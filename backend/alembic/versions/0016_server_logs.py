"""Server jurnalı (server_logs) — admin panel üçün.
Ətraflı: db/server_logs.sql.

Revision ID: 0016
"""
from pathlib import Path

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "server_logs.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute("drop table if exists public.server_logs")
