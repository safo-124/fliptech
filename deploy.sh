#!/usr/bin/env bash
#
# Deploy on the VPS. Idempotent — safe to re-run.
#
#   ./deploy.sh
#
# Migrations run before the new containers take traffic, so a failed migration
# leaves the previous release serving rather than a half-migrated database
# behind a new one.

set -euo pipefail

cd "$(dirname "$0")"

if [ ! -f .env.production ]; then
  echo "No .env.production. Copy .env.production.example and fill it in." >&2
  exit 1
fi

# Fail early and loudly rather than deploying with a placeholder secret.
if grep -qE '^DJANGO_SECRET_KEY=\s*$' .env.production; then
  echo "DJANGO_SECRET_KEY is empty in .env.production." >&2
  exit 1
fi
if grep -q 'CHANGE_ME' .env.production; then
  echo ".env.production still contains CHANGE_ME." >&2
  exit 1
fi

echo "==> Building images"
docker compose build

echo "==> Checking the database is usable"
# Reports missing PostGIS, a plain postgres:// scheme, an unencrypted remote
# connection or insufficient privileges — before anything is written.
docker compose run --rm django python manage.py check_database

echo "==> Applying migrations"
docker compose run --rm django python manage.py migrate --noinput

echo "==> Ensuring back-office roles exist"
docker compose run --rm django python manage.py setup_groups

echo "==> Starting"
docker compose up -d --remove-orphans

echo "==> Waiting for health"
for _ in $(seq 1 30); do
  if docker compose exec -T django curl -fsS http://127.0.0.1:8000/healthz/ >/dev/null 2>&1; then
    echo "    django healthy"
    break
  fi
  sleep 2
done

docker compose ps
echo
echo "Done. If this is the first deploy, create the admin account:"
echo "  docker compose exec django python manage.py createsuperuser"
