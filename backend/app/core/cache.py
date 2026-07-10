"""Redis keş qatı — fail-open dizayn.

Prinsip: keş SÜRƏTLƏNDİRİCİDİR, asılılıq deyil. Redis əlçatmazdırsa
loader (DB) birbaşa çağırılır — istifadəçi yalnız keşsiz sürət görür,
xəta görmür. Bütün Redis əmrləri pool-un socket_timeout-u ilə məhdudlaşır.

İstifadə:
    data = await cached("cat:list", 300, lambda: _load_categories(db))
    await invalidate("cat:list")            # yazı əməliyyatından sonra
"""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from typing import Any

from app.db.session import redis

_PREFIX = "cache:"


async def cached(
    key: str, ttl: int, loader: Callable[[], Awaitable[Any]]
) -> Any:
    """Keşdən oxu; yoxdursa loader-i çağır və nəticəni saxla."""
    full = _PREFIX + key
    try:
        hit = await redis.get(full)
        if hit is not None:
            return json.loads(hit)
    except Exception:
        pass  # Redis problemi → birbaşa DB
    data = await loader()
    try:
        await redis.setex(full, ttl, json.dumps(data, default=str))
    except Exception:
        pass
    return data


async def invalidate(*keys: str) -> None:
    try:
        await redis.delete(*[_PREFIX + k for k in keys])
    except Exception:
        pass


async def invalidate_prefix(prefix: str) -> None:
    """Prefiks üzrə təmizləmə (məs. 'online:' bütün radius variantları)."""
    try:
        cursor = 0
        while True:
            cursor, keys = await redis.scan(
                cursor=cursor, match=_PREFIX + prefix + "*", count=200
            )
            if keys:
                await redis.delete(*keys)
            if cursor == 0:
                break
    except Exception:
        pass
