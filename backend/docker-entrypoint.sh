#!/bin/sh
# Konteyner başlanğıcı:
#   api     — miqrasiyalar (alembic upgrade head), sonra uvicorn
#   worker  — dövri işlər (tək nüsxə)
#   başqa   — əmr olduğu kimi icra olunur (məs. python scripts/migrate_data.py)
set -e
case "$1" in
  api)
    python -m alembic upgrade head
    # --proxy-headers: istifadəçinin həqiqi IP-si (rate limit üçün) Caddy-dən gəlir.
    # API portu xaricə açıq deyil — yalnız daxili şəbəkədəki proxy-yə etibar olunur.
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 \
      --workers "${API_WORKERS:-2}" --proxy-headers --forwarded-allow-ips '*' \
      --timeout-graceful-shutdown 20
    ;;
  worker)
    exec python -m app.worker
    ;;
  *)
    exec "$@"
    ;;
esac
