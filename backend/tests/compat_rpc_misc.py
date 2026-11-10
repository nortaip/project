"""Şikayət / KYC / parol RPC-ləri + keçmiş edge function-lar (Supabase-uyğun qat).

  * `/rest/v1/rpc/<ad>` — app/compat/rpc_misc.py:
      open_dispute, add_dispute_evidence, submit_kyc, submit_kyc_renewal,
      request_password_reset_otp, request_password_reset_email,
      reset_password_with_otp, request_password_change_otp,
      verify_password_change_otp
  * `/functions/v1/<ad>` — app/compat/functions.py:
      create-payment-session, verify-payment, payment-webhook,
      process-withdrawal, delete-account, admin-change-password,
      ai-question-generator, ai-price-research

Hər çağırış real HTTP marşrutundan keçir; cavabın forması klientlərin oxuduğu
sahələrlə (src/lib/disputeService.ts, kycService.ts, ForgotPassword.tsx,
BalancePage.tsx, CustomerBalance.tsx, Result.tsx, WithdrawalsPage.tsx,
QuestionsAdmin.tsx, PricesAdmin.tsx; Dart: dispute_service, kyc_service,
change_password_screen, supabase_service, settings) bir-bir müqayisə olunur.
Epoint API saxta HTTP nəqliyyatı ilə əvəz olunur (imza hər sorğuda yoxlanır);
e-poçt lokal SMTP tutucusuna gedir.

Təmiz bazada işə salın (DATABASE_URL/REDIS_URL env ilə):
    python3 tests/compat_rpc_misc.py
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import re
import sys
import types
import uuid
from decimal import Decimal
from urllib.parse import parse_qs

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SMTP_PORT = 58113
os.environ.setdefault("SMTP_HOST", "127.0.0.1")
os.environ.setdefault("SMTP_PORT", str(SMTP_PORT))
os.environ.setdefault("SMTP_SECURITY", "none")
os.environ.setdefault("RATE_LIMIT_AUTH", "1000/minute")
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")

import httpx  # noqa: E402
from aiosmtpd.controller import Controller  # noqa: E402

PASSWORD = "Guclu!Parol1"
EP_PUBLIC, EP_PRIVATE = "i000000001", "test_epoint_private"
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra if not cond else ''}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name} {extra}")


def is_uuid(v) -> bool:
    return isinstance(v, str) and bool(UUID_RE.match(v))


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


class _Inbox:
    def __init__(self) -> None:
        self.messages: list[tuple[str, str]] = []

    async def handle_DATA(self, server, session, envelope):  # noqa: N802, ANN001
        self.messages.append((envelope.rcpt_tos[0], envelope.content.decode("utf-8", "replace")))
        return "250 OK"

    def last_code(self, to: str) -> str:
        import email
        import email.policy

        for rcpt, content in reversed(self.messages):
            if rcpt == to:
                msg = email.message_from_string(content, policy=email.policy.default)
                body = msg.get_body(preferencelist=("plain",))
                return re.search(r"\b(\d{6})\b", body.get_content()).group(1)
        raise AssertionError(f"{to} üçün məktub yoxdur")


class FakeEpoint:
    """Epoint API-nin saxtası: imzanı yoxlayır, sorğuları yadda saxlayır,
    cavabı endpoint-ə görə `self.next` lüğətindən verir."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict]] = []
        self.next: dict[str, tuple[int, dict]] = {}
        self.bad_signatures = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        endpoint = request.url.path.rsplit("/", 1)[-1]
        form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
        data, sig = form.get("data", ""), form.get("signature", "")
        good = base64.b64encode(hashlib.sha1(
            f"{EP_PRIVATE}{data}{EP_PRIVATE}".encode()).digest()).decode()
        if sig != good:
            self.bad_signatures += 1
            return httpx.Response(400, json={"status": "error", "message": "bad signature"})
        payload = json.loads(base64.b64decode(data))
        self.calls.append((endpoint, payload))
        status, body = self.next.get(endpoint, (500, {"status": "error"}))
        return httpx.Response(status, json=body)

    def last(self, endpoint: str) -> dict:
        for ep, p in reversed(self.calls):
            if ep == endpoint:
                return p
        raise AssertionError(f"{endpoint} çağırılmayıb")


def signed(payload: dict) -> dict:
    data = base64.b64encode(json.dumps(payload).encode()).decode()
    sig = base64.b64encode(hashlib.sha1(
        f"{EP_PRIVATE}{data}{EP_PRIVATE}".encode()).digest()).decode()
    return {"data": data, "signature": sig}


