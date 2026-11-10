"""Profillər — öz profilim, yeniləmə, ustanın public profili + rəylər.

Əlavə: istifadəçi blokları (block_user/unblock_user), provayder rolu
müraciəti axını (request/cancel/approve/reject), set_self_role və
set_member_online RPC-lərinin portları.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.core.cache import cached
from app.db.session import get_db
from app.models.user import User
from app.services import marketplace
from app.services.marketplace import OpError
from app.services.notify import dispatch, insert_notification

router = APIRouter(prefix="/profiles", tags=["profiles"])

_ADMIN_ROLES = ("admin", "master", "superadmin")
_ADMIN = require_roles(*_ADMIN_ROLES)

_ME_FIELDS = (
    "id, email, name, role, phone_number, address, avatar_url, balance,"
    " bonus_balance, is_verified, verification_status, is_online, rating,"
    " rating_count, latitude, longitude, created_at"
)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone_number: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)
    avatar_url: str | None = Field(default=None, max_length=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_online: bool | None = None


@router.get("/me")
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    row = (
        await db.execute(
            text(f"select {_ME_FIELDS} from profiles where id = :id"), {"id": user.id}
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profil tapılmadı")
    return dict(row._mapping)


@router.patch("/me")
async def update_me(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Dəyişiklik yoxdur")
    # Ağ siyahı — yalnız icazəli sahələr (balance/role və s. burada YOXDUR)
    sets = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = user.id
    await db.execute(
        text(f"update profiles set {sets}, updated_at = now() where id = :id"), updates
    )
    await db.commit()
    return {"ok": True}


@router.get("/online/providers")
async def online_providers(
    db: AsyncSession = Depends(get_db),
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float = 10,
    limit: int = 100,
) -> list[dict]:
    """Onlayn ustalar (xəritə üçün). lat/lng verilsə radius daxilində."""
    sql = (
        "select id, name, avatar_url, rating, latitude, longitude, last_seen_at"
        " from profiles where role='provider' and is_online"
        " and latitude is not null and longitude is not null"
    )
    params: dict = {"l": min(limit, 300)}
    if lat is not None and lng is not None:
        # Haversine (km) — indekssiz sadə variant, limitli nəticə üçün yetərli
        sql += (
            " and 6371 * acos(least(1, greatest(-1,"
            " cos(radians(:lat)) * cos(radians(latitude))"
            " * cos(radians(longitude) - radians(:lng))"
            " + sin(radians(:lat)) * sin(radians(latitude))))) <= :r"
        )
        params.update({"lat": lat, "lng": lng, "r": max(0.05, min(radius_km, 100))})
    async def load() -> list[dict]:
        rows = await db.execute(text(sql + " limit :l"), params)
        return [dict(r._mapping) for r in rows]

    # Koordinatı ~1km dəqiqliklə yuvarlaqlaşdır — keş açarı partlamasın
    if lat is not None and lng is not None:
        ck = f"online:{round(lat,2)}:{round(lng,2)}:{round(radius_km,1)}"
    else:
        ck = "online:all"
    return await cached(ck, 10, load)


@router.get("/{profile_id}")
async def public_profile(profile_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """Ustanın public profili — güvən məlumatları (balans/telefon YOXDUR)."""
    row = (
        await db.execute(
            text(
                "select id, name, role, avatar_url, is_verified, verification_status,"
                "       is_online, rating, rating_count, experience_years, specialties,"
                "       created_at,"
                "  (select count(*) from opportunities_offers oo"
                "    where oo.provider_id = profiles.id and oo.status='completed') as completed_jobs"
                " from profiles where id = :id"
            ),
            {"id": profile_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profil tapılmadı")
    return dict(row._mapping)


@router.get("/{profile_id}/reviews")
async def reviews(
    profile_id: uuid.UUID, db: AsyncSession = Depends(get_db), limit: int = 20
) -> list[dict]:
    rows = await db.execute(
        text(
            "select rating, comment, created_at from provider_reviews"
            " where provider_id = :id and comment is not null and comment <> ''"
            " order by created_at desc limit :l"
        ),
        {"id": profile_id, "l": min(limit, 50)},
    )
    return [dict(r._mapping) for r in rows]


# ── Bloklama (block_user / unblock_user portları) ─────────────────
class BlockIn(BaseModel):
    blocked_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=500)
    scope: str = Field(default="global", pattern="^(global|brigade|customer)$")
    brigade_id: uuid.UUID | None = None


@router.post("/block", status_code=201)
async def block_user(
    body: BlockIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """İstifadəçini blokla (block_user portu). scope='brigade' olduqda
    yalnız komanda sahibi/dispetçeri bloklaya bilər və üzv deaktiv edilir."""
    try:
        block_id = await marketplace.block_user(
            db, caller_id=user.id, blocked_id=body.blocked_id, reason=body.reason,
            scope=body.scope, brigade_id=body.brigade_id)
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {"ok": True, "block_id": str(block_id) if block_id else None}


@router.delete("/block/{block_id}")
async def unblock_user(
    block_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Bloku götür (unblock_user portu) — yalnız blok sahibi və ya admin."""
    block = (
        await db.execute(
            text("select id, blocker_id from user_blocks where id = :id"),
            {"id": block_id},
        )
    ).first()
    if block is None:
        raise HTTPException(status_code=404, detail="Blok tapılmadı")
    if block.blocker_id != user.id and user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    await db.execute(
        text("delete from user_blocks where id = :id"), {"id": block_id}
    )
    await db.commit()
    return {"ok": True}


