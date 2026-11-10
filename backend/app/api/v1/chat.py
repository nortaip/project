"""Chat — söhbətlər və mesajlar (realtime yayım ilə)."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models.user import User
from app.services import marketplace
from app.services.marketplace import OpError
from app.services.realtime import publish

router = APIRouter(prefix="/chat", tags=["chat"])


class ConversationOpen(BaseModel):
    peer_id: uuid.UUID
    opportunity_id: uuid.UUID | None = None


class MessageIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)


async def _in_conversation(db: AsyncSession, conv_id: uuid.UUID, user_id: uuid.UUID):
    return (
        await db.execute(
            text(
                "select id, customer_id, provider_id from conversations"
                " where id=:c and (customer_id=:u or provider_id=:u)"
            ),
            {"c": conv_id, "u": user_id},
        )
    ).first()


@router.post("/conversations")
async def open_conversation(
    body: ConversationOpen,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """İdempotent: mövcud söhbət varsa onu qaytarır (open_conversation portu)."""
    if body.peer_id == user.id:
        raise HTTPException(status_code=400, detail="Özünüzlə söhbət aça bilməzsiniz")
    existing = (
        await db.execute(
            text(
                "select id from conversations"
                " where ((customer_id=:a and provider_id=:b)"
                "     or (customer_id=:b and provider_id=:a))"
                "   and coalesce(opportunity_id::text,'') = coalesce(cast(:opp as text),'')"
                " limit 1"
            ),
            {"a": user.id, "b": body.peer_id,
             "opp": str(body.opportunity_id) if body.opportunity_id else None},
        )
    ).first()
    if existing:
        return {"id": str(existing.id), "created": False}
    row = (
        await db.execute(
            text(
                "insert into conversations (customer_id, provider_id, opportunity_id)"
                " values (:a, :b, :opp) returning id"
            ),
            {"a": user.id, "b": body.peer_id, "opp": body.opportunity_id},
        )
    ).first()
    await db.commit()
    return {"id": str(row.id), "created": True}


class SupportOpen(BaseModel):
    category: str = Field(
        default="general",
        pattern="^(general|order|payment|kyc|complaint|provider)$")


@router.post("/support")
async def open_support_conversation(
    body: SupportOpen,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Dəstək çatı aç — kateqoriya başına idempotent
    (open_support_conversation RPC portu; məntiq ortaq servisdədir).
    Dəstək hesabı: platform_config.support_user_id, yoxdursa ilk admin."""
    try:
        conv_id, created = await marketplace.open_support_conversation(
            db, caller_id=user.id, category=body.category,
            user_role="provider" if user.role == "provider" else "customer")
        await db.commit()
    except OpError as e:
        await db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e)) from e
    return {"id": str(conv_id), "created": created}


# ── Admin: dəstək söhbətləri ──────────────────────────────────────
@router.get("/support/conversations")
async def support_conversations(
    _admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
    category: str | None = None,
    limit: int = Query(default=50, le=200),
) -> list[dict]:
    """Admin: bütün dəstək söhbətləri (kateqoriya + oxunmamış sayı ilə)."""
    sql = (
        "select c.id, c.category, c.user_role, c.customer_id,"
        "       c.last_message_at, c.last_message_preview,"
        "       p.name as user_name, p.email as user_email,"
        "       (select count(*) from chat_messages m"
        "         where m.conversation_id = c.id and m.sender_id = c.customer_id"
        "           and m.read_at is null) as unread"
        "  from conversations c"
        "  left join profiles p on p.id = c.customer_id"
        " where c.category is not null and c.opportunity_id is null"
    )
    params: dict = {"l": limit}
    if category:
        sql += " and c.category = :c"
        params["c"] = category
    rows = await db.execute(
        text(sql + " order by c.last_message_at desc nulls last limit :l"), params
    )
    return [dict(r._mapping) for r in rows]


