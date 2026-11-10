"""Bazar (marketplace) əməliyyatları — REST router-ləri və Supabase-uyğun RPC
adapterləri (app/compat/rpc_core.py) üçün ORTAQ servis qatı.

Hər funksiya köhnə Supabase SQL funksiyasının (və ya ona bağlı trigger-in)
portudur və iki yerdən çağırılır:
  * app/api/v1/*  — REST endpoint (HTTP status + `detail`)
  * app/compat/rpc_core.py — /rest/v1/rpc/<ad> (PostgREST formatı)

Qaydalar:
  * Tranzaksiya çağıranın öhdəsindədir: servis yalnız yazır, commit ETMİR.
  * Bildirişlər tranzaksiya daxilində yaradılır və `Notice` siyahısı kimi
    qaytarılır — çağıran commit-dən SONRA `notify.dispatch_all` edir.
  * Biznes qaydası pozulanda `OpError` atılır (pul servisləri `MoneyError`).
  * Pul məbləğləri/ledger məntiqi app/services/money.py-dədir — burada yalnız
    çağırılır, dəyişdirilmir.
"""
from __future__ import annotations

import uuid
from datetime import date as date_cls
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.cache import cached
from app.services import money
from app.services.money import customer_net_paid, _config_pct, _round2
from app.services.notify import (
    Notice, insert_notice, notify_new_offer, notify_offer_accepted,
    notify_offer_refunded, notify_offer_released,
)

ADMIN_ROLES = ("admin", "master", "superadmin")
OPEN_STATUSES = ("pending", "open", "new", "active")
CANCELLABLE_STATUSES = ("pending", "open", "new", "accepted", "active")
SUPPORT_CATEGORIES = ("general", "order", "payment", "kyc", "complaint", "provider")


class OpError(Exception):
    """Biznes qaydası pozuntusu.

    `status` — REST üçün HTTP status; `code` — SQL funksiyasının
    `{ok:false, error:'KOD'}` kimi QAYTARDIĞI hallarda maşın kodu;
    `extra` — həmin cavaba əlavə sahələr (məs. current_status).
    """

    def __init__(self, message: str, status: int = 409, code: str | None = None,
                 extra: dict | None = None) -> None:
        super().__init__(message)
        self.status, self.code, self.extra = status, code, extra or {}


async def config_decimal(db: AsyncSession, key: str, default: str = "0") -> Decimal:
    """platform_config dəyəri (keşsiz — çıxarış kimi nadir əməliyyatlar üçün)."""
    row = (
        await db.execute(
            text("select value #>> '{}' as v from platform_config where key=:k"),
            {"k": key},
        )
    ).first()
    return Decimal(str(row.v).strip('"')) if row and row.v else Decimal(default)


# ════════════════ Təkliflər (offers) ════════════════════════════════════


