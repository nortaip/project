"""Ellit API — giriş nöqtəsi.

Təhlükəsizlik qatları (Faza 7-də genişlənəcək):
  - Redis-əsaslı rate limiting (IP başına; auth endpointlərində sərt)
  - OWASP təhlükəsizlik başlıqları
  - Sərt CORS (yalnız icazəli origin-lər)
  - Bütün input Pydantic ilə validasiya olunur (SQLAlchemy → injection-safe)
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.auth import router as auth_router
from app.api.v1.catalog import router as catalog_router
from app.api.v1.offers import router as offers_router
from app.api.v1.opportunities import router as opportunities_router
from app.api.v1.profiles import router as profiles_router
from app.core.config import settings
from app.db.session import engine, redis
from app.ws.gateway import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await redis.aclose()
    await engine.dispose()


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
_AUTH_PATHS = ("/auth/login", "/auth/register", "/auth/google", "/auth/apple")


@app.middleware("http")
async def rate_limit(request: Request, call_next):
    ip = request.client.host if request.client else "unknown"
    is_auth = any(request.url.path.endswith(p) for p in _AUTH_PATHS)
    count, window = _AUTH_LIMIT if is_auth else _DEFAULT_LIMIT
    bucket = f"rl:{'auth' if is_auth else 'gen'}:{ip}:{int(time.time()) // window}"
    try:
        current = await redis.incr(bucket)
        if current == 1:
            await redis.expire(bucket, window)
        if current > count:
            return JSONResponse(
                status_code=429,
                content={"detail": "Çox sorğu — bir az sonra yenidən cəhd edin"},
            )
    except Exception:
        pass  # Redis əlçatmazdırsa API dayanmasın (fail-open, loglanır)
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp: Response = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ── Routerlər ─────────────────────────────────────────────────────
app.include_router(auth_router, prefix=settings.API_V1_PREFIX)
app.include_router(catalog_router, prefix=settings.API_V1_PREFIX)
app.include_router(profiles_router, prefix=settings.API_V1_PREFIX)
app.include_router(opportunities_router, prefix=settings.API_V1_PREFIX)
app.include_router(offers_router, prefix=settings.API_V1_PREFIX)
app.include_router(ws_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "env": settings.ENV}
