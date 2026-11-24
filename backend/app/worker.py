"""Dövri işlər prosesi (cron) — API-dən AYRI işləyir.

API bir neçə worker ilə qalxır; dövri işlər (escrow-un avtomatik açılması,
köhnəlmiş sifarişlərin ləğvi, no-show refund, bot məkanları) və push növbəsi
hər worker-də işləsəydi eyni iş (və eyni push) bir neçə dəfə görülərdi. Ona görə API-də CRON_ENABLED=false,
bu proses isə tək nüsxədə işləyir:

    python -m app.worker
"""
from __future__ import annotations

import asyncio
import logging
import signal

from app.core import dblog
from app.db.session import engine, redis
from app.db.tunnel import close_tunnel
from app.services import push_listener
from app.services.cron import start_cron, stop_cron

log = logging.getLogger("ellit.worker")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    dblog.install("worker")          # admin panel → Server jurnalı
    start_cron()
    # Push növbəsi: hər yeni bildiriş FCM ilə (tək nüsxə — yalnız worker-də)
    push_task = asyncio.create_task(push_listener.run_forever())
    log.info("Dövri işlər və push növbəsi başladı")
    await stop.wait()
    log.info("Dayandırılır…")
    stop_cron()
    push_task.cancel()
    await dblog.stop()
    await redis.aclose()
    await engine.dispose()
    close_tunnel()


if __name__ == "__main__":
    asyncio.run(main())
