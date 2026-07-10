"""Pul əməliyyatları — Supabase RPC-lərinin portu (accept/release/cancel).

Orijinaldan FƏRQLİ təkmilləşdirmələr:
  * Bütün balans sətirlər SELECT ... FOR UPDATE ilə kilidlənir —
    yarış vəziyyəti (race condition) mümkün deyil.
  * Hər əməliyyat tək DB tranzaksiyasındadır — yarımçıq pul axını olmur.
  * Komissiya faizləri platform_config-dən oxunur (admin idarə edir).

Promo-kod dəstəyi daxildir (_apply_promo).
"""
from __future__ import annotations

import uuid
from decimal import Decimal, ROUND_HALF_UP

from app.core.cache import cached
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class MoneyError(Exception):
    """Biznes qaydası pozuntusu — API 400/409 kimi qaytarır."""


def _round2(x: Decimal) -> Decimal:
    return x.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def _config_pct(db: AsyncSession, key: str, default: Decimal = Decimal(0)) -> Decimal:
    """Komissiya faizi — 30s Redis keşi ilə (admin dəyişəndə invalidate
    olunur; pul əməliyyatlarında hər dəfə DB-yə getmək lazım deyil)."""

    async def load() -> str | None:
        row = (
            await db.execute(
                text("select value #>> '{}' as v from platform_config where key = :k"),
                {"k": key},
            )
        ).first()
        return None if row is None else row.v

    v = await cached(f"cfg:{key}", 30, load)
    if v is None:
        return default
    try:
        return Decimal(str(v).strip('"'))
    except Exception:
        return default


async def _log_tx(
    db: AsyncSession, *, user_id, tx_type: str, amount: Decimal,
    balance_after: Decimal, description: str, related_id: str, created_by,
) -> None:
    await db.execute(
        text(
            "insert into transactions (user_id, type, amount, balance_after,"
            " description, related_id, created_by)"
            " values (:u, :t, :a, :b, :d, :r, :c)"
        ),
        {"u": user_id, "t": tx_type, "a": amount, "b": balance_after,
         "d": description, "r": related_id, "c": created_by},
    )


async def _apply_promo(
    db: AsyncSession, *, code: str, caller_id: uuid.UUID, amount: Decimal,
    gross: Decimal, offer_id: uuid.UUID, opp_id,
) -> Decimal:
    """Promo kodu yoxla və endirimi qaytar (RPC promo bölməsinin portu)."""
    promo = (
        await db.execute(
            text(
                "select id, code, discount_type, discount_value, min_order_amount,"
                " max_uses, used_count, per_user_limit, is_active, starts_at,"
                " expires_at from promo_codes where upper(code) = upper(:c) for update"
            ),
            {"c": code.strip()},
        )
    ).first()
    if promo is None:
        raise MoneyError("PROMO_INVALID: Promo kod tapılmadı")
    if not promo.is_active:
        raise MoneyError("PROMO_INVALID: Kod aktiv deyil")
    now_row = (await db.execute(text("select now() as n"))).first()
    if promo.starts_at and now_row.n < promo.starts_at:
        raise MoneyError("PROMO_INVALID: Kod hələ aktiv deyil")
    if promo.expires_at and now_row.n > promo.expires_at:
        raise MoneyError("PROMO_INVALID: Kodun vaxtı keçib")
    if promo.min_order_amount and amount < Decimal(promo.min_order_amount):
        raise MoneyError(f"PROMO_INVALID: Minimum məbləğ {promo.min_order_amount} AZN")
    if promo.max_uses is not None and promo.used_count >= promo.max_uses:
        raise MoneyError("PROMO_INVALID: Kodun limiti dolub")
    if promo.per_user_limit is not None:
        used = (
            await db.execute(
                text(
                    "select count(*) as c from promo_redemptions"
                    " where promo_id=:p and user_id=:u"
                ),
                {"p": promo.id, "u": caller_id},
            )
        ).first()
        if used.c >= promo.per_user_limit:
            raise MoneyError("PROMO_INVALID: Siz bu kodu artıq istifadə etmisiniz")

    if promo.discount_type == "percent":
        discount = _round2(amount * Decimal(promo.discount_value) / 100)
    else:
        discount = Decimal(promo.discount_value)
    discount = min(discount, gross)

    await db.execute(
        text("update promo_codes set used_count = used_count + 1 where id=:id"),
        {"id": promo.id},
    )
    await db.execute(
        text(
            "insert into promo_redemptions (promo_id, user_id, offer_id,"
            " opportunity_id, discount_amount) values (:p, :u, :o, :opp, :d)"
        ),
        {"p": promo.id, "u": caller_id, "o": offer_id, "opp": opp_id, "d": discount},
    )
    return discount


