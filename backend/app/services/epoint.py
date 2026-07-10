"""Epoint ödəniş inteqrasiyası.

Protokol (rəsmi sənəd):
  data      = base64( json(payload) )
  signature = base64( sha1( private_key + data + private_key ) )

Təhlükəsizlik:
  * Webhook imzası MÜTLƏQ yoxlanır — imzasız/yanlış imzalı callback rədd.
  * order_id unikaldır (payments.order_id UNIQUE) → idempotency:
    eyni callback iki dəfə gəlsə balans iki dəfə artmır.
"""
from __future__ import annotations

import base64
import hashlib
import json
import uuid
from typing import Any

import httpx

from app.core.config import settings

EPOINT_API = "https://epoint.az/api/1"


def encode_data(payload: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(payload).encode()).decode()


def sign(data_b64: str) -> str:
    raw = f"{settings.EPOINT_PRIVATE_KEY}{data_b64}{settings.EPOINT_PRIVATE_KEY}"
    return base64.b64encode(hashlib.sha1(raw.encode()).digest()).decode()


def verify_signature(data_b64: str, signature: str) -> bool:
    """Sabit-vaxt müqayisə — timing hücumlarına qarşı."""
    import hmac

    return hmac.compare_digest(sign(data_b64), signature)


def decode_callback(data_b64: str) -> dict:
    return json.loads(base64.b64decode(data_b64))


async def create_checkout(
    *, amount: str, order_id: str, description: str, success_url: str, error_url: str
) -> dict:
    """Ödəniş sessiyası yarat — istifadəçi checkout_url-ə yönləndirilir."""
    payload = {
        "public_key": settings.EPOINT_PUBLIC_KEY,
        "amount": amount,
        "currency": "AZN",
        "language": "az",
        "order_id": order_id,
        "description": description,
        "success_redirect_url": success_url,
        "error_redirect_url": error_url,
    }
    data = encode_data(payload)
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(
            f"{EPOINT_API}/request",
            data={"data": data, "signature": sign(data)},
        )
        resp.raise_for_status()
        return resp.json()


def new_order_id(user_id: uuid.UUID) -> str:
    return f"topup-{str(user_id)[:8]}-{uuid.uuid4().hex[:12]}"
