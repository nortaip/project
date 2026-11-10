"""Admin RPC-ləri — admin panelin (`src/MasterAdmin`, `src/admin`)
`supabase.rpc('admin_*')` çağırışları. Qaydalar: app/compat/rpc.py

Hər handler köhnə SQL funksiyası ilə eyni arqument adlarını qəbul edir və
eyni formada cavab qaytarır; iş məntiqi isə mövcud Python portundadır
(`app/api/v1/admin.py` → `svc_*`, `app/api/v1/kyc.py`, `app/api/v1/profiles.py`)
— burada yalnız arqument çevrilməsi və xəta tərcüməsi var.

İcazə iki pillədə yoxlanılır:
  1. `@rpc(..., admin=True)` — JWT-dəki rol admin/master/superadmin olmalıdır
     (anonim → 401, adi istifadəçi → 403).
  2. `@_db_admin` — rol BAZADAN yenidən oxunur (`require_roles` kimi): token
     veriləndən sonra rolu alınmış və ya bloklanmış admin köhnə tokenlə heç nə
     edə bilməz. İki rol sütununun ikisi də admin olmalıdır: `users.role`
     (API) və `profiles.role` (köhnə SQL funksiyaları və RLS bunu oxuyurdu).
"""
from __future__ import annotations

import functools
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1 import admin as svc
from app.api.v1 import kyc as kyc_api
from app.api.v1 import profiles as profiles_api
from app.compat.context import ADMIN_ROLES
from app.compat.errors import ApiError, RpcError, from_pg
from app.compat.rpc import RpcContext, rpc
from app.models.user import User


# ── İcazə: bazadan rol yoxlaması ──────────────────────────────────
@dataclass
class AdminCtx:
    """Handler-ə ötürülən kontekst: sessiya + bazadan oxunmuş admin."""

    db: AsyncSession
    admin: User


async def _load_admin(ctx: RpcContext) -> User:
    uid = ctx.require_user()
    user = (
        await ctx.db.execute(select(User).where(User.id == uid))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        # get_current_user ilə eyni: silinmiş/bloklanmış hesabın tokeni keçmir
        raise ApiError(401, "PGRST301", "Hesab aktiv deyil")
    profile_role = (
        await ctx.db.execute(
            text("select lower(coalesce(role, '')) from profiles where id = :id"),
            {"id": uid},
        )
    ).scalar()
    if user.role not in ADMIN_ROLES or profile_role not in ADMIN_ROLES:
        raise ApiError(403, "42501", "Forbidden: admin only")
    return user


def _db_admin(fn):
    """Handler-dən əvvəl admin rolunu bazadan təsdiqləyir, servis xətalarını
    PostgREST formatına çevirir. `functools.wraps` imzanı saxlayır — reyestr
    arqument adlarını (p_...) əsl funksiyadan oxuyur."""

    @functools.wraps(fn)
    async def wrapper(ctx: RpcContext, **kwargs: Any) -> Any:
        admin = await _load_admin(ctx)
        try:
            return await fn(AdminCtx(db=ctx.db, admin=admin), **kwargs)
        except (svc.AdminError, kyc_api.KycError) as e:
            # köhnə `raise exception '...'` mətni → {code: 'P0001', message}
            raise RpcError(e.sql) from e
        except HTTPException as e:   # REST route funksiyalarından gələn xəta
            raise RpcError(str(e.detail)) from e
        except ValidationError as e:
            raise ApiError(400, "22023", "Arqument dəyəri yolverilməzdir",
                           details=str(e.errors()[0].get("msg"))) from e
        except DBAPIError as e:
            # məhdudiyyət pozuntusu və s. — PostgREST kimi SQLSTATE ilə
            pg = getattr(e.orig, "__cause__", None) or e.orig
            raise from_pg(pg, True) from e

    return wrapper


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


def _num(value: Any) -> Decimal | None:
    """numeric: JSON ədədi və ya sətir. float ikilik xətası olmasın deyə
    `Decimal(str(x))` ilə çevrilir (0.1 → Decimal('0.1'))."""
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


def _int(value: Any) -> int | None:
    if value is None:
        return None
    d = _num(value)
    if d != d.to_integral_value():
        raise _invalid("integer", value)
    return int(d)


def _bool(value: Any) -> bool | None:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ("true", "t", "1"):
        return True
    if isinstance(value, str) and value.lower() in ("false", "f", "0"):
        return False
    raise _invalid("boolean", value)


def _text(value: Any) -> str | None:
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, (dict, list)):
        raise _invalid("text", value)
    return str(value)


