"""Briqadalar (komandalar) — üzvlük, müraciət, dəvət, təyinat, pul axını.

Supabase RPC portları: brigade_place_offer, brigade_dispatch_order (burada),
qalan briqada RPC-ləri app/services/brigade.py-dədir.
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
from app.services import brigade as svc
from app.services.brigade import BrigadeError
from app.services.notify import dispatch
from app.services.realtime import publish

router = APIRouter(prefix="/brigades", tags=["brigades"])


def _http_error(e: BrigadeError) -> HTTPException:
    """BrigadeError → uyğun HTTP status (mesaj mətninə əsasən)."""
    msg = str(e)
    if "tapılmadı" in msg:
        return HTTPException(status_code=404, detail=msg)
    if msg.startswith("Yalnız") or "İcazə yoxdur" in msg:
        return HTTPException(status_code=403, detail=msg)
    return HTTPException(status_code=409, detail=msg)


async def _commit_and_notify(db: AsyncSession, result: dict) -> dict:
    """Commit + toplanmış bildirişləri (push/WS) commit-dən SONRA göndər."""
    notices = result.pop("_notices", [])
    await db.commit()
    for uid, title, body, data in notices:
        dispatch(uid, title, body, data)
    return result


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


# ════════════════ Müraciətlər (apply_for_brigade / cancel) ════════════════


class ApplyIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    categories: list[str] = Field(default_factory=list, max_length=20)
    contact_phone: str | None = Field(default=None, max_length=32)
    contact_email: str | None = Field(default=None, max_length=320)
    address: str | None = Field(default=None, max_length=500)
    logo_url: str | None = Field(default=None, max_length=1000)


@router.post("/applications", status_code=201)
async def apply(
    body: ApplyIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Briqada yaratmaq üçün müraciət (apply_for_brigade portu)."""
    try:
        result = await svc.apply_for_brigade(
            db, caller_id=user.id, name=body.name, description=body.description,
            categories=body.categories, contact_phone=body.contact_phone,
            contact_email=body.contact_email, address=body.address,
            logo_url=body.logo_url)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


