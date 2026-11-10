"""Supabase-uyğun RPC testi — briqada funksiyaları (/rest/v1/rpc/<ad>).

Hər handler real marşrut üzərindən (POST /rest/v1/rpc/<ad>, bearer token
/api/v1/auth/register-dən) yoxlanır: uğurlu yol, əsas xəta yolları və icazələr
(anonim / üzv olmayan / yanlış rol rədd edilir). Cavab forması klientlərin
(veb: src/pages/Brigade*.tsx, JoinBrigade.tsx, PendingInvites.tsx; mobil:
lib/services/brigade_service.dart) oxuduğu sahələrlə sahə-sahə tutuşdurulur.

Təzə bazada tək başına işləyir (DATABASE_URL/REDIS_URL env ilə):
    python3 tests/compat_rpc_brigade.py
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime
from decimal import Decimal

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Test bir dəqiqədə 120-dən çox sorğu göndərir — ümumi IP limiti testə mane olmasın
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import httpx  # noqa: E402

RPCS = [
    "my_pending_brigade_invites", "accept_brigade_invite", "decline_brigade_invite",
    "lookup_brigade_invite", "brigade_assignment_complete", "brigade_assignment_start",
    "brigade_assignment_respond", "set_member_online", "brigade_top_up_from_owner",
    "brigade_distribute_balance", "apply_for_brigade", "cancel_brigade_application",
    "brigade_dispatch_order", "brigade_dispatch_assign", "brigade_place_offer",
    "brigade_role",
]


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra if not cond else ''}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


def data(r: httpx.Response):
    """supabase-js / postgrest-dart kimi: boş gövdə (204) → null."""
    return None if r.content == b"" else r.json()


def is_num(v) -> bool:
    """JSON ədədi (klientlər `as num` / JS number gözləyir — sətir yox)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_uuid(v) -> bool:
    try:
        return isinstance(v, str) and str(uuid.UUID(v)) == v
    except ValueError:
        return False


def is_ts(v) -> bool:
    """`new Date(x)` / `DateTime.parse(x)` oxuya bilən ISO vaxt."""
    try:
        return isinstance(v, str) and datetime.fromisoformat(v).tzinfo is not None
    except ValueError:
        return False


def err(r: httpx.Response, status: int, code: str, contains: str = "") -> bool:
    """PostgREST xəta zərfi: {code, details, hint, message}."""
    if r.status_code != status:
        return False
    try:
        body = r.json()
    except ValueError:
        return False
    return (isinstance(body, dict)
            and set(body) == {"code", "details", "hint", "message"}
            and body["code"] == code
            and isinstance(body["message"], str) and body["message"] != ""
            and contains in body["message"])


def biz(r: httpx.Response, contains: str = "") -> bool:
    """`raise exception '...'` qarşılığı: 400 + P0001 + mesaj."""
    return err(r, 400, "P0001", contains)


