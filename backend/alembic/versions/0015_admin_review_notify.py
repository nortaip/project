"""İş admin yoxlamasına düşəndə adminlərə bildiriş.
Ətraflı: db/admin_review_notify.sql.

Revision ID: 0015
"""
from pathlib import Path

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "admin_review_notify.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute("drop trigger if exists ellit_n_admin_review on public.opportunities;"
               " drop function if exists public.ellit_n_admin_review();")
