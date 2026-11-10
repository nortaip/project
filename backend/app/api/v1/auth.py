"""Auth endpointləri: qeydiyyat, giriş, refresh rotasiyası, Google/Apple, çıxış.

Giriş və qeydiyyat e-poçt VƏ YA telefon nömrəsi ilə işləyir (Supabase-dən
köçən istifadəçilərin bir hissəsinin yalnız telefonu var).

Təhlükəsizlik:
  - Login/register sərt rate-limit altındadır (brute-force).
  - Uğursuz login-də "email yoxdur" / "parol səhvdir" fərqləndirilmir
    (istifadəçi sadalama hücumunun qarşısı).
  - Refresh rotasiyası: köhnə jti dərhal ləğv edilir; təkrar istifadə
    aşkarlanarsa istifadəçinin BÜTÜN sessiyaları bağlanır (oğurluq əlaməti).
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr, Field, model_validator
from sqlalchemy import select, update
from sqlalchemy import text as sa_text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core import oauth as oauth_core
from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db, redis
from app.models.user import OAuthIdentity, RefreshSession, User
from app.services.identity import find_user, identifier_key, normalize_phone, phone_tail

router = APIRouter(prefix="/auth", tags=["auth"])

# ── Şemalar ───────────────────────────────────────────────────────
class RegisterIn(BaseModel):
    """Qeydiyyat e-poçt VƏ YA telefonla (ikisi də verilə bilər)."""

    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    role: str = Field(default="customer", pattern="^(customer|provider)$")

    @model_validator(mode="after")
    def _need_contact(self) -> "RegisterIn":
        if not self.email and not self.phone:
            raise ValueError("Email və ya telefon nömrəsi tələb olunur")
        if self.phone is not None:
            normalized = normalize_phone(self.phone)
            if normalized is None:
                raise ValueError("Telefon nömrəsi düzgün deyil")
            self.phone = normalized
        return self


class LoginIn(BaseModel):
    """`identifier` — e-poçt və ya telefon. Köhnə klientlər üçün `email`
    və `phone` sahələri də qəbul olunur."""

    identifier: str | None = Field(default=None, max_length=320)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=32)
    password: str = Field(max_length=128)

    @model_validator(mode="after")
    def _need_identifier(self) -> "LoginIn":
        ident = (self.identifier or self.email or self.phone or "").strip()
        if not ident:
            raise ValueError("Email və ya telefon nömrəsi tələb olunur")
        self.identifier = ident
        return self


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
# Bu bölmədəki funksiyalar iki giriş qatı tərəfindən paylaşılır:
#   * /api/v1/auth/*  (bu fayl)            — xətaları HTTPException-a çevirir
#   * /auth/v1/*      (app/compat/gotrue)  — xətaları GoTrue formatına çevirir
# Ona görə biznes qaydaları burada `AuthFailure` atır, HTTP-dən xəbərsizdir.
class AuthFailure(Exception):
    """Kimlik əməliyyatının rədd səbəbi (`code`):
    email_taken | phone_taken | locked | invalid_credentials | inactive |
    refresh_invalid | refresh_reused | user_gone"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


_FAILURE_HTTP: dict[str, tuple[int, str]] = {
    "email_taken": (409, "Bu email artıq qeydiyyatdadır"),
    "phone_taken": (409, "Bu telefon nömrəsi artıq qeydiyyatdadır"),
    "locked": (429, "Çox uğursuz cəhd — 15 dəqiqə sonra yenidən yoxlayın"),
    "invalid_credentials": (401, "Email/telefon və ya parol yanlışdır"),
    "inactive": (403, "Hesab deaktivdir"),
    "refresh_invalid": (401, "Refresh token etibarsızdır"),
    "refresh_reused": (401, "Sessiya ləğv edildi — yenidən daxil olun"),
    "user_gone": (401, "Hesab tapılmadı"),
}


def failure_message(code: str) -> str:
    return _FAILURE_HTTP[code][1]


def _http(e: AuthFailure) -> HTTPException:
    status_code, detail = _FAILURE_HTTP[e.code]
    return HTTPException(status_code=status_code, detail=detail)


def _access_ttl() -> int:
    return settings.ACCESS_TOKEN_MINUTES * 60


