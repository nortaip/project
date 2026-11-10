"""Təkliflər — vermə, siyahı, qəbul (pul), tamamlama (escrow açılışı).

Bildirişlər (Supabase notify_customer_on_new_offer /
notify_provider_on_offer_status trigger-lərinin portu) app.services.notify
köməkçiləri ilə tranzaksiya daxilində yazılır, commit-dən sonra push + WS
dispatch olunur.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.money import (
    MoneyError, _config_pct, _round2, accept_offer, refund_offer, release_offer,
)
from app.services.notify import (
    dispatch_all, notify_new_offer, notify_offer_accepted,
    notify_offer_refunded, notify_offer_released,
)
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
    if user.role not in ("provider", "admin", "master", "superadmin"):
        raise HTTPException(status_code=403, detail="Yalnız provayderlər təklif verə bilər")

    # KYC qapısı + komissiya balansı (place_bid RPC ilə eyni şərtlər)
    prof = (
        await db.execute(
            text(
                "select coalesce(balance,0) as balance,"
                "       coalesce(is_verified,false) as is_verified,"
                "       last_kyc_approved_at"
                "  from profiles where id = :u"
            ),
            {"u": user.id},
        )
    ).first()
    if user.role == "provider":
        kyc_at = prof.last_kyc_approved_at
        kyc_fresh = (
            kyc_at is not None
            and kyc_at > datetime.now(timezone.utc) - timedelta(days=14)
        )
        if not prof.is_verified or not kyc_fresh:
            raise HTTPException(
                status_code=403,
                detail="KYC_REQUIRED: Şəxsiyyət təsdiqiniz yoxdur və ya vaxtı bitib")

    commission_pct = await _config_pct(db, "commission_on_accept")
    required = _round2(Decimal(str(body.amount)) * commission_pct / 100)
    if Decimal(prof.balance) < required:
        raise HTTPException(
            status_code=409,
            detail=f"NO_BALANCE: balansda minimum {required} AZN olmalıdır"
                   f" (komissiya {commission_pct}%), cari: {prof.balance} AZN")

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
    # Müştəriyə bildiriş (notify_customer_on_new_offer trigger portu)
    notices = await notify_new_offer(db, offer_id=row.id)
    await db.commit()
    dispatch_all(notices)
    await publish(opp.created_by, "offer.new", {
        "opportunity_id": str(body.opportunity_id), "offer_id": str(row.id),
        "amount": str(body.amount)})
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
        result = await accept_offer(db, offer_id=offer_id, caller_id=user.id, method=body.method, promo_code=body.promo_code)
        # Qəbul olunan + bu qəbulla rədd edilən provayderlərə bildiriş
        notices = await notify_offer_accepted(db, offer_id=offer_id)
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
        result = await release_offer(db, offer_id=offer_id, caller_id=user.id, caller_role=user.role)
        # Provayderə bildiriş (kartda açılan məbləğ ilə, nağdda sadə mətn)
        notices = await notify_offer_released(
            db, offer_id=offer_id, method=result["method"],
            released=result["released"])
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
        result = await refund_offer(
            db, offer_id=offer_id, caller_id=user.id,
            caller_role=user.role, reason=body.reason)
        # İdempotent təkrar çağırışda (already_refunded) bildiriş yazılmır
        notices = []
        if not result.get("already_refunded"):
            notices = await notify_offer_refunded(
                db, offer_id=offer_id,
                refunded_amount=result["refunded_amount"])
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    dispatch_all(notices)
    return result
