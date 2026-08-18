#!/usr/bin/env bash
#
# Hold open the SSH tunnel to the server's PostgreSQL.
#
#   ./tunnel.sh
#
# Run this in its own WSL window and leave it. Development reads
# backend/.env, which points at 127.0.0.1:5433 — the near end of this tunnel —
# so nothing else works while it is down.
#
# It reconnects on its own. A plain `ssh -N -L` dies silently when the network
# drops or the laptop sleeps, and the next Django command then fails with
# "connection refused", which looks like a database problem rather than a
# network one.

set -uo pipefail

SERVER="${SERVER:-safo@135.181.93.156}"
LOCAL_PORT="${LOCAL_PORT:-5433}"
REMOTE_PORT="${REMOTE_PORT:-5432}"

if command -v nc >/dev/null && nc -z 127.0.0.1 "$LOCAL_PORT" 2>/dev/null; then
  echo "Port $LOCAL_PORT is already in use — a tunnel is probably running already."
  echo "Close the other window first, or set LOCAL_PORT to something else."
  exit 1
fi

echo "Tunnel: 127.0.0.1:$LOCAL_PORT -> $SERVER:$REMOTE_PORT"
echo "Leave this window open. Ctrl+C to stop."
echo

trap 'echo; echo "Tunnel closed."; exit 0' INT TERM

while true; do
  # ServerAlive* makes ssh notice a dead link in ~30s instead of hanging on it.
  # ExitOnForwardFailure stops it sitting there connected but not forwarding.
  ssh -N \
      -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 \
      -o ServerAliveCountMax=2 \
      -o ConnectTimeout=10 \
      -L "${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
      "$SERVER"

  echo "$(date '+%H:%M:%S')  tunnel dropped, reconnecting in 5s..."
  sleep 5
done
