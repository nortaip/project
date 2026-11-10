"""Briqada RPC handler-ləri — qaydalar: app/compat/rpc.py

Hər handler köhnə Supabase SQL funksiyası ilə eyni adlı/arqumentli nazik
adapterdir: arqumentləri PostgREST kimi tipə çevirir, işi
`app/services/brigade.py`-dəki porta ötürür, nəticəni SQL funksiyasının
qaytardığı JSON formasına salır (jsonb → obyekt, `returns table` → massiv,
`returns void` → None/204, skalyar → çılpaq dəyər).

İcazələr: `auth.uid()` → `ctx.user_id`. Yeganə anonim RPC
`lookup_brigade_invite`-dir (dəvət linki girişdən ƏVVƏL açılır; orijinalda
da `grant execute ... to anon` idi). Qalanları yalnız giriş etmiş istifadəçi
üçündür, rol yoxlamasını (sahib / dispatcher / təyin olunmuş üzv) servis edir.

Xətalar: servisdəki `BrigadeError` → `RpcError` (P0001, 400) — klient
`error.message`-i göstərir və `NO_BALANCE` / `COOLDOWN` / `ALREADY_TAKEN`
alt-sətirlərini yoxlayır. Baza xətaları PostgREST-dəki kimi SQLSTATE ilə
qaytarılır (məs. yanlış uuid → 22P02).
"""
from __future__ import annotations

import json
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any, Awaitable

from sqlalchemy.exc import DBAPIError

from app.compat.errors import ApiError, RpcError, from_pg
from app.compat.rpc import RpcContext, rpc
from app.services import brigade as svc
from app.services import notify
from app.services.brigade import BrigadeError

# Arqument ümumiyyətlə göndərilməyib (SQL DEFAULT işləsin) — açıq `null`-dan fərqlidir
_UNSET: Any = object()


# ── Arqument çevirmələri (PostgREST-in tip yoxlamasının qarşılığı) ──────


def _bad_input(pg_type: str, value: Any) -> ApiError:
    shown = value if isinstance(value, str) else json.dumps(value, default=str)
    return ApiError(400, "22P02",
                    f'invalid input syntax for type {pg_type}: "{shown}"')


def _uuid(value: Any) -> uuid.UUID | None:
    if value is None or isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        raise _bad_input("uuid", value)
    try:
        return uuid.UUID(value.strip())
    except ValueError as e:
        raise _bad_input("uuid", value) from e


def _numeric(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float, str, Decimal)):
        raise _bad_input("numeric", value)
    try:
        d = Decimal(str(value).strip())
    except (InvalidOperation, ValueError) as e:
        raise _bad_input("numeric", value) from e
    if not d.is_finite():
        raise _bad_input("numeric", value)
    return d


def _int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        raise _bad_input("integer", value)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        try:
            return int(value.strip())
        except ValueError as e:
            raise _bad_input("integer", value) from e
    raise _bad_input("integer", value)


def _bool(value: Any) -> bool | None:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str) and value.strip().lower() in ("true", "t", "1"):
        return True
    if isinstance(value, str) and value.strip().lower() in ("false", "f", "0"):
        return False
    raise _bad_input("boolean", value)


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    raise _bad_input("text", value)


def _array(value: Any) -> list | None:
    """JSON massivi və ya PostgreSQL massiv literalı ('{a,b}' — GET sorğusu)."""
    if value is None or isinstance(value, list):
        return value
    if isinstance(value, str):
        s = value.strip()
        if s.startswith("{") and s.endswith("}"):
            inner = s[1:-1].strip()
            return [p.strip().strip('"') for p in inner.split(",")] if inner else []
    raise ApiError(400, "22P02", f'malformed array literal: "{value}"')


def _uuid_array(value: Any) -> list[uuid.UUID] | None:
    items = _array(value)
    return None if items is None else [_uuid(v) for v in items]


def _text_array(value: Any) -> list[str] | None:
    items = _array(value)
    return None if items is None else [_text(v) for v in items]


# ── Ortaq icra: commit, xəta çevirməsi, bildiriş göndərişi ──────────────


def _pg_error(exc: DBAPIError) -> ApiError:
    """SQLAlchemy/asyncpg xətası → PostgREST formatı (SQLSTATE saxlanır)."""
    orig = getattr(exc, "orig", None)
    pg = getattr(orig, "__cause__", None) or orig or exc
    return from_pg(pg, authenticated=True)


