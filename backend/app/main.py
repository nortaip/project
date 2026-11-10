"""Ellit API — giriş nöqtəsi.

Təhlükəsizlik qatları (Faza 7-də genişlənəcək):
  - Redis-əsaslı rate limiting (IP başına; auth endpointlərində sərt)
  - OWASP təhlükəsizlik başlıqları
  - Sərt CORS (yalnız icazəli origin-lər)
  - Bütün input Pydantic ilə validasiya olunur (SQLAlchemy → injection-safe)
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.auth import router as auth_router
from app.api.v1.brigades import router as brigades_router
from app.api.v1.chat import router as chat_router
from app.api.v1.kyc import router as kyc_router
from app.api.v1.admin import router as admin_router
from app.api.v1.notifications import router as notifications_router
from app.api.v1.password import router as password_router
from app.api.v1.payments import router as payments_router
from app.api.v1.bookings import router as bookings_router
from app.api.v1.storage import router as storage_router
from app.api.v1.disputes import router as disputes_router
from app.api.v1.withdrawals import router as withdrawals_router
from app.api.v1.catalog import router as catalog_router
from app.api.v1.offers import router as offers_router
from app.api.v1.opportunities import router as opportunities_router
from app.api.v1.profiles import router as profiles_router
from app.core.config import settings
from app.db.session import engine, redis
from app.db.tunnel import close_tunnel
from app.ws.gateway import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dövri işlər (auto-release, stale cancel, no-show refund, expire)
    if settings.CRON_ENABLED:
        from app.services.cron import start_cron, stop_cron
        start_cron()
    yield
    if settings.CRON_ENABLED:
        stop_cron()
    await redis.aclose()
    await engine.dispose()
    close_tunnel()


app = FastAPI(
    title=settings.APP_NAME,
    docs_url="/docs" if settings.ENV != "production" else None,
    redoc_url=None,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Rate limiting (Redis sliding window) ─────────────────────────
def _parse_limit(spec: str) -> tuple[int, int]:
    count, _, period = spec.partition("/")
    seconds = {"second": 1, "minute": 60, "hour": 3600}[period.strip()]
    return int(count), seconds


_DEFAULT_LIMIT = _parse_limit(settings.RATE_LIMIT_DEFAULT)
_AUTH_LIMIT = _parse_limit(settings.RATE_LIMIT_AUTH)
_AUTH_PATHS = (
    "/auth/login", "/auth/register", "/auth/google", "/auth/apple",
    "/auth/password-reset/request", "/auth/password-reset/email",
    "/auth/password-reset/confirm", "/auth/password-change/confirm",
)


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    is_auth = any(request.url.path.endswith(p) for p in _AUTH_PATHS)
    count, window = _AUTH_LIMIT if is_auth else _DEFAULT_LIMIT
    bucket = f"rl:{'auth' if is_auth else 'gen'}:{ip}:{int(time.time()) // window}"
    try:
        # 500ms qapaq: Redis yavaşlayıbsa sorğu onun arxasında GÖZLƏMİR —
        # limit yoxlaması ötürülür (fail-open), istifadəçi ləngimə görmür
        current = await asyncio.wait_for(redis.incr(bucket), timeout=0.5)
        if current == 1:
            await asyncio.wait_for(redis.expire(bucket, window), timeout=0.5)
        if current > count:
            return JSONResponse(
                status_code=429,
                content={"detail": "Çox sorğu — bir az sonra yenidən cəhd edin"},
            )
    except (asyncio.TimeoutError, Exception):
        pass  # Redis əlçatmazdırsa API dayanmasın (fail-open)
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp: Response = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    # API cavabları keşlənmir; fayl marşrutları öz Cache-Control-unu verir
    resp.headers.setdefault("Cache-Control", "no-store")
    return resp


# ── Routerlər ─────────────────────────────────────────────────────
app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(password_router, prefix=settings.API_V1_PREFIX)
app.include_router(catalog_router, prefix=settings.API_V1_PREFIX)
app.include_router(profiles_router, prefix=settings.API_V1_PREFIX)
app.include_router(opportunities_router, prefix=settings.API_V1_PREFIX)
app.include_router(offers_router, prefix=settings.API_V1_PREFIX)
app.include_router(brigades_router, prefix=settings.API_V1_PREFIX)
app.include_router(kyc_router, prefix=settings.API_V1_PREFIX)
app.include_router(chat_router, prefix=settings.API_V1_PREFIX)
app.include_router(notifications_router, prefix=settings.API_V1_PREFIX)
app.include_router(payments_router, prefix=settings.API_V1_PREFIX)
app.include_router(bookings_router, prefix=settings.API_V1_PREFIX)
app.include_router(storage_router, prefix=settings.API_V1_PREFIX)
app.include_router(disputes_router, prefix=settings.API_V1_PREFIX)
app.include_router(withdrawals_router, prefix=settings.API_V1_PREFIX)
app.include_router(admin_router, prefix=settings.API_V1_PREFIX)
app.include_router(ws_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "env": settings.ENV}