async def _bind_access(access_token: str, refresh_jti: str) -> None:
    """access token → onu doğuran refresh sessiyası (Redis, access ömrü qədər).
    "Yalnız bu cihazdan çıx" və "cari sessiyadan başqa hamısını bağla" üçün
    lazımdır — access token-in özündə sessiya identifikatoru yoxdur."""
    try:
        claims = jwt.get_unverified_claims(access_token)
        await redis.setex(f"at:{claims['jti']}", _access_ttl() + 60, refresh_jti)
    except Exception:  # noqa: BLE001 — xəritə olmasa çağıran tərəf sərt variantı seçir
        pass


async def current_refresh_jti(access_claims: dict) -> str | None:
    """Verilən access token-in bağlı olduğu refresh sessiyasının jti-si."""
    try:
        return await redis.get(f"at:{access_claims.get('jti')}")
    except Exception:  # noqa: BLE001
        return None


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
    await _bind_access(access, jti)
    return TokenOut(
        access_token=access, refresh_token=refresh, user_id=user.id, role=user.role
    )


async def revoke_sessions(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    keep_jti: str | None = None,
    only_jti: str | None = None,
    signed_out: bool = True,
) -> int:
    """İstifadəçinin refresh sessiyalarını bağlayır (DB + Redis) və commit edir.
    `only_jti` — yalnız həmin sessiya; `keep_jti` — ondan başqa hamısı.

    `signed_out=True` (çıxış, parol dəyişməsi): bağlanan token-lər `rtdead:<jti>`
    ilə "çıxış edilmiş" kimi işarələnir — həmin cihaz sonra köhnə token-ini
    göndərsə, bu rotasiyadan çıxmış token-in təkrarı (oğurluq) SAYILMIR və
    istifadəçinin digər (məs. parolu indicə dəyişən) cihazı çıxarılmır.
    Oğurluq aşkarlananda `signed_out=False` — işarə qoyulmur."""
    q = select(RefreshSession).where(
        RefreshSession.user_id == user_id, RefreshSession.revoked.is_(False)
    )
    if only_jti is not None:
        q = q.where(RefreshSession.jti == only_jti)
    sessions = [
        s for s in (await db.execute(q)).scalars().all() if s.jti != keep_jti
    ]
    for s in sessions:
        s.revoked = True
    await db.commit()
    now = datetime.now(timezone.utc)
    for s in sessions:
        try:
            await redis.delete(f"rt:{s.jti}")
            ttl = int((s.expires_at - now).total_seconds())
            if signed_out and ttl > 0:
                await redis.setex(f"rtdead:{s.jti}", ttl, "1")
        except Exception:  # noqa: BLE001 — DB-dəki revoke əsasdır
            pass
    return len(sessions)


