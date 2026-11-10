"""Ümumi dependency-lər: cari istifadəçi, rol yoxlaması (RBAC)."""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decode_token
from app.db.session import get_db, set_actor
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: AsyncSession = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tələb olunur",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = decode_token(creds.credentials, "access")
    except JWTError as e:
        raise HTTPException(status_code=401, detail="Token etibarsızdır") from e
    user = (
        await db.execute(select(User).where(User.id == uuid.UUID(payload["sub"])))
    ).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Hesab aktiv deyil")
    # Audit trigger-ləri üçün "kim etdi" konteksti (auth.uid() əvəzi)
    await set_actor(db, user.id)
    return user


def require_roles(*roles: str):
    """İstifadə: Depends(require_roles('admin', 'superadmin'))"""

    async def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="İcazə yoxdur")
        return user

    return checker
