"""E2E — geri ödəmə (refund) və dövri pul işləri: məbləğlər qəpiyinə qədər.

Canlı Supabase-də refund_offer_payment və dövri işlər işləmirdi; burada
düzgün davranış yoxlanır:
  * kart: müştəri ödədiyi HƏR ŞEYİ (məbləğ + servis haqqı) geri alır,
    provayderin kilidli escrow-u açılır, provayderə pul keçmir
  * nağd: müştəri yalnız ödədiyi depozit + haqqı geri alır (tam məbləği yox)
  * təkrar çağırış pulu ikinci dəfə qaytarmır
  * no-show cron-u (30 dəq) avtomatik refund edir
  * tamamlanmış sifarişin escrow-u 24 saatdan sonra cron ilə açılır — bir dəfə
  * köhnəlmiş sifarişin ləğvi gözləyən təklifləri də bağlayır

İşə salma (təmiz baza):  python tests/e2e_refund.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")

import httpx  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


async def main() -> None:
    from sqlalchemy import text

    from app.db.session import SessionLocal
    from app.main import app
    from app.services import cron

    async def scalar(sql: str, **p):
        async with SessionLocal() as db:
            return (await db.execute(text(sql), p)).scalar()

    async def bal(uid: str) -> Decimal:
        return Decimal(await scalar("select coalesce(balance,0) from profiles where id=:i", i=uid))

    async def locked(uid: str) -> Decimal:
        return Decimal(await scalar(
            "select coalesce((select locked_balance from provider_wallets"
            " where provider_id=:i), 0)", i=uid))

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        async def reg(email: str, role: str) -> tuple[str, dict]:
            r = await c.post("/api/v1/auth/register", json={
                "email": email, "password": "Refund#Parol1", "name": email, "role": role})
            assert r.status_code == 201, r.text
            return r.json()["user_id"], {"Authorization": f"Bearer {r.json()['access_token']}"}

        cust, ch = await reg("refund.musteri@test.az", "customer")
        prov, ph = await reg("refund.usta@test.az", "provider")
        prov2, ph2 = await reg("refund.usta2@test.az", "provider")
        async with SessionLocal() as db:
            cat = str((await db.execute(text(
                "insert into service_categories (label) values ('Refund testi') returning id"
            ))).scalar())
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'), ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '2'), ('cash_deposit_pct', '20')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text("update profiles set balance = 1000 where id = :i"), {"i": cust})
            await db.execute(text(
                "update profiles set is_verified = true, last_kyc_approved_at = now(),"
                " balance = 100 where id in (:a, :b)"), {"a": prov, "b": prov2})
            await db.commit()
        from app.services import money
        money._CONFIG_CACHE.clear() if hasattr(money, "_CONFIG_CACHE") else None

        async def order(title: str, amount: str, method: str, who=ph) -> tuple[str, str]:
            r = await c.post("/api/v1/opportunities", headers=ch, json={
                "title": title, "category_id": cat, "date": "2026-12-10"})
            assert r.status_code == 201, r.text
            opp = r.json()["id"]
            r = await c.post("/api/v1/offers", headers=who, json={
                "opportunity_id": opp, "amount": amount})
            assert r.status_code == 201, r.text
            off = r.json()["id"]
            r = await c.post(f"/api/v1/offers/{off}/accept", headers=ch, json={"method": method})
            assert r.status_code == 200, r.text
            return opp, off

        # ── 1. KART: 200 ₼ + 2% haqq = 204 ödənir ──
        c0, p0 = await bal(cust), await bal(prov)
        opp, off = await order("Kart refund", "200.00", "card")
        check("kart: müştəridən 204 ₼ tutuldu (200 + 2% haqq)", c0 - await bal(cust) == Decimal("204"))
        check("kart: escrow 180 ₼ kilidləndi (200 − 10%)", await locked(prov) == Decimal("180"))
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ph2, json={"reason": "yad"})
        check("yad şəxs refund edə bilmir", r.status_code == 409 and await bal(cust) == c0 - 204)
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ch, json={"reason": "Usta gəlmədi"})
        check("kart refund", r.status_code == 200 and r.json()["refunded_amount"] == "204.00", r.text[:200])
        check("kart: müştəri balansı tam bərpa olundu", await bal(cust) == c0, str(await bal(cust)))
        check("kart: escrow açıldı, provayderə pul keçmədi",
              await locked(prov) == 0 and await bal(prov) == p0)
        check("təklif/sifariş statusu refunded",
              await scalar("select status from opportunities_offers where id=:i", i=off) == "refunded"
              and await scalar("select status from opportunities where id=:i", i=opp) == "refunded")
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ch, json={"reason": "təkrar"})
        check("təkrar refund pulu ikinci dəfə qaytarmır",
              r.status_code == 200 and r.json().get("already_refunded") is True
              and await bal(cust) == c0
              and await scalar("select count(*) from transactions where type='refund'"
                               " and related_id=:r", r=off) == 1)
        r = await c.post(f"/api/v1/offers/{off}/complete", headers=ch)
        check("refund olunmuş təklif tamamlana bilmir", r.status_code == 409
              and await bal(prov) == p0)

        # ── 2. NAĞD: depozit 20% (20) + haqq 2% (2) = 22 ödənir ──
        c1, p1 = await bal(cust), await bal(prov)
        opp, off = await order("Nağd refund", "100.00", "cash")
        check("nağd: müştəridən 22 ₼ tutuldu (depozit 20 + haqq 2)", c1 - await bal(cust) == Decimal("22"))
        check("nağd: ustadan komissiya 10 ₼ tutuldu", p1 - await bal(prov) == Decimal("10"))
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ch, json={"reason": "Ləğv"})
        check("nağd refund yalnız ödənilən 22 ₼-ı qaytarır (100 yox)",
              r.status_code == 200 and r.json()["refunded_amount"] == "22.00"
              and await bal(cust) == c1, r.text[:200])

        # ── 3. Cron: 30 dəq yola düşməyən usta → avtomatik refund ──
        c2 = await bal(cust)
        opp, off = await order("No-show", "50.00", "card")
        check("təzə qəbul hələ refund olunmur", await cron.refund_no_show() == 0)
        async with SessionLocal() as db:
            await db.execute(text("set local session_replication_role = replica"))
            await db.execute(text(
                "update opportunities_offers set updated_at = now() - interval '31 minutes'"
                " where id = :i"), {"i": off})
            await db.commit()
        check("no-show cron 1 təklifi refund etdi", await cron.refund_no_show() == 1)
        check("no-show: müştəri pulunu tam geri aldı", await bal(cust) == c2)
        check("no-show: ledger-də sistem sətri (created_by boş)", await scalar(
            "select count(*) from transactions where type='refund' and related_id=:r"
            " and created_by is null and description='AUTO_REFUND_PROVIDER_NO_SHOW'", r=off) == 1)
        check("no-show cron təkrar işləyəndə heç nə etmir", await cron.refund_no_show() == 0
              and await bal(cust) == c2)

        # ── 4. Cron: tamamlanmış sifarişin escrow-u 24 saatdan sonra açılır ──
        p3 = await bal(prov)
        opp, off = await order("Auto-release", "100.00", "card")
        for st in ("ongoing", "completed"):
            r = await c.post(f"/api/v1/opportunities/{opp}/status", headers=ph, json={"status": st})
            if r.status_code != 200:
                r = await c.post(f"/api/v1/opportunities/{opp}/status", headers=ch, json={"status": st})
            check(f"status → {st}", r.status_code == 200, r.text[:160])
        check("24 saat keçməyib → açılmır", await cron.auto_release_completed_escrow() == 0
              and await bal(prov) == p3)
        async with SessionLocal() as db:
            await db.execute(text("set local session_replication_role = replica"))
            await db.execute(text(
                "update opportunities set completed_at = now() - interval '25 hours'"
                " where id = :i"), {"i": opp})
            await db.commit()
        check("auto-release cron 1 escrow açdı", await cron.auto_release_completed_escrow() == 1)
        # escrow 90 (100−10%), tamamlama komissiyası 5% = 4.50 → 85.50
        check("usta 85.50 ₼ aldı (90 − 5%)", await bal(prov) - p3 == Decimal("85.50"),
              str(await bal(prov) - p3))
        check("auto-release ikinci dəfə ödəmir", await cron.auto_release_completed_escrow() == 0
              and await bal(prov) - p3 == Decimal("85.50")
              and await scalar("select count(*) from transactions where type='escrow_release'"
                               " and related_id=:r", r=off) == 1)
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ch, json={"reason": "gec"})
        check("ödənilmiş təklif refund oluna bilmir", r.status_code == 409)

        # ── 5. Cron: 2 saat təklifsiz qalan sifariş ləğv olunur ──
        r = await c.post("/api/v1/opportunities", headers=ch, json={
            "title": "Köhnəlmiş", "category_id": cat, "date": "2026-12-11"})
        stale = r.json()["id"]
        r = await c.post("/api/v1/offers", headers=ph2, json={
            "opportunity_id": stale, "amount": "70.00"})
        stale_offer = r.json()["id"]
        async with SessionLocal() as db:
            await db.execute(text(
                "update opportunities set created_at = now() - interval '3 hours'"
                " where id = :i"), {"i": stale})
            await db.commit()
        n = await cron.cancel_stale_pending()
        check("köhnəlmiş sifariş ləğv olundu", n == 1 and await scalar(
            "select status from opportunities where id=:i", i=stale) == "cancelled")
        check("gözləyən təklifi də bağlandı", await scalar(
            "select status from opportunities_offers where id=:i", i=stale_offer) == "cancelled")
        check("ləğv audit loguna sistem kimi düşdü", await scalar(
            "select actor_role from opportunity_audit_log where opportunity_id=:i"
            " and new_status='cancelled'", i=stale) == "system")

        # ── 6. Ləğv: müştəri ödədiyi xalis məbləği geri alır ──
        c6, p6 = await bal(cust), await bal(prov)
        opp, off = await order("Ləğv kart", "200.00", "card")
        r = await c.post(f"/api/v1/opportunities/{opp}/cancel", headers=ch,
                         json={"reason": "Planlar dəyişdi"})
        check("kart sifariş ləğvi: 204 ₼ tam qaytarıldı (haqq daxil)",
              r.status_code == 200 and await bal(cust) == c6, r.text[:200])
        check("kart ləğvi: escrow açıldı, usta balansı dəyişmədi",
              await locked(prov) == 0 and await bal(prov) == p6)
        opp, off = await order("Ləğv nağd", "100.00", "cash")
        c7 = await bal(cust)
        r = await c.post(f"/api/v1/opportunities/{opp}/cancel", headers=ch,
                         json={"reason": "Ehtiyac qalmadı"})
        check("nağd sifariş ləğvi: depozit + haqq (22 ₼) qaytarıldı",
              r.status_code == 200 and await bal(cust) - c7 == Decimal("22"), r.text[:200])

        # Admin ləğvi: pul adminə yox, sifariş sahibinə gedir
        adm, ah = await reg("refund.admin@test.az", "customer")
        async with SessionLocal() as db:
            await db.execute(text("update users set role='admin' where id=:i"), {"i": adm})
            await db.execute(text("update profiles set role='admin' where id=:i"), {"i": adm})
            await db.commit()
        r = await c.post("/api/v1/auth/login", json={
            "email": "refund.admin@test.az", "password": "Refund#Parol1"})
        ah = {"Authorization": f"Bearer {r.json()['access_token']}"}
        c8, a8 = await bal(cust), await bal(adm)
        opp, off = await order("Admin ləğvi", "50.00", "card")
        r = await c.post(f"/api/v1/opportunities/{opp}/cancel", headers=ah,
                         json={"reason": "Admin müdaxiləsi"})
        check("admin ləğvi: pul sifariş sahibinə qaytarıldı, adminə yox",
              r.status_code == 200 and await bal(cust) == c8 and await bal(adm) == a8,
              r.text[:200])
        r = await c.post(f"/api/v1/offers/{off}/refund", headers=ch, json={"reason": "təkrar"})
        check("ləğvdən sonra təkrar refund pulu ikinci dəfə qaytarmır",
              await bal(cust) == c8, r.text[:200])

    print("\nREFUND / DÖVRİ PUL İŞLƏRİ E2E KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
