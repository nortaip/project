"""/rest/v1 uyğunluq testi — cədvəl sorğuları RLS altında.

Canlı server (uvicorn) qaldırılır, data toxumlanır və veb tətbiqin istifadə
etdiyi HƏQİQİ `@supabase/supabase-js` klienti ilə sorğular icra olunur
(tests/js/rest_client.mjs); üstəlik xam HTTP ilə protokol və təhlükəsizlik
yoxlamaları (identifikator/dəyər inyeksiyası, vaxtı bitmiş token, CORS).

İşə salma (təmiz baza + `alembic upgrade head` sonra):
    python tests/compat_rest.py
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import asyncpg  # noqa: E402
import httpx  # noqa: E402

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(os.environ.get("COMPAT_TEST_PORT", "18100"))
URL = f"http://127.0.0.1:{PORT}"


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


async def main() -> None:
    dsn = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT),
         "--log-level", "warning"], cwd=BACKEND, env=dict(os.environ))
    try:
        async with httpx.AsyncClient(base_url=URL, timeout=20) as c:
            for _ in range(60):
                try:
                    if (await c.get("/health")).status_code == 200:
                        break
                except httpx.HTTPError:
                    await asyncio.sleep(0.25)
            else:
                raise SystemExit("server qalxmadı")

            # ── İstifadəçilər ──
            ids, tok = {}, {}
            people = [("cust1", "Müştəri Bir", "customer"), ("cust2", "Müştəri İki", "customer"),
                      ("prov1", "Usta Bir", "provider"), ("prov2", "Usta İki", "provider"),
                      ("admin", "Admin", "customer")]
            for key, name, role in people:
                r = await c.post("/api/v1/auth/register", json={
                    "email": f"{key}@rest-test.az", "password": "Rest#Parol1", "name": name, "role": role})
                assert r.status_code == 201, r.text
                ids[key], tok[key] = r.json()["user_id"], r.json()["access_token"]

            db = await asyncpg.connect(dsn)
            await db.execute("update users set role='admin' where id=$1::uuid", ids["admin"])
            await db.execute("update profiles set role='admin' where id=$1::uuid", ids["admin"])
            r = await c.post("/api/v1/auth/login", json={
                "email": "admin@rest-test.az", "password": "Rest#Parol1"})
            tok["admin"] = r.json()["access_token"]

            # ── Toxum data (sahib kimi, RLS-siz) ──
            cat = await db.fetchval("insert into service_categories (label) values ('Santexnik') returning id")
            cat2 = await db.fetchval("insert into service_categories (label) values ('Elektrik') returning id")
            sub = await db.fetchval(
                "insert into service_subcategories (category_id, label) values ($1, 'Kran') returning id", cat)
            await db.execute("update profiles set balance = 100 where id = $1::uuid", ids["cust1"])
            await db.execute("update profiles set specialties = array[$2::text] where id = $1::uuid",
                             ids["prov1"], str(cat))
            opp = await db.fetchval(
                "insert into opportunities (title, description, created_by, date, category_id,"
                " subcategory_id, location, extra_answers, status) values ('Kran sızır', 'Mətbəx',"
                " $1::uuid, '2026-12-01', $2, $3, 'Bakı', '{\"foto\": \"var\", \"otaq\": 3}',"
                " 'pending') returning id",
                ids["cust1"], cat, sub)
            for who, amount in (("prov1", 50), ("prov2", 80)):
                await db.execute(
                    "insert into opportunities_offers (opportunity_id, provider_id, offer_amount, status)"
                    " values ($1, $2::uuid, $3, 'pending')", opp, ids[who], amount)
            base = datetime.now(timezone.utc) - timedelta(minutes=10)
            for i, (title, read) in enumerate((("Birinci", True), ("İkinci", False), ("Üçüncü", False))):
                await db.execute(
                    "insert into notifications (user_id, title, body, is_read, created_at)"
                    " values ($1::uuid, $2, 'mətn', $3, $4)", ids["cust1"], title, read,
                    base + timedelta(minutes=i))
            await db.execute(
                "insert into notifications (user_id, title, body) values ($1::uuid, 'Gizli', 'başqasının')",
                ids["cust2"])
            service = await db.fetchval(
                "insert into services (title, location, provider_id, images) values"
                " ('Kombi təmiri', 'Bakı', $1::uuid, array['a.jpg']) returning id", ids["prov1"])
            await db.execute(
                "insert into bookings (service_id, customer_id, provider_id, status, date, \"time\","
                " total_amount, fee_paid) values ($1, $2::uuid, $3::uuid, 'pending', '2026-12-05',"
                " '10:00', 40, true)", service, ids["cust1"], ids["prov1"])
            brigade = await db.fetchval(
                "insert into brigades (owner_id, name) values ($1::uuid, 'Ellit Komanda') returning id",
                ids["prov1"])
            member = await db.fetchval(
                "select id from brigade_members where brigade_id = $1 and profile_id = $2::uuid",
                brigade, ids["prov1"])
            await db.execute(
                "insert into brigade_assignments (brigade_id, member_id, source_type, source_id, status)"
                " values ($1, $2, 'opportunity', $3, 'offered')", brigade, member, str(opp))

            # ── Xam HTTP: protokol + təhlükəsizlik ──
            h1 = {"Authorization": f"Bearer {tok['cust1']}", "apikey": "anon"}
            r = await c.get("/rest/v1/notifications?select=id&order=created_at.asc", headers={**h1, "Range": "0-1"})
            check("Range başlığı + Content-Range", r.status_code == 200 and len(r.json()) == 2
                  and r.headers["content-range"] == "0-1/*", f"{r.status_code} {r.headers.get('content-range')}")
            r = await c.get("/rest/v1/notifications?select=id", headers={**h1, "Prefer": "count=exact"})
            check("count=exact → Content-Range cəmi", r.headers["content-range"] == "0-2/3", r.headers.get("content-range", ""))
            r = await c.get("/rest/v1/notifications?select=id&limit=1",
                            headers={**h1, "Accept": "application/vnd.pgrst.object+json"})
            check("object+json → tək obyekt", r.status_code == 200 and isinstance(r.json(), dict))
            r = await c.get("/rest/v1/notifications?select=id",
                            headers={**h1, "Accept": "application/vnd.pgrst.object+json"})
            check("object+json, çox sətir → 406 PGRST116", r.status_code == 406
                  and r.json()["code"] == "PGRST116" and "3 rows" in r.json()["details"], r.text)
            for evil in ("/rest/v1/profiles?select=id&id=eq.x';drop table profiles;--",
                         "/rest/v1/profiles?select=id,name;drop table profiles",
                         "/rest/v1/profiles?select=id&order=name;drop table profiles",
                         "/rest/v1/profiles?select=id&name;drop=eq.1",
                         "/rest/v1/profiles?select=id&or=(name.eq.a);drop table profiles",
                         "/rest/v1/profiles?select=x:id::text;drop",
                         "/rest/v1/profiles%3Bdrop%20table%20profiles?select=id",
                         "/rest/v1/profiles?select=id,secret:users(password_hash)",
                         "/rest/v1/profiles?select=id&id=in.(select id from users)"):
                r = await c.get(evil, headers=h1)
                check("inyeksiya cəhdi 4xx ilə rədd olunur", 400 <= r.status_code < 500, f"{evil} → {r.status_code}")
            check("inyeksiyalardan sonra cədvəl yerindədir",
                  await db.fetchval("select count(*) from profiles") == 5)
            r = await c.get("/rest/v1/profiles?select=id&name=eq." + "Robert'); DROP TABLE profiles;--", headers=h1)
            check("dəyərdə SQL mətni sadəcə dəyərdir (200, boş)", r.status_code == 200 and r.json() == [])

            from app.core.config import settings
            from jose import jwt
            expired = jwt.encode(
                {"sub": ids["cust1"], "role": "customer", "type": "access",
                 "iat": int(time.time()) - 7200, "exp": int(time.time()) - 3600, "jti": "x"},
                settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
            r = await c.get("/rest/v1/notifications?select=id", headers={"Authorization": f"Bearer {expired}"})
            check("vaxtı bitmiş token → 401 (klient yeniləsin)", r.status_code == 401 and r.json()["code"] == "PGRST301", r.text)
            forged = jwt.encode(
                {"sub": ids["cust2"], "role": "admin", "type": "access",
                 "exp": int(time.time()) + 3600}, "basqa-sirr", algorithm="HS256")
            r = await c.get("/rest/v1/notifications?select=id", headers={"Authorization": f"Bearer {forged}"})
            check("saxta imzalı token anonim sayılır (data yox)",
                  r.status_code in (200, 401) and (r.status_code == 401 or r.json() == []), r.text)
            r = await c.options("/rest/v1/profiles", headers={
                "Origin": "https://ellit.az", "Access-Control-Request-Method": "PATCH",
                "Access-Control-Request-Headers": "apikey,authorization,prefer,x-client-info,content-type"})
            check("CORS preflight supabase-js başlıqlarını buraxır", r.status_code == 200
                  and "prefer" in r.headers.get("access-control-allow-headers", "").lower(), str(dict(r.headers)))
            r = await c.get("/rest/v1/profiles?select=id&limit=1", headers={**h1, "Origin": "https://ellit.az"})
            check("Content-Range brauzerə açıqdır (expose)",
                  "content-range" in r.headers.get("access-control-expose-headers", "").lower())

            # RLS konteksti sızmır: ardıcıl fərqli istifadəçilər eyni pool bağlantılarını işlədir
            seen = set()
            for _ in range(12):
                for key in ("cust1", "cust2"):
                    r = await c.get("/rest/v1/notifications?select=user_id",
                                    headers={"Authorization": f"Bearer {tok[key]}"})
                    seen |= {(key, row["user_id"]) for row in r.json()}
            check("pool bağlantılarında kimlik qarışmır",
                  seen == {("cust1", ids["cust1"]), ("cust2", ids["cust2"])}, str(seen))
            r = await c.get("/api/v1/profiles/me", headers={"Authorization": f"Bearer {tok['cust1']}"})
            check("RLS sorğularından sonra adi API işləyir (rol sıfırlanıb)", r.status_code == 200)

            # ── supabase-js ilə ──
            ctx = {"url": URL, "tok": tok,
                   "id": {**ids, "cat": str(cat), "cat2": str(cat2), "sub": str(sub), "opp": str(opp),
                          "service": service, "brigade": str(brigade)}}
            p = subprocess.run(["node", "tests/js/rest_client.mjs"], cwd=BACKEND,
                               env={**os.environ, "CTX": json.dumps(ctx)},
                               capture_output=True, text=True)
            print(p.stdout.rstrip())
            check("supabase-js paketi", p.returncode == 0, p.stderr[-600:])

            check("qorunan sütunlar bazada dəyişməyib", await db.fetchrow(
                "select balance, is_verified, role from profiles where id=$1::uuid", ids["cust1"])
                  == (100, False, "customer"))
            check("admin rolu users cədvəli ilə sinxrondur", await db.fetchval(
                "select role from users where id=$1::uuid", ids["admin"]) == "admin")
            await db.close()
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()

    print("\nREST UYĞUNLUQ TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
