# Fliiptech Skills Hub — install notes

Corrections to Sections 05 and 06 of *Product Documentation v1.0*, plus the
traps that cost a day each if you meet them during the build rather than before.

Versions below were resolved against PyPI and npm on **2026-08-17** and every
one was verified to exist and to be mutually compatible. Re-run the check at
kickoff if that date has moved much.

---

## What the PDF got right

Worth saying, because most of this file is corrections. `next@16.3.1`,
`react@19.2.8` and Django 5.2 LTS are all real, current and correctly paired.
Django 6.1 is the current release, but 5.2 LTS is supported to April 2028 and is
the right choice for a project that Section 05 already flags may change hands.

---

## Version corrections

| PDF says | Use | Why |
|---|---|---|
| `next` 16.2.x "long-term support line" | `next@16.3.1` | Next.js publishes no LTS line. There is no 16.2 support channel to sit on. Pin an exact version and upgrade deliberately |
| `node` 22.x LTS minimum | **Node 24** | Node 22 entered maintenance in Oct 2025; 24 is Active LTS |
| PostgreSQL 16 | **PostgreSQL 17 or 18** | 16 works, but this is greenfield. Match the PostGIS package to the Postgres major |
| `django-imagekit` + `next/image` | `next/image` only | Two image pipelines, two caches, two sets of derived files. Django stores the original and strips EXIF; Next resizes and serves WebP |
| `black` and `ruff` | `ruff` only | `ruff format` supersedes black; both installed means two formatters fighting over the same files |
| `django-otp` for SMS codes | write ~60 lines | django-otp does TOTP/HOTP/static/email. It does **not** send SMS. The Arkesel/Hubtel call is yours either way |
| *(not listed)* | `@hookform/resolvers@5.9.1` | Zod is on v4; react-hook-form needs the resolver package and it is absent from Section 06 entirely |
| *(not listed)* | `sharp@0.35.3` | Required by `next/image` when self-hosting on Hetzner |
| *(not listed)* | `next-intl@4.13.7` | Section 10 requires strings externalised for Twi and Ga. No i18n library appears in Section 06 |
| *(not listed)* | `django-import-export` | Section 03 names "no way to export a list" as the NGO give-up condition; Section 11's budget-cut plan is to sell the database to an NGO. Export is in neither the capability table nor the stack |

### ESLint: pin 9.x, not 10

Found by installing rather than by reading. `eslint@10.8.1` is current, but
`eslint-config-next@16.3.1` pulls three plugins that all cap at `^9`:

```
eslint-plugin-import@2.32.0    wants ^2 || ... || ^9
eslint-plugin-jsx-a11y@6.10.2  wants ^3 || ... || ^9
eslint-plugin-react@7.37.5     wants ^3 || ... || ^9.7
```

`eslint@9.39.5` is pinned instead, and `pnpm peers check` then reports no
issues at all. Same failure mode as TypeScript below: taking `latest` across
this stack produces a toolchain that installs but does not work.

### TypeScript: pin 6.0.x, not 7

`typescript@7.0.2` is current `latest`. Do not take it yet.
`eslint-config-next@16.3.1` depends on `typescript-eslint@8.x`, which declares:

```
peerDependencies: { typescript: ">=4.8.4 <6.1.0" }
```

TypeScript 7 is outside that range, so Next's own lint config will not support
it. `typescript@6.0.3` is pinned in `frontend/package.json`. Revisit once
typescript-eslint ships a v7-compatible major.

---

## Install-day traps

**`react-leaflet` must be v5.** v4 hard-fails on React 19 peer resolution.
Verified: `react-leaflet@5.0.0` peers `react: ^19.0.0`. Nearly every tutorial
and code snippet in circulation is v4 — including ones an assistant will hand
you. It is pinned exactly for this reason.

**Marker clustering: use `supercluster`, not `leaflet.markercluster`.** The PDF
specifies `leaflet.markercluster`. It is plain JS, last released in 2023, and
has no maintained React 19 wrapper — the community wrappers lag behind
react-leaflet v5. `supercluster` is the clustering engine underneath most of
them, works with any React version because it is pure computation, and you
render the clusters yourself as ordinary markers. Roughly 40 lines more code,
and no dependency you cannot upgrade.

**Leaflet is client-only.** Import the map through
`dynamic(() => import("./Map"), { ssr: false })` or the App Router build dies on
`window is not defined`. Budget an hour for the broken default marker icon
paths under the bundler too — it is everyone's first Leaflet bug and the fix is
not obvious.

**Tailwind is v4.** CSS-first configuration, `@tailwindcss/postcss` in the
PostCSS chain, and no `tailwind.config.js` by default. Every v3 instruction you
find will send you sideways.

**PostGIS needs system packages before `pip install` will help:**

```bash
sudo apt install postgresql-17-postgis-3 gdal-bin libgdal-dev binutils libproj-dev
```

**Extensions before models.** `backend/core/migrations/0001_extensions.py`
creates `postgis`, `pg_trgm`, `unaccent` and `btree_gin`, and must run before
any migration declaring a geometry field or trigram index. That ordering is
enforced by a `run_before` list in the migration itself — it is not automatic,
and without it Django is free to build the trigram indexes first and fail with
`operator class "gin_trgm_ops" does not exist`. `CREATE EXTENSION` needs
superuser; on your own Hetzner box that is fine.

---

## This machine: two environment facts that cost an hour each

**`D:` is exFAT, which does not support symbolic links.** pnpm's default
`isolated` linker builds `node_modules` from symlinks into a content-addressed
store, so `pnpm install` fails outright here with `ERR_PNPM_EISDIR`. The fix is
`nodeLinker: hoisted`, which writes a flat npm-style tree of real directories.

The trap inside the trap: **pnpm 11 reads this from `pnpm-workspace.yaml`, not
`.npmrc`.** Setting `node-linker=hoisted` in `.npmrc` is silently ignored —
`pnpm config get node-linker` reads back `undefined` and the install fails
again with an identical error. The setting lives in
`frontend/pnpm-workspace.yaml`.

exFAT also has no POSIX permissions and no case sensitivity, both of which
matter to a Linux deployment target. Moving this project to an NTFS volume, or
onto the WSL2 ext4 filesystem, removes the whole class of problem — and once on
ext4 you can drop `nodeLinker: hoisted` for the faster default.

**GeoDjango cannot run on Windows without native libraries.** GDAL, GEOS and
PROJ are C libraries, not pip packages. A clean `pip install` of the whole
backend succeeds and every module imports, and then
`django.contrib.gis` fails at import with `Could not find the GDAL library`.
The chosen fix is WSL2 with Ubuntu 24.04 LTS, which also makes the apt commands
in this file literally correct and matches the Hetzner production target.

---

## Install order

Development happens inside WSL2 (Ubuntu 24.04 LTS), which mirrors the Hetzner
target. System packages first:

```bash
sudo apt install postgresql-17 postgresql-17-postgis-3 gdal-bin libgdal-dev binutils libproj-dev libgeos-dev
```

```bash
cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt -r requirements-dev.txt
```

```bash
cd frontend && pnpm install
```

Then `python manage.py migrate` — and confirm `core.0001_extensions` ran first.

---

## Current state of this machine

Provisioned and verified end to end.

| Component | Where | Version |
|---|---|---|
| Ubuntu | WSL2 distro `Ubuntu-24.04` | 24.04.4 LTS |
| PostgreSQL | WSL, cluster `17/main`, port 5432 | 17.11 (PGDG) |
| PostGIS | database `skillshub` | 3.6.4 |
| GDAL / GEOS / PROJ | WSL system libs | 3.13.2 / 3.14.1 / 9.8.1 |
| Backend venv | `/opt/venvs/skillshub` (ext4, **not** on `/mnt/d`) | Python 3.12.3 |
| Frontend | `D:\fliptech\frontend\node_modules` (Windows) | Node 24.11.1 |

Database: role `skillshub` owns database `skillshub`. Extensions `postgis`,
`pg_trgm`, `unaccent` and `btree_gin` are created by the superuser, so the app
role never needs superuser. `core.0001_extensions` is therefore a no-op against
this database but still correct against a fresh one.

Credentials are generated into `backend/.env`, which is gitignored.
`backend/.env.example` is the committed template.

**The venv is on ext4 on purpose.** `python3 -m venv` builds `bin/python` as a
symlink, which exFAT cannot represent, so a venv created under `/mnt/d` fails.
Project code stays on `/mnt/d`; only the venv moves.

```bash
wsl -d Ubuntu-24.04
source /opt/venvs/skillshub/bin/activate && cd /mnt/d/fliptech/backend
```

### Split environment: backend in Linux, frontend on Windows

The backend runs in WSL because GeoDjango needs native GDAL. The frontend has
no such dependency and its `node_modules` currently holds **Windows** binaries
(`sharp`, `@swc/core`), so run `pnpm dev` from PowerShell, not from WSL. WSL2
forwards `localhost`, so the two halves talk to each other without extra config.

To move the frontend into WSL later, install Node there and reinstall from
scratch — the native binaries cannot be shared across the two platforms.

### Two WSL settings that were changed

`/etc/wsl.conf` now contains:

- `systemd=true` — so `systemctl enable postgresql` works and the database comes
  back automatically after a reboot. Without it, Postgres needs a manual
  `pg_ctlcluster 17 main start` every session.
- `appendWindowsPath=false` — keeps the Windows `PATH` out of Linux, so WSL
  cannot accidentally execute Windows binaries. Side effect: Windows `node` and
  `npm` are no longer callable from inside WSL, which is intended given the
  split above. Remove the line to restore the old behaviour.

### Verified working

PostGIS geodesic distance was checked against known coordinates — Accra to Tema
returns 23.7 km and Accra to Kumasi 200 km, both correct. `pg_trgm` scores
`similarity('welding','welder')` at 0.364, comfortably above a 0.3 threshold,
which is the fuzzy matching the plain full-text search in Section 05 could not
do on its own.

---

## Django project layout

```
backend/
  manage.py
  pyproject.toml          ruff and pytest configuration
  config/
    settings.py           one file, env-driven (see note below)
    urls.py               back-office, healthz, API schema and docs
    wsgi.py  asgi.py
  core/                   extensions migration, TimeStampedModel, health probe
  geography/              Region, Area
  catalog/                Trade, Programme, Intake
  providers/              Provider, ProviderMedia, Verification,
                          GovernmentStatus, ListingConfirmation, Suspension
  enquiries/              Enquiry, EnquiryOutcome, Enrolment
  billing/                Subscription
```

The six local apps map onto the fifteen tables in DATA_MODEL.md, so the models
drop into place without rearranging anything.

**Settings are a single file, not a package.** Production differences are gated
on `DEBUG` rather than split across `base/dev/prod` modules. Section 05 flags
that this codebase may be handed to a local contractor; one file that reads top
to bottom is worth more here than an inheritance chain.

### Routes

| Path | What |
|---|---|
| `/back-office/` | Django admin — the product for build Stages 1 and 2 |
| `/healthz/` | Liveness probe that asserts PostGIS is reachable, not just that Django returns 200 |
| `/api/schema/` | OpenAPI schema from drf-spectacular |
| `/api/docs/` | Swagger UI |

The admin is deliberately not at `/admin/`.

### Wired up in settings

GeoDjango and `django.contrib.postgres`; DRF with drf-spectacular, django-filter
and anonymous throttling; CORS for the Next.js origin; django-axes login
throttling (5 attempts, 1 hour cooloff); simple-history middleware for the audit
trail; Redis cache; phone numbers defaulting to region `GH`; timezone
`Africa/Accra`; and HSTS, secure cookies and SSL redirect gated behind
`not DEBUG`.

Sentry is initialised only when `SENTRY_DSN` is set, with `send_default_pii`
explicitly **off** — trainee phone numbers are personal data under Act 843 and
should not be shipped to a third-party error tracker by default.

`STORAGES` declares a `"private"` alias alongside `"default"`, pointing at the
second R2 bucket with `querystring_auth` and a 300-second signed-URL expiry.
That is the mechanism behind DATA_MODEL.md's fourth structural rule.

### Verified working

```
/healthz/       {"status": "ok", "postgis": "3.6 USE_GEOS=1 USE_PROJ=1 USE_STATS=1"}
/api/schema/    HTTP 200
/api/docs/      HTTP 200
/back-office/   HTTP 302 (login redirect)
redis cache     round-trip ok
ruff check      All checks passed
ruff format     31 files already formatted
pytest          3 passed
makemigrations --check   No changes detected
```

The test suite asserts that `pg_trgm` and `unaccent` are actually installed and
that `similarity('welding','welder')` clears 0.3 — so if someone later drops the
extensions migration, a test fails rather than search quietly degrading.

Running the tests needs one database grant: `ALTER ROLE skillshub CREATEDB`.

Earlier this also said to install the four extensions into `template1`. **Do
not do that.** It was a workaround for a real bug — `core.0001_extensions` was
not ordered before the migrations that create trigram indexes — and because
every new database inherited the extensions from `template1`, the ordering
never mattered locally and the bug stayed invisible for days while CI failed on
every run. The migration now declares `run_before`, so a clean database works,
and `template1` is deliberately left with only what PostGIS puts there. Keeping
the local template as bare as CI's is what makes this class of bug show up
here rather than in a pipeline nobody is reading.

A `No directory at: staticfiles/` warning during tests is expected and harmless
until `collectstatic` has run once.

---

---

## The back office

Build Stage 2. Section 05 says the admin is the deciding factor for choosing
Django at all, so this is the product for the first two stages rather than
scaffolding around it.

### Roles and the approval step

