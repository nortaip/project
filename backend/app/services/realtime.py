"""Realtime yayım — Redis pub/sub üzərindən istifadəçi kanallarına hadisələr.

WS gateway (app/ws/gateway.py) hər istifadəçini `user:{id}` kanalına
abunə edir; burada publish olunan hər hadisə həmin istifadəçinin açıq
bağlantılarına dərhal çatır (çox-instans işləyir).
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from app.db.session import redis


async def publish(user_id: uuid.UUID | str, event: str, payload: dict[str, Any]) -> None:
    """Hadisəni istifadəçinin kanalına göndər (xəta API-ni dayandırmır)."""
    msg = json.dumps(
        {
            "event": event,
            "payload": payload,
            "ts": datetime.now(timezone.utc).isoformat(),
        },
        default=str,
    )
    try:
        await redis.publish(f"user:{user_id}", msg)
    except Exception:
        # Realtime "best effort"-dur — data DB-də onsuz da var
        pass
