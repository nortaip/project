"""Sifarişlər (opportunities) — yaratma, siyahı, detal, ləğv."""
from __future__ import annotations

import json
import uuid
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/opportunities", tags=["opportunities"])

_OPEN_STATUSES = ("pending", "open", "new", "active")
_CANCELLABLE = ("pending", "open", "new", "accepted", "active")


class OpportunityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=4000)
    category_id: uuid.UUID
    subcategory_id: uuid.UUID | None = None
    date: date
    location: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    budget: Decimal | None = Field(default=None, ge=0, le=Decimal("999999"))
    extra_answers: dict = Field(default_factory=dict)


class CancelIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


@router.post("", status_code=201)
async def create_opportunity(
    body: OpportunityCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = (
        await db.execute(
            text(
                "insert into opportunities (title, description, created_by, date,"
                " location, latitude, longitude, category_id, subcategory_id,"
                " budget, extra_answers, status)"
                " values (:t, :d, :u, :dt, :loc, :lat, :lng, :c, :s, :b,"
                " cast(:ea as jsonb), 'pending') returning id"
            ),
            {"t": body.title, "d": body.description, "u": user.id, "dt": body.date,
             "loc": body.location, "lat": body.latitude, "lng": body.longitude,
             "c": body.category_id, "s": body.subcategory_id, "b": body.budget,
             "ea": json.dumps(body.extra_answers)},
        )
    ).first()
    await db.commit()
    return {"id": str(row.id), "status": "pending"}


@router.get("/mine")
async def my_opportunities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, title, status, date, location, budget, category_id,"
            " accepted_offer_id, created_at from opportunities"
            " where created_by = :u order by created_at desc"
            " limit :l offset :o"
        ),
        {"u": user.id, "l": limit, "o": offset},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/open")
async def open_opportunities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    category_id: uuid.UUID | None = None,
    limit: int = Query(default=50, le=100),
) -> list[dict]:
    """Provayderlər üçün açıq sifarişlər (öz sifarişləri istisna)."""
    if user.role not in ("provider", "admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Yalnız provayderlər üçün")
    sql = (
        "select id, title, description, date, location, latitude, longitude,"
        " budget, category_id, subcategory_id, created_at from opportunities"
        " where status = any(:sts) and created_by <> :u"
    )
    params: dict = {"sts": list(_OPEN_STATUSES), "u": user.id, "l": limit}
    if category_id:
        sql += " and category_id = :c"
        params["c"] = category_id
    rows = await db.execute(text(sql + " order by created_at desc limit :l"), params)
    return [dict(r._mapping) for r in rows]


@router.get("/{opportunity_id}")
async def opportunity_detail(
    opportunity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = (
        await db.execute(
            text("select * from opportunities where id = :id"), {"id": opportunity_id}
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    d = dict(row._mapping)
    is_owner = d["created_by"] == user.id
    is_assigned = d.get("provider_id") == user.id
    if not (is_owner or is_assigned or user.role in ("admin", "superadmin")):
        # Provayderlər açıq sifarişin detalını görə bilər
        if not (user.role == "provider" and d["status"] in _OPEN_STATUSES):
            raise HTTPException(status_code=403, detail="İcazə yoxdur")
    return d


@router.post("/{opportunity_id}/cancel")
async def cancel_opportunity(
    opportunity_id: uuid.UUID,
    body: CancelIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Ləğv + kart ödənişində avtomatik refund (cancel RPC portu)."""
    row = (
        await db.execute(
            text(
                "select id, created_by, status, accepted_offer_id"
                " from opportunities where id = :id for update"
            ),
            {"id": opportunity_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    if row.created_by != user.id and user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    if row.status not in _CANCELLABLE:
        raise HTTPException(status_code=409, detail="Bu mərhələdə ləğv mümkün deyil")

    refunded = Decimal(0)
    if row.accepted_offer_id is not None:
        # Kart escrow-u geri qaytar
        offer = (
            await db.execute(
                text(
                    "select id, provider_id, payment_method, offer_amount"
                    " from opportunities_offers where id = :id for update"
                ),
                {"id": row.accepted_offer_id},
            )
        ).first()
        if offer is not None and offer.payment_method == "card":
            locked = (
                await db.execute(
                    text(
                        "select amount from transactions where related_id = :r"
                        " and type = 'escrow_lock' order by created_at desc limit 1"
                    ),
                    {"r": str(offer.id)},
                )
            ).first()
            if locked is not None:
                refunded = Decimal(locked.amount)
                await db.execute(
                    text(
                        "update provider_wallets set locked_balance = "
                        " greatest(locked_balance - :a, 0), updated_at = now()"
                        " where provider_id = :p"
                    ),
                    {"a": refunded, "p": offer.provider_id},
                )
                # Müştəriyə tam məbləğ (komissiya daxil) qaytarılır
                full = Decimal(offer.offer_amount)
                await db.execute(
                    text("update profiles set balance = coalesce(balance,0) + :a where id = :u"),
                    {"a": full, "u": user.id},
                )
                await db.execute(
                    text(
                        "insert into transactions (user_id, type, amount, description,"
                        " related_id, created_by) values (:u, 'refund', :a, :d, :r, :u)"
                    ),
                    {"u": user.id, "a": full,
                     "d": f"Sifariş ləğvi — geri qaytarma ({body.reason[:100]})",
                     "r": str(offer.id)},
                )
                refunded = full
        if offer is not None:
            await db.execute(
                text("update opportunities_offers set status='rejected', updated_at=now() where id=:id"),
                {"id": offer.id},
            )

    await db.execute(
        text(
            "update opportunities set status='cancelled', cancellation_reason=:r"
            " where id=:id"
        ),
        {"r": body.reason, "id": opportunity_id},
    )
    await db.commit()
    return {"ok": True, "refunded": str(refunded)}
