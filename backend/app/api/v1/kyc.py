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


class KycSubmitError(Exception):
    """KYC göndərişi qaydası pozuntusu; `code` — SQL RPC-nin qaytardığı xəta kodu."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.status, self.code, self.message = status, code, message


async def _insert_verification(
    db: AsyncSession, *, user_id: uuid.UUID, id_front_path: str, id_back_path: str,
    selfie_path: str, full_name_on_id: str | None, id_number: str | None,
    birth_date: date | None, is_renewal: bool = False,
) -> uuid.UUID:
    """Yeni müraciət sətri + profil statusu 'pending' (commit çağıranındır)."""
    row = (
        await db.execute(
            text(
                "insert into provider_verifications (provider_id, id_front_path,"
                " id_back_path, selfie_path, full_name_on_id, id_number,"
                " birth_date, is_renewal)"
                " values (:u, :f, :b, :s, :n, :i, :d, :r) returning id"
            ),
            {"u": user_id, "f": id_front_path, "b": id_back_path,
             "s": selfie_path, "n": full_name_on_id,
             "i": id_number, "d": birth_date, "r": is_renewal},
        )
    ).first()
    await db.execute(
        text("update profiles set verification_status='pending' where id=:u"),
        {"u": user_id},
    )
    return row.id


async def _cancel_pending(db: AsyncSession, user_id: uuid.UUID) -> None:
    await db.execute(
        text(
            "update provider_verifications set status='cancelled', updated_at=now()"
            " where provider_id=:u and status='pending'"
        ),
        {"u": user_id},
    )


async def submit_kyc_core(
    db: AsyncSession, *, user_id: uuid.UUID, id_front_path: str, id_back_path: str,
    selfie_path: str, full_name_on_id: str | None = None,
    id_number: str | None = None, birth_date: date | None = None,
) -> dict:
    """`submit_kyc` SQL RPC-nin semantikası (Supabase-uyğun RPC üçün):
    hər giriş etmiş istifadəçi göndərə bilər, fayl yolları öz qovluğunda
    olmalıdır, mövcud pending müraciət ləğv olunub yenisi yaradılır."""
    prefix = f"{user_id}/"
    if not all(p.startswith(prefix) for p in (id_front_path, id_back_path, selfie_path)):
        raise KycSubmitError(400, "INVALID_PATH", "fayl yolu sizin deyil")
    await _cancel_pending(db, user_id)
    vid = await _insert_verification(
        db, user_id=user_id, id_front_path=id_front_path, id_back_path=id_back_path,
        selfie_path=selfie_path, full_name_on_id=full_name_on_id,
        id_number=id_number, birth_date=birth_date)
    await db.commit()
    return {"ok": True, "verification_id": str(vid), "status": "pending"}


async def renewal_core(
    db: AsyncSession, *, user_id: uuid.UUID, role: str, selfie_path: str
) -> dict:
    """submit_kyc_renewal portu (REST + RPC ortaq): sənəd path-ları sonuncu
    approved müraciətdən götürülür, yalnız selfie yenidir."""
    # SQL: yalnız provayder rolu renewal edə bilər
    if (role or "").lower() not in ("provider", "pro", "seller"):
        raise KycSubmitError(403, "NOT_A_PROVIDER", "yalnız ustalar üçün")
    # SQL: path sahibi öz user_id-si ilə başlamalıdır
    if not selfie_path.startswith(f"{user_id}/"):
        raise KycSubmitError(400, "INVALID_PATH", "fayl yolu sizin deyil")
    prior = (
        await db.execute(
            text(
                "select id_front_path, id_back_path, full_name_on_id, id_number,"
                " birth_date from provider_verifications"
                " where provider_id=:u and status='approved'"
                " order by reviewed_at desc nulls last, created_at desc limit 1"
            ),
            {"u": user_id},
        )
    ).first()
    if prior is None:
        # İlk dəfə KYC göndərməyibsə, renewal işləməz — tam KYC lazımdır
        raise KycSubmitError(409, "NO_PRIOR_APPROVED_KYC", "əvvəlcə tam KYC yoxlamasından keçin")
    # Mövcud pending müraciət varsa, onu ləğv et (SQL semantikası)
    await _cancel_pending(db, user_id)
    vid = await _insert_verification(
        db, user_id=user_id, id_front_path=prior.id_front_path,
        id_back_path=prior.id_back_path, selfie_path=selfie_path,
        full_name_on_id=prior.full_name_on_id, id_number=prior.id_number,
        birth_date=prior.birth_date, is_renewal=True)
    await db.commit()
    return {"ok": True, "verification_id": str(vid), "status": "pending",
            "is_renewal": True}


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
    vid = await _insert_verification(
        db, user_id=user.id, id_front_path=body.id_front_path,
        id_back_path=body.id_back_path, selfie_path=body.selfie_path,
        full_name_on_id=body.full_name_on_id, id_number=body.id_number,
        birth_date=body.birth_date)
    await db.commit()
    return {"id": str(vid), "status": "pending"}


@router.post("/renewal", status_code=201)
async def renewal(
    body: KycRenewalIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Yalnız selfie yeniləməsi — tam KYC-si olanlar üçün sürətli yol
    (submit_kyc_renewal RPC-nin portu)."""
    try:
        res = await renewal_core(
            db, user_id=user.id, role=user.role, selfie_path=body.selfie_path)
    except KycSubmitError as e:
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {"id": res["verification_id"], "status": "pending", "is_renewal": True}


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


