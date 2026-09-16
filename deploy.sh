#!/usr/bin/env bash
#
# Deploy on the VPS, without Docker. Idempotent — safe to re-run.
#
#   ./deploy.sh
#
# Run deploy/bootstrap.sh once first. This script installs dependencies,
# migrates, builds the frontend and restarts both services.
#
# Ordering matters: everything that can fail is done BEFORE either service is
# restarted, so a broken release leaves the previous one serving rather than
# putting a half-built one in front of users.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fliptech}"
DATA_DIR="${DATA_DIR:-/var/lib/fliptech}"
SERVICE_USER="${SERVICE_USER:-fliptech}"
VENV="$APP_DIR/backend/.venv"

cd "$APP_DIR"

# -H sets HOME to the service user's own home. Without it HOME stays whoever
# invoked the deploy — root, or your own account — and pnpm puts its content
# store there instead of under /home/fliptech, so the service user cannot reach
# the packages it just installed.
run_as() { sudo -u "$SERVICE_USER" -H "$@"; }

if [ ! -f backend/.env ]; then
  echo "backend/.env is missing. Copy backend/.env.example and fill it in." >&2
  exit 1
fi
if [ ! -f frontend/.env.production ]; then
  echo "frontend/.env.production is missing." >&2
  exit 1
fi
if grep -qE '^DJANGO_SECRET_KEY=\s*$' backend/.env; then
  echo "DJANGO_SECRET_KEY is empty in backend/.env." >&2
  exit 1
fi
if grep -q 'CHANGE_ME' backend/.env; then
  echo "backend/.env still contains CHANGE_ME." >&2
  exit 1
fi
if ! command -v pnpm >/dev/null; then
  echo "pnpm is not installed. Re-run deploy/bootstrap.sh, or: sudo npm install -g pnpm@11.22.0" >&2
  exit 1
fi

echo "==> Backend dependencies"
[ -d "$VENV" ] || run_as python3 -m venv "$VENV"
run_as "$VENV/bin/pip" install --quiet --upgrade pip
run_as "$VENV/bin/pip" install --quiet -r backend/requirements.txt

echo "==> Checking the database"
# Reports a missing PostGIS extension, a plain postgres:// scheme or an
# unencrypted remote connection before anything is written.
( cd backend && run_as "$VENV/bin/python" manage.py check_database )

echo "==> Migrations"
( cd backend && run_as "$VENV/bin/python" manage.py migrate --noinput )

echo "==> Back-office roles"
( cd backend && run_as "$VENV/bin/python" manage.py setup_groups )

echo "==> Static files"
( cd backend && run_as "$VENV/bin/python" manage.py collectstatic --noinput --clear >/dev/null )

echo "==> Deployment checks"
# --deploy surfaces missing HSTS, insecure cookies and a debug-mode leak. It is
# advisory here rather than fatal, but it should be read.
( cd backend && run_as "$VENV/bin/python" manage.py check --deploy 2>&1 | tail -20 ) || true

echo "==> Frontend"
cd frontend
# pnpm, not npm. pnpm-lock.yaml is the only lockfile in the repo, and CI and the
# Dockerfile both install from it. `npm ci` therefore had nothing to read, fell
# through to `npm install` — and that WRITES a package-lock.json. The next
# deploy then found a lockfile, `npm ci --omit=dev` succeeded, and the build
# lost typescript, tailwindcss and @tailwindcss/postcss, which are all
# devDependencies that `next build` needs. The first deploy worked and the one
# after it failed.
#
# --prod=false keeps those devDependencies even if NODE_ENV=production is
# inherited from the environment, which pnpm would otherwise honour.
run_as pnpm install --frozen-lockfile --prod=false
# NEXT_PUBLIC_* values are inlined at build time, not read at run time, so the
# build has to see them. Changing the domain or brand name means rebuilding.
set -a; . ./.env.production; set +a
run_as env \
  NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-}" \
  NEXT_PUBLIC_SITE_URL="${NEXT_PUBLIC_SITE_URL:-}" \
  NEXT_PUBLIC_BRAND_NAME="${NEXT_PUBLIC_BRAND_NAME:-Fliptech}" \
  NEXT_PUBLIC_MEDIA_HOST="${NEXT_PUBLIC_MEDIA_HOST:-}" \
  pnpm build
cd ..

echo "==> Restarting"
# Only now, once every fallible step has succeeded.
sudo systemctl restart fliptech-api
sudo systemctl restart fliptech-web

echo "==> Health"
# The probe goes to gunicorn on loopback, so it has to look like a request that
# arrived through Caddy, or it never reaches the view:
#
#   Host             ALLOWED_HOSTS is the public hostname, so Django answered
#                    "127.0.0.1:8000" with a 400 DisallowedHost and the deploy
#                    reported a dead API while the site was serving perfectly.
#   X-Forwarded-Proto  SECURE_SSL_REDIRECT is on in production. Over plain HTTP
#                    Django replies 301 to https, and `curl -fsS` treats a 301
#                    as success without following it — a health check that
#                    passes on a redirect is worse than none.
#
# The hostname comes from the env file rather than being hardcoded, so this
# keeps working when the domain changes.
health_host=$(grep -E '^DJANGO_ALLOWED_HOSTS=' backend/.env | cut -d= -f2- | cut -d, -f1 | tr -d '[:space:]')
probe_api() {
  curl -fsS --max-time 5 \
    -H "Host: ${health_host}" \
    -H "X-Forwarded-Proto: https" \
    http://127.0.0.1:8000/healthz/
}

ok=false
for _ in $(seq 1 30); do
  if probe_api >/dev/null 2>&1; then ok=true; break; fi
  sleep 2
done
if [ "$ok" = true ]; then
  echo "    api healthy: $(probe_api)"
else
  echo "    api did NOT come up. Recent log:" >&2
  sudo journalctl -u fliptech-api -n 30 --no-pager >&2
  exit 1
fi

web=false
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:3000/ 2>/dev/null; then web=true; break; fi
  sleep 2
done
[ "$web" = true ] && echo "    web healthy" || {
  echo "    web did NOT come up. Recent log:" >&2
  sudo journalctl -u fliptech-web -n 30 --no-pager >&2
  exit 1
}

echo
echo "Deployed. If this is the first run, create your account:"
echo "  cd $APP_DIR/backend && sudo -u $SERVICE_USER $VENV/bin/python manage.py createsuperuser"
