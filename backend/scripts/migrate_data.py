"""Supabase → öz PostgreSQL: tam data köçürməsi (Supabase bağlanmazdan əvvəl).

Nə edir:
  1. auth.users      → users            (ID-lər, e-poçt, telefon, bcrypt parol hash-ləri)
  2. auth.identities → oauth_identities (Google / Apple bağlantıları)
  3. public.*        → public.*         (hədəfdəki BÜTÜN cədvəllər, avtomatik siyahı)
  4. sayğaclar (sequence) mövcud maksimuma qaldırılır
  5. yoxlama: hər cədvəldə mənbə və hədəf sətir sayı tutuşdurulur

Hədəf baza əvvəlcədən `python -m alembic upgrade head` ilə yaradılmalıdır —
yəni köhnə Supabase funksiya/trigger/RLS-ləri DAŞINMIR, yalnız data.

İstifadə (serverdə; sirlər .env / mühit dəyişənlərindədir, koda yazılmır):
    export SOURCE_DB_URL='postgresql://postgres.<ref>:<parol>@<host>:5432/postgres'
    python scripts/migrate_data.py --dry-run     # yalnız hesabat, heç nə yazmır
    python scripts/migrate_data.py               # köçür + yoxla
    python scripts/migrate_data.py --verify      # yalnız say müqayisəsi

Hədəf: TARGET_DB_URL verilibsə o, əks halda tətbiqin öz konfiqurasiyası
(DATABASE_URL; SSH_HOST doludursa SSH tuneli üzərindən).

Prinsiplər:
  * ID-lər olduğu kimi saxlanır (profiles.id == auth.users.id) → FK remapping yoxdur.
  * Parollar itmir: bcrypt hash köçür, ilk girişdə şəffaf şəkildə Argon2-yə keçir.
  * Hədəfdə session_replication_role=replica → FK sırası və trigger-lər köçürmə
    zamanı işləmir (data olduğu kimi düşür).
  * Hər cədvəldə sütun kəsişməsi götürülür; mənbədə olub hədəfdə OLMAYAN
    sütun/cədvəllər hesabatda göstərilir (səssiz itki olmasın).
  * ON CONFLICT DO NOTHING → skript idempotentdir; yarıda kəsilsə yenidən işə salın.
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

BATCH = 2000

# Hədəfdə backend-in öz cədvəlləri — public köçürməsindən kənar
_BACKEND_ONLY = {"users", "oauth_identities", "refresh_sessions", "alembic_version"}
# Köçürülməsi mənasız olan müvəqqəti data
_SKIP_DATA = {"password_otps"}


def _target_dsn() -> tuple[str, bool]:
    """(asyncpg DSN, tunel açılıbmı)."""
    explicit = os.environ.get("TARGET_DB_URL")
    if explicit:
        return explicit.replace("postgresql+asyncpg://", "postgresql://"), False
    from app.db.tunnel import resolve_database_url, tunnel_enabled

    return resolve_database_url().replace("postgresql+asyncpg://", "postgresql://"), tunnel_enabled()


async def _tables(conn: asyncpg.Connection) -> list[str]:
    rows = await conn.fetch(
        "select table_name from information_schema.tables"
        " where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"
    )
    return [r["table_name"] for r in rows]


async def _columns(conn: asyncpg.Connection, table: str) -> list[str]:
    rows = await conn.fetch(
        "select column_name from information_schema.columns"
        " where table_schema = 'public' and table_name = $1"
        "   and is_generated = 'NEVER' order by ordinal_position",
        table,
    )
    return [r["column_name"] for r in rows]


async def _count(conn: asyncpg.Connection, table: str, schema: str = "public") -> int:
    return await conn.fetchval(f'select count(*) from {schema}."{table}"')


# E-poçtu (hərf registrindən asılı olmayaraq) eyni olan hesablardan yalnız biri
# köçürülür: profili, parolu, girişi olan "həqiqi" hesab. Canlı bazada 26 belə
# cüt var — ikincisi parolsuz, profilsiz, heç vaxt giriş etməmiş "xəyali"
# hesabdır (created_at boş). Yeni sistemdə e-poçt unikaldır.
_KEPT_USERS_SQL = """
    select id from (
      select u.id, row_number() over (
               partition by coalesce(lower(u.email), u.id::text)
               order by (exists (select 1 from public.profiles p where p.id = u.id)) desc,
                        (coalesce(u.encrypted_password, '') <> '') desc,
                        (u.last_sign_in_at is not null) desc,
                        (u.created_at is not null) desc,
                        u.created_at nulls last, u.id) as rn
        from auth.users u
       where u.deleted_at is null) z
     where rn = 1