async def accept_offer(
    db: AsyncSession, *, offer_id: uuid.UUID, caller_id: uuid.UUID, method: str,
    promo_code: str | None = None,
) -> dict:
    """Müştəri təklifi qəbul edir (kart = tam escrow; nağd = depozit).

    accept_offer_with_payment RPC-nin portu. Tranzaksiya çağıranın
    öhdəsindədir (router `async with db.begin()` edir).
    """
    if method not in ("cash", "card"):
        raise MoneyError("Ödəniş üsulu yanlışdır")

    offer = (
        await db.execute(
            text(
                "select oo.id, oo.opportunity_id, oo.provider_id, oo.brigade_id,"
                "       oo.offer_amount, oo.status, op.created_by"
                "  from opportunities_offers oo"
                "  join opportunities op on op.id = oo.opportunity_id"
                " where oo.id = :id for update of oo"
            ),
            {"id": offer_id},
        )
    ).first()
    if offer is None:
        raise MoneyError("Təklif tapılmadı")
    if offer.created_by != caller_id:
        raise MoneyError("Yalnız sifariş sahibi qəbul edə bilər")
    if offer.status != "pending":
        raise MoneyError("Təklif artıq aktiv deyil")

    amount = Decimal(offer.offer_amount)
    is_brigade = offer.brigade_id is not None

    pct_key = "brigade_commission_on_accept" if is_brigade else "commission_on_accept"
    commission_pct = await _config_pct(db, pct_key)
    if commission_pct == 0 and is_brigade:
        commission_pct = await _config_pct(db, "commission_on_accept")
    commission = _round2(amount * commission_pct / 100)
    provider_amt = amount - commission

    fee_pct = await _config_pct(db, "commission_customer_service_fee")
    fee = _round2(amount * fee_pct / 100)

    # ── Müştəri balansı (kilidlə) ──
    cust = (
        await db.execute(
            text("select coalesce(balance,0) as b from profiles where id = :id for update"),
            {"id": caller_id},
        )
    ).first()
    if cust is None:
        raise MoneyError("Profil tapılmadı")
    cust_balance = Decimal(cust.b)

    discount = Decimal(0)
    if method == "card":
        total = amount + fee
        if promo_code:
            discount = await _apply_promo(
                db, code=promo_code, caller_id=caller_id, amount=amount,
                gross=total, offer_id=offer_id, opp_id=offer.opportunity_id)
            total -= discount
        if cust_balance < total:
            raise MoneyError(f"INSUFFICIENT_BALANCE: lazım {total}, mövcud {cust_balance}")
        new_balance = cust_balance - total
        await db.execute(
            text("update profiles set balance = :b where id = :id"),
            {"b": new_balance, "id": caller_id},
        )
        # Escrow: provayder cüzdanına kilidli məbləğ
        await db.execute(
            text(
                "insert into provider_wallets (provider_id, locked_balance)"
                " values (:p, :a)"
                " on conflict (provider_id) do update"
                " set locked_balance = provider_wallets.locked_balance + :a,"
                "     updated_at = now()"
            ),
            {"p": offer.provider_id, "a": provider_amt},
        )
        await _log_tx(db, user_id=caller_id, tx_type="booking_charge", amount=-amount,
                      balance_after=new_balance,
                      description=f"Sifariş ödənişi (escrow), offer {str(offer_id)[:8]}",
                      related_id=str(offer_id), created_by=caller_id)
        await _log_tx(db, user_id=offer.provider_id, tx_type="escrow_lock",
                      amount=provider_amt, balance_after=Decimal(0),
                      description=f"Escrow (qəbul komissiyası {commission_pct}%: {commission} ₼)",
                      related_id=str(offer_id), created_by=caller_id)
        if commission > 0:
            await _log_tx(db, user_id=offer.provider_id, tx_type="platform_revenue",
                          amount=commission, balance_after=Decimal(0),
                          description=f"Qəbul komissiyası (kart, {commission_pct}%)",
                          related_id=str(offer_id), created_by=caller_id)
    else:  # cash
        deposit_pct = await _config_pct(db, "cash_deposit_pct", Decimal(20))
        deposit = _round2(amount * deposit_pct / 100)
        total = deposit + fee
        if promo_code:
            discount = await _apply_promo(
                db, code=promo_code, caller_id=caller_id, amount=amount,
                gross=total, offer_id=offer_id, opp_id=offer.opportunity_id)
            total = max(total - discount, Decimal(0))
        if cust_balance < total:
            raise MoneyError(f"INSUFFICIENT_BALANCE: depozit+haqq {total}, mövcud {cust_balance}")
        new_balance = cust_balance - total
        await db.execute(
            text("update profiles set balance = :b where id = :id"),
            {"b": new_balance, "id": caller_id},
        )
        # Nağdda komissiya icraçı tərəfin balansından tutulur
        if is_brigade:
            brig = (
                await db.execute(
                    text("select coalesce(balance,0) as b from brigades where id=:id for update"),
                    {"id": offer.brigade_id},
                )
            ).first()
            if Decimal(brig.b) < commission:
                raise MoneyError("BRIGADE_INSUFFICIENT_BALANCE: komanda balansı komissiya üçün yetərsizdir")
            await db.execute(
                text("update brigades set balance = balance - :c, updated_at=now() where id=:id"),
                {"c": commission, "id": offer.brigade_id},
            )
        else:
            prov = (
                await db.execute(
                    text("select coalesce(balance,0) as b from profiles where id=:id for update"),
                    {"id": offer.provider_id},
                )
            ).first()
            if Decimal(prov.b) < commission:
                raise MoneyError("PROVIDER_INSUFFICIENT_BALANCE: usta balansı komissiya üçün yetərsizdir")
            await db.execute(
                text("update profiles set balance = balance - :c where id=:id"),
                {"c": commission, "id": offer.provider_id},
            )
        if commission > 0:
            await _log_tx(db, user_id=offer.provider_id, tx_type="platform_revenue",
                          amount=commission, balance_after=Decimal(0),
                          description=f"Qəbul komissiyası (nağd, {commission_pct}%)",
                          related_id=str(offer_id), created_by=caller_id)
        if deposit > 0:
            await _log_tx(db, user_id=caller_id, tx_type="cash_deposit_lock",
                          amount=-deposit, balance_after=new_balance,
                          description=f"Qarantili nağd depozit ({deposit_pct}%)",
                          related_id=str(offer_id), created_by=caller_id)

    if discount > 0:
        await _log_tx(db, user_id=caller_id, tx_type="promo_discount", amount=discount,
                      balance_after=new_balance,
                      description=f"Promo endirim ({promo_code}, {method})",
                      related_id=str(offer_id), created_by=caller_id)

    if fee > 0:
        await _log_tx(db, user_id=caller_id, tx_type="platform_revenue", amount=-fee,
                      balance_after=new_balance,
                      description=f"Müştəri servis haqqı ({fee_pct}%)",
                      related_id=str(offer_id), created_by=caller_id)

    # ── Statuslar ──
    await db.execute(
        text(
            "update opportunities_offers set status='accepted', payment_method=:m,"
            " paid_at = case when :m = 'card' then now() end, updated_at=now()"
            " where id=:id"
        ),
        {"m": method, "id": offer_id},
    )
    await db.execute(
        text(
            "update opportunities_offers set status='rejected', updated_at=now()"
            " where opportunity_id=:opp and id<>:id and status='pending'"
        ),
        {"opp": offer.opportunity_id, "id": offer_id},
    )
    await db.execute(
        text(
            "update opportunities set status='accepted', accepted_offer_id=:id,"
            " provider_id=:prov where id=:opp"
        ),
        {"id": offer_id, "prov": offer.provider_id, "opp": offer.opportunity_id},
    )
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, :t, :ti, :b, :r)"
        ),
        {"u": offer.provider_id,
         "t": "offer_accepted_card" if method == "card" else "offer_accepted_cash",
         "ti": "Təklifiniz qəbul edildi 🎉",
         "b": "Müştəri kartla ödədi, məbləğ escrow-dadır."
              if method == "card" else "Müştəri qarantili nağd seçdi.",
         "r": str(offer.opportunity_id)},
    )
    return {
        "ok": True, "method": method, "offer_id": str(offer_id),
        "opportunity_id": str(offer.opportunity_id),
        "commission_amt": str(commission), "commission_pct": str(commission_pct),
        "customer_fee_amt": str(fee), "is_brigade": is_brigade,
        "discount": str(discount),
    }


