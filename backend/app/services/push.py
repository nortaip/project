"""FCM push bildirişləri — firebase-admin ilə (best-effort).

FIREBASE_CREDENTIALS_PATH konfiqurasiya olunmayıbsa səssiz keçir
(development). Token etibarsızdırsa user_devices-dən silinir.
"""
from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal

_app = None


def _init():
    global _app
    if _app is not None or not settings.FIREBASE_CREDENTIALS_PATH:
        return _app
    try:
        import firebase_admin
        from firebase_admin import credentials

        cred = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
        _app = firebase_admin.initialize_app(cred)
    except Exception:
        _app = None
    return _app


def _send_sync(tokens: list[str], title: str, body: str, data: dict) -> list[str]:
    """Uğursuz (etibarsız) tokenləri qaytarır."""
    from firebase_admin import messaging

    bad: list[str] = []
    for t in tokens:
        try:
            messaging.send(
                messaging.Message(
                    token=t,
                    notification=messaging.Notification(title=title, body=body),
                    data={k: str(v) for k, v in data.items()},
                )
            )
        except Exception:
            bad.append(t)
    return bad


async def send_push(
    user_id: uuid.UUID | str, title: str, body: str, data: dict | None = None
) -> None:
    """İstifadəçinin bütün cihazlarına push (fail olsa API dayanmır)."""
    if _init() is None:
        return
    try:
        async with SessionLocal() as db:
            rows = await db.execute(
                text("select fcm_token from user_devices where user_id = :u"),
                {"u": user_id},
            )
            tokens = [r.fcm_token for r in rows]
        if not tokens:
            return
        bad = await asyncio.to_thread(_send_sync, tokens, title, body, data or {})
        if bad:
            async with SessionLocal() as db:
                await db.execute(
                    text("delete from user_devices where fcm_token = any(:t)"),
                    {"t": bad},
                )
                await db.commit()
    except Exception:
        pass
