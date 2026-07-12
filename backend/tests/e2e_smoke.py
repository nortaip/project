"""E2E smoke test — real PostgreSQL + Redis üzərində tam istifadəçi axını.

Axın: qeydiyyat (müştəri + usta) → sifariş yarat → açıq sifarişləri gör →
təklif ver → təklifləri gör → KART ilə qəbul (escrow) → tamamla (release)
→ balans/ledger yoxlamaları.

İşə salma (DATABASE_URL/REDIS_URL env ilə):
    python tests/e2e_smoke.py
"""
from __future__ import annotations

import asyncio
import os
import sys
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

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

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        # ── 0. Health ──
        r = await c.get("/health")
        check("health", r.status_code == 200)

        # ── 1. Qeydiyyat ──
        r = await c.post("/api/v1/auth/register", json={
            "email": "musteri@test.az", "password": "Guclu!Parol1",
            "name": "Test Müştəri", "role": "customer"})
        check("müştəri qeydiyyatı", r.status_code == 201, str(r.json())[:80])
        cust = r.json()
        r = await c.post("/api/v1/auth/register", json={
            "email": "usta@test.az", "password": "Guclu!Parol2",
            "name": "Test Usta", "role": "provider"})
        check("usta qeydiyyatı", r.status_code == 201)
        prov = r.json()
        ch = {"Authorization": f"Bearer {cust['access_token']}"}
        ph = {"Authorization": f"Bearer {prov['access_token']}"}

        # Login yenidən işləyirmi
        r = await c.post("/api/v1/auth/login", json={
            "email": "musteri@test.az", "password": "Guclu!Parol1"})
        check("login", r.status_code == 200)
        r = await c.post("/api/v1/auth/login", json={
            "email": "musteri@test.az", "password": "SEHV"})
        check("yanlış parol rədd olunur", r.status_code == 401)

        # ── 2. Seed: kateqoriya + komissiya konfiqi + müştəri balansı ──
        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "insert into service_categories (label) values ('Santexnik')"
                " returning id"))).first()
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'),"
                " ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '0')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text(
                "update profiles set balance = 500 where id = :id"),
                {"id": cust["user_id"]})
            await db.commit()
            cat_id = str(cat.id)

        # ── 3. Kataloq public işləyir ──
        r = await c.get("/api/v1/catalog/categories")
        check("kataloq", r.status_code == 200 and len(r.json()) == 1)

        # ── 4. Sifariş yarat (müştəri) ──
        r = await c.post("/api/v1/opportunities", headers=ch, json={
            "title": "Kran sızır", "description": "Mətbəxdə kran dəyişimi",
            "category_id": cat_id, "date": "2026-07-15",
            "location": "40.4093, 49.8671", "latitude": 40.4093, "longitude": 49.8671})
        check("sifariş yaradıldı", r.status_code == 201, str(r.json()))
        opp_id = r.json()["id"]

        # Usta öz sifarişi olmayan açıq sifarişləri görür
        r = await c.get("/api/v1/opportunities/open", headers=ph)
        check("usta açıq sifarişi görür", r.status_code == 200 and len(r.json()) == 1)
        # Müştəri /open görə bilməz
        r = await c.get("/api/v1/opportunities/open", headers=ch)
        check("müştəriyə /open qadağandır (RBAC)", r.status_code == 403)

        # ── 5. Təklif ver (usta) ──
        r = await c.post("/api/v1/offers", headers=ph, json={
            "opportunity_id": opp_id, "amount": "100.00", "notes": "1 saata gələrəm"})
        check("təklif verildi", r.status_code == 201, str(r.json()))
        offer_id = r.json()["id"]
        # Dublikat rədd olunur
        r = await c.post("/api/v1/offers", headers=ph, json={
            "opportunity_id": opp_id, "amount": "90.00"})
        check("dublikat təklif rədd olunur", r.status_code == 409)

        # ── 6. Müştəri təklifləri görür ──
        r = await c.get(f"/api/v1/offers/by-opportunity/{opp_id}", headers=ch)
        offers = r.json()
        check("təkliflər siyahısı", r.status_code == 200 and len(offers) == 1
              and offers[0]["provider_name"] == "Test Usta")
        # Usta başqasının təkliflərini görə bilməz
        r = await c.get(f"/api/v1/offers/by-opportunity/{opp_id}", headers=ph)
        check("yad təklif siyahısı qadağandır", r.status_code == 403)

        # ── 7. KART ilə qəbul — escrow + komissiya 10% ──
        r = await c.post(f"/api/v1/offers/{offer_id}/accept", headers=ch,
                         json={"method": "card"})
        check("qəbul (card)", r.status_code == 200, str(r.json()))
        check("komissiya 10 ₼", r.json()["commission_amt"] == "10.00")

        async with SessionLocal() as db:
            bal = (await db.execute(text(
                "select balance from profiles where id=:id"),
                {"id": cust["user_id"]})).first()
            check("müştəri balansı 500→400", Decimal(bal.balance) == 400)
            w = (await db.execute(text(
                "select locked_balance from provider_wallets where provider_id=:id"),
                {"id": prov["user_id"]})).first()
            check("escrow kilidi 90 ₼ (100-10)", Decimal(w.locked_balance) == 90)
            st = (await db.execute(text(
                "select status, accepted_offer_id from opportunities where id=:id"),
                {"id": opp_id})).first()
            check("sifariş accepted", st.status == "accepted"
                  and str(st.accepted_offer_id) == offer_id)

        # Usta özü tamamlaya bilməz
        r = await c.post(f"/api/v1/offers/{offer_id}/complete", headers=ph)
        check("usta özü tamamlaya bilməz", r.status_code == 409)

        # ── 8. Müştəri tamamlayır — release (5% tamamlama komissiyası) ──
        r = await c.post(f"/api/v1/offers/{offer_id}/complete", headers=ch)
        check("tamamlama", r.status_code == 200, str(r.json()))
        check("release 85.50 ₼ (90 - 5%)", r.json()["released"] == "85.50")

        async with SessionLocal() as db:
            pb = (await db.execute(text(
                "select balance from profiles where id=:id"),
                {"id": prov["user_id"]})).first()
            check("usta balansı 85.50", Decimal(pb.balance) == Decimal("85.50"))
            w = (await db.execute(text(
                "select locked_balance from provider_wallets where provider_id=:id"),
                {"id": prov["user_id"]})).first()
            check("escrow boşaldı", Decimal(w.locked_balance) == 0)
            txn = (await db.execute(text(
                "select count(*) as c from transactions"))).first()
            check("ledger yazıları var", txn.c >= 5, f"({txn.c} tranzaksiya)")
            st = (await db.execute(text(
                "select status from opportunities where id=:id"), {"id": opp_id})).first()
            check("sifariş completed", st.status == "completed")

        # ── 9. Profil endpointləri ──
        r = await c.get("/api/v1/profiles/me", headers=ch)
        check("profilim", r.status_code == 200 and r.json()["name"] == "Test Müştəri")
        r = await c.get(f"/api/v1/profiles/{prov['user_id']}")
        check("ustanın public profili (balanssız)",
              r.status_code == 200 and "balance" not in r.json()
              and r.json()["completed_jobs"] == 1)

        # ══════════ FAZA 3.1 modulları ══════════

        # ── 10. Bildirişlər ──
        r = await c.get("/api/v1/notifications", headers=ch)
        check("bildiriş siyahısı", r.status_code == 200 and len(r.json()) >= 1)
        r = await c.get("/api/v1/notifications/unread-count", headers=ch)
        check("oxunmamış sayı", r.status_code == 200 and r.json()["count"] >= 1)
        r = await c.post("/api/v1/notifications/read-all", headers=ch)
        check("hamısını oxu", r.status_code == 200)
        r = await c.get("/api/v1/notifications/unread-count", headers=ch)
        check("oxunmamış 0 oldu", r.json()["count"] == 0)

        # ── 11. Chat ──
        r = await c.post("/api/v1/chat/conversations", headers=ch,
                         json={"peer_id": prov["user_id"], "opportunity_id": opp_id})
        check("söhbət açıldı", r.status_code == 200 and r.json()["created"])
        conv_id = r.json()["id"]
        r = await c.post("/api/v1/chat/conversations", headers=ch,
                         json={"peer_id": prov["user_id"], "opportunity_id": opp_id})
        check("söhbət idempotent", r.json()["created"] is False
              and r.json()["id"] == conv_id)
        r = await c.post(f"/api/v1/chat/conversations/{conv_id}/messages",
                         headers=ch, json={"body": "Salam, nə vaxt gələrsiniz?"})
        check("mesaj göndərildi", r.status_code == 201)
        r = await c.get("/api/v1/chat/conversations", headers=ph)
        convs = r.json()
        check("usta söhbəti görür (1 oxunmamış)", len(convs) == 1
              and convs[0]["unread"] == 1
              and convs[0]["peer_name"] == "Test Müştəri")
        r = await c.get(f"/api/v1/chat/conversations/{conv_id}/messages", headers=ph)
        check("mesajlar oxundu", r.status_code == 200 and len(r.json()) == 1)
        r = await c.get("/api/v1/chat/conversations", headers=ph)
        check("oxunmamış sıfırlandı", r.json()[0]["unread"] == 0)

        # ── 12. KYC axını ──
        r = await c.post("/api/v1/kyc/submit", headers=ph, json={
            "id_front_path": "kyc/f.jpg", "id_back_path": "kyc/b.jpg",
            "selfie_path": "kyc/s.jpg", "full_name_on_id": "Test Usta"})
        check("KYC göndərildi", r.status_code == 201)
        r = await c.post("/api/v1/kyc/submit", headers=ph, json={
            "id_front_path": "x", "id_back_path": "x", "selfie_path": "x"})
        check("təkrar KYC rədd olunur", r.status_code == 409)
        r = await c.get("/api/v1/kyc/status", headers=ph)
        check("KYC status pending", r.json()["status"] == "pending")
        # KYC müştəri üçün qadağandır
        r = await c.post("/api/v1/kyc/submit", headers=ch, json={
            "id_front_path": "x", "id_back_path": "x", "selfie_path": "x"})
        check("müştəri KYC verə bilməz", r.status_code == 403)

        # Admin yarat (rol yüksəltmə birbaşa DB-dən)
        r = await c.post("/api/v1/auth/register", json={
            "email": "admin@test.az", "password": "Admin!Parol9",
            "name": "Admin", "role": "customer"})
        adm = r.json()
        async with SessionLocal() as db:
            await db.execute(text("update users set role='admin' where id=:id"),
                             {"id": adm["user_id"]})
            await db.execute(text("update profiles set role='admin' where id=:id"),
                             {"id": adm["user_id"]})
            await db.commit()
        # köhnə token köhnə rolu daşıyır → yenidən login (JWT-də rol var)
        r = await c.post("/api/v1/auth/login", json={
            "email": "admin@test.az", "password": "Admin!Parol9"})
        ah = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # Adi istifadəçi pending siyahısını görə bilməz
        r = await c.get("/api/v1/kyc/pending", headers=ph)
        check("pending siyahısı yalnız admin", r.status_code == 403)
        r = await c.get("/api/v1/kyc/pending", headers=ah)
        check("admin pending görür", r.status_code == 200 and len(r.json()) == 1)
        ver_id = r.json()[0]["id"]
        r = await c.post(f"/api/v1/kyc/{ver_id}/review", headers=ah,
                         json={"approve": True})
        check("admin təsdiqlədi", r.status_code == 200)
        r = await c.get("/api/v1/kyc/status", headers=ph)
        check("KYC approved + verified", r.json()["status"] == "approved"
              and r.json()["is_verified"] is True)

        # ── 13. Briqada axını ──
        async with SessionLocal() as db:
            b = (await db.execute(text(
                "insert into brigades (owner_id, name, balance)"
                " values (:o, 'Ellit Komanda', 50) returning id"),
                {"o": prov["user_id"]})).first()
            await db.execute(text(
                "insert into brigade_members (brigade_id, profile_id, role)"
                " values (:b, :p, 'owner')"),
                {"b": b.id, "p": prov["user_id"]})
            await db.commit()
            brigade_id = str(b.id)

        r = await c.get("/api/v1/brigades/my", headers=ph)
        check("komandam", r.status_code == 200 and r.json()["my_role"] == "owner"
              and "balance" in r.json())
        r = await c.get("/api/v1/brigades/my", headers=ch)
        check("müştəri komandada deyil", r.status_code == 404)

        # Yeni sifariş — komanda təklifi üçün
        r = await c.post("/api/v1/opportunities", headers=ch, json={
            "title": "Ev təmiri", "category_id": cat_id, "date": "2026-07-20"})
        opp2 = r.json()["id"]
        r = await c.post(f"/api/v1/brigades/{brigade_id}/offers", headers=ph,
                         json={"opportunity_id": opp2, "amount": "200.00"})
        check("komanda təklifi verildi", r.status_code == 201, str(r.json()))
        r = await c.get(f"/api/v1/offers/by-opportunity/{opp2}", headers=ch)
        check("komanda təklifi görünür", r.json()[0]["brigade_name"] == "Ellit Komanda")

        # Dispatch — işçi təyini
        async with SessionLocal() as db:
            m = (await db.execute(text(
                "select id from brigade_members where brigade_id=:b"),
                {"b": brigade_id})).first()
            member_id = str(m.id)
        r = await c.post(f"/api/v1/brigades/{brigade_id}/dispatch", headers=ph,
                         json={"source_id": opp2, "member_ids": [member_id]})
        check("işçi təyin olundu", r.status_code == 200 and r.json()["inserted"] == 1)
        r = await c.post(f"/api/v1/brigades/{brigade_id}/dispatch", headers=ph,
                         json={"source_id": opp2, "member_ids": [member_id]})
        check("dublikat təyinat 0 insert", r.json()["inserted"] == 0)
        r = await c.post(f"/api/v1/brigades/{brigade_id}/dispatch", headers=ch,
                         json={"source_id": opp2, "member_ids": [member_id]})
        check("müştəri dispatch edə bilməz", r.status_code == 403)

        # ══════════ FAZA 4-7 modulları ══════════

        # ── 14. Promo kod ilə qəbul ──
        async with SessionLocal() as db:
            await db.execute(text(
                "insert into promo_codes (code, discount_type, discount_value,"
                " per_user_limit) values ('ENDIRIM20', 'fixed', 20, 1)"))
            await db.execute(text(
                "update profiles set balance = balance + 300 where id=:u"),
                {"u": cust["user_id"]})
            await db.commit()
        # opp2 üçün komanda təklifini promo ilə qəbul (kart):
        r = await c.get(f"/api/v1/offers/by-opportunity/{opp2}", headers=ch)
        boffer_id = r.json()[0]["id"]
        r = await c.post(f"/api/v1/offers/{boffer_id}/accept", headers=ch,
                         json={"method": "card", "promo_code": "ENDIRIM20"})
        check("promo ilə qəbul", r.status_code == 200, str(r.json())[:100])
        check("endirim 20 ₼", r.json()["discount"] == "20.00"
              or r.json()["discount"] == "20")
        r = await c.post(f"/api/v1/offers/{boffer_id}/accept", headers=ch,
                         json={"method": "card", "promo_code": "YALAN"})
        check("yalan promo rədd (artıq accepted)", r.status_code == 409)

        # ── 15. Ödəniş webhook (imza yoxlaması + idempotency) ──
        import base64 as b64mod, hashlib as hmod, json as jmod
        from app.core.config import settings as cfg
        cfg.EPOINT_PRIVATE_KEY = "test_private_key"
        async with SessionLocal() as db:
            await db.execute(text(
                "insert into payments (order_id, user_id, amount, status, method,"
                " provider) values ('topup-test-1', :u, 50, 'pending', 'card',"
                " 'epoint')"), {"u": cust["user_id"]})
            await db.commit()
        payload = {"order_id": "topup-test-1", "status": "success",
                   "transaction": "tx123"}
        data_b64 = b64mod.b64encode(jmod.dumps(payload).encode()).decode()
        sig = b64mod.b64encode(hmod.sha1(
            f"test_private_key{data_b64}test_private_key".encode()).digest()).decode()
        r = await c.post("/api/v1/payments/webhook",
                         data={"data": data_b64, "signature": "SAXTA"})
        check("saxta imza rədd olunur", r.status_code == 403)
        r = await c.post("/api/v1/payments/webhook",
                         data={"data": data_b64, "signature": sig})
        check("düzgün imza qəbul olunur", r.status_code == 200)
        async with SessionLocal() as db:
            b1 = (await db.execute(text(
                "select balance from profiles where id=:u"),
                {"u": cust["user_id"]})).first().balance
        r = await c.post("/api/v1/payments/webhook",
                         data={"data": data_b64, "signature": sig})
        check("təkrar webhook idempotent", r.json().get("skipped") == "artıq emal olunub")
        async with SessionLocal() as db:
            b2 = (await db.execute(text(
                "select balance from profiles where id=:u"),
                {"u": cust["user_id"]})).first().balance
        check("balans iki dəfə artmadı", b1 == b2, f"({b1})")
        r = await c.get("/api/v1/payments/transactions", headers=ch)
        check("tranzaksiya tarixçəsi", r.status_code == 200 and len(r.json()) >= 3)

        # ── 16. Çıxarış axını ──
        r = await c.post("/api/v1/withdrawals", headers=ph,
                         json={"amount": "50.00", "bank_card": "4169738812345678"})
        check("çıxarış sorğusu", r.status_code == 201, str(r.json()))
        wd_id = r.json()["id"]
        r = await c.post("/api/v1/withdrawals", headers=ph,
                         json={"amount": "10.00", "bank_card": "4169738812345678"})
        check("ikinci pending çıxarış rədd", r.status_code == 409)
        r = await c.post("/api/v1/withdrawals", headers=ch,
                         json={"amount": "10.00", "bank_card": "4169738812345678"})
        check("müştəri çıxarış edə bilməz", r.status_code == 403)
        r = await c.get("/api/v1/withdrawals/pending", headers=ah)
        check("admin pending çıxarışları görür", len(r.json()) == 1)
        r = await c.post(f"/api/v1/withdrawals/{wd_id}/process", headers=ah,
                         json={"approve": False, "admin_notes": "Kart yanlışdır"})
        check("admin rədd etdi", r.status_code == 200)
        async with SessionLocal() as db:
            pb = (await db.execute(text(
                "select balance from profiles where id=:u"),
                {"u": prov["user_id"]})).first()
            check("rədd → məbləğ geri qayıtdı", Decimal(pb.balance) == Decimal("85.50"))

        # ── 17. Admin API ──
        r = await c.get("/api/v1/admin/stats", headers=ah)
        check("admin statistika", r.status_code == 200
              and "platform_revenue_total" in r.json())
        r = await c.get("/api/v1/admin/stats", headers=ch)
        check("adi user admin API görmür", r.status_code == 403)
        r = await c.put("/api/v1/admin/config/commission_on_accept", headers=ah,
                        json={"value": "12"})
        check("komissiya dəyişdirildi", r.status_code == 200)
        r = await c.put("/api/v1/admin/config/JUNK_KEY", headers=ah,
                        json={"value": "1"})
        check("icazəsiz konfiq açarı rədd", r.status_code == 400)
        r = await c.post("/api/v1/admin/banners", headers=ah, json={
            "image_url": "https://cdn.ellit.az/b1.jpg"})
        check("başlıqsız banner yaradıldı", r.status_code == 201)
        r = await c.get("/api/v1/catalog/banners")
        check("banner public görünür", len(r.json()) == 1)
        r = await c.get("/api/v1/admin/audit", headers=ah)
        check("audit log", r.status_code == 200 and len(r.json()) >= 2)

        # ── 18. Cihaz qeydiyyatı + onlayn ustalar ──
        r = await c.post("/api/v1/notifications/devices", headers=ph, json={
            "platform": "ios", "fcm_token": "tok_" + "x" * 20})
        check("FCM cihaz qeydiyyatı", r.status_code == 201)
        async with SessionLocal() as db:
            await db.execute(text(
                "update profiles set is_online=true, latitude=40.41,"
                " longitude=49.87 where id=:u"), {"u": prov["user_id"]})
            await db.commit()
        r = await c.get("/api/v1/profiles/online/providers"
                        "?lat=40.4093&lng=49.8671&radius_km=5")
        check("onlayn ustalar radiusda", r.status_code == 200 and len(r.json()) == 1)
        r = await c.get("/api/v1/profiles/online/providers"
                        "?lat=41.5&lng=48.0&radius_km=5")
        check("uzaq radiusda boş", len(r.json()) == 0)

        # ── 19. Təhlükəsizlik: login lockout ──
        for _ in range(5):
            await c.post("/api/v1/auth/login", json={
                "email": "musteri@test.az", "password": "SEHV-PAROL"})
        r = await c.post("/api/v1/auth/login", json={
            "email": "musteri@test.az", "password": "Guclu!Parol1"})
        check("5 uğursuz cəhddən sonra lockout (düzgün parolla belə)",
              r.status_code == 429)

        # ── 20. Parol dəyişmə (usta) ──
        r = await c.post("/api/v1/auth/change-password", headers=ph, json={
            "current_password": "SEHV", "new_password": "TezeParol123"})
        check("yanlış cari parol rədd", r.status_code == 401)
        r = await c.post("/api/v1/auth/change-password", headers=ph, json={
            "current_password": "Guclu!Parol2", "new_password": "TezeParol123"})
        check("parol dəyişdi", r.status_code == 204)
        r = await c.post("/api/v1/auth/refresh", json={
            "refresh_token": prov["refresh_token"]})
        check("köhnə refresh sessiyası bağlandı", r.status_code == 401)
        # Rate-limit bucket-larını təmizlə (bütün test eyni IP-dəndir —
        # limitin dolması elə qorumanın işlədiyini göstərir)
        from app.db.session import redis as app_redis
        for pattern in ("rl:auth:*", "lock:*"):
            keys = await app_redis.keys(pattern)
            if keys:
                await app_redis.delete(*keys)
        r = await c.post("/api/v1/auth/login", json={
            "email": "usta@test.az", "password": "TezeParol123"})
        check("yeni parolla giriş", r.status_code == 200)

        # ── 21. Dəstək çatı (admin panel) ──
        # support_user_id konfiq olunmayıb → ilk admin dəstək hesabıdır
        r = await c.post("/api/v1/chat/support", headers=ch,
                         json={"category": "order"})
        check("dəstək çatı açıldı", r.status_code == 200 and r.json()["created"])
        sup_conv = r.json()["id"]
        r = await c.post("/api/v1/chat/support", headers=ch,
                         json={"category": "order"})
        check("dəstək çatı idempotent (kateqoriya başına)",
              r.json()["created"] is False and r.json()["id"] == sup_conv)
        r = await c.post("/api/v1/chat/support", headers=ch,
                         json={"category": "payment"})
        check("fərqli kateqoriya → yeni söhbət", r.json()["created"] is True)
        r = await c.post(f"/api/v1/chat/conversations/{sup_conv}/messages",
                         headers=ch, json={"body": "Sifarişimdə problem var"})
        check("istifadəçi dəstəyə yazdı", r.status_code == 201)

        # Admin tərəfi
        r = await c.get("/api/v1/chat/support/conversations", headers=ah)
        convs = r.json()
        check("admin dəstək söhbətlərini görür", r.status_code == 200
              and len(convs) == 2)
        target = next(x for x in convs if x["id"] == sup_conv)
        check("oxunmamış sayı + kateqoriya",
              target["unread"] == 1 and target["category"] == "order"
              and target["user_name"] == "Test Müştəri")
        r = await c.get("/api/v1/chat/support/conversations", headers=ph)
        check("adi user admin dəstək API görmür", r.status_code == 403)
        r = await c.get(f"/api/v1/chat/support/conversations/{sup_conv}/messages",
                        headers=ah)
        check("admin mesajları oxudu", r.status_code == 200 and len(r.json()) == 1)
        r = await c.get("/api/v1/chat/support/conversations", headers=ah)
        target = next(x for x in r.json() if x["id"] == sup_conv)
        check("oxunmamış sıfırlandı (admin)", target["unread"] == 0)
        r = await c.post(f"/api/v1/chat/support/conversations/{sup_conv}/messages",
                         headers=ah, json={"body": "Salam! Baxırıq, 5 dəqiqəyə həll olunacaq."})
        check("admin cavab yazdı", r.status_code == 201)
        # İstifadəçi cavabı görür
        r = await c.get(f"/api/v1/chat/conversations/{sup_conv}/messages", headers=ch)
        msgs = r.json()
        check("istifadəçi dəstək cavabını görür", len(msgs) == 2
              and "həll olunacaq" in msgs[1]["body"])
        r = await c.get("/api/v1/notifications", headers=ch)
        check("dəstək cavabı bildirişi", any(
            n["type"] == "support" for n in r.json()))

    print("\nBÜTÜN E2E TESTLƏR KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
