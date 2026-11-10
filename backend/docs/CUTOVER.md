# Keçid planı — Supabase söndürülür, sistem Python + PostgreSQL-də qalır

Texniki köçürmə əmrləri: `scripts/MIGRATION.md`. Klient dəyişiklikləri:
`docs/CLIENT_MIGRATION.md`.

## Hazırkı vəziyyət

| Hissə | Vəziyyət |
|---|---|
| Backend API (auth, sifariş, təklif, ödəniş, briqada, KYC, çat, admin, fayllar) | hazır, E2E testlərlə örtülüb |
| **Supabase-uyğun giriş qatı** — `/rest/v1` (RLS altında), `/rest/v1/rpc` (63 RPC), `/auth/v1`, `/storage/v1`, `/realtime/v1`, `/functions/v1` | hazır; həqiqi `supabase-js` ilə və brauzerdə test olunub |
| Parol bərpası (OTP: e-poçt + tətbiq bildirişi), e-poçt/telefonla giriş | hazır |
| PostgreSQL-ə SSH tuneli | hazır |
| Data + istifadəçi + fayl köçürmə skriptləri | hazır, lokal məşqdən keçib |
| Veb və mobil klientlər | **kod dəyişmir** — yalnız server ünvanı: veb `VITE_API_URL`, mobil `.env`-də `API_URL` |

Klientlər eyni `supabase-js` / `supabase_flutter` kitabxanalarını işlədir,
amma Supabase xidmətinə deyil, bu Python backend-ə qoşulur. `VITE_API_URL` /
`API_URL` təyin olunmayana qədər klientlər köhnə Supabase-ə gedir — yəni
keçid bir ayarla edilir və bir ayarla geri qaytarılır.

Bütün testlər: `tests/run_all.sh` (16 paket) + brauzer: `tests/browser/web_flow.cjs`.

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

## Mərhələ 2 — Klientlər (yalnız ünvan)

6. Veb: `.env` → `VITE_API_URL=https://api.ellit.az`, `npm run build`
   (CSP və preconnect avtomatik yeni ünvana yazılır). Staging-də məşq bazası ilə yoxlayın.
7. Mobil: `lib/.env` → `API_URL=https://api.ellit.az`, yeni versiya mağazalara
   (təsdiq vaxtını nəzərə alın). Köhnə versiyalar keçid günü Supabase
   bağlanana qədər köhnə serverlə işləyir.
8. Google Console: `https://api.ellit.az/auth/v1/callback` redirect ünvanı əlavə olunur.

## Mərhələ 3 — Keçid günü (qısa texniki fasilə)

9. Supabase-ə yazılar dayandırılır (texniki fasilə elanı / API açarlarının rotasiyası).
10. `python scripts/migrate_data.py` — son delta (idempotent) → `--verify`.
11. `python scripts/migrate_storage.py` + `--rewrite-urls https://api.ellit.az`.
12. Pul yoxlaması: `sum(balance)`, `sum(bonus_balance)`, `transactions` cəmləri iki bazada eyni.
13. `.env`: `CRON_ENABLED=true` → API yenidən başladılır.
14. Yeni veb build yayımlanır, mobil yeniləmə açılır.
15. Epoint webhook URL: `https://api.ellit.az/api/v1/payments/webhook`.

## Geri dönüş

Supabase silinməyib, yalnız yazıya bağlıdır: problem olarsa köhnə build-lər
geri qaytarılır və Supabase yenidən açılır. Bu pəncərədə yeni sistemdə yaranan
data əl ilə geri daşınmalı olur — ona görə keçiddən əvvəl staging məşqi vacibdir.

## Keçiddən sonra

- Supabase 2–4 həftə arxiv kimi saxlanır, sonra son `pg_dump` götürülüb bağlanır.
- Gündəlik backup: `pg_dump` + `STORAGE_DIR` (rsync/S3).
- Monitorinq: `/health`, nginx log, `pg_stat_activity`, Redis yaddaşı.
