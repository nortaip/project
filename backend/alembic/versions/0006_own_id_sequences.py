"""payments / promotion_plans id sayğacları cədvələ bağlanır və irəli çəkilir.

Bu iki cədvəldə id `DEFAULT nextval('..._id_seq')` ilə gəlir, amma sayğac
sütuna bağlı (OWNED BY) deyildi — `pg_get_serial_sequence` onu tapmırdı və
köçürmə skripti sayğacı mövcud maksimuma qaldırmırdı. Nəticədə yeni ödəniş
köhnə ödənişlərin nömrəsini (1, 2, …) alırdı: ya unikal açar xətası, ya da
Epoint-də artıq işlənmiş order_id ilə rədd.

Revision ID: 0006
"""
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

_TABLES = (("payments", "payments_id_seq"), ("promotion_plans", "promotion_plans_id_seq"))


def upgrade() -> None:
    for table, seq in _TABLES:
        op.execute(f"alter sequence public.{seq} owned by public.{table}.id")
        # Sayğac heç vaxt geri çəkilmir: max(id) və cari dəyərdən böyüyü götürülür
        op.execute(
            f"select setval('public.{seq}', greatest("
            f"(select coalesce(max(id), 0) from public.{table}),"
            f" (select last_value from public.{seq}), 1), true)"
        )


def downgrade() -> None:
    for _table, seq in _TABLES:
        op.execute(f"alter sequence public.{seq} owned by none")