@router.post("/applications/{application_id}/cancel")
async def cancel_application(
    application_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Öz pending müraciətini ləğv et (cancel_brigade_application portu)."""
    try:
        result = await svc.cancel_brigade_application(
            db, caller_id=user.id, application_id=application_id)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


# ════════════════ Dəvətlər (invite / lookup / accept / decline) ═══════════


class InviteIn(BaseModel):
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    intended_role: str = Field(default="member", pattern="^(member|dispatcher)$")
    commission_pct: Decimal | None = Field(default=None, ge=0, le=100)


@router.post("/{brigade_id}/invites", status_code=201)
async def create_invite(
    brigade_id: uuid.UUID,
    body: InviteIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Üzvlük dəvəti (+ _brigade_invite_notify trigger-inin portu)."""
    try:
        result = await svc.create_brigade_invite(
            db, caller_id=user.id, brigade_id=brigade_id, email=body.email,
            phone=body.phone, intended_role=body.intended_role,
            commission_pct=body.commission_pct)
        return await _commit_and_notify(db, result)
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e


@router.get("/invites/pending")
async def my_pending_invites(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Mənə gələn pending dəvətlər (my_pending_brigade_invites portu)."""
    return await svc.my_pending_brigade_invites(db, caller_id=user.id)


@router.get("/invites/{token}")
async def lookup_invite(
    token: uuid.UUID, db: AsyncSession = Depends(get_db)
) -> dict:
    """Dəvətin təfərrüatı — magic link səhifəsi üçün (lookup_brigade_invite)."""
    result = await svc.lookup_brigade_invite(db, token=token)
    if result is None:
        raise HTTPException(status_code=404, detail="Dəvət tapılmadı")
    return result


@router.post("/invites/{token}/accept")
async def accept_invite(
    token: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dəvəti qəbul et — üzvlüyə qoşul (accept_brigade_invite portu)."""
    try:
        result = await svc.accept_brigade_invite(
            db, caller_id=user.id, token=token)
        return await _commit_and_notify(db, result)
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e


@router.post("/invites/{token}/decline")
async def decline_invite(
    token: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dəvəti rədd et (decline_brigade_invite portu)."""
    try:
        result = await svc.decline_brigade_invite(
            db, caller_id=user.id, token=token)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


# ════════════════ Rol / işçi seçimi ═══════════════════════════════════════


@router.get("/{brigade_id}/role")
async def my_role(
    brigade_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Çağıranın bu briqadadakı rolu (brigade_role + is_brigade_dispatcher)."""
    role = await svc.brigade_role(db, brigade_id, user.id)
    return {"role": role, "is_dispatcher": role in ("owner", "dispatcher")}


@router.get("/{brigade_id}/pick-worker")
async def pick_worker(
    brigade_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """İlk online işçini seç (brigade_pick_worker portu)."""
    if not await svc.is_brigade_dispatcher(db, brigade_id, user.id):
        raise HTTPException(status_code=403,
                            detail="Yalnız sahib/dispatcher işçi seçə bilər")
    member_id = await svc.brigade_pick_worker(db, brigade_id)
    return {"member_id": str(member_id) if member_id else None}


# ════════════════ Təyinatlar (assign / dispatch-assign / cavablar) ════════


class AssignOrderIn(BaseModel):
    source_type: str = Field(default="opportunity", min_length=1, max_length=32)
    source_id: str = Field(min_length=1, max_length=64)
    member_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    notes: str | None = Field(default=None, max_length=500)
    priority: int = Field(default=5, ge=1, le=10)


@router.post("/{brigade_id}/assign")
async def assign_order(
    brigade_id: uuid.UUID,
    body: AssignOrderIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Sifarişi üzv(lər)ə təyin et (brigade_assign_order portu)."""
    try:
        result = await svc.brigade_assign_order(
            db, caller_id=user.id, brigade_id=brigade_id,
            source_type=body.source_type, source_id=body.source_id,
            member_ids=body.member_ids, notes=body.notes,
            priority=body.priority)
        return await _commit_and_notify(db, result)
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e


class DispatchAssignIn(BaseModel):
    opportunity_id: uuid.UUID
    member_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=Decimal("999999"))
    notes: str | None = Field(default=None, max_length=1000)


@router.post("/{brigade_id}/dispatch-assign")
async def dispatch_assign(
    brigade_id: uuid.UUID,
    body: DispatchAssignIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Sifarişi konkret işçiyə yönləndir — işçi adından təklif + təyinat
    (brigade_dispatch_assign portu, re-route + 10s cooldown daxil)."""
    try:
        result = await svc.brigade_dispatch_assign(
            db, caller_id=user.id, brigade_id=brigade_id,
            opportunity_id=body.opportunity_id, member_id=body.member_id,
            amount=body.amount, notes=body.notes)
        return await _commit_and_notify(db, result)
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e


class RespondIn(BaseModel):
    action: str = Field(pattern="^(accept|decline)$")


@router.post("/assignments/{assignment_id}/respond")
async def assignment_respond(
    assignment_id: uuid.UUID,
    body: RespondIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Üzv təyinatı qəbul/rədd edir (brigade_assignment_respond portu)."""
    try:
        result = await svc.brigade_assignment_respond(
            db, caller_id=user.id, assignment_id=assignment_id,
            action=body.action)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


@router.post("/assignments/{assignment_id}/start")
async def assignment_start(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """İşə başla (brigade_assignment_start portu)."""
    try:
        result = await svc.brigade_assignment_start(
            db, caller_id=user.id, assignment_id=assignment_id)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


@router.post("/assignments/{assignment_id}/complete")
async def assignment_complete(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Təyinatı tamamla — üzv və ya dispatcher (brigade_assignment_complete)."""
    try:
        result = await svc.brigade_assignment_complete(
            db, caller_id=user.id, assignment_id=assignment_id)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


@router.post("/assignments/{assignment_id}/claim")
async def assignment_claim(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """“İlk qəbul edən qazanır” — offer-i götür (claim_opportunity portu)."""
    try:
        result = await svc.claim_opportunity(
            db, caller_id=user.id, assignment_id=assignment_id)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


@router.post("/assignments/{assignment_id}/decline")
async def assignment_decline(
    assignment_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Təklif olunan işi rədd et (decline_offer portu)."""
    try:
        result = await svc.decline_offer(
            db, caller_id=user.id, assignment_id=assignment_id)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


# ════════════════ Pul axınları (top-up / bölgü) ═══════════════════════════


class TopUpIn(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("999999"))


@router.post("/{brigade_id}/top-up")
async def top_up(
    brigade_id: uuid.UUID,
    body: TopUpIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Sahibin şəxsi balansından briqadaya köçürmə (brigade_top_up_from_owner)."""
    try:
        result = await svc.brigade_top_up_from_owner(
            db, caller_id=user.id, brigade_id=brigade_id, amount=body.amount)
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result


class AllocationItem(BaseModel):
    profile_id: uuid.UUID
    amount: Decimal = Field(gt=0, le=Decimal("999999"))


class DistributeIn(BaseModel):
    allocations: list[AllocationItem] = Field(min_length=1, max_length=100)


@router.post("/{brigade_id}/distribute")
async def distribute(
    brigade_id: uuid.UUID,
    body: DistributeIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Briqada balansını üzvlərə payla (brigade_distribute_balance portu)."""
    try:
        result = await svc.brigade_distribute_balance(
            db, caller_id=user.id, brigade_id=brigade_id,
            allocations=[{"profile_id": a.profile_id, "amount": a.amount}
                         for a in body.allocations])
        await db.commit()
    except BrigadeError as e:
        await db.rollback()
        raise _http_error(e) from e
    return result
