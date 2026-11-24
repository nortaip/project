"""Canlı monitor (admin panel → Canlı monitor) testi.

    python tests/compat_live.py
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

MOBILE = {"X-Client-Info": "supabase-flutter/2.8.0", "User-Agent": "Dart/3.5 (dart:io)"}
WEB = {"X-Client-Info": "supabase-js-web/2.45.0",
       "User-Agent": "Mozilla/5.0 (Macintosh) Chrome/130"}


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


async def settle() -> None:
    from app.services import live

    for _ in range(20):
        if not live._tasks:
            return
        await asyncio.gather(*list(live._tasks), return_exceptions=True)


async def main() -> None:
    from app.main import app
    from app.services import live

    db = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        H = {"apikey": "ellit-public"}

        async def signup(email: str, name: str) -> tuple[str, str]:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": name}})
            assert r.status_code == 200, r.text
            return r.json()["user"]["id"], r.json()["access_token"]

        def auth(tok: str, client: dict) -> dict:
            return {**H, **client, "Authorization": f"Bearer {tok}",
                    "Prefer": "return=representation"}

        async def set_role(uid: str, role: str) -> None:
            await db.execute("update profiles set role=$2 where id=$1::uuid", uid, role)
            await db.execute("update users set role=$2 where id=$1::uuid", uid, role)

        cat = str(uuid.uuid4())
        await db.execute("insert into service_categories (id, label) values ($1::uuid, 'Santexnik')",
                         cat)
        cust, cust_tok = await signup("aysel@canli.az", "Aysel")
        prov, _ = await signup("rauf@canli.az", "Rauf Usta")
        busy, _ = await signup("elvin@canli.az", "Elvin Usta")
        bot, _ = await signup("bot@canli.az", "Bot Usta")
        adm, adm_tok = await signup("admin@canli.az", "Admin")
        for u in (prov, busy, bot):
            await set_role(u, "provider")
        await set_role(adm, "admin")
        r = await c.post("/auth/v1/token?grant_type=password", headers={**H, **WEB}, json={
            "email": "admin@canli.az", "password": "Parol#12345"})
        assert r.status_code == 200, r.text
        adm_tok = r.json()["access_token"]            # yeni token — admin rolu ilə
        # Rauf: Bakı mərkəzi, boş; Elvin: yaxında, işdə; bot: sayılmır
        await db.execute("update profiles set is_online=true, latitude=40.4093, longitude=49.8671,"
                         " specialties=array[$2], last_seen_at=now() where id=$1::uuid", prov, cat)
        await db.execute("update profiles set is_online=true, latitude=40.4100, longitude=49.8680,"
                         " last_seen_at=now() where id=$1::uuid", busy)
        await db.execute("update profiles set is_online=true, is_bot=true, latitude=40.41,"
                         " longitude=49.86 where id=$1::uuid", bot)
        await db.execute("insert into opportunities (title, created_by, date, status, provider_id,"
                         " latitude, longitude) values ('İşdə olan sifariş', $1::uuid, current_date,"
                         " 'ongoing', $2::uuid, 40.41, 49.868)", cust, busy)

        print("\n── 1. Müştəri mobil tətbiqdə: sifariş + baxış ──")
        for title, lat, lng, category in (("Kran təmiri", 40.4095, 49.8675, cat),
                                          ("Boru sızır", 40.5800, 49.9900, cat),
                                          ("Elektrik", 40.5805, 49.9905, None)):
            r = await c.post("/rest/v1/opportunities", headers=auth(cust_tok, MOBILE), json={
                "title": title, "created_by": cust, "date": "2026-12-01", "status": "pending",
                "latitude": lat, "longitude": lng, "category_id": category})
            check(f"sifariş yarandı: {title}", r.status_code == 201, r.text[:200])
        for _ in range(3):
            r = await c.get("/rest/v1/opportunities?select=id&created_by=eq." + cust,
                            headers=auth(cust_tok, MOBILE))
            check("müştəri sifarişlərinə baxır", r.status_code == 200, r.text[:200])
        await settle()

        print("\n── 2. admin_live_overview ──")
        r = await c.post("/rest/v1/rpc/admin_live_overview", headers=auth(adm_tok, WEB),
                         json={"p_cell_km": 5})
        check("admin canlı icmalı alır", r.status_code == 200, r.text[:300])
        ov = r.json()
        await settle()
        k = ov["counts"]
        check("onlayn ustalar: 2 real (1 boş, 1 işdə), bot ayrıca",
              (k["providers_online"], k["providers_free"], k["providers_busy"],
               k["providers_bots"]) == (2, 1, 1, 1), str(k))
        check("usta gözləyən sifarişlər: 3", k["orders_waiting"] == 3, str(k))
        check("aktiv iş: 1", k["jobs_active"] == 1, str(k))
        check("tətbiqdə indi: 1 müştəri (mobil)",
              k["customers_in_app"] == 1 and k["mobile_in_app"] >= 1, str(k))
        check("ümumi əmsal: 3 sifariş / 1 boş usta → x3.0",
              ov["city"] == {"demand": 3, "supply": 1, "coefficient": 3.0}, str(ov["city"]))
        zs = {(z["demand"], z["supply"]): z for z in ov["zones"]}
        check("mərkəz zonası: 1 sifariş / 1 usta → x1.0",
              (1, 1) in zs and zs[(1, 1)]["coefficient"] == 1.0, str(list(zs)))
        check("şimal zonası: 2 sifariş / 0 usta → x3.0",
              (2, 0) in zs and zs[(2, 0)]["coefficient"] == 3.0, str(list(zs)))
        check("zona altıbucaqlıdır", all(len(z["polygon"]) == 6 for z in ov["zones"]))
        pv = {p["id"]: p for p in ov["providers"]}
        check("xəritədə ustalar: kateqoriya adı, işdə/bot işarəsi",
              pv[prov]["categories"] == ["Santexnik"] and pv[busy]["busy"] and pv[bot]["bot"],
              str(ov["providers"]))
        users = {u["id"]: u for u in ov["users"]}
        check("onlayn siyahıda müştəri: ad, mobil, son hərəkət",
              cust in users and users[cust]["name"] == "Aysel"
              and users[cust]["client"] == "mobile"
              and users[cust]["activity"] in ("Sifarişlərə baxır", "Yeni sifariş"),
              str(users.get(cust)))

        r = await c.post("/rest/v1/rpc/admin_live_overview", headers=auth(adm_tok, WEB),
                         json={"p_cell_km": 5, "p_category_id": cat})
        ov2 = r.json()
        users2 = {u["id"]: u for u in ov2["users"]}
        check("admin (əvvəlki sorğusundan) veb kimi görünür",
              users2.get(adm, {}).get("client") == "web"
              and users2[adm]["activity"] == "Canlı monitorda"
              and ov2["counts"]["admins_in_app"] == 1, str(users2.get(adm)))
        check("kateqoriya filtri: 2 sifariş, 1 usta",
              r.status_code == 200 and ov2["city"]["demand"] == 2
              and ov2["counts"]["providers_online"] == 1, str(ov2.get("city")))

        print("\n── 3. admin_live_feed ──")
        r = await c.post("/rest/v1/rpc/admin_live_feed", headers=auth(adm_tok, WEB), json={})
        check("admin canlı axını alır", r.status_code == 200, r.text[:300])
        feed = r.json()["items"]
        labels = [(i["kind"], i["label"], i.get("name")) for i in feed]
        check("'Tətbiqi açdı' (müştəri, mobil)",
              ("online", "Tətbiqi açdı", "Aysel") in labels, str(labels))
        check("'Yeni sifariş' adı ilə",
              sum(1 for x in labels if x == ("action", "Yeni sifariş", "Aysel")) == 3, str(labels))
        check("baxış bir dəfə yazılır (60 s-də təkrarlanmır)",
              sum(1 for x in labels if x[1] == "Sifarişlərə baxır") == 1, str(labels))
        check("admin sorğuları (canlı monitor) axını doldurmur",
              not any("admin_live" in (i.get("path") or "") for i in feed), str(labels))
        check("giriş və qeydiyyat kimin olduğu ilə yazılır",
              ("action", "Giriş", "Admin") in labels
              and ("action", "Qeydiyyat", "Aysel") in labels, str(labels))
        check("axında token yoxdur",
              not any(cust_tok in str(i) or adm_tok in str(i) for i in feed))
        last = r.json()["last_id"]
        r = await c.post("/rest/v1/opportunities", headers=auth(cust_tok, MOBILE), json={
            "title": "Yeni iş", "created_by": cust, "date": "2026-12-02", "status": "pending"})
        await settle()
        r = await c.post("/rest/v1/rpc/admin_live_feed", headers=auth(adm_tok, WEB),
                         json={"p_after": last})
        new = r.json()["items"]
        check("p_after: yalnız yeni hadisə gəlir",
              [(i["kind"], i["label"]) for i in new] == [("action", "Yeni sifariş")], str(new))

        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok, MOBILE),
                         json={"provider_id": prov, "rating": 5})
        await settle()
        r = await c.post("/rest/v1/rpc/admin_live_feed", headers=auth(adm_tok, WEB),
                         json={"p_after": new[0]["id"]})
        fails = [i for i in r.json()["items"] if i["kind"] == "fail"]
        check("uğursuz cəhd axında 'fail' kimi", len(fails) == 1 and fails[0]["label"] == "Rəy"
              and fails[0]["status"] in (401, 403), str(r.json()["items"]))

        print("\n── 4. İcazələr ──")
        r = await c.post("/rest/v1/rpc/admin_live_overview", headers=auth(cust_tok, MOBILE),
                         json={})
        check("müştəri canlı icmalı ala bilmir", r.status_code == 403, r.text[:200])
        r = await c.post("/rest/v1/rpc/admin_live_feed", headers=H, json={})
        check("anonim canlı axını ala bilmir", r.status_code == 401, r.text[:200])

        print("\n── 5. Presence müddəti ──")
        from app.db.session import redis
        await redis.zadd(live.PRESENCE_KEY, {cust: 1})          # çoxdan görünüb
        r = await c.post("/rest/v1/rpc/admin_live_overview", headers=auth(adm_tok, WEB),
                         json={"p_cell_km": 5})
        check("2 dəqiqədən çox görünməyən onlayn sayılmır",
              r.json()["counts"]["customers_in_app"] == 0, str(r.json()["counts"]))
    await settle()
    await db.close()
    print("\nCANLI MONİTOR TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
