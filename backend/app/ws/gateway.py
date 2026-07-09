"""Realtime WebSocket gateway (Faza 5-də tam genişlənəcək).

Kanallar Redis pub/sub üzərindən yayımlanır — çox-instans miqyaslanma.
Auth: bağlantı zamanı access token yoxlanır; kanal abunəliyi RBAC-a tabedir
(məs. yalnız sifariş sahibi öz təklif kanalına qoşula bilər — Faza 5).
"""
from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.core.security import decode_token
from app.db.session import redis

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = "") -> None:
    # Token yoxlaması bağlantı anında
    try:
        payload = decode_token(token, "access")
        user_id = uuid.UUID(payload["sub"])
    except (JWTError, ValueError):
        await websocket.close(code=4401)  # unauthorized
        return

    await websocket.accept()
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"user:{user_id}")

    async def reader() -> None:
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                await websocket.send_text(msg["data"])

    task = asyncio.create_task(reader())
    try:
        while True:
            # Klientdən ping/subscribe mesajları (Faza 5-də kanal idarəsi)
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        await pubsub.unsubscribe()
        await pubsub.aclose()
