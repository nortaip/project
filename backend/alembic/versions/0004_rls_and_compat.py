"""Supabase-uyğun giriş qatı üçün baza hissəsi: RLS siyasətləri, rollar,
auth.* köməkçiləri, realtime dəyişiklik siqnalı, istifadəçi metadata-sı.

db/rls.sql canlı Supabase siyasətlərindən generasiya olunub; ətraflı izah
həmin faylın başındadır.

Revision ID: 0004
"""
from pathlib import Path

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_DB = Path(__file__).resolve().parents[2] / "db"
_RLS = _DB / "rls.sql"
_TRIGGERS = _DB / "triggers.sql"


def upgrade() -> None:
    op.execute(
        """
        alter table public.users add column if not exists user_metadata jsonb not null default '{}'::jsonb;
        alter table public.users add column if not exists last_sign_in_at timestamptz;
        """
    )
    # Trigger dəsti yenidən tətbiq olunur (idempotent): başqa cədvələ yazan
    # funksiyalar SECURITY DEFINER oldu — klient rolu ilə də işləsinlər
    op.execute(_TRIGGERS.read_text())
    op.execute(_RLS.read_text())


def downgrade() -> None:
    raise NotImplementedError("Geri alınmır — bazanı yenidən yaradın")