async def place_bid(
    db: AsyncSession, *, caller_id: uuid.UUID, role: str,
    opportunity_id: uuid.UUID, amount: Decimal, notes: str | None = None,
) -> dict:
    """Provayder sifarişə təklif verir (place_bid RPC portu).

    Qaytarır: bid_id, amount, required_balance (qəbul komissiyası üçün lazım
    olan balans), customer_id və müştəriyə bildiriş (`notices`).
    """
    if amount is None or amount <= 0:
        raise OpError("Təklif məbləği müsbət olmalıdır", 400)
    if role not in ("provider", *ADMIN_ROLES):
        raise OpError("Yalnız provayderlər təklif verə bilər", 403)

    # KYC qapısı + komissiya balansı
    prof = (
        await db.execute(
            text(
                "select coalesce(balance,0) as balance,"
                "       coalesce(is_verified,false) as is_verified,"
                "       last_kyc_approved_at"
                "  from profiles where id = :u"
            ),
            {"u": caller_id},
        )
    ).first()
    if prof is None:
        raise OpError("Profil tapılmadı", 404)
    if role == "provider":
        kyc_at = prof.last_kyc_approved_at
        kyc_fresh = (
            kyc_at is not None
            and kyc_at > datetime.now(timezone.utc) - timedelta(days=14)
        )
        if not prof.is_verified or not kyc_fresh:
            raise OpError(
                "KYC_REQUIRED: Şəxsiyyət təsdiqiniz yoxdur və ya vaxtı bitib", 403)

    commission_pct = await _config_pct(db, "commission_on_accept")
    required = _round2(Decimal(str(amount)) * commission_pct / 100)
    if Decimal(prof.balance) < required:
        raise OpError(
            f"NO_BALANCE: balansda minimum {required} AZN olmalıdır"
            f" (komissiya {commission_pct}%), cari: {prof.balance} AZN")

    opp = (
        await db.execute(
            text("select id, status, created_by from opportunities where id = :id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise OpError("Sifariş tapılmadı", 404)
    if opp.created_by == caller_id:
        raise OpError("Öz sifarişinizə təklif verə bilməzsiniz")
    if opp.status not in OPEN_STATUSES:
        raise OpError("Sifariş artıq aktiv deyil")

    dup = (
        await db.execute(
            text(
                "select 1 from opportunities_offers"
                " where opportunity_id=:opp and provider_id=:u and status='pending'"
            ),
            {"opp": opportunity_id, "u": caller_id},
        )
    ).first()
    if dup:
        raise OpError("Artıq təklif vermisiniz")

    row = (
        await db.execute(
            text(
                "insert into opportunities_offers"
                " (opportunity_id, provider_id, offer_amount, status, notes)"
                " values (:opp, :u, :a, 'pending', :n) returning id"
            ),
            {"opp": opportunity_id, "u": caller_id, "a": amount, "n": notes},
        )
    ).first()
    # Müştəriyə bildiriş (notify_customer_on_new_offer trigger portu)
    notices = await notify_new_offer(db, offer_id=row.id)
    return {"bid_id": row.id, "amount": amount, "required_balance": required,
            "customer_id": opp.created_by, "notices": notices}


async def accept_offer(
    db: AsyncSession, *, offer_id: uuid.UUID, caller_id: uuid.UUID, method: str,
    promo_code: str | None = None, latitude: Decimal | None = None,
    longitude: Decimal | None = None,
) -> tuple[dict, list[Notice]]:
    """Təklifin qəbulu: pul (money.accept_offer) + dəqiq ünvan koordinatları
    + bildirişlər. MoneyError atır."""
    result = await money.accept_offer(
        db, offer_id=offer_id, caller_id=caller_id, method=method,
        promo_code=promo_code)
    # SQL: latitude = coalesce(p_latitude, latitude) — mobil tətbiq xəritədən
    # seçilmiş dəqiq məkanı qəbul anında göndərir
    if latitude is not None or longitude is not None:
        await db.execute(
            text(
                "update opportunities"
                "   set latitude  = coalesce(cast(:lat as numeric), latitude),"
                "       longitude = coalesce(cast(:lng as numeric), longitude)"
                " where id = cast(:opp as uuid)"
            ),
            {"lat": latitude, "lng": longitude, "opp": result["opportunity_id"]},
        )
    # Qəbul olunan + bu qəbulla rədd edilən provayderlərə bildiriş
    notices = await notify_offer_accepted(db, offer_id=offer_id)
    return result, notices


async def release_offer(
    db: AsyncSession, *, offer_id: uuid.UUID, caller_id: uuid.UUID,
    caller_role: str,
) -> tuple[dict, list[Notice]]:
    """İş tamamlandı: escrow açılışı (money.release_offer) + provayderə
    bildiriş (kartda açılan məbləğ ilə, nağdda sadə mətn). MoneyError atır."""
    result = await money.release_offer(
        db, offer_id=offer_id, caller_id=caller_id, caller_role=caller_role)
    notices = await notify_offer_released(
        db, offer_id=offer_id, method=result["method"],
        released=result["released"])
    return result, notices


async def refund_offer(
    db: AsyncSession, *, offer_id: uuid.UUID, caller_id: uuid.UUID,
    caller_role: str, reason: str | None = None,
) -> tuple[dict, list[Notice]]:
    """Geri qaytarma (money.refund_offer, idempotent) + bildirişlər.
    İdempotent təkrar çağırışda (already_refunded) bildiriş yazılmır."""
    result = await money.refund_offer(
        db, offer_id=offer_id, caller_id=caller_id, caller_role=caller_role,
        reason=reason)
    notices: list[Notice] = []
    if not result.get("already_refunded"):
        notices = await notify_offer_refunded(
            db, offer_id=offer_id, refunded_amount=result["refunded_amount"])
    return result, notices


# ════════════════ Sifarişin ləğvi ═══════════════════════════════════════


async def cancel_opportunity(
    db: AsyncSession, *, opportunity_id: uuid.UUID, caller_id: uuid.UUID,
    is_admin: bool, reason: str | None, refund_to_caller: bool = False,
) -> dict:
    """Ləğv + kart ödənişində avtomatik refund (cancel_opportunity RPC portu).

    Pul: kartda provayderin escrow-u açılır; müştəriyə (kart və nağd) bu
    təklif üçün həqiqətən ödədiyi xalis məbləğ qaytarılır. SQL-dəki qalan
    addımlar da icra olunur: qəbul edilmiş və gözləyən təkliflər bağlanır,
    icraçıya bildiriş yazılır, sifarişdən icraçı/təklif bağlantısı götürülür.

    `refund_to_caller` köhnə çağırışlarla uyğunluq üçün qalır, nəzərə alınmır.
    """
    row = (
        await db.execute(
            text(
                "select id, created_by, status, accepted_offer_id"
                " from opportunities where id = :id for update"
            ),
            {"id": opportunity_id},
        )
    ).first()
    if row is None:
        raise OpError("Sifariş tapılmadı", 404, code="NOT_FOUND")
    if row.created_by != caller_id and not is_admin:
        raise OpError("İcazə yoxdur", 403, code="NOT_AUTHORIZED")
    if row.status not in CANCELLABLE_STATUSES:
        raise OpError("Bu mərhələdə ləğv mümkün deyil", 409, code="NOT_CANCELLABLE",
                      extra={"current_status": row.status})

    reason_txt = (reason or "").strip()
    # Pul HƏMİŞƏ sifariş sahibinə qaytarılır — admin ləğv edəndə də (əvvəlki
    # REST portu admin ləğvində pulu adminin özünə yazırdı)
    recipient = row.created_by
    refunded = Decimal(0)
    notices: list[Notice] = []
    if row.accepted_offer_id is not None:
        # Kart escrow-u geri qaytar
        offer = (
            await db.execute(
                text(
                    "select id, provider_id, payment_method, offer_amount"
                    " from opportunities_offers where id = :id for update"
                ),
                {"id": row.accepted_offer_id},
            )
        ).first()
        if offer is not None and offer.payment_method == "card":
            # Kart: provayderin kilidli escrow-u açılır (ona heç nə keçmir)
            locked = (
                await db.execute(
                    text(
                        "select amount from transactions where related_id = :r"
                        " and type = 'escrow_lock' order by created_at desc limit 1"
                    ),
                    {"r": str(offer.id)},
                )
            ).first()
            if locked is not None:
                await db.execute(
                    text(
                        "update provider_wallets set locked_balance = "
                        " greatest(locked_balance - :a, 0), updated_at = now()"
                        " where provider_id = :p"
                    ),
                    {"a": Decimal(locked.amount), "p": offer.provider_id},
                )
        if offer is not None:
            # Müştəriyə bu təklif üçün həqiqətən ödədiyi xalis məbləğ qaytarılır
            # (kart: məbləğ + haqq − promo; nağd: depozit + haqq − promo).
            # Artıq qaytarılıbsa (refund sətri var) təkrar ödənmir.
            already = (
                await db.execute(
                    text("select 1 from transactions where type = 'refund'"
                         " and related_id = :r limit 1"),
                    {"r": str(offer.id)},
                )
            ).first()
            net = Decimal(0) if already else await customer_net_paid(
                db, offer_id=offer.id, customer_id=row.created_by)
            if net > 0:
                bal = (
                    await db.execute(
                        text("update profiles set balance = coalesce(balance,0) + :a"
                             " where id = :u returning balance"),
                        {"a": net, "u": recipient},
                    )
                ).first()
                await db.execute(
                    text(
                        "insert into transactions (user_id, type, amount, balance_after,"
                        " description, related_id, created_by)"
                        " values (:u, 'refund', :a, :b, :d, :r, :c)"
                    ),
                    {"u": recipient, "a": net, "b": Decimal(bal.balance), "c": caller_id,
                     "d": "Sifariş ləğvi — geri qaytarma"
                          + (f" ({reason_txt[:100]})" if reason_txt else ""),
                     "r": str(offer.id)},
                )
                refunded = net
        if offer is not None:
            await db.execute(
                text("update opportunities_offers set status='rejected', updated_at=now() where id=:id"),
                {"id": offer.id},
            )
            # İcraçıya bildiriş (SQL: type='order_cancelled')
            if offer.provider_id is not None and offer.provider_id != caller_id:
                notices.append(await insert_notice(
                    db, user_id=offer.provider_id, ntype="order_cancelled",
                    title="Sifariş ləğv edildi",
                    body=f"Səbəb: {reason_txt}" if reason_txt
                    else "Müştəri sifarişi ləğv etdi",
                    related_id=str(opportunity_id)))

    # Bütün gözləyən təkliflər bağlanır
    await db.execute(
        text(
            "update opportunities_offers set status='rejected', updated_at=now()"
            " where opportunity_id = :id and status = 'pending'"
        ),
        {"id": opportunity_id},
    )
    await db.execute(
        text(
            "update opportunities set status='cancelled', cancellation_reason=:r,"
            " accepted_offer_id = null, provider_id = null where id=:id"
        ),
        {"r": reason_txt or "Müştəri ləğv etdi", "id": opportunity_id},
    )
    return {"refunded": refunded, "notices": notices}


# ════════════════ Promo / komissiya / balans ════════════════════════════


async def validate_promo(
    db: AsyncSession, *, caller_id: uuid.UUID, code: str | None, amount: Decimal,
) -> dict:
    """Promo kodun yoxlanması — yalnız oxuyur (validate_promo_code portu).
    Etibarsız kod xəta deyil: `{valid: false, message}` qaytarılır."""

    def bad(msg: str) -> dict:
        return {"valid": False, "message": msg}

    if code is None or not code.strip():
        return bad("Kod boşdur")
    promo = (
        await db.execute(
            text(
                "select id, code, discount_type, discount_value, min_order_amount,"
                " max_uses, used_count, per_user_limit, is_active, starts_at,"
                " expires_at from promo_codes where upper(code) = upper(:c)"
            ),
            {"c": code.strip()},
        )
    ).first()
    if promo is None:
        return bad("Promo kod tapılmadı")
    if not promo.is_active:
        return bad("Kod aktiv deyil")
    now = (await db.execute(text("select now() as n"))).first().n
    if promo.starts_at and now < promo.starts_at:
        return bad("Kod hələ aktiv deyil")
    if promo.expires_at and now > promo.expires_at:
        return bad("Kodun vaxtı keçib")
    if promo.min_order_amount and amount < Decimal(promo.min_order_amount):
        return bad(f"Minimum sifariş məbləği: {promo.min_order_amount} ₼")
    if promo.max_uses is not None and promo.used_count >= promo.max_uses:
        return bad("Kodun limiti dolub")
    if promo.per_user_limit is not None:
        used = (
            await db.execute(
                text("select count(*) as c from promo_redemptions"
                     " where promo_id=:p and user_id=:u"),
                {"p": promo.id, "u": caller_id},
            )
        ).first()
        if used.c >= promo.per_user_limit:
            return bad("Siz bu kodu artıq istifadə etmisiniz")

    if promo.discount_type == "percent":
        discount = _round2(amount * Decimal(promo.discount_value) / 100)
    else:
        discount = Decimal(promo.discount_value)
    discount = min(discount, amount)
    return {"valid": True, "promo_id": promo.id, "code": promo.code,
            "discount_type": promo.discount_type,
            "discount_value": Decimal(promo.discount_value),
            "discount": discount, "final": amount - discount,
            "message": "Promo kod tətbiq olundu"}


_RATE_KEYS = (
    "commission_on_accept", "commission_on_complete", "commission_on_withdrawal",
    "commission_on_bonus_convert", "bonus_on_complete", "min_withdrawal_amount",
)


async def commission_rates(db: AsyncSession) -> dict[str, Decimal]:
    """Admin-in təyin etdiyi cari faizlər (get_commission_rates portu) —
    yalnız platform_config-də mövcud olan açarlar."""
    rows = await db.execute(
        text("select key, value #>> '{}' as v from platform_config"
             " where key = any(:keys)"),
        {"keys": list(_RATE_KEYS)},
    )
    out: dict[str, Decimal] = {}
    for r in rows:
        try:
            out[r.key] = Decimal(str(r.v).strip('"'))
        except Exception:  # noqa: BLE001 — rəqəm olmayan dəyər ötürülür
            continue
    return out


async def request_withdrawal(
    db: AsyncSession, *, caller_id: uuid.UUID, amount: Decimal, bank_card: str,
) -> dict:
    """Çıxarış sorğusu (request_withdrawal RPC portu): minimum məbləğ,
    balansdan dərhal tutma, komissiya hesabı, withdrawals + transactions."""
    if amount is None or amount <= 0:
        raise OpError("Məbləğ müsbət olmalıdır", 400)
    if bank_card is None or len(bank_card.strip()) < 8:
        raise OpError("Bank kartı / IBAN tələb olunur", 400)
    min_amount = await config_decimal(db, "min_withdrawal_amount", "0")
    if amount < min_amount:
        raise OpError(f"Minimum çıxarış {min_amount} ₼", 400)

    bal = (
        await db.execute(
            text("select coalesce(balance,0) as b from profiles where id=:u for update"),
            {"u": caller_id},
        )
    ).first()
    if bal is None or Decimal(bal.b) < amount:
        raise OpError("INSUFFICIENT_BALANCE: Balans yetərsizdir", 409,
                      code="INSUFFICIENT_BALANCE")

    pct = await config_decimal(db, "commission_on_withdrawal")
    commission = _round2(amount * pct / 100)
    net = amount - commission

    # Məbləğ dərhal balansdan tutulur (rədd olunsa geri qaytarılır)
    new_bal = (
        await db.execute(
            text("update profiles set balance = balance - :a where id=:u returning balance"),
            {"a": amount, "u": caller_id},
        )
    ).first()
    row = (
        await db.execute(
            text(
                "insert into withdrawals (provider_id, amount_requested,"
                " commission_percent, commission_amount, net_amount, bank_card)"
                " values (:u, :a, :p, :c, :n, :card) returning id"
            ),
            {"u": caller_id, "a": amount, "p": pct, "c": commission,
             "n": net, "card": bank_card},
        )
    ).first()
    await db.execute(
        text(
            "insert into transactions (user_id, type, amount, balance_after,"
            " description, related_id)"
            " values (:u, 'withdrawal', :a, :b, :d, :r)"
        ),
        {"u": caller_id, "a": -amount, "b": new_bal.balance,
         "d": f"Çıxarış sorğusu (komissiya {pct}%: {commission} ₼, xalis {net} ₼)",
         "r": str(row.id)},
    )
    return {"id": row.id, "net_amount": net, "commission": commission}


async def worker_earnings(
    db: AsyncSession, *, caller_id: uuid.UUID, p_from: datetime, p_to: datetime,
) -> dict:
    """Ustanın qazanc hesabatı (worker_earnings RPC portu) — verilən
    aralıqda tamamlanmış sifarişlər, platforma/komanda payı və xalis məbləğ."""
    row = (
        await db.execute(
            text(
                "with cfg as (select"
                "  coalesce((select (value)::text::numeric from platform_config"
                "    where key='commission_on_accept'), 0) as ppct,"
                "  coalesce((select (value)::text::numeric from platform_config"
                "    where key='brigade_member_commission_pct'), 0) as bpct),"
                " rows as ("
                "  select op.id, op.title, op.completed_at,"
                "         oo.offer_amount::numeric as amount,"
                "         oo.brigade_id, oo.payment_method"
                "    from opportunities op"
                "    join opportunities_offers oo on oo.id = op.accepted_offer_id"
                "   where oo.provider_id = :u and op.status='completed'"
                "     and op.completed_at is not null"
                "     and op.completed_at >= :f and op.completed_at <= :t),"
                " calc as ("
                "  select r.*, round(r.amount * c.ppct/100, 2) as platform_amt,"
                "         case when r.brigade_id is not null"
                "              then round(r.amount * c.bpct/100, 2) else 0 end"
                "           as brigade_cut,"
                "         case when r.brigade_id is not null then c.bpct else 0 end"
                "           as brigade_pct"
                "    from rows r cross join cfg c)"
                " select count(*) as cnt,"
                "        coalesce(sum(amount),0) as gross,"
                "        coalesce(sum(platform_amt),0) as platform_total,"
                "        coalesce(sum(brigade_cut),0) as brigade_total,"
                "        coalesce(sum(round(amount - platform_amt - brigade_cut, 2)),0)"
                "          as net_total,"
                "        coalesce(jsonb_agg(jsonb_build_object("
                "          'id', id, 'title', title, 'completed_at', completed_at,"
                "          'amount', amount, 'is_brigade', brigade_id is not null,"
                "          'payment_method', payment_method,"
                "          'worker_pct', (100 - platform_amt/nullif(amount,0)*100"
                "                         - brigade_pct),"
                "          'worker_net', round(amount-platform_amt-brigade_cut,2),"
                "          'brigade_cut', brigade_cut, 'platform_amt', platform_amt)"
                "          order by completed_at desc), cast('[]' as jsonb))"
                "          as orders"
                "   from calc"
            ),
            {"u": caller_id, "f": p_from, "t": p_to},
        )
    ).first()
    return {"from": p_from, "to": p_to, "count": row.cnt, "gross": row.gross,
            "platform_total": row.platform_total,
            "brigade_total": row.brigade_total, "net_total": row.net_total,
            "orders": row.orders}


# ════════════════ Birbaşa sifariş (booking) ═════════════════════════════


async def create_booking(
    db: AsyncSession, *, caller_id: uuid.UUID, service_id: int,
    date: date_cls | None, time_str: str | None, package_name: str | None,
    package_price: Decimal | None, package_duration: str | None,
    notes: str | None,
) -> tuple[dict, list[Notice]]:
    """Birbaşa sifariş + 1 ₼ komissiya (money.create_booking_with_fee) və
    xidmətin provayderinə bildiriş (notify_provider_on_new_booking portu).
    MoneyError atır."""
    result = await money.create_booking_with_fee(
        db, caller_id=caller_id, service_id=service_id, date=date,
        time_str=time_str or "", package_name=package_name,
        package_price=package_price, package_duration=package_duration,
        notes=notes)
    notices: list[Notice] = []
    bk = (
        await db.execute(
            text("select provider_id from bookings where id = cast(:b as uuid)"),
            {"b": result["booking_id"]},
        )
    ).first()
    if bk is not None and bk.provider_id is not None \
            and bk.provider_id != caller_id:
        notices.append(await insert_notice(
            db, user_id=bk.provider_id, ntype="new_booking",
            title="Yeni sifariş", body="Sizə yeni sifariş gəldi.",
            related_id=result["booking_id"]))
    return result, notices


# ════════════════ Ana səhifə icmalı ═════════════════════════════════════


async def home_overview(db: AsyncSession) -> dict:
    """home_overview RPC-nin portu — ana səhifə icmalı (60s keş).

    Kateqoriya tərcümə fallback-ı: əvvəl service_categories.label_ru/en/zh,
    tapılmasa service_text_translations lüğəti (sxemdə mövcuddursa —
    introspeksiya ilə yoxlanır, yoxdursa sorğu ondan istifadə etmir).
    """

    async def load() -> dict:
        # Sxem introspeksiyası: köhnə Supabase sxemində olan, lakin bu
        # bazada olmaya bilən obyektlər üçün qoruma
        meta = (
            await db.execute(
                text(
                    "select to_regclass('public.service_text_translations')"
                    "         is not null as has_tr,"
                    "       exists (select 1 from information_schema.columns"
                    "         where table_schema='public'"
                    "           and table_name='service_categories'"
                    "           and column_name='label_zh') as has_zh"
                )
            )
        ).first()
        has_tr, has_zh = bool(meta.has_tr), bool(meta.has_zh)

        counts = (
            await db.execute(
                text(
                    "select"
                    " (select count(*) from profiles where role = 'provider') as providers,"
                    " (select count(*) from services) as services,"
                    " (select count(*) from bookings) as bookings"
                )
            )
        ).first()

        # Top provayderlər — reytinq üzrə ilk 8
        # (profiles.rating bu sxemdə text-dir → təhlükəsiz rəqəmsal sıralama)
        top = await db.execute(
            text(
                "select pr.id, pr.name, pr.avatar_url, pr.rating, pr.is_verified,"
                "       (select count(*) from provider_reviews rv"
                "         where rv.provider_id = pr.id)::int as reviews_count"
                "  from profiles pr where pr.role = 'provider'"
                " order by (case when pr.rating ~ '^[0-9]+(\\.[0-9]+)?$'"
                "                then cast(pr.rating as numeric) end)"
                "          desc nulls last"
                " limit 8"
            )
        )

        # Kateqoriyalar — tərcümə fallback-ı ilə
        sc_cols = "label_ru, label_en" + (", label_zh" if has_zh else "")
        ru_expr = "coalesce(sc.label_ru" + (", t.ru)" if has_tr else ")")
        en_expr = "coalesce(sc.label_en" + (", t.en)" if has_tr else ")")
        if has_zh and has_tr:
            zh_expr = "coalesce(sc.label_zh, t.zh)"
        elif has_zh:
            zh_expr = "sc.label_zh"
        elif has_tr:
            zh_expr = "t.zh"
        else:
            zh_expr = "cast(null as text)"
        tr_join = (
            " left join service_text_translations t on t.az = g.category"
            if has_tr else ""
        )
        cats = await db.execute(
            text(
                "select g.category, g.count,"
                f"      {ru_expr} as label_ru,"
                f"      {en_expr} as label_en,"
                f"      {zh_expr} as label_zh"
                "  from ("
                "    select trim(category) as category, count(*)::int as count"
                "      from services where coalesce(trim(category), '') <> ''"
                "     group by trim(category)"
                "     order by count(*) desc limit 12"
                "  ) g"
                f" left join lateral (select {sc_cols} from service_categories"
                "    where trim(label) = g.category limit 1) sc on true"
                f"{tr_join}"
            )
        )

        cities = await db.execute(
            text(
                "select trim(split_part(location, ',', 1)) as city,"
                "       count(*)::int as count"
                "  from services"
                " where coalesce(trim(split_part(location, ',', 1)), '') <> ''"
                " group by trim(split_part(location, ',', 1))"
                " order by count(*) desc limit 10"
            )
        )

        recent = await db.execute(
            text(
                "select id, title, category, location, created_at"
                "  from services order by created_at desc limit 5"
            )
        )

        return {
            "providers": counts.providers,
            "services": counts.services,
            "bookings": counts.bookings,
            "top_providers": [dict(r._mapping) for r in top],
            "categories": [dict(r._mapping) for r in cats],
            "cities": [dict(r._mapping) for r in cities],
            "recent": [dict(r._mapping) for r in recent],
        }

    return await cached("catalog:home-overview", 60, load)


# ════════════════ Bildirişlər ═══════════════════════════════════════════


async def mark_all_notifications_read(db: AsyncSession, *, caller_id: uuid.UUID) -> int:
    """mark_all_notifications_read RPC portu — dəyişən sətir sayını qaytarır."""
    result = await db.execute(
        text("update notifications set is_read=true where user_id=:u and not is_read"),
        {"u": caller_id},
    )
    return result.rowcount


# ════════════════ Bloklama / provayder müraciəti ════════════════════════


async def block_user(
    db: AsyncSession, *, caller_id: uuid.UUID, blocked_id: uuid.UUID,
    reason: str | None = None, scope: str = "global",
    brigade_id: uuid.UUID | None = None,
) -> uuid.UUID | None:
    """İstifadəçini blokla (block_user portu). scope='brigade' olduqda
    yalnız komanda sahibi/dispetçeri bloklaya bilər və üzv deaktiv edilir.
    Təkrar blokda konflikt sükutla ötürülür (None qaytarılır)."""
    if caller_id == blocked_id:
        raise OpError("Özünüzü bloklaya bilməzsiniz", 409)
    if scope not in ("global", "brigade", "customer"):
        raise OpError("Yanlış blok növü (scope)", 400)

    if scope == "brigade":
        if brigade_id is None:
            raise OpError("brigade_id tələb olunur", 400)
        # SQL: is_brigade_dispatcher(p_brigade_id, v_caller)
        disp = (
            await db.execute(
                text(
                    "select 1 from brigade_members"
                    " where brigade_id=:b and profile_id=:u and is_active=true"
                    "   and role in ('owner', 'dispatcher')"
                ),
                {"b": brigade_id, "u": caller_id},
            )
        ).first()
        if disp is None:
            raise OpError("Yalnız komanda sahibi/dispetçeri bloklaya bilər", 403)
        # Üzvü komandadan çıxar (deaktiv et)
        await db.execute(
            text(
                "update brigade_members set is_active=false"
                " where brigade_id=:b and profile_id=:p"
            ),
            {"b": brigade_id, "p": blocked_id},
        )

    # Blok sətrini yarat — təkrar blokda konflikt sükutla ötürülür
    row = (
        await db.execute(
            text(
                "insert into user_blocks (blocker_id, blocked_id, reason,"
                " scope, brigade_id) values (:u, :b, :r, :s, :br)"
                " on conflict do nothing returning id"
            ),
            {"u": caller_id, "b": blocked_id, "r": reason,
             "s": scope, "br": brigade_id},
        )
    ).first()
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'user_block', 'user', :t,"
            " jsonb_build_object('scope', cast(:s as text),"
            " 'brigade_id', cast(:br as text), 'reason', cast(:r as text)))"
        ),
        {"a": caller_id, "t": str(blocked_id), "s": scope,
         "br": str(brigade_id) if brigade_id else None, "r": reason},
    )
    return row.id if row else None


async def request_provider_role(
    db: AsyncSession, *, caller_id: uuid.UUID, role: str,
    message: str | None = None, company_name: str | None = None,
    experience_years: int | None = None, specialties: list[str] | None = None,
) -> uuid.UUID:
    """Provayder olmaq üçün müraciət (request_provider_role portu)."""
    if role in ("provider", *ADMIN_ROLES):
        raise OpError("Siz artıq provayder/admin statusundasınız")
    pending = (
        await db.execute(
            text(
                "select 1 from provider_requests"
                " where user_id = :u and status = 'pending'"
            ),
            {"u": caller_id},
        )
    ).first()
    if pending:
        raise OpError("Sizin artıq aktiv müraciətiniz var")
    row = (
        await db.execute(
            text(
                "insert into provider_requests"
                " (user_id, message, company_name, experience_years, specialties)"
                " values (:u, :m, :c, :e, cast(:sp as text[])) returning id"
            ),
            {"u": caller_id, "m": message, "c": company_name,
             "e": experience_years, "sp": list(specialties or [])},
        )
    ).first()
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id, payload)"
            " values (:a, 'provider_request', 'provider_request', :t,"
            " jsonb_build_object('message', cast(:m as text)))"
        ),
        {"a": caller_id, "t": str(row.id), "m": message},
    )
    return row.id


