"""Supabase → öz PostgreSQL köçürməsinin məşqi (lokal, real PostgreSQL).

Supabase-ə bənzər MƏNBƏ baza qurulur (auth.users / auth.identities sxemi,
bcrypt parollar, yalnız-telefon istifadəçi, hədəfdə olmayan artıq sütun və
cədvəl), E2E paketi ilə real data yaradılır, sonra scripts/migrate_data.py
təmiz HƏDƏF bazaya köçürür və nəticə API üzərindən yoxlanır.

İşə salma:
    PG_ADMIN_URL=postgresql://ellit@127.0.0.1:55432/postgres \\
    REDIS_URL=redis://localhost:56379/7 python tests/test_migration.py
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys

import asyncpg
import bcrypt

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN = os.environ.get("PG_ADMIN_URL", "postgresql://ellit@127.0.0.1:55432/postgres")
SRC_DB, TGT_DB = "ellit_mig_src", "ellit_mig_tgt"
LEGACY_PW = "SupabaseKohne#1"


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


def _url(db: str, driver: str = "postgresql") -> str:
    base = ADMIN.rsplit("/", 1)[0]
    return f"{base}/{db}".replace("postgresql://", f"{driver}://")


def _env(db: str, **extra: str) -> dict:
    env = dict(os.environ)
    env.update({
        "DATABASE_URL": _url(db, "postgresql+asyncpg"),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:56379/7"),
        "JWT_SECRET": "test-secret-for-local-smoke-0123456789",
        "CRON_ENABLED": "false", "RATE_LIMIT_AUTH": "1000/minute",
    })
    env.pop("SSH_HOST", None)
    env.update(extra)
    return env


def run(env: dict, *cmd: str) -> tuple[int, str]:
    p = subprocess.run([sys.executable, *cmd], cwd=BACKEND, env=env,
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


async def build_source() -> dict:
    """E2E datası olan bazanı Supabase formasına salır."""
    admin = await asyncpg.connect(ADMIN)
    for db in (SRC_DB, TGT_DB):
        await admin.execute(f"drop database if exists {db} with (force)")
        await admin.execute(f"create database {db}")
    await admin.close()

    rc, out = run(_env(SRC_DB), "-m", "alembic", "upgrade", "head")
    check("mənbə sxemi quruldu", rc == 0, out[-200:] if rc else "")
    for script in ("tests/e2e_smoke.py", "tests/e2e_auth_recovery.py"):
        rc, out = run(_env(SRC_DB), script)
        check(f"mənbədə real data yaradıldı ({script})", rc == 0, out[-300:] if rc else "")

    src = await asyncpg.connect(_url(SRC_DB))
    legacy = bcrypt.hashpw(LEGACY_PW.encode(), bcrypt.gensalt(rounds=10)).decode()
    await src.execute(
        """
        create schema auth;
        create table auth.users (
          id uuid primary key, email text, phone text, encrypted_password text,
          email_confirmed_at timestamptz, banned_until timestamptz,
          deleted_at timestamptz, created_at timestamptz, updated_at timestamptz);
        create table auth.identities (
          id uuid primary key default gen_random_uuid(), user_id uuid not null,
          provider text not null, provider_id text not null,
          created_at timestamptz default now());
        insert into auth.users (id, email, phone, encrypted_password,
                                email_confirmed_at, created_at, updated_at)
          select id, email, phone, password_hash, now(), created_at, updated_at
            from public.users;
        """
    )
    # Supabase-də bütün parollar bcrypt-dir
    await src.execute("update auth.users set encrypted_password = $1"
                      " where encrypted_password is not null", legacy)
    email_user = await src.fetchval(
        "select id from auth.users where email = 'musteri@test.az'")
    phone_user = await src.fetchval(
        "select id from auth.users where email is null and phone = '994501234567'")
    # OAuth-only (parolsuz) istifadəçi + silinmiş + bloklanmış hesab
    oauth_user = await src.fetchval(
        "insert into auth.users (id, email, created_at, updated_at)"
        " values (gen_random_uuid(), 'google.user@test.az', now(), now()) returning id")
    await src.execute(
        "insert into public.profiles (id, email, name, role)"
        " values ($1, 'google.user@test.az', 'Google İstifadəçi', 'customer')", oauth_user)
    await src.execute(
        "insert into auth.identities (user_id, provider, provider_id) values"
        " ($1, 'google', 'google-sub-123'), ($1, 'email', 'google.user@test.az')", oauth_user)
    await src.execute(
        "insert into auth.users (id, email, deleted_at, created_at, updated_at)"
        " values (gen_random_uuid(), 'silinmis@test.az', now(), now(), now())")
    banned = await src.fetchval(
        "insert into auth.users (id, email, encrypted_password, banned_until,"
        " created_at, updated_at) values (gen_random_uuid(), 'bloklu@test.az', $1,"
        " now() + interval '10 years', now(), now()) returning id", legacy)
    await src.execute(
        "insert into public.profiles (id, email, name, role)"
        " values ($1, 'bloklu@test.az', 'Bloklu', 'customer')", banned)
    # Canlı bazada backend cədvəlləri yoxdur; əvəzində hədəfdə olmayan artıqlar var
    await src.execute(
        """
        drop table public.refresh_sessions, public.oauth_identities,
                   public.users, public.alembic_version cascade;
        alter table public.profiles add column kohne_supabase_sutunu text;
        create table public.kohne_supabase_cedveli (id int primary key);
        """
    )
    counts = {
        t: await src.fetchval(f'select count(*) from public."{t}"')
        for t in ("profiles", "opportunities", "opportunities_offers", "transactions",
                  "notifications", "bookings", "brigades", "chat_messages",
                  "service_categories", "provider_wallets")
    }
    # Sayğac yoxlaması üçün: mənbədə yüksək ID-li elan (identity sütunu)
    await src.execute(
        "insert into public.services (id, title) overriding system value"
        " values (5000, 'Köhnə elan')")
    max_service = await src.fetchval("select coalesce(max(id), 0) from public.services")
    await src.close()
    return {"email_user": str(email_user), "phone_user": str(phone_user),
            "oauth_user": str(oauth_user), "banned": str(banned),
            "counts": counts, "max_service": max_service}


async def main() -> None:
    info = await build_source()
    tgt_env = _env(TGT_DB, SOURCE_DB_URL=_url(SRC_DB))

    rc, out = run(tgt_env, "scripts/migrate_data.py", "--dry-run")
    check("hədəf hazır deyilsə köçürmə dayanır", rc == 2 and "alembic upgrade head" in out)
    rc, out = run(tgt_env, "-m", "alembic", "upgrade", "head")
    check("hədəf sxemi quruldu (alembic)", rc == 0, out[-200:] if rc else "")

    rc, out = run(tgt_env, "scripts/migrate_data.py", "--dry-run")
    check("dry-run heç nə yazmır", rc == 0 and "DRY-RUN TAMAMLANDI" in out, out[-200:])
    tgt = await asyncpg.connect(_url(TGT_DB))
    check("dry-run-dan sonra hədəf boşdur",
          await tgt.fetchval("select count(*) from users") == 0
          and await tgt.fetchval("select count(*) from profiles") == 0)

    rc, out = run(tgt_env, "scripts/migrate_data.py")
    print("\n".join("      " + ln for ln in out.strip().splitlines()[-14:]))
    check("köçürmə uğurla bitdi", rc == 0 and "KÖÇÜRMƏ TAMAMLANDI ✓" in out)
    check("hədəfdə olmayan sütun hesabatda göstərilir", "kohne_supabase_sutunu" in out)
    check("hədəfdə olmayan cədvəl hesabatda göstərilir", "kohne_supabase_cedveli" in out)

    for t, n in info["counts"].items():
        got = await tgt.fetchval(f'select count(*) from public."{t}"')
        check(f"{t}: {n} sətir köçdü", got == n, f"(hədəf: {got})")
    row = await tgt.fetchrow("select * from users where id = $1::uuid", info["email_user"])
    check("istifadəçi ID-si və bcrypt hash saxlanıb",
          row is not None and row["password_hash"].startswith("$2")
          and str(row["legacy_supabase_id"]) == info["email_user"])
    check("silinmiş auth hesabı köçmür",
          await tgt.fetchval("select count(*) from users where email='silinmis@test.az'") == 0)
    check("bloklanmış hesab deaktiv köçür", await tgt.fetchval(
        "select is_active from users where id = $1::uuid", info["banned"]) is False)
    check("Google bağlantısı köçdü (email identity yox)", await tgt.fetchval(
        "select count(*) from oauth_identities where user_id = $1::uuid"
        " and provider = 'google' and provider_sub = 'google-sub-123'",
        info["oauth_user"]) == 1 and await tgt.fetchval(
        "select count(*) from oauth_identities") == 1)
    triggers = await tgt.fetchval(
        "select count(*) from pg_trigger where not tgisinternal and tgname not like 'ellit_%'")
    check("hədəfdə köhnə Supabase trigger-i yoxdur", triggers == 0)

    rc, out = run(tgt_env, "scripts/migrate_data.py")
    check("təkrar işə salma təhlükəsizdir (idempotent)", rc == 0)
    for t, n in info["counts"].items():
        got = await tgt.fetchval(f'select count(*) from public."{t}"')
        check(f"{t}: təkrar köçürmədə dublikat yoxdur", got == n, f"({got})")
    rc, out = run(tgt_env, "scripts/migrate_data.py", "--verify")
    check("--verify say müqayisəsi keçir", rc == 0, out[-200:] if rc else "")
    await tgt.close()

    # ── Köçmüş data ilə API işləyirmi ──
    for k, v in tgt_env.items():
        os.environ[k] = v
    sys.path.insert(0, BACKEND)
    import httpx
    from sqlalchemy import text

    from app.db.session import SessionLocal
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                 base_url="http://t") as c:
        r = await c.post("/api/v1/auth/login", json={
            "email": "musteri@test.az", "password": LEGACY_PW})
        check("köçmüş istifadəçi KÖHNƏ parolu ilə girir", r.status_code == 200, r.text[:120])
        ch = {"Authorization": f"Bearer {r.json()['access_token']}"}
        r = await c.post("/api/v1/auth/login", json={
            "identifier": "050 123 45 67", "password": LEGACY_PW})
        check("yalnız-telefon istifadəçi telefonla girir", r.status_code == 200, r.text[:120])
        r = await c.post("/api/v1/auth/login", json={
            "email": "bloklu@test.az", "password": LEGACY_PW})
        check("bloklanmış hesab girə bilmir", r.status_code == 403)
        r = await c.post("/api/v1/auth/login", json={
            "email": "google.user@test.az", "password": LEGACY_PW})
        check("parolsuz (OAuth) hesab parolla girə bilmir", r.status_code == 401)

        r = await c.get("/api/v1/opportunities/mine", headers=ch)
        check("köçmüş sifarişlər API-də görünür", r.status_code == 200 and len(r.json()) >= 1)
        r = await c.get("/api/v1/profiles/me", headers=ch)
        check("köçmüş profil oxunur", r.status_code == 200)
        async with SessionLocal() as db:
            cat = (await db.execute(text(
                "select id from service_categories limit 1"))).scalar()
            new_id = (await db.execute(text(
                "insert into services (title) values ('Sayğac testi') returning id"))).scalar()
            await db.rollback()
        check("serial sayğac köçmüş maksimumdan sonra davam edir",
              new_id > info["max_service"], f"({new_id} > {info['max_service']})")
        r = await c.post("/api/v1/opportunities", headers=ch, json={
            "title": "Köçürmədən sonrakı sifariş", "category_id": str(cat),
            "date": "2026-12-20"})
        check("köçürmədən sonra yeni sifariş yaranır", r.status_code == 201, r.text[:160])
        r = await c.post("/api/v1/auth/password-reset/request",
                         json={"identifier": "musteri@test.az"})
        check("köçmüş hesabda parol bərpası işləyir", r.status_code == 200)

    admin = await asyncpg.connect(ADMIN)
    for db in (SRC_DB, TGT_DB):
        await admin.execute(f"drop database if exists {db} with (force)")
    await admin.close()
    print("\nKÖÇÜRMƏ MƏŞQİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
