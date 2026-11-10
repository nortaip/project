"""Supabase-uyğun RPC-lər (app/compat/rpc_core.py) — HTTP üzərindən E2E.

Hər handler `POST /rest/v1/rpc/<ad>` ilə, `/api/v1/auth/register`-dən alınan
bearer token ilə çağırılır. Yoxlanır:
  * uğur yolu — cavabın forması sahə-sahə, klientin oxuduğu kimi
    (src/** və ellit_booking/lib/** çağırış yerləri);
  * əsas xəta yolları — klientin axtardığı mətn/kod (NO_BALANCE,
    INSUFFICIENT_BALANCE, PROMO_INVALID, {ok:false,error:'KOD'} ...);
  * başqa istifadəçi və anonim çağıran rədd edilir.

Təzə bazada tək başına işləyir (DATABASE_URL/REDIS_URL env ilə):
    python3 tests/compat_rpc_core.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Bir testdə ~250 sorğu: qlobal limit testə mane olmasın (digər compat testləri kimi)
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import httpx  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra if not cond else ''}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


def is_uuid(v) -> bool:
    try:
        uuid.UUID(str(v))
        return isinstance(v, str)
    except ValueError:
        return False


def num(v) -> bool:
    """JSON ədədi (bool deyil) — klient `.toFixed()` / `as num` edir."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


