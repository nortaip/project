"""İdentifikator həlli: e-poçt VƏ YA telefon nömrəsi ilə istifadəçi tapmaq.

Telefonlar bazada müxtəlif formatlarda ola bilər (+994501234567,
994501234567, 0501234567, 501234567) — müqayisə milli nömrənin son 9
rəqəmi üzrə aparılır (Azərbaycan nömrələri: operator kodu 2 + abunəçi 7).
"""
from __future__ import annotations

import re

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

_NON_DIGIT = re.compile(r"\D")
PHONE_TAIL = 9


def is_email(identifier: str) -> bool:
    return "@" in identifier


def phone_digits(raw: str) -> str:
    return _NON_DIGIT.sub("", raw or "")


def phone_tail(raw: str) -> str | None:
    """Müqayisə açarı: son 9 rəqəm; nömrə qısadırsa None."""
    d = phone_digits(raw)
    return d[-PHONE_TAIL:] if len(d) >= PHONE_TAIL else None


def normalize_phone(raw: str) -> str | None:
    """Saxlama formatı: ölkə kodu ilə, yalnız rəqəmlər (994XXXXXXXXX)."""
    d = phone_digits(raw)
    if len(d) == 9:
        return "994" + d
    if len(d) == 10 and d.startswith("0"):
        return "994" + d[1:]
    if 11 <= len(d) <= 15:
        return d
    return None


def identifier_key(identifier: str) -> str:
    """Rate-limit / lockout açarı üçün sabit forma (hesab olub-olmamasından asılı deyil)."""
    ident = identifier.strip().lower()
    if is_email(ident):
        return ident
    return phone_tail(ident) or ident


async def find_user(db: AsyncSession, identifier: str) -> User | None:
    ident = (identifier or "").strip()
    if not ident:
        return None
    if is_email(ident):
        return (
            await db.execute(select(User).where(User.email == ident.lower()))
        ).scalar_one_or_none()

    tail = phone_tail(ident)
    if tail is None:
        return None
    # Namizədlər: kimlik cədvəlindəki nömrə (users.phone) və profildəki nömrə.
    # Eyni nömrə bir neçə hesabda ola bilər (canlı bazada telefonla açılmış hesab
    # + eyni nömrəni yazmış e-poçt hesabı). Supabase telefonla girişdə məhz
    # telefon kimliyini (nömrə "+"-sız saxlanılır) tapırdı — eyni sıralama:
    #   3 = users.phone uyğun və "+"-sız (telefonla qeydiyyat)
    #   2 = users.phone uyğun
    #   1 = yalnız profildəki nömrə uyğun
    # Ən yüksək xal tək hesabdadırsa o seçilir; bərabərlikdə heç kim (birmənalı deyil).
    rows = (
        await db.execute(
            text(
                "select id, max(score) as score from ("
                "  select u.id, case when left(coalesce(u.phone, ''), 1) <> '+' then 3 else 2 end"
                "         as score"
                "    from users u"
                "   where right(regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g'), :n) = :t"
                "  union all"
                "  select p.id, 1 from profiles p join users u2 on u2.id = p.id"
                "   where right(regexp_replace(coalesce(p.phone_number, ''), '\\D', '', 'g'), :n) = :t"
                ") c group by id order by score desc limit 3"
            ),
            {"t": tail, "n": PHONE_TAIL},
        )
    ).all()
    if not rows or (len(rows) > 1 and rows[0].score == rows[1].score):
        return None  # tapılmadı və ya birmənalı deyil — heç kimə giriş vermirik
    return (
        await db.execute(select(User).where(User.id == rows[0].id))
    ).scalar_one_or_none()


def mask_email(email: str) -> str:
    """a•••@g•••.com — ünvanı açmadan istifadəçiyə ipucu."""
    local, _, domain = email.partition("@")
    host, dot, tld = domain.rpartition(".")
    if not dot:
        host, tld = domain, ""
    masked = f"{local[:1]}•••@{host[:1]}•••"
    return f"{masked}.{tld}" if tld else masked
