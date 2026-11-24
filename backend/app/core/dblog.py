"""Server jurnalı: loq qeydləri `server_logs` cədvəlinə yazılır və admin
panelində (Administrator → Server jurnalı) görünür.

  * API və worker prosesləri öz qeydlərini yazır (`source` = api | worker);
  * yazı növbə + toplu INSERT ilə (2 s-də bir) — sorğuları ləngitmir;
    baza əlçatmaz olsa qeydlər atılır (API dayanmır, loq döngüsü yaranmır);
  * səviyyə: tətbiqin öz loqları (ellit.*, cron, …) INFO-dan, kitabxanalar
    yalnız WARNING-dən;
  * köhnə qeydləri worker gündə bir dəfə silir (LOG_RETENTION_DAYS).

Sirr yazılmır: HTTP qeydində yalnız metod, yol (query-siz), status, müddət,
istifadəçi ID-si və IP; gövdə və başlıqlar yazılmır.
"""
from __future__ import annotations

import asyncio
import json
import logging
import queue
import sys
import traceback

from sqlalchemy import text

# Tətbiqin öz loqları (INFO-dan yazılır)
APP_LOGGERS = ("ellit", "cron", "opportunities", "app")
# Səs-küylü kitabxanalar — yalnız WARNING-dən
_LIB_PREFIXES = ("sqlalchemy", "asyncpg", "httpx", "httpcore", "uvicorn.access",
                 "watchfiles", "multipart", "urllib3", "google", "firebase_admin",
                 "hpack", "passlib")

_MAX_PENDING = 5000
_BATCH = 500
_q: "queue.SimpleQueue[tuple]" = queue.SimpleQueue()
_source = "api"
_task: asyncio.Task | None = None
_handler: logging.Handler | None = None


class DbLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # noqa: D401
        try:
            if record.levelno < logging.WARNING and record.name.startswith(_LIB_PREFIXES):
                return
            if _q.qsize() >= _MAX_PENDING:
                return
            ctx = getattr(record, "ctx", None)
            ctx = dict(ctx) if isinstance(ctx, dict) else {}
            if record.exc_info:
                ctx["traceback"] = "".join(
                    traceback.format_exception(*record.exc_info))[-4000:]
            _q.put((record.created, record.levelname, _source, record.name,
                    record.getMessage()[:2000], ctx or None))
        except Exception:  # noqa: BLE001 — loq yazısı heç vaxt xəta atmamalıdır
            pass


def install(source: str) -> None:
    """Prosesin başlanğıcında (işləyən event loop daxilində) çağırılır."""
    global _source, _task, _handler
    _source = source
    if _handler is None:
        _handler = DbLogHandler(level=logging.INFO)
        logging.getLogger().addHandler(_handler)
        # Tətbiq loqları INFO-dan (kök logger WARNING qalır — kitabxanalar səs salmasın)
        for name in APP_LOGGERS:
            logging.getLogger(name).setLevel(logging.INFO)
        # uvicorn öz xətalarını (gözlənilməz istisnalar) kök loqa ötürmür
        logging.getLogger("uvicorn.error").addHandler(DbLogHandler(level=logging.WARNING))
    if _task is None or _task.done():
        _task = asyncio.create_task(_flush_loop())


async def stop() -> None:
    """Dayanma: qalan qeydləri yaz."""
    global _task
    if _task is not None:
        _task.cancel()
        _task = None
    await flush()


async def _flush_loop() -> None:
    while True:
        await asyncio.sleep(2)
        await flush()


async def flush() -> int:
    """Növbədəki qeydləri bazaya yazır; yazılanların sayını qaytarır."""
    rows = []
    while len(rows) < _BATCH:
        try:
            rows.append(_q.get_nowait())
        except queue.Empty:
            break
    if not rows:
        return 0
    from app.db.session import engine

    try:
        async with engine.begin() as conn:
            await conn.execute(
                text("insert into server_logs (created_at, level, source, logger, message,"
                     " context) values (to_timestamp(:t), :l, :s, :g, :m, cast(:c as jsonb))"),
                [{"t": t, "l": lvl, "s": src, "g": name, "m": msg,
                  "c": json.dumps(ctx, ensure_ascii=False, default=str) if ctx else None}
                 for (t, lvl, src, name, msg, ctx) in rows],
            )
    except Exception as e:  # noqa: BLE001 — loq üçün loq yazmırıq (döngü olmasın)
        print(f"[dblog] {len(rows)} qeyd yazılmadı: {e}", file=sys.stderr)
        return 0
    return len(rows)
