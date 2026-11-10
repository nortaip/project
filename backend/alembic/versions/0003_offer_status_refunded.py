"""Təklif statuslarına 'refunded' və 'cancelled' əlavə olunur.

Canlı Supabase bazasında opportunities_offers_status_check yalnız
pending/accepted/rejected/ongoing/completed qəbul edirdi, halbuki geri
ödəmə (refund) və köhnəlmiş sifarişin avtomatik ləğvi təklifə məhz
'refunded' / 'cancelled' yazmağa çalışırdı — ona görə həmin axınlar canlıda
heç vaxt işləməyib. Yeni sistemdə bu statuslar rəsmən icazəlidir.

Revision ID: 0003
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table public.opportunities_offers
          drop constraint if exists opportunities_offers_status_check;
        alter table public.opportunities_offers
          add constraint opportunities_offers_status_check
          check (status = any (array['pending', 'accepted', 'rejected', 'ongoing',
                                     'completed', 'refunded', 'cancelled']));
        """
    )


def downgrade() -> None:
    raise NotImplementedError("Geri alınmır — bazanı yenidən yaradın")
