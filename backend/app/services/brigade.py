"""Briqada (komanda) əməliyyatları — Supabase RPC-lərinin portu.

Əhatə edir: müraciət (apply/cancel), dəvətlər (invite/accept/decline/lookup),
rol yoxlamaları, online statusu, briqada təklifi (place_offer), işçi
təyinatları (assign/dispatch-order/dispatch-assign/respond/start/complete/
claim/decline) və pul axınları (top-up, bölgü).

Orijinaldan FƏRQLİ təkmilləşdirmələr (money.py ilə eyni prinsiplər):
  * Balans sətirlər SELECT ... FOR UPDATE ilə kilidlənir.
  * Hər əməliyyat tək DB tranzaksiyasındadır — commit çağıranın öhdəsindədir.
  * Supabase trigger-lərinin (notify_member_on_assignment,
    _brigade_invite_notify) notification insert-ləri müvafiq axına daxil
    edilib; push/WS göndərişi üçün nəticədəki `_notices` siyahısı commit-dən
    SONRA notify.dispatch ilə ötürülməlidir.

auth.uid() → caller_id parametri (JWT-dən gələn istifadəçi).
"""
from __future__ import annotations

import json
import re
import uuid
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import notify
from app.services.money import _config_pct, _log_tx, _round2


class BrigadeError(Exception):
    """Biznes qaydası pozuntusu — API 409 kimi qaytarır (bax: MoneyError)."""


# Bildiriş tuple-u: (user_id, title, body, data) — commit-dən sonra dispatch
Notice = tuple[str, str, str, dict]

_OPEN_STATUSES = ("open", "pending", "new", "active")


def _phone9(raw: str | None) -> str | None:
    """Telefonun son 9 rəqəmi (SQL: right(regexp_replace(...,'[^0-9]',''),9))."""
    digits = re.sub(r"[^0-9]", "", raw or "")
    return digits[-9:] or None


async def _audit(
    db: AsyncSession, *, actor, action: str, target_type: str,
    target_id: str, payload: dict,
) -> None:
    """Audit qeydi — best-effort (SQL-dəki `exception when others then null`)."""
    try:
        async with db.begin_nested():
            await db.execute(
                text(
                    "insert into audit_log (actor, action, target_type, target_id, payload)"
                    " values (:a, :ac, :tt, :ti, cast(:p as jsonb))"
                ),
                {"a": actor, "ac": action, "tt": target_type, "ti": target_id,
                 "p": json.dumps(payload, default=str)},
            )
    except Exception:
        pass


async def _insert_notice(
    db: AsyncSession, *, user_id, title: str, body: str, kind: str,
    related_id: str, link: str | None = None, ntype: str = "info",
) -> Notice:
    """notifications sətri (kind/link sütunları ilə) + dispatch tuple-u."""
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, kind,"
            " related_id, link) values (:u, :t, :ti, :b, :k, :r, :l)"
        ),
        {"u": user_id, "t": ntype, "ti": title, "b": body, "k": kind,
         "r": related_id, "l": link},
    )
    return (str(user_id), title, body, {"kind": kind, "related_id": related_id})


# ── Rol yoxlamaları ─────────────────────────────────────────────────────


async def brigade_role(
    db: AsyncSession, brigade_id: uuid.UUID, profile_id: uuid.UUID
) -> str | None:
    """brigade_role RPC portu — aktiv üzvün rolu (yoxdursa None)."""
    row = (
        await db.execute(
            text(
                "select bm.role from brigade_members bm"
                " where bm.brigade_id = :b and bm.profile_id = :p"
                "   and bm.is_active = true limit 1"
            ),
            {"b": brigade_id, "p": profile_id},
        )
    ).first()
    return row.role if row else None


