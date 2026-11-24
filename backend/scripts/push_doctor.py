"""Push bildirişlərinin diaqnostikası — serverdə işə salın:

    docker compose run --rm --no-deps api python scripts/push_doctor.py
    docker compose run --rm --no-deps api python scripts/push_doctor.py --email user@example.com

Yoxlayır:
  1. Firebase service account açarları (Android + iOS) var və oxunur;
  2. user_devices-də neçə cihaz tokeni var (platforma üzrə, son görülmə);
  3. son 24 saatda neçə bildiriş yaranıb (növlərə görə);
  4. --email verilsə: həmin istifadəçinin hər cihazına test push göndərir və
     Firebase-in cavabını göstərir (etibarsız token silinmir — yalnız hesabat).
Heç nə dəyişmir.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def ok(msg: str) -> None:
    print(f"  ✓ {msg}")


def bad(msg: str) -> None:
    print(f"  ✗ {msg}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", help="test push göndəriləcək istifadəçinin e-poçtu")
    args = ap.parse_args()

    from sqlalchemy import text

    from app.core.config import settings
    from app.db.session import SessionLocal
    from app.services import push

    problems = 0
    print("\n1) Firebase açarları (deploy/secrets → /run/secrets/ellit)")
    for name, path in (("android", settings.FIREBASE_CREDENTIALS_PATH),
                       ("ios", settings.FIREBASE_IOS_CREDENTIALS_PATH)):
        if not path:
            bad(f"{name}: .env-də yol verilməyib "
                f"({'FIREBASE_CREDENTIALS_PATH' if name == 'android' else 'FIREBASE_IOS_CREDENTIALS_PATH'})")
            problems += 1
            continue
        if not os.path.exists(path):
            bad(f"{name}: fayl YOXDUR: {path} — Firebase Console → Project settings → "
                "Service accounts → Generate new private key; faylı serverə "
                "~/project/deploy/secrets/ altına köçürün")
            problems += 1
            continue
        try:
            with open(path, encoding="utf-8") as f:
                j = json.load(f)
            if j.get("type") != "service_account":
                bad(f"{name}: {path} service account açarı deyil (type={j.get('type')}) — "
                    "google-services.json / GoogleService-Info.plist yox, "
                    "Service accounts-dan endirilən JSON lazımdır")
                problems += 1
            else:
                ok(f"{name}: {path} — layihə: {j.get('project_id')}, {j.get('client_email')}")
        except Exception as e:  # noqa: BLE001
            bad(f"{name}: {path} oxunmadı: {e}")
            problems += 1
    apps = push._init()
    if apps:
        ok(f"Firebase yükləndi: {', '.join(apps)}")
    else:
        bad("Heç bir Firebase açarı yüklənmədi — server HEÇ BİR push göndərmir")
        problems += 1

    async with SessionLocal() as db:
        print("\n2) Cihaz tokenləri (user_devices)")
        rows = (await db.execute(text(
            "select coalesce(platform, '?') as p, count(*) as n, max(last_seen) as last"
            "  from user_devices where fcm_token is not null group by 1 order by 1"))).all()
        if not rows:
            bad("Heç bir cihaz tokeni yoxdur — yeni mobil versiya ilə giriş edən olmayıb "
                "və ya tətbiq tokeni serverə yaza bilmir")
            problems += 1
        for r in rows:
            ok(f"{r.p}: {r.n} cihaz (son: {r.last})")

        print("\n3) Son 24 saatın bildirişləri")
        rows = (await db.execute(text(
            "select type, count(*) as n from notifications"
            " where created_at > now() - interval '24 hours'"
            " group by 1 order by 2 desc limit 15"))).all()
        if not rows:
            print("  (son 24 saatda bildiriş yaranmayıb)")
        for r in rows:
            print(f"    {r.n:>5}  {r.type}")

        if args.email:
            print(f"\n4) Test push: {args.email}")
            u = (await db.execute(text(
                "select id from users where lower(email) = lower(:e)"),
                {"e": args.email})).first()
            if u is None:
                bad("istifadəçi tapılmadı")
                return 1
            devs = (await db.execute(text(
                "select fcm_token, platform, last_seen from user_devices"
                " where user_id = :u and fcm_token is not null"), {"u": u.id})).all()
            if not devs:
                bad("bu istifadəçinin cihaz tokeni yoxdur — telefonda yeni versiya "
                    "ilə çıxıb yenidən daxil olun, bildiriş icazəsini verin")
                return 1
            if not apps:
                bad("Firebase yüklənmədiyi üçün göndərmək olmur (1-ci bəndə baxın)")
                return 1
            from firebase_admin import messaging
            for d in devs:
                tail = (d.fcm_token or "")[-8:]
                sent = False
                for app in push._apps_for(d.platform, apps):
                    try:
                        mid = messaging.send(push.build_message(
                            d.fcm_token, "Ellit test bildirişi",
                            "Bu bildirişi görürsünüzsə, push işləyir ✓",
                            {"type": "test"}), app=app)
                        ok(f"{d.platform} …{tail}: göndərildi ({app.name}) → {mid}")
                        sent = True
                        break
                    except Exception as e:  # noqa: BLE001
                        print(f"    {d.platform} …{tail} [{app.name}]: "
                              f"{type(e).__name__}: {str(e)[:160]}")
                if not sent:
                    problems += 1

    print("\nWorker-in push növbəsi: docker compose logs --since 1h worker | grep -i push")
    print("  ('push: LISTEN ellit_push aktivdir' olmalıdır; 'push göndərilmədi' sətirləri səbəbi göstərir)")
    print("\nNƏTİCƏ:", "problem tapılmadı ✓" if problems == 0 else f"{problems} problem ✗")
    return 0 if problems == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