"""


async def copy_auth(src: asyncpg.Connection, dst: asyncpg.Connection, dry: bool) -> None:
    rows = await src.fetch(
        """
        select u.id, u.email, u.phone, u.encrypted_password,
               (u.email_confirmed_at is not null) as email_verified,
               coalesce(u.created_at, p.created_at, now()) as created_at,
               coalesce(u.updated_at, u.created_at, p.created_at, now()) as updated_at,
               u.last_sign_in_at,
               coalesce(u.raw_user_meta_data, '{}'::jsonb)::text as user_metadata,
               coalesce(nullif(p.role, ''), 'customer') as role,
               not (coalesce(p.status, 'active') = 'blocked'
                    or coalesce(u.banned_until > now(), false)) as is_active
          from auth.users u
          left join public.profiles p on p.id = u.id
         where u.id in (""" + _KEPT_USERS_SQL + """)
        """
    )
    skipped = await src.fetch(
        "select u.id from auth.users u where u.deleted_at is null and u.id not in ("
        + _KEPT_USERS_SQL + ")")
    if skipped:
        print(f"⚠ e-poçtu (hərf registrindən asılı olmayaraq) təkrarlanan {len(skipped)} "
              "hesab köçürülmür — hər qrupda profili/parolu/girişi olan hesab saxlanılır:")
        for r in skipped:
            print(f"    atlandı: {r['id']}")
    with_pw = sum(1 for r in rows if r["encrypted_password"])
    phone_only = sum(1 for r in rows if not r["email"] and r["phone"])
    print(f"auth.users → users: {len(rows)} istifadəçi "
          f"(parollu: {with_pw}, yalnız telefon: {phone_only})")
    idents = await src.fetch(
        "select user_id, provider, provider_id, created_at from auth.identities"
        " where provider in ('google', 'apple')"
    )
    print(f"auth.identities → oauth_identities: {len(idents)} (google/apple)")
    if dry:
        return
    await dst.executemany(
        """
        insert into users (id, email, phone, password_hash, email_verified,
                           created_at, updated_at, role, is_active, legacy_supabase_id,
                           user_metadata, last_sign_in_at)
        values ($1, nullif(lower($2), ''), nullif($3, ''), nullif($4, ''),
                $5, $6, $7, left($8, 24), $9, $1, ($10::text)::jsonb, $11)
        on conflict do nothing
        """,
        [
            (r["id"], r["email"], r["phone"], r["encrypted_password"],
             r["email_verified"], r["created_at"], r["updated_at"],
             r["role"], r["is_active"], r["user_metadata"], r["last_sign_in_at"])
            for r in rows
        ],
    )
    known = {r["id"] for r in await dst.fetch("select id from users")}
    missing = [r for r in rows if r["id"] not in known]
    for r in missing:
        print(f"  ⚠ istifadəçi köçmədi (təkrarlanan e-poçt/telefon?): {r['id']}")
    await dst.executemany(
        """
        insert into oauth_identities (user_id, provider, provider_sub, created_at)
        values ($1, $2, $3, $4)
        on conflict do nothing
        """,
        [(r["user_id"], r["provider"], r["provider_id"], r["created_at"])
         for r in idents if r["user_id"] in known],
    )


async def copy_table(src: asyncpg.Connection, dst: asyncpg.Connection,
                     table: str, dry: bool) -> None:
    src_cols = set(await _columns(src, table))
    dst_cols = await _columns(dst, table)
    cols = [c for c in dst_cols if c in src_cols]
    dropped = sorted(src_cols - set(dst_cols))
    if dropped:
        print(f"  ⚠ {table}: mənbədə var, hədəfdə YOXDUR → köçmür: {', '.join(dropped)}")
    if not cols:
        print(f"  ⚠ {table}: ortaq sütun yoxdur — ötürülür")
        return
    total = await _count(src, table)
    print(f"  {table}: {total} sətir ({len(cols)} sütun)")
    if dry or total == 0:
        return

    col_list = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(cols)))
    insert_sql = (
        f'insert into public."{table}" ({col_list}) overriding system value'
        f" values ({placeholders}) on conflict do nothing"
    )
    # Server tərəfi kursor: böyük cədvəllər yaddaşa yığılmır, sıra sabitdir
    async with src.transaction(isolation="repeatable_read", readonly=True):
        cur = await src.cursor(f'select {col_list} from public."{table}"')
        while True:
            rows = await cur.fetch(BATCH)
            if not rows:
                break
            await dst.executemany(insert_sql, [tuple(r.values()) for r in rows])


async def fix_sequences(dst: asyncpg.Connection) -> None:
    """serial/identity sayğaclarını mövcud maksimumdan sonraya qoy."""
    rows = await dst.fetch(
        """
        select c.table_name, c.column_name,
               pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name) as seq
          from information_schema.columns c
          join information_schema.tables t
            on t.table_schema = c.table_schema and t.table_name = c.table_name
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and (c.column_default like 'nextval(%' or c.is_identity = 'YES')
        """
    )
    for r in rows:
        if r["seq"]:
            await dst.execute(
                f"select setval($1::regclass, coalesce((select max(\"{r['column_name']}\")"
                f" from public.\"{r['table_name']}\"), 0) + 1, false)",
                r["seq"],
            )
    print(f"sayğaclar yeniləndi: {sum(1 for r in rows if r['seq'])}")


async def verify(src: asyncpg.Connection, dst: asyncpg.Connection,
                 tables: list[str]) -> bool:
    ok = True
    print("\nYOXLAMA (mənbə → hədəf sətir sayı)")
    s = await src.fetchval(f"select count(*) from ({_KEPT_USERS_SQL}) k")
    d = await dst.fetchval("select count(*) from users")
    mark = "✓" if d >= s else "✗"
    ok &= d >= s
    print(f"  [{mark}] users: {s} → {d}")
    for t in tables:
        s, d = await _count(src, t), await _count(dst, t)
        good = d >= s  # hədəfdə yeni sətirlər ola bilər (köçürmədən sonrakı fəaliyyət)
        ok &= good
        if not good or s:
            print(f"  [{'✓' if good else '✗'}] {t}: {s} → {d}")
    orphans = await dst.fetchval(
        "select count(*) from profiles p where not exists"
        " (select 1 from users u where u.id = p.id)"
    )
    if orphans:
        print(f"  ⚠ kimliyi olmayan profil: {orphans} (auth.users-də silinmiş hesablar)")
    return ok


async def main() -> int:
    dry = "--dry-run" in sys.argv
    only_verify = "--verify" in sys.argv
    if "SOURCE_DB_URL" not in os.environ:
        print("SOURCE_DB_URL təyin olunmayıb (Supabase → Settings → Database → "
              "Connection string). Onu mühit dəyişəni kimi verin.")
        return 2
    dsn, tunneled = _target_dsn()
    src = await asyncpg.connect(os.environ["SOURCE_DB_URL"], statement_cache_size=0)
    dst = await asyncpg.connect(dsn)
    try:
        version = await dst.fetchval(
            "select version_num from alembic_version limit 1") if await dst.fetchval(
            "select to_regclass('public.alembic_version')") else None
        if version is None:
            print("Hədəf baza hazır deyil — əvvəlcə: python -m alembic upgrade head")
            return 2
        print(f"hədəf sxem versiyası: {version}" + (" (SSH tuneli ilə)" if tunneled else ""))

        src_tables, dst_tables = set(await _tables(src)), await _tables(dst)
        tables = [t for t in dst_tables
                  if t in src_tables and t not in _BACKEND_ONLY | _SKIP_DATA]
        not_in_target = sorted(src_tables - set(dst_tables))
        if not_in_target:
            print("⚠ mənbədə var, hədəfdə YOXDUR (köçmür): " + ", ".join(not_in_target))

        if only_verify:
            return 0 if await verify(src, dst, tables) else 1

        if not dry:
            await dst.execute("set session_replication_role = replica")
        await copy_auth(src, dst, dry)
        failed: list[str] = []
        for t in tables:
            try:
                await copy_table(src, dst, t, dry)
            except Exception as e:  # noqa: BLE001 — bir cədvəl hamısını dayandırmasın
                failed.append(t)
                print(f"  ✗ {t}: {type(e).__name__}: {e}")
        if dry:
            print("\nDRY-RUN TAMAMLANDI (heç nə yazılmadı)")
            return 0
        await fix_sequences(dst)
        await dst.execute("set session_replication_role = origin")
        ok = await verify(src, dst, tables) and not failed
        print("\nKÖÇÜRMƏ TAMAMLANDI ✓" if ok
              else "\nKÖÇÜRMƏ XƏTALARLA BİTDİ ✗ — yuxarıdakı sətirlərə baxın")
        return 0 if ok else 1
    finally:
        await src.close()
        await dst.close()
        if tunneled:
            from app.db.tunnel import close_tunnel

            close_tunnel()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
