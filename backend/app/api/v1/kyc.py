"""KYC — sənəd göndərmə, status, selfie yeniləməsi, admin yoxlaması.

kyc.sql RPC-lərinin portu. Qayda: təsdiq 14 gün etibarlıdır
(last_kyc_approved_at), sonra selfie yeniləməsi tələb olunur.
"""
from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.services.realtime import publish

router = APIRouter(prefix="/kyc", tags=["kyc"])

KYC_VALID_DAYS = 14


class KycSubmitIn(BaseModel):
    id_front_path: str = Field(min_length=1, max_length=1000)
    id_back_path: str = Field(min_length=1, max_length=1000)
    selfie_path: str = Field(min_length=1, max_length=1000)
    full_name_on_id: str | None = Field(default=None, max_length=200)
    id_number: str | None = Field(default=None, max_length=32)
    birth_date: date | None = None


class KycRenewalIn(BaseModel):
    selfie_path: str = Field(min_length=1, max_length=1000)


class KycReviewIn(BaseModel):
    approve: bool
    rejection_reason: str | None = Field(default=None, max_length=500)


@router.get("/status")
async def status(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    row = (
        await db.execute(
            text(
                "select verification_status, is_verified, last_kyc_approved_at,"
                " (last_kyc_approved_at is not null and"
                f"  last_kyc_approved_at <= now() - interval '{KYC_VALID_DAYS} days')"
                " as expired from profiles where id = :u"
            ),
            {"u": user.id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profil tapılmadı")
    st = row.verification_status or "not_submitted"
    if st == "approved" and row.expired:
        st = "expired"  # server tərəfdə düzgün status (mobil düzəlişiylə uyğun)
    latest = (
        await db.execute(
            text(
                "select id, status, rejection_reason, created_at from provider_verifications"
                " where provider_id = :u order by created_at desc limit 1"
            ),
            {"u": user.id},
        )
    ).first()
    return {
        "status": st,
        "is_verified": bool(row.is_verified) and not row.expired,
        "last_approved_at": row.last_kyc_approved_at,
        "latest_submission": dict(latest._mapping) if latest else None,
    }


@router.post("/submit", status_code=201)
async def submit(
    body: KycSubmitIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.role != "provider":
        raise HTTPException(status_code=403, detail="KYC yalnız ustalar üçündür")
    pending = (
        await db.execute(
            text(
                "select 1 from provider_verifications"
                " where provider_id=:u and status='pending'"
            ),
            {"u": user.id},
        )
    ).first()
    if pending:
        raise HTTPException(status_code=409, detail="Aktiv müraciətiniz artıq yoxlanılır")
    row = (
        await db.execute(
            text(
                "insert into provider_verifications (provider_id, id_front_path,"
                " id_back_path, selfie_path, full_name_on_id, id_number, birth_date)"
                " values (:u, :f, :b, :s, :n, :i, :d) returning id"
            ),
            {"u": user.id, "f": body.id_front_path, "b": body.id_back_path,
             "s": body.selfie_path, "n": body.full_name_on_id,
             "i": body.id_number, "d": body.birth_date},
        )
    ).first()
    await db.execute(
        text("update profiles set verification_status='pending' where id=:u"),
        {"u": user.id},
    )
    await db.commit()
    return {"id": str(row.id), "status": "pending"}


@router.post("/renewal", status_code=201)
async def renewal(
    body: KycRenewalIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Yalnız selfie yeniləməsi — tam KYC-si olanlar üçün sürətli yol."""
    prior = (
        await db.execute(
            text(
                "select id_front_path, id_back_path, full_name_on_id, id_number,"
                " birth_date from provider_verifications"
                " where provider_id=:u and status='approved'"
                " order by created_at desc limit 1"
            ),
            {"u": user.id},
        )
    ).first()
    if prior is None:
        raise HTTPException(status_code=409, detail="Əvvəlcə tam KYC yoxlamasından keçin")
    row = (
        await db.execute(
            text(
                "insert into provider_verifications (provider_id, id_front_path,"
                " id_back_path, selfie_path, full_name_on_id, id_number,"
                " birth_date, is_renewal)"
                " values (:u, :f, :b, :s, :n, :i, :d, true) returning id"
            ),
            {"u": user.id, "f": prior.id_front_path, "b": prior.id_back_path,
             "s": body.selfie_path, "n": prior.full_name_on_id,
             "i": prior.id_number, "d": prior.birth_date},
        )
    ).first()
    await db.execute(
        text("update profiles set verification_status='pending' where id=:u"),
        {"u": user.id},
    )
    await db.commit()
    return {"id": str(row.id), "status": "pending", "is_renewal": True}


# ── Admin ─────────────────────────────────────────────────────────
@router.get("/pending")
async def pending_list(
    _admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = await db.execute(
        text(
            "select v.id, v.provider_id, v.full_name_on_id, v.id_number,"
            "       v.id_front_path, v.id_back_path, v.selfie_path,"
            "       v.is_renewal, v.created_at, p.name, p.email"
            "  from provider_verifications v join profiles p on p.id = v.provider_id"
            " where v.status = 'pending' order by v.created_at"
        )
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{verification_id}/review")
async def review(
    verification_id: uuid.UUID,
    body: KycReviewIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin KYC qərarı (admin_kyc_review portu)."""
    v = (
        await db.execute(
            text(
                "select id, provider_id, status from provider_verifications"
                " where id = :id for update"
            ),
            {"id": verification_id},
        )
    ).first()
    if v is None:
        raise HTTPException(status_code=404, detail="Müraciət tapılmadı")
    if v.status != "pending":
        raise HTTPException(status_code=409, detail="Müraciət artıq yoxlanılıb")
    if not body.approve and not (body.rejection_reason or "").strip():
        raise HTTPException(status_code=400, detail="Rədd üçün səbəb yazın")

    new_status = "approved" if body.approve else "rejected"
    await db.execute(
        text(
            "update provider_verifications set status=:s, rejection_reason=:r,"
            " reviewed_by=:a, reviewed_at=now(), updated_at=now() where id=:id"
        ),
        {"s": new_status, "r": body.rejection_reason, "a": admin.id, "id": verification_id},
    )
    if body.approve:
        await db.execute(
            text(
                "update profiles set verification_status='approved', is_verified=true,"
                " last_kyc_approved_at=now() where id=:u"
            ),
            {"u": v.provider_id},
        )
    else:
        await db.execute(
            text(
                "update profiles set verification_status='rejected', is_verified=false"
                " where id=:u"
            ),
            {"u": v.provider_id},
        )
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, :t, :ti, :b, :r)"
        ),
        {"u": v.provider_id,
         "t": "kyc_approved" if body.approve else "kyc_rejected",
         "ti": "KYC təsdiqləndi ✅" if body.approve else "KYC rədd edildi",
         "b": "Şəxsiyyətiniz təsdiqləndi — sifariş qəbul edə bilərsiniz."
              if body.approve else f"Səbəb: {body.rejection_reason}",
         "r": str(verification_id)},
    )
    await db.commit()
    await publish(v.provider_id, "kyc.decision", {"approved": body.approve})
    return {"ok": True, "status": new_status}