async def main() -> None:
    from sqlalchemy import text

    from app.db.session import SessionLocal
    from app.main import app

    async def one(sql: str, **params):
        async with SessionLocal() as db:
            return (await db.execute(text(sql), params)).first()

    async def val(sql: str, **params):
        async with SessionLocal() as db:
            return (await db.execute(text(sql), params)).scalar()

    async def run(sql: str, **params) -> None:
        async with SessionLocal() as db:
            await db.execute(text(sql), params)
            await db.commit()

    async def notifs(user_id: str, ntype: str) -> list:
        async with SessionLocal() as db:
            return (await db.execute(text(
                "select id, type, title, body, related_id, is_read"
                "  from notifications where user_id = :u and type = :t"
                " order by created_at, id"), {"u": user_id, "t": ntype})).all()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        async def rpc(name: str, args: dict | None = None,
                      h: dict | None = None) -> httpx.Response:
            return await c.post(f"/rest/v1/rpc/{name}", json=args or {},
                                headers=h or {})

        def err(r: httpx.Response, status: int, code: str,
                contains: str | None = None) -> bool:
            if r.status_code != status:
                return False
            b = r.json()
            return (b.get("code") == code and set(b) >= {"code", "message", "details", "hint"}
                    and (contains is None or contains in (b.get("message") or "")))

        async def register(email: str, name: str, role: str) -> tuple[str, dict]:
            r = await c.post("/api/v1/auth/register", json={
                "email": email, "password": "Guclu!Parol1", "name": name,
                "role": role})
            check(f"qeydiyyat: {name}", r.status_code == 201, r.text[:200])
            return (r.json()["user_id"],
                    {"Authorization": f"Bearer {r.json()['access_token']}"})

        # ══════════ 0. İstifadəçilər + seed ══════════
        print("\n── 0. Hazırlıq ──")
        cust, ch = await register("musteri@rpc.az", "RPC Müştəri", "customer")
        cust2, c2h = await register("diger@rpc.az", "Digər Müştəri", "customer")
        pa, ah = await register("usta.a@rpc.az", "Usta A", "provider")
        pb, bh = await register("usta.b@rpc.az", "Usta B", "provider")
        pc, pch = await register("usta.c@rpc.az", "Usta C (KYC-siz)", "provider")
        adm, _ = await register("admin@rpc.az", "RPC Admin", "customer")
        await run("update users set role='admin' where id=:i", i=adm)
        await run("update profiles set role='admin' where id=:i", i=adm)
        r = await c.post("/api/v1/auth/login", json={
            "email": "admin@rpc.az", "password": "Guclu!Parol1"})
        check("admin girişi", r.status_code == 200, r.text[:200])
        admh = {"Authorization": f"Bearer {r.json()['access_token']}"}

        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "insert into service_categories (label) values ('Santexnik')"
                " returning id"))).first()
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'),"
                " ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '2'),"
                " ('cash_deposit_pct', '20'),"
                " ('bonus_on_complete', '1'),"
                " ('commission_on_withdrawal', '2'),"
                " ('min_withdrawal_amount', '10'),"
                " ('commission_on_bonus_convert', '10'),"
                " ('brigade_member_commission_pct', '15')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text(
                "update profiles set balance = 1000 where id = :id"), {"id": cust})
            await db.execute(text(
                "update profiles set is_verified = true,"
                " last_kyc_approved_at = now(), balance = 50"
                " where id = any(:ids)"), {"ids": [pa, pb]})
            svc = (await db.execute(text(
                "insert into services (title, category, price, location, provider_id,"
                " created_at) values ('Kran təmiri', 'Santexnik', 40,"
                " 'Bakı, Yasamal', :p, now()) returning id"), {"p": pb})).first()
            await db.commit()
            cat_id, svc_id = str(cat.id), int(svc.id)

        async def new_opp(headers: dict, title: str) -> str:
            r = await c.post("/api/v1/opportunities", headers=headers, json={
                "title": title, "description": "RPC testi",
                "category_id": cat_id, "date": "2026-12-15"})
            check(f"sifariş yaradıldı: {title}", r.status_code == 201, r.text[:200])
            return r.json()["id"]

        # ══════════ 1. Anonim çağıran ══════════
        print("\n── 1. Anonim çağıran rədd edilir ──")
        z = str(uuid.uuid4())
        anon_calls = {
            "accept_offer_with_payment": {"p_offer_id": z, "p_method": "card"},
            "release_offer_to_provider": {"p_offer_id": z},
            "refund_offer_payment": {"p_offer_id": z},
            "place_bid": {"p_opportunity_id": z, "p_amount": 10},
            "decline_offer": {"p_assignment_id": z},
            "claim_opportunity": {"p_assignment_id": z},
            "cancel_opportunity": {"p_opportunity_id": z},
            "expire_stale_offers": {"p_threshold_seconds": 60},
            "validate_promo_code": {"p_code": "X", "p_amount": 10},
            "get_commission_rates": {},
            "convert_bonus_to_balance": {"p_amount": 5},
            "request_withdrawal": {"p_amount": 20, "p_bank_card": "4169738812345678"},
            "worker_earnings": {},
            "create_booking_with_fee": {"p_service_id": svc_id, "p_date": "2026-12-20",
                                        "p_time": "10:00"},
            "mark_all_notifications_read": {},
            "block_user": {"p_blocked_id": z},
            "request_provider_role": {},
            "open_conversation": {"p_opportunity_id": z, "p_peer_id": z},
            "open_support_conversation": {},
        }
        anon_key = {"Authorization": "Bearer anon-public-key", "apikey": "anon-public-key"}
        for name, args in anon_calls.items():
            r = await rpc(name, args)
            check(f"anonim → 401/42501: {name}", err(r, 401, "42501"), r.text[:200])
        r = await rpc("get_commission_rates", {}, anon_key)
        check("anon açarı ilə get_commission_rates da 401",
              err(r, 401, "42501"), r.text[:200])

        # ══════════ 2. home_overview (anonim açıq) + get_commission_rates ══════════
        print("\n── 2. home_overview / get_commission_rates ──")
        r = await rpc("home_overview", {}, anon_key)
        d = r.json()
        check("home_overview anonim: 200 + bütün açarlar",
              r.status_code == 200 and set(d) == {
                  "providers", "services", "bookings", "top_providers",
                  "categories", "cities", "recent"}, r.text[:300])
        check("home_overview: saylar ədəddir (3 provayder, 1 xidmət, 0 sifariş)",
              d["providers"] == 3 and d["services"] == 1 and d["bookings"] == 0,
              str(d))
        tp = d["top_providers"]
        check("top_providers: klientin oxuduğu sahələr",
              len(tp) == 3 and all(set(p) >= {"id", "name", "avatar_url", "rating",
                                              "is_verified", "reviews_count"}
                                   for p in tp)
              and all(isinstance(p["reviews_count"], int) for p in tp), str(tp))
        check("categories: category/count/label_ru/label_en/label_zh",
              d["categories"] == [{"category": "Santexnik", "count": 1,
                                   "label_ru": None, "label_en": None,
                                   "label_zh": None}], str(d["categories"]))
        check("cities: şəhər vergüldən əvvəlki hissədir",
              d["cities"] == [{"city": "Bakı", "count": 1}], str(d["cities"]))
        check("recent: id/title/category/location/created_at",
              len(d["recent"]) == 1 and d["recent"][0]["id"] == svc_id
              and d["recent"][0]["title"] == "Kran təmiri"
              and isinstance(d["recent"][0]["created_at"], str), str(d["recent"]))
        r = await rpc("home_overview", {}, ch)
        check("home_overview giriş etmiş istifadəçiyə də 200", r.status_code == 200)

        r = await rpc("get_commission_rates", {}, ch)
        rates = r.json()
        check("get_commission_rates: 6 açar, hamısı ədəd",
              r.status_code == 200 and set(rates) == {
                  "commission_on_accept", "commission_on_complete",
                  "commission_on_withdrawal", "commission_on_bonus_convert",
                  "bonus_on_complete", "min_withdrawal_amount"}
              and all(num(v) for v in rates.values()), r.text)
        check("get_commission_rates: dəyərlər platform_config-dən",
              rates["commission_on_accept"] == 10
              and rates["min_withdrawal_amount"] == 10
              and rates["commission_on_withdrawal"] == 2, str(rates))
        r = await rpc("get_commission_rates", {"x": 1}, ch)
        check("naməlum arqument → 404 PGRST202", err(r, 404, "PGRST202"), r.text)

        # ══════════ 3. place_bid ══════════
        print("\n── 3. place_bid ──")
        opp1 = await new_opp(ch, "Kran sızır")
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 100}, ah)
        b = r.json()
        check("place_bid: 200 {ok, bid_id, amount, required_balance}",
              r.status_code == 200 and b.get("ok") is True and is_uuid(b.get("bid_id"))
              and b["amount"] == 100 and b["required_balance"] == 10, r.text)
        off1 = b["bid_id"]
        row = await one("select provider_id, offer_amount, status from"
                        " opportunities_offers where id=:i", i=off1)
        check("təklif çağıranın adına yazıldı (pending, 100)",
              str(row.provider_id) == pa and row.offer_amount == 100
              and row.status == "pending")
        n = await notifs(cust, "new_offer")
        check("müştəriyə new_offer bildirişi", len(n) == 1
              and n[0].related_id == off1, str(n))
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 90}, ah)
        check("təkrar təklif → 400 P0001", err(r, 400, "P0001", "Artıq təklif"), r.text)
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 1000}, bh)
        check("balans azdır → mesajda NO_BALANCE", err(r, 400, "P0001", "NO_BALANCE"),
              r.text)
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 50}, pch)
        check("KYC yoxdur → mesajda KYC_REQUIRED",
              err(r, 400, "P0001", "KYC_REQUIRED"), r.text)
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 50}, c2h)
        check("müştəri təklif verə bilməz", err(r, 400, "P0001", "provayder"), r.text)
        r = await rpc("place_bid", {"p_opportunity_id": opp1, "p_amount": 0}, bh)
        check("sıfır məbləğ → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("place_bid", {"p_opportunity_id": "yox", "p_amount": 5}, bh)
        check("yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text)
        r = await rpc("place_bid", {"p_opportunity_id": opp1}, bh)
        check("çatışmayan arqument → 404 PGRST202", err(r, 404, "PGRST202"), r.text)

        # ══════════ 4. validate_promo_code ══════════
        print("\n── 4. validate_promo_code ──")
        await run("insert into promo_codes (code, discount_type, discount_value,"
                  " per_user_limit, min_order_amount) values"
                  " ('ENDIRIM10', 'percent', 10, 1, 20), ('KOHNE', 'fixed', 5, null, null)")
        await run("update promo_codes set is_active=false where code='KOHNE'")
        r = await rpc("validate_promo_code", {"p_code": "endirim10", "p_amount": 100}, ch)
        p = r.json()
        check("etibarlı kod: valid/promo_id/code/discount_type/discount_value/"
              "discount/final/message",
              r.status_code == 200 and p.get("valid") is True
              and is_uuid(p.get("promo_id")) and p["code"] == "ENDIRIM10"
              and p["discount_type"] == "percent" and p["discount_value"] == 10
              and p["discount"] == 10 and p["final"] == 90
              and p["message"] == "Promo kod tətbiq olundu", r.text)
        for code, amount, msg in (("YOXDUR", 100, "Promo kod tapılmadı"),
                                  ("KOHNE", 100, "Kod aktiv deyil"),
                                  ("ENDIRIM10", 10, "Minimum sifariş məbləği: 20.00 ₼"),
                                  ("  ", 100, "Kod boşdur")):
            r = await rpc("validate_promo_code", {"p_code": code, "p_amount": amount}, ch)
            check(f"etibarsız kod 200 {{valid:false, message}}: {msg}",
                  r.status_code == 200 and r.json() == {"valid": False, "message": msg},
                  r.text)

        # ══════════ 5. accept_offer_with_payment ══════════
        print("\n── 5. accept_offer_with_payment ──")
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off1, "p_method": "card"}, c2h)
        check("başqa müştəri qəbul edə bilmir", err(r, 400, "P0001", "sifariş sahibi"),
              r.text)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off1, "p_method": "bitcoin"}, ch)
        check("yanlış ödəniş üsulu → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off1, "p_method": "card", "p_promo_code": "YOXDUR"}, ch)
        check("yanlış promo → mesajda PROMO_INVALID",
              err(r, 400, "P0001", "PROMO_INVALID"), r.text)
        check("uğursuz qəbul heç nə yazmadı (rollback)",
              await val("select status from opportunities_offers where id=:i", i=off1)
              == "pending"
              and await val("select balance from profiles where id=:i", i=cust) == 1000)
        r = await rpc("accept_offer_with_payment", {
            "p_offer_id": off1, "p_method": "card", "p_latitude": 40.4093,
            "p_longitude": 49.8671, "p_promo_code": "ENDIRIM10"}, ch)
        a = r.json()
        check("kartla qəbul: 200 + SQL cavabının bütün sahələri",
              r.status_code == 200 and set(a) == {
                  "ok", "method", "offer_id", "opportunity_id", "commission_amt",
                  "commission_pct", "is_brigade", "customer_fee_amt",
                  "customer_fee_pct", "deposit_amt", "deposit_pct", "discount"},
              r.text)
        check("kartla qəbul: dəyərlər",
              a["ok"] is True and a["method"] == "card" and a["offer_id"] == off1
              and a["opportunity_id"] == opp1 and a["commission_amt"] == 10
              and a["commission_pct"] == 10 and a["is_brigade"] is False
              and a["customer_fee_amt"] == 2 and a["customer_fee_pct"] == 2
              and a["deposit_amt"] == 20 and a["deposit_pct"] == 20
              and a["discount"] == 10
              and all(num(a[k]) for k in ("commission_amt", "customer_fee_amt",
                                          "deposit_amt", "discount")), str(a))
        check("müştəridən 100 + 2 − 10 = 92 tutuldu",
              await val("select balance from profiles where id=:i", i=cust) == 908)
        o = await one("select status, latitude, longitude, provider_id"
                      " from opportunities where id=:i", i=opp1)
        check("sifariş accepted + dəqiq koordinatlar yazıldı (p_latitude/p_longitude)",
              o.status == "accepted" and float(o.latitude) == 40.4093
              and float(o.longitude) == 49.8671 and str(o.provider_id) == pa, str(o))
        check("ustaya offer_accepted_card bildirişi",
              len(await notifs(pa, "offer_accepted_card")) == 1)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off1, "p_method": "card"}, ch)
        check("təkrar qəbul → 400", err(r, 400, "P0001", "aktiv deyil"), r.text)
        # promo istifadə limiti (per_user_limit=1) artıq dolub
        opp_p = await new_opp(ch, "Promo limiti")
        r = await rpc("place_bid", {"p_opportunity_id": opp_p, "p_amount": 30}, bh)
        off_p = r.json()["bid_id"]
        r = await rpc("accept_offer_with_payment", {
            "p_offer_id": off_p, "p_method": "cash", "p_promo_code": "ENDIRIM10"}, ch)
        check("istifadə olunmuş promo (nağd da) → PROMO_INVALID",
              err(r, 400, "P0001", "PROMO_INVALID"), r.text)
        # Müştəri balansı yetərsiz (kart)
        opp_c2 = await new_opp(c2h, "Balanssız müştəri")
        r = await rpc("place_bid", {"p_opportunity_id": opp_c2, "p_amount": 100}, bh)
        off_c2 = r.json()["bid_id"]
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off_c2, "p_method": "card"}, c2h)
        check("balans yetərsiz → mesajda INSUFFICIENT_BALANCE",
              err(r, 400, "P0001", "INSUFFICIENT_BALANCE"), r.text)
        # Nağd: provayderin balansı komissiyaya çatmır
        await run("update profiles set balance = 100 where id=:i", i=cust2)
        await run("update profiles set balance = 5 where id=:i", i=pb)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off_c2, "p_method": "cash"}, c2h)
        check("nağd: usta balansı az → PROVIDER_INSUFFICIENT_BALANCE",
              err(r, 400, "P0001", "PROVIDER_INSUFFICIENT_BALANCE"), r.text)
        await run("update profiles set balance = 50 where id=:i", i=pb)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off_c2, "p_method": "cash"}, c2h)
        a = r.json()
        check("nağd qəbul: depozit 20 + haqq 2, komissiya ustadan",
              r.status_code == 200 and a["method"] == "cash" and a["deposit_amt"] == 20
              and a["discount"] == 0
              and await val("select balance from profiles where id=:i", i=cust2) == 78
              and await val("select balance from profiles where id=:i", i=pb) == 40,
              r.text)

        # ══════════ 6. release_offer_to_provider ══════════
        print("\n── 6. release_offer_to_provider ──")
        r = await rpc("release_offer_to_provider", {"p_offer_id": off1}, bh)
        check("yad usta tamamlaya bilmir", err(r, 400, "P0001", "müştəri"), r.text)
        r = await rpc("release_offer_to_provider", {"p_offer_id": off1}, c2h)
        check("başqa müştəri tamamlaya bilmir", err(r, 400, "P0001"), r.text)
        bal_pa = await val("select balance from profiles where id=:i", i=pa)
        r = await rpc("release_offer_to_provider", {"p_offer_id": off1}, ch)
        check("kart: 200 + açılan məbləğ ədəd kimi (90 − 5% = 85.5)",
              r.status_code == 200 and r.json() == 85.5, r.text)
        check("ustanın balansına 85.5 keçdi",
              await val("select balance from profiles where id=:i", i=pa)
              == bal_pa + await val("select 85.5::numeric"))
        check("ustaya offer_completed bildirişi",
              len(await notifs(pa, "offer_completed")) == 1)
        r = await rpc("release_offer_to_provider", {"p_offer_id": off1}, ch)
        check("təkrar → ALREADY_RELEASED", err(r, 400, "P0001", "ALREADY_RELEASED"),
              r.text)
        r = await rpc("release_offer_to_provider", {"p_offer_id": off_c2}, c2h)
        check("nağd: 200 + 0", r.status_code == 200 and r.json() == 0, r.text)

        # ══════════ 7. refund_offer_payment ══════════
        print("\n── 7. refund_offer_payment ──")
        opp2 = await new_opp(ch, "Boru təmiri")
        r = await rpc("place_bid", {"p_opportunity_id": opp2, "p_amount": 60}, ah)
        off2 = r.json()["bid_id"]
        r = await rpc("refund_offer_payment", {"p_offer_id": off2}, ch)
        check("pending təklif → {ok:false, error:OFFER_NOT_REFUNDABLE, current_status}",
              r.status_code == 200 and r.json() == {
                  "ok": False, "error": "OFFER_NOT_REFUNDABLE",
                  "current_status": "pending"}, r.text)
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off2, "p_method": "card"}, ch)
        check("qəbul (kart, refund üçün)", r.status_code == 200, r.text)
        bal_c = await val("select balance from profiles where id=:i", i=cust)
        r = await rpc("refund_offer_payment", {"p_offer_id": off2, "p_reason": "x"}, c2h)
        check("yad şəxs → {ok:false, error:NOT_AUTHORIZED}",
              r.status_code == 200 and r.json() == {"ok": False, "error": "NOT_AUTHORIZED"},
              r.text)
        r = await rpc("refund_offer_payment", {"p_offer_id": str(uuid.uuid4())}, ch)
        check("naməlum təklif → {ok:false, error:OFFER_NOT_FOUND}",
              r.status_code == 200 and r.json() == {"ok": False, "error": "OFFER_NOT_FOUND"},
              r.text)
        r = await rpc("refund_offer_payment",
                      {"p_offer_id": off2, "p_reason": "Usta gəlmədi"}, ch)
        f = r.json()
        check("refund: {ok, refunded_amount (ədəd), customer_id, opportunity_id}",
              r.status_code == 200 and f.get("ok") is True
              and f["refunded_amount"] == 61.2 and num(f["refunded_amount"])
              and f["customer_id"] == cust and f["opportunity_id"] == opp2, r.text)
        check("müştəriyə 60 + 1.2 haqq qaytarıldı",
              await val("select balance from profiles where id=:i", i=cust)
              == bal_c + await val("select 61.2::numeric"))
        check("refund bildirişləri (müştəri + usta)",
              len(await notifs(cust, "offer_refunded")) == 1
              and len(await notifs(pa, "offer_refunded")) == 1)
        r = await rpc("refund_offer_payment", {"p_offer_id": off2}, ch)
        check("təkrar → {ok:true, already_refunded:true}",
              r.status_code == 200 and r.json() == {"ok": True, "already_refunded": True},
              r.text)

        # ══════════ 8. cancel_opportunity ══════════
        print("\n── 8. cancel_opportunity ──")
        opp3 = await new_opp(ch, "Ləğv ediləcək")
        r = await rpc("place_bid", {"p_opportunity_id": opp3, "p_amount": 40}, ah)
        off3 = r.json()["bid_id"]
        r = await rpc("cancel_opportunity", {"p_opportunity_id": opp3}, c2h)
        check("yad şəxs → {ok:false, error:NOT_AUTHORIZED}",
              r.status_code == 200 and r.json() == {"ok": False, "error": "NOT_AUTHORIZED"},
              r.text)
        r = await rpc("cancel_opportunity", {"p_opportunity_id": str(uuid.uuid4())}, ch)
        check("naməlum sifariş → {ok:false, error:NOT_FOUND}",
              r.status_code == 200 and r.json() == {"ok": False, "error": "NOT_FOUND"},
              r.text)
        r = await rpc("cancel_opportunity", {"p_opportunity_id": opp3}, ch)
        check("ləğv (pending): {ok:true, refunded:0}",
              r.status_code == 200 and r.json() == {"ok": True, "refunded": 0}, r.text)
        o = await one("select status, cancellation_reason from opportunities"
                      " where id=:i", i=opp3)
        check("status cancelled + defolt səbəb",
              o.status == "cancelled" and o.cancellation_reason == "Müştəri ləğv etdi",
              str(o))
        check("gözləyən təklif bağlandı (rejected)",
              await val("select status from opportunities_offers where id=:i", i=off3)
              == "rejected")
        r = await rpc("cancel_opportunity", {"p_opportunity_id": opp3}, ch)
        check("təkrar → {ok:false, error:NOT_CANCELLABLE, current_status}",
              r.status_code == 200 and r.json() == {
                  "ok": False, "error": "NOT_CANCELLABLE",
                  "current_status": "cancelled"}, r.text)
        # Kartla qəbul olunmuş sifarişin ləğvi → escrow açılır, müştəriyə qaytarılır
        opp4 = await new_opp(ch, "Kartla ləğv")
        r = await rpc("place_bid", {"p_opportunity_id": opp4, "p_amount": 50}, ah)
        off4 = r.json()["bid_id"]
        r = await rpc("accept_offer_with_payment",
                      {"p_offer_id": off4, "p_method": "card"}, ch)
        check("qəbul (kart, ləğv üçün)", r.status_code == 200, r.text)
        locked = await val("select locked_balance from provider_wallets"
                           " where provider_id=:i", i=pa)
        bal_c = await val("select balance from profiles where id=:i", i=cust)
        r = await rpc("cancel_opportunity",
                      {"p_opportunity_id": opp4, "p_reason": "Planlar dəyişdi"}, ch)
        # Müştəri ödədiyini tam geri alır: 50 + 2% servis haqqı = 51
        check("kartlı ləğv: {ok:true, refunded:51} (ədəd, haqq daxil)",
              r.status_code == 200 and r.json() == {"ok": True, "refunded": 51}
              and num(r.json()["refunded"]), r.text)
        check("müştəri +51 (ödədiyi qədər), ustanın kilidli escrow-u −45",
              await val("select balance from profiles where id=:i", i=cust) == bal_c + 51
              and await val("select locked_balance from provider_wallets"
                            " where provider_id=:i", i=pa) == locked - 45)
        o = await one("select status, provider_id, accepted_offer_id,"
                      " cancellation_reason from opportunities where id=:i", i=opp4)
        check("sifariş: cancelled, icraçı bağlantısı götürüldü, səbəb yazıldı",
              o.status == "cancelled" and o.provider_id is None
              and o.accepted_offer_id is None
              and o.cancellation_reason == "Planlar dəyişdi", str(o))
        n = await notifs(pa, "order_cancelled")
        check("ustaya order_cancelled bildirişi (səbəb ilə)",
              len(n) == 1 and n[0].body == "Səbəb: Planlar dəyişdi"
              and n[0].related_id == opp4, str(n))
        opp5 = await new_opp(c2h, "Admin ləğvi")
        r = await rpc("cancel_opportunity",
                      {"p_opportunity_id": opp5, "p_reason": "Qayda pozuntusu"}, admh)
        check("admin başqasının sifarişini ləğv edə bilir",
              r.status_code == 200 and r.json()["ok"] is True, r.text)

        # ══════════ 9. convert_bonus_to_balance ══════════
        print("\n── 9. convert_bonus_to_balance ──")
        await run("update provider_wallets set bonus_balance = 20 where provider_id=:i",
                  i=pa)
        bal_pa = await val("select balance from profiles where id=:i", i=pa)
        r = await rpc("convert_bonus_to_balance", {"p_amount": 10}, ah)
        v = r.json()
        check("konvertasiya: {ok, amount_requested, commission_pct, commission_amt,"
              " credited, new_balance} — hamısı ədəd",
              r.status_code == 200 and v.get("ok") is True
              and v["amount_requested"] == 10 and v["commission_pct"] == 10
              and v["commission_amt"] == 1 and v["credited"] == 9
              and v["new_balance"] == float(bal_pa + 9)
              and all(num(v[k]) for k in ("amount_requested", "commission_pct",
                                          "commission_amt", "credited", "new_balance")),
              r.text)
        check("bonus 20 → 10",
              await val("select bonus_balance from provider_wallets"
                        " where provider_id=:i", i=pa) == 10)
        r = await rpc("convert_bonus_to_balance", {"p_amount": 50}, ah)
        check("bonus yetərsiz → 400 (INSUFFICIENT_BONUS)",
              err(r, 400, "P0001", "INSUFFICIENT_BONUS"), r.text)
        r = await rpc("convert_bonus_to_balance", {"p_amount": 5}, c2h)
        check("başqasının bonusu xərclənmir (öz cüzdanı yoxdur → 400)",
              err(r, 400, "P0001", "INSUFFICIENT_BONUS"), r.text)
        r = await rpc("convert_bonus_to_balance", {"p_amount": -1}, ah)
        check("mənfi məbləğ → 400", err(r, 400, "P0001"), r.text)

        # ══════════ 10. request_withdrawal ══════════
        print("\n── 10. request_withdrawal ──")
        r = await rpc("request_withdrawal",
                      {"p_amount": 5, "p_bank_card": "4169738812345678"}, ah)
        check("minimumdan az → 400 (Minimum)", err(r, 400, "P0001", "Minimum"), r.text)
        r = await rpc("request_withdrawal", {"p_amount": 20, "p_bank_card": "123"}, ah)
        check("qısa kart → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("request_withdrawal",
                      {"p_amount": 100000, "p_bank_card": "4169738812345678"}, ah)
        check("balans yetərsiz → mesajda INSUFFICIENT_BALANCE",
              err(r, 400, "P0001", "INSUFFICIENT_BALANCE"), r.text)
        bal_pa = await val("select balance from profiles where id=:i", i=pa)
        r = await rpc("request_withdrawal",
                      {"p_amount": 20, "p_bank_card": "4169738812345678"}, ah)
        check("çıxarış: 200 + uuid (SQL `returns uuid`)",
              r.status_code == 200 and is_uuid(r.json()), r.text)
        w = await one("select provider_id, amount_requested, commission_amount,"
                      " net_amount, status from withdrawals where id=:i", i=r.json())
        check("withdrawals sətri çağıranın adına: 20 / 0.40 / 19.60 / pending",
              str(w.provider_id) == pa and w.amount_requested == 20
              and float(w.commission_amount) == 0.4 and float(w.net_amount) == 19.6
              and w.status == "pending", str(w))
        check("balansdan 20 tutuldu",
              await val("select balance from profiles where id=:i", i=pa) == bal_pa - 20)

        # ══════════ 11. worker_earnings ══════════
        print("\n── 11. worker_earnings ──")
        r = await rpc("worker_earnings", {}, ah)
        e = r.json()
        check("qazanc: from/to/count/gross/platform_total/brigade_total/net_total/orders",
              r.status_code == 200 and set(e) == {
                  "from", "to", "count", "gross", "platform_total", "brigade_total",
                  "net_total", "orders"}, r.text)
        check("qazanc: 1 tamamlanmış sifariş (100 → platforma 10, xalis 90)",
              e["count"] == 1 and e["gross"] == 100 and e["platform_total"] == 10
              and e["brigade_total"] == 0 and e["net_total"] == 90
              and isinstance(e["from"], str) and isinstance(e["to"], str), str(e))
        o = e["orders"][0] if e["orders"] else {}
        check("orders[0]: klientin oxuduğu sahələr",
              len(e["orders"]) == 1 and o["id"] == opp1 and o["title"] == "Kran sızır"
              and isinstance(o["completed_at"], str) and o["amount"] == 100
              and o["is_brigade"] is False and o["payment_method"] == "card"
              and o["worker_pct"] == 90 and o["worker_net"] == 90
              and o["brigade_cut"] == 0 and o["platform_amt"] == 10, str(o))
        r = await rpc("worker_earnings", {"p_from": "2099-01-01T00:00:00.000Z",
                                          "p_to": "2099-02-01T00:00:00.000Z"}, ah)
        check("gələcək aralıq (JS toISOString formatı) → count 0, orders []",
              r.status_code == 200 and r.json()["count"] == 0
              and r.json()["orders"] == [], r.text)
        r = await rpc("worker_earnings", {}, ch)
        check("başqa istifadəçi yalnız özünü görür (0)",
              r.status_code == 200 and r.json()["count"] == 0, r.text)
        r = await rpc("worker_earnings", {"p_from": "dünən"}, ah)
        check("yanlış vaxt → 400 22P02", err(r, 400, "22P02"), r.text)

        # ══════════ 12. create_booking_with_fee ══════════
        print("\n── 12. create_booking_with_fee ──")
        bal_c = await val("select balance from profiles where id=:i", i=cust)
        r = await rpc("create_booking_with_fee", {
            "p_service_id": svc_id, "p_date": "2026-12-20", "p_time": "10:00",
            "p_package_name": "Standart", "p_package_price": 55,
            "p_package_duration": "2 saat", "p_notes": "  "}, ch)
        k = r.json()
        check("sifariş: {ok, booking_id, fee, balance}",
              r.status_code == 200 and k.get("ok") is True and is_uuid(k.get("booking_id"))
              and k["fee"] == 1 and num(k["fee"])
              and k["balance"] == float(bal_c - 1), r.text)
        bk = await one("select customer_id, provider_id, total_amount, status, notes,"
                       " fee_paid, date from bookings where id=:i", i=k["booking_id"])
        check("booking: çağıran müştəri, xidmətin provayderi, paket qiyməti",
              str(bk.customer_id) == cust and str(bk.provider_id) == pb
              and bk.total_amount == 55 and bk.status == "pending" and bk.notes is None
              and bk.fee_paid is True and str(bk.date) == "2026-12-20", str(bk))
        check("provayderə new_booking bildirişi",
              len(await notifs(pb, "new_booking")) == 1)
        await run("update profiles set balance = 0.5 where id=:i", i=cust2)
        r = await rpc("create_booking_with_fee", {
            "p_service_id": svc_id, "p_date": "2026-12-20", "p_time": "10:00"}, c2h)
        check("balans yetərsiz → 200 {ok:false, error:INSUFFICIENT_BALANCE, fee:1}",
              r.status_code == 200
              and r.json() == {"ok": False, "error": "INSUFFICIENT_BALANCE", "fee": 1},
              r.text)
        r = await rpc("create_booking_with_fee", {
            "p_service_id": 999999, "p_date": "2026-12-20", "p_time": "10:00"}, ch)
        check("naməlum xidmət → {ok:false, error:SERVICE_NOT_FOUND}",
              r.json() == {"ok": False, "error": "SERVICE_NOT_FOUND"}, r.text)
        r = await rpc("create_booking_with_fee", {
            "p_service_id": svc_id, "p_date": "2026-12-20", "p_time": " "}, ch)
        check("boş vaxt → {ok:false, error:INVALID_INPUT}",
              r.json() == {"ok": False, "error": "INVALID_INPUT"}, r.text)
        check("uğursuz cəhdlər pul tutmadı",
              await val("select balance from profiles where id=:i", i=cust) == bal_c - 1
              and await val("select balance from profiles where id=:i", i=cust2)
              == await val("select 0.5::numeric"))

        # ══════════ 13. mark_all_notifications_read ══════════
        print("\n── 13. mark_all_notifications_read ──")
        unread = await val("select count(*) from notifications where user_id=:u"
                           " and not is_read", u=cust)
        pa_unread = await val("select count(*) from notifications where user_id=:u"
                              " and not is_read", u=pa)
        r = await rpc("mark_all_notifications_read", {}, ch)
        check("200 + dəyişən sətir sayı (ədəd)",
              r.status_code == 200 and r.json() == unread and unread > 0, r.text)
        r = await rpc("mark_all_notifications_read", {}, ch)
        check("təkrar → 0", r.status_code == 200 and r.json() == 0, r.text)
        check("başqasının bildirişlərinə toxunmadı",
              await val("select count(*) from notifications where user_id=:u"
                        " and not is_read", u=pa) == pa_unread and pa_unread > 0)

        # ══════════ 14. block_user ══════════
        print("\n── 14. block_user ──")
        r = await rpc("block_user", {"p_blocked_id": pc, "p_reason": "spam"}, ch)
        check("global blok: 200 + uuid", r.status_code == 200 and is_uuid(r.json()), r.text)
        blk = await one("select blocker_id, blocked_id, scope, reason from user_blocks"
                        " where id=:i", i=r.json())
        check("bloklayan = çağıran (tokendən)",
              str(blk.blocker_id) == cust and str(blk.blocked_id) == pc
              and blk.scope == "global" and blk.reason == "spam", str(blk))
        r = await rpc("block_user", {"p_blocked_id": pc}, ch)
        check("təkrar blok → null (204, SQL kimi id yoxdur)",
              r.status_code == 204, f"{r.status_code} {r.text}")
        r = await rpc("block_user", {"p_blocked_id": cust}, ch)
        check("özünü bloklamaq → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("block_user", {"p_blocked_id": pc, "p_scope": "hamı"}, ch)
        check("yanlış scope → 400", err(r, 400, "P0001"), r.text)
        async with SessionLocal() as db:
            brig = (await db.execute(text(
                "insert into brigades (owner_id, name) values (:o, 'RPC Komanda')"
                " returning id"), {"o": pa})).first()
            mem_b = (await db.execute(text(
                "insert into brigade_members (brigade_id, profile_id, role, is_online)"
                " values (:b, :p, 'member', true) returning id"),
                {"b": brig.id, "p": pb})).first()
            mem_c = (await db.execute(text(
                "insert into brigade_members (brigade_id, profile_id, role, is_online)"
                " values (:b, :p, 'member', true) returning id"),
                {"b": brig.id, "p": pc})).first()
            await db.commit()
            brig_id, mem_b, mem_c = str(brig.id), str(mem_b.id), str(mem_c.id)
        r = await rpc("block_user", {"p_blocked_id": pc, "p_scope": "brigade"}, ah)
        check("brigade scope brigade_id-siz → 400", err(r, 400, "P0001", "brigade_id"),
              r.text)
        r = await rpc("block_user", {"p_blocked_id": pc, "p_scope": "brigade",
                                     "p_brigade_id": brig_id}, bh)
        check("adi üzv komandadan bloklaya bilməz",
              err(r, 400, "P0001", "sahibi/dispetçeri"), r.text)
        r = await rpc("block_user", {"p_blocked_id": pc, "p_reason": None,
                                     "p_scope": "brigade", "p_brigade_id": brig_id}, ah)
        check("sahib komandadan bloklayır: 200 + uuid",
              r.status_code == 200 and is_uuid(r.json()), r.text)
        check("bloklanan üzv deaktiv edildi",
              await val("select is_active from brigade_members where id=:i", i=mem_c)
              is False)

        # ══════════ 15. request_provider_role ══════════
        print("\n── 15. request_provider_role ──")
        r = await rpc("request_provider_role", {
            "p_message": None, "p_company_name": "Usta MMC",
            "p_experience_years": 5, "p_specialties": ["Santexnik", "Elektrik"]}, c2h)
        check("müraciət: 200 + uuid", r.status_code == 200 and is_uuid(r.json()), r.text)
        pr = await one("select user_id, company_name, experience_years, specialties,"
                       " status from provider_requests where id=:i", i=r.json())
        check("müraciət çağıranın adına, sahələr yazıldı",
              str(pr.user_id) == cust2 and pr.company_name == "Usta MMC"
              and pr.experience_years == 5
              and list(pr.specialties) == ["Santexnik", "Elektrik"]
              and pr.status == "pending", str(pr))
        r = await rpc("request_provider_role", {
            "p_message": None, "p_company_name": None, "p_experience_years": None,
            "p_specialties": []}, c2h)
        check("təkrar → mesajda 'artıq aktiv müraciətiniz' (klient bunu yoxlayır)",
              err(r, 400, "P0001", "artıq aktiv müraciətiniz"), r.text)
        r = await rpc("request_provider_role", {}, ah)
        check("provayder müraciət edə bilməz",
              err(r, 400, "P0001", "artıq provayder"), r.text)
        r = await rpc("request_provider_role", {"p_specialties": "Santexnik"}, ch)
        check("specialties massiv deyil → 400 22P02", err(r, 400, "22P02"), r.text)

        # ══════════ 16. open_conversation ══════════
        print("\n── 16. open_conversation ──")
        r = await rpc("open_conversation", {"p_opportunity_id": opp1, "p_peer_id": pa}, ch)
        conv = r.json()
        check("müştəri açır: 200 + uuid", r.status_code == 200 and is_uuid(conv), r.text)
        cv = await one("select customer_id, provider_id, opportunity_id"
                       " from conversations where id=:i", i=conv)
        check("müştəri = sifariş sahibi, provayder = peer",
              str(cv.customer_id) == cust and str(cv.provider_id) == pa
              and str(cv.opportunity_id) == opp1, str(cv))
        r = await rpc("open_conversation", {"p_opportunity_id": opp1, "p_peer_id": pa}, ch)
        check("idempotent: eyni id", r.json() == conv, r.text)
        r = await rpc("open_conversation", {"p_opportunity_id": opp1, "p_peer_id": cust2}, ah)
        check("provayder açır (peer nəzərə alınmır) → eyni söhbət",
              r.status_code == 200 and r.json() == conv, r.text)
        r = await rpc("open_conversation", {"p_opportunity_id": opp1, "p_peer_id": pa}, bh)
        cv2 = await one("select customer_id, provider_id from conversations"
                        " where id=:i", i=r.json())
        check("başqası başqasının adından söhbət aça bilmir (provayder = özü)",
              r.status_code == 200 and r.json() != conv
              and str(cv2.customer_id) == cust and str(cv2.provider_id) == pb, str(cv2))
        r = await rpc("open_conversation",
                      {"p_opportunity_id": str(uuid.uuid4()), "p_peer_id": pa}, ch)
        check("naməlum sifariş → 400", err(r, 400, "P0001", "tapılmadı"), r.text)

        # ══════════ 17. open_support_conversation ══════════
        print("\n── 17. open_support_conversation ──")
        r = await rpc("open_support_conversation", {}, ch)
        sup = r.json()
        check("arqumentsiz (SupportChat.tsx): 200 + uuid",
              r.status_code == 200 and is_uuid(sup), r.text)
        sc = await one("select customer_id, provider_id, category, user_role,"
                       " opportunity_id from conversations where id=:i", i=sup)
        check("dəstək söhbəti: müştəri = çağıran, dəstək = admin, general/customer",
              str(sc.customer_id) == cust and str(sc.provider_id) == adm
              and sc.category == "general" and sc.user_role == "customer"
              and sc.opportunity_id is None, str(sc))
        r = await rpc("open_support_conversation",
                      {"p_category": "general", "p_user_role": "provider"}, ch)
        check("eyni kateqoriya → eyni id (user_role yenilənir)",
              r.json() == sup and await val(
                  "select user_role from conversations where id=:i", i=sup) == "provider",
              r.text)
        r = await rpc("open_support_conversation",
                      {"p_category": "payment", "p_user_role": "customer"}, ch)
        check("başqa kateqoriya → yeni söhbət", is_uuid(r.json()) and r.json() != sup,
              r.text)
        r = await rpc("open_support_conversation", {"p_category": "pul"}, ch)
        check("yanlış kateqoriya → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("open_support_conversation", {"p_user_role": "admin"}, ch)
        check("yanlış rol → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("open_support_conversation", {}, admh)
        check("dəstək hesabı özü ilə söhbət aça bilməz", err(r, 400, "P0001"), r.text)

        # ══════════ 18. claim_opportunity / decline_offer / expire_stale_offers ═══
        print("\n── 18. Briqada: claim / decline / expire ──")
        src = await new_opp(c2h, "Briqada işi")

        async def assignment_c(member: str, *, ago: int = 0, by: str | None = None,
                               source: str = src) -> str:
            async with SessionLocal() as db:
                row = (await db.execute(text(
                    "insert into brigade_assignments (brigade_id, member_id,"
                    " source_type, source_id, status, assigned_by, assigned_at)"
                    " values (:b, :m, 'opportunity', :s, 'offered', cast(:by as uuid),"
                    " now() - make_interval(secs => :ago)) returning id"),
                    {"b": brig_id, "m": member, "s": source, "by": by,
                     "ago": ago})).first()
                await db.commit()
                return str(row.id)

        await run("update brigade_members set is_active = true where id=:i", i=mem_c)
        a1 = await assignment_c(mem_b)
        a2 = await assignment_c(mem_c)
        r = await rpc("claim_opportunity", {"p_assignment_id": a1}, ch)
        check("yad şəxs götürə bilmir → 400", err(r, 400, "P0001", "Yalnız"), r.text)
        r = await rpc("claim_opportunity", {"p_assignment_id": a1}, bh)
        check("üzv götürür → 204 (SQL `returns void`)", r.status_code == 204,
              f"{r.status_code} {r.text}")
        check("a1 accepted, eyni sifarişin a2-si expired",
              await val("select status from brigade_assignments where id=:i", i=a1)
              == "accepted"
              and await val("select status from brigade_assignments where id=:i", i=a2)
              == "expired")
        r = await rpc("claim_opportunity", {"p_assignment_id": a2}, pch)
        check("artıq bağlanmış təklif → 400", err(r, 400, "P0001"), r.text)
        r = await rpc("claim_opportunity", {"p_assignment_id": str(uuid.uuid4())}, bh)
        check("naməlum təyinat → 400", err(r, 400, "P0001", "tapılmadı"), r.text)

        src2 = await new_opp(c2h, "Briqada işi 2")
        a3 = await assignment_c(mem_b, source=src2)
        r = await rpc("decline_offer", {"p_assignment_id": a3}, ah)
        check("başqası (hətta sahib) imtina edə bilmir → 400",
              err(r, 400, "P0001", "İcazə yoxdur"), r.text)
        r = await rpc("decline_offer", {"p_assignment_id": a3}, bh)
        check("üzv imtina edir → 204", r.status_code == 204, f"{r.status_code} {r.text}")
        check("a3 declined",
              await val("select status from brigade_assignments where id=:i", i=a3)
              == "declined")
        r = await rpc("decline_offer", {"p_assignment_id": a3}, bh)
        check("təkrar imtina → 400", err(r, 400, "P0001"), r.text)

        src3 = await new_opp(c2h, "Briqada işi 3")
        old = await assignment_c(mem_b, ago=120, source=src3)
        fresh = await assignment_c(mem_c, ago=30, source=src3)
        src4 = await new_opp(c2h, "Briqada işi 4")
        manual = await assignment_c(mem_c, ago=600, by=pa, source=src4)
        r = await rpc("expire_stale_offers", {"p_threshold_seconds": 0}, bh)
        check("adi istifadəçi: hədd 60 s-dən aşağı düşmür → yalnız 120 s-lik (1)",
              r.status_code == 200 and r.json() == 1, r.text)
        check("köhnə expired, təzə və əl ilə təyin olunan toxunulmaz",
              await val("select status from brigade_assignments where id=:i", i=old)
              == "expired"
              and await val("select status from brigade_assignments where id=:i", i=fresh)
              == "offered"
              and await val("select status from brigade_assignments where id=:i", i=manual)
              == "offered")
        r = await rpc("expire_stale_offers", {}, bh)
        check("defolt arqument (60) → 0", r.status_code == 200 and r.json() == 0, r.text)
        r = await rpc("expire_stale_offers", {"p_threshold_seconds": 10}, admh)
        check("admin aşağı hədd verə bilər → təzə təklif də (1)",
              r.status_code == 200 and r.json() == 1, r.text)
        r = await rpc("expire_stale_offers", {"p_threshold_seconds": "çox"}, admh)
        check("yanlış ədəd → 400 22P02", err(r, 400, "22P02"), r.text)

        # ══════════ 19. Bloklanmış hesabın köhnə tokeni ══════════
        print("\n── 19. Deaktiv hesab ──")
        await run("update users set is_active = false where id=:i", i=cust2)
        r = await rpc("mark_all_notifications_read", {}, c2h)
        check("deaktiv hesabın tokeni → 401", err(r, 401, "PGRST301"), r.text)

    print("\nRPC CORE TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
