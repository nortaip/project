"""Async SQLAlchemy sessiyası + Redis bağlantısı."""
from collections.abc import AsyncGenerator

import redis.asyncio as aioredis
from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.core.config import settings
from app.db.tunnel import resolve_database_url

# SSH_HOST verilibsə burada tunel açılır və DSN lokal tunel ucuna yönəlir
engine = create_async_engine(
    resolve_database_url(),
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# ── Aktyor konteksti (Supabase-dəki auth.uid() əvəzi) ───────────
# Bazadakı audit trigger-ləri "kim etdi?" sualını `app.user_id` sessiya
# dəyişənindən oxuyur. Dəyər tranzaksiya-lokaldır (set_config(..., true)) —
# pool-dakı bağlantı növbəti sorğuya başqasının kimliyi ilə keçə bilməz.
_ACTOR_SQL = text("select set_config('app.user_id', :uid, true)")


@event.listens_for(Session, "after_begin")
def _apply_actor(session, transaction, connection) -> None:  # noqa: ANN001
    actor = session.info.get("actor_id")
    if actor:
        connection.execute(_ACTOR_SQL, {"uid": str(actor)})


async def set_actor(db: AsyncSession, user_id) -> None:
    """Sessiyanın aktyorunu təyin edir: cari tranzaksiyaya dərhal, sonrakı
    tranzaksiyalara isə after_begin hook-u ilə avtomatik tətbiq olunur."""
    db.info["actor_id"] = str(user_id)
    await db.execute(_ACTOR_SQL, {"uid": str(user_id)})

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
