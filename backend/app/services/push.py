"""FCM push bildirişləri — firebase-admin ilə (best-effort).

Mobil tətbiq iki ayrı Firebase layihəsindədir: Android (FIREBASE_CREDENTIALS_PATH)
və iOS (FIREBASE_IOS_CREDENTIALS_PATH). Hər cihazın tokeni öz platformasının
layihəsi ilə göndərilir; platforma bəlli deyilsə və ya layihə uyğun gəlmirsə
(SenderIdMismatch) digər layihə ilə yenidən cəhd olunur. Heç biri
konfiqurasiya olunmayıbsa səssiz keçir (development). Token həqiqətən
etibarsızdırsa user_devices-dən silinir.
"""
from __future__ import annotations

import asyncio
import time
import logging
import uuid

from sqlalchemy import text

from app.core.config import settings
from app.db.session import SessionLocal

log = logging.getLogger("ellit.push")
_apps: dict[str, object] | None = None


def _init() -> dict[str, object]:
    """{'android': app, 'ios': app} — yalnız konfiqurasiya olunanlar."""
    global _apps
    if _apps is not None:
        return _apps
    apps: dict[str, object] = {}
    try:
        import firebase_admin
        from firebase_admin import credentials

        for name, path in (("android", settings.FIREBASE_CREDENTIALS_PATH),
                           ("ios", settings.FIREBASE_IOS_CREDENTIALS_PATH)):
            if not path:
                continue
            try:
                apps[name] = firebase_admin.initialize_app(
                    credentials.Certificate(path), name=f"ellit-{name}")
            except Exception as e:  # noqa: BLE001
                log.warning("Firebase (%s) açarı yüklənmədi: %s", name, e)
    except Exception as e:  # noqa: BLE001
        log.warning("firebase-admin yoxdur: %s", e)
    _apps = apps
    return apps


def _apps_for(platform: str | None, apps: dict[str, object]) -> list[object]:
    """Əvvəl cihazın öz platformasının layihəsi, sonra digəri."""
    first = apps.get((platform or "").lower())
    rest = [a for a in apps.values() if a is not first]
    return ([first] if first is not None else []) + rest


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
    return name == "UnregisteredError" or (
        name == "InvalidArgumentError" and "registration token" in str(exc).lower())


def _is_wrong_project(exc: Exception) -> bool:
    """Token başqa Firebase layihəsinə aiddir — digər layihə ilə yoxlanmalıdır."""
    name = type(exc).__name__
    return name in ("SenderIdMismatchError", "ThirdPartyAuthError") or "mismatch" in str(exc).lower()


def _send_sync(devices: list[tuple[str, str | None]], title: str, body: str,
               data: dict, apps: dict[str, object],
               stats: dict | None = None) -> list[str]:
    """Etibarsız tokenləri qaytarır; `stats["sent"]` — uğurla göndərilənlərin sayı."""
    from firebase_admin import messaging

    bad: list[str] = []
    for token, platform in devices:
        candidates = _apps_for(platform, apps)
        for i, app in enumerate(candidates):
            try:
                messaging.send(build_message(token, title, body, data), app=app)
                if stats is not None:
                    stats["sent"] = stats.get("sent", 0) + 1
                break
            except Exception as e:  # noqa: BLE001
                if _is_wrong_project(e) and i + 1 < len(candidates):
                    continue
                if _is_dead_token(e) or _is_wrong_project(e):
                    bad.append(token)
                else:
                    log.warning("push göndərilmədi (%s): %s", platform, e)
                break
    return bad


_last_no_firebase_warn = 0.0


def _warn_no_firebase() -> None:
    """Firebase açarı yoxdur — hər bildirişdə yox, 10 dəqiqədə bir xəbərdarlıq."""
    global _last_no_firebase_warn
    now = time.monotonic()
    if now - _last_no_firebase_warn > 600 or _last_no_firebase_warn == 0.0:
        _last_no_firebase_warn = now
        log.warning("push GÖNDƏRİLMİR: Firebase açarı yoxdur (deploy/secrets/firebase*.json)"
                    " — yoxlama: python scripts/push_doctor.py")


async def send_push(
    user_id: uuid.UUID | str, title: str, body: str, data: dict | None = None
) -> None:
    """İstifadəçinin bütün cihazlarına push (fail olsa API dayanmır).

    Hər göndəriş loqa yazılır (kimə, neçə cihaz, neçəsi getdi) — "bildiriş
    niyə gəlmədi" sualına `docker compose logs worker | grep push` cavab verir."""
    apps = _init()
    if not apps:
        _warn_no_firebase()
        return
    try:
        async with SessionLocal() as db:
            rows = await db.execute(
                text("select fcm_token, platform from user_devices where user_id = :u"),
                {"u": user_id},
            )
            devices = [(r.fcm_token, r.platform) for r in rows if r.fcm_token]
        if not devices:
            log.info("push → %s: cihaz tokeni yoxdur (tətbiqdə giriş edilməyib və ya "
                     "bildiriş icazəsi verilməyib) — %s", user_id, (title or "")[:60])
            return
        stats: dict = {"sent": 0}
        bad = await asyncio.to_thread(
            _send_sync, devices, title, body, data or {}, apps, stats)
        log.info("push → %s: %d cihaz, %d göndərildi%s — %s", user_id, len(devices),
                 stats["sent"], f", {len(bad)} ölü token silindi" if bad else "",
                 (title or "")[:60])
        if bad:
            async with SessionLocal() as db:
                await db.execute(
                    text("delete from user_devices where fcm_token = any(:t)"),
                    {"t": bad},
                )
                await db.commit()
    except Exception as e:  # noqa: BLE001
        log.warning("push xətası: %s", e)


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
