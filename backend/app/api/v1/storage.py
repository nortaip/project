"""Fayl saxlama — Supabase Storage-ın əvəzi (lokal disk).

Bucket adları canlı Supabase bucket-ləri ilə EYNİDİR ki, köçürülmüş fayllar
(scripts/migrate_storage.py) və bazadakı yollar dəyişmədən işləsin.

Giriş rejimləri:
  public        — hamı oxuyur (elan şəkilləri, bannerlər)
  authenticated — istənilən giriş etmiş istifadəçi oxuyur (profil şəkilləri)
  private       — yalnız sahib (yolun ilk seqmenti = user id) və admin (KYC, mübahisə)

URL-lər:
  GET  /storage/public/{bucket}/{yol}   — tokensiz (yalnız public bucket)
  GET  /storage/object/{bucket}/{yol}   — tokenlə (bütün rejimlər)
  POST /storage/{bucket}                — yükləmə → {bucket}/{user_id}/{uuid}.ext

Fayllar STORAGE_DIR/{bucket}/... altında saxlanır. Yeni yüklənənlərin adı
təsadüfi UUID-dir; oxunuşda yol bucket qovluğundan kənara çıxa bilməz.
"""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_current_user
from app.core.config import settings
from app.models.user import User

router = APIRouter(prefix="/storage", tags=["storage"])

_ADMIN_ROLES = ("admin", "master", "superadmin")

_BUCKETS = {
    # canlı Supabase bucket-ləri
    "service-images": "public",
    "opportunity-photos": "public",
    "completion-evidence": "public",
    "banners": "public",
    "make-33c80158-profile-photos": "authenticated",
    "kyc-documents": "private",
    "dispute-evidence": "private",
    # backend-in ilkin (qısa adlı) bucket-ləri
    "images": "public",
    "kyc": "private",
}
_ADMIN_UPLOAD_ONLY = {"banners"}
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "image/gif": ".gif", "application/pdf": ".pdf",
}


def _root() -> Path:
    p = Path(settings.STORAGE_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _mode(bucket: str) -> str:
    mode = _BUCKETS.get(bucket)
    if mode is None:
        raise HTTPException(status_code=404, detail="Bucket tapılmadı")
    return mode


def _resolve(bucket: str, rel: str) -> Path:
    """Bucket daxilində faylı tapır; qovluqdan kənara çıxma cəhdi → 404."""
    base = (_root() / bucket).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise HTTPException(status_code=404, detail="Fayl tapılmadı")
    return target


def _may_read(mode: str, rel: str, user: User) -> bool:
    if mode in ("public", "authenticated") or user.role in _ADMIN_ROLES:
        return True
    return rel.split("/", 1)[0] == str(user.id)


# Sıra vacibdir: sabit prefiksli marşrutlar ümumi {bucket}/... marşrutundan əvvəl
@router.get("/public/{bucket}/{path:path}")
async def read_public(bucket: str, path: str) -> FileResponse:
    if _mode(bucket) != "public":
        raise HTTPException(status_code=404, detail="Fayl tapılmadı")
    return FileResponse(
        _resolve(bucket, path), headers={"Cache-Control": "public, max-age=86400"}
    )


@router.get("/object/{bucket}/{path:path}")
async def read_object(
    bucket: str, path: str, user: User = Depends(get_current_user)
) -> FileResponse:
    mode = _mode(bucket)
    if not _may_read(mode, path, user):
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    return FileResponse(
        _resolve(bucket, path), headers={"Cache-Control": "private, max-age=300"}
    )


@router.post("/{bucket}", status_code=201)
async def upload(
    bucket: str,
    file: UploadFile,
    user: User = Depends(get_current_user),
) -> dict:
    mode = _mode(bucket)
    if bucket in _ADMIN_UPLOAD_ONLY and user.role not in _ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status_code=415, detail="Fayl tipi dəstəklənmir")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Fayl 10 MB-dan böyükdür")

    name = f"{uuid.uuid4().hex}{ext}"
    rel = Path(str(user.id)) / name
    dest = _root() / bucket / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    kind = "public" if mode == "public" else "object"
    return {
        "bucket": bucket,
        "path": f"{bucket}/{rel}",
        "url": f"{settings.API_V1_PREFIX}/storage/{kind}/{bucket}/{rel}",
        "size": len(data),
    }


@router.get("/{bucket}/{owner_id}/{name}")
async def download(
    bucket: str,
    owner_id: uuid.UUID,
    name: str,
    user: User = Depends(get_current_user),
) -> FileResponse:
    """Köhnə forma (bucket/sahib/ad) — /storage/object/... ilə eynidir."""
    mode = _mode(bucket)
    rel = f"{owner_id}/{name}"
    if not _may_read(mode, rel, user):
        raise HTTPException(status_code=403, detail="İcazə yoxdur")
    return FileResponse(_resolve(bucket, rel))
