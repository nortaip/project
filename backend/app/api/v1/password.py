"""Parol bərpası və OTP ilə parol dəyişmə — Supabase-dən asılı olmayan axın.

Əvəz etdiyi Supabase RPC-ləri: request_password_reset_otp,
request_password_reset_email, reset_password_with_otp,
request_password_change_otp, verify_password_change_otp.

"Parolu unutdum" (giriş etməmiş istifadəçi):
  POST /auth/password-reset/request  {identifier}            → kod göndər
  POST /auth/password-reset/email    {identifier}            → kodu e-poçtla göndər
  POST /auth/password-reset/confirm  {identifier, otp, new_password}

Parol dəyişmə (giriş etmiş istifadəçi, cari parolu bilmədən):
  POST /auth/password-change/request
  POST /auth/password-change/confirm {otp, new_password}

Təhlükəsizlik:
  * İstifadəçi sadalama qoruması — `request` hesab olub-olmamasından asılı
    olmayaraq eyni cavabı verir; saatlıq limit də identifikatora görədir.
  * Kod bazada açıq saxlanmır: HMAC-SHA256(JWT_SECRET, user:kod).
  * Kod 5 dəqiqə yaşayır, 5 səhv cəhddən sonra yanır, bir dəfə işlənir.
  * Uğurlu yeniləmədə bütün refresh sessiyaları bağlanır (bütün cihazlardan çıxış).
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.security import hash_password, verify_password
from app.db.session import get_db, redis
from app.models.user import RefreshSession, User
from app.services import mailer
from app.services.identity import find_user, identifier_key, mask_email
from app.services.notify import dispatch, insert_notification

router = APIRouter(prefix="/auth", tags=["auth"])

_PURPOSE_RESET = "reset"
_PURPOSE_CHANGE = "change"
_EMAIL_MARK = "email_fallback"


# ── Şemalar ───────────────────────────────────────────────────────
class ResetRequestIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)


class ResetConfirmIn(BaseModel):
    identifier: str = Field(min_length=3, max_length=320)
    otp: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


class ChangeConfirmIn(BaseModel):
    otp: str = Field(min_length=4, max_length=12)
    new_password: str = Field(min_length=8, max_length=128)


# ── Köməkçilər ────────────────────────────────────────────────────
def _otp_digest(user_id: uuid.UUID | str, code: str) -> str:
    return hmac.new(
        settings.JWT_SECRET.encode(), f"{user_id}:{code.strip()}".encode(), hashlib.sha256
    ).hexdigest()


def _err(status: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


async def _hit_limit(key: str) -> None:
    """Saatlıq sorğu limiti. Redis əlçatmazdırsa buraxır (fail-open) —
    bazadakı sayğac (`_recent_count`) ikinci müdafiə xəttidir."""
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, 3600)
    except Exception:  # noqa: BLE001
        return
    if n > settings.OTP_MAX_PER_HOUR:
        raise _err(429, "TOO_MANY_REQUESTS",
                   "Çox sorğu göndərildi — bir saat sonra yenidən cəhd edin")


async def _recent_count(db: AsyncSession, user_id: uuid.UUID, marker: str) -> int:
    row = (
        await db.execute(
            text(
                "select count(*) as c from password_otps"
                " where user_id = :u and phone = :m"
                "   and created_at > now() - interval '1 hour'"
            ),
            {"u": user_id, "m": marker},
        )
    ).first()
    return int(row.c)


async def _issue_otp(db: AsyncSession, user: User, purpose: str) -> str:
    """Yeni kod yaradır (əvvəlkiləri yandırır) və açıq kodu qaytarır."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    await db.execute(
        text(
            "update password_otps set used = true"
            " where user_id = :u and phone = :m and used = false"
        ),
        {"u": user.id, "m": purpose},
    )
    await db.execute(
        text(
            "insert into password_otps (user_id, phone, otp, expires_at)"
            " values (:u, :m, :o, :e)"
        ),
        {
            "u": user.id, "m": purpose, "o": _otp_digest(user.id, code),
            "e": datetime.now(timezone.utc) + timedelta(minutes=settings.OTP_TTL_MINUTES),
        },
    )
    return code


