"""Status bildirişləri tam Azərbaycan dilində (texniki status adı yox).
Ətraflı: db/status_notify_texts.sql.

Revision ID: 0014
"""
from pathlib import Path

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "status_notify_texts.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    # Trigger funksiyaları notify_triggers.sql-dəki köhnə variantla qalır;
    # mətn köməkçiləri silinmir (funksiyalar onlardan asılıdır).
    pass
