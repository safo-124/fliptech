# Deploying, and connecting your VPS PostgreSQL

Single VPS, four containers: Django, Next.js, Redis and Caddy. **The database
is not one of them** — it stays where it already is, on your VPS.

---

## Answering the database question first

### 1. Your PostgreSQL almost certainly needs PostGIS added

This is the part that catches people. The project does not need "a PostgreSQL
database", it needs **PostgreSQL with PostGIS**. Provider search is a geographic
query — "which workshops are within ten kilometres of this point" — and
`Provider.location` is a geometry column that a plain PostgreSQL cannot store.

On the VPS, as a user with sudo:

```bash
psql -V
```

Then install the matching PostGIS package — the version number must match your
PostgreSQL major version:

```bash
sudo apt install postgresql-17-postgis-3
```

### 2. Create the database and role

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE skillshub LOGIN PASSWORD 'use-a-long-random-one';
CREATE DATABASE skillshub OWNER skillshub;
\c skillshub
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS btree_gin;
GRANT ALL ON SCHEMA public TO skillshub;
```

Creating the extensions as `postgres` here means the application role never
needs superuser. `core/migrations/0001_extensions.py` then finds them already
present and does nothing.

### 3. Let the container reach it

Docker containers do not share the host's `localhost`. Two situations:

**Database on the same VPS as Docker.** Point at the docker bridge address,
usually `172.17.0.1`, and allow it in PostgreSQL:

```conf
# /etc/postgresql/17/main/postgresql.conf
listen_addresses = 'localhost,172.17.0.1'
```

```conf
# /etc/postgresql/17/main/pg_hba.conf
host    skillshub    skillshub    172.17.0.0/16    scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

Do **not** open 5432 in the firewall for this case. The bridge is internal.

**Database on a different host.** Use the private network address, require TLS,
and firewall 5432 to the app server only:

```bash
sudo ufw allow from <APP_SERVER_IP> to any port 5432 proto tcp
```

Then append `?sslmode=require` to the URL. Without it the password and every
trainee phone number cross the network in clear text — and those phone numbers
are personal data under the Data Protection Act, 2012.

### 4. Write the URL

In `.env.production`:

```
DATABASE_URL=postgis://skillshub:your-password@172.17.0.1:5432/skillshub
```

**The scheme is `postgis://`, not `postgres://`.** django-environ picks the
database backend from the scheme, and `postgres://` selects the plain backend,
which cannot handle `PointField`. This is the single most likely thing to get
wrong.

### 5. Check before migrating

```bash
docker compose run --rm django python manage.py check_database
```

It reports the server version, whether TLS is on for a remote host, which of the
four extensions are present, and whether the role can create the missing ones —
then tells you exactly what to fix. Run it before `migrate`, so a problem
surfaces before a half-built schema exists.

---

## First deploy

Prerequisites: a VPS with Docker and the compose plugin, a domain pointed at its
IP, and ports 80 and 443 open.

```bash
git clone <your-repo> /opt/fliptech && cd /opt/fliptech
cp .env.production.example .env.production
chmod 600 .env.production
```

Fill in `.env.production`. Generate the secret key with:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(64))"
```

Then:

```bash
./deploy.sh
```

The script builds the images, checks the database, migrates, creates the two
back-office roles, and starts the stack. Migrations run **before** the new
containers take traffic, so a failed migration leaves the previous release
serving rather than putting a new one in front of a half-migrated database.

Finally, create your account — this sets a password, so it is yours to do:

```bash
docker compose exec django python manage.py createsuperuser
```

Then sign in at `https://your-domain/back-office/`.

---

## What the stack does

| Container | Role |
|---|---|
| `caddy` | TLS and routing. Obtains and renews certificates automatically |
| `next` | The public site |
| `django` | API, back office, media |
| `redis` | Cache |

**Everything is served from one origin.** Caddy sends `/api`, `/back-office`,
`/healthz`, `/static` and `/media` to Django and everything else to Next.js. So
the browser never makes a cross-origin request: no CORS preflight on the enquiry
POST, and back-office session cookies stay first-party.

**Server-side rendering never leaves the machine.** Next.js talks to Django over
the container network via `API_URL_INTERNAL`, while the browser uses the public
HTTPS origin. Using one value for both is the classic container-deploy bug: SSR
requests would leave the box, cross TLS and come back for no reason.

**`NEXT_PUBLIC_*` values are baked in at build time**, not read at run time. To
change the domain or brand name you rebuild the frontend image — `deploy.sh`
does this every run, so it is only worth knowing when debugging a stale value.

---

## Routine operations

```bash
./deploy.sh                                    # deploy a new release
docker compose logs -f django                  # follow logs
docker compose exec django python manage.py shell
docker compose restart next                    # restart one service
```

Nightly database backup, held off the server — Section 10 asks for this, and
notes that an untested backup is not a backup:

```bash
0 2 * * * pg_dump -Fc skillshub > /var/backups/skillshub-$(date +\%F).dump
```

Restore-test it once, on a scratch database, before you rely on it.

---

## Not wired up yet

- **No push-on-merge.** CI lints, tests and proves both images build, but
  deployment is a manual `./deploy.sh`. That is deliberate: automatic deploys
  need a staging environment to prove a release against, and there is not one
  yet.
- **No image registry.** Images are built on the VPS. Fine for one server;
  revisit if a second appears.
- **Media is on a Docker volume** until Cloudflare R2 credentials are set. Back
  it up with the database, or move to R2 first.
- **SMS and WhatsApp are inert.** `SMS_PROVIDER=console` logs codes instead of
  sending them, pending sender-ID registration and Meta verification.
