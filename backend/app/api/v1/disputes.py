"""Mübahisələr (disputes) — açılış, sübut əlavəsi, admin həlli, siyahılar.

open_dispute / add_dispute_evidence / resolve_dispute RPC-lərinin portu.
Pul hərəkəti resolve zamanı app.services.money-dəki refund_offer /
release_offer funksiyaları ilə aparılır (SQL-dəki refund_offer_payment /
release_offer_to_provider ekvivalentləri) — yenidən yazılmır.

Bildirişlər Supabase-dəki notify_on_dispute_opened /
notify_on_dispute_resolved trigger-lərinin portudur: tranzaksiya daxilində
insert, commit-dən sonra push + WS dispatch.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.services.money import MoneyError, refund_offer, release_offer
from app.services.notify import dispatch, insert_notification

router = APIRouter(prefix="/disputes", tags=["disputes"])

_ADMIN = require_roles("admin", "master", "superadmin")

# Şikayət pəncərəsi — iş tamamlandıqdan sonra bu qədər saat ərzində
DISPUTE_WINDOW_HOURS = 24


class DisputeOpenIn(BaseModel):
    opportunity_id: uuid.UUID
    reason: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=3000)


class EvidenceIn(BaseModel):
    file_path: str = Field(min_length=1, max_length=1000)
    file_type: str = Field(min_length=1, max_length=64)
    size_bytes: int | None = Field(default=None, ge=0)


class ResolveIn(BaseModel):
    resolution: str = Field(pattern="^(customer|provider)$")
    notes: str | None = Field(default=None, max_length=2000)


@router.post("", status_code=201)
async def open_dispute(
    body: DisputeOpenIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Tamamlanmış sifariş üzrə şikayət açılışı (open_dispute portu)."""
    opp = (
        await db.execute(
            text(
                "select id, status, created_by, provider_id,"
                "       extract(epoch from (now() - coalesce(completed_at, updated_at)))"
                "         / 3600.0 as hours_passed"
                "  from opportunities where id = :id for update"
            ),
            {"id": body.opportunity_id},
        )
    ).first()
    if opp is None:
        raise HTTPException(status_code=404, detail="OPPORTUNITY_NOT_FOUND: sifariş tapılmadı")

    # Yalnız completed statusunda şikayət olur
    if opp.status != "completed":
        raise HTTPException(
            status_code=409,
            detail=f"OPPORTUNITY_NOT_COMPLETED: cari status {opp.status}")

    # 24 saat pəncərəsi
    hours_passed = float(opp.hours_passed or 0)
    if hours_passed > DISPUTE_WINDOW_HOURS:
        raise HTTPException(
            status_code=409,
            detail=f"DISPUTE_WINDOW_EXPIRED: {round(hours_passed, 1)} saat keçib")

    # Çağıran ya müştəri, ya provayder olmalıdır
    if user.id not in (opp.created_by, opp.provider_id):
        raise HTTPException(status_code=403, detail="NOT_AUTHORIZED: tərəf deyilsiniz")

    # Qarşı tərəfi təyin et
    against = opp.provider_id if user.id == opp.created_by else opp.created_by
    if against is None:
        raise HTTPException(status_code=409, detail="NO_COUNTERPARTY: qarşı tərəf yoxdur")

    # Qəbul edilmiş (və ya refund olunmuş) təklif
    offer = (
        await db.execute(
            text(
                "select id from opportunities_offers"
                " where opportunity_id = :opp and status in ('accepted', 'refunded')"
                " order by created_at desc limit 1"
            ),
            {"opp": body.opportunity_id},
        )
    ).first()
    if offer is None:
        raise HTTPException(status_code=409, detail="NO_ACCEPTED_OFFER: qəbul edilmiş təklif yoxdur")

    # Mövcud aktiv şikayət?
    existing = (
        await db.execute(
            text(
                "select 1 from disputes where opportunity_id = :opp"
                " and status in ('open', 'under_review')"
            ),
            {"opp": body.opportunity_id},
        )
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="DISPUTE_ALREADY_OPEN: aktiv şikayət var")

    row = (
        await db.execute(
            text(
                "insert into disputes (opportunity_id, offer_id, raised_by,"
                " against_user, reason, description, status)"
                " values (:opp, :off, :u, :ag, :r, :d, 'open') returning id"
            ),
            {"opp": body.opportunity_id, "off": offer.id, "u": user.id,
             "ag": against, "r": body.reason, "d": body.description},
        )
    ).first()

    # Sifariş statusu → disputed
    await db.execute(
        text("update opportunities set status='disputed' where id=:id"),
        {"id": body.opportunity_id},
    )

    # notify_on_dispute_opened trigger-inin portu — qarşı tərəfə bildiriş
    n_title = "Sizin barənizdə şikayət açıldı"
    n_body = f"Sifariş #{str(body.opportunity_id)[:8]} üçün şikayət baxılır."
    await insert_notification(
        db, user_id=against, ntype="dispute_opened",
        title=n_title, body=n_body, related_id=str(body.opportunity_id),
    )
    await db.commit()
    dispatch(against, n_title, n_body, {
        "type": "dispute_opened", "dispute_id": str(row.id),
        "opportunity_id": str(body.opportunity_id)})
    return {
        "ok": True,
        "dispute_id": str(row.id),
        "opportunity_id": str(body.opportunity_id),
    }


