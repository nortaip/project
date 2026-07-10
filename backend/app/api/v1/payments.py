"""Ödənişlər — balans artırma (Epoint), webhook, tarixçə."""
from __future__ import annotations

from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.session import get_db
from app.models.user import User
from app.services import epoint
from app.services.realtime import publish

router = APIRouter(prefix="/payments", tags=["payments"])


class TopUpIn(BaseModel):
    amount: Decimal = Field(gt=0, le=Decimal("10000"))
    success_url: str = Field(default="https://ellit.az/payment/result")
    error_url: str = Field(default="https://ellit.az/payment/result?status=failed")


@router.post("/top-up", status_code=201)
async def top_up(
    body: TopUpIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Balans artırma sessiyası — checkout_url qaytarır."""
    if not settings.EPOINT_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Ödəniş sistemi konfiqurasiya olunmayıb")
    order_id = epoint.new_order_id(user.id)
    await db.execute(
        text(
            "insert into payments (order_id, user_id, amount, status, method,"
            " provider, description)"
            " values (:o, :u, :a, 'pending', 'card', 'epoint', 'Balans artırma')"
        ),
        {"o": order_id, "u": user.id, "a": body.amount},
    )
    await db.commit()
    try:
        resp = await epoint.create_checkout(
            amount=str(body.amount), order_id=order_id,
            description=f"Ellit balans artırma — {user.email or user.id}",
            success_url=body.success_url, error_url=body.error_url,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Epoint xətası: {e}") from e
    if resp.get("status") != "success" or not resp.get("redirect_url"):
        raise HTTPException(status_code=502, detail="Epoint sessiya yaratmadı")
    return {"order_id": order_id, "checkout_url": resp["redirect_url"]}


@router.post("/webhook")
async def webhook(request: Request, db: AsyncSession = Depends(get_db)) -> dict:
    """Epoint callback — İMZA YOXLANIR, idempotentdir (public endpoint).

    Bank form-data göndərir: data=<b64>, signature=<b64(sha1)>.
    """
    form = await request.form()
    data_b64 = str(form.get("data") or "")
    signature = str(form.get("signature") or "")
    if not data_b64 or not signature:
        raise HTTPException(status_code=400, detail="data/signature yoxdur")
    if not epoint.verify_signature(data_b64, signature):
        # İmza yanlış = saxta callback cəhdi — audit üçün loglanır
        await db.execute(
            text(
                "insert into audit_log (action, target_type, payload)"
                " values ('webhook_bad_signature', 'payment',"
                " jsonb_build_object('data', cast(:d as text)))"
            ),
            {"d": data_b64[:500]},
        )
        await db.commit()
        raise HTTPException(status_code=403, detail="İmza yanlışdır")

    cb = epoint.decode_callback(data_b64)
    order_id = cb.get("order_id")
    status = cb.get("status")
    if not order_id:
        return {"ok": True, "skipped": "order_id yoxdur"}

    # İdempotent emal: yalnız pending → completed keçidi balans artırır
    pay = (
        await db.execute(
            text(
                "select id, user_id, amount, status from payments"
                " where order_id = :o for update"
            ),
            {"o": order_id},
        )
    ).first()
    if pay is None:
        return {"ok": True, "skipped": "naməlum order_id"}
    if pay.status != "pending":
        return {"ok": True, "skipped": "artıq emal olunub"}  # idempotency

    if status == "success":
        await db.execute(
            text(
                "update payments set status='completed', external_id=:t,"
                " completed_at=now(), paid_at=now() where id=:id"
            ),
            {"t": str(cb.get("transaction") or ""), "id": pay.id},
        )
        new_bal = (
            await db.execute(
                text(
                    "update profiles set balance = coalesce(balance,0) + :a"
                    " where id = :u returning balance"
                ),
                {"a": pay.amount, "u": pay.user_id},
            )
        ).first()
        await db.execute(
            text(
                "insert into transactions (user_id, type, amount, balance_after,"
                " description, related_id)"
                " values (:u, 'top_up', :a, :b, 'Balans artırma (Epoint)', :r)"
            ),
            {"u": pay.user_id, "a": pay.amount, "b": new_bal.balance, "r": order_id},
        )
        await db.execute(
            text(
                "insert into notifications (user_id, type, title, body, related_id)"
                " values (:u, 'payment', 'Balans artırıldı 💳',"
                " :b, :r)"
            ),
            {"u": pay.user_id, "b": f"{pay.amount} ₼ balansınıza əlavə olundu",
             "r": order_id},
        )
        await db.commit()
        await publish(pay.user_id, "payment.completed",
                      {"order_id": order_id, "amount": str(pay.amount)})
    else:
        await db.execute(
            text("update payments set status='failed' where id=:id"), {"id": pay.id}
        )
        await db.commit()
        await publish(pay.user_id, "payment.failed", {"order_id": order_id})
    return {"ok": True}


@router.get("/history")
async def history(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=100),
) -> list[dict]:
    rows = await db.execute(
        text(
            "select order_id, amount, status, method, description, created_at,"
            " completed_at from payments where user_id = :u"
            " order by created_at desc limit :l"
        ),
        {"u": user.id, "l": limit},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/transactions")
async def transactions(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=50, le=100),
    offset: int = 0,
) -> list[dict]:
    rows = await db.execute(
        text(
            "select type, amount, balance_after, description, related_id, created_at"
            " from transactions where user_id = :u"
            " order by created_at desc limit :l offset :o"
        ),
        {"u": user.id, "l": limit, "o": offset},
    )
    return [dict(r._mapping) for r in rows]
