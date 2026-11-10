# Supabase → öz PostgreSQL: köçürmə təlimatı

Məqsəd: Supabase tam söndürülür, bütün sistem **Python (FastAPI) + PostgreSQL**
üzərində işləyir. Bu sənəd data və faylların köçürülməsini addım-addım verir.
Keçid gününün ümumi ardıcıllığı: `docs/CUTOVER.md`.

> **Sirlər haqqında:** baza parolu, SSH açarı, Supabase service-role açarı
> yalnız serverdəki `.env` faylına və ya həmin terminalın mühit dəyişənlərinə
> yazılır. Koda, git-ə, çata yazılmır.

## Nə köçür, nə köçmür

| Supabase-də | Yeni sistemdə | Necə |
|---|---|---|
| `public.*` cədvəlləri (data) | eyni cədvəllər | `scripts/migrate_data.py` |
| `auth.users` (e-poçt, telefon, bcrypt parol) | `users` | eyni skript — ID-lər və parollar saxlanır |
| `auth.identities` (Google/Apple) | `oauth_identities` | eyni skript |
| Storage bucket-ləri (~800 fayl, ~1.2 GB) | `STORAGE_DIR/{bucket}/…` | `scripts/migrate_storage.py` |
| RPC funksiyaları (118) | API endpointləri | artıq Python-dadır (`app/api/v1`, `app/services`) |
| Trigger-lər (41) | 22 texniki trigger `db/triggers.sql` + qalanı Python | `alembic upgrade head` |
| pg_cron işləri (4) | `app/services/cron.py` | `CRON_ENABLED=true` |
| RLS siyasətləri | API-də icazə yoxlamaları | — (baza yalnız backend-ə açıqdır) |
| Parol bərpası e-poçtu / OTP | `/auth/password-reset/*` + SMTP | `SMTP_*` ayarları |

Köhnə Supabase funksiya/trigger/RLS-ləri **daşınmır**: hədəf baza alembic ilə
sıfırdan qurulur, skript yalnız datanı köçürür.

## 0. Hazırlıq (serverdə, bir dəfə)

```bash
# PostgreSQL 15+ və Redis quraşdırılıb; baza və istifadəçi yaradılıb:
#   create user ellit with password '…';  create database ellit owner ellit;
cd /opt/ellit-backend && python3 -m venv venv && . venv/bin/activate
pip install -r requirements.txt
cp .env.example .env       # DATABASE_URL, REDIS_URL, JWT_SECRET, SMTP_* və s. doldurun
python -m alembic upgrade head     # sxem + trigger-lər
```

### Baza başqa serverdədirsə — SSH tuneli

PostgreSQL portunu (5432) internetə açmayın. `.env`-də:

```ini
DATABASE_URL=postgresql+asyncpg://ellit:<parol>@127.0.0.1:5432/ellit   # SSH serverindən görünən ünvan
SSH_HOST=db.ellit.az
SSH_USER=ellit
SSH_KEY_PATH=/etc/ellit/id_ed25519        # və ya SSH_PASSWORD=…
SSH_HOST_FINGERPRINT=SHA256:…             # aşağıdakı əmrlə alınır
```

```bash
ssh-keygen -t ed25519 -f /etc/ellit/id_ed25519 -N ''        # açar cütü
ssh-copy-id -i /etc/ellit/id_ed25519.pub ellit@db.ellit.az   # açarı baza serverinə
python -m app.db.tunnel --fingerprint   # host açarı izi → .env (serverdəki ilə tutuşdurun)
python -m app.db.tunnel                 # "SSH tuneli OK ✓" + PostgreSQL versiyası
```

Bundan sonra API (`uvicorn`), `alembic` və köçürmə skriptləri avtomatik tunel
üzərindən işləyir; bağlantı qopsa tunel özü bərpa olunur. API ilə baza eyni
serverdədirsə `SSH_HOST` boş qalır.

## 1. Data köçürməsi

```bash
# Supabase Dashboard → Project Settings → Database → Connection string (Session pooler / Direct)
export SOURCE_DB_URL='postgresql://postgres.<ref>:<parol>@<host>:5432/postgres'

python scripts/migrate_data.py --dry-run   # heç nə yazmır: cədvəl/sətir sayları, xəbərdarlıqlar
python scripts/migrate_data.py             # köçür + sayları yoxla → "KÖÇÜRMƏ TAMAMLANDI ✓"
python scripts/migrate_data.py --verify    # istənilən vaxt təkrar say müqayisəsi
```

- Skript idempotentdir — keçid günü təkrar işə salınır (yalnız yeni sətirlər əlavə olunur).
- `⚠ mənbədə var, hədəfdə YOXDUR` sətirləri köçməyən sütun/cədvəlləri göstərir;
  lazımlıdırsa əvvəlcə alembic miqrasiyası ilə hədəfə əlavə edin.
- İstifadəçilər parolunu itirmir: bcrypt hash köçür, ilk girişdə Argon2-yə keçir.
  Yalnız telefonu olan istifadəçilər telefon + köhnə parolla girir.
- Pul yoxlaması (iki bazada eyni olmalıdır):
  `select sum(balance), sum(bonus_balance) from profiles;`
  `select type, count(*), sum(amount) from transactions group by 1 order by 1;`

## 2. Fayllar (Storage)

```bash
export SUPABASE_URL='https://<ref>.supabase.co'
export SUPABASE_SERVICE_KEY='<service_role açarı>'   # Dashboard → Settings → API
python scripts/migrate_storage.py --dry-run     # bucket-lər üzrə say/ölçü
python scripts/migrate_storage.py               # endir → STORAGE_DIR/{bucket}/{yol}
python scripts/migrate_storage.py --rewrite-urls https://api.ellit.az --dry-run
python scripts/migrate_storage.py --rewrite-urls https://api.ellit.az
```

Bucket adları və yollar dəyişmir. Yeni URL-lər:

| Rejim | Bucket-lər | URL |
|---|---|---|
| public | service-images, opportunity-photos, completion-evidence, banners | `/api/v1/storage/public/{bucket}/{yol}` |
| giriş etmiş istifadəçi | make-33c80158-profile-photos | `/api/v1/storage/object/{bucket}/{yol}` |
| yalnız sahib + admin | kyc-documents, dispute-evidence | `/api/v1/storage/object/{bucket}/{yol}` |

`STORAGE_DIR` daimi diskdə olmalı və backup-a daxil edilməlidir.

## 3. Yoxlama

```bash
curl -s https://api.ellit.az/health
# köhnə hesabla giriş (e-poçt və ya telefon):
curl -s -X POST https://api.ellit.az/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"identifier":"<email/telefon>","password":"<parol>"}'
```

## Lokal məşq (Supabase-ə toxunmadan)

Bütün zəncir lokal PostgreSQL üzərində avtomatik testlərlə yoxlanır:

```bash
python tests/test_migration.py           # Supabase formalı mənbə → təmiz hədəf → API
python tests/test_storage_migration.py   # fayl köçürməsi + URL çevirmə + icazələr
python tests/test_ssh_tunnel.py          # SSH tuneli + bütün E2E tunel üzərindən
```
