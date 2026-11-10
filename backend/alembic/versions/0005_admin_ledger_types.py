"""Ledger-ə admin_credit / admin_debit növləri əlavə olunur.

Admin panelindəki "balansı artır/azalt" (admin_credit_balance) canlı
Supabase-də də heç vaxt işləməyib: funksiya transactions cədvəlinə bu iki
növü yazırdı, transactions_type_check isə onlara icazə vermirdi.

Revision ID: 0005
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table public.transactions drop constraint if exists transactions_type_check;
        alter table public.transactions add constraint transactions_type_check
          check (type = any (array['top_up', 'booking_charge', 'refund', 'bonus_earn',
            'bonus_convert', 'withdrawal', 'admin_adjust', 'escrow_lock', 'escrow_release',
            'platform_revenue', 'cash_deposit_lock', 'brigade_payout', 'promo_discount',
            'admin_credit', 'admin_debit']));
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Geri alınmır — bazanı yenidən yaradın")
