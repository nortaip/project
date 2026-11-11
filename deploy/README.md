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

> Əmrləri **blok-blok** icra edin və hər blokdan sonra xəta olub-olmadığına baxın.
> Bir addım alınmasa, növbətiləri başqa qovluqda işləyib orada faylları
> dəyişə bilər (məs. serverdəki başqa tətbiqin `.env`-ini).

Repo private olduğu üçün serverə **yalnız oxuma** hüquqlu deploy açarı lazımdır.

**2a.** Açarı yaradın və SSH ayarını yazın:

```bash
cd ~
ssh-keygen -t ed25519 -f ~/.ssh/ellit_deploy -N ''
cat >> ~/.ssh/config <<'CFG'
Host github-ellit
  HostName github.com
  User git
  IdentityFile ~/.ssh/ellit_deploy
  IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
cat ~/.ssh/ellit_deploy.pub
```

**2b.** Ekrana çıxan `ssh-ed25519 …` sətrini kopyalayın: GitHub →
`nortaip/project` → **Settings → Deploy keys → Add deploy key** → yapışdırın,
"Allow write access" **işarələməyin** → Add key.

**2c.** Yoxlayın və klonlayın:

```bash
ssh -T github-ellit        # "Hi nortaip/project! You've successfully authenticated…" (ilk dəfə "yes" yazın)
git clone -b claude/cool-planck-80kldx github-ellit:nortaip/project.git ~/project \
  && cd ~/project/deploy && pwd     # /root/project/deploy çıxmalıdır
```

## 3. Ayarlar (.env)

```bash
# "&&": qovluq yoxdursa heç nə icra olunmur — başqa yerdə .env yaradılmasın
cd ~/project/deploy && cp -n .env.example .env && chmod 600 .env   # -n: mövcud .env-in üzərinə YAZMIR
# Güclü sirlər yaradın və .env-ə yazın:
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
sed -i "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" .env
nano .env     # domenlər, SMTP, Google/Apple, Epoint açarlarını doldurun
```

Redaktorsuz (tövsiyə olunur — xüsusi simvollu parollar düzgün yazılır):

```bash
./set-env.sh SMTP_PASSWORD          # dəyər gizli soruşulur
./set-env.sh SMTP_HOST smtp.gmail.com
./set-env.sh --show                 # hansı ayarlar dolu/boş (sirlər göstərilmir)
```

Firebase push üçün service-account JSON-u `deploy/secrets/firebase.json` kimi
qoyun (`scp firebase.json root@SERVER_IP:~/project/deploy/secrets/`).

> Sirlər yalnız serverdəki bu `.env`-də saxlanır — git-ə, çata, e-poçta yazmayın.

## Cloudflare Tunnel ilə (port açmadan) — domen Cloudflare-dədirsə tövsiyə olunur

Serverdə heç bir port açılmır, DNS A qeydi lazım deyil, HTTPS-i Cloudflare edir;
serverdəki digər saytlara (80/443-ü tutan proxy-lərə) toxunulmur.

1. Cloudflare → **Zero Trust → Networks → Tunnels → Create a tunnel →
   Cloudflared**, ad: `ellit`. "Install connector" ekranındakı əmrdə
   `--token` sözündən sonrakı uzun sətri kopyalayın (bu **sirdir** — yalnız
   serverdəki `.env`-ə yazın).
2. **Public hostname** əlavə edin: Subdomain `api`, Domain `ellit.az`,
   Service **HTTP**, URL `web:80`. DNS qeydini Cloudflare özü yaradır
   (əl ilə yaradılmış `api` A qeydi varsa, əvvəlcə onu silin).
3. Serverdə `deploy/.env`:

   ```ini
   COMPOSE_FILE=docker-compose.yml:docker-compose.tunnel.yml
   CLOUDFLARE_TUNNEL_TOKEN=<token>
   WEB_SITE="http://ellit.az, http://www.ellit.az"
   API_SITE=http://api.ellit.az
   TRUSTED_PROXIES=private_ranges
   CLIENT_IP_HEADER=Cf-Connecting-Ip
   ```

4. `docker compose up -d --build` → `docker compose logs --tail 20 cloudflared`
   ("Registered tunnel connection") → `curl https://api.ellit.az/health`.

Keçid günü eyni tunelə ikinci public hostname əlavə olunur: `ellit.az` → HTTP
→ `web:80` (və `www`). Mövcud `ellit.az` A qeydləri əvvəlcə silinməlidir.

İstifadəçinin həqiqi IP-si (sorğu limiti üçün) Cloudflare-in `Cf-Connecting-Ip`
başlığından götürülür; saxta `X-Forwarded-For` nəzərə alınmır.

## Serverdə artıq başqa sayt varsa (80/443 tutulub)

Əvvəlcə yoxlayın: `ss -ltnp | grep -E ':(80|443) '` və `docker ps`.

### a) 80/443-ü başqa Docker konteyneri (Caddy/nginx) tutursa — tövsiyə olunan

Ellit portları host-a açmır, qarşıdakı proxy ilə ortaq `edge` şəbəkəsinə qoşulur:

```bash
docker network create edge
docker network connect edge <qarşı-proxy-konteyneri>      # məs. uberfrontbot-caddy-1
```

`deploy/.env`-də (`.env.example`-də hazırdır):

```ini
COMPOSE_FILE=docker-compose.yml:docker-compose.edge.yml
WEB_SITE=http://ellit.az
API_SITE=http://api.ellit.az
TRUSTED_PROXIES=private_ranges
```

Qarşı proxy-nin Caddyfile-ına (HTTPS-i o edir):

```caddyfile
ellit.az, www.ellit.az, api.ellit.az {
	reverse_proxy ellit-web:80
}
```

