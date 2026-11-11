#!/bin/bash
# .env-də bir ayarı redaktorsuz yazır/dəyişir.
#   ./set-env.sh AÇAR            → dəyər gizli soruşulur (sirlər üçün)
#   ./set-env.sh AÇAR 'dəyər'    → dəyər birbaşa
#   ./set-env.sh --show          → ayarların adları və dolu/boş olduğu (dəyərlər göstərilmir)
#   ./set-env.sh --clear AÇAR    → dəyəri boşaldır
# Xüsusi simvollar ($ * # ' " boşluq) avtomatik düzgün yazılır.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo ".env yoxdur — əvvəlcə: cp .env.example .env"; exit 1; }

if [ "${1:-}" = "--show" ]; then
  python3 - <<'PY'
import re
PLAIN = {"WEB_DOMAIN", "API_DOMAIN", "WEB_SITE", "API_SITE", "COMPOSE_FILE", "TRUSTED_PROXIES",
         "CLIENT_IP_HEADER", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "SMTP_FROM", "API_WORKERS",
         "APPLE_BUNDLE_ID", "APPLE_SERVICE_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID",
         "APPLE_PRIVATE_KEY_PATH", "AUTH_REDIRECT_URLS", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_IDS"}
for line in open(".env", encoding="utf-8"):
    m = re.match(r"^([A-Z_][A-Z0-9_]*)=(.*)$", line.rstrip("\n"))
    if not m:
        continue
    k, v = m.groups()
    # docker compose (env_file) qaydası: soldakı boşluq atılır; dırnaqsız dəyərdə
    # " #"-dan sonrası şərhdir. DİQQƏT: "KEY=   # şərh" boş DEYİL — dəyər "# şərh" olur.
    v = v.lstrip()
    end = v.find(v[0], 1) if v[:1] in ("'", '"') else -1
    if end > 0:
        v = v[1:end]
    else:
        v = v.split(" #", 1)[0].rstrip()
    if k in PLAIN:
        print(f"{k:<28} {v or '(boş)'}")
    else:
        print(f"{k:<28} {'dolu (%d simvol)' % len(v) if v else '(boş)'}")
PY
  exit 0
fi

if [ "${1:-}" = "--clear" ]; then
  key="${2:?İstifadə: ./set-env.sh --clear AÇAR}"
  [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "Yanlış ayar adı: $key"; exit 1; }
  sed -i "s/^${key}=.*/${key}=/" .env
  echo "$key boşaldıldı ✓"
  exit 0
fi

key="${1:?İstifadə: ./set-env.sh AÇAR [dəyər]}"
[[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || { echo "Yanlış ayar adı: $key"; exit 1; }
if [ $# -ge 2 ]; then
  val="$2"
else
  read -r -s -p "$key dəyəri (ekranda görünmür): " val; echo
fi
[ -n "$val" ] || { echo "Dəyər boşdur — heç nə dəyişmədi."; exit 1; }

KEY="$key" VAL="$val" python3 - <<'PY'
import os, re, sys
k, v = os.environ["KEY"], os.environ["VAL"]
if "\n" in v:
    sys.exit("Dəyər bir neçə sətirdir — yalnız bir sətir olmalıdır.")
if re.fullmatch(r"[A-Za-z0-9_./:@,+=*-]*", v) and "$" not in v:
    line = f"{k}={v}"
elif "'" not in v:
    line = f"{k}='{v}'"            # tək dırnaq: hər şey olduğu kimi ($ daxil)
elif "$" not in v:
    line = k + '="' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
else:
    sys.exit("Dəyərdə həm ' həm də $ var — bu sirri dəyişin (məs. yenisini yaradın).")
lines = open(".env", encoding="utf-8").read().splitlines()
pat = re.compile(rf"^{re.escape(k)}=")
done = False
for i, l in enumerate(lines):
    if pat.match(l):
        if not done:
            lines[i] = line
            done = True
        else:
            lines[i] = "# (təkrar silindi) " + k + "=…"
if not done:
    lines.append(line)
open(".env", "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"{k} yazıldı ✓")
PY
chmod 600 .env
