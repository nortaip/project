"""Çıxarışlar — usta pul çıxarır, admin emal edir."""
from __future__ import annotations

import uuid
from decimal import Decimal, ROUND_HALF_UP

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.services.realtime import publish

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


class WithdrawalIn(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("100000"))
    bank_card: str = Field(min_length=8, max_length=32)


class ProcessIn(BaseModel):
    approve: bool
    admin_notes: str | None = Field(default=None, max_length=500)


async def _pct(db: AsyncSession, key: str, default: str = "0") -> Decimal:
    row = (
        await db.execute(
            text("select value #>> '{}' as v from platform_config where key=:k"),
            {"k": key},
        )
    ).first()
    return Decimal(str(row.v).strip('"')) if row and row.v else Decimal(default)


@router.post("", status_code=201)
async def request_withdrawal(
    body: WithdrawalIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.role != "provider":
        raise HTTPException(status_code=403, detail="Yalnız ustalar çıxarış edə bilər")
    min_amount = await _pct(db, "min_withdrawal_amount", "0")
    if body.amount < min_amount:
        raise HTTPException(status_code=400, detail=f"Minimum çıxarış {min_amount} ₼")

    pending = (
        await db.execute(
            text("select 1 from withdrawals where provider_id=:u and status='pending'"),
            {"u": user.id},
        )
    ).first()
    if pending:
        raise HTTPException(status_code=409, detail="Gözləyən çıxarış sorğunuz var")

    bal = (
        await db.execute(
            text("select coalesce(balance,0) as b from profiles where id=:u for update"),
            {"u": user.id},
        )
    ).first()
    if Decimal(bal.b) < body.amount:
        raise HTTPException(status_code=409, detail="Balans yetərsizdir")

    pct = await _pct(db, "commission_on_withdrawal")
    commission = (body.amount * pct / 100).quantize(Decimal("0.01"), ROUND_HALF_UP)
    net = body.amount - commission

    # Məbləğ dərhal balansdan tutulur (rədd olunsa geri qaytarılır)
    new_bal = (
        await db.execute(
            text("update profiles set balance = balance - :a where id=:u returning balance"),
            {"a": body.amount, "u": user.id},
        )
    ).first()
    row = (
        await db.execute(
            text(
                "insert into withdrawals (provider_id, amount_requested,"
                " commission_percent, commission_amount, net_amount, bank_card)"
                " values (:u, :a, :p, :c, :n, :card) returning id"
            ),
            {"u": user.id, "a": body.amount, "p": pct, "c": commission,
             "n": net, "card": body.bank_card},
        )
    ).first()
    await db.execute(
        text(
            "insert into transactions (user_id, type, amount, balance_after,"
            " description, related_id)"
            " values (:u, 'withdrawal', :a, :b, :d, :r)"
        ),
        {"u": user.id, "a": -body.amount, "b": new_bal.balance,
         "d": f"Çıxarış sorğusu (komissiya {pct}%: {commission} ₼, xalis {net} ₼)",
         "r": str(row.id)},
    )
    await db.commit()
    return {"id": str(row.id), "net_amount": str(net), "commission": str(commission)}


@router.get("/mine")
async def my_withdrawals(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    rows = await db.execute(
        text(
            "select id, amount_requested, commission_amount, net_amount, bank_card,"
            " status, requested_at, processed_at from withdrawals"
            " where provider_id = :u order by requested_at desc limit 50"
        ),
        {"u": user.id},
    )
    return [dict(r._mapping) for r in rows]


# ── Admin ─────────────────────────────────────────────────────────
@router.get("/pending")
async def pending(
    _admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    rows = await db.execute(
        text(
            "select w.id, w.provider_id, w.amount_requested, w.net_amount,"
            " w.bank_card, w.requested_at, p.name, p.email"
            "  from withdrawals w join profiles p on p.id = w.provider_id"
            " where w.status='pending' order by w.requested_at"
        )
    )
    return [dict(r._mapping) for r in rows]


@router.post("/{withdrawal_id}/process")
async def process(
    withdrawal_id: uuid.UUID,
    body: ProcessIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    w = (
        await db.execute(
            text(
                "select id, provider_id, amount_requested, status from withdrawals"
                " where id=:id for update"
            ),
            {"id": withdrawal_id},
        )
    ).first()
    if w is None:
        raise HTTPException(status_code=404, detail="Çıxarış tapılmadı")
    if w.status != "pending":
        raise HTTPException(status_code=409, detail="Artıq emal olunub")

    new_status = "processed" if body.approve else "rejected"
    await db.execute(
        text(
            "update withdrawals set status=:s, admin_notes=:n, processed_at=now()"
            " where id=:id"
        ),
        {"s": new_status, "n": body.admin_notes, "id": withdrawal_id},
    )
    if not body.approve:
        # Rədd → məbləğ geri qaytarılır
        new_bal = (
            await db.execute(
                text(
                    "update profiles set balance = coalesce(balance,0) + :a"
                    " where id=:u returning balance"
                ),
                {"a": w.amount_requested, "u": w.provider_id},
            )
        ).first()
        await db.execute(
            text(
                "insert into transactions (user_id, type, amount, balance_after,"
                " description, related_id, created_by)"
                " values (:u, 'refund', :a, :b, 'Çıxarış rədd edildi — geri qaytarma',"
                " :r, :adm)"
            ),
            {"u": w.provider_id, "a": w.amount_requested, "b": new_bal.balance,
             "r": str(withdrawal_id), "adm": admin.id},
        )
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, 'withdrawal', :t, :b, :r)"
        ),
        {"u": w.provider_id,
         "t": "Çıxarış emal olundu ✅" if body.approve else "Çıxarış rədd edildi",
         "b": "Vəsait kartınıza göndərildi" if body.approve
              else f"Məbləğ balansınıza qaytarıldı. {body.admin_notes or ''}",
         "r": str(withdrawal_id)},
    )
    await db.commit()
    await publish(w.provider_id, "withdrawal.processed",
                  {"id": str(withdrawal_id), "approved": body.approve})
    return {"ok": True, "status": new_status}
