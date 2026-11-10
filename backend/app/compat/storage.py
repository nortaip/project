"""Supabase Storage-uyğun /storage/v1 — fayllar lokal diskdə.

Klientlər (`supabase.storage.from(bucket)` — storage-js və Dart `storage_client`)
bu marşrutlarla danışır:

    POST   /object/{bucket}/{yol}            upload / uploadBinary (multipart və ya xam gövdə)
    PUT    /object/{bucket}/{yol}            update (mövcud faylın üzərinə yazma)
    DELETE /object/{bucket}                  remove  — gövdə {"prefixes": [...]}
    POST   /object/sign/{bucket}/{yol}       createSignedUrl → {"signedURL": "/object/sign/...?token="}
    GET    /object/sign/{bucket}/{yol}?token imzalı URL ilə oxuma (tokensiz, vaxtı bitən)
    GET    /object/public/{bucket}/{yol}     getPublicUrl-in ünvanı (yalnız public bucket)
    GET    /object/authenticated/{bucket}/{yol}, /object/{bucket}/{yol}   download (Bearer token)

Fayllar STORAGE_DIR/{bucket}/{yol} altındadır — `app/api/v1/storage.py` və
`scripts/migrate_storage.py` ilə EYNİ düzüm, yəni köçürülmüş fayllar və bazadakı
yollar dəyişmədən işləyir.

İcazələr: Supabase-də `storage.objects` üzərindəki RLS siyasətləri burada Python
yoxlamalarıdır (`_can`). İki canlı siyasət — "Allow all for testing" (ALL, true)
və "Allow all users to read from the bucket" (SELECT, true) — QƏSDƏN köçürülməyib:
onlar bütün digər siyasətləri təsirsiz edirdi (KYC sənədləri daxil hər fayl hər
kəsə açıq idi). Siyasəti olmayan bucket-lər üçün qayda klientlərin istifadə
etdiyi yol formasından çıxarılıb (bax `_can`).

Xəta forması Supabase Storage ilə eynidir: {"statusCode": "404", "error", "message"}
(`statusCode` sətirdir — Dart klienti onu String kimi oxuyur).
"""
from __future__ import annotations

import os
import re
import shutil
import tempfile
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.routing import APIRoute
from jose import JWTError, jwt
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool
from starlette.formparsers import MultiPartException, MultiPartParser

from app.api.v1.storage import _root  # eyni STORAGE_DIR (qovluq yoxdursa yaradır)
from app.compat.context import Caller, bearer_token, caller_from_token
from app.compat.errors import ApiError
from app.core.config import settings
from app.db.session import engine

MB = 1024 * 1024
_ADMIN = ("admin", "master", "superadmin")


# ── Xətalar ───────────────────────────────────────────────────────
class StorageError(Exception):
    def __init__(self, status: int, error: str, message: str) -> None:
        super().__init__(message)
        self.status, self.error, self.message = status, error, message

    def response(self) -> JSONResponse:
        return JSONResponse(status_code=self.status, content={
            "statusCode": str(self.status), "error": self.error, "message": self.message})


def _bucket_not_found() -> StorageError:
    return StorageError(404, "Bucket not found", "Bucket not found")


def _object_not_found() -> StorageError:
    return StorageError(404, "not_found", "Object not found")


def _forbidden() -> StorageError:
    return StorageError(403, "Unauthorized", "new row violates row-level security policy")


class _StorageRoute(APIRoute):
    """StorageError → Supabase formasında JSON (router səviyyəsində tutulur)."""

    def get_route_handler(self) -> Callable:
        handler = super().get_route_handler()

        async def wrapped(request: Request) -> Response:
            try:
                return await handler(request)
            except StorageError as e:
                return e.response()

        return wrapped


router = APIRouter(tags=["compat-storage"], route_class=_StorageRoute)


# ── Bucket-lər (canlı Supabase ilə eyni ad, görünürlük və limitlər) ──
_JPEG, _PNG, _WEBP, _AVIF, _HEIC, _GIF = (
    "image/jpeg", "image/png", "image/webp", "image/avif", "image/heic", "image/gif")
_MP4, _MOV, _PDF, _SVG = "video/mp4", "video/quicktime", "application/pdf", "image/svg+xml"


@dataclass(frozen=True)
class Bucket:
    public: bool
    max_bytes: int
    mimes: frozenset[str]


