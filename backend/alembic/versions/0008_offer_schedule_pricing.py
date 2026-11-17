"""Təklifdə gəliş tarixi, kateqoriyaya görə qiymət vahidi (sabit / m² / saat)
və təklif sahələrinin /rest/v1 yazılarından qorunması. Ətraflı:
db/offer_schedule.sql.

Revision ID: 0008
"""
from pathlib import Path

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "offer_schedule.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    op.execute(
        """
        drop trigger if exists ellit_guard_offer_columns on public.opportunities_offers;
        drop function if exists public.ellit_guard_offer_columns();
        drop index if exists public.opportunities_offers_provider_proposed_idx;
        alter table public.opportunities_offers
          drop constraint if exists opportunities_offers_price_unit_check,
          drop column if exists proposed_at, drop column if exists price_unit,
          drop column if exists unit_price, drop column if exists quantity;
        alter table public.service_categories
          drop constraint if exists service_categories_price_unit_check,
          drop column if exists price_unit;
        """
    )
