#!/usr/bin/env bash
#
# Preflight for the VPS. Read-only — changes nothing, installs nothing.
#
#   bash server-check.sh
#
# Answers the questions the deploy depends on: is there enough memory to build,
# is Docker present, does PostgreSQL have PostGIS, and are 80/443 free.

set -uo pipefail

say()  { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }
ok()   { printf '  \033[32mok\033[0m   %s\n' "$1"; }
warn() { printf '  \033[33mwarn\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31mBAD\033[0m  %s\n' "$1"; }

say "Host"
. /etc/os-release && echo "  $PRETTY_NAME  ($(uname -m), kernel $(uname -r))"
echo "  vCPU: $(nproc)"

say "Memory and disk"
mem_total_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
swap_total_mb=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
echo "  RAM:  ${mem_total_mb} MB"
echo "  Swap: ${swap_total_mb} MB"
df -h / | awk 'NR==2 {print "  Disk: " $4 " free of " $2}'

# The Next.js production build is the memory peak of the whole deploy. On a 4 GB
# box that also runs PostgreSQL, it can be killed by the OOM reaper without an
# obvious error — the build just dies. Swap is the cheap insurance.
if [ "$mem_total_mb" -lt 6000 ] && [ "$swap_total_mb" -lt 1500 ]; then
  warn "Under 6 GB RAM and little swap. Add 2 GB before building images:"
  echo "         sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile"
  echo "         sudo mkswap /swapfile && sudo swapon /swapfile"
  echo "         echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab"
else
  ok "Memory headroom looks sufficient for an image build"
fi

say "Docker"
if command -v docker >/dev/null 2>&1; then
  ok "$(docker --version)"
  if docker compose version >/dev/null 2>&1; then
    ok "$(docker compose version)"
  else
    bad "docker compose plugin missing"
  fi
  docker info >/dev/null 2>&1 && ok "current user can run docker" \
    || warn "cannot run docker as this user — add yourself: sudo usermod -aG docker \$USER, then log out and back in"
else
  bad "Docker not installed"
  echo "         curl -fsSL https://get.docker.com | sudo sh"
fi

say "PostgreSQL"
if command -v psql >/dev/null 2>&1; then
  ok "client $(psql -V | awk '{print $3}')"
  if command -v pg_lsclusters >/dev/null 2>&1; then
    pg_lsclusters 2>/dev/null | sed 's/^/  /'
    pg_major=$(pg_lsclusters -h 2>/dev/null | awk 'NR==1 {print $1}')
  fi
  pg_major=${pg_major:-$(psql -V | awk '{print $3}' | cut -d. -f1)}

  # PostGIS is the requirement people miss: the project stores geometry, which
  # a plain PostgreSQL cannot do.
  # -n so sudo fails immediately instead of prompting. Without it, running this
  # script over a non-interactive ssh made the query fail for want of a
  # password, 2>/dev/null hid that, and an installed PostGIS was reported as
  # missing — which sends you off installing a package you already have.
  if sudo -n -u postgres psql -tAc "SELECT 1 FROM pg_available_extensions WHERE name='postgis'" 2>/dev/null | grep -q 1; then
    ok "postgis is available to the server"
    sudo -n -u postgres psql -tAc \
      "SELECT datname FROM pg_database WHERE datname NOT IN ('template0','template1')" 2>/dev/null \
      | sed 's/^/  database: /'
  elif sudo -n true 2>/dev/null; then
    bad "postgis NOT available — provider search cannot work without it"
    echo "         sudo apt install postgresql-${pg_major}-postgis-3"
  elif dpkg -l 2>/dev/null | grep -q "postgresql-${pg_major}-postgis"; then
    ok "postgis package is installed (extension not queried — needs sudo)"
  else
    warn "cannot check postgis without sudo. Re-run on a terminal with sudo access."
  fi
else
  warn "No psql on this host. Fine if the database lives elsewhere."
fi

say "Ports"
for p in 80 443; do
  if ss -ltnH "( sport = :$p )" 2>/dev/null | grep -q .; then
    bad "port $p already in use — Caddy cannot bind it"
    ss -ltnp "( sport = :$p )" 2>/dev/null | sed 's/^/       /'
  else
    ok "port $p free"
  fi
done

say "Firewall"
if command -v ufw >/dev/null 2>&1; then
  sudo ufw status 2>/dev/null | head -8 | sed 's/^/  /'
else
  echo "  ufw not installed"
fi

say "Public address"
ip -4 addr show scope global 2>/dev/null | awk '/inet /{print "  " $2}' | head -3
echo
echo "Point your domain's A record at that address before deploying:"
echo "Caddy needs a real hostname to issue a TLS certificate."
