# Ellit.az Backend — FastAPI + PostgreSQL

Supabase-dən müstəqil, özü-hostlanan backend. Texnologiyalar:
FastAPI + Uvicorn, PostgreSQL 16, Redis (realtime/rate-limit), MinIO (S3).

## İşə salma (development)

```bash
cp .env.example .env      # JWT_SECRET-i dəyişin!
docker compose up --build
# API:    http://localhost:8000/docs
# Health: http://localhost:8000/health
```

## Struktur

```
app/
  core/     konfiq, JWT, parol hash, Google/Apple token yoxlaması
  db/       async SQLAlchemy + Redis
  models/   cədvəllər (Faza 1-də Supabase sxemi tam köçürülür)
  api/v1/   REST endpointlər (auth hazırdır)
  ws/       realtime WebSocket gateway (Redis pub/sub)
scripts/    Supabase-dən data köçürmə skriptləri
```

## Fazalar

- [x] Faza 0 — skelet, auth (email/parol + Google + Apple), rate-limit, WS özülü
- [x] Faza 1 — tam DB sxemi (50 cədvəl, canlı bazadan çıxarılıb, PostgreSQL 16-da yoxlanılıb) + Alembic baseline + data köçürmə skripti
- [x] Faza 2 — auth + istifadəçi köçürməsi (bcrypt→argon2 şəffaf)
- [x] Faza 3 — domen API-ləri: kataloq, sifarişlər, təkliflər, profillər (27 E2E test real PG+Redis-də keçir); + briqadalar, KYC, chat, bildirişlər (55+ E2E yoxlama)
- [x] Faza 4 — pul tam: accept/release/cancel+refund (FOR UPDATE), promo-kodlar, Epoint top-up + webhook (imza + idempotency), çıxarışlar
- [x] Faza 5 — realtime tam: hadisə yayımı + presence (onlayn/oflayn, canlı yer), çox-cihaz dəstəyi, onlayn ustalar radius endpointi
- [x] Faza 6 — bildirişlər (in-app + FCM push servisi + cihaz qeydiyyatı), admin API (statistika, komissiyalar, istifadəçi blok, bannerlər, audit, çıxarış emalı)
- [x] Faza 7 — login lockout (5 cəhd/15 dəq), parol dəyişmə (bütün sessiyalar bağlanır), webhook imza + idempotency, RBAC hər yerdə, rate-limit; 81 E2E yoxlama real PG+Redis-də
- [x] Faza 8 — sənədlər hazır: docs/CLIENT_MIGRATION.md (endpoint xəritəsi), docs/CUTOVER.md (keçid planı), deploy/nginx.conf