Section 09 requires a second pair of eyes before a listing goes live. That is
only a real control if the two roles hold different permissions, so publishing
is a **custom permission** (`providers.publish_provider`) rather than something
implied by edit rights.

```bash
python manage.py setup_groups
```

| Group | Can | Cannot |
|---|---|---|
| Field officer (40 perms) | Draft and edit providers, photos, evidence, verifications, government status, programmes, intakes, enrolments | Publish, suspend, delete |
| Operations lead (51 perms) | Everything above, plus publish, suspend, manage subscriptions and geography | — |

The command is idempotent, so re-run it after adding models. Both groups need
`is_staff=True` on the user.

### What each screen does

`ProviderAdmin` is the screen a field officer lives in: photo, verification,
government status, evidence and subscription inlines in the order a site visit
follows, with the ones not needed during a visit collapsed. Status is changed by
action, not by hand, so the approval step and the reason for a suspension are
always recorded.

The **Trust** column renders the site visit and the government record as two
separate statements and either may be absent. There is no combined badge, and
no `is_verified` field exists anywhere in the codebase to build one from.

Suspending a provider writes a `Suspension` row with a required reason and flips
the listing status in the same step, so a hidden listing always has a logged
explanation behind it.

`EnrolmentAdmin` is built around the monthly provider conversation. The enquiry
link is optional and usually empty — an enrolment with no enquiry is the normal
case, not a data error. Completion and attestation sit in their own fieldset,
labelled as the two questions to ask.

`EnquiryAdmin` is add-disabled and the trainee's own words are read-only: staff
annotate outcomes, they do not rewrite what was sent.

Both `ProviderAdmin` and `EnrolmentAdmin` carry export actions, closing the NGO
gap from Section 03.

### EXIF stripping

Photographs are re-encoded on upload with metadata discarded, and `exif_stripped`
records that it happened. **Orientation is applied before the metadata is
dropped** — EXIF carries the rotation flag, so stripping it naively leaves half
the photographs on their side. Files Pillow cannot read (a scanned PDF
certificate) pass through untouched and `exif_stripped` stays `False` rather
than claiming a strip that never happened.

### Verified

35 tests pass, including: a field officer's publish attempt leaves the listing
pending; an operations lead's publishes it; a draft cannot skip the approval
step; an uploaded photograph carrying a camera make and a rotate-90 flag comes
back with empty EXIF and its pixels transposed from 20x10 to 10x20; suspension
records the reason and hides the listing; and every back-office page loads.

### Known gap: background photo upload

Section 09 calls working on a phone over a mobile connection "a specific
requirement, not a general aspiration", with photographs uploading in the
background. **Stock Django admin does not do this.** Uploads are part of the
form POST, so a dropped connection loses the whole form, photographs included —
which is exactly the failure mode a field visit in poor signal produces.

This needs custom work before the pilot, and it is not a settings change. The
realistic options are a small JavaScript uploader posting photographs to a
separate endpoint before the form is submitted, or accepting a two-step flow
where the provider is saved first and photographs are added afterwards. The
second is free and should be the fallback if the budget is tight.

---

---

## The API

Build Stage 3, consumed by the Next.js frontend. Everything is anonymous and
read-only except the enquiry endpoints and the tokenised dashboard.

| Endpoint | Serves |
|---|---|
| `GET /api/providers/` | Search. `lat`/`lng`/`radius_km`, `bbox`, `trade`, `area`, `region`, `max_fee`, `verified_only`, `q` |
| `GET /api/providers/{area}/{slug}/` | The profile screen at its public address |
| `GET /api/trades/`, `/areas/`, `/regions/` | Filter row, area picker, region index |
| `GET /api/pages/summary/?trade=&area=` | Fee range and counts for a generated page |
| `POST /api/enquiries/request-code/` | Send a one-time code |
| `POST /api/enquiries/verify-code/` | Verify it |
| `POST /api/enquiries/` | Send the enquiry, get a reference and a wa.me link |
| `GET /api/dashboard/{token}/` | Screen 5, opened from a WhatsApp link |
| `GET /api/schema/`, `/api/docs/` | OpenAPI schema and Swagger UI |

### Search behaviour worth knowing

`max_fee` matches providers with **any** active programme at or below the
ceiling, not providers whose every course is cheap — someone on a budget wants
to see the workshop if one course fits.

`verified_only` means an unexpired Fliiptech site visit. It does **not** mean
CTVET registration, and the two are never combined into one filter. A test
asserts that a CTVET-registered provider who was never visited is excluded, so
the trust separation holds in search as well as on screen.

`q` uses trigram similarity, so "welder" finds *Accra Welding Works*.

