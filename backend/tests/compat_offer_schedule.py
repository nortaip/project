"""Təklifdə gəliş tarixi, kateqoriyaya görə qiymət vahidi və təklif sahələrinin qorunması.

* Usta təklif verəndə gələcəyi günü seçir (`p_proposed_at`), müştəri bunu görüb
  qəbul / rədd edir; usta aktiv işi bitməsə də yeni (gələcək) sifariş götürür.
* Admin kateqoriyada qiymət vahidini seçir (fixed / m2 / hour); m²/saat
  kateqoriyasında usta vahid qiymət + təxmini miqdar yazır, ümumi məbləğ
  avtomatik hesablanır.
* /rest/v1 ilə təklifin məbləği və ödəniş sahələri dəyişdirilə bilmir.

İşə salma (təmiz baza + `alembic upgrade head` sonra):
    python tests/compat_offer_schedule.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("RATE_LIMIT_AUTH", "100000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import asyncpg  # noqa: E402
import httpx  # noqa: E402

BAKU = timezone(timedelta(hours=4))


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

        def auth(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        async def rpc(tok: str, name: str, **body) -> httpx.Response:
            return await c.post(f"/rest/v1/rpc/{name}", headers=auth(tok), json=body)

        cust, cust_tok = await signup("musteri@cedvel.az", "Müştəri")
        prov, prov_tok = await signup("usta@cedvel.az", "Usta Rəşad")
        prov2, prov2_tok = await signup("usta2@cedvel.az", "Usta Elçin")
        admin, admin_tok = await signup("admin@cedvel.az", "Admin")
        for uid in (prov, prov2):
            await db.execute(
                "update profiles set role = 'provider', is_verified = true, balance = 500,"
                " last_kyc_approved_at = now() where id = $1::uuid", uid)
            await db.execute("update users set role = 'provider' where id = $1::uuid", uid)
        await db.execute("update profiles set balance = 1000 where id = $1::uuid", cust)
        await db.execute("update profiles set role = 'admin' where id = $1::uuid", admin)
        await db.execute("update users set role = 'admin' where id = $1::uuid", admin)

        print("\n── 1. Admin kateqoriyanın qiymət vahidini seçir ──")
        tile = await db.fetchval(
            "insert into service_categories (label) values ('Kafel') returning id::text")
        repair = await db.fetchval(
            "insert into service_categories (label) values ('Təmir') returning id::text")
        r = await c.patch(f"/rest/v1/service_categories?id=eq.{tile}", headers=auth(admin_tok),
                          json={"price_unit": "m2"})
        check("admin 'Kafel' kateqoriyasını m² başı etdi (/rest/v1)",
              r.status_code == 200 and r.json()[0]["price_unit"] == "m2", r.text[:200])
        r = await c.patch(f"/rest/v1/service_categories?id=eq.{repair}", headers=auth(admin_tok),
                          json={"price_unit": "litr"})
        check("yanlış vahid qəbul olunmur", r.status_code == 400, r.text[:200])
        r = await c.get(f"/rest/v1/service_categories?id=eq.{tile}&select=price_unit", headers=H)
        check("vahidi hamı oxuya bilir (təklif formasında lazımdır)",
              r.json() == [{"price_unit": "m2"}], r.text)
        r = await c.patch(f"/rest/v1/service_categories?id=eq.{repair}", headers=auth(cust_tok),
                          json={"price_unit": "hour"})
        unit_after = await db.fetchval(
            "select price_unit from service_categories where id = $1::uuid", repair)
        check("adi istifadəçi vahidi dəyişə bilmir", unit_after == "fixed",
              f"{r.status_code} {unit_after}")

        async def order(cat: str, title: str) -> str:
            r = await c.post("/rest/v1/opportunities", headers=auth(cust_tok), json={
                "title": title, "created_by": cust, "date": "2026-12-01", "location": "Bakı",
                "category_id": cat, "status": "pending"})
            assert r.status_code == 201, r.text
            return r.json()[0]["id"]

        print("\n── 2. m² başı təklif + gəliş tarixi ──")
        opp1 = await order(tile, "Hamam kafeli")
        come = (datetime.now(BAKU) + timedelta(days=3)).date().isoformat()
        r = await rpc(prov_tok, "place_bid", p_opportunity_id=opp1, p_amount=1, p_unit_price=15,
                      p_quantity=40, p_proposed_at=come, p_notes="Material sizdən")
        j = r.json()
        check("usta m² qiyməti + miqdar + gün ilə təklif verdi (cəmi server hesablayır)",
              r.status_code == 200 and j["ok"] and float(j["amount"]) == 600
              and j["price_unit"] == "m2" and float(j["unit_price"]) == 15
              and float(j["quantity"]) == 40 and j["proposed_at"].startswith(come), r.text)
        bid1 = j["bid_id"]
        row = await db.fetchrow("select * from opportunities_offers where id = $1::uuid", bid1)
        check("bazada: ümumi məbləğ = 15 × 40, vahid, miqdar, tarix, qeyd",
              float(row["offer_amount"]) == 600 and row["price_unit"] == "m2"
              and row["proposed_at"].astimezone(BAKU).date().isoformat() == come
              and row["notes"] == "Material sizdən")
        n = await db.fetchrow("select title, body from notifications where user_id = $1::uuid"
                              " and type = 'new_offer'", cust)
        check("müştəri bildirişində qiymət vahidi və gəliş günü var",
              n is not None and "15 ₼/m² × 40 m²" in n["body"]
              and datetime.fromisoformat(come).strftime("%d.%m.%Y") in n["body"], str(n))
        r = await c.get(f"/rest/v1/opportunities_offers?id=eq.{bid1}"
                        "&select=offer_amount,price_unit,unit_price,quantity,proposed_at",
                        headers=auth(cust_tok))
        check("müştəri təklifin tarixini və qiymət bölgüsünü görür",
              r.status_code == 200 and r.json()[0]["price_unit"] == "m2"
              and r.json()[0]["proposed_at"] is not None, r.text[:200])

        print("\n── 3. Yoxlamalar ──")
        opp2 = await order(tile, "Mətbəx kafeli")
        past = (datetime.now(BAKU) - timedelta(days=1)).date().isoformat()
        r = await rpc(prov2_tok, "place_bid", p_opportunity_id=opp2, p_amount=150, p_unit_price=15,
                      p_quantity=10, p_proposed_at=past)
        check("keçmiş tarix qəbul olunmur", r.status_code >= 400 and "keçmiş" in r.text, r.text)
        far = (datetime.now(BAKU) + timedelta(days=120)).date().isoformat()
        r = await rpc(prov2_tok, "place_bid", p_opportunity_id=opp2, p_amount=150, p_unit_price=15,
                      p_quantity=10, p_proposed_at=far)
        check("90 gündən uzaq tarix qəbul olunmur", r.status_code >= 400, r.text)
        r = await rpc(prov2_tok, "place_bid", p_opportunity_id=opp2, p_amount=150, p_unit_price=15,
                      p_quantity=0)
        check("m²-də miqdar 0 ola bilməz", r.status_code >= 400, r.text)
        r = await rpc(prov2_tok, "place_bid", p_opportunity_id=opp2, p_amount=120)
        check("köhnə klient (yalnız ümumi məbləğ) hələ də işləyir — sabit qiymət",
              r.status_code == 200 and r.json()["price_unit"] == "fixed"
              and float(r.json()["amount"]) == 120 and r.json()["proposed_at"] is None, r.text)
        opp3 = await order(repair, "Qapı təmiri")
        r = await rpc(prov2_tok, "place_bid", p_opportunity_id=opp3, p_amount=80,
                      p_proposed_at=f"{come}T15:30:00+04:00")
        check("sabit qiymətli kateqoriya + dəqiq saat",
              r.status_code == 200 and r.json()["price_unit"] == "fixed"
              and "15:30" in r.json()["proposed_at"].replace("11:30", "15:30"), r.text)

        print("\n── 4. Usta işi bitməsə də yeni sifariş götürür ──")
        r = await rpc(cust_tok, "accept_offer_with_payment", p_offer_id=bid1, p_method="cash")
        check("müştəri 1-ci təklifi qəbul etdi", r.status_code == 200, r.text[:300])
        opp4 = await order(repair, "Pəncərə təmiri")
        later = (datetime.now(BAKU) + timedelta(days=5)).date().isoformat()
        r = await rpc(prov_tok, "place_bid", p_opportunity_id=opp4, p_amount=50,
                      p_proposed_at=later)
        check("aktiv (qəbul olunmuş) işi olan usta 5 gün sonraya yeni təklif verə bilir",
              r.status_code == 200 and r.json()["ok"], r.text)
        bid4 = r.json()["bid_id"]

        print("\n── 5. Təklif sahələrinin qorunması (/rest/v1) ──")
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(cust_tok),
                          json={"offer_amount": 1})
        amt = await db.fetchval("select offer_amount from opportunities_offers where id=$1::uuid",
                                bid4)
        check("müştəri təklifin məbləğini endirə bilmir",
              r.status_code >= 400 and float(amt) == 50, f"{r.status_code} {amt}")
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(prov_tok),
                          json={"status": "accepted"})
        st = await db.fetchval("select status from opportunities_offers where id=$1::uuid", bid4)
        check("usta öz təklifini ödənişsiz 'qəbul edildi' edə bilmir", st == "pending",
              f"{r.status_code} {st}")
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(prov_tok),
                          json={"payout_status": "approved"})
        check("usta ödəniş statusunu 'approved' edə bilmir", r.status_code >= 400, r.text[:200])
        new_day = (datetime.now(BAKU) + timedelta(days=6)).date().isoformat()
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(prov_tok),
                          json={"proposed_at": f"{new_day}T00:00:00+04:00"})
        check("usta gözləmədə olan təklifin gününü dəyişə bilir", r.status_code == 200,
              r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(cust_tok),
                          json={"proposed_at": f"{come}T00:00:00+04:00"})
        check("müştəri ustanın gününü dəyişə bilmir", r.status_code >= 400, r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid1}", headers=auth(prov_tok),
                          json={"proposed_at": f"{new_day}T00:00:00+04:00"})
        check("qəbul olunmuş təklifin günü /rest/v1 ilə dəyişmir", r.status_code >= 400,
              r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid4}", headers=auth(cust_tok),
                          json={"status": "rejected"})
        st = await db.fetchval("select status from opportunities_offers where id=$1::uuid", bid4)
        check("müştəri gözləmədə olan təklifi rədd edə bilir (başqa ustaya baxır)",
              r.status_code == 200 and st == "rejected", f"{r.status_code} {st}")
        rej = await db.fetchval(
            "select count(*) from notifications where user_id = $1::uuid and type = 'offer_rejected'"
            " and related_id = $2", prov, bid4)
        check("usta rədd bildirişi aldı", rej == 1)
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid1}", headers=auth(prov_tok),
                          json={"completion_photos": ["https://x/1.jpg"],
                                "customer_signature_url": "https://x/s.png",
                                "payout_status": "pending_review"})
        check("usta qəbul olunmuş işə tamamlanma sübutu göndərə bilir", r.status_code == 200,
              r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{bid1}", headers=auth(admin_tok),
                          json={"payout_status": "approved"})
        check("admin ödəniş statusunu dəyişə bilir", r.status_code == 200, r.text[:200])

    await db.close()
    print("\nTƏKLİF TARİXİ / QİYMƏT VAHİDİ TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
    os._exit(0)
