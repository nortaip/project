"""Komissiyalar: admin panelində qoyulan faizlər pul axınında DƏQİQ tətbiq olunurmu.

    python tests/compat_commissions.py

Faizlər: qəbul 10%, tamamlama 5%, müştəri servis haqqı 2%, nağd depozit 20%,
nağdlaşdırma 2%; briqada: qəbul 0% (açıq şəkildə), tamamlama 3%, üzv payı 10%.
"""
from __future__ import annotations

import asyncio
import os
import sys
from decimal import Decimal as D

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("RATE_LIMIT_AUTH", "100000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import asyncpg  # noqa: E402
import httpx  # noqa: E402

CFG = {"commission_on_accept": 10, "commission_on_complete": 5,
       "commission_customer_service_fee": 2, "cash_deposit_pct": 20,
       "commission_on_withdrawal": 2, "min_withdrawal_amount": 5, "bonus_on_complete": 0,
       "brigade_commission_on_accept": 0, "brigade_commission_on_complete": 3,
       "brigade_member_commission_pct": 10, "commission_on_bonus_convert": 4}


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


async def main() -> None:
    from app.main import app

    db = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    H = {"apikey": "ellit-public"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        async def signup(email: str, name: str) -> str:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": name}})
            assert r.status_code == 200, r.text
            return r.json()["user"]["id"]

        async def login(email: str) -> str:
            r = await c.post("/auth/v1/token?grant_type=password", headers=H, json={
                "email": email, "password": "Parol#12345"})
            assert r.status_code == 200, r.text
            return r.json()["access_token"]

        def A(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        async def set_role(uid: str, role: str) -> None:
            await db.execute("update profiles set role=$2 where id=$1::uuid", uid, role)
            await db.execute("update users set role=$2 where id=$1::uuid", uid, role)

        cust = await signup("musteri@komissiya.az", "Müştəri")
        prov = await signup("usta@komissiya.az", "Usta")
        owner = await signup("briqada@komissiya.az", "Briqada Sahibi")
        adm = await signup("admin@komissiya.az", "Admin")
        for u, r in ((prov, "provider"), (owner, "provider"), (adm, "admin")):
            await set_role(u, r)
        await db.execute("update profiles set is_verified=true, last_kyc_approved_at=now()"
                         " where id = any($1::uuid[])", [prov, owner])
        ct, pt, at = (await login("musteri@komissiya.az"), await login("usta@komissiya.az"),
                      await login("admin@komissiya.az"))

        print("\n── 0. Admin faizləri qoyur ──")
        for k, v in CFG.items():
            r = await c.post("/rest/v1/rpc/admin_update_commission", headers=A(at),
                             json={"p_key": k, "p_value": v})
            check(f"{k} = {v}", r.status_code in (200, 204), r.text[:200])

        async def bal(u: str) -> D:
            return D(await db.fetchval("select coalesce(balance,0) from profiles"
                                       " where id=$1::uuid", u))

        async def locked(u: str) -> D:
            return D(await db.fetchval("select coalesce(locked_balance,0) from provider_wallets"
                                       " where provider_id=$1::uuid", u) or 0)

        async def order(title: str) -> str:
            r = await c.post("/rest/v1/opportunities", headers=A(ct), json={
                "title": title, "created_by": cust, "date": "2026-12-05", "status": "pending"})
            assert r.status_code == 201, r.text
            return r.json()[0]["id"]

        async def finish(offer: str) -> dict:
            await c.post("/rest/v1/rpc/release_offer_to_provider", headers=A(ct),
                         json={"p_offer_id": offer})                     # → admin yoxlaması
            r = await c.post("/rest/v1/rpc/release_offer_to_provider", headers=A(at),
                             json={"p_offer_id": offer})
            assert r.status_code == 200, r.text
            return r.json()

        print("\n── 1. Təklif: ustanın balansında qəbul komissiyası olmalıdır ──")
        o1 = await order("Kart sifarişi")
        r = await c.post("/rest/v1/rpc/place_bid", headers=A(pt),
                         json={"p_opportunity_id": o1, "p_amount": 100})
        check("balans 0 → 100 ₼ təklif rədd (10% = 10 ₼ lazım)",
              r.status_code == 400 and "NO_BALANCE" in r.text and "10.00" in r.text, r.text[:200])
        await db.execute("update profiles set balance=15 where id=$1::uuid", prov)
        r = await c.post("/rest/v1/rpc/place_bid", headers=A(pt),
                         json={"p_opportunity_id": o1, "p_amount": 100})
        check("balans 15 → təklif qəbul", r.status_code == 200, r.text[:200])
        off1 = r.json()["bid_id"]

        print("\n── 2. Kartla ödəniş ──")
        await db.execute("update profiles set balance=300 where id=$1::uuid", cust)
        r = await c.post("/rest/v1/rpc/accept_offer_with_payment", headers=A(ct),
                         json={"p_offer_id": off1, "p_method": "card"})
        check("kartla qəbul", r.status_code == 200, r.text[:200])
        check("müştəridən 100 + 2% servis haqqı = 102 tutuldu", await bal(cust) == D("198"),
              str(await bal(cust)))
        check("ustanın escrow-u 100 − 10% = 90", await locked(prov) == D("90"),
              str(await locked(prov)))
        await finish(off1)
        check("iş bitdi: usta 90 − 5% = 85.5 aldı (15 + 85.5)", await bal(prov) == D("100.5"),
              str(await bal(prov)))
        check("escrow sıfırlandı", await locked(prov) == 0)

        print("\n── 3. Nağd ödəniş: depozit iş bitəndə ustaya ──")
        o2 = await order("Nağd sifariş")
        r = await c.post("/rest/v1/rpc/place_bid", headers=A(pt),
                         json={"p_opportunity_id": o2, "p_amount": 100})
        off2 = r.json()["bid_id"]
        r = await c.post("/rest/v1/rpc/accept_offer_with_payment", headers=A(ct),
                         json={"p_offer_id": off2, "p_method": "cash"})
        check("nağd qəbul", r.status_code == 200, r.text[:200])
        check("müştəridən depozit 20 + haqq 2 = 22 tutuldu", await bal(cust) == D("176"),
              str(await bal(cust)))
        check("ustanın balansından komissiya 10 tutuldu", await bal(prov) == D("90.5"),
              str(await bal(prov)))
        res = await finish(off2)
        check("iş bitdi: depozit 20 ustanın balansına keçdi", await bal(prov) == D("110.5"),
              str(await bal(prov)))
        tx = await db.fetchrow("select amount, balance_after from transactions"
                               " where type='cash_deposit_release' and related_id=$1", off2)
        check("ledger-də 'cash_deposit_release' +20", tx is not None and D(tx["amount"]) == 20
              and D(tx["balance_after"]) == D("110.5"), str(tx))
        note = await db.fetchval("select body from notifications where user_id=$1::uuid"
                                 " and type='offer_completed' order by created_at desc limit 1",
                                 prov)
        check("ustaya bildiriş: depozit balansa köçürüldü",
              note is not None and "depoziti 20" in note, str(note))
        r = await c.post("/rest/v1/rpc/release_offer_to_provider", headers=A(at),
                         json={"p_offer_id": off2})
        check("təkrar tamamlama → depozit ikinci dəfə verilmir",
              r.status_code >= 400 and await bal(prov) == D("110.5"), r.text[:120])

        print("\n── 4. Nağdlaşdırma ──")
        r = await c.post("/rest/v1/rpc/request_withdrawal", headers=A(pt),
                         json={"p_amount": 50, "p_bank_card": "4169000011112222"})
        w = await db.fetchrow("select commission_amount, net_amount from withdrawals"
                              " where provider_id=$1::uuid", prov)
        check("50 ₼ → komissiya 1, xalis 49", r.status_code == 200 and w is not None
              and D(w["commission_amount"]) == 1 and D(w["net_amount"]) == 49, str(w))

        print("\n── 5. Briqada: öz faizləri ──")
        brig = await db.fetchval(
            "insert into brigades (owner_id, name, slug) values ($1::uuid, 'Test Briqada',"
            " 'test-briqada') returning id", owner)
        await db.execute("update profiles set balance=0 where id=$1::uuid", owner)

        async def brigade_offer(title: str) -> str:
            opp = await order(title)
            return str(await db.fetchval(
                "insert into opportunities_offers (opportunity_id, provider_id, brigade_id,"
                " offer_amount, status) values ($1, $2::uuid, $3, 200, 'pending') returning id",
                opp, owner, brig))

        b1 = await brigade_offer("Briqada nağd")
        r = await c.post("/rest/v1/rpc/accept_offer_with_payment", headers=A(ct),
                         json={"p_offer_id": b1, "p_method": "cash"})
        check("briqada qəbul faizi 0% → briqada balansı 0 olsa da nağd qəbul olunur",
              r.status_code == 200 and D(r.json()["commission_amt"]) == 0, r.text[:200])
        await finish(b1)
        check("briqada nağd işi bitdi: depozit 40 (200 × 20%) sahibə keçdi",
              await bal(owner) == D("40"), str(await bal(owner)))
        await db.execute("update profiles set balance=500 where id=$1::uuid", cust)
        b2 = await brigade_offer("Briqada kart")
        r = await c.post("/rest/v1/rpc/accept_offer_with_payment", headers=A(ct),
                         json={"p_offer_id": b2, "p_method": "card"})
        check("briqada kartla qəbul: escrow tam 200 (qəbul faizi 0%)",
              r.status_code == 200 and await locked(owner) == 200, r.text[:200])
        await finish(b2)
        # 200 − 3% = 194; üzv payı 10% = 19.4 briqadaya; sahibə 174.6 (+40 depozit)
        check("tamamlama: 3% briqada faizi, 10% komanda payı → usta 174.6 aldı",
              await bal(owner) == D("214.6"), str(await bal(owner)))
        bb = D(await db.fetchval("select balance from brigades where id=$1", brig))
        check("briqada balansına komanda payı 19.4", bb == D("19.4"), str(bb))
        await db.execute("delete from platform_config where key='brigade_commission_on_accept'")
        from app.core.cache import invalidate
        await invalidate("cfg:brigade_commission_on_accept")
        b3 = await brigade_offer("Briqada faizsiz açar")
        r = await c.post("/rest/v1/rpc/accept_offer_with_payment", headers=A(ct),
                         json={"p_offer_id": b3, "p_method": "card"})
        check("briqada faizi təyin olunmayıbsa ümumi 10% tətbiq olunur",
              r.status_code == 200 and D(r.json()["commission_amt"]) == 20, r.text[:200])

        print("\n── 6. Admin dashboard gəliri ──")
        r = await c.post("/rest/v1/rpc/admin_dashboard_stats", headers=A(at), json={})
        s = r.json()
        # qəbul: kart 10 + nağd 10 + briqada (son) 20; tamamlama: 4.5 + 6 (briqada 3%)
        # servis haqqı: 2 + 2 + 4 + 4 + 4; nağdlaşdırma: 1
        check("qəbul komissiyası (kart + nağd) = 40", D(str(s["acceptCommission"])) == 40, str(s))
        check("tamamlama komissiyası = 10.5", D(str(s["completeCommission"])) == D("10.5"),
              str(s))
        check("müştəri servis haqqı = 16", D(str(s["serviceFee"])) == 16, str(s))
        check("nağdlaşdırma komissiyası = 1", D(str(s["withdrawalCommission"])) == 1, str(s))
        check("platforma gəliri = 67.5", D(str(s["platformRevenue30d"])) == D("67.5"), str(s))
        r = await c.post("/rest/v1/rpc/admin_dashboard_daily", headers=A(at), json={"p_days": 2})
        check("gündəlik gəlir cəmi eynidir",
              sum(D(str(x["revenue"])) for x in r.json()) == D("67.5"), r.text[:300])
    await db.close()
    print("\nKOMİSSİYA TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
