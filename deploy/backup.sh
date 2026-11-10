#!/bin/bash
# Gündəlik backup: PostgreSQL dump + yüklənmiş fayllar. Serverdə cron ilə:
#   crontab -e  →  17 3 * * * /root/project/deploy/backup.sh >> /var/log/ellit-backup.log 2>&1
# Son 14 günün backup-ı saxlanır. Serverdən kənara da köçürün (rsync/S3)!
set -euo pipefail
cd "$(dirname "$0")"
DIR="./backups/$(date +%F)"
mkdir -p "$DIR"
docker compose exec -T db pg_dump -U ellit -d ellit -Fc > "$DIR/ellit.dump"
docker compose run --rm --no-deps -u root -v "$(pwd)/backups:/backups" --entrypoint sh api \
  -c "tar czf /backups/$(date +%F)/storage.tgz -C /data storage"
find ./backups -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
echo "$(date -Is) backup hazır: $DIR ($(du -sh "$DIR" | cut -f1))"
