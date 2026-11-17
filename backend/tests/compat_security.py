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
