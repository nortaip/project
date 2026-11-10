# Veb sayt (React) + HTTPS proxy (Caddy) — bir obraz.
# Build kontekstı: repo kökü (deploy/docker-compose.yml bunu təyin edir).

# ── 1. Veb build ──
FROM node:22-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Server ünvanı build zamanı sayta (və CSP-yə) yazılır
ARG VITE_API_URL
ARG VITE_EPOINT_PUBLIC_KEY=""
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL verilməyib (deploy/.env)" && exit 1)
ENV VITE_API_URL=$VITE_API_URL VITE_EPOINT_PUBLIC_KEY=$VITE_EPOINT_PUBLIC_KEY
RUN npm run build

# ── 2. Caddy: statik sayt + API proxy + avtomatik HTTPS (Let's Encrypt) ──
FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv
