"""Sorğunu edən şəxs (anon / giriş etmiş) və RLS konteksti."""
from __future__ import annotations

import json
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field

import asyncpg
from fastapi import Request
from jose import ExpiredSignatureError, JWTError

from app.compat.errors import ApiError
from app.core.security import decode_token
from app.db.session import engine

ADMIN_ROLES = ("admin", "master", "superadmin")


@dataclass
class Caller:
    user_id: uuid.UUID | None = None
    app_role: str | None = None            # customer | provider | admin ...
    claims: dict = field(default_factory=dict)

    @property
    def authenticated(self) -> bool:
        return self.user_id is not None

    @property
    def db_role(self) -> str:
        return "authenticated" if self.authenticated else "anon"

    @property
    def is_admin(self) -> bool:
        return (self.app_role or "") in ADMIN_ROLES


def bearer_token(request: Request) -> str | None:
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        return auth[7:].strip() or None
    return None


def caller_from_token(token: str | None) -> Caller:
    """Bizim access token → giriş etmiş; başqa hər şey (o cümlədən klientin
    `anon key`-i) → anonim. Vaxtı bitmiş token 401 verir ki, klient yeniləsin."""
    if not token:
        return Caller()
    try:
        payload = decode_token(token, "access")
    except ExpiredSignatureError as e:
        raise ApiError(401, "PGRST301", "JWT expired") from e
    except JWTError:
        return Caller()
    try:
        uid = uuid.UUID(payload["sub"])
    except (KeyError, ValueError):
        return Caller()
    return Caller(user_id=uid, app_role=payload.get("role"), claims=payload)


def get_caller(request: Request) -> Caller:
    return caller_from_token(bearer_token(request))


def require_user(caller: Caller) -> uuid.UUID:
    if caller.user_id is None:
        raise ApiError(401, "PGRST301", "Giriş tələb olunur")
    return caller.user_id


@asynccontextmanager
async def rls_connection(caller: Caller):
    """Klient adından sorğular üçün bağlantı: tranzaksiya daxilində
    `SET LOCAL ROLE anon|authenticated` + auth.uid() konteksti. Bundan sonra
    icra olunan hər sorğuya PostgreSQL RLS siyasətləri tətbiq olunur.
    Çıxışda commit (xəta olsa rollback) — rol və kontekst tranzaksiya ilə bitir."""
    async with engine.connect() as sa_conn:
        raw = await sa_conn.get_raw_connection()
        conn: asyncpg.Connection = raw.driver_connection
        tx = conn.transaction()
        await tx.start()
        try:
            await conn.execute(
                "select set_config('app.user_id', $1, true),"
                " set_config('app.role', $2, true), set_config('app.claims', $3, true)",
                str(caller.user_id) if caller.user_id else "", caller.db_role,
                json.dumps({"sub": str(caller.user_id) if caller.user_id else None,
                            "role": caller.db_role,
                            "email": caller.claims.get("email")}),
            )
            await conn.execute(f"set local role {caller.db_role}")
            yield conn
        except BaseException:
            await tx.rollback()
            raise
        else:
            await tx.commit()
