# Fliiptech Skills Hub

A directory of hands-on skills training in Ghana — welding, tailoring,
hairdressing, auto mechanics and other trades — launching in Greater Accra.
Trainees compare workshops by fee, course length and next intake, see what
Fliiptech actually checked on a site visit, and send an enquiry. Workshop
owners list themselves from a phone. Staff review, verify and keep listings
current from a back office.

## Who uses it

| Who | Where | What they do |
|---|---|---|
| Trainees | `/`, `/map`, `/trades/…`, `/<area>/<workshop>` | Search, compare, save workshops, send enquiries. Sign in with a phone code; no password. |
| Workshop owners | `/trainer/join`, `/trainer/dashboard` | Sign up with a phone code, list the workshop, photos, ID and first course, then keep it up to date. |
| Staff | `/back-office/` | Confirm trainers, approve listings, record site visits, follow up enquiries, send owner messages and sign-in codes. |

Nothing a trainer submits is public until staff approve it.

## How it is built

| Part | Technology |
|---|---|
| Backend | Django 5.2 LTS, Django REST Framework, GeoDjango on PostgreSQL with PostGIS |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS 4, next-intl, Leaflet |
| Server | One VPS: Caddy in front, gunicorn and `next start` under systemd, PostgreSQL and Redis on the same box |

```
backend/          Django project
  config/         settings (one file, env-driven) and URLs
  core/           back office, SMS and email delivery, images, demo data
  geography/      regions and areas
  catalog/        trades, courses (programmes) and intakes
  providers/      workshops, trainer accounts, photos, verification, freshness
  enquiries/      phone codes, enquiries, outcomes, enrolments
  trainees/       trainee accounts, saved workshops, staff support access
  billing/        subscriptions
  templates/      back-office templates
frontend/         Next.js site
  src/app/        pages
  src/components/ UI, maps, trainer and trainee areas
  messages/       interface text (en.json), ready for translation
deploy/           server bootstrap, systemd units, Caddyfile
```

## Running it locally

The backend needs GDAL, GEOS and PROJ, which are system libraries rather than
pip packages, and ffmpeg for teaching videos, so it runs on Linux (WSL2
Ubuntu 24.04 on Windows). The frontend runs fine on Windows. [SETUP.md](SETUP.md) has the full install notes and the
traps worth knowing before you start.

**Backend** (from `backend/`, inside WSL):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
cp .env.example .env          # then set DATABASE_URL (note: postgis://)
python manage.py check_database
python manage.py migrate
python manage.py setup_groups
python manage.py seed_demo    # optional: illustrative workshops
python manage.py createsuperuser
python manage.py runserver 0.0.0.0:8000
```

Settings come from `backend/.env`. To use a different file for one command,
set `ENV_FILE`, for example `ENV_FILE=.env.local python manage.py migrate`.
Under pytest, `backend/.env.local` is used whenever it exists, whatever
`ENV_FILE` says. Keep it pointing at a local database: a test run creates and
drops a database of its own.

**Frontend** (from `frontend/`):

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Then open http://127.0.0.1:3000 for the site and
http://127.0.0.1:8000/back-office/ for the back office. Use `127.0.0.1`, not
`localhost`: the site and API share a hostname so the CSRF cookie works.

### Sign-in codes without an SMS gateway

There is no SMS gateway yet, so `SMS_PROVIDER` decides where codes go:

- `console` writes them to the server log. The default.
- `backoffice` puts each one on the back office's **Codes to send** page, for
  staff to pass on by WhatsApp or text. Operations lead and superusers only.
- `arkesel` / `hubtel` are for when a sender ID is registered.

## Tests and checks

The same checks CI runs:

```bash
# backend/
ruff check . && ruff format --check .
python manage.py makemigrations --check --dry-run
pytest -q

# frontend/
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

CI also runs the browser tests in `frontend/e2e` against a production build
and a real API with the demo data. That includes `e2e/budget.spec.ts`, which
fails the build if the search page goes over 208 KB or takes longer than three
seconds to first paint on 3G. (208, raised once from 200 on 2026-10-29 when the
marketplace's share of the one Tailwind stylesheet pushed it over; the test
file records why.) To run them locally, start the API and
`pnpm build && pnpm start`, then `pnpm test:e2e` (or `pnpm test:budget` for
the budgets alone). The back-office tests need `ADMIN_E2E_USERNAME` and
`ADMIN_E2E_PASSWORD` for a local staff account, and `BACK_OFFICE_URL`.
Chrome already on the machine works: set `PLAYWRIGHT_BROWSER_CHANNEL=chrome`.

## Management commands

| Command | What it does |
|---|---|
| `check_database` | Checks a database can host the project: PostGIS, extensions, privileges |
| `setup_groups` | Creates or updates the Field officer and Operations lead roles. `deploy.sh` runs it on every release |
| `seed_demo` / `purge_demo` | Adds or removes illustrative workshops. `purge_demo` is a dry run unless `--yes` |
| `queue_freshness_prompts` | Queues the 90-day "are your fees and dates still right?" messages. Runs nightly on the server |
| `process_videos` | Prepares uploaded teaching videos for phones with ffmpeg. Runs all the time on the server; `--once` works through the queue and stops |
| `check_email` | Sends a test message through the configured email transport |
| `prune_media` | Deletes public media files nothing refers to. Dry run unless `--yes` |
| `fetch_trade_photos`, `attach_stock_photos` | Freely licensed Wikimedia Commons photos for demo listings |

## API

The site talks to Django under `/api/`. The schema is at `/api/schema/` and
browsable docs at `/api/docs/`.

## Deploying

[DEPLOY.md](DEPLOY.md) covers the server: first-time setup, configuration,
email, routine operations and what is not wired up yet. A release is
`./deploy.sh`, which runs every step that can fail before restarting anything.

## More documentation

- [SETUP.md](SETUP.md) — install notes, version choices and why, and the state
  of each part of the build
- [DEPLOY.md](DEPLOY.md) — running it on the server
- [DATA_MODEL.md](DATA_MODEL.md) — the tables and the reasoning behind them