# ════════════════ Söhbətlər (chat) ══════════════════════════════════════

# conversations_unique_pair indeksinin ifadəsi (ON CONFLICT hədəfi)
_CONV_CONFLICT = (
    "(coalesce(cast(opportunity_id as text),"
    " 'support_' || coalesce(category, 'general')), customer_id, provider_id)"
)


async def open_conversation(
    db: AsyncSession, *, caller_id: uuid.UUID, opportunity_id: uuid.UUID,
    peer_id: uuid.UUID | None,
) -> uuid.UUID:
    """Sifariş üzrə müştəri↔provayder söhbəti (open_conversation RPC portu,
    idempotent). Sifariş sahibi çağırırsa o müştəridir və qarşı tərəf
    `peer_id`-dir; başqası çağırırsa müştəri sifariş sahibi, provayder isə
    çağıranın ÖZÜDÜR (peer_id nəzərə alınmır — başqasının adından söhbət
    açmaq olmur)."""
    opp = (
        await db.execute(
            text("select created_by from opportunities where id = :id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None or opp.created_by is None:
        raise OpError("Sifariş tapılmadı", 404)
    if caller_id == opp.created_by:
        customer, provider = caller_id, peer_id
        if provider is None:
            raise OpError("Qarşı tərəf (peer) göstərilməyib", 400)
    else:
        customer, provider = opp.created_by, caller_id
    row = (
        await db.execute(
            text(
                "insert into conversations (opportunity_id, customer_id, provider_id)"
                " values (:opp, :c, :p)"
                f" on conflict {_CONV_CONFLICT}"
                " do update set last_message_at = conversations.last_message_at"
                " returning id"
            ),
            {"opp": opportunity_id, "c": customer, "p": provider},
        )
    ).first()
    return row.id


async def support_user_id(db: AsyncSession) -> uuid.UUID:
    """Dəstək hesabı: platform_config.support_user_id, yoxdursa ilk admin."""
    row = (
        await db.execute(
            text("select value #>> '{}' as v from platform_config"
                 " where key = 'support_user_id'")
        )
    ).first()
    if row and row.v:
        try:
            return uuid.UUID(str(row.v).strip('"'))
        except ValueError:
            pass
    admin = (
        await db.execute(
            text("select id from users where role in ('admin','superadmin')"
                 " and is_active order by created_at limit 1")
        )
    ).first()
    if admin is None:
        raise OpError("Dəstək hesabı konfiqurasiya olunmayıb", 503)
    return admin.id


async def open_support_conversation(
    db: AsyncSession, *, caller_id: uuid.UUID, category: str | None = "general",
    user_role: str | None = "customer",
) -> tuple[uuid.UUID, bool]:
    """Dəstək çatı aç — kateqoriya başına idempotent
    (open_support_conversation RPC portu). Qaytarır: (id, yeni yaradıldımı)."""
    cat = (category or "").strip() or "general"
    role = (user_role or "").strip() or "customer"
    if role not in ("customer", "provider"):
        raise OpError(f"Yanlış istifadəçi rolu (user_role): {role}", 400)
    if cat not in SUPPORT_CATEGORIES:
        raise OpError(f"Yanlış kateqoriya (category): {cat}", 400)
    support_id = await support_user_id(db)
    if caller_id == support_id:
        raise OpError("Özünüzlə dəstək söhbəti aça bilməzsiniz", 409)
    row = (
        await db.execute(
            text(
                "insert into conversations (opportunity_id, customer_id,"
                " provider_id, category, user_role)"
                " values (null, :u, :s, :c, :r)"
                f" on conflict {_CONV_CONFLICT}"
                " do update set last_message_at = conversations.last_message_at,"
                "               user_role = excluded.user_role"
                " returning id, (xmax = 0) as created"
            ),
            {"u": caller_id, "s": support_id, "c": cat, "r": role},
        )
    ).first()
    return row.id, bool(row.created)
