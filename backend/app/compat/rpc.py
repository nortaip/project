"""RPC reyestri: /rest/v1/rpc/<ad> → Python funksiyası.

Köhnə Supabase SQL funksiyalarının hər biri üçün eyni adlı, eyni arqumentli
və eyni formada cavab qaytaran Python handler qeydiyyatdan keçir:

    @rpc("place_bid")
    async def place_bid(ctx: RpcContext, p_opportunity_id: str, p_amount: float, ...):
        ...
        return {"ok": True, ...}        # SQL funksiyasının qaytardığı forma

Qaydalar:
  * Arqument adları klientin göndərdiyi adlardır (p_...). Defoltu olmayan
    arqument verilməyibsə PGRST202 (funksiya tapılmadı) qaytarılır.
  * `anon=True` — giriş etməmiş istifadəçi də çağıra bilər.
  * `admin=True` — yalnız admin/master/superadmin.
  * Xəta: `raise RpcError("MESAJ")` → {code:'P0001', message:'MESAJ'} (400).
  * `ctx.db` — adi AsyncSession (servis hüquqları, RLS YOX): icazə yoxlamasını
    handler/servis özü edir. Commit handler-in öhdəsindədir.
  * Qaytarılan dəyər JSON-a çevrilir (Decimal/UUID/datetime dəstəklənir);
    None → 204 (SQL `returns void`).
"""
from __future__ import annotations

import inspect
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.compat.context import Caller
from app.compat.errors import ApiError


@dataclass
class RpcContext:
    db: AsyncSession
    caller: Caller

    @property
    def user_id(self) -> uuid.UUID | None:
        return self.caller.user_id

    @property
    def role(self) -> str:
        """Tətbiq rolu (customer/provider/admin...); anonim üçün 'anon'."""
        return self.caller.app_role or "anon"

    @property
    def is_admin(self) -> bool:
        return self.caller.is_admin

    def require_user(self) -> uuid.UUID:
        if self.caller.user_id is None:
            raise ApiError(401, "PGRST301", "Giriş tələb olunur")
        return self.caller.user_id


@dataclass
class _Entry:
    fn: Callable[..., Awaitable[Any]]
    anon: bool
    admin: bool
    params: dict[str, inspect.Parameter]


_REGISTRY: dict[str, _Entry] = {}


def rpc(name: str, *, anon: bool = False, admin: bool = False):
    def deco(fn: Callable[..., Awaitable[Any]]):
        params = dict(list(inspect.signature(fn).parameters.items())[1:])  # ctx-dən sonrakılar
        _REGISTRY[name] = _Entry(fn=fn, anon=anon, admin=admin, params=params)
        return fn
    return deco


def registered() -> list[str]:
    return sorted(_REGISTRY)


def _not_found(name: str, args: dict) -> ApiError:
    sig = ", ".join(sorted(args)) or ""
    return ApiError(
        404, "PGRST202",
        f"Could not find the function public.{name}({sig}) in the schema cache",
        hint="RPC bu backend-də qeydiyyatda deyil və ya arqumentlər uyğun gəlmir",
    )


async def call(name: str, args: dict, db: AsyncSession, caller: Caller) -> Any:
    entry = _REGISTRY.get(name)
    if entry is None:
        raise _not_found(name, args)
    if not entry.anon and not caller.authenticated:
        raise ApiError(401, "42501", f"permission denied for function {name}")
    if entry.admin and not caller.is_admin:
        raise ApiError(403, "42501", f"permission denied for function {name}")
    unknown = set(args) - set(entry.params)
    missing = [n for n, p in entry.params.items()
               if p.default is inspect.Parameter.empty and n not in args]
    if unknown or missing:
        raise _not_found(name, args)
    return await entry.fn(RpcContext(db=db, caller=caller), **args)
