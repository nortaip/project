"""Yeni müraciətlərdə (usta, KYC, briqada, nağdlaşdırma, şikayət, dəstək mesajı)
adminlərə bildiriş. Ətraflı: db/admin_request_notify.sql.

Revision ID: 0017
"""
from pathlib import Path

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "admin_request_notify.sql"

_TRIGGERS = (
    ("ellit_na_provider_request", "provider_requests"),
    ("ellit_na_kyc", "provider_verifications"),
    ("ellit_na_brigade_application", "brigade_applications"),
    ("ellit_na_withdrawal", "withdrawals"),
    ("ellit_na_dispute", "disputes"),
    ("ellit_na_support_message", "chat_messages"),
)


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    for trg, table in _TRIGGERS:
        op.execute(f"drop trigger if exists {trg} on public.{table};"
                   f" drop function if exists public.{trg}();")
    op.execute("drop function if exists public.ellit_notify_admins(text, text, text, text, text);"
               " drop function if exists public.ellit_profile_label(uuid);")