The card carries `lowest_fee`, `shortest_duration_weeks` and `next_intake` from
queryset annotations rather than per-row queries.

### The enquiry flow

Three limits stack on the code endpoint: 5 per IP per minute, 5 per number per
day, 20 per IP per day. Codes are stored **hashed** with a 10-minute expiry and
are burned after 5 wrong guesses, with the attempt counted before the check so a
crash mid-verify cannot buy a free guess.

A number that verified within the last hour skips a fresh SMS entirely. Screen 4
encourages enquiring with three providers, and that must not cost three
messages — a test pins it.

The confirmation returns a `wa.me` click-to-chat link, which is free. Only the
provider-alert side needs the paid Cloud API, and that is currently logged
rather than sent, because no credentials exist yet.

SMS delivery is a pluggable backend (`SMS_PROVIDER`). `console` logs the code
and is the development and CI default. The Arkesel and Hubtel backends raise
`NotImplementedError` rather than silently no-opping, so a misconfigured
production deploy fails at the first enquiry instead of swallowing every code.

### Provider dashboard: an assumption, not a confirmed decision

Screen 5 is reached by a signed, expiring token in a WhatsApp link — no
password, no username, no account creation. This implements the recommendation
in the decisions table, **not** a founder decision. Section 02 says owners will
not maintain their own profiles and Section 03 names being asked to log in as
what makes them give up, so this is the only design consistent with both. If the
decision goes the other way, replace `provider_from_token` in
`providers/dashboard.py` and the views keep working.

The dashboard reports what it can honestly measure and `null` for the rest:

- `response_rate` is defined as enquiries **marked replied within 48 hours**,
  and the basis is returned alongside the number. The conversation is on
  WhatsApp by design, so a broader definition would be unsupportable.
- `profile_views` returns `null`, because no analytics source is in the stack.
  Returning `0` would say "nobody looked", which is a different and false claim
  to put in front of a paying provider.

### Verified

59 tests pass; `spectacular` generates 15 operations with zero warnings and zero
errors; a live server returns 200 on every public route with no server errors.

Three bugs the tests caught, all fixed:

- **Money serialised as float.** Endpoints building a dict from an aggregate
  bypass DRF's `COERCE_DECIMAL_TO_STRING`, so subscription prices and public fee
  ranges came out as `120.0`. `core/money.py` renders them as fixed two-place
  strings.
- **Pagination over an unordered queryset.** `for_card()` annotates aggregates,
  which introduces a `GROUP BY`, and Django treats a grouped queryset as
  unordered even with `Meta.ordering` — silently repeating and dropping rows
  between pages. Ordering is now explicit.
- **`SMS_PROVIDER=arkesel` in the generated `.env`**, which made every enquiry
  raise. The template now defaults to `console`.

---

## The frontend

The remainder of Stage 3. Six screens, built against the API and verified with
seeded demo data (`python manage.py seed_demo`).

| Route | Screen |
|---|---|
| `/` | 1. Search results, the default view |
| `/map` | 2. Map, reached only from the toggle |
| `/<area>/<provider>` | 3. Provider profile |
| `/enquiry?programme=` | 4. Enquiry form, then the confirmation |
| `/dashboard/<token>` | 5. Workshop dashboard |
| `/<place>/<trade>-training` | 6. Generated page for search engines |
| `/trades/<trade>` | Trade explainer |

### The search page ships no JavaScript for its core function

Filters are anchors and a plain GET form, not a client component. The page
works before hydration, with JavaScript disabled, and on a dropped connection.
A React filter widget would cost a bundle to do the same job more slowly on
exactly the device this product targets.

Leaflet and the enquiry form are the only client islands, and neither is on the
search path. Verified: no `leaflet`, `supercluster`, `react-hook-form` or `zod`
appears in any bundle the search page loads.

### Mobile-first, not mobile-only

The trainee arrives on a phone, so that layout is what the design is optimised
for and nothing about it changed. But two audiences arrive on a desktop and were
not served by the original hard 640px cap: the NGO programme officer building a
shortlist (Section 03), and search traffic landing on a generated area page —
which Section 04 explicitly shows as a **desktop view that stacks to a single
column on a phone**.

| Screen | Phone | Desktop |
|---|---|---|
| Search | One column, no map | Results left, **map in a sticky right panel** |
| Provider profile | One column, trust first in source order | Courses left, the two trust blocks in a sticky right aside |
| Map (`/map`) | Map only | Ranked list beside a full-width map |
| Generated page | One column | Three-column card grid, prose capped at `max-w-prose` |
| Dashboard | Two stats up | Four stats across |
| Enquiry | Full width | Form capped at `max-w-xl` |

