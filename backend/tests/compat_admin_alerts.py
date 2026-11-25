"""Admin müraciət bildirişləri + menyu sayları (admin_pending_counts) testi.

    python tests/compat_admin_alerts.py
"""
from __future__ import annotations

import asyncio
import os
import sys

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


async def main() -> None:
    from app.main import app

    db = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        H = {"apikey": "ellit-public"}

        async def signup(email: str, name: str) -> tuple[str, str]:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": name}})
            assert r.status_code == 200, r.text
            return r.json()["user"]["id"], r.json()["access_token"]

        async def login(email: str) -> str:
            r = await c.post("/auth/v1/token?grant_type=password", headers=H, json={
                "email": email, "password": "Parol#12345"})
            assert r.status_code == 200, r.text
            return r.json()["access_token"]

        def auth(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        async def set_role(uid: str, role: str) -> None:
            await db.execute("update profiles set role=$2 where id=$1::uuid", uid, role)
            await db.execute("update users set role=$2 where id=$1::uuid", uid, role)

        async def alerts(uid: str, kind: str | None = None) -> list:
            q = ("select kind, title, body, link, related_id, is_read from notifications"
                 " where user_id=$1::uuid and type='admin_request'")
            args = [uid]
            if kind:
                q += " and kind=$2"
                args.append(kind)
            return await db.fetch(q + " order by created_at", *args)

        cust, cust_tok = await signup("leyla@muraciet.az", "Leyla Həsənova")
        prov, prov_tok = await signup("usta@muraciet.az", "Rauf Usta")
        adm1, _ = await signup("admin1@muraciet.az", "Admin Bir")
        adm2, _ = await signup("admin2@muraciet.az", "Admin İki")
        for a in (adm1, adm2):
            await set_role(a, "admin")
        await set_role(prov, "provider")
        adm_tok = await login("admin1@muraciet.az")
        prov_tok = await login("usta@muraciet.az")

        async def counts() -> dict:
            r = await c.post("/rest/v1/rpc/admin_pending_counts", headers=auth(adm_tok), json={})
            assert r.status_code == 200, r.text
            return r.json()

        k0 = await counts()
        check("başlanğıcda saylar sıfırdır", all(v == 0 for v in k0.values()), str(k0))

        print("\n── 1. Usta olmaq müraciəti ──")
        r = await c.post("/rest/v1/rpc/request_provider_role", headers=auth(cust_tok),
                         json={"p_message": "Santexnikəm", "p_company_name": "Leyla Servis"})
        check("müştəri usta olmaq üçün müraciət etdi", r.status_code == 200, r.text[:200])
        for a in (adm1, adm2):
            n = await alerts(a, "provider_request")
            check(f"admin bildiriş aldı ({'1' if a == adm1 else '2'})",
                  len(n) == 1 and n[0]["title"] == "Yeni usta müraciəti"
                  and "Leyla Həsənova" in n[0]["body"] and "Leyla Servis" in n[0]["body"]
                  and n[0]["link"] == "/Administrator/providers", str(n))
        check("müştəriyə admin bildirişi getmir", await alerts(cust) == [])

        print("\n── 2. KYC (ilk və təkrar) ──")
        r = await c.post("/rest/v1/rpc/submit_kyc", headers=auth(prov_tok), json={
            "p_id_front_path": f"{prov}/front.jpg", "p_id_back_path": f"{prov}/back.jpg",
            "p_selfie_path": f"{prov}/selfie.jpg", "p_full_name": "Rauf Məmmədov"})
        check("usta KYC göndərdi", r.status_code == 200 and r.json().get("ok") is not False,
              r.text[:200])
        n = await alerts(adm1, "kyc")
        check("adminə 'Yeni KYC müraciəti'", len(n) == 1 and n[0]["title"] == "Yeni KYC müraciəti"
              and n[0]["body"].startswith("Rauf Məmmədov")
              and n[0]["link"] == "/Administrator/kyc", str(n))
        await db.execute("update provider_verifications set status='rejected'"
                         " where provider_id=$1::uuid", prov)
        await db.execute("update provider_verifications set status='pending'"
                         " where provider_id=$1::uuid", prov)
        check("rədddən sonra yenidən göndəriləndə yeni bildiriş",
              len(await alerts(adm1, "kyc")) == 2)
        await db.execute("update provider_verifications set admin_notes='x'"
                         " where provider_id=$1::uuid", prov)
        check("status dəyişməyəndə təkrar bildiriş yoxdur", len(await alerts(adm1, "kyc")) == 2)

        print("\n── 3. Briqada, nağdlaşdırma, şikayət ──")
        r = await c.post("/rest/v1/rpc/apply_for_brigade", headers=auth(prov_tok),
                         json={"p_name": "Usta Briqadası"})
        check("briqada müraciəti", r.status_code == 200, r.text[:200])
        n = await alerts(adm1, "brigade_application")
        check("adminə 'Yeni briqada müraciəti'",
              len(n) == 1 and n[0]["body"].startswith("Usta Briqadası")
              and n[0]["link"] == "/Administrator/brigades", str(n))
        await db.execute("insert into withdrawals (provider_id, amount_requested, commission_percent,"
                         " commission_amount, net_amount, bank_card, status) values"
                         " ($1::uuid, 120.50, 0, 0, 120.50, '4169********1234', 'pending')", prov)
        n = await alerts(adm1, "withdrawal")
        check("adminə 'Yeni nağdlaşdırma istəyi' (məbləğ ilə)",
              len(n) == 1 and n[0]["body"] == "Rauf Usta — 120.5 ₼."
              and n[0]["link"] == "/Administrator/withdrawals", str(n))
        opp = await db.fetchval(
            "insert into opportunities (title, created_by, date, status, provider_id)"
            " values ('Kran', $1::uuid, current_date, 'completed', $2::uuid) returning id",
            cust, prov)
        offer = await db.fetchval(
            "insert into opportunities_offers (opportunity_id, provider_id, offer_amount, status,"
            " payout_status) values ($1, $2::uuid, 50, 'accepted', 'pending_review') returning id",
            opp, prov)
        await db.execute("insert into disputes (opportunity_id, offer_id, raised_by, against_user,"
                         " reason, description, status) values ($1, $2, $3::uuid, $4::uuid,"
                         " 'no_show', 'Usta ümumiyyətlə gəlmədi', 'open')", opp, offer, cust, prov)
        n = await alerts(adm1, "dispute")
        check("adminə 'Yeni şikayət' (səbəb Azərbaycanca)",
              len(n) == 1 and "usta gəlməyib" in n[0]["body"], str(n))

        print("\n── 4. Dəstək çatı ──")
        r = await c.post("/rest/v1/rpc/open_support_conversation", headers=auth(cust_tok),
                         json={"p_category": "payment"})
        check("müştəri dəstək çatını açdı", r.status_code == 200, r.text[:200])
        conv = r.json()
        for body in ("Salam, ödəniş keçmədi", "Kömək edin"):
            r = await c.post("/rest/v1/chat_messages", headers=auth(cust_tok), json={
                "conversation_id": conv, "sender_id": cust, "body": body})
            check(f"müştəri mesaj yazdı: {body}", r.status_code == 201, r.text[:200])
        n = await alerts(adm1, "support_message")
        check("iki mesaj → bir bildiriş (admin oxuyana qədər təkrarlanmır)",
              len(n) == 1 and n[0]["body"] == "Leyla Həsənova: Salam, ödəniş keçmədi"
              and n[0]["link"] == "/Administrator/support" and n[0]["related_id"] == conv, str(n))
        r = await c.post("/rest/v1/chat_messages", headers=auth(adm_tok), json={
            "conversation_id": conv, "sender_id": adm1, "body": "Baxırıq"})
        check("admin cavab yazdı", r.status_code == 201, r.text[:200])
        check("adminin öz cavabı bildiriş yaratmır", len(await alerts(adm1, "support_message")) == 1)
        # admin çatı açdı — veb panel mesajları oxunmuş kimi işarələyir
        r = await c.patch(f"/rest/v1/chat_messages?conversation_id=eq.{conv}"
                          f"&sender_id=eq.{cust}&read_at=is.null", headers=auth(adm_tok),
                          json={"read_at": "2026-11-25T10:00:00Z"})
        check("admin mesajları oxudu", r.status_code in (200, 204), r.text[:200])
        r = await c.post("/rest/v1/chat_messages", headers=auth(cust_tok), json={
            "conversation_id": conv, "sender_id": cust, "body": "Hələ də alınmır"})
        n = await alerts(adm1, "support_message")
        check("oxunandan sonra yeni mesaj → yeni bildiriş",
              len(n) == 2 and n[1]["body"] == "Leyla Həsənova: Hələ də alınmır", str(n))
        check("ikinci admin də yeni bildiriş aldı",
              len(await alerts(adm2, "support_message")) == 2)

        print("\n── 5. Menyu sayları (admin_pending_counts) ──")
        k = await counts()
        want = {"providers": 1, "kyc": 1, "brigades": 1, "withdrawals": 1,
                "job_completions": 1, "support": 1, "disputes": 1}
        check("hər bölmənin sayı düzgündür", {x: k[x] for x in want} == want, str(k))
        check("oxunmamış admin bildirişləri sayılır", k["unread_alerts"] >= 6, str(k))
        await db.execute("update chat_messages set read_at=now() where conversation_id=$1::uuid",
                         conv)
        check("(öncə) dəstək çatı: 1 söhbətdə oxunmamış mesaj var", k["support"] == 1, str(k))
        await db.execute("update provider_requests set status='approved'")
        k = await counts()
        check("baxılan müraciətlər saydan çıxır", k["support"] == 0 and k["providers"] == 0, str(k))
        r = await c.post("/rest/v1/rpc/admin_pending_counts", headers=auth(cust_tok), json={})
        check("müştəri sayları ala bilmir", r.status_code == 403, r.text[:200])
        pushed = await db.fetchval("select count(*) from notifications where type='admin_request'")
        check("bütün bildirişlər notifications cədvəlində (push buradan gedir)", pushed >= 12,
              str(pushed))
    await db.close()
    print("\nADMİN MÜRACİƏT BİLDİRİŞLƏRİ TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
