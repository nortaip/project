#!/bin/bash
# Serverdə yeniləmə: git pull → docker compose build api worker web → up -d → yoxlama.
#
# İki cür işlədilir:
#   * əl ilə:            ~/project/deploy/remote-deploy.sh
#   * GitHub Actions-dan (.github/workflows/deploy.yml) SSH ilə. Həmin SSH açarı
#     ~/.ssh/authorized_keys-də `command="…/remote-deploy.sh"` ilə məhdudlaşdırılır —
#     açarla YALNIZ bu skript işləyir (shell, port yönləndirmə və s. yoxdur).
#
# Kod yalnız fast-forward ilə yenilənir (serverdə əl ilə dəyişilmiş fayl varsa dayanır).
# api sağlam (healthy) olmasa son loglar göstərilir və skript xəta ilə bitir.
set -euo pipefail

# Bütün iş funksiyadadır: bash onu tam oxuyandan sonra icra edir — `git pull`
# bu faylın özünü dəyişsə də işləyən nüsxəyə təsir etmir.
main() {
  local here
  here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
  exec 9>/tmp/ellit-deploy.lock
  flock -n 9 || { echo "Başqa yeniləmə hələ gedir — bir az sonra yenidən cəhd edin."; exit 1; }

  echo "== $(date '+%F %T') yeniləmə başladı"
  cd "$here/.."
  local before after
  before=$(git rev-parse --short HEAD)
  GIT_TERMINAL_PROMPT=0 git pull --ff-only
  after=$(git rev-parse --short HEAD)
  echo "== kod: $before → $after (budaq: $(git rev-parse --abbrev-ref HEAD))"
  if [ "$before" != "$after" ]; then
    git log --oneline "$before..$after" | head -30
  fi

  cd "$here"
  echo "== docker compose build api worker web"
  docker compose build api worker web
  echo "== docker compose up -d"
  docker compose up -d

  echo "== api hazır olana qədər gözlənilir (miqrasiyalar başlanğıcda icra olunur)…"
  local cid status="?"
  for _ in $(seq 120); do
    cid=$(docker compose ps -q api || true)
    status=$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo "?")
    [ "$status" = "healthy" ] && break
    sleep 2
  done
  docker compose ps
  if [ "$status" != "healthy" ]; then
    echo "!! api sağlam deyil (status: $status) — son loglar:"
    docker compose logs --tail 80 api
    exit 1
  fi
  # köhnə (adsız) image-lər diski doldurmasın
  docker image prune -f >/dev/null 2>&1 || true
  echo "== HAZIR ✓ server $after versiyasındadır"
}

main "$@"
exit