# ── Provayder rolu müraciəti axını ────────────────────────────────
class ProviderRequestIn(BaseModel):
    message: str | None = Field(default=None, max_length=2000)
    company_name: str | None = Field(default=None, max_length=200)
    experience_years: int | None = Field(default=None, ge=0, le=80)
    specialties: list[str] = Field(default_factory=list, max_length=30)


class ProviderApproveIn(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class ProviderRejectIn(BaseModel):
    reason: str | None = Field(default=None, max_length=1000)


@router.post("/provider-request", status_code=201)
async def request_provider_role(
    body: ProviderRequestIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Provayder olmaq üçün müraciət (request_provider_role portu)."""
    try:
        req_id = await marketplace.request_provider_role(
            db, caller_id=user.id, role=user.role, message=body.message,
            company_name=body.company_name,
            experience_years=body.experience_years, specialties=body.specialties)
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {"id": str(req_id), "status": "pending"}


@router.delete("/provider-request/{request_id}")
async def cancel_provider_request(
    request_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Öz müraciətini geri götür (cancel_provider_request portu)."""
    req = (
        await db.execute(
            text("select id, user_id, status from provider_requests where id = :id"),
            {"id": request_id},
        )
    ).first()
    if req is None:
        raise HTTPException(status_code=404, detail="Müraciət tapılmadı")
    if req.user_id != user.id:
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Ləğv mümkün deyil: {req.status}")
    await db.execute(
        text(
            "update provider_requests set status='cancelled', decided_at=now()"
            " where id = :id"
        ),
        {"id": request_id},
    )
    await db.commit()
    return {"ok": True}


@router.post("/provider-request/{request_id}/approve")
async def admin_approve_provider_request(
    request_id: uuid.UUID,
    body: ProviderApproveIn,
    admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin müraciəti təsdiqləyir (admin_approve_provider_request portu)."""
    req = (
        await db.execute(
            text("select id, user_id, status from provider_requests where id = :id"),
            {"id": request_id},
        )
    ).first()
    if req is None:
        raise HTTPException(status_code=404, detail="Müraciət tapılmadı")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Müraciət artıq {req.status}")

    # Profili yenilə: role + müraciətdə qeyd olunan provayder sahələri
    await db.execute(
        text(
            "update profiles p"
            "   set role = 'provider',"
            "       company_name     = coalesce(r.company_name, p.company_name),"
            "       experience_years = coalesce(r.experience_years, p.experience_years),"
            "       specialties      = case when array_length(r.specialties, 1) > 0"
            "                               then r.specialties else p.specialties end"
            "  from provider_requests r"
            " where r.id = :rid and p.id = r.user_id"
        ),
        {"rid": request_id},
    )
    # users cədvəli ilə rol sinxronu (auth bu cədvəldən oxuyur)
    await db.execute(
        text("update users set role='provider' where id = :u"),
        {"u": req.user_id},
    )
    await db.execute(
        text(
            "update provider_requests set status='approved', decided_at=now(),"
            " decided_by=:a, admin_note=:n where id=:id"
        ),
        {"a": admin.id, "n": body.note, "id": request_id},
    )
    n_title = "Provayder statusu təsdiqləndi"
    n_body = "Artıq sifariş qəbul edə bilərsiniz."
    await insert_notification(
        db, user_id=req.user_id, ntype="provider_approved",
        title=n_title, body=n_body, related_id=str(request_id),
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'provider_approve', 'provider_request', :t,"
            " jsonb_build_object('user_id', cast(:u as text)))"
        ),
        {"a": admin.id, "t": str(request_id), "u": str(req.user_id)},
    )
    await db.commit()
    dispatch(req.user_id, n_title, n_body, {"type": "provider_approved"})
    return {"ok": True, "user_id": str(req.user_id)}


@router.post("/provider-request/{request_id}/reject")
async def admin_reject_provider_request(
    request_id: uuid.UUID,
    body: ProviderRejectIn,
    admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin müraciəti rədd edir (admin_reject_provider_request portu)."""
    req = (
        await db.execute(
            text("select id, user_id, status from provider_requests where id = :id"),
            {"id": request_id},
        )
    ).first()
    if req is None:
        raise HTTPException(status_code=404, detail="Müraciət tapılmadı")
    if req.status != "pending":
        raise HTTPException(status_code=409, detail=f"Müraciət artıq {req.status}")

    await db.execute(
        text(
            "update provider_requests set status='rejected', decided_at=now(),"
            " decided_by=:a, admin_note=:n where id=:id"
        ),
        {"a": admin.id, "n": body.reason, "id": request_id},
    )
    n_title = "Provayder müraciəti imtina edildi"
    n_body = body.reason or "Müraciətiniz qəbul olunmadı."
    await insert_notification(
        db, user_id=req.user_id, ntype="provider_rejected",
        title=n_title, body=n_body, related_id=str(request_id),
    )
    await db.commit()
    dispatch(req.user_id, n_title, n_body, {"type": "provider_rejected"})
    return {"ok": True}


# ── Öz rolunu dəyişmə / onlayn status ─────────────────────────────
class SelfRoleIn(BaseModel):
    role: str = Field(pattern="^(customer|provider)$")


class OnlineIn(BaseModel):
    is_online: bool


@router.post("/me/role")
async def set_self_role(
    body: SelfRoleIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Öz rolunu dəyiş (set_self_role portu) — yalnız customer↔provider."""
    # Admin/master öz rolunu downgrade edə bilməz
    if user.role in _ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Admin rolu self-service ilə dəyişdirilə bilməz")
    await db.execute(
        text("update profiles set role=:r, updated_at=now() where id=:u"),
        {"r": body.role, "u": user.id},
    )
    # users cədvəli ilə rol sinxronu (auth bu cədvəldən oxuyur)
    await db.execute(
        text("update users set role=:r where id=:u"),
        {"r": body.role, "u": user.id},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'self_role_change', 'profile', :t,"
            " jsonb_build_object('from', :f, 'to', :r))"
        ),
        {"a": user.id, "t": str(user.id), "f": user.role, "r": body.role},
    )
    await db.commit()
    return {"role": body.role}


@router.post("/me/online")
async def set_member_online(
    body: OnlineIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Komanda üzvünün onlayn statusu + heartbeat (set_member_online portu)."""
    await db.execute(
        text(
            "update brigade_members set is_online=:o, last_heartbeat=now()"
            " where profile_id=:u and is_active=true"
        ),
        {"o": body.is_online, "u": user.id},
    )
    await db.commit()
    return {"ok": True, "is_online": body.is_online}

@router.get("/me/earnings")
async def my_earnings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    days: int = Query(default=30, ge=1, le=365),
) -> dict:
    """Ustanın qazanc hesabatı (worker_earnings RPC portu) — son `days` gün.
    Hesablama ortaq servisdədir (RPC adapteri ilə eyni sorğu)."""
    now = datetime.now(timezone.utc)
    res = await marketplace.worker_earnings(
        db, caller_id=user.id, p_from=now - timedelta(days=days), p_to=now)
    return {"count": res["count"], "gross": str(res["gross"]),
            "platform_total": str(res["platform_total"]),
            "brigade_total": str(res["brigade_total"]),
            "net_total": str(res["net_total"]), "orders": res["orders"]}
