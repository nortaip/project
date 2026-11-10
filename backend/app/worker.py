"""Dövri işlər prosesi (cron) — API-dən AYRI işləyir.

API bir neçə worker ilə qalxır; dövri işlər (escrow-un avtomatik açılması,
köhnəlmiş sifarişlərin ləğvi, no-show refund, bot məkanları) hər worker-də
işləsəydi eyni iş bir neçə dəfə görülərdi. Ona görə API-də CRON_ENABLED=false,
bu proses isə tək nüsxədə işləyir:

    python -m app.worker
"""
from __future__ import annotations

import asyncio
import logging
import signal

from app.db.session import engine, redis
from app.db.tunnel import close_tunnel
from app.services.cron import start_cron, stop_cron

log = logging.getLogger("ellit.worker")


async def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    start_cron()
    log.info("Dövri işlər başladı")
    await stop.wait()
    log.info("Dayandırılır…")
    stop_cron()
    await redis.aclose()
    await engine.dispose()
    close_tunnel()


if __name__ == "__main__":
    asyncio.run(main())
