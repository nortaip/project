"""WhatsApp mesajları — öz WhatsApp bot servisimiz (nortaip/WhatsappBot) ilə.

    POST {WHATSAPP_API_URL}/api/send
    Authorization: Bearer <WHATSAPP_TOKEN>        (paneldə sessiyanın tokeni, wa_…)
    {"to": "994501234567", "text": "…"}

Bot mesajları növbə ilə göndərir ("insan rejimi": mesajlar arası 6–20 s fasilə,
"yazır…" göstəricisi) və cavabı mesaj həqiqətən gedəndən sonra qaytarır. Ona
görə göndərmə arxa planda başladılır — API sorğusu gözləmir.
"""
from __future__ import annotations

import asyncio
import logging
import re

import httpx

from app.core.config import settings

log = logging.getLogger("ellit.whatsapp")

# Arxa plan tapşırıqlarına güclü istinad (yoxsa GC yarımçıq dayandıra bilər)
_tasks: set[asyncio.Task] = set()


def enabled() -> bool:
    return bool(settings.WHATSAPP_API_URL.strip() and settings.WHATSAPP_TOKEN.strip())


def normalize_phone(phone: str | None) -> str | None:
    """Botun gözlədiyi format: beynəlxalq rəqəmlər, "+"-sız (994501234567)."""
    digits = re.sub(r"\D", "", phone or "")
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0"):      # 0501234567
        digits = "994" + digits[1:]
    elif len(digits) == 9:                                 # 501234567
        digits = "994" + digits
    return digits if 10 <= len(digits) <= 15 else None


def _mask(phone: str) -> str:
    return "•••" + phone[-3:]


def otp_text(code: str, ttl_minutes: int) -> str:
    # Diqqət: bot {a|b} sintaksisini variasiya kimi işlədir — mətndə fiqurlu
    # mötərizə olmamalıdır.
    return (
        f"Ellit.az təsdiq kodunuz: *{code}*\n"
        f"Kod {ttl_minutes} dəqiqə etibarlıdır. Bu kodu heç kimə deməyin — "
        "Ellit əməkdaşları kodu heç vaxt soruşmur."
    )


async def send_text(phone: str | None, text: str, *, timeout: float = 120.0) -> bool:
    """Mesajı göndərir və nəticəni gözləyir. Uğurludursa True."""
    to = normalize_phone(phone)
    if not enabled() or not to:
        return False
    url = settings.WHATSAPP_API_URL.strip().rstrip("/") + "/api/send"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(
                url,
                json={"to": to, "text": text},
                headers={"Authorization": f"Bearer {settings.WHATSAPP_TOKEN.strip()}"},
            )
    except httpx.HTTPError as e:
        log.warning("WhatsApp göndərilmədi (%s): %s", _mask(to), e)
        return False
    try:
        data = r.json()
    except ValueError:
        data = {}
    results = data.get("results") if isinstance(data, dict) else None
    ok = r.status_code == 200 and any(
        isinstance(x, dict) and x.get("status") == "sent" for x in (results or []))
    if ok:
        log.info("WhatsApp göndərildi (%s)", _mask(to))
    else:
        # 409 — bot sessiyası qoşulu deyil (QR); 429 — limit; 401 — token
        err = data.get("error") if isinstance(data, dict) else None
        if not err and results:
            err = "; ".join(str(x.get("error")) for x in results if isinstance(x, dict))
        log.warning("WhatsApp rədd etdi (%s): http %s %s", _mask(to), r.status_code,
                    str(err or r.text)[:200])
    return ok


def send_in_background(phone: str | None, text: str) -> bool:
    """Göndərməni arxa planda başladır. Başladıldısa True (nəticə logdadır)."""
    if not enabled() or not normalize_phone(phone):
        return False
    task = asyncio.create_task(send_text(phone, text))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return True
