#!/usr/bin/env bash
#
# Point local development at the server's PostgreSQL, over an SSH tunnel.
#
#   ./link-remote-db.sh
#
# Run this from WSL, not from Windows and not on the server. It rotates the
# server's database password to a fresh value, writes it into
# backend/.env.remote together with the tunnel address, and verifies the
# result. The password is never printed and never has to be copied by hand.
#
# Afterwards, prefix any command to use the server's database:
#
#   ENV_FILE=.env.remote python manage.py migrate
#
# Leave the prefix off and you are back on your local database. Tests always
# read .env, so they cannot touch the server.

set -euo pipefail

SERVER="${SERVER:-safo@135.181.93.156}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
DB_NAME="${DB_NAME:-skillshub}"
DB_USER="${DB_USER:-skillshub}"

cd "$(dirname "$0")/backend"

if [ ! -f .env ]; then
  echo "backend/.env is missing — set up local development first." >&2
  exit 1
fi

echo "==> Rotating the database password on the server"
# Generated here, applied there, stored here. It exists in exactly two places
# and passes through a file rather than a command line, so it never appears in
# the server's process list.
NEWPW="$(openssl rand -hex 32)"
TMP_SQL="$(mktemp)"
printf "ALTER ROLE %s PASSWORD '%s';\n" "$DB_USER" "$NEWPW" > "$TMP_SQL"
chmod 600 "$TMP_SQL"

scp -q "$TMP_SQL" "$SERVER:/tmp/rot.sql"
rm -f "$TMP_SQL"

# Feed the file on stdin rather than with psql -f. scp leaves it owned by the
# login user with mode 600, so `sudo -u postgres psql -f` fails with
# "Permission denied" — postgres cannot read it. With a redirect the shell
# opens the file as the login user and hands psql the descriptor, so the file
# stays unreadable to everyone else. sudo still reads its own prompt from the
# tty that -t allocates.
if ! ssh -t "$SERVER" 'sudo -u postgres psql -q -v ON_ERROR_STOP=1 < /tmp/rot.sql; rc=$?; shred -u /tmp/rot.sql; exit $rc'; then
  echo
  echo "  The password was NOT changed on the server, so nothing is out of sync." >&2
  echo "  Re-run this script and enter the sudo password correctly." >&2
  exit 1
fi

echo "==> Writing backend/.env.remote"
# Rebuilt from .env every run, so it cannot drift. Note the host: the tunnel's
# near end on this machine, NOT localhost:5432 which is your local database.
cp .env .env.remote
python3 - "$NEWPW" "$LOCAL_PORT" "$DB_USER" "$DB_NAME" <<'PY'
import sys, pathlib, re
pw, port, user, db = sys.argv[1:5]
p = pathlib.Path(".env.remote")
lines = []
for line in p.read_text().splitlines():
    if line.startswith("DATABASE_URL="):
        line = f"DATABASE_URL=postgis://{user}:{pw}@127.0.0.1:{port}/{db}"
    lines.append(line)
p.write_text("\n".join(lines) + "\n")
PY
chmod 600 .env.remote
unset NEWPW

echo "==> Checking the tunnel"
if ! nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
  cat <<EOF

  The tunnel is not open, so the check below cannot run yet.

  Open it in another WSL window and leave it running:

      ssh -N -L ${LOCAL_PORT}:127.0.0.1:5432 ${SERVER}

  Then come back here and run:

      ENV_FILE=.env.remote /opt/venvs/skillshub/bin/python manage.py check_database

EOF
  exit 0
fi

ENV_FILE=.env.remote /opt/venvs/skillshub/bin/python manage.py check_database
