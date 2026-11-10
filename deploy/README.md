# Ellit — serverdə Docker ilə quraşdırma (SSH)

Bir serverdə hər şey: **PostgreSQL 16 + Redis + Python API + dövri işlər +
veb sayt + avtomatik HTTPS (Caddy / Let's Encrypt)**. Supabase lazım deyil.

```
İnternet ─► Caddy :443 ─┬─► ellit.az       → veb sayt (React build)
            (HTTPS)     └─► api.ellit.az   → api (FastAPI, 2 worker) ─┬─► db (PostgreSQL)
                                             worker (dövri işlər) ────┴─► redis
```

Baza və Redis portları xaricə **açılmır** — yalnız daxili Docker şəbəkəsindədir.

## Tələblər

- Ubuntu 22.04/24.04 server, minimum 2 GB RAM (build üçün; 1 GB-dırsa swap əlavə edin), 20 GB disk
- DNS: `ellit.az`, `www.ellit.az` (istəyə görə) və `api.ellit.az` → serverin IP-si (A qeydi)
- Açıq portlar: 22 (SSH), 80, 443

## 1. Serverə qoşulun və Docker quraşdırın

```bash
ssh root@SERVER_IP

curl -fsSL https://get.docker.com | sh          # Docker + compose plugin
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# RAM 2 GB-dan azdırsa (build zamanı lazım olur):
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 2. Kodu gətirin

Repo private olduğu üçün serverə **yalnız oxuma** hüquqlu deploy açarı verin:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/ellit_deploy -N ''
cat ~/.ssh/ellit_deploy.pub
# ↑ bunu GitHub → nortaip/project → Settings → Deploy keys → Add key (Write YOX)
cat >> ~/.ssh/config <<'CFG'
Host github-ellit
  HostName github.com
  IdentityFile ~/.ssh/ellit_deploy
CFG
git clone -b claude/cool-planck-80kldx git@github-ellit:nortaip/project.git ~/project
cd ~/project/deploy
```

## 3. Ayarlar (.env)

```bash
cp .env.example .env
chmod 600 .env
# Güclü sirlər yaradın və .env-ə yazın:
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env     # domenlər, SMTP, Google/Apple, Epoint açarlarını doldurun
```

Firebase push üçün service-account JSON-u `deploy/secrets/firebase.json` kimi
qoyun (`scp firebase.json root@SERVER_IP:~/project/deploy/secrets/`).

> Sirlər yalnız serverdəki bu `.env`-də saxlanır — git-ə, çata, e-poçta yazmayın.

## 4. Build və işə salma

```bash
docker compose up -d --build        # ilk dəfə ~4–6 dəqiqə
docker compose ps                   # api/db/redis "healthy", web/worker "Up"
docker compose logs -f api          # Ctrl+C ilə çıxın
curl https://api.ellit.az/health    # {"status":"ok","env":"production"}
```

İlk başlanğıcda API bazanı özü qurur (`alembic upgrade head`: sxem, trigger-lər,
icazə qaydaları). Caddy HTTPS sertifikatını avtomatik alır (DNS serverə
yönəlməyibsə sertifikat alınmır — `docker compose logs web` baxın).

## 5. Supabase-dən data və faylların köçürülməsi

Əvvəlcə **sınaq** (heç nə yazmır):

```bash
# Supabase → Project Settings → Database → Connection string (Session pooler)
export SOURCE_DB_URL='postgresql://postgres.<ref>:<parol>@<host>:5432/postgres'
docker compose run --rm -e SOURCE_DB_URL api python scripts/migrate_data.py --dry-run
```

Sonra köçürmə (idempotentdir — təkrar işə salmaq təhlükəsizdir):

```bash
docker compose run --rm -e SOURCE_DB_URL api python scripts/migrate_data.py
docker compose run --rm -e SOURCE_DB_URL api python scripts/migrate_data.py --verify

# Fayllar (Supabase → Settings → API → service_role açarı)
export SUPABASE_URL='https://<ref>.supabase.co' SUPABASE_SERVICE_KEY='<service_role>'
docker compose run --rm -e SOURCE_DB_URL -e SUPABASE_URL -e SUPABASE_SERVICE_KEY \
  api python scripts/migrate_storage.py
docker compose run --rm -e SUPABASE_URL api \
  python scripts/migrate_storage.py --rewrite-urls https://api.ellit.az
unset SOURCE_DB_URL SUPABASE_SERVICE_KEY
```

Pul yoxlaması (Supabase SQL editorunda da eyni sorğunu işlədib tutuşdurun):

```bash
docker compose exec db psql -U ellit -d ellit -c \
  "select sum(balance), sum(bonus_balance) from profiles"
```

Keçid gününün tam ardıcıllığı: `backend/docs/CUTOVER.md`.

## 6. Mobil tətbiq

`ellit_booking/lib/.env` → `API_URL=https://api.ellit.az`, yeni build mağazalara.
Google Console-da redirect: `https://api.ellit.az/auth/v1/callback`.

## Gündəlik işlər

| Nə | Əmr |
|---|---|
| Yeniləmə (yeni kod) | `cd ~/project && git pull && cd deploy && docker compose up -d --build` |
| Loglar | `docker compose logs -f api` / `worker` / `web` |
| Yenidən başlatma | `docker compose restart api worker` |
| Baza konsolu | `docker compose exec db psql -U ellit -d ellit` |
| Backup (əl ilə) | `./backup.sh` |
| Backup (gündəlik) | `crontab -e` → `17 3 * * * /root/project/deploy/backup.sh >> /var/log/ellit-backup.log 2>&1` |
| Backup-dan bərpa | `docker compose exec -T db pg_restore -U ellit -d ellit --clean --if-exists < backups/TARIX/ellit.dump` |

Kompüterinizdən bazaya baxmaq (port xaricə açılmadan, SSH tuneli ilə):
`docker-compose.yml`-də `db` altındakı `ports: ["127.0.0.1:5432:5432"]` sətrini
açın, `docker compose up -d db`, sonra kompüterdə
`ssh -L 5432:127.0.0.1:5432 root@SERVER_IP` → DBeaver/pgAdmin `localhost:5432`.

## Baza ayrı serverdədirsə (SSH tuneli)

`db` servisini silin və `.env`-də:

```ini
DATABASE_URL=postgresql+asyncpg://ellit:<parol>@127.0.0.1:5432/ellit   # baza serverindən görünən ünvan
SSH_HOST=db.ellit.az
SSH_USER=ellit
SSH_KEY_PATH=/run/secrets/ellit/db_tunnel_key       # açarı deploy/secrets/ altına qoyun
SSH_HOST_FINGERPRINT=SHA256:…                        # docker compose run --rm api python -m app.db.tunnel --fingerprint
```

`docker-compose.yml`-də `api` və `worker` üçün `DATABASE_URL` sətrini silin
(`.env`-dəki istifadə olunsun). Yoxlama: `docker compose run --rm api python -m app.db.tunnel`.
