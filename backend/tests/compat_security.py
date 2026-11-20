"""Təhlükəsizlik yoxlamasında (pentest) tapılanların reqressiya testi.

* Saxta rəy: istənilən istifadəçi istənilən ustaya rəy yazıb reytinqi
  dəyişə bilməməlidir — yalnız tamamlanmış işin müştərisi, bir dəfə.
* Elan: giriş etməmiş biri elan yarada bilməz; giriş etmiş biri başqasının
  adına elan yarada bilməz (sahibi həmişə özüdür).
* Production-da defolt / qısa JWT açarı ilə server açılmır.

İşə salma (təmiz baza + `alembic upgrade head` sonra):
    python tests/compat_security.py
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
    from app.core.config import Settings, check_production_secrets
    from app.main import app

    db = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        H = {"apikey": "ellit-public"}

        async def signup(email: str) -> tuple[str, str]:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": email[:6]}})
            assert r.status_code == 200, r.text
            return r.json()["user"]["id"], r.json()["access_token"]

        def auth(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        cust, cust_tok = await signup("musteri@pentest.az")
        prov, prov_tok = await signup("usta@pentest.az")
        rival, rival_tok = await signup("rəqib@pentest.az")
        await db.execute("update profiles set role = 'provider' where id = any($1::uuid[])",
                         [prov, rival])
        opp = await db.fetchval(
            "insert into opportunities (title, created_by, date, status)"
            " values ('Kran', $1::uuid, '2026-12-01', 'pending') returning id::text", cust)
        offer = await db.fetchval(
            "insert into opportunities_offers (opportunity_id, provider_id, offer_amount, status)"
            " values ($1::uuid, $2::uuid, 50, 'accepted') returning id::text", opp, prov)

        print("\n── 1. Rəylər ──")
        r = await c.post("/rest/v1/provider_reviews", headers=auth(rival_tok), json={
            "provider_id": prov, "rating": 1, "comment": "sabotaj"})
        check("kənar istifadəçi ustaya saxta rəy yaza bilmir", r.status_code in (401, 403),
              f"{r.status_code} {r.text[:200]}")
        r = await c.post("/rest/v1/provider_reviews", headers=auth(rival_tok), json={
            "provider_id": prov, "offer_id": offer, "rating": 1})
        check("başqasının işinə də rəy yaza bilmir", r.status_code in (401, 403), r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": prov, "offer_id": offer, "rating": 5})
        check("müştəri iş TAMAMLANMAMIŞ rəy yaza bilmir", r.status_code in (401, 403),
              r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=H, json={
            "provider_id": prov, "rating": 1})
        check("anonim rəy yaza bilmir", r.status_code in (401, 403), r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{offer}", headers=auth(cust_tok),
                          json={"status": "completed"})
        check("müştəri işi tamamladı", r.status_code == 200, r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": prov, "offer_id": offer, "rating": 5, "comment": "Əla"})
        check("tamamlanmış işin müştərisi rəy yazır", r.status_code == 201, r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": prov, "offer_id": offer, "rating": 5})
        check("eyni işə ikinci rəy yazılmır (reytinqi şişirtmək olmur)", r.status_code == 409,
              r.text[:200])
        rating = await db.fetchrow("select rating, rating_count from profiles where id=$1::uuid",
                                   prov)
        check("ustanın reytinqi yalnız həqiqi rəydən: 5.0 / 1 rəy",
              float(rating["rating"]) == 5 and rating["rating_count"] == 1, str(dict(rating)))

        # Mobil axın: müştəri "İş bitdi" deyəndə sifariş admin yoxlamasına düşür
        # (pending_review), təklif 'accepted' qalır — rəy yazıla bilməlidir.
        opp2 = await db.fetchval(
            "insert into opportunities (title, created_by, date, status)"
            " values ('Unitaz', $1::uuid, '2026-12-02', 'ongoing') returning id::text", cust)
        offer2 = await db.fetchval(
            "insert into opportunities_offers (opportunity_id, provider_id, offer_amount, status)"
            " values ($1::uuid, $2::uuid, 70, 'accepted') returning id::text", opp2, prov)
        await db.execute("update opportunities set accepted_offer_id=$1::uuid, provider_id=$2::uuid"
                         " where id=$3::uuid", offer2, prov, opp2)
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": prov, "offer_id": offer2, "rating": 4})
        check("iş hələ gedərkən (ongoing) rəy yazılmır", r.status_code in (401, 403),
              r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{offer2}",
                          headers=auth(cust_tok), json={"payout_status": "pending_review"})
        check("müştəri ödəniş statusunu özü dəyişə bilmir", r.status_code in (401, 403),
              r.text[:200])
        r = await c.patch(f"/rest/v1/opportunities?id=eq.{opp2}", headers=auth(cust_tok),
                          json={"status": "pending_review"})
        check("müştəri işi bitmiş kimi təsdiqlədi (admin yoxlaması)", r.status_code == 200,
              r.text[:200])
        ps = await db.fetchval("select payout_status from opportunities_offers where id=$1::uuid",
                               offer2)
        check("təklif admin təsdiq növbəsinə düşdü (payout_status=pending_review)",
              ps == "pending_review", str(ps))
        r = await c.patch(f"/rest/v1/opportunities_offers?id=eq.{offer2}",
                          headers=auth(cust_tok), json={"payout_status": "paid"})
        check("müştəri ödənişi 'paid' edə bilmir", r.status_code in (401, 403), r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(rival_tok), json={
            "provider_id": prov, "offer_id": offer2, "rating": 1})
        check("pending_review işinə də kənar şəxs rəy yaza bilmir", r.status_code in (401, 403),
              r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": prov, "offer_id": offer2, "rating": 4, "comment": "Yaxşı"})
        check("admin yoxlamasındakı işin müştərisi rəy yazır", r.status_code == 201,
              r.text[:200])
        n = await db.fetch("select title, body, related_id, link from notifications"
                           " where user_id=$1::uuid and type='new_review'", prov)
        check("ustaya 'Yeni rəy' bildirişi getdi (REST yazısı)",
              len(n) == 2 and any("4/5" in x["body"] and "Unitaz" in x["body"]
                                  and x["related_id"] == opp2 for x in n), str([dict(x) for x in n]))
        rating = await db.fetchrow("select rating, rating_count from profiles where id=$1::uuid",
                                   prov)
        check("reytinq yeniləndi: 4.5 / 2 rəy",
              float(rating["rating"]) == 4.5 and rating["rating_count"] == 2, str(dict(rating)))

        print("\n── 2. Xidmət elanları ──")
        r = await c.post("/rest/v1/services", headers=H, json={
            "provider_id": prov, "title": "Saxta elan", "price": 1,
            "contact_phone": "+994500000000"})
        check("giriş etməmiş biri elan yarada bilmir", r.status_code in (401, 403),
              f"{r.status_code} {r.text[:200]}")
        r = await c.post("/rest/v1/services", headers=auth(rival_tok), json={
            "provider_id": prov, "title": "Başqasının adına", "price": 1})
        owner = r.json()[0]["provider_id"] if r.status_code == 201 else None
        check("başqasının adına elan yaradılmır (sahibi həmişə özüdür)",
              r.status_code in (401, 403) or owner == rival, f"{r.status_code} {owner}")
        r = await c.post("/rest/v1/services", headers=auth(prov_tok), json={
            "provider_id": prov, "title": "Santexnik xidməti", "price": 30})
        check("usta öz elanını yaradır", r.status_code == 201
              and r.json()[0]["provider_id"] == prov, r.text[:200])

    print("\n── 3. Production sirləri ──")
    for secret, ok in (("CHANGE_ME_IN_PRODUCTION_64_BYTES_MIN", False), ("qisa", False),
                       ("a" * 64, True)):
        try:
            check_production_secrets(Settings(ENV="production", JWT_SECRET=secret))
            started = True
        except RuntimeError:
            started = False
        check(f"production JWT açarı {secret[:12]!r}… → {'açılır' if ok else 'açılmır'}",
              started == ok)
    check_production_secrets(Settings(ENV="development"))   # dev-də defolt açar olar

    await db.close()
    print("\nTƏHLÜKƏSİZLİK TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
    os._exit(0)