@router.post("/{dispute_id}/evidence", status_code=201)
async def add_evidence(
    dispute_id: uuid.UUID,
    body: EvidenceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Şikayətə sübut faylı əlavəsi (add_dispute_evidence portu)."""
    d = (
        await db.execute(
            text("select id, raised_by, against_user, status from disputes where id = :id"),
            {"id": dispute_id},
        )
    ).first()
    if d is None:
        raise HTTPException(status_code=404, detail="DISPUTE_NOT_FOUND: şikayət tapılmadı")
    # Yalnız tərəflər sübut əlavə edə bilər
    if user.id not in (d.raised_by, d.against_user):
        raise HTTPException(status_code=403, detail="NOT_AUTHORIZED: tərəf deyilsiniz")
    if d.status not in ("open", "under_review"):
        raise HTTPException(status_code=409, detail="DISPUTE_CLOSED: şikayət bağlanıb")

    await db.execute(
        text(
            "insert into dispute_attachments (dispute_id, file_path, file_type,"
            " size_bytes, uploaded_by) values (:d, :p, :t, :s, :u)"
        ),
        {"d": dispute_id, "p": body.file_path, "t": body.file_type,
         "s": body.size_bytes, "u": user.id},
    )
    await db.execute(
        text("update disputes set updated_at = now() where id = :id"),
        {"id": dispute_id},
    )
    await db.commit()
    return {"ok": True}


@router.post("/{dispute_id}/resolve")
async def resolve(
    dispute_id: uuid.UUID,
    body: ResolveIn,
    admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin şikayəti həll edir (resolve_dispute portu).

    resolution='customer' → pul müştəriyə qaytarılır (refund_offer);
    resolution='provider' → escrow provayderə açılır (release_offer).
    """
    d = (
        await db.execute(
            text(
                "select id, opportunity_id, offer_id, raised_by, against_user,"
                " status from disputes where id = :id for update"
            ),
            {"id": dispute_id},
        )
    ).first()
    if d is None:
        raise HTTPException(status_code=404, detail="DISPUTE_NOT_FOUND: şikayət tapılmadı")
    if d.status not in ("open", "under_review"):
        raise HTTPException(status_code=409, detail="ALREADY_RESOLVED: şikayət artıq həll olunub")

    # ── Pul hərəkəti — money.py servis funksiyaları ilə (SQL RPC portları) ──
    try:
        if body.resolution == "customer":
            # SQL: refund_offer_payment(offer_id, 'DISPUTE_RESOLVED_CUSTOMER: ...')
            pay_result = await refund_offer(
                db, offer_id=d.offer_id, caller_id=admin.id,
                caller_role=admin.role,
                reason=f"DISPUTE_RESOLVED_CUSTOMER: {body.notes or ''}")
        else:
            # SQL: perform release_offer_to_provider(offer_id) — security definer
            # birbaşa icra edir. release_offer-in "yalnız müştəri" yoxlamasını
            # keçmək üçün müştəri adından çağırırıq; admin səlahiyyəti yuxarıda
            # yoxlanılıb, pul semantikası eynidir.
            opp = (
                await db.execute(
                    text("select created_by from opportunities where id = :id"),
                    {"id": d.opportunity_id},
                )
            ).first()
            await release_offer(
                db, offer_id=d.offer_id, caller_id=opp.created_by,
                caller_role="customer")
            # SQL: mark released + opportunity → completed
            await db.execute(
                text("update opportunities_offers set escrow_released_at = now()"
                     " where id = :id"),
                {"id": d.offer_id},
            )
            await db.execute(
                text("update opportunities set status='completed' where id=:id"),
                {"id": d.opportunity_id},
            )
            pay_result = {"ok": True, "released": True}
    except MoneyError as e:
        await db.rollback()
        raise HTTPException(status_code=409, detail=str(e)) from e

    new_status = (
        "resolved_customer" if body.resolution == "customer" else "resolved_provider"
    )
    await db.execute(
        text(
            "update disputes set status=:s, resolution_notes=:n,"
            " resolved_by=:a, resolved_at=now() where id=:id"
        ),
        {"s": new_status, "n": body.notes, "a": admin.id, "id": dispute_id},
    )

    # notify_on_dispute_resolved trigger-inin portu — hər iki tərəfə bildiriş
    if body.resolution == "customer":
        n_title = "Şikayət müştərinin lehinə həll olundu"
        n_body = "Pul müştərinin balansına qaytarıldı."
    else:
        n_title = "Şikayət provayderin lehinə həll olundu"
        n_body = "Pul provayderə ötürüldü."
    for party in (d.raised_by, d.against_user):
        await insert_notification(
            db, user_id=party, ntype="dispute_resolved",
            title=n_title, body=n_body, related_id=str(d.opportunity_id),
        )
    await db.commit()
    for party in (d.raised_by, d.against_user):
        dispatch(party, n_title, n_body, {
            "type": "dispute_resolved", "dispute_id": str(dispute_id),
            "resolution": body.resolution})
    return {"ok": True, "resolution": body.resolution, "payment_result": pay_result}


@router.get("/mine")
async def my_disputes(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
) -> list[dict]:
    """İstifadəçinin tərəf olduğu şikayətlər (açan və ya qarşı tərəf)."""
    rows = await db.execute(
        text(
            "select d.id, d.opportunity_id, d.offer_id, d.raised_by,"
            "       d.against_user, d.reason, d.description, d.status,"
            "       d.resolution_notes, d.resolved_at, d.created_at,"
            "       (select count(*) from dispute_attachments a"
            "         where a.dispute_id = d.id) as attachments_count"
            "  from disputes d"
            " where d.raised_by = :u or d.against_user = :u"
            " order by d.created_at desc limit :l"
        ),
        {"u": user.id, "l": min(limit, 100)},
    )
    return [dict(r._mapping) for r in rows]


@router.get("")
async def admin_list(
    status: str | None = None,
    _admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Admin üçün şikayət siyahısı — tərəflərin adları ilə."""
    rows = await db.execute(
        text(
            "select d.id, d.opportunity_id, d.offer_id, d.raised_by,"
            "       d.against_user, d.reason, d.description, d.status,"
            "       d.resolution_notes, d.resolved_by, d.resolved_at, d.created_at,"
            "       pr.name as raised_by_name, pa.name as against_name,"
            "       oo.offer_amount,"
            "       (select count(*) from dispute_attachments a"
            "         where a.dispute_id = d.id) as attachments_count"
            "  from disputes d"
            "  left join profiles pr on pr.id = d.raised_by"
            "  left join profiles pa on pa.id = d.against_user"
            "  left join opportunities_offers oo on oo.id = d.offer_id"
            " where (cast(:s as text) is null or :s = 'all' or d.status = :s)"
            " order by d.created_at desc limit :l offset :o"
        ),
        {"s": status, "l": min(limit, 200), "o": offset},
    )
    return [dict(r._mapping) for r in rows]
