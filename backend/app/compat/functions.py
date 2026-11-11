"""Keçmiş Supabase edge function-ları: POST /functions/v1/<ad>.

Klientlər `supabase.functions.invoke('<ad>', { body })` çağırır: JSON gövdə +
istifadəçinin bearer token-i; cavab JSON-dur, 2xx olmayan status klientdə
`error` (FunctionsHttpError) olur. Hər marşrut köhnə Deno funksiyasının
(supabase/functions/<ad>/index.ts) qəbul etdiyi gövdəni və qaytardığı JSON-u
saxlayır, iş məntiqi isə mövcud Python kodunun üzərindədir:

    create-payment-session   Epoint ödəniş sessiyası (balans / xidmət promosu /
                             payout kartı qeydiyyatı)        → payments + epoint
    verify-payment           webhook gəlməyibsə statusu Epoint-dən soruşur
    payment-webhook          Epoint callback-i (köhnə ünvanla eyni yol)
    process-withdrawal       admin çıxarışı emal edir         → withdrawals
    delete-account           istifadəçi öz hesabını silir
    admin-change-password    admin istifadəçi parolunu dəyişir → password
    ai-question-generator,
    ai-price-research        mənbə kodu yoxdur — "hələ qoşulmayıb" cavabı

Çağıranın kimliyi yalnız token-dən götürülür; rol hər dəfə bazadan oxunur.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import password as password_api
from app.api.v1 import payments as payments_api
from app.api.v1 import withdrawals as withdrawals_api
from app.compat.context import ADMIN_ROLES, get_caller
from app.compat.errors import ApiError
from app.core.config import settings
from app.db.session import get_db, redis, set_actor
from app.models.user import RefreshSession, User
from app.services import epoint

log = logging.getLogger("ellit.functions")

router = APIRouter(tags=["compat-functions"])

DEFAULT_RETURN_URL = "https://ellit.az/payment/result"
MAX_TOPUP = Decimal("10000")

# Xidmət promosu qiymətləri (₼): növ → gün → qiymət (köhnə funksiyadakı cədvəl)
PROMOTION_PRICE: dict[str, dict[int, int]] = {
    "vip": {5: 5, 10: 10, 30: 25},
    "premium": {5: 10, 15: 30, 30: 45},
}


# ── Köməkçilər ────────────────────────────────────────────────────
class _Fail(Exception):
    """Funksiyanın JSON xəta cavabı (status + gövdə)."""

    def __init__(self, status: int, error: str, **extra: Any) -> None:
        super().__init__(error)
        self.status, self.payload = status, {"error": error, **extra}


def _jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _json(payload: dict, status: int = 200) -> JSONResponse:
    return JSONResponse(status_code=status, content=_jsonable(payload))


def _function(handler):
    """_Fail → JSON xəta; gözlənilməz xəta → 500 (təfərrüat yalnız logda)."""

    async def wrapper(request: Request, db: AsyncSession = Depends(get_db)) -> JSONResponse:
        try:
            return await handler(request, db)
        except _Fail as f:
            await db.rollback()
            return _json(f.payload, f.status)
        except Exception:  # noqa: BLE001
            await db.rollback()
            log.exception("functions/%s gözlənilməz xəta", handler.__name__)
            return _json({"error": "Internal error"}, 500)

    # functools.wraps işlədilmir: FastAPI imzanı `__wrapped__`-dan oxuyardı
    wrapper.__name__, wrapper.__doc__ = handler.__name__, handler.__doc__
    return wrapper


async def _body(request: Request, *, required: bool = True) -> dict:
    raw = await request.body()
    if not raw.strip():
        if required:
            raise _Fail(400, "Invalid JSON")
        return {}
    try:
        data = json.loads(raw)
    except ValueError as e:
        raise _Fail(400, "Invalid JSON") from e
    if not isinstance(data, dict):
        raise _Fail(400, "Invalid JSON")
    return data


async def _user(request: Request, db: AsyncSession, *,
                missing: str = "Missing Authorization",
                invalid: str = "Invalid token") -> User:
    """Token sahibi (aktiv `users` sətri). Köhnə funksiyalardakı
    `auth.getUser()` qarşılığı: token yoxdur/etibarsızdır/hesab deaktivdir → 401."""
    if not request.headers.get("authorization"):
        raise _Fail(401, missing)
    try:
        caller = get_caller(request)
    except ApiError as e:                      # vaxtı bitmiş token
        raise _Fail(401, invalid, message=e.message) from e
    if caller.user_id is None:
        raise _Fail(401, invalid)
    user = (
        await db.execute(select(User).where(User.id == caller.user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise _Fail(401, invalid)
    await set_actor(db, user.id)               # audit trigger-ləri üçün aktyor
    return user


def _is_admin(user: User) -> bool:
    return (user.role or "").lower() in ADMIN_ROLES


def _epoint_configured() -> bool:
    return bool(settings.EPOINT_PUBLIC_KEY.strip() and settings.EPOINT_PRIVATE_KEY.strip())


async def _epoint_call(endpoint: str, payload: dict[str, Any]) -> tuple[int, dict]:
    """Epoint API çağırışı (data + signature form sahələri) → (HTTP status, JSON)."""
    data = epoint.encode_data(payload)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{epoint.EPOINT_API}/{endpoint}",
            data={"data": data, "signature": epoint.sign(data)},
        )
    try:
        body = resp.json()
    except ValueError:
        body = {}
    return resp.status_code, body if isinstance(body, dict) else {}


def _append_query(url: str, params: dict[str, str]) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(params)
    return urlunsplit(parts._replace(query=urlencode(query)))


def _return_url(body: dict) -> str:
    url = body.get("return_url")
    if url is None:
        return DEFAULT_RETURN_URL
    if not isinstance(url, str) or not url.strip() or len(url) > 2000:
        raise _Fail(400, "Invalid return_url")
    return url.strip()


def _account(body: dict, return_url: str) -> str:
    """Köhnə funksiya veb/mobil üçün iki Epoint hesabı dəstəkləyirdi; burada
    bir hesab var, kanal yalnız metadata-da qeyd olunur."""
    mobile = body.get("channel") == "mobile" or return_url.startswith("ellitbooking://")
    return "mobile" if mobile else "web"


async def _insert_payment(db: AsyncSession, *, user_id: uuid.UUID, amount: Decimal | None,
                          description: str, metadata: dict) -> int:
    """Pending ödəniş sətri. Epoint-ə `order_id` kimi ödənişin id-si gedir
    (köhnə funksiyadakı kimi) — webhook sətri `payments.order_id` ilə tapır."""
    pid = (await db.execute(text("select nextval('payments_id_seq') as id"))).first().id
    await db.execute(
        text(
            "insert into payments (id, order_id, user_id, amount, currency, status,"
            " method, provider, description, metadata)"
            " values (:id, :o, :u, :a, 'AZN', 'pending', 'card', 'epoint', :d,"
            " cast(:m as jsonb))"
        ),
        {"id": pid, "o": str(pid), "u": user_id, "a": amount, "d": description,
         "m": json.dumps(metadata, ensure_ascii=False)},
    )
    await db.commit()
    return int(pid)


async def _mark_payment(db: AsyncSession, pid: int, status: str, extra: dict) -> None:
    await db.execute(
        text(
            "update payments set status = :s,"
            " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
            " where id = :id"
        ),
        {"s": status, "m": json.dumps(extra, ensure_ascii=False, default=str), "id": pid},
    )
    await db.commit()


# ── create-payment-session ────────────────────────────────────────
@router.post("/create-payment-session")
@_function
async def create_payment_session(request: Request, db: AsyncSession) -> JSONResponse:
    """Gövdə: {purpose?, amount?, currency?, description?, return_url?, channel?,
    service_id?, promotion_type?, promotion_duration?, offer_id?}
    Cavab: {payment_id, redirect_url, transaction_id} |
           {payment_id: null, redirect_url: null, mode: 'test', message}"""
    user = await _user(request, db)
    body = await _body(request)

    purpose = body.get("purpose") or "balance_topup"
    currency = str(body.get("currency") or "AZN").upper()
    if currency != "AZN":
        raise _Fail(400, "Unsupported currency")
    return_url = _return_url(body)
    account = _account(body, return_url)

    if purpose == "card_registration":
        return await _card_registration(db, user, body, return_url, account)

    if purpose == "service_payment":
        # Köhnə axın (kartla birbaşa təklif ödənişi → lock_offer_payment) Python
        # backend-də yoxdur: təklif balansdan qəbul olunur (accept_offer_with_payment).
        raise _Fail(501, "service_payment bu serverdə dəstəklənmir — balansı artırıb"
                         " təklifi balansdan qəbul edin", code="NOT_IMPLEMENTED")

    service_id: int | None = None
    promotion_type = promotion_days = None
    if purpose == "service_promotion":
        promotion_type = body.get("promotion_type")
        try:
            promotion_days = int(body.get("promotion_duration") or 0)
        except (TypeError, ValueError):
            promotion_days = 0
        if not body.get("service_id") or not promotion_type or not promotion_days:
            raise _Fail(400, "Missing service_id / promotion_type / promotion_duration")
        price = PROMOTION_PRICE.get(str(promotion_type), {}).get(promotion_days)
        if not price:
            raise _Fail(400, "Invalid promotion tier/duration")
        try:
            service_id = int(str(body["service_id"]))
        except ValueError as e:
            raise _Fail(404, "Service not found") from e
        svc = (
            await db.execute(
                text("select provider_id from services where id = :id"), {"id": service_id}
            )
        ).first()
        if svc is None:
            raise _Fail(404, "Service not found")
        if svc.provider_id != user.id:
            raise _Fail(403, "Forbidden — not service owner")
        amount = Decimal(price)
        description = f"{str(promotion_type).upper()} promotion ({promotion_days} gün)"
    elif purpose == "balance_topup":
        try:
            amount = Decimal(str(body.get("amount")))
        except (InvalidOperation, ValueError) as e:
            raise _Fail(400, "Invalid amount") from e
        if not amount.is_finite() or amount <= 0:
            raise _Fail(400, "Invalid amount")
        if amount > MAX_TOPUP:
            raise _Fail(400, "Amount exceeds limit (10000 AZN)")
        # Epoint-ə 2 onluq yerlə gedir — sətirdə də eyni məbləğ saxlanır
        amount = amount.quantize(Decimal("0.01"), ROUND_HALF_UP)
        if amount <= 0:
            raise _Fail(400, "Invalid amount")
        description = str(body.get("description") or "Balance top-up")[:500]
    else:
        raise _Fail(400, "Invalid purpose")

    if not _epoint_configured():
        # Açarsız rejimdə pending sətir YARADILMIR (imzası yoxlana bilməyən
        # callback ilə tamamlana bilməsin) — klient `message`-i göstərir.
        return _json({
            "payment_id": None, "redirect_url": None, "mode": "test",
            "message": "Ödəniş sistemi konfiqurasiya olunmayıb"
                       " (EPOINT_PUBLIC_KEY / EPOINT_PRIVATE_KEY).",
        })

    pid = await _insert_payment(
        db, user_id=user.id, amount=amount, description=description,
        metadata={
            "purpose": purpose,
            "service_id": service_id,
            "promotion_type": promotion_type,
            "promotion_duration": promotion_days,
            "promotion_days": promotion_days,     # webhook bu açarı oxuyur
            "offer_id": None,
            "return_url": body.get("return_url"),
            "epoint_account": account,
        },
    )
    url_with_id = _append_query(return_url, {"id": str(pid)})
    try:
        resp = await epoint.create_checkout(
            amount=f"{amount:.2f}", order_id=str(pid), description=description,
            success_url=url_with_id,
            error_url=_append_query(url_with_id, {"status": "failed"}),
        )
    except Exception as e:  # noqa: BLE001 — şəbəkə / HTTP xətası
        log.warning("Epoint /request xətası: %s", e)
        await _mark_payment(db, pid, "failed", {"epoint_error": {"message": str(e)[:300]}})
        raise _Fail(502, "Gateway error") from e
    if not isinstance(resp, dict) or resp.get("status") != "success" \
            or not resp.get("redirect_url"):
        resp = resp if isinstance(resp, dict) else {}
        log.warning("Epoint /request rədd etdi (payment %s): status=%s code=%s message=%s",
                    pid, resp.get("status"), resp.get("code"), str(resp.get("message"))[:200])
        await _mark_payment(db, pid, "failed", {"epoint_error": {
            "code": resp.get("code"), "message": resp.get("message")}})
        raise _Fail(502, "Gateway error", epoint=resp)

    transaction = resp.get("transaction")
    if transaction:
        await db.execute(
            text("update payments set external_id = :t where id = :id"),
            {"t": str(transaction), "id": pid},
        )
        await db.commit()
    return _json({"payment_id": pid, "redirect_url": resp["redirect_url"],
                  "transaction_id": transaction})


async def _card_registration(db: AsyncSession, user: User, body: dict,
                             return_url: str, account: str) -> JSONResponse:
    """Payout kartının Epoint-də qeydiyyatı (refund=1). Callback-də order_id
    olmur — sətir `description`-dakı `pid:`/`uid:` nişanları ilə tapılır."""
    if not _epoint_configured():
        raise _Fail(500, "Epoint açarları konfiqurasiya olunmayıb")
    # Məbləğ yoxdur: payments_amount_positive CHECK 0-ı qəbul etmir → NULL
    pid = await _insert_payment(
        db, user_id=user.id, amount=None, description="Card registration for payouts",
        metadata={"purpose": "card_registration", "return_url": body.get("return_url"),
                  "epoint_account": account},
    )
    url_with_id = _append_query(return_url, {"id": str(pid), "kind": "card_registration"})
    payload = {
        "public_key": settings.EPOINT_PUBLIC_KEY,
        "language": "az",
        "refund": "1",
        "description": f"Ellit payout card | uid:{user.id} | pid:{pid}",
        "success_redirect_url": url_with_id,
        "error_redirect_url": _append_query(url_with_id, {"status": "failed"}),
    }
    try:
        status, resp = await _epoint_call("card-registration", payload)
    except Exception as e:  # noqa: BLE001
        log.warning("Epoint /card-registration xətası: %s", e)
        status, resp = 0, {"message": str(e)[:300]}
    if not 200 <= status < 300 or resp.get("status") != "success":
        log.warning("Epoint /card-registration rədd etdi (payment %s): http=%s message=%s",
                    pid, status, str(resp.get("message"))[:200])
        await _mark_payment(db, pid, "failed", {"epoint_error": resp})
        raise _Fail(502, "Gateway error (card-registration)", epoint=resp)
    return _json({"payment_id": pid, "redirect_url": resp.get("redirect_url"),
                  "transaction_id": resp.get("transaction")})


# ── verify-payment ────────────────────────────────────────────────
@router.post("/verify-payment")
@_function
async def verify_payment(request: Request, db: AsyncSession) -> JSONResponse:
    """Gövdə: {payment_id}. Webhook gəlməyibsə ödənişin statusunu Epoint-dən
    soruşur və uğurludursa webhook-la eyni emalı (idempotent) aparır."""
    user = await _user(request, db, missing="NOT_AUTHENTICATED", invalid="NOT_AUTHENTICATED")
    body = await _body(request, required=False)
    raw_id = body.get("payment_id")
    if raw_id in (None, ""):
        raise _Fail(400, "MISSING_PAYMENT_ID")
    try:
        pid = int(str(raw_id))
    except ValueError as e:
        raise _Fail(404, "PAYMENT_NOT_FOUND") from e

    pay = (
        await db.execute(
            text("select id, user_id, amount, status, order_id, external_id, metadata"
                 " from payments where id = :id"),
            {"id": pid},
        )
    ).first()
    if pay is None:
        raise _Fail(404, "PAYMENT_NOT_FOUND")
    # Yalnız ödənişin sahibi (və ya admin/dəstək)
    if pay.user_id != user.id and not (_is_admin(user) or user.role == "support"):
        raise _Fail(403, "NOT_AUTHORIZED")

    if pay.status == "completed":
        return _json({"ok": True, "status": "completed", "already_completed": True})
    if not pay.external_id:
        return _json({"ok": False, "error": "NO_TRANSACTION_ID",
                      "payment_status": pay.status})
    meta = pay.metadata or {}
    purpose = meta.get("purpose") or "balance_topup"
    if pay.status != "pending":
        return _json({"ok": False, "error": "NOT_PENDING", "payment_status": pay.status})
    if purpose not in ("balance_topup", "service_promotion"):
        # service_payment / card_registration burada tamamlanmır (balansa yazılmasın)
        return _json({"ok": False, "error": "UNSUPPORTED_PURPOSE",
                      "payment_status": pay.status})
    if not _epoint_configured():
        raise _Fail(500, "Server misconfigured")

    try:
        http_status, ep = await _epoint_call("get-status", {
            "public_key": settings.EPOINT_PUBLIC_KEY, "transaction": str(pay.external_id)})
    except Exception as e:  # noqa: BLE001
        log.warning("Epoint /get-status xətası: %s", e)
        return _json({"ok": False, "error": "EPOINT_HTTP_ERROR", "status": 0, "epoint": {}})
    if not 200 <= http_status < 300:
        return _json({"ok": False, "error": "EPOINT_HTTP_ERROR",
                      "status": http_status, "epoint": ep})

    ep_status = str(ep.get("status") or "").lower()
    if ep_status != "success":
        if ep_status in ("error", "returned", "server_error"):
            await db.execute(
                text(
                    "update payments set status = :s,"
                    " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
                    " where id = :id and status = 'pending'"
                ),
                {"s": "refunded" if ep_status == "returned" else "failed",
                 "m": json.dumps({"epoint_status_check": ep}, default=str), "id": pid},
            )
            await db.commit()
        return _json({"ok": False, "epoint_status": ep_status,
                      "message": ep.get("message"), "payment_status": pay.status})

    # Məbləğ uyğunluğu (əlavə müdafiə) — Epoint başqa məbləğ deyirsə kredit YOXDUR
    if ep.get("amount") is not None:
        try:
            ep_amount = Decimal(str(ep["amount"]))
        except (InvalidOperation, ValueError):
            ep_amount = None
        if ep_amount is None or not ep_amount.is_finite() \
                or abs(ep_amount - Decimal(pay.amount)) > Decimal("0.01"):
            await db.execute(
                text(
                    "update payments set status = 'failed',"
                    " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
                    " where id = :id and status = 'pending'"
                ),
                {"m": json.dumps({"amount_mismatch": {
                    "expected": str(pay.amount), "received": str(ep["amount"])}}),
                 "id": pid},
            )
            await db.commit()
            return _json({"ok": False, "error": "AMOUNT_MISMATCH"})

    # Köçürülmüş köhnə sətirlərdə order_id boş ola bilər — emal ona görə tapır
    order_id = pay.order_id
    if not order_id:
        order_id = str(pid)
        await db.execute(
            text("update payments set order_id = :o where id = :id and order_id is null"),
            {"o": order_id, "id": pid},
        )
    # Webhook ilə eyni (idempotent) emal: balans krediti / promo tətbiqi
    await payments_api.settle_payment(
        db, order_id=order_id, status="success", transaction=pay.external_id)
    row = (
        await db.execute(
            text("select p.status, pr.balance from payments p"
                 " left join profiles pr on pr.id = p.user_id where p.id = :id"),
            {"id": pid},
        )
    ).first()
    if row.status != "completed":
        return _json({"ok": False, "error": "RPC_FAILED", "payment_status": row.status})
    await db.execute(
        text(
            "update payments set"
            " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
            " where id = :id"
        ),
        {"m": json.dumps({"recovered_via": "verify-payment",
                          "epoint_status_check": ep}, default=str), "id": pid},
    )
    await db.commit()
    return _json({"ok": True, "status": "completed", "credited_amount": pay.amount,
                  "new_balance": row.balance, "purpose": purpose})


# ── payment-webhook (Epoint callback — köhnə ünvanla eyni yol) ─────
_TAG_UID = re.compile(r"uid:([a-f0-9-]+)", re.I)
_TAG_PID = re.compile(r"pid:(\d+)", re.I)


@router.post("/payment-webhook")
@_function
async def payment_webhook(request: Request, db: AsyncSession) -> JSONResponse:
    """Bank JWT göndərmir — təhlükəsizlik yalnız imzadır (payments.verify_callback).
    Ödəniş callback-ləri /api/v1/payments/webhook ilə eyni emaldan keçir;
    əlavə olaraq kart qeydiyyatı callback-i (operation_code 001) emal olunur."""
    if not settings.EPOINT_PRIVATE_KEY.strip():
        raise _Fail(500, "Server misconfigured")   # açarsız imza yoxlana bilməz
    ctype = request.headers.get("content-type") or ""
    data_b64 = signature = ""
    if "application/json" in ctype:
        try:
            raw = json.loads(await request.body() or b"{}")
        except ValueError:
            raw = {}
        if isinstance(raw, dict):
            data_b64, signature = str(raw.get("data") or ""), str(raw.get("signature") or "")
    else:
        form = await request.form()
        data_b64, signature = str(form.get("data") or ""), str(form.get("signature") or "")
    try:
        cb = await payments_api.verify_callback(db, data_b64, signature)
    except HTTPException as e:
        raise _Fail(e.status_code, str(e.detail)) from e
    except ValueError as e:
        raise _Fail(400, "Invalid payload") from e
    if not isinstance(cb, dict):
        raise _Fail(400, "Invalid payload")

    is_card_registration = str(cb.get("operation_code")) == "001" or (
        bool(cb.get("card_id")) and cb.get("amount") is None)
    if is_card_registration:
        return await _card_registration_callback(db, cb)

    order_id = cb.get("order_id")
    if not order_id:
        raise _Fail(400, "Missing order_id")
    return _json(await payments_api.settle_payment(
        db, order_id=str(order_id), status=cb.get("status"),
        transaction=cb.get("transaction")))


async def _card_registration_callback(db: AsyncSession, cb: dict) -> JSONResponse:
    desc = str(cb.get("description") or "")
    pid_m, uid_m = _TAG_PID.search(desc), _TAG_UID.search(desc)
    if not pid_m and not uid_m:
        raise _Fail(400, "Cannot resolve card registration (no pid/uid in description)")
    row = None
    cols = "select id, user_id, status from payments"
    if pid_m:
        row = (
            await db.execute(
                text(f"{cols} where id = :id"
                     " and metadata ->> 'purpose' = 'card_registration' for update"),
                {"id": int(pid_m.group(1))},
            )
        ).first()
    if row is None and uid_m:
        try:
            uid = uuid.UUID(uid_m.group(1))
        except ValueError as e:
            raise _Fail(400, "Cannot resolve card registration (bad uid)") from e
        row = (
            await db.execute(
                text(f"{cols} where user_id = :u and status = 'pending'"
                     " and metadata ->> 'purpose' = 'card_registration'"
                     " order by created_at desc limit 1 for update"),
                {"u": uid},
            )
        ).first()
    if row is None:
        raise _Fail(404, "Card registration payment row not found")
    if row.status == "completed":
        return _json({"ok": True, "idempotent": True})
    if row.status != "pending":
        return _json({"ok": True, "skipped": "artıq emal olunub"})

    meta = json.dumps({"epoint_payload": cb}, ensure_ascii=False, default=str)
    if cb.get("status") == "success" and cb.get("card_id"):
        await db.execute(
            text(
                "update profiles set epoint_card_uid = :c,"
                " epoint_card_mask = coalesce(cast(:m as text), epoint_card_mask)"
                " where id = :u"
            ),
            {"c": str(cb["card_id"]),
             "m": str(cb["card_mask"]) if cb.get("card_mask") else None,
             "u": row.user_id},
        )
        await db.execute(
            text(
                "update payments set status = 'completed', completed_at = now(),"
                " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
                " where id = :id"
            ),
            {"m": meta, "id": row.id},
        )
        await db.commit()
        return _json({"ok": True, "card_registered": True})

    await db.execute(
        text(
            "update payments set status = :s,"
            " metadata = coalesce(metadata, '{}'::jsonb) || cast(:m as jsonb)"
            " where id = :id"
        ),
        {"s": "cancelled" if cb.get("status") == "cancelled" else "failed",
         "m": meta, "id": row.id},
    )
    await db.commit()
    return _json({"ok": True})


# ── process-withdrawal ────────────────────────────────────────────
@router.post("/process-withdrawal")
@_function
async def process_withdrawal(request: Request, db: AsyncSession) -> JSONResponse:
    """Gövdə: {withdrawal_id, action: 'payout'|'manual'|'reject', notes?} — yalnız admin.
    payout → Epoint execute-pay + processed; manual → yalnız processed;
    reject → rejected + məbləğ balansa qaytarılır."""
    admin = await _user(request, db)
    if not _is_admin(admin):
        raise _Fail(403, "Forbidden — admin only")
    body = await _body(request)
    action = body.get("action")
    if not body.get("withdrawal_id") or not action:
        raise _Fail(400, "Missing withdrawal_id or action")
    try:
        wd_id = uuid.UUID(str(body["withdrawal_id"]))
    except ValueError as e:
        raise _Fail(404, "Withdrawal not found") from e
    notes = body.get("notes")
    notes = str(notes)[:500] if notes else None
    if action not in ("payout", "manual", "reject"):
        raise _Fail(400, "Unknown action")

    # Sətir kilidlənir: eyni çıxarış üçün paralel iki payout mümkün olmasın
    wd = (
        await db.execute(
            text("select id, provider_id, net_amount, status from withdrawals"
                 " where id = :id for update"),
            {"id": wd_id},
        )
    ).first()
    if wd is None:
        raise _Fail(404, "Withdrawal not found")
    if wd.status != "pending":
        raise _Fail(400, f"Withdrawal already {wd.status}")

    async def finish(approve: bool, admin_notes: str | None,
                     external_id: str | None = None) -> None:
        try:
            await withdrawals_api.process_withdrawal_core(
                db, withdrawal_id=wd_id, approve=approve, admin_notes=admin_notes,
                admin_id=admin.id, external_id=external_id)
        except withdrawals_api.WithdrawalError as e:
            raise _Fail(400, e.message) from e

    if action == "reject":
        await finish(False, notes)
        return _json({"ok": True, "status": "rejected"})
    if action == "manual":
        await finish(True, notes or "Manual transfer by admin")
        return _json({"ok": True, "status": "processed", "mode": "manual"})

    # ── payout: Epoint execute-pay (yalnız refund=1 ilə qeydiyyatlı karta) ──
    if not _epoint_configured():
        raise _Fail(500, "Epoint açarları konfiqurasiya olunmayıb")
    prof = (
        await db.execute(
            text("select epoint_card_uid from profiles where id = :id"),
            {"id": wd.provider_id},
        )
    ).first()
    card_uid = prof.epoint_card_uid if prof else None
    if not card_uid:
        raise _Fail(
            400,
            "Provayder Epoint-də kartını qeydiyyatdan keçirməyib. Manual emala salın və ya"
            " provayderdən kartını qeydiyyatdan keçirməsini xahiş edin.",
            requires_card_registration=True,
        )
    try:
        status, resp = await _epoint_call("execute-pay", {
            "public_key": settings.EPOINT_PUBLIC_KEY,
            "language": "az",
            "card_uid": str(card_uid),
            "order_id": str(wd.id),
            "amount": f"{Decimal(wd.net_amount):.2f}",
            "currency": "AZN",
            "description": f"Withdrawal {str(wd.id)[:8]}",
        })
    except Exception as e:  # noqa: BLE001
        log.warning("Epoint /execute-pay xətası: %s", e)
        raise _Fail(502, "Epoint payout failed", epoint={"message": str(e)[:300]}) from e
    if not 200 <= status < 300 or resp.get("status") != "success":
        raise _Fail(502, "Epoint payout failed", epoint=resp)

    external_id = str(resp.get("transaction") or resp.get("transaction_id") or "")
    try:
        await finish(True, notes or f"Epoint payout: {external_id}", external_id or None)
    except Exception as e:  # noqa: BLE001 — pul artıq göndərilib, admin bilməlidir
        log.exception("payout uğurlu, DB yenilənmədi (withdrawal %s, epoint %s)",
                      wd_id, external_id)
        raise _Fail(500, "Payout succeeded but DB update failed",
                    external_id=external_id) from e
    return _json({"ok": True, "status": "processed", "mode": "epoint",
                  "external_id": external_id})


# ── delete-account ────────────────────────────────────────────────
@router.post("/delete-account")
@_function
async def delete_account(request: Request, db: AsyncSession) -> JSONResponse:
    """Gövdə: {} — istifadəçi YALNIZ öz hesabını silir (id token-dən).
    Cavab: {ok: true} | 409 {error: 'HAS_ACTIVE_OFFERS'|'HAS_PENDING_WITHDRAWALS'}"""
    user = await _user(request, db, missing="MISSING_AUTHORIZATION", invalid="INVALID_TOKEN")
    uid = user.id

    # Açıq öhdəliklər varsa silmək olmaz: icra olunan iş (usta kimi) və ya
    # ödənişi escrow-da olan öz sifarişi (müştəri kimi — sifariş silinsə
    # ustanın kilidli məbləği sahibsiz qalardı)
    active = (
        await db.execute(
            text(
                "select (select count(*) from opportunities_offers"
                "         where provider_id = :u"
                "           and status in ('accepted', 'ongoing', 'in_progress'))"
                "     + (select count(*) from opportunities"
                "         where created_by = :u and status in ('active', 'accepted',"
                "           'i-am-here', 'ongoing', 'pending_review', 'disputed')) as c"
            ),
            {"u": uid},
        )
    ).first()
    if active.c:
        raise _Fail(409, "HAS_ACTIVE_OFFERS",
                    message="Aktiv sifarişlərini tamamla və ya ləğv et, sonra hesabı sil.")
    pending_wd = (
        await db.execute(
            text("select count(*) as c from withdrawals"
                 " where provider_id = :u and status in ('pending', 'processing')"),
            {"u": uid},
        )
    ).first()
    if pending_wd.c:
        raise _Fail(409, "HAS_PENDING_WITHDRAWALS",
                    message="Gözləyən çıxarış sorğun var. Tamamlanmasını gözlə.")

    # Bütün cihazlardakı sessiyalar bağlanır
    sessions = (
        await db.execute(select(RefreshSession.jti).where(RefreshSession.user_id == uid))
    ).scalars().all()
    await db.execute(
        text("update refresh_sessions set revoked = true where user_id = :u"), {"u": uid})

    deleted = True
    try:
        # Savepoint — FK pozuntusunda tranzaksiya bütövlükdə ölməsin
        async with db.begin_nested():
            await db.execute(text("delete from profiles where id = :u"), {"u": uid})
            await db.execute(text("delete from users where id = :u"), {"u": uid})
    except DBAPIError:
        # Tarixçəsi (FK / trigger qadağası) olan hesab fiziki silinə bilmir → kimlik söndürülür
        # və şəxsi məlumat təmizlənir (giriş mümkün deyil, e-poçt/telefon azad olur)
        deleted = False
        await db.execute(text("delete from oauth_identities where user_id = :u"), {"u": uid})
        await db.execute(text("delete from user_devices where user_id = :u"), {"u": uid})
        await db.execute(
            text("update users set is_active = false, email = null, phone = null,"
                 " password_hash = null where id = :u"),
            {"u": uid},
        )
        await db.execute(
            text(
                "update profiles set status = 'deleted', name = 'Silinmiş istifadəçi',"
                " email = null, phone_number = null, address = null, avatar_url = null,"
                " birth_date = null, latitude = null, longitude = null,"
                " epoint_card_uid = null, epoint_card_mask = null, is_online = false,"
                " availability_status = 'offline' where id = :u"
            ),
            {"u": uid},
        )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, :act, 'user', :t, jsonb_build_object('method', 'delete-account'))"
        ),
        {"a": None if deleted else uid,
         "act": "account_delete" if deleted else "account_deactivate", "t": str(uid)},
    )
    await db.commit()
    try:
        for jti in sessions:
            await redis.delete(f"rt:{jti}")
    except Exception:  # noqa: BLE001 — Redis əlçatmazdırsa DB-dəki revoke kifayətdir
        pass
    return _json({"ok": True})


# ── admin-change-password ─────────────────────────────────────────
@router.post("/admin-change-password")
@_function
async def admin_change_password(request: Request, db: AsyncSession) -> JSONResponse:
    """Gövdə: {user_id, new_password} — yalnız admin. Hədəfin bütün sessiyaları
    bağlanır, ona təhlükəsizlik bildirişi gedir, əməliyyat audit_log-a yazılır."""
    admin = await _user(request, db)
    if not _is_admin(admin):
        raise _Fail(403, "Yalnız admin üçün!")
    body = await _body(request)
    new_password = body.get("new_password")
    if not body.get("user_id") or not new_password or not isinstance(new_password, str):
        raise _Fail(400, "Missing user_id or new_password")
    if len(new_password) < 6:
        raise _Fail(400, "Parol minimum 6 simvol olmalıdır")
    if len(new_password) > 128:
        raise _Fail(400, "Parol maksimum 128 simvol ola bilər")
    try:
        target_id = uuid.UUID(str(body["user_id"]))
    except ValueError as e:
        raise _Fail(400, "User not found") from e
    target = (
        await db.execute(select(User).where(User.id == target_id))
    ).scalar_one_or_none()
    if target is None:
        raise _Fail(400, "User not found")

    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'admin_password_reset', 'user', :t,"
            " jsonb_build_object('method', 'admin-change-password'))"
        ),
        {"a": admin.id, "t": str(target_id)},
    )
    # Yeni parol + bütün sessiyaların bağlanması + bildiriş (commit daxildir)
    await password_api.set_password(db, target, new_password)
    return _json({"ok": True})


# ── AI funksiyaları (mənbə kodu repoda yoxdur) ────────────────────
def _ai_not_implemented(name: str) -> JSONResponse:
    # HTTP 200 + success:false — klient yalnız bu halda `message`-i göstərir
    # (2xx olmayan cavabda supabase-js ümumi "non-2xx" mətni verir).
    return _json({
        "success": False,
        "error": "NOT_IMPLEMENTED",
        "status": 501,
        "function": name,
        "message": "AI xidməti bu serverdə hələ qoşulmayıb — sualları/qiymətləri"
                   " əl ilə daxil edin.",
    })


async def _admin_only(request: Request, db: AsyncSession) -> None:
    try:
        user = await _user(request, db)
    except _Fail as f:
        raise _Fail(f.status, f.payload["error"], success=False,
                    message="Giriş tələb olunur") from f
    if not _is_admin(user):
        raise _Fail(403, "Forbidden — admin only", success=False,
                    message="Yalnız admin üçün")


@router.post("/ai-question-generator")
@_function
async def ai_question_generator(request: Request, db: AsyncSession) -> JSONResponse:
    """Gözlənilən müqavilə — gövdə: {category_id, category_label, subcategory_id,
    subcategory_label}; uğurda funksiya sualları `service_questions`-a ÖZÜ yazır və
    {success: true, count: <yazılan sual sayı>} qaytarır; əks halda
    {success: false, message}."""
    await _admin_only(request, db)
    return _ai_not_implemented("ai-question-generator")


@router.post("/ai-price-research")
@_function
async def ai_price_research(request: Request, db: AsyncSession) -> JSONResponse:
    """Gözlənilən müqavilə — gövdə: {category_label, subcategory_label}; uğurda
    {success: true, priceResult: {average_min, average_max, description}}."""
    await _admin_only(request, db)
    return _ai_not_implemented("ai-price-research")


# ── Naməlum funksiya ──────────────────────────────────────────────
@router.post("/{name}")
async def unknown_function(name: str) -> JSONResponse:
    return _json({"code": "NOT_FOUND", "error": "Function not found",
                  "message": f"Requested function was not found: {name}"}, 404)
