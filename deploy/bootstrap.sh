#!/usr/bin/env bash
#
# One-time server setup. Run once on a fresh VPS, as a user with sudo:
#
#   sudo bash deploy/bootstrap.sh
#
# Installs system packages, creates the service user and directories, installs
# Caddy, and registers the two systemd units. It does NOT deploy the code or
# touch the database — that is deploy.sh. Safe to re-run.

set -euo pipefail

APP_DIR=/opt/fliptech
DATA_DIR=/var/lib/fliptech
SERVICE_USER=fliptech
NODE_MAJOR=24

if [ "$(id -u)" -ne 0 ]; then
  echo "Run with sudo." >&2
  exit 1
fi

HERE="$(cd "$(dirname "$0")" && pwd)"

echo "==> System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# GDAL, GEOS and PROJ are C libraries that pip cannot supply. This is the same
# requirement that forced WSL for local development on Windows.
apt-get install -y -qq \
  python3-venv python3-dev build-essential \
  gdal-bin libgdal-dev binutils libproj-dev libgeos-dev \
  libpq-dev redis-server curl ca-certificates gnupg git rsync

echo "==> Node ${NODE_MAJOR}"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt "$NODE_MAJOR" ]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
fi
node -v | sed 's/^/    node /'

echo "==> pnpm"
# The frontend's only lockfile is pnpm-lock.yaml, so deploy.sh installs with
# pnpm and this has to exist before it runs. Installed globally with npm rather
# than through corepack: corepack caches per user, and the build runs as the
# fliptech service account, which has no login shell and no writable HOME by
# the time systemd hardening is in the picture. A global install is visible to
# every user and needs no cache.
#
# Pinned to the version in frontend/package.json's packageManager field. Change
# both together.
if ! command -v pnpm >/dev/null || [ "$(pnpm --version 2>/dev/null)" != "11.22.0" ]; then
  npm install -g pnpm@11.22.0 >/dev/null
fi
pnpm --version | sed 's/^/    pnpm /'

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi
caddy version | sed 's/^/    /'

echo "==> Swap"
# The Next.js production build is the memory peak of the whole deploy. On a 4 GB
# box that also runs PostgreSQL it can be killed by the OOM reaper, and the
# build simply dies with no useful error. Swap is the cheap insurance.
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 6000 ] && [ "$swap_mb" -lt 1500 ] && [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    2 GB swap added"
else
  echo "    swap already adequate (${swap_mb} MB)"
fi

echo "==> Service user and directories"
# A dedicated system account with no login shell. The web processes then cannot
# read your home directory or use your SSH keys if one of them is compromised.
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"

install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$APP_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR/static"
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR/media"

# Private evidence: owner-only, and deliberately NOT under the directory Caddy
# serves. Section 10 requires verification evidence is never publicly served.
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 700 "$DATA_DIR/private-media"

install -d -o caddy -g caddy /var/log/caddy 2>/dev/null || install -d /var/log/caddy

echo "==> systemd units"
install -m 644 "$HERE/fliptech-api.service" /etc/systemd/system/
install -m 644 "$HERE/fliptech-web.service" /etc/systemd/system/
# Mode 644 explicitly: the repo lives on an exFAT volume during development,
# which reports every file as executable, and systemd warns about executable
# unit files.
systemctl daemon-reload
systemctl enable redis-server >/dev/null 2>&1 || true
systemctl start redis-server >/dev/null 2>&1 || true

echo "==> Firewall"
if command -v ufw >/dev/null; then
  ufw allow 22/tcp  >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  echo "    22, 80, 443 allowed (5432 deliberately not opened — the database is local)"
fi

cat <<DONE

Bootstrap complete.

Next:
  1. Put your domain in /etc/caddy/Caddyfile (copy deploy/Caddyfile), then:
         sudo systemctl reload caddy
  2. Get the code to ${APP_DIR} (git clone, or rsync from your machine).
  3. Create ${APP_DIR}/backend/.env and ${APP_DIR}/frontend/.env.production.
  4. Run ./deploy.sh

Caddy needs a real hostname pointed at this server before it can issue a
certificate. It cannot do so for a bare IP address.
DONE
