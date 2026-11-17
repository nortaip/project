"""Vahid bildiriş servisi — Supabase-dəki notify_* trigger-lərinin əvəzi.

İki mərhələ:
  1. `insert_notification(db, ...)` — tranzaksiya DAXİLİNDƏ notifications
     sətri yaradır (rollback olsa bildiriş də itir — düzgün davranış).
  2. `dispatch(...)` — commit-DƏN SONRA çağırılır: FCM push + WebSocket
     publish (hər ikisi best-effort, API-ni ləngitmir).

Rahatlıq üçün `notify_after_commit` ikisini birləşdirən nümunə axındır:
    nid = await insert_notification(db, ...)
    await db.commit()
    dispatch(user_id, title, body, {"notif_id": nid, ...})

Təklif (offer) hadisələri üçün `notify_*` köməkçiləri (notify_new_offer,
notify_offer_accepted, notify_offer_released, notify_offer_refunded) eyni
qaydanı izləyir: tranzaksiya daxilində sətir yaradır və `Notice` siyahısı
qaytarır; çağıran tərəf commit-dən sonra `dispatch_all(...)` edir.
"""
from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.realtime import publish


# Bildiriş tuple-u: (user_id, title, body, data) — commit-dən sonra dispatch
Notice = tuple[str, str, str, dict]


async def insert_notification(
    db: AsyncSession, *, user_id, ntype: str, title: str, body: str,
    related_id: str | None = None, kind: str | None = None,
    link: str | None = None,
) -> str:
    """notifications sətri. `kind`/`link` — köhnə web trigger-lərinin
    doldurduğu sütunlardır (verilməsə NULL qalır)."""
    row = (
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body,"
                " related_id, kind, link)"
                " values (:u, :t, :ti, :b, :r, :k, :l) returning id"
            ),
            {"u": user_id, "t": ntype, "ti": title, "b": body, "r": related_id,
             "k": kind, "l": link},
        )
    ).first()
    return str(row.id)


async def insert_notice(
    db: AsyncSession, *, user_id, ntype: str, title: str, body: str,
    related_id: str | None = None, link: str | None = None,
) -> Notice:
    """insert_notification + commit-dən sonra dispatch üçün hazır tuple.

    Köhnə veb trigger-ləri dəyəri `kind` sütununa yazırdı, mobil tətbiq və
    API isə `type` oxuyur — hər iki klient düzgün görsün deyə eyni dəyər
    hər iki sütuna yazılır.
    """
    nid = await insert_notification(
        db, user_id=user_id, ntype=ntype, title=title, body=body,
        related_id=related_id, kind=ntype, link=link)
    return (str(user_id), title, body,
            {"type": ntype, "related_id": related_id or "", "notif_id": nid})


def dispatch(
    user_id: uuid.UUID | str, title: str, body: str,
    data: dict[str, Any] | None = None,
) -> None:
    """WS — fire-and-forget (commit-dən sonra çağırın).

    FCM push burada GÖNDƏRİLMİR: hər notifications sətri bazada
    `pg_notify('ellit_push')` edir və worker (push_listener) onu göndərir —
    beləcə /rest/v1 trigger-lərinin yaratdığı bildirişlər də push alır və
    heç biri ikiqat getmir."""
    payload = data or {}

    async def _run() -> None:
        try:
            await publish(user_id, "notification.new",
                          {"title": title, "body": body, **payload})
        except Exception:
            pass

    try:
        asyncio.get_running_loop().create_task(_run())
    except RuntimeError:
        pass  # event loop yoxdur (test konteksti)


def dispatch_all(notices: list[Notice]) -> None:
    """Toplanmış bildirişləri göndər (commit-dən SONRA çağırın)."""
    for uid, title, body, data in notices:
        dispatch(uid, title, body, data)