The profile aside is sticky because the question it answers — should I trust
this workshop — applies to every course on the page, not only the one at the
top. On a phone the source order still puts trust first, before any fee.

### The map beside the search results

On desktop the search page shows results on the left and a sticky map on the
right. Two things make that compatible with Section 04's warning that the map
"must never become the default view":

**The list stays primary.** It keeps the wider column, the ordering, and the
fee/duration/intake comparison. The map is a second read of the same result
set, not a replacement for it. On a phone — the device the product is designed
for — nothing changed: no map, and the `/map` route is still a separate screen
reached from the toggle.

**The phone does not pay for it.** Leaflet, react-leaflet and supercluster are
roughly 60 KB gzipped and the budget had about 11 KB of headroom, so a
`hidden lg:block` wrapper would have shipped all of it to every phone and simply
hidden the result. Instead `SearchMapPanel` reads the viewport with
`useSyncExternalStore` and returns `null` below 1024px, so `dynamic()` never
fetches the chunk. Reading it through `useSyncExternalStore` rather than an
effect also avoids the setState-in-effect cascade the React 19 rules flag.

Measured on a 375px viewport: map not rendered, **no Leaflet CSS requested,
zero tile requests**, one-column list. Cold initial payload **193.1 KB**, still
inside the 200 KB budget — the panel's own gating logic costs about 3.5 KB.

Measured at 1600px: list 977px in three columns on the left, map 544px wide and
870px tall on the right, tiles and clusters rendering, no horizontal overflow.

Column counts step down when the map is beside the list, since the cards have
less room: one at `lg`, two at `xl`, three at `2xl`. Without the map — the
`/map` route and the generated pages — the grid still goes up to four.

The container grows in steps — 1152px, then 1280px at `xl`, then 1600px at
`2xl` — rather than stopping at one width. A single cap looked deliberate on a
laptop and looked abandoned on a 2560px monitor, with the content stranded in
the middle. It still stops growing: a card grid spanning an entire ultrawide is
harder to scan, not easier.

**Two card fixes matter more than the container width**, and both only show up
once the cards sit in a grid:

- The card is a full-height flex column with the facts row pinned to the bottom
  by `mt-auto`. Badge text varies in length — "CTVET: Claimed, not verified by
  Fliiptech" wraps to two lines where "CTVET: Registered" does not — so without
  this the fee, duration and intake rows drift out of alignment across a row.
  That defeats the entire reason those three are on the card.
- The provider name wraps to two lines (`line-clamp-2`) instead of truncating.
  It is the primary identifier, and "Accra Central Auto mechan…" is not
  something a trainee can compare or repeat over the phone.

Measured at 2560px: 1600px container, 4 columns, 376px cards, **every one of
five rows has its facts aligned**, zero truncated names, no horizontal
overflow. At 1280px: 3 columns, profile splits 720px + 352px with the aside
sticky. At 375px: single column, correct source order, every tap target at
least 44px apart from the `sr-only` skip link, which is 1px until focused by
design.

Generated-page titles are title-cased from the slug rather than left as
`welding training in greater accra`. CSS `capitalize` fixed the visible heading
but not the `<title>` or meta description — which is what a search result
actually shows, and these pages exist to be found.

Responsive layout cost **0.6 KB** of the page-weight budget, because Tailwind
only ships the utilities actually used.

### Page weight: passes, with little room left

Measured over the wire, gzipped, images excluded:

```
HTML   6.8 KB
CSS    4.3 KB
JS   177.9 KB
     -------
     189.0 KB   against the 200 KB budget in Section 10
```

**This is worth a decision rather than a tick.** The application code is about
11 KB of that. The other 178 KB is the React 19 and Next.js 16 framework floor,
which no amount of care in this codebase reduces. The budget passes today and
would fail the moment a client component lands on the search path.

Two consequences follow. First, the no-client-JS rule for the search page is
not a stylistic preference and should be treated as a constraint. Second, if
Section 10's budget is a firm requirement rather than a target, that is an
argument to re-examine the Next.js decision itself — the framework consumes
about ninety per cent of the allowance before a line of product code. Section 05
justifies Next.js on server rendering for the generated pages, which is sound;
this is the cost side of that trade and it should be stated to whoever signs off.

### The URL collision, and how it is resolved

Section 04 specifies `/tema/welding-training` and
`/tema/tema-community-1-welding-works`. Both are `/<place>/<slug>` and Next
cannot tell them apart. The convention adopted: **a generated trade page always
ends in `-training`**, and the leading segment may be a region or an area;
anything else is looked up as a provider.

