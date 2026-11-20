"""Ustanın öz qiymətləri (kateqoriya üzrə vahid + vahid qiymət).
Ətraflı: db/provider_prices.sql.

Revision ID: 0012
"""
from pathlib import Path

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "provider_prices.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute("drop table if exists public.provider_prices;"
               " drop function if exists public.ellit_touch_provider_prices();")