async def is_brigade_dispatcher(
    db: AsyncSession, brigade_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """is_brigade_dispatcher RPC portu — owner/dispatcher-dirmi."""
    row = (
        await db.execute(
            text(
                "select 1 from brigade_members"
                " where brigade_id = :b and profile_id = :u"
                "   and is_active = true and role in ('owner','dispatcher')"
            ),
            {"b": brigade_id, "u": user_id},
        )
    ).first()
    return row is not None


async def brigade_pick_worker(
    db: AsyncSession, brigade_id: uuid.UUID
) -> uuid.UUID | None:
    """brigade_pick_worker RPC portu — ilk online işçi (məsafə yoxlanmır)."""
    row = (
        await db.execute(
            text(
                "select id from brigade_members"
                " where brigade_id = :b and is_active = true and is_online = true"
                " order by last_heartbeat desc nulls last, joined_at asc limit 1"
            ),
            {"b": brigade_id},
        )
    ).first()
    return row.id if row else None


async def set_member_online(
    db: AsyncSession, *, caller_id: uuid.UUID, is_online: bool
) -> int:
    """set_member_online RPC portu — çağıranın BÜTÜN aktiv üzvlüklərində
    online statusu + heartbeat. Yenilənən sətir sayını qaytarır (orijinal
    `returns void` idi; üzv olmayan üçün səssizcə 0 sətir)."""
    res = await db.execute(
        text(
            "update brigade_members set is_online = :o, last_heartbeat = now()"
            " where profile_id = :u and is_active = true"
        ),
        {"o": is_online, "u": caller_id},
    )
    return res.rowcount or 0


# ── Müraciətlər ─────────────────────────────────────────────────────────


async def apply_for_brigade(
    db: AsyncSession, *, caller_id: uuid.UUID, name: str,
    description: str | None = None, categories: list[str] | None = None,
    contact_phone: str | None = None, contact_email: str | None = None,
    address: str | None = None, logo_url: str | None = None,
) -> dict:
    """Briqada yaratmaq üçün müraciət (apply_for_brigade RPC portu)."""
    if not (name or "").strip():
        raise BrigadeError("Ad tələb olunur")

    pending = (
        await db.execute(
            text(
                "select 1 from brigade_applications"
                " where applicant_id = :u and status = 'pending'"
            ),
            {"u": caller_id},
        )
    ).first()
    if pending:
        raise BrigadeError("Sizin artıq aktiv müraciətiniz var")

    # Profil + users-dən müraciətçi snapshot-u (SQL: profiles + auth.users)
    snap = (
        await db.execute(
            text(
                "select coalesce(p.name, '') as name,"
                "       coalesce(p.email, u.email, '') as email,"
                "       coalesce(p.phone_number, u.phone, '') as phone"
                "  from users u left join profiles p on p.id = u.id"
                " where u.id = :u"
            ),
            {"u": caller_id},
        )
    ).first()
    app_name = (snap.name or None) if snap else None
    app_email = (snap.email or None) if snap else None
    app_phone = (snap.phone or None) if snap else None

    row = (
        await db.execute(
            text(
                "insert into brigade_applications"
                " (applicant_id, name, description, categories, contact_phone,"
                "  contact_email, address, logo_url, applicant_name,"
                "  applicant_email, applicant_phone)"
                " values (:u, :n, :d, :c, :cp, :ce, :ad, :lg, :an, :ae, :ap)"
                " returning id"
            ),
            {"u": caller_id, "n": name, "d": description,
             "c": categories or [], "cp": contact_phone, "ce": contact_email,
             "ad": address, "lg": logo_url, "an": app_name, "ae": app_email,
             "ap": app_phone},
        )
    ).first()
    await _audit(db, actor=caller_id, action="brigade_apply",
                 target_type="brigade_application", target_id=str(row.id),
                 payload={"name": name})
    return {"ok": True, "application_id": str(row.id)}


async def cancel_brigade_application(
    db: AsyncSession, *, caller_id: uuid.UUID, application_id: uuid.UUID
) -> dict:
    """Öz pending müraciətini ləğv et (cancel_brigade_application portu)."""
    app = (
        await db.execute(
            text("select id, applicant_id, status from brigade_applications"
                 " where id = :id for update"),
            {"id": application_id},
        )
    ).first()
    if app is None:
        raise BrigadeError("Müraciət tapılmadı")
    if app.applicant_id != caller_id:
        raise BrigadeError("İcazə yoxdur")
    if app.status != "pending":
        raise BrigadeError(f"'{app.status}' statuslu müraciəti ləğv etmək olmaz")

    await db.execute(
        text("update brigade_applications set status='cancelled',"
             " decided_at = now() where id = :id"),
        {"id": application_id},
    )
    return {"ok": True}


# ── Dəvətlər ────────────────────────────────────────────────────────────


async def create_brigade_invite(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    email: str | None, phone: str | None, intended_role: str = "member",
    commission_pct: Decimal | None = None,
) -> dict:
    """Üzvlük dəvəti yarat (+ _brigade_invite_notify trigger-inin portu)."""
    if not email and not phone:
        raise BrigadeError("Email və ya telefon tələb olunur")
    if not await is_brigade_dispatcher(db, brigade_id, caller_id):
        raise BrigadeError("Yalnız briqada sahibi və ya dispatcher dəvət edə bilər")

    inv = (
        await db.execute(
            text(
                "insert into brigade_invites (brigade_id, invited_by, email,"
                " phone, intended_role, commission_pct)"
                " values (:b, :u, :e, :p, :r, :c) returning id, token, expires_at"
            ),
            {"b": brigade_id, "u": caller_id, "e": email, "p": phone,
             "r": intended_role, "c": commission_pct},
        )
    ).first()

    notices: list[Notice] = []
    # ── _brigade_invite_notify trigger portu ──
    # Hədəf user-i users cədvəlində tap (profiles asılı deyil)
    target = None
    if email:
        target = (
            await db.execute(
                text("select id from users"
                     " where lower(coalesce(email,'')) = lower(:e) limit 1"),
                {"e": email},
            )
        ).first()
    if target is None and phone:
        target = (
            await db.execute(
                text("select id from users where coalesce(phone,'') = :p limit 1"),
                {"p": phone},
            )
        ).first()
    if target is not None:
        # user qeydiyyatdan keçib — bildiriş yaz
        brig = (
            await db.execute(
                text("select name from brigades where id = :id"), {"id": brigade_id}
            )
        ).first()
        brigade_name = brig.name if brig else None
        role_label = "dispatcher" if intended_role == "dispatcher" else "işçi"
        notices.append(await _insert_notice(
            db, user_id=target.id, ntype="brigade_invite",
            title=f"{brigade_name or 'Şirkət'} sizi dəvət edir",
            body=f"Şirkətə {role_label} kimi qatılmaq üçün dəvət aldınız.",
            kind="brigade_invite", related_id=str(inv.token)))
    # (user tapılmasa yalnız magic link ilə işləyəcək)

    return {"ok": True, "invite_id": str(inv.id), "token": str(inv.token),
            "expires_at": inv.expires_at, "_notices": notices}


async def lookup_brigade_invite(db: AsyncSession, *, token: uuid.UUID) -> dict | None:
    """Dəvətin təfərrüatı (lookup_brigade_invite(uuid) RPC portu)."""
    row = (
        await db.execute(
            text(
                "select i.token, i.status, i.intended_role, i.commission_pct,"
                "       i.expires_at, i.expires_at <= now() as is_expired,"
                "       i.email as invited_email, i.phone as invited_phone,"
                "       b.id as brigade_id, b.name, b.description, b.logo_url,"
                "       b.is_verified"
                "  from brigade_invites i join brigades b on b.id = i.brigade_id"
                " where i.token = :t"
            ),
            {"t": token},
        )
    ).first()
    if row is None:
        return None
    return {
        "token": str(row.token), "status": row.status,
        "intended_role": row.intended_role, "commission_pct": row.commission_pct,
        "expires_at": row.expires_at, "is_expired": row.is_expired,
        "invited_email": row.invited_email, "invited_phone": row.invited_phone,
        "brigade": {
            "id": str(row.brigade_id), "name": row.name,
            "description": row.description, "logo_url": row.logo_url,
            "is_verified": row.is_verified,
        },
    }


async def my_pending_brigade_invites(
    db: AsyncSession, *, caller_id: uuid.UUID
) -> list[dict]:
    """Mənə gələn pending dəvətlər (my_pending_brigade_invites RPC portu)."""
    rows = await db.execute(
        text(
            "with me as ("
            "  select coalesce(p.email, u.email) as my_email,"
            "         nullif(right(regexp_replace("
            "           coalesce(p.phone_number, u.phone, ''),"
            "           '[^0-9]', '', 'g'), 9), '') as my_phone9"
            "    from users u left join profiles p on p.id = u.id"
            "   where u.id = :u)"
            " select i.token, i.intended_role, b.id as brigade_id,"
            "        b.name as brigade_name, b.logo_url as brigade_logo,"
            "        i.created_at as invited_at, i.expires_at"
            "   from brigade_invites i"
            "   join brigades b on b.id = i.brigade_id"
            "  cross join me"
            "  where i.status = 'pending' and i.expires_at > now()"
            "    and ((i.email is not null and me.my_email is not null"
            "          and lower(i.email) = lower(me.my_email))"
            "      or (i.phone is not null and me.my_phone9 is not null"
            "          and right(regexp_replace(i.phone, '[^0-9]', '', 'g'), 9)"
            "              = me.my_phone9))"
            "  order by i.created_at desc"
        ),
        {"u": caller_id},
    )
    return [dict(r._mapping) for r in rows]


async def accept_brigade_invite(
    db: AsyncSession, *, caller_id: uuid.UUID, token: uuid.UUID
) -> dict:
    """Dəvəti qəbul et — üzvlüyə upsert (accept_brigade_invite RPC portu)."""
    invite = (
        await db.execute(
            text(
                "select * from brigade_invites"
                " where token = :t and status = 'pending' and expires_at > now()"
                " for update"
            ),
            {"t": token},
        )
    ).first()
    if invite is None:
        raise BrigadeError("Dəvət tapılmadı, vaxtı keçib və ya cavablanıb")

    # email/phone-u profiles + users birləşdirərək götür
    me = (
        await db.execute(
            text(
                "select coalesce(p.email, u.email) as email,"
                "       coalesce(p.phone_number, u.phone) as phone"
                "  from users u left join profiles p on p.id = u.id"
                " where u.id = :u"
            ),
            {"u": caller_id},
        )
    ).first()
    my_email = me.email if me else None
    my_phone = me.phone if me else None

    if invite.email is not None and \
            (my_email or "").lower() != invite.email.lower():
        raise BrigadeError("Bu dəvət başqa email ünvanı üçündür")
    if invite.phone is not None and _phone9(invite.phone) != _phone9(my_phone):
        raise BrigadeError("Bu dəvət başqa telefon nömrəsi üçündür")

    await db.execute(
        text(
            "insert into brigade_members"
            " (brigade_id, profile_id, role, is_active, commission_pct)"
            " values (:b, :u, :r, true, :c)"
            " on conflict (brigade_id, profile_id) do update"
            " set role = excluded.role, is_active = true,"
            "     commission_pct = excluded.commission_pct"
        ),
        {"b": invite.brigade_id, "u": caller_id, "r": invite.intended_role,
         "c": invite.commission_pct},
    )
    await db.execute(
        text("update brigade_invites set status='accepted',"
             " responded_at = now() where id = :id"),
        {"id": invite.id},
    )

    notices: list[Notice] = []
    owner = (
        await db.execute(
            text("select owner_id from brigades where id = :id"),
            {"id": invite.brigade_id},
        )
    ).first()
    if owner is not None:
        notices.append(await _insert_notice(
            db, user_id=owner.owner_id, ntype="brigade_invite_accepted",
            title="Dəvət qəbul edildi", body="Yeni üzv şirkətinizə qatıldı.",
            kind="brigade_invite_accepted", related_id=str(invite.brigade_id)))

    return {"ok": True, "brigade_id": str(invite.brigade_id),
            "role": invite.intended_role, "_notices": notices}


async def decline_brigade_invite(
    db: AsyncSession, *, caller_id: uuid.UUID, token: uuid.UUID
) -> dict:
    """Dəvəti rədd et (decline_brigade_invite RPC portu)."""
    invite = (
        await db.execute(
            text("select id from brigade_invites"
                 " where token = :t and status = 'pending' for update"),
            {"t": token},
        )
    ).first()
    if invite is None:
        raise BrigadeError("Dəvət tapılmadı və ya artıq cavablanıb")
    await db.execute(
        text("update brigade_invites set status='declined',"
             " responded_at = now() where id = :id"),
        {"id": invite.id},
    )
    return {"ok": True}


# ── Təyinatlar ──────────────────────────────────────────────────────────


async def _assignment_notice(
    db: AsyncSession, *, assignment_id, brigade_id, member_id, source_id: str,
    status: str,
) -> Notice | None:
    """notify_member_on_assignment trigger-inin portu (offered/assigned)."""
    if status not in ("offered", "assigned"):
        return None
    member = (
        await db.execute(
            text("select profile_id from brigade_members where id = :id"),
            {"id": member_id},
        )
    ).first()
    if member is None:
        return None
    brig = (
        await db.execute(
            text("select name from brigades where id = :id"), {"id": brigade_id}
        )
    ).first()
    brigade_name = brig.name if brig else None
    opp = (
        await db.execute(
            text("select title from opportunities where id::text = :s"),
            {"s": source_id},
        )
    ).first()
    opp_title = opp.title if opp else None

    kind = "brigade_offer" if status == "offered" else "brigade_assignment"
    title = (brigade_name or "Briqada") + " — " + \
        ("yeni sifariş" if status == "offered" else "yeni təyinat")
    body = (opp_title or "Sifariş") + " — " + \
        ("ilk qəbul edən qazanır" if status == "offered" else "sənə təyin edildi")
    return await _insert_notice(
        db, user_id=member.profile_id, title=title, body=body, kind=kind,
        related_id=str(assignment_id), link="/account/master/incoming")


_NIL_UUID = uuid.UUID(int=0)


async def auto_broadcast_opportunity(
    db: AsyncSession, opp_id: uuid.UUID
) -> list[Notice]:
    """Yeni sifarişi uyğun briqadaların online üzvlərinə “ilk qəbul edən
    qazanır” təklifi kimi yayır (auto_broadcast_opportunity RPC portu).

    Uyğunluq: briqadanın həmin kateqoriya üçün aktiv qiyməti (brigade_prices)
    var; üzv aktiv + online-dır, sifarişin sahibi deyil və qlobal bloklanmayıb.
    Hər yeni `offered` təyinat üçün notify_member_on_assignment bildirişi
    yazılır; qaytarılan Notice siyahısı (uzunluğu = yeni təyinat sayı)
    commit-dən SONRA dispatch edilməlidir. Təkrar çağırış idempotentdir
    (unikal (brigade_id, source_id, member_id) → heç nə əlavə olunmur).

    Orijinalda bu funksiyanı tg_opportunity_auto_broadcast trigger-i çağırırdı
    (yalnız açıq statuslu, kateqoriyalı yeni sifariş üçün, xətanı udaraq) —
    çağıran tərəf onu SAVEPOINT (db.begin_nested) daxilində işlətməlidir ki,
    yayım xətası sifarişin yaranmasını bloklamasın.
    """
    opp = (
        await db.execute(
            text("select id, category_id, subcategory_id, status, created_by"
                 "  from opportunities where id = :id"),
            {"id": opp_id},
        )
    ).first()
    if opp is None:
        return []
    source_id = str(opp_id)

    # Bu sifarişi artıq kimsə götürübsə (accepted/in_progress/completed) — skip
    taken = (
        await db.execute(
            text(
                "select 1 from brigade_assignments"
                " where source_id = :s"
                "   and status in ('accepted','in_progress','completed') limit 1"
            ),
            {"s": source_id},
        )
    ).first()
    if taken:
        return []

    rows = (
        await db.execute(
            text(
                "insert into brigade_assignments"
                " (brigade_id, member_id, source_type, source_id, assigned_by,"
                "  status, priority)"
                " select distinct bp.brigade_id, bm.id, 'opportunity',"
                "        cast(:s as text), cast(null as uuid), 'offered', 5"
                "   from brigade_prices bp"
                "   join brigade_members bm on bm.brigade_id = bp.brigade_id"
                "  where bp.category_id = :cat"
                "    and bp.is_active = true"
                "    and (bp.subcategory_id is null or bp.subcategory_id = :sub)"
                "    and bm.is_active = true"
                "    and bm.is_online = true"
                "    and bm.profile_id <> :creator"
                # Bloklananları çıxar
                "    and not exists ("
                "      select 1 from user_blocks ub"
                "       where ub.blocked_id = bm.profile_id"
                "         and ub.scope = 'global')"
                # artıq broadcast olunmuş (SQL: exception when unique_violation)
                " on conflict (brigade_id, source_id, member_id) do nothing"
                " returning id, brigade_id, member_id"
            ),
            {"s": source_id, "cat": opp.category_id, "sub": opp.subcategory_id,
             "creator": opp.created_by or _NIL_UUID},
        )
    ).all()

    notices: list[Notice] = []
    for r in rows:
        # yeni insert → notify_member_on_assignment trigger bildirişi
        notice = await _assignment_notice(
            db, assignment_id=r.id, brigade_id=r.brigade_id,
            member_id=r.member_id, source_id=source_id, status="offered")
        if notice:
            notices.append(notice)
    return notices


async def brigade_assign_order(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    source_type: str, source_id: str, member_ids: list[uuid.UUID],
    notes: str | None = None, priority: int = 5,
) -> dict:
    """Sifarişi üzv(lər)ə təyin et (brigade_assign_order RPC portu)."""
    role = await brigade_role(db, brigade_id, caller_id)
    if role not in ("owner", "dispatcher"):
        raise BrigadeError("Yalnız sahib/dispatcher təyin edə bilər")
    if not member_ids:
        raise BrigadeError("Ən azı bir member_id tələb olunur")

    notices: list[Notice] = []
    count = 0
    for member_id in member_ids:
        member = (
            await db.execute(
                text(
                    "select 1 from brigade_members bm"
                    " where bm.id = :m and bm.brigade_id = :b"
                    "   and bm.is_active = true"
                ),
                {"m": member_id, "b": brigade_id},
            )
        ).first()
        if member is None:
            raise BrigadeError(f"Üzv {member_id} bu briqadaya aid deyil")

        row = (
            await db.execute(
                text(
                    "insert into brigade_assignments"
                    " (brigade_id, member_id, source_type, source_id,"
                    "  assigned_by, notes, priority)"
                    " values (:b, :m, :st, :s, :u, :n, :p)"
                    " on conflict (brigade_id, source_id, member_id) do nothing"
                    " returning id"
                ),
                {"b": brigade_id, "m": member_id, "st": source_type,
                 "s": source_id, "u": caller_id, "n": notes, "p": priority},
            )
        ).first()
        count += 1
        if row is not None:  # yeni insert → trigger bildirişi
            notice = await _assignment_notice(
                db, assignment_id=row.id, brigade_id=brigade_id,
                member_id=member_id, source_id=source_id, status="assigned")
            if notice:
                notices.append(notice)
    return {"ok": True, "count": count, "_notices": notices}


async def brigade_place_offer(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    opportunity_id: uuid.UUID, amount: Decimal, notes: str | None = None,
) -> dict:
    """Briqada adından təklif (brigade_place_offer RPC portu).

    Müştəriyə bildirişi ÇAĞIRAN yazır (REST marşrutu öz mətnini, RPC adapteri
    isə notify_customer_on_new_offer trigger-inin portunu işlədir) — ona görə
    nəticədə `_customer_id` və `_brigade_name` köməkçi sahələri var.

    Komissiya hesabı REST marşrutundan olduğu kimi köçürülüb:
    `brigade_commission_on_accept` (yoxdursa `commission_on_accept`).
    """
    if amount is None or amount <= 0:
        raise BrigadeError("Bid məbləği müsbət olmalıdır")
    # Yalnız dispatcher/owner
    if not await is_brigade_dispatcher(db, brigade_id, caller_id):
        raise BrigadeError("Yalnız briqada sahibi və ya dispatcher təklif verə bilər")

    # Komissiya üçün komanda balansı kifayətdirmi (nağd ssenarisi üçün tələb)
    pct_row = (
        await db.execute(
            text(
                "select coalesce((select (value #>> '{}')::numeric from platform_config"
                "  where key='brigade_commission_on_accept'),"
                " (select (value #>> '{}')::numeric from platform_config"
                "  where key='commission_on_accept'), 0) as pct"
            )
        )
    ).first()
    commission_pct = Decimal(pct_row.pct)
    commission = _round2(amount * commission_pct / 100)
    brig = (
        await db.execute(
            text("select coalesce(balance,0) as b, name from brigades where id=:id"),
            {"id": brigade_id},
        )
    ).first()
    if brig is None:
        raise BrigadeError("Komanda tapılmadı")
    if Decimal(brig.b) < commission:
        raise BrigadeError(
            f"NO_BALANCE: Briqada balansında minimum {commission} AZN"
            f" olmalıdır (komissiya faizi: {commission_pct}), cari: {brig.b} AZN")

    opp = (
        await db.execute(
            text("select id, status, created_by from opportunities where id=:id"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise BrigadeError("Sifariş tapılmadı")
    if opp.created_by == caller_id:
        raise BrigadeError("Öz sifarişinizə təklif verə bilməzsiniz")
    if opp.status not in _OPEN_STATUSES:
        raise BrigadeError("Sifariş artıq aktiv deyil")

    # Bu briqada artıq təklif veribsə skip
    dup = (
        await db.execute(
            text(
                "select 1 from opportunities_offers"
                " where opportunity_id=:opp and brigade_id=:b and status='pending'"
            ),
            {"opp": opportunity_id, "b": brigade_id},
        )
    ).first()
    if dup:
        raise BrigadeError("Briqada artıq bu sifarişə təklif verib")

    # provider_id = dispatcher (kim göndərdi) — briqada təklifi brigade_id
    # ilə fərqləndirilir
    row = (
        await db.execute(
            text(
                "insert into opportunities_offers"
                " (opportunity_id, provider_id, brigade_id, offer_amount, status, notes)"
                " values (:opp, :u, :b, :a, 'pending', :n) returning id"
            ),
            {"opp": opportunity_id, "u": caller_id, "b": brigade_id,
             "a": amount, "n": notes},
        )
    ).first()
    return {"ok": True, "offer_id": str(row.id), "amount": str(amount),
            "required_balance": str(commission),
            "_customer_id": opp.created_by, "_brigade_name": brig.name}


async def brigade_dispatch_order(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    source_id: str, member_ids: list[uuid.UUID], priority: int = 5,
    notes: str | None = None,
) -> dict:
    """İşçi(lər)i sifarişə təyin et (brigade_dispatch_order RPC portu).

    Orijinaldan sərt: üzv həmin briqadaya aid olmalıdır (SQL bunu yoxlamırdı —
    dispatcher başqa briqadanın üzvünə təyinat/bildiriş yaza bilirdi).
    Hər yeni təyinat üçün notify_member_on_assignment trigger-inin bildirişi
    yazılır; `_notices` commit-dən SONRA dispatch edilməlidir.
    """
    if not await is_brigade_dispatcher(db, brigade_id, caller_id):
        raise BrigadeError("Yalnız briqada sahibi və ya dispatcher təyin edə bilər")
    if not member_ids:
        raise BrigadeError("Ən azı bir member_id tələb olunur")
    if not (source_id or "").strip():
        raise BrigadeError("source_id tələb olunur")

    notices: list[Notice] = []
    inserted = 0
    for member_id in member_ids:
        member = (
            await db.execute(
                text("select 1 from brigade_members"
                     " where id = :m and brigade_id = :b"),
                {"m": member_id, "b": brigade_id},
            )
        ).first()
        if member is None:
            raise BrigadeError(f"Üzv {member_id} bu briqadaya aid deyil")
        row = (
            await db.execute(
                text(
                    "insert into brigade_assignments"
                    " (brigade_id, member_id, source_type, source_id,"
                    "  assigned_by, status, notes, priority)"
                    " values (:b, :m, 'opportunity', :s, :u, 'assigned', :n, :p)"
                    # Bu member-ə artıq təyin edilib — keç (SQL: unique_violation)
                    " on conflict (brigade_id, source_id, member_id) do nothing"
                    " returning id"
                ),
                {"b": brigade_id, "m": member_id, "s": source_id,
                 "u": caller_id, "n": notes, "p": priority},
            )
        ).first()
        if row is None:
            continue
        inserted += 1
        notice = await _assignment_notice(
            db, assignment_id=row.id, brigade_id=brigade_id,
            member_id=member_id, source_id=source_id, status="assigned")
        if notice:
            notices.append(notice)

    await _audit(db, actor=caller_id, action="brigade_dispatch",
                 target_type="brigade_assignment", target_id=source_id,
                 payload={"brigade_id": str(brigade_id),
                          "member_count": inserted, "priority": priority})
    return {"ok": True, "inserted": inserted, "_notices": notices}


async def brigade_dispatch_assign(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    opportunity_id: uuid.UUID, member_id: uuid.UUID, amount: Decimal,
    notes: str | None = None,
) -> dict:
    """Dispatcher sifarişi konkret işçiyə yönləndirir — işçi adından təklif
    + təyinat (brigade_dispatch_assign RPC portu, re-route + 10s cooldown)."""
    if amount is None or amount <= 0:
        raise BrigadeError("Təklif məbləği müsbət olmalıdır")
    if not await is_brigade_dispatcher(db, brigade_id, caller_id):
        raise BrigadeError("Yalnız briqada sahibi və ya dispatcher sifariş yönləndirə bilər")

    opp = (
        await db.execute(
            text("select id, status, budget, created_by, accepted_offer_id"
                 " from opportunities where id = :id for update"),
            {"id": opportunity_id},
        )
    ).first()
    if opp is None:
        raise BrigadeError("Sifariş tapılmadı")
    if opp.created_by == caller_id:
        raise BrigadeError("Öz sifarişinizi yönləndirə bilməzsiniz")

    # Başqası (başqa briqada/işçi) götürübsə
    if opp.accepted_offer_id is not None or opp.status not in _OPEN_STATUSES:
        raise BrigadeError("ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb")
    other = (
        await db.execute(
            text(
                "select 1 from brigade_assignments"
                " where source_id = :s and brigade_id <> :b"
                "   and status in ('accepted','in_progress','completed')"
            ),
            {"s": str(opportunity_id), "b": brigade_id},
        )
    ).first()
    if other:
        raise BrigadeError("ALREADY_TAKEN: Sifariş artıq başqasına bağlanıb")

    # ── RE-ROUTE + 10 SANİYƏ COOLDOWN ──
    # Bu briqadanın bu sifariş üzrə cari aktiv təyinatı (istənilən işçi)
    cur = (
        await db.execute(
            text(
                "select id, member_id, status, assigned_at,"
                "       extract(epoch from (now() - assigned_at)) as age_s"
                "  from brigade_assignments"
                " where brigade_id = :b and source_id = :s"
                "   and status in ('assigned','accepted','in_progress')"
                " order by assigned_at desc limit 1"
            ),
            {"b": brigade_id, "s": str(opportunity_id)},
        )
    ).first()
    rerouted = cur is not None and cur.member_id != member_id
    if rerouted:
        # İş artıq qəbul edilib/başlayıbsa dəyişmək olmaz
        if cur.status in ("accepted", "in_progress"):
            raise BrigadeError(
                "Bu sifariş artıq işçi tərəfindən qəbul edilib — işçini dəyişmək olmaz")
        # 10 saniyə cooldown (son yönləndirmədən)
        age = Decimal(str(cur.age_s))
        if age < 10:
            wait = int(-(-(10 - age) // 1))  # ceil
            raise BrigadeError(
                f"COOLDOWN: Yönləndirməni dəyişmək üçün 10 saniyə gözləyin ({wait})")
        # Köhnə işçinin təyinatını ləğv et
        await db.execute(
            text("update brigade_assignments set status='cancelled',"
                 " responded_at = now() where id = :id"),
            {"id": cur.id},
        )

    # İşçi
    member = (
        await db.execute(
            text(
                "select bm.id, bm.profile_id from brigade_members bm"
                " where bm.id = :m and bm.brigade_id = :b and bm.is_active = true"
            ),
            {"m": member_id, "b": brigade_id},
        )
    ).first()
    if member is None:
        raise BrigadeError("İşçi bu briqadanın aktiv üzvü deyil")
    profile_id = member.profile_id
    if profile_id == opp.created_by:
        raise BrigadeError("İşçi sifarişin sahibi ola bilməz")

    # Komissiya (briqada balansı operativ gate)
    commission_pct = await _config_pct(db, "commission_on_accept")
    commission_amt = _round2(amount * commission_pct / 100)
    brig = (
        await db.execute(
            text("select coalesce(balance,0) as b from brigades where id = :id"),
            {"id": brigade_id},
        )
    ).first()
    if brig is None or Decimal(brig.b) < commission_amt:
        bal = Decimal(brig.b) if brig else Decimal(0)
        raise BrigadeError(
            f"NO_BALANCE: Briqada balansında minimum {commission_amt} AZN"
            f" olmalıdır (komissiya faizi: {commission_pct}), cari: {bal} AZN")

    # Təklif işçinin adından
    offer = (
        await db.execute(
            text(
                "select id from opportunities_offers"
                " where opportunity_id = :opp and brigade_id = :b"
                "   and status = 'pending' limit 1"
            ),
            {"opp": opportunity_id, "b": brigade_id},
        )
    ).first()
    offer_notices: list[Notice] = []
    if offer is None:
        offer = (
            await db.execute(
                text(
                    "insert into opportunities_offers (opportunity_id,"
                    " provider_id, brigade_id, offer_amount, status, notes)"
                    " values (:opp, :p, :b, :a, 'pending', :n) returning id"
                ),
                {"opp": opportunity_id, "p": profile_id, "b": brigade_id,
                 "a": amount, "n": notes},
            )
        ).first()
        # yeni insert → notify_customer_on_new_offer trigger bildirişi
        # (orijinalda trigger AFTER INSERT idi — update yolunda bildiriş yox)
        offer_notices = await notify.notify_new_offer(db, offer_id=offer.id)
    else:
        await db.execute(
            text(
                "update opportunities_offers set provider_id = :p,"
                " offer_amount = :a, notes = coalesce(:n, notes) where id = :id"
            ),
            {"p": profile_id, "a": amount, "n": notes, "id": offer.id},
        )
    offer_id = offer.id

    # İşçiyə təyinat
    notices: list[Notice] = list(offer_notices)
    existing = (
        await db.execute(
            text(
                "select id from brigade_assignments"
                " where brigade_id = :b and source_id = :s and member_id = :m"
            ),
            {"b": brigade_id, "s": str(opportunity_id), "m": member_id},
        )
    ).first()
    if existing is None:
        asg = (
            await db.execute(
                text(
                    "insert into brigade_assignments (brigade_id, member_id,"
                    " source_type, source_id, assigned_by, status, notes, priority)"
                    " values (:b, :m, 'opportunity', :s, :u, 'assigned', :n, 5)"
                    " returning id"
                ),
                {"b": brigade_id, "m": member_id, "s": str(opportunity_id),
                 "u": caller_id, "n": notes},
            )
        ).first()
        assignment_id = asg.id
        # yeni insert → notify_member_on_assignment trigger bildirişi
        notice = await _assignment_notice(
            db, assignment_id=assignment_id, brigade_id=brigade_id,
            member_id=member_id, source_id=str(opportunity_id),
            status="assigned")
        if notice:
            notices.append(notice)
    else:
        asg = (
            await db.execute(
                text(
                    "update brigade_assignments set status='assigned',"
                    " assigned_by = :u, notes = coalesce(:n, notes),"
                    " responded_at = null, assigned_at = now()"
                    " where id = :id returning id"
                ),
                {"u": caller_id, "n": notes, "id": existing.id},
            )
        ).first()
        assignment_id = asg.id
        brig_name = (
            await db.execute(
                text("select name from brigades where id = :id"),
                {"id": brigade_id},
            )
        ).first()
        notices.append(await _insert_notice(
            db, user_id=profile_id,
            title=f"{(brig_name.name if brig_name else None) or 'Briqada'} — yeni təyinat",
            body="Sifariş sənə təyin edildi. Qəbul və ya rədd et.",
            kind="brigade_assignment", related_id=str(assignment_id),
            link="/account/master/incoming"))

    # Audit (best-effort)
    names = (
        await db.execute(
            text(
                "select (select name from brigades where id = :b) as brigade,"
                "       (select name from profiles where id = :d) as dispatcher,"
                "       (select name from profiles where id = :w) as worker"
            ),
            {"b": brigade_id, "d": caller_id, "w": profile_id},
        )
    ).first()
    await _audit(
        db, actor=caller_id, action="brigade_dispatch_assign",
        target_type="opportunity_offer", target_id=str(offer_id),
        payload={
            "brigade_id": str(brigade_id), "brigade_name": names.brigade,
            "opportunity_id": str(opportunity_id), "member_id": str(member_id),
            "worker_profile_id": str(profile_id), "worker_name": names.worker,
            "dispatcher_id": str(caller_id), "dispatcher_name": names.dispatcher,
            "rerouted": rerouted, "on_behalf_of_worker": True,
            "amount": str(amount),
        })

    return {"ok": True, "offer_id": str(offer_id),
            "assignment_id": str(assignment_id), "provider_id": str(profile_id),
            "amount": str(amount), "required_balance": str(commission_amt),
            "rerouted": rerouted, "_notices": notices}


async def _load_assignment(
    db: AsyncSession, assignment_id: uuid.UUID, *, lock: bool = False
):
    """Təyinat + üzvün profile_id-si (bütün respond axınlarının ortaq hissəsi)."""
    row = (
        await db.execute(
            text(
                "select a.id, a.brigade_id, a.member_id, a.source_id, a.status,"
                "       m.profile_id as member_profile_id"
                "  from brigade_assignments a"
                "  join brigade_members m on m.id = a.member_id"
                " where a.id = :id" + (" for update of a" if lock else "")
            ),
            {"id": assignment_id},
        )
    ).first()
    if row is None:
        raise BrigadeError("Təyinat tapılmadı")
    return row


async def brigade_assignment_respond(
    db: AsyncSession, *, caller_id: uuid.UUID, assignment_id: uuid.UUID,
    action: str,
) -> dict:
    """Üzv təyinatı qəbul/rədd edir (brigade_assignment_respond portu)."""
    if action not in ("accept", "decline"):
        raise BrigadeError("Yanlış əməliyyat (accept | decline)")
    a = await _load_assignment(db, assignment_id)
    if a.member_profile_id != caller_id:
        raise BrigadeError("Yalnız təyin olunmuş üzv cavab verə bilər")
    if a.status != "assigned":
        raise BrigadeError(f"Təyinat artıq '{a.status}' statusundadır")
    await db.execute(
        text("update brigade_assignments set status = :st,"
             " responded_at = now() where id = :id"),
        {"st": "accepted" if action == "accept" else "declined",
         "id": assignment_id},
    )
    return {"ok": True, "status": "accepted" if action == "accept" else "declined"}


async def brigade_assignment_start(
    db: AsyncSession, *, caller_id: uuid.UUID, assignment_id: uuid.UUID
) -> dict:
    """İşə başla (brigade_assignment_start RPC portu)."""
    a = await _load_assignment(db, assignment_id, lock=True)
    if a.member_profile_id != caller_id:
        raise BrigadeError("Yalnız təyin olunmuş üzv başlaya bilər")
    if a.status not in ("accepted", "assigned"):
        raise BrigadeError(f"'{a.status}' statusundan başlamaq olmaz")
    await db.execute(
        text("update brigade_assignments set status='in_progress',"
             " responded_at = coalesce(responded_at, now()) where id = :id"),
        {"id": assignment_id},
    )
    return {"ok": True, "status": "in_progress"}


async def brigade_assignment_complete(
    db: AsyncSession, *, caller_id: uuid.UUID, assignment_id: uuid.UUID
) -> dict:
    """Təyinatı tamamla — üzv özü VƏ YA dispatcher (..._complete portu)."""
    a = await _load_assignment(db, assignment_id)
    if a.member_profile_id != caller_id and \
            not await is_brigade_dispatcher(db, a.brigade_id, caller_id):
        raise BrigadeError("İcazə yoxdur")
    if a.status not in ("accepted", "in_progress"):
        raise BrigadeError(f"'{a.status}' statusundan tamamlamaq olmaz")
    await db.execute(
        text("update brigade_assignments set status='completed',"
             " completed_at = now() where id = :id"),
        {"id": assignment_id},
    )
    return {"ok": True, "status": "completed"}


async def claim_opportunity(
    db: AsyncSession, *, caller_id: uuid.UUID, assignment_id: uuid.UUID
) -> dict:
    """“İlk qəbul edən qazanır” — offer-i götür (claim_opportunity portu)."""
    a = await _load_assignment(db, assignment_id, lock=True)
    if a.member_profile_id != caller_id:
        raise BrigadeError("Yalnız təyin olunmuş üzv götürə bilər")
    if a.status not in ("offered", "assigned"):
        raise BrigadeError(f"Təyinat artıq '{a.status}' statusundadır")

    # Başqa biri artıq qəbul edibmi? (eyni source_id üçün)
    other = (
        await db.execute(
            text(
                "select count(*) as c from brigade_assignments"
                " where source_id = :s and id <> :id"
                "   and status in ('accepted','in_progress','completed')"
            ),
            {"s": a.source_id, "id": a.id},
        )
    ).first()
    if other.c > 0:
        # Bu offer-i avtomatik expired et
        await db.execute(
            text("update brigade_assignments set status='expired',"
                 " responded_at = now() where id = :id"),
            {"id": a.id},
        )
        raise BrigadeError("Sifariş artıq başqa işçi tərəfindən qəbul edildi")

    # Qəbul et
    await db.execute(
        text("update brigade_assignments set status='accepted',"
             " responded_at = now() where id = :id"),
        {"id": a.id},
    )
    # Eyni opportunity üzrə qalan offerləri expired et
    await db.execute(
        text(
            "update brigade_assignments set status='expired',"
            " responded_at = now()"
            " where source_id = :s and id <> :id"
            "   and status in ('offered','assigned')"
        ),
        {"s": a.source_id, "id": a.id},
    )
    await _audit(db, actor=caller_id, action="opportunity_claim",
                 target_type="brigade_assignment", target_id=str(a.id),
                 payload={"source_id": a.source_id,
                          "brigade_id": str(a.brigade_id)})
    return {"ok": True, "status": "accepted"}


async def decline_offer(
    db: AsyncSession, *, caller_id: uuid.UUID, assignment_id: uuid.UUID
) -> dict:
    """Təklif olunan işi rədd et (decline_offer RPC portu)."""
    a = await _load_assignment(db, assignment_id)
    if a.member_profile_id != caller_id:
        raise BrigadeError("İcazə yoxdur")
    if a.status not in ("offered", "assigned"):
        raise BrigadeError(f"'{a.status}' statusunu rədd etmək olmaz")
    await db.execute(
        text("update brigade_assignments set status='declined',"
             " responded_at = now() where id = :id"),
        {"id": assignment_id},
    )
    return {"ok": True, "status": "declined"}


# ── Pul axınları ────────────────────────────────────────────────────────


async def brigade_top_up_from_owner(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    amount: Decimal,
) -> dict:
    """Sahibin şəxsi balansından briqada balansına köçürmə
    (brigade_top_up_from_owner RPC portu)."""
    if amount is None or amount <= 0:
        raise BrigadeError("Məbləğ müsbət olmalıdır")

    brig = (
        await db.execute(
            text("select owner_id from brigades where id = :id for update"),
            {"id": brigade_id},
        )
    ).first()
    if brig is None:
        raise BrigadeError("Briqada tapılmadı")
    if brig.owner_id != caller_id:
        raise BrigadeError("Yalnız briqada sahibi top-up edə bilər")

    owner = (
        await db.execute(
            text("select coalesce(balance,0) as b from profiles"
                 " where id = :u for update"),
            {"u": caller_id},
        )
    ).first()
    if owner is None or Decimal(owner.b) < amount:
        bal = Decimal(owner.b) if owner else Decimal(0)
        raise BrigadeError(
            f"INSUFFICIENT_BALANCE: Şəxsi balans yetərli deyil (cari: {bal} ₼)")

    # Atomik köçürmə
    new_owner = (
        await db.execute(
            text(
                "update profiles set balance = balance - :a"
                " where id = :u and coalesce(balance,0) >= :a returning balance"
            ),
            {"a": amount, "u": caller_id},
        )
    ).first()
    if new_owner is None:
        raise BrigadeError("INSUFFICIENT_BALANCE")
    new_brigade = (
        await db.execute(
            text("update brigades set balance = coalesce(balance,0) + :a,"
                 " updated_at = now() where id = :id returning balance"),
            {"a": amount, "id": brigade_id},
        )
    ).first()

    await _log_tx(db, user_id=caller_id, tx_type="admin_adjust", amount=-amount,
                  balance_after=Decimal(new_owner.balance),
                  description=f"Briqada balansına köçürmə ({brigade_id})",
                  related_id=str(brigade_id), created_by=caller_id)

    return {"ok": True, "brigade_balance": str(new_brigade.balance),
            "owner_balance": str(new_owner.balance)}


async def brigade_distribute_balance(
    db: AsyncSession, *, caller_id: uuid.UUID, brigade_id: uuid.UUID,
    allocations: list[dict],
) -> dict:
    """Briqada balansını üzvlərə payla (brigade_distribute_balance portu).

    allocations: [{"profile_id": uuid, "amount": Decimal}, ...]
    """
    if not allocations:
        raise BrigadeError("Bölgü siyahısı boşdur")

    brig = (
        await db.execute(
            text("select owner_id, coalesce(balance,0) as b"
                 " from brigades where id = :id for update"),
            {"id": brigade_id},
        )
    ).first()
    if brig is None:
        raise BrigadeError("Briqada tapılmadı")
    if brig.owner_id != caller_id:
        raise BrigadeError("Yalnız briqada sahibi pul bölgüsü edə bilər")

    # 1-ci keçid: validasiya + cəm
    total = Decimal(0)
    count = 0
    items: list[tuple[uuid.UUID, Decimal]] = []
    for item in allocations:
        pid = item.get("profile_id")
        amt = item.get("amount")
        if pid is None:
            raise BrigadeError("profile_id boşdur")
        amt = _round2(Decimal(str(amt))) if amt is not None else None
        if amt is None or amt <= 0:
            raise BrigadeError(f"Məbləğ müsbət olmalıdır (profil {pid})")
        member = (
            await db.execute(
                text(
                    "select 1 from brigade_members bm"
                    " where bm.brigade_id = :b and bm.profile_id = :p"
                    "   and bm.is_active = true"
                ),
                {"b": brigade_id, "p": pid},
            )
        ).first()
        if member is None:
            raise BrigadeError(f"Profil {pid} bu briqadanın aktiv üzvü deyil")
        items.append((pid, amt))
        total += amt
        count += 1

    if total > Decimal(brig.b):
        raise BrigadeError(
            f"NO_BALANCE: Briqada balansı yetərli deyil"
            f" (lazım: {total} AZN, mövcud: {brig.b} AZN)")

    new_brigade = (
        await db.execute(
            text("update brigades set balance = balance - :t,"
                 " updated_at = now() where id = :id returning balance"),
            {"t": total, "id": brigade_id},
        )
    ).first()

    # 2-ci keçid: balans + ledger yazıları
    for pid, amt in items:
        member_bal = (
            await db.execute(
                text("update profiles set balance = coalesce(balance,0) + :a"
                     " where id = :p returning balance"),
                {"a": amt, "p": pid},
            )
        ).first()
        await _log_tx(db, user_id=pid, tx_type="brigade_payout", amount=amt,
                      balance_after=Decimal(member_bal.balance),
                      description="Briqada pul bölgüsü",
                      related_id=str(brigade_id), created_by=caller_id)

    await _log_tx(db, user_id=caller_id, tx_type="brigade_payout",
                  amount=-total, balance_after=Decimal(new_brigade.balance),
                  description=f"Üzvlərə pul bölgüsü ({count} nəfər)",
                  related_id=str(brigade_id), created_by=caller_id)
    await _audit(db, actor=caller_id, action="brigade_payout",
                 target_type="brigade", target_id=str(brigade_id),
                 payload={"total": str(total), "count": count,
                          "allocations": [
                              {"profile_id": str(p), "amount": str(a)}
                              for p, a in items]})

    return {"ok": True, "total": str(total), "count": count,
            "brigade_balance": str(new_brigade.balance)}