@router.get("/support/conversations/{conversation_id}/messages")
async def support_messages(
    conversation_id: uuid.UUID,
    _admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, le=200),
) -> list[dict]:
    conv = (
        await db.execute(
            text("select id, customer_id from conversations"
                 " where id=:c and category is not null"),
            {"c": conversation_id},
        )
    ).first()
    if conv is None:
        raise HTTPException(status_code=404, detail="Dəstək söhbəti tapılmadı")
    # İstifadəçinin mesajlarını oxunmuş işarələ
    await db.execute(
        text(
            "update chat_messages set read_at = now()"
            " where conversation_id=:c and sender_id = :u and read_at is null"
        ),
        {"c": conversation_id, "u": conv.customer_id},
    )
    await db.commit()
    rows = await db.execute(
        text(
            "select id, sender_id, body, attachments, created_at, read_at"
            " from chat_messages where conversation_id=:c"
            " order by created_at asc limit :l"
        ),
        {"c": conversation_id, "l": limit},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/support/conversations/{conversation_id}/messages", status_code=201)
async def support_reply(
    conversation_id: uuid.UUID,
    body: MessageIn,
    admin: User = Depends(require_roles("admin", "superadmin")),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Admin dəstək adından cavab yazır — istifadəçiyə realtime çatır."""
    conv = (
        await db.execute(
            text("select id, customer_id, provider_id from conversations"
                 " where id=:c and category is not null"),
            {"c": conversation_id},
        )
    ).first()
    if conv is None:
        raise HTTPException(status_code=404, detail="Dəstək söhbəti tapılmadı")
    # sender = dəstək hesabı (istifadəçi tərəfdə "Dəstək" kimi görünür)
    row = (
        await db.execute(
            text(
                "insert into chat_messages (conversation_id, sender_id, body)"
                " values (:c, :s, :b) returning id, created_at"
            ),
            {"c": conversation_id, "s": conv.provider_id, "b": body.body},
        )
    ).first()
    await db.execute(
        text(
            "update conversations set last_message_at=now(),"
            " last_message_preview=:p where id=:c"
        ),
        {"p": body.body[:120], "c": conversation_id},
    )
    await db.execute(
        text(
            "insert into notifications (user_id, type, title, body, related_id)"
            " values (:u, 'support', 'Dəstəkdən cavab 💬', :b, :r)"
        ),
        {"u": conv.customer_id, "b": body.body[:120], "r": str(conversation_id)},
    )
    await db.execute(
        text(
            "insert into audit_log (actor_id, action, target_type, target_id)"
            " values (:a, 'support_reply', 'conversation', :t)"
        ),
        {"a": admin.id, "t": str(conversation_id)},
    )
    await db.commit()
    await publish(conv.customer_id, "chat.message", {
        "conversation_id": str(conversation_id), "message_id": str(row.id),
        "sender_id": str(conv.provider_id), "body": body.body,
        "is_support": True})
    return {"id": str(row.id), "created_at": str(row.created_at)}


@router.get("/conversations")
async def my_conversations(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> list[dict]:
    rows = await db.execute(
        text(
            "select c.id, c.opportunity_id, c.customer_id, c.provider_id,"
            "       c.last_message_at, c.last_message_preview,"
            "       case when c.customer_id = :u then pp.name else pc.name end as peer_name,"
            "       case when c.customer_id = :u then pp.avatar_url else pc.avatar_url end as peer_avatar,"
            "       (select count(*) from chat_messages m"
            "         where m.conversation_id = c.id and m.sender_id <> :u"
            "           and m.read_at is null) as unread"
            "  from conversations c"
            "  left join profiles pc on pc.id = c.customer_id"
            "  left join profiles pp on pp.id = c.provider_id"
            " where c.customer_id = :u or c.provider_id = :u"
            " order by c.last_message_at desc nulls last"
        ),
        {"u": user.id},
    )
    return [dict(r._mapping) for r in rows]


@router.get("/conversations/{conversation_id}/messages")
async def messages(
    conversation_id: uuid.UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=100, le=200),
) -> list[dict]:
    conv = await _in_conversation(db, conversation_id, user.id)
    if conv is None:
        raise HTTPException(status_code=403, detail="Bu söhbətə girişiniz yoxdur")
    # Qarşı tərəfin mesajlarını oxunmuş işarələ
    await db.execute(
        text(
            "update chat_messages set read_at = now()"
            " where conversation_id=:c and sender_id <> :u and read_at is null"
        ),
        {"c": conversation_id, "u": user.id},
    )
    await db.commit()
    rows = await db.execute(
        text(
            "select id, sender_id, body, attachments, created_at, read_at"
            " from chat_messages where conversation_id=:c"
            " order by created_at asc limit :l"
        ),
        {"c": conversation_id, "l": limit},
    )
    return [dict(r._mapping) for r in rows]


@router.post("/conversations/{conversation_id}/messages", status_code=201)
async def send_message(
    conversation_id: uuid.UUID,
    body: MessageIn,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    conv = await _in_conversation(db, conversation_id, user.id)
    if conv is None:
        raise HTTPException(status_code=403, detail="Bu söhbətə girişiniz yoxdur")
    row = (
        await db.execute(
            text(
                "insert into chat_messages (conversation_id, sender_id, body)"
                " values (:c, :u, :b) returning id, created_at"
            ),
            {"c": conversation_id, "u": user.id, "b": body.body},
        )
    ).first()
    await db.execute(
        text(
            "update conversations set last_message_at=now(),"
            " last_message_preview=:p where id=:c"
        ),
        {"p": body.body[:120], "c": conversation_id},
    )
    await db.commit()
    peer = conv.provider_id if conv.customer_id == user.id else conv.customer_id
    await publish(peer, "chat.message", {
        "conversation_id": str(conversation_id), "message_id": str(row.id),
        "sender_id": str(user.id), "body": body.body})
    return {"id": str(row.id), "created_at": str(row.created_at)}