async def broadcast_new_opportunity(db: AsyncSession, *, opp_id, title: str,
                                    body: str, category_id, subcategory_id,
                                    created_by) -> list[str]:
    """notify_providers_on_new_opportunity trigger-inin portu.

    Uyğun ixtisaslı (və ya heç bir ixtisas seçməmiş) ONLAYN provayderlərə
    notifications sətri yaradır; qaytarılan user_id siyahısı ilə çağıran
    tərəf commit-dən sonra dispatch edə bilər.
    """
    rows = (
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " select p.id, 'new_opportunity', :ti, :b, :r"
                "   from profiles p"
                "  where lower(coalesce(p.role,'')) in ('provider','pro','seller')"
                "    and p.id <> :creator"
                # Oflayn usta sifariş almır (mobil: "Oflayn — sifariş gəlmir")
                "    and coalesce(p.is_online, false)"
                # ixtisas kateqoriya ID-si (mobil) və ya adı (veb) ola bilər
                "    and (coalesce(array_length(p.specialties, 1), 0) = 0"
                "         or p.specialties && public.ellit_specialty_keys("
                "              cast(nullif(:cat, '') as uuid), cast(nullif(:sub, '') as uuid)))"
                " returning user_id"
            ),
            {"ti": f"Yeni sifariş: {title}", "b": body, "r": str(opp_id),
             "creator": created_by,
             "cat": str(category_id or ""), "sub": str(subcategory_id or "")},
        )
    ).all()
    return [str(r.user_id) for r in rows]


# ── Təklif (offer) hadisələri ───────────────────────────────────────────
# Supabase-dəki notify_customer_on_new_offer / notify_provider_on_offer_status
# trigger-lərinin portu. Hamısı tranzaksiya DAXİLİNDƏ çağırılır və commit-dən
# sonra dispatch_all üçün Notice siyahısı qaytarır.

_OFFER_LINK_CUSTOMER = "/my-opportunities"
_OFFER_LINK_PROVIDER = "/account/services"


async def _offer_ctx(db: AsyncSession, offer_id):
    """Təklif + sifariş başlığı + tərəflər (bildiriş mətni üçün)."""
    return (
        await db.execute(
            text(
                "select oo.id, oo.opportunity_id, oo.provider_id, oo.offer_amount,"
                "       oo.status, oo.proposed_at, oo.price_unit, oo.unit_price,"
                "       oo.quantity, op.title as opp_title, op.created_by,"
                "       p.name as provider_name"
                "  from opportunities_offers oo"
                "  left join opportunities op on op.id = oo.opportunity_id"
                "  left join profiles p on p.id = oo.provider_id"
                " where oo.id = :id"
            ),
            {"id": offer_id},
        )
    ).first()


_UNIT_LABEL = {"m2": "m²", "hour": "saat"}
_BAKU = timezone(timedelta(hours=4))


def offer_terms(o) -> str:
    """" (15 ₼/m² × 40 m²) · 20.11.2026 10:00" — vahid qiymət və gəliş vaxtı."""
    def num(v) -> str:
        return format(Decimal(str(v)).normalize(), "f")

    out = ""
    unit = _UNIT_LABEL.get(getattr(o, "price_unit", None) or "")
    if unit and o.unit_price is not None and o.quantity is not None:
        out += f" ({num(o.unit_price)} ₼/{unit} × {num(o.quantity)} {unit})"
    if getattr(o, "proposed_at", None):
        t = o.proposed_at.astimezone(_BAKU)
        out += " · " + t.strftime("%d.%m.%Y") + ("" if (t.hour, t.minute) == (0, 0)
                                                    else t.strftime(" %H:%M"))
    return out


def _offer_line(title: str | None, amount) -> str:
    """SQL: coalesce(title,'Sifariş') || ' — ' || offer_amount::text || ' ₼'."""
    return f"{title or 'Sifariş'} — {'' if amount is None else amount} ₼"


async def notify_new_offer(db: AsyncSession, *, offer_id) -> list[Notice]:
    """Yeni pending təklif → müştəriyə (notify_customer_on_new_offer portu)."""
    o = await _offer_ctx(db, offer_id)
    if o is None or o.status != "pending" or o.created_by is None:
        return []
    return [await insert_notice(
        db, user_id=o.created_by, ntype="new_offer",
        title=f"Yeni təklif: {o.provider_name or 'Provayder'}",
        body=f"{o.opp_title or 'Sifarişiniz'} — {o.offer_amount} ₼{offer_terms(o)}",
        related_id=str(o.id), link=_OFFER_LINK_CUSTOMER)]


