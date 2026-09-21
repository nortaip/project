"""Kataloq — kateqoriyalar, alt-kateqoriyalar, suallar, qiymətlər (public)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cached
from app.db.session import get_db

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

    Kateqoriya tərcümə fallback-ı: əvvəl service_categories.label_ru/en/zh,
    tapılmasa service_text_translations lüğəti (sxemdə mövcuddursa —
    introspeksiya ilə yoxlanır, yoxdursa sorğu ondan istifadə etmir).
    """

    async def load() -> dict:
        # Sxem introspeksiyası: köhnə Supabase sxemində olan, lakin bu
        # bazada olmaya bilən obyektlər üçün qoruma
        meta = (
            await db.execute(
                text(
                    "select to_regclass('public.service_text_translations')"
                    "         is not null as has_tr,"
                    "       exists (select 1 from information_schema.columns"
                    "         where table_schema='public'"
                    "           and table_name='service_categories'"
                    "           and column_name='label_zh') as has_zh"
                )
            )
        ).first()
        has_tr, has_zh = bool(meta.has_tr), bool(meta.has_zh)

        counts = (
            await db.execute(
                text(
                    "select"
                    " (select count(*) from profiles where role = 'provider') as providers,"
                    " (select count(*) from services) as services,"
                    " (select count(*) from bookings) as bookings"
                )
            )
        ).first()

        # Top provayderlər — reytinq üzrə ilk 8
        # (profiles.rating bu sxemdə text-dir → təhlükəsiz rəqəmsal sıralama)
        top = await db.execute(
            text(
                "select pr.id, pr.name, pr.avatar_url, pr.rating, pr.is_verified,"
                "       (select count(*) from provider_reviews rv"
                "         where rv.provider_id = pr.id)::int as reviews_count"
                "  from profiles pr where pr.role = 'provider'"
                " order by (case when pr.rating ~ '^[0-9]+(\\.[0-9]+)?$'"
                "                then cast(pr.rating as numeric) end)"
                "          desc nulls last"
                " limit 8"
            )
        )

        # Kateqoriyalar — tərcümə fallback-ı ilə
        sc_cols = "label_ru, label_en" + (", label_zh" if has_zh else "")
        ru_expr = "coalesce(sc.label_ru" + (", t.ru)" if has_tr else ")")
        en_expr = "coalesce(sc.label_en" + (", t.en)" if has_tr else ")")
        if has_zh and has_tr:
            zh_expr = "coalesce(sc.label_zh, t.zh)"
        elif has_zh:
            zh_expr = "sc.label_zh"
        elif has_tr:
            zh_expr = "t.zh"
        else:
            zh_expr = "cast(null as text)"
        tr_join = (
            " left join service_text_translations t on t.az = g.category"
            if has_tr else ""
        )
        cats = await db.execute(
            text(
                "select g.category, g.count,"
                f"      {ru_expr} as label_ru,"
                f"      {en_expr} as label_en,"
                f"      {zh_expr} as label_zh"
                "  from ("
                "    select trim(category) as category, count(*)::int as count"
                "      from services where coalesce(trim(category), '') <> ''"
                "     group by trim(category)"
                "     order by count(*) desc limit 12"
                "  ) g"
                f" left join lateral (select {sc_cols} from service_categories"
                "    where trim(label) = g.category limit 1) sc on true"
                f"{tr_join}"
            )
        )

        cities = await db.execute(
            text(
                "select trim(split_part(location, ',', 1)) as city,"
                "       count(*)::int as count"
                "  from services"
                " where coalesce(trim(split_part(location, ',', 1)), '') <> ''"
                " group by trim(split_part(location, ',', 1))"
                " order by count(*) desc limit 10"
            )
        )

        recent = await db.execute(
            text(
                "select id, title, category, location, created_at"
                "  from services order by created_at desc limit 5"
            )
        )

        return {
            "providers": counts.providers,
            "services": counts.services,
            "bookings": counts.bookings,
            "top_providers": [dict(r._mapping) for r in top],
            "categories": [dict(r._mapping) for r in cats],
            "cities": [dict(r._mapping) for r in cities],
            "recent": [dict(r._mapping) for r in recent],
        }

    return await cached("catalog:home-overview", 60, load)


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
