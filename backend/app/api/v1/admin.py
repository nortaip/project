"""Admin API — statistika, komissiyalar, istifadəçilər, bannerlər, audit."""
from __future__ import annotations

import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_roles
from app.db.session import get_db
from app.models.user import User

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles("admin", "superadmin"))],
)


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
    await db.execute(
        text(
            "insert into platform_config (key, value, updated_at)"
            " values (:k, cast(:v as jsonb), now())"
            " on conflict (key) do update set value = cast(:v as jsonb),"
            " updated_at = now()"
        ),
        {"k": key, "v": json.dumps(str(val))},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'config_update', 'platform_config', :k,"
            " jsonb_build_object('value', cast(:v as text)))"
        ),
        {"a": admin.id, "k": key, "v": body.value},
    )
    await db.commit()
    return {"ok": True, "key": key, "value": val}


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
    return {"ok": True}


@router.delete("/banners/{banner_id}", status_code=204)
async def delete_banner(banner_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> None:
    await db.execute(text("delete from banners where id=:id"), {"id": banner_id})
    await db.commit()


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
