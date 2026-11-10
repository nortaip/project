"""Fayl saxlama + Supabase Storage köçürməsi testi.

Saxta Supabase Storage serveri (eyni URL forması və Authorization tələbi) və
storage.objects cədvəli olan mənbə baza qurulur; scripts/migrate_storage.py
faylları endirir, URL-ləri çevirir, sonra backend-in /storage marşrutları
köçmüş faylları düzgün icazələrlə verir.

İşə salma:
    PG_ADMIN_URL=postgresql://ellit@127.0.0.1:55432/postgres \\
    REDIS_URL=redis://localhost:56379/8 python tests/test_storage_migration.py
"""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

import asyncpg

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADMIN = os.environ.get("PG_ADMIN_URL", "postgresql://ellit@127.0.0.1:55432/postgres")
SRC_DB, TGT_DB = "ellit_stor_src", "ellit_stor_tgt"
SERVICE_KEY = "test-service-role-key"
OWNER = "11111111-1111-4111-8111-111111111111"

FILES = {
    ("banners", "banner-1.gif"): b"GIF89a" + b"\x00" * 200,
    ("service-images", "services/abc/1746-foto şəkil.jpg"): b"\xff\xd8" + b"S" * 5000,
    ("kyc-documents", f"{OWNER}/178_id_front.jpg"): b"\xff\xd8" + b"K" * 3000,
    ("make-33c80158-profile-photos", f"{OWNER}/avatar.png"): b"\x89PNG" + b"A" * 800,
}


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


class _FakeSupabase(BaseHTTPRequestHandler):
    hits: dict[str, int] = {}

    def log_message(self, *a):  # noqa: ANN002
        pass

    def do_GET(self):  # noqa: N802
        prefix = "/storage/v1/object/"
        if not self.path.startswith(prefix):
            self.send_error(404)
            return
        if self.headers.get("Authorization") != f"Bearer {SERVICE_KEY}":
            self.send_error(400)
            return
        bucket, _, name = unquote(self.path[len(prefix):]).partition("/")
        n = _FakeSupabase.hits[name] = _FakeSupabase.hits.get(name, 0) + 1
        if bucket == "banners" and n == 1:
            self.send_error(503)  # müvəqqəti xəta → skript təkrar cəhd etməlidir
            return
        data = FILES.get((bucket, name))
        if data is None:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def _url(db: str, driver: str = "postgresql") -> str:
    return f"{ADMIN.rsplit('/', 1)[0]}/{db}".replace("postgresql://", f"{driver}://")


