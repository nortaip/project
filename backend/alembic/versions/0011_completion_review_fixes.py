"""Müştərinin "İş bitdi" təsdiqi + rəy düzəlişləri (pending_review).
Ətraflı: db/completion_review_fixes.sql.

Revision ID: 0011
"""
from pathlib import Path

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "completion_review_fixes.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute("drop trigger if exists ellit_n_new_review on public.provider_reviews;"
               " drop function if exists public.ellit_n_new_review();")
