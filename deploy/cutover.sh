#!/bin/bash
# Keçid: YENİ serverdəki bazanı sıfırlayır → Supabase-dən son vəziyyəti köçürür →
# faylları yeniləyir → say/pul cəmlərini tutuşdurur → dövri işləri (worker) başladır.
# Supabase-ə YAZMIR (yalnız oxuyur). Hər addım uğursuz olsa skript dayanır.
#
#   cd ~/project/deploy
#   read -s -p "Supabase DB parolu: " PGPASS && echo   …  export SOURCE_DB_URL=…   (README)
#   read -s -p "service_role açarı: " SUPABASE_SERVICE_KEY && echo && export SUPABASE_SERVICE_KEY
#   export SUPABASE_URL=https://<ref>.supabase.co
#   ./cutover.sh
set -euo pipefail
cd "$(dirname "$0")"

: "${SOURCE_DB_URL:?SOURCE_DB_URL təyin olunmayıb}"
if [ "${SKIP_STORAGE:-0}" != "1" ]; then
  : "${SUPABASE_URL:?SUPABASE_URL təyin olunmayıb}"
  : "${SUPABASE_SERVICE_KEY:?SUPABASE_SERVICE_KEY təyin olunmayıb}"
fi
API_DOMAIN=$(grep -E '^API_DOMAIN=' .env | tail -1 | cut -d= -f2-)
: "${API_DOMAIN:?.env-də API_DOMAIN yoxdur}"

step() { echo; echo "══════ $* ══════"; }

echo "Bu skript YENİ serverdəki bazanı tam silib Supabase-dən yenidən köçürəcək."
echo "(Yeni bazada köçürmədən sonra yaranmış hər şey itəcək. Supabase-ə toxunulmur.)"
if [ "${CUTOVER_CONFIRM:-}" != "BAŞLA" ]; then
  read -r -p "Davam etmək üçün BAŞLA yazın: " ans
  [ "$ans" = "BAŞLA" ] || { echo "Dayandırıldı."; exit 1; }
fi

step "1/7 API və worker dayandırılır"
docker compose stop api worker

step "2/7 Yeni baza sıfırlanır"
docker compose rm -sf db
docker volume rm ellit_pgdata
docker compose exec -T redis redis-cli flushall >/dev/null

step "3/7 Baza qurulur (miqrasiyalar)"
docker compose up -d --wait db
docker compose up -d --wait api

step "4/7 Data köçürülür"
docker compose run --rm -T -e SOURCE_DB_URL api python scripts/migrate_data.py

step "5/7 Fayllar"
if [ "${SKIP_STORAGE:-0}" = "1" ]; then
  echo "SKIP_STORAGE=1 — ötürülür"
else
  docker compose run --rm -T -e SOURCE_DB_URL -e SUPABASE_URL -e SUPABASE_SERVICE_KEY \
    api python scripts/migrate_storage.py
  docker compose run --rm -T -e SUPABASE_URL \
    api python scripts/migrate_storage.py --rewrite-urls "https://${API_DOMAIN}"
fi

step "6/7 Say və pul cəmləri tutuşdurulur"
docker compose run --rm -T -e SOURCE_DB_URL api python scripts/compare_totals.py

step "7/7 Dövri işlər (worker) başladılır"
docker compose up -d worker
docker compose ps

echo
echo "KEÇİD HAZIRDIR ✓  — indi Cloudflare-də ellit.az-ı tunelə yönəldin (README)."
