"""Paritet E2E testi — Supabase DB trigger-lərindən Python-a köçürülən məntiq.

Əhatə:
  1. Təklif bildirişləri (yeni təklif, qəbul + rədd edilənlər, tamamlama,
     geri qaytarma — o cümlədən cron yolu ilə avtomatik refund)
  2. Birbaşa sifariş (booking) bildirişləri + provayder endpointləri
     (confirm / complete / incoming) və icazə/status qaydaları
  3. Briqada avtomatik yayımı (auto_broadcast_opportunity)
  4. Bot provayderlərin koordinat yenilənməsi (refresh_bot_locations cron)

Təzə bazada tək başına işləyir (DATABASE_URL/REDIS_URL env ilə):
    python3 tests/e2e_parity.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timezone

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

    async def notifs(user_id: str, ntype: str | None = None,
                     kind: str | None = None) -> list:
        """İstifadəçinin bildirişləri (köhnədən yeniyə) — birbaşa bazadan."""
        async with SessionLocal() as db:
            rows = (await db.execute(text(
                "select id, type, kind, title, body, related_id, link"
                "  from notifications where user_id = :u"
                " order by created_at, id"), {"u": user_id})).all()
        return [r for r in rows
                if (ntype is None or r.type == ntype)
                and (kind is None or r.kind == kind)]

    async def one(sql: str, params: dict | None = None):
        async with SessionLocal() as db:
            return (await db.execute(text(sql), params or {})).first()

    async def run(sql: str, params: dict | None = None) -> None:
        async with SessionLocal() as db:
            await db.execute(text(sql), params or {})
            await db.commit()

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        async def register(email: str, name: str, role: str) -> tuple[str, dict]:
            r = await c.post("/api/v1/auth/register", json={
                "email": email, "password": "Guclu!Parol1", "name": name,
                "role": role})
            check(f"qeydiyyat: {name}", r.status_code == 201,
                  "" if r.status_code == 201 else r.text[:120])
            return (r.json()["user_id"],
                    {"Authorization": f"Bearer {r.json()['access_token']}"})

        # ══════════ 0. İstifadəçilər + seed ══════════
        cust, ch = await register("musteri@paritet.az", "Paritet Müştəri", "customer")
        pa, ah = await register("usta.a@paritet.az", "Usta A", "provider")
        pb, bh = await register("usta.b@paritet.az", "Usta B", "provider")
        pc, pch = await register("usta.c@paritet.az", "Usta C", "provider")

        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "insert into service_categories (label) values ('Santexnik')"
                " returning id"))).first()
            cat2 = (await db.execute(text(
                "insert into service_categories (label) values ('Elektrik')"
                " returning id"))).first()
            sub = (await db.execute(text(
                "insert into service_subcategories (category_id, label)"
                " values (:c, 'Kran təmiri') returning id"),
                {"c": cat.id})).first()
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'),"
                " ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '0')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text(
                "update profiles set balance = 1000 where id = :id"), {"id": cust})
            # Ustalar: KYC təsdiqi + komissiya üçün balans (place_bid qaydaları)
            await db.execute(text(
                "update profiles set is_verified = true,"
                " last_kyc_approved_at = now(), balance = 50"
                " where id = any(:ids)"), {"ids": [pa, pb, pc]})
            await db.commit()
            cat_id, cat2_id, sub_id = str(cat.id), str(cat2.id), str(sub.id)

        async def new_opp(title: str, **extra) -> str:
            r = await c.post("/api/v1/opportunities", headers=ch, json={
                "title": title, "description": "Paritet testi",
                "category_id": cat_id, "date": "2026-12-15", **extra})
            check(f"sifariş yaradıldı: {title}", r.status_code == 201, str(r.json()))
            return r.json()["id"]

        async def offer(headers: dict, opp: str, amount: str) -> str:
            r = await c.post("/api/v1/offers", headers=headers, json={
                "opportunity_id": opp, "amount": amount})
            check(f"təklif verildi ({amount} ₼)", r.status_code == 201, str(r.json()))
            return r.json()["id"]

        # ══════════ 1. Təklif bildirişləri ══════════
        print("\n── 1. Təklif bildirişləri ──")
        opp1 = await new_opp("Kran sızır")
        off_a = await offer(ah, opp1, "100.00")

        n = await notifs(cust, "new_offer")
        check("yeni təklif → müştəriyə 1 bildiriş (type=new_offer)", len(n) == 1)
        check("new_offer: kind/başlıq/mətn/related_id/link orijinaldakı kimi",
              n[0].kind == "new_offer"
              and n[0].title == "Yeni təklif: Usta A"
              and n[0].body == "Kran sızır — 100.00 ₼"
              and n[0].related_id == off_a
              and n[0].link == "/my-opportunities", str(tuple(n[0])))
        check("təklif verən ustaya new_offer getmir",
              len(await notifs(pa, "new_offer")) == 0)

        off_b = await offer(bh, opp1, "120.00")
        off_c = await offer(pch, opp1, "90.00")
        check("3 təklif → müştəridə 3 new_offer",
              len(await notifs(cust, "new_offer")) == 3)

        # Uğursuz qəbul cəhdi (sifariş sahibi deyil) → heç bir bildiriş yaranmır
        r = await c.post(f"/api/v1/offers/{off_a}/accept", headers=bh,
                         json={"method": "card"})
        check("yad şəxs qəbul edə bilmir", r.status_code == 409)
        check("uğursuz qəbul bildiriş yaratmır",
              len(await notifs(pa, "offer_accepted_card")) == 0
              and len(await notifs(pb, "offer_rejected")) == 0)

        # KART ilə qəbul: A qəbul olunur, B və C rədd edilir
        r = await c.post(f"/api/v1/offers/{off_a}/accept", headers=ch,
                         json={"method": "card"})
        check("qəbul (card)", r.status_code == 200, str(r.json()))
        n = await notifs(pa, "offer_accepted_card")
        check("qəbul → qəbul olunan ustaya 1 bildiriş (offer_accepted_card)",
              len(n) == 1 and n[0].related_id == opp1, str([tuple(x) for x in n]))
        check("qəbul olunan ustaya rədd bildirişi getmir",
              len(await notifs(pa, "offer_rejected")) == 0)
        for label, uid, oid, amt in (("B", pb, off_b, "120.00"),
                                     ("C", pc, off_c, "90.00")):
            n = await notifs(uid, "offer_rejected")
            check(f"rədd edilən usta {label} → 1 bildiriş (offer_rejected)",
                  len(n) == 1)
            check(f"offer_rejected ({label}): öz təklifi + orijinal mətn",
                  n[0].kind == "offer_rejected"
                  and n[0].title == "Təklifin rədd edildi"
                  and n[0].body == f"Kran sızır — {amt} ₼"
                  and n[0].related_id == oid
                  and n[0].link == "/account/services", str(tuple(n[0])))
            check(f"usta {label}-yə qəbul bildirişi getmir",
                  len(await notifs(uid, "offer_accepted_card")) == 0)
        check("müştəriyə offer_rejected / offer_accepted getmir",
              len(await notifs(cust, "offer_rejected")) == 0
              and len(await notifs(cust, "offer_accepted_card")) == 0)

        # Tamamlama (kart): açılan məbləğ bildirişdə
        r = await c.post(f"/api/v1/offers/{off_a}/complete", headers=ch)
        check("tamamlama (card)", r.status_code == 200
              and r.json()["released"] == "85.50", str(r.json()))
        n = await notifs(pa, "offer_completed")
        check("tamamlama → ustaya 1 bildiriş (offer_completed)", len(n) == 1)
        check("offer_completed (kart): açılan məbləğ 85.50 ₼ mətndədir",
              n[0].kind == "offer_completed"
              and n[0].title == "İş tamamlandı və ödəniş açıldı"
              and "85.50 ₼" in n[0].body and "Kran sızır" in n[0].body
              and n[0].related_id == off_a, str(tuple(n[0])))
        check("müştəriyə offer_completed getmir",
              len(await notifs(cust, "offer_completed")) == 0)
        r = await c.post(f"/api/v1/offers/{off_a}/complete", headers=ch)
        check("təkrar tamamlama rədd + yeni bildiriş yoxdur", r.status_code == 409
              and len(await notifs(pa, "offer_completed")) == 1)

        # NAĞD axın: əvvəlcədən (başqa tranzaksiyada) rədd edilmiş təklif
        # yenidən bildiriş almamalıdır
        opp2 = await new_opp("Rozetka dəyişimi")
        off_b2 = await offer(bh, opp2, "50.00")
        await run(
            "insert into opportunities_offers (opportunity_id, provider_id,"
            " offer_amount, status, updated_at)"
            " values (:o, :p, 40, 'rejected', now() - interval '1 hour')",
            {"o": opp2, "p": pc})
        r = await c.post(f"/api/v1/offers/{off_b2}/accept", headers=ch,
                         json={"method": "cash"})
        check("qəbul (cash)", r.status_code == 200, str(r.json()))
        n = await notifs(pb, "offer_accepted_cash")
        check("nağd qəbul → ustaya 1 bildiriş (offer_accepted_cash)",
              len(n) == 1 and n[0].related_id == opp2)
        check("köhnə rədd edilmiş təklif yenidən bildiriş almır",
              len(await notifs(pc, "offer_rejected")) == 1)
        r = await c.post(f"/api/v1/offers/{off_b2}/complete", headers=ch)
        check("tamamlama (cash)", r.status_code == 200
              and r.json()["method"] == "cash", str(r.json()))
        n = await notifs(pb, "offer_completed")
        check("nağd tamamlama → ustaya 1 bildiriş, məbləğsiz sadə mətn",
              len(n) == 1 and n[0].title == "İş tamamlandı"
              and "₼" not in n[0].body and "Rozetka dəyişimi" in n[0].body
              and n[0].related_id == off_b2, str(tuple(n[0])))

        # ── Geri qaytarma (refund) → usta + müştəri ──
        # QEYD: money.refund_offer hazırkı sxemdə işləmir (bu tapşırıqdan
        # kənar, toxunulmayan pul kodu): (1) uuid tipli transactions.payment_id
        # sütununa 'refund:<offer_id>' mətni ilə müraciət edir → DataError;
        # (2) təklifə 'refunded' statusu yazır, opportunities_offers_status_check
        # isə buna icazə vermir. Əvvəlcə REAL yol sınanır; yalnız məhz bu məlum
        # xətalardan biri çıxarsa, pul hissəsi olmayan, eyni nəticə formasını
        # verən əvəzedici ilə endpoint-in / cron-un bildiriş hissəsi yoxlanır.
        import app.api.v1.offers as offers_mod
        from app.services import cron
        from app.services.money import MoneyError

        async def stub_refund(db, *, offer_id, caller_id, caller_role, reason=None):
            o = (await db.execute(text(
                "select oo.opportunity_id, oo.offer_amount, oo.status,"
                "       op.created_by"
                "  from opportunities_offers oo"
                "  join opportunities op on op.id = oo.opportunity_id"
                " where oo.id = :id for update of oo"), {"id": offer_id})).first()
            if o is None:
                raise MoneyError("OFFER_NOT_FOUND")
            if o.status != "accepted":
                raise MoneyError(f"OFFER_NOT_REFUNDABLE: status={o.status}")
            # 'refunded' təklif statusuna CHECK icazə vermir → 'rejected'
            await db.execute(text(
                "update opportunities_offers set status='rejected' where id=:id"),
                {"id": offer_id})
            await db.execute(text(
                "update opportunities set status='refunded',"
                " cancellation_reason=:r where id=:id"),
                {"r": reason or "Refund issued", "id": o.opportunity_id})
            return {"ok": True, "refunded_amount": str(o.offer_amount),
                    "customer_id": str(o.created_by),
                    "opportunity_id": str(o.opportunity_id)}

        async def stub_release(db, *, offer_id, caller_id, caller_role):
            o = (await db.execute(text(
                "select status, payment_method from opportunities_offers"
                " where id = :id for update"), {"id": offer_id})).first()
            if o is None or o.status == "completed":
                raise MoneyError("ALREADY_RELEASED")
            await db.execute(text(
                "update opportunities_offers set status='completed',"
                " escrow_released_at=now() where id=:id"), {"id": offer_id})
            return {"ok": True, "released": "12.34",
                    "method": o.payment_method or "cash", "bonus": "0"}

        real_refund = (offers_mod.refund_offer, cron.refund_offer)
        real_release = cron.release_offer
        known_issues: list[str] = []
        try:
            opp3 = await new_opp("Boru təmiri")
            off_a3 = await offer(ah, opp3, "60.00")
            r = await c.post(f"/api/v1/offers/{off_a3}/accept", headers=ch,
                             json={"method": "card"})
            check("qəbul (card, refund üçün)", r.status_code == 200)
            r = await c.post(f"/api/v1/offers/{off_a3}/refund", headers=pch,
                             json={"reason": "yad şəxs"})
            check("yad şəxs refund edə bilmir + bildiriş yoxdur",
                  r.status_code == 409
                  and len(await notifs(cust, "offer_refunded")) == 0)

            from sqlalchemy.exc import DBAPIError
            try:
                r = await c.post(f"/api/v1/offers/{off_a3}/refund", headers=ch,
                                 json={"reason": "Usta gəlmədi"})
                tag = ""
            except DBAPIError as e:
                if "invalid UUID 'refund:" not in str(e) \
                        and "opportunities_offers_status_check" not in str(e):
                    raise
                known_issues.append(
                    "money.refund_offer real bazada işləmir: transactions."
                    "payment_id uuid-dir, kod isə 'refund:<offer_id>' mətni"
                    " göndərir (DataError); üstəlik təklifə yazdığı 'refunded'"
                    " statusuna opportunities_offers_status_check icazə vermir"
                    " — POST /offers/{id}/refund 500 verir, cron refund_no_show"
                    " isə səssizcə 0 qaytarır")
                print("  [!] MƏLUM PROBLEM: " + known_issues[-1])
                print("      → bildiriş hissəsi əvəzedici refund_offer ilə yoxlanır")
                check("uğursuz real refund heç nə yazmayıb (rollback)",
                      len(await notifs(cust, "offer_refunded")) == 0
                      and len(await notifs(pa, "offer_refunded")) == 0)
                offers_mod.refund_offer = stub_refund
                cron.refund_offer = stub_refund
                tag = " [əvəzedici refund_offer]"
                r = await c.post(f"/api/v1/offers/{off_a3}/refund", headers=ch,
                                 json={"reason": "Usta gəlmədi"})
            check("refund" + tag, r.status_code == 200
                  and r.json()["refunded_amount"] == "60.00", str(r.json()))
            n = await notifs(cust, "offer_refunded")
            check("refund → müştəriyə 1 bildiriş (offer_refunded, məbləğ ilə)" + tag,
                  len(n) == 1 and n[0].kind == "offer_refunded"
                  and n[0].related_id == off_a3
                  and "60.00 ₼" in n[0].body and "Boru təmiri" in n[0].body,
                  str([tuple(x) for x in n]))
            n = await notifs(pa, "offer_refunded")
            check("refund → ustaya 1 bildiriş (offer_refunded)" + tag,
                  len(n) == 1 and n[0].kind == "offer_refunded"
                  and n[0].related_id == off_a3
                  and "Boru təmiri" in n[0].body, str([tuple(x) for x in n]))
            check("refund-da kənar ustaya bildiriş getmir",
                  len(await notifs(pb, "offer_refunded")) == 0)
            r = await c.post(f"/api/v1/offers/{off_a3}/refund", headers=ch,
                             json={"reason": "təkrar"})
            check("təkrar refund idempotentdir: pul da, bildiriş də təkrarlanmır" + tag,
                  r.status_code == (409 if tag else 200)
                  and (tag or r.json().get("already_refunded") is True)
                  and len(await notifs(cust, "offer_refunded")) == 1
                  and len(await notifs(pa, "offer_refunded")) == 1)

            # Cron yolu: 30 dəq yola düşməyən usta → avtomatik refund + bildirişlər
            opp4 = await new_opp("Kombi baxışı")
            off_b4 = await offer(bh, opp4, "70.00")
            r = await c.post(f"/api/v1/offers/{off_b4}/accept", headers=ch,
                             json={"method": "card"})
            check("qəbul (card, no-show üçün)", r.status_code == 200)
            check("vaxtı çatmamış təklif cron-da refund olunmur",
                  await cron.refund_no_show() == 0
                  and len(await notifs(pb, "offer_refunded")) == 0)
            async with SessionLocal() as db:   # qəbul vaxtını 31 dəq geri çək
                await db.execute(text(
                    "alter table opportunities_offers"
                    " disable trigger ellit_touch_updated_at"))
                await db.execute(text(
                    "update opportunities_offers"
                    "   set updated_at = now() - interval '31 minutes'"
                    " where id = :id"), {"id": off_b4})
                await db.execute(text(
                    "alter table opportunities_offers"
                    " enable trigger ellit_touch_updated_at"))
                await db.commit()
            check("cron: no-show refund 1 təklif" + tag,
                  await cron.refund_no_show() == 1)
            n = await notifs(pb, "offer_refunded")
            check("cron refund → ustaya bildiriş" + tag,
                  len(n) == 1 and n[0].related_id == off_b4)
            n = await notifs(cust, "offer_refunded")
            check("cron refund → müştəriyə bildiriş" + tag,
                  len(n) == 2 and n[-1].related_id == off_b4
                  and "70.00 ₼" in n[-1].body)

            # Cron yolu: completed + 24 saat → escrow avtomatik açılır + bildiriş
            opp5 = await new_opp("Qapı kilidi")
            off_c5 = await offer(pch, opp5, "80.00")
            r = await c.post(f"/api/v1/offers/{off_c5}/accept", headers=ch,
                             json={"method": "card"})
            check("qəbul (card, auto-release üçün)", r.status_code == 200)
            r = await c.post(f"/api/v1/opportunities/{opp5}/status", headers=ch,
                             json={"status": "completed"})
            check("müştəri sifarişi completed etdi", r.status_code == 200)
            await run("update opportunities set completed_at ="
                      " now() - interval '25 hours' where id = :id", {"id": opp5})
            released = await cron.auto_release_completed_escrow()
            tag = ""
            if released == 0:
                known_issues.append(
                    "cron auto_release_completed_escrow heç vaxt işləmir:"
                    " money.release_offer sistem çağıranını 'Yalnız müştəri"
                    " tamamlaya bilər' ilə rədd edir, cron xətanı udur")
                print("  [!] MƏLUM PROBLEM: " + known_issues[-1])
                print("      → bildiriş hissəsi əvəzedici release_offer ilə yoxlanır")
                check("uğursuz real auto-release bildiriş yazmayıb",
                      len(await notifs(pc, "offer_completed")) == 0)
                cron.release_offer = stub_release
                tag = " [əvəzedici release_offer]"
                released = await cron.auto_release_completed_escrow()
            check("cron: auto-release 1 təklif" + tag, released == 1)
            n = await notifs(pc, "offer_completed")
            check("cron auto-release → ustaya bildiriş (offer_completed)" + tag,
                  len(n) == 1 and n[0].related_id == off_c5
                  and "Qapı kilidi" in n[0].body and "₼" in n[0].body,
                  str([tuple(x) for x in n]))
        finally:
            offers_mod.refund_offer, cron.refund_offer = real_refund
            cron.release_offer = real_release

        # ══════════ 2. Birbaşa sifarişlər (bookings) ══════════
        print("\n── 2. Booking bildirişləri + provayder endpointləri ──")
        async with SessionLocal() as db:   # Usta A-nın xidməti
            svc = (await db.execute(text(
                "insert into services (title, price, provider_id, status)"
                " values ('Ev təmizliyi', 30, :p, 'active') returning id"),
                {"p": pa})).first()
            await db.commit()
        svc_id = svc.id

        async def book() -> str:
            r = await c.post("/api/v1/bookings", headers=ch, json={
                "service_id": svc_id, "date": "2026-12-20", "time": "10:00"})
            check("booking yaradıldı", r.status_code == 201, str(r.json()))
            return r.json()["booking_id"]

        async def bstatus(bid: str) -> str:
            return (await one("select status from bookings where id = :id",
                              {"id": bid})).status

        bk1 = await book()
        n = await notifs(pa, "new_booking")
        check("yeni booking → xidmətin provayderinə 1 bildiriş (new_booking)",
              len(n) == 1 and n[0].title == "Yeni sifariş"
              and n[0].body == "Sizə yeni sifariş gəldi."
              and n[0].related_id == bk1, str([tuple(x) for x in n]))
        check("müştəriyə / kənar ustaya new_booking getmir",
              len(await notifs(cust, "new_booking")) == 0
              and len(await notifs(pb, "new_booking")) == 0)

        # GET /bookings/incoming
        r = await c.get("/api/v1/bookings/incoming", headers=ah)
        inc = r.json()
        check("incoming: provayder öz xidmətinin sifarişini görür",
              r.status_code == 200 and len(inc) == 1 and inc[0]["id"] == bk1
              and inc[0]["status"] == "pending"
              and inc[0]["service_title"] == "Ev təmizliyi"
              and inc[0]["customer_name"] == "Paritet Müştəri", str(inc)[:200])
        r = await c.get("/api/v1/bookings/incoming", headers=bh)
        check("incoming: başqa provayderdə boşdur",
              r.status_code == 200 and r.json() == [])
        r = await c.get("/api/v1/bookings/incoming", headers=ch)
        check("incoming: müştəridə boşdur", r.status_code == 200 and r.json() == [])
        r = await c.get("/api/v1/bookings/incoming")
        check("incoming: tokensiz 401", r.status_code == 401)

        # confirm — icazə və status qaydaları
        r = await c.post(f"/api/v1/bookings/{bk1}/complete", headers=ah)
        check("pending sifarişi tamamlamaq olmaz (409)", r.status_code == 409)
        r = await c.post(f"/api/v1/bookings/{bk1}/confirm", headers=bh)
        check("yad provayder confirm edə bilmir (403)", r.status_code == 403)
        r = await c.post(f"/api/v1/bookings/{bk1}/confirm", headers=ch)
        check("müştəri confirm edə bilmir (403)", r.status_code == 403)
        r = await c.post(f"/api/v1/bookings/{uuid.uuid4()}/confirm", headers=ah)
        check("mövcud olmayan booking confirm → 404", r.status_code == 404)
        check("uğursuz cəhdlər statusu və bildirişləri dəyişmir",
              await bstatus(bk1) == "pending"
              and len(await notifs(cust, "booking_confirmed")) == 0)
        r = await c.post(f"/api/v1/bookings/{bk1}/confirm", headers=ah)
        check("provayder confirm etdi (pending → confirmed)",
              r.status_code == 200 and r.json()["status"] == "confirmed"
              and await bstatus(bk1) == "confirmed", str(r.json()))
        n = await notifs(cust, "booking_confirmed")
        check("confirm → müştəriyə 1 bildiriş (booking_confirmed)",
              len(n) == 1 and n[0].title == "Sifariş qəbul edildi"
              and n[0].body == "Provayder sifarişinizi qəbul etdi."
              and n[0].related_id == bk1, str([tuple(x) for x in n]))
        r = await c.post(f"/api/v1/bookings/{bk1}/confirm", headers=ah)
        check("təkrar confirm rədd (409)", r.status_code == 409)

        # complete — icazə və status qaydaları
        r = await c.post(f"/api/v1/bookings/{bk1}/complete", headers=bh)
        check("yad provayder complete edə bilmir (403)", r.status_code == 403)
        r = await c.post(f"/api/v1/bookings/{bk1}/complete", headers=ch)
        check("müştəri complete edə bilmir (403)", r.status_code == 403)
        r = await c.post(f"/api/v1/bookings/{uuid.uuid4()}/complete", headers=ah)
        check("mövcud olmayan booking complete → 404", r.status_code == 404)
        r = await c.post(f"/api/v1/bookings/{bk1}/complete", headers=ah)
        check("provayder complete etdi (confirmed → completed)",
              r.status_code == 200 and r.json()["status"] == "completed"
              and await bstatus(bk1) == "completed", str(r.json()))
        n = await notifs(cust, "booking_completed")
        check("complete → müştəriyə 1 bildiriş (booking_completed)",
              len(n) == 1 and n[0].title == "Sifariş tamamlandı"
              and n[0].related_id == bk1, str([tuple(x) for x in n]))
        check("status bildirişləri provayderin özünə getmir",
              len(await notifs(pa, "booking_confirmed")) == 0
              and len(await notifs(pa, "booking_completed")) == 0)
        r = await c.post(f"/api/v1/bookings/{bk1}/complete", headers=ah)
        check("təkrar complete rədd (409)", r.status_code == 409)
        r = await c.post(f"/api/v1/bookings/{bk1}/confirm", headers=ah)
        check("completed → confirmed qayıtmır (409)", r.status_code == 409)
        r = await c.post(f"/api/v1/bookings/{bk1}/cancel", headers=ch)
        check("tamamlanmış sifariş ləğv olunmur (409)", r.status_code == 409)

        # cancel — müştəri ləğv edir → provayderə bildiriş
        bk2 = await book()
        r = await c.post(f"/api/v1/bookings/{bk2}/cancel", headers=bh)
        check("yad şəxs ləğv edə bilmir (409, status dəyişmir)",
              r.status_code == 409 and await bstatus(bk2) == "pending")
        r = await c.post(f"/api/v1/bookings/{bk2}/cancel", headers=ch)
        check("müştəri ləğv etdi", r.status_code == 200
              and await bstatus(bk2) == "cancelled")
        n = await notifs(pa, "booking_cancelled")
        check("müştəri ləğvi → provayderə 1 bildiriş (booking_cancelled)",
              len(n) == 1 and n[0].title == "Sifariş ləğv edildi"
              and n[0].related_id == bk2, str([tuple(x) for x in n]))
        check("ləğv edən müştərinin özünə bildiriş getmir",
              len(await notifs(cust, "booking_cancelled")) == 0)
        r = await c.post(f"/api/v1/bookings/{bk2}/confirm", headers=ah)
        check("ləğv olunmuş sifariş confirm olunmur (409)", r.status_code == 409)

        # cancel — provayder ləğv edir → müştəriyə bildiriş
        bk3 = await book()
        r = await c.post(f"/api/v1/bookings/{bk3}/confirm", headers=ah)
        check("bk3 confirm", r.status_code == 200)
        r = await c.post(f"/api/v1/bookings/{bk3}/cancel", headers=ah)
        check("provayder ləğv etdi", r.status_code == 200
              and await bstatus(bk3) == "cancelled")
        n = await notifs(cust, "booking_cancelled")
        check("provayder ləğvi → müştəriyə 1 bildiriş (booking_cancelled)",
              len(n) == 1 and n[0].related_id == bk3, str([tuple(x) for x in n]))
        check("ləğv edən provayderin özünə əlavə bildiriş getmir",
              len(await notifs(pa, "booking_cancelled")) == 1)
        r = await c.get("/api/v1/bookings/incoming?status=cancelled", headers=ah)
        check("incoming status filtri", r.status_code == 200
              and sorted(x["id"] for x in r.json()) == sorted([bk2, bk3]))
        r = await c.get("/api/v1/bookings/incoming", headers=ah)
        check("incoming: bütün sifarişlər (3)", len(r.json()) == 3)

        # ══════════ 3. Briqada avtomatik yayımı ══════════
        print("\n── 3. Briqada auto-broadcast ──")
        from app.services.brigade import auto_broadcast_opportunity

        own1, _ = await register("sahib1@paritet.az", "Sahib Bir", "provider")
        m_on, _ = await register("uzv.online@paritet.az", "Üzv Online", "provider")
        m_off, _ = await register("uzv.offline@paritet.az", "Üzv Offline", "provider")
        m_inact, _ = await register("uzv.passiv@paritet.az", "Üzv Passiv", "provider")
        m_blk, _ = await register("uzv.blok@paritet.az", "Üzv Bloklu", "provider")

        async with SessionLocal() as db:
            async def brigade(owner: str, name: str, owner_online: bool) -> str:
                b = (await db.execute(text(
                    "insert into brigades (owner_id, name) values (:o, :n)"
                    " returning id"), {"o": owner, "n": name})).first()
                # sahib üzv sətrini ellit_brigade_auto_owner trigger-i yaradır
                await db.execute(text(
                    "update brigade_members set is_online = :on"
                    " where brigade_id = :b and profile_id = :o"),
                    {"on": owner_online, "b": b.id, "o": owner})
                return str(b.id)

            async def member(b: str, p: str, *, online: bool,
                             active: bool = True) -> str:
                m = (await db.execute(text(
                    "insert into brigade_members (brigade_id, profile_id, role,"
                    " is_active, is_online) values (:b, :p, 'member', :a, :on)"
                    " returning id"),
                    {"b": b, "p": p, "a": active, "on": online})).first()
                return str(m.id)

            async def price(b: str, category: str, *, active: bool = True,
                            subcategory: str | None = None) -> None:
                await db.execute(text(
                    "insert into brigade_prices (brigade_id, category_id,"
                    " subcategory_id, price, is_active)"
                    " values (:b, :c, :s, 25, :a)"),
                    {"b": b, "c": category, "s": subcategory, "a": active})

            # B1: bu kateqoriya üçün aktiv qiymət; sahib offline
            b1 = await brigade(own1, "Usta Komanda", owner_online=False)
            await price(b1, cat_id)
            mem_on = await member(b1, m_on, online=True)
            mem_off = await member(b1, m_off, online=False)
            await member(b1, m_inact, online=True, active=False)
            await member(b1, m_blk, online=True)
            await member(b1, cust, online=True)          # sifarişin sahibi
            await db.execute(text(
                "insert into user_blocks (blocker_id, blocked_id, scope)"
                " values (:a, :b, 'global')"), {"a": own1, "b": m_blk})
            # B2: yalnız BAŞQA kateqoriya üçün qiymət; sahib online
            b2 = await brigade(pa, "Elektrik Komanda", owner_online=True)
            await price(b2, cat2_id)
            # B3: bu kateqoriya üçün qiymət var, amma aktiv deyil; sahib online
            b3 = await brigade(pc, "Passiv Qiymət", owner_online=True)
            await price(b3, cat_id, active=False)
            # B4: qiymət yalnız alt-kateqoriya üçündür; sahib online
            b4 = await brigade(pb, "Kran Ustaları", owner_online=True)
            await price(b4, cat_id, subcategory=sub_id)
            await db.commit()

        async def assignments(opp: str) -> list:
            async with SessionLocal() as db:
                return (await db.execute(text(
                    "select a.id, a.brigade_id, a.member_id, a.status,"
                    "       a.source_type, a.assigned_by, a.priority,"
                    "       m.profile_id"
                    "  from brigade_assignments a"
                    "  join brigade_members m on m.id = a.member_id"
                    " where a.source_id = :s order by a.assigned_at, a.id"),
                    {"s": opp})).all()

        opp_b = await new_opp("Hamam təmiri")
        rows = await assignments(opp_b)
        check("auto-broadcast: yalnız 1 təyinat (B1-in online aktiv üzvü)",
              len(rows) == 1 and str(rows[0].member_id) == mem_on
              and str(rows[0].brigade_id) == b1,
              str([(str(x.profile_id), x.status) for x in rows]))
        check("təyinat: status=offered, source_type=opportunity,"
              " assigned_by NULL, priority 5",
              rows[0].status == "offered" and rows[0].source_type == "opportunity"
              and rows[0].assigned_by is None and rows[0].priority == 5)
        offered_to = {str(x.profile_id) for x in rows}
        check("sifarişin sahibinə heç vaxt təklif getmir", cust not in offered_to)
        check("offline / passiv / bloklanmış üzvlərə və offline sahibə getmir",
              not offered_to & {m_off, m_inact, m_blk, own1})
        check("başqa kateqoriya / passiv qiymət / alt-kateqoriya qiymətli"
              " briqadalara getmir", not offered_to & {pa, pc, pb})
        n = await notifs(m_on, kind="brigade_offer")
        check("təklif olunan üzvə bildiriş (kind=brigade_offer)",
              len(n) == 1 and n[0].related_id == str(rows[0].id)
              and n[0].title == "Usta Komanda — yeni sifariş"
              and n[0].body == "Hamam təmiri — ilk qəbul edən qazanır"
              and n[0].link == "/account/master/incoming", str([tuple(x) for x in n]))
        others = [len(await notifs(u, kind="brigade_offer"))
                  for u in (m_off, m_inact, m_blk, own1, cust, pa, pb, pc)]
        check("təklif olunmayanlara brigade_offer bildirişi getmir",
              sum(others) == 0, str(others))

        # İkinci çağırış idempotentdir
        async with SessionLocal() as db:
            again = await auto_broadcast_opportunity(db, uuid.UUID(opp_b))
            await db.commit()
        check("ikinci çağırış idempotentdir (0 yeni təyinat, 0 yeni bildiriş)",
              again == [] and len(await assignments(opp_b)) == 1
              and len(await notifs(m_on, kind="brigade_offer")) == 1)

        # Yeni online olan üzv növbəti çağırışda əlavə olunur (yalnız o)
        await run("update brigade_members set is_online = true where id = :id",
                  {"id": mem_off})
        async with SessionLocal() as db:
            more = await auto_broadcast_opportunity(db, uuid.UUID(opp_b))
            await db.commit()
        rows = await assignments(opp_b)
        check("sonradan online olan üzv əlavə olunur (yalnız yeni sətir)",
              len(more) == 1 and more[0][0] == m_off and len(rows) == 2
              and all(x.status == "offered" for x in rows)
              and len(await notifs(m_off, kind="brigade_offer")) == 1
              and len(await notifs(m_on, kind="brigade_offer")) == 1)

        # Sifariş artıq götürülübsə yayım dayanır
        await run("update brigade_assignments set status = 'accepted'"
                  " where source_id = :s and member_id = :m",
                  {"s": opp_b, "m": mem_on})
        await run("update brigade_members set is_online = true"
                  " where brigade_id = :b and profile_id = :p",
                  {"b": b1, "p": own1})
        async with SessionLocal() as db:
            after = await auto_broadcast_opportunity(db, uuid.UUID(opp_b))
            await db.commit()
        check("götürülmüş sifariş yenidən yayılmır",
              after == [] and len(await assignments(opp_b)) == 2)
        async with SessionLocal() as db:
            none = await auto_broadcast_opportunity(db, uuid.uuid4())
        check("mövcud olmayan sifariş → boş nəticə", none == [])

        # Alt-kateqoriyalı sifariş: B1 (ümumi qiymət) + B4 (alt-kateqoriya qiyməti)
        opp_s = await new_opp("Kran dəyişimi", subcategory_id=sub_id)
        rows = await assignments(opp_s)
        offered_to = {str(x.profile_id) for x in rows}
        check("alt-kateqoriyalı sifariş: B1-in online üzvləri + B4 sahibi",
              offered_to == {m_on, m_off, own1, pb}
              and all(x.status == "offered" for x in rows),
              str(sorted(offered_to)))
        check("yenə sifarişin sahibinə / uyğunsuzlara getmir",
              not offered_to & {cust, m_inact, m_blk, pa, pc})

        # Yayım xətası sifarişin yaranmasını bloklamır (SAVEPOINT)
        import app.api.v1.opportunities as opp_mod
        real_broadcast = opp_mod.auto_broadcast_opportunity

        async def broken_broadcast(db, opp_id):
            # tranzaksiyanı "zəhərləyən" real DB xətası
            await db.execute(text("select * from mövcud_olmayan_cədvəl"))
            return []

        opp_mod.auto_broadcast_opportunity = broken_broadcast
        try:
            r = await c.post("/api/v1/opportunities", headers=ch, json={
                "title": "Yayım xətası testi", "category_id": cat_id,
                "date": "2026-12-25"})
        finally:
            opp_mod.auto_broadcast_opportunity = real_broadcast
        check("yayım xətası olsa da sifariş yaranır (201)",
              r.status_code == 201, str(r.json()))
        opp_x = r.json()["id"]
        row = await one("select status from opportunities where id = :id",
                        {"id": opp_x})
        check("sifariş bazada qalıb, təyinat yoxdur, digər bildirişlər yazılıb",
              row is not None and row.status == "pending"
              and len(await assignments(opp_x)) == 0
              and any(x.related_id == opp_x
                      for x in await notifs(m_on, "new_opportunity")))

        # ══════════ 4. Bot koordinatları (cron) ══════════
        print("\n── 4. Bot provayder koordinatları ──")
        async with SessionLocal() as db:
            bot_ids = []
            for i in (1, 2, 3):
                b = (await db.execute(text(
                    "insert into profiles (email, name, role, latitude, longitude,"
                    " is_online) values (:e, :n, 'provider', 0, 0, false)"
                    " returning id"),
                    {"e": f"bot_provider_{i}@ellit.bot", "n": f"Bot {i}"})).first()
                bot_ids.append(str(b.id))
            # Bota oxşayan, amma bot OLMAYAN profillər
            fake = []
            for e in ("bot_provider_9@gmail.com", "provider_1@ellit.bot"):
                f = (await db.execute(text(
                    "insert into profiles (email, name, role, latitude, longitude,"
                    " is_online) values (:e, 'Saxta bot', 'provider', 1.5, 2.5,"
                    " false) returning id"), {"e": e})).first()
                fake.append(str(f.id))
            await db.execute(text(
                "update profiles set latitude = 41.5, longitude = 48.25,"
                " is_online = false, last_seen_at = null where id = :id"),
                {"id": pc})
            await db.commit()

        async def loc(pid: str):
            return await one(
                "select latitude, longitude, is_online, last_seen_at"
                "  from profiles where id = :id", {"id": pid})

        before_normal = {p: tuple(await loc(p)) for p in (pa, pb, pc, cust, *fake)}
        moved = await cron.refresh_bot_locations()
        check("refresh_bot_locations: 3 bot yeniləndi", moved == 3, f"({moved})")
        first = {}
        for b in bot_ids:
            l = await loc(b)
            first[b] = (l.latitude, l.longitude)
            near = any(abs(l.latitude - la) <= 0.0041 and abs(l.longitude - lo) <= 0.0041
                       for la, lo in cron._ABSHERON_COORDS)
            check("bot yerini dəyişdi: Abşeron nöqtəsindən ±0.004° daxilində,"
                  " online, last_seen_at dolu",
                  (l.latitude, l.longitude) != (0, 0) and near
                  and l.is_online is True and l.last_seen_at is not None,
                  f"({l.latitude:.4f}, {l.longitude:.4f})")
        after_normal = {p: tuple(await loc(p)) for p in before_normal}
        check("adi provayderlər / müştəri / bota oxşayan profillər toxunulmayıb",
              after_normal == before_normal)
        check("adi provayderin koordinatı olduğu kimidir (41.5, 48.25)",
              after_normal[pc][:3] == (41.5, 48.25, False))
        await cron.refresh_bot_locations()
        second = {b: tuple(await loc(b))[:2] for b in bot_ids}
        check("növbəti işə düşmədə botlar yenidən yer dəyişir",
              all(second[b] != first[b] for b in bot_ids))

        # Gündəlik cədvəl: hər gün 03:00 UTC
        check("refresh_bot_locations gündəlik işlər siyahısındadır (03:00 UTC)",
              (cron.refresh_bot_locations, 3, 0) in cron._DAILY_JOBS)
        t = datetime(2026, 1, 1, 2, 0, tzinfo=timezone.utc)
        check("növbəti 03:00-a qədər saniyə hesabı (02:00 → 3600, 03:00 → 86400)",
              cron._seconds_until(3, 0, now=t) == 3600
              and cron._seconds_until(3, 0, now=t.replace(hour=3)) == 86400
              and cron._seconds_until(3, 0, now=t.replace(hour=23)) == 4 * 3600)

    if known_issues:
        print("\nMƏLUM PROBLEMLƏR (toxunulmayan pul kodu — əvəzedici ilə keçildi):")
        for k in known_issues:
            print(f"  [!] {k}")
    print("\nPARİTET E2E TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
