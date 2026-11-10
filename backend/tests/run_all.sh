#!/usr/bin/env bash
# Bütün test paketləri — hər biri TƏMİZ bazada (lokal PostgreSQL + Redis).
#   PG_ADMIN_URL=postgresql://ellit@127.0.0.1:55432/postgres \
#   REDIS_URL=redis://localhost:56379/5 tests/run_all.sh
set -u
cd "$(dirname "$0")/.."
PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://ellit@127.0.0.1:55432/postgres}"
export PG_ADMIN_URL
export REDIS_URL="${REDIS_URL:-redis://localhost:56379/5}"
export JWT_SECRET="${JWT_SECRET:-test-secret-for-local-smoke-0123456789}"
export CRON_ENABLED=false
DB=ellit_test_suite
BASE="${PG_ADMIN_URL%/*}"
export DATABASE_URL="${BASE/postgresql:\/\//postgresql+asyncpg://}/$DB"
REDIS_CLI="redis-cli -u $REDIS_URL"

fresh() {
  psql "$PG_ADMIN_URL" -q -c "drop database if exists $DB with (force)" -c "create database $DB" >/dev/null
  $REDIS_CLI flushdb >/dev/null
}

fail=0
run() {  # run <ad> <əmr...>
  local name="$1"; shift
  local out; out="$("$@" 2>&1)"; local rc=$?
  if [ $rc -eq 0 ]; then echo "✓ $name  — $(echo "$out" | tail -1)"
  else echo "✗ $name (exit $rc)"; echo "$out" | tail -15; fail=1; fi
}

for t in e2e_smoke e2e_auth_recovery e2e_parity e2e_refund; do
  fresh; python3 -m alembic upgrade head >/dev/null 2>&1 || { echo "✗ alembic"; exit 1; }
  run "$t" python3 "tests/$t.py"
done
fresh; run "test_ssh_tunnel (+E2E tunel üzərindən)" python3 tests/test_ssh_tunnel.py
$REDIS_CLI flushdb >/dev/null; run "test_migration" python3 tests/test_migration.py
$REDIS_CLI flushdb >/dev/null; run "test_storage_migration" python3 tests/test_storage_migration.py
psql "$PG_ADMIN_URL" -q -c "drop database if exists $DB with (force)" >/dev/null
[ $fail -eq 0 ] && echo "BÜTÜN PAKETLƏR KEÇDİ ✓" || { echo "UĞURSUZ PAKET VAR ✗"; exit 1; }
