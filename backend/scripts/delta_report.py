"""Yeni baza ↔ Supabase: köçürmədən sonra hansı tərəfdə nə dəyişib (YALNIZ OXUYUR).

Veb müvəqqəti Supabase-ə qaytarılanda (mobil hələ yenilənməyib) yeni bazada
yaranmış data itməsin deyə əvvəlcə fərq ölçülür. Hər cədvəl üzrə:

  yalnız yeni bazada  — vebdə (yeni serverdə) yaranıb, Supabase-də yoxdur
  yalnız Supabase-də   — mobildə (Supabase-də) yaranıb, yeni bazada yoxdur
  fərqli               — hər iki tərəfdə var, dəyərlər fərqlidir
                         (updated_at varsa: hansı tərəf daha yenidir)

Köçürmədə fayl ünvanları yeni serverə yazılmışdı (--rewrite-urls) — müqayisədə
bu fərq nəzərə alınmır. Yeni serverə yüklənmiş, Supabase Storage-də olmayan
fayllar ayrıca sayılır.

İstifadə (serverdə):
    docker compose run --rm -e SOURCE_DB_URL api python scripts/delta_report.py
    ... delta_report.py --ids     # hər cədvəldə ilk 20 açar da göstərilir

Heç bir bazaya yazmır. E-poçt/telefon kimi şəxsi məlumat çap etmir — yalnız
say və ID-lər.
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
from collections.abc import Iterable
from typing import Any

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.migrate_data import (  # noqa: E402
    _BACKEND_ONLY, _SKIP_DATA, _columns, _KEPT_USERS_SQL, _tables, _target_dsn,
)

SHOW = 20


def storage_prefixes() -> tuple[str, str]:
    """(yeni server prefiksi, Supabase prefiksi) — açıq fayl ünvanları."""
    api = (os.environ.get("API_EXTERNAL_URL") or "https://api.ellit.az").rstrip("/")
    m = re.search(r"postgres\.([a-z0-9]+)[:@]", os.environ.get("SOURCE_DB_URL", ""))
    ref = os.environ.get("SUPABASE_REF") or (m.group(1) if m else "")
    sup = (os.environ.get("SUPABASE_URL") or f"https://{ref}.supabase.co").rstrip("/")
    return f"{api}/api/v1/storage/public/", f"{sup}/storage/v1/object/public/"


def _norm(value: Any, new: str, old: str) -> Any:
    if isinstance(value, str):
        return value.replace(new, old)
    if isinstance(value, list):
        return [_norm(v, new, old) for v in value]
    return value


def _paths(value: Any, prefix: str) -> Iterable[str]:
    """Dəyərin içindəki yeni server fayl yolları (bucket/ad)."""
    if isinstance(value, str):
        for m in re.finditer(re.escape(prefix) + r"([^\s\"'?#]+)", value):
            yield m.group(1)
    elif isinstance(value, list):
        for v in value:
            yield from _paths(v, prefix)


async def _pk(conn: asyncpg.Connection, table: str) -> list[str]:
    rows = await conn.fetch(
        """
        select a.attname from pg_index i
          join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = format('public.%I', $1::text)::regclass and i.indisprimary
         order by array_position(i.indkey, a.attnum)
        """,
        table,
    )
    return [r["attname"] for r in rows]


class TableDiff:
    def __init__(self, table: str) -> None:
        self.table = table
        self.only_new: list[Any] = []
        self.only_src: list[Any] = []
        self.differ: list[tuple[Any, str]] = []   # (açar, "yeni"/"supabase"/"?")
        self.files: set[str] = set()
        self.note = ""

    @property
    def empty(self) -> bool:
        return not (self.only_new or self.only_src or self.differ or self.note)


async def diff_table(src: asyncpg.Connection, dst: asyncpg.Connection, table: str,
                     new_prefix: str, old_prefix: str) -> TableDiff:
    d = TableDiff(table)
    src_cols = set(await _columns(src, table))
    cols = [c for c in await _columns(dst, table) if c in src_cols]
    pk = [c for c in await _pk(dst, table) if c in cols]
    if not cols:
        d.note = "ortaq sütun yoxdur"
        return d
    col_list = ", ".join(f'"{c}"' for c in cols)
    q = f'select {col_list} from public."{table}"'
    new_rows, src_rows = await dst.fetch(q), await src.fetch(q)

    def key(r: asyncpg.Record) -> Any:
        return tuple(r[c] for c in pk) if pk else tuple(_norm(r[c], new_prefix, old_prefix)
                                                         for c in cols)

    a = {key(r): r for r in new_rows}
    b = {key(r): r for r in src_rows}
    for k, r in a.items():
        if k not in b:
            d.only_new.append(k)
            for c in cols:
                d.files.update(_paths(r[c], new_prefix))
    d.only_src = [k for k in b if k not in a]
    if not pk:
        if d.only_new or d.only_src:
            d.note = "birincil açar yoxdur — tam sətir müqayisəsi"
        return d
    for k in a.keys() & b.keys():
        ra, rb = a[k], b[k]
        changed = [c for c in cols
                   if _norm(ra[c], new_prefix, old_prefix) != _norm(rb[c], new_prefix, old_prefix)]
        if not changed:
            continue
        side = "?"
        if "updated_at" in cols and ra["updated_at"] and rb["updated_at"]:
            side = "yeni" if ra["updated_at"] > rb["updated_at"] else "supabase"
        d.differ.append((k, side))
        for c in changed:
            d.files.update(_paths(ra[c], new_prefix))
    return d


async def diff_users(src: asyncpg.Connection, dst: asyncpg.Connection) -> list[str]:
    """users ↔ auth.users və oauth_identities ↔ auth.identities."""
    lines = []
    new = {r["id"]: r for r in await dst.fetch(
        "select id, password_hash, last_sign_in_at, is_active from users")}
    sup = {r["id"]: r for r in await src.fetch(
        "select id, encrypted_password, last_sign_in_at from auth.users"
        " where deleted_at is null and id in (" + _KEPT_USERS_SQL + ")")}
    only_new = [i for i in new if i not in sup]
    only_src = [i for i in sup if i not in new]
    pw_changed = [i for i in new.keys() & sup.keys()
                  if (new[i]["password_hash"] or "") != (sup[i]["encrypted_password"] or "")
                  and not (new[i]["password_hash"] or "").startswith("$argon2")]
    upgraded = [i for i in new.keys() & sup.keys()
                if (new[i]["password_hash"] or "").startswith("$argon2")]
    lines.append(f"  istifadəçi: yalnız yeni bazada {len(only_new)}, "
                 f"yalnız Supabase-də {len(only_src)}")
    lines.append(f"  parolu yeni serverdə dəyişən: {len(pw_changed)}; "
                 f"girişdə Argon2-yə keçən (yeni serverdə giriş edib): {len(upgraded)}")
    ident_new = {(r["provider"], r["provider_sub"]) for r in await dst.fetch(
        "select provider, provider_sub from oauth_identities")}
    ident_src = {(r["provider"], r["provider_id"]) for r in await src.fetch(
        "select provider, provider_id from auth.identities where provider in ('google','apple')")}
    lines.append(f"  Google/Apple bağlantısı: yalnız yeni bazada {len(ident_new - ident_src)}, "
                 f"yalnız Supabase-də {len(ident_src - ident_new)}")
    if "--ids" in sys.argv:
        for label, ids in (("yalnız yeni", only_new), ("yalnız Supabase", only_src)):
            if ids:
                lines.append(f"    {label}: " + ", ".join(str(i) for i in ids[:SHOW]))
    return lines


async def missing_files(src: asyncpg.Connection, paths: set[str]) -> list[str]:
    if not paths or not await src.fetchval("select to_regclass('storage.objects')"):
        return sorted(paths)
    rows = await src.fetch("select bucket_id || '/' || name as p from storage.objects"
                           " where bucket_id || '/' || name = any($1::text[])", list(paths))
    have = {r["p"] for r in rows}
    return sorted(p for p in paths if p not in have)


async def main() -> int:
    if "SOURCE_DB_URL" not in os.environ:
        print("SOURCE_DB_URL təyin olunmayıb (Supabase bağlantı sətri).")
        return 2
    dsn, tunneled = _target_dsn()
    new_prefix, old_prefix = storage_prefixes()
    src = await asyncpg.connect(os.environ["SOURCE_DB_URL"], statement_cache_size=0)
    dst = await asyncpg.connect(dsn)
    try:
        print("YENİ BAZA ↔ SUPABASE FƏRQİ (heç nə yazılmır)\n")
        print("İstifadəçilər:")
        for line in await diff_users(src, dst):
            print(line)
        src_tables = set(await _tables(src))
        tables = [t for t in await _tables(dst)
                  if t in src_tables and t not in _BACKEND_ONLY | _SKIP_DATA]
        files: set[str] = set()
        print("\nCədvəllər (yalnız fərqi olanlar):")
        print(f"  {'cədvəl':<28}{'yalnız yeni':>12}{'yalnız Supabase':>17}{'fərqli':>8}"
              "  daha yeni tərəf")
        total = 0
        for t in tables:
            try:
                d = await diff_table(src, dst, t, new_prefix, old_prefix)
            except Exception as e:  # noqa: BLE001
                print(f"  ✗ {t}: {type(e).__name__}: {e}")
                continue
            files |= d.files
            if d.empty:
                continue
            total += len(d.only_new) + len(d.only_src) + len(d.differ)
            sides = {}
            for _, s in d.differ:
                sides[s] = sides.get(s, 0) + 1
            side_txt = ", ".join(f"{k}: {v}" for k, v in sorted(sides.items()))
            print(f"  {t:<28}{len(d.only_new):>12}{len(d.only_src):>17}{len(d.differ):>8}"
                  f"  {side_txt}{'  (' + d.note + ')' if d.note else ''}")
            if "--ids" in sys.argv:
                for label, keys in (("yalnız yeni", d.only_new), ("yalnız Supabase", d.only_src),
                                    ("fərqli", [k for k, _ in d.differ])):
                    if keys:
                        shown = ", ".join("/".join(str(x) for x in k) for k in keys[:SHOW])
                        print(f"      {label}: {shown}")
        if not total:
            print("  (fərq yoxdur)")
        missing = await missing_files(src, files)
        print(f"\nYeni serverə yüklənib Supabase Storage-də olmayan fayl: {len(missing)}")
        for p in missing[:SHOW]:
            print(f"    {p}")
        return 0
    finally:
        await src.close()
        await dst.close()
        if tunneled:
            from app.db.tunnel import close_tunnel

            close_tunnel()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
