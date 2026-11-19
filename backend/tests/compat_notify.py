"""Bildiriş trigger-ləri (/rest/v1 yazıları) + push növbəsi testi.

Klientlər (veb, mobil) sifariş, təklif, status və çat mesajını birbaşa
/rest/v1 ilə yazır. Supabase-də bunların bildirişini bazanın trigger-ləri
yaradırdı; burada db/notify_triggers.sql eyni işi görür — yalnız /rest/v1
yazılarında (Python RPC/API yolları bildirişi özü yaradır, ikiqat olmasın).
Hər bildiriş `pg_notify('ellit_push')` edir və worker FCM göndərir.

İşə salma (təmiz baza + `alembic upgrade head` sonra):
    python tests/compat_notify.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("RATE_LIMIT_AUTH", "100000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import asyncpg  # noqa: E402
import httpx  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


def pg_dsn() -> str:
    return os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")


async def main() -> None:
    from app.main import app
    from app.services import push, push_listener

    db = await asyncpg.connect(pg_dsn())
    pushed: list[str] = []

    async def fake_send(nid: str) -> bool:
        pushed.append(nid)
        return True

    push_listener.send_notification_push = fake_send
    listener = asyncio.create_task(push_listener.run_forever())

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        H = {"apikey": "ellit-public"}

        async def signup(email: str, name: str) -> tuple[str, str]:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": name}})
            j = r.json()
            assert r.status_code == 200, r.text
            return j["user"]["id"], j["access_token"]

        def auth(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        async def notifs(uid: str, ntype: str | None = None) -> list:
            q = "select * from notifications where user_id = $1::uuid"
            args: list = [uid]
            if ntype:
                q += " and type = $2"
                args.append(ntype)
            return await db.fetch(q, *args)

        cat = await db.fetchval(
            "insert into service_categories (label) values ('Santexnika') returning id::text")
        other = await db.fetchval(
            "insert into service_categories (label) values ('Elektrik') returning id::text")

        cust, cust_tok = await signup("musteri@notify.az", "Müştəri")
        p_id, p_tok = await signup("usta.id@notify.az", "Usta ID")          # ixtisas: ID
        p_lbl, _ = await signup("usta.ad@notify.az", "Usta Ad")             # ixtisas: ad (veb)
        p_any, _ = await signup("usta.hamisi@notify.az", "Usta Hamısı")     # ixtisas yoxdur
        p_off, _ = await signup("usta.oflayn@notify.az", "Usta Oflayn")     # oflayn
        p_oth, _ = await signup("usta.diger@notify.az", "Usta Digər")       # başqa kateqoriya
        for uid, spec, online in ((p_id, [cat], True), (p_lbl, ["Santexnika"], True),
                                  (p_any, [], True), (p_off, [cat], False),
                                  (p_oth, [other], True)):
            await db.execute(
                "update profiles set role = 'provider', is_verified = true, specialties = $2,"
                " is_online = $3 where id = $1::uuid", uid, spec, online)
            await db.execute("update users set role = 'provider' where id = $1::uuid", uid)

        print("\n── 1. Yeni sifariş (veb/mobil: POST /rest/v1/opportunities) ──")
        r = await c.post("/rest/v1/opportunities", headers=auth(cust_tok), json={
            "title": "Kran axır", "description": "Mətbəxdə", "created_by": cust,
            "date": "2026-12-20", "location": "Bakı", "category_id": cat, "status": "pending"})
        check("sifariş /rest/v1 ilə yarandı", r.status_code == 201, r.text[:200])
        opp = r.json()[0]["id"]
        got = {u: len([n for n in await notifs(u, "new_opportunity") if n["related_id"] == opp])
               for u in (p_id, p_lbl, p_any, p_off, p_oth, cust)}
        check("ixtisası kateqoriya ID-si olan onlayn usta bildiriş aldı", got[p_id] == 1, str(got))
        check("ixtisası kateqoriya ADI olan (veb qeydiyyatı) onlayn usta aldı", got[p_lbl] == 1)
        check("ixtisas seçməmiş onlayn usta aldı", got[p_any] == 1)
        check("OFLAYN usta almadı", got[p_off] == 0)
        check("başqa kateqoriyanın ustası almadı", got[p_oth] == 0)
        check("müştərinin özünə getmədi", got[cust] == 0)
        n_row = (await notifs(p_id, "new_opportunity"))[0]
        check("bildiriş həm type, həm kind sütununda (veb və mobil oxusun)",
              n_row["kind"] == "new_opportunity" and n_row["title"].startswith("Yeni sifariş"))

        print("\n── 2. Təklif statusu (təklifin özü RPC ilə yaranır — /rest/v1 insert bağlıdır) ──")
        offer = await db.fetchval(
            "insert into opportunities_offers (opportunity_id, provider_id, offer_amount, status)"
            " values ($1::uuid, $2::uuid, 40, 'pending') returning id::text", opp, p_id)
        check("RPC/daxili yolla yaranan təklifə trigger bildiriş yazmır (Python yazır)",
              len(await notifs(cust, "new_offer")) == 0)
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{offer}", headers=auth(cust_tok),
                          json={"status": "rejected"})
        check("müştəri təklifi rədd etdi (/rest/v1)", r.status_code == 200, r.text[:200])
        new_offer = [n for n in await notifs(p_id, "offer_rejected") if n["related_id"] == offer]
        check("usta 'Təklifin rədd edildi' bildirişi aldı (1 dəfə)",
              len(new_offer) == 1 and "40" in (new_offer[0]["body"] or ""), str(new_offer))

        print("\n── 3. Sifariş statusu ──")
        r = await c.patch(f"/rest/v1/opportunities?id=eq.{opp}", headers=auth(cust_tok), json={
            "status": "cancelled", "cancellation_reason": "Artıq lazım deyil"})
        check("müştəri sifarişi ləğv etdi (/rest/v1)", r.status_code == 200, r.text[:200])
        st = [n for n in await notifs(cust, "status_cancelled") if n["related_id"] == opp]
        check("müştəriyə status bildirişi getdi", len(st) == 1, str(st))

        print("\n── 4. Çat mesajı ──")
        conv = await db.fetchval(
            "insert into conversations (customer_id, provider_id, opportunity_id)"
            " values ($1::uuid, $2::uuid, $3::uuid) returning id::text", cust, p_id, opp)
        r = await c.post("/rest/v1/chat_messages", headers=auth(cust_tok), json={
            "conversation_id": conv, "sender_id": cust, "body": "Salam, nə vaxt gələ bilərsiniz?"})
        check("çat mesajı /rest/v1 ilə yazıldı", r.status_code == 201, r.text[:200])
        ch = [n for n in await notifs(p_id, "chat") if n["related_id"] == conv]
        check("qarşı tərəf (usta) çat bildirişi aldı", len(ch) == 1 and ch[0]["title"] == "Müştəri",
              str(ch))
        check("göndərən özü bildiriş almadı", len(await notifs(cust, "chat")) == 0)
        prev = await db.fetchrow("select last_message_at, last_message_preview from conversations"
                                 " where id = $1::uuid", conv)
        check("söhbətin son mesajı yeniləndi (siyahı sırası və önizləmə)",
              prev["last_message_at"] is not None
              and prev["last_message_preview"].startswith("Salam"))

        print("\n── 5. Python (RPC/API) yazıları ikiqat bildiriş yaratmır ──")
        before = await db.fetchval("select count(*) from notifications")
        await db.execute(
            "insert into opportunities (title, created_by, category_id, status, date)"
            " values ('Daxili yazı', $1::uuid, $2::uuid, 'pending', '2026-12-21')", cust, cat)
        check("/rest/v1 olmayan yazıda trigger bildiriş yaratmır",
              await db.fetchval("select count(*) from notifications") == before)

        print("\n── 6. Push növbəsi ──")
        all_ids = {r["id"] for r in await db.fetch("select id::text from notifications")}
        for _ in range(50):
            if all_ids <= set(pushed):
                break
            await asyncio.sleep(0.1)
        check("hər bildiriş push növbəsinə düşdü", all_ids <= set(pushed),
              f"{len(all_ids - set(pushed))} çatmadı")
        check("hər bildiriş yalnız bir dəfə göndərildi", len(pushed) == len(set(pushed)))
        nid = await db.fetchval(
            "insert into notifications (user_id, type, title, body) values"
            " ($1::uuid, 'test', 'Birbaşa', 'x') returning id::text", cust)
        for _ in range(50):
            if nid in pushed:
                break
            await asyncio.sleep(0.1)
        check("istənilən yolla yaranan bildiriş push alır", nid in pushed)

        await db.execute("set session_replication_role = replica")
        sync_id = await db.fetchval(
            "insert into notifications (user_id, type, title) values ($1::uuid, 'sync', 'S')"
            " returning id::text", cust)
        await db.execute("set session_replication_role = origin")
        await asyncio.sleep(0.5)
        check("Supabase-dən sinxronla gələn bildiriş ikinci dəfə push olunmur",
              sync_id not in pushed)

        print("\n── 7. FCM mesajının forması ──")
        captured: list = []

        async def fake_push(user_id, title, body, data=None):
            captured.append((str(user_id), title, body, data))

        push.send_push = fake_push
        await push.send_notification_push(new_offer[0]["id"])
        check("push: başlıq, mətn, type/related_id/notif_id",
              captured and captured[0][0] == p_id and captured[0][1].startswith("Təklifin")
              and captured[0][3]["type"] == "offer_rejected"
              and captured[0][3]["related_id"] == offer
              and captured[0][3]["notif_id"] == str(new_offer[0]["id"]), str(captured))
        msg = push.build_message("tok", "Başlıq", "Mətn", {"type": "x"})
        check("Android: yüksək prioritet + bildiriş kanalı (tətbiq bağlı olanda da)",
              msg.android.priority == "high"
              and msg.android.notification.channel_id == push.ANDROID_CHANNEL_ID)
        check("iOS: alert push, səs", msg.apns.headers["apns-push-type"] == "alert"
              and msg.apns.payload.aps.sound == "default")

    print("\n── 8. İki Firebase layihəsi (Android: ellit-d79fa, iOS: ellit-ios) ──")
    from firebase_admin import messaging as fm

    class SenderIdMismatchError(Exception):
        pass

    class UnregisteredError(Exception):
        pass

    owner = {"tok-android": "A", "tok-ios": "I", "tok-ios-as-android": "I"}
    sent: list[tuple[str, str]] = []

    def fake_send(msg, app=None):
        tok = msg.token
        if tok == "tok-dead":
            raise UnregisteredError("Requested entity was not found")
        if tok == "tok-flaky":
            raise ConnectionError("timeout")
        if owner.get(tok) != app:
            raise SenderIdMismatchError("SenderId mismatch")
        sent.append((tok, app))

    real_send = fm.send
    fm.send = fake_send
    try:
        bad = push._send_sync(
            [("tok-android", "android"), ("tok-ios", "ios"), ("tok-ios-as-android", "android"),
             ("tok-dead", "ios"), ("tok-flaky", "android")],
            "T", "B", {}, {"android": "A", "ios": "I"})
    finally:
        fm.send = real_send
    check("Android tokeni Android layihəsi ilə, iOS tokeni iOS layihəsi ilə gedir",
          ("tok-android", "A") in sent and ("tok-ios", "I") in sent, str(sent))
    check("platforması səhv yazılmış token digər layihə ilə yenidən göndərilir",
          ("tok-ios-as-android", "I") in sent, str(sent))
    check("yalnız həqiqətən ölü token silinir (şəbəkə xətası tokeni silmir)",
          bad == ["tok-dead"], str(bad))
    check("bir layihə konfiqurasiya olunubsa hamısı onunla göndərilir",
          push._apps_for("ios", {"android": "A"}) == ["A"])

    listener.cancel()
    await db.close()
    print("\nBİLDİRİŞ TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
    os._exit(0)
