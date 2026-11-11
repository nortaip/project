"""Supabase Auth (GoTrue) uyğun API testi — /auth/v1/* (app/compat/gotrue.py).

Real PostgreSQL + Redis üzərində, httpx ASGITransport ilə HTTP marşrutları
sınanır. Google/Apple şəbəkə çağırışları funksiya sərhədində əvəz olunur
(Google: kod mübadiləsi + ID token yoxlaması; Apple: açıq açarların endirilməsi —
imza yoxlaması isə REAL işləyir, test öz RSA açarı ilə token imzalayır).
E-poçt göndərişi `mailer.send_mail` səviyyəsində tutulur.

İşə salma (təmiz baza):
    DATABASE_URL=... REDIS_URL=... JWT_SECRET=... python3 tests/compat_gotrue.py
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import uuid
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cryptography.hazmat.primitives import serialization as _ser  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec as _ec  # noqa: E402

# Apple veb OAuth: Apple Developer-dəki .p8 açarı kimi P-256 EC açarı
_APPLE_EC_KEY = _ec.generate_private_key(_ec.SECP256R1())
APPLE_EC_PUB = _APPLE_EC_KEY.public_key().public_bytes(
    _ser.Encoding.PEM, _ser.PublicFormat.SubjectPublicKeyInfo).decode()
_APPLE_P8 = _APPLE_EC_KEY.private_bytes(
    _ser.Encoding.PEM, _ser.PrivateFormat.PKCS8, _ser.NoEncryption()).decode()

# Bu modulun parametrləri (app/core/config.py-a köçürülənə qədər ENV-dən oxunur)
os.environ.update({
    "APPLE_SERVICE_ID": "az.ellit.web",
    "APPLE_TEAM_ID": "TEAM123456",
    "APPLE_KEY_ID": "KEY1234567",
    # .env-də bir sətir: sətir sonları \\n kimi
    "APPLE_PRIVATE_KEY": _APPLE_P8.replace("\n", "\\n"),
    "SITE_URL": "https://ellit.az",
    "AUTH_REDIRECT_URLS": "http://localhost:5173,io.supabase.ellitbooking://login-callback/,"
                          "https://ellit.az/reset-password",
    "API_EXTERNAL_URL": "http://t",
    "GOOGLE_OAUTH_CLIENT_ID": "web-client.apps.googleusercontent.com",
    "GOOGLE_OAUTH_CLIENT_SECRET": "test-secret",
    "REFRESH_REUSE_INTERVAL": "10",
})

import httpx  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {'' if cond else extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


def err_ok(r: httpx.Response, status: int, code: str, msg_part: str | None = None) -> bool:
    """GoTrue xəta forması: {code:int, error_code:str, msg:str}."""
    try:
        j = r.json()
    except ValueError:
        return False
    return (r.status_code == status and j.get("error_code") == code
            and j.get("code") == status and isinstance(j.get("msg"), str)
            and (msg_part is None or msg_part in j["msg"]))


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def frag(location: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlsplit(location).fragment).items()}


def query(location: str) -> dict:
    return {k: v[0] for k, v in parse_qs(urlsplit(location).query).items()}


async def main() -> None:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk, jwt
    from sqlalchemy import text

    from app.compat import gotrue
    from app.core import oauth as oauth_core
    from app.core.config import settings
    from app.core.security import decode_token
    from app.db.session import SessionLocal, redis
    from app.main import app
    from app.services import mailer

    A = "/auth/v1"
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:

        async def db_one(sql: str, **params):
            async with SessionLocal() as s:
                return (await s.execute(text(sql), params)).first()

        def bearer(tok: str) -> dict:
            return {"Authorization": f"Bearer {tok}"}

        async def pw_login(ident: dict, password: str) -> httpx.Response:
            return await c.post(f"{A}/token?grant_type=password",
                                json={**ident, "password": password})

        # ── 0. health / settings ──
        r = await c.get(f"{A}/health")
        check("GET /health", r.status_code == 200 and r.json()["name"] == "GoTrue")
        r = await c.get(f"{A}/settings")
        s = r.json()
        check("GET /settings", r.status_code == 200 and s["external"]["email"]
              and s["external"]["google"] is True and s["mailer_autoconfirm"] is True, str(s))

        # ── 1. Qeydiyyat (e-poçt) ──
        meta = {"name": "Aysel Məmmədova", "role": "customer", "phone": "+994501112233",
                "address": "Bakı", "specialties": []}
        r = await c.post(f"{A}/signup", json={
            "email": "Aysel@Test.az", "password": "parol123", "data": meta,
            "gotrue_meta_security": {"captcha_token": None},
            "code_challenge": None, "code_challenge_method": None})
        check("signup (email) → 200", r.status_code == 200, r.text[:300])
        sess = r.json()
        u = sess["user"]
        check("signup sessiya qaytarır (təsdiq addımı yoxdur)",
              sess["access_token"] and sess["refresh_token"] and sess["token_type"] == "bearer"
              and sess["expires_in"] == settings.ACCESS_TOKEN_MINUTES * 60
              and abs(sess["expires_at"] - (time.time() + sess["expires_in"])) < 10)
        check("user obyekti: id/aud/role/email",
              u["aud"] == "authenticated" and u["role"] == "authenticated"
              and u["email"] == "aysel@test.az" and u["phone"] == ""
              and u["email_confirmed_at"] and u["created_at"] and u["last_sign_in_at"], str(u))
        check("user_metadata = signUp data",
              all(u["user_metadata"].get(k) == v for k, v in meta.items()), str(u["user_metadata"]))
        check("app_metadata.provider = email",
              u["app_metadata"] == {"provider": "email", "providers": ["email"]}
              and u["identities"][0]["provider"] == "email", str(u["app_metadata"]))
        aysel_id = u["id"]
        claims = decode_token(sess["access_token"], "access")
        check("eyni backend token-i (decode_token)", claims["sub"] == aysel_id
              and claims["role"] == "customer")
        r = await c.get("/api/v1/profiles/me", headers=bearer(sess["access_token"]))
        check("token /api/v1 endpointlərində keçərlidir", r.status_code == 200, r.text[:200])
        row = await db_one("select name, role, email, phone_number from profiles where id = :i",
                           i=aysel_id)
        check("profiles sətri yaradıldı (ad/rol metadata-dan)",
              row and row.name == "Aysel Məmmədova" and row.role == "customer"
              and row.email == "aysel@test.az", str(row))
        row = await db_one("select user_metadata, last_sign_in_at from users where id = :i",
                           i=aysel_id)
        check("users.user_metadata saxlanıldı", row.user_metadata == meta and row.last_sign_in_at)

        # ── 2. Qeydiyyat (telefon) + rol hücumu ──
        r = await c.post(f"{A}/signup", json={
            "phone": "+994 55 123 45 67", "password": "telefon1",
            "data": {"name": "Admin Olmaq İstəyən", "role": "superadmin"}, "channel": "sms"})
        check("signup (telefon) → 200", r.status_code == 200, r.text[:300])
        tel = r.json()
        check("telefon normallaşdırıldı", tel["user"]["phone"] == "994551234567"
              and tel["user"]["email"] == "" and tel["user"]["app_metadata"]["provider"] == "phone",
              str(tel["user"]))
        row = await db_one("select u.role as urole, p.role as prole, p.phone_number"
                           " from users u join profiles p on p.id = u.id where u.id = :i",
                           i=tel["user"]["id"])
        check("admin rolunu özünə təyin etmək olmur", row.urole == "customer"
              and row.prole == "customer" and row.phone_number == "994551234567", str(row))
        check("access token rolu customer",
              decode_token(tel["access_token"], "access")["role"] == "customer")
        r = await c.post(f"{A}/signup", json={"email": "usta@test.az", "password": "usta1234",
                                               "data": {"name": "Usta", "role": "provider"}})
        row = await db_one("select role from profiles where id = :i", i=r.json()["user"]["id"])
        check("provider rolu da birbaşa verilmir (admin təsdiqi ilə)", row.role == "customer")

        # ── 3. Qeydiyyat xətaları ──
        r = await c.post(f"{A}/signup", json={"email": "aysel@test.az", "password": "basqa123"})
        check("dublikat e-poçt → 422 user_already_exists 'User already registered'",
              err_ok(r, 422, "user_already_exists", "already registered"), r.text)
        r = await c.post(f"{A}/signup", json={"phone": "0551234567", "password": "basqa123"})
        check("dublikat telefon (başqa formatda) → 422",
              err_ok(r, 422, "user_already_exists", "already registered"), r.text)
        r = await c.post(f"{A}/signup", json={"email": "zeif@test.az", "password": "123"})
        j = r.json()
        check("zəif parol → 422 weak_password + reasons",
              err_ok(r, 422, "weak_password") and j["weak_password"]["reasons"] == ["length"], r.text)
        r = await c.post(f"{A}/signup", json={"email": "yanlis", "password": "parol123"})
        check("yanlış e-poçt → 400 validation_failed", err_ok(r, 400, "validation_failed"), r.text)
        r = await c.post(f"{A}/signup", json={"email": "a@b.az", "phone": "+994501234567",
                                               "password": "parol123"})
        check("e-poçt + telefon birlikdə → 400", err_ok(r, 400, "validation_failed"), r.text)
        r = await c.post(f"{A}/signup", json={"phone": "12", "password": "parol123"})
        check("yanlış telefon → 400", err_ok(r, 400, "validation_failed"), r.text)
        r = await c.post(f"{A}/signup", json={"password": "parol123", "data": {}})
        check("anonim qeydiyyat bağlıdır → 422",
              err_ok(r, 422, "anonymous_provider_disabled"), r.text)
        r = await c.post(f"{A}/signup", json={"email": "m@test.az", "password": "parol123",
                                               "data": ["x"]})
        check("metadata obyekt deyil → 400", err_ok(r, 400, "validation_failed"), r.text)
        r = await c.post(f"{A}/signup", content=b"{bad json", headers={"content-type": "application/json"})
        check("pozuq JSON → 400 bad_json", err_ok(r, 400, "bad_json"), r.text)

        # ── 4. Parolla giriş ──
        r = await pw_login({"email": "AYSEL@test.az"}, "parol123")
        check("email + parol → sessiya", r.status_code == 200 and r.json()["user"]["id"] == aysel_id,
              r.text[:200])
        for ph in ("+994551234567", "994551234567", "0551234567"):
            r = await pw_login({"phone": ph}, "telefon1")
            check(f"telefon + parol ({ph})", r.status_code == 200
                  and r.json()["user"]["phone"] == "994551234567", r.text[:200])
        r = await pw_login({"email": "aysel@test.az"}, "sehv-parol")
        check("yanlış parol → 400 invalid_credentials 'Invalid login credentials'",
              err_ok(r, 400, "invalid_credentials", "Invalid login credentials"), r.text)
        r = await pw_login({"email": "yoxdur@test.az"}, "parol123")
        check("naməlum istifadəçi → eyni xəta (sadalama yoxdur)",
              err_ok(r, 400, "invalid_credentials", "Invalid login credentials"), r.text)
        r = await pw_login({"phone": "+994701234567"}, "parol123")
        check("naməlum telefon → eyni xəta", err_ok(r, 400, "invalid_credentials"), r.text)
        r = await c.post(f"{A}/token?grant_type=password", json={"password": "x"})
        check("identifikatorsuz → invalid_credentials", err_ok(r, 400, "invalid_credentials"))
        r = await c.post(f"{A}/token?grant_type=magic", json={})
        check("naməlum grant_type → 400", err_ok(r, 400, "validation_failed"), r.text)

        # lockout (köhnə qayda: 5 uğursuz cəhd → kilid), yalnız ayrı hesabda
        await c.post(f"{A}/signup", json={"email": "kilid@test.az", "password": "dogru123"})
        for _ in range(5):
            await pw_login({"email": "kilid@test.az"}, "sehv")
        r = await pw_login({"email": "kilid@test.az"}, "dogru123")
        check("5 uğursuz cəhddən sonra kilid → 429 (düzgün parol da)",
              err_ok(r, 429, "over_request_rate_limit"), r.text)
        r = await c.post("/api/v1/auth/login", json={"email": "kilid@test.az", "password": "dogru123"})
        check("kilid köhnə /api/v1/auth/login ilə ortaqdır", r.status_code == 429)

        # Supabase-dən köçən bcrypt istifadəçisi
        import bcrypt
        legacy_id = uuid.uuid4()
        async with SessionLocal() as s:
            await s.execute(text(
                "insert into users (id, email, password_hash, role, is_active, email_verified)"
                " values (:i, 'kohne@test.az', :h, 'customer', true, true)"),
                {"i": legacy_id, "h": bcrypt.hashpw(b"kohneParol1", bcrypt.gensalt()).decode()})
            await s.execute(text(
                "insert into profiles (id, email, name, role) values (:i, 'kohne@test.az',"
                " 'Köhnə', 'customer')"), {"i": legacy_id})
            await s.commit()
        r = await pw_login({"email": "kohne@test.az"}, "kohneParol1")
        check("köhnə bcrypt hash ilə giriş", r.status_code == 200
              and r.json()["user"]["id"] == str(legacy_id), r.text[:200])
        row = await db_one("select password_hash from users where id = :i", i=legacy_id)
        check("bcrypt → Argon2 rehash", row.password_hash.startswith("$argon2"))
        r = await pw_login({"email": "kohne@test.az"}, "kohneParol1")
        check("rehash-dən sonra giriş", r.status_code == 200)

        # deaktiv hesab
        await c.post(f"{A}/signup", json={"email": "ban@test.az", "password": "ban12345"})
        async with SessionLocal() as s:
            await s.execute(text("update users set is_active = false where email = 'ban@test.az'"))
            await s.commit()
        r = await pw_login({"email": "ban@test.az"}, "ban12345")
        check("deaktiv hesab → 400 user_banned", err_ok(r, 400, "user_banned"), r.text)

        # ── 5. GET /user ──
        r = await pw_login({"email": "aysel@test.az"}, "parol123")
        s1 = r.json()
        r = await c.get(f"{A}/user", headers=bearer(s1["access_token"]))
        check("GET /user", r.status_code == 200 and r.json()["id"] == aysel_id
              and r.json()["user_metadata"]["name"] == "Aysel Məmmədova", r.text[:200])
        r = await c.get(f"{A}/user")
        check("GET /user token-siz → 401 no_authorization", err_ok(r, 401, "no_authorization"))
        r = await c.get(f"{A}/user", headers=bearer("anon-key-placeholder"))
        check("GET /user anon key ilə → 403 bad_jwt", err_ok(r, 403, "bad_jwt"), r.text)
        expired = jwt.encode({"sub": aysel_id, "role": "customer", "type": "access",
                              "iat": int(time.time()) - 120, "exp": int(time.time()) - 60,
                              "jti": "x"}, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        r = await c.get(f"{A}/user", headers=bearer(expired))
        check("vaxtı keçmiş token → 403 bad_jwt", err_ok(r, 403, "bad_jwt", "expired"), r.text)
        r = await c.get(f"{A}/user", headers=bearer(s1["refresh_token"]))
        check("refresh token access kimi keçmir", err_ok(r, 403, "bad_jwt"))

        # ── 6. PUT /user ──
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]),
                        json={"data": {"name": "Aysel M.", "address": None, "city": "Gəncə"},
                              "code_challenge": None, "code_challenge_method": None})
        um = r.json()["user_metadata"]
        check("updateUser({data}) birləşdirir; null açarı silir",
              r.status_code == 200 and um["name"] == "Aysel M." and um["city"] == "Gəncə"
              and "address" not in um and um["phone"] == "+994501112233", r.text[:300])
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]), json={"data": "x"})
        check("data obyekt deyil → 400", err_ok(r, 400, "validation_failed"))
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]),
                        json={"email": "yeni@test.az"})
        check("e-poçt dəyişikliyi rədd (təsdiqsiz)", err_ok(r, 422, "email_change_not_supported"))
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]), json={"password": "parol123"})
        check("eyni parol → 422 same_password ('same' mətndə)",
              err_ok(r, 422, "same_password", "different from the old")
              and "same" in r.json()["msg"], r.text)
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]), json={"password": "12"})
        check("zəif yeni parol → 422 weak_password", err_ok(r, 422, "weak_password"))

        r = await pw_login({"email": "aysel@test.az"}, "parol123")
        other = r.json()  # ikinci cihaz
        r = await c.put(f"{A}/user", headers=bearer(s1["access_token"]),
                        json={"password": "YeniParol9"})
        check("updateUser({password})", r.status_code == 200, r.text[:200])
        check("köhnə parol artıq işləmir",
              err_ok(await pw_login({"email": "aysel@test.az"}, "parol123"), 400, "invalid_credentials"))
        check("yeni parol işləyir", (await pw_login({"email": "aysel@test.az"}, "YeniParol9")).status_code == 200)
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": other["refresh_token"]})
        check("parol dəyişəndə digər cihazın sessiyası bağlandı (oğurluq sayılmır)",
              err_ok(r, 400, "refresh_token_not_found"), r.text)
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s1["refresh_token"]})
        check("parolu dəyişən cari sessiya işləməyə davam edir", r.status_code == 200, r.text)
        s1 = r.json()
        row = await db_one("select count(*) as n from notifications where user_id = :i and type = 'security'",
                           i=aysel_id)
        check("təhlükəsizlik bildirişi yazıldı", row.n == 1)

        # ── 7. Refresh rotasiyası ──
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s1["refresh_token"]})
        s2 = r.json()
        check("refresh → yeni cüt", r.status_code == 200 and s2["refresh_token"] != s1["refresh_token"]
              and s2["access_token"] != s1["access_token"] and s2["user"]["id"] == aysel_id)
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s1["refresh_token"]})
        check("güzəşt pəncərəsində təkrar (iki tab) → EYNİ varis token",
              r.status_code == 200 and r.json()["refresh_token"] == s2["refresh_token"], r.text[:200])
        # eyni anda iki sorğu
        r1, r2 = await asyncio.gather(
            c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s2["refresh_token"]}),
            c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s2["refresh_token"]}))
        check("paralel iki refresh → hər ikisi uğurlu, tək varis",
              r1.status_code == 200 and r2.status_code == 200
              and r1.json()["refresh_token"] == r2.json()["refresh_token"], f"{r1.text[:120]} {r2.text[:120]}")
        s3 = r1.json()
        row = await db_one("select count(*) as n from refresh_sessions where user_id = :i"
                           " and revoked = false", i=aysel_id)
        n_before = row.n

        os.environ["REFRESH_REUSE_INTERVAL"] = "0"
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s3["refresh_token"]})
        s4 = r.json()
        check("güzəştsiz rotasiya", r.status_code == 200)
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s3["refresh_token"]})
        check("rotasiyadan çıxmış token təkrar → 400 refresh_token_already_used",
              err_ok(r, 400, "refresh_token_already_used"), r.text)
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s4["refresh_token"]})
        check("oğurluq əlaməti → istifadəçinin BÜTÜN sessiyaları bağlandı (varis də)",
              r.status_code == 400 and n_before >= 1, r.text)
        row = await db_one("select count(*) as n from refresh_sessions where user_id = :i"
                           " and revoked = false", i=aysel_id)
        check("DB-də aktiv sessiya qalmadı", row.n == 0)
        s5 = (await pw_login({"email": "aysel@test.az"}, "YeniParol9")).json()
        r1, r2 = await asyncio.gather(
            c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s5["refresh_token"]}),
            c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": s5["refresh_token"]}))
        codes = sorted([r1.status_code, r2.status_code])
        check("güzəştsiz paralel təkrar → biri uğurlu, digəri reuse (atomik iddia)",
              codes == [200, 400], f"{r1.text[:100]} {r2.text[:100]}")
        os.environ["REFRESH_REUSE_INTERVAL"] = "10"

        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": "zibil"})
        check("etibarsız refresh → 400 refresh_token_not_found", err_ok(r, 400, "refresh_token_not_found"))
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={})
        check("refresh_token yoxdur → 400", err_ok(r, 400, "validation_failed"))
        r = await c.post(f"{A}/token?grant_type=refresh_token",
                         json={"refresh_token": s1["access_token"]})
        check("access token refresh kimi keçmir", r.status_code == 400)

        # köhnə /api/v1/auth/refresh sərt qaydası dəyişməyib
        lg = (await c.post("/api/v1/auth/login", json={"email": "aysel@test.az",
                                                        "password": "YeniParol9"})).json()
        r = await c.post("/api/v1/auth/refresh", json={"refresh_token": lg["refresh_token"]})
        check("/api/v1/auth/refresh rotasiya", r.status_code == 200)
        r = await c.post("/api/v1/auth/refresh", json={"refresh_token": lg["refresh_token"]})
        check("/api/v1/auth/refresh təkrar → 401 (güzəşt yoxdur)", r.status_code == 401)

        # ── 8. Çıxış (scope) ──
        async def new_sess() -> dict:
            return (await pw_login({"phone": "+994551234567"}, "telefon1")).json()

        async def alive(sess: dict) -> bool:
            row = await redis.get(f"rt:{decode_token(sess['refresh_token'], 'refresh')['jti']}")
            return row is not None

        a, b, cc = await new_sess(), await new_sess(), await new_sess()
        r = await c.post(f"{A}/logout?scope=local", headers=bearer(a["access_token"]))
        check("logout local → 204", r.status_code == 204)
        check("local: yalnız cari sessiya bağlandı",
              not await alive(a) and await alive(b) and await alive(cc))
        r = await c.post(f"{A}/logout?scope=others", headers=bearer(b["access_token"]))
        check("others: cari qalır, qalanları bağlanır",
              r.status_code == 204 and await alive(b) and not await alive(cc))
        d = await new_sess()
        r = await c.post(f"{A}/logout", headers=bearer(b["access_token"]))
        check("global (standart): hamısı bağlanır",
              r.status_code == 204 and not await alive(b) and not await alive(d))
        r = await c.post(f"{A}/token?grant_type=refresh_token", json={"refresh_token": d["refresh_token"]})
        check("çıxışdan sonra refresh işləmir", r.status_code == 400)
        r = await c.post(f"{A}/logout")
        check("logout token-siz → 401 (klient bunu nəzərə almır)", r.status_code == 401)
        r = await c.post(f"{A}/logout?scope=hamisi", headers=bearer(d["access_token"]))
        check("naməlum scope → 400", err_ok(r, 400, "validation_failed"))

        # ── 9. redirect_to icazə siyahısı ──
        ok_urls = ["https://ellit.az", "https://ellit.az/", "https://ellit.az/reset-password",
                   "https://ellit.az/any/path?x=1", "http://localhost:5173/",
                   "io.supabase.ellitbooking://login-callback/",
                   "io.supabase.ellitbooking://login-callback"]
        bad_urls = ["https://evil.com/", "https://ellit.az.evil.com/", "https://ellit.az@evil.com/",
                    "http://ellit.az/", "https://ellit.az:8443/", "//evil.com", "javascript:alert(1)",
                    "https://evil.com\\@ellit.az", "https://ellit.az\t.evil.com",
                    "io.supabase.ellitbooking://evil/", "ellitbooking://login-callback/",
                    "http://localhost:5174/", "data:text/html,x", ""]
        check("icazəli ünvanlar keçir", all(gotrue.is_allowed_redirect(u) for u in ok_urls),
              str([u for u in ok_urls if not gotrue.is_allowed_redirect(u)]))
        check("açıq yönləndirmə yoxdur", not any(gotrue.is_allowed_redirect(u) for u in bad_urls),
              str([u for u in bad_urls if gotrue.is_allowed_redirect(u)]))

        # ── 10. Parol bərpası (resetPasswordForEmail → keçid → sessiya) ──
        sent: list[tuple] = []

        async def fake_send(to, subject, body, html=None):
            sent.append((to, subject, body, html))
            return True

        mailer.send_mail, mailer.mail_enabled = fake_send, (lambda: True)

        def last_link() -> str:
            body = sent[-1][2]
            return next(w for w in body.split() if w.startswith("http://t/auth/v1/verify"))

        r = await c.post(f"{A}/recover?redirect_to=https%3A%2F%2Fellit.az%2Freset-password",
                         json={"email": "Aysel@test.az", "gotrue_meta_security": {}})
        check("POST /recover → 200 {}", r.status_code == 200 and r.json() == {} and len(sent) == 1
              and sent[0][0] == "aysel@test.az", r.text)
        link = last_link()
        r = await c.get(link.replace("http://t", ""))
        loc = r.headers.get("location", "")
        f = frag(loc)
        check("bərpa keçidi → icazəli redirect_to + fraqmentdə sessiya (type=recovery)",
              r.status_code == 303 and loc.startswith("https://ellit.az/reset-password#")
              and f.get("type") == "recovery" and f.get("access_token") and f.get("refresh_token")
              and f.get("token_type") == "bearer" and f.get("expires_in"), loc[:200])
        r = await c.put(f"{A}/user", headers=bearer(f["access_token"]), json={"password": "BerpaParol7"})
        check("bərpa sessiyası ilə updateUser({password})", r.status_code == 200)
        check("bərpadan sonra yeni parolla giriş",
              (await pw_login({"email": "aysel@test.az"}, "BerpaParol7")).status_code == 200)
        r = await c.get(link.replace("http://t", ""))
        loc = r.headers.get("location", "")
        check("keçid bir dəfəlikdir → error_code=otp_expired",
              r.status_code == 303 and frag(loc).get("error_code") == "otp_expired", loc)

        r = await c.post(f"{A}/recover?redirect_to=https%3A%2F%2Fevil.com%2F", json={"email": "aysel@test.az"})
        link = last_link()
        check("icazəsiz redirect_to e-poçtdakı keçidə düşmür",
              "evil.com" not in link and "redirect_to=https%3A%2F%2Fellit.az" in link, link)
        # yeni keçid əvvəlkini etibarsız edir; PKCE bərpa
        verifier = b64url(secrets.token_bytes(40))
        challenge = b64url(hashlib.sha256(verifier.encode()).digest())
        r = await c.post(f"{A}/recover?redirect_to=https%3A%2F%2Fellit.az%2Freset-password",
                         json={"email": "aysel@test.az", "code_challenge": challenge,
                               "code_challenge_method": "s256"})
        check("rate-limit (3/saat) hələ aşılmayıb", r.status_code == 200, r.text)
        r_old = await c.get(link.replace("http://t", ""))
        check("yeni keçid köhnəni etibarsız edir",
              frag(r_old.headers["location"]).get("error_code") == "otp_expired")
        r = await c.get(last_link().replace("http://t", ""))
        qs = query(r.headers["location"])
        check("PKCE bərpa keçidi → ?code=", r.status_code == 303 and qs.get("code")
              and "access_token" not in r.headers["location"], r.headers["location"])
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": qs["code"], "code_verifier": verifier})
        check("PKCE bərpa kodu → sessiya", r.status_code == 200 and r.json()["user"]["id"] == aysel_id)
        r = await c.post(f"{A}/recover", json={"email": "aysel@test.az"})
        check("4-cü bərpa sorğusu → 429 over_email_send_rate_limit",
              err_ok(r, 429, "over_email_send_rate_limit"), r.text)
        n_sent = len(sent)
        r = await c.post(f"{A}/recover", json={"email": "heckim@test.az"})
        check("naməlum e-poçt → eyni 200 {}, məktub yoxdur",
              r.status_code == 200 and r.json() == {} and len(sent) == n_sent)
        r = await c.post(f"{A}/recover", json={"email": "yanlis"})
        check("yanlış e-poçt → 400", err_ok(r, 400, "validation_failed"))
        # POST /verify (verifyOtp token_hash)
        r = await c.post(f"{A}/recover", json={"email": "usta@test.az"})
        tok = parse_qs(urlsplit(last_link()).query)["token"][0]
        r = await c.post(f"{A}/verify", json={"type": "recovery", "token_hash": tok})
        check("POST /verify (recovery token_hash) → sessiya",
              r.status_code == 200 and r.json()["user"]["email"] == "usta@test.az", r.text[:200])
        r = await c.post(f"{A}/verify", json={"type": "recovery", "token_hash": tok})
        check("POST /verify təkrar → 403 otp_expired", err_ok(r, 403, "otp_expired"))
        r = await c.post(f"{A}/otp", json={"email": "aysel@test.az"})
        check("POST /otp (magic link) bağlıdır → 422", err_ok(r, 422, "otp_disabled"))

        # ── 11. Google OAuth (veb: implicit; mobil: PKCE) ──
        google_users = {}
        exchanged: list[tuple] = []

        async def fake_exchange(code, redirect_uri):
            exchanged.append((code, redirect_uri))
            return code  # "ID token" = kod; aşağıdakı yoxlayıcı onu açır

        def fake_verify_google(token, audiences=None):
            if audiences is not None and "web-client.apps.googleusercontent.com" not in audiences:
                raise oauth_core.OAuthError("aud uyğunsuz")
            info = google_users[token]
            return {"provider": "google", "sub": info["sub"], "email": info["email"],
                    "name": info["name"], "avatar_url": info["pic"], "nonce": info["nonce"]}

        gotrue._google_exchange_code = fake_exchange
        oauth_core.verify_google_token = fake_verify_google

        async def authorize(**params) -> httpx.Response:
            return await c.get(f"{A}/authorize", params={"provider": "google", **params})

        async def google_round(auth_resp: httpx.Response, sub: str, email: str,
                               name: str = "Google İstifadəçi", nonce_override=None,
                               cookies: bool = True, code: str | None = None) -> httpx.Response:
            gq = query(auth_resp.headers["location"])
            code = code or secrets.token_hex(8)
            google_users[code] = {"sub": sub, "email": email, "name": name,
                                  "pic": "https://img/x.png",
                                  "nonce": nonce_override or gq["nonce"]}
            jar = {k: v for k, v in auth_resp.cookies.items()} if cookies else {}
            c.cookies.clear()
            return await c.get(f"{A}/callback", params={"code": code, "state": gq["state"]},
                               cookies=jar)

        r = await authorize(redirect_to="http://localhost:5173/")
        loc = r.headers.get("location", "")
        gq = query(loc)
        check("GET /authorize → Google-a yönləndirmə",
              r.status_code == 302 and loc.startswith("https://accounts.google.com/")
              and gq["client_id"] == "web-client.apps.googleusercontent.com"
              and gq["redirect_uri"] == "http://t/auth/v1/callback" and gq["state"] and gq["nonce"]
              and gq["response_type"] == "code" and "openid" in gq["scope"], loc[:200])
        check("state brauzer cookie-si ilə bağlanır", any(k.startswith("ellit_oauth_") for k in r.cookies))
        st = decode_token(gq["state"], "oauth_state")
        check("state imzalıdır və qısa ömürlüdür", st["exp"] - st["iat"] <= 600
              and st["r"] == "http://localhost:5173/")

        r = await google_round(r, "g-sub-1", "google.user@gmail.com", name="Leyla Həsənova")
        loc = r.headers.get("location", "")
        f = frag(loc)
        check("callback (implicit) → redirect_to#access_token...",
              r.status_code == 302 and loc.startswith("http://localhost:5173/#")
              and f.get("access_token") and f.get("refresh_token") and f.get("expires_in")
              and f.get("token_type") == "bearer" and exchanged[-1][1] == "http://t/auth/v1/callback",
              loc[:200])
        r = await c.get(f"{A}/user", headers=bearer(f["access_token"]))
        gu = r.json()
        check("Google istifadəçisi: app_metadata.provider=google, metadata ad/avatar",
              gu["app_metadata"]["provider"] == "google" and gu["email"] == "google.user@gmail.com"
              and gu["user_metadata"]["full_name"] == "Leyla Həsənova"
              and gu["user_metadata"]["avatar_url"] == "https://img/x.png"
              and gu["identities"][0]["provider"] == "google", str(gu)[:400])
        row = await db_one("select name, role from profiles where id = :i", i=gu["id"])
        check("Google ilə profil yaradıldı", row.name == "Leyla Həsənova" and row.role == "customer")

        r = await authorize(redirect_to="https://evil.com/steal")
        check("icazəsiz redirect_to → state-də SITE_URL",
              decode_token(query(r.headers["location"])["state"], "oauth_state")["r"] == "https://ellit.az")
        r2 = await google_round(r, "g-sub-1", "google.user@gmail.com")
        check("…və token-lər yalnız SITE_URL-ə gedir",
              r2.headers["location"].startswith("https://ellit.az#")
              or r2.headers["location"].startswith("https://ellit.az/#"), r2.headers["location"][:80])

        r = await authorize(redirect_to="http://localhost:5173/")
        r2 = await google_round(r, "g-sub-1", "google.user@gmail.com", cookies=False)
        check("state cookie-siz (başqa brauzer) → bad_oauth_state, token yoxdur",
              frag(r2.headers["location"]).get("error_code") == "bad_oauth_state"
              and "access_token" not in r2.headers["location"], r2.headers["location"])
        r = await authorize(redirect_to="http://localhost:5173/")
        r2 = await google_round(r, "g-sub-1", "google.user@gmail.com")
        check("normal callback", "access_token" in r2.headers["location"])
        jar = dict(r.cookies)
        r3 = await c.get(f"{A}/callback", params={"code": "yeni", "state": query(r.headers["location"])["state"]},
                         cookies=jar)
        check("state təkrar istifadəsi → bad_oauth_state",
              frag(r3.headers["location"]).get("error_code") == "bad_oauth_state", r3.headers["location"])
        r = await c.get(f"{A}/callback", params={"code": "x", "state": "saxta.state.token"})
        check("saxta state → SITE_URL-ə xəta", r.headers["location"].startswith("https://ellit.az")
              and "bad_oauth_state" in r.headers["location"])
        r = await authorize(redirect_to="http://localhost:5173/")
        r2 = await google_round(r, "g-sub-1", "google.user@gmail.com", nonce_override="basqa")
        check("ID token nonce uyğunsuz → xəta", "access_token" not in r2.headers["location"]
              and "bad_oauth_callback" in r2.headers["location"])
        r = await authorize(redirect_to="http://localhost:5173/")
        jar = dict(r.cookies)
        r2 = await c.get(f"{A}/callback", params={"error": "access_denied",
                                                    "state": query(r.headers["location"])["state"]},
                         cookies=jar)
        check("istifadəçi Google-da imtina etdi → error fraqmenti",
              frag(r2.headers["location"]).get("error") == "access_denied")

        r = await authorize(redirect_to="io.supabase.ellitbooking://login-callback/")
        check("deep-link + PKCE-siz → 400 (token-lər tətbiq URL-inə yazılmır)",
              err_ok(r, 400, "validation_failed", "PKCE"), r.text)
        r = await c.get(f"{A}/authorize", params={"provider": "github"})
        check("naməlum provayder → 400", err_ok(r, 400, "validation_failed"))
        r = await c.get(f"{A}/authorize", params={"provider": "google", "code_challenge": "qısa"})
        check("yanlış code_challenge → 400", err_ok(r, 400, "validation_failed"))

        # mobil: supabase_flutter PKCE axını
        verifier = b64url(secrets.token_bytes(48))
        challenge = b64url(hashlib.sha256(verifier.encode()).digest())
        r = await authorize(redirect_to="io.supabase.ellitbooking://login-callback/",
                            flow_type="pkce", code_challenge=challenge, code_challenge_method="s256")
        check("authorize (PKCE) → 302", r.status_code == 302, r.text)
        r2 = await google_round(r, "g-sub-2", "mobil@gmail.com", name="Mobil")
        loc = r2.headers["location"]
        code = query(loc).get("code")
        check("callback (PKCE) → deep-link?code=, token yoxdur",
              loc.startswith("io.supabase.ellitbooking://login-callback/?code=") and code
              and "access_token" not in loc, loc)
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": code, "code_verifier": "yanlis" * 8})
        check("yanlış code_verifier → 400 bad_code_verifier", err_ok(r, 400, "bad_code_verifier"), r.text)
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": code, "code_verifier": verifier})
        check("yanlış cəhd kodu yandırır → 404 flow_state_not_found",
              err_ok(r, 404, "flow_state_not_found"), r.text)
        r = await authorize(redirect_to="io.supabase.ellitbooking://login-callback/",
                            code_challenge=challenge, code_challenge_method="s256")
        code = query((await google_round(r, "g-sub-2", "mobil@gmail.com")).headers["location"])["code"]
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": code, "code_verifier": verifier})
        ms = r.json()
        check("grant_type=pkce → sessiya", r.status_code == 200 and ms["user"]["email"] == "mobil@gmail.com"
              and ms["user"]["app_metadata"]["provider"] == "google", r.text[:200])
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": code, "code_verifier": verifier})
        check("PKCE kodu bir dəfəlikdir", err_ok(r, 404, "flow_state_not_found"))
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": code})
        check("verifier-siz → 400", err_ok(r, 400, "validation_failed"))
        await redis.setex(f"gotrue:pkce:{hashlib.sha256(b'kohne').hexdigest()}", 1,
                          '{"uid": "%s", "cc": "%s", "ccm": "s256", "kind": "oauth"}' % (ms["user"]["id"], challenge))
        await asyncio.sleep(1.2)
        r = await c.post(f"{A}/token?grant_type=pkce", json={"auth_code": "kohne", "code_verifier": verifier})
        check("vaxtı keçmiş PKCE kodu → 404", err_ok(r, 404, "flow_state_not_found"))

        # Google ilə mövcud e-poçt hesabına bağlanma
        r = await authorize(redirect_to="http://localhost:5173/")
        f = frag((await google_round(r, "g-sub-3", "usta@test.az")).headers["location"])
        r = await c.get(f"{A}/user", headers=bearer(f["access_token"]))
        uu = r.json()
        check("Google kimliyi mövcud e-poçt hesabına bağlandı (yeni hesab yox)",
              uu["email"] == "usta@test.az" and uu["app_metadata"]["provider"] == "email"
              and sorted(uu["app_metadata"]["providers"]) == ["email", "google"], str(uu["app_metadata"]))

        # ── 12. signInWithIdToken (Apple, nonce ilə) ──
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
        pub = jwk.construct(key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode(),
            "RS256").to_dict()
        pub.update(kid="test-kid", alg="RS256", use="sig")
        pub = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in pub.items()}

        async def fake_apple_keys():
            return [pub]

        oauth_core._apple_public_keys = fake_apple_keys

        def apple_token(*, nonce: str | None, aud: str = "asif.dev.ellit.booking", sub: str = "apple-001",
                        email: str | None = "relay@privaterelay.appleid.com", exp_delta: int = 600,
                        nonce_claim: str | None = None) -> str:
            now = int(time.time())
            claims = {"iss": "https://appleid.apple.com", "aud": aud, "sub": sub,
                      "iat": now, "exp": now + exp_delta}
            if email:
                claims["email"] = email
            if nonce is not None:
                claims["nonce"] = hashlib.sha256(nonce.encode()).hexdigest()
            if nonce_claim is not None:  # veb axını: Apple nonce-u olduğu kimi qaytarır
                claims["nonce"] = nonce_claim
            return jwt.encode(claims, pem.decode(), algorithm="RS256", headers={"kid": "test-kid"})

        raw = secrets.token_urlsafe(24)
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw), "nonce": raw,
            "gotrue_meta_security": {"captcha_token": None}, "access_token": None})
        ap = r.json()
        check("Apple signInWithIdToken (nonce) → sessiya",
              r.status_code == 200 and ap["user"]["app_metadata"]["provider"] == "apple"
              and ap["user"]["email"] == "relay@privaterelay.appleid.com", r.text[:300])
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw), "nonce": raw})
        check("təkrar Apple girişi → eyni istifadəçi", r.json()["user"]["id"] == ap["user"]["id"])
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw), "nonce": "basqa-nonce"})
        check("nonce uyğunsuz → 400 'Nonces mismatch'", err_ok(r, 400, "validation_failed", "Nonces mismatch"))
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw)})
        check("token-də nonce var, sorğuda yox → 400", err_ok(r, 400, "validation_failed", "nonce"))
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw, aud="com.basqa.app"), "nonce": raw})
        check("başqa tətbiqin Apple token-i (aud) → 400", err_ok(r, 400, "validation_failed", "aud"), r.text)
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": apple_token(nonce=raw, exp_delta=-60), "nonce": raw})
        check("vaxtı keçmiş Apple token → 400", err_ok(r, 400, "validation_failed"))
        forged = apple_token(nonce=raw)[:-6] + "AAAAAA"
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "apple", "id_token": forged, "nonce": raw})
        check("saxta imza → 400", err_ok(r, 400, "validation_failed"))
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "facebook", "id_token": "x"})
        check("dəstəklənməyən provayder → 400", err_ok(r, 400, "validation_failed"))
        google_users["native-google-id-token"] = {"sub": "g-sub-2", "email": "mobil@gmail.com",
                                                  "name": "Mobil", "pic": None, "nonce": None}
        r = await c.post(f"{A}/token?grant_type=id_token", json={
            "provider": "google", "id_token": "native-google-id-token", "nonce": None})
        check("Google signInWithIdToken (veb client id auditoriyası)",
              r.status_code == 200 and r.json()["user"]["email"] == "mobil@gmail.com", r.text[:200])

        # ── 12b. Apple veb OAuth: /authorize → Apple → POST /callback (form_post) ──
        secret = gotrue._apple_client_secret()
        sh, sc = jwt.get_unverified_header(secret), jwt.get_unverified_claims(secret)
        check("Apple client_secret: .p8 ilə imzalanmış ES256 JWT",
              sh["alg"] == "ES256" and sh["kid"] == "KEY1234567" and sc["iss"] == "TEAM123456"
              and sc["sub"] == "az.ellit.web" and sc["aud"] == "https://appleid.apple.com"
              and 0 < sc["exp"] - sc["iat"] <= 180 * 86400
              and jwt.decode(secret, APPLE_EC_PUB, algorithms=["ES256"],
                             audience="https://appleid.apple.com")["sub"] == "az.ellit.web", str(sc))
        check("client_secret keşlənir", gotrue._apple_client_secret() == secret)

        apple_codes: dict[str, str] = {}
        apple_exchanged: list[tuple] = []

        async def fake_apple_exchange(code, redirect_uri):
            apple_exchanged.append((code, redirect_uri))
            if code not in apple_codes:
                raise oauth_core.OAuthError("invalid_grant")
            return apple_codes[code]

        gotrue._apple_exchange_code = fake_apple_exchange

        async def apple_authorize(redirect_to: str = "http://localhost:5173/") -> httpx.Response:
            return await c.get(f"{A}/authorize", params={"provider": "apple", "redirect_to": redirect_to})

        async def apple_post(auth_resp: httpx.Response, *, sub: str, email: str | None,
                             user_json: str | None = None, nonce_claim: str | None = None,
                             cookies: bool = True, extra: dict | None = None) -> httpx.Response:
            aq_ = query(auth_resp.headers["location"])
            code = "apple-" + secrets.token_hex(6)
            apple_codes[code] = apple_token(nonce=None, aud="az.ellit.web", sub=sub, email=email,
                                            nonce_claim=nonce_claim or aq_["nonce"])
            form = {"code": code, "state": aq_["state"], **({"user": user_json} if user_json else {})}
            form.update(extra or {})
            jar = {k: v for k, v in auth_resp.cookies.items()} if cookies else {}
            c.cookies.clear()
            return await c.post(f"{A}/callback", data=form, cookies=jar)

        r = await apple_authorize()
        loc = r.headers.get("location", "")
        aq = query(loc)
        check("GET /authorize?provider=apple → Apple (form_post, name email)",
              r.status_code == 302 and loc.startswith("https://appleid.apple.com/auth/authorize?")
              and aq["client_id"] == "az.ellit.web" and aq["response_mode"] == "form_post"
              and aq["response_type"] == "code" and aq["scope"] == "name email"
              and aq["redirect_uri"] == "http://t/auth/v1/callback" and aq["state"] and aq["nonce"], loc[:200])
        check("Apple state cookie-si qoyulur", any(k.startswith("ellit_oauth_") for k in r.cookies))
        # HTTPS-də Apple-ın saytlararası POST-unda cookie gəlsin deyə SameSite=None; Secure
        os.environ["API_EXTERNAL_URL"] = "https://api.test"
        try:
            rs = await apple_authorize()
            sc_hdr = rs.headers.get("set-cookie", "").lower()
            rg = await c.get(f"{A}/authorize", params={"provider": "google",
                                                       "redirect_to": "http://localhost:5173/"})
            gc_hdr = rg.headers.get("set-cookie", "").lower()
        finally:
            os.environ["API_EXTERNAL_URL"] = "http://t"
        check("HTTPS: Apple state cookie-si SameSite=None; Secure (Google-da Lax qalır)",
              "samesite=none" in sc_hdr and "secure" in sc_hdr and "samesite=lax" in gc_hdr,
              f"{sc_hdr} | {gc_hdr}")

        r = await apple_post(r, sub="apple-web-1", email="nigar@privaterelay.appleid.com",
                             user_json=json.dumps({"name": {"firstName": "Nigar", "lastName": "Əliyeva"},
                                                   "email": "nigar@privaterelay.appleid.com"}))
        loc = r.headers.get("location", "")
        f = frag(loc)
        check("POST /callback (Apple) → 303 redirect_to#access_token",
              r.status_code == 303 and loc.startswith("http://localhost:5173/#") and f.get("access_token")
              and apple_exchanged[-1][1] == "http://t/auth/v1/callback", f"{r.status_code} {loc[:200]}")
        u = (await c.get(f"{A}/user", headers=bearer(f["access_token"]))).json()
        check("Apple veb istifadəçisi: provider apple, ad ilk girişdən götürülür",
              u["app_metadata"]["provider"] == "apple" and u["email"] == "nigar@privaterelay.appleid.com"
              and u["user_metadata"].get("full_name") == "Nigar Əliyeva", str(u)[:300])

        r = await apple_post(await apple_authorize(), sub="apple-001", email="relay@privaterelay.appleid.com")
        f = frag(r.headers.get("location", ""))
        uu = (await c.get(f"{A}/user", headers=bearer(f["access_token"]))).json()
        check("Apple veb girişi = mobil (native) Apple hesabı (eyni sub → eyni istifadəçi)",
              uu["id"] == ap["user"]["id"], str(uu)[:200])

        r = await apple_post(await apple_authorize(), sub="apple-web-2", email="x@privaterelay.appleid.com",
                             nonce_claim="basqa-nonce")
        check("Apple: nonce uyğunsuz → token yoxdur",
              "access_token" not in r.headers.get("location", "")
              and frag(r.headers["location"]).get("error_code") == "bad_oauth_callback", r.headers.get("location"))
        r = await apple_post(await apple_authorize(), sub="apple-web-3", email="y@privaterelay.appleid.com",
                             cookies=False)
        check("Apple: state cookie-siz (başqa brauzer) → bad_oauth_state",
              frag(r.headers["location"]).get("error_code") == "bad_oauth_state", r.headers.get("location"))
        ar = await apple_authorize()
        c.cookies.clear()
        r = await c.post(f"{A}/callback", data={"error": "user_cancelled_authorize",
                                                "state": query(ar.headers["location"])["state"]},
                         cookies={k: v for k, v in ar.cookies.items()})
        check("Apple: istifadəçi imtina etdi → access_denied",
              r.status_code == 303 and frag(r.headers["location"]).get("error") == "access_denied",
              r.headers.get("location"))
        r = await c.post(f"{A}/callback", content=b"\xff\x00", headers={"content-type": "multipart/form-data"})
        check("POST /callback pozuq gövdə → bad_oauth_state (500 yox)",
              r.status_code == 303 and "bad_oauth_state" in r.headers.get("location", ""), str(r.status_code))
        r = await c.get(f"{A}/authorize", params={"provider": "facebook"})
        check("dəstəklənməyən provayder /authorize → 400", err_ok(r, 400, "validation_failed"))

        # ── 13. Sessiya token-ləri digər backend qatlarında ──
        r = await c.get("/rest/v1/profiles", params={"id": f"eq.{ap['user']['id']}", "select": "id,role"},
                        headers={**bearer(ap["access_token"]), "apikey": "anon"})
        check("compat /rest/v1 token-i tanıyır", r.status_code == 200, r.text[:200])

    await redis.aclose()
    print("GOTRUE TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