async def main() -> None:
    from sqlalchemy import text

    import app.compat.functions as fn_mod
    import app.services.epoint as ep_mod
    from app.compat import rpc as registry
    from app.core.config import settings
    from app.db.session import SessionLocal
    from app.main import app

    # ── Epoint saxta nəqliyyat (real imzalama/forma kodlaşdırması işləyir) ──
    fake = FakeEpoint()
    mock = httpx.MockTransport(fake.handler)
    real_client = httpx.AsyncClient
    shim = types.SimpleNamespace(
        AsyncClient=lambda **kw: real_client(transport=mock, **kw))
    fn_mod.httpx = shim
    ep_mod.httpx = shim

    inbox = _Inbox()
    smtp = Controller(inbox, hostname="127.0.0.1", port=SMTP_PORT)
    smtp.start()

    async def q(sql: str, **params):
        async with SessionLocal() as db:
            r = (await db.execute(text(sql), params)).first()
            await db.commit()
            return r

    async def exe(sql: str, **params) -> None:
        async with SessionLocal() as db:
            await db.execute(text(sql), params)
            await db.commit()

    async def notif_code(user_id: str) -> str:
        row = await q("select body from notifications where user_id = :u"
                      " and type = 'password_otp' order by created_at desc limit 1", u=user_id)
        return re.search(r"\b(\d{6})\b", row.body).group(1)

    transport = httpx.ASGITransport(app=app)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            ANON = {"apikey": "anon-key-from-client"}

            async def rpc(name: str, args: dict | None = None, h: dict | None = None):
                return await c.post(f"/rest/v1/rpc/{name}", json=args or {},
                                    headers={**ANON, **(h or {})})

            async def fn(name: str, body=None, h: dict | None = None, raw: bytes | None = None):
                headers = {**ANON, **(h or {})}
                if raw is not None:
                    return await c.post(f"/functions/v1/{name}", content=raw,
                                        headers={**headers, "content-type": "application/json"})
                if body is None:
                    return await c.post(f"/functions/v1/{name}", headers=headers)
                return await c.post(f"/functions/v1/{name}", json=body, headers=headers)

            async def register(key: str, name: str, role: str = "customer") -> dict:
                email = f"{key}@rpc-misc.az"
                r = await c.post("/api/v1/auth/register", json={
                    "email": email, "password": PASSWORD, "name": name, "role": role})
                check(f"qeydiyyat: {name}", r.status_code == 201, r.text[:160])
                u = r.json()
                u.update(email=email, name=name, password=PASSWORD,
                         h={"Authorization": f"Bearer {u['access_token']}"})
                return u

            async def login(u: dict, pw: str | None = None) -> httpx.Response:
                r = await c.post("/api/v1/auth/login",
                                 json={"email": u["email"], "password": pw or u["password"]})
                if r.status_code == 200:
                    u.update(r.json())
                    u["h"] = {"Authorization": f"Bearer {u['access_token']}"}
                return r

            print("── Qeydiyyat + seed ──")
            cust = await register("musteri", "Müştəri Aysel")
            prov = await register("usta", "Usta Rəşad", "provider")
            other = await register("kenar", "Kənar Şəxs")
            prov2 = await register("usta2", "Usta İki", "provider")
            adm = await register("admin", "Admin")
            await exe("update users set role='admin' where id=:u", u=adm["user_id"])
            await exe("update profiles set role='admin' where id=:u", u=adm["user_id"])
            check("admin yenidən giriş", (await login(adm)).status_code == 200)
            await exe("insert into platform_config (key, value) values"
                      " ('commission_on_withdrawal', '2'), ('min_withdrawal_amount', '1')"
                      " on conflict (key) do update set value = excluded.value")
            await exe("update profiles set balance = 500 where id = :u", u=prov["user_id"])
            await exe("update profiles set balance = 100 where id = :u", u=prov2["user_id"])

            async def opp(status: str, completed_ago: int | None = 1,
                          offer: str | None = "accepted", provider=None) -> str:
                o = await q(
                    "insert into opportunities (title, created_by, provider_id, date, status,"
                    " completed_at) values ('Kran təmiri', :c, :p, current_date, :s,"
                    " now() - make_interval(hours => :ago)) returning id",
                    c=cust["user_id"], p=provider or prov["user_id"], s=status,
                    ago=completed_ago or 0)
                if offer:
                    await exe("insert into opportunities_offers (opportunity_id, provider_id,"
                              " offer_amount, status) values (:o, :p, 80, :s)",
                              o=o.id, p=provider or prov["user_id"], s=offer)
                return str(o.id)

            registered = set(registry.registered())
            for name in ("open_dispute", "add_dispute_evidence", "submit_kyc",
                         "submit_kyc_renewal", "request_password_reset_otp",
                         "request_password_reset_email", "reset_password_with_otp",
                         "request_password_change_otp", "verify_password_change_otp"):
                check(f"RPC qeydiyyatdadır: {name}", name in registered)

            # ══════════════════════ ŞİKAYƏTLƏR ══════════════════════
            print("── open_dispute ──")
            opp_ok = await opp("completed")
            args = {"p_opportunity_id": opp_ok, "p_reason": "poor_quality",
                    "p_description": "İş keyfiyyətsiz görülüb, kran yenə sızır."}
            r = await rpc("open_dispute", args)
            check("anonim → 401 42501", r.status_code == 401 and r.json()["code"] == "42501",
                  r.text)
            r = await rpc("open_dispute", {"p_opportunity_id": opp_ok}, cust["h"])
            check("çatışmayan arqument → 404 PGRST202",
                  r.status_code == 404 and r.json()["code"] == "PGRST202")
            r = await rpc("open_dispute", {**args, "p_opportunity_id": "yox"}, cust["h"])
            check("uuid olmayan id → 400 22P02",
                  r.status_code == 400 and r.json()["code"] == "22P02", r.text)
            r = await rpc("open_dispute", {**args, "p_opportunity_id": str(uuid.uuid4())},
                          cust["h"])
            check("olmayan sifariş → {ok:false, error:OPPORTUNITY_NOT_FOUND}",
                  r.status_code == 200
                  and r.json() == {"ok": False, "error": "OPPORTUNITY_NOT_FOUND"}, r.text)
            o2 = await opp("ongoing", None)
            r = await rpc("open_dispute", {**args, "p_opportunity_id": o2}, cust["h"])
            check("tamamlanmamış → OPPORTUNITY_NOT_COMPLETED + current_status",
                  r.json() == {"ok": False, "error": "OPPORTUNITY_NOT_COMPLETED",
                               "current_status": "ongoing"}, r.text)
            o3 = await opp("completed", 30)
            r = await rpc("open_dispute", {**args, "p_opportunity_id": o3}, cust["h"])
            d = r.json()
            check("24 saat keçib → DISPUTE_WINDOW_EXPIRED + hours_passed (ədəd)",
                  d["ok"] is False and d["error"] == "DISPUTE_WINDOW_EXPIRED"
                  and is_num(d["hours_passed"]) and 29.5 < d["hours_passed"] < 30.5, r.text)
            r = await rpc("open_dispute", args, other["h"])
            check("tərəf olmayan → NOT_AUTHORIZED",
                  r.json() == {"ok": False, "error": "NOT_AUTHORIZED"}, r.text)
            o4 = await opp("completed", 1, offer=None)
            r = await rpc("open_dispute", {**args, "p_opportunity_id": o4}, cust["h"])
            check("qəbul olunmuş təklif yoxdur → NO_ACCEPTED_OFFER",
                  r.json() == {"ok": False, "error": "NO_ACCEPTED_OFFER"}, r.text)
            r = await rpc("open_dispute", {**args, "p_reason": "bilinmir"}, cust["h"])
            check("yanlış səbəb → 400 23514 (CHECK, SQL-də də exception idi)",
                  r.status_code == 400 and r.json()["code"] == "23514", r.text)
            r = await rpc("open_dispute", {**args, "p_description": "qısa"}, cust["h"])
            check("qısa təsvir → 400 23514", r.status_code == 400
                  and r.json()["code"] == "23514", r.text)
            check("uğursuz cəhdlər sifarişi dəyişmədi",
                  (await q("select status from opportunities where id=:o", o=opp_ok)).status
                  == "completed")

            r = await rpc("open_dispute", args, cust["h"])
            d = r.json()
            check("müştəri şikayət açır → {ok, dispute_id, opportunity_id}",
                  r.status_code == 200 and d["ok"] is True and is_uuid(d["dispute_id"])
                  and d["opportunity_id"] == opp_ok and set(d) == {
                      "ok", "dispute_id", "opportunity_id"}, r.text)
            dispute_id = d["dispute_id"]
            row = await q("select raised_by, against_user, reason, status, offer_id"
                          " from disputes where id=:d", d=dispute_id)
            check("dispute sətri: raised_by=müştəri, against=usta, open",
                  str(row.raised_by) == cust["user_id"]
                  and str(row.against_user) == prov["user_id"]
                  and row.reason == "poor_quality" and row.status == "open")
            check("sifariş → disputed", (await q(
                "select status from opportunities where id=:o", o=opp_ok)).status == "disputed")
            check("ustaya dispute_opened bildirişi", (await q(
                "select count(*) as n from notifications where user_id=:u"
                " and type='dispute_opened'", u=prov["user_id"])).n == 1)
            r = await rpc("open_dispute", args, prov["h"])
            check("artıq disputed → OPPORTUNITY_NOT_COMPLETED",
                  r.json()["error"] == "OPPORTUNITY_NOT_COMPLETED")
            await exe("update opportunities set status='completed' where id=:o", o=opp_ok)
            r = await rpc("open_dispute", args, prov["h"])
            check("aktiv şikayət var → DISPUTE_ALREADY_OPEN",
                  r.json() == {"ok": False, "error": "DISPUTE_ALREADY_OPEN"}, r.text)
            await exe("update opportunities set status='disputed' where id=:o", o=opp_ok)

            print("── add_dispute_evidence ──")
            ev = {"p_dispute_id": dispute_id,
                  "p_file_path": f"{dispute_id}/{prov['user_id']}/1_foto.jpg",
                  "p_file_type": "image", "p_size_bytes": 12345}
            r = await rpc("add_dispute_evidence", ev)
            check("anonim → 401", r.status_code == 401)
            r = await rpc("add_dispute_evidence", ev, prov["h"])
            check("qarşı tərəf sübut əlavə edir → {ok:true}",
                  r.status_code == 200 and r.json() == {"ok": True}, r.text)
            ev2 = {k: v for k, v in ev.items() if k != "p_size_bytes"}
            ev2["p_file_path"] = f"{dispute_id}/{cust['user_id']}/2_video.mp4"
            r = await rpc("add_dispute_evidence", {**ev2, "p_file_type": "video"}, cust["h"])
            check("p_size_bytes defoltludur (verilməyə bilər)", r.json() == {"ok": True}, r.text)
            rows = await q("select count(*) as n, max(size_bytes) as s,"
                           " count(*) filter (where uploaded_by = :p) as by_p"
                           " from dispute_attachments where dispute_id=:d",
                           d=dispute_id, p=prov["user_id"])
            check("2 sübut sətri, uploaded_by token-dən", rows.n == 2 and rows.s == 12345
                  and rows.by_p == 1)
            r = await rpc("add_dispute_evidence", ev, other["h"])
            check("tərəf olmayan → NOT_AUTHORIZED",
                  r.json() == {"ok": False, "error": "NOT_AUTHORIZED"})
            r = await rpc("add_dispute_evidence", {**ev, "p_dispute_id": str(uuid.uuid4())},
                          prov["h"])
            check("olmayan şikayət → DISPUTE_NOT_FOUND",
                  r.json() == {"ok": False, "error": "DISPUTE_NOT_FOUND"})
            await exe("update disputes set status='resolved_customer' where id=:d", d=dispute_id)
            r = await rpc("add_dispute_evidence", ev, prov["h"])
            check("bağlı şikayət → DISPUTE_CLOSED",
                  r.json() == {"ok": False, "error": "DISPUTE_CLOSED"})
            check("bağlı şikayətə sətir yazılmadı", (await q(
                "select count(*) as n from dispute_attachments where dispute_id=:d",
                d=dispute_id)).n == 2)

            # ══════════════════════ KYC ══════════════════════
            print("── submit_kyc ──")
            u = cust["user_id"]
            kyc = {"p_id_front_path": f"{u}/1_id_front.jpg",
                   "p_id_back_path": f"{u}/1_id_back.jpg",
                   "p_selfie_path": f"{u}/1_selfie.jpg"}
            r = await rpc("submit_kyc", kyc)
            check("anonim → 401", r.status_code == 401)
            r = await rpc("submit_kyc", {**kyc, "p_selfie_path": f"{prov['user_id']}/x.jpg"},
                          cust["h"])
            check("başqasının qovluğu → INVALID_PATH",
                  r.json() == {"ok": False, "error": "INVALID_PATH"}, r.text)
            r = await rpc("submit_kyc", kyc, cust["h"])
            d = r.json()
            check("göndəriş (yalnız məcburi arqumentlər) → {ok, verification_id, status}",
                  d["ok"] is True and is_uuid(d["verification_id"]) and d["status"] == "pending"
                  and set(d) == {"ok", "verification_id", "status"}, r.text)
            first_vid = d["verification_id"]
            r = await rpc("submit_kyc", {**kyc, "p_full_name": "Aysel Məmmədova",
                                         "p_id_number": "AA1234567",
                                         "p_birth_date": "1990-05-01"}, cust["h"])
            d = r.json()
            check("təkrar göndəriş (tam arqumentlər) qəbul olunur", d["ok"] is True, r.text)
            row = await q("select full_name_on_id, id_number, birth_date::text as b, status"
                          " from provider_verifications where id=:v", v=d["verification_id"])
            check("ad/nömrə/doğum tarixi yazıldı", row.full_name_on_id == "Aysel Məmmədova"
                  and row.id_number == "AA1234567" and row.b == "1990-05-01"
                  and row.status == "pending")
            check("əvvəlki pending → cancelled", (await q(
                "select status from provider_verifications where id=:v", v=first_vid)).status
                  == "cancelled")
            check("profil verification_status=pending", (await q(
                "select verification_status from profiles where id=:u", u=u)
            ).verification_status == "pending")
            r = await rpc("submit_kyc", {**kyc, "p_birth_date": "dünən"}, cust["h"])
            check("yanlış tarix → 400", r.status_code == 400, r.text)

            print("── submit_kyc_renewal ──")
            p = prov["user_id"]
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{u}/2_selfie.jpg"})
            check("anonim → 401", r.status_code == 401)
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{u}/2_selfie.jpg"},
                          cust["h"])
            check("müştəri → NOT_A_PROVIDER",
                  r.json() == {"ok": False, "error": "NOT_A_PROVIDER"}, r.text)
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{p}/2_selfie.jpg"},
                          prov["h"])
            check("əvvəlki təsdiq yoxdur → NO_PRIOR_APPROVED_KYC",
                  r.json() == {"ok": False, "error": "NO_PRIOR_APPROVED_KYC"}, r.text)
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{u}/2_selfie.jpg"},
                          prov["h"])
            check("başqasının qovluğu → INVALID_PATH",
                  r.json() == {"ok": False, "error": "INVALID_PATH"}, r.text)
            r = await rpc("submit_kyc", {"p_id_front_path": f"{p}/f.jpg",
                                         "p_id_back_path": f"{p}/b.jpg",
                                         "p_selfie_path": f"{p}/s.jpg",
                                         "p_full_name": "Rəşad Usta"}, prov["h"])
            approved = r.json()["verification_id"]
            await exe("update provider_verifications set status='approved', reviewed_at=now()"
                      " where id=:v", v=approved)
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{p}/2_selfie.jpg"},
                          prov["h"])
            d = r.json()
            check("renewal → {ok, verification_id, status:pending, is_renewal:true}",
                  d.get("ok") is True and is_uuid(d["verification_id"])
                  and d["status"] == "pending" and d["is_renewal"] is True, r.text)
            row = await q("select id_front_path, id_back_path, selfie_path, full_name_on_id,"
                          " is_renewal from provider_verifications where id=:v",
                          v=d["verification_id"])
            check("sənədlər təsdiqli müraciətdən, selfie yeni",
                  row.id_front_path == f"{p}/f.jpg" and row.id_back_path == f"{p}/b.jpg"
                  and row.selfie_path == f"{p}/2_selfie.jpg"
                  and row.full_name_on_id == "Rəşad Usta" and row.is_renewal is True)

            # ══════════════════ PAROL BƏRPASI (anonim) ══════════════════
            print("── request_password_reset_otp / reset_password_with_otp ──")
            r = await rpc("request_password_reset_otp", {"p_email": cust["email"]})
            check("anonim kod sorğusu → {ok:true, channel:'push'}",
                  r.status_code == 200 and r.json() == {"ok": True, "channel": "push"}, r.text)
            same = r.json()
            r = await rpc("request_password_reset_otp", {"p_email": "yoxdur@rpc-misc.az"})
            check("olmayan hesab eyni cavab (sadalama qoruması)", r.json() == same)
            r = await rpc("request_password_reset_otp", {"p_email": "ab"})
            check("zibil identifikator eyni cavab", r.json() == same)
            code = await notif_code(cust["user_id"])
            check("kod tətbiq bildirişində", len(code) == 6)
            stored = (await q("select otp from password_otps where user_id=:u and not used",
                              u=cust["user_id"])).otp
            check("kod bazada HMAC ilə (açıq deyil)", stored != code and len(stored) == 64)
            reset = {"p_email": cust["email"], "p_otp": code, "p_new_password": "YeniParol#22"}
            r = await rpc("reset_password_with_otp", {**reset, "p_new_password": "qısa"})
            check("qısa parol → PASSWORD_TOO_SHORT",
                  r.json() == {"ok": False, "error": "PASSWORD_TOO_SHORT"})
            wrong = "000000" if code != "000000" else "111111"
            r = await rpc("reset_password_with_otp", {**reset, "p_otp": wrong})
            check("səhv kod → WRONG_CODE + attempts_left=4",
                  r.json() == {"ok": False, "error": "WRONG_CODE", "attempts_left": 4}, r.text)
            r = await rpc("reset_password_with_otp", {**reset, "p_email": "yoxdur@rpc-misc.az"})
            check("olmayan hesab → NO_OTP (kod yoxdur ilə eyni)",
                  r.json() == {"ok": False, "error": "NO_OTP"}, r.text)
            old_refresh = cust["refresh_token"]
            r = await rpc("reset_password_with_otp",
                          {**reset, "p_otp": f"{code[:3]} {code[3:]}"})
            check("düz kod (boşluqla) → {ok:true}", r.json() == {"ok": True}, r.text)
            check("köhnə parol işləmir", (await login(cust)).status_code == 401)
            cust["password"] = "YeniParol#22"
            check("yeni parolla giriş", (await login(cust)).status_code == 200)
            r = await c.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
            check("köhnə refresh sessiyası ölüb", r.status_code == 401)
            r = await rpc("reset_password_with_otp", reset)
            check("kod ikinci dəfə → NO_OTP", r.json() == {"ok": False, "error": "NO_OTP"})

            await rpc("request_password_reset_otp", {"p_email": cust["email"]})
            code = await notif_code(cust["user_id"])
            await exe("update password_otps set expires_at = now() - interval '1 minute'"
                      " where user_id=:u and not used", u=cust["user_id"])
            r = await rpc("reset_password_with_otp", {**reset, "p_otp": code})
            check("vaxtı bitmiş → EXPIRED", r.json() == {"ok": False, "error": "EXPIRED"})

            await rpc("request_password_reset_otp", {"p_email": cust["email"]})
            code = await notif_code(cust["user_id"])
            wrong = "000000" if code != "000000" else "111111"
            res = [(await rpc("reset_password_with_otp", {**reset, "p_otp": wrong})).json()
                   for _ in range(5)]
            check("attempts_left 4→1 azalır",
                  [x.get("attempts_left") for x in res[:4]] == [4, 3, 2, 1], str(res))
            check("5-ci səhv → TOO_MANY_ATTEMPTS",
                  res[4] == {"ok": False, "error": "TOO_MANY_ATTEMPTS"}, str(res[4]))
            r = await rpc("reset_password_with_otp", {**reset, "p_otp": code})
            check("yanmış kod düz olsa da işləmir", r.json()["ok"] is False)
            r = await rpc("request_password_reset_otp", {"p_email": cust["email"]})
            check("saatda 3-dən çox → {ok:false, error:RATE_LIMITED}",
                  r.json() == {"ok": False, "error": "RATE_LIMITED"}, r.text)
            check("parol dəyişmədi", (await login(cust)).status_code == 200)

            print("── request_password_reset_email ──")
            await exe("update users set phone='994551112233' where id=:u", u=other["user_id"])
            n_before = len(inbox.messages)
            r = await rpc("request_password_reset_email", {"p_identifier": "055 111 22 33"})
            check("telefonla → {ok:true, email_hint, channel:email_code}",
                  r.json() == {"ok": True, "email_hint": "k•••@r•••.az", "channel": "email_code"}, r.text)
            await asyncio.sleep(0.3)
            check("məktub göndərildi", len(inbox.messages) == n_before + 1)
            code = inbox.last_code(other["email"])
            r = await rpc("reset_password_with_otp", {"p_email": "0551112233", "p_otp": code,
                                                      "p_new_password": "Mektub#Parol5"})
            check("e-poçt kodu ilə telefon identifikatoru → ok", r.json() == {"ok": True}, r.text)
            other["password"] = "Mektub#Parol5"
            check("yeni parolla giriş", (await login(other)).status_code == 200)
            r = await rpc("request_password_reset_email", {"p_identifier": "050 999 99 99"})
            check("olmayan hesab → {ok:true} (ipucusuz)", r.json() == {"ok": True}, r.text)
            await rpc("request_password_reset_email", {"p_identifier": "0551112233"})
            await rpc("request_password_reset_email", {"p_identifier": "0551112233"})
            r = await rpc("request_password_reset_email", {"p_identifier": "0551112233"})
            check("4-cü məktub → RATE_LIMITED",
                  r.json() == {"ok": False, "error": "RATE_LIMITED"}, r.text)
            smtp_host = settings.SMTP_HOST
            settings.SMTP_HOST = ""
            r = await rpc("request_password_reset_email", {"p_identifier": "0551112233"})
            settings.SMTP_HOST = smtp_host
            check("SMTP yoxdur → ok:false (klient 'Email göndərilə bilmədi' göstərir)",
                  r.json() == {"ok": False, "error": "EMAIL_NOT_CONFIGURED"}, r.text)

            # ══════════════ PAROL DƏYİŞMƏ (giriş etmiş) ══════════════
            print("── request_password_change_otp / verify_password_change_otp ──")
            r = await rpc("request_password_change_otp")
            check("anonim → 401", r.status_code == 401)
            r = await rpc("verify_password_change_otp", {"p_otp": "123456"})
            check("anonim verify → 401", r.status_code == 401)
            r = await rpc("verify_password_change_otp", {"p_otp": "123456"}, prov["h"])
            check("kod istənməyib → NO_OTP", r.json() == {"ok": False, "error": "NO_OTP"})
            r = await rpc("request_password_change_otp", None, prov["h"])
            check("kod sorğusu → {ok:true}", r.json() == {"ok": True}, r.text)
            code = await notif_code(prov["user_id"])
            wrong = "000000" if code != "000000" else "111111"
            r = await rpc("verify_password_change_otp", {"p_otp": wrong}, prov["h"])
            check("səhv → WRONG_CODE + attempts_left",
                  r.json() == {"ok": False, "error": "WRONG_CODE", "attempts_left": 4}, r.text)
            r = await rpc("verify_password_change_otp", {"p_otp": code}, prov["h"])
            check("düz kod → {ok:true}", r.json() == {"ok": True}, r.text)
            check("yoxlama parolu dəyişmir", (await login(prov)).status_code == 200)
            r = await rpc("verify_password_change_otp", {"p_otp": code}, prov["h"])
            check("kod bir dəfəlikdir → NO_OTP", r.json() == {"ok": False, "error": "NO_OTP"})
            await rpc("request_password_change_otp", None, prov["h"])
            code = await notif_code(prov["user_id"])
            await exe("update password_otps set expires_at = now() - interval '1 minute'"
                      " where user_id=:u and not used", u=prov["user_id"])
            r = await rpc("verify_password_change_otp", {"p_otp": code}, prov["h"])
            check("vaxtı bitmiş → EXPIRED", r.json() == {"ok": False, "error": "EXPIRED"})
            await rpc("request_password_change_otp", None, prov["h"])
            r = await rpc("request_password_change_otp", None, prov["h"])
            check("saatda 3-dən çox → RATE_LIMITED",
                  r.json() == {"ok": False, "error": "RATE_LIMITED"}, r.text)

            # ═════════════════════ EDGE FUNCTION-LAR ═════════════════════
            print("── create-payment-session ──")
            topup = {"amount": 25.5, "currency": "AZN", "purpose": "balance_topup",
                     "return_url": "https://ellit.az/payment/result",
                     "description": "Balans artırma"}
            r = await fn("create-payment-session", topup)
            check("token yoxdur → 401 {error}", r.status_code == 401
                  and r.json() == {"error": "Missing Authorization"}, r.text)
            r = await fn("create-payment-session", topup,
                         {"Authorization": "Bearer saxta.token.x"})
            check("etibarsız token → 401 Invalid token", r.status_code == 401
                  and r.json()["error"] == "Invalid token")
            settings.EPOINT_PUBLIC_KEY = settings.EPOINT_PRIVATE_KEY = ""
            n_pay = (await q("select count(*) as n from payments")).n
            r = await fn("create-payment-session", topup, cust["h"])
            d = r.json()
            check("açarsız → 200 {redirect_url:null, mode:'test', message}",
                  r.status_code == 200 and d["redirect_url"] is None and d["mode"] == "test"
                  and isinstance(d["message"], str) and d["message"], r.text)
            check("açarsız rejimdə ödəniş sətri yaranmır",
                  (await q("select count(*) as n from payments")).n == n_pay)
            settings.EPOINT_PUBLIC_KEY, settings.EPOINT_PRIVATE_KEY = EP_PUBLIC, EP_PRIVATE

            fake.next["request"] = (200, {"status": "success", "transaction": "TX-1",
                                          "redirect_url": "https://epoint.az/pay/TX-1"})
            r = await fn("create-payment-session", topup, cust["h"])
            d = r.json()
            check("balans artırma → {payment_id, redirect_url, transaction_id}",
                  r.status_code == 200 and isinstance(d["payment_id"], int)
                  and d["redirect_url"] == "https://epoint.az/pay/TX-1"
                  and d["transaction_id"] == "TX-1", r.text)
            pid1 = d["payment_id"]
            ep = fake.last("request")
            check("Epoint sorğusu imzalı, sahələr string",
                  fake.bad_signatures == 0 and ep["amount"] == "25.50"
                  and ep["order_id"] == str(pid1) and ep["public_key"] == EP_PUBLIC
                  and ep["currency"] == "AZN"
                  and ep["success_redirect_url"] == f"https://ellit.az/payment/result?id={pid1}"
                  and "status=failed" in ep["error_redirect_url"], str(ep))
            row = await q("select user_id, amount, status, order_id, external_id, metadata"
                          " from payments where id=:i", i=pid1)
            check("payments sətri: pending, 25.50, order_id=id, external_id=TX-1",
                  str(row.user_id) == cust["user_id"] and row.amount == Decimal("25.50")
                  and row.status == "pending" and row.order_id == str(pid1)
                  and row.external_id == "TX-1"
                  and row.metadata["purpose"] == "balance_topup")
            fake.next["request"] = (200, {"status": "success", "transaction": "TX-1B",
                                          "redirect_url": "https://epoint.az/pay/TX-1B"})
            r = await fn("create-payment-session", {"amount": 30, "currency": "AZN"}, cust["h"])
            check("UpdateBalance.tsx gövdəsi (purpose yox) → balance_topup",
                  r.status_code == 200 and r.json()["redirect_url"], r.text)
            for bad, label in ((-5, "mənfi"), (0, "sıfır"), (20000, "limitdən çox"),
                               ("abc", "mətn")):
                r = await fn("create-payment-session", {**topup, "amount": bad}, cust["h"])
                check(f"məbləğ {label} → 400", r.status_code == 400
                      and r.json()["error"].startswith(("Invalid amount", "Amount exceeds")),
                      r.text)
            r = await fn("create-payment-session", None, cust["h"], raw=b"{yox")
            check("yanlış JSON → 400", r.status_code == 400
                  and r.json() == {"error": "Invalid JSON"})
            r = await fn("create-payment-session", {**topup, "purpose": "hack"}, cust["h"])
            check("naməlum purpose → 400", r.status_code == 400)
            fake.next["request"] = (200, {"status": "error", "code": "E1", "message": "x"})
            r = await fn("create-payment-session", topup, cust["h"])
            check("Epoint rədd etdi → 502 {error:'Gateway error'}",
                  r.status_code == 502 and r.json()["error"] == "Gateway error", r.text)
            check("uğursuz sessiya sətri failed", (await q(
                "select status from payments where user_id=:u order by id desc limit 1",
                u=cust["user_id"])).status == "failed")

            svc_id = (await q("insert into services (id, title, provider_id)"
                              " values (nextval('services_id_seq'), 'Santexnika', :p)"
                              " returning id", p=prov["user_id"])).id
            promo = {"purpose": "service_promotion", "service_id": svc_id,
                     "promotion_type": "vip", "promotion_duration": 10,
                     "return_url": "https://ellit.az/my-services"}
            fake.next["request"] = (200, {"status": "success", "transaction": "TX-P",
                                          "redirect_url": "https://epoint.az/pay/TX-P"})
            r = await fn("create-payment-session", promo, cust["h"])
            check("başqasının xidməti → 403", r.status_code == 403
                  and r.json()["error"] == "Forbidden — not service owner", r.text)
            r = await fn("create-payment-session", {**promo, "promotion_duration": 7},
                         prov["h"])
            check("yanlış müddət → 400", r.status_code == 400
                  and r.json()["error"] == "Invalid promotion tier/duration")
            r = await fn("create-payment-session", {**promo, "service_id": None}, prov["h"])
            check("service_id yoxdur → 400", r.status_code == 400)
            r = await fn("create-payment-session", {**promo, "service_id": 999999}, prov["h"])
            check("olmayan xidmət → 404", r.status_code == 404)
            r = await fn("create-payment-session", promo, prov["h"])
            d = r.json()
            check("promo sessiyası → redirect_url", r.status_code == 200
                  and d["redirect_url"] == "https://epoint.az/pay/TX-P", r.text)
            pid_promo = d["payment_id"]
            check("promo qiyməti serverdə: VIP 10 gün = 10 ₼",
                  fake.last("request")["amount"] == "10.00")

            fake.next["card-registration"] = (200, {
                "status": "success", "redirect_url": "https://epoint.az/card/1"})
            r = await fn("create-payment-session", {
                "purpose": "card_registration", "channel": "mobile",
                "return_url": "ellitbooking://payment/result"}, prov["h"])
            d = r.json()
            check("kart qeydiyyatı → {payment_id, redirect_url}", r.status_code == 200
                  and d["redirect_url"] == "https://epoint.az/card/1"
                  and isinstance(d["payment_id"], int), r.text)
            pid_card = d["payment_id"]
            ep = fake.last("card-registration")
            check("kart sorğusu: refund=1, description-da uid/pid",
                  ep["refund"] == "1" and f"uid:{prov['user_id']}" in ep["description"]
                  and f"pid:{pid_card}" in ep["description"]
                  and ep["success_redirect_url"].startswith("ellitbooking://payment/result?"))
            r = await fn("create-payment-session", {"purpose": "service_payment",
                                                    "offer_id": str(uuid.uuid4())}, cust["h"])
            check("service_payment → 501 (Python backend-də yoxdur)", r.status_code == 501)

            print("── payment-webhook ──")
            b0 = (await q("select balance from profiles where id=:u", u=cust["user_id"])).balance
            cb = signed({"order_id": str(pid1), "status": "success", "transaction": "TX-1",
                         "amount": "25.50"})
            r = await c.post("/functions/v1/payment-webhook",
                             data={"data": cb["data"], "signature": "SAXTA"})
            check("saxta imza → 403", r.status_code == 403)
            r = await c.post("/functions/v1/payment-webhook", data=cb)
            check("imzalı callback → 200 {ok:true}", r.status_code == 200
                  and r.json() == {"ok": True}, r.text)
            b1 = (await q("select balance from profiles where id=:u", u=cust["user_id"])).balance
            check("balans +25.50", Decimal(b1) - Decimal(b0) == Decimal("25.50"))
            r = await c.post("/functions/v1/payment-webhook", json=cb)
            check("təkrar (JSON formatında) idempotent", r.status_code == 200
                  and r.json().get("skipped") == "artıq emal olunub", r.text)
            check("balans ikinci dəfə artmadı", (await q(
                "select balance from profiles where id=:u", u=cust["user_id"])).balance == b1)
            r = await c.post("/functions/v1/payment-webhook", data=signed({
                "order_id": str(pid_promo), "status": "success", "transaction": "TX-P"}))
            check("promo ödənişi callback-i", r.status_code == 200, r.text)
            row = await q("select promotion_type, promotion_expires_at > now() + interval"
                          " '9 days' as ok from services where id=:s", s=svc_id)
            check("xidmət VIP oldu (10 gün)", row.promotion_type == "vip" and row.ok)

            print("── verify-payment ──")
            r = await fn("verify-payment", {"payment_id": pid1})
            check("token yoxdur → 401 NOT_AUTHENTICATED", r.status_code == 401
                  and r.json() == {"error": "NOT_AUTHENTICATED"})
            r = await fn("verify-payment", {}, cust["h"])
            check("payment_id yoxdur → 400", r.status_code == 400
                  and r.json() == {"error": "MISSING_PAYMENT_ID"})
            r = await fn("verify-payment", {"payment_id": 987654321}, cust["h"])
            check("olmayan → 404", r.status_code == 404
                  and r.json() == {"error": "PAYMENT_NOT_FOUND"})
            r = await fn("verify-payment", {"payment_id": pid1}, other["h"])
            check("başqasının ödənişi → 403", r.status_code == 403
                  and r.json() == {"error": "NOT_AUTHORIZED"})
            r = await fn("verify-payment", {"payment_id": pid1}, cust["h"])
            check("tamamlanmış → {ok, status:'completed', already_completed}",
                  r.json() == {"ok": True, "status": "completed", "already_completed": True})
            r = await fn("verify-payment", {"payment_id": pid_card}, prov["h"])
            check("transaction yoxdur → NO_TRANSACTION_ID",
                  r.json() == {"ok": False, "error": "NO_TRANSACTION_ID",
                               "payment_status": "pending"}, r.text)

            fake.next["request"] = (200, {"status": "success", "transaction": "TX-2",
                                          "redirect_url": "https://epoint.az/pay/TX-2"})
            pid2 = (await fn("create-payment-session", {**topup, "amount": 40},
                             cust["h"])).json()["payment_id"]
            fake.next["get-status"] = (200, {"status": "new"})
            r = await fn("verify-payment", {"payment_id": pid2}, cust["h"])
            check("hələ ödənilməyib → {ok:false, epoint_status:'new', payment_status}",
                  r.json() == {"ok": False, "epoint_status": "new", "message": None,
                               "payment_status": "pending"}, r.text)
            check("get-status imzalı, transaction=TX-2",
                  fake.last("get-status") == {"public_key": EP_PUBLIC, "transaction": "TX-2"})
            b0 = (await q("select balance from profiles where id=:u", u=cust["user_id"])).balance
            fake.next["get-status"] = (200, {"status": "success", "amount": "40.00"})
            r = await fn("verify-payment", {"payment_id": pid2}, cust["h"])
            d = r.json()
            check("Epoint success → {ok, status, credited_amount, new_balance, purpose}",
                  d.get("ok") is True and d["status"] == "completed"
                  and d["credited_amount"] == 40 and d["purpose"] == "balance_topup"
                  and Decimal(str(d["new_balance"])) == Decimal(b0) + 40, r.text)
            r = await fn("verify-payment", {"payment_id": pid2}, cust["h"])
            check("təkrar verify → already_completed",
                  r.json().get("already_completed") is True)
            r = await c.post("/functions/v1/payment-webhook", data=signed({
                "order_id": str(pid2), "status": "success", "transaction": "TX-2"}))
            check("gec gələn webhook ikinci dəfə kreditləmir", (await q(
                "select balance from profiles where id=:u", u=cust["user_id"])
            ).balance == Decimal(b0) + 40)
            check("top_up ledger yazısı tək", (await q(
                "select count(*) as n from transactions where user_id=:u and type='top_up'"
                " and related_id=:r", u=cust["user_id"], r=str(pid2))).n == 1)

            fake.next["request"] = (200, {"status": "success", "transaction": "TX-3",
                                          "redirect_url": "https://epoint.az/pay/TX-3"})
            pid3 = (await fn("create-payment-session", {**topup, "amount": 15},
                             cust["h"])).json()["payment_id"]
            fake.next["get-status"] = (200, {"status": "success", "amount": "1500.00"})
            r = await fn("verify-payment", {"payment_id": pid3}, adm["h"])
            check("admin başqasınınkını yoxlaya bilir; məbləğ uyğunsuz → AMOUNT_MISMATCH",
                  r.json() == {"ok": False, "error": "AMOUNT_MISMATCH"}, r.text)
            check("uyğunsuz ödəniş failed, kredit yoxdur", (await q(
                "select status from payments where id=:i", i=pid3)).status == "failed")
            fake.next["request"] = (200, {"status": "success", "transaction": "TX-4",
                                          "redirect_url": "https://epoint.az/pay/TX-4"})
            pid4 = (await fn("create-payment-session", {**topup, "amount": 15},
                             cust["h"])).json()["payment_id"]
            fake.next["get-status"] = (200, {"status": "error", "message": "Declined"})
            r = await fn("verify-payment", {"payment_id": pid4}, cust["h"])
            check("Epoint error → ok:false, sətir failed",
                  r.json()["ok"] is False and r.json()["epoint_status"] == "error"
                  and (await q("select status from payments where id=:i", i=pid4)).status
                  == "failed", r.text)

            print("── payment-webhook: kart qeydiyyatı ──")
            card_cb = {"operation_code": "001", "status": "success", "card_id": "CARD-77",
                       "card_mask": "416973******5678",
                       "description": f"Ellit payout card | uid:{prov['user_id']} | pid:{pid_card}"}

            # ── process-withdrawal (kartsız payout testi qeydiyyatdan ƏVVƏL) ──
            print("── process-withdrawal ──")

            async def new_withdrawal(u: dict, amount: str = "100.00") -> str:
                r = await c.post("/api/v1/withdrawals", headers=u["h"],
                                 json={"amount": amount, "bank_card": "4169738812345678"})
                check(f"çıxarış sorğusu {amount}", r.status_code == 201, r.text)
                return r.json()["id"]

            wd1 = await new_withdrawal(prov)
            bal_after_req = (await q("select balance from profiles where id=:u",
                                     u=prov["user_id"])).balance
            body = {"withdrawal_id": wd1, "action": "reject", "notes": "Kart yanlışdır"}
            r = await fn("process-withdrawal", body)
            check("token yoxdur → 401", r.status_code == 401)
            r = await fn("process-withdrawal", body, prov["h"])
            check("admin deyil → 403", r.status_code == 403
                  and r.json() == {"error": "Forbidden — admin only"})
            r = await fn("process-withdrawal", {"action": "reject"}, adm["h"])
            check("withdrawal_id yoxdur → 400", r.status_code == 400
                  and r.json() == {"error": "Missing withdrawal_id or action"})
            r = await fn("process-withdrawal", {**body, "withdrawal_id": str(uuid.uuid4())},
                         adm["h"])
            check("olmayan → 404", r.status_code == 404
                  and r.json() == {"error": "Withdrawal not found"})
            r = await fn("process-withdrawal", {**body, "action": "steal"}, adm["h"])
            check("naməlum action → 400", r.status_code == 400
                  and r.json() == {"error": "Unknown action"})
            r = await fn("process-withdrawal", body, adm["h"])
            check("reject → {ok:true, status:'rejected'}",
                  r.status_code == 200 and r.json() == {"ok": True, "status": "rejected"}, r.text)
            check("rədd → məbləğ balansa qayıtdı", (await q(
                "select balance from profiles where id=:u", u=prov["user_id"])
            ).balance == bal_after_req + 100)
            r = await fn("process-withdrawal", body, adm["h"])
            check("təkrar emal → 400 'Withdrawal already rejected'", r.status_code == 400
                  and r.json() == {"error": "Withdrawal already rejected"}, r.text)

            wd2 = await new_withdrawal(prov)
            r = await fn("process-withdrawal", {"withdrawal_id": wd2, "action": "manual"},
                         adm["h"])
            check("manual → {ok, status:'processed', mode:'manual'}",
                  r.json() == {"ok": True, "status": "processed", "mode": "manual"}, r.text)
            row = await q("select status, admin_notes from withdrawals where id=:w", w=wd2)
            check("manual qeyd", row.status == "processed"
                  and row.admin_notes == "Manual transfer by admin")

            wd3 = await new_withdrawal(prov)
            r = await fn("process-withdrawal", {"withdrawal_id": wd3, "action": "payout"},
                         adm["h"])
            d = r.json()
            check("kart qeydiyyatsız payout → 400 + requires_card_registration",
                  r.status_code == 400 and d["requires_card_registration"] is True
                  and "kartını" in d["error"], r.text)
            r = await c.post("/functions/v1/payment-webhook", data=signed(card_cb))
            check("kart qeydiyyatı callback-i → {ok, card_registered}",
                  r.json() == {"ok": True, "card_registered": True}, r.text)
            row = await q("select epoint_card_uid, epoint_card_mask from profiles where id=:u",
                          u=prov["user_id"])
            check("profilə kart yazıldı", row.epoint_card_uid == "CARD-77"
                  and row.epoint_card_mask == "416973******5678")
            check("kart ödəniş sətri completed", (await q(
                "select status from payments where id=:i", i=pid_card)).status == "completed")
            r = await c.post("/functions/v1/payment-webhook", data=signed(card_cb))
            check("təkrar kart callback-i idempotent", r.json() == {"ok": True, "idempotent": True})

            fake.next["execute-pay"] = (200, {"status": "error", "message": "Limit"})
            r = await fn("process-withdrawal", {"withdrawal_id": wd3, "action": "payout"},
                         adm["h"])
            check("Epoint payout rədd → 502, çıxarış pending qalır",
                  r.status_code == 502 and r.json()["error"] == "Epoint payout failed"
                  and (await q("select status from withdrawals where id=:w", w=wd3)).status
                  == "pending", r.text)
            fake.next["execute-pay"] = (200, {"status": "success", "transaction": "PAY-9"})
            r = await fn("process-withdrawal", {"withdrawal_id": wd3, "action": "payout"},
                         adm["h"])
            check("payout → {ok, status:'processed', mode:'epoint', external_id}",
                  r.json() == {"ok": True, "status": "processed", "mode": "epoint",
                               "external_id": "PAY-9"}, r.text)
            ep = fake.last("execute-pay")
            check("execute-pay: card_uid, xalis məbləğ (100 - 2%), order_id",
                  ep["card_uid"] == "CARD-77" and ep["amount"] == "98.00"
                  and ep["order_id"] == wd3 and ep["currency"] == "AZN", str(ep))
            check("withdrawals.external_id yazıldı", (await q(
                "select external_id from withdrawals where id=:w", w=wd3)).external_id == "PAY-9")

            # ═════════════════ admin-change-password ═════════════════
            print("── admin-change-password ──")
            body = {"user_id": other["user_id"], "new_password": "AdminVerdi#7"}
            r = await fn("admin-change-password", body, cust["h"])
            check("admin deyil → 403", r.status_code == 403
                  and r.json() == {"error": "Yalnız admin üçün!"})
            r = await fn("admin-change-password", {**body, "new_password": "123"}, adm["h"])
            check("qısa parol → 400", r.status_code == 400)
            r = await fn("admin-change-password", {"user_id": other["user_id"]}, adm["h"])
            check("parol yoxdur → 400", r.status_code == 400
                  and r.json() == {"error": "Missing user_id or new_password"})
            old_rt = other["refresh_token"]
            r = await fn("admin-change-password", body, adm["h"])
            check("admin parolu dəyişdi → {ok:true}", r.json() == {"ok": True}, r.text)
            check("köhnə parol işləmir", (await login(other)).status_code == 401)
            r = await c.post("/api/v1/auth/refresh", json={"refresh_token": old_rt})
            check("hədəfin sessiyaları bağlandı", r.status_code == 401)
            other["password"] = "AdminVerdi#7"
            check("yeni parolla giriş", (await login(other)).status_code == 200)
            check("audit_log yazıldı", (await q(
                "select count(*) as n from audit_log where action='admin_password_reset'"
                " and target_id=:t", t=other["user_id"])).n == 1)

            # ═════════════════════ AI funksiyaları ═════════════════════
            print("── ai-question-generator / ai-price-research ──")
            qbody = {"category_id": str(uuid.uuid4()), "category_label": "Santexnika",
                     "subcategory_id": str(uuid.uuid4()), "subcategory_label": "Kran"}
            pbody = {"category_label": "Santexnika", "subcategory_label": "Kran"}
            for name, body in (("ai-question-generator", qbody), ("ai-price-research", pbody)):
                r = await fn(name, body)
                check(f"{name}: token yoxdur → 401", r.status_code == 401)
                r = await fn(name, body, cust["h"])
                check(f"{name}: admin deyil → 403", r.status_code == 403)
                r = await fn(name, body, adm["h"])
                d = r.json()
                check(f"{name}: admin → success:false + NOT_IMPLEMENTED + message",
                      r.status_code == 200 and d["success"] is False
                      and d["error"] == "NOT_IMPLEMENTED" and isinstance(d["message"], str)
                      and "priceResult" not in d and "count" not in d, r.text)
            r = await fn("yoxdur-funksiya", {}, cust["h"])
            check("naməlum funksiya → 404", r.status_code == 404)

            # ═════════════════════ delete-account ═════════════════════
            print("── delete-account ──")
            r = await fn("delete-account")
            check("token yoxdur → 401 MISSING_AUTHORIZATION", r.status_code == 401
                  and r.json() == {"error": "MISSING_AUTHORIZATION"})
            r = await fn("delete-account", None, {"Authorization": "Bearer pis"})
            check("etibarsız token → 401 INVALID_TOKEN", r.status_code == 401
                  and r.json() == {"error": "INVALID_TOKEN"})
            await exe("update opportunities_offers set status='accepted'"
                      " where opportunity_id=:o", o=opp_ok)
            r = await fn("delete-account", None, prov["h"])
            check("aktiv iş → 409 HAS_ACTIVE_OFFERS", r.status_code == 409
                  and r.json()["error"] == "HAS_ACTIVE_OFFERS", r.text)
            await new_withdrawal(prov2, "50.00")
            r = await fn("delete-account", None, prov2["h"])
            check("gözləyən çıxarış → 409 HAS_PENDING_WITHDRAWALS", r.status_code == 409
                  and r.json()["error"] == "HAS_PENDING_WITHDRAWALS", r.text)

            gone = await register("silinen", "Silinən Hesab")
            r = await fn("delete-account", None, gone["h"])
            check("tarixçəsiz hesab silindi → {ok:true}", r.status_code == 200
                  and r.json() == {"ok": True}, r.text)
            check("users + profiles sətri yoxdur", (await q(
                "select (select count(*) from users where id=:u)"
                " + (select count(*) from profiles where id=:u) as n", u=gone["user_id"])).n == 0)
            check("giriş mümkün deyil", (await login(gone)).status_code == 401)
            r = await c.post("/api/v1/auth/refresh", json={"refresh_token": gone["refresh_token"]})
            check("refresh sessiyası ölüb", r.status_code == 401)
            r = await rpc("request_password_change_otp", None, gone["h"])
            check("hələ etibarlı access token RPC-də işləmir → AUTH_REQUIRED",
                  r.json() == {"ok": False, "error": "AUTH_REQUIRED"}, r.text)
            r = await fn("delete-account", None, gone["h"])
            check("təkrar silmə → 401", r.status_code == 401)

            keeper = await register("tarixceli", "Tarixçəli Usta", "provider")
            await exe("insert into services (id, title, provider_id)"
                      " values (nextval('services_id_seq'), 'Elektrik', :p)",
                      p=keeper["user_id"])
            r = await fn("delete-account", None, keeper["h"])
            check("tarixçəli hesab → {ok:true}", r.json() == {"ok": True}, r.text)
            row = await q("select u.is_active, u.email, u.password_hash, p.status, p.name"
                          " from users u join profiles p on p.id = u.id where u.id=:u",
                          u=keeper["user_id"])
            check("kimlik söndürüldü + şəxsi məlumat təmizləndi", row.is_active is False
                  and row.email is None and row.password_hash is None
                  and row.status == "deleted" and row.name == "Silinmiş istifadəçi")
            check("giriş mümkün deyil", (await login(keeper)).status_code == 401)
            r = await c.post("/api/v1/auth/refresh",
                             json={"refresh_token": keeper["refresh_token"]})
            check("refresh sessiyası ölüb", r.status_code == 401)
            r = await rpc("submit_kyc_renewal", {"p_selfie_path": f"{keeper['user_id']}/s.jpg"},
                          keeper["h"])
            check("deaktiv hesabın tokeni RPC-də → NOT_AUTHENTICATED",
                  r.json() == {"ok": False, "error": "NOT_AUTHENTICATED"}, r.text)
            check("epoint saxtasına imzasız sorğu getmədi", fake.bad_signatures == 0)
    finally:
        smtp.stop()

    print("RPC MISC + FUNCTIONS TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
