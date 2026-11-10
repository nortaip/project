"""Baseline-dan sonra canlı bazaya əlavə olunmuş sütunlar + backend trigger dəsti.

Baseline (0001) sxem şəkli çəkiləndən sonra canlı Supabase bazasına əlavə
olunanlar (sütun-sütun müqayisə ilə çıxarılıb): bookings.notes/fee_paid,
password_otps.user_id/used/attempts, service_categories.sort_order,
label_zh / options_zh tərcümə sütunları və service_text_translations lüğəti.

Sonra db/triggers.sql — backend-in öz trigger dəsti tətbiq olunur.

Revision ID: 0002
"""
from pathlib import Path

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

_TRIGGERS = Path(__file__).resolve().parents[2] / "db" / "triggers.sql"

_DELTAS = """
alter table public.bookings              add column if not exists notes text;
alter table public.bookings              add column if not exists fee_paid boolean not null default false;
alter table public.password_otps         add column if not exists user_id uuid;
alter table public.password_otps         add column if not exists used boolean not null default false;
alter table public.password_otps         add column if not exists attempts integer not null default 0;
alter table public.service_categories    add column if not exists sort_order integer not null default 100;
alter table public.service_categories    add column if not exists label_zh text;
alter table public.service_subcategories add column if not exists label_zh text;
alter table public.service_questions     add column if not exists label_zh text;
alter table public.service_questions     add column if not exists options_zh jsonb;

create table if not exists public.service_text_translations (
  az text primary key,
  ru text,
  en text,
  zh text
);

create index if not exists ix_password_otps_user
  on public.password_otps (user_id, created_at desc);
"""


def upgrade() -> None:
    op.execute(_DELTAS)
    op.execute(_TRIGGERS.read_text())


def downgrade() -> None:
    raise NotImplementedError("Geri alınmır — bazanı yenidən yaradın")
