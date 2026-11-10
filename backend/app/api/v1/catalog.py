"""Kataloq — kateqoriyalar, alt-kateqoriyalar, suallar, qiymətlər (public)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cached
from app.db.session import get_db
from app.services import marketplace

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/categories")
async def categories(db: AsyncSession = Depends(get_db)) -> list[dict]:
    async def load() -> list[dict]:
        rows = await db.execute(
            text(
                "select id, label, label_ru, label_en, icon_name"
                " from service_categories where is_active order by label"
            )
        )
        return [dict(r._mapping) for r in rows]

    return await cached("catalog:categories", 300, load)


@router.get("/categories/{category_id}/subcategories")
async def subcategories(category_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, label, label_ru, label_en from service_subcategories"
            " where category_id = :c order by label"
        ),
        {"c": category_id},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/categories/{category_id}/questions")
async def questions(
    category_id: uuid.UUID,
    subcategory_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    sql = (
        "select id, name, label, label_ru, label_en, type, options,"
        "       options_ru, options_en, required, order_num, subcategory_id"
        " from service_questions where category_id = :c"
    )
    params: dict = {"c": category_id}
    if subcategory_id:
        sql += " and subcategory_id = :s"
        params["s"] = subcategory_id
    rows = await db.execute(text(sql + " order by order_num"), params)
    return [dict(r._mapping) for r in rows]


@router.get("/home-overview")
async def home_overview(db: AsyncSession = Depends(get_db)) -> dict:
    """home_overview RPC-nin portu — ana səhifə icmalı (60s keş).
    Sorğular ortaq servisdədir (RPC adapteri ilə eyni kod)."""
    return await marketplace.home_overview(db)


@router.get("/banners")
async def banners(db: AsyncSession = Depends(get_db)) -> list[dict]:
    async def load() -> list[dict]:
        rows = await db.execute(
            text(
                "select id, title, subtitle, image_url, link_url, sort_order"
                " from banners where is_active order by sort_order, created_at desc"
            )
        )
        return [dict(r._mapping) for r in rows]

    return await cached("catalog:banners", 60, load)