async def main() -> None:
    from sqlalchemy import text

    from app.compat import rpc as registry
    from app.db.session import SessionLocal
    from app.main import app

    async def one(sql: str, params: dict | None = None):
        async with SessionLocal() as db:
            return (await db.execute(text(sql), params or {})).first()

    async def rows(sql: str, params: dict | None = None) -> list:
        async with SessionLocal() as db:
            return list((await db.execute(text(sql), params or {})).all())

    async def run(sql: str, params: dict | None = None):
        async with SessionLocal() as db:
            res = await db.execute(text(sql), params or {})
            row = res.first() if res.returns_rows else None
            await db.commit()
            return row

    async def notifs(user_id: str, kind: str | None = None,
                     ntype: str | None = None) -> list:
        got = await rows(
            "select id, type, kind, title, body, related_id, link"
            "  from notifications where user_id = :u order by created_at, id",
            {"u": user_id})
        return [n for n in got
                if (kind is None or n.kind == kind)
                and (ntype is None or n.type == ntype)]

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        async def register(email: str, name: str, role: str,
                           phone: str | None = None) -> tuple[str, dict]:
            body = {"email": email, "password": "Guclu!Parol1", "name": name,
                    "role": role}
            if phone:
                body["phone"] = phone
            r = await c.post("/api/v1/auth/register", json=body)
            check(f"qeydiyyat: {name}", r.status_code == 201, r.text[:160])
            return (r.json()["user_id"],
                    {"Authorization": f"Bearer {r.json()['access_token']}"})

        async def rpc(name: str, args: dict | None = None,
                      headers: dict | None = None) -> httpx.Response:
            return await c.post(f"/rest/v1/rpc/{name}", json=args or {},
                                headers=headers or {})

        # supabase-js giriş etməmiş istifadəçi üçün `anon key`-i bearer kimi göndərir
        ANON = {"apikey": "anon-key", "Authorization": "Bearer anon-key"}

        # ══════════ 0. İstifadəçilər + seed ══════════
        print("\n── 0. Hazırlıq ──")
        owner, oh = await register("sahib@briqada.az", "Sahib Usta", "provider")
        disp, dh = await register("dispetcer@briqada.az", "Dispetçer", "provider")
        w1, w1h = await register("isci1@briqada.az", "İşçi Bir", "provider")
        w2, w2h = await register("isci2@briqada.az", "İşçi İki", "provider")
        cust, ch = await register("musteri@briqada.az", "Müştəri", "customer")
        outs, xh = await register("kenar@briqada.az", "Kənar Usta", "provider")
        inv, ih = await register("devetli@briqada.az", "Dəvətli Usta", "provider")
        phu, phh = await register("telefonlu@briqada.az", "Telefonlu Usta",
                                  "provider", phone="+994 50 123 45 67")

        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "insert into service_categories (label) values ('Təmir')"
                " returning id"))).first()
            await db.execute(text(
                "insert into platform_config (key, value) values"
                " ('commission_on_accept', '10'),"
                " ('commission_on_complete', '5'),"
                " ('commission_customer_service_fee', '0')"
                " on conflict (key) do update set value = excluded.value"))
            await db.execute(text(
                "update profiles set balance = 500 where id = :id"), {"id": owner})
            b1 = (await db.execute(text(
                "insert into brigades (owner_id, name, description, logo_url,"
                " is_verified) values (:o, 'Ellit Briqada', 'Təmir ustaları',"
                " 'https://cdn.ellit.az/b1.png', true) returning id"),
                {"o": owner})).first()
            b2 = (await db.execute(text(
                "insert into brigades (owner_id, name, balance)"
                " values (:o, 'Kənar Briqada', 1000) returning id"),
                {"o": outs})).first()
            # sahib üzv sətrini ellit_brigade_auto_owner trigger-i yaradır
            for pid, role in ((disp, "dispatcher"), (w1, "member"), (w2, "member")):
                await db.execute(text(
                    "insert into brigade_members (brigade_id, profile_id, role)"
                    " values (:b, :p, :r)"), {"b": b1.id, "p": pid, "r": role})
            await db.commit()
            cat_id, B1, B2 = str(cat.id), str(b1.id), str(b2.id)

        async def member_id(brigade: str, profile: str) -> str:
            r = await one("select id from brigade_members"
                          " where brigade_id = :b and profile_id = :p",
                          {"b": brigade, "p": profile})
            return str(r.id)

        M_OWNER = await member_id(B1, owner)
        M_W1 = await member_id(B1, w1)
        M_W2 = await member_id(B1, w2)
        M_OUTS = await member_id(B2, outs)

        async def new_opp(title: str) -> str:
            r = await c.post("/api/v1/opportunities", headers=ch, json={
                "title": title, "description": "RPC testi",
                "category_id": cat_id, "date": "2026-12-15"})
            check(f"sifariş yaradıldı: {title}", r.status_code == 201, r.text[:160])
            return r.json()["id"]

        async def balances() -> tuple[Decimal, Decimal, Decimal, Decimal]:
            b = await one("select balance from brigades where id = :b", {"b": B1})
            p = {str(r.id): r.balance for r in await rows(
                "select id, coalesce(balance,0) as balance from profiles"
                " where id = any(:ids)", {"ids": [owner, w1, w2]})}
            return (Decimal(b.balance), Decimal(p[owner]), Decimal(p[w1]),
                    Decimal(p[w2]))

        check("16 briqada RPC-si reyestrdədir",
              set(RPCS) <= set(registry.registered()),
              str(sorted(set(RPCS) - set(registry.registered()))))

        # ══════════ 1. Anonim çağırışlar ══════════
        print("\n── 1. Anonim / naməlum çağırışlar ──")
        nil = str(uuid.uuid4())
        valid_args = {
            "my_pending_brigade_invites": {},
            "accept_brigade_invite": {"p_token": nil},
            "decline_brigade_invite": {"p_token": nil},
            "brigade_assignment_complete": {"p_assignment_id": nil},
            "brigade_assignment_start": {"p_assignment_id": nil},
            "brigade_assignment_respond": {"p_assignment_id": nil, "p_action": "accept"},
            "set_member_online": {"p_is_online": True},
            "brigade_top_up_from_owner": {"p_brigade_id": B1, "p_amount": 10},
            "brigade_distribute_balance": {
                "p_brigade_id": B1,
                "p_allocations": [{"profile_id": w1, "amount": 1}]},
            "apply_for_brigade": {"p_name": "Anonim briqada"},
            "cancel_brigade_application": {"p_application_id": nil},
            "brigade_dispatch_order": {
                "p_brigade_id": B1, "p_source_id": nil, "p_member_ids": [M_W1]},
            "brigade_dispatch_assign": {
                "p_brigade_id": B1, "p_opportunity_id": nil, "p_member_id": M_W1,
                "p_amount": 10},
            "brigade_place_offer": {
                "p_brigade_id": B1, "p_opportunity_id": nil, "p_amount": 10},
            "brigade_role": {"p_brigade_id": B1},
        }
        for name, args in valid_args.items():
            r = await rpc(name, args)                 # heç bir başlıq yoxdur
            r2 = await rpc(name, args, ANON)          # anon key bearer kimi
            check(f"anonim rədd edilir: {name}",
                  err(r, 401, "42501", name) and err(r2, 401, "42501", name),
                  f"{r.status_code} {r.text[:120]}")
        check("anonim çağırışlar heç nə dəyişməyib",
              (await one("select count(*) as c from brigade_applications")).c == 0
              and (await one("select count(*) as c from brigade_assignments")).c == 0
              and (await one("select count(*) as c from opportunities_offers")).c == 0
              and (await balances()) == (Decimal(0), Decimal(500), Decimal(0), Decimal(0)))

        r = await rpc("brigade_role", {}, oh)
        check("məcburi arqument yoxdur → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])
        r = await rpc("brigade_role", {"p_brigade_id": B1, "p_extra": 1}, oh)
        check("naməlum arqument → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])

        # ══════════ 2. apply_for_brigade / cancel_brigade_application ══════════
        print("\n── 2. Müraciət: apply_for_brigade / cancel_brigade_application ──")
        apply_args = {  # src/pages/Brigades.tsx handleApply göndərən kimi
            "p_name": "Müştəri Briqadası", "p_description": "Təsvir",
            "p_categories": ["temir", "santexnik"], "p_contact_phone": "+994551112233",
            "p_contact_email": "biz@briqada.az", "p_address": None,
            "p_logo_url": None,
        }
        r = await rpc("apply_for_brigade", apply_args, ch)
        app_id = data(r)
        check("apply_for_brigade → 200, gövdə çılpaq uuid sətridir",
              r.status_code == 200 and is_uuid(app_id), f"{r.status_code} {r.text[:160]}")
        a = await one("select * from brigade_applications where id = :id", {"id": app_id})
        check("müraciət sətri: çağıranın adına, sahələr göndərildiyi kimi",
              a is not None and str(a.applicant_id) == cust and a.status == "pending"
              and a.name == "Müştəri Briqadası" and a.description == "Təsvir"
              and list(a.categories) == ["temir", "santexnik"]
              and a.contact_phone == "+994551112233"
              and a.contact_email == "biz@briqada.az"
              and a.address is None and a.logo_url is None, str(a))
        check("müraciətçi snapshot-u (ad/email) profildən yazılıb",
              a.applicant_name == "Müştəri" and a.applicant_email == "musteri@briqada.az",
              f"{a.applicant_name} {a.applicant_email}")

        r = await rpc("apply_for_brigade", apply_args, ch)
        check("ikinci aktiv müraciət rədd edilir",
              biz(r, "Sizin artıq aktiv müraciətiniz var"), r.text[:160])
        r = await rpc("apply_for_brigade", {"p_name": "   "}, xh)
        check("boş ad rədd edilir", biz(r), r.text[:160])
        r = await rpc("apply_for_brigade", {"p_description": "adsız"}, xh)
        check("p_name göndərilməyib → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])
        check("uğursuz cəhdlər sətir yaratmayıb",
              (await one("select count(*) as c from brigade_applications")).c == 1)

        r = await rpc("cancel_brigade_application", {"p_application_id": app_id}, xh)
        check("başqasının müraciətini ləğv etmək olmaz", biz(r), r.text[:160])
        check("müraciət hələ pending-dir",
              (await one("select status from brigade_applications where id = :id",
                         {"id": app_id})).status == "pending")
        r = await rpc("cancel_brigade_application", {"p_application_id": "uuid-deyil"}, ch)
        check("yanlış uuid → 400 22P02", err(r, 400, "22P02", "uuid"), r.text[:160])
        r = await rpc("cancel_brigade_application", {"p_application_id": nil}, ch)
        check("olmayan müraciət → xəta", biz(r), r.text[:160])

        r = await rpc("cancel_brigade_application", {"p_application_id": app_id}, ch)
        check("cancel_brigade_application → 204, boş gövdə (returns void)",
              r.status_code == 204 and r.content == b"", f"{r.status_code} {r.text[:160]}")
        a = await one("select status, decided_at from brigade_applications where id = :id",
                      {"id": app_id})
        check("müraciət cancelled + decided_at", a.status == "cancelled"
              and a.decided_at is not None)
        r = await rpc("cancel_brigade_application", {"p_application_id": app_id}, ch)
        check("artıq ləğv edilmiş müraciət təkrar ləğv olunmur", biz(r, "cancelled"),
              r.text[:160])

        r = await rpc("apply_for_brigade", {"p_name": "Yalnız ad"}, ch)
        app2 = data(r)
        a = await one("select * from brigade_applications where id = :id", {"id": app2})
        check("yalnız p_name ilə (qalanları DEFAULT) müraciət yaranır",
              r.status_code == 200 and is_uuid(app2) and a is not None
              and list(a.categories) == [] and a.description is None
              and a.status == "pending", f"{r.status_code} {r.text[:160]}")

        # ══════════ 3. Dəvətlər ══════════
        print("\n── 3. Dəvətlər: lookup / my_pending / accept / decline ──")
        t_email = str((await run(
            "insert into brigade_invites (brigade_id, invited_by, email,"
            " intended_role, commission_pct)"
            " values (:b, :u, 'Devetli@Briqada.az', 'member', 12.5) returning token",
            {"b": B1, "u": owner})).token)
        t_phone = str((await run(
            "insert into brigade_invites (brigade_id, invited_by, phone, intended_role)"
            " values (:b, :u, '050 123-45-67', 'dispatcher') returning token",
            {"b": B1, "u": owner})).token)
        t_expired = str((await run(
            "insert into brigade_invites (brigade_id, invited_by, email, expires_at)"
            " values (:b, :u, 'devetli@briqada.az', now() - interval '1 day')"
            " returning token", {"b": B1, "u": owner})).token)

        # lookup — girişsiz (JoinBrigade.tsx səhifəsi login-dən əvvəl açılır)
        INVITE_KEYS = {"token", "status", "intended_role", "commission_pct",
                       "expires_at", "is_expired", "invited_email", "invited_phone",
                       "brigade"}
        BRIGADE_KEYS = {"id", "name", "description", "logo_url", "is_verified"}
        for label, hdrs in (("başlıqsız", {}), ("anon key ilə", ANON),
                            ("giriş etmiş", xh)):
            r = await rpc("lookup_brigade_invite", {"p_token": t_email}, hdrs)
            d = data(r)
            check(f"lookup_brigade_invite ({label}) → 200 obyekt, sahələr tam",
                  r.status_code == 200 and isinstance(d, dict)
                  and set(d) == INVITE_KEYS and set(d["brigade"]) == BRIGADE_KEYS,
                  f"{r.status_code} {r.text[:200]}")
        check("lookup: token/status/rol",
              d["token"] == t_email and d["status"] == "pending"
              and d["intended_role"] == "member", str(d))
        check("lookup: commission_pct JSON ədədidir (12.5)",
              is_num(d["commission_pct"]) and d["commission_pct"] == 12.5,
              repr(d["commission_pct"]))
        check("lookup: expires_at ISO vaxt, is_expired bool false",
              is_ts(d["expires_at"]) and d["is_expired"] is False, str(d))
        check("lookup: invited_email dəvətdəki kimi, invited_phone null",
              d["invited_email"] == "Devetli@Briqada.az" and d["invited_phone"] is None)
        check("lookup: brigade {id,name,description,logo_url,is_verified}",
              d["brigade"] == {"id": B1, "name": "Ellit Briqada",
                               "description": "Təmir ustaları",
                               "logo_url": "https://cdn.ellit.az/b1.png",
                               "is_verified": True}, str(d["brigade"]))

        d = data(await rpc("lookup_brigade_invite", {"p_token": t_phone}))
        check("lookup (telefon dəvəti): commission_pct null, invited_phone dolu",
              d["commission_pct"] is None and d["invited_phone"] == "050 123-45-67"
              and d["invited_email"] is None and d["intended_role"] == "dispatcher", str(d))
        d = data(await rpc("lookup_brigade_invite", {"p_token": t_expired}))
        check("lookup (vaxtı keçmiş): is_expired true",
              d["is_expired"] is True and d["status"] == "pending", str(d))
        r = await rpc("lookup_brigade_invite", {"p_token": nil})
        check("lookup (olmayan token) → klient üçün null",
              r.status_code in (200, 204) and data(r) is None,
              f"{r.status_code} {r.text[:120]}")
        r = await rpc("lookup_brigade_invite", {"p_token": "uuid-deyil"})
        check("lookup (yanlış uuid) → 400 22P02", err(r, 400, "22P02", "uuid"), r.text[:160])
        r = await rpc("lookup_brigade_invite", {})
        check("lookup (p_token yoxdur) → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])

        # my_pending_brigade_invites
        PENDING_KEYS = {"token", "intended_role", "brigade_id", "brigade_name",
                        "brigade_logo", "invited_at", "expires_at"}
        r = await rpc("my_pending_brigade_invites", None, ih)
        d = data(r)
        check("my_pending_brigade_invites → 200 massiv, 1 sətir (vaxtı keçmiş düşmür)",
              r.status_code == 200 and isinstance(d, list) and len(d) == 1,
              f"{r.status_code} {r.text[:200]}")
        check("pending sətri: sahələr tam və klientin oxuduğu kimi",
              set(d[0]) == PENDING_KEYS and d[0]["token"] == t_email
              and d[0]["intended_role"] == "member" and d[0]["brigade_id"] == B1
              and d[0]["brigade_name"] == "Ellit Briqada"
              and d[0]["brigade_logo"] == "https://cdn.ellit.az/b1.png"
              and is_ts(d[0]["invited_at"]) and is_ts(d[0]["expires_at"]), str(d[0]))
        r = await rpc("my_pending_brigade_invites", None, phh)
        d = data(r)
        check("telefonla dəvət: son 9 rəqəm uyğunluğu ilə tapılır",
              r.status_code == 200 and len(d) == 1 and d[0]["token"] == t_phone
              and d[0]["intended_role"] == "dispatcher", r.text[:200])
        r = await rpc("my_pending_brigade_invites", None, xh)
        check("dəvəti olmayan istifadəçi → boş massiv []",
              r.status_code == 200 and data(r) == [], r.text[:120])

        # accept
        r = await rpc("accept_brigade_invite", {"p_token": t_email}, xh)
        check("başqasının email dəvətini qəbul etmək olmaz", biz(r, "email"), r.text[:160])
        r = await rpc("accept_brigade_invite", {"p_token": t_phone}, xh)
        check("başqasının telefon dəvətini qəbul etmək olmaz", biz(r, "telefon"), r.text[:160])
        check("rədd edilən cəhd üzvlük yaratmayıb, dəvət pending qalıb",
              (await one("select count(*) as c from brigade_members"
                         " where brigade_id = :b and profile_id = :p",
                         {"b": B1, "p": outs})).c == 0
              and (await one("select status from brigade_invites where token = :t",
                             {"t": t_email})).status == "pending")
        r = await rpc("accept_brigade_invite", {"p_token": t_expired}, ih)
        check("vaxtı keçmiş dəvət qəbul olunmur", biz(r), r.text[:160])
        r = await rpc("accept_brigade_invite", {"p_token": nil}, ih)
        check("olmayan dəvət qəbul olunmur", biz(r), r.text[:160])
        r = await rpc("accept_brigade_invite", {"p_token": "uuid-deyil"}, ih)
        check("accept: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])

        r = await rpc("accept_brigade_invite", {"p_token": t_email}, ih)
        d = data(r)
        check("accept_brigade_invite → 200 {ok, brigade_id, role}",
              r.status_code == 200 and d == {"ok": True, "brigade_id": B1,
                                             "role": "member"}, r.text[:200])
        m = await one("select role, is_active, commission_pct from brigade_members"
                      " where brigade_id = :b and profile_id = :p", {"b": B1, "p": inv})
        i = await one("select status, responded_at from brigade_invites where token = :t",
                      {"t": t_email})
        check("üzvlük yarandı (rol + komissiya dəvətdən), dəvət accepted",
              m is not None and m.role == "member" and m.is_active is True
              and m.commission_pct == Decimal("12.50")
              and i.status == "accepted" and i.responded_at is not None, f"{m} {i}")
        n = await notifs(owner, ntype="brigade_invite_accepted")
        check("briqada sahibinə 'Dəvət qəbul edildi' bildirişi",
              len(n) == 1 and n[0].title == "Dəvət qəbul edildi" and n[0].related_id == B1,
              str(n))
        r = await rpc("accept_brigade_invite", {"p_token": t_email}, ih)
        check("artıq cavablanmış dəvət təkrar qəbul olunmur", biz(r), r.text[:160])
        d = data(await rpc("lookup_brigade_invite", {"p_token": t_email}))
        check("lookup qəbuldan sonra status=accepted göstərir", d["status"] == "accepted")
        check("qəbuldan sonra pending siyahısı boşdur",
              data(await rpc("my_pending_brigade_invites", None, ih)) == [])
        check("yeni üzv üçün brigade_role → 'member'",
              data(await rpc("brigade_role", {"p_brigade_id": B1}, ih)) == "member")

        # decline
        r = await rpc("decline_brigade_invite", {"p_token": "uuid-deyil"}, phh)
        check("decline: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("decline_brigade_invite", {"p_token": nil}, phh)
        check("decline: olmayan dəvət → xəta", biz(r), r.text[:160])
        r = await rpc("decline_brigade_invite", {"p_token": t_phone}, phh)
        check("decline_brigade_invite → 200 {ok: true}",
              r.status_code == 200 and data(r) == {"ok": True}, r.text[:160])
        i = await one("select status, responded_at from brigade_invites where token = :t",
                      {"t": t_phone})
        check("dəvət declined + responded_at, üzvlük yaranmayıb",
              i.status == "declined" and i.responded_at is not None
              and (await one("select count(*) as c from brigade_members"
                             " where profile_id = :p", {"p": phu})).c == 0)
        r = await rpc("decline_brigade_invite", {"p_token": t_phone}, phh)
        check("artıq rədd edilmiş dəvət təkrar rədd olunmur", biz(r), r.text[:160])
        r = await rpc("accept_brigade_invite", {"p_token": t_phone}, phh)
        check("rədd edilmiş dəvət qəbul olunmur", biz(r), r.text[:160])

        # ══════════ 4. brigade_role ══════════
        print("\n── 4. brigade_role ──")
        for label, hdrs, want in (("sahib", oh, "owner"), ("dispetçer", dh, "dispatcher"),
                                  ("işçi", w1h, "member")):
            r = await rpc("brigade_role", {"p_brigade_id": B1}, hdrs)
            check(f"brigade_role ({label}) → çılpaq mətn \"{want}\"",
                  r.status_code == 200 and r.text == f'"{want}"' and data(r) == want,
                  f"{r.status_code} {r.text[:120]}")
        for label, hdrs in (("müştəri", ch), ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_role", {"p_brigade_id": B1}, hdrs)
            check(f"brigade_role (üzv olmayan: {label}) → null",
                  r.status_code in (200, 204) and data(r) is None,
                  f"{r.status_code} {r.text[:120]}")
        r = await rpc("brigade_role", {"p_brigade_id": nil}, oh)
        check("brigade_role (olmayan briqada) → null",
              r.status_code in (200, 204) and data(r) is None)
        await run("update brigade_members set is_active = false where id = :m", {"m": M_W2})
        r = await rpc("brigade_role", {"p_brigade_id": B1}, w2h)
        check("deaktiv üzv → null", data(r) is None, r.text[:120])
        await run("update brigade_members set is_active = true where id = :m", {"m": M_W2})
        r = await rpc("brigade_role", {"p_brigade_id": B1, "p_profile_id": owner}, w1h)
        check("üzv başqa üzvün rolunu görə bilir (p_profile_id)",
              r.status_code == 200 and data(r) == "owner", r.text[:120])
        r = await rpc("brigade_role", {"p_brigade_id": B1, "p_profile_id": owner}, ch)
        check("üzv olmayan başqasının rolunu soruşa bilmir → 403 42501",
              err(r, 403, "42501"), f"{r.status_code} {r.text[:160]}")
        r = await rpc("brigade_role", {"p_brigade_id": "uuid-deyil"}, oh)
        check("brigade_role: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await c.get("/rest/v1/rpc/brigade_role", params={"p_brigade_id": B1}, headers=dh)
        check("brigade_role GET ilə də işləyir (STABLE funksiya)",
              r.status_code == 200 and data(r) == "dispatcher", r.text[:120])

        # ══════════ 5. set_member_online ══════════
        print("\n── 5. set_member_online ──")

        async def online(mid: str):
            return await one("select is_online, last_heartbeat from brigade_members"
                             " where id = :m", {"m": mid})

        r = await rpc("set_member_online", {"p_is_online": True}, w1h)
        check("set_member_online(true) → 204, boş gövdə (returns void)",
              r.status_code == 204 and r.content == b"", f"{r.status_code} {r.text[:120]}")
        s1, s2 = await online(M_W1), await online(M_W2)
        check("yalnız çağıranın üzvlüyü online oldu + heartbeat yazıldı",
              s1.is_online is True and s1.last_heartbeat is not None
              and s2.is_online is False and s2.last_heartbeat is None, f"{s1} {s2}")
        r = await rpc("set_member_online", {"p_is_online": False}, w1h)
        check("set_member_online(false) → offline",
              r.status_code == 204 and (await online(M_W1)).is_online is False)
        r = await rpc("set_member_online", {"p_is_online": True}, ch)
        check("üzv olmayan çağırış → 204, heç bir sətir dəyişmir",
              r.status_code == 204
              and (await one("select count(*) as c from brigade_members"
                             " where is_online")).c == 0, r.text[:120])
        await run("update brigade_members set is_active = false where id = :m", {"m": M_W2})
        r = await rpc("set_member_online", {"p_is_online": True}, w2h)
        check("deaktiv üzvlük online edilmir",
              r.status_code == 204 and (await online(M_W2)).is_online is False)
        await run("update brigade_members set is_active = true where id = :m", {"m": M_W2})
        r = await rpc("set_member_online", {}, w1h)
        check("p_is_online yoxdur → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])
        r = await rpc("set_member_online", {"p_is_online": "bəli"}, w1h)
        check("boolean olmayan dəyər → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("set_member_online", {"p_is_online": None}, w1h)
        check("null → 400", r.status_code == 400 and (await online(M_W1)).is_online is False,
              r.text[:160])

        # ══════════ 6. brigade_top_up_from_owner ══════════
        print("\n── 6. brigade_top_up_from_owner ──")
        for label, hdrs, frag in (("dispetçer (sahib deyil)", dh, "Yalnız briqada sahibi"),
                                  ("işçi", w1h, "Yalnız briqada sahibi"),
                                  ("üzv olmayan", ch, "Yalnız briqada sahibi"),
                                  ("başqa briqadanın sahibi", xh, "Yalnız briqada sahibi")):
            r = await rpc("brigade_top_up_from_owner",
                          {"p_brigade_id": B1, "p_amount": 10}, hdrs)
            check(f"top-up rədd edilir: {label}", biz(r, frag), r.text[:160])
        r = await rpc("brigade_top_up_from_owner", {"p_brigade_id": B1, "p_amount": 500.01}, oh)
        check("şəxsi balansdan çox → INSUFFICIENT_BALANCE",
              biz(r, "INSUFFICIENT_BALANCE"), r.text[:160])
        for bad in (0, -5):
            r = await rpc("brigade_top_up_from_owner", {"p_brigade_id": B1, "p_amount": bad}, oh)
            check(f"məbləğ {bad} rədd edilir", biz(r), r.text[:160])
        r = await rpc("brigade_top_up_from_owner", {"p_brigade_id": B1, "p_amount": "abc"}, oh)
        check("ədəd olmayan məbləğ → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("brigade_top_up_from_owner", {"p_brigade_id": nil, "p_amount": 10}, oh)
        check("olmayan briqada → 'Briqada tapılmadı'", biz(r, "Briqada tapılmadı"), r.text[:160])
        check("uğursuz top-up cəhdləri balansları dəyişməyib",
              (await balances()) == (Decimal(0), Decimal(500), Decimal(0), Decimal(0))
              and (await one("select count(*) as c from transactions")).c == 0)

        r = await rpc("brigade_top_up_from_owner", {"p_brigade_id": B1, "p_amount": 120.5}, oh)
        d = data(r)
        check("brigade_top_up_from_owner → 200 {ok, brigade_balance, owner_balance}",
              r.status_code == 200 and isinstance(d, dict)
              and set(d) == {"ok", "brigade_balance", "owner_balance"} and d["ok"] is True,
              f"{r.status_code} {r.text[:200]}")
        check("balanslar JSON ədədidir: briqada 120.5, sahib 379.5",
              is_num(d["brigade_balance"]) and is_num(d["owner_balance"])
              and d["brigade_balance"] == 120.5 and d["owner_balance"] == 379.5, str(d))
        check("bazada: briqada +120.50, sahib −120.50",
              (await balances()) == (Decimal("120.50"), Decimal("379.50"),
                                     Decimal(0), Decimal(0)))
        tx = await rows("select user_id, type, amount, balance_after, related_id,"
                        " created_by from transactions")
        check("ledger: sahibdə admin_adjust −120.50, balance_after 379.50",
              len(tx) == 1 and str(tx[0].user_id) == owner and tx[0].type == "admin_adjust"
              and tx[0].amount == Decimal("-120.50")
              and tx[0].balance_after == Decimal("379.50")
              and tx[0].related_id == B1 and str(tx[0].created_by) == owner, str(tx))

        # ══════════ 7. brigade_place_offer ══════════
        print("\n── 7. brigade_place_offer ──")
        opp1 = await new_opp("Mənzil təmiri")
        opp2 = await new_opp("Hamam təmiri")
        own_opp = str((await run(
            "insert into opportunities (title, created_by, date, category_id, status)"
            " values ('Dispetçerin öz sifarişi', :u, '2026-12-20', :c, 'open')"
            " returning id", {"u": disp, "c": cat_id})).id)
        cust_offers_before = len(await notifs(cust, kind="new_offer"))

        for label, hdrs in (("işçi (member rolu)", w1h), ("üzv olmayan müştəri", ch),
                            ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_place_offer", {
                "p_brigade_id": B1, "p_opportunity_id": opp1, "p_amount": 200}, hdrs)
            check(f"təklif rədd edilir: {label}", biz(r, "Yalnız"), r.text[:160])
        for bad in (0, -1):
            r = await rpc("brigade_place_offer", {
                "p_brigade_id": B1, "p_opportunity_id": opp1, "p_amount": bad}, dh)
            check(f"təklif məbləği {bad} rədd edilir", biz(r, "müsbət"), r.text[:160])
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": opp1, "p_amount": 5000}, dh)
        check("komissiya üçün balans çatmır → mesajda NO_BALANCE",
              biz(r, "NO_BALANCE"), r.text[:200])
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": nil, "p_amount": 200}, dh)
        check("olmayan sifariş → 'Sifariş tapılmadı'", biz(r, "Sifariş tapılmadı"), r.text[:160])
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": own_opp, "p_amount": 200}, dh)
        check("öz sifarişinə briqada təklifi verilmir", biz(r, "Öz sifarişinizə"), r.text[:160])
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": "uuid-deyil", "p_amount": 200}, dh)
        check("place_offer: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        check("uğursuz cəhdlər təklif yaratmayıb",
              (await one("select count(*) as c from opportunities_offers")).c == 0)

        r = await rpc("brigade_place_offer", {  # BrigadeDispatchPanel.tsx göndərən kimi
            "p_brigade_id": B1, "p_opportunity_id": opp1, "p_amount": 200,
            "p_notes": "Sabah gələ bilərik"}, dh)
        d = data(r)
        check("brigade_place_offer → 200 {ok, offer_id, amount, required_balance}",
              r.status_code == 200 and isinstance(d, dict)
              and set(d) == {"ok", "offer_id", "amount", "required_balance"}
              and d["ok"] is True and is_uuid(d["offer_id"]),
              f"{r.status_code} {r.text[:200]}")
        check("amount=200, required_balance=20 (10% komissiya) — JSON ədədləri",
              is_num(d["amount"]) and is_num(d["required_balance"])
              and d["amount"] == 200 and d["required_balance"] == 20, str(d))
        off1 = d["offer_id"]
        o = await one("select * from opportunities_offers where id = :id", {"id": off1})
        check("təklif sətri: provider=dispetçer, brigade_id, 200.00, pending, qeyd",
              str(o.opportunity_id) == opp1 and str(o.provider_id) == disp
              and str(o.brigade_id) == B1 and o.offer_amount == Decimal("200.00")
              and o.status == "pending" and o.notes == "Sabah gələ bilərik", str(o))
        check("təklif vermək briqada balansından pul tutmur",
              (await balances())[0] == Decimal("120.50"))
        n = await notifs(cust, kind="new_offer")
        check("müştəriyə new_offer bildirişi (related_id=offer, link=/my-opportunities)",
              len(n) == cust_offers_before + 1 and n[-1].related_id == off1
              and n[-1].link == "/my-opportunities"
              and n[-1].title == "Yeni təklif: Dispetçer"
              and n[-1].body == "Mənzil təmiri — 200.00 ₼", str(n[-1:]))
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": opp1, "p_amount": 150}, oh)
        check("eyni sifarişə ikinci briqada təklifi rədd edilir",
              biz(r, "artıq bu sifarişə təklif verib"), r.text[:160])
        r = await rpc("brigade_place_offer", {
            "p_brigade_id": B1, "p_opportunity_id": opp2, "p_amount": "99.90"}, oh)
        d = data(r)
        check("sahib də təklif verə bilir; p_notes-suz; required_balance 9.99",
              r.status_code == 200 and d["amount"] == 99.9
              and d["required_balance"] == 9.99, r.text[:200])
        off2 = d["offer_id"]

        # ══════════ 8. brigade_dispatch_order ══════════
        print("\n── 8. brigade_dispatch_order ──")
        for label, hdrs in (("işçi (member rolu)", w1h), ("üzv olmayan müştəri", ch),
                            ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_dispatch_order", {
                "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1]}, hdrs)
            check(f"təyinat rədd edilir: {label}", biz(r, "Yalnız"), r.text[:160])
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": []}, dh)
        check("boş üzv siyahısı rədd edilir", biz(r, "member_id"), r.text[:160])
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_OUTS]}, dh)
        check("başqa briqadanın üzvünə təyinat rədd edilir", biz(r, "aid deyil"), r.text[:160])
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1, "uuid-deyil"]}, dh)
        check("siyahıda yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1],
            "p_priority": 11}, dh)
        check("prioritet 1..10 xaricində → 400 (23514 check pozuntusu)",
              err(r, 400, "23514"), f"{r.status_code} {r.text[:200]}")
        check("uğursuz cəhdlər təyinat yaratmayıb",
              (await one("select count(*) as c from brigade_assignments")).c == 0)

        r = await rpc("brigade_dispatch_order", {  # assignWorker(): yalnız 3 arqument
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1]}, dh)
        check("brigade_dispatch_order → 200 {ok: true, inserted: 1}",
              r.status_code == 200 and data(r) == {"ok": True, "inserted": 1}, r.text[:200])
        a1 = await one("select * from brigade_assignments where source_id = :s"
                       " and member_id = :m", {"s": off1, "m": M_W1})
        check("təyinat sətri: assigned, opportunity, prioritet 5 (DEFAULT), kim təyin etdi",
              a1 is not None and a1.status == "assigned" and a1.source_type == "opportunity"
              and a1.priority == 5 and a1.notes is None and str(a1.brigade_id) == B1
              and str(a1.assigned_by) == disp, str(a1))
        A1 = str(a1.id)
        n = await notifs(w1, kind="brigade_assignment")
        check("işçiyə brigade_assignment bildirişi (link=/account/master/incoming)",
              len(n) == 1 and n[0].related_id == A1
              and n[0].link == "/account/master/incoming"
              and n[0].title == "Ellit Briqada — yeni təyinat", str(n))
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1]}, dh)
        check("təkrar təyinat → inserted 0, ikinci bildiriş yoxdur",
              data(r) == {"ok": True, "inserted": 0}
              and len(await notifs(w1, kind="brigade_assignment")) == 1, r.text[:200])
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off1, "p_member_ids": [M_W1, M_W2],
            "p_priority": 8, "p_notes": "Təcili"}, oh)
        a2 = await one("select * from brigade_assignments where source_id = :s"
                       " and member_id = :m", {"s": off1, "m": M_W2})
        check("iki üzv (biri təkrar) → inserted 1; p_priority/p_notes yazılır",
              data(r) == {"ok": True, "inserted": 1} and a2.priority == 8
              and a2.notes == "Təcili" and str(a2.assigned_by) == owner, r.text[:200])
        A2 = str(a2.id)

        # ══════════ 9. brigade_assignment_respond / start / complete ══════════
        print("\n── 9. brigade_assignment_respond / start / complete ──")

        async def asg(aid: str):
            return await one("select status, responded_at, completed_at"
                             "  from brigade_assignments where id = :id", {"id": aid})

        # respond
        for label, hdrs in (("başqa işçi", w2h), ("dispetçer", dh), ("üzv olmayan", ch)):
            r = await rpc("brigade_assignment_respond",
                          {"p_assignment_id": A1, "p_action": "accept"}, hdrs)
            check(f"respond rədd edilir: {label}", biz(r, "Yalnız təyin olunmuş üzv"),
                  r.text[:160])
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A1, "p_action": "bəlkə"}, w1h)
        check("yanlış p_action rədd edilir", biz(r, "accept | decline"), r.text[:160])
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": nil, "p_action": "accept"}, w1h)
        check("olmayan təyinat → xəta", biz(r, "tapılmadı"), r.text[:160])
        r = await rpc("brigade_assignment_respond", {"p_assignment_id": A1}, w1h)
        check("p_action yoxdur → 404 PGRST202", err(r, 404, "PGRST202"), r.text[:160])
        check("uğursuz cəhdlərdən sonra status hələ assigned",
              (await asg(A1)).status == "assigned")
        r = await rpc("brigade_assignment_complete", {"p_assignment_id": A1}, w1h)
        check("assigned statusundan tamamlamaq olmaz", biz(r, "assigned"), r.text[:160])

        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A1, "p_action": "accept"}, w1h)
        s = await asg(A1)
        check("brigade_assignment_respond(accept) → 204 boş gövdə; status accepted",
              r.status_code == 204 and r.content == b"" and s.status == "accepted"
              and s.responded_at is not None, f"{r.status_code} {r.text[:120]} {s}")
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A1, "p_action": "decline"}, w1h)
        check("artıq cavablanmış təyinata təkrar cavab verilmir", biz(r, "accepted"),
              r.text[:160])
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A2, "p_action": "decline"}, w2h)
        check("brigade_assignment_respond(decline) → 204; status declined",
              r.status_code == 204 and (await asg(A2)).status == "declined", r.text[:120])

        # start
        for label, hdrs in (("başqa işçi", w2h), ("dispetçer", dh), ("üzv olmayan", ch)):
            r = await rpc("brigade_assignment_start", {"p_assignment_id": A1}, hdrs)
            check(f"start rədd edilir: {label}", biz(r, "Yalnız təyin olunmuş üzv"),
                  r.text[:160])
        r = await rpc("brigade_assignment_start", {"p_assignment_id": A2}, w2h)
        check("declined təyinatı başlatmaq olmaz", biz(r, "declined"), r.text[:160])
        r = await rpc("brigade_assignment_start", {"p_assignment_id": "uuid-deyil"}, w1h)
        check("start: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("brigade_assignment_start", {"p_assignment_id": A1}, w1h)
        check("brigade_assignment_start → 204 boş gövdə; status in_progress",
              r.status_code == 204 and r.content == b""
              and (await asg(A1)).status == "in_progress", f"{r.status_code} {r.text[:120]}")
        r = await rpc("brigade_assignment_start", {"p_assignment_id": A1}, w1h)
        check("artıq başlamış iş təkrar başlamır", biz(r, "in_progress"), r.text[:160])

        # complete
        for label, hdrs in (("başqa işçi (dispetçer deyil)", w2h), ("üzv olmayan", ch),
                            ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_assignment_complete", {"p_assignment_id": A1}, hdrs)
            check(f"complete rədd edilir: {label}", biz(r, "İcazə yoxdur"), r.text[:160])
        check("rədd edilən cəhdlərdən sonra status hələ in_progress",
              (await asg(A1)).status == "in_progress")
        r = await rpc("brigade_assignment_complete", {"p_assignment_id": nil}, w1h)
        check("complete: olmayan təyinat → xəta", biz(r, "tapılmadı"), r.text[:160])
        r = await rpc("brigade_assignment_complete", {"p_assignment_id": A1}, w1h)
        s = await asg(A1)
        check("brigade_assignment_complete (üzv özü) → 204 boş gövdə; completed",
              r.status_code == 204 and r.content == b"" and s.status == "completed"
              and s.completed_at is not None, f"{r.status_code} {r.text[:120]} {s}")
        r = await rpc("brigade_assignment_complete", {"p_assignment_id": A1}, w1h)
        check("artıq tamamlanmış təyinat təkrar tamamlanmır", biz(r, "completed"),
              r.text[:160])
        # dispetçer başqa işçinin qəbul etdiyi işi tamamlaya bilir
        r = await rpc("brigade_dispatch_order", {
            "p_brigade_id": B1, "p_source_id": off2, "p_member_ids": [M_W2]}, dh)
        A3 = str((await one("select id from brigade_assignments where source_id = :s",
                            {"s": off2})).id)
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A3, "p_action": "accept"}, w2h)
        r = await rpc("brigade_assignment_complete", {"p_assignment_id": A3}, dh)
        check("brigade_assignment_complete (dispetçer) → 204; completed",
              r.status_code == 204 and (await asg(A3)).status == "completed", r.text[:120])

        # ══════════ 10. brigade_dispatch_assign ══════════
        print("\n── 10. brigade_dispatch_assign ──")
        opp3 = await new_opp("Kondisioner quraşdırma")
        opp4 = await new_opp("Elektrik xətti")
        opp5 = await new_opp("Boya işi")
        base = {"p_brigade_id": B1, "p_opportunity_id": opp3, "p_member_id": M_W1,
                "p_amount": 300, "p_notes": None}   # dispatchOrder() göndərən kimi

        for label, hdrs in (("işçi (member rolu)", w1h), ("üzv olmayan müştəri", ch),
                            ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_dispatch_assign", base, hdrs)
            check(f"yönləndirmə rədd edilir: {label}", biz(r, "Yalnız"), r.text[:160])
        r = await rpc("brigade_dispatch_assign", {**base, "p_amount": 0}, dh)
        check("məbləğ 0 rədd edilir", biz(r, "müsbət"), r.text[:160])
        r = await rpc("brigade_dispatch_assign", {**base, "p_opportunity_id": nil}, dh)
        check("olmayan sifariş → xəta", biz(r, "Sifariş tapılmadı"), r.text[:160])
        r = await rpc("brigade_dispatch_assign", {**base, "p_opportunity_id": own_opp}, dh)
        check("öz sifarişini yönləndirmək olmaz", biz(r, "Öz sifarişinizi"), r.text[:160])
        r = await rpc("brigade_dispatch_assign", {**base, "p_member_id": M_OUTS}, dh)
        check("başqa briqadanın üzvünə yönləndirmək olmaz",
              biz(r, "aktiv üzvü deyil"), r.text[:160])
        r = await rpc("brigade_dispatch_assign", {**base, "p_amount": 5000}, dh)
        check("komissiya üçün balans çatmır → mesajda NO_BALANCE",
              biz(r, "NO_BALANCE"), r.text[:200])
        r = await rpc("brigade_dispatch_assign", {**base, "p_member_id": "uuid-deyil"}, dh)
        check("dispatch_assign: yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        check("uğursuz cəhdlər bu sifarişə təklif/təyinat yaratmayıb",
              (await one("select count(*) as c from opportunities_offers"
                         " where opportunity_id = :o", {"o": opp3})).c == 0
              and (await one("select count(*) as c from brigade_assignments"
                             " where source_id = :o", {"o": opp3})).c == 0)

        cust_n = len(await notifs(cust, kind="new_offer"))
        w1_n = len(await notifs(w1, kind="brigade_assignment"))
        r = await rpc("brigade_dispatch_assign", base, dh)
        d = data(r)
        DA_KEYS = {"ok", "offer_id", "assignment_id", "provider_id", "amount",
                   "required_balance", "rerouted"}
        check("brigade_dispatch_assign → 200, sahələr tam",
              r.status_code == 200 and isinstance(d, dict) and set(d) == DA_KEYS,
              f"{r.status_code} {r.text[:240]}")
        check("ok true, id-lər uuid, provider_id = işçinin profili, rerouted false",
              d["ok"] is True and is_uuid(d["offer_id"]) and is_uuid(d["assignment_id"])
              and d["provider_id"] == w1 and d["rerouted"] is False, str(d))
        check("amount=300, required_balance=30 — JSON ədədləri",
              is_num(d["amount"]) and is_num(d["required_balance"])
              and d["amount"] == 300 and d["required_balance"] == 30, str(d))
        off3, A4 = d["offer_id"], d["assignment_id"]
        o = await one("select * from opportunities_offers where id = :id", {"id": off3})
        a = await one("select * from brigade_assignments where id = :id", {"id": A4})
        check("təklif işçinin adından (provider=işçi), briqada ilə, 300.00 pending",
              str(o.provider_id) == w1 and str(o.brigade_id) == B1
              and str(o.opportunity_id) == opp3 and o.offer_amount == Decimal("300.00")
              and o.status == "pending", str(o))
        check("təyinat: işçi 1, assigned, source=sifariş, assigned_by=dispetçer",
              str(a.member_id) == M_W1 and a.status == "assigned"
              and a.source_id == opp3 and a.source_type == "opportunity"
              and str(a.assigned_by) == disp, str(a))
        n = await notifs(w1, kind="brigade_assignment")
        check("işçiyə təyinat bildirişi (sifarişin başlığı ilə)",
              len(n) == w1_n + 1 and n[-1].related_id == A4
              and n[-1].body == "Kondisioner quraşdırma — sənə təyin edildi", str(n[-1:]))
        n = await notifs(cust, kind="new_offer")
        check("müştəriyə new_offer bildirişi işçinin adı ilə",
              len(n) == cust_n + 1 and n[-1].related_id == off3
              and n[-1].title == "Yeni təklif: İşçi Bir", str(n[-1:]))
        check("yönləndirmə briqada balansından pul tutmur",
              (await balances())[0] == Decimal("120.50"))

        # re-route: 10 saniyə cooldown
        r = await rpc("brigade_dispatch_assign", {**base, "p_member_id": M_W2}, dh)
        check("dərhal başqa işçiyə dəyişmək → mesajda COOLDOWN",
              biz(r, "COOLDOWN"), r.text[:200])
        check("cooldown zamanı köhnə təyinat toxunulmaz qalır",
              (await asg(A4)).status == "assigned")
        await run("update brigade_assignments set assigned_at = now() - interval"
                  " '11 seconds' where id = :id", {"id": A4})
        r = await rpc("brigade_dispatch_assign",
                      {**base, "p_member_id": M_W2, "p_amount": 320.5,
                       "p_notes": "İşçi dəyişdi"}, oh)
        d = data(r)
        check("cooldown-dan sonra re-route → rerouted true, eyni təklif, yeni təyinat",
              r.status_code == 200 and set(d) == DA_KEYS and d["rerouted"] is True
              and d["offer_id"] == off3 and d["assignment_id"] != A4
              and d["provider_id"] == w2 and d["amount"] == 320.5
              and d["required_balance"] == 32.05, r.text[:240])
        A5 = d["assignment_id"]
        o = await one("select * from opportunities_offers where id = :id", {"id": off3})
        check("köhnə təyinat cancelled; təklif yeni işçiyə keçdi (320.50, qeyd)",
              (await asg(A4)).status == "cancelled" and str(o.provider_id) == w2
              and o.offer_amount == Decimal("320.50") and o.notes == "İşçi dəyişdi"
              and (await one("select count(*) as c from opportunities_offers"
                             " where opportunity_id = :o", {"o": opp3})).c == 1, str(o))
        check("re-route müştəriyə ikinci new_offer bildirişi yazmır (təklif yenilənir)",
              len(await notifs(cust, kind="new_offer")) == cust_n + 1)
        # işçi qəbul etdikdən sonra dəyişmək olmaz
        r = await rpc("brigade_assignment_respond",
                      {"p_assignment_id": A5, "p_action": "accept"}, w2h)
        check("yeni işçi təyinatı qəbul etdi", r.status_code == 204, r.text[:120])
        await run("update brigade_assignments set assigned_at = now() - interval"
                  " '11 seconds' where id = :id", {"id": A5})
        r = await rpc("brigade_dispatch_assign", {**base, "p_member_id": M_W1}, dh)
        check("qəbul edilmiş işdə işçini dəyişmək olmaz",
              biz(r, "işçini dəyişmək olmaz"), r.text[:200])

        # başqa briqada artıq götürüb → ALREADY_TAKEN
        await run("insert into brigade_assignments (brigade_id, member_id, source_type,"
                  " source_id, status) values (:b, :m, 'opportunity', :s, 'accepted')",
                  {"b": B2, "m": M_OUTS, "s": opp4})
        r = await rpc("brigade_dispatch_assign", {**base, "p_opportunity_id": opp4}, dh)
        check("başqa briqadanın götürdüyü sifariş → mesajda ALREADY_TAKEN",
              biz(r, "ALREADY_TAKEN"), r.text[:200])
        # p_notes göndərilməsə də işləyir (DEFAULT NULL)
        r = await rpc("brigade_dispatch_assign", {
            "p_brigade_id": B1, "p_opportunity_id": opp5, "p_member_id": M_W1,
            "p_amount": "50"}, oh)
        d = data(r)
        check("p_notes-suz çağırış (sahib) → ok, required_balance 5",
              r.status_code == 200 and d["ok"] is True and d["amount"] == 50
              and d["required_balance"] == 5 and d["rerouted"] is False, r.text[:240])

        # ══════════ 11. brigade_distribute_balance ══════════
        print("\n── 11. brigade_distribute_balance ──")
        before = await balances()
        tx_before = (await one("select count(*) as c from transactions")).c
        check("bölgüdən əvvəl: briqada 120.50, sahib 379.50, işçilər 0",
              before == (Decimal("120.50"), Decimal("379.50"), Decimal(0), Decimal(0)),
              str(before))
        alloc = [{"profile_id": w1, "amount": 20.25}, {"profile_id": w2, "amount": 30}]

        for label, hdrs in (("dispetçer (sahib deyil)", dh), ("işçi", w1h),
                            ("üzv olmayan", ch), ("başqa briqadanın sahibi", xh)):
            r = await rpc("brigade_distribute_balance",
                          {"p_brigade_id": B1, "p_allocations": alloc}, hdrs)
            check(f"bölgü rədd edilir: {label}",
                  biz(r, "Yalnız briqada sahibi pul bölgüsü edə bilər"), r.text[:160])
        r = await rpc("brigade_distribute_balance",
                      {"p_brigade_id": B1, "p_allocations": []}, oh)
        check("boş bölgü siyahısı rədd edilir", biz(r, "Bölgü siyahısı boşdur"), r.text[:160])
        r = await rpc("brigade_distribute_balance",
                      {"p_brigade_id": B1, "p_allocations": None}, oh)
        check("null bölgü siyahısı rədd edilir", biz(r, "Bölgü siyahısı boşdur"), r.text[:160])
        r = await rpc("brigade_distribute_balance", {
            "p_brigade_id": B1,
            "p_allocations": [{"profile_id": w1, "amount": 100},
                              {"profile_id": w2, "amount": 20.51}]}, oh)
        check("cəm briqada balansından çoxdur → mesajda NO_BALANCE",
              biz(r, "NO_BALANCE"), r.text[:200])
        r = await rpc("brigade_distribute_balance", {
            "p_brigade_id": B1,
            "p_allocations": [{"profile_id": w1, "amount": 10},
                              {"profile_id": cust, "amount": 10}]}, oh)
        check("üzv olmayan profilə pay rədd edilir", biz(r, "aktiv üzvü deyil"), r.text[:160])
        for bad in (0, -3):
            r = await rpc("brigade_distribute_balance", {
                "p_brigade_id": B1, "p_allocations": [{"profile_id": w1, "amount": bad}]}, oh)
            check(f"pay məbləği {bad} rədd edilir", biz(r, "müsbət"), r.text[:160])
        r = await rpc("brigade_distribute_balance", {
            "p_brigade_id": B1, "p_allocations": [{"profile_id": "uuid-deyil", "amount": 5}]}, oh)
        check("bölgüdə yanlış uuid → 400 22P02", err(r, 400, "22P02"), r.text[:160])
        r = await rpc("brigade_distribute_balance",
                      {"p_brigade_id": nil, "p_allocations": alloc}, oh)
        check("olmayan briqada → 'Briqada tapılmadı'", biz(r, "Briqada tapılmadı"), r.text[:160])
        check("uğursuz cəhdlər balans və ledger-i dəyişməyib",
              (await balances()) == before
              and (await one("select count(*) as c from transactions")).c == tx_before)

        r = await rpc("brigade_distribute_balance",   # BrigadeBalanceTab.tsx göndərən kimi
                      {"p_brigade_id": B1, "p_allocations": alloc}, oh)
        d = data(r)
        check("brigade_distribute_balance → 200 {ok, total, count, brigade_balance}",
              r.status_code == 200 and isinstance(d, dict)
              and set(d) == {"ok", "total", "count", "brigade_balance"} and d["ok"] is True,
              f"{r.status_code} {r.text[:200]}")
        check("total 50.25, count 2, brigade_balance 70.25 — JSON ədədləri",
              is_num(d["total"]) and is_num(d["brigade_balance"])
              and isinstance(d["count"], int) and d["total"] == 50.25
              and d["count"] == 2 and d["brigade_balance"] == 70.25, str(d))
        check("bazada: briqada 70.25, işçi1 +20.25, işçi2 +30.00, sahibin şəxsi balansı eyni",
              (await balances()) == (Decimal("70.25"), Decimal("379.50"),
                                     Decimal("20.25"), Decimal("30.00")),
              str(await balances()))
        tx = await rows("select user_id, amount, balance_after, description, related_id,"
                        " created_by from transactions where type = 'brigade_payout'"
                        " order by amount")
        got = {str(t.user_id): t for t in tx}
        check("ledger: 3 brigade_payout sətri (2 üzv + sahibdə −cəm)",
              len(tx) == 3 and set(got) == {owner, w1, w2}
              and got[w1].amount == Decimal("20.25")
              and got[w1].balance_after == Decimal("20.25")
              and got[w2].amount == Decimal("30.00")
              and got[w2].balance_after == Decimal("30.00")
              and got[owner].amount == Decimal("-50.25")
              and got[owner].balance_after == Decimal("70.25")
              and got[owner].description == "Üzvlərə pul bölgüsü (2 nəfər)"
              and all(t.related_id == B1 and str(t.created_by) == owner for t in tx),
              str(tx))
        r = await rpc("brigade_distribute_balance", {
            "p_brigade_id": B1, "p_allocations": [{"profile_id": w1, "amount": 70.26}]}, oh)
        check("qalıqdan 1 qəpik çox bölmək olmaz (NO_BALANCE), balans 70.25 qalır",
              biz(r, "NO_BALANCE") and (await balances())[0] == Decimal("70.25"),
              r.text[:200])

    print("\nRPC BRİQADA TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