BUCKETS: dict[str, Bucket] = {
    "make-33c80158-profile-photos": Bucket(False, 5 * MB, frozenset({_JPEG, _PNG, _WEBP})),
    "service-images": Bucket(True, 5 * MB, frozenset({_JPEG, _PNG, _WEBP, _AVIF})),
    "dispute-evidence": Bucket(False, 20 * MB, frozenset(
        {_JPEG, _PNG, _HEIC, _WEBP, _MP4, _MOV, _PDF})),
    "kyc-documents": Bucket(False, 10 * MB, frozenset({_JPEG, _PNG, _HEIC, _WEBP})),
    "opportunity-photos": Bucket(True, 5 * MB, frozenset({_JPEG, _PNG, _WEBP, _HEIC})),
    # Canlıda limit/tip siyahısı yox idi. Ölçü 20 MB; tip siyahısı burada ƏLAVƏ
    # olunub (yalnız şəkil) — public bucket-dən ixtiyari fayl paylanmasın.
    "completion-evidence": Bucket(True, 20 * MB, frozenset({_JPEG, _PNG, _WEBP, _HEIC})),
    "banners": Bucket(True, 20 * MB, frozenset({_JPEG, _PNG, _WEBP, _GIF, _AVIF, _SVG})),
}

# Fayl adının uzantısı → tip. Uzantı varsa bucket-in tip siyahısına uyğun olmalıdır.
_EXT_TYPES = {
    ".jpg": _JPEG, ".jpeg": _JPEG, ".jfif": _JPEG, ".png": _PNG, ".webp": _WEBP,
    ".avif": _AVIF, ".heic": _HEIC, ".heif": _HEIC, ".gif": _GIF, ".svg": _SVG,
    ".mp4": _MP4, ".m4v": _MP4, ".mov": _MOV, ".qt": _MOV, ".pdf": _PDF,
}
_HEIC_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"hevm", b"hevs",
                b"mif1", b"msf1"}
_SNIFF_BYTES = 2048


def sniff(head: bytes) -> str | None:
    """Faylın ƏSL tipi ilk baytlardan (magic number) — klientin göndərdiyi
    Content-Type-a etibar edilmir."""
    if head[:3] == b"\xff\xd8\xff":
        return _JPEG
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return _PNG
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return _GIF
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return _WEBP
    if head[:5] == b"%PDF-":
        return _PDF
    if head[4:8] == b"ftyp" and len(head) >= 12:
        size = min(int.from_bytes(head[:4], "big"), len(head), 256)
        brands = {head[8:12]} | {head[i:i + 4] for i in range(16, max(size, 16), 4)}
        if brands & {b"avif", b"avis"}:
            return _AVIF
        if head[8:12] in _HEIC_BRANDS or brands & (_HEIC_BRANDS - {b"mif1", b"msf1"}):
            return _HEIC
        return _MOV if head[8:12] == b"qt  " else _MP4
    if head[4:8] in (b"moov", b"mdat", b"wide", b"free", b"skip"):
        return _MOV     # köhnə QuickTime (ftyp qutusu yoxdur)
    start = head.lstrip(b"\xef\xbb\xbf \t\r\n")[:1024].lower()
    if start.startswith(b"<svg") or (start.startswith(b"<?xml") and b"<svg" in start):
        return _SVG
    return None


# ── Yol təhlükəsizliyi ────────────────────────────────────────────
_BAD_CHARS = re.compile(r"[\x00-\x1f\x7f\\]")


def _clean_name(name: str) -> str:
    """Obyekt adını yoxlayır (storage-js kimi artıq `/`-ləri atır). `..`, `.`,
    boş seqment, `\\`, idarəetmə simvolları və həddən uzun adlar rədd olunur."""
    name = re.sub(r"/+", "/", name).strip("/")
    if not name or len(name.encode()) > 1024 or _BAD_CHARS.search(name):
        raise StorageError(400, "InvalidKey", "Invalid key")
    for seg in name.split("/"):
        if seg in (".", "..") or len(seg.encode()) > 255 or seg != seg.strip():
            raise StorageError(400, "InvalidKey", "Invalid key")
    return name