class KycError(Exception):
    """KYC qərarı xətası: `detail` — REST mətni (HTTP `status` ilə),
    `sql` — köhnə admin_kyc_review funksiyasındakı `raise exception` mətni."""

    def __init__(self, status: int, detail: str, sql: str | None = None) -> None:
        super().__init__(detail)
        self.status, self.detail, self.sql = status, detail, sql or detail


@router.post("/{verification_id}/review")
async def review(
    verification_id: uuid.UUID,
    body: KycReviewIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin KYC qərarı (admin_kyc_review portu)."""
    try:
        new_status = await svc_review_kyc(
            db, admin_id=admin.id, verification_id=verification_id,
            approve=body.approve, reason=body.rejection_reason,
            pending_only=True)
    except KycError as e:
        raise HTTPException(status_code=e.status, detail=e.detail) from e
    return {"ok": True, "status": new_status}


async def svc_review_kyc(
    db: AsyncSession, *, admin_id, verification_id, approve: bool,
    reason: str | None = None, notes: str | None = None,
    pending_only: bool = True,
) -> str:
    """KYC qərarının iş məntiqi — REST endpointi və `admin_kyc_review` RPC
    adapteri (app/compat/rpc_admin.py) üçün ortaq. Yeni statusu qaytarır.

    `pending_only=False` — köhnə SQL funksiyasının davranışı: artıq qərar
    verilmiş müraciət də yenidən təsdiqlənə/rədd edilə bilər. `notes` verilsə
    `admin_notes` sütununa yazılır (SQL-dəki `p_notes`).
    İcazə yoxlaması çağıran tərəfin öhdəsindədir.
    """
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
        raise KycError(404, "Müraciət tapılmadı", "KYC tapılmadı")
    if pending_only and v.status != "pending":
        raise KycError(409, "Müraciət artıq yoxlanılıb")
    if not approve and not (reason or "").strip():
        raise KycError(400, "Rədd üçün səbəb yazın", "İmtina səbəbi tələb olunur")

    new_status = "approved" if approve else "rejected"
    # SQL: təsdiqdə rejection_reason sıfırlanır; admin_notes yalnız RPC yolunda
    # ötürülür (REST gövdəsində belə sahə yoxdur — mövcud qeyd saxlanır)
    await db.execute(
        text(
            "update provider_verifications set status=:s, rejection_reason=:r,"
            " admin_notes = case when :set_notes then cast(:n as text)"
            "                    else admin_notes end,"
            " reviewed_by=:a, reviewed_at=now(), updated_at=now() where id=:id"
        ),
        {"s": new_status, "r": None if approve else reason,
         "set_notes": not pending_only, "n": notes,
         "a": admin_id, "id": verification_id},
    )
    if approve:
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
    # Bildiriş yalnız status dəyişəndə (köhnə notify_on_kyc_decision trigger-i kimi)
    if v.status != new_status:
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " values (:u, :t, :ti, :b, :r)"
            ),
            {"u": v.provider_id,
             "t": "kyc_approved" if approve else "kyc_rejected",
             "ti": "KYC təsdiqləndi ✅" if approve else "KYC rədd edildi",
             "b": "Şəxsiyyətiniz təsdiqləndi — sifariş qəbul edə bilərsiniz."
                  if approve else f"Səbəb: {reason}",
             "r": str(verification_id)},
        )
    # Audit (admin_kyc_review SQL-dəki kimi)
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, :act, 'provider_verification', :t,"
            " jsonb_build_object('provider_id', cast(:p as text),"
            "  'reason', cast(:re as text)))"
        ),
        {"a": admin_id, "act": "kyc_approve" if approve else "kyc_reject",
         "t": str(verification_id), "p": str(v.provider_id), "re": reason},
    )
    await db.commit()
    await publish(v.provider_id, "kyc.decision", {"approved": approve})
    return new_status
