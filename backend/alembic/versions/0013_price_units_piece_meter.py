"""Qiymət vahidləri: ədəd (piece) və metr (meter).
Ətraflı: db/price_units_piece_meter.sql.

Revision ID: 0013
"""
from pathlib import Path

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

_SQL = Path(__file__).resolve().parents[2] / "db" / "price_units_piece_meter.sql"


def upgrade() -> None:
    op.execute(_SQL.read_text())


def downgrade() -> None:
    for tbl, nullable in (("service_categories", False), ("opportunities_offers", True),
                          ("provider_prices", False)):
        cond = "price_unit in ('fixed', 'm2', 'hour')"
        if nullable:
            cond = f"price_unit is null or {cond}"
        op.execute(f"alter table public.{tbl} drop constraint if exists {tbl}_price_unit_check;"
                   f" alter table public.{tbl} add constraint {tbl}_price_unit_check"
                   f" check ({cond}) not valid")
