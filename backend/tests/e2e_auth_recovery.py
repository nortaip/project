"""E2E — parol bərpası, telefonla giriş, audit konteksti (real PostgreSQL + Redis).

Yoxlanılır:
  * "Parolu unutdum": kod sorğusu → e-poçt (lokal SMTP tutucu) → səhv kod →
    düz kod → köhnə parol/sessiya ölür, yeni parol işləyir
  * sadalama qoruması, saatlıq limit, vaxtı bitmiş kod, 5 səhv cəhd
  * telefonla qeydiyyat/giriş (müxtəlif formatlar), telefonla bərpa
  * "kod gəlmədi" — telefon identifikatoru ilə e-poçt fallback + maskalı ipucu
  * giriş etmiş istifadəçinin OTP ilə parol dəyişməsi
  * Supabase-dən köçmüş bcrypt + yalnız-telefon istifadəçi
  * `app.user_id` konteksti → opportunity_audit_log aktyoru; status trigger-i

İşə salma (təmiz baza üzərində, e2e_smoke-dan asılı deyil):
    python tests/e2e_auth_recovery.py
"""
from __future__ import annotations

import asyncio
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SMTP_PORT = 58025
os.environ.setdefault("SMTP_HOST", "127.0.0.1")
os.environ.setdefault("SMTP_PORT", str(SMTP_PORT))
os.environ.setdefault("SMTP_SECURITY", "none")
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")  # IP limiti bu testin mövzusu deyil

import httpx  # noqa: E402
from aiosmtpd.controller import Controller  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


class _Inbox:
    """Lokal SMTP tutucu — göndərilən məktublar yaddaşda qalır."""

    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    async def handle_DATA(self, server, session, envelope):  # noqa: N802, ANN001
        self.messages.append(
            (envelope.rcpt_tos[0], envelope.content.decode("utf-8", "replace"))
        )
        return "250 OK"

    def last_code(self, to: str) -> str:
        for rcpt, content in reversed(self.messages):
            if rcpt == to:
                m = re.search(r"Subject:.*?(\d{6})", content)
                if m:
                    return m.group(1)
                # mövzu MIME ilə kodlaşdırılıbsa — gövdədən götür
                import email

                msg = email.message_from_string(content)
                body = msg.get_body(preferencelist=("plain",)) if hasattr(msg, "get_body") else None
                text = body.get_content() if body else content
                return re.search(r"\b(\d{6})\b", text).group(1)
        raise AssertionError(f"{to} üçün məktub yoxdur")


