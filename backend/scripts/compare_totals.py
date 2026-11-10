"""Supabase (mənbə) ilə yeni bazanı (hədəf) tutuşdurur: saylar və pul cəmləri.

    SOURCE_DB_URL=… python scripts/compare_totals.py      # fərq varsa exit 1

Hədəf: TARGET_DB_URL və ya tətbiqin DATABASE_URL-i (SSH tuneli daxil).
"""
from __future__ import annotations

import asyncio
import os
import sys
from decimal import Decimal

import asyncpg

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.migrate_data import _KEPT_USERS_SQL, _target_dsn  # noqa: E402

# (ad, mənbə sorğusu, hədəf sorğusu — None: eyni sorğu)
CHECKS = [
    ("istifadəçi", f"select count(*) from ({_KEPT_USERS_SQL}) k", "select count(*) from users"),
    ("profil", "select count(*) from public.profiles", None),
    ("balans cəmi", "select coalesce(sum(balance), 0) from public.profiles", None),
    ("bonus cəmi", "select coalesce(sum(bonus_balance), 0) from public.profiles", None),
    ("escrow (kilidli)", "select coalesce(sum(locked_balance), 0) from public.provider_wallets", None),
    ("briqada balansı", "select coalesce(sum(balance), 0) from public.brigades", None),
    ("tranzaksiya sayı", "select count(*) from public.transactions", None),
    ("tranzaksiya cəmi", "select coalesce(sum(amount), 0) from public.transactions", None),
    ("sifariş", "select count(*) from public.opportunities", None),
    ("təklif", "select count(*) from public.opportunities_offers", None),
    ("çıxarış", "select count(*) from public.withdrawals", None),
    ("ödəniş", "select count(*) from public.payments", None),
]


async def main() -> int:
    if "SOURCE_DB_URL" not in os.environ:
        print("SOURCE_DB_URL təyin olunmayıb")
        return 2
    dsn, _ = _target_dsn()
    src = await asyncpg.connect(os.environ["SOURCE_DB_URL"], statement_cache_size=0)
    dst = await asyncpg.connect(dsn)
    ok = True
    try:
        print(f"{'':20} {'Supabase':>14} {'Yeni baza':>14}")
        for name, sq, dq in CHECKS:
            a = await src.fetchval(sq)
            b = await dst.fetchval(dq or sq)
            same = Decimal(str(a)) == Decimal(str(b))
            ok &= same
            print(f"{name:20} {str(a):>14} {str(b):>14}  {'✓' if same else '✗ FƏRQ'}")
    finally:
        await src.close()
        await dst.close()
    print("CƏMLƏR EYNİDİR ✓" if ok else "FƏRQ VAR ✗ — keçidi dayandırın və araşdırın")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
