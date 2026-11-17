"""Supabase → yeni baza: köçürmədən sonra Supabase-də yaranan/dəyişən datanı əlavə edir.

Köhnə mobil versiya (Supabase-ə bağlı) hələ işlədiyi müddətdə həmin istifadəçilərin
qeydiyyatları, sifarişləri, mesajları və s. yeni bazaya da düşsün deyə. Yeni bazadakı
heç nə SİLİNMİR və vebdə yaranmış data üzərinə yazılmır:

  * Supabase-də olub yeni bazada olmayan sətirlər əlavə olunur (istifadəçilər,
    Google/Apple bağlantıları və bütün ortaq cədvəllər).
  * Hər iki tərəfdə olan sətir Supabase-də DAHA SONRA dəyişibsə (updated_at)
    yenilənir — balans sütunlarından başqa.
  * Balanslar (profiles / provider_wallets / brigades) üzərinə yazılmır: yalnız
    Supabase-dəki DƏYİŞİKLİK (son sinxrondan bəri fərq) yeni bazadakı balansa
    əlavə olunur. Beləcə həm vebdəki, həm köhnə mobildəki pul hərəkəti qalır.
  * Parol: hesab yeni serverdə heç parol dəyişməyibsə (hash hələ köhnə bcrypt-dir)
    və Supabase-də dəyişibsə, Supabase-dəki götürülür.
  * Yeni bazanın ardıcıl ID-ləri (ödəniş, xidmət…) 100000-dən başlayır ki,
    Supabase-in kiçik ID-ləri ilə toqquşmasın (Epoint order_id də unikal qalsın).

Silinmələr köçürülmür. Skript idempotentdir — istənilən qədər təkrarlana bilər
(worker-də SUPABASE_SYNC_DB_URL verilibsə hər SUPABASE_SYNC_MINUTES dəqiqədən bir).

İstifadə (serverdə):
    docker compose run --rm --no-deps -e SOURCE_DB_URL api python scripts/sync_from_supabase.py --dry-run
    docker compose run --rm --no-deps -e SOURCE_DB_URL api python scripts/sync_from_supabase.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from decimal import Decimal
from typing import Any

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.delta_report import _pk  # noqa: E402
from scripts.migrate_data import (  # noqa: E402
    _BACKEND_ONLY, _SKIP_DATA, AUTH_USERS_SQL, INSERT_USERS_SQL, _columns, _tables,
    _target_dsn, user_args,
)

# Üzərinə yazılmayan, yalnız fərqi (delta) köçürülən pul sütunları
PROTECTED: dict[str, tuple[str, ...]] = {
    "profiles": ("balance", "bonus_balance", "total_bonus_earned"),
    "provider_wallets": ("balance", "bonus_balance", "locked_balance"),
    "brigades": ("balance",),
}
ID_FLOOR = 100000

_STATE_DDL = """
    create schema if not exists sync;
    create table if not exists sync.supabase_balance (
      tbl text not null, pk text not null, col text not null, value numeric,
      updated_at timestamptz not null default now(),
      primary key (tbl, pk, col));
    create table if not exists sync.supabase_runs (
      id bigserial primary key, at timestamptz not null default now(), summary jsonb);
