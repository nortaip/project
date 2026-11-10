"""Birbaşa xidmət sifarişləri (bookings) — 1 ₼ komissiya ilə yaradılma,
siyahılar (müştəri / provayder), təsdiq, tamamlama və ləğv.

Supabase create_booking_with_fee RPC-nin API qarşılığı. Bildirişlər
notify_provider_on_new_booking / notify_on_booking_status_change
trigger-lərinin portudur: tranzaksiya daxilində insert, commit-dən sonra
push + WS dispatch.
"""
from __future__ import annotations

import uuid
from datetime import date as date_cls
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services import marketplace
from app.services.money import MoneyError
from app.services.notify import Notice, dispatch_all, insert_notice

router = APIRouter(prefix="/bookings", tags=["bookings"])

# notify_on_booking_status_change trigger-inin mətnləri (type = booking_<status>)
_STATUS_TEXT: dict[str, tuple[str, str]] = {
    "confirmed": ("Sifariş qəbul edildi", "Provayder sifarişinizi qəbul etdi."),
    "completed": ("Sifariş tamamlandı",
                  "Sifariş uğurla tamamlandı — rəy bildirə bilərsiniz."),
    "cancelled": ("Sifariş ləğv edildi", "Bu sifariş ləğv edildi."),
}


class BookingCreate(BaseModel):
    service_id: int
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(min_length=1, max_length=16)
    package_name: str | None = Field(default=None, max_length=200)
    package_price: Decimal | None = Field(default=None, ge=0)
    package_duration: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=2000)


async def _status_notice(
    db: AsyncSession, *, user_id, booking_id, status: str,
) -> Notice:
    title, body = _STATUS_TEXT[status]
    return await insert_notice(
        db, user_id=user_id, ntype=f"booking_{status}", title=title, body=body,
        related_id=str(booking_id))


@router.post("", status_code=201)
async def create_booking(
    body: BookingCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    # asyncpg `cast(:d as date)` parametri üçün mətn yox, date obyekti tələb
    # edir (mətn göndəriləndə DataError verir) — ona görə burada çevrilir.
    try:
        booking_date = date_cls.fromisoformat(body.date)
    except ValueError as e:
        raise HTTPException(status_code=422, detail="Tarix yanlışdır") from e
    try:
        # 1 ₼ komissiya + sifariş + xidmətin provayderinə bildiriş
        # (create_booking_with_fee RPC ilə eyni ortaq servis)
        result, notices = await marketplace.create_booking(
            db, caller_id=user.id, service_id=body.service_id, date=booking_date,
            time_str=body.time, package_name=body.package_name,
            package_price=body.package_price,
            package_duration=body.package_duration, notes=body.notes)
        await db.commit()
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    dispatch_all(notices)
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


@router.get("/incoming")
async def incoming_bookings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    status: str | None = Query(
        default=None, pattern="^(pending|confirmed|completed|cancelled)$"),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    """Provayderin xidmətlərinə gələn birbaşa sifarişlər."""
    sql = (
        "select b.id, b.service_id, s.title as service_title, b.customer_id,"
        "       c.name as customer_name, c.avatar_url as customer_avatar,"
        "       b.date, b.time, b.status, b.total_amount, b.package_name,"
        "       b.package_price, b.package_duration, b.notes, b.created_at"
        "  from bookings b"
        "  left join services s on s.id = b.service_id"
        "  left join profiles c on c.id = b.customer_id"
        " where b.provider_id = :u"
    )
    params: dict = {"u": user.id, "l": limit, "o": offset}
    if status:
        sql += " and b.status = :st"
        params["st"] = status
    rows = await db.execute(
        text(sql + " order by b.created_at desc limit :l offset :o"), params)
    return [dict(r._mapping) for r in rows]


async def _provider_transition(
    db: AsyncSession, *, booking_id: uuid.UUID, user: User,
    from_status: str, to_status: str,
) -> dict:
    """Provayder tərəfi status keçidi (pending→confirmed, confirmed→completed).

    Yalnız sifariş olunan xidmətin provayderi (bookings.provider_id —
    yaradılanda services.provider_id-dən götürülür) dəyişə bilər.
    """
    bk = (
        await db.execute(
            text("select id, customer_id, provider_id, status from bookings"
                 " where id = :id for update"),
            {"id": booking_id},
        )
    ).first()
    if bk is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    if bk.provider_id != user.id:
        raise HTTPException(
            status_code=403,
            detail="Yalnız xidmətin provayderi bu əməliyyatı edə bilər")
    if bk.status != from_status:
        raise HTTPException(
            status_code=409,
            detail=f"'{bk.status}' statuslu sifariş üçün bu əməliyyat mümkün deyil")
    await db.execute(
        text("update bookings set status = :st, updated_at = now() where id = :id"),
        {"st": to_status, "id": booking_id},
    )
    notices: list[Notice] = []
    if bk.customer_id is not None and bk.customer_id != user.id:
        notices.append(await _status_notice(
            db, user_id=bk.customer_id, booking_id=booking_id, status=to_status))
    await db.commit()
    dispatch_all(notices)
    return {"ok": True, "status": to_status}


@router.post("/{booking_id}/confirm")
async def confirm_booking(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Provayder sifarişi qəbul edir (pending → confirmed)."""
    return await _provider_transition(
        db, booking_id=booking_id, user=user,
        from_status="pending", to_status="confirmed")


@router.post("/{booking_id}/complete")
async def complete_booking(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Provayder sifarişi tamamlayır (confirmed → completed)."""
    return await _provider_transition(
        db, booking_id=booking_id, user=user,
        from_status="confirmed", to_status="completed")


@router.post("/{booking_id}/cancel")
async def cancel_booking(
    booking_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Ləğv — müştəri və ya xidmətin provayderi; qarşı tərəfə bildiriş."""
    row = (
        await db.execute(
            text(
                "update bookings set status='cancelled', updated_at=now()"
                " where id=:id and (customer_id=:u or provider_id=:u)"
                "   and status in ('pending','confirmed')"
                " returning id, customer_id, provider_id"
            ),
            {"id": booking_id, "u": user.id},
        )
    ).first()
    if row is None:
        raise HTTPException(
            status_code=409,
            detail="Sifariş tapılmadı və ya bu mərhələdə ləğv edilə bilməz")
    peer = row.provider_id if user.id == row.customer_id else row.customer_id
    notices: list[Notice] = []
    if peer is not None and peer != user.id:
        notices.append(await _status_notice(
            db, user_id=peer, booking_id=booking_id, status="cancelled"))
    await db.commit()
    dispatch_all(notices)
    return {"ok": True}