def _dest(bucket: str, name: str) -> Path:
    """STORAGE_DIR/{bucket}/{name} — simvolik keçidlər açıldıqdan SONRA da bucket
    qovluğunun daxilində qalmalıdır (bax app/api/v1/storage.py `_resolve`)."""
    base = (_root() / bucket).resolve()
    target = (base / name).resolve()
    if target == base or not target.is_relative_to(base):
        raise StorageError(400, "InvalidKey", "Invalid key")
    return target


def _bucket(bucket_id: str) -> Bucket:
    b = BUCKETS.get(bucket_id)
    if b is None:
        raise _bucket_not_found()
    return b


# ── Kim soruşur + icazə yoxlamaları (köhnə storage.objects RLS) ───
def _uuid_text(s: str | None) -> str | None:
    """`x::text = folder` müqayisəsinin qarşılığı: yalnız kanonik uuid mətni."""
    try:
        return s if s and str(uuid.UUID(s)) == s else None
    except ValueError:
        return None


@dataclass
class Access:
    caller: Caller
    _cache: dict[str, Any] = field(default_factory=dict)

    @property
    def uid(self) -> str | None:
        return str(self.caller.user_id) if self.caller.user_id else None

    async def _one(self, key: str, sql: str, params: dict) -> Any:
        if key not in self._cache:
            async with engine.connect() as conn:
                self._cache[key] = (await conn.execute(text(sql), params)).first()
        return self._cache[key]

    async def role(self) -> str:
        """lower(coalesce(profiles.role, '')) — siyasətlərdəki ifadə ilə eyni."""
        if self.uid is None:
            return ""
        row = await self._one("role", "select lower(coalesce(role, '')) from public.profiles"
                                      " where id = cast(:u as uuid)", {"u": self.uid})
        return row[0] if row else ""

    async def has_role(self, *roles: str) -> bool:
        return (await self.role()) in roles

    async def dispute(self, dispute_id: str) -> Any:
        return await self._one(
            f"d:{dispute_id}",
            "select raised_by::text as raised_by, against_user::text as against_user, status"
            "  from public.disputes where id = cast(:d as uuid)", {"d": dispute_id})

    async def offer_party(self, offer_id: str) -> bool:
        """Təklifin ustası və ya həmin sifarişə təyin olunmuş briqada üzvü."""
        row = await self._one(
            f"o:{offer_id}",
            "select (o.provider_id = cast(:u as uuid)) or exists ("
            "         select 1 from public.brigade_assignments ba"
            "           join public.brigade_members bm on bm.id = ba.member_id"
            "          where ba.source_id = o.opportunity_id::text"
            "            and bm.profile_id = cast(:u as uuid))"
            "  from public.opportunities_offers o where o.id = cast(:o as uuid)",
            {"o": offer_id, "u": self.uid})
        return bool(row and row[0])


async def _access(request: Request) -> Access:
    try:
        caller = caller_from_token(bearer_token(request))
    except ApiError as e:     # vaxtı bitmiş token
        raise StorageError(401, "Unauthorized", "jwt expired") from e
    if caller.user_id is not None:
        # deaktiv edilmiş/silinmiş hesabın hələ etibarlı tokeni → anonim
        async with engine.connect() as conn:
            row = (await conn.execute(text(
                "select is_active from public.users where id = cast(:u as uuid)"),
                {"u": str(caller.user_id)})).first()
        if row is None or not row[0]:
            caller = Caller()
    return Access(caller)


