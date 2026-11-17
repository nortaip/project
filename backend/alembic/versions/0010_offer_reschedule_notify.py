"""Usta təklifin gəliş gününü dəyişəndə müştəriyə bildiriş.
Ətraflı: db/offer_reschedule_notify.sql.

Revision ID: 0010
"""
from pathlib import Path

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "offer_reschedule_notify.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute("drop trigger if exists ellit_n_offer_rescheduled on public.opportunities_offers;"
               " drop function if exists public.ellit_n_offer_rescheduled();")
