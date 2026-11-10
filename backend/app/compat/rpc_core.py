"""Əsas (core) RPC-lər — klientlərin `supabase.rpc('<ad>')` ilə çağırdığı
sifariş/təklif/pul/söhbət funksiyaları. Qaydalar: app/compat/rpc.py

Hər handler köhnə SQL funksiyası ilə eyni arqument adlarını (p_...) qəbul edir
və klientin oxuduğu formada cavab qaytarır. İş məntiqi mövcud Python
servislərindədir (`app/services/marketplace.py`, `money.py`, `brigade.py`,
`cron.py`) — REST endpoint-ləri də eyni servisləri çağırır; burada yalnız
arqument çevrilməsi, icazə və xəta/cavab formasının tərcüməsi var.

İcazə:
  * `home_overview` istisna olmaqla hamısı giriş tələb edir (reyestr anonimi
    401 ilə rədd edir). Çağıran HƏMİŞƏ tokendən götürülür (`auth.uid()`
    əvəzi) — arqumentdə gələn heç bir istifadəçi id-sinə etibar edilmir.
  * Rol tokendən yox, BAZADAN (`users.role`) oxunur — REST-dəki
    `get_current_user` kimi: rolu dəyişmiş və ya bloklanmış hesabın köhnə
    tokeni keçmir.

Xəta forması (klient nəyi yoxlayırsa o):
  * SQL-də `raise exception '...'` olan hallar → {code:'P0001', message} (400).
    Klientlərin axtardığı kodlar mesajda saxlanır: NO_BALANCE, KYC_REQUIRED,
    PROMO_INVALID, INSUFFICIENT_BALANCE, PROVIDER_/BRIGADE_INSUFFICIENT_BALANCE.
  * SQL-in `{ok:false, error:'KOD'}` QAYTARDIĞI funksiyalar
    (refund_offer_payment, cancel_opportunity, create_booking_with_fee) burada
    da 200 ilə eyni obyekti qaytarır.
  * Pul sahələri JSON ədədi kimi verilir (klient `.toFixed()` / `as num` edir).
"""
from __future__ import annotations

import datetime as dt
import functools
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.compat.errors import ApiError, RpcError, from_pg
from app.compat.rpc import RpcContext, rpc
from app.services import brigade, cron, marketplace, money
from app.services.brigade import BrigadeError
from app.services.marketplace import ADMIN_ROLES, OpError
from app.services.money import MoneyError, _config_pct, _round2
from app.services.notify import dispatch_all
from app.services.realtime import publish


# ── Çağıran (bazadan təsdiqlənmiş) ────────────────────────────────
@dataclass
class Actor:
    id: uuid.UUID
    role: str            # users.role — customer | provider | admin | ...

    @property
    def is_admin(self) -> bool:
        return self.role in ADMIN_ROLES


async def _actor(ctx: RpcContext) -> Actor:
    """Tokendəki istifadəçini bazadan yoxlayır və cari rolunu qaytarır."""
    uid = ctx.require_user()
    row = (
        await ctx.db.execute(
            text("select role, is_active from users where id = :id"), {"id": uid}
        )
    ).first()
    if row is None or not row.is_active:
        # get_current_user ilə eyni: silinmiş/bloklanmış hesabın tokeni keçmir
        raise ApiError(401, "PGRST301", "Hesab aktiv deyil")
    role = (row.role or "").lower()
    # 'system' yalnız daxili dövri işlərin roludur — kənardan heç vaxt gəlmir
    return Actor(id=uid, role="customer" if role == "system" else role)


def _core(name: str, *, anon: bool = False):
    """`@rpc` + servis xətalarının PostgREST formatına tərcüməsi.
    `functools.wraps` imzanı saxlayır — reyestr arqument adlarını əsl
    funksiyadan oxuyur."""

    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(ctx: RpcContext, **kwargs: Any) -> Any:
            try:
                return await fn(ctx, **kwargs)
            except ApiError:
                raise
            except (MoneyError, BrigadeError, OpError) as e:
                # köhnə `raise exception '...'` → {code: 'P0001', message}
                raise RpcError(str(e)) from e
            except DBAPIError as e:
                # trigger xətası (məs. INVALID_STATUS_TRANSITION), məhdudiyyət
                # pozuntusu və s. — PostgREST kimi SQLSTATE ilə
                pg = getattr(e.orig, "__cause__", None) or e.orig
                raise from_pg(pg, True) from e

        return rpc(name, anon=anon)(wrapper)

    return deco