# ── Balans / bonus ────────────────────────────────────────────────
@rpc("admin_credit_balance", admin=True)
@_db_admin
async def admin_credit_balance(a: AdminCtx, p_target_user_id, p_amount, p_reason):
    """returns numeric — yeni profiles.balance."""
    return await svc.svc_credit_balance(
        a.db, admin_id=a.admin.id, user_id=_uuid(p_target_user_id),
        amount=_num(p_amount), reason=_text(p_reason))


@rpc("admin_credit_bonus", admin=True)
@_db_admin
async def admin_credit_bonus(a: AdminCtx, p_target_user_id, p_amount, p_reason):
    """returns numeric — yeni provider_wallets.bonus_balance."""
    return await svc.svc_credit_bonus(
        a.db, admin_id=a.admin.id, user_id=_uuid(p_target_user_id),
        amount=_num(p_amount), reason=_text(p_reason))


@rpc("admin_adjust_balance", admin=True)
@_db_admin
async def admin_adjust_balance(a: AdminCtx, p_user_id, p_amount, p_reason,
                               p_target="balance"):
    """returns numeric — düzəlişdən sonrakı dəyər (balance | bonus | locked)."""
    return await svc.svc_adjust_balance(
        a.db, admin_id=a.admin.id, user_id=_uuid(p_user_id),
        amount=_num(p_amount), reason=_text(p_reason), target=_text(p_target))


# ── Dashboard ─────────────────────────────────────────────────────
@rpc("admin_dashboard_stats", admin=True)
@_db_admin
async def admin_dashboard_stats(a: AdminCtx):
    """returns jsonb — {totalUsers, ..., pendingWithdrawalsCount}."""
    return await svc.svc_dashboard_stats(a.db)


@rpc("admin_dashboard_daily", admin=True)
@_db_admin
async def admin_dashboard_daily(a: AdminCtx, p_days=14):
    """returns table(d date, gmv numeric, revenue numeric)."""
    days = _int(p_days)
    if days is None or days < 1:
        return []          # SQL: boş generate_series
    return await svc.svc_dashboard_daily(a.db, min(days, 3660))


# ── İstifadəçilər ─────────────────────────────────────────────────
@rpc("admin_list_users_with_meta", admin=True)
@_db_admin
async def admin_list_users_with_meta(a: AdminCtx):
    """returns table(id, name, email, phone_number, avatar_url, role, is_active,
    created_at, auth_email, auth_meta, provider) + səhifənin oxuduğu profil
    sahələri (status, is_verified, balance, address, rating)."""
    return await svc.svc_users_with_meta(a.db)


@rpc("admin_set_user_role", admin=True)
@_db_admin
async def admin_set_user_role(a: AdminCtx, p_target_user_id, p_new_role):
    """returns void — profiles.role VƏ users.role yenilənir."""
    await svc.svc_set_user_role(
        a.db, admin=a.admin, user_id=_uuid(p_target_user_id),
        role=_text(p_new_role))


@rpc("admin_delete_user", admin=True)
@_db_admin
async def admin_delete_user(a: AdminCtx, p_user_id):
    """returns jsonb — {ok, deleted?, banned?, error?} (xəta da 200 ilə qayıdır,
    panel `data.ok` / `data.error` oxuyur)."""
    return await svc.svc_delete_user(a.db, admin=a.admin, user_id=_uuid(p_user_id))


# ── Provayder müraciətləri ────────────────────────────────────────
async def _pending_provider_request(db: AsyncSession, request_id: uuid.UUID) -> None:
    """SQL funksiyasındakı xəta mətnləri ilə ilkin yoxlama (əsl iş və təkrar
    yoxlama profiles.py-dakı portdadır)."""
    status = (
        await db.execute(
            text("select status from provider_requests where id = :id"),
            {"id": request_id},
        )
    ).scalar()
    if status is None:
        raise RpcError("Request not found")
    if status != "pending":
        raise RpcError(f"Request already {status}")


