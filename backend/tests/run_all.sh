#!/usr/bin/env bash
# Bütün test paketləri — hər biri ÖZ təmiz bazasında, paralel (lokal PostgreSQL + Redis).
#   PG_ADMIN_URL=postgresql://ellit@127.0.0.1:55432/postgres  REDIS_PORT=56379  tests/run_all.sh
# Tələb: python3 (requirements.txt), node + layihə kökündə npm ci (supabase-js testləri üçün).
set -u
cd "$(dirname "$0")/.."
export PG_ADMIN_URL="${PG_ADMIN_URL:-postgresql://ellit@127.0.0.1:55432/postgres}"
REDIS_PORT="${REDIS_PORT:-56379}"
BASE="${PG_ADMIN_URL%/*}"
LOGDIR="$(mktemp -d)"
export JWT_SECRET="${JWT_SECRET:-test-secret-for-local-smoke-0123456789}"
export CRON_ENABLED=false RATE_LIMIT_AUTH=100000/minute RATE_LIMIT_DEFAULT=100000/minute

# run <ad> <redis db> <əmr...>  — öz bazası, öz redis db-si, öz portu
run() {
  local name="$1" n="$2"; shift 2
  local db="ellit_suite_${name}"
  (
    psql "$PG_ADMIN_URL" -q -c "drop database if exists $db with (force)" -c "create database $db" >/dev/null 2>&1
    redis-cli -p "$REDIS_PORT" -n "$n" flushdb >/dev/null
    export DATABASE_URL="${BASE/postgresql:\/\//postgresql+asyncpg://}/$db"
    export REDIS_URL="redis://localhost:$REDIS_PORT/$n" COMPAT_TEST_PORT=$((18300 + n))
    export PG_DSN="$BASE/$db"
    python3 -m alembic upgrade head >/dev/null 2>&1 || { echo "alembic uğursuz"; exit 1; }
    "$@"
  ) >"$LOGDIR/$name.log" 2>&1
  local rc=$?
  if [ $rc -eq 0 ]; then echo "✓ $name — $(grep -v '^\s*$' "$LOGDIR/$name.log" | tail -1)"
  else echo "✗ $name (exit $rc)"; tail -15 "$LOGDIR/$name.log" | sed 's/^/    /'; echo 1 >>"$LOGDIR/FAILED"; fi
  psql "$PG_ADMIN_URL" -q -c "drop database if exists $db with (force)" >/dev/null 2>&1
}

# Canlı server + supabase-js (Node) testi
js_against_server() {
  local script="$1"; shift
  python3 -m uvicorn app.main:app --port "$COMPAT_TEST_PORT" --log-level warning &
  local pid=$!
  for _ in $(seq 60); do curl -sf "http://127.0.0.1:$COMPAT_TEST_PORT/health" >/dev/null && break; sleep 0.25; done
  node "$script" "http://127.0.0.1:$COMPAT_TEST_PORT" "$PG_DSN"; local rc=$?
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
  return $rc
}
export -f js_against_server

i=0
for t in e2e_smoke e2e_auth_recovery e2e_parity e2e_refund compat_rest compat_rpc_core \
         compat_rpc_brigade compat_rpc_admin compat_rpc_misc compat_gotrue compat_storage_realtime; do
  i=$((i + 1)); run "$t" "$i" python3 "tests/$t.py" &
done
run js_gotrue 14 bash -c 'js_against_server tests/js/gotrue_client.mjs' &
run js_storage_realtime 15 bash -c 'js_against_server tests/js/storage_realtime_client.mjs' &
wait
# Öz bazalarını yaradan / port tutan paketlər — ardıcıl
run test_ssh_tunnel 12 python3 tests/test_ssh_tunnel.py
REDIS_URL="redis://localhost:$REDIS_PORT/13" run test_migration 13 python3 tests/test_migration.py
REDIS_URL="redis://localhost:$REDIS_PORT/13" run test_storage_migration 13 python3 tests/test_storage_migration.py

if [ -f "$LOGDIR/FAILED" ]; then echo "UĞURSUZ PAKET VAR ✗ (loglar: $LOGDIR)"; exit 1; fi
rm -rf "$LOGDIR"
echo "BÜTÜN PAKETLƏR KEÇDİ ✓"