"""


def _pk_text(key: tuple) -> str:
    return json.dumps([str(k) for k in key], ensure_ascii=False)


class Report:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.counts: dict[str, Any] = {}

    def add(self, table: str, **kw: int) -> None:
        kw = {k: v for k, v in kw.items() if v}
        if kw:
            self.counts[table] = kw
            self.lines.append(f"  {table:<28} " + ", ".join(f"{k}: {v}" for k, v in kw.items()))


async def sync_users(src, dst, dry: bool, rep: Report) -> None:
    rows = await src.fetch(AUTH_USERS_SQL)
    have = {r["id"]: r for r in await dst.fetch(
        "select id, password_hash, last_sign_in_at from users")}
    missing = [r for r in rows if r["id"] not in have]
    pw = [r for r in rows if r["id"] in have and r["encrypted_password"]
          and (have[r["id"]]["password_hash"] or "").startswith("$2")
          and r["encrypted_password"] != have[r["id"]]["password_hash"]]
    signin = [r for r in rows if r["id"] in have and r["last_sign_in_at"]
              and (have[r["id"]]["last_sign_in_at"] is None
                   or r["last_sign_in_at"] > have[r["id"]]["last_sign_in_at"])]
    added = conflict = 0
    if not dry:
        for r in missing:
            st = await dst.execute(INSERT_USERS_SQL, *user_args(r))
            if st.endswith(" 1"):
                added += 1
            else:
                conflict += 1
                print(f"  ⚠ istifadəçi əlavə olunmadı (e-poçt/telefon yeni bazada başqa "
                      f"hesabdadır): {r['id']}")
        await dst.executemany(
            "update users set password_hash = $2 where id = $1 and password_hash like '$2%'",
            [(r["id"], r["encrypted_password"]) for r in pw])
        await dst.executemany(
            "update users set last_sign_in_at = $2 where id = $1"
            " and (last_sign_in_at is null or last_sign_in_at < $2)",
            [(r["id"], r["last_sign_in_at"]) for r in signin])
    else:
        added = len(missing)
    rep.add("istifadəçi", əlavə=added, toqquşma=conflict, parol=len(pw))

    known = {r["id"] for r in await dst.fetch("select id from users")} if not dry else set(have)
    idents = await src.fetch(
        "select user_id, provider, provider_id, created_at from auth.identities"
        " where provider in ('google', 'apple')")
    have_id = {(r["provider"], r["provider_sub"]) for r in await dst.fetch(
        "select provider, provider_sub from oauth_identities")}
    new_idents = [r for r in idents if (r["provider"], r["provider_id"]) not in have_id
                  and (r["user_id"] in known or dry)]
    if not dry and new_idents:
        await dst.executemany(
            "insert into oauth_identities (user_id, provider, provider_sub, created_at)"
            " values ($1, $2, $3, $4) on conflict do nothing",
            [(r["user_id"], r["provider"], r["provider_id"], r["created_at"]) for r in new_idents])
    rep.add("Google/Apple bağlantısı", əlavə=len(new_idents))


async def sync_table(src, dst, table: str, dry: bool, rep: Report) -> None:
    src_cols = set(await _columns(src, table))
    cols = [c for c in await _columns(dst, table) if c in src_cols]
    pk = [c for c in await _pk(dst, table) if c in cols]
    if not cols or not pk:
        return
    protected = [c for c in PROTECTED.get(table, ()) if c in cols]
    col_list = ", ".join(f'"{c}"' for c in cols)
    src_rows = await src.fetch(f'select {col_list} from public."{table}"')
    if not src_rows:
        return
    has_upd = "updated_at" in cols
    sel = ", ".join(f'"{c}"' for c in dict.fromkeys([*pk, *(["updated_at"] if has_upd else [])]))
    dst_rows = {tuple(r[c] for c in pk): r
                for r in await dst.fetch(f'select {sel} from public."{table}"')}

    def key(r):
        return tuple(r[c] for c in pk)

    missing = [r for r in src_rows if key(r) not in dst_rows]
    newer = [r for r in src_rows if has_upd and key(r) in dst_rows and r["updated_at"]
             and (dst_rows[key(r)]["updated_at"] is None
                  or r["updated_at"] > dst_rows[key(r)]["updated_at"])]

    inserted = 0
    if missing and not dry:
        before = await dst.fetchval(f'select count(*) from public."{table}"')
        ph = ", ".join(f"${i + 1}" for i in range(len(cols)))
        await dst.executemany(
            f'insert into public."{table}" ({col_list}) overriding system value'
            f" values ({ph}) on conflict do nothing",
            [tuple(r[c] for c in cols) for r in missing])
        inserted = await dst.fetchval(f'select count(*) from public."{table}"') - before
    elif missing:
        inserted = len(missing)

    upd_cols = [c for c in cols if c not in pk and c not in protected]
    if newer and upd_cols and not dry:
        sets = ", ".join(f'"{c}" = ${i + 1 + len(pk)}' for i, c in enumerate(upd_cols))
        where = " and ".join(f'"{c}" = ${i + 1}' for i, c in enumerate(pk))
        await dst.executemany(
            f'update public."{table}" set {sets} where {where}',
            [(*key(r), *(r[c] for c in upd_cols)) for r in newer])

    # ── Balanslar: yalnız Supabase-dəki dəyişiklik (delta) əlavə olunur ──
    moved = 0
    if protected:
        state = {(r["pk"], r["col"]): r["value"] for r in await dst.fetch(
            "select pk, col, value from sync.supabase_balance where tbl = $1", table)
        } if await dst.fetchval("select to_regclass('sync.supabase_balance')") else {}
        inserted_keys = {key(r) for r in missing}
        adjust: list[tuple] = []
        baseline: list[tuple] = []
        for r in src_rows:
            k = key(r)
            pkt = _pk_text(k)
            for c in protected:
                sv = r[c] if r[c] is not None else Decimal(0)
                base = state.get((pkt, c))
                if base is None or k in inserted_keys:
                    baseline.append((table, pkt, c, sv))      # ilk dəfə: başlanğıc nöqtəsi
                elif sv != base:
                    adjust.append((k, c, sv - base))
                    baseline.append((table, pkt, c, sv))
        moved = len(adjust)
        if not dry:
            where = " and ".join(f'"{c}" = ${i + 2}' for i, c in enumerate(pk))
            for k, c, delta in adjust:
                await dst.execute(
                    f'update public."{table}" set "{c}" = coalesce("{c}", 0) + $1 where {where}',
                    delta, *k)
                print(f"  ₼ {table}.{c} {'/'.join(map(str, k))}: {delta:+}")
            await dst.executemany(
                "insert into sync.supabase_balance (tbl, pk, col, value) values ($1, $2, $3, $4)"
                " on conflict (tbl, pk, col) do update set value = excluded.value,"
                " updated_at = now()", baseline)
    rep.add(table, əlavə=inserted, toqquşma=len(missing) - inserted, yeniləndi=len(newer),
            balans=moved)


async def bump_sequences(src, dst, dry: bool, rep: Report) -> None:
    """Yeni bazada ardıcıl ID-ləri Supabase-in diapazonundan uzaqlaşdır."""
    rows = await dst.fetch(
        """
        select c.table_name, c.column_name,
               coalesce(pg_get_serial_sequence(format('public.%I', c.table_name), c.column_name),
                        substring(c.column_default from $re$nextval\\('([^']+)'$re$)) as seq
          from information_schema.columns c
          join information_schema.tables t using (table_schema, table_name)
         where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
           and (c.column_default like 'nextval(%' or c.is_identity = 'YES')
        """
    )
    src_tables = set(await _tables(src))
    for r in rows:
        if not r["seq"]:
            continue
        t, c = r["table_name"], r["column_name"]
        dst_max = await dst.fetchval(f'select coalesce(max("{c}"), 0) from public."{t}"')
        src_max = await src.fetchval(
            f'select coalesce(max("{c}"), 0) from public."{t}"') if t in src_tables else 0
        cur = await dst.fetchval(
            f"select case when is_called then last_value + 1 else last_value end from {r['seq']}")
        want = max(dst_max + 1, src_max + 1, ID_FLOOR, cur)
        if want != cur:
            if not dry:
                await dst.execute("select setval($1::regclass, $2, false)", r["seq"], want)
            rep.add(f"sayğac {t}.{c}", növbəti=want)


async def run_sync(src_dsn: str, dst_dsn: str, *, dry: bool = False) -> Report:
    rep = Report()
    src = await asyncpg.connect(src_dsn, statement_cache_size=0)
    dst = await asyncpg.connect(dst_dsn)
    try:
        if not dry:
            await dst.execute(_STATE_DDL)
        # Bir anda yalnız bir sinxron (worker + əl ilə işə salma toqquşmasın)
        if not await dst.fetchval("select pg_try_advisory_lock(hashtext('ellit_supabase_sync'))"):
            rep.lines.append("  başqa sinxron hələ işləyir — ötürüldü")
            return rep
        async with src.transaction(isolation="repeatable_read", readonly=True):
            async with dst.transaction():
                await dst.execute("set local session_replication_role = replica")
                await sync_users(src, dst, dry, rep)
                src_tables = set(await _tables(src))
                for t in await _tables(dst):
                    if t in src_tables and t not in _BACKEND_ONLY | _SKIP_DATA:
                        await sync_table(src, dst, t, dry, rep)
                await bump_sequences(src, dst, dry, rep)
                if not dry:
                    await dst.execute("insert into sync.supabase_runs (summary) values ($1::jsonb)",
                                      json.dumps(rep.counts, ensure_ascii=False, default=str))
        return rep
    finally:
        await dst.execute("select pg_advisory_unlock_all()")
        await src.close()
        await dst.close()


async def main() -> int:
    dry = "--dry-run" in sys.argv
    if "SOURCE_DB_URL" not in os.environ:
        print("SOURCE_DB_URL təyin olunmayıb (Supabase bağlantı sətri).")
        return 2
    dsn, tunneled = _target_dsn()
    try:
        rep = await run_sync(os.environ["SOURCE_DB_URL"], dsn, dry=dry)
    finally:
        if tunneled:
            from app.db.tunnel import close_tunnel

            close_tunnel()
    print("SUPABASE → YENİ BAZA" + (" (DRY-RUN, heç nə yazılmadı)" if dry else ""))
    print("\n".join(rep.lines) if rep.lines else "  yenilik yoxdur")
    print("\nSİNXRON TAMAMLANDI ✓" if not dry else "")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
