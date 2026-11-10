"""E-poçt göndərişi (SMTP) — Supabase Auth e-poçtlarının əvəzi.

SMTP_HOST təyin olunmayıbsa `mail_enabled()` False qaytarır və heç nə
göndərilmir; çağıran tərəf bunu nəzərə alır (kod tətbiq bildirişi ilə gedir).
Göndəriş xətası API sorğusunu yıxmır — False qaytarılır və loglanır.
"""
from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib

from app.core.config import settings

log = logging.getLogger("ellit.mail")


def mail_enabled() -> bool:
    return bool(settings.SMTP_HOST.strip())


async def send_mail(to: str, subject: str, body: str, html: str | None = None) -> bool:
    if not mail_enabled():
        return False
    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    if html:
        msg.add_alternative(html, subtype="html")

    mode = settings.SMTP_SECURITY.strip().lower()
    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST.strip(),
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER or None,
            password=settings.SMTP_PASSWORD or None,
            use_tls=(mode == "ssl"),
            start_tls=(True if mode == "starttls" else False),
            timeout=15,
        )
        return True
    except Exception as e:  # noqa: BLE001 — SMTP xətası istifadəçi axınını dayandırmasın
        log.warning("E-poçt göndərilmədi (%s): %s", type(e).__name__, e)
        return False


def otp_mail(code: str, minutes: int) -> tuple[str, str, str]:
    """(mövzu, mətn, html) — parol bərpası kodu məktubu."""
    subject = f"Ellit — təsdiq kodunuz: {code}"
    text = (
        f"Parolunuzu yeniləmək üçün təsdiq kodu: {code}\n\n"
        f"Kod {minutes} dəqiqə etibarlıdır. Bu sorğunu siz etməmisinizsə, "
        f"məktubu nəzərə almayın — parolunuz dəyişməyəcək.\n\nEllit.az"
    )
    html = (
        '<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;'
        'padding:24px;color:#0A0F1E">'
        '<h2 style="color:#2563EB;margin:0 0 12px">Ellit</h2>'
        "<p>Parolunuzu yeniləmək üçün təsdiq kodu:</p>"
        f'<p style="font-size:32px;font-weight:700;letter-spacing:6px;'
        f'margin:16px 0">{code}</p>'
        f'<p style="color:#64748B">Kod {minutes} dəqiqə etibarlıdır. Bu sorğunu '
        "siz etməmisinizsə, məktubu nəzərə almayın — parolunuz dəyişməyəcək.</p>"
        "</div>"
    )
    return subject, text, html