# ── Arqument çevrilməsi (JSON → Python; səhv tip → 22P02, PostgREST kimi) ──
def _invalid(pg_type: str, value: Any) -> ApiError:
    return ApiError(400, "22P02",
                    f'invalid input syntax for type {pg_type}: "{value}"')


def _uuid(value: Any) -> uuid.UUID:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        raise _invalid("uuid", value)
    try:
        return uuid.UUID(value)
    except ValueError:
        raise _invalid("uuid", value) from None


def _uuid_opt(value: Any) -> uuid.UUID | None:
    return None if value is None else _uuid(value)


def _num_opt(value: Any) -> Decimal | None:
    """JSON ədədi və ya ədəd mətni → Decimal (None → None)."""
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise _invalid("numeric", value)
    try:
        d = Decimal(str(value).strip())
    except InvalidOperation:
        raise _invalid("numeric", value) from None
    if not d.is_finite():
        raise _invalid("numeric", value)
    return d


def _int_opt(value: Any) -> int | None:
    d = _num_opt(value)
    if d is None:
        return None
    if d != d.to_integral_value():
        raise _invalid("integer", value)
    return int(d)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    return value if isinstance(value, str) else str(value)


def _date_opt(value: Any) -> dt.date | None:
    if value is None:
        return None
    if isinstance(value, str):
        try:
            return dt.date.fromisoformat(value.strip()[:10])
        except ValueError:
            pass
    raise _invalid("date", value)


def _ts_opt(value: Any) -> dt.datetime | None:
    """ISO vaxt mətni → vaxt zonalı datetime (zonasız dəyər UTC sayılır)."""
    if value is None:
        return None
    if isinstance(value, str):
        try:
            parsed = dt.datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            parsed = None
        if parsed is not None:
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)
    raise _invalid("timestamp with time zone", value)


def _failure(e: Exception) -> dict:
    """'KOD: izah' / 'KOD: status=x' mətnli servis xətası → SQL funksiyasının
    qaytardığı `{ok:false, error:'KOD'[, current_status]}` obyekti."""
    code, _, rest = str(e).partition(":")
    out: dict[str, Any] = {"ok": False, "error": code.strip()}
    rest = rest.strip()
    if rest.startswith("status="):
        out["current_status"] = rest[len("status="):]
    return out


# ════════════════ Təkliflər: vermə / qəbul / tamamlama / refund ══════════


@_core("place_bid")
async def place_bid(ctx: RpcContext, p_opportunity_id: Any, p_amount: Any) -> dict:
    """Provayder təklif verir. Xətalar raise olunur (NO_BALANCE, KYC_REQUIRED…);
    mobil tətbiq cavabdan `bid_id` oxuyur."""
    actor = await _actor(ctx)
    res = await marketplace.place_bid(
        ctx.db, caller_id=actor.id, role=actor.role,
        opportunity_id=_uuid(p_opportunity_id), amount=_num_opt(p_amount))
    await ctx.db.commit()
    dispatch_all(res["notices"])
    await publish(res["customer_id"], "offer.new", {
        "opportunity_id": str(p_opportunity_id), "offer_id": str(res["bid_id"]),
        "amount": str(res["amount"])})
    return {"ok": True, "bid_id": res["bid_id"], "amount": res["amount"],
            "required_balance": res["required_balance"]}


@_core("accept_offer_with_payment")
async def accept_offer_with_payment(
    ctx: RpcContext, p_offer_id: Any, p_method: Any, p_latitude: Any = None,
    p_longitude: Any = None, p_promo_code: Any = None,
) -> dict:
    """Müştəri təklifi qəbul edir (kart = escrow, nağd = depozit). Yalnız
    sifariş sahibi — yoxlama pul servisindədir."""
    actor = await _actor(ctx)
    offer_id = _uuid(p_offer_id)
    lat, lng = _num_opt(p_latitude), _num_opt(p_longitude)
    if (lat is not None and abs(lat) > 90) or (lng is not None and abs(lng) > 180):
        raise RpcError("Koordinatlar yanlışdır")
    result, notices = await marketplace.accept_offer(
        ctx.db, offer_id=offer_id, caller_id=actor.id,
        method=_text(p_method) or "",
        promo_code=(_text(p_promo_code) or "").strip() or None,
        latitude=lat, longitude=lng)

    # SQL cavabındakı məlumat sahələri (pul hərəkətinə təsiri yoxdur)
    amount = Decimal((await ctx.db.execute(
        text("select offer_amount from opportunities_offers where id = :id"),
        {"id": offer_id})).scalar())
    fee_pct = await _config_pct(ctx.db, "commission_customer_service_fee")
    deposit_pct = await _config_pct(ctx.db, "cash_deposit_pct", Decimal(20))
    await ctx.db.commit()
    dispatch_all(notices)
    return {
        "ok": True, "method": result["method"], "offer_id": result["offer_id"],
        "opportunity_id": result["opportunity_id"],
        "commission_amt": Decimal(result["commission_amt"]),
        "commission_pct": Decimal(result["commission_pct"]),
        "is_brigade": result["is_brigade"],
        "customer_fee_amt": Decimal(result["customer_fee_amt"]),
        "customer_fee_pct": fee_pct,
        "deposit_amt": _round2(amount * deposit_pct / 100),
        "deposit_pct": deposit_pct,
        "discount": Decimal(result["discount"]),
    }


