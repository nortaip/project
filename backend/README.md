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
- [ ] Faza 2 — auth istifadəçi köçürməsi (bcrypt→argon2 şəffaf)
- [ ] Faza 3 — domen API-ləri (sifariş/təklif/briqada/KYC)
- [ ] Faza 4 — pul: ledger, escrow, Epoint (imza+idempotency)
- [ ] Faza 5 — realtime kanallar (təkliflər, chat, presence)
- [ ] Faza 6 — bildirişlər (FCM), admin API
- [ ] Faza 7 — təhlükəsizlik sərtləşdirməsi + testlər
- [ ] Faza 8 — klient keçidi və cutover
