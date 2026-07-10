"""Briqadalar (komandalar) — üzvlük, komanda təklifi, işçi təyini.

Supabase RPC portları: brigade_place_offer, brigade_dispatch_order.
"""
from __future__ import annotations

import uuid
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.services.realtime import publish

router = APIRouter(prefix="/brigades", tags=["brigades"])


class BrigadeOfferIn(BaseModel):
    opportunity_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=Decimal("999999"))
    notes: str | None = Field(default=None, max_length=1000)


class DispatchIn(BaseModel):
    source_id: str = Field(min_length=1, max_length=64)
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    priority: int = Field(default=5, ge=1, le=10)
    notes: str | None = Field(default=None, max_length=500)


async def _member_role(db: AsyncSession, brigade_id: uuid.UUID, user_id: uuid.UUID) -> str | None:
    row = (
        await db.execute(
            text(
                "select role from brigade_members"
                " where brigade_id=:b and profile_id=:u and is_active"
            ),
            {"b": brigade_id, "u": user_id},
        )
    ).first()
    return row.role if row else None


@router.get("/my")
async def my_brigade(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    row = (
        await db.execute(
            text(
                "select b.id, b.name, b.logo_url, b.balance, b.rating,"
                "       b.is_verified, b.categories, m.role as my_role"
                "  from brigade_members m join brigades b on b.id = m.brigade_id"
                " where m.profile_id = :u and m.is_active limit 1"
            ),
            {"u": user.id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Komandada deyilsiniz")
    d = dict(row._mapping)
    if d["my_role"] not in ("owner", "dispatcher"):
        d.pop("balance", None)  # balans yalnız idarəçilərə görünür
    return d


@router.get("/{brigade_id}")
async def brigade_public(brigade_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    row = (
        await db.execute(
            text(
                "select id, name, description, logo_url, rating, is_verified,"
                "       categories, total_orders, created_at"
                " from brigades where id = :id and is_active"
            ),
            {"id": brigade_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Komanda tapılmadı")
    return dict(row._mapping)


@router.get("/{brigade_id}/members")
async def members(
    brigade_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    if await _member_role(db, brigade_id, user.id) is None:
        raise HTTPException(status_code=403, detail="Komanda üzvü deyilsiniz")
    rows = await db.execute(
        text(
            "select m.id, m.profile_id, m.role, m.is_online, m.joined_at,"
            "       p.name, p.avatar_url"
            "  from brigade_members m join profiles p on p.id = m.profile_id"
            " where m.brigade_id = :b and m.is_active order by m.joined_at"
        ),
        {"b": brigade_id},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{brigade_id}/offers", status_code=201)
async def place_brigade_offer(
    brigade_id: uuid.UUID,
    body: BrigadeOfferIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Komanda adından təklif (brigade_place_offer portu)."""
    role = await _member_role(db, brigade_id, user.id)
    if role not in ("owner", "dispatcher"):
        raise HTTPException(status_code=403, detail="Yalnız sahib/dispatcher təklif verə bilər")

    # Komissiya üçün komanda balansı kifayətdirmi (nağd ssenarisi üçün tələb)
    pct_row = (
        await db.execute(
            text(
                "select coalesce((select (value #>> '{}')::numeric from platform_config"
                "  where key='brigade_commission_on_accept'),"
                " (select (value #>> '{}')::numeric from platform_config"
                "  where key='commission_on_accept'), 0) as pct"
            )
        )
    ).first()
    commission = (body.amount * Decimal(pct_row.pct) / 100).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP)
    brig = (
        await db.execute(
            text("select coalesce(balance,0) as b, name from brigades where id=:id"),
            {"id": brigade_id},
        )
    ).first()
    if brig is None:
        raise HTTPException(status_code=404, detail="Komanda tapılmadı")
    if Decimal(brig.b) < commission:
        raise HTTPException(
            status_code=409,
            detail=f"NO_BALANCE: komanda balansında minimum {commission} ₼ olmalıdır",
        )

    opp = (
        await db.execute(
            text("select id, status, created_by from opportunities where id=:id"),
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
                " where opportunity_id=:opp and brigade_id=:b and status='pending'"
            ),
            {"opp": body.opportunity_id, "b": brigade_id},
        )
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail="Komanda artıq təklif verib")

    row = (
        await db.execute(
            text(
                "insert into opportunities_offers"
                " (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)"
                " values (:opp, :u, :b, :a, 'pending', :n) returning id"
            ),
            {"opp": body.opportunity_id, "u": user.id, "b": brigade_id,
             "a": body.amount, "n": body.notes},
        )
    ).first()
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, 'new_offer', 'Yeni komanda təklifi 📨', :b, :r)"
        ),
        {"u": opp.created_by,
         "b": f"{brig.name} komandası {body.amount} ₼ təklif etdi",
         "r": str(body.opportunity_id)},
    )
    await db.commit()
    await publish(opp.created_by, "offer.new", {
        "opportunity_id": str(body.opportunity_id), "offer_id": str(row.id),
        "amount": str(body.amount), "brigade_name": brig.name})
    return {"id": str(row.id), "required_balance": str(commission)}


@router.post("/{brigade_id}/dispatch")
async def dispatch(
    brigade_id: uuid.UUID,
    body: DispatchIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """İşçi(lər)i sifarişə təyin et (brigade_dispatch_order portu)."""
    role = await _member_role(db, brigade_id, user.id)
    if role not in ("owner", "dispatcher"):
        raise HTTPException(status_code=403, detail="Yalnız sahib/dispatcher təyin edə bilər")

    inserted = 0
    for member_id in body.member_ids:
        ok = (
            await db.execute(
                text(
                    "insert into brigade_assignments"
                    " (brigade_id, member_id, source_type, source_id, assigned_by,"
                    "  status, notes, priority)"
                    " values (:b, :m, 'opportunity', :s, :u, 'assigned', :n, :p)"
                    " on conflict (brigade_id, source_id, member_id) do nothing"
                    " returning id"
                ),
                {"b": brigade_id, "m": member_id, "s": body.source_id,
                 "u": user.id, "n": body.notes, "p": body.priority},
            )
        ).first()
        if ok:
            inserted += 1
            member = (
                await db.execute(
                    text("select profile_id from brigade_members where id=:id"),
                    {"id": member_id},
                )
            ).first()
            if member:
                await db.execute(
                    text(
                        "insert into notifications (user_id, type, title, body, related_id)"
                        " values (:u, 'assignment', 'Yeni tapşırıq 🔧',"
                        " 'Sizə yeni iş təyin olundu', :r)"
                    ),
                    {"u": member.profile_id, "r": body.source_id},
                )
                await publish(member.profile_id, "assignment.new",
                              {"source_id": body.source_id, "brigade_id": str(brigade_id)})
    await db.commit()
    return {"ok": True, "inserted": inserted}