və onu yenidən yükləyin (`docker exec <konteyner> caddy reload --config /etc/caddy/Caddyfile`).
`docker network connect` konteyner yenidən yaradılanda itir — qalıcı olsun deyə
həmin layihənin compose faylında `edge` şəbəkəsini `external: true` kimi əlavə edin.

### b) Host-da nginx işləyirsə

`deploy/nginx-existing-proxy.conf`-u nginx-ə
əlavə edin (faylın başında əmrlər var), `deploy/.env`-də `WEB_SITE`,
`API_SITE`, `HTTP_BIND`, `HTTPS_BIND`, `TRUSTED_PROXIES` sətrlərini açın
(`.env.example`-də hazırdır). Ellit konteyneri yalnız `127.0.0.1:8088`-də
dinləyir, HTTPS-i mövcud nginx + certbot edir.

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

## Keçid (cutover) — `ellit.az` yeni serverə

**Əvvəlcədən (.env):** `EPOINT_PUBLIC_KEY`/`EPOINT_PRIVATE_KEY` — **veb** Epoint
hesabının açarları; `GOOGLE_OAUTH_CLIENT_ID/SECRET` (Google Console-da redirect:
`https://api.ellit.az/auth/v1/callback`); Apple (aşağıda); `SMTP_*`; Firebase JSON.
`docker compose up -d --build api web` ilə tətbiq edin.

**Apple ilə veb girişi:** Apple Developer → Identifiers → **Services IDs** →
veb üçün olan Services ID → Sign in with Apple → Configure: **Domains** siyahısına
`api.ellit.az`, **Return URLs** siyahısına `https://api.ellit.az/auth/v1/callback`
əlavə edin (köhnə Supabase ünvanı qala bilər). Sonra `.env`:

```bash
./set-env.sh APPLE_SERVICE_ID       # Services ID (məs. az.ellit.web)
./set-env.sh APPLE_TEAM_ID          # Team ID (10 simvol, hesabın sağ yuxarısında)
./set-env.sh APPLE_KEY_ID           # Keys → Sign in with Apple açarının Key ID-si
# .p8 açar faylı (bir dəfə endirilir): scp AuthKey_XXXX.p8 root@SERVER:~/project/deploy/secrets/apple.p8
chmod 644 secrets/apple.p8
./set-env.sh APPLE_PRIVATE_KEY_PATH /run/secrets/ellit/apple.p8
docker compose up -d api
```

`.p8` faylı yoxdursa: Supabase → Authentication → Providers → Apple-dakı hazır
**Secret Key (for OAuth)** JWT-ni `./set-env.sh APPLE_CLIENT_SECRET` ilə yazın
(ən çox 6 ay işləyir — `.p8` ilə isə backend onu özü yeniləyir).

> `.env`-də `AÇAR=   # şərh` yazmayın: docker compose bunu boş yox, `# şərh`
> dəyəri kimi oxuyur. Boşaltmaq üçün: `./set-env.sh --clear AÇAR`.

**1. Son köçürmə** — yeni bazanı sıfırlayır, Supabase-in son vəziyyətini
köçürür, faylları yeniləyir, say və pul cəmlərini tutuşdurur, worker-i başladır
(fərq olsa dayanır). Supabase-ə yazmır:

```bash
cd ~/project/deploy && git pull && docker compose build api web
# SOURCE_DB_URL (bölmə 5-dəki parol bloku), sonra:
read -s -p "service_role açarı: " SUPABASE_SERVICE_KEY && echo && export SUPABASE_SERVICE_KEY
export SUPABASE_URL=https://fvvxtnjfjtqrhpecsvpd.supabase.co
./cutover.sh            # "BAŞLA" yazın; sonda "CƏMLƏR EYNİDİR ✓" və "KEÇİD HAZIRDIR ✓"
unset SOURCE_DB_URL SUPABASE_SERVICE_KEY
```

**2. Cloudflare DNS → tunel:**
1. **DNS → Records**-da `ellit.az` və `www` qeydlərinin **ekran görüntüsünü
   çəkin** (geri dönüş üçün), sonra onları silin.
2. **Zero Trust → Networks → Tunnels → ellit → Public hostnames**: iki ünvan
   əlavə edin — `ellit.az` → `http://web:80` və `www.ellit.az` → `http://web:80`.
3. `.env`-də: `WEB_SITE="http://ellit.az, http://www.ellit.az"`, sonra
   `docker compose up -d web`.

**3. Epoint (veb hesabı):** ödəniş nəticəsi (callback) ünvanını
`https://api.ellit.az/functions/v1/payment-webhook` edin. Mobil Epoint
hesabına toxunmayın — mobil tətbiq yenilənənə qədər Supabase ilə işləyir.

**4. Yoxlama:** `https://ellit.az` açılır, köhnə hesabla giriş, sifarişlər,
balans; kiçik məbləğlə balans artırma (callback gəlir, balans artır).

**Geri dönüş:** Cloudflare-də tunelin `ellit.az`/`www` ünvanlarını silin və
ekran görüntüsündəki köhnə DNS qeydlərini bərpa edin; Epoint veb callback-ini
köhnə ünvana qaytarın.

> **Diqqət (veb yeni bazada, mobil Supabase-də):** bu müddətdə iki baza ayrı
> yaşayır — vebdə yaradılan sifarişləri, qeydiyyatları, balans dəyişikliklərini
> köhnə mobil tətbiq görmür və əksinə. Mobil yeniləmə nə qədər tez çıxsa, fərq
> o qədər az olar; mobil keçəndə Supabase-dəki yeni data ayrıca birləşdirilməlidir.

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
