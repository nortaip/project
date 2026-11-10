"""(doldurulacaq) — bax app/compat/__init__.py"""
from fastapi import APIRouter

router = APIRouter()


async def start() -> None:
    """Tətbiq açılışında çağırılır (LISTEN dinləyicisi)."""


async def stop() -> None:
    """Tətbiq bağlananda çağırılır."""
