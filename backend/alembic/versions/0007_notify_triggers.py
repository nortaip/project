"""Bildiriş trigger-ləri (/rest/v1 yazıları) və push növbəsi.

Klientlər sifariş, təklif, status, booking, şikayət və s. yazılarını birbaşa
/rest/v1 ilə edir; Supabase-də bunların bildirişini bazanın trigger-ləri
yaradırdı, burada isə yaranmırdı. Ətraflı: db/notify_triggers.sql.

Revision ID: 0007
"""
from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "notify_triggers.sql"

_TRIGGERS = (
    ("opportunities", "ellit_n_new_opportunity"),
    ("opportunities", "ellit_n_opportunity_status"),
    ("opportunities_offers", "ellit_n_new_offer"),
    ("opportunities_offers", "ellit_n_offer_status"),
    ("bookings", "ellit_n_new_booking"),
    ("bookings", "ellit_n_booking_status"),
    ("brigade_assignments", "ellit_n_brigade_assignment"),
    ("brigade_invites", "ellit_n_brigade_invite"),
    ("disputes", "ellit_n_dispute_opened"),
    ("disputes", "ellit_n_dispute_resolved"),
    ("provider_verifications", "ellit_n_kyc_decision"),
    ("chat_messages", "ellit_chat_message_after_insert"),
    ("notifications", "ellit_push_on_notification"),
)


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    for table, fn in _TRIGGERS:
        op.execute(f"drop trigger if exists {fn} on public.{table}")
        op.execute(f"drop function if exists public.{fn}()")
    op.execute("drop function if exists public.ellit_specialty_keys(uuid, uuid)")
    op.execute("drop function if exists public.ellit_via_rest()")
