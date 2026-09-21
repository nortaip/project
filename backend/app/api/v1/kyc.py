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
from app.services.notify import dispatch, insert_notification
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
    """Yalnız selfie yeniləməsi — tam KYC-si olanlar üçün sürətli yol.

    submit_kyc_renewal RPC-nin portu: sənəd path-ları sonuncu approved
    müraciətdən götürülür, yalnız selfie yenidir.
    """
    # SQL: yalnız provayder rolu renewal edə bilər
    if user.role not in ("provider", "pro", "seller"):
        raise HTTPException(status_code=403, detail="NOT_A_PROVIDER: yalnız ustalar üçün")
    # SQL: path sahibi öz user_id-si ilə başlamalıdır
    if not body.selfie_path.startswith(f"{user.id}/"):
        raise HTTPException(status_code=400, detail="INVALID_PATH: fayl yolu sizin deyil")
    prior = (
        await db.execute(
            text(
                "select id_front_path, id_back_path, full_name_on_id, id_number,"
                " birth_date from provider_verifications"
                " where provider_id=:u and status='approved'"
                " order by reviewed_at desc nulls last, created_at desc limit 1"
            ),
            {"u": user.id},
        )
    ).first()
    if prior is None:
        # İlk dəfə KYC göndərməyibsə, renewal işləməz — tam KYC lazımdır
        raise HTTPException(
            status_code=409,
            detail="NO_PRIOR_APPROVED_KYC: əvvəlcə tam KYC yoxlamasından keçin")
    # Mövcud pending müraciət varsa, onu ləğv et (SQL semantikası)
    await db.execute(
        text(
            "update provider_verifications set status='cancelled', updated_at=now()"
            " where provider_id=:u and status='pending'"
        ),
        {"u": user.id},
    )
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
_ADMIN = require_roles("admin", "master", "superadmin")


class KycRevokeIn(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


@router.get("/list")
async def admin_list(
    status: str | None = None,
    _admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    """Bütün KYC müraciətləri, provayder məlumatları ilə (admin_kyc_list portu).

    `status` boş və ya 'all' olduqda hamısı, əks halda yalnız həmin status.
    """
    rows = await db.execute(
        text(
            "select v.id, v.provider_id, v.full_name_on_id, v.id_number,"
            "       v.birth_date, v.status, v.rejection_reason, v.admin_notes,"
            "       v.is_renewal, v.created_at, v.reviewed_at,"
            "       v.id_front_path, v.id_back_path, v.selfie_path,"
            "       p.name  as provider_name, p.email as provider_email,"
            "       p.phone_number as provider_phone, p.avatar_url as provider_avatar"
            "  from provider_verifications v"
            "  left join profiles p on p.id = v.provider_id"
            " where (cast(:s as text) is null or :s = 'all' or v.status = :s)"
            " order by v.created_at desc"
        ),
        {"s": status},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{provider_id}/revoke")
async def revoke(
    provider_id: uuid.UUID,
    body: KycRevokeIn,
    admin: User = Depends(_ADMIN),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Təsdiqlənmiş KYC-nin ləğvi (revoke_kyc portu) — usta yenidən
    sənəd göndərməlidir."""
    # SQL: səbəb minimum 5 simvol olmalıdır
    if len(body.reason.strip()) < 5:
        raise HTTPException(status_code=400, detail="REASON_REQUIRED: səbəb ən azı 5 simvol")
    prof = (
        await db.execute(
            text("select is_verified from profiles where id = :p"),
            {"p": provider_id},
        )
    ).first()
    if prof is None:
        raise HTTPException(status_code=404, detail="PROVIDER_NOT_FOUND: provayder tapılmadı")
    if not prof.is_verified:
        raise HTTPException(status_code=409, detail="NOT_VERIFIED: provayder onsuz da təsdiqsizdir")

    # Profil bayraqlarını yenilə — yenidən submit tələb olunur
    await db.execute(
        text(
            "update profiles set is_verified=false,"
            " verification_status='resubmit_required' where id=:p"
        ),
        {"p": provider_id},
    )
    # Sonuncu approved müraciəti 'cancelled' et ki, rejection_reason görünsün
    await db.execute(
        text(
            "update provider_verifications"
            "   set status='cancelled', rejection_reason=:r,"
            "       reviewed_by=:a, reviewed_at=now()"
            " where id = (select id from provider_verifications"
            "              where provider_id=:p and status='approved'"
            "              order by reviewed_at desc nulls last, created_at desc"
            "              limit 1)"
        ),
        {"r": body.reason, "a": admin.id, "p": provider_id},
    )
    # Bildiriş (SQL-dəki kyc_revoked notification insert-i)
    n_title = "KYC təsdiqi ləğv edildi"
    n_body = f"Səbəb: {body.reason}. Yenidən sənəd yükləyin."
    await insert_notification(
        db, user_id=provider_id, ntype="kyc_revoked",
        title=n_title, body=n_body, related_id=str(provider_id),
    )
    await db.commit()
    # Commit-dən sonra push + WS (best-effort)
    dispatch(provider_id, n_title, n_body, {"type": "kyc_revoked"})
    return {"ok": True, "provider_id": str(provider_id)}


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
