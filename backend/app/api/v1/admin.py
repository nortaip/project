"""Admin API — statistika, komissiyalar, istifadəçilər, bannerlər, audit.

İş məntiqi `svc_*` funksiyalarındadır (FastAPI-dən asılı deyil): həm bu
moduldakı REST endpointləri, həm də Supabase-uyğun RPC adapterləri
(`app/compat/rpc_admin.py`) eyni funksiyaları çağırır. `svc_*` funksiyaları
icazə YOXLAMIR — çağıran tərəf admin olduğunu artıq təsdiqləmiş olmalıdır.
"""
from __future__ import annotations

import json
import logging
import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.core.cache import invalidate
from app.db.session import get_db, redis
from app.models.user import User
from app.services.lifecycle import set_opportunity_status
from app.services.money import MoneyError, release_offer
from app.services.notify import (
    Notice,
    dispatch,
    dispatch_all,
    insert_notice,
    notify_offer_released,
)

log = logging.getLogger(__name__)

# Supabase RPC-lərindəki admin yoxlaması: ('admin','master','superadmin')
_ADMIN = ("admin", "master", "superadmin")

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(*_ADMIN))],
)


class AdminError(Exception):
    """`svc_*` funksiyalarının iş məntiqi xətası.

    `detail` — REST cavabının mətni (HTTP `status` ilə); `sql` — köhnə SQL
    funksiyasındakı `raise exception '...'` mətni (RPC qatı məhz bunu qaytarır
    ki, admin panelin gördüyü xəta mesajları dəyişməsin).
    """

    def __init__(self, status: int, detail: str, sql: str | None = None) -> None:
        super().__init__(detail)
        self.status, self.detail, self.sql = status, detail, sql or detail


def _http(e: AdminError) -> HTTPException:
    return HTTPException(status_code=e.status, detail=e.detail)


class ConfigIn(BaseModel):
    value: str = Field(max_length=200)


class BannerIn(BaseModel):
    title: str = Field(default="", max_length=200)   # başlıqsız banner dəstəklənir
    subtitle: str | None = Field(default=None, max_length=300)
    image_url: str = Field(min_length=1, max_length=1000)
    link_url: str | None = Field(default=None, max_length=1000)
    is_active: bool = True
    sort_order: int = Field(default=0, ge=0, le=999)


class BlockIn(BaseModel):
    active: bool


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)) -> dict:
    users = (
        await db.execute(
            text("select role, count(*) as c from profiles group by role")
        )
    ).all()
    orders = (
        await db.execute(
            text("select status, count(*) as c from opportunities group by status")
        )
    ).all()
    revenue = (
        await db.execute(
            text(
                "select coalesce(sum(amount),0) as total from transactions"
                " where type='platform_revenue' and amount > 0"
            )
        )
    ).first()
    month = (
        await db.execute(
            text(
                "select coalesce(sum(amount),0) as total from transactions"
                " where type='platform_revenue' and amount > 0"
                " and created_at >= date_trunc('month', now())"
            )
        )
    ).first()
    return {
        "users_by_role": {r.role: r.c for r in users},
        "orders_by_status": {r.status: r.c for r in orders},
        "platform_revenue_total": str(revenue.total),
        "platform_revenue_month": str(month.total),
    }


# ── Komissiya / konfiq ────────────────────────────────────────────
_ALLOWED_CONFIG = {
    "commission_on_accept", "commission_on_complete",
    "brigade_commission_on_accept", "brigade_commission_on_complete",
    "brigade_member_commission_pct", "commission_on_withdrawal",
    "min_withdrawal_amount", "commission_customer_service_fee",
    "cash_deposit_pct", "bonus_on_complete",
}


@router.get("/config")
async def get_config(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = await db.execute(
        text("select key, value, description, updated_at from platform_config"
             " where key = any(:keys) order by key"),
        {"keys": list(_ALLOWED_CONFIG)},
    )
    return [dict(r._mapping) for r in rows]


@router.put("/config/{key}")
async def set_config(
    key: str,
    body: ConfigIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if key not in _ALLOWED_CONFIG:
        raise HTTPException(status_code=400, detail="Bu açar idarə olunmur")
    try:
        val = float(body.value)
        if not (0 <= val <= 100000):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="Dəyər rəqəm olmalıdır") from None
    await _write_config(db, key=key, value_json=json.dumps(str(val)),
                        actor_id=admin.id, audit_value=body.value)
    return {"ok": True, "key": key, "value": val}


async def _write_config(
    db: AsyncSession, *, key: str, value_json: str, actor_id, audit_value: str,
) -> None:
    """platform_config upsert + audit + commit + keşin təzələnməsi.
    `value_json` — jsonb-yə yazılacaq hazır JSON mətni."""
    await db.execute(
        text(
            "insert into platform_config (key, value, updated_at)"
            " values (:k, cast(:v as jsonb), now())"
            " on conflict (key) do update set value = cast(:v as jsonb),"
            " updated_at = now()"
        ),
        {"k": key, "v": value_json},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'config_update', 'platform_config', :k,"
            " jsonb_build_object('value', cast(:v as text)))"
        ),
        {"a": actor_id, "k": key, "v": audit_value},
    )
    await db.commit()
    await invalidate(f"cfg:{key}")  # pul servisi 30s keşini dərhal təzələsin


# Faizlə ölçülən açarlar (0..100); min_withdrawal_amount AZN məbləğidir
_PERCENT_CONFIG = _ALLOWED_CONFIG - {"min_withdrawal_amount"}