@_core("release_offer_to_provider")
async def release_offer_to_provider(ctx: RpcContext, p_offer_id: Any) -> Decimal:
    """İş tamamlandı — escrow provayderə açılır. Müştəri (sifariş sahibi) və
    ya `pending_review` təsdiqi üçün admin. Qaytarır: açılan məbləğ (nağd: 0)."""
    actor = await _actor(ctx)
    result, notices = await marketplace.release_offer(
        ctx.db, offer_id=_uuid(p_offer_id), caller_id=actor.id,
        caller_role=actor.role)
    await ctx.db.commit()
    dispatch_all(notices)
    return Decimal(result["released"])


@_core("refund_offer_payment")
async def refund_offer_payment(
    ctx: RpcContext, p_offer_id: Any, p_reason: Any = None,
) -> dict:
    """Qəbul edilmiş təklifin geri qaytarılması (müştəri, provayderin özü,
    admin/support). Uğursuzluq raise olunmur — `{ok:false, error}` qaytarılır."""
    actor = await _actor(ctx)
    offer_id = _uuid(p_offer_id)
    try:
        result, notices = await marketplace.refund_offer(
            ctx.db, offer_id=offer_id, caller_id=actor.id,
            caller_role=actor.role, reason=_text(p_reason))
    except MoneyError as e:
        await ctx.db.rollback()
        return _failure(e)
    await ctx.db.commit()
    dispatch_all(notices)
    if result.get("already_refunded"):
        return {"ok": True, "already_refunded": True}
    return {"ok": True, "refunded_amount": Decimal(result["refunded_amount"]),
            "customer_id": result["customer_id"],
            "opportunity_id": result["opportunity_id"]}


@_core("cancel_opportunity")
async def cancel_opportunity(
    ctx: RpcContext, p_opportunity_id: Any, p_reason: Any = None,
) -> dict:
    """Sifarişin ləğvi (sahib və ya admin) + refund. Biznes rədləri
    `{ok:false, error:'NOT_FOUND'|'NOT_AUTHORIZED'|'NOT_CANCELLABLE'}` kimi
    qaytarılır; baza trigger-inin xətası (INVALID_STATUS_TRANSITION) raise olunur."""
    actor = await _actor(ctx)
    opp_id = _uuid(p_opportunity_id)
    try:
        res = await marketplace.cancel_opportunity(
            ctx.db, opportunity_id=opp_id, caller_id=actor.id,
            is_admin=actor.is_admin, reason=_text(p_reason))
    except OpError as e:
        if e.code is None:
            raise
        await ctx.db.rollback()
        return {"ok": False, "error": e.code, **e.extra}
    await ctx.db.commit()
    dispatch_all(res["notices"])
    return {"ok": True, "refunded": res["refunded"]}


# ════════════════ Briqada təklifləri (işçi tərəfi) ══════════════════════


@_core("claim_opportunity")
async def claim_opportunity(ctx: RpcContext, p_assignment_id: Any) -> None:
    """“İlk qəbul edən qazanır” — yalnız təyinatın öz üzvü götürə bilər."""
    actor = await _actor(ctx)
    await brigade.claim_opportunity(
        ctx.db, caller_id=actor.id, assignment_id=_uuid(p_assignment_id))
    await ctx.db.commit()


@_core("decline_offer")
async def decline_offer(ctx: RpcContext, p_assignment_id: Any) -> None:
    """Təklif olunan işdən imtina — yalnız təyinatın öz üzvü."""
    actor = await _actor(ctx)
    await brigade.decline_offer(
        ctx.db, caller_id=actor.id, assignment_id=_uuid(p_assignment_id))
    await ctx.db.commit()


