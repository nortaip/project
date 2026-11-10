"""Sifariş həyat dövrü — status keçid matrisi və reytinq yeniləməsi.

Supabase-dəki validate_opportunity_status_transition trigger-inin və
_refresh_provider_rating trigger-inin servis-qat portu.
"""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Status keçid matrisi — bazadakı ellit_validate_opportunity_status
# trigger-i ilə EYNİ olmalıdır (db/triggers.sql). Python qatı istifadəçiyə
# anlaşıqlı xəta verir, trigger isə son müdafiə xəttidir.
# Admin müdaxiləsi matrisdən kənara çıxa bilər: `app.status_override`.
_TRANSITIONS: dict[str, set[str]] = {
    "pending":   {"accepted", "cancelled"},
    "open":      {"accepted", "cancelled"},
    "new":       {"accepted", "cancelled"},
    "accepted":  {"i-am-here", "ongoing", "pending_review", "completed", "cancelled", "refunded"},
    "i-am-here": {"ongoing", "pending_review", "completed", "cancelled", "refunded"},
    "ongoing":   {"pending_review", "completed", "cancelled", "refunded"},
    "pending_review": {"completed", "rejected", "refunded"},
    "completed": {"disputed", "refunded"},
    "disputed":  {"completed", "refunded"},
}


class InvalidTransition(Exception):
    pass


def assert_transition(old: str, new: str) -> None:
    if old == new:
        return
    if new not in _TRANSITIONS.get(old, set()):
        raise InvalidTransition(f"INVALID_STATUS_TRANSITION: {old} -> {new}")


async def set_opportunity_status(
    db: AsyncSession, *, opp_id, new_status: str, actor_id, actor_role: str,
) -> str:
    """Statusu matris yoxlaması ilə dəyişir; köhnə statusu qaytarır."""
    row = (
        await db.execute(
            text("select status from opportunities where id=:id for update"),
            {"id": opp_id},
        )
    ).first()
    if row is None:
        raise InvalidTransition("NOT_FOUND")
    if actor_role in ("admin", "master", "superadmin"):
        await db.execute(text("select set_config('app.status_override', 'on', true)"))
    else:
        assert_transition(row.status, new_status)
    await db.execute(
        text(
            "update opportunities set status=:s,"
            " work_started_at = case when :s = 'ongoing'"
            "   then coalesce(work_started_at, now()) else work_started_at end,"
            " work_ended_at = case when :s = 'pending_review'"
            "   then coalesce(work_ended_at, now()) else work_ended_at end,"
            " completed_at = case when :s = 'completed'"
            "   then coalesce(completed_at, now()) else completed_at end"
            " where id=:id"
        ),
        {"s": new_status, "id": opp_id},
    )
    return row.status


async def refresh_provider_rating(db: AsyncSession, provider_id) -> None:
    """provider_reviews-dan orta reytinqi yenidən hesabla
    (_refresh_provider_rating trigger portu)."""
    await db.execute(
        text(
            "update profiles set"
            " rating = coalesce((select round(avg(rating)::numeric, 2)"
            "   from provider_reviews where provider_id = :p and rating is not null), 0),"
            " rating_count = (select count(*) from provider_reviews"
            "   where provider_id = :p and rating is not null)"
            " where id = :p"
        ),
        {"p": provider_id},
    )
