"""Çıxarışlar — usta pul çıxarır, admin emal edir."""
from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.services import marketplace
from app.services.marketplace import OpError
from app.services.realtime import publish

router = APIRouter(prefix="/withdrawals", tags=["withdrawals"])


class WithdrawalIn(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("100000"))
    bank_card: str = Field(min_length=8, max_length=32)


class ProcessIn(BaseModel):
    approve: bool
    admin_notes: str | None = Field(default=None, max_length=500)


@router.post("", status_code=201)
async def request_withdrawal(
    body: WithdrawalIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    if user.role != "provider":
        raise HTTPException(status_code=403, detail="Yalnız ustalar çıxarış edə bilər")
    pending = (
        await db.execute(
            text("select 1 from withdrawals where provider_id=:u and status='pending'"),
            {"u": user.id},
        )
    ).first()
    if pending:
        raise HTTPException(status_code=409, detail="Gözləyən çıxarış sorğunuz var")

    # Minimum məbləğ, balansdan tutma, komissiya və qeydlər ortaq servisdədir
    # (request_withdrawal RPC ilə eyni kod)
    try:
        res = await marketplace.request_withdrawal(
            db, caller_id=user.id, amount=body.amount, bank_card=body.bank_card)
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {"id": str(res["id"]), "net_amount": str(res["net_amount"]),
            "commission": str(res["commission"])}


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


class WithdrawalError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


async def process_withdrawal_core(
    db: AsyncSession, *, withdrawal_id: uuid.UUID, approve: bool,
    admin_notes: str | None, admin_id: uuid.UUID, external_id: str | None = None,
) -> dict:
    """Çıxarışın emalı (admin_process_withdrawal portu) — REST marşrutu və
    Supabase-uyğun `process-withdrawal` funksiyası ortaq istifadə edir.
    Admin səlahiyyətini çağıran yoxlayır. `external_id` — bank köçürməsinin
    (Epoint payout) əməliyyat nömrəsi, varsa."""
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
        raise WithdrawalError(404, "Çıxarış tapılmadı")
    if w.status != "pending":
        raise WithdrawalError(409, "Artıq emal olunub")

    new_status = "processed" if approve else "rejected"
    await db.execute(
        text(
            "update withdrawals set status=:s, admin_notes=:n, processed_at=now(),"
            " external_id = coalesce(cast(:x as text), external_id)"
            " where id=:id"
        ),
        {"s": new_status, "n": admin_notes, "x": external_id, "id": withdrawal_id},
    )
    if not approve:
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
             "r": str(withdrawal_id), "adm": admin_id},
        )
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, 'withdrawal', :t, :b, :r)"
        ),
        {"u": w.provider_id,
         "t": "Çıxarış emal olundu ✅" if approve else "Çıxarış rədd edildi",
         "b": "Vəsait kartınıza göndərildi" if approve
              else f"Məbləğ balansınıza qaytarıldı. {admin_notes or ''}",
         "r": str(withdrawal_id)},
    )
    await db.commit()
    await publish(w.provider_id, "withdrawal.processed",
                  {"id": str(withdrawal_id), "approved": approve})
    return {"ok": True, "status": new_status}


@router.post("/{withdrawal_id}/process")
async def process(
    withdrawal_id: uuid.UUID,
    body: ProcessIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        return await process_withdrawal_core(
            db, withdrawal_id=withdrawal_id, approve=body.approve,
            admin_notes=body.admin_notes, admin_id=admin.id)
    except WithdrawalError as e:
        raise HTTPException(status_code=e.status, detail=e.message) from e
