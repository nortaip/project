"""Supabase Storage → lokal disk (STORAGE_DIR): bütün bucket-lərin faylları.

Fayl siyahısı birbaşa Supabase bazasından (storage.objects) oxunur, fayllar
Storage API-dən service-role açarı ilə endirilir və
STORAGE_DIR/{bucket}/{yol} altına yazılır — backend-in /storage marşrutları
eyni bucket adları və yollarla işləyir.

İstifadə (serverdə; açarlar mühit dəyişənidir, koda/çata yazılmır):
    export SOURCE_DB_URL='postgresql://postgres.<ref>:<parol>@<host>:5432/postgres'
    export SUPABASE_URL='https://<ref>.supabase.co'
    export SUPABASE_SERVICE_KEY='<service_role açarı>'
    python scripts/migrate_storage.py --dry-run          # yalnız siyahı/ölçü
    python scripts/migrate_storage.py                    # endir
    python scripts/migrate_storage.py --rewrite-urls https://api.ellit.az
        # bazadakı Supabase fayl URL-lərini yeni API ünvanına çevirir (hədəf baza)

Təkrar işə salmaq təhlükəsizdir: ölçüsü uyğun gələn mövcud fayl ötürülür.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from urllib.parse import quote

import asyncpg
import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

CONCURRENCY = 6


def _storage_dir() -> Path:
    from app.core.config import settings

    return Path(os.environ.get("STORAGE_DIR") or settings.STORAGE_DIR).resolve()


def _safe_dest(root: Path, bucket: str, name: str) -> Path | None:
    base = (root / bucket).resolve()
    dest = (base / name).resolve()
    return dest if dest.is_relative_to(base) and dest != base else None


async def _list_objects() -> list[asyncpg.Record]:
    src = await asyncpg.connect(os.environ["SOURCE_DB_URL"], statement_cache_size=0)
    try:
        return await src.fetch(
            "select bucket_id, name, coalesce((metadata->>'size')::bigint, -1) as size"
            "  from storage.objects where name not like '%/.emptyFolderPlaceholder'"
            " order by bucket_id, name"
        )
    finally:
        await src.close()


async def download_all(dry: bool) -> int:
    objects = await _list_objects()
    root = _storage_dir()
    per_bucket: dict[str, list[int]] = {}
    for o in objects:
        b = per_bucket.setdefault(o["bucket_id"], [0, 0])
        b[0] += 1
        b[1] += max(o["size"], 0)
    print(f"hədəf qovluq: {root}")
    for bucket, (n, size) in per_bucket.items():
        print(f"  {bucket}: {n} fayl, {size / 1_048_576:.1f} MB")
    if dry:
        print("DRY-RUN TAMAMLANDI (heç nə endirilmədi)")
        return 0

    base = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    sem = asyncio.Semaphore(CONCURRENCY)
    stats = {"ok": 0, "skip": 0, "fail": 0}

    async with httpx.AsyncClient(headers=headers, timeout=120, follow_redirects=True) as http:
        async def one(o: asyncpg.Record) -> None:
            dest = _safe_dest(root, o["bucket_id"], o["name"])
            if dest is None:
                stats["fail"] += 1
                print(f"  ✗ təhlükəli yol ötürüldü: {o['bucket_id']}/{o['name']}")
                return
            if dest.is_file() and o["size"] >= 0 and dest.stat().st_size == o["size"]:
                stats["skip"] += 1
                return
            url = f"{base}/storage/v1/object/{quote(o['bucket_id'])}/{quote(o['name'])}"
            async with sem:
                for attempt in range(4):
                    try:
                        r = await http.get(url)
                        if r.status_code == 200:
                            dest.parent.mkdir(parents=True, exist_ok=True)
                            tmp = dest.with_name(dest.name + ".part")
                            tmp.write_bytes(r.content)
                            tmp.replace(dest)
                            stats["ok"] += 1
                            return
                        if r.status_code < 500 and r.status_code != 429:
                            break
                    except httpx.HTTPError:
                        pass
                    await asyncio.sleep(2 ** attempt)
            stats["fail"] += 1
            print(f"  ✗ endirilmədi: {o['bucket_id']}/{o['name']}")

        await asyncio.gather(*(one(o) for o in objects))

    print(f"endirildi: {stats['ok']}, artıq var idi: {stats['skip']}, uğursuz: {stats['fail']}")
    print("FAYL KÖÇÜRMƏSİ TAMAMLANDI ✓" if not stats["fail"]
          else "FAYL KÖÇÜRMƏSİ XƏTALARLA BİTDİ ✗ — skripti yenidən işə salın")
    return 0 if not stats["fail"] else 1


async def rewrite_urls(new_base: str, dry: bool) -> int:
    """Hədəf bazada Supabase Storage URL-lərini backend URL-lərinə çevirir.

    …/storage/v1/object/public/<bucket>/<yol> → <new_base>/api/v1/storage/public/<bucket>/<yol>
    Mətn, mətn massivi və json/jsonb sütunlarının hamısı yoxlanır.
    """
    from app.core.config import settings
    from app.db.tunnel import close_tunnel, resolve_database_url, tunnel_enabled

    old = os.environ["SUPABASE_URL"].rstrip("/") + "/storage/v1/object/public/"
    new = new_base.rstrip("/") + settings.API_V1_PREFIX + "/storage/public/"
    dsn = (os.environ.get("TARGET_DB_URL") or resolve_database_url()).replace(
        "postgresql+asyncpg://", "postgresql://")
    dst = await asyncpg.connect(dsn)
    total = 0
    try:
        cols = await dst.fetch(
            """
            select c.table_name, c.column_name, c.data_type, c.udt_name
              from information_schema.columns c
              join information_schema.tables t
                on t.table_schema = c.table_schema and t.table_name = c.table_name
             where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
               and c.is_generated = 'NEVER'
               and (c.data_type in ('text', 'character varying', 'json', 'jsonb')
                    or (c.data_type = 'ARRAY' and c.udt_name in ('_text', '_varchar')))
            """
        )
        like = "%" + old.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        async with dst.transaction():
            # yalnız mətn əvəzlənir — biznes trigger-ləri işə düşməsin
            await dst.execute("set local session_replication_role = replica")
            for c in cols:
                t, col = c["table_name"], c["column_name"]
                n = await dst.fetchval(
                    f'select count(*) from public."{t}" where "{col}"::text like $1', like)
                if not n:
                    continue
                total += n
                print(f"  {t}.{col}: {n} sətir")
                if dry:
                    continue
                if c["data_type"] == "ARRAY":
                    expr = f'(select array_agg(replace(x, $1, $2)) from unnest("{col}") x)'
                elif c["data_type"] in ("json", "jsonb"):
                    expr = f'replace("{col}"::text, $1, $2)::{c["data_type"]}'
                else:
                    expr = f'replace("{col}", $1, $2)'
                await dst.execute(
                    f'update public."{t}" set "{col}" = {expr} where "{col}"::text like $3',
                    old, new, like)
        print(f"{'tapıldı' if dry else 'yeniləndi'}: {total} sətir  ({old} → {new})")
        return 0
    finally:
        await dst.close()
        if tunnel_enabled():
            close_tunnel()


def main() -> int:
    dry = "--dry-run" in sys.argv
    if "--rewrite-urls" in sys.argv:
        i = sys.argv.index("--rewrite-urls")
        if i + 1 >= len(sys.argv) or "SUPABASE_URL" not in os.environ:
            print("İstifadə: SUPABASE_URL=… python scripts/migrate_storage.py "
                  "--rewrite-urls https://api.ellit.az [--dry-run]")
            return 2
        return asyncio.run(rewrite_urls(sys.argv[i + 1], dry))
    need = ["SOURCE_DB_URL"] + ([] if dry else ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"])
    missing = [k for k in need if k not in os.environ]
    if missing:
        print("Mühit dəyişənləri çatışmır: " + ", ".join(missing))
        return 2
    return asyncio.run(download_all(dry))


if __name__ == "__main__":
    raise SystemExit(main())
