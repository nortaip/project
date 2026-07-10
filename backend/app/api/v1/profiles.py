"""Profillər — öz profilim, yeniləmə, ustanın public profili + rəylər."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User

router = APIRouter(prefix="/profiles", tags=["profiles"])

_ME_FIELDS = (
    "id, email, name, role, phone_number, address, avatar_url, balance,"
    " bonus_balance, is_verified, verification_status, is_online, rating,"
    " rating_count, latitude, longitude, created_at"
)


class ProfileUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    phone_number: str | None = Field(default=None, max_length=32)
    address: str | None = Field(default=None, max_length=500)
    avatar_url: str | None = Field(default=None, max_length=1000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_online: bool | None = None


@router.get("/me")
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> dict:
    row = (
        await db.execute(
            text(f"select {_ME_FIELDS} from profiles where id = :id"), {"id": user.id}
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profil tapılmadı")
    return dict(row._mapping)


@router.patch("/me")
async def update_me(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    updates = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not updates:
        raise HTTPException(status_code=400, detail="Dəyişiklik yoxdur")
    # Ağ siyahı — yalnız icazəli sahələr (balance/role və s. burada YOXDUR)
    sets = ", ".join(f"{k} = :{k}" for k in updates)
    updates["id"] = user.id
    await db.execute(
        text(f"update profiles set {sets}, updated_at = now() where id = :id"), updates
    )
    await db.commit()
    return {"ok": True}


@router.get("/{profile_id}")
async def public_profile(profile_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> dict:
    """Ustanın public profili — güvən məlumatları (balans/telefon YOXDUR)."""
    row = (
        await db.execute(
            text(
                "select id, name, role, avatar_url, is_verified, verification_status,"
                "       is_online, rating, rating_count, experience_years, specialties,"
                "       created_at,"
                "  (select count(*) from opportunities_offers oo"
                "    where oo.provider_id = profiles.id and oo.status='completed') as completed_jobs"
                " from profiles where id = :id"
            ),
            {"id": profile_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Profil tapılmadı")
    return dict(row._mapping)


@router.get("/{profile_id}/reviews")
async def reviews(
    profile_id: uuid.UUID, db: AsyncSession = Depends(get_db), limit: int = 20
) -> list[dict]:
    rows = await db.execute(
        text(
            "select rating, comment, created_at from provider_reviews"
            " where provider_id = :id and comment is not null and comment <> ''"
            " order by created_at desc limit :l"
        ),
        {"id": profile_id, "l": min(limit, 50)},
    )
    return [dict(r._mapping) for r in rows]
