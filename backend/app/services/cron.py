"""Dövri (cron) işlər — Supabase-dəki scheduled funksiyaların portu.

main.py lifespan-da `start_cron()` ilə işə düşür; hər işin öz intervalı
var, xətalar udulur (növbəti dövrədə təkrar cəhd). Gündəlik işlər
(`_DAILY_JOBS`) isə sabit UTC saatında işləyir (pg_cron '0 3 * * *' kimi).
"""
from __future__ import annotations

import asyncio
import logging
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text

from app.db.session import SessionLocal
from app.services.money import release_offer, refund_offer, MoneyError
from app.services.notify import (
    dispatch_all, notify_offer_refunded, notify_offer_released,
)

log = logging.getLogger("cron")

_SYSTEM_ROLE = "system"   # money.* bu rolu dövri iş kimi tanıyır
_SYSTEM_ID = None         # ledger-də created_by boş qalır (insan aktyor yoxdur)


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
                res = await release_offer(db, offer_id=r.id, caller_id=_SYSTEM_ID,
                                          caller_role=_SYSTEM_ROLE)
                # Provayderə bildiriş (offer status trigger portu)
                notices = await notify_offer_released(
                    db, offer_id=r.id, method=res["method"],
                    released=res["released"])
                await db.commit()
                dispatch_all(notices)
                done += 1
            except MoneyError as e:
                await db.rollback()
                log.warning("auto-release ötürüldü (offer %s): %s", r.id, e)
            except Exception:
                await db.rollback()
                log.exception("auto-release xətası (offer %s)", r.id)
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
                res = await refund_offer(db, offer_id=r.id, caller_id=_SYSTEM_ID,
                                         caller_role=_SYSTEM_ROLE,
                                         reason="AUTO_REFUND_PROVIDER_NO_SHOW")
                # Provayderə və müştəriyə bildiriş
                notices = []
                if not res.get("already_refunded"):
                    notices = await notify_offer_refunded(
                        db, offer_id=r.id,
                        refunded_amount=res["refunded_amount"])
                await db.commit()
                dispatch_all(notices)
                done += 1
            except MoneyError as e:
                await db.rollback()
                log.warning("no-show refund ötürüldü (offer %s): %s", r.id, e)
            except Exception:
                await db.rollback()
                log.exception("no-show refund xətası (offer %s)", r.id)
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


# Abşeron yarımadası — quru sahələr (dəniz/göl deyil, faktiki yaşayış yerləri).
# refresh_bot_locations SQL funksiyasındakı v_coords massivi ilə eynidir.
_ABSHERON_COORDS: tuple[tuple[float, float], ...] = (
    # Bakı şəhər
    (40.4082, 49.8531),  # Bakı mərkəz (Fəvvarələr meydanı)
    (40.3953, 49.8127),  # Yasamal
    (40.3805, 49.8590),  # Səbail (28 May)
    (40.4514, 49.8014),  # Binəqədi
    (40.4127, 49.8636),  # Nərimanov
    (40.4015, 49.9095),  # Nizami
    (40.4577, 49.9617),  # Sabunçu
    (40.4093, 49.9742),  # Suraxanı
    (40.3892, 49.9531),  # Xətai
    (40.4262, 49.8918),  # Nəsimi (Akademiya)
    # Abşeron qəsəbələri
    (40.5215, 49.9890),  # Maştağa
    (40.5078, 50.0913),  # Buzovna
    (40.4861, 50.1480),  # Mərdəkan
    (40.5410, 50.1467),  # Şüvəlan
    (40.5630, 50.0260),  # Bilgəh
    (40.5810, 49.9020),  # Pirşağa
    (40.4520, 49.9650),  # Nardaran
    (40.4350, 49.9450),  # Bakıxanov
    # Cənub və qərb
    (40.5896, 49.6685),  # Sumqayıt
    (40.3927, 49.7530),  # Lökbatan
    (40.3650, 49.6300),  # Qaradağ (Sahil)
    (40.4950, 49.7240),  # Mehdiabad
)
_BOT_EMAIL_PATTERN = "bot_provider_%@ellit.bot"
_BOT_OFFSET = 0.008          # (random() - 0.5) * 0.008 → ±0.004° ≈ 400 m


async def refresh_bot_locations() -> int:
    """Bot provayderlərin koordinatlarını Abşeron üzrə təsadüfi yeniləyir
    (refresh_bot_locations pg_cron işinin portu — hər gün 03:00 UTC).

    Hər bot üçün: təsadüfi baza nöqtəsi + kiçik offset (şəhər daxili),
    is_online = true, last_seen_at = now(). Adi provayderlərə toxunmur.
    """
    async with SessionLocal() as db:
        bots = (
            await db.execute(
                text("select id from profiles where email like :pat"),
                {"pat": _BOT_EMAIL_PATTERN},
            )
        ).all()
        for b in bots:
            lat, lng = random.choice(_ABSHERON_COORDS)
            await db.execute(
                text(
                    "update profiles set latitude = :lat, longitude = :lng,"
                    " is_online = true, last_seen_at = now() where id = :id"
                ),
                {"lat": lat + (random.random() - 0.5) * _BOT_OFFSET,
                 "lng": lng + (random.random() - 0.5) * _BOT_OFFSET,
                 "id": b.id},
            )
        await db.commit()
        return len(bots)


_JOBS = [
    (auto_release_completed_escrow, 300),   # 5 dəq
    (cancel_stale_pending, 600),            # 10 dəq
    (refund_no_show, 300),                  # 5 dəq
    (expire_stale_brigade_offers, 60),      # 1 dəq
]

# Gündəlik işlər: (funksiya, saat, dəqiqə) — UTC
_DAILY_JOBS = [
    (refresh_bot_locations, 3, 0),          # hər gün 03:00 UTC (Bakı 07:00)
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


def _seconds_until(hour: int, minute: int, now: datetime | None = None) -> float:
    """Növbəti HH:MM (UTC) anına qədər qalan saniyələr."""
    now = now or datetime.now(timezone.utc)
    nxt = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if nxt <= now:
        nxt += timedelta(days=1)
    return (nxt - now).total_seconds()


async def _daily_loop(fn, hour: int, minute: int) -> None:
    while True:
        await asyncio.sleep(_seconds_until(hour, minute))
        try:
            n = await fn()
            if n:
                log.info("%s: %s sətir", fn.__name__, n)
        except Exception as e:  # noqa: BLE001
            log.warning("%s xəta: %s", fn.__name__, e)
        # Saat sürüşməsi səbəbindən eyni dəqiqədə ikinci dəfə işləməsin
        await asyncio.sleep(61)


def start_cron() -> None:
    for fn, interval in _JOBS:
        _tasks.append(asyncio.get_event_loop().create_task(_loop(fn, interval)))
    for fn, hour, minute in _DAILY_JOBS:
        _tasks.append(
            asyncio.get_event_loop().create_task(_daily_loop(fn, hour, minute)))


def stop_cron() -> None:
    for t in _tasks:
        t.cancel()
    _tasks.clear()
