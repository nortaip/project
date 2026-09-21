"""Birbaşa xidmət sifarişləri (bookings) — 1 ₼ komissiya ilə yaradılma,
siyahı və ləğv. Supabase create_booking_with_fee RPC-nin API qarşılığı."""
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
from app.services.money import MoneyError, create_booking_with_fee

router = APIRouter(prefix="/bookings", tags=["bookings"])


class BookingCreate(BaseModel):
    service_id: int
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(min_length=1, max_length=16)
    package_name: str | None = Field(default=None, max_length=200)
    package_price: Decimal | None = Field(default=None, ge=0)
    package_duration: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


@router.post("", status_code=201)
async def create_booking(
    body: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        result = await create_booking_with_fee(
            db, caller_id=user.id, service_id=body.service_id, date=body.date,
            time_str=body.time, package_name=body.package_name,
            package_price=body.package_price,
            package_duration=body.package_duration, notes=body.notes)
        # Provayderə bildiriş (notify_provider_on_new_booking trigger portu)
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " select provider_id, 'new_booking', 'Yeni sifariş',"
                "        'Yeni birbaşa sifariş aldınız', id::text"
                "   from bookings where id = cast(:b as uuid)"
            ),
            {"b": result["booking_id"]},
        )
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    return result


@router.get("/mine")
async def my_bookings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, service_id, provider_id, date, time, status,"
            "       total_amount, package_name, package_price, package_duration,"
            "       notes, fee_paid, created_at"
            "  from bookings where customer_id = :u order by created_at desc"
        ),
        {"u": user.id},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{booking_id}/cancel")
async def cancel_booking(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    row = (
        await db.execute(
            text(
                "update bookings set status='cancelled', updated_at=now()"
                " where id=:id and customer_id=:u"
                "   and status in ('pending','confirmed')"
                " returning id, provider_id"
            ),
            {"id": booking_id, "u": user.id},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=409,
            detail="Sifariş tapılmadı və ya bu mərhələdə ləğv edilə bilməz")
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:p, 'booking_cancelled', 'Sifariş ləğv edildi',"
            " 'Müştəri birbaşa sifarişi ləğv etdi', :r)"
        ),
        {"p": row.provider_id, "r": str(booking_id)},
    )
    await db.commit()
    return {"ok": True}