async def _deliver(db: AsyncSession, user: User, code: str) -> None:
    """Kodu tətbiq bildirişi (+push) və varsa e-poçtla çatdırır; commit edir."""
    title = "Parol yeniləmə kodu"
    body = f"Təsdiq kodunuz: {code} ({settings.OTP_TTL_MINUTES} dəqiqə etibarlıdır)"
    nid = await insert_notification(
        db, user_id=user.id, ntype="password_otp", title=title, body=body
    )
    await db.commit()
    dispatch(user.id, title, body, {"type": "password_otp", "notif_id": nid})
    if user.email and mailer.mail_enabled():
        await mailer.send_mail(user.email, *mailer.otp_mail(code, settings.OTP_TTL_MINUTES))


async def _verify_otp(db: AsyncSession, user: User, purpose: str, code: str) -> None:
    """Kodu yoxlayır və istifadə olunmuş kimi işarələyir; səhvdirsə HTTPException."""
    row = (
        await db.execute(
            text(
                "select id, otp, expires_at, attempts from password_otps"
                " where user_id = :u and phone = :m and used = false"
                " order by created_at desc limit 1 for update"
            ),
            {"u": user.id, "m": purpose},
        )
    ).first()
    if row is None:
        raise _err(400, "NO_OTP", "Aktiv kod yoxdur — yeni kod istəyin")
    if row.expires_at < datetime.now(timezone.utc):
        await db.execute(text("update password_otps set used = true where id = :i"), {"i": row.id})
        await db.commit()
        raise _err(400, "EXPIRED", "Kodun vaxtı bitib — yeni kod istəyin")
    if row.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise _err(400, "TOO_MANY_ATTEMPTS", "Çox səhv cəhd — yeni kod istəyin")
    if not hmac.compare_digest(row.otp, _otp_digest(user.id, code)):
        attempts = row.attempts + 1
        await db.execute(
            text("update password_otps set attempts = :a, used = :burn where id = :i"),
            {"a": attempts, "burn": attempts >= settings.OTP_MAX_ATTEMPTS, "i": row.id},
        )
        await db.commit()  # sayğac rollback olmasın
        left = max(settings.OTP_MAX_ATTEMPTS - attempts, 0)
        if left == 0:
            raise _err(400, "TOO_MANY_ATTEMPTS", "Çox səhv cəhd — yeni kod istəyin")
        raise _err(400, "WRONG_CODE", "Kod yanlışdır", attempts_left=left)
    await db.execute(text("update password_otps set used = true where id = :i"), {"i": row.id})


async def _set_password(db: AsyncSession, user: User, new_password: str) -> None:
    """Yeni parolu yazır, bütün sessiyaları bağlayır, təhlükəsizlik bildirişi göndərir."""
    user.password_hash = hash_password(new_password)
    sessions = (
        await db.execute(
            select(RefreshSession).where(
                RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False)
            )
        )
    ).scalars().all()
    for s in sessions:
        s.revoked = True
    title, body = "Parolunuz yeniləndi 🔐", (
        "Hesabınızın parolu dəyişdirildi. Bunu siz etməmisinizsə, dərhal "
        "dəstək xidməti ilə əlaqə saxlayın."
    )
    nid = await insert_notification(
        db, user_id=user.id, ntype="security", title=title, body=body
    )
    await db.commit()
    try:
        for s in sessions:
            await redis.delete(f"rt:{s.jti}")
        # Uğursuz giriş kilidləri də sıfırlanır — istifadəçi dərhal girə bilsin
        for ident in filter(None, (user.email, user.phone)):
            async for key in redis.scan_iter(match=f"lock:{identifier_key(ident)}:*"):
                await redis.delete(key)
    except Exception:  # noqa: BLE001 — Redis əlçatmazdırsa DB-dəki revoke kifayətdir
        pass
    dispatch(user.id, title, body, {"type": "security", "notif_id": nid})


