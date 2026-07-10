# Cutover planı — Supabase → öz backend

## Hazırlıq (istənilən vaxt)
1. Server: Ubuntu 22+, docker compose, domen `api.ellit.az` → server IP
2. `cp .env.example .env` — JWT_SECRET (64+ bayt), Epoint açarları,
   Google client ID-ləri, Apple bundle ID, Firebase credentials
3. `docker compose up -d db redis minio` → `alembic upgrade head`
4. nginx (deploy/nginx.conf) + certbot TLS

## Məşq köçürməsi (production-a toxunmadan)
5. SOURCE_DB_URL=<supabase> TARGET_DB_URL=<yeni> \
   python scripts/migrate_data.py --dry-run   # saylara bax
6. Tam köçür + yoxla: sətir sayları, balans cəmləri
   select sum(balance) from profiles;  -- iki bazada eyni olmalıdır

## Keçid günü (10-15 dəq pəncərə)
7. Mobil app + veb yeni API build-ləri hazır (BASE_URL dəyişilmiş)
8. Supabase-i read-only et (yaxud API açarlarını rotasiya et)
9. migrate_data.py yenidən işlət (delta — idempotentdir)
10. Storage: rclone ilə bucket-ları köçür
11. Yeni build-ləri yayımla (web deploy + app store update)
12. Epoint webhook URL-ni dəyiş: https://api.ellit.az/api/v1/payments/webhook

## Geri dönüş planı
Problem çıxsa köhnə build-lər Supabase ilə işləməyə davam edir —
Supabase silinməyib, yalnız read-only. DNS/build geri qaytarılır.

## Keçiddən sonra
- Supabase-i 2-4 həftə saxla (arxiv), sonra export + bağla
- Monitorinq: /health uptime, nginx access log, pg_stat_activity
- Gündəlik backup: pg_dump cron + S3-ə yüklə