async def create_account(
    db: AsyncSession,
    *,
    email: str | None,
    phone: str | None,
    password: str,
    name: str | None,
    role: str,
    commit: bool = True,
) -> User:
    """Yeni istifadəçi + domen profili. `phone` artıq normallaşdırılmış olmalıdır.
    Dublikat → AuthFailure(email_taken | phone_taken)."""
    email = email.lower() if email else None
    if email:
        existing = (
            await db.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing:
            raise AuthFailure("email_taken")
    if phone:
        # Format fərqlərinə davamlı yoxlama (son 9 rəqəm) — users + profiles
        taken = (
            await db.execute(
                sa_text(
                    "select 1 from users where right(regexp_replace(coalesce(phone, ''),"
                    " '\\D', '', 'g'), 9) = :t"
                    " union all"
                    " select 1 from profiles where right(regexp_replace("
                    "coalesce(phone_number, ''), '\\D', '', 'g'), 9) = :t limit 1"
                ),
                {"t": phone_tail(phone)},
            )
        ).first()
        if taken:
            raise AuthFailure("phone_taken")
    user = User(
        email=email,
        phone=phone,
        password_hash=hash_password(password),
        role=role,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError as e:  # eyni anda iki qeydiyyat (unikal indeks)
        await db.rollback()
        raise AuthFailure("phone_taken" if "phone" in str(e.orig) else "email_taken") from e
    # Domen profili (Supabase-dəki handle_new_user trigger-inin ekvivalenti)
    await db.execute(
        sa_text(
            "insert into profiles (id, email, phone_number, name, role)"
            " values (:id, :email, :phone, :name, :role) on conflict (id) do nothing"
        ),
        {"id": user.id, "email": user.email, "phone": phone,
         "name": name, "role": role},
    )
    if commit:
        await db.commit()
    return user


async def oauth_find_or_create(
    db: AsyncSession, info: dict, fallback_name: str | None
) -> User:
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
        raise AuthFailure("inactive")
    return user


async def _oauth_login(
    db: AsyncSession, request: Request, info: dict, fallback_name: str | None
) -> TokenOut:
    try:
        user = await oauth_find_or_create(db, info, fallback_name)
    except AuthFailure as e:
        raise _http(e) from e
    return await _issue_tokens(db, user, request)


# ── Endpointlər ───────────────────────────────────────────────────
@router.post("/register", response_model=TokenOut, status_code=201)
async def register(
    body: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    try:
        user = await create_account(
            db, email=body.email, phone=body.phone, password=body.password,
            name=body.name, role=body.role,
        )
    except AuthFailure as e:
        raise _http(e) from e
    return await _issue_tokens(db, user, request)


_LOCKOUT_LIMIT = 5          # ardıcıl uğursuz cəhd
_LOCKOUT_WINDOW = 900       # 15 dəqiqə


async def _check_lockout(email: str, ip: str) -> str:
    """Brute-force lockout açarı qaytarır; kilidlidirsə AuthFailure atır."""
    key = f"lock:{email}:{ip}"
    try:
        fails = int(await redis.get(key) or 0)
    except Exception:
        return key
    if fails >= _LOCKOUT_LIMIT:
        raise AuthFailure("locked")
    return key


async def _register_fail(key: str) -> None:
    try:
        n = await redis.incr(key)
        if n == 1:
            await redis.expire(key, _LOCKOUT_WINDOW)
    except Exception:
        pass


async def authenticate_password(
    db: AsyncSession, identifier: str, password: str, ip: str
) -> User:
    """E-poçt/telefon + parol yoxlaması: lockout, "hesab yoxdur"/"parol səhvdir"
    fərqləndirilməməsi, bcrypt → Argon2 rehash. Uğursuzluq → AuthFailure."""
    lock_key = await _check_lockout(identifier_key(identifier), ip)
    user = await find_user(db, identifier)
    if user is None or not user.password_hash:
        await _register_fail(lock_key)
        raise AuthFailure("invalid_credentials")
    ok, needs_rehash = verify_password(password, user.password_hash)
    if not ok:
        await _register_fail(lock_key)
        raise AuthFailure("invalid_credentials")
    try:
        await redis.delete(lock_key)  # uğurlu giriş → sayğac sıfırlanır
    except Exception:
        pass
    if not user.is_active:
        raise AuthFailure("inactive")
    if needs_rehash:  # bcrypt (Supabase köçürməsi) → Argon2
        user.password_hash = hash_password(password)
        await db.commit()
    return user


@router.post("/login", response_model=TokenOut)
async def login(
    body: LoginIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    ip = request.client.host if request.client else "?"
    try:
        user = await authenticate_password(db, body.identifier, body.password, ip)
    except AuthFailure as e:
        raise _http(e) from e
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


# Refresh token-in "iddiası": `rt:<jti>` açarını silən YEGANƏ sorğu rotasiya
# hüququ qazanır (atomik — eyni token-lə paralel iki sorğu iki sessiya doğura
# bilməz). `reuse_interval` > 0 olduqda qalib üçün qısa ömürlü `rtgrace:<jti>`
# açarı da elə həmin atomik addımda yaranır.
_CLAIM_REFRESH_LUA = """
if redis.call('DEL', KEYS[1]) == 1 then
  if tonumber(ARGV[1]) > 0 then
    redis.call('SET', KEYS[2], '', 'EX', ARGV[1])
  end
  return 1
end
return 0
"""


async def _grace_successor(jti: str) -> str | None:
    """Yenicə rotasiya olunmuş token üçün varisi (yeni refresh token) qaytarır.
    Qalib sorğu hələ yazmayıbsa qısa müddət gözləyir. Güzəşt pəncərəsi yoxdursa
    (və ya bitibsə) None."""
    for _ in range(60):  # ≈3 saniyə
        try:
            val = await redis.get(f"rtgrace:{jti}")
        except Exception:  # noqa: BLE001
            return None
        if val is None:
            return None
        if val:
            return val
        await asyncio.sleep(0.05)
    return None


async def rotate_refresh_session(
    db: AsyncSession, request: Request, refresh_token: str, *, reuse_interval: int = 0
) -> tuple[User, TokenOut]:
    """Refresh rotasiyası: köhnə jti dərhal ləğv olunur, yenisi verilir.

    Rotasiyadan çıxmış token-in təkrar istifadəsi oğurluq əlaməti sayılır və
    istifadəçinin BÜTÜN sessiyaları bağlanır (AuthFailure("refresh_reused")).

    `reuse_interval` (saniyə, standart 0 = güzəşt yoxdur): eyni token bu müddət
    ərzində ikinci dəfə gələrsə (iki brauzer tabı, itmiş cavabdan sonra təkrar
    cəhd) oğurluq sayılmır — sorğu ilk rotasiyanın verdiyi EYNİ yeni refresh
    token-i alır, yeni sessiya yaranmır. Pəncərə bitəndən sonra adi qayda işləyir.
    """
    try:
        payload = decode_token(refresh_token, "refresh")
        jti = payload["jti"]
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, KeyError, ValueError) as e:
        raise AuthFailure("refresh_invalid") from e

    redis_up = True
    try:
        claimed = bool(
            await asyncio.wait_for(
                redis.eval(_CLAIM_REFRESH_LUA, 2, f"rt:{jti}", f"rtgrace:{jti}",
                           str(max(int(reuse_interval), 0))),
                timeout=1.0,
            )
        )
    except Exception:  # noqa: BLE001
        # Redis əlçatmazdırsa DB-dəki sessiya qeydinə düş (fail-safe) — iddia
        # yenə atomikdir: sətri `revoked=false`-dan çıxaran sorğu qalibdir
        redis_up = False
        res = await db.execute(
            update(RefreshSession)
            .where(RefreshSession.jti == jti, RefreshSession.revoked.is_(False))
            .values(revoked=True)
            .returning(RefreshSession.jti)
        )
        claimed = res.first() is not None
        await db.commit()

    if not claimed:
        if reuse_interval > 0 and redis_up:
            successor = await _grace_successor(jti)
            if successor:
                try:
                    succ_jti = decode_token(successor, "refresh")["jti"]
                    alive = await redis.get(f"rt:{succ_jti}")
                except Exception:  # noqa: BLE001
                    succ_jti, alive = None, None
                user = (
                    await db.execute(select(User).where(User.id == user_id))
                ).scalar_one_or_none()
                if alive and user is not None and user.is_active:
                    access = create_access_token(user.id, user.role)
                    await _bind_access(access, succ_jti)
                    return user, TokenOut(
                        access_token=access, refresh_token=successor,
                        user_id=user.id, role=user.role,
                    )
        # Çıxış / parol dəyişməsi ilə bağlanmış sessiyanın token-i: sadəcə etibarsız
        try:
            if await redis.get(f"rtdead:{jti}"):
                raise AuthFailure("refresh_invalid")
        except AuthFailure:
            raise
        except Exception:  # noqa: BLE001 — işarə oxunmursa sərt qayda
            pass
        # Rotasiyadan sonra təkrar istifadə = oğurluq əlaməti →
        # istifadəçinin bütün sessiyalarını bağla
        await revoke_sessions(db, user_id, signed_out=False)
        raise AuthFailure("refresh_reused")

    # Rotasiya: köhnəni sil
    old = (
        await db.execute(select(RefreshSession).where(RefreshSession.jti == jti))
    ).scalar_one_or_none()
    if old:
        old.revoked = True

    user = (
        await db.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        await db.commit()
        raise AuthFailure("user_gone")
    tokens = await _issue_tokens(db, user, request)
    if reuse_interval > 0 and redis_up:
        try:
            await redis.set(f"rtgrace:{jti}", tokens.refresh_token, ex=int(reuse_interval))
        except Exception:  # noqa: BLE001 — güzəşt olmasa sərt qayda işləyir
            pass
    return user, tokens


@router.post("/refresh", response_model=TokenOut)
async def refresh(
    body: RefreshIn, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenOut:
    try:
        _, tokens = await rotate_refresh_session(db, request, body.refresh_token)
    except AuthFailure as e:
        raise _http(e) from e
    return tokens


@router.post("/logout")
async def logout(body: RefreshIn, db: AsyncSession = Depends(get_db)) -> dict:
    try:
        payload = decode_token(body.refresh_token, "refresh")
    except JWTError:
        return {"ok": True}  # onsuz da etibarsızdır
    await redis.delete(f"rt:{payload['jti']}")
    old = (
        await db.execute(
            select(RefreshSession).where(RefreshSession.jti == payload["jti"])
        )
    ).scalar_one_or_none()
    if old:
        old.revoked = True
        await db.commit()
    return {"ok": True}


class ChangePasswordIn(BaseModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
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
    return {"ok": True}
