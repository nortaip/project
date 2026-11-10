"""Təkliflər — vermə, siyahı, qəbul (pul), tamamlama (escrow açılışı).

Bildirişlər (Supabase notify_customer_on_new_offer /
notify_provider_on_offer_status trigger-lərinin portu) app.services.notify
köməkçiləri ilə tranzaksiya daxilində yazılır, commit-dən sonra push + WS
dispatch olunur.
"""
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
from app.services import marketplace
from app.services.marketplace import OpError
from app.services.money import MoneyError
# Geriyə uyğunluq: köhnə kod/testlər `offers.refund_offer`-ə müraciət edir
# (məntiq indi marketplace.refund_offer → money.refund_offer-dədir)
from app.services.money import refund_offer  # noqa: F401
from app.services.notify import dispatch_all
from app.services.realtime import publish

router = APIRouter(prefix="/offers", tags=["offers"])


class OfferCreate(BaseModel):
    opportunity_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=Decimal("999999"))
    notes: str | None = Field(default=None, max_length=1000)


class AcceptIn(BaseModel):
    method: str = Field(pattern="^(cash|card)$")
    promo_code: str | None = Field(default=None, max_length=32)


@router.post("", status_code=201)
async def place_offer(
    body: OfferCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # Qaydalar (rol, KYC, komissiya balansı, təkrar təklif) ortaq servisdədir —
    # place_bid RPC ilə eyni kod
    try:
        res = await marketplace.place_bid(
            db, caller_id=user.id, role=user.role,
            opportunity_id=body.opportunity_id, amount=body.amount,
            notes=body.notes)
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    dispatch_all(res["notices"])
    await publish(res["customer_id"], "offer.new", {
        "opportunity_id": str(body.opportunity_id), "offer_id": str(res["bid_id"]),
        "amount": str(body.amount)})
    return {"id": str(res["bid_id"]), "status": "pending"}


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
        # Pul + qəbul olunan/rədd edilən provayderlərə bildiriş
        result, notices = await marketplace.accept_offer(
            db, offer_id=offer_id, caller_id=user.id, method=body.method,
            promo_code=body.promo_code)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    dispatch_all(notices)
    return result


@router.post("/{offer_id}/complete")
async def complete(
    offer_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        # Escrow açılışı + provayderə bildiriş
        result, notices = await marketplace.release_offer(
            db, offer_id=offer_id, caller_id=user.id, caller_role=user.role)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    dispatch_all(notices)
    return result


class RefundIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


@router.post("/{offer_id}/refund")
async def refund(
    offer_id: uuid.UUID,
    body: RefundIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Qəbul edilmiş təklifin geri qaytarılması (idempotent)."""
    try:
        # İdempotent təkrar çağırışda (already_refunded) bildiriş yazılmır
        result, notices = await marketplace.refund_offer(
            db, offer_id=offer_id, caller_id=user.id,
            caller_role=user.role, reason=body.reason)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    dispatch_all(notices)
    return result