# ── "Parolu unutdum" ──────────────────────────────────────────────
@router.post("/password-reset/request")
async def request_reset(body: ResetRequestIn, db: AsyncSession = Depends(get_db)) -> dict:
    """Təsdiq kodu göndərir. Cavab hesabın olub-olmamasını açmır."""
    await _hit_limit(f"otp:req:{identifier_key(body.identifier)}")
    user = await find_user(db, body.identifier)
    if user is not None and user.is_active:
        if await _recent_count(db, user.id, _PURPOSE_RESET) < settings.OTP_MAX_PER_HOUR:
            code = await _issue_otp(db, user, _PURPOSE_RESET)
            await _deliver(db, user, code)
    return {
        "ok": True,
        "expires_in": settings.OTP_TTL_MINUTES * 60,
        "message": "Hesab mövcuddursa, təsdiq kodu göndərildi",
    }


@router.post("/password-reset/email")
async def request_reset_email(body: ResetRequestIn, db: AsyncSession = Depends(get_db)) -> dict:
    """"Kod gəlmədi?" — kodu hesabın e-poçtuna göndərir (telefonla
    axtarışda da işləyir) və maskalanmış ünvan ipucu qaytarır."""
    if not mailer.mail_enabled():
        raise _err(503, "EMAIL_NOT_CONFIGURED", "E-poçt göndərişi hazırda aktiv deyil")
    await _hit_limit(f"otp:mail:{identifier_key(body.identifier)}")
    user = await find_user(db, body.identifier)
    if user is None or not user.is_active or not user.email:
        raise _err(404, "NO_EMAIL", "Bu hesaba bağlı e-poçt ünvanı tapılmadı")
    if await _recent_count(db, user.id, _EMAIL_MARK) >= settings.OTP_MAX_PER_HOUR:
        raise _err(429, "TOO_MANY_REQUESTS",
                   "Çox sorğu göndərildi — bir saat sonra yenidən cəhd edin")
    code = await _issue_otp(db, user, _PURPOSE_RESET)
    # Saatlıq e-poçt limiti üçün işarə sətri (kod daşımır, dərhal "işlənmiş")
    await db.execute(
        text(
            "insert into password_otps (user_id, phone, otp, expires_at, used)"
            " values (:u, :m, '-', now(), true)"
        ),
        {"u": user.id, "m": _EMAIL_MARK},
    )
    await db.commit()
    sent = await mailer.send_mail(user.email, *mailer.otp_mail(code, settings.OTP_TTL_MINUTES))
    if not sent:
        raise _err(502, "EMAIL_FAILED", "E-poçt göndərilə bilmədi — bir az sonra yenidən cəhd edin")
    return {"ok": True, "email_hint": mask_email(user.email),
            "expires_in": settings.OTP_TTL_MINUTES * 60}


@router.post("/password-reset/confirm")
async def confirm_reset(body: ResetConfirmIn, db: AsyncSession = Depends(get_db)) -> dict:
    user = await find_user(db, body.identifier)
    if user is None or not user.is_active:
        # Sadalama qoruması: "hesab yoxdur" ilə "kod yoxdur" fərqlənmir
        raise _err(400, "NO_OTP", "Aktiv kod yoxdur — yeni kod istəyin")
    await _verify_otp(db, user, _PURPOSE_RESET, body.otp)
    await _set_password(db, user, body.new_password)
    return {"ok": True}


# ── Giriş etmiş istifadəçi: OTP ilə parol dəyişmə ─────────────────
@router.post("/password-change/request")
async def request_change(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
) -> dict:
    if await _recent_count(db, user.id, _PURPOSE_CHANGE) >= settings.OTP_MAX_PER_HOUR:
        raise _err(429, "TOO_MANY_REQUESTS",
                   "Çox sorğu göndərildi — bir saat sonra yenidən cəhd edin")
    code = await _issue_otp(db, user, _PURPOSE_CHANGE)
    await _deliver(db, user, code)
    return {"ok": True, "expires_in": settings.OTP_TTL_MINUTES * 60}


@router.post("/password-change/confirm")
async def confirm_change(
    body: ChangeConfirmIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    if user.password_hash and verify_password(body.new_password, user.password_hash)[0]:
        raise _err(400, "SAME_PASSWORD", "Yeni parol köhnə ilə eyni ola bilməz")
    await _verify_otp(db, user, _PURPOSE_CHANGE, body.otp)
    await _set_password(db, user, body.new_password)
    return {"ok": True}