@rpc("admin_approve_provider_request", admin=True)
@_db_admin
async def admin_approve_provider_request(a: AdminCtx, p_request_id, p_note=None):
    """returns void."""
    rid = _uuid(p_request_id)
    await _pending_provider_request(a.db, rid)
    await profiles_api.admin_approve_provider_request(
        rid, profiles_api.ProviderApproveIn(note=_text(p_note)),
        admin=a.admin, db=a.db)


@rpc("admin_reject_provider_request", admin=True)
@_db_admin
async def admin_reject_provider_request(a: AdminCtx, p_request_id, p_reason=None):
    """returns void."""
    rid = _uuid(p_request_id)
    await _pending_provider_request(a.db, rid)
    await profiles_api.admin_reject_provider_request(
        rid, profiles_api.ProviderRejectIn(reason=_text(p_reason)),
        admin=a.admin, db=a.db)


# ── Şirkətlər (briqadalar) ────────────────────────────────────────
@rpc("admin_companies_list", admin=True)
@_db_admin
async def admin_companies_list(a: AdminCtx):
    """returns jsonb — sətirlər massivi (boşdursa [])."""
    return await svc.svc_companies_list(a.db)


@rpc("admin_company_detail", admin=True)
@_db_admin
async def admin_company_detail(a: AdminCtx, p_brigade_id):
    """returns jsonb — {brigade, members, orders, finance, logs}."""
    return await svc.svc_company_detail(a.db, _uuid(p_brigade_id))


@rpc("admin_approve_brigade_application", admin=True)
@_db_admin
async def admin_approve_brigade_application(a: AdminCtx, p_application_id,
                                            p_note=None):
    """returns uuid — yaradılan briqadanın id-si."""
    return await svc.svc_approve_brigade_application(
        a.db, admin_id=a.admin.id, application_id=_uuid(p_application_id),
        note=_text(p_note))


@rpc("admin_reject_brigade_application", admin=True)
@_db_admin
async def admin_reject_brigade_application(a: AdminCtx, p_application_id,
                                           p_reason=None):
    """returns void."""
    await svc.svc_reject_brigade_application(
        a.db, admin_id=a.admin.id, application_id=_uuid(p_application_id),
        reason=_text(p_reason))


# ── Sifariş təsdiqi ───────────────────────────────────────────────
@rpc("admin_complete_opportunity", admin=True)
@_db_admin
async def admin_complete_opportunity(a: AdminCtx, p_opportunity_id):
    """returns text — 'completed' | 'already_completed'."""
    return await svc.svc_complete_opportunity(
        a.db, admin=a.admin, opportunity_id=_uuid(p_opportunity_id))


# ── KYC ───────────────────────────────────────────────────────────
@rpc("admin_kyc_list", admin=True)
@_db_admin
async def admin_kyc_list(a: AdminCtx, p_status=None):
    """returns jsonb — müraciətlər massivi, provayder məlumatı ilə."""
    return await kyc_api.admin_list(status=_text(p_status), _admin=a.admin, db=a.db)


@rpc("admin_kyc_review", admin=True)
@_db_admin
async def admin_kyc_review(a: AdminCtx, p_id, p_approve, p_reason=None,
                           p_notes=None):
    """returns void."""
    await kyc_api.svc_review_kyc(
        a.db, admin_id=a.admin.id, verification_id=_uuid(p_id),
        approve=bool(_bool(p_approve)), reason=_text(p_reason),
        notes=_text(p_notes), pending_only=False)


# ── Komissiya ─────────────────────────────────────────────────────
@rpc("admin_update_commission", admin=True)
@_db_admin
async def admin_update_commission(a: AdminCtx, p_key, p_value):
    """returns void."""
    await svc.svc_update_commission(
        a.db, admin_id=a.admin.id, key=_text(p_key), value=_num(p_value))
