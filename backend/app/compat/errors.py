"""PostgREST formatında xətalar: {code, details, hint, message}."""
from __future__ import annotations

from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str,
                 details: str | None = None, hint: str | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.details, self.hint = details, hint

    def response(self) -> JSONResponse:
        return JSONResponse(
            status_code=self.status,
            content={"code": self.code, "details": self.details,
                     "hint": self.hint, "message": self.message},
        )


class RpcError(ApiError):
    """RPC daxilində `raise exception '...'` qarşılığı (SQLSTATE P0001 → 400)."""

    def __init__(self, message: str, code: str = "P0001", status: int = 400,
                 details: str | None = None, hint: str | None = None) -> None:
        super().__init__(status, code, message, details, hint)


# SQLSTATE → HTTP status (PostgREST ilə eyni xəritə)
def status_for_sqlstate(state: str, authenticated: bool) -> int:
    if state == "42501":
        return 403 if authenticated else 401
    if state in ("23505", "23503"):
        return 409
    if state in ("42P01", "42883"):
        return 404
    if state.startswith(("22", "23", "42")) or state in ("P0001",):
        return 400
    if state.startswith("P0"):
        return 400
    if state == "57014":
        return 500
    return 500


def from_pg(exc: BaseException, authenticated: bool) -> ApiError:
    """asyncpg.PostgresError → ApiError."""
    state = getattr(exc, "sqlstate", None) or "XX000"
    return ApiError(
        status_for_sqlstate(state, authenticated), state,
        getattr(exc, "message", None) or str(exc),
        getattr(exc, "detail", None), getattr(exc, "hint", None),
    )
