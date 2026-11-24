"""Server jurnalı (admin panel → Server jurnalı) testi.

    python tests/compat_server_logs.py
"""
from __future__ import annotations

import asyncio
import logging
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
    from app.core import dblog
    from app.main import app
    from app.services.cron import purge_server_logs

    dblog.install("api")
    db = await asyncpg.connect(os.environ["DATABASE_URL"].replace("+asyncpg", ""))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        H = {"apikey": "ellit-public"}

        async def signup(email: str) -> tuple[str, str]:
            r = await c.post("/auth/v1/signup", headers=H, json={
                "email": email, "password": "Parol#12345", "data": {"name": email[:5]}})
            assert r.status_code == 200, r.text
            return r.json()["user"]["id"], r.json()["access_token"]

        def auth(tok: str) -> dict:
            return {**H, "Authorization": f"Bearer {tok}", "Prefer": "return=representation"}

        cust, cust_tok = await signup("musteri@jurnal.az")
        adm, adm_tok = await signup("admin@jurnal.az")
        await db.execute("update profiles set role='admin' where id=$1::uuid", adm)
        await db.execute("update users set role='admin' where id=$1::uuid", adm)

        print("\n── 1. HTTP fəaliyyəti ──")
        r = await c.post("/rest/v1/opportunities", headers=auth(cust_tok), json={
            "title": "Jurnal sifarişi", "created_by": cust, "date": "2026-12-01",
            "status": "pending"})
        check("müştəri sifariş yaratdı", r.status_code == 201, r.text[:200])
        r = await c.patch(f"/rest/v1/profiles?id=eq.{cust}", headers=auth(cust_tok),
                          json={"latitude": 40.4, "longitude": 49.8})
        check("canlı yer yeniləməsi (uğurlu)", r.status_code in (200, 204), r.text[:200])
        await c.get("/rest/v1/service_categories?select=id", headers=H)
        r = await c.post("/rest/v1/rpc/home_overview", headers=auth(cust_tok), json={})
        check("oxuyan RPC (home_overview) işlədi", r.status_code == 200, r.text[:200])
        r = await c.post("/rest/v1/provider_reviews", headers=auth(cust_tok), json={
            "provider_id": adm, "rating": 5})
        check("icazəsiz rəy rədd olundu", r.status_code in (401, 403), r.text[:200])
        logging.getLogger("ellit.push").warning("push göndərilmədi (ios): test")
        logging.getLogger("ellit.whatsapp").info("WhatsApp göndərildi (•••123)")
        logging.getLogger("sqlalchemy.engine").info("SELECT 1 — səs-küy")
        await dblog.flush()

        rows = await db.fetch("select level, source, logger, message, context"
                              " from server_logs order by id")
        msgs = [r["message"] for r in rows]
        new_order = [r for r in rows if r["message"].startswith("Yeni sifariş")]
        check("'Yeni sifariş' yazıldı (istifadəçi ID-si, status, müddət ilə)",
              len(new_order) == 1 and new_order[0]["level"] == "INFO"
              and new_order[0]["source"] == "api"
              and '"user": "' + cust + '"' in new_order[0]["context"]
              and '"status": 201' in new_order[0]["context"], str(msgs))
        check("canlı yer yeniləməsi jurnala düşmür (səs-küy)",
              not any("/rest/v1/profiles" in m for m in msgs), str(msgs))
        check("GET sorğuları yazılmır",
              not any("service_categories" in m for m in msgs), str(msgs))
        check("yalnız oxuyan RPC (home_overview) yazılmır",
              not any("home_overview" in m for m in msgs), str(msgs))
        denied = [r for r in rows if r["message"].startswith("Rəy — UĞURSUZ 403")
                  or r["message"].startswith("Rəy — UĞURSUZ 401")]
        check("rədd olunan əməliyyat WARNING kimi yazılır",
              len(denied) == 1 and denied[0]["level"] == "WARNING", str(msgs))
        check("tətbiq loqları düşür (push xəbərdarlığı, WhatsApp INFO)",
              any(r["logger"] == "ellit.push" and r["level"] == "WARNING" for r in rows)
              and any(r["logger"] == "ellit.whatsapp" and r["level"] == "INFO" for r in rows),
              str(msgs))
        check("kitabxana səs-küyü (sqlalchemy INFO) düşmür",
              not any((r["logger"] or "").startswith("sqlalchemy") for r in rows))
        check("token / Authorization jurnala yazılmır",
              not any(cust_tok in (r["context"] or "") + r["message"] for r in rows))

        print("\n── 2. Kim oxuya bilər ──")
        r = await c.get("/rest/v1/server_logs?select=id,level,message&order=id.desc&limit=50",
                        headers=auth(adm_tok))
        check("admin jurnalı oxuyur", r.status_code == 200 and len(r.json()) >= 4, r.text[:200])
        r = await c.get("/rest/v1/server_logs?select=id", headers=auth(cust_tok))
        check("adi istifadəçi heç nə görmür", r.status_code == 200 and r.json() == [], r.text)
        r = await c.get("/rest/v1/server_logs?select=id", headers=H)
        check("anonim oxuya bilmir", r.status_code in (401, 403)
              or (r.status_code == 200 and r.json() == []), r.text[:200])
        r = await c.post("/rest/v1/server_logs", headers=auth(adm_tok), json={
            "level": "INFO", "source": "x", "message": "saxta"})
        check("heç kim (admin də) jurnala yaza bilmir", r.status_code in (401, 403), r.text[:200])

        print("\n── 3. Köhnə qeydlərin silinməsi ──")
        await db.execute("insert into server_logs (created_at, level, source, message)"
                         " values (now() - interval '30 days', 'INFO', 'api', 'köhnə')")
        n = await purge_server_logs()
        left = await db.fetchval("select count(*) from server_logs where message = 'köhnə'")
        check("14 gündən köhnə qeyd silindi", n >= 1 and left == 0, f"{n} {left}")
    await dblog.stop()
    await db.close()
    print("\nSERVER JURNALI TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
