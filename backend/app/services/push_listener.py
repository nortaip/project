"""Push növbəsi: notifications-a düşən hər sətir FCM ilə göndərilir.

db/notify_triggers.sql → `pg_notify('ellit_push', <notification id>)`. Bu
dinləyici yalnız worker prosesində (tək nüsxə) işləyir ki, push ikiqat
getməsin. Bağlantı qopsa yenidən qoşulur və qopma müddətində yaranan
bildirişləri də göndərir.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

import asyncpg

from app.compat.realtime import _connect_kwargs
from app.services.push import send_notification_push

log = logging.getLogger("ellit.push")
CHANNEL = "ellit_push"
_sent: dict[str, float] = {}   # son göndərilənlər (təkrar göndərməsin)
_SENT_TTL = 600.0


def _remember(nid: str) -> bool:
    """True — ilk dəfədir; False — artıq göndərilib."""
    now = asyncio.get_running_loop().time()
    for k in [k for k, t in _sent.items() if now - t > _SENT_TTL]:
        _sent.pop(k, None)
    if nid in _sent:
        return False
    _sent[nid] = now
    return True


async def _worker(queue: asyncio.Queue[str]) -> None:
    while True:
        nid = await queue.get()
        if not _remember(nid):
            continue
        try:
            await send_notification_push(nid)
        except Exception as e:  # noqa: BLE001
            log.warning("push %s göndərilmədi: %s", nid, e)


async def _catch_up(conn: asyncpg.Connection, queue: asyncio.Queue[str],
                    since: datetime) -> None:
    rows = await conn.fetch(
        "select id::text from notifications where created_at >= $1 order by created_at", since)
    for r in rows:
        queue.put_nowait(r["id"])


async def run_forever() -> None:
    queue: asyncio.Queue[str] = asyncio.Queue(maxsize=10000)
    workers = [asyncio.create_task(_worker(queue)) for _ in range(4)]
    backoff = 1.0
    alive_at: datetime | None = None   # bağlantının son sağlam anı
    try:
        while True:
            conn: asyncpg.Connection | None = None
            try:
                conn = await asyncpg.connect(**_connect_kwargs(), timeout=10)
                lost = asyncio.Event()
                conn.add_termination_listener(lambda _c: lost.set())

                def _on(_c, _pid, _ch, payload: str) -> None:
                    try:
                        queue.put_nowait(payload)
                    except asyncio.QueueFull:
                        log.error("push növbəsi dolub — bildiriş ötürüldü")

                await conn.add_listener(CHANNEL, _on)
                if alive_at is not None:
                    # qopma müddətində yaranan bildirişlər (təkrarı _remember tutur)
                    await _catch_up(conn, queue, alive_at - timedelta(seconds=5))
                backoff = 1.0
                log.info("push: LISTEN %s aktivdir", CHANNEL)
                while not lost.is_set():
                    alive_at = datetime.now(timezone.utc)
                    try:
                        await asyncio.wait_for(lost.wait(), 30)
                    except asyncio.TimeoutError:
                        await asyncio.wait_for(conn.execute("select 1"), 10)
                log.warning("push: dinləyici bağlantısı qopdu")
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                log.warning("push: dinləyici xətası (%s) — %ss sonra", e, backoff)
            finally:
                if conn is not None:
                    try:
                        await asyncio.wait_for(conn.close(), 5)
                    except BaseException:  # noqa: BLE001
                        conn.terminate()
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)
    finally:
        for w in workers:
            w.cancel()
