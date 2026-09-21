"""Vahid bildiriş servisi — Supabase-dəki notify_* trigger-lərinin əvəzi.

İki mərhələ:
  1. `insert_notification(db, ...)` — tranzaksiya DAXİLİNDƏ notifications
     sətri yaradır (rollback olsa bildiriş də itir — düzgün davranış).
  2. `dispatch(...)` — commit-DƏN SONRA çağırılır: FCM push + WebSocket
     publish (hər ikisi best-effort, API-ni ləngitmir).

Rahatlıq üçün `notify_after_commit` ikisini birləşdirən nümunə axındır:
    nid = await insert_notification(db, ...)
    await db.commit()
    dispatch(user_id, title, body, {"notif_id": nid, ...})
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.push import send_push
from app.services.realtime import publish


async def insert_notification(
    db: AsyncSession, *, user_id, ntype: str, title: str, body: str,
    related_id: str | None = None,
) -> str:
    row = (
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " values (:u, :t, :ti, :b, :r) returning id"
            ),
            {"u": user_id, "t": ntype, "ti": title, "b": body, "r": related_id},
        )
    ).first()
    return str(row.id)


def dispatch(
    user_id: uuid.UUID | str, title: str, body: str,
    data: dict[str, Any] | None = None,
) -> None:
    """Push + WS — fire-and-forget (commit-dən sonra çağırın)."""
    payload = data or {}

    async def _run() -> None:
        try:
            await send_push(user_id, title, body, payload)
        except Exception:
            pass
        try:
            await publish(user_id, "notification.new",
                          {"title": title, "body": body, **payload})
        except Exception:
            pass

    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        pass  # event loop yoxdur (test konteksti)


async def broadcast_new_opportunity(db: AsyncSession, *, opp_id, title: str,
                                    body: str, category_id, subcategory_id,
                                    created_by) -> list[str]:
    """notify_providers_on_new_opportunity trigger-inin portu.

    Uyğun ixtisaslı (və ya heç bir ixtisas seçməmiş) provayderlərə
    notifications sətri yaradır; qaytarılan user_id siyahısı ilə çağıran
    tərəf commit-dən sonra dispatch edə bilər.
    """
    rows = (
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " select p.id, 'new_opportunity', :ti, :b, :r"
                "   from profiles p"
                "  where lower(coalesce(p.role,'')) in ('provider','pro','seller')"
                "    and p.id <> :creator"
                "    and ("
                "      (p.specialties is not null and ("
                "        (:cat <> '' and p.specialties @> array[cast(:cat as text)])"
                "        or (:sub <> '' and p.specialties @> array[cast(:sub as text)])"
                "      ))"
                "      or coalesce(array_length(p.specialties, 1), 0) = 0"
                "    )"
                " returning user_id"
            ),
            {"ti": f"Yeni sifariş: {title}", "b": body, "r": str(opp_id),
             "creator": created_by,
             "cat": str(category_id or ""), "sub": str(subcategory_id or "")},
        )
    ).all()
    return [str(r.user_id) for r in rows]