async def _run(ctx: RpcContext, op: Awaitable[Any]) -> Any:
    """Servis əməliyyatını icra et və commit et; `_notices` (push/WS) yalnız
    commit-dən SONRA göndərilir. Biznes xətası → RpcError (P0001)."""
    try:
        result = await op
        notices = result.pop("_notices", []) if isinstance(result, dict) else []
        await ctx.db.commit()
    except BrigadeError as e:
        await ctx.db.rollback()
        raise RpcError(str(e)) from e
    except DBAPIError as e:
        await ctx.db.rollback()
        raise _pg_error(e) from e
    notify.dispatch_all(notices)
    return result


async def _read(ctx: RpcContext, op: Awaitable[Any]) -> Any:
    """Yalnız oxuyan sorğu — commit yoxdur, baza xətası PostgREST formatında."""
    try:
        return await op
    except DBAPIError as e:
        await ctx.db.rollback()
        raise _pg_error(e) from e


# ── Dəvətlər ────────────────────────────────────────────────────────────


@rpc("my_pending_brigade_invites")
async def my_pending_brigade_invites(ctx: RpcContext) -> list[dict]:
    """returns table(token, intended_role, brigade_id, brigade_name,
    brigade_logo, invited_at, expires_at) → sətirlər massivi."""
    uid = ctx.require_user()
    return await _read(ctx, svc.my_pending_brigade_invites(ctx.db, caller_id=uid))


@rpc("lookup_brigade_invite", anon=True)
async def lookup_brigade_invite(ctx: RpcContext, p_token: Any) -> dict | None:
    """Dəvət linkinin (magic link) təfərrüatı — giriş TƏLƏB ETMİR.

    Klientlərin oxuduğu forma `lookup_brigade_invite(uuid)` variantıdır:
    {token, status, intended_role, commission_pct, expires_at, is_expired,
     invited_email, invited_phone, brigade:{id,name,description,logo_url,
     is_verified}}; tapılmasa null (klient "dəvət tapılmadı" göstərir).
    """
    token = _uuid(p_token)
    if token is None:
        return None
    return await _read(ctx, svc.lookup_brigade_invite(ctx.db, token=token))


@rpc("accept_brigade_invite")
async def accept_brigade_invite(ctx: RpcContext, p_token: Any) -> dict:
    """→ {ok, brigade_id, role}. Dəvətin email/telefonu çağıranınki olmalıdır."""
    uid = ctx.require_user()
    r = await _run(ctx, svc.accept_brigade_invite(
        ctx.db, caller_id=uid, token=_uuid(p_token)))
    return {"ok": True, "brigade_id": r["brigade_id"], "role": r["role"]}


@rpc("decline_brigade_invite")
async def decline_brigade_invite(ctx: RpcContext, p_token: Any) -> dict:
    """→ {ok: true}."""
    uid = ctx.require_user()
    await _run(ctx, svc.decline_brigade_invite(
        ctx.db, caller_id=uid, token=_uuid(p_token)))
    return {"ok": True}


# ── Rol ─────────────────────────────────────────────────────────────────


@rpc("brigade_role")
async def brigade_role(ctx: RpcContext, p_brigade_id: Any,
                       p_profile_id: Any = _UNSET) -> str | None:
    """Aktiv üzvün rolu — çılpaq mətn ('owner'|'dispatcher'|'member') və ya null.

    `p_profile_id` DEFAULT auth.uid() idi və klientlər onu göndərmir. Başqa
    profilin rolunu soruşmaq yalnız həmin briqadanın aktiv üzvünə və adminə
    açıqdır (brigade_members-in RLS oxu qaydası ilə eyni) — orijinal SECURITY
    DEFINER funksiya bunu hər giriş etmiş istifadəçiyə açıq saxlayırdı.
    """
    uid = ctx.require_user()
    brigade_id = _uuid(p_brigade_id)
    profile_id = uid if p_profile_id is _UNSET else _uuid(p_profile_id)
    if brigade_id is None or profile_id is None:
        return None
    if profile_id != uid and not ctx.is_admin:
        mine = await _read(ctx, svc.brigade_role(ctx.db, brigade_id, uid))
        if mine is None:
            raise ApiError(403, "42501", "İcazə yoxdur: başqa profilin rolunu"
                                         " yalnız briqada üzvü görə bilər")
    return await _read(ctx, svc.brigade_role(ctx.db, brigade_id, profile_id))