This is why `Region` and `Area` slugs share a namespace and why `Area.clean()`
rejects a slug that collides with a region — that constraint in DATA_MODEL.md
exists to keep this routing rule unambiguous.

### Thin pages are excluded, not published

The generated page calls the summary endpoint and emits `noindex` when the
inventory is below three providers. The sitemap applies the same gate before
listing a URL at all.

With the seeded data that means **six region pages are listed** (four providers
each) and **thirty area-level pages are excluded** (one provider each). Six
trades across sixteen regions is ninety-six URLs; publishing the empty ones
teaches a crawler the site is mostly empty, which is worse than not generating
them.

### Verified

Production build succeeds; `tsc --noEmit` and `eslint` both clean; every route
returns 200 against a live backend; the rendered profile shows the verification
block, the "not a government accreditation" line and the separate government
block with "Not claimed"; JSON-LD is emitted on provider pages; `robots.txt`
disallows `/dashboard/` and the dashboard sets `noindex`.

Four things caught during the build, all fixed:

- **`ssr: false` is not allowed in a Server Component** under the App Router.
  The map now loads through a thin client wrapper, so the page stays a Server
  Component and still fetches providers server-side.
- **The list API returned no coordinates**, so the map had nothing to plot.
  `lat`/`lng` were added to the provider list serializer.
- **Two React 19 compiler-rule violations**: `setState` called synchronously
  inside an effect in the map (a cascading render on every mount, visible as a
  stutter on a mid-range phone), and react-hook-form's `watch()` used in an
  effect. Both rewritten.
- **`eslint-config-next` 16 ships native flat config**; bridging it with
  `FlatCompat` fails with a circular-structure error. `eslint.config.mjs`
  imports it directly.

### Why not shadcn/ui

Worth recording, because it is a reasonable default and skipping it was a
choice rather than an oversight.

shadcn/ui is Radix primitives plus Tailwind, copied into the repo. Its value is
highest where an interface has real interactive surface: dialogs, comboboxes,
date pickers, command palettes, toasts, multi-step forms. Three things make this
particular product a poor fit.

**Every Radix component is a client component.** The search page currently
ships zero JavaScript for its core function, and the page-weight budget has
about 11 KB of headroom above the framework floor. Rebuilding the filter row on
shadcn's `Select` and `Checkbox` would convert the one screen that must work on
a 3G connection into a hydrated client widget, and would spend headroom the
budget does not have.

**There is very little interactive surface to gain from.** Across six screens
the interactive elements are: a filter form, one enquiry form, and a map. The
rest is cards, badges, definition lists and headings — markup where a component
library adds indirection rather than removing work.

**The place shadcn would genuinely earn its keep is the back office**, which is
where the complex forms, inline editing and approval flows live. That is Django
admin, not React, and Section 05 chose Django precisely so that screen did not
have to be built.

Where it would be reasonable to reconsider: the dashboard (Screen 5) and the
enquiry flow are already client-side or off the critical path, so adopting
shadcn there would cost nothing the budget is protecting. If the interface grows
a provider self-service area — the thing Section 02 currently assumes away —
that is the point to revisit this properly rather than component by component.

### Known gaps

- **Tile provider still unchosen.** The map points at OpenStreetMap's public
  tile server, whose usage policy rules this out. Only the URL and attribution
  in `MapView.tsx` change when a provider is picked.
- **No provider photographs in the demo data**, so cards render a placeholder
  block. The image pipeline (`next/image`, WebP, lazy) is wired and will work
  once the field team uploads through the back office.
- **No component tests.** Vitest and Playwright are installed but unused; the
  verification above is a live smoke test, not a suite.

---

## Not done yet

- **No Linux user account.** Ubuntu was installed with `--no-launch`, so only
  root exists and everything above ran as root. Run `wsl -d Ubuntu-24.04` once
  to create your account and set its password — that step needs a human.
  Afterwards, `sudo chown -R $USER /opt/venvs/skillshub`.
- **No admin superuser.** Creating one sets a password, so run it yourself:
  `python manage.py createsuperuser`, then `python manage.py setup_groups`.
- **Provider alerts are not sent.** The WhatsApp template and SMS fallback are
  logged, pending Meta business verification and a registered sender ID.
- **Background photo upload**, as above.
- **Map tile provider unchosen**, as above.
- **Stages 4 to 6** of the build order: scheduled freshness prompts, staleness
  flags, caching and monitoring.
- **Redis is enabled** and the cache works, but Celery stays deferred to
  Stage 6 per the note in `requirements.txt`.

---

## Corrections to the service and cost table (Section 06)