async def release_offer(
    db: AsyncSession, *, offer_id: uuid.UUID, caller_id: uuid.UUID, caller_role: str
) -> dict:
    """İş tamamlandı — escrow provayderə açılır (release_offer_to_provider portu)."""
    row = (
        await db.execute(
            text(
                "select oo.provider_id, oo.payment_method, oo.offer_amount,"
                "       op.id as opp_id, op.status as opp_status, op.created_by"
                "  from opportunities_offers oo"
                "  join opportunities op on op.id = oo.opportunity_id"
                " where oo.id = :id for update of oo"
            ),
            {"id": offer_id},
        )
    ).first()
    if row is None:
        raise MoneyError("Təklif tapılmadı")

    if row.opp_status == "pending_review":
        if caller_role not in ("admin", "superadmin"):
            raise MoneyError("pending_review yalnız admin tərəfindən təsdiqlənir")
    elif row.created_by != caller_id:
        raise MoneyError("Yalnız müştəri tamamlaya bilər")

    if row.payment_method != "card":
        # Nağd: yalnız statuslar dəyişir
        await db.execute(
            text("update opportunities_offers set status='completed', updated_at=now() where id=:id"),
            {"id": offer_id})
        await db.execute(
            text("update opportunities set status='completed', completed_at=now() where id=:id"),
            {"id": row.opp_id})
        return {"ok": True, "released": "0", "method": "cash"}

    locked = (
        await db.execute(
            text(
                "select amount from transactions"
                " where related_id = :r and type = 'escrow_lock'"
                " order by created_at desc limit 1"
            ),
            {"r": str(offer_id)},
        )
    ).first()
    if locked is None:
        raise MoneyError("Escrow tapılmadı")
    locked_amt = Decimal(locked.amount)

    pct = await _config_pct(db, "commission_on_complete")
    commission = _round2(locked_amt * pct / 100)
    release_amt = locked_amt - commission

    await db.execute(
        text(
            "update provider_wallets set locked_balance = locked_balance - :l,"
            " total_earned = coalesce(total_earned,0) + :r, updated_at=now()"
            " where provider_id = :p"
        ),
        {"l": locked_amt, "r": release_amt, "p": row.provider_id},
    )
    await db.execute(
        text("update profiles set balance = coalesce(balance,0) + :a where id = :p"),
        {"a": release_amt, "p": row.provider_id},
    )
    await db.execute(
        text("update opportunities_offers set status='completed', escrow_released_at=now(),"
             " updated_at=now() where id=:id"), {"id": offer_id})
    await db.execute(
        text("update opportunities set status='completed', completed_at=now() where id=:id"),
        {"id": row.opp_id})
    await _log_tx(db, user_id=row.provider_id, tx_type="escrow_release", amount=release_amt,
                  balance_after=Decimal(0),
                  description=f"İş tamamlandı (tamamlama komissiyası {pct}%: {commission} ₼)",
                  related_id=str(offer_id), created_by=caller_id)
    if commission > 0:
        await _log_tx(db, user_id=row.provider_id, tx_type="platform_revenue",
                      amount=commission, balance_after=Decimal(0),
                      description=f"Tamamlama komissiyası ({pct}%)",
                      related_id=str(offer_id), created_by=caller_id)
    return {"ok": True, "released": str(release_amt), "method": "card"}