async def svc_update_commission(
    db: AsyncSession, *, admin_id, key: str | None, value: Decimal | None,
) -> None:
    """admin_update_commission RPC portu — dəyər jsonb ƏDƏDİ kimi saxlanır
    (SQL-dəki `to_jsonb(p_value)`), yoxlamalar və xəta mətnləri SQL ilə eynidir."""
    if key not in _ALLOWED_CONFIG:
        raise AdminError(400, "Bu açar idarə olunmur", f"Invalid config key: {key}")
    if value is None:
        raise AdminError(400, "Dəyər rəqəm olmalıdır", "Value cannot be null")
    if value < 0:
        raise AdminError(400, "Dəyər mənfi ola bilməz", "Value must be >= 0")
    if key in _PERCENT_CONFIG and value > 100:
        raise AdminError(400, "Faiz 100-dən böyük ola bilməz",
                         "Percentage value must be <= 100")
    as_text = format(value, "f")   # eksponentsiz yazılış → etibarlı JSON ədədi
    await _write_config(db, key=key, value_json=as_text, actor_id=admin_id,
                        audit_value=as_text)


# ── İstifadəçilər ─────────────────────────────────────────────────
@router.get("/users")
async def users(
    db: AsyncSession = Depends(get_db),
    q: str | None = None,
    role: str | None = None,
    limit: int = Query(default=50, le=200),
    offset: int = 0,
) -> list[dict]:
    sql = (
        "select p.id, p.name, p.email, p.role, p.balance, p.is_verified,"
        " p.status, p.created_at, u.is_active"
        "  from profiles p left join users u on u.id = p.id where true"
    )
    params: dict = {"l": limit, "o": offset}
    if q:
        sql += " and (p.name ilike :q or p.email ilike :q)"
        params["q"] = f"%{q}%"
    if role:
        sql += " and p.role = :r"
        params["r"] = role
    rows = await db.execute(
        text(sql + " order by p.created_at desc limit :l offset :o"), params
    )
    return [dict(r._mapping) for r in rows]


@router.post("/users/{user_id}/active")
async def set_user_active(
    user_id: uuid.UUID,
    body: BlockIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Özünüzü bloklaya bilməzsiniz")
    await db.execute(
        text("update users set is_active=:a where id=:id"),
        {"a": body.active, "id": user_id},
    )
    await db.execute(
        text("update profiles set status=:s where id=:id"),
        {"s": "active" if body.active else "blocked", "id": user_id},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id)"
            " values (:a, :act, 'user', :t)"
        ),
        {"a": admin.id, "act": "user_unblock" if body.active else "user_block",
         "t": str(user_id)},
    )
    await db.commit()
    return {"ok": True}