def run(env: dict, *cmd: str) -> tuple[int, str]:
    p = subprocess.run([sys.executable, *cmd], cwd=BACKEND, env=env,
                       capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


async def main() -> None:
    admin = await asyncpg.connect(ADMIN)
    for db in (SRC_DB, TGT_DB):
        await admin.execute(f"drop database if exists {db} with (force)")
        await admin.execute(f"create database {db}")
    await admin.close()

    src = await asyncpg.connect(_url(SRC_DB))
    await src.execute(
        "create schema storage; create table storage.objects"
        " (bucket_id text, name text, metadata jsonb)")
    for (bucket, name), data in FILES.items():
        await src.execute(
            "insert into storage.objects values ($1, $2, $3::jsonb)",
            bucket, name, '{"size": %d}' % len(data))
    await src.execute(
        "insert into storage.objects values"
        " ('banners', '../../../kenar/evil.gif', '{\"size\": 5}'),"
        " ('banners', 'qovluq/.emptyFolderPlaceholder', '{\"size\": 0}')")
    await src.close()

    server = ThreadingHTTPServer(("127.0.0.1", 0), _FakeSupabase)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    supabase_url = f"http://127.0.0.1:{server.server_address[1]}"
    work = Path(tempfile.mkdtemp(prefix="ellit-stor-"))
    storage_dir = work / "data" / "storage"

    env = dict(os.environ)
    env.pop("SSH_HOST", None)
    env.update({
        "DATABASE_URL": _url(TGT_DB, "postgresql+asyncpg"),
        "REDIS_URL": os.environ.get("REDIS_URL", "redis://localhost:56379/8"),
        "JWT_SECRET": "test-secret-for-local-smoke-0123456789",
        "CRON_ENABLED": "false", "RATE_LIMIT_AUTH": "1000/minute",
        "STORAGE_DIR": str(storage_dir), "SOURCE_DB_URL": _url(SRC_DB),
        "SUPABASE_URL": supabase_url, "SUPABASE_SERVICE_KEY": SERVICE_KEY,
    })

    try:
        # ── 1. Faylların endirilməsi ──
        rc, out = run(env, "scripts/migrate_storage.py", "--dry-run")
        check("dry-run siyahı verir, heç nə endirmir",
              rc == 0 and "service-images: 1 fayl" in out and not storage_dir.exists(), out[-200:])
        rc, out = run(env, "scripts/migrate_storage.py")
        for (bucket, name), data in FILES.items():
            f = storage_dir / bucket / name
            check(f"endirildi: {bucket}/{name[-28:]}", f.is_file() and f.read_bytes() == data)
        check("müvəqqəti 503-dən sonra təkrar cəhd işlədi",
              _FakeSupabase.hits.get("banner-1.gif") == 2)
        check("qovluqdan kənara yazan yol rədd edildi",
              rc == 1 and "təhlükəli yol" in out and not (work / "kenar").exists()
              and not list(work.rglob("evil.gif")))
        check("yer tutucu fayl ötürüldü", not list(storage_dir.rglob(".emptyFolderPlaceholder")))
        before = dict(_FakeSupabase.hits)
        rc, out = run(env, "scripts/migrate_storage.py")
        check("təkrar işə salma mövcud faylları yenidən endirmir",
              _FakeSupabase.hits == before and "artıq var idi: 4" in out, out[-160:])

        # ── 2. Bazadakı URL-lərin çevrilməsi ──
        rc, out = run(env, "-m", "alembic", "upgrade", "head")
        check("hədəf sxemi quruldu", rc == 0, out[-200:] if rc else "")
        old = f"{supabase_url}/storage/v1/object/public"
        tgt = await asyncpg.connect(_url(TGT_DB))
        await tgt.execute(
            "insert into banners (title, image_url, link_url) values"
            " ('Yay', $1, 'https://ellit.az/kampaniya')", f"{old}/banners/banner-1.gif")
        await tgt.execute(
            "insert into services (title, images) values ('Elan', $1)",
            [f"{old}/service-images/services/abc/1.jpg", "https://basqa.sayt/x.jpg"])
        await tgt.execute(
            "insert into users (id, email, role) values ($1::uuid, 'sahib@test.az', 'customer')",
            OWNER)
        await tgt.execute(
            "insert into profiles (id, name, role, avatar_url) values"
            " ($1::uuid, 'Sahib', 'customer', 'https://lh3.googleusercontent.com/a/xyz')", OWNER)
        cat = await tgt.fetchval(
            "insert into service_categories (label) values ('Təmir') returning id")
        await tgt.execute(
            "insert into opportunities (title, created_by, category_id, date, status,"
            " extra_answers) values ('Sifariş', $1::uuid, $2, current_date, 'completed',"
            " $3::jsonb)", OWNER, cat, '{"foto": "%s/opportunity-photos/a/b.jpg"}' % old)

        rc, out = run(env, "scripts/migrate_storage.py", "--rewrite-urls",
                      "https://api.ellit.az", "--dry-run")
        check("URL çevirmə dry-run: tapır, dəyişmir", rc == 0 and "tapıldı: 3" in out
              and await tgt.fetchval("select image_url from banners") == f"{old}/banners/banner-1.gif",
              out[-200:])
        rc, out = run(env, "scripts/migrate_storage.py", "--rewrite-urls", "https://api.ellit.az")
        new = "https://api.ellit.az/api/v1/storage/public"
        check("mətn sütunu çevrildi", rc == 0 and await tgt.fetchval(
            "select image_url from banners") == f"{new}/banners/banner-1.gif", out[-200:])
        check("mətn massivi çevrildi, kənar URL-ə toxunulmadı", await tgt.fetchval(
            "select images from services") == [f"{new}/service-images/services/abc/1.jpg",
                                                "https://basqa.sayt/x.jpg"])
        check("jsonb daxilindəki URL çevrildi", await tgt.fetchval(
            "select extra_answers->>'foto' from opportunities") == f"{new}/opportunity-photos/a/b.jpg")
        check("əlaqəsiz sütunlar dəyişmədi",
              await tgt.fetchval("select link_url from banners") == "https://ellit.az/kampaniya"
              and "googleusercontent" in await tgt.fetchval("select avatar_url from profiles"))
        check("tamamlanmış sifarişin statusu çevirmə zamanı pozulmadı", await tgt.fetchval(
            "select status from opportunities") == "completed")
        await tgt.close()

        # ── 3. Backend köçmüş faylları verir ──
        os.environ.update({k: env[k] for k in (
            "DATABASE_URL", "REDIS_URL", "JWT_SECRET", "CRON_ENABLED",
            "RATE_LIMIT_AUTH", "STORAGE_DIR")})
        sys.path.insert(0, BACKEND)
        import httpx

        from app.core.security import create_access_token
        from app.main import app

        S = "/api/v1/storage"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                     base_url="http://t") as c:
            r = await c.post("/api/v1/auth/register", json={
                "email": "kenar@test.az", "password": "Kenar#Parol1", "name": "Kənar"})
            other = {"Authorization": f"Bearer {r.json()['access_token']}"}
            import uuid

            owner = {"Authorization": f"Bearer {create_access_token(uuid.UUID(OWNER), 'customer')}"}

            r = await c.get(f"{S}/public/banners/banner-1.gif")
            check("public fayl tokensiz verilir + keşlənir", r.status_code == 200
                  and r.content == FILES[("banners", "banner-1.gif")]
                  and "max-age" in r.headers["cache-control"])
            r = await c.get(f"{S}/public/service-images/services/abc/1746-foto şəkil.jpg")
            check("iç-içə yol + boşluq/unikod adlı fayl", r.status_code == 200)
            kyc = f"kyc-documents/{OWNER}/178_id_front.jpg"
            r = await c.get(f"{S}/public/{kyc}")
            check("private bucket public marşrutdan verilmir", r.status_code == 404)
            r = await c.get(f"{S}/object/{kyc}")
            check("private fayl tokensiz verilmir", r.status_code == 401)
            r = await c.get(f"{S}/object/{kyc}", headers=other)
            check("başqasının KYC sənədi verilmir", r.status_code == 403)
            r = await c.get(f"{S}/object/{kyc}", headers=owner)
            check("sahib öz KYC sənədini alır", r.status_code == 200
                  and r.content == FILES[("kyc-documents", f"{OWNER}/178_id_front.jpg")])
            avatar = f"make-33c80158-profile-photos/{OWNER}/avatar.png"
            check("profil şəkli: giriş etmiş hər kəs görür, anonim yox",
                  (await c.get(f"{S}/object/{avatar}", headers=other)).status_code == 200
                  and (await c.get(f"{S}/object/{avatar}")).status_code == 401)
            for evil in (f"{S}/public/banners/%2e%2e/kyc-documents/{OWNER}/178_id_front.jpg",
                         f"{S}/public/banners/..%2fkyc-documents%2f{OWNER}%2f178_id_front.jpg",
                         f"{S}/object/banners/%2e%2e/%2e%2e/%2e%2e/etc/passwd"):
                r = await c.get(evil, headers=other)
                check("qovluqdan kənara çıxma cəhdi rədd olunur", r.status_code == 404,
                      f"({r.status_code})")
            r = await c.get(f"{S}/public/yoxdur/x.png")
            check("naməlum bucket 404", r.status_code == 404)

            png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
            r = await c.post(f"{S}/service-images", headers=other,
                             files={"file": ("a.png", png, "image/png")})
            check("yükləmə işləyir və URL qaytarır", r.status_code == 201, r.text[:160])
            r2 = await c.get(r.json()["url"])
            check("yüklənən public fayl URL-dən oxunur", r2.status_code == 200 and r2.content == png)
            r = await c.post(f"{S}/banners", headers=other,
                             files={"file": ("b.png", png, "image/png")})
            check("banner yükləmə yalnız admin üçündür", r.status_code == 403)
            r = await c.post(f"{S}/service-images", headers=other,
                             files={"file": ("x.exe", b"MZ", "application/x-msdownload")})
            check("icazəsiz fayl tipi rədd olunur", r.status_code == 415)
            r = await c.post(f"{S}/kyc-documents", headers=other,
                             files={"file": ("id.png", png, "image/png")})
            mine = r.json()["url"]
            check("private yükləmə: sahib oxuyur, başqası yox",
                  (await c.get(mine, headers=other)).status_code == 200
                  and (await c.get(mine, headers=owner)).status_code == 403)
    finally:
        server.shutdown()
        admin = await asyncpg.connect(ADMIN)
        for db in (SRC_DB, TGT_DB):
            await admin.execute(f"drop database if exists {db} with (force)")
        await admin.close()

    print("\nFAYL SAXLAMA TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