@_core("expire_stale_offers")
async def expire_stale_offers(ctx: RpcContext, p_threshold_seconds: Any = 60) -> int:
    """Cavabsız avtomatik briqada təkliflərini vaxtı bitmiş sayır (dövri işin
    ehtiyat çağırışı; klientlər 60 göndərir). Qaytarır: dəyişən sətir sayı.

    Hədd adi istifadəçi üçün dövri işin həddindən (60 s) aşağı ola bilməz —
    əks halda istənilən hesab p_threshold_seconds=0 ilə bütün platformadakı
    təzə təklifləri ləğv edə bilərdi."""
    actor = await _actor(ctx)
    seconds = _int_opt(p_threshold_seconds)
    if seconds is None:
        seconds = 60
    seconds = max(seconds, 0 if actor.is_admin else 60)
    return await cron.expire_stale_brigade_offers(seconds)


# ════════════════ Promo / komissiya / balans ════════════════════════════


@_core("validate_promo_code")
async def validate_promo_code(ctx: RpcContext, p_code: Any, p_amount: Any) -> dict:
    """Promo kodun yoxlanması (yalnız oxuyur). Etibarsız kod xəta deyil:
    `{valid:false, message}`."""
    actor = await _actor(ctx)
    amount = _num_opt(p_amount)
    if amount is None:
        return {"valid": False, "message": "Məbləğ göstərilməyib"}
    return await marketplace.validate_promo(
        ctx.db, caller_id=actor.id, code=_text(p_code), amount=amount)


@_core("get_commission_rates")
async def get_commission_rates(ctx: RpcContext) -> dict:
    """Cari komissiya faizləri: {açar: ədəd}. SQL heç bir açar olmayanda null
    qaytarırdı; burada boş obyekt verilir (None reyestrdə 204 deməkdir) —
    klientlərin hamısı çatışmayan açarı 0/defolt sayır."""
    await _actor(ctx)
    return await marketplace.commission_rates(ctx.db)


@_core("convert_bonus_to_balance")
async def convert_bonus_to_balance(ctx: RpcContext, p_amount: Any) -> dict:
    """Bonus balansı əsas balansa çevir (çağıranın öz cüzdanı)."""
    actor = await _actor(ctx)
    amount = _num_opt(p_amount)
    if amount is None:
        raise RpcError("Məbləğ müsbət olmalıdır")
    result = await money.convert_bonus(ctx.db, caller_id=actor.id, amount=amount)
    await ctx.db.commit()
    return {"ok": True,
            "amount_requested": Decimal(result["amount_requested"]),
            "commission_pct": Decimal(result["commission_pct"]),
            "commission_amt": Decimal(result["commission_amt"]),
            "credited": Decimal(result["credited"]),
            "new_balance": Decimal(result["new_balance"])}


@_core("request_withdrawal")
async def request_withdrawal(ctx: RpcContext, p_amount: Any, p_bank_card: Any) -> uuid.UUID:
    """Çıxarış sorğusu — çağıranın öz balansından. Qaytarır: sorğunun id-si."""
    actor = await _actor(ctx)
    res = await marketplace.request_withdrawal(
        ctx.db, caller_id=actor.id, amount=_num_opt(p_amount),
        bank_card=_text(p_bank_card))
    await ctx.db.commit()
    return res["id"]


@_core("worker_earnings")
async def worker_earnings(ctx: RpcContext, p_from: Any = None, p_to: Any = None) -> dict:
    """Çağıranın qazanc hesabatı (defolt: son 30 gün)."""
    actor = await _actor(ctx)
    now = dt.datetime.now(dt.timezone.utc)
    return await marketplace.worker_earnings(
        ctx.db, caller_id=actor.id,
        p_from=_ts_opt(p_from) or now - dt.timedelta(days=30),
        p_to=_ts_opt(p_to) or now)


# ════════════════ Birbaşa sifariş (booking) ═════════════════════════════


