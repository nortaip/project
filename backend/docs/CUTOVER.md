# Keçid planı — Supabase söndürülür, sistem Python + PostgreSQL-də qalır

Texniki köçürmə əmrləri: `scripts/MIGRATION.md`. Klient dəyişiklikləri:
`docs/CLIENT_MIGRATION.md`.

## Hazırkı vəziyyət

| Hissə | Vəziyyət |
|---|---|
| Backend API (auth, sifariş, təklif, ödəniş, briqada, KYC, çat, admin, fayllar) | hazır, E2E testlərlə örtülüb |
| Parol bərpası (OTP: e-poçt + tətbiq bildirişi), e-poçt/telefonla giriş | hazır |
| PostgreSQL-ə SSH tuneli | hazır |
| Data + istifadəçi + fayl köçürmə skriptləri | hazır, lokal məşqdən keçib |
| **Veb (React) və mobil (Flutter) klientlər** | **hələ Supabase SDK işlədir — API-yə keçirilməlidir** |

Supabase yalnız klientlər yeni API-yə keçəndən sonra söndürülə bilər.

## Mərhələ 1 — Server (istənilən vaxt, production-a toxunmur)

1. Server: Ubuntu 22+, PostgreSQL 15+, Redis, nginx + TLS (`deploy/nginx.conf`),
   domen `api.ellit.az`.
2. `.env`: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET` (64+ bayt), `SMTP_*`,
   Epoint açarları, Google/Apple ID-ləri, `FIREBASE_CREDENTIALS_PATH`,
   `STORAGE_DIR`; baza ayrı serverdədirsə `SSH_*`.
3. `python -m alembic upgrade head`
4. Məşq köçürməsi: `migrate_data.py --dry-run` → `migrate_data.py` →
   `migrate_storage.py`. Supabase-də heç nə dəyişmir; istənilən qədər təkrarlana bilər.
5. Bu mərhələdə `CRON_ENABLED=false` (dövri işləri hələ Supabase görür).

## Mərhələ 2 — Klientlər

6. Veb və mobil tətbiqdə Supabase çağırışları API çağırışları ilə əvəzlənir
   (`docs/CLIENT_MIGRATION.md`), staging-də məşq bazası ilə yoxlanır.
7. Mobil yeni versiya mağazalara göndərilir (təsdiq vaxtını nəzərə alın).

## Mərhələ 3 — Keçid günü (qısa texniki fasilə)

8. Supabase-ə yazılar dayandırılır (texniki fasilə elanı / API açarlarının rotasiyası).
9. `python scripts/migrate_data.py` — son delta (idempotent) → `--verify`.
10. `python scripts/migrate_storage.py` + `--rewrite-urls https://api.ellit.az`.
11. Pul yoxlaması: `sum(balance)`, `sum(bonus_balance)`, `transactions` cəmləri iki bazada eyni.
12. `.env`: `CRON_ENABLED=true` → API yenidən başladılır.
13. Yeni veb build yayımlanır, mobil yeniləmə açılır.
14. Epoint webhook URL: `https://api.ellit.az/api/v1/payments/webhook`.

## Geri dönüş

Supabase silinməyib, yalnız yazıya bağlıdır: problem olarsa köhnə build-lər
geri qaytarılır və Supabase yenidən açılır. Bu pəncərədə yeni sistemdə yaranan
data əl ilə geri daşınmalı olur — ona görə keçiddən əvvəl staging məşqi vacibdir.

## Keçiddən sonra

- Supabase 2–4 həftə arxiv kimi saxlanır, sonra son `pg_dump` götürülüb bağlanır.
- Gündəlik backup: `pg_dump` + `STORAGE_DIR` (rsync/S3).
- Monitorinq: `/health`, nginx log, `pg_stat_activity`, Redis yaddaşı.
