"""Realtime WebSocket gateway — kanallar + presence (onlayn ustalar).

Protokol (klient → server):
    {"action": "ping"}                         → {"event":"pong"}
    {"action": "presence", "online": true}     → provayder onlayn/oflayn
    {"action": "location", "lat": .., "lng":..}→ canlı yer yeniləməsi

Server → klient: services/realtime.publish() ilə göndərilən bütün
hadisələr ({"event": "...", "payload": {...}, "ts": "..."}).

Presence: bağlantı açılanda provayder avtomatik onlayn olur,
bağlantı qopanda (bütün cihazlar) oflayn — Redis sayğacı ilə.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from jose import JWTError
from sqlalchemy import text

from app.core.security import decode_token
from app.db.session import SessionLocal, redis

router = APIRouter()


async def _set_presence(user_id: uuid.UUID, online: bool) -> None:
    async with SessionLocal() as db:
        await db.execute(
            text(
                "update profiles set is_online = :o,"
                " availability_status = case when :o then 'online' else 'offline' end,"
                " last_seen_at = now() where id = :u"
            ),
            {"o": online, "u": user_id},
        )
        # Komanda üzvlüyü varsa orada da əks olunsun
        await db.execute(
            text(
                "update brigade_members set is_online = :o, last_heartbeat = now()"
                " where profile_id = :u"
            ),
            {"o": online, "u": user_id},
        )
        await db.commit()


async def _update_location(user_id: uuid.UUID, lat: float, lng: float) -> None:
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return
    async with SessionLocal() as db:
        await db.execute(
            text(
                "update profiles set latitude=:la, longitude=:lo, last_seen_at=now()"
                " where id=:u"
            ),
            {"la": lat, "lo": lng, "u": user_id},
        )
        await db.commit()


@router.websocket("/ws")
async def ws_endpoint(websocket: WebSocket, token: str = "") -> None:
    try:
        payload = decode_token(token, "access")
        user_id = uuid.UUID(payload["sub"])
        role = payload.get("role", "customer")
    except (JWTError, ValueError):
        await websocket.close(code=4401)
        return

    await websocket.accept()

    # Presence: bu istifadəçinin aktiv bağlantı sayı (çox cihaz dəstəyi)
    conn_key = f"presence:{user_id}"
    conns = await redis.incr(conn_key)
    await redis.expire(conn_key, 3600)
    if conns == 1 and role == "provider":
        await _set_presence(user_id, True)

    pubsub = redis.pubsub()
    await pubsub.subscribe(f"user:{user_id}")

    async def reader() -> None:
        async for msg in pubsub.listen():
            if msg["type"] == "message":
                await websocket.send_text(msg["data"])

    task = asyncio.create_task(reader())
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                cmd = json.loads(raw)
            except json.JSONDecodeError:
                continue
            action = cmd.get("action")
            if action == "ping":
                await websocket.send_text(json.dumps({"event": "pong"}))
                await redis.expire(conn_key, 3600)
            elif action == "presence" and role == "provider":
                await _set_presence(user_id, bool(cmd.get("online", True)))
            elif action == "location" and role == "provider":
                try:
                    await _update_location(
                        user_id, float(cmd.get("lat")), float(cmd.get("lng"))
                    )
                except (TypeError, ValueError):
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe()
            await pubsub.aclose()
        remaining = await redis.decr(conn_key)
        if remaining <= 0:
            await redis.delete(conn_key)
            if role == "provider":
                with contextlib.suppress(Exception):
                    await _set_presence(user_id, False)
