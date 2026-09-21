"""Fayl saxlama — Supabase Storage-ın sadə əvəzi (lokal disk / S3-ə hazır).

Bucket-lər: kyc (yalnız sahibi + admin oxuyur), images (public oxunuş).
Fayllar STORAGE_DIR altında bucket/istifadəçi qovluqlarında saxlanılır;
ad təsadüfi UUID ilə verilir (path traversal mümkün deyil).
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

_BUCKETS = {"kyc": "private", "images": "public"}
_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "application/pdf": ".pdf",
}


def _root() -> Path:
    p = Path(settings.STORAGE_DIR)
    p.mkdir(parents=True, exist_ok=True)
    return p


@router.post("/{bucket}", status_code=201)
async def upload(
    bucket: str,
    file: UploadFile,
    user: User = Depends(get_current_user),
) -> dict:
    if bucket not in _BUCKETS:
        raise HTTPException(status_code=404, detail="Bucket tapılmadı")
    ext = _ALLOWED_TYPES.get(file.content_type or "")
    if ext is None:
        raise HTTPException(status_code=415, detail="Fayl tipi dəstəklənmir")
    data = await file.read()
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Fayl 10 MB-dan böyükdür")

    name = f"{uuid.uuid4().hex}{ext}"
    rel = Path(bucket) / str(user.id) / name
    dest = _root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return {"path": str(rel), "size": len(data)}


@router.get("/{bucket}/{owner_id}/{name}")
async def download(
    bucket: str,
    owner_id: uuid.UUID,
    name: str,
    user: User = Depends(get_current_user),
) -> FileResponse:
    if bucket not in _BUCKETS:
        raise HTTPException(status_code=404, detail="Bucket tapılmadı")
    # Ad yalnız bizim generasiya formatımızda ola bilər (traversal qoruması)
    if not name.replace(".", "").replace("-", "").isalnum() or "/" in name:
        raise HTTPException(status_code=400, detail="Yanlış fayl adı")
    if _BUCKETS[bucket] == "private":
        if user.id != owner_id and user.role not in ("admin", "master", "superadmin"):
            raise HTTPException(status_code=403, detail="İcazə yoxdur")
    path = _root() / bucket / str(owner_id) / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Fayl tapılmadı")
    return FileResponse(path)
