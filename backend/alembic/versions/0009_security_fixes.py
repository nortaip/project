"""Pentest düzəlişləri: köhnə "hamıya icazə" siyasətləri (saxta rəy,
başqasının adına elan), rəy yalnız tamamlanmış iş üçün və bir dəfə.
Ətraflı: db/security_fixes.sql.

Revision ID: 0009
"""
from pathlib import Path

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "security_fixes.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    # Təhlükəsizlik düzəlişi geri qaytarılmır (köhnə açıq siyasətlər bərpa olunmasın)
    op.execute("drop index if exists public.provider_reviews_offer_uniq")