@_core("create_booking_with_fee")
async def create_booking_with_fee(
    ctx: RpcContext, p_service_id: Any, p_date: Any, p_time: Any,
    p_package_name: Any = None, p_package_price: Any = None,
    p_package_duration: Any = None, p_notes: Any = None,
) -> dict:
    """Birbaşa sifariş + 1 ₼ komissiya. Uğursuzluq raise olunmur — klient
    `res.error === 'INSUFFICIENT_BALANCE'` yoxlayır."""
    actor = await _actor(ctx)
    service_id = _int_opt(p_service_id)
    price = _num_opt(p_package_price)
    booking_date = _date_opt(p_date)
    if price is not None and price < 0:
        return {"ok": False, "error": "INVALID_INPUT"}
    if service_id is None:
        return {"ok": False, "error": "SERVICE_NOT_FOUND"}
    try:
        result, notices = await marketplace.create_booking(
            ctx.db, caller_id=actor.id, service_id=service_id, date=booking_date,
            time_str=_text(p_time), package_name=_text(p_package_name),
            package_price=price, package_duration=_text(p_package_duration),
            notes=_text(p_notes))
    except MoneyError as e:
        await ctx.db.rollback()
        out = _failure(e)
        if out["error"] == "INSUFFICIENT_BALANCE":
            out["fee"] = money.BOOKING_FEE
        return out
    await ctx.db.commit()
    dispatch_all(notices)
    return {"ok": True, "booking_id": result["booking_id"],
            "fee": Decimal(result["fee"]), "balance": Decimal(result["balance"])}


# ════════════════ Ana səhifə / bildirişlər ══════════════════════════════


@_core("home_overview", anon=True)
async def home_overview(ctx: RpcContext) -> dict:
    """Ana səhifə icmalı — girişsiz də açıqdır (ana səhifə onu login-dən
    əvvəl çağırır; yalnız ümumi saylar və açıq elanlar)."""
    return await marketplace.home_overview(ctx.db)


@_core("mark_all_notifications_read")
async def mark_all_notifications_read(ctx: RpcContext) -> int:
    """Çağıranın bütün bildirişləri oxunmuş olur. Qaytarır: dəyişən say."""
    actor = await _actor(ctx)
    count = await marketplace.mark_all_notifications_read(ctx.db, caller_id=actor.id)
    await ctx.db.commit()
    return count


# ════════════════ Bloklama / provayder müraciəti ════════════════════════


@_core("block_user")
async def block_user(
    ctx: RpcContext, p_blocked_id: Any, p_reason: Any = None,
    p_scope: Any = "global", p_brigade_id: Any = None,
) -> uuid.UUID | None:
    """İstifadəçini blokla (bloklayan = çağıran). scope='brigade' yalnız
    komanda sahibi/dispetçeri üçün. Qaytarır: blokun id-si (təkrarda null)."""
    actor = await _actor(ctx)
    block_id = await marketplace.block_user(
        ctx.db, caller_id=actor.id, blocked_id=_uuid(p_blocked_id),
        reason=_text(p_reason), scope=_text(p_scope) or "global",
        brigade_id=_uuid_opt(p_brigade_id))
    await ctx.db.commit()
    return block_id


@_core("request_provider_role")
async def request_provider_role(
    ctx: RpcContext, p_message: Any = None, p_company_name: Any = None,
    p_experience_years: Any = None, p_specialties: Any = None,
) -> uuid.UUID:
    """Provayder olmaq üçün müraciət (çağıranın öz adından). Qaytarır: id."""
    actor = await _actor(ctx)
    specialties = [] if p_specialties is None else p_specialties
    if not isinstance(specialties, list) \
            or not all(isinstance(s, str) for s in specialties):
        raise _invalid("text[]", p_specialties)
    req_id = await marketplace.request_provider_role(
        ctx.db, caller_id=actor.id, role=actor.role, message=_text(p_message),
        company_name=_text(p_company_name),
        experience_years=_int_opt(p_experience_years), specialties=specialties)
    await ctx.db.commit()
    return req_id


# ════════════════ Söhbətlər (chat) ══════════════════════════════════════


@_core("open_conversation")
async def open_conversation(ctx: RpcContext, p_opportunity_id: Any, p_peer_id: Any) -> uuid.UUID:
    """Sifariş üzrə söhbəti aç (idempotent). Çağıran həmişə tərəflərdən
    biridir: sifariş sahibi → müştəri; başqası → provayder (özü)."""
    actor = await _actor(ctx)
    conv_id = await marketplace.open_conversation(
        ctx.db, caller_id=actor.id, opportunity_id=_uuid(p_opportunity_id),
        peer_id=_uuid_opt(p_peer_id))
    await ctx.db.commit()
    return conv_id


@_core("open_support_conversation")
async def open_support_conversation(
    ctx: RpcContext, p_category: Any = "general", p_user_role: Any = "customer",
) -> uuid.UUID:
    """Dəstək çatı aç (kateqoriya başına idempotent). Qaytarır: söhbətin id-si."""
    actor = await _actor(ctx)
    conv_id, _created = await marketplace.open_support_conversation(
        ctx.db, caller_id=actor.id, category=_text(p_category),
        user_role=_text(p_user_role))
    await ctx.db.commit()
    return conv_id
