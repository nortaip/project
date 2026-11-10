"""Admin RPC-ləri — Supabase-uyğun `/rest/v1/rpc/admin_*` (app/compat/rpc_admin.py).

Admin panelin (`src/MasterAdmin`, `src/admin`) `supabase.rpc(...)` ilə çağırdığı
18 funksiyanın hər biri real marşrut üzərindən yoxlanılır:

  * icazə matrisi — anonim 401, adi istifadəçi 403, bazada rolu alınmış /
    bloklanmış admin hələ etibarlı tokenlə belə 403 / 401 (heç nə dəyişmir);
  * cavabın forması — panelin oxuduğu sahələr bir-bir;
  * yan təsirlər — balans, ledger, audit, bildiriş, sessiya ləğvi.

Təmiz bazada işə salın (DATABASE_URL/REDIS_URL env ilə):
    python3 tests/compat_rpc_admin.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Test yüzlərlə sorğu göndərir — ümumi IP limiti (120/dəq) testə mane olmasın
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import httpx  # noqa: E402

PASSWORD = "Guclu!Parol1"

RPCS = [
    "admin_credit_balance", "admin_credit_bonus", "admin_dashboard_stats",
    "admin_dashboard_daily", "admin_list_users_with_meta",
    "admin_approve_provider_request", "admin_reject_provider_request",
    "admin_set_user_role", "admin_delete_user", "admin_adjust_balance",
    "admin_companies_list", "admin_company_detail", "admin_complete_opportunity",
    "admin_approve_brigade_application", "admin_reject_brigade_application",
    "admin_kyc_list", "admin_kyc_review", "admin_update_commission",
]


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra if not cond else ''}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name} {extra}")


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def dec(v) -> Decimal:
    return Decimal(str(v))


async def main() -> None:
    from sqlalchemy import text

    from app.compat import rpc as registry
    from app.core.security import decode_token
    from app.db.session import SessionLocal, redis
    from app.main import app

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        registered: dict[str, dict] = {}

        async def register(key: str, name: str, role: str = "customer",
                           phone: str | None = None) -> dict:
            body = {"password": PASSWORD, "name": name, "role": role}
            if phone:
                body["phone"] = phone
            else:
                body["email"] = f"{key}@rpc-admin.az"
            r = await c.post("/api/v1/auth/register", json=body)
            check(f"qeydiyyat: {name}", r.status_code == 201, r.text[:160])
            u = r.json()
            u["email"] = body.get("email")
            u["name"] = name
            u["h"] = {"Authorization": f"Bearer {u['access_token']}"}
            registered[key] = u
            return u

        async def login(u: dict) -> dict:
            r = await c.post("/api/v1/auth/login",
                             json={"email": u["email"], "password": PASSWORD})
            check(f"login: {u['name']}", r.status_code == 200, r.text[:160])
            u.update(r.json())
            u["h"] = {"Authorization": f"Bearer {u['access_token']}"}
            return u["h"]

        async def rpc(name: str, args: dict | None = None,
                      headers: dict | None = None) -> httpx.Response:
            return await c.post(f"/rest/v1/rpc/{name}", json=args or {},
                                headers=headers or {})

        async def one(sql: str, **params):
            async with SessionLocal() as db:
                return (await db.execute(text(sql), params)).first()

        async def scalar(sql: str, **params):
            row = await one(sql, **params)
            return None if row is None else row[0]

        async def run(sql: str, **params):
            async with SessionLocal() as db:
                row = (await db.execute(text(sql), params))
                out = row.first() if row.returns_rows else None
                await db.commit()
                return out

        def err(r: httpx.Response, message: str, status: int = 400,
                code: str = "P0001") -> bool:
            try:
                j = r.json()
            except ValueError:
                return False
            return (r.status_code == status and j.get("code") == code
                    and j.get("message") == message
                    and set(j) == {"code", "details", "hint", "message"})

        # ══════════ 0. Reyestr ══════════
        check("18 admin RPC-nin hamısı qeydiyyatdadır",
              set(RPCS) <= set(registry.registered()),
              str(set(RPCS) - set(registry.registered())))

        # ══════════ 1. İstifadəçilər ══════════
        adm = await register("admin", "Baş Admin")
        adm2 = await register("admin2", "İkinci Admin")      # profiles üzərindən rolu alınacaq
        adm3 = await register("admin3", "Üçüncü Admin")      # yalnız users.role alınacaq
        adm4 = await register("admin4", "Dördüncü Admin")    # bloklanacaq
        adm5 = await register("admin5", "Hədəf Admin")       # silinmə hədəfi
        sup = await register("super", "Super Admin")
        cust = await register("musteri", "Test Müştəri")
        prov = await register("usta", "Test Usta", "provider")
        guard = await register("gozetci", "Gözətçi İstifadəçi")
        u_role = await register("rol", "Rol Dəyişən")
        u_req1 = await register("muraciet1", "Müraciətçi Bir")
        u_req2 = await register("muraciet2", "Müraciətçi İki")
        u_app1 = await register("briqadir1", "Briqadir Bir", "provider")
        u_app2 = await register("briqadir2", "Briqadir İki", "provider")
        u_kyc = await register("kyc", "Kamran Usta", "provider")
        u_del = await register("silinen", "Silinən İstifadəçi")
        u_goog = await register("google", "Google İstifadəçi")
        u_phone = await register("telefon", "Telefon İstifadəçi",
                                 phone="+994501112233")

        # Admin: users.role VƏ profiles.role (sonra yenidən login — JWT-də rol var)
        async with SessionLocal() as db:
            for u in (adm, adm2, adm3, adm4, adm5, sup):
                await db.execute(text("update profiles set role='admin' where id=:id"),
                                 {"id": u["user_id"]})
                await db.execute(text("update users set role='admin' where id=:id"),
                                 {"id": u["user_id"]})
            # superadmin yalnız users.role-da mövcuddur (profiles_role_check)
            await db.execute(text("update users set role='superadmin' where id=:id"),
                             {"id": sup["user_id"]})
            await db.execute(text(
                "update users set user_metadata = cast(:m as jsonb) where id=:id"),
                {"m": '{"full_name": "Google İstifadəçi", "avatar_url": "https://x/a.png"}',
                 "id": u_goog["user_id"]})
            await db.execute(text(
                "insert into oauth_identities (id, user_id, provider, provider_sub)"
                " values (gen_random_uuid(), :u, 'google', 'g-sub-1')"),
                {"u": u_goog["user_id"]})
            await db.commit()
        ah = await login(adm)
        a2h = await login(adm2)
        a3h = await login(adm3)
        a4h = await login(adm4)
        await login(adm5)
        sh = await login(sup)
        check("admin tokeni admin rolunu daşıyır",
              decode_token(adm["access_token"], "access")["role"] == "admin")
        check("superadmin tokeni superadmin rolunu daşıyır",
              decode_token(sup["access_token"], "access")["role"] == "superadmin")

        # ══════════ 2. Seed: kateqoriya, konfiq, gözətçi qeydləri ══════════
        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "insert into service_categories (label) values ('Santexnik')"
                " returning id"))).first()
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'),"
                " ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '0'),"
                " ('commission_on_withdrawal', '2')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text("update profiles set balance = 500 where id = :id"),
                             {"id": cust["user_id"]})
            await db.execute(text(
                "update profiles set is_verified = true,"
                " last_kyc_approved_at = now(), balance = 50 where id = :id"),
                {"id": prov["user_id"]})
            # Gözətçi: icazə matrisində hər RPC-yə REAL hədəf verilir ki,
            # yoxlama sınsa nəyinsə dəyişdiyi dərhal görünsün
            g = guard["user_id"]
            g_req = (await db.execute(text(
                "insert into provider_requests (user_id, message, company_name)"
                " values (:u, 'gözətçi', 'Gözətçi MMC') returning id"), {"u": g})).first()
            g_app = (await db.execute(text(
                "insert into brigade_applications (applicant_id, name)"
                " values (:u, 'Gözətçi Briqada') returning id"), {"u": g})).first()
            g_brig = (await db.execute(text(
                "insert into brigades (owner_id, name) values (:u, 'Alfa Qrup')"
                " returning id"), {"u": g})).first()
            g_opp = (await db.execute(text(
                "insert into opportunities (title, created_by, date, status)"
                " values ('Gözətçi sifarişi', :u, current_date, 'accepted')"
                " returning id"), {"u": g})).first()
            g_kyc = (await db.execute(text(
                "insert into provider_verifications (provider_id, id_front_path,"
                " id_back_path, selfie_path) values (:u, 'g/f.jpg', 'g/b.jpg',"
                " 'g/s.jpg') returning id"), {"u": g})).first()
            await db.commit()
            cat_id = str(cat.id)
        g_req, g_app, g_brig, g_opp, g_kyc = (
            str(x.id) for x in (g_req, g_app, g_brig, g_opp, g_kyc))

        # ══════════ 3. İcazə matrisi (18 RPC × 7 çağıran) ══════════
        guard_args = {
            "admin_credit_balance": {"p_target_user_id": cust["user_id"],
                                     "p_amount": 1, "p_reason": "icazəsiz"},
            "admin_credit_bonus": {"p_target_user_id": prov["user_id"],
                                   "p_amount": 1, "p_reason": "icazəsiz"},
            "admin_dashboard_stats": {},
            "admin_dashboard_daily": {"p_days": 14},
            "admin_list_users_with_meta": {},
            "admin_approve_provider_request": {"p_request_id": g_req, "p_note": None},
            "admin_reject_provider_request": {"p_request_id": g_req,
                                              "p_reason": "icazəsiz"},
            "admin_set_user_role": {"p_target_user_id": guard["user_id"],
                                    "p_new_role": "admin"},
            "admin_delete_user": {"p_user_id": guard["user_id"]},
            "admin_adjust_balance": {"p_user_id": cust["user_id"], "p_amount": 1,
                                     "p_reason": "icazəsiz", "p_target": "balance"},
            "admin_companies_list": {},
            "admin_company_detail": {"p_brigade_id": g_brig},
            "admin_complete_opportunity": {"p_opportunity_id": g_opp},
            "admin_approve_brigade_application": {"p_application_id": g_app,
                                                  "p_note": None},
            "admin_reject_brigade_application": {"p_application_id": g_app,
                                                 "p_reason": "icazəsiz"},
            "admin_kyc_list": {"p_status": "pending"},
            "admin_kyc_review": {"p_id": g_kyc, "p_approve": True,
                                 "p_reason": None, "p_notes": None},
            "admin_update_commission": {"p_key": "commission_on_withdrawal",
                                        "p_value": 77},
        }
        check("matris bütün RPC-ləri əhatə edir", set(guard_args) == set(RPCS))

        async def fingerprint() -> str:
            return await scalar(
                "select jsonb_build_object("
                " 'guard_profile', (select jsonb_build_array(role, status, balance)"
                "     from profiles where id = :g),"
                " 'guard_user', (select jsonb_build_array(role, is_active)"
                "     from users where id = :g),"
                " 'cust_balance', (select balance from profiles where id = :c),"
                " 'prov_bonus', (select bonus_balance from provider_wallets"
                "     where provider_id = :p),"
                " 'req', (select status from provider_requests where id = :req),"
                " 'app', (select status from brigade_applications where id = :app),"
                " 'opp', (select status from opportunities where id = :opp),"
                " 'kyc', (select status from provider_verifications where id = :kyc),"
                " 'cfg', (select value from platform_config"
                "     where key = 'commission_on_withdrawal'),"
                " 'brigades', (select count(*) from brigades),"
                " 'audit', (select count(*) from audit_log),"
                " 'tx', (select count(*) from transactions),"
                " 'notif', (select count(*) from notifications))::text",
                g=guard["user_id"], c=cust["user_id"], p=prov["user_id"],
                req=g_req, app=g_app, opp=g_opp, kyc=g_kyc)

        fp0 = await fingerprint()

        async def deny_all(label: str, headers: dict, status: int,
                           code: str | None = None) -> None:
            bad = []
            for name in RPCS:
                r = await rpc(name, guard_args[name], headers)
                body_code = None
                try:
                    body_code = r.json().get("code")
                except (ValueError, AttributeError):
                    pass
                if r.status_code != status or (code and body_code != code):
                    bad.append(f"{name}→{r.status_code}/{body_code}")
            check(f"{label}: 18 RPC-nin hamısı {status}", not bad, ", ".join(bad))
            check(f"{label}: bazada heç nə dəyişmədi", await fingerprint() == fp0)

        await deny_all("anonim (tokensiz)", {}, 401, "42501")
        await deny_all("anonim (klientin anon açarı ilə)",
                       {"Authorization": "Bearer sb-anon-key-deyil-jwt",
                        "apikey": "sb-anon-key-deyil-jwt"}, 401, "42501")
        await deny_all("adi müştəri", cust["h"], 403, "42501")
        await deny_all("adi usta (provider)", prov["h"], 403, "42501")

        # Rolu alınmış admin: token hələ etibarlıdır və 'admin' deyir
        r = await rpc("admin_dashboard_stats", {}, a2h)
        check("ikinci admin rol alınmazdan əvvəl işləyir", r.status_code == 200)
        r = await rpc("admin_dashboard_stats", {}, a3h)
        check("üçüncü admin rol alınmazdan əvvəl işləyir", r.status_code == 200)
        r = await rpc("admin_dashboard_stats", {}, a4h)
        check("dördüncü admin bloklanmazdan əvvəl işləyir", r.status_code == 200)
        async with SessionLocal() as db:
            # (a) panel yolu ilə: profiles.role dəyişir → trigger users.role-u sinxronlayır
            await db.execute(text("update profiles set role='customer' where id=:id"),
                             {"id": adm2["user_id"]})
            # (b) yalnız users.role (profiles.role hələ 'admin')
            await db.execute(text("update users set role='customer' where id=:id"),
                             {"id": adm3["user_id"]})
            # (c) hesab bloklanıb
            await db.execute(text("update users set is_active=false where id=:id"),
                             {"id": adm4["user_id"]})
            await db.commit()
        check("(a) users.role da 'customer' oldu (trigger)",
              await scalar("select role from users where id=:id",
                           id=adm2["user_id"]) == "customer")
        check("(b) profiles.role hələ 'admin'dir",
              await scalar("select role from profiles where id=:id",
                           id=adm3["user_id"]) == "admin")
        for h in (a2h, a3h, a4h):
            tok = h["Authorization"][7:]
            check("köhnə token hələ etibarlıdır və admin rolu daşıyır",
                  decode_token(tok, "access")["role"] == "admin")
        fp0 = await fingerprint()
        await deny_all("rolu alınmış admin (profiles.role)", a2h, 403, "42501")
        await deny_all("rolu alınmış admin (yalnız users.role)", a3h, 403, "42501")
        await deny_all("bloklanmış admin (is_active=false)", a4h, 401)

        # Reyestr səviyyəsi: yanlış / çatışmayan arqument → PGRST202
        r = await rpc("admin_dashboard_daily", {"days": 3}, ah)
        check("naməlum arqument → 404 PGRST202",
              r.status_code == 404 and r.json()["code"] == "PGRST202")
        r = await rpc("admin_set_user_role", {"p_target_user_id": guard["user_id"]}, ah)
        check("çatışmayan arqument → 404 PGRST202",
              r.status_code == 404 and r.json()["code"] == "PGRST202")
        r = await rpc("admin_company_detail", {"p_brigade_id": "uuid-deyil"}, ah)
        check("yanlış uuid → 400 22P02",
              r.status_code == 400 and r.json()["code"] == "22P02", r.text)
        check("uğursuz çağırışlar heç nə dəyişmədi", await fingerprint() == fp0)

        # ══════════ 4. admin_complete_opportunity ══════════
        # 4a. Kartla qəbul edilmiş sifariş → təsdiq escrow-nu açır
        r = await c.post("/api/v1/opportunities", headers=cust["h"], json={
            "title": "Kran sızır", "description": "Mətbəxdə kran dəyişimi",
            "category_id": cat_id, "date": "2026-12-15",
            "location": "40.4093, 49.8671", "latitude": 40.4093,
            "longitude": 49.8671})
        check("sifariş yaradıldı", r.status_code == 201, r.text[:160])
        opp1 = r.json()["id"]
        r = await c.post("/api/v1/offers", headers=prov["h"], json={
            "opportunity_id": opp1, "amount": "100.00"})
        check("təklif verildi", r.status_code == 201, r.text[:160])
        offer1 = r.json()["id"]
        r = await c.post(f"/api/v1/offers/{offer1}/accept", headers=cust["h"],
                         json={"method": "card"})
        check("kartla qəbul (escrow 90 ₼)", r.status_code == 200, r.text[:160])
        w = await one("select locked_balance from provider_wallets"
                      " where provider_id=:p", p=prov["user_id"])
        check("escrow kilidi 90 ₼", Decimal(w.locked_balance) == 90)
        n_cust0 = await scalar(
            "select count(*) from notifications where user_id=:u"
            " and type='status_completed'", u=cust["user_id"])

        r = await rpc("admin_complete_opportunity", {"p_opportunity_id": opp1}, ah)
        check("admin_complete_opportunity → 200 'completed' (JSON sətri)",
              r.status_code == 200 and r.json() == "completed", r.text[:200])
        st = await one(
            "select o.status, o.completed_at, oo.status as offer_status,"
            " oo.escrow_released_at, oo.admin_approved_by"
            " from opportunities o join opportunities_offers oo"
            "   on oo.id = o.accepted_offer_id where o.id=:id", id=opp1)
        check("sifariş completed + completed_at",
              st.status == "completed" and st.completed_at is not None)
        check("təklif completed, admin təsdiqi qeyd olunub",
              st.offer_status == "completed" and st.escrow_released_at is not None
              and str(st.admin_approved_by) == adm["user_id"])
        pb = await one("select balance from profiles where id=:p", p=prov["user_id"])
        w = await one("select locked_balance from provider_wallets"
                      " where provider_id=:p", p=prov["user_id"])
        check("escrow açıldı: usta balansı 50 + 85.50 (90 − 5%)",
              Decimal(pb.balance) == Decimal("135.50"), str(pb.balance))
        check("escrow boşaldı", Decimal(w.locked_balance) == 0)
        check("ledger: escrow_release 85.50",
              await scalar("select amount from transactions where related_id=:r"
                           " and type='escrow_release'", r=offer1) == Decimal("85.50"))
        check("müştəriyə 'İş tamamlandı' bildirişi",
              await scalar(
                  "select count(*) from notifications where user_id=:u"
                  " and type='status_completed' and related_id=:r"
                  " and title='İş tamamlandı'",
                  u=cust["user_id"], r=opp1) == 1 and n_cust0 == 0)
        check("ustaya ödəniş bildirişi (offer_completed)",
              await scalar(
                  "select count(*) from notifications where user_id=:u"
                  " and type='offer_completed' and related_id=:r",
                  u=prov["user_id"], r=offer1) == 1)
        check("status tarixçəsi aktyoru admin kimi yazıb",
              await scalar(
                  "select count(*) from opportunity_audit_log where opportunity_id=:o"
                  " and new_status='completed' and actor_id=:a",
                  o=opp1, a=adm["user_id"]) == 1)

        r = await rpc("admin_complete_opportunity", {"p_opportunity_id": opp1}, ah)
        check("təkrar çağırış → 'already_completed'",
              r.status_code == 200 and r.json() == "already_completed")
        check("təkrar çağırış pul köçürmədi",
              await scalar("select balance from profiles where id=:p",
                           p=prov["user_id"]) == Decimal("135.50"))

        # 4b. Qəbul edilmiş təklifi olmayan sifariş → yalnız status
        opp2 = str((await run(
            "insert into opportunities (title, created_by, provider_id, date, status)"
            " values ('Təklifsiz iş', :u, :p, current_date, 'ongoing') returning id",
            u=cust["user_id"], p=u_kyc["user_id"])).id)
        r = await rpc("admin_complete_opportunity", {"p_opportunity_id": opp2}, ah)
        check("təklifsiz sifariş → 'completed'",
              r.status_code == 200 and r.json() == "completed", r.text[:200])
        st = await one("select status, completed_at from opportunities where id=:id",
                       id=opp2)
        check("status completed + completed_at",
              st.status == "completed" and st.completed_at is not None)
        check("hər iki tərəfə status bildirişi",
              await scalar(
                  "select count(distinct user_id) from notifications"
                  " where type='status_completed' and related_id=:r", r=opp2) == 2)

        # 4c. Təsdiq gözləməyən / mövcud olmayan sifariş
        r = await c.post("/api/v1/opportunities", headers=cust["h"], json={
            "title": "Hələ təklif yoxdur", "description": "gözləyir",
            "category_id": cat_id, "date": "2026-12-20",
            "location": "40.4, 49.8", "latitude": 40.4, "longitude": 49.8})
        opp3 = r.json()["id"]
        st3 = await scalar("select status from opportunities where id=:id", id=opp3)
        r = await rpc("admin_complete_opportunity", {"p_opportunity_id": opp3}, ah)
        check("gözləyən sifariş → SQL xəta mətni",
              err(r, f"Order is not awaiting approval (status: {st3})"), r.text)
        check("gözləyən sifarişin statusu dəyişmədi",
              await scalar("select status from opportunities where id=:id",
                           id=opp3) == st3)
        r = await rpc("admin_complete_opportunity",
                      {"p_opportunity_id": str(uuid.uuid4())}, ah)
        check("naməlum sifariş → 'Opportunity not found'",
              err(r, "Opportunity not found"), r.text)

        # ══════════ 5. admin_dashboard_stats / admin_dashboard_daily ══════════
        async with SessionLocal() as db:
            await db.execute(text(
                "insert into bookings (customer_id, provider_id, status, date, time,"
                " total_amount) values"
                " (:c, :p, 'pending', current_date, '10:00', 30),"
                " (:c, :p, 'completed', current_date, '11:00', 45)"),
                {"c": cust["user_id"], "p": prov["user_id"]})
            await db.execute(text(
                "insert into withdrawals (provider_id, amount_requested,"
                " commission_percent, commission_amount, net_amount, status)"
                " values (:p, 40, 2, 0.80, 39.20, 'pending')"),
                {"p": prov["user_id"]})
            await db.commit()
        n_users = len(registered)
        n_providers = sum(1 for k in ("usta", "briqadir1", "briqadir2", "kyc"))
        r = await rpc("admin_dashboard_stats", {}, ah)
        s = r.json()
        stat_keys = {
            "totalUsers", "newUsers7d", "totalProviders", "totalBookings",
            "pendingBookings", "completedBookings", "totalBrigades",
            "activeOpportunities", "totalOpportunities", "gmv7d", "gmv30d",
            "completedPayments30d", "acceptCommission", "completeCommission",
            "withdrawalCommission", "platformRevenue30d",
            "pendingWithdrawalsAmount", "pendingWithdrawalsCount"}
        check("dashboard_stats: 200 + obyekt", r.status_code == 200
              and isinstance(s, dict), r.text[:200])
        check("dashboard_stats: panelin oxuduğu 18 açarın hamısı",
              set(s) == stat_keys, str(set(s) ^ stat_keys))
        check("dashboard_stats: bütün dəyərlər JSON ədədidir",
              all(is_num(v) for v in s.values()), str(s))
        check("totalUsers / newUsers7d",
              s["totalUsers"] == n_users and s["newUsers7d"] == n_users, str(s))
        check("totalProviders", s["totalProviders"] == n_providers, str(s))
        check("bookings: 2 ümumi, 1 pending, 1 completed",
              (s["totalBookings"], s["pendingBookings"], s["completedBookings"])
              == (2, 1, 1), str(s))
        check("totalBrigades", s["totalBrigades"] == 1, str(s))
        # gözətçi (accepted) + opp3 (pending) aktivdir; opp1, opp2 tamamlanıb
        check("opportunities: 4 ümumi, 2 aktiv",
              (s["totalOpportunities"], s["activeOpportunities"]) == (4, 2), str(s))
        check("GMV 7g/30g = 100, 1 ödəniş",
              dec(s["gmv7d"]) == 100 and dec(s["gmv30d"]) == 100
              and s["completedPayments30d"] == 1, str(s))
        check("qəbul komissiyası 10 (100 − 90)", dec(s["acceptCommission"]) == 10, str(s))
        check("tamamlama komissiyası 4.5 (90 − 85.5)",
              dec(s["completeCommission"]) == Decimal("4.5"), str(s))
        check("çıxarış komissiyası 0.8, gözləyən 40 ₼ / 1 sorğu",
              dec(s["withdrawalCommission"]) == Decimal("0.8")
              and dec(s["pendingWithdrawalsAmount"]) == 40
              and s["pendingWithdrawalsCount"] == 1, str(s))
        check("platformRevenue30d = 10 + 4.5 + 0.8",
              dec(s["platformRevenue30d"]) == Decimal("15.3"), str(s))

        today = str(await scalar("select current_date"))
        first_day = str(await scalar("select current_date - 13"))
        r = await rpc("admin_dashboard_daily", {"p_days": 14}, ah)
        d = r.json()
        check("dashboard_daily: 200 + 14 sətirlik massiv",
              r.status_code == 200 and isinstance(d, list) and len(d) == 14, r.text[:200])
        check("dashboard_daily: hər sətir {d, gmv, revenue}",
              all(set(x) == {"d", "gmv", "revenue"} for x in d))
        check("dashboard_daily: d — 'YYYY-MM-DD', artan sıra, bu gün sonuncu",
              d[0]["d"] == first_day and d[-1]["d"] == today
              and [x["d"] for x in d] == sorted(x["d"] for x in d), str(d[-1]))
        check("dashboard_daily: gmv/revenue JSON ədədidir",
              all(is_num(x["gmv"]) and is_num(x["revenue"]) for x in d))
        check("dashboard_daily: bu gün gmv 100, gəlir 10.8 (10 + 0.8)",
              dec(d[-1]["gmv"]) == 100 and dec(d[-1]["revenue"]) == Decimal("10.8"),
              str(d[-1]))
        check("dashboard_daily: əvvəlki günlər sıfırdır",
              all(dec(x["gmv"]) == 0 and dec(x["revenue"]) == 0 for x in d[:-1]))
        r = await rpc("admin_dashboard_daily", {}, ah)
        check("dashboard_daily: p_days defoltu 14", len(r.json()) == 14)
        r = await rpc("admin_dashboard_daily", {"p_days": 3}, ah)
        check("dashboard_daily: p_days=3 → 3 sətir", len(r.json()) == 3)
        r = await c.get("/rest/v1/rpc/admin_dashboard_daily?p_days=5", headers=ah)
        check("dashboard_daily: GET ?p_days=5 → 5 sətir",
              r.status_code == 200 and len(r.json()) == 5, r.text[:200])

        # ══════════ 6. admin_list_users_with_meta ══════════
        r = await rpc("admin_list_users_with_meta", {}, ah)
        users = r.json()
        user_keys = {
            "id", "name", "email", "phone_number", "avatar_url", "role",
            "is_active", "created_at", "auth_email", "auth_meta", "provider",
            "status", "is_verified", "balance", "address", "rating"}
        check("users_with_meta: 200 + massiv", r.status_code == 200
              and isinstance(users, list), r.text[:200])
        check("users_with_meta: bütün istifadəçilər", len(users) == n_users,
              f"{len(users)} != {n_users}")
        check("users_with_meta: sətir sütunları", all(set(u) == user_keys for u in users),
              str(set(users[0]) ^ user_keys))
        by_id = {u["id"]: u for u in users}
        cu = by_id[cust["user_id"]]
        check("müştəri sətri: id/name/email/role/auth_email",
              cu["name"] == "Test Müştəri" and cu["email"] == cust["email"]
              and cu["auth_email"] == cust["email"] and cu["role"] == "customer", str(cu))
        check("müştəri sətri: is_active true, provider 'email', auth_meta obyekt",
              cu["is_active"] is True and cu["provider"] == "email"
              and cu["auth_meta"] == {}, str(cu))
        check("müştəri sətri: status/is_verified/balance (səhifə oxuyur)",
              cu["status"] == "active" and cu["is_verified"] is False
              and is_num(cu["balance"]) and dec(cu["balance"]) == 400, str(cu))
        check("created_at ISO vaxtdır, siyahı yenidən köhnəyə sıralıdır",
              isinstance(cu["created_at"], str) and "T" in cu["created_at"]
              and [u["created_at"] for u in users]
              == sorted((u["created_at"] for u in users), reverse=True))
        gu = by_id[u_goog["user_id"]]
        check("OAuth istifadəçisi: provider 'google' + metadata",
              gu["provider"] == "google"
              and gu["auth_meta"] == {"full_name": "Google İstifadəçi",
                                      "avatar_url": "https://x/a.png"}, str(gu))
        pu = by_id[u_phone["user_id"]]
        check("telefonla qeydiyyat: provider 'phone', auth_email null",
              pu["provider"] == "phone" and pu["auth_email"] is None, str(pu))
        check("admin sətri: role 'admin'", by_id[adm["user_id"]]["role"] == "admin")
        check("bloklanmış hesab: is_active false",
              by_id[adm4["user_id"]]["is_active"] is False)

        # ══════════ 7. admin_adjust_balance ══════════
        b0 = Decimal(await scalar("select balance from profiles where id=:u",
                                  u=cust["user_id"]))
        tx0 = await scalar("select count(*) from transactions")
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": 50.25,
            "p_reason": "Test səbəbi", "p_target": "balance"}, ah)
        check("adjust_balance: 200 + çılpaq JSON ədədi (yeni balans)",
              r.status_code == 200 and is_num(r.json())
              and dec(r.json()) == b0 + Decimal("50.25"), r.text[:200])
        check("müştəri balansı +50.25",
              await scalar("select balance from profiles where id=:u",
                           u=cust["user_id"]) == b0 + Decimal("50.25"))
        tx = await one(
            "select type, amount, balance_after, description, created_by"
            " from transactions where user_id=:u and type='admin_adjust'"
            " order by created_at desc limit 1", u=cust["user_id"])
        check("ledger: admin_adjust sətri",
              tx.amount == Decimal("50.25") and tx.balance_after == b0 + Decimal("50.25")
              and tx.description == "Admin düzəlişi (balance): Test səbəbi"
              and str(tx.created_by) == adm["user_id"], str(tx))
        au = await one(
            "select actor_id, actor, payload from audit_log"
            " where action='balance_adjust' and target_id=:t"
            " order by created_at desc limit 1", t=cust["user_id"])
        check("audit: balance_adjust (aktyor + payload)",
              str(au.actor_id) == adm["user_id"] and str(au.actor) == adm["user_id"]
              and au.payload["target"] == "balance" and au.payload["reason"] == "Test səbəbi"
              and dec(au.payload["amount"]) == Decimal("50.25"), str(au))
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": -0.25, "p_reason": "geri"}, ah)
        check("adjust_balance: p_target defoltu 'balance', mənfi məbləğ azaldır",
              r.status_code == 200 and dec(r.json()) == b0 + 50, r.text[:200])
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": 5, "p_reason": "bonus",
            "p_target": "bonus"}, ah)
        check("adjust_balance: müştəri bonusu → profiles.bonus_balance",
              r.status_code == 200 and dec(r.json()) == 5
              and await scalar("select bonus_balance from profiles where id=:u",
                               u=cust["user_id"]) == 5, r.text[:200])
        wl0 = await one("select balance, bonus_balance, locked_balance"
                        " from provider_wallets where provider_id=:p", p=prov["user_id"])
        r = await rpc("admin_adjust_balance", {
            "p_user_id": prov["user_id"], "p_amount": 10, "p_reason": "kilid",
            "p_target": "locked"}, ah)
        check("adjust_balance: usta 'locked' → provider_wallets.locked_balance",
              r.status_code == 200 and dec(r.json()) == wl0.locked_balance + 10
              and await scalar("select locked_balance from provider_wallets"
                               " where provider_id=:p", p=prov["user_id"])
              == wl0.locked_balance + 10, r.text[:200])
        r = await rpc("admin_adjust_balance", {
            "p_user_id": prov["user_id"], "p_amount": 20, "p_reason": "cüzdan",
            "p_target": "balance"}, ah)
        check("adjust_balance: usta 'balance' → provider_wallets.balance",
              r.status_code == 200 and dec(r.json()) == wl0.balance + 20, r.text[:200])

        fp_bal = await scalar(
            "select jsonb_build_array((select balance from profiles where id=:u),"
            " (select count(*) from transactions),"
            " (select count(*) from audit_log))::text", u=cust["user_id"])
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": 0, "p_reason": "x"}, ah)
        check("adjust_balance: sıfır → 'Amount cannot be zero / null'",
              err(r, "Amount cannot be zero / null"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": None, "p_reason": "x"}, ah)
        check("adjust_balance: null → 'Amount cannot be zero / null'",
              err(r, "Amount cannot be zero / null"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": 1, "p_reason": "x",
            "p_target": "gold"}, ah)
        check("adjust_balance: yanlış hədəf",
              err(r, "Invalid target (must be balance | bonus | locked)"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": 1, "p_reason": "x",
            "p_target": "locked"}, ah)
        check("adjust_balance: müştəriyə 'locked' olmaz",
              err(r, "locked balance applies only to providers"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": -100000, "p_reason": "x"}, ah)
        check("adjust_balance: mənfi nəticə rədd olunur",
              err(r, "Result would be negative balance"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": str(uuid.uuid4()), "p_amount": 1, "p_reason": "x"}, ah)
        check("adjust_balance: naməlum istifadəçi → 'User not found'",
              err(r, "User not found"), r.text)
        r = await rpc("admin_adjust_balance", {
            "p_user_id": cust["user_id"], "p_amount": "çox", "p_reason": "x"}, ah)
        check("adjust_balance: ədəd olmayan məbləğ → 22P02",
              r.status_code == 400 and r.json()["code"] == "22P02", r.text)
        check("rədd edilən düzəlişlər balansı/ledger-i/auditi dəyişmədi",
              await scalar(
                  "select jsonb_build_array((select balance from profiles where id=:u),"
                  " (select count(*) from transactions),"
                  " (select count(*) from audit_log))::text",
                  u=cust["user_id"]) == fp_bal)
        check("ledger-ə yalnız uğurlu 5 düzəliş yazıldı",
              await scalar("select count(*) from transactions") == tx0 + 5)

        # ══════════ 8. admin_credit_bonus ══════════
        bon0 = Decimal(await scalar(
            "select bonus_balance from provider_wallets where provider_id=:p",
            p=prov["user_id"]))
        r = await rpc("admin_credit_bonus", {
            "p_target_user_id": prov["user_id"], "p_amount": 7.5,
            "p_reason": "Bid refund (offer x)"}, ah)
        check("credit_bonus: 200 + çılpaq JSON ədədi (yeni bonus)",
              r.status_code == 200 and is_num(r.json())
              and dec(r.json()) == bon0 + Decimal("7.5"), r.text[:200])
        check("cüzdan bonusu +7.5",
              await scalar("select bonus_balance from provider_wallets"
                           " where provider_id=:p", p=prov["user_id"])
              == bon0 + Decimal("7.5"))
        au = await one(
            "select actor_id, target_type, payload from audit_log"
            " where action='admin_bonus_adjust' and target_id=:t", t=prov["user_id"])
        check("audit: admin_bonus_adjust",
              au is not None and str(au.actor_id) == adm["user_id"]
              and au.target_type == "wallet"
              and dec(au.payload["new_bonus"]) == bon0 + Decimal("7.5"), str(au))
        r = await rpc("admin_credit_bonus", {
            "p_target_user_id": u_role["user_id"], "p_amount": 3, "p_reason": "ilk"}, ah)
        check("credit_bonus: cüzdanı olmayana cüzdan yaradır",
              r.status_code == 200 and dec(r.json()) == 3, r.text[:200])
        r = await rpc("admin_credit_bonus", {
            "p_target_user_id": prov["user_id"], "p_amount": 0, "p_reason": "x"}, ah)
        check("credit_bonus: sıfır → 'Amount must be non-zero'",
              err(r, "Amount must be non-zero"), r.text)
        r = await rpc("admin_credit_bonus", {
            "p_target_user_id": str(uuid.uuid4()), "p_amount": 1, "p_reason": "x"}, ah)
        check("credit_bonus: naməlum istifadəçi → FK xətası 409 / 23503",
              r.status_code == 409 and r.json()["code"] == "23503", r.text)

        # ══════════ 9. admin_credit_balance ══════════
        r = await rpc("admin_credit_balance", {
            "p_target_user_id": cust["user_id"], "p_amount": 0, "p_reason": "x"}, ah)
        check("credit_balance: sıfır → 'Amount must be non-zero'",
              err(r, "Amount must be non-zero"), r.text)
        r = await rpc("admin_credit_balance", {
            "p_target_user_id": str(uuid.uuid4()), "p_amount": 5, "p_reason": "x"}, ah)
        check("credit_balance: naməlum istifadəçi → 'User not found'",
              err(r, "User not found"), r.text)
        # MƏLUM QÜSUR (köhnə SQL funksiyasında da eynidir): ledger növü
        # 'admin_credit'/'admin_debit' `transactions_type_check`-də yoxdur, ona görə
        # düzgün çağırış da check pozuntusu ilə bitir və balans DƏYİŞMİR. Pul
        # məntiqi qəsdən düzəldilməyib (bax: hesabat) — məhdudiyyət və ya ledger
        # növü dəyişdirilərsə bu yoxlamalar yenilənməlidir.
        cb0 = await scalar("select balance from profiles where id=:u", u=cust["user_id"])
        r = await rpc("admin_credit_balance", {
            "p_target_user_id": cust["user_id"], "p_amount": 25,
            "p_reason": "Admin adjustment"}, ah)
        check("credit_balance: düzgün çağırış → 400 / 23514 (transactions_type_check)",
              r.status_code == 400 and r.json()["code"] == "23514"
              and "transactions_type_check" in r.json()["message"], r.text[:300])
        check("credit_balance: xətadan sonra balans dəyişmədi, audit yazılmadı",
              await scalar("select balance from profiles where id=:u",
                           u=cust["user_id"]) == cb0
              and await scalar("select count(*) from audit_log"
                               " where action='admin_balance_adjust'") == 0)

        # ══════════ 10. admin_set_user_role ══════════
        r = await rpc("admin_set_user_role", {
            "p_target_user_id": u_role["user_id"], "p_new_role": "provider"}, ah)
        check("set_user_role: 204 (void)", r.status_code == 204 and r.content == b"",
              r.text[:200])
        rr = await one("select (select role from profiles where id=:u) as p,"
                       " (select role from users where id=:u) as u", u=u_role["user_id"])
        check("rol hər İKİ sütunda dəyişdi (profiles + users)",
              rr.p == "provider" and rr.u == "provider", str(rr))
        h_role = await login(u_role)
        check("yeni login yeni rolu daşıyır",
              decode_token(h_role["Authorization"][7:], "access")["role"] == "provider")
        r = await rpc("admin_set_user_role", {
            "p_target_user_id": u_role["user_id"], "p_new_role": "admin"}, ah)
        rr = await one("select (select role from profiles where id=:u) as p,"
                       " (select role from users where id=:u) as u", u=u_role["user_id"])
        check("admin roluna yüksəltmə (hər iki sütun)",
              r.status_code == 204 and rr.p == "admin" and rr.u == "admin", str(rr))
        r = await rpc("admin_set_user_role", {
            "p_target_user_id": u_role["user_id"], "p_new_role": "customer"}, ah)
        rr = await one("select (select role from profiles where id=:u) as p,"
                       " (select role from users where id=:u) as u", u=u_role["user_id"])
        check("geri customer (hər iki sütun)",
              r.status_code == 204 and rr.p == "customer" and rr.u == "customer", str(rr))
        check("audit: 3 role_change qeydi",
              await scalar("select count(*) from audit_log where action='role_change'"
                           " and target_id=:t and actor_id=:a",
                           t=u_role["user_id"], a=adm["user_id"]) == 3)
        r = await rpc("admin_set_user_role", {
            "p_target_user_id": u_role["user_id"], "p_new_role": "superadmin"}, ah)
        check("set_user_role: icazəsiz rol → 'Invalid role: superadmin'",
              err(r, "Invalid role: superadmin"), r.text)
        r = await rpc("admin_set_user_role", {
            "p_target_user_id": sup["user_id"], "p_new_role": "customer"}, ah)
        check("set_user_role: admin superadmini endirə bilməz",
              err(r, "Forbidden: only superadmin can change a master/superadmin role"),
              r.text)
        rr = await one("select (select role from profiles where id=:u) as p,"
                       " (select role from users where id=:u) as u", u=sup["user_id"])
        check("superadminin rolları toxunulmaz qaldı",
              rr.p == "admin" and rr.u == "superadmin", str(rr))

        # ══════════ 11. admin_approve / reject_provider_request ══════════
        r = await c.post("/api/v1/profiles/provider-request", headers=u_req1["h"], json={
            "message": "Usta olmaq istəyirəm", "company_name": "Şirkət MMC",
            "experience_years": 7, "specialties": ["santexnik"]})
        check("provayder müraciəti göndərildi", r.status_code == 201, r.text[:160])
        req1 = r.json()["id"]
        r = await c.post("/api/v1/profiles/provider-request", headers=u_req2["h"],
                         json={"message": "Mən də"})
        req2 = r.json()["id"]

        r = await rpc("admin_approve_provider_request",
                      {"p_request_id": req1, "p_note": None}, ah)
        check("approve_provider_request: 204 (void)",
              r.status_code == 204 and r.content == b"", r.text[:200])
        q = await one("select status, decided_by, decided_at, admin_note"
                      " from provider_requests where id=:id", id=req1)
        check("müraciət approved, qərar verən admin",
              q.status == "approved" and str(q.decided_by) == adm["user_id"]
              and q.decided_at is not None and q.admin_note is None, str(q))
        p = await one("select p.role, p.company_name, p.experience_years, p.specialties,"
                      " u.role as urole from profiles p join users u on u.id = p.id"
                      " where p.id=:u", u=u_req1["user_id"])
        check("profil provayder oldu (hər iki rol sütunu) + müraciət sahələri köçdü",
              p.role == "provider" and p.urole == "provider"
              and p.company_name == "Şirkət MMC" and p.experience_years == 7
              and p.specialties == ["santexnik"], str(p))
        check("müraciətçiyə bildiriş (provider_approved)",
              await scalar("select count(*) from notifications where user_id=:u"
                           " and type='provider_approved' and related_id=:r",
                           u=u_req1["user_id"], r=req1) == 1)
        r = await rpc("admin_approve_provider_request",
                      {"p_request_id": req1, "p_note": "təkrar"}, ah)
        check("təkrar təsdiq → 'Request already approved'",
              err(r, "Request already approved"), r.text)
        r = await rpc("admin_approve_provider_request",
                      {"p_request_id": str(uuid.uuid4())}, ah)
        check("naməlum müraciət → 'Request not found'",
              err(r, "Request not found"), r.text)

        r = await rpc("admin_reject_provider_request",
                      {"p_request_id": req2, "p_reason": "Sənədlər natamamdır"}, ah)
        check("reject_provider_request: 204 (void)",
              r.status_code == 204 and r.content == b"", r.text[:200])
        q = await one("select status, decided_by, admin_note from provider_requests"
                      " where id=:id", id=req2)
        check("müraciət rejected, səbəb admin_note-da",
              q.status == "rejected" and str(q.decided_by) == adm["user_id"]
              and q.admin_note == "Sənədlər natamamdır", str(q))
        check("rədd edilənin rolu dəyişmədi",
              await scalar("select role from profiles where id=:u",
                           u=u_req2["user_id"]) == "customer")
        check("müraciətçiyə bildiriş (səbəb mətni ilə)",
              await scalar("select body from notifications where user_id=:u"
                           " and type='provider_rejected' and related_id=:r",
                           u=u_req2["user_id"], r=req2) == "Sənədlər natamamdır")
        r = await rpc("admin_reject_provider_request",
                      {"p_request_id": req2, "p_reason": "bir də"}, ah)
        check("təkrar rədd → 'Request already rejected'",
              err(r, "Request already rejected"), r.text)
        # defolt arqument: p_reason verilmir (gözətçinin müraciəti)
        r = await rpc("admin_reject_provider_request", {"p_request_id": g_req}, ah)
        check("p_reason defoltu (null) qəbul olunur",
              r.status_code == 204 and await scalar(
                  "select body from notifications where user_id=:u"
                  " and type='provider_rejected'", u=guard["user_id"])
              == "Müraciətiniz qəbul olunmadı.", r.text[:200])

        # ══════════ 12. admin_approve / reject_brigade_application ══════════
        async with SessionLocal() as db:
            app1 = (await db.execute(text(
                "insert into brigade_applications (applicant_id, name, description,"
                " categories, contact_phone, contact_email, address)"
                " values (:u, 'Beta Ustalar', 'Təmir briqadası',"
                " cast(:c as text[]), '+994501234567', 'beta@ustalar.az',"
                " 'Bakı, Nizami 1') returning id"),
                {"u": u_app1["user_id"], "c": ["santexnik", "elektrik"]})).first()
            app2 = (await db.execute(text(
                "insert into brigade_applications (applicant_id, name)"
                " values (:u, 'Qamma Briqada') returning id"),
                {"u": u_app2["user_id"]})).first()
            await db.commit()
        app1, app2 = str(app1.id), str(app2.id)

        r = await rpc("admin_approve_brigade_application",
                      {"p_application_id": app1, "p_note": "Yaxşı komanda"}, ah)
        check("approve_brigade_application: 200 + uuid (JSON sətri)",
              r.status_code == 200 and isinstance(r.json(), str)
              and str(uuid.UUID(r.json())) == r.json(), r.text[:200])
        brig1 = r.json()
        q = await one("select status, brigade_id, decided_by, admin_note, decided_at"
                      " from brigade_applications where id=:id", id=app1)
        check("müraciət approved + briqada bağlandı",
              q.status == "approved" and str(q.brigade_id) == brig1
              and str(q.decided_by) == adm["user_id"]
              and q.admin_note == "Yaxşı komanda" and q.decided_at is not None, str(q))
        b = await one("select owner_id, name, description, categories, contact_phone,"
                      " contact_email, address, is_verified from brigades where id=:id",
                      id=brig1)
        check("briqada müraciətdəki məlumatla, təsdiqlənmiş yaradıldı",
              str(b.owner_id) == u_app1["user_id"] and b.name == "Beta Ustalar"
              and b.description == "Təmir briqadası"
              and b.categories == ["santexnik", "elektrik"]
              and b.contact_phone == "+994501234567"
              and b.contact_email == "beta@ustalar.az"
              and b.address == "Bakı, Nizami 1" and b.is_verified is True, str(b))
        check("müraciətçi tək 'owner' üzvdür",
              await scalar("select count(*) from brigade_members where brigade_id=:b",
                           b=brig1) == 1
              and await scalar("select role from brigade_members where brigade_id=:b"
                               " and profile_id=:p", b=brig1, p=u_app1["user_id"])
              == "owner")
        n = await one("select title, body, kind, link from notifications"
                      " where user_id=:u and type='brigade_approved'",
                      u=u_app1["user_id"])
        check("müraciətçiyə bildiriş (link ilə)",
              n is not None and n.title == "Briqada təsdiqləndi"
              and n.body == "Beta Ustalar admin tərəfindən təsdiqləndi."
              and n.kind == "brigade_approved" and n.link == f"/brigades/{brig1}", str(n))
        r = await rpc("admin_approve_brigade_application", {"p_application_id": app1}, ah)
        check("təkrar təsdiq → 'Application already approved'",
              err(r, "Application already approved"), r.text)
        r = await rpc("admin_approve_brigade_application",
                      {"p_application_id": str(uuid.uuid4())}, ah)
        check("naməlum müraciət → 'Application not found'",
              err(r, "Application not found"), r.text)
        check("uğursuz təsdiqlər briqada yaratmadı",
              await scalar("select count(*) from brigades") == 2)

        r = await rpc("admin_reject_brigade_application",
                      {"p_application_id": app2, "p_reason": "Məlumat azdır"}, ah)
        check("reject_brigade_application: 204 (void)",
              r.status_code == 204 and r.content == b"", r.text[:200])
        q = await one("select status, brigade_id, decided_by, admin_note"
                      " from brigade_applications where id=:id", id=app2)
        check("müraciət rejected, səbəb admin_note-da, briqada yoxdur",
              q.status == "rejected" and q.brigade_id is None
              and str(q.decided_by) == adm["user_id"]
              and q.admin_note == "Məlumat azdır", str(q))
        n = await one("select title, body, link from notifications where user_id=:u"
                      " and type='brigade_rejected'", u=u_app2["user_id"])
        check("müraciətçiyə imtina bildirişi",
              n is not None and n.title == "Briqada müraciəti imtina edildi"
              and n.body == "Məlumat azdır" and n.link == "/brigades", str(n))
        r = await rpc("admin_reject_brigade_application",
                      {"p_application_id": app2, "p_reason": "bir də"}, ah)
        check("təkrar rədd → 'Application already rejected'",
              err(r, "Application already rejected"), r.text)
        r = await rpc("admin_reject_brigade_application", {"p_application_id": g_app}, ah)
        check("p_reason defoltu (null) qəbul olunur",
              r.status_code == 204 and await scalar(
                  "select body from notifications where user_id=:u"
                  " and type='brigade_rejected'", u=guard["user_id"])
              == "Müraciətiniz qəbul olunmadı.", r.text[:200])

        # ══════════ 13. admin_companies_list / admin_company_detail ══════════
        async with SessionLocal() as db:
            member = (await db.execute(text(
                "select id from brigade_members where brigade_id=:b"),
                {"b": brig1})).first()
            await db.execute(text(
                "update brigade_members set is_online = true, commission_pct = 12.5"
                " where id=:m"), {"m": member.id})
            offer_b = (await db.execute(text(
                "insert into opportunities_offers (opportunity_id, provider_id,"
                " offer_amount, status, payment_method, brigade_id)"
                " values (:o, :p, 70, 'pending', 'cash', :b) returning id"),
                {"o": opp3, "p": u_app1["user_id"], "b": brig1})).first()
            await db.execute(text(
                "insert into brigade_assignments (brigade_id, member_id, source_type,"
                " source_id, status) values (:b, :m, 'opportunity', :s, 'completed')"),
                {"b": brig1, "m": member.id, "s": opp3})
            await db.execute(text(
                "insert into transactions (user_id, type, amount, description,"
                " related_id) values (:u, 'brigade_payout', 12.50,"
                " 'Komanda payı', :b)"), {"u": u_app1["user_id"], "b": brig1})
            await db.commit()

        r = await rpc("admin_companies_list", {}, ah)
        comp = r.json()
        comp_keys = {"id", "name", "is_verified", "is_active", "balance", "rating",
                     "total_orders", "created_at", "owner_name", "member_count",
                     "online_count", "offer_count"}
        check("companies_list: 200 + massiv, ada görə sıralı",
              r.status_code == 200 and isinstance(comp, list)
              and [x["name"] for x in comp] == ["Alfa Qrup", "Beta Ustalar"],
              r.text[:300])
        check("companies_list: sətir sütunları (panelin CompanyRow tipi)",
              all(set(x) == comp_keys for x in comp), str(set(comp[0]) ^ comp_keys))
        cb = comp[1]
        check("companies_list: Beta sətri dəyərləri",
              cb["id"] == brig1 and cb["is_verified"] is True and cb["is_active"] is True
              and cb["owner_name"] == "Briqadir Bir" and cb["member_count"] == 1
              and cb["online_count"] == 1 and cb["offer_count"] == 1
              and is_num(cb["balance"]) and is_num(cb["rating"])
              and cb["total_orders"] == 0 and "T" in cb["created_at"], str(cb))
        check("companies_list: Alfa sətri (təsdiqsiz, təklifsiz)",
              comp[0]["id"] == g_brig and comp[0]["is_verified"] is False
              and comp[0]["owner_name"] == "Gözətçi İstifadəçi"
              and comp[0]["member_count"] == 1 and comp[0]["online_count"] == 0
              and comp[0]["offer_count"] == 0, str(comp[0]))

        r = await rpc("admin_company_detail", {"p_brigade_id": brig1}, ah)
        det = r.json()
        check("company_detail: 200 + {brigade, members, orders, finance, logs}",
              r.status_code == 200
              and set(det) == {"brigade", "members", "orders", "finance", "logs"},
              r.text[:300])
        bk = {"id", "name", "description", "is_verified", "is_active", "balance",
              "rating", "total_orders", "categories", "contact_phone",
              "contact_email", "address", "created_at", "owner_name", "owner_id"}
        bd = det["brigade"]
        check("company_detail.brigade: sütunlar", set(bd) == bk, str(set(bd) ^ bk))
        check("company_detail.brigade: dəyərlər",
              bd["id"] == brig1 and bd["name"] == "Beta Ustalar"
              and bd["description"] == "Təmir briqadası"
              and bd["categories"] == ["santexnik", "elektrik"]
              and bd["contact_phone"] == "+994501234567"
              and bd["contact_email"] == "beta@ustalar.az"
              and bd["address"] == "Bakı, Nizami 1"
              and bd["owner_id"] == u_app1["user_id"]
              and bd["owner_name"] == "Briqadir Bir" and bd["is_verified"] is True,
              str(bd))
        mk = {"member_id", "profile_id", "name", "avatar_url", "role",
              "commission_pct", "is_active", "is_online", "joined_at", "done_count"}
        check("company_detail.members: 1 sətir + sütunlar",
              len(det["members"]) == 1 and set(det["members"][0]) == mk,
              str(det["members"]))
        m = det["members"][0]
        check("company_detail.members: dəyərlər",
              m["member_id"] == str(member.id) and m["profile_id"] == u_app1["user_id"]
              and m["name"] == "Briqadir Bir" and m["role"] == "owner"
              and dec(m["commission_pct"]) == Decimal("12.5") and m["is_active"] is True
              and m["is_online"] is True and m["done_count"] == 1
              and m["avatar_url"] is None and "T" in m["joined_at"], str(m))
        ok_ = {"offer_id", "opportunity_id", "title", "amount", "status",
               "payment_method", "created_at", "worker_name", "worker_status"}
        check("company_detail.orders: 1 sətir + sütunlar",
              len(det["orders"]) == 1 and set(det["orders"][0]) == ok_,
              str(det["orders"]))
        o = det["orders"][0]
        check("company_detail.orders: dəyərlər (təyin olunmuş işçi ilə)",
              o["offer_id"] == str(offer_b.id) and o["opportunity_id"] == opp3
              and o["title"] == "Hələ təklif yoxdur" and dec(o["amount"]) == 70
              and o["status"] == "pending" and o["payment_method"] == "cash"
              and o["worker_name"] == "Briqadir Bir"
              and o["worker_status"] == "completed", str(o))
        fk = {"id", "type", "amount", "description", "created_at", "user_name"}
        check("company_detail.finance: 1 sətir + sütunlar",
              len(det["finance"]) == 1 and set(det["finance"][0]) == fk,
              str(det["finance"]))
        f = det["finance"][0]
        check("company_detail.finance: dəyərlər",
              f["type"] == "brigade_payout" and dec(f["amount"]) == Decimal("12.5")
              and f["description"] == "Komanda payı"
              and f["user_name"] == "Briqadir Bir", str(f))
        lk = {"id", "action", "target_type", "created_at", "actor_name", "payload"}
        check("company_detail.logs: sətir sütunları",
              len(det["logs"]) >= 1 and all(set(x) == lk for x in det["logs"]),
              str(det["logs"])[:300])
        appr = [x for x in det["logs"] if x["action"] == "brigade_approve"]
        check("company_detail.logs: təsdiq qeydi (aktyor adı + payload)",
              len(appr) == 1 and appr[0]["actor_name"] == "Baş Admin"
              and appr[0]["target_type"] == "brigade_application"
              and appr[0]["payload"]["brigade_id"] == brig1
              and appr[0]["payload"]["note"] == "Yaxşı komanda", str(appr))
        check("company_detail.logs: yenidən köhnəyə sıralıdır",
              [x["created_at"] for x in det["logs"]]
              == sorted((x["created_at"] for x in det["logs"]), reverse=True))
        r = await rpc("admin_company_detail", {"p_brigade_id": g_brig}, ah)
        check("company_detail: boş bölmələr [] qaytarır",
              r.status_code == 200 and r.json()["orders"] == []
              and r.json()["finance"] == [] and len(r.json()["members"]) == 1,
              r.text[:300])
        r = await rpc("admin_company_detail", {"p_brigade_id": str(uuid.uuid4())}, ah)
        check("company_detail: naməlum → 'Şirkət tapılmadı'",
              err(r, "Şirkət tapılmadı"), r.text)

        # ══════════ 14. admin_kyc_list / admin_kyc_review ══════════
        kid = u_kyc["user_id"]
        r = await c.post("/api/v1/kyc/submit", headers=u_kyc["h"], json={
            "id_front_path": f"{kid}/front.jpg", "id_back_path": f"{kid}/back.jpg",
            "selfie_path": f"{kid}/selfie.jpg", "full_name_on_id": "Kamran Ustayev",
            "id_number": "AZE1234567", "birth_date": "1990-05-17"})
        check("KYC göndərildi", r.status_code == 201, r.text[:160])
        ver = r.json()["id"]

        r = await rpc("admin_kyc_list", {"p_status": "pending"}, ah)
        kl = r.json()
        kyc_keys = {
            "id", "provider_id", "full_name_on_id", "id_number", "birth_date",
            "status", "rejection_reason", "admin_notes", "is_renewal", "created_at",
            "reviewed_at", "id_front_path", "id_back_path", "selfie_path",
            "provider_name", "provider_email", "provider_phone", "provider_avatar"}
        check("kyc_list(pending): 200 + 2 sətirlik massiv, yenisi birinci",
              r.status_code == 200 and isinstance(kl, list)
              and [x["id"] for x in kl] == [ver, g_kyc], r.text[:300])
        check("kyc_list: sətir sütunları (panelin Kyc tipi)",
              all(set(x) == kyc_keys for x in kl), str(set(kl[0]) ^ kyc_keys))
        k = kl[0]
        check("kyc_list: sətir dəyərləri",
              k["provider_id"] == kid and k["full_name_on_id"] == "Kamran Ustayev"
              and k["id_number"] == "AZE1234567" and k["birth_date"] == "1990-05-17"
              and k["status"] == "pending" and k["rejection_reason"] is None
              and k["admin_notes"] is None and k["is_renewal"] is False
              and k["reviewed_at"] is None
              and k["id_front_path"] == f"{kid}/front.jpg"
              and k["id_back_path"] == f"{kid}/back.jpg"
              and k["selfie_path"] == f"{kid}/selfie.jpg"
              and k["provider_name"] == "Kamran Usta"
              and k["provider_email"] == u_kyc["email"]
              and k["provider_phone"] is None and k["provider_avatar"] is None
              and "T" in k["created_at"], str(k))
        r = await rpc("admin_kyc_list", {"p_status": "all"}, ah)
        check("kyc_list('all') → hamısı", len(r.json()) == 2)
        r = await rpc("admin_kyc_list", {}, ah)
        check("kyc_list() — p_status defoltu null → hamısı", len(r.json()) == 2)
        r = await rpc("admin_kyc_list", {"p_status": "approved"}, ah)
        check("kyc_list('approved') → []", r.status_code == 200 and r.json() == [])

        r = await rpc("admin_kyc_review", {
            "p_id": ver, "p_approve": False, "p_reason": "   ", "p_notes": None}, ah)
        check("kyc_review: səbəbsiz imtina → 'İmtina səbəbi tələb olunur'",
              err(r, "İmtina səbəbi tələb olunur"), r.text)
        r = await rpc("admin_kyc_review", {
            "p_id": str(uuid.uuid4()), "p_approve": True}, ah)
        check("kyc_review: naməlum → 'KYC tapılmadı'", err(r, "KYC tapılmadı"), r.text)
        check("uğursuz qərarlar statusu dəyişmədi",
              await scalar("select status from provider_verifications where id=:id",
                           id=ver) == "pending")

        r = await rpc("admin_kyc_review", {
            "p_id": ver, "p_approve": True, "p_reason": None,
            "p_notes": "Sənədlər qaydasındadır"}, ah)
        check("kyc_review(təsdiq): 204 (void)",
              r.status_code == 204 and r.content == b"", r.text[:200])
        v = await one("select status, rejection_reason, admin_notes, reviewed_by,"
                      " reviewed_at from provider_verifications where id=:id", id=ver)
        check("müraciət approved, qeyd + yoxlayan admin yazıldı",
              v.status == "approved" and v.rejection_reason is None
              and v.admin_notes == "Sənədlər qaydasındadır"
              and str(v.reviewed_by) == adm["user_id"] and v.reviewed_at is not None,
              str(v))
        p = await one("select is_verified, verification_status, last_kyc_approved_at"
                      " from profiles where id=:u", u=kid)
        check("profil təsdiqləndi (is_verified + 14 günlük tarix)",
              p.is_verified is True and p.verification_status == "approved"
              and p.last_kyc_approved_at is not None, str(p))
        check("ustaya bildiriş (kyc_approved)",
              await scalar("select count(*) from notifications where user_id=:u"
                           " and type='kyc_approved' and related_id=:r",
                           u=kid, r=ver) == 1)
        au = await one("select actor_id, payload from audit_log"
                       " where action='kyc_approve' and target_id=:t", t=ver)
        check("audit: kyc_approve",
              au is not None and str(au.actor_id) == adm["user_id"]
              and au.payload["provider_id"] == kid, str(au))
        r = await rpc("admin_kyc_list", {"p_status": "approved"}, ah)
        check("kyc_list('approved'): qərar sahələri doludur",
              len(r.json()) == 1 and r.json()[0]["id"] == ver
              and r.json()[0]["admin_notes"] == "Sənədlər qaydasındadır"
              and r.json()[0]["reviewed_at"] is not None, r.text[:300])
        r = await rpc("admin_kyc_list", {"p_status": "pending"}, ah)
        check("kyc_list('pending'): yalnız gözətçinin müraciəti qaldı",
              [x["id"] for x in r.json()] == [g_kyc])

        r = await rpc("admin_kyc_review", {
            "p_id": g_kyc, "p_approve": False, "p_reason": "Şəkil bulanıqdır",
            "p_notes": None}, ah)
        check("kyc_review(imtina): 204 (void)", r.status_code == 204, r.text[:200])
        v = await one("select status, rejection_reason, reviewed_by"
                      " from provider_verifications where id=:id", id=g_kyc)
        check("müraciət rejected, səbəb yazıldı",
              v.status == "rejected" and v.rejection_reason == "Şəkil bulanıqdır"
              and str(v.reviewed_by) == adm["user_id"], str(v))
        p = await one("select is_verified, verification_status from profiles"
                      " where id=:u", u=guard["user_id"])
        check("profil: is_verified false, status rejected",
              p.is_verified is False and p.verification_status == "rejected", str(p))
        check("bildiriş (kyc_rejected, səbəb ilə)",
              await scalar("select body from notifications where user_id=:u"
                           " and type='kyc_rejected'", u=guard["user_id"])
              == "Səbəb: Şəkil bulanıqdır")
        # SQL funksiyası qərarı dəyişməyə icazə verirdi (pending tələbi yox idi)
        r = await rpc("admin_kyc_review", {
            "p_id": ver, "p_approve": False, "p_reason": "Sənədin vaxtı bitib"}, ah)
        v = await one("select status, rejection_reason, admin_notes"
                      " from provider_verifications where id=:id", id=ver)
        p = await one("select is_verified, verification_status from profiles"
                      " where id=:u", u=kid)
        check("təsdiqlənmiş KYC sonradan rədd edilə bilir (SQL davranışı)",
              r.status_code == 204 and v.status == "rejected"
              and v.rejection_reason == "Sənədin vaxtı bitib" and v.admin_notes is None
              and p.is_verified is False and p.verification_status == "rejected",
              f"{r.status_code} {v} {p}")

        # ══════════ 15. admin_update_commission ══════════
        await redis.setex("cache:cfg:commission_on_withdrawal", 30, '"2"')
        r = await rpc("admin_update_commission",
                      {"p_key": "commission_on_withdrawal", "p_value": 12.5}, ah)
        check("update_commission: 204 (void)",
              r.status_code == 204 and r.content == b"", r.text[:200])
        cfg = await one("select value, jsonb_typeof(value) as jt, value #>> '{}' as txt,"
                        " updated_at > now() - interval '1 minute' as fresh"
                        " from platform_config where key='commission_on_withdrawal'")
        check("dəyər jsonb ƏDƏDİ kimi saxlandı (to_jsonb(numeric)), updated_at təzələndi",
              cfg.jt == "number" and Decimal(cfg.txt) == Decimal("12.5") and cfg.fresh,
              str(cfg))
        check("pul servisinin konfiq keşi təmizləndi",
              await redis.get("cache:cfg:commission_on_withdrawal") is None)
        check("audit: config_update",
              await scalar("select count(*) from audit_log where action='config_update'"
                           " and target_id='commission_on_withdrawal' and actor_id=:a",
                           a=adm["user_id"]) == 1)
        r = await rpc("admin_update_commission",
                      {"p_key": "bonus_on_complete", "p_value": 0}, ah)
        check("update_commission: yeni açar əlavə olunur, 0 icazəlidir",
              r.status_code == 204 and await scalar(
                  "select value #>> '{}' from platform_config"
                  " where key='bonus_on_complete'") == "0", r.text[:200])
        r = await rpc("admin_update_commission",
                      {"p_key": "min_withdrawal_amount", "p_value": 500}, ah)
        check("update_commission: min_withdrawal_amount 100-dən böyük ola bilir",
              r.status_code == 204 and await scalar(
                  "select value #>> '{}' from platform_config"
                  " where key='min_withdrawal_amount'") == "500", r.text[:200])
        r = await rpc("admin_update_commission",
                      {"p_key": "commission_on_accept", "p_value": 100.5}, ah)
        check("update_commission: faiz > 100 → 'Percentage value must be <= 100'",
              err(r, "Percentage value must be <= 100"), r.text)
        r = await rpc("admin_update_commission",
                      {"p_key": "commission_on_accept", "p_value": -1}, ah)
        check("update_commission: mənfi → 'Value must be >= 0'",
              err(r, "Value must be >= 0"), r.text)
        r = await rpc("admin_update_commission",
                      {"p_key": "commission_on_accept", "p_value": None}, ah)
        check("update_commission: null → 'Value cannot be null'",
              err(r, "Value cannot be null"), r.text)
        r = await rpc("admin_update_commission",
                      {"p_key": "jwt_secret", "p_value": 1}, ah)
        check("update_commission: icazəsiz açar → 'Invalid config key: jwt_secret'",
              err(r, "Invalid config key: jwt_secret"), r.text)
        check("rədd edilən dəyişikliklər konfiqə toxunmadı",
              await scalar("select value #>> '{}' from platform_config"
                           " where key='commission_on_accept'") == "10"
              and await scalar("select count(*) from platform_config"
                               " where key='jwt_secret'") == 0)

        # ══════════ 16. admin_delete_user ══════════
        r = await rpc("admin_delete_user", {"p_user_id": adm["user_id"]}, ah)
        check("delete_user: özünü silmək → 200 {ok:false, error:CANNOT_DELETE_SELF}",
              r.status_code == 200
              and r.json() == {"ok": False, "error": "CANNOT_DELETE_SELF"}, r.text)
        r = await rpc("admin_delete_user", {"p_user_id": adm5["user_id"]}, ah)
        check("delete_user: admin başqa admini silə bilməz",
              r.status_code == 200
              and r.json() == {"ok": False, "error": "ONLY_SUPERADMIN_DELETES_ADMINS"},
              r.text)
        r = await rpc("admin_delete_user", {"p_user_id": sup["user_id"]}, ah)
        check("delete_user: admin superadmini silə bilməz",
              r.status_code == 200
              and r.json() == {"ok": False, "error": "ONLY_SUPERADMIN_DELETES_ADMINS"},
              r.text)
        check("rədd edilən silmələr: hesablar yerindədir",
              await scalar("select count(*) from users where id in (:a, :b, :c)",
                           a=adm["user_id"], b=adm5["user_id"], c=sup["user_id"]) == 3)

        # 16a. Tarixçəsiz hesab → tam silinir (profil + kimlik + sessiyalar)
        jti = decode_token(u_del["refresh_token"], "refresh")["jti"]
        check("silinməzdən əvvəl refresh sessiyası aktivdir",
              await redis.get(f"rt:{jti}") is not None
              and await scalar("select count(*) from refresh_sessions where user_id=:u",
                               u=u_del["user_id"]) == 1)
        r = await rpc("admin_delete_user", {"p_user_id": u_del["user_id"]}, ah)
        check("delete_user: 200 {ok:true, deleted:true}",
              r.status_code == 200 and r.json() == {"ok": True, "deleted": True}, r.text)
        check("profil sətri silindi",
              await scalar("select count(*) from profiles where id=:u",
                           u=u_del["user_id"]) == 0)
        check("kimlik (users) sətri silindi",
              await scalar("select count(*) from users where id=:u",
                           u=u_del["user_id"]) == 0)
        check("refresh sessiyaları bazadan və Redis-dən silindi",
              await scalar("select count(*) from refresh_sessions where user_id=:u",
                           u=u_del["user_id"]) == 0
              and await redis.get(f"rt:{jti}") is None)
        r = await c.post("/api/v1/auth/refresh",
                         json={"refresh_token": u_del["refresh_token"]})
        check("silinmiş hesabın refresh tokeni işləmir", r.status_code == 401, r.text)
        r = await c.get("/api/v1/profiles/me", headers=u_del["h"])
        check("silinmiş hesabın access tokeni işləmir", r.status_code == 401, r.text)
        r = await c.post("/api/v1/auth/login",
                         json={"email": u_del["email"], "password": PASSWORD})
        check("silinmiş hesabla login olmur", r.status_code == 401, r.text)
        check("audit: user_delete",
              await scalar("select count(*) from audit_log where action='user_delete'"
                           " and target_id=:t and actor_id=:a",
                           t=u_del["user_id"], a=adm["user_id"]) == 1)

        # 16b. Tarixçəsi olan hesab (briqada sahibi) → soft-ban
        jti1 = decode_token(u_app1["refresh_token"], "refresh")["jti"]
        check("ban-dan əvvəl refresh sessiyası aktivdir",
              await redis.get(f"rt:{jti1}") is not None)
        r = await rpc("admin_delete_user", {"p_user_id": u_app1["user_id"]}, ah)
        check("delete_user: 200 {ok:true, deleted:false, banned:true}",
              r.status_code == 200
              and r.json() == {"ok": True, "deleted": False, "banned": True}, r.text)
        q = await one("select u.is_active, p.status from users u join profiles p"
                      " on p.id = u.id where u.id=:u", u=u_app1["user_id"])
        check("hesab qalır, amma bloklanıb (is_active=false, status='blocked')",
              q is not None and q.is_active is False and q.status == "blocked", str(q))
        check("briqadası və məlumatı toxunulmazdır",
              await scalar("select count(*) from brigades where id=:b", b=brig1) == 1)
        check("refresh sessiyaları ləğv edildi (baza + Redis)",
              await scalar("select bool_and(revoked) from refresh_sessions"
                           " where user_id=:u", u=u_app1["user_id"]) is True
              and await redis.get(f"rt:{jti1}") is None)
        r = await c.post("/api/v1/auth/refresh",
                         json={"refresh_token": u_app1["refresh_token"]})
        check("bloklanmış hesabın refresh tokeni işləmir", r.status_code == 401, r.text)
        r = await c.post("/api/v1/auth/login",
                         json={"email": u_app1["email"], "password": PASSWORD})
        check("bloklanmış hesabla login olmur", r.status_code in (401, 403), r.text)
        check("audit: user_soft_ban",
              await scalar("select count(*) from audit_log where action='user_soft_ban'"
                           " and target_id=:t", t=u_app1["user_id"]) == 1)

        # 16c. Superadmin admini silə bilir
        r = await rpc("admin_delete_user", {"p_user_id": adm5["user_id"]}, sh)
        check("delete_user: superadmin admini silir",
              r.status_code == 200 and r.json() == {"ok": True, "deleted": True}, r.text)
        check("silinmiş adminin köhnə tokeni RPC-də 401 alır",
              (await rpc("admin_dashboard_stats", {}, adm5["h"])).status_code == 401)
        r = await rpc("admin_delete_user", {"p_user_id": str(uuid.uuid4())}, ah)
        check("delete_user: mövcud olmayan id → {ok:true, deleted:true} (SQL kimi)",
              r.status_code == 200 and r.json() == {"ok": True, "deleted": True}, r.text)

        # ══════════ 17. REST endpointləri eyni servisləri işlədir (reqressiya) ══════════
        r = await c.get("/api/v1/admin/dashboard-stats", headers=ah)
        r2 = await rpc("admin_dashboard_stats", {}, ah)
        check("REST /admin/dashboard-stats RPC ilə eyni açarları verir",
              r.status_code == 200 and set(r.json()) == set(r2.json()), r.text[:200])
        r = await c.get("/api/v1/admin/dashboard-daily?days=7", headers=ah)
        check("REST /admin/dashboard-daily", r.status_code == 200 and len(r.json()) == 7)
        r = await c.get("/api/v1/admin/users-meta", headers=ah)
        r2 = await rpc("admin_list_users_with_meta", {}, ah)
        check("REST /admin/users-meta RPC ilə eyni sayda sətir",
              r.status_code == 200 and len(r.json()) == len(r2.json()))
        r = await c.get("/api/v1/admin/companies", headers=ah)
        check("REST /admin/companies", r.status_code == 200 and len(r.json()) == 2)
        r = await c.get(f"/api/v1/admin/companies/{brig1}", headers=ah)
        check("REST /admin/companies/{id}",
              r.status_code == 200 and r.json()["brigade"]["name"] == "Beta Ustalar")
        r = await c.get(f"/api/v1/admin/companies/{uuid.uuid4()}", headers=ah)
        check("REST naməlum şirkət → 404", r.status_code == 404
              and r.json()["detail"] == "Şirkət tapılmadı", r.text)
        r = await c.post(f"/api/v1/admin/users/{cust['user_id']}/adjust-balance",
                         headers=ah, json={"amount": "1.50", "reason": "REST"})
        check("REST adjust-balance cavab forması dəyişməyib",
              r.status_code == 200 and r.json()["ok"] is True
              and r.json()["target"] == "balance"
              and Decimal(r.json()["new_value"]) == b0 + Decimal("51.50"), r.text)
        r = await c.post(f"/api/v1/admin/users/{cust['user_id']}/adjust-balance",
                         headers=ah, json={"amount": "0"})
        check("REST adjust-balance sıfır → 400 (Azərbaycanca mətn)",
              r.status_code == 400 and r.json()["detail"] == "Məbləğ sıfır ola bilməz",
              r.text)
        r = await c.post(f"/api/v1/admin/users/{prov['user_id']}/credit-bonus",
                         headers=ah, json={"amount": "2"})
        check("REST credit-bonus cavab forması dəyişməyib",
              r.status_code == 200 and r.json()["ok"] is True
              and Decimal(r.json()["new_bonus"]) == bon0 + Decimal("9.5"), r.text)
        r = await c.post(f"/api/v1/admin/users/{u_role['user_id']}/role",
                         headers=ah, json={"role": "provider"})
        check("REST role dəyişmə", r.status_code == 200
              and r.json() == {"ok": True, "role": "provider"}, r.text)
        r = await c.delete(f"/api/v1/admin/users/{adm['user_id']}", headers=ah)
        check("REST özünü silmək → 400 CANNOT_DELETE_SELF",
              r.status_code == 400 and r.json()["detail"] == "CANNOT_DELETE_SELF", r.text)
        r = await c.delete(f"/api/v1/admin/users/{sup['user_id']}", headers=ah)
        check("REST admin superadmini silə bilməz → 403",
              r.status_code == 403
              and r.json()["detail"] == "ONLY_SUPERADMIN_DELETES_ADMINS", r.text)
        r = await c.post(f"/api/v1/admin/brigade-applications/{app1}/approve",
                         headers=ah, json={})
        check("REST təkrar briqada təsdiqi → 409", r.status_code == 409
              and r.json()["detail"] == "Application already approved", r.text)
        r = await c.post(f"/api/v1/kyc/{ver}/review", headers=ah,
                         json={"approve": True})
        check("REST KYC: artıq yoxlanılmış müraciət → 409 (REST qaydası dəyişməyib)",
              r.status_code == 409, r.text)
        r = await c.get("/api/v1/admin/dashboard-stats", headers=cust["h"])
        check("REST admin API adi istifadəçiyə bağlıdır", r.status_code == 403)

    print("RPC ADMİN TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