@rpc("set_member_online")
async def set_member_online(ctx: RpcContext, p_is_online: Any) -> None:
    """returns void. Çağıranın öz aktiv üzvlüklərində online + heartbeat."""
    uid = ctx.require_user()
    is_online = _bool(p_is_online)
    if is_online is None:
        raise ApiError(400, "23502", 'null value in column "is_online" of relation'
                                     ' "brigade_members" violates not-null constraint')
    await _run(ctx, svc.set_member_online(ctx.db, caller_id=uid, is_online=is_online))
    return None


# ── Müraciətlər ─────────────────────────────────────────────────────────


@rpc("apply_for_brigade")
async def apply_for_brigade(
    ctx: RpcContext, p_name: Any, p_description: Any = None,
    p_categories: Any = _UNSET, p_contact_phone: Any = None,
    p_contact_email: Any = None, p_address: Any = None, p_logo_url: Any = None,
) -> str:
    """returns uuid — yeni müraciətin id-si (çılpaq sətir)."""
    uid = ctx.require_user()
    categories = [] if p_categories is _UNSET else (_text_array(p_categories) or [])
    r = await _run(ctx, svc.apply_for_brigade(
        ctx.db, caller_id=uid, name=_text(p_name) or "",
        description=_text(p_description), categories=categories,
        contact_phone=_text(p_contact_phone), contact_email=_text(p_contact_email),
        address=_text(p_address), logo_url=_text(p_logo_url)))
    return r["application_id"]


@rpc("cancel_brigade_application")
async def cancel_brigade_application(ctx: RpcContext, p_application_id: Any) -> None:
    """returns void. Yalnız öz `pending` müraciətini."""
    uid = ctx.require_user()
    await _run(ctx, svc.cancel_brigade_application(
        ctx.db, caller_id=uid, application_id=_uuid(p_application_id)))
    return None


# ── Təyinatlar ──────────────────────────────────────────────────────────


@rpc("brigade_assignment_respond")
async def brigade_assignment_respond(ctx: RpcContext, p_assignment_id: Any,
                                     p_action: Any) -> None:
    """returns void. Yalnız təyin olunmuş üzv; p_action: accept | decline."""
    uid = ctx.require_user()
    await _run(ctx, svc.brigade_assignment_respond(
        ctx.db, caller_id=uid, assignment_id=_uuid(p_assignment_id),
        action=_text(p_action) or ""))
    return None


@rpc("brigade_assignment_start")
async def brigade_assignment_start(ctx: RpcContext, p_assignment_id: Any) -> None:
    """returns void. Yalnız təyin olunmuş üzv; assigned/accepted → in_progress."""
    uid = ctx.require_user()
    await _run(ctx, svc.brigade_assignment_start(
        ctx.db, caller_id=uid, assignment_id=_uuid(p_assignment_id)))
    return None


@rpc("brigade_assignment_complete")
async def brigade_assignment_complete(ctx: RpcContext, p_assignment_id: Any) -> None:
    """returns void. Üzv özü və ya briqadanın sahibi/dispatcher-i."""
    uid = ctx.require_user()
    await _run(ctx, svc.brigade_assignment_complete(
        ctx.db, caller_id=uid, assignment_id=_uuid(p_assignment_id)))
    return None


@rpc("brigade_dispatch_order")
async def brigade_dispatch_order(
    ctx: RpcContext, p_brigade_id: Any, p_source_id: Any, p_member_ids: Any,
    p_priority: Any = 5, p_notes: Any = None,
) -> dict:
    """→ {ok, inserted}. Yalnız sahib/dispatcher; təkrar təyinat sayılmır."""
    uid = ctx.require_user()
    r = await _run(ctx, svc.brigade_dispatch_order(
        ctx.db, caller_id=uid, brigade_id=_uuid(p_brigade_id),
        source_id=_text(p_source_id) or "",
        member_ids=_uuid_array(p_member_ids) or [],
        priority=_int(p_priority), notes=_text(p_notes)))
    return {"ok": True, "inserted": r["inserted"]}