async def main() -> None:
    from sqlalchemy import text

    from app.db.session import SessionLocal
    from app.main import app

    inbox = _Inbox()
    smtp = Controller(inbox, hostname="127.0.0.1", port=SMTP_PORT)
    smtp.start()

    async def notif_code(user_id: str) -> str:
        async with SessionLocal() as db:
            row = (await db.execute(text(
                "select body from notifications where user_id = :u"
                " and type = 'password_otp' order by created_at desc limit 1"),
                {"u": user_id})).first()
        return re.search(r"\b(\d{6})\b", row.body).group(1)

    P = "/api/v1/auth"
    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            # ── 1. E-poçtla hesab + bərpa ──
            r = await c.post(f"{P}/register", json={
                "email": "aysel@test.az", "password": "KohneParol#1", "name": "Aysel"})
            check("e-poçtla qeydiyyat", r.status_code == 201, r.text[:120])
            a = r.json()

            r = await c.post(f"{P}/password-reset/request", json={"identifier": "Aysel@Test.az"})
            check("bərpa kodu sorğusu", r.status_code == 200 and r.json()["ok"] is True)
            r2 = await c.post(f"{P}/password-reset/request", json={"identifier": "yoxdur@test.az"})
            check("olmayan hesab eyni cavabı alır (sadalama qoruması)",
                  r2.status_code == 200 and r2.json() == r.json())
            await asyncio.sleep(0.3)
            code = inbox.last_code("aysel@test.az")
            check("kod e-poçtla gəldi", len(code) == 6)
            check("eyni kod tətbiq bildirişində də var", await notif_code(a["user_id"]) == code)
            async with SessionLocal() as db:
                stored = (await db.execute(text(
                    "select otp from password_otps where user_id = :u and used = false"),
                    {"u": a["user_id"]})).scalar()
            check("kod bazada açıq saxlanmır (HMAC)", stored != code and len(stored) == 64)

            wrong = "000000" if code != "000000" else "111111"
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": wrong, "new_password": "YeniParol#22"})
            d = r.json()["detail"]
            check("səhv kod rədd olunur", r.status_code == 400
                  and d["code"] == "WRONG_CODE" and d["attempts_left"] == 4, str(d))
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": code, "new_password": "qısa"})
            check("zəif parol rədd olunur (min 8)", r.status_code == 422)
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": code, "new_password": "YeniParol#22"})
            check("düz kodla parol yeniləndi", r.status_code == 200, r.text[:160])

            r = await c.post(f"{P}/login", json={"email": "aysel@test.az", "password": "KohneParol#1"})
            check("köhnə parol artıq işləmir", r.status_code == 401)
            r = await c.post(f"{P}/login", json={"email": "aysel@test.az", "password": "YeniParol#22"})
            check("yeni parolla giriş", r.status_code == 200)
            a_new = r.json()
            r = await c.post(f"{P}/refresh", json={"refresh_token": a["refresh_token"]})
            check("köhnə sessiyalar bağlandı (refresh ölüb)", r.status_code == 401)
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": code, "new_password": "BashqaParol#3"})
            check("kod ikinci dəfə işləmir", r.status_code == 400
                  and r.json()["detail"]["code"] == "NO_OTP")
            ah = {"Authorization": f"Bearer {a_new['access_token']}"}
            r = await c.get("/api/v1/notifications", headers=ah)
            check("təhlükəsizlik bildirişi yaradıldı",
                  any(n["type"] == "security" for n in r.json()))

            # ── 2. Vaxtı bitmiş kod + 5 səhv cəhd ──
            r = await c.post(f"{P}/password-reset/request", json={"identifier": "aysel@test.az"})
            await asyncio.sleep(0.3)
            code = inbox.last_code("aysel@test.az")
            async with SessionLocal() as db:
                await db.execute(text(
                    "update password_otps set expires_at = now() - interval '1 minute'"
                    " where user_id = :u and used = false"), {"u": a["user_id"]})
                await db.commit()
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": code, "new_password": "YeniParol#33"})
            check("vaxtı bitmiş kod rədd olunur", r.status_code == 400
                  and r.json()["detail"]["code"] == "EXPIRED")

            r = await c.post(f"{P}/password-reset/request", json={"identifier": "aysel@test.az"})
            await asyncio.sleep(0.3)
            code = inbox.last_code("aysel@test.az")
            wrong = "000000" if code != "000000" else "111111"
            last = None
            for _ in range(5):
                last = await c.post(f"{P}/password-reset/confirm", json={
                    "identifier": "aysel@test.az", "otp": wrong, "new_password": "YeniParol#33"})
            check("5 səhv cəhddən sonra kod yanır",
                  last.json()["detail"]["code"] == "TOO_MANY_ATTEMPTS")
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "aysel@test.az", "otp": code, "new_password": "YeniParol#33"})
            check("yanmış kod düz olsa da işləmir", r.status_code == 400)

            r = await c.post(f"{P}/password-reset/request", json={"identifier": "aysel@test.az"})
            check("saatda 3 sorğudan sonra limit", r.status_code == 429
                  and r.json()["detail"]["code"] == "TOO_MANY_REQUESTS")
            r = await c.post(f"{P}/login", json={"email": "aysel@test.az", "password": "YeniParol#22"})
            check("uğursuz bərpa cəhdləri parolu dəyişmir", r.status_code == 200)

            # ── 3. Telefonla qeydiyyat / giriş ──
            r = await c.post(f"{P}/register", json={
                "phone": "+994 50 123 45 67", "password": "Telefon#Parol1",
                "name": "Rəşad", "role": "provider"})
            check("telefonla qeydiyyat", r.status_code == 201, r.text[:160])
            b = r.json()
            async with SessionLocal() as db:
                row = (await db.execute(text(
                    "select u.phone, p.phone_number, p.role from users u"
                    " join profiles p on p.id = u.id where u.id = :u"),
                    {"u": b["user_id"]})).first()
            check("telefon normallaşdırılıb saxlanır",
                  row.phone == "994501234567" and row.phone_number == "994501234567"
                  and row.role == "provider")
            for ident in ("0501234567", "501234567", "+994501234567", "994 50 123-45-67"):
                r = await c.post(f"{P}/login", json={
                    "identifier": ident, "password": "Telefon#Parol1"})
                check(f"telefonla giriş ({ident})", r.status_code == 200, r.text[:120])
            r = await c.post(f"{P}/login", json={"phone": "0501234567", "password": "SEHV"})
            check("telefon + səhv parol rədd olunur", r.status_code == 401)
            r = await c.post(f"{P}/register", json={
                "phone": "050 123 45 67", "password": "Telefon#Parol9", "name": "Təkrar"})
            check("eyni telefon ikinci dəfə qeydiyyatdan keçmir", r.status_code == 409)
            r = await c.post(f"{P}/register", json={"password": "Telefon#Parol9", "name": "Boş"})
            check("email də, telefon da yoxdursa rədd", r.status_code == 422)

            # ── 4. Telefonla bərpa (e-poçtu olmayan hesab → tətbiq bildirişi) ──
            r = await c.post(f"{P}/password-reset/request", json={"identifier": "050-123-45-67"})
            check("telefonla bərpa sorğusu", r.status_code == 200)
            code = await notif_code(b["user_id"])
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "0501234567", "otp": code, "new_password": "Telefon#Yeni2"})
            check("telefonla parol yeniləndi", r.status_code == 200, r.text[:160])
            r = await c.post(f"{P}/login", json={
                "identifier": "0501234567", "password": "Telefon#Yeni2"})
            check("telefon + yeni parolla giriş", r.status_code == 200)
            b_new = r.json()
            r = await c.post(f"{P}/password-reset/email", json={"identifier": "0501234567"})
            check("e-poçtu olmayan hesabda fallback 404", r.status_code == 404
                  and r.json()["detail"]["code"] == "NO_EMAIL")

            # ── 5. "Kod gəlmədi" — telefon identifikatoru, e-poçtla çatdırma ──
            async with SessionLocal() as db:
                await db.execute(text(
                    "update profiles set phone_number = '+994 (55) 987-65-43' where id = :u"),
                    {"u": a["user_id"]})
                await db.commit()
            await (await _redis()).delete("otp:req:aysel@test.az")
            n_before = len(inbox.messages)
            r = await c.post(f"{P}/password-reset/email", json={"identifier": "055 987 65 43"})
            check("telefonla axtarış → e-poçt fallback", r.status_code == 200
                  and r.json()["email_hint"] == "a•••@t•••.az", r.text[:160])
            await asyncio.sleep(0.3)
            check("fallback məktubu göndərildi", len(inbox.messages) == n_before + 1)
            code = inbox.last_code("aysel@test.az")
            r = await c.post(f"{P}/password-reset/confirm", json={
                "identifier": "0559876543", "otp": code, "new_password": "Fallback#Parol4"})
            check("fallback kodu ilə parol yeniləndi", r.status_code == 200, r.text[:160])

            # ── 6. Giriş etmiş istifadəçi: OTP ilə parol dəyişmə ──
            bh = {"Authorization": f"Bearer {b_new['access_token']}"}
            r = await c.post(f"{P}/password-change/request", headers=bh)
            check("parol dəyişmə kodu sorğusu", r.status_code == 200)
            code = await notif_code(b["user_id"])
            r = await c.post(f"{P}/password-change/confirm", headers=bh, json={
                "otp": code, "new_password": "Telefon#Yeni2"})
            check("eyni parol rədd olunur", r.status_code == 400
                  and r.json()["detail"]["code"] == "SAME_PASSWORD")
            r = await c.post(f"{P}/password-change/confirm", headers=bh, json={
                "otp": code, "new_password": "Telefon#Uchuncu3"})
            check("OTP ilə parol dəyişdi", r.status_code == 200, r.text[:160])
            r = await c.post(f"{P}/password-change/request")
            check("parol dəyişmə token tələb edir", r.status_code == 401)
            r = await c.post(f"{P}/login", json={
                "identifier": "0501234567", "password": "Telefon#Uchuncu3"})
            check("dəyişmiş parolla giriş", r.status_code == 200)
            bh = {"Authorization": f"Bearer {r.json()['access_token']}"}

            # ── 7. Supabase-dən köçmüş istifadəçi: bcrypt + yalnız telefon ──
            import bcrypt

            legacy_hash = bcrypt.hashpw(b"SupabaseParol1", bcrypt.gensalt(rounds=10)).decode()
            async with SessionLocal() as db:
                uid = (await db.execute(text(
                    "insert into users (phone, password_hash, role)"
                    " values ('994701112233', :h, 'customer') returning id"),
                    {"h": legacy_hash})).scalar()
                await db.execute(text(
                    "insert into profiles (id, name, role, phone_number)"
                    " values (:i, 'Köhnə İstifadəçi', 'customer', '+994701112233')"), {"i": uid})
                await db.commit()
            r = await c.post(f"{P}/login", json={
                "identifier": "070 111 22 33", "password": "SupabaseParol1"})
            check("köçmüş (bcrypt, telefon) istifadəçi köhnə parolu ilə girir",
                  r.status_code == 200, r.text[:160])
            async with SessionLocal() as db:
                h = (await db.execute(text(
                    "select password_hash from users where id = :i"), {"i": uid})).scalar()
            check("hash şəffaf şəkildə Argon2-yə yeniləndi", h.startswith("$argon2"))

            # ── 8. Audit konteksti (auth.uid() əvəzi) + status trigger-i ──
            r = await c.post(f"{P}/login", json={
                "email": "aysel@test.az", "password": "Fallback#Parol4"})
            ah = {"Authorization": f"Bearer {r.json()['access_token']}"}
            async with SessionLocal() as db:
                cat_id = str((await db.execute(text(
                    "insert into service_categories (label) values ('Elektrik') returning id"
                ))).scalar())
                await db.commit()
            r = await c.post("/api/v1/opportunities", headers=ah, json={
                "title": "Rozetka işləmir", "category_id": cat_id, "date": "2026-12-01"})
            check("sifariş yaradıldı", r.status_code == 201, r.text[:160])
            opp = r.json()["id"]
            r = await c.post(f"/api/v1/opportunities/{opp}/cancel", headers=ah,
                             json={"reason": "Planlar dəyişdi"})
            check("sifariş ləğv edildi", r.status_code == 200, r.text[:160])
            async with SessionLocal() as db:
                log = (await db.execute(text(
                    "select old_status, new_status, actor_id::text as actor, actor_role, reason"
                    " from opportunity_audit_log where opportunity_id = :o"), {"o": opp})).first()
            check("audit log aktyoru API istifadəçisidir",
                  log is not None and log.actor == a["user_id"]
                  and log.actor_role == "customer" and log.new_status == "cancelled"
                  and log.reason == "Planlar dəyişdi", str(log))

            async with SessionLocal() as db:
                try:
                    await db.execute(text(
                        "update opportunities set status = 'ongoing' where id = :o"), {"o": opp})
                    blocked = False
                except Exception as e:  # noqa: BLE001
                    blocked = "INVALID_STATUS_TRANSITION" in str(e)
                await db.rollback()
            check("baza qadağan status keçidini rədd edir (cancelled → ongoing)", blocked)
            async with SessionLocal() as db:
                leaked = (await db.execute(text(
                    "select current_setting('app.user_id', true)"))).scalar()
            check("aktyor konteksti başqa bağlantıya sızmır", not leaked)
    finally:
        smtp.stop()

    print("\nAUTH BƏRPA E2E TESTLƏRİ KEÇDİ ✓")


async def _redis():
    from app.db.session import redis

    return redis


if __name__ == "__main__":
    asyncio.run(main())
