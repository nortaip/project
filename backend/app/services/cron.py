"""Dövri (cron) işlər — Supabase-dəki scheduled funksiyaların portu.

main.py lifespan-da `start_cron()` ilə işə düşür; hər işin öz intervalı
var, xətalar udulur (növbəti dövrədə təkrar cəhd).
"""
from __future__ import annotations

import asyncio
import logging
from decimal import Decimal

from sqlalchemy import text

from app.db.session import SessionLocal
from app.services.money import release_offer, refund_offer, MoneyError

log = logging.getLogger("cron")

_SYSTEM_ROLE = "superadmin"          # sistem işləri admin səlahiyyəti ilə
_SYSTEM_ID = "00000000-0000-0000-0000-000000000000"


async def auto_release_completed_escrow() -> int:
    """completed + 24 saat + mübahisəsiz → escrow avtomatik açılır."""
    done = 0
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "select o.id from opportunities_offers o"
                    " join opportunities opp on opp.id = o.opportunity_id"
                    " where opp.status = 'completed'"
                    "   and opp.completed_at < now() - interval '24 hours'"
                    "   and o.status = 'accepted'"
                    "   and o.escrow_released_at is null"
                    "   and not exists (select 1 from disputes d"
                    "     where d.opportunity_id = opp.id"
                    "       and d.status in ('open','under_review'))"
                    " limit 100"
                )
            )
        ).all()
    for r in rows:
        async with SessionLocal() as db:
            try:
                await release_offer(db, offer_id=r.id, caller_id=_SYSTEM_ID,
                                    caller_role=_SYSTEM_ROLE)
                await db.commit()
                done += 1
            except (MoneyError, Exception):
                await db.rollback()
    return done


async def cancel_stale_pending() -> int:
    """2 saatdan çox təklifsiz qalan sifarişlər avtomatik ləğv olunur."""
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "update opportunities set status='cancelled',"
                    " cancellation_reason='AUTO_CANCEL_STALE_PENDING'"
                    " where status in ('pending','open','new')"
                    "   and created_at < now() - interval '2 hours'"
                    " returning id"
                )
            )
        ).all()
        if rows:
            await db.execute(
                text("update opportunities_offers set status='cancelled'"
                     " where opportunity_id = any(:ids) and status='pending'"),
                {"ids": [r.id for r in rows]},
            )
        await db.commit()
        return len(rows)


async def refund_no_show() -> int:
    """Qəbuldan 30 dəq sonra hələ yola düşməmiş usta → avtomatik refund."""
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "select o.id from opportunities_offers o"
                    " join opportunities opp on opp.id = o.opportunity_id"
                    " where o.status='accepted' and opp.status='accepted'"
                    "   and o.updated_at < now() - interval '30 minutes'"
                    " limit 100"
                )
            )
        ).all()
    done = 0
    for r in rows:
        async with SessionLocal() as db:
            try:
                await refund_offer(db, offer_id=r.id, caller_id=_SYSTEM_ID,
                                   caller_role=_SYSTEM_ROLE,
                                   reason="AUTO_REFUND_PROVIDER_NO_SHOW")
                await db.commit()
                done += 1
            except Exception:
                await db.rollback()
    return done


async def expire_stale_brigade_offers(threshold_seconds: int = 60) -> int:
    """Cavabsız briqada təyinatları vaxtı bitmiş sayılır."""
    async with SessionLocal() as db:
        rows = (
            await db.execute(
                text(
                    "update brigade_assignments set status='expired',"
                    " responded_at=now()"
                    " where status in ('offered','assigned') and assigned_by is null"
                    "   and assigned_at < now() - make_interval(secs => :s)"
                    " returning id"
                ),
                {"s": threshold_seconds},
            )
        ).all()
        await db.commit()
        return len(rows)


_JOBS = [
    (auto_release_completed_escrow, 300),   # 5 dəq
    (cancel_stale_pending, 600),            # 10 dəq
    (refund_no_show, 300),                  # 5 dəq
    (expire_stale_brigade_offers, 60),      # 1 dəq
]

_tasks: list[asyncio.Task] = []


async def _loop(fn, interval: int) -> None:
    while True:
        try:
            n = await fn()
            if n:
                log.info("%s: %s sətir", fn.__name__, n)
        except Exception as e:  # noqa: BLE001
            log.warning("%s xəta: %s", fn.__name__, e)
        await asyncio.sleep(interval)


def start_cron() -> None:
    for fn, interval in _JOBS:
        _tasks.append(asyncio.get_event_loop().create_task(_loop(fn, interval)))


def stop_cron() -> None:
    for t in _tasks:
        t.cancel()
    _tasks.clear()
