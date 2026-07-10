"""Supabase → yeni PostgreSQL data köçürməsi.

İstifadə:
    export SOURCE_DB_URL="postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres"
    export TARGET_DB_URL="postgresql://ellit:...@localhost:5432/ellit"
    python scripts/migrate_data.py            # tam köçürmə
    python scripts/migrate_data.py --dry-run  # yalnız say hesabatı

Prinsiplər:
  * auth.users → users: ID-lər OLDUĞU KİMİ saxlanır (profiles.id ==
    auth.users.id olduğundan heç bir FK remapping lazım deyil).
    bcrypt parol hash-ləri köçürülür — istifadəçilər parolunu itirmir.
  * identities → oauth_identities (google/apple bağlantıları).
  * Hədəfdə session_replication_role=replica → FK sırası problem olmur.
  * Hər cədvəldə sütun kəsişməsi götürülür (sxem fərqlərinə davamlı).
  * ON CONFLICT DO NOTHING → skript idempotentdir (yarıda kəsilsə
    yenidən işə salmaq təhlükəsizdir).
"""
from __future__ import annotations

import asyncio
import os
import sys

import asyncpg

BATCH = 2000

# Bütün public cədvəllər (sıra əhəmiyyət daşımır — replica rejimi)
TABLES = [
    "profiles", "service_categories", "service_subcategories",
    "service_questions", "service_prices", "services", "brigades",
    "brigade_members", "brigade_assignments", "brigade_invites",
    "brigade_applications", "brigade_prices", "opportunities",
    "opportunities_offers", "opportunity_audit_log", "conversations",
    "chat_messages", "messages", "bookings", "notifications",
    "transactions", "user_transactions", "provider_wallets",
    "provider_bonus_logs", "provider_commissions_logs", "payments",
    "withdrawals", "promo_codes", "promo_redemptions", "provider_requests",
    "provider_reviews", "provider_status", "provider_verifications",
    "disputes", "dispute_attachments", "user_blocks", "user_devices",
    "user_settings", "banners", "announcements", "platform_config",
    "config", "audit_log", "featured_services", "popular_services",
    "promotion_plans", "password_otps",
]


async def copy_auth_users(src: asyncpg.Connection, dst: asyncpg.Connection, dry: bool) -> None:
    rows = await src.fetch(
        """
        select u.id, u.email, u.phone, u.encrypted_password,
               (u.email_confirmed_at is not null) as email_verified,
               u.created_at, u.updated_at,
               coalesce(p.role, 'customer') as role,
               (coalesce(p.status,'active') <> 'blocked') as is_active
          from auth.users u
          left join public.profiles p on p.id = u.id
        """
    )
    print(f"auth.users → users: {len(rows)} istifadəçi", "(dry-run)" if dry else "")
    if dry:
        return
    await dst.executemany(
        """
        insert into users (id, email, phone, password_hash, email_verified,
                           created_at, updated_at, role, is_active,
                           legacy_supabase_id)
        values ($1, nullif(lower($2), ''), nullif($3, ''), $4, $5, $6, $7, $8, $9, $1)
        on conflict (id) do nothing
        """,
        [
            (r["id"], r["email"], r["phone"], r["encrypted_password"],
             r["email_verified"], r["created_at"], r["updated_at"],
             r["role"], r["is_active"])
            for r in rows
        ],
    )

    # OAuth bağlantıları (google/apple)
    idents = await src.fetch(
        """
        select user_id, provider, provider_id, created_at
          from auth.identities
         where provider in ('google', 'apple')
        """
    )
    print(f"auth.identities → oauth_identities: {len(idents)}")
    await dst.executemany(
        """
        insert into oauth_identities (user_id, provider, provider_sub, created_at)
        values ($1, $2, $3, $4)
        on conflict (provider, provider_sub) do nothing
        """,
        [(r["user_id"], r["provider"], r["provider_id"], r["created_at"]) for r in idents],
    )


async def copy_table(src: asyncpg.Connection, dst: asyncpg.Connection, table: str, dry: bool) -> None:
    src_cols = {
        r["column_name"]
        for r in await src.fetch(
            "select column_name from information_schema.columns "
            "where table_schema='public' and table_name=$1", table)
    }
    dst_cols_rows = await dst.fetch(
        "select column_name from information_schema.columns "
        "where table_schema='public' and table_name=$1 order by ordinal_position", table)
    cols = [r["column_name"] for r in dst_cols_rows if r["column_name"] in src_cols]
    if not cols:
        print(f"  ⚠ {table}: ortaq sütun yoxdur — ötürülür")
        return

    total = (await src.fetchrow(f'select count(*) as c from public."{table}"'))["c"]
    print(f"  {table}: {total} sətir ({len(cols)} sütun)", "(dry-run)" if dry else "")
    if dry or total == 0:
        return

    col_list = ", ".join(f'"{c}"' for c in cols)
    placeholders = ", ".join(f"${i+1}" for i in range(len(cols)))
    insert_sql = (
        f'insert into public."{table}" ({col_list}) values ({placeholders}) '
        f"on conflict do nothing"
    )
    offset = 0
    while offset < total:
        rows = await src.fetch(
            f'select {col_list} from public."{table}" limit {BATCH} offset {offset}'
        )
        await dst.executemany(insert_sql, [tuple(r.values()) for r in rows])
        offset += BATCH


async def fix_sequences(dst: asyncpg.Connection) -> None:
    """bigserial/identity sayğaclarını mövcud maksimuma qaldır."""
    for table, col in (("payments", "id"), ("promotion_plans", "id"),
                       ("provider_bonus_logs", "id"), ("services", "id")):
        await dst.execute(
            f"select setval(pg_get_serial_sequence('public.{table}', '{col}'), "
            f"coalesce((select max({col}) from public.{table}), 0) + 1, false)"
        )


async def main() -> None:
    dry = "--dry-run" in sys.argv
    src = await asyncpg.connect(os.environ["SOURCE_DB_URL"])
    dst = await asyncpg.connect(os.environ["TARGET_DB_URL"])
    try:
        if not dry:
            await dst.execute("set session_replication_role = replica")
        await copy_auth_users(src, dst, dry)
        for t in TABLES:
            try:
                await copy_table(src, dst, t, dry)
            except Exception as e:  # bir cədvəl bütün köçürməni dayandırmasın
                print(f"  ✗ {table if (table := t) else t}: {e}")
        if not dry:
            await fix_sequences(dst)
            await dst.execute("set session_replication_role = origin")
        print("KÖÇÜRMƏ TAMAMLANDI ✓" if not dry else "DRY-RUN TAMAMLANDI")
    finally:
        await src.close()
        await dst.close()


if __name__ == "__main__":
    asyncio.run(main())
