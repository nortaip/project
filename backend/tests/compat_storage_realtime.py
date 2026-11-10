"""Supabase-uyğun Storage (/storage/v1) və Realtime (/realtime/v1) testi.

Storage — httpx ASGITransport ilə: hər əməliyyat, hər bucket-in icazə qaydaları
(başqa istifadəçi cəhdləri daxil), yol keçidi (traversal) cəhdləri, ölçü/tip limitləri.
Realtime — canlı uvicorn serverinə (port 18102) əsl websocket ilə: join, görünən
sətir üçün INSERT/UPDATE/DELETE, RLS-in gizlətdiyi sətir üçün HEÇ NƏ, filtrlər,
token vaxtının bitməsi, heartbeat, limitlər.

İşə salma (təmiz baza, alembic upgrade head-dən sonra):
    DATABASE_URL=postgresql+asyncpg://ellit@127.0.0.1:55432/ellit_storage_rt \\
    REDIS_URL=redis://localhost:56379/15 JWT_SECRET=... CRON_ENABLED=false \\
    python3 tests/compat_storage_realtime.py
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)

STORAGE_DIR = tempfile.mkdtemp(prefix="ellit-storage-test-")
OUTSIDE_DIR = tempfile.mkdtemp(prefix="ellit-outside-")
os.environ["STORAGE_DIR"] = STORAGE_DIR
os.environ.setdefault("RATE_LIMIT_DEFAULT", "100000/minute")
os.environ.setdefault("RATE_LIMIT_AUTH", "100000/minute")
PORT = 18102

import asyncpg  # noqa: E402
import httpx  # noqa: E402
from jose import jwt  # noqa: E402


def check(name: str, cond: bool, extra: str = "") -> None:
    mark = "✓" if cond else "✗ FAIL"
    print(f"  [{mark}] {name} {extra}")
    if not cond:
        raise SystemExit(f"TEST UĞURSUZ: {name}")


# ── Nümunə fayllar (əsl "magic" baytlarla) ────────────────────────
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"J" * 500
PNG = b"\x89PNG\r\n\x1a\n" + b"P" * 500
WEBP = b"RIFF\x00\x01\x00\x00WEBPVP8 " + b"W" * 500
HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"H" * 500
MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"M" * 500
PDF = b"%PDF-1.7\n" + b"D" * 500
GIF = b"GIF89a" + b"G" * 200
EXE = b"MZ\x90\x00" + b"X" * 500


def jwt_secret() -> str:
    from app.core.config import settings
    return settings.JWT_SECRET


def make_token(uid: str, exp_in: float, role: str = "customer") -> str:
    now = int(time.time())
    return jwt.encode({"sub": uid, "role": role, "type": "access", "iat": now,
                       "exp": now + exp_in, "jti": uuid.uuid4().hex[:8]},
                      jwt_secret(), algorithm="HS256")


def pg_dsn() -> str:
    return os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")


# ════════════════════════════════════════════════════════════════
#  STORAGE
# ════════════════════════════════════════════════════════════════
async def storage_tests(c: httpx.AsyncClient, U: dict, db: asyncpg.Connection) -> None:
    A, B, C, ADM = U["a"], U["b"], U["c"], U["admin"]
    H = {k: {"Authorization": f"Bearer {v['token']}", "apikey": "anon"} for k, v in U.items() if isinstance(v, dict)}
    anon = {"apikey": "anon", "Authorization": "Bearer anon-key"}

    def mp(data: bytes, ctype: str, name: str = "blob") -> dict:
        # storage-js: FormData('cacheControl', ...) + ('', Blob)
        return {"files": {"": (name, data, ctype)}, "data": {"cacheControl": "3600"}}

    async def up(who, bucket, path, data, ctype="image/png", upsert=None, raw=False, method="POST"):
        h = dict(H[who]) if who else dict(anon)
        if upsert is not None:
            h["x-upsert"] = "true" if upsert else "false"
        url = f"/storage/v1/object/{bucket}/{path}"
        if raw:
            h["content-type"] = ctype
            h["cache-control"] = "max-age=3600"
            return await c.request(method, url, headers=h, content=data)
        return await c.request(method, url, headers=h, **mp(data, ctype))

    async def pub(bucket, path):
        return await c.get(f"/storage/v1/object/public/{bucket}/{path}")

    async def dl(who, bucket, path, kind=""):
        h = H[who] if who else anon
        return await c.get(f"/storage/v1/object/{kind}{bucket}/{path}", headers=h)

    async def rm(who, bucket, paths):
        h = H[who] if who else anon
        return await c.request("DELETE", f"/storage/v1/object/{bucket}", headers=h,
                               json={"prefixes": paths})

    async def sign(who, bucket, path, expires=3600):
        return await c.post(f"/storage/v1/object/sign/{bucket}/{path}", headers=H[who],
                            json={"expiresIn": expires})

    def on_disk(bucket, path) -> Path:
        return Path(STORAGE_DIR) / bucket / path

    print("\n── Storage: service-images (public) ──")
    p = f"services/{B['id']}/1746-foto.png"
    r = await up("b", "service-images", p, PNG, upsert=False)
    check("upload (multipart, x-upsert:false) → 200 {Id, Key}",
          r.status_code == 200 and r.json().get("Key") == f"service-images/{p}" and r.json().get("Id"),
          str(r.json()))
    check("fayl STORAGE_DIR/{bucket}/{yol} altındadır", on_disk("service-images", p).read_bytes() == PNG)
    r = await pub("service-images", p)
    check("public URL oxunur (tokensiz)", r.status_code == 200 and r.content == PNG
          and r.headers["content-type"] == "image/png")
    r = await up("b", "service-images", p, PNG, upsert=False)
    check("dublikat (upsert yox) → 409 Duplicate",
          r.status_code == 409 and r.json() == {"statusCode": "409", "error": "Duplicate",
                                                "message": "The resource already exists"})
    r = await up("b", "service-images", p, PNG + b"2", upsert=True)
    check("sahib upsert edir → 200", r.status_code == 200 and on_disk("service-images", p).read_bytes() == PNG + b"2")
    r = await up("a", "service-images", p, PNG, upsert=True)
    check("başqası upsert ilə ÜZƏRİNƏ YAZA BİLMİR → 403",
          r.status_code == 403 and on_disk("service-images", p).read_bytes() == PNG + b"2", str(r.json()))
    r = await up("a", "service-images", f"services/{B['id']}/other.png", PNG)
    check("başqasının qovluğuna upload → 403 (RLS xətası forması)",
          r.status_code == 403 and r.json()["statusCode"] == "403" and "row-level security" in r.json()["message"])
    r = await up("a", "service-images", f"{uuid.uuid4()}.png", PNG)
    check("kök qovluğa upload → 403 (canlı siyasət services/<uid>/ tələb edir)", r.status_code == 403)
    r = await up(None, "service-images", f"services/{A['id']}/x.png", PNG)
    check("anonim upload → 403", r.status_code == 403)
    r = await up("a", "service-images", f"services/{A['id']}/raw.png", PNG, raw=True)
    check("xam gövdə (ArrayBuffer) upload → 200", r.status_code == 200, r.text)
    r = await up("a", "service-images", "private/a-file.png", PNG)
    check("'private/' qovluğu (canlı siyasət) → 200", r.status_code == 200)
    r = await up("b", "service-images", "private/a-file.png", PNG, upsert=True)
    check("'private/' faylının üzərinə başqası yaza bilmir → 403", r.status_code == 403)

    print("\n── Storage: ölçü və tip limitləri ──")
    big = PNG + b"\x00" * (5 * 1024 * 1024)
    r = await up("a", "service-images", f"services/{A['id']}/big.png", big)
    check("5 MB-dan böyük → 413", r.status_code == 413 and r.json()["statusCode"] == "413")
    check("böyük fayl diskə yazılmayıb", not on_disk("service-images", f"services/{A['id']}/big.png").exists())
    r = await up("a", "service-images", f"services/{A['id']}/big2.png", big, raw=True)
    check("5 MB-dan böyük (xam gövdə) → 413", r.status_code == 413)
    r = await up("a", "service-images", f"services/{A['id']}/fake.png", PDF, ctype="image/png")
    check("PDF məzmunu image/png kimi elan edilib → 415 (məzmun yoxlanır)",
          r.status_code == 415 and r.json()["error"] == "invalid_mime_type", str(r.json()))
    r = await up("a", "service-images", f"services/{A['id']}/fake.png", EXE, ctype="image/png", raw=True)
    check("EXE məzmunu image/png kimi (xam) → 415", r.status_code == 415)
    r = await up("a", "service-images", f"services/{A['id']}/img.pdf", PNG, ctype="image/png")
    check("PNG məzmunu, .pdf uzantısı (uzantı ziddiyyəti) → 415", r.status_code == 415)
    r = await up("a", "service-images", f"services/{A['id']}/x.html", PNG, ctype="text/html")
    check(".html uzantısı → 415", r.status_code == 415)
    r = await up("a", "service-images", f"services/{A['id']}/a.gif", GIF, ctype="image/gif")
    check("GIF service-images-də icazəli deyil (canlı siyahı) → 415", r.status_code == 415)
    r = await c.post(f"/storage/v1/object/service-images/services/{A['id']}/cl.png",
                     headers={**H["a"], "content-type": "image/png", "content-length": str(50 * 1024 * 1024)},
                     content=PNG)
    check("Content-Length başlığı limitdən böyük → 413", r.status_code in (413, 400))

    print("\n── Storage: yol təhlükəsizliyi ──")
    outside = Path(OUTSIDE_DIR)
    (outside / "secret.txt").write_bytes(b"SECRET")
    r = await c.get("/storage/v1/object/public/service-images/..%2F..%2F..%2Fetc%2Fpasswd")
    check("public GET ..%2F traversal rədd", r.status_code in (400, 404) and b"root:" not in r.content)
    r = await c.get("/storage/v1/object/public/service-images/%2e%2e/%2e%2e/etc/passwd")
    check("public GET %2e%2e traversal rədd", r.status_code in (400, 404) and b"root:" not in r.content)
    r = await up("a", "service-images", f"services/{A['id']}/..%2F..%2F..%2Fescape.png", PNG)
    check("upload ..%2F traversal rədd", r.status_code in (400, 403, 404))
    check("bucket qovluğundan kənarda fayl yaranmayıb",
          not (Path(STORAGE_DIR) / "escape.png").exists() and not (Path(STORAGE_DIR).parent / "escape.png").exists())
    r = await up("a", "service-images", f"services/{A['id']}/a%5C..%5Cb.png", PNG)
    check("backslash olan ad rədd → 400", r.status_code == 400)
    os.symlink(OUTSIDE_DIR, Path(STORAGE_DIR) / "service-images" / "lnk")
    r = await pub("service-images", "lnk/secret.txt")
    check("symlink ilə bucket-dən kənar oxuma rədd", r.status_code in (400, 404) and r.content != b"SECRET")
    udir = Path(STORAGE_DIR) / "service-images" / "services" / A["id"]
    os.symlink(OUTSIDE_DIR, udir / "out")
    r = await up("a", "service-images", f"services/{A['id']}/out/planted.png", PNG)
    check("symlink ilə bucket-dən kənara yazma rədd",
          r.status_code in (400, 403) and not (outside / "planted.png").exists(), str(r.status_code))
    r = await c.post("/storage/v1/object/no-such-bucket/x.png", headers=H["a"], **mp(PNG, "image/png"))
    check("naməlum bucket → 404 Bucket not found",
          r.status_code == 404 and r.json()["error"] == "Bucket not found")
    r = await pub("../../etc", "passwd")
    check("bucket adında traversal → 404", r.status_code == 404)
    r = await pub("service-images", f"services/{B['id']}/nope.png")
    check("olmayan obyekt → 404 {statusCode, error, message}",
          r.status_code == 404 and set(r.json()) == {"statusCode", "error", "message"})

    print("\n── Storage: remove ──")
    r = await rm("a", "service-images", [p])
    check("başqasının faylını remove → [] və fayl yerində",
          r.status_code == 200 and r.json() == [] and on_disk("service-images", p).exists())
    r = await rm(None, "service-images", [p])
    check("anonim remove → []", r.status_code == 200 and r.json() == [])
    r = await rm("b", "service-images", [p, "../../x", f"services/{B['id']}/nope.png"])
    check("sahib remove → yalnız mövcud fayl qaytarılır",
          r.status_code == 200 and [o["name"] for o in r.json()] == [p] and not on_disk("service-images", p).exists(),
          str(r.json()))
    check("silinmiş fayl public URL-də 404", (await pub("service-images", p)).status_code == 404)
    r = await c.request("DELETE", "/storage/v1/object/service-images", headers=H["b"], json={"prefixes": "x"})
    check("yanlış remove gövdəsi → 400", r.status_code == 400)

    print("\n── Storage: banners (yalnız admin yazır) ──")
    r = await up("a", "banners", "banner-1.png", PNG, upsert=True)
    check("adi istifadəçi banner yükləyə bilmir → 403", r.status_code == 403)
    r = await up("admin", "banners", "banner-1.png", PNG, upsert=True)
    check("admin banner (upsert:true) → 200", r.status_code == 200, r.text)
    r = await up("admin", "banners", "banner-1.png", GIF, ctype="image/gif", upsert=True)
    check("admin upsert (.png adı, GIF məzmunu) — hər ikisi icazəlidir → 200", r.status_code == 200)
    check("banner public oxunur", (await pub("banners", "banner-1.png")).status_code == 200)
    r = await rm("a", "banners", ["banner-1.png"])
    check("adi istifadəçi banner silə bilmir", r.json() == [] and on_disk("banners", "banner-1.png").exists())

    print("\n── Storage: kyc-documents (gizli; oxuma yalnız admin) ──")
    kp = f"{A['id']}/1700000000_id_front.jpg"
    r = await up("a", "kyc-documents", kp, JPEG, ctype="image/jpeg", upsert=False)
    check("öz qovluğuna KYC upload → 200", r.status_code == 200)
    r = await up("a", "kyc-documents", f"{A['id']}/1700000001_selfie.heic", HEIC, ctype="image/heic")
    check("HEIC KYC upload → 200", r.status_code == 200, r.text)
    r = await up("b", "kyc-documents", f"{A['id']}/evil.jpg", JPEG, ctype="image/jpeg")
    check("başqasının KYC qovluğuna upload → 403", r.status_code == 403)
    r = await up("a", "kyc-documents", kp, JPEG, ctype="image/jpeg", upsert=True)
    check("KYC faylının üzərinə yazmaq (UPDATE siyasəti yoxdur) → 403", r.status_code == 403)
    r = await up("a", "kyc-documents", f"{A['id']}/doc.pdf", PDF, ctype="application/pdf")
    check("KYC-də PDF icazəli deyil → 415", r.status_code == 415)
    r = await up("a", "kyc-documents", f"{A['id']}/huge.jpg", JPEG + b"\x00" * (10 * 1024 * 1024), ctype="image/jpeg")
    check("KYC 10 MB limiti → 413", r.status_code == 413)
    check("gizli bucket public URL-dən görünmür", (await pub("kyc-documents", kp)).status_code in (400, 404))
    r = await dl("a", "kyc-documents", kp)
    check("sahib öz KYC sənədini endirə bilmir (canlı: yalnız admin) → 404", r.status_code == 404)
    r = await dl("admin", "kyc-documents", kp)
    check("admin KYC endirir (/object/{bucket}/...)", r.status_code == 200 and r.content == JPEG)
    r = await dl("admin", "kyc-documents", kp, kind="authenticated/")
    check("admin KYC endirir (/object/authenticated/...)", r.status_code == 200 and r.content == JPEG)
    r = await sign("a", "kyc-documents", kp)
    check("sahib createSignedUrl → 404 (oxuma icazəsi yoxdur)", r.status_code == 404)
    r = await sign("admin", "kyc-documents", kp, 3600)
    signed = r.json().get("signedURL", "")
    check("admin createSignedUrl → {signedURL: /object/sign/...?token=}",
          r.status_code == 200 and signed.startswith(f"/object/sign/kyc-documents/{kp}?token="), signed.split('?')[0])
    r = await c.get("/storage/v1" + signed)
    check("imzalı URL tokensiz/başlıqsız oxunur", r.status_code == 200 and r.content == JPEG)
    tok = signed.split("token=", 1)[1]
    r = await c.get(f"/storage/v1/object/sign/kyc-documents/{A['id']}/1700000001_selfie.heic?token={tok}")
    check("imzalı token başqa fayl üçün işləmir → 400", r.status_code == 400)
    r = await c.get(f"/storage/v1/object/sign/kyc-documents/{kp}?token={tok[:-3]}abc")
    check("dəyişdirilmiş token → 400", r.status_code == 400)
    expired = jwt.encode({"url": f"kyc-documents/{kp}", "type": "storage-sign",
                          "exp": int(time.time()) - 5}, jwt_secret(), algorithm="HS256")
    r = await c.get(f"/storage/v1/object/sign/kyc-documents/{kp}?token={expired}")
    check("vaxtı bitmiş imzalı URL → 400", r.status_code == 400)
    r = await c.get(f"/storage/v1/object/sign/kyc-documents/{kp}?token={U['admin']['token']}")
    check("access token imzalı URL tokeni kimi qəbul olunmur → 400", r.status_code == 400)
    r = await sign("admin", "kyc-documents", f"{A['id']}/nope.jpg")
    check("olmayan fayl üçün createSignedUrl → 404", r.status_code == 404)
    r = await rm("b", "kyc-documents", [kp])
    check("başqası KYC silə bilmir", r.json() == [] and on_disk("kyc-documents", kp).exists())
    r = await rm("a", "kyc-documents", [kp])
    check("sahib öz KYC sənədini silir", len(r.json()) == 1 and not on_disk("kyc-documents", kp).exists())

    print("\n── Storage: dispute-evidence (mübahisə tərəfləri) ──")
    d_id = U["dispute_id"]
    ep = f"{d_id}/{A['id']}/1700_qebz.pdf"
    r = await up("a", "dispute-evidence", ep, PDF, ctype="application/pdf")
    check("mübahisəni açan sübut yükləyir (PDF) → 200", r.status_code == 200, r.text)
    r = await up("b", "dispute-evidence", f"{d_id}/{B['id']}/1701_video.mp4", MP4, ctype="video/mp4")
    check("qarşı tərəf sübut yükləyir (MP4) → 200", r.status_code == 200, r.text)
    r = await up("c", "dispute-evidence", f"{d_id}/{C['id']}/x.jpg", JPEG, ctype="image/jpeg")
    check("kənar istifadəçi sübut yükləyə bilmir → 403", r.status_code == 403)
    r = await up("a", "dispute-evidence", f"{d_id}/{B['id']}/spoof.jpg", JPEG, ctype="image/jpeg")
    check("başqasının adına (2-ci qovluq) yükləmək olmaz → 403", r.status_code == 403)
    r = await up("a", "dispute-evidence", f"{uuid.uuid4()}/{A['id']}/x.jpg", JPEG, ctype="image/jpeg")
    check("olmayan mübahisəyə yükləmək olmaz → 403", r.status_code == 403)
    r = await up("a", "dispute-evidence", f"{d_id}/{A['id']}/x.exe", EXE, ctype="application/pdf")
    check("icazəsiz tip → 415", r.status_code == 415)
    r = await dl("b", "dispute-evidence", ep)
    check("qarşı tərəf sübutu endirir", r.status_code == 200 and r.content == PDF)
    r = await dl("c", "dispute-evidence", ep)
    check("kənar istifadəçi endirə bilmir → 404", r.status_code == 404)
    r = await sign("c", "dispute-evidence", ep)
    check("kənar istifadəçi createSignedUrl ala bilmir → 404", r.status_code == 404)
    r = await sign("b", "dispute-evidence", ep)
    check("tərəf createSignedUrl alır", r.status_code == 200)
    r = await dl("admin", "dispute-evidence", ep)
    check("admin endirir", r.status_code == 200)
    r = await rm("b", "dispute-evidence", [ep])
    check("qarşı tərəf açanın sübutunu silə bilmir", r.json() == [] and on_disk("dispute-evidence", ep).exists())
    await db.execute("update disputes set status = 'resolved_customer' where id = $1", uuid.UUID(d_id))
    r = await up("a", "dispute-evidence", f"{d_id}/{A['id']}/late.pdf", PDF, ctype="application/pdf")
    check("bağlanmış mübahisəyə yükləmək olmaz → 403", r.status_code == 403)
    r = await rm("a", "dispute-evidence", [ep])
    check("bağlanmış mübahisədə silmək olmaz", r.json() == [] and on_disk("dispute-evidence", ep).exists())
    await db.execute("update disputes set status = 'open' where id = $1", uuid.UUID(d_id))
    r = await rm("a", "dispute-evidence", [ep])
    check("açıq mübahisədə sahib öz sübutunu silir", len(r.json()) == 1)

    print("\n── Storage: completion-evidence (təklifin ustası) ──")
    o_id = U["offer_id"]
    r = await up("b", "completion-evidence", f"{o_id}/1700_0.jpg", JPEG, ctype="image/jpeg")
    check("usta iş şəklini yükləyir → 200", r.status_code == 200, r.text)
    r = await up("b", "completion-evidence", f"{o_id}/signature.png", PNG, ctype="application/octet-stream")
    check("uploadBinary imza (content-type octet-stream, məzmun PNG) → 200", r.status_code == 200, r.text)
    check("public URL oxunur", (await pub("completion-evidence", f"{o_id}/signature.png")).status_code == 200)
    def dart_multipart(data: bytes, filename: str, ctype: str) -> tuple[bytes, str]:
        # Dart `http.MultipartRequest` (storage_client 2.4.0): əvvəl sahələr, sonra
        # fayl sahəsi name="" — uploadBinary filename="" göndərir, upload isə yerli yolu
        bnd = "dart-http-boundary-" + uuid.uuid4().hex[:20]
        body = (f"--{bnd}\r\ncontent-disposition: form-data; name=\"cacheControl\"\r\n\r\n3600\r\n"
                f"--{bnd}\r\ncontent-type: {ctype}\r\n"
                f"content-disposition: form-data; name=\"\"; filename=\"{filename}\"\r\n\r\n").encode()
        return body + data + f"\r\n--{bnd}--\r\n".encode(), f"multipart/form-data; boundary={bnd}"
    for fname, target in (("", f"{o_id}/signature-dart.png"),
                          ("/data/user/0/az.ellit/cache/scaled_1.jpg", f"{o_id}/1700_1.jpg")):
        body, ct = dart_multipart(JPEG if target.endswith(".jpg") else PNG, fname,
                                  "image/jpeg" if target.endswith(".jpg") else "image/png")
        r = await c.post(f"/storage/v1/object/completion-evidence/{target}",
                         headers={**H["b"], "content-type": ct, "x-upsert": "false"}, content=body)
        check(f"Dart storage_client multipart forması (filename={fname!r}) → 200 {{Key}}",
              r.status_code == 200 and r.json()["Key"] == f"completion-evidence/{target}", r.text[:120])

    r = await up("c", "completion-evidence", f"{o_id}/fake.jpg", JPEG, ctype="image/jpeg")
    check("kənar istifadəçi başqasının təklifinə yükləyə bilmir → 403", r.status_code == 403)
    r = await up("c", "completion-evidence", f"{uuid.uuid4()}/fake.jpg", JPEG, ctype="image/jpeg")
    check("olmayan təklifə yükləmək olmaz → 403", r.status_code == 403)
    r = await up("b", "completion-evidence", f"{o_id}/signature.png", PNG, upsert=True)
    check("imzanın üzərinə yazmaq (yalnız admin) → 403", r.status_code == 403)

    print("\n── Storage: opportunity-photos (öz qovluğu; update/PUT) ──")
    op = f"{A['id']}/foto.webp"
    r = await up("a", "opportunity-photos", op, WEBP, ctype="image/webp")
    check("öz qovluğuna WEBP → 200", r.status_code == 200, r.text)
    r = await up("b", "opportunity-photos", f"{A['id']}/x.webp", WEBP, ctype="image/webp")
    check("başqasının qovluğuna → 403", r.status_code == 403)
    r = await up("a", "opportunity-photos", op, WEBP + b"2", ctype="image/webp", method="PUT")
    check("update (PUT) öz faylı → 200", r.status_code == 200 and on_disk("opportunity-photos", op).read_bytes() == WEBP + b"2")
    r = await up("b", "opportunity-photos", op, WEBP, ctype="image/webp", method="PUT")
    check("update (PUT) başqasının faylı → 403", r.status_code == 403)
    r = await up("a", "opportunity-photos", f"{A['id']}/none.webp", WEBP, ctype="image/webp", method="PUT")
    check("update (PUT) olmayan fayl → 404", r.status_code == 404)

    print("\n── Storage: profile-photos (gizli; giriş etmiş oxuyur) ──")
    pp = f"{A['id']}/avatar.png"
    r = await up("a", "make-33c80158-profile-photos", pp, PNG)
    check("öz avatarı → 200", r.status_code == 200)
    r = await up("b", "make-33c80158-profile-photos", f"{A['id']}/x.png", PNG)
    check("başqasının qovluğuna → 403", r.status_code == 403)
    check("public URL ilə görünmür", (await pub("make-33c80158-profile-photos", pp)).status_code in (400, 404))
    r = await dl("b", "make-33c80158-profile-photos", pp)
    check("giriş etmiş başqa istifadəçi oxuyur", r.status_code == 200 and r.content == PNG)
    r = await dl(None, "make-33c80158-profile-photos", pp)
    check("anonim oxuya bilmir → 404", r.status_code == 404)

    print("\n── Storage: token ──")
    r = await c.post(f"/storage/v1/object/opportunity-photos/{A['id']}/t.png",
                     headers={"Authorization": f"Bearer {make_token(A['id'], -10)}"}, **mp(PNG, "image/png"))
    check("vaxtı bitmiş token → 401 jwt expired", r.status_code == 401 and r.json()["message"] == "jwt expired")
    await db.execute("update users set is_active = false where id = $1", uuid.UUID(C["id"]))
    r = await up("c", "opportunity-photos", f"{C['id']}/x.png", PNG)
    check("deaktiv hesabın tokeni → anonim (403)", r.status_code == 403)
    await db.execute("update users set is_active = true where id = $1", uuid.UUID(C["id"]))

    print("\n── Storage: köhnə native /api/v1/storage eyni fayla çatır ──")
    r = await c.get(f"/api/v1/storage/public/opportunity-photos/{op}")
    check("native public marşrut eyni faylı verir", r.status_code == 200 and r.content == WEBP + b"2")


# ════════════════════════════════════════════════════════════════
#  REALTIME
# ════════════════════════════════════════════════════════════════
class RT:
    """Minimal Phoenix klienti (realtime-js-in göndərdiyi formada)."""

    def __init__(self, ws) -> None:
        self.ws, self.inbox, self.ref = ws, [], 0
        self.closed: int | None = None
        self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        try:
            async for raw in self.ws:
                self.inbox.append(json.loads(raw))
        except Exception:  # noqa: BLE001
            pass
        self.closed = self.ws.close_code if self.ws.close_code is not None else -1

    async def push(self, topic, event, payload, join_ref=None) -> str:
        self.ref += 1
        ref = str(self.ref)
        await self.ws.send(json.dumps({"topic": topic, "event": event, "payload": payload,
                                       "ref": ref, "join_ref": join_ref}))
        return ref

    async def wait(self, pred, timeout=5.0):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            for i, m in enumerate(self.inbox):
                if pred(m):
                    return self.inbox.pop(i)
            await asyncio.sleep(0.02)
        return None

    async def reply(self, ref, timeout=5.0):
        return await self.wait(lambda m: m["event"] == "phx_reply" and m["ref"] == ref, timeout)

    async def join(self, topic, changes, token=None):
        payload = {"config": {"broadcast": {"ack": False, "self": False}, "presence": {"key": ""},
                              "postgres_changes": changes, "private": False}}
        if token:
            payload["access_token"] = token
        ref = await self.push(f"realtime:{topic}", "phx_join", payload)
        return await self.reply(ref)

    def changes(self, topic):
        return lambda m: m["event"] == "postgres_changes" and m["topic"] == f"realtime:{topic}"


async def connect(token=None) -> RT:
    from websockets.asyncio.client import connect as ws_connect
    ws = await ws_connect(f"ws://127.0.0.1:{PORT}/realtime/v1/websocket?apikey=anon-key&vsn=1.0.0",
                          max_size=4 * 1024 * 1024)
    return RT(ws)


async def realtime_tests(U: dict, db: asyncpg.Connection) -> None:
    A, B, ADM = U["a"], U["b"], U["admin"]

    async def notify(uid, title="Salam", typ="info") -> uuid.UUID:
        return await db.fetchval("insert into notifications (user_id, title, type) values ($1, $2, $3)"
                                 " returning id", uuid.UUID(uid), title, typ)

    print("\n── Realtime: qoşulma və join ──")
    a = await connect()
    ref = await a.push("phoenix", "heartbeat", {})
    r = await a.reply(ref)
    check("heartbeat → phx_reply ok", r is not None and r["payload"]["status"] == "ok")

    flt = f"user_id=eq.{A['id']}"
    r = await a.join("notif-a", [{"event": "*", "schema": "public", "table": "notifications", "filter": flt}],
                     A["token"])
    pc = (r or {}).get("payload", {}).get("response", {}).get("postgres_changes") or []
    check("join → ok, postgres_changes binding-ləri id ilə qayıdır",
          r is not None and r["payload"]["status"] == "ok" and len(pc) == 1
          and pc[0]["filter"] == flt and pc[0]["table"] == "notifications" and isinstance(pc[0]["id"], int), str(r))
    bid_a = pc[0]["id"]
    sysmsg = await a.wait(lambda m: m["event"] == "system" and m["topic"] == "realtime:notif-a")
    check("system 'Subscribed to PostgreSQL' mesajı", sysmsg is not None and sysmsg["payload"]["status"] == "ok")
    r = await a.join("all-notif-a", [{"event": "*", "schema": "public", "table": "notifications"}], A["token"])
    check("filtrsiz ikinci kanal", r["payload"]["status"] == "ok")

    # dinləyici hazır olana qədər gözlə (server təzə açılıb)
    got = None
    for _ in range(50):
        await notify(A["id"], "isinma")
        got = await a.wait(a.changes("notif-a"), 0.3)
        if got:
            break
    check("LISTEN dinləyicisi işləyir (isinma hadisəsi gəldi)", got is not None)
    await asyncio.sleep(0.5)
    a.inbox.clear()

    print("\n── Realtime: INSERT / UPDATE / DELETE görünən sətir üçün ──")
    nid = await notify(A["id"], "Yeni sifariş")
    m = await a.wait(a.changes("notif-a"))
    d = (m or {}).get("payload", {}).get("data", {})
    check("INSERT çatdı (ids, data.type, schema, table, commit_timestamp)",
          m is not None and m["payload"]["ids"] == [bid_a] and d.get("type") == "INSERT"
          and d.get("schema") == "public" and d.get("table") == "notifications"
          and d.get("commit_timestamp", "").endswith("Z") and d.get("errors") is None, str(m)[:300])
    check("record tam sətirdir", d["record"]["id"] == str(nid) and d["record"]["title"] == "Yeni sifariş"
          and d["record"]["user_id"] == A["id"] and d["record"]["is_read"] is False)
    check("columns [{name, type}]", {"name": "is_read", "type": "bool"} in d["columns"])
    m2 = await a.wait(a.changes("all-notif-a"))
    check("filtrsiz kanal da (RLS icazə verir) alır", m2 is not None and m2["payload"]["data"]["record"]["id"] == str(nid))

    await db.execute("update notifications set is_read = true where id = $1", nid)
    m = await a.wait(a.changes("notif-a"))
    d = (m or {}).get("payload", {}).get("data", {})
    check("UPDATE çatdı (record yeni, old_record yalnız açar)",
          d.get("type") == "UPDATE" and d["record"]["is_read"] is True and d["old_record"] == {"id": str(nid)},
          str(d)[:300])
    await a.wait(a.changes("all-notif-a"))

    r = await a.join("notif-by-id", [{"event": "DELETE", "schema": "public", "table": "notifications",
                                     "filter": f"id=eq.{nid}"}], A["token"])
    check("id=eq.<pk> filtri ilə DELETE kanalı", r["payload"]["status"] == "ok")
    adm = await connect()
    r = await adm.join("adm-notif", [{"event": "DELETE", "schema": "public", "table": "notifications"}], ADM["token"])
    check("admin filtrsiz DELETE kanalı", r["payload"]["status"] == "ok")
    a.inbox.clear()
    await db.execute("delete from notifications where id = $1", nid)
    m = await a.wait(a.changes("notif-by-id"))
    d = (m or {}).get("payload", {}).get("data", {})
    check("DELETE (açar filtri) çatdı, old_record YALNIZ əsas açardır",
          d.get("type") == "DELETE" and d.get("old_record") == {"id": str(nid)} and "record" not in d, str(d))
    m = await adm.wait(adm.changes("adm-notif"))
    check("DELETE admin-ə çatdı (yalnız açar)", m is not None and m["payload"]["data"]["old_record"] == {"id": str(nid)})
    m = await a.wait(lambda x: x["event"] == "postgres_changes" and x["topic"] in
                     ("realtime:notif-a", "realtime:all-notif-a"), 1.0)
    check("DELETE açar olmayan filtrli/filtrsiz kanala GETMİR (görünürlük yoxlanıla bilmir)", m is None, str(m))

    print("\n── Realtime: RLS gizlədirsə — heç nə ──")
    b = await connect()
    r = await b.join("all-notif-b", [{"event": "*", "schema": "public", "table": "notifications"}], B["token"])
    an = await connect()
    r2 = await an.join("anon-notif", [{"event": "*", "schema": "public", "table": "notifications"}])
    check("B və anonim filtrsiz qoşuldu", r["payload"]["status"] == "ok" and r2["payload"]["status"] == "ok")
    a.inbox.clear()
    nb = await notify(B["id"], "B-nin gizli bildirişi")
    m = await b.wait(b.changes("all-notif-b"))
    check("B öz bildirişini alır", m is not None and m["payload"]["data"]["record"]["id"] == str(nb))
    m = await a.wait(lambda x: x["event"] == "postgres_changes", 1.5)
    check("A B-nin bildirişini ALMIR (filtrsiz kanal da)", m is None, str(m)[:200])
    m = await an.wait(lambda x: x["event"] == "postgres_changes", 0.5)
    check("anonim heç nə almır", m is None)
    r = await a.join("spy", [{"event": "*", "schema": "public", "table": "notifications",
                              "filter": f"user_id=eq.{B['id']}"}], A["token"])
    await notify(B["id"], "yenə gizli")
    m = await a.wait(a.changes("spy"), 1.5)
    check("A B-nin user_id filtri ilə də heç nə almır", r["payload"]["status"] == "ok" and m is None)
    await db.execute("delete from notifications where id = $1", nb)
    m = await a.wait(a.changes("spy"), 1.0)
    check("A B-nin sətrinin DELETE-ini də almır", m is None)

    print("\n── Realtime: filtrlər ──")
    r = await a.join("in-filter", [{"event": "INSERT", "schema": "public", "table": "notifications",
                                    "filter": 'type=in.("alert",urgent)'}], A["token"])
    check("in.(...) filtri qəbul olundu", r["payload"]["status"] == "ok")
    await notify(A["id"], "adi", "info")
    m = await a.wait(a.changes("in-filter"), 1.0)
    check("in.() — uyğun gəlməyən tip gəlmir", m is None)
    await notify(A["id"], "vacib", "urgent")
    m = await a.wait(a.changes("in-filter"))
    check("in.() — uyğun tip gəlir", m is not None and m["payload"]["data"]["record"]["type"] == "urgent")
    r = await a.join("upd-only", [{"event": "UPDATE", "schema": "public", "table": "notifications",
                                   "filter": flt}], A["token"])
    await notify(A["id"], "insert gəlməməli")
    m = await a.wait(a.changes("upd-only"), 1.0)
    check("event: UPDATE kanalı INSERT almır", m is None)
    r = await a.join("bad", [{"event": "*", "schema": "public", "table": "notifications; drop table users"},
                             {"event": "*", "schema": "public", "table": "users"},
                             {"event": "*", "schema": "public", "table": "notifications",
                              "filter": "nope_col=eq.1"},
                             {"event": "*", "schema": "auth", "table": "notifications"}], A["token"])
    s = await a.wait(lambda x: x["event"] == "system" and x["topic"] == "realtime:bad")
    check("yanlış cədvəl/sütun/sxem → system error (SQL-ə düşmür)",
          r["payload"]["status"] == "ok" and s is not None and s["payload"]["status"] == "error", str(s)[:200])
    still = await db.fetchval("select count(*) from users")
    check("users cədvəli yerindədir", still >= 4)
    a.inbox.clear()

    print("\n── Realtime: digər cədvəllər (opportunities_offers RLS) ──")
    r = await b.join("offers-b", [{"event": "*", "schema": "public", "table": "opportunities_offers",
                                   "filter": f"provider_id=eq.{B['id']}"}], B["token"])
    c_ = await connect()
    await c_.join("offers-c", [{"event": "*", "schema": "public", "table": "opportunities_offers"}],
                  U["c"]["token"])
    await db.execute("update opportunities_offers set notes = 'yenilənib' where id = $1", uuid.UUID(U["offer_id"]))
    m = await b.wait(b.changes("offers-b"))
    check("usta öz təklifinin UPDATE-ini alır", m is not None and m["payload"]["data"]["record"]["notes"] == "yenilənib")
    m = await c_.wait(c_.changes("offers-c"), 1.5)
    check("kənar istifadəçi başqasının təklifini ALMIR", m is None)

    print("\n── Realtime: token vaxtının bitməsi ──")
    e = await connect()
    short = make_token(A["id"], 3)
    r = await e.join("exp", [{"event": "*", "schema": "public", "table": "notifications", "filter": flt}], short)
    check("qısa ömürlü tokenlə join ok", r["payload"]["status"] == "ok")
    await notify(A["id"], "token hələ etibarlı")
    check("token etibarlı ikən çatdırılır", await e.wait(e.changes("exp")) is not None)
    await asyncio.sleep(3.5)
    await notify(A["id"], "token bitib")
    m = await e.wait(e.changes("exp"), 1.5)
    check("token bitəndən sonra HEÇ NƏ çatdırılmır", m is None)
    s = await e.wait(lambda x: x["event"] == "system" and "expired" in x["payload"].get("message", ""), 1.0)
    check("system 'Token has expired' mesajı", s is not None)
    ref = await e.push("realtime:exp", "access_token", {"access_token": make_token(A["id"], 600)})
    await asyncio.sleep(0.2)
    await notify(A["id"], "token yeniləndi")
    m = await e.wait(e.changes("exp"))
    check("access_token ilə yeniləndikdən sonra yenidən çatdırılır",
          m is not None and m["payload"]["data"]["record"]["title"] == "token yeniləndi")
    ref = await e.push("realtime:exp", "access_token", {"access_token": make_token(A["id"], -5)})
    await asyncio.sleep(0.2)
    await notify(A["id"], "vaxtı keçmiş token göndərildi")
    check("vaxtı keçmiş access_token göndərilsə çatdırılma dayanır", await e.wait(e.changes("exp"), 1.0) is None)
    r = await e.join("exp2", [{"event": "*", "schema": "public", "table": "notifications", "filter": flt}],
                     make_token(A["id"], -5))
    await notify(A["id"], "join-da vaxtı keçmiş token")
    check("vaxtı keçmiş tokenlə join → çatdırılma yoxdur", await e.wait(e.changes("exp2"), 1.0) is None)
    ref = await e.push("realtime:exp", "access_token", {"access_token": B["token"]})
    await asyncio.sleep(0.2)
    await notify(A["id"], "kimlik B-yə dəyişdi")
    check("token başqa istifadəçiyə dəyişəndə A-nın sətri gəlmir", await e.wait(e.changes("exp"), 1.0) is None)

    print("\n── Realtime: leave, dəstəklənməyən hadisələr, limitlər ──")
    ref = await a.push("realtime:notif-a", "phx_leave", {})
    r = await a.reply(ref)
    close = await a.wait(lambda x: x["event"] == "phx_close" and x["topic"] == "realtime:notif-a")
    check("phx_leave → reply ok + phx_close", r is not None and r["payload"]["status"] == "ok" and close is not None)
    a.inbox.clear()
    await notify(A["id"], "ayrıldıqdan sonra")
    check("ayrılmış kanala heç nə gəlmir", await a.wait(a.changes("notif-a"), 1.0) is None)
    ref = await a.push("realtime:all-notif-a", "broadcast", {"type": "broadcast", "event": "x", "payload": {}})
    r = await a.reply(ref)
    check("broadcast dəstəklənmir → error reply", r is not None and r["payload"]["status"] == "error")
    ref = await a.push("phoenix", "heartbeat", {})
    check("heartbeat hələ də işləyir", (await a.reply(ref)) is not None)
    many = await connect()
    statuses = []
    for i in range(101):
        rr = await many.join(f"ch{i}", [], None)
        statuses.append(rr["payload"]["status"] if rr else None)
    check("kanal limiti (100/soket)", statuses[:100] == ["ok"] * 100 and statuses[100] == "error")
    big = await connect()
    await big.ws.send(json.dumps({"topic": "phoenix", "event": "heartbeat", "payload": {"x": "y" * 70_000},
                                  "ref": "1"}))
    for _ in range(100):
        if big.closed is not None:
            break
        await asyncio.sleep(0.05)
    check("64 KB-dan böyük mesaj → soket bağlanır (1009)", big.closed == 1009, str(big.closed))

    for s_ in (a, b, an, adm, c_, e, many):
        await s_.ws.close()


# ════════════════════════════════════════════════════════════════
async def seed(c: httpx.AsyncClient, db: asyncpg.Connection) -> dict:
    users = {}
    for key, role in (("a", "customer"), ("b", "provider"), ("c", "customer"), ("admin", "customer")):
        r = await c.post("/api/v1/auth/register", json={
            "email": f"{key}-{uuid.uuid4().hex[:6]}@test.az", "password": "Guclu!Parol1",
            "name": f"Test {key}", "role": role})
        check(f"qeydiyyat: {key}", r.status_code == 201, "" if r.status_code == 201 else r.text[:120])
        users[key] = {"id": str(r.json()["user_id"]), "token": r.json()["access_token"]}
    await db.execute("update profiles set role = 'admin' where id = $1", uuid.UUID(users["admin"]["id"]))
    A, B = uuid.UUID(users["a"]["id"]), uuid.UUID(users["b"]["id"])
    opp = await db.fetchval("insert into opportunities (title, date, created_by, status) values"
                            " ('Kran', current_date, $1, 'pending') returning id", A)
    offer = await db.fetchval("insert into opportunities_offers (opportunity_id, provider_id, offer_amount)"
                              " values ($1, $2, 100) returning id", opp, B)
    disp = await db.fetchval("insert into disputes (opportunity_id, offer_id, raised_by, against_user, reason,"
                             " description) values ($1, $2, $3, $4, 'poor_quality',"
                             " 'İş keyfiyyətsiz görülüb, kran yenə sızır') returning id",
                             opp, offer, A, B)
    users["offer_id"], users["dispute_id"], users["opp_id"] = str(offer), str(disp), str(opp)
    return users


async def main() -> None:
    from app.main import app

    db = await asyncpg.connect(pg_dsn())
    server = None
    try:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t", timeout=60) as c:
            print("── Hazırlıq ──")
            U = await seed(c, db)
            await storage_tests(c, U, db)

        print("\n── uvicorn :%d işə salınır ──" % PORT)
        server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(PORT), "--log-level", "warning"],
            cwd=BACKEND, env=os.environ.copy())
        async with httpx.AsyncClient(timeout=2) as hc:
            for _ in range(100):
                try:
                    if (await hc.get(f"http://127.0.0.1:{PORT}/health")).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.2)
            else:
                raise SystemExit("server açılmadı")
        await realtime_tests(U, db)
    finally:
        await db.close()
        if server is not None:
            server.terminate()
            try:
                server.wait(10)
            except subprocess.TimeoutExpired:
                server.kill()
        import shutil
        shutil.rmtree(STORAGE_DIR, ignore_errors=True)
        shutil.rmtree(OUTSIDE_DIR, ignore_errors=True)

    print("\nSTORAGE + REALTIME TESTLƏRİ KEÇDİ ✓")


if __name__ == "__main__":
    asyncio.run(main())
