"""Ledger-ə `cash_deposit_release` növü: nağd sifariş tamamlananda müştərinin
qəbul anında ödədiyi depozit ustanın balansına köçürülür (əvvəl platformada
qalırdı — köhnə Supabase funksiyasından gələn səhv).

Revision ID: 0018
"""
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

_TYPES = ("top_up", "booking_charge", "refund", "bonus_earn", "bonus_convert", "withdrawal",
          "admin_adjust", "escrow_lock", "escrow_release", "platform_revenue",
          "cash_deposit_lock", "brigade_payout", "promo_discount", "admin_credit",
          "admin_debit")


def _constraint(types: tuple[str, ...]) -> str:
    arr = ", ".join(f"'{t}'" for t in types)
    return (
        "alter table public.transactions drop constraint if exists transactions_type_check;"
        " alter table public.transactions add constraint transactions_type_check"
        f" check (type = any (array[{arr}]));"
    )


def upgrade() -> None:
    op.execute(_constraint((*_TYPES, "cash_deposit_release")))


def downgrade() -> None:
    op.execute("delete from public.transactions where type = 'cash_deposit_release';")
    op.execute(_constraint(_TYPES))
