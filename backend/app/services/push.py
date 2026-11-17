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


# Mobil tətbiqin yüksək prioritetli kanalı (lib/services/notification_service.dart,
# AndroidManifest default_notification_channel_id) — tətbiq bağlı olanda da
# bildiriş səs/banner ilə göstərilsin.
ANDROID_CHANNEL_ID = "ellit_main"


def build_message(token: str, title: str, body: str, data: dict):
    from firebase_admin import messaging

    return messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in data.items()},
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                channel_id=ANDROID_CHANNEL_ID, sound="default"),
        ),
        apns=messaging.APNSConfig(
            headers={"apns-priority": "10", "apns-push-type": "alert"},
            payload=messaging.APNSPayload(aps=messaging.Aps(sound="default")),
        ),
    )


def _is_dead_token(exc: Exception) -> bool:
    """Yalnız həqiqətən etibarsız token silinir (şəbəkə xətası tokeni silməsin)."""
    name = type(exc).__name__
    return name in ("UnregisteredError", "SenderIdMismatchError") or (
        name == "InvalidArgumentError" and "registration token" in str(exc).lower())


def _send_sync(tokens: list[str], title: str, body: str, data: dict) -> list[str]:
    """Etibarsız tokenləri qaytarır."""
    from firebase_admin import messaging

    bad: list[str] = []
    for t in tokens:
        try:
            messaging.send(build_message(t, title, body, data))
        except Exception as e:  # noqa: BLE001
            if _is_dead_token(e):
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


async def send_notification_push(notif_id: str) -> bool:
    """notifications sətrini istifadəçinin cihazlarına göndər (push növbəsi)."""
    notif_id = str(notif_id)
    async with SessionLocal() as db:
        row = (await db.execute(
            text("select user_id, title, coalesce(body, '') as body, type, kind,"
                 " related_id, link from notifications where id = cast(:i as uuid)"),
            {"i": notif_id},
        )).first()
    if row is None:
        return False
    await send_push(row.user_id, row.title, row.body, {
        "type": row.type or row.kind or "info",
        "related_id": row.related_id or "",
        "notif_id": notif_id,
        **({"link": row.link} if row.link else {}),
    })
    return True
