# Deploying

One VPS, no Docker. Django under gunicorn, Next.js under `next start`, Caddy in
front for TLS, PostgreSQL and Redis on the same box.

> A Docker Compose setup also exists (`docker-compose.yml`, the two
> `Dockerfile`s). It is not the path in use — everything below is the native
> one. Keep or delete the Docker files as you prefer; nothing here depends on
> them.

---

## Before you start

**A domain pointed at the server.** Caddy obtains and renews certificates
automatically, but it cannot issue one for a bare IP address. Add an `A` record
now — DNS propagation is the only step here with waiting built into it.

**PostgreSQL with PostGIS**, which you already have. If you are starting from
scratch, see [Database](#database) below.

---

## First deploy

### 1. Bootstrap the server, once

```bash
sudo bash deploy/bootstrap.sh
```

Installs the GDAL/GEOS/PROJ system libraries pip cannot supply, Node 24, Caddy
and Redis; creates the `fliptech` service user and the data directories;
registers both systemd units; and adds 2 GB of swap if the box is small.

That swap matters: the Next.js production build is the memory peak of the whole
deploy, and on a 4 GB box also running PostgreSQL the OOM reaper kills it with
no useful error.

### 2. Get the code onto the server

```bash
sudo -u fliptech git clone https://github.com/safo-124/fliptech.git /opt/fliptech
```

Or from your machine, if you would rather not push first:

```bash
rsync -az --exclude node_modules --exclude .venv --exclude .next --exclude .git \
  /d/fliptech/ safo@YOUR_SERVER:/tmp/fliptech/
ssh safo@YOUR_SERVER 'sudo rsync -a /tmp/fliptech/ /opt/fliptech/ && sudo chown -R fliptech:fliptech /opt/fliptech'
```

### 3. Configuration

`/opt/fliptech/backend/.env`:

```
BRAND_NAME=Fliptech
DJANGO_SECRET_KEY=            # python3 -c "import secrets; print(secrets.token_urlsafe(64))"
DJANGO_DEBUG=False
DJANGO_ALLOWED_HOSTS=your-domain.com
CSRF_TRUSTED_ORIGINS=https://your-domain.com
CORS_ALLOWED_ORIGINS=https://your-domain.com

DATABASE_URL=postgis://skillshub:PASSWORD@127.0.0.1:5432/skillshub
REDIS_URL=redis://127.0.0.1:6379/0

DJANGO_STATIC_ROOT=/var/lib/fliptech/static
DJANGO_MEDIA_ROOT=/var/lib/fliptech/media
DJANGO_PRIVATE_MEDIA_ROOT=/var/lib/fliptech/private-media

SMS_PROVIDER=console
```

`/opt/fliptech/frontend/.env.production`:

```
NEXT_PUBLIC_API_URL=https://your-domain.com
NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_BRAND_NAME=Fliptech
```

```bash
sudo chmod 600 /opt/fliptech/backend/.env
sudo chown fliptech:fliptech /opt/fliptech/backend/.env /opt/fliptech/frontend/.env.production
```

### 4. Caddy

```bash
sudo cp /opt/fliptech/deploy/Caddyfile /etc/caddy/Caddyfile
sudo sed -i 's/skillshub.example.com/your-domain.com/' /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 5. Deploy

```bash
cd /opt/fliptech && ./deploy.sh
```

Then create your account — it sets a password, so it is yours to run:

```bash
cd /opt/fliptech/backend && sudo -u fliptech .venv/bin/python manage.py createsuperuser
```

Sign in at `https://your-domain.com/back-office/`.

---

## How it fits together

| Piece | Where |
|---|---|
| Caddy | ports 80/443, TLS, routing |
| Django (gunicorn) | `127.0.0.1:8000`, 2 workers × 4 threads |
| Next.js | `127.0.0.1:3000` |
| PostgreSQL, Redis | local sockets |

Only Caddy listens publicly. Django and Next.js bind to loopback, so neither can
be reached except through it.

**One origin for everything.** Caddy sends `/api`, `/back-office` and `/healthz`
to Django, serves `/static` and `/media` from disk, and everything else to
Next.js. The browser therefore never makes a cross-origin request: no CORS
preflight on the enquiry POST, and back-office session cookies stay first-party.

**Server-side rendering never leaves the machine.** Next.js talks to gunicorn
over loopback via `API_URL_INTERNAL`, while the browser uses the public HTTPS
origin. Using one value for both is the classic deploy bug — SSR requests would
leave the box, cross TLS and come back for no reason.

**`NEXT_PUBLIC_*` is baked in at build time**, not read at run time. Changing the
domain or brand name means re-running `deploy.sh`, which rebuilds.

**deploy.sh restarts nothing until every fallible step has passed.** Dependencies,
the database check, migrations, `collectstatic` and the frontend build all run
first, so a broken release leaves the previous one serving.

### Where files live, and why it matters

| Path | Contents |
|---|---|
| `/opt/fliptech` | code, owned by the `fliptech` service user |
| `/var/lib/fliptech/static` | collected static files, served by Caddy |
| `/var/lib/fliptech/media` | **public** workshop photographs, served by Caddy |
| `/var/lib/fliptech/private-media` | **private** verification evidence and owner ID — mode 700, never served |

Private evidence is deliberately outside the directory Caddy is pointed at.
Section 10 requires it is never publicly served, and widening that `root` or
moving these directories together would leak identity documents. Once Cloudflare
R2 credentials are set the app switches to two buckets automatically and stops
writing here.

The services run as `fliptech`, a system account with no login shell, under
systemd hardening (`ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`).
A compromised web process cannot read your home directory or use your SSH keys.

---

## Database

Already done on this server, kept for reference.

**PostGIS is required, not optional.** Provider search is a geographic query and
`Provider.location` is a geometry column that plain PostgreSQL cannot store.

```bash
sudo apt install postgresql-18-postgis-3     # match your PostgreSQL major version
sudo -u postgres psql
```

```sql
CREATE ROLE skillshub LOGIN PASSWORD 'a-long-random-one';
CREATE DATABASE skillshub OWNER skillshub;
\c skillshub
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
GRANT ALL ON SCHEMA public TO skillshub;
```

Creating the extensions as `postgres` means the app role never needs superuser.

**The scheme is `postgis://`, not `postgres://`.** django-environ picks the
backend from it, and `postgres://` selects one that cannot handle `PointField`.
Verify before migrating:

```bash
cd /opt/fliptech/backend && sudo -u fliptech .venv/bin/python manage.py check_database
```

---

## Routine operations

```bash
./deploy.sh                              # release
sudo journalctl -u fliptech-api -f       # Django logs
sudo journalctl -u fliptech-web -f       # Next.js logs
sudo systemctl restart fliptech-api
sudo systemctl status fliptech-api fliptech-web caddy
```

Nightly backup, held off the server. Section 10 asks for this and notes that an
untested backup is not a backup, so restore-test it once on a scratch database:

```bash
0 2 * * * pg_dump -Fc skillshub > /var/backups/skillshub-$(date +\%F).dump
```

Back up `/var/lib/fliptech/private-media` alongside it — verification evidence
is not reproducible.

---

## Not wired up yet

- **No push-on-merge.** CI lints, tests and builds, but deploying is a manual
  `./deploy.sh`. Deliberate: automatic deploys want a staging environment to
  prove a release against, and there is not one.
- **Media is on local disk** until R2 credentials are set. Storage switches
  automatically when they appear.
- **SMS and WhatsApp are inert.** `SMS_PROVIDER=console` logs codes instead of
  sending them, pending sender-ID registration and Meta verification.
- **No staging.** Every deploy goes straight to the machine trainees will use.
