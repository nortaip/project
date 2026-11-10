"""PostgREST-uyğun /rest/v1 — cədvəl sorğuları (RLS altında) və RPC-lər."""
from __future__ import annotations

import datetime as dt
import decimal
import json
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.compat import rpc as rpc_registry
from app.compat.context import get_caller
from app.compat.errors import ApiError
from app.db.session import get_db, set_actor

router = APIRouter(tags=["compat-rest"])


def _json_default(o: Any) -> Any:
    if isinstance(o, decimal.Decimal):
        # PostgREST numeric-i JSON ədədi kimi verir
        return int(o) if o == o.to_integral_value() and o.as_tuple().exponent >= 0 else float(o)
    if isinstance(o, (uuid.UUID,)):
        return str(o)
    if isinstance(o, (dt.datetime, dt.date, dt.time)):
        return o.isoformat()
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if hasattr(o, "_asdict"):
        return o._asdict()
    if hasattr(o, "_mapping"):
        return dict(o._mapping)
    raise TypeError(f"JSON-a çevrilmir: {type(o).__name__}")


def dumps(value: Any) -> str:
    return json.dumps(value, default=_json_default, ensure_ascii=False)


def json_response(value: Any, status: int = 200, headers: dict | None = None) -> Response:
    return Response(content=dumps(value), status_code=status,
                    media_type="application/json", headers=headers)


# ── RPC ───────────────────────────────────────────────────────────
@router.api_route("/rpc/{name}", methods=["POST", "GET"])
async def call_rpc(name: str, request: Request, db: AsyncSession = Depends(get_db)) -> Response:
    try:
        caller = get_caller(request)
        if request.method == "GET":
            args: dict = dict(request.query_params)
        else:
            raw = await request.body()
            try:
                args = json.loads(raw) if raw.strip() else {}
            except ValueError as e:
                raise ApiError(400, "PGRST102", "Sorğu gövdəsi düzgün JSON deyil") from e
            if not isinstance(args, dict):
                raise ApiError(400, "PGRST102", "RPC arqumentləri JSON obyekti olmalıdır")
        if caller.user_id is not None:
            await set_actor(db, caller.user_id)   # audit trigger-ləri üçün aktyor
        result = await rpc_registry.call(name, args, db, caller)
    except ApiError as e:
        await db.rollback()
        return e.response()
    if result is None:
        return Response(status_code=204)
    return json_response(result)


# RPC handler modulları (qeydiyyat import zamanı baş verir)
from app.compat import rpc_admin, rpc_brigade, rpc_core, rpc_misc  # noqa: E402, F401

# Cədvəl sorğuları (/rest/v1/<cədvəl>) — RLS altında
from app.compat.tables import router as _tables_router  # noqa: E402

router.include_router(_tables_router)
