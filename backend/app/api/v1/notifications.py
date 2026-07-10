"""Bildirişlər — siyahı, oxunmamış sayı, oxunmuş işarələmə."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("")
async def list_notifications(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, type, title, body, related_id, is_read, created_at"
            " from notifications where user_id = :u"
            " order by created_at desc limit :l offset :o"
        ),
        {"u": user.id, "l": limit, "o": offset},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/unread-count")
async def unread_count(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    row = (
        await db.execute(
            text("select count(*) as c from notifications where user_id=:u and not is_read"),
            {"u": user.id},
        )
    ).first()
    return {"count": row.c}


@router.post("/{notification_id}/read")
async def mark_read(
    notification_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    await db.execute(
        text("update notifications set is_read=true where id=:id and user_id=:u"),
        {"id": notification_id, "u": user.id},
    )
    await db.commit()
    return {"ok": True}


@router.post("/read-all")
async def mark_all_read(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    await db.execute(
        text("update notifications set is_read=true where user_id=:u and not is_read"),
        {"u": user.id},
    )
    await db.commit()
    return {"ok": True}


class DeviceIn(BaseModel):
    platform: str = Field(pattern="^(ios|android|web)$")
    fcm_token: str = Field(min_length=10, max_length=500)


@router.post("/devices", status_code=201)
async def register_device(
    body: DeviceIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """FCM token qeydiyyatı (push bildirişlər üçün)."""
    await db.execute(
        text(
            "insert into user_devices (user_id, platform, fcm_token, last_seen)"
            " values (:u, :p, :t, now())"
            " on conflict (user_id, fcm_token) do update set last_seen = now()"
        ),
        {"u": user.id, "p": body.platform, "t": body.fcm_token},
    )
    await db.commit()
    return {"ok": True}
