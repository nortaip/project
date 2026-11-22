"""CORS + rate limit reqressiya testi.

Əvvəl rate limit middleware-i CORS-dan xaricdə idi: brauzerin OPTIONS
yoxlamaları da limitə sayılırdı və 429 cavabında CORS başlığı olmurdu —
vebdə "No 'Access-Control-Allow-Origin' header" xətası (KYC admin səhifəsində
sənəd şəkillərinin imzalı linkləri yüklənmirdi).

    python tests/compat_cors.py
"""
from __future__ import annotations

import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["RATE_LIMIT_DEFAULT"] = "5/minute"     # kiçik limit — 429-u görmək üçün
os.environ.setdefault("RATE_LIMIT_AUTH", "100000/minute")
os.environ.setdefault("CORS_ORIGINS", "https://ellit.az")

import httpx  # noqa: E402

ORIGIN = "https://ellit.az"


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


async def main() -> None:
    from app.db.session import redis
    from app.main import app

    await redis.flushdb()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        print("\n── 1. Brauzer yoxlaması (OPTIONS) limitə sayılmır ──")
        pre = {"Origin": ORIGIN, "Access-Control-Request-Method": "POST",
               "Access-Control-Request-Headers": "authorization,apikey,content-type,x-client-info"}
        codes = []
        for i in range(20):
            r = await c.options(
                f"/storage/v1/object/sign/kyc-documents/u/{i}_id_front.jpg", headers=pre)
            codes.append((r.status_code, r.headers.get("access-control-allow-origin")))
        check("20 OPTIONS yoxlamasının hamısı 200 + Access-Control-Allow-Origin",
              all(s == 200 and o == ORIGIN for s, o in codes), str(codes[:3]))

        print("\n── 2. Limit aşılanda 429 cavabında da CORS başlığı var ──")
        got = None
        for _ in range(30):
            r = await c.get("/rest/v1/service_categories?select=id",
                            headers={"Origin": ORIGIN, "apikey": "ellit-public"})
            if r.status_code == 429:
                got = r
                break
        check("limit aşıldı (429)", got is not None)
        check("429 cavabında Access-Control-Allow-Origin var (brauzer xətanı görür)",
              got.headers.get("access-control-allow-origin") == ORIGIN, str(dict(got.headers)))
        r = await c.options("/rest/v1/service_categories", headers=pre)
        check("limit dolu olanda da OPTIONS yoxlaması keçir", r.status_code == 200
              and r.headers.get("access-control-allow-origin") == ORIGIN, str(r.status_code))
        r = await c.options("/rest/v1/service_categories",
                            headers={**pre, "Origin": "https://pis-sayt.example"})
        check("başqa saytın yoxlamasına icazə verilmir",
              r.headers.get("access-control-allow-origin") is None, str(dict(r.headers)))
    await redis.flushdb()
    print("\nCORS / RATE LIMIT TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