async def notify_offer_accepted(db: AsyncSession, *, offer_id) -> list[Notice]:
    """Təklif qəbul edildi → qəbul olunan provayderə və bu qəbul nəticəsində
    təklifi rədd edilən provayderlərə (notify_provider_on_offer_status portu).

    Qəbul olunan provayderin sətrini money.accept_offer artıq yaradıb
    (offer_accepted_card / offer_accepted_cash — accept RPC-nin öz bildirişi);
    burada yalnız onun dispatch tuple-u hazırlanır ki, cüt bildiriş olmasın.
    """
    o = await _offer_ctx(db, offer_id)
    if o is None:
        return []
    notices: list[Notice] = []
    if o.provider_id is not None:
        acc = (
            await db.execute(
                text(
                    "select id, type, title, body from notifications"
                    " where user_id = :u and related_id = :r"
                    "   and type in ('offer_accepted_card','offer_accepted_cash')"
                    " order by created_at desc limit 1"
                ),
                {"u": o.provider_id, "r": str(o.opportunity_id)},
            )
        ).first()
        if acc is not None:
            notices.append((str(o.provider_id), acc.title, acc.body or "", {
                "type": acc.type, "related_id": str(o.opportunity_id),
                "notif_id": str(acc.id)}))

    # accept_offer qalan pending təklifləri bu tranzaksiyada 'rejected' edir və
    # updated_at = now() yazır; now() tranzaksiya boyu sabitdir, ona görə bu
    # bərabərlik MƏHZ indi rədd edilənləri seçir (əvvəlkilərə toxunmur).
    rejected = (
        await db.execute(
            text(
                "select id, provider_id, offer_amount from opportunities_offers"
                " where opportunity_id = :opp and id <> :id"
                "   and status = 'rejected' and updated_at = now()"
                "   and provider_id is not null"
                " order by created_at"
            ),
            {"opp": o.opportunity_id, "id": offer_id},
        )
    ).all()
    for r in rejected:
        notices.append(await insert_notice(
            db, user_id=r.provider_id, ntype="offer_rejected",
            title="Təklifin rədd edildi",
            body=_offer_line(o.opp_title, r.offer_amount),
            related_id=str(r.id), link=_OFFER_LINK_PROVIDER))
    return notices


async def notify_offer_released(
    db: AsyncSession, *, offer_id, method: str, released,
) -> list[Notice]:
    """İş tamamlandı → provayderə (offer status 'completed' trigger portu).

    Kart: açılan (escrow-dan balansa keçən) məbləğ göstərilir.
    Nağd: pul hərəkəti yoxdur — sadə mətn.
    """
    o = await _offer_ctx(db, offer_id)
    if o is None or o.provider_id is None:
        return []
    if method == "card":
        title = "İş tamamlandı və ödəniş açıldı"
        body = f"{o.opp_title or 'Sifariş'} — {released} ₼ balansınıza köçürüldü"
    else:
        title = "İş tamamlandı"
        body = f"{o.opp_title or 'Sifariş'} — nağd sifariş tamamlandı"
    return [await insert_notice(
        db, user_id=o.provider_id, ntype="offer_completed", title=title,
        body=body, related_id=str(o.id), link=_OFFER_LINK_PROVIDER)]


async def notify_offer_refunded(
    db: AsyncSession, *, offer_id, refunded_amount,
) -> list[Notice]:
    """Geri qaytarma → provayderə və müştəriyə (orijinalda trigger yox idi)."""
    o = await _offer_ctx(db, offer_id)
    if o is None:
        return []
    notices: list[Notice] = []
    if o.created_by is not None:
        notices.append(await insert_notice(
            db, user_id=o.created_by, ntype="offer_refunded",
            title="Ödəniş geri qaytarıldı",
            body=f"{o.opp_title or 'Sifariş'} — {refunded_amount} ₼"
                 " balansınıza qaytarıldı",
            related_id=str(o.id), link=_OFFER_LINK_CUSTOMER))
    if o.provider_id is not None and o.provider_id != o.created_by:
        notices.append(await insert_notice(
            db, user_id=o.provider_id, ntype="offer_refunded",
            title="Sifariş üzrə ödəniş geri qaytarıldı",
            body=f"{o.opp_title or 'Sifariş'} — sifariş dayandırıldı,"
                 " ödəniş müştəriyə qaytarıldı",
            related_id=str(o.id), link=_OFFER_LINK_PROVIDER))
    return notices
