"""Async SQLAlchemy sessiyası + Redis bağlantısı."""
from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── Redis: pool + sərt timeout-lar ──────────────────────────────
# Prinsip: Redis yavaşlasa/dursa API sorğuları ONUN ARXASINDA DONMUR —
# hər əmr max ~3s gözləyir, sonra xəta atır və çağıran fail-open davranır.
#   max_connections   — pool limiti (hər WS pubsub + API əmrləri buradan)
#   socket_timeout    — cavab gözləmə limiti (donmuş soketə qarşı)
#   health_check_interval — ölü bağlantılar avtomatik təzələnir
redis_pool = aioredis.ConnectionPool.from_url(
    settings.REDIS_URL,
    decode_responses=True,
    max_connections=settings.REDIS_MAX_CONNECTIONS,
    socket_connect_timeout=2,
    socket_timeout=3,
    socket_keepalive=True,
    health_check_interval=30,
    retry_on_timeout=True,
)
redis = aioredis.Redis(connection_pool=redis_pool)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