# ── Bannerlər ─────────────────────────────────────────────────────
@router.get("/banners")
async def admin_banners(db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = await db.execute(
        text("select * from banners order by sort_order, created_at desc")
    )
    return [dict(r._mapping) for r in rows]


@router.post("/banners", status_code=201)
async def create_banner(body: BannerIn, db: AsyncSession = Depends(get_db)) -> dict:
    row = (
        await db.execute(
            text(
                "insert into banners (title, subtitle, image_url, link_url,"
                " is_active, sort_order) values (:t, :s, :i, :l, :a, :o)"
                " returning id"
            ),
            {"t": body.title, "s": body.subtitle, "i": body.image_url,
             "l": body.link_url, "a": body.is_active, "o": body.sort_order},
        )
    ).first()
    await db.commit()
    await invalidate("catalog:banners")
    return {"id": str(row.id)}


@router.put("/banners/{banner_id}")
async def update_banner(
    banner_id: uuid.UUID, body: BannerIn, db: AsyncSession = Depends(get_db)
) -> dict:
    await db.execute(
        text(
            "update banners set title=:t, subtitle=:s, image_url=:i, link_url=:l,"
            " is_active=:a, sort_order=:o, updated_at=now() where id=:id"
        ),
        {"t": body.title, "s": body.subtitle, "i": body.image_url,
         "l": body.link_url, "a": body.is_active, "o": body.sort_order,
         "id": banner_id},
    )
    await db.commit()
    await invalidate("catalog:banners")
    return {"ok": True}


@router.delete("/banners/{banner_id}")
async def delete_banner(banner_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(text("delete from banners where id=:id"), {"id": banner_id})
    await db.commit()
    await invalidate("catalog:banners")
    return {"ok": True}


# ── Dashboard (admin_dashboard_stats / admin_dashboard_daily portu) ─
@router.get("/dashboard-stats")
async def dashboard_stats(db: AsyncSession = Depends(get_db)) -> dict:
    return await svc_dashboard_stats(db)


async def svc_dashboard_stats(db: AsyncSession) -> dict:
    """admin_dashboard_stats RPC-nin 1:1 portu — 30 günlük panel statistikası."""
    row = (
        await db.execute(
            text(
                "with counts as ("
                " select"
                "  (select count(*) from profiles)                                              as total_users,"
                "  (select count(*) from profiles where created_at >= now() - interval '7 days') as new_users_7d,"
                "  (select count(*) from profiles where lower(coalesce(role,'')) = 'provider')  as total_providers,"
                "  (select count(*) from bookings)                                              as total_bookings,"
                "  (select count(*) from bookings where status = 'pending')                     as pending_bookings,"
                "  (select count(*) from bookings where status = 'completed')                   as completed_bookings,"
                "  (select count(*) from brigades)                                              as total_brigades,"
                "  (select count(*) from opportunities"
                "    where status in ('pending','active','ongoing','accepted'))                 as active_opportunities,"
                "  (select count(*) from opportunities)                                         as total_opportunities"
                "),"
                "gmv_30d as ("
                " select coalesce(sum(abs(amount)),0) as v, count(*) as paid_count"
                "   from transactions"
                "  where type = 'booking_charge' and created_at >= now() - interval '30 days'"
                "),"
                "gmv_7d as ("
                " select coalesce(sum(abs(amount)),0) as v from transactions"
                "  where type = 'booking_charge' and created_at >= now() - interval '7 days'"
                "),"
                # Qəbul komissiyası: müştərinin əlavə ödədiyi fərq
                "accept_comm as ("
                " select coalesce(sum(c.abs_amt - coalesce(l.amt,0)),0) as v"
                "   from (select related_id, abs(amount) as abs_amt from transactions"
                "          where type = 'booking_charge'"
                "            and created_at >= now() - interval '30 days') c"
                "   left join (select related_id, sum(amount) as amt from transactions"
                "               where type = 'escrow_lock' group by related_id) l"
                "     on l.related_id = c.related_id"
                "),"
                # Tamamlama komissiyası: escrow_lock - escrow_release fərqi
                "complete_comm as ("
                " select coalesce(sum(l.amt - r.amt),0) as v"
                "   from (select related_id, sum(amount) as amt from transactions"
                "          where type = 'escrow_lock'"
                "            and created_at >= now() - interval '30 days'"
                "          group by related_id) l"
                "   join (select related_id, sum(amount) as amt from transactions"
                "          where type = 'escrow_release'"
                "            and created_at >= now() - interval '30 days'"
                "          group by related_id) r on r.related_id = l.related_id"
                "),"
                "wd as ("
                " select coalesce(sum(commission_amount),0) as wd_comm,"
                "  coalesce(sum(case when status='pending' then amount_requested end),0) as pending_amount,"
                "  count(*) filter (where status='pending') as pending_count"
                "   from withdrawals where requested_at >= now() - interval '30 days'"
                ")"
                "select c.total_users, c.new_users_7d, c.total_providers,"
                "       c.total_bookings, c.pending_bookings, c.completed_bookings,"
                "       c.total_brigades, c.active_opportunities, c.total_opportunities,"
                "       g7.v as gmv_7d, g30.v as gmv_30d, g30.paid_count,"
                "       ac.v as accept_comm, cc.v as complete_comm, w.wd_comm,"
                "       w.pending_amount, w.pending_count"
                "  from counts c, gmv_30d g30, gmv_7d g7, accept_comm ac,"
                "       complete_comm cc, wd w"
            )
        )
    ).first()
    return {
        "totalUsers": row.total_users,
        "newUsers7d": row.new_users_7d,
        "totalProviders": row.total_providers,
        "totalBookings": row.total_bookings,
        "pendingBookings": row.pending_bookings,
        "completedBookings": row.completed_bookings,
        "totalBrigades": row.total_brigades,
        "activeOpportunities": row.active_opportunities,
        "totalOpportunities": row.total_opportunities,
        "gmv7d": row.gmv_7d,
        "gmv30d": row.gmv_30d,
        "completedPayments30d": row.paid_count,
        "acceptCommission": row.accept_comm,
        "completeCommission": row.complete_comm,
        "withdrawalCommission": row.wd_comm,
        "platformRevenue30d": (
            Decimal(row.accept_comm) + Decimal(row.complete_comm) + Decimal(row.wd_comm)
        ),
        "pendingWithdrawalsAmount": row.pending_amount,
        "pendingWithdrawalsCount": row.pending_count,
    }


@router.get("/dashboard-daily")
async def dashboard_daily(
    days: int = Query(default=14, ge=1, le=365),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    return await svc_dashboard_daily(db, days)


async def svc_dashboard_daily(db: AsyncSession, days: int) -> list[dict]:
    """admin_dashboard_daily RPC-nin portu — gün-gün GMV və gəlir.
    Sətirlər: {d, gmv, revenue} (SQL-dəki `returns table` sütunları)."""
    rows = await db.execute(
        text(
            "with days as ("
            " select generate_series("
            "   (current_date - (cast(:d as int) - 1))::date,"
            "   current_date, '1 day'::interval)::date as d"
            "),"
            "daily_gmv as ("
            " select date_trunc('day', created_at)::date as dt, sum(abs(amount)) as g"
            "   from transactions"
            "  where type = 'booking_charge'"
            "    and created_at >= current_date - cast(:d as int)"
            "  group by 1"
            "),"
            "daily_accept as ("
            " select date_trunc('day', c.created_at)::date as dt,"
            "        sum(abs(c.amount) - coalesce(l.amt,0)) as a"
            "   from transactions c"
            "   left join (select related_id, sum(amount) as amt from transactions"
            "               where type = 'escrow_lock' group by related_id) l"
            "     on l.related_id = c.related_id"
            "  where c.type = 'booking_charge'"
            "    and c.created_at >= current_date - cast(:d as int)"
            "  group by 1"
            "),"
            "daily_wd as ("
            " select date_trunc('day', requested_at)::date as dt,"
            "        sum(commission_amount) as w"
            "   from withdrawals"
            "  where requested_at >= current_date - cast(:d as int)"
            "  group by 1"
            ")"
            "select days.d,"
            "       coalesce(daily_gmv.g, 0)::numeric as gmv,"
            "       (coalesce(daily_accept.a, 0) + coalesce(daily_wd.w, 0))::numeric as revenue"
            "  from days"
            "  left join daily_gmv on daily_gmv.dt = days.d"
            "  left join daily_accept on daily_accept.dt = days.d"
            "  left join daily_wd on daily_wd.dt = days.d"
            " order by days.d"
        ),
        {"d": days},
    )
    return [dict(r._mapping) for r in rows]


# ── İstifadəçilər (meta ilə) — admin_list_users_with_meta portu ───
@router.get("/users-meta")
async def users_with_meta(db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await svc_users_with_meta(db)


async def svc_users_with_meta(db: AsyncSession) -> list[dict]:
    """admin_list_users_with_meta portu. Supabase `auth.users` yerinə kimlik
    cədvəli `users` (+ `oauth_identities`) istifadə olunur:

      auth_email ← users.email
      auth_meta  ← users.user_metadata      (köhnə raw_user_meta_data)
      provider   ← ilk OAuth bağlantısı (google/apple) | 'phone' | 'email'
      is_active  ← users.is_active

    SQL funksiyasının 11 sütunundan əlavə İstifadəçilər səhifəsinin oxuduğu
    profil sahələri də (status, is_verified, balance, address, rating)
    qaytarılır — səhifə əvvəllər bunları `profiles` fallback sorğusundan alırdı.
    """
    rows = await db.execute(
        text(
            "select p.id, p.name, p.email, p.phone_number, p.avatar_url, p.role,"
            "       coalesce(u.is_active, true) as is_active, p.created_at,"
            "       u.email as auth_email,"
            "       u.user_metadata as auth_meta,"
            "       coalesce((select oi.provider from oauth_identities oi"
            "                  where oi.user_id = p.id"
            "                  order by oi.created_at limit 1),"
            "                case when u.email is null and u.phone is not null"
            "                     then 'phone' end,"
            "                'email') as provider,"
            "       p.status, p.is_verified, p.balance, p.address, p.rating"
            "  from profiles p"
            "  left join users u on u.id = p.id"
            " order by p.created_at desc nulls last"
        )
    )
    return [dict(r._mapping) for r in rows]


# ── Şirkətlər (briqadalar) — admin_companies_list / admin_company_detail ─
@router.get("/companies")
async def companies_list(db: AsyncSession = Depends(get_db)) -> list[dict]:
    return await svc_companies_list(db)


async def svc_companies_list(db: AsyncSession) -> list[dict]:
    """admin_companies_list portu — ada görə sıralı şirkət (briqada) siyahısı."""
    rows = await db.execute(
        text(
            "select b.id, b.name, b.is_verified, b.is_active, b.balance,"
            "       b.rating, b.total_orders, b.created_at,"
            "       (select name from profiles where id = b.owner_id) as owner_name,"
            "       (select count(*) from brigade_members bm"
            "         where bm.brigade_id = b.id and bm.is_active) as member_count,"
            "       (select count(*) from brigade_members bm"
            "         where bm.brigade_id = b.id and bm.is_active and bm.is_online)"
            "         as online_count,"
            "       (select count(*) from opportunities_offers oo"
            "         where oo.brigade_id = b.id) as offer_count"
            "  from brigades b order by b.name"
        )
    )
    return [dict(r._mapping) for r in rows]


@router.get("/companies/{brigade_id}")
async def company_detail(
    brigade_id: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    try:
        return await svc_company_detail(db, brigade_id)
    except AdminError as e:
        raise _http(e) from e


async def svc_company_detail(db: AsyncSession, brigade_id: uuid.UUID) -> dict:
    """admin_company_detail portu: {brigade, members, orders, finance, logs}."""
    brigade = (
        await db.execute(
            text(
                "select b.id, b.name, b.description, b.is_verified, b.is_active,"
                "       b.balance, b.rating, b.total_orders, b.categories,"
                "       b.contact_phone, b.contact_email, b.address, b.created_at,"
                "       b.owner_id,"
                "       (select name from profiles where id = b.owner_id) as owner_name"
                "  from brigades b where b.id = :id"
            ),
            {"id": brigade_id},
        )
    ).first()
    if brigade is None:
        raise AdminError(404, "Şirkət tapılmadı")

    members = await db.execute(
        text(
            "select bm.id as member_id, bm.profile_id, p.name, p.avatar_url,"
            "       bm.role, bm.commission_pct, bm.is_active, bm.is_online,"
            "       bm.joined_at,"
            "       (select count(*) from brigade_assignments ba"
            "         where ba.member_id = bm.id and ba.status = 'completed')"
            "         as done_count"
            "  from brigade_members bm join profiles p on p.id = bm.profile_id"
            " where bm.brigade_id = :b order by bm.role, p.name"
        ),
        {"b": brigade_id},
    )
    orders = await db.execute(
        text(
            "select oo.id as offer_id, oo.opportunity_id, op.title,"
            "       oo.offer_amount as amount, oo.status, oo.payment_method,"
            "       oo.created_at,"
            "       (select p2.name from brigade_assignments ba"
            "          join brigade_members bm2 on bm2.id = ba.member_id"
            "          join profiles p2 on p2.id = bm2.profile_id"
            "         where ba.brigade_id = :b"
            "           and ba.source_id = oo.opportunity_id::text"
            "         order by ba.assigned_at desc limit 1) as worker_name,"
            "       (select ba.status from brigade_assignments ba"
            "         where ba.brigade_id = :b"
            "           and ba.source_id = oo.opportunity_id::text"
            "         order by ba.assigned_at desc limit 1) as worker_status"
            "  from opportunities_offers oo"
            "  left join opportunities op on op.id = oo.opportunity_id"
            " where oo.brigade_id = :b order by oo.created_at desc"
        ),
        {"b": brigade_id},
    )
    finance = await db.execute(
        text(
            "select t.id, t.type, t.amount, t.description, t.created_at,"
            "       (select name from profiles where id = t.user_id) as user_name"
            "  from transactions t where t.related_id = :b"
            " order by t.created_at desc limit 200"
        ),
        {"b": str(brigade_id)},
    )
    logs = await db.execute(
        text(
            "select a.id, a.action, a.target_type, a.created_at, a.payload,"
            "       (select name from profiles"
            "         where id = coalesce(a.actor, a.actor_id)) as actor_name"
            "  from audit_log a"
            " where a.target_id = :b or a.payload->>'brigade_id' = :b"
            " order by a.created_at desc limit 300"
        ),
        {"b": str(brigade_id)},
    )
    return {
        "brigade": dict(brigade._mapping),
        "members": [dict(r._mapping) for r in members],
        "orders": [dict(r._mapping) for r in orders],
        "finance": [dict(r._mapping) for r in finance],
        "logs": [dict(r._mapping) for r in logs],
    }


# ── Balans / bonus əməliyyatları ──────────────────────────────────
class AdjustBalanceIn(BaseModel):
    amount: Decimal
    reason: str | None = Field(default=None, max_length=500)
    target: str = Field(default="balance", pattern="^(balance|bonus|locked)$")


class CreditIn(BaseModel):
    amount: Decimal
    reason: str | None = Field(default=None, max_length=500)


@router.post("/users/{user_id}/adjust-balance")
async def adjust_balance(
    user_id: uuid.UUID,
    body: AdjustBalanceIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        v_new = await svc_adjust_balance(
            db, admin_id=admin.id, user_id=user_id, amount=body.amount,
            reason=body.reason, target=body.target)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True, "target": body.target, "new_value": str(v_new)}


async def svc_adjust_balance(
    db: AsyncSession, *, admin_id, user_id, amount: Decimal | None,
    reason: str | None, target: str = "balance",
) -> Decimal:
    """admin_adjust_balance RPC portu — balance | bonus | locked düzəlişi.

    Provayder rolları üçün provider_wallets, qalanlar üçün profiles.
    Hər dəyişiklik transactions ledger-inə və audit_log-a yazılır.
    Yeni dəyəri qaytarır (SQL `returns numeric`).
    """
    if amount is None or amount == 0:
        raise AdminError(400, "Məbləğ sıfır ola bilməz", "Amount cannot be zero / null")
    if target not in ("balance", "bonus", "locked"):
        raise AdminError(400, "Yanlış hədəf (balance | bonus | locked)",
                         "Invalid target (must be balance | bonus | locked)")

    # Hədəf istifadəçinin rolu (sətri kilidləyirik — yarış vəziyyəti olmasın)
    row = (
        await db.execute(
            text("select lower(coalesce(role,'')) as r from profiles"
                 " where id = :id for update"),
            {"id": user_id},
        )
    ).first()
    if row is None:
        raise AdminError(404, "User not found")

    if row.r in ("provider", "pro", "seller"):
        # Cüzdan sətri yoxdursa yarat
        await db.execute(
            text("insert into provider_wallets (provider_id) values (:p)"
                 " on conflict (provider_id) do nothing"),
            {"p": user_id},
        )
        col = {"balance": "balance", "bonus": "bonus_balance",
               "locked": "locked_balance"}[target]
        new = (
            await db.execute(
                text(
                    f"update provider_wallets set {col} = coalesce({col},0) + :a,"
                    f" updated_at = now() where provider_id = :p returning {col} as v"
                ),
                {"a": amount, "p": user_id},
            )
        ).first()
    else:
        if target == "locked":
            raise AdminError(400, "locked balans yalnız provayderlərə aiddir",
                             "locked balance applies only to providers")
        col = "balance" if target == "balance" else "bonus_balance"
        new = (
            await db.execute(
                text(f"update profiles set {col} = coalesce({col},0) + :a"
                     f" where id = :p returning {col} as v"),
                {"a": amount, "p": user_id},
            )
        ).first()

    if new is None:
        raise AdminError(400, "Balance update failed")
    v_new = Decimal(new.v)
    if v_new < 0:
        raise AdminError(400, "Nəticə mənfi balans olardı",
                         "Result would be negative balance")

    # transactions ledger — MÜTLƏQ yazılır
    await db.execute(
        text(
            "insert into transactions (user_id, type, amount, balance_after,"
            " description, created_by) values (:u, 'admin_adjust', :a, :b, :d, :c)"
        ),
        {"u": user_id, "a": amount, "b": v_new,
         "d": f"Admin düzəlişi ({target}): {reason or '—'}",
         "c": admin_id},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:act, 'balance_adjust', 'user_balance', :t,"
            " jsonb_build_object('target', cast(:tg as text),"
            "  'amount', cast(:a as numeric), 'reason', cast(:re as text),"
            "  'new_balance', cast(:n as numeric)))"
        ),
        {"act": admin_id, "t": str(user_id), "tg": target,
         "a": amount, "re": reason, "n": v_new},
    )
    await db.commit()
    return v_new


@router.post("/users/{user_id}/credit-balance")
async def credit_balance(
    user_id: uuid.UUID,
    body: CreditIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        v_new = await svc_credit_balance(
            db, admin_id=admin.id, user_id=user_id, amount=body.amount,
            reason=body.reason)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True, "new_balance": str(v_new)}


async def svc_credit_balance(
    db: AsyncSession, *, admin_id, user_id, amount: Decimal | None,
    reason: str | None,
) -> Decimal:
    """admin_credit_balance RPC portu — profiles.balance üzərində kredit/debet.

    Ledger-ə 'admin_credit'/'admin_debit' yazılır. Canlı Supabase-də
    transactions_type_check bu növlərə icazə vermədiyi üçün əməliyyat heç
    vaxt işləməyib; alembic 0005 həmin növləri məhdudiyyətə əlavə edir.
    """
    if amount is None or amount == 0:
        raise AdminError(400, "Məbləğ sıfır ola bilməz", "Amount must be non-zero")
    new = (
        await db.execute(
            text("update profiles set balance = coalesce(balance,0) + :a"
                 " where id = :u returning balance"),
            {"a": amount, "u": user_id},
        )
    ).first()
    if new is None:
        raise AdminError(404, "User not found")
    v_new = Decimal(new.balance)

    # transactions ledger — MÜTLƏQ yazılır
    await db.execute(
        text(
            "insert into transactions (user_id, type, amount, balance_after,"
            " description, created_by) values (:u, :t, :a, :b, :d, :c)"
        ),
        {"u": user_id,
         "t": "admin_credit" if amount > 0 else "admin_debit",
         "a": amount, "b": v_new,
         "d": reason or "Admin manual adjustment", "c": admin_id},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:act, 'admin_balance_adjust', 'profile', :t,"
            " jsonb_build_object('amount', cast(:a as numeric),"
            "  'reason', cast(:re as text), 'new_balance', cast(:n as numeric)))"
        ),
        {"act": admin_id, "t": str(user_id), "a": amount,
         "re": reason, "n": v_new},
    )
    await db.commit()
    return v_new


@router.post("/users/{user_id}/credit-bonus")
async def credit_bonus(
    user_id: uuid.UUID,
    body: CreditIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        v_new = await svc_credit_bonus(
            db, admin_id=admin.id, user_id=user_id, amount=body.amount,
            reason=body.reason)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True, "new_bonus": str(v_new)}


async def svc_credit_bonus(
    db: AsyncSession, *, admin_id, user_id, amount: Decimal | None,
    reason: str | None,
) -> Decimal:
    """admin_credit_bonus RPC portu — provider_wallets.bonus_balance düzəlişi."""
    if amount is None or amount == 0:
        raise AdminError(400, "Məbləğ sıfır ola bilməz", "Amount must be non-zero")
    new = (
        await db.execute(
            text(
                "insert into provider_wallets (provider_id, bonus_balance)"
                " values (:p, :a)"
                " on conflict (provider_id) do update"
                " set bonus_balance = coalesce(provider_wallets.bonus_balance,0) + :a"
                " returning bonus_balance"
            ),
            {"p": user_id, "a": amount},
        )
    ).first()
    v_new = Decimal(new.bonus_balance)
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:act, 'admin_bonus_adjust', 'wallet', :t,"
            " jsonb_build_object('amount', cast(:a as numeric),"
            "  'reason', cast(:re as text), 'new_bonus', cast(:n as numeric)))"
        ),
        {"act": admin_id, "t": str(user_id), "a": amount,
         "re": reason, "n": v_new},
    )
    await db.commit()
    return v_new


# ── Rol dəyişmə / istifadəçi silmə ────────────────────────────────
class RoleIn(BaseModel):
    role: str = Field(pattern="^(customer|provider|admin)$")


@router.post("/users/{user_id}/role")
async def set_user_role(
    user_id: uuid.UUID,
    body: RoleIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        await svc_set_user_role(db, admin=admin, user_id=user_id, role=body.role)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True, "role": body.role}


async def svc_set_user_role(
    db: AsyncSession, *, admin: User, user_id, role: str | None,
) -> None:
    """admin_set_user_role RPC portu. Bu backenddə rol İKİ yerdə saxlanır:
    `profiles.role` (RLS siyasətləri oxuyur) və `users.role` (API/JWT oxuyur)
    — ikisi də yenilənir.

    SQL-dən əlavə qoruma: `users.role` master/superadmin olan hesabın rolunu
    yalnız superadmin dəyişə bilər (köhnə sistemdə bu rollar yalnız
    panelin UI-ında qorunurdu; burada server tərəfində də qorunur).
    """
    if role not in ("customer", "provider", "admin"):
        raise AdminError(400, "Yanlış rol", f"Invalid role: {role}")
    target = (
        await db.execute(
            text("select u.role as user_role, p.role as profile_role"
                 "  from (select cast(:id as uuid) as id) x"
                 "  left join users u on u.id = x.id"
                 "  left join profiles p on p.id = x.id"),
            {"id": str(user_id) if user_id else None},
        )
    ).first()
    if (target.user_role or "") in ("master", "superadmin") and admin.role != "superadmin":
        raise AdminError(
            403, "master/superadmin rolunu yalnız superadmin dəyişə bilər",
            "Forbidden: only superadmin can change a master/superadmin role")
    await db.execute(
        text("update profiles set role = :r where id = :id"),
        {"r": role, "id": user_id},
    )
    await db.execute(
        text("update users set role = :r where id = :id"),
        {"r": role, "id": user_id},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'role_change', 'user', :t,"
            " jsonb_build_object('role', cast(:r as text),"
            "  'old_role', cast(:o as text)))"
        ),
        {"a": admin.id, "t": str(user_id), "r": role,
         "o": target.profile_role or target.user_role},
    )
    await db.commit()


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: uuid.UUID,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    res = await svc_delete_user(db, admin=admin, user_id=user_id)
    if not res["ok"]:
        raise HTTPException(
            status_code=403 if res["error"] == "ONLY_SUPERADMIN_DELETES_ADMINS" else 400,
            detail=res["error"])
    return res


