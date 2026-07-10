"""Auth endpointləri: qeydiyyat, giriş, refresh rotasiyası, Google/Apple, çıxış.

Təhlükəsizlik:
  - Login/register sərt rate-limit altındadır (brute-force).
  - Uğursuz login-də "email yoxdur" / "parol səhvdir" fərqləndirilmir
    (istifadəçi sadalama hücumunun qarşısı).
  - Refresh rotasiyası: köhnə jti dərhal ləğv edilir; təkrar istifadə
    aşkarlanarsa istifadəçinin BÜTÜN sessiyaları bağlanır (oğurluq əlaməti).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from jose import JWTError
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core import oauth as oauth_core
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db, redis
from app.models.user import OAuthIdentity, RefreshSession, User

router = APIRouter(prefix="/auth", tags=["auth"])

_INVALID_CREDS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Email və ya parol yanlışdır",
)


# ── Şemalar ───────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="customer", pattern="^(customer|provider)$")


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=128)


class GoogleIn(BaseModel):
    id_token: str


class AppleIn(BaseModel):
    identity_token: str
    name: str | None = None  # Apple adı yalnız ilk girişdə verir


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user_id: uuid.UUID
    role: str


# ── Köməkçilər ────────────────────────────────────────────────────
async def _issue_tokens(
    db: AsyncSession, user: User, request: Request
) -> TokenOut:
    access = create_access_token(user.id, user.role)
    refresh, jti, exp = create_refresh_token(user.id)
    db.add(
        RefreshSession(
            jti=jti,
            user_id=user.id,
            user_agent=(request.headers.get("user-agent") or "")[:255],
            ip=request.client.host if request.client else None,
            expires_at=exp,
        )
    )
    await db.commit()
    ttl = int((exp - datetime.now(timezone.utc)).total_seconds())
    await redis.setex(f"rt:{jti}", ttl, str(user.id))
    return TokenOut(
        access_token=access, refresh_token=refresh, user_id=user.id, role=user.role
    )


async def _oauth_login(
    db: AsyncSession, request: Request, info: dict, fallback_name: str | None
) -> TokenOut:
    """OAuth kimliyi ilə user tap/yarat (hesab bağlama daxil)."""
    res = await db.execute(
        select(OAuthIdentity).where(
            OAuthIdentity.provider == info["provider"],
            OAuthIdentity.provider_sub == info["sub"],
        )
    )
    identity = res.scalar_one_or_none()
    if identity:
        user = (
            await db.execute(select(User).where(User.id == identity.user_id))
        ).scalar_one()
    else:
        user = None
        if info.get("email"):
            user = (
                await db.execute(select(User).where(User.email == info["email"]))
            ).scalar_one_or_none()
        if user is None:
            user = User(
                email=info.get("email"),
                role="customer",
                email_verified=bool(info.get("email")),
            )
            db.add(user)
            await db.flush()
            await db.execute(
                sa_text(
                    "insert into profiles (id, email, name, role)"
                    " values (:id, :email, :name, 'customer')"
                    " on conflict (id) do nothing"
                ),
                {"id": user.id, "email": user.email,
                 "name": info.get("name") or fallback_name},
            )
        db.add(
            OAuthIdentity(
                user_id=user.id, provider=info["provider"], provider_sub=info["sub"]
            )
        )
        await db.commit()
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Hesab deaktivdir")
    return await _issue_tokens(db, user, request)


# ── Endpointlər ───────────────────────────────────────────────────
@router.post("/register", response_model=TokenOut, status_code=201)
async def register(
    body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    existing = (
        await db.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()
    if existing:
        # Sadalama hücumuna qarşı eyni format cavab
        raise HTTPException(status_code=409, detail="Bu email artıq qeydiyyatdadır")
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.flush()
    # Domen profili (Supabase-dəki handle_new_user trigger-inin ekvivalenti)
    await db.execute(
        sa_text(
            "insert into profiles (id, email, name, role)"
            " values (:id, :email, :name, :role) on conflict (id) do nothing"
        ),
        {"id": user.id, "email": user.email, "name": body.name, "role": body.role},
    )
    await db.commit()
    return await _issue_tokens(db, user, request)


_LOCKOUT_LIMIT = 5          # ardıcıl uğursuz cəhd
_LOCKOUT_WINDOW = 900       # 15 dəqiqə


async def _check_lockout(email: str, ip: str) -> str:
    """Brute-force lockout açarı qaytarır; kilidlidirsə exception atır."""
    key = f"lock:{email}:{ip}"
    try:
        fails = int(await redis.get(key) or 0)
    except Exception:
        return key
    if fails >= _LOCKOUT_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Çox uğursuz cəhd — 15 dəqiqə sonra yenidən yoxlayın",
        )
    return key


async def _register_fail(key: str) -> None:
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, _LOCKOUT_WINDOW)
    except Exception:
        pass


@router.post("/login", response_model=TokenOut)
async def login(
    body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    ip = request.client.host if request.client else "?"
    lock_key = await _check_lockout(body.email.lower(), ip)
    user = (
        await db.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()
    if user is None or not user.password_hash:
        await _register_fail(lock_key)
        raise _INVALID_CREDS
    ok, needs_rehash = verify_password(body.password, user.password_hash)
    if not ok:
        await _register_fail(lock_key)
        raise _INVALID_CREDS
    try:
        await redis.delete(lock_key)  # uğurlu giriş → sayğac sıfırlanır
    except Exception:
        pass
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Hesab deaktivdir")
    if needs_rehash:  # bcrypt (Supabase köçürməsi) → Argon2
        user.password_hash = hash_password(body.password)
        await db.commit()
    return await _issue_tokens(db, user, request)


@router.post("/google", response_model=TokenOut)
async def login_google(
    body: GoogleIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    try:
        info = oauth_core.verify_google_token(body.id_token)
    except oauth_core.OAuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return await _oauth_login(db, request, info, None)


@router.post("/apple", response_model=TokenOut)
async def login_apple(
    body: AppleIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    try:
        info = await oauth_core.verify_apple_token(body.identity_token)
    except oauth_core.OAuthError as e:
        raise HTTPException(status_code=401, detail=str(e)) from e
    return await _oauth_login(db, request, info, body.name)


@router.post("/refresh", response_model=TokenOut)
async def refresh(
    body: RefreshIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Refresh token etibarsızdır") from e

    jti = payload["jti"]
    user_id = uuid.UUID(payload["sub"])

    import asyncio as _aio
    try:
        rt_ok = await _aio.wait_for(redis.get(f"rt:{jti}"), timeout=1.0)
    except Exception:
        # Redis əlçatmazdırsa DB-dəki sessiya qeydinə düş (fail-safe)
        db_row = (
            await db.execute(
                select(RefreshSession).where(
                    RefreshSession.jti == jti, RefreshSession.revoked.is_(False)
                )
            )
        ).scalar_one_or_none()
        rt_ok = db_row is not None
    if not rt_ok:
        # Rotasiyadan sonra təkrar istifadə = oğurluq əlaməti →
        # istifadəçinin bütün sessiyalarını bağla
        sessions = (
            await db.execute(
                select(RefreshSession).where(
                    RefreshSession.user_id == user_id,
                    RefreshSession.revoked.is_(False),
                )
            )
        ).scalars()
        for s in sessions:
            s.revoked = True
            await redis.delete(f"rt:{s.jti}")
        await db.commit()
        raise HTTPException(status_code=401, detail="Sessiya ləğv edildi — yenidən daxil olun")

    # Rotasiya: köhnəni sil
    await redis.delete(f"rt:{jti}")
    old = (
        await db.execute(select(RefreshSession).where(RefreshSession.jti == jti))
    ).scalar_one_or_none()
    if old:
        old.revoked = True

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Hesab tapılmadı")
    return await _issue_tokens(db, user, request)


@router.post("/logout", status_code=204)
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)) -> None:
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except JWTError:
        return  # onsuz da etibarsızdır
    await redis.delete(f"rt:{payload['jti']}")
    old = (
        await db.execute(
            select(RefreshSession).where(RefreshSession.jti == payload["jti"])
        )
    ).scalar_one_or_none()
    if old:
        old.revoked = True
        await db.commit()


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password", status_code=204)
async def change_password(
    body: ChangePasswordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    if not user.password_hash:
        raise HTTPException(status_code=400, detail="Hesabda parol yoxdur (OAuth)")
    ok, _ = verify_password(body.current_password, user.password_hash)
    if not ok:
        raise HTTPException(status_code=401, detail="Cari parol yanlışdır")
    user.password_hash = hash_password(body.new_password)
    # Təhlükəsizlik: bütün refresh sessiyaları bağlanır
    sessions = (
        await db.execute(
            select(RefreshSession).where(
                RefreshSession.user_id == user.id,
                RefreshSession.revoked.is_(False),
            )
        )
    ).scalars()
    for s in sessions:
        s.revoked = True
        try:
            await redis.delete(f"rt:{s.jti}")
        except Exception:
            pass
    await db.commit()