**WhatsApp pricing is out of date.** The PDF says "free tier, then per
conversation". Meta moved template messaging to **per-message** pricing. Every
provider alert, every 90-day freshness prompt and the "review your listing" link
in Section 09 is a business-initiated template: it needs pre-approval, needs
opt-in, and is billed per send. Only replies inside the 24-hour customer service
window are free. This changes the Section 09 operating cost materially and
should be re-modelled before the pilot budget is fixed.

**OpenStreetMap tiles are not free for this use.** The OSMF public tile server's
usage policy rules out commercial and heavy use. Pick MapTiler, Carto, Stadia or
Protomaps on a free tier from day one. The Leaflet code is identical either way,
so this costs nothing to decide early and risks a block if decided late.

**Celery is premature until Stage 6.** On a 10–20 EUR Hetzner box already
running Postgres, PostGIS, Django and Gunicorn, adding a Celery worker, a beat
process and Redis is real memory pressure — and the only thing that needs them
is the Section 09 freshness cycle, which is Stage 6 in the build order. Use cron
plus management commands through Stage 5. Celery is commented in
`requirements.txt` rather than removed, so the decision stays visible.

**Vercel plus Hetzner means every server-rendered request crosses providers.**
The under-3-seconds-on-3G budget in Section 10 is measured against that choice.
Co-locating Next.js on the Hetzner box is the simpler answer; if Vercel wins for
other reasons, measure the area pages before committing.

**Hetzner is in Finland.** Personal data of Ghanaian citizens held abroad is a
cross-border transfer under the Data Protection Act, 2012 (Act 843). The DPC
registration that Section 10 already commits to should name it explicitly.

---

## Security items to build in, not bolt on

- **Rate-limit the OTP send endpoint specifically**, with a hard daily cap per
  phone number and per IP. `django-axes` covers staff login only. SMS pumping
  fraud is a direct cash loss.
- **Verify a phone number once per session, not once per enquiry.** Screen 4
  encourages enquiring with three providers; done naively that is three SMS you
  pay for and three points of friction on the free side of the marketplace.
- **Strip EXIF on upload.** Phone photos carry GPS. Section 10 commits to
  minimal collection, and an un-stripped workshop photo can expose an owner's
  home address.
- **Two R2 buckets.** Public for workshop photographs, private with signed URLs
  for verification evidence and owner identification. Section 10 requires
  evidence to be "never publicly served" and a default `django-storages` ACL
  will not honour that on its own.
- **Decide API authentication.** `django-cors-headers` is CORS, not auth, and
  Section 06 lists nothing else. Session cookies vs. server-side tokens is also
  what decides whether Next.js can sit on a different origin from Django.

---

## SEO corrections (Section 04)

Search is the entire acquisition strategy, and three things it needs are missing
from the stack and the plan.

**Do not generate 96 pages for one region.** "6 trades by 16 regions" with
providers in Greater Accra only produces ~90 pages with no inventory — exactly
the thin templates Section 04 warns against, and a genuine ranking risk rather
than a neutral one. Generate a page only where listings meet a threshold (3 is a
reasonable start) and `noindex` the rest until they fill.

**Add sitemap, robots and structured data.** Next's `sitemap.ts` and `robots.ts`
plus JSON-LD (`Course`, `LocalBusiness`) on provider and area pages. None appear
in Section 06.

**Add analytics.** Screen 5 shows profile views and the SEO strategy needs
measurement, but nothing in the stack counts a view. Plausible or Umami, plus
Search Console.

---

## Decisions that block the install

Five of these are already in Section 12 as founder decisions. They are repeated
here because they now block work rather than merely inform it.

| Decision | Blocks |
|---|---|
| **Brand name and domain** (pending ORC search) | Repo name, R2 buckets, TLS certificate, WhatsApp display name, SMS sender ID. Everything below depends on it |
| **Start Meta Business verification** | WhatsApp Cloud API. Weeks of lead time, needs registered-business documents. Longest pole in the project and not code |
| **Register the SMS sender ID** (Arkesel or Hubtel) | Enquiry OTP. Also days-to-weeks, also needs business documents |
| **Provider login mechanism** | The `Provider` model and Screen 5. Recommended: tokenised magic link over WhatsApp, no password |
| **Next.js hosting: Vercel or the Hetzner box** | API auth strategy and the Section 10 performance budget |
| **Tile provider** | Nothing structural — same Leaflet code — but decide before launch, not after a block |
| **Define or cut "response rate"** | Screen 5. As specified it is unmeasurable, because the conversation is on WhatsApp by design |
| **Whether the demand interviews happen first** | Section 12 already calls this the assumption everything rests on |