async def _can(acc: Access, op: str, bucket_id: str, name: str) -> bool:
    """op: select | insert | update | delete. `folders` = storage.foldername(name)
    (fayl adı daxil deyil), yəni `folders[0]` SQL-dəki `(foldername(name))[1]`-dir."""
    folders = name.split("/")[:-1]
    f1 = folders[0] if len(folders) >= 1 else None
    f2 = folders[1] if len(folders) >= 2 else None
    uid = acc.uid
    if op == "select" and BUCKETS[bucket_id].public:
        # *_public_read siyasətləri; public bucket onsuz da tokensiz oxunur
        return True
    if uid is None:
        return False          # auth.uid() null → heç bir yazma/gizli oxuma siyasəti keçmir

    if bucket_id == "service-images":
        if op == "insert":
            # service_images_owner_upload | "Give users authenticated access to folder"
            return (f1 == "services" and f2 == uid) or f1 == "private"
        return f2 == uid      # service_images_owner_update / _delete

    if bucket_id == "opportunity-photos":
        return f1 == uid      # opportunity photos upload / update / delete

    if bucket_id == "banners":
        return await acc.has_role(*_ADMIN)       # banners_img_admin_write (ALL)

    if bucket_id == "kyc-documents":
        if op == "select":    # kyc read admin only
            return await acc.has_role("admin", "support", "master", "superadmin")
        if op in ("insert", "delete"):           # kyc upload own / kyc delete own pending
            return f1 == uid
        return False          # UPDATE siyasəti yoxdur → üzərinə yazmaq olmaz

    if bucket_id == "dispute-evidence":
        did = _uuid_text(f1)
        d = await acc.dispute(did) if did else None
        if d is None:
            return False
        party = uid in (d.raised_by, d.against_user)
        active = d.status in ("open", "under_review")
        if op == "select":    # dispute evidence read
            return party or await acc.has_role("admin", "support")
        if op == "insert":    # dispute evidence upload
            return f2 == uid and party and active
        if op == "delete":    # dispute evidence delete
            return f2 == uid and active
        return False

    if bucket_id == "completion-evidence":
        # Canlıda xüsusi siyasət yox idi. Mobil klient `{offer_id}/...` yoluna yazır.
        if op == "insert":
            oid = _uuid_text(f1)
            return bool(oid) and (await acc.offer_party(oid) or await acc.has_role(*_ADMIN))
        return await acc.has_role(*_ADMIN)       # üzərinə yazma/silmə yalnız admin

    if bucket_id == "make-33c80158-profile-photos":
        # Canlıda xüsusi siyasət yox idi: yazma yalnız öz qovluğuna, oxuma giriş etmiş hər kəsə
        if op == "select":
            return True
        return f1 == uid or await acc.has_role(*_ADMIN)

    return False


# ── Yükləmə ───────────────────────────────────────────────────────
class _TooLarge(Exception):
    pass


def _too_large() -> StorageError:
    return StorageError(413, "Payload too large",
                        "The object exceeded the maximum allowed size")


async def _capped(request: Request, cap: int):
    """Sorğu gövdəsi axını — `cap` baytdan çox oxunmur (Content-Length-ə etibar yoxdur)."""
    seen = 0
    async for chunk in request.stream():
        seen += len(chunk)
        if seen > cap:
            raise _TooLarge()
        yield chunk


async def _receive(request: Request, limit: int) -> tuple[Any, str]:
    """Gövdədən faylı götürür → (müvəqqəti fayl obyekti, elan olunan content-type).
    storage-js Blob/File və Dart klienti multipart (sahə adı ''), xam gövdə isə
    ArrayBuffer/axın yükləmələridir."""
    ctype = (request.headers.get("content-type") or "").strip()
    cap = limit + 64 * 1024         # multipart sərhədləri/sahələri üçün pay
    try:
        if int(request.headers.get("content-length") or 0) > cap:
            raise _too_large()
    except ValueError as e:
        raise StorageError(400, "InvalidRequest", "Invalid Content-Length") from e
    try:
        if ctype.lower().startswith("multipart/form-data"):
            parser = MultiPartParser(request.headers, _capped(request, cap),
                                     max_files=1, max_fields=8)
            form = await parser.parse()
            upload = next((v for _, v in form.multi_items() if hasattr(v, "file")), None)
            if upload is None:
                raise StorageError(400, "InvalidRequest", "No file in multipart body")
            return upload.file, (upload.content_type or "")
        spool = tempfile.SpooledTemporaryFile(max_size=MB)
        async for chunk in _capped(request, limit):
            spool.write(chunk)
        return spool, ctype
    except _TooLarge as e:
        raise _too_large() from e
    except MultiPartException as e:
        raise StorageError(400, "InvalidRequest", "Malformed multipart body") from e


def _store(src: Any, dest: Path, overwrite: bool) -> None:
    """Müvəqqəti fayla yazıb atomik yerinə qoyur. overwrite=False olanda mövcud
    faylın üzərinə YAZILMIR (link → FileExistsError), yarış vəziyyəti daxil."""
    tmp_dir = _root() / ".tmp"       # bucket adı ola bilməz → kənardan əlçatmaz
    tmp_dir.mkdir(exist_ok=True)
    tmp = tmp_dir / f"{uuid.uuid4().hex}.part"
    try:
        with open(tmp, "wb") as out:
            src.seek(0)
            shutil.copyfileobj(src, out, 1024 * 1024)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if overwrite:
            os.replace(tmp, dest)
        else:
            os.link(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def _key_id(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "ellit-storage:" + key))