async def svc_delete_user(db: AsyncSession, *, admin: User, user_id) -> dict:
    """admin_delete_user RPC portu. Cavab SQL-dəki jsonb ilə eynidir:
    {ok:false, error} | {ok:true, deleted:true} | {ok:true, deleted:false, banned:true}.

    Profil + kimlik (`users`) sətri silinir; refresh sessiyaları həm bazada,
    həm Redis-də ləğv olunur. Tarixçəsi (FK asılılığı) olan hesab silinə
    bilmirsə soft-ban edilir: users.is_active=false + profiles.status='blocked'
    (Supabase-dəki banned_until='infinity' qarşılığı) — sessiyalar yenə bağlanır.
    """
    if user_id == admin.id:
        return {"ok": False, "error": "CANNOT_DELETE_SELF"}
    target = (
        await db.execute(
            text("select (select lower(coalesce(role,'')) from profiles where id = :id) as pr,"
                 "       (select lower(coalesce(role,'')) from users where id = :id) as ur"),
            {"id": user_id},
        )
    ).first()
    if (target.pr in _ADMIN or target.ur in _ADMIN) and admin.role != "superadmin":
        return {"ok": False, "error": "ONLY_SUPERADMIN_DELETES_ADMINS"}

    # Redis-dəki refresh açarları üçün jti-lər (sətirlər silinməzdən əvvəl)
    jtis = [
        r.jti for r in await db.execute(
            text("select jti from refresh_sessions where user_id = :id"),
            {"id": user_id},
        )
    ]

    deleted = True
    try:
        # Savepoint — FK pozuntusunda tranzaksiya bütövlükdə ölməsin
        async with db.begin_nested():
            await db.execute(
                text("delete from profiles where id = :id"), {"id": user_id})
            # refresh_sessions / oauth_identities ON DELETE CASCADE ilə silinir
            await db.execute(
                text("delete from users where id = :id"), {"id": user_id})
    except IntegrityError:
        deleted = False
        await db.execute(
            text("update users set is_active = false where id = :id"),
            {"id": user_id},
        )
        await db.execute(
            text("update profiles set status = 'blocked' where id = :id"),
            {"id": user_id},
        )
        await db.execute(
            text("update refresh_sessions set revoked = true where user_id = :id"),
            {"id": user_id},
        )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id)"
            " values (:a, :act, 'user', :t)"
        ),
        {"a": admin.id,
         "act": "user_delete" if deleted else "user_soft_ban",
         "t": str(user_id)},
    )
    await db.commit()
    # Commit-dən sonra: Redis whitelist-dən çıxar (refresh artıq işləməsin)
    for jti in jtis:
        try:
            await redis.delete(f"rt:{jti}")
        except Exception:
            log.warning("refresh sessiyası Redis-dən silinmədi (jti %s)", jti)
    if deleted:
        return {"ok": True, "deleted": True}
    return {"ok": True, "deleted": False, "banned": True}


