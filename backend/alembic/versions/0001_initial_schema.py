"""İlkin sxem — canlı Supabase bazasından çıxarılmış tam struktur.

Revision ID: 0001
"""
from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

_SCHEMA = Path(__file__).resolve().parents[2] / "db" / "schema.sql"


def upgrade() -> None:
    op.execute(_SCHEMA.read_text())


def downgrade() -> None:
    raise NotImplementedError("Baseline geri alınmır — bazanı yenidən yaradın")