@rpc("brigade_dispatch_assign")
async def brigade_dispatch_assign(
    ctx: RpcContext, p_brigade_id: Any, p_opportunity_id: Any, p_member_id: Any,
    p_amount: Any, p_notes: Any = None,
) -> dict:
    """→ {ok, offer_id, assignment_id, provider_id, amount, required_balance,
    rerouted}. Yalnız sahib/dispatcher. Xəta prefiksləri: COOLDOWN,
    ALREADY_TAKEN, NO_BALANCE (klient bunları yoxlayır)."""
    uid = ctx.require_user()
    r = await _run(ctx, svc.brigade_dispatch_assign(
        ctx.db, caller_id=uid, brigade_id=_uuid(p_brigade_id),
        opportunity_id=_uuid(p_opportunity_id), member_id=_uuid(p_member_id),
        amount=_numeric(p_amount), notes=_text(p_notes)))
    return {"ok": True, "offer_id": r["offer_id"],
            "assignment_id": r["assignment_id"], "provider_id": r["provider_id"],
            "amount": Decimal(r["amount"]),
            "required_balance": Decimal(r["required_balance"]),
            "rerouted": r["rerouted"]}


@rpc("brigade_place_offer")
async def brigade_place_offer(
    ctx: RpcContext, p_brigade_id: Any, p_opportunity_id: Any, p_amount: Any,
    p_notes: Any = None,
) -> dict:
    """→ {ok, offer_id, amount, required_balance}. Yalnız sahib/dispatcher.
    Xəta prefiksi NO_BALANCE (klient yoxlayır)."""
    uid = ctx.require_user()
    brigade_id = _uuid(p_brigade_id)
    opportunity_id = _uuid(p_opportunity_id)
    amount = _numeric(p_amount)
    notes = _text(p_notes)

    async def op() -> dict:
        r = await svc.brigade_place_offer(
            ctx.db, caller_id=uid, brigade_id=brigade_id,
            opportunity_id=opportunity_id, amount=amount, notes=notes)
        # yeni təklif → müştəriyə bildiriş (notify_customer_on_new_offer trigger portu)
        r["_notices"] = await notify.notify_new_offer(ctx.db, offer_id=r["offer_id"])
        return r

    r = await _run(ctx, op())
    return {"ok": True, "offer_id": r["offer_id"], "amount": Decimal(r["amount"]),
            "required_balance": Decimal(r["required_balance"])}


# ── Pul axınları ────────────────────────────────────────────────────────


@rpc("brigade_top_up_from_owner")
async def brigade_top_up_from_owner(ctx: RpcContext, p_brigade_id: Any,
                                    p_amount: Any) -> dict:
    """→ {ok, brigade_balance, owner_balance}. Yalnız briqada sahibi."""
    uid = ctx.require_user()
    r = await _run(ctx, svc.brigade_top_up_from_owner(
        ctx.db, caller_id=uid, brigade_id=_uuid(p_brigade_id),
        amount=_numeric(p_amount)))
    return {"ok": True, "brigade_balance": Decimal(r["brigade_balance"]),
            "owner_balance": Decimal(r["owner_balance"])}


@rpc("brigade_distribute_balance")
async def brigade_distribute_balance(ctx: RpcContext, p_brigade_id: Any,
                                     p_allocations: Any) -> dict:
    """→ {ok, total, count, brigade_balance}. Yalnız briqada sahibi.
    p_allocations: [{profile_id, amount}, ...] (jsonb)."""
    uid = ctx.require_user()
    brigade_id = _uuid(p_brigade_id)
    if isinstance(p_allocations, str):  # jsonb sətir kimi göndərilibsə
        try:
            p_allocations = json.loads(p_allocations)
        except ValueError as e:
            raise ApiError(400, "22P02", "invalid input syntax for type json") from e
    allocations: list[dict] = []
    if isinstance(p_allocations, list):
        for item in p_allocations:
            if not isinstance(item, dict):
                raise RpcError("profile_id boşdur")
            allocations.append({"profile_id": _uuid(item.get("profile_id")),
                                "amount": _numeric(item.get("amount"))})
    # massiv deyilsə/boşdursa servis "Bölgü siyahısı boşdur" qaytarır
    r = await _run(ctx, svc.brigade_distribute_balance(
        ctx.db, caller_id=uid, brigade_id=brigade_id, allocations=allocations))
    return {"ok": True, "total": Decimal(r["total"]), "count": r["count"],
            "brigade_balance": Decimal(r["brigade_balance"])}
