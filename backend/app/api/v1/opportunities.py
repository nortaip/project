"""Sifarişlər (opportunities) — yaratma, siyahı, detal, ləğv."""
from __future__ import annotations

import json
import logging
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
from app.services import marketplace
from app.services.brigade import auto_broadcast_opportunity
from app.services.lifecycle import (
    InvalidTransition, refresh_provider_rating, set_opportunity_status,
)
from app.services.marketplace import OpError
from app.services.notify import (
    broadcast_new_opportunity, dispatch, dispatch_all, insert_notification,
)

log = logging.getLogger("opportunities")

router = APIRouter(prefix="/opportunities", tags=["opportunities"])

_OPEN_STATUSES = ("pending", "open", "new", "active")


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
    # Uyğun provayderlərə bildiriş (notify_providers_on_new_opportunity portu)
    notified = await broadcast_new_opportunity(
        db, opp_id=row.id, title=body.title,
        body=body.description or body.location or "Detallara baxın",
        category_id=body.category_id, subcategory_id=body.subcategory_id,
        created_by=user.id)
    # Briqada üzvlərinə avtomatik yayım (tg_opportunity_auto_broadcast trigger
    # portu). SAVEPOINT daxilindədir: yayım xətası yalnız yayımı geri qaytarır,
    # sifarişin yaranmasını bloklamır (SQL: exception when others then null).
    brigade_notices: list = []
    try:
        async with db.begin_nested():
            brigade_notices = await auto_broadcast_opportunity(db, row.id)
    except Exception as e:  # noqa: BLE001
        brigade_notices = []
        log.warning("auto_broadcast_opportunity xəta (opp %s): %s", row.id, e)
    await db.commit()
    for uid in notified[:200]:
        dispatch(uid, f"Yeni sifariş: {body.title}",
                 body.description or "Detallara baxın",
                 {"type": "new_opportunity", "related_id": str(row.id)})
    for uid, n_title, n_body, n_data in brigade_notices:
        dispatch(uid, n_title, n_body, n_data)
    return {"id": str(row.id), "status": "pending"}


class StatusIn(BaseModel):
    status: str = Field(
        pattern="^(i-am-here|ongoing|pending_review|completed|cancelled)$")


@router.post("/{opportunity_id}/status")
async def change_status(
    opportunity_id: uuid.UUID,
    body: StatusIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Provayderin iş axını statusları (yola düşdüm → ünvandayam → iş gedir
    → təsdiqə göndər). Keçid matrisi ilə qorunur."""
    opp = (
        await db.execute(
            text("select created_by, provider_id, status from opportunities"
                 " where id=:id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    is_admin = user.role in ("admin", "master", "superadmin")
    if user.id not in (opp.created_by, opp.provider_id) and not is_admin:
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    # completed yalnız müştəri/admin üçün (release endpointi ayrıca)
    if body.status == "completed" and user.id == opp.provider_id and not is_admin:
        raise HTTPException(
            status_code=403, detail="Tamamlamanı müştəri təsdiqləyir")
    try:
        old = await set_opportunity_status(
            db, opp_id=opportunity_id, new_status=body.status,
            actor_id=user.id, actor_role=user.role)
    except InvalidTransition as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e
    # Qarşı tərəfə bildiriş
    peer = opp.created_by if user.id == opp.provider_id else opp.provider_id
    nid = None
    if peer:
        titles = {
            "i-am-here": ("Provayder ünvanda", "Provayder ünvana çatıb."),
            "ongoing": ("İş başladı", "Sifariş üzərində iş başlandı."),
            "pending_review": ("İş təsdiqə göndərildi",
                               "İş bitdi — admin təsdiqi gözlənilir."),
            "completed": ("İş tamamlandı", "Sifariş uğurla başa çatdı."),
            "cancelled": ("Sifariş ləğv edildi", "Bu sifariş ləğv edildi."),
        }
        ti, b = titles[body.status]
        nid = await insert_notification(
            db, user_id=peer, ntype=f"status_{body.status}", title=ti, body=b,
            related_id=str(opportunity_id))
    await db.commit()
    if peer and nid:
        dispatch(peer, titles[body.status][0], titles[body.status][1],
                 {"type": "status_changed", "related_id": str(opportunity_id)})
    return {"ok": True, "from": old, "to": body.status}


class ReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=2000)


@router.post("/{opportunity_id}/review", status_code=201)
async def leave_review(
    opportunity_id: uuid.UUID,
    body: ReviewIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Müştəri rəyi + provayder reytinqinin yenilənməsi
    (_refresh_provider_rating trigger portu)."""
    opp = (
        await db.execute(
            text("select created_by, provider_id, accepted_offer_id, status"
                 " from opportunities where id=:id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise HTTPException(status_code=404, detail="Sifariş tapılmadı")
    if opp.created_by != user.id:
        raise HTTPException(status_code=403, detail="Yalnız sifariş sahibi rəy yaza bilər")
    if opp.provider_id is None or opp.accepted_offer_id is None:
        raise HTTPException(status_code=409, detail="Qəbul edilmiş təklif yoxdur")
    dup = (
        await db.execute(
            text("select 1 from provider_reviews where offer_id=:o"),
            {"o": opp.accepted_offer_id},
        )
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail="Bu sifarişə artıq rəy yazmısınız")
    await db.execute(
        text("insert into provider_reviews (provider_id, offer_id, rating, comment)"
             " values (:p, :o, :r, :c)"),
        {"p": opp.provider_id, "o": opp.accepted_offer_id, "r": body.rating,
         "c": body.comment},
    )
    await refresh_provider_rating(db, opp.provider_id)
    nid = await insert_notification(
        db, user_id=opp.provider_id, ntype="new_review",
        title="Yeni rəy aldınız ⭐", body=f"Müştəri {body.rating}/5 qiymət verdi",
        related_id=str(opportunity_id))
    await db.commit()
    dispatch(opp.provider_id, "Yeni rəy aldınız ⭐",
             f"Müştəri {body.rating}/5 qiymət verdi",
             {"type": "new_review", "related_id": str(opportunity_id),
              "notif_id": nid})
    return {"ok": True}


@router.get("/mine")
async def my_opportunities(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
) -> list[dict]:
    rows = await db.execute(
        text(
            "select o.id, o.title, o.status, o.date, o.location, o.budget,"
            " o.category_id, o.accepted_offer_id, o.created_at,"
            " count(oo.id) as offer_count"
            " from opportunities o"
            " left join opportunities_offers oo on oo.opportunity_id = o.id"
            " where o.created_by = :u group by o.id"
            " order by o.created_at desc limit :l offset :o"
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
    """Ləğv + kart ödənişində avtomatik refund (cancel RPC portu).

    Məntiq ortaq servisdədir (cancel_opportunity RPC ilə eyni kod). REST yolu
    tarixən geri qaytarmanı çağırana yazır — pul davranışı toxunulmadan
    saxlanıb (refund_to_caller=True)."""
    try:
        res = await marketplace.cancel_opportunity(
            db, opportunity_id=opportunity_id, caller_id=user.id,
            is_admin=user.role in ("admin", "superadmin"), reason=body.reason,
            refund_to_caller=True)
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    dispatch_all(res["notices"])
    return {"ok": True, "refunded": str(res["refunded"])}