async def _upload(request: Request, bucket_id: str, path: str, replace_only: bool) -> Response:
    bucket = _bucket(bucket_id)
    name = _clean_name(path)
    acc = await _access(request)
    dest = _dest(bucket_id, name)
    exists = dest.is_file()
    upsert = replace_only or (request.headers.get("x-upsert") or "").lower() == "true"

    # İcazə gövdə oxunmazdan ƏVVƏL yoxlanır
    if replace_only:
        if not await _can(acc, "update", bucket_id, name):
            raise _forbidden()
        if not exists:
            raise _object_not_found()
    else:
        if not await _can(acc, "insert", bucket_id, name):
            raise _forbidden()
        if exists:
            if not upsert:
                raise StorageError(409, "Duplicate", "The resource already exists")
            if not await _can(acc, "update", bucket_id, name):
                raise _forbidden()   # başqasının (və ya sahibsiz) obyektinin üzərinə yazmaq olmaz

    ext = os.path.splitext(name)[1].lower()
    if ext and _EXT_TYPES.get(ext) not in bucket.mimes:
        raise StorageError(415, "invalid_mime_type", f"file extension {ext} is not supported")

    src, declared = await _receive(request, bucket.max_bytes)
    try:
        size = src.seek(0, os.SEEK_END)
        if size > bucket.max_bytes:
            raise _too_large()
        src.seek(0)
        actual = sniff(src.read(_SNIFF_BYTES))
        if actual not in bucket.mimes:
            shown = actual or declared.split(";")[0].strip() or "application/octet-stream"
            raise StorageError(415, "invalid_mime_type", f"mime type {shown} is not supported")
        try:
            await run_in_threadpool(_store, src, dest, upsert)
        except FileExistsError as e:
            raise StorageError(409, "Duplicate", "The resource already exists") from e
        except OSError as e:     # məs. fayl ↔ qovluq toqquşması
            raise StorageError(400, "InvalidKey", "Invalid key") from e
    finally:
        src.close()
    key = f"{bucket_id}/{name}"
    return JSONResponse({"Id": _key_id(key), "Key": key})


# ── Oxuma ─────────────────────────────────────────────────────────
def _serve(request: Request, bucket_id: str, name: str, cache: str) -> FileResponse:
    target = _dest(bucket_id, name)
    if not target.is_file():
        raise _object_not_found()
    with open(target, "rb") as fh:
        head = fh.read(_SNIFF_BYTES)
    media = (sniff(head) or _EXT_TYPES.get(target.suffix.lower())
             or "application/octet-stream")
    headers = {"Cache-Control": cache}
    if media == _SVG:
        # SVG skript daşıya bilər — birbaşa açılanda heç nə icra olunmasın
        headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    download = request.query_params.get("download")
    if download is not None or media == "application/octet-stream":
        fname = (download or target.name).replace("/", "_").replace("\\", "_")
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(fname)}"
    return FileResponse(target, media_type=media, headers=headers)


# ── İmzalı URL ────────────────────────────────────────────────────
_SIGN_TYPE = "storage-sign"       # access/refresh tokenləri ilə qarışmasın
_MAX_SIGN_SECONDS = 7 * 24 * 3600


