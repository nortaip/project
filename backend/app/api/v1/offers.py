"""Təkliflər — vermə, siyahı, qəbul (pul), tamamlama (escrow açılışı)."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.money import MoneyError, accept_offer, release_offer

router = APIRouter(prefix="/offers", tags=["offers"])


class OfferCreate(BaseModel):
    opportunity_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=Decimal("999999"))
    notes: str | None = Field(default=None, max_length=1000)


class AcceptIn(BaseModel):
    method: str = Field(pattern="^(cash|card)$")


@router.post("", status_code=201)
async def place_offer(
    body: OfferCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.role != "provider":
        raise HTTPException(status_code=403, detail="Yalnız provayderlər təklif verə bilər")

    opp = (
        await db.execute(
            text("select id, status, created_by from opportunities where id = :id"),
            {"id": body.opportunity_id},
        )
    ).first()
    if opp is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    if opp.created_by == user.id:
        raise HTTPException(status_code=409, detail="Öz sifarişinizə təklif verə bilməzsiniz")
    if opp.status not in ("pending", "open", "new", "active"):
        raise HTTPException(status_code=409, detail="Sifariş artıq aktiv deyil")

    dup = (
        await db.execute(
            text(
                "select 1 from opportunities_offers"
                " where opportunity_id=:opp and provider_id=:u and status='pending'"
            ),
            {"opp": body.opportunity_id, "u": user.id},
        )
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail="Artıq təklif vermisiniz")

    row = (
        await db.execute(
            text(
                "insert into opportunities_offers"
                " (opportunity_id, provider_id, offer_amount, status, notes)"
                " values (:opp, :u, :a, 'pending', :n) returning id"
            ),
            {"opp": body.opportunity_id, "u": user.id, "a": body.amount, "n": body.notes},
        )
    ).first()
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, 'new_offer', 'Yeni təklif 📨', :b, :r)"
        ),
        {"u": opp.created_by, "b": f"Sifarişinizə {body.amount} ₼ təklif gəldi",
         "r": str(body.opportunity_id)},
    )
    await db.commit()
    return {"id": str(row.id), "status": "pending"}


@router.get("/by-opportunity/{opportunity_id}")
async def offers_for_opportunity(
    opportunity_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    opp = (
        await db.execute(
            text("select created_by from opportunities where id = :id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    if opp.created_by != user.id and user.role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    rows = await db.execute(
        text(
            "select oo.id, oo.provider_id, oo.brigade_id, oo.offer_amount,"
            "       oo.status, oo.payment_method, oo.notes, oo.created_at,"
            "       p.name  as provider_name, p.avatar_url as provider_avatar,"
            "       p.rating as provider_rating, p.is_online as provider_online,"
            "       p.latitude as provider_lat, p.longitude as provider_lng,"
            "       b.name  as brigade_name, b.logo_url as brigade_logo"
            "  from opportunities_offers oo"
            "  left join profiles p on p.id = oo.provider_id"
            "  left join brigades b on b.id = oo.brigade_id"
            " where oo.opportunity_id = :opp"
            "   and oo.status not in ('rejected')"
            " order by oo.offer_amount asc"
        ),
        {"opp": opportunity_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{offer_id}/accept")
async def accept(
    offer_id: uuid.UUID,
    body: AcceptIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await accept_offer(db, offer_id=offer_id, caller_id=user.id, method=body.method)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    return result


@router.post("/{offer_id}/complete")
async def complete(
    offer_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await release_offer(db, offer_id=offer_id, caller_id=user.id, caller_role=user.role)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    return result
