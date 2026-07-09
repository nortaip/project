"""Auth nüvəsi: parol hash (Argon2 + köhnə bcrypt), JWT access/refresh.

Təhlükəsizlik qərarları:
  - Argon2id — müasir, GPU-hücumlarına davamlı parol hash-i.
  - Supabase-dən köçürülən istifadəçilərin bcrypt hash-ləri dəstəklənir;
    ilk uğurlu login-də şəffaf şəkildə Argon2-yə yenilənir (rehash).
  - Access token qısa ömürlü (15 dəq), refresh token rotasiya olunur və
    jti-si Redis-də saxlanır → oğurlanmış refresh dərhal ləğv edilə bilir.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from jose import JWTError, jwt

from app.core.config import settings

_argon2 = PasswordHasher(time_cost=3, memory_cost=65536, parallelism=2)


# ── Parol ─────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return _argon2.hash(password)


def verify_password(password: str, stored_hash: str) -> tuple[bool, bool]:
    """(uğurlu?, rehash lazımdır?) qaytarır."""
    if stored_hash.startswith("$argon2"):
        try:
            _argon2.verify(stored_hash, password)
            return True, _argon2.check_needs_rehash(stored_hash)
        except VerifyMismatchError:
            return False, False
    if stored_hash.startswith(("$2a$", "$2b$", "$2y$")):
        # Supabase köçürməsindən qalan bcrypt
        import bcrypt

        ok = bcrypt.checkpw(password.encode(), stored_hash.encode())
        return ok, ok  # uğurludursa Argon2-yə keçir
    return False, False


# ── JWT ───────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user_id: uuid.UUID, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": _now(),
        "exp": _now() + timedelta(minutes=settings.ACCESS_TOKEN_MINUTES),
        "jti": secrets.token_urlsafe(8),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID) -> tuple[str, str, datetime]:
    """(token, jti, expires_at) — jti Redis-də whitelist kimi saxlanır."""
    jti = secrets.token_urlsafe(16)
    exp = _now() + timedelta(days=settings.REFRESH_TOKEN_DAYS)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": _now(),
        "exp": exp,
        "jti": jti,
    }
    token = jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
    return token, jti, exp


def decode_token(token: str, expected_type: str) -> dict:
    """Etibarsız/dəyişdirilmiş token → JWTError qaldırır."""
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    if payload.get("type") != expected_type:
        raise JWTError("Yanlış token növü")
    return payload