# ── Sifarişin admin təsdiqi — admin_complete_opportunity ──────────
_COMPLETABLE = ("pending_review", "ongoing", "i-am-here", "accepted")


async def svc_complete_opportunity(
    db: AsyncSession, *, admin: User, opportunity_id,
) -> str:
    """admin_complete_opportunity RPC portu → 'completed' | 'already_completed'.

    Köhnə sistemdə funksiya yalnız statusu 'completed' edirdi, escrow-nu isə
    `auto_release_on_opportunity_complete` DB trigger-i dərhal açırdı. Bu
    backenddə həmin trigger yoxdur — pul hərəkəti `money.release_offer`
    servisindədir; ona görə qəbul edilmiş təklif varsa mövcud servis çağırılır
    (hesablama dəyişdirilməyib). Təklif açıla bilmirsə (escrow yoxdur, artıq
    qaytarılıb və s.) yalnız status dəyişir — köhnə trigger də belə hallarda
    xətasız keçirdi.
    """
    opp = (
        await db.execute(
            text("select status, accepted_offer_id, created_by, provider_id"
                 "  from opportunities where id = :id for update"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None or opp.status is None:
        raise AdminError(404, "Sifariş tapılmadı", "Opportunity not found")
    if opp.status == "completed":
        return "already_completed"
    if opp.status not in _COMPLETABLE:
        raise AdminError(
            409, f"Sifariş təsdiq gözləmir (status: {opp.status})",
            f"Order is not awaiting approval (status: {opp.status})")

    notices: list[Notice] = []
    released = False
    if opp.accepted_offer_id is not None:
        try:
            async with db.begin_nested():
                res = await release_offer(
                    db, offer_id=opp.accepted_offer_id, caller_id=admin.id,
                    caller_role=admin.role)
                notices += await notify_offer_released(
                    db, offer_id=opp.accepted_offer_id, method=res["method"],
                    released=res["released"])
            released = True
        except MoneyError as e:
            log.warning("admin təsdiqi: escrow açılmadı (sifariş %s): %s",
                        opportunity_id, e)
    if not released:
        await set_opportunity_status(
            db, opp_id=opportunity_id, new_status="completed",
            actor_id=admin.id, actor_role=admin.role)

    # notify_on_opportunity_status_change trigger portu: müştəriyə, pul
    # açılmayıbsa provayderə də (açılıbsa o, ödəniş bildirişini artıq alıb)
    targets = [opp.created_by]
    if not released and opp.provider_id and opp.provider_id != opp.created_by:
        targets.append(opp.provider_id)
    for uid in targets:
        if uid is None:
            continue
        notices.append(await insert_notice(
            db, user_id=uid, ntype="status_completed", title="İş tamamlandı",
            body="Sifariş uğurla tamamlandı.", related_id=str(opportunity_id)))
    await db.commit()
    dispatch_all(notices)
    return "completed"


# ── Briqada müraciətləri — admin_approve/reject_brigade_application ─
class DecisionIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


@router.get("/brigade-applications")
async def brigade_applications(
    status: str | None = Query(default="pending"),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Müraciət siyahısı (təsdiq/rədd panelinin mənbəyi)."""
    sql = (
        "select id, applicant_id, name, description, categories, contact_phone,"
        " contact_email, address, logo_url, status, admin_note, brigade_id,"
        " applicant_name, applicant_email, applicant_phone, created_at,"
        " decided_at, decided_by from brigade_applications where true"
    )
    params: dict = {}
    if status and status != "all":
        sql += " and status = :s"
        params["s"] = status
    rows = await db.execute(text(sql + " order by created_at desc"), params)
    return [dict(r._mapping) for r in rows]


async def _pending_application(db: AsyncSession, application_id):
    app_row = (
        await db.execute(
            text("select * from brigade_applications where id = :id for update"),
            {"id": application_id},
        )
    ).first()
    if app_row is None:
        raise AdminError(404, "Application not found")
    if app_row.status != "pending":
        raise AdminError(409, f"Application already {app_row.status}")
    return app_row


@router.post("/brigade-applications/{application_id}/approve")
async def approve_brigade_application(
    application_id: uuid.UUID,
    body: DecisionIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        brigade_id = await svc_approve_brigade_application(
            db, admin_id=admin.id, application_id=application_id, note=body.note)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True, "brigade_id": str(brigade_id)}


async def svc_approve_brigade_application(
    db: AsyncSession, *, admin_id, application_id, note: str | None,
) -> uuid.UUID:
    """admin_approve_brigade_application RPC portu — briqada yaradılır,
    yeni briqadanın id-si qaytarılır (SQL `returns uuid`)."""
    app_row = await _pending_application(db, application_id)

    # Briqada yarat
    brigade = (
        await db.execute(
            text(
                "insert into brigades (owner_id, name, description, categories,"
                " contact_phone, contact_email, address, logo_url, is_verified)"
                " values (:o, :n, :d, :c, :ph, :em, :ad, :lo, true) returning id"
            ),
            {"o": app_row.applicant_id, "n": app_row.name,
             "d": app_row.description, "c": app_row.categories,
             "ph": app_row.contact_phone, "em": app_row.contact_email,
             "ad": app_row.address, "lo": app_row.logo_url},
        )
    ).first()
    brigade_id = brigade.id

    # Müraciətçini owner üzv kimi əlavə et (varsa — toxunma)
    await db.execute(
        text(
            "insert into brigade_members (brigade_id, profile_id, role, is_active)"
            " values (:b, :p, 'owner', true)"
            " on conflict (brigade_id, profile_id) do nothing"
        ),
        {"b": brigade_id, "p": app_row.applicant_id},
    )

    # Müraciəti təsdiqlənmiş kimi qeyd et
    await db.execute(
        text(
            "update brigade_applications set status='approved', decided_at=now(),"
            " decided_by=:by, admin_note=:note, brigade_id=:b where id=:id"
        ),
        {"by": admin_id, "note": note, "b": brigade_id,
         "id": application_id},
    )

    # Bildiriş → müraciətçi (best-effort, RPC-dəki kimi xətanı udur)
    title = "Briqada təsdiqləndi"
    n_body = f"{app_row.name or 'Briqada'} admin tərəfindən təsdiqləndi."
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "insert into notifications (user_id, type, title, body,"
                    " related_id, kind, link) values (:u, 'brigade_approved',"
                    " :t, :b, :r, 'brigade_approved', :l)"
                ),
                {"u": app_row.applicant_id, "t": title, "b": n_body,
                 "r": str(brigade_id), "l": f"/brigades/{brigade_id}"},
            )
    except Exception:
        pass

    # Audit (best-effort)
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "insert into audit_log (actor_id, action, target_type,"
                    " target_id, payload) values (:a, 'brigade_approve',"
                    " 'brigade_application', :t,"
                    " jsonb_build_object('brigade_id', cast(:b as text),"
                    "  'note', cast(:n as text)))"
                ),
                {"a": admin_id, "t": str(application_id),
                 "b": str(brigade_id), "n": note},
            )
    except Exception:
        pass

    await db.commit()
    dispatch(app_row.applicant_id, title, n_body,
             {"brigade_id": str(brigade_id)})
    return brigade_id


@router.post("/brigade-applications/{application_id}/reject")
async def reject_brigade_application(
    application_id: uuid.UUID,
    body: DecisionIn,
    admin: User = Depends(require_roles(*_ADMIN)),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        await svc_reject_brigade_application(
            db, admin_id=admin.id, application_id=application_id, reason=body.note)
    except AdminError as e:
        raise _http(e) from e
    return {"ok": True}


async def svc_reject_brigade_application(
    db: AsyncSession, *, admin_id, application_id, reason: str | None,
) -> None:
    """admin_reject_brigade_application RPC portu."""
    app_row = await _pending_application(db, application_id)

    await db.execute(
        text(
            "update brigade_applications set status='rejected', decided_at=now(),"
            " decided_by=:by, admin_note=:note where id=:id"
        ),
        {"by": admin_id, "note": reason, "id": application_id},
    )

    title = "Briqada müraciəti imtina edildi"
    n_body = reason or "Müraciətiniz qəbul olunmadı."
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "insert into notifications (user_id, type, title, body,"
                    " related_id, kind, link) values (:u, 'brigade_rejected',"
                    " :t, :b, :r, 'brigade_rejected', '/brigades')"
                ),
                {"u": app_row.applicant_id, "t": title, "b": n_body,
                 "r": str(application_id)},
            )
    except Exception:
        pass
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "insert into audit_log (actor_id, action, target_type,"
                    " target_id, payload) values (:a, 'brigade_reject',"
                    " 'brigade_application', :t,"
                    " jsonb_build_object('reason', cast(:n as text)))"
                ),
                {"a": admin_id, "t": str(application_id), "n": reason},
            )
    except Exception:
        pass

    await db.commit()
    dispatch(app_row.applicant_id, title, n_body,
             {"application_id": str(application_id)})


# ── Audit ─────────────────────────────────────────────────────────
@router.get("/audit")
async def audit(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, le=500),
    offset: int = 0,
) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, actor_id, action, target_type, target_id, payload, created_at"
            " from audit_log order by created_at desc limit :l offset :o"
        ),
        {"l": limit, "o": offset},
    )
    return [dict(r._mapping) for r in rows]