def _sign(key: str, expires_in: int) -> str:
    return jwt.encode({"url": key, "type": _SIGN_TYPE, "exp": int(time.time()) + expires_in},
                      settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _signed_key(token: str | None) -> str | None:
    try:
        payload = jwt.decode(token or "", settings.JWT_SECRET,
                             algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    if payload.get("type") != _SIGN_TYPE or "exp" not in payload:
        return None
    return payload.get("url")


async def _json_body(request: Request) -> dict:
    try:
        body = await request.json()
    except Exception as e:  # noqa: BLE001
        raise StorageError(400, "InvalidRequest", "Body must be JSON") from e
    if not isinstance(body, dict):
        raise StorageError(400, "InvalidRequest", "Body must be a JSON object")
    return body


# ── Marşrutlar (sıra vacibdir: sabit prefikslər ümumi {bucket}-dən əvvəl) ──
@router.post("/object/sign/{bucket_id}/{path:path}")
async def create_signed_url(bucket_id: str, path: str, request: Request) -> Response:
    _bucket(bucket_id)
    name = _clean_name(path)
    acc = await _access(request)
    body = await _json_body(request)
    expires = body.get("expiresIn")
    if isinstance(expires, bool) or not isinstance(expires, int) or expires <= 0:
        raise StorageError(400, "InvalidRequest", "expiresIn must be a positive integer")
    if not await _can(acc, "select", bucket_id, name) or not _dest(bucket_id, name).is_file():
        raise _object_not_found()     # icazəsiz ≡ yoxdur (mövcudluq sızmır)
    token = _sign(f"{bucket_id}/{name}", min(expires, _MAX_SIGN_SECONDS))
    return JSONResponse({"signedURL": f"/object/sign/{bucket_id}/{quote(name)}?token={token}"})


@router.api_route("/object/sign/{bucket_id}/{path:path}", methods=["GET", "HEAD"])
async def read_signed(bucket_id: str, path: str, request: Request) -> Response:
    _bucket(bucket_id)
    name = _clean_name(path)
    if _signed_key(request.query_params.get("token")) != f"{bucket_id}/{name}":
        raise StorageError(400, "InvalidJWT", "Invalid or expired signed URL")
    return _serve(request, bucket_id, name, "private, max-age=300")


@router.api_route("/object/public/{bucket_id}/{path:path}", methods=["GET", "HEAD"])
async def read_public(bucket_id: str, path: str, request: Request) -> Response:
    if not _bucket(bucket_id).public:
        raise _bucket_not_found()     # gizli bucket public ünvandan görünmür
    return _serve(request, bucket_id, _clean_name(path), "public, max-age=3600")


async def _read_authenticated(bucket_id: str, path: str, request: Request) -> Response:
    bucket = _bucket(bucket_id)
    name = _clean_name(path)
    acc = await _access(request)
    if not await _can(acc, "select", bucket_id, name):
        raise _object_not_found()
    return _serve(request, bucket_id, name,
                  "public, max-age=3600" if bucket.public else "private, max-age=300")


@router.api_route("/object/authenticated/{bucket_id}/{path:path}", methods=["GET", "HEAD"])
async def read_authenticated(bucket_id: str, path: str, request: Request) -> Response:
    return await _read_authenticated(bucket_id, path, request)


@router.api_route("/object/{bucket_id}/{path:path}", methods=["GET", "HEAD"])
async def download(bucket_id: str, path: str, request: Request) -> Response:
    return await _read_authenticated(bucket_id, path, request)


@router.post("/object/{bucket_id}/{path:path}")
async def upload(bucket_id: str, path: str, request: Request) -> Response:
    return await _upload(request, bucket_id, path, replace_only=False)


@router.put("/object/{bucket_id}/{path:path}")
async def update(bucket_id: str, path: str, request: Request) -> Response:
    return await _upload(request, bucket_id, path, replace_only=True)


@router.delete("/object/{bucket_id}")
async def remove(bucket_id: str, request: Request) -> Response:
    """`remove([...])`: yalnız çağıranın silə bildiyi mövcud fayllar silinir və
    qaytarılır; qalanları (Supabase-də RLS kimi) səssizcə ötürülür."""
    _bucket(bucket_id)
    acc = await _access(request)
    prefixes = (await _json_body(request)).get("prefixes")
    if (not isinstance(prefixes, list) or not prefixes or len(prefixes) > 1000
            or not all(isinstance(p, str) for p in prefixes)):
        raise StorageError(400, "InvalidRequest", "prefixes must be a list of 1-1000 strings")
    removed = []
    for raw in dict.fromkeys(prefixes):
        try:
            name = _clean_name(raw)
            target = _dest(bucket_id, name)
        except StorageError:
            continue
        if not target.is_file() or not await _can(acc, "delete", bucket_id, name):
            continue
        stat = target.stat()
        target.unlink(missing_ok=True)
        stamp = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(stat.st_mtime))
        removed.append({
            "name": name, "bucket_id": bucket_id, "id": _key_id(f"{bucket_id}/{name}"),
            "owner": None, "created_at": stamp, "updated_at": stamp,
            "last_accessed_at": stamp, "metadata": {"size": stat.st_size},
        })
    return JSONResponse(removed)
