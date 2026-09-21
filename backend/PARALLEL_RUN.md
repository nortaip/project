# Ellit Backend — Paralel işə salma və keçid (cutover) bələdçisi

Bu backend Supabase ilə **paralel** işləmək üçün qurulub: klientlər (veb + mobil)
Supabase-də qalır, backend eyni Postgres bazasının üstündə ayrıca API kimi
işləyir. Kəsinti yoxdur; keçid modul-modul, AYRICA qərarla edilir.

## 1. Tələblər

- Python 3.11+, PostgreSQL 15+, Redis 6+
- `pip install -r requirements.txt`

## 2. Mühit dəyişənləri

| Dəyişən | İzah |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://user:pass@host:5432/db`. Paralel rejimdə Supabase Postgres-in **birbaşa** connection string-i (Dashboard → Settings → Database → Connection string, `Direct connection`). |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `JWT_SECRET` | Minimum 32 simvol təsadüfi sətir. Supabase JWT-si ilə əlaqəsi yoxdur — bu backend-in öz tokenləri. |
| `CRON_ENABLED` | `true` (default). Paralel rejimdə **`false` saxlayın** — auto-release/auto-cancel işlərini hələ Supabase tərəfi idarə edir; iki sistem eyni işi görməsin. |
| `STORAGE_DIR` | Fayl saxlama qovluğu (default `./storage`). |
| `FIREBASE_CREDENTIALS_PATH` | FCM push üçün service-account JSON (opsional; boşdursa push səssiz keçir). |
| `EPOINT_*` | Ödəniş açarları (payments.py-a bax). |

## 3. Lokal test (tam izolyasiya)

```bash
# Lokal Postgres + Redis qaldırın, sonra:
export DATABASE_URL=postgresql+asyncpg://ellit@127.0.0.1:55432/ellit
export REDIS_URL=redis://localhost:56379/0
export JWT_SECRET=$(openssl rand -hex 32)
export CRON_ENABLED=false
python -m alembic upgrade head          # sxem (db/schema.sql əsasında)
python tests/e2e_smoke.py               # tam E2E — hamısı yaşıl olmalıdır
```

## 4. Serverdə işə salma

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
```

nginx tərəfində `api.ellit.az` → `127.0.0.1:8000` proxy; WebSocket üçün
`/ws` yoluna `Upgrade` başlıqlarını ötürün. systemd unit nümunəsi:

```ini
[Service]
WorkingDirectory=/opt/ellit-backend
EnvironmentFile=/opt/ellit-backend/.env
ExecStart=/opt/ellit-backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
```

## 5. Paralel rejimdə DİQQƏT

- **Auth ayrıdır**: backend öz JWT-lərini verir (`/api/v1/auth/login`).
  Supabase sessiyaları ilə qarışmır. Data köçürməsi `scripts/migrate_data.py`
  ilə (auth.users → users cədvəli, bcrypt hash-lər saxlanılır, ilk girişdə
  Argon2-yə keçir).
- **Pul əməliyyatları**: eyni sifariş üzərində EYNİ ANDA həm Supabase RPC,
  həm backend endpointi işlədilməməlidir. Paralel mərhələdə backend-i yalnız
  OXUMA + yeni modullar üçün istifadə edin; pul axını cutover-ə qədər
  Supabase-də qalsın.
- **Cron**: yalnız cutover-dən sonra `CRON_ENABLED=true`.

## 6. Cutover ardıcıllığı (hər addım geri dönə bilən)

1. Hesabat/admin oxunuşları → backend (risksiz, yalnız SELECT)
2. Bildirişlər + storage → backend
3. Sifariş axını (opportunities/offers/pul) → backend; Supabase RPC-lərinə
   `revoke execute from authenticated` (təsadüfi paralel yazının qarşısı)
4. Auth → backend (istifadəçilər növbəti girişdə yeni tokenlə davam edir)
5. `CRON_ENABLED=true`; Supabase-dəki scheduled funksiyalar söndürülür
6. Realtime: klientlər `wss://api.ellit.az/ws?token=...`-ə keçir

## 7. Test statusu

`tests/e2e_smoke.py` — qeydiyyatdan escrow-a, promo-dan çıxarışa, KYC-dən
admin panelə 70+ yoxlama. Hər dəyişiklikdən sonra işlədin.
