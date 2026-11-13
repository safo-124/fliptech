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
DJANGO_ALLOWED_HOSTS=your-domain.com,127.0.0.1
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

## Turning on email

Until this is done, sign-in codes are written to the journal and nobody
receives one. The back office says so on its own front page.

The settings are already there and env-driven, so this is `.env` and a
restart — no deploy.

**Gmail, for pilot volume and without a domain.** Roughly 500 recipients a day.

1. Google Account → Security → turn on **2-Step Verification**. App passwords
   do not exist without it.
2. Same page → **App passwords** → create one. Google shows it once.
3. Add to `/opt/fliptech/backend/.env`:

   ```
   EMAIL_PROVIDER=smtp
   EMAIL_HOST=smtp.gmail.com
   EMAIL_PORT=587
   EMAIL_USE_TLS=True
   EMAIL_HOST_USER=you@gmail.com
   EMAIL_HOST_PASSWORD=the-16-character-app-password
   DEFAULT_FROM_EMAIL=Fliiptech Skills Hub <you@gmail.com>
   ```

   `DEFAULT_FROM_EMAIL` has to be the same account. Gmail rejects a From
   address it does not own, and the failure looks like a refused message
   rather than an authentication error, which is confusing enough to be worth
   knowing in advance.

4. Restart and check:

   ```bash
   sudo systemctl restart fliptech-api
   cd /opt/fliptech/backend && sudo -u fliptech .venv/bin/python manage.py check_email you@example.com
   ```

   `check_email` reports the host, the user and whether a password is set —
   never the password itself — then sends one message and says what the server
   answered. A first message often lands in spam before the sender is trusted.

**A transactional provider** (Brevo, Resend, Postmark, SES) is the production
answer and the same four settings, with their host and credentials. Every one
of them wants DNS records proving a domain you own, so buying the domain is
the prerequisite, not the signup.

---

## Map tiles

Until this is done the maps load their tiles from OpenStreetMap's own servers.
That is a free community service with no guarantee, and its usage policy asks
busy sites to use a tile provider instead.

1. Pick a provider and create an account. MapTiler, Stadia Maps and
   Thunderforest all serve the raster tiles the site uses; free tiers and
   terms differ, so check them for a commercial site at your traffic. Choose a
   light, quiet style: the soft-grey treatment the site gives OpenStreetMap's
   tiles is switched off for a provider's own style.
2. In the provider's dashboard, restrict the key to your domain. It is visible
   in the page, as every tile key is; the restriction is what protects it.
3. Add both lines to `/opt/fliptech/frontend/.env.production`, copying the
   exact URL template and attribution the provider gives you. For example:

   ```
   NEXT_PUBLIC_MAP_TILE_URL=https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=YOUR_KEY
   NEXT_PUBLIC_MAP_TILE_ATTRIBUTION=&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors
   ```

4. `./deploy.sh`. These are fixed at build time, so editing the file alone
   changes nothing.

## Error monitoring

Sentry is wired into the API and starts as soon as it has a key. It is sent
no personal data: no cookies, users or IP addresses, and no request bodies,
which carry phone numbers.

1. Create a Sentry project for Django and copy its DSN.
2. Add to `/opt/fliptech/backend/.env`:

   ```
   SENTRY_DSN=https://…
   SENTRY_ENVIRONMENT=production
   ```

   Use `staging` on a staging server, so its errors are not read as ones
   trainees saw.
3. `sudo systemctl restart fliptech-api`. No rebuild needed.

The Next.js side is not in Sentry; its errors are in
`journalctl -u fliptech-web`. Adding Sentry's browser SDK would cost the search
page roughly a sixth of its 200 KB budget.

---

## Switching on Twi or Ga

Translations are added as they are done; see `frontend/messages/README.md`
for the site's text and `backend/locale/README.md` for the API's messages.
Whatever a language has not translated yet is shown in English, so it can be
switched on before it is finished — on staging first, so translators can
check their work in place.

1. `/opt/fliptech/frontend/.env.production`: `NEXT_PUBLIC_LOCALES=en,tw`
2. `/opt/fliptech/backend/.env`: `INTERFACE_LANGUAGES=tw`
3. Once there are server translations: `sudo apt install gettext`
4. `./deploy.sh` — the site's languages are fixed at build time, and the
   deploy compiles any server translations.

The footer then offers the language, each named in itself. The choice is a
cookie, not a change of address, so no indexed URL moves.

---

## How it fits together

| Piece | Where |
|---|---|
| Caddy | ports 80/443, TLS, routing |
| Django (gunicorn) | `127.0.0.1:8000`, 2 workers × 4 threads |
| Next.js | `127.0.0.1:3000` |
| Video worker (`process_videos`) | no port; reads the queue in the database |
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

That loopback hop is why `127.0.0.1` belongs in `DJANGO_ALLOWED_HOSTS` above.
An SSR request arrives with `Host: 127.0.0.1:8000`, and without it Django
answers 400 DisallowedHost — every page renders its "could not load" state
while the site looks perfectly healthy from outside. Node's `fetch` cannot
send a different `Host` (undici ignores the header), so this cannot be fixed
in the frontend. The frontend does send `X-Forwarded-Proto: https`, without
which `SECURE_SSL_REDIRECT` answers the same hop with a 301 to a port nothing
is listening on.

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
| `/var/lib/fliptech/private-media/videos/review` | **private** encoded videos waiting for review |
| `/var/lib/fliptech/private-media/video-work` | uploads as they arrive, deleted once encoded |
| `/var/lib/fliptech/media/videos/public` | **public** approved videos, served by Caddy |

Private evidence is deliberately outside the directory Caddy is pointed at.
Section 10 requires it is never publicly served, and widening that `root` or
moving these directories together would leak identity documents. Once Cloudflare
R2 credentials are set the app switches to two buckets automatically and stops
writing here.

The services run as `fliptech`, a system account with no login shell, under
systemd hardening (`ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`).
A compromised web process cannot read your home directory or use your SSH keys.

## Teaching videos

Trainers upload videos from their phones and the server prepares them with
ffmpeg. No video service is involved: the files are stored and played from
this machine.

**What happens to an upload.** The phone sends the file in 2 MB pieces to
`/api/trainer/profile/videos/<id>/upload/`. Caddy buffers each piece before
passing it on (`request_buffers` in the Caddyfile), so a slow phone does not
hold a gunicorn thread. The pieces collect in `private-media/video-work/`.
When the last one arrives, `fliptech-video` encodes the file to a 360p copy
(about 3.5 MB a minute), a 720p copy if the original is sharp enough, and a
poster still, strips the location the phone recorded, and deletes the
original. The video then waits in **Videos to review** in the back office.
Approving it moves its files to `media/videos/public/`, where Caddy serves
them. Taking it down moves them back. Approved lessons appear on the
workshop's listing and in **Online learning** (`/learn`), one course per
workshop, in the order they were sent.

**Servers set up before videos existed** need ffmpeg and the worker, once:

```bash
sudo apt-get install -y ffmpeg
sudo install -m 644 /opt/fliptech/deploy/fliptech-video.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fliptech-video
sudo cp /opt/fliptech/deploy/Caddyfile /etc/caddy/Caddyfile   # then put your domain back in
sudo systemctl reload caddy
```

**Watching it work:** `journalctl -u fliptech-video -f`. A video that cannot
be prepared shows the trainer why; the log has ffmpeg's own error.

**Limits** are settings in `backend/.env`, placeholders until pricing is
decided. Change them and `sudo systemctl restart fliptech-api fliptech-video`.

| Setting | Default | |
|---|---|---|
| `VIDEO_MAX_MINUTES` | 60 | Longest single lesson |
| `VIDEO_MAX_HOURS_PER_PROVIDER` | 24 | Total video on one listing |
| `VIDEO_MAX_PER_PROVIDER` | 40 | Lessons on one listing |
| `VIDEO_MAX_UPLOAD_BYTES` | 4 GB | Largest single upload |
| `VIDEO_MIN_FREE_BYTES` | 10 GB | Uploads stop when the disk has less free than this |
| `VIDEO_FFMPEG_THREADS` | 1 | Raise on a server that only encodes |

**Disk.** A 24-hour course is about 5 GB at 360p and 19 GB with the 720p copy,
plus space for uploads while they wait to be encoded. Put
`/var/lib/fliptech` on a Hetzner Volume before videos grow, so they can never
fill the disk PostgreSQL is on. Hetzner's server backups do not include
Volumes, so back the videos up separately.

**When encoding falls behind.** One lesson at a time, on at most one CPU, is
slow for long courses. Run `process_videos` on a second server pointed at the
same database and storage; each worker takes a different video. An encoding
whose worker died is started again after six hours, and an upload nobody has
added to for two days is removed.

## Home page pictures

The home page has four places for a photograph: the large one beside the
search, and one on each of the Find training, Online learning and
Marketplace cards. Staff choose them in the back office under **Core → Home
page pictures** (operations leads and superusers). Each needs a short
description of what it shows, for screen readers, and a credit when the
photograph is not your own. A Creative Commons photograph must be credited,
and the credit is shown on the picture.

An empty place is fine. It falls back to something real from the site: a
workshop's photograph (captioned with the workshop), a course's still or a
product's photo, and then to the plain card. The page refreshes within five
minutes of a change.

## Paid courses (Paystack)

Trainers can charge for their course: one price for all their lessons, with
the first lesson always free. Trainees pay by mobile money or card through
**Paystack**, Stripe's company for Ghana (Stripe itself does not accept
Ghanaian businesses). Each payment is split by Paystack straight to the
trainer's own payout account; Fliiptech takes nothing
(`PAYSTACK_PLATFORM_PERCENTAGE=0`) and Paystack's fee comes out of the
trainer's share (`PAYSTACK_FEE_BEARER=subaccount`).

**Switching it on**

1. Open a Paystack account at paystack.com and complete its business
   verification.
2. In Paystack's dashboard, **Settings → API Keys & Webhooks**, copy the
   **test** secret key into `backend/.env`:
   ```
   PAYSTACK_SECRET_KEY=sk_test_...
   ```
3. On the same page, set the **webhook URL** to
   `https://your-domain/api/payments/paystack/webhook/`. This is what
   unlocks a course when a trainee pays and closes the page before coming
   back.
4. Add the `/media/videos/public/*` block from `deploy/Caddyfile` to your
   Caddyfile, above the `/media/*` one, then reload Caddy. Without it a
   paid lesson's file is still only ever given to people who paid, but its
   link would work for anyone they shared it with.
5. Restart: `sudo systemctl restart fliptech-api`.

Test with Paystack's test MoMo numbers and cards. Going live is replacing the
test key with the live one (`sk_live_...`); nothing else changes.

**What a trainer does:** Videos tab → *Sell your course* → where to be paid
(mobile money network or bank, and the number), then the price. A price can
only be set once the payout account is saved.

**Where to look:** every purchase is in the back office under *Courses →
Course purchases*, read-only: only Paystack's confirmation marks one paid.
Refunds are made in the Paystack dashboard.

## Marketplace money: boosts, the Shop plan and Buy now

The same Paystack key switches on three ways the marketplace earns, and the
same webhook URL confirms all of them. With no key set, none is offered and
free shops have no product limit.

| What | Who pays | Price (setting) | Where the money goes |
| --- | --- | --- | --- |
| Boost a product | Seller | GH₵15 a week (`MARKETPLACE_BOOST_WEEK_PRICE`), GH₵40 a month (`MARKETPLACE_BOOST_MONTH_PRICE`) | Fliiptech |
| Shop plan | Seller | GH₵30 a month (`MARKETPLACE_PLAN_PRICE`) | Fliiptech |
| Buy now | Buyer | The product's price | The seller's payout account, less Fliiptech's 5% (`MARKETPLACE_COMMISSION_PERCENT`) |

- A **boost** puts a product first in the marketplace, marked "Sponsored",
  unless the buyer chose a sort.
- The **Shop plan** lifts the free limit of 5 products on show
  (`MARKETPLACE_FREE_PRODUCT_LIMIT`), shows a banner on the shop page, gives
  one free week's boost a month, and puts the shop above free ones. It does
  not renew by itself: the seller is texted 3 days before it ends.
- **Buy now** appears once a seller saves a payout account (dashboard →
  *Orders*). Paystack splits each payment as it is made; Fliiptech never
  holds the seller's money. Staff are asked to tell the seller on WhatsApp
  (*Messages to sellers*), the buyer gets a text receipt, and the seller
  marks the order handed over. **Refunds:** refund in the Paystack
  dashboard, then use *Record as refunded* on the order in the back office.

**Reviews.** A few days after somebody asks about or buys a product, they
are texted a link to review the seller. Only those links can leave a review,
one each. Staff can hide a review under *Marketplace → Seller reviews*.

The texts are sent by `manage.py marketplace_daily`, which
`fliptech-freshness.service` now runs every morning after the freshness
prompts. `go-live.sh` reinstalls the unit, so nothing extra is needed.

**Where to look:** the back-office home page has a *Marketplace earnings*
card for the last 30 days, linking to orders, seller payments and reviews.

**More ways sellers pay, and more for buyers**

| What | Price (setting) |
| --- | --- |
| Seeing who sent a quote request | GH₵5 (`MARKETPLACE_LEAD_PRICE`), free on the Shop plan; at most 5 makers per request (`MARKETPLACE_LEAD_LIMIT`) |
| "Verified maker" visit | GH₵80 (`MARKETPLACE_VERIFICATION_PRICE`) |

- **Sellers are texted at once** when someone asks or pays, by the SMS
  provider in `SMS_PROVIDER`. The WhatsApp messages in *Messages to sellers*
  stay as a reminder.
- **Verified maker:** paid visits waiting to happen are linked from the
  earnings card. After visiting, select the seller under *Seller accounts*
  and use *Mark as verified maker*. It needs the "Can mark a seller as a
  verified maker" permission (superusers have it).
- **Reports:** buyers can report a product. Open reports are linked from the
  earnings card; *Take the reported products down* suspends them.
- **Quote requests:** a buyer describes a bulk or custom job; sellers in
  that trade are texted and find it under *Quote requests* in their
  dashboard.
- **Funnel:** *Funnel by trade* on the earnings card shows views, questions
  and sales per trade for 30 days.

**Buyer protection (off until you switch it on)**

With `MARKETPLACE_HOLD_PAYMENTS=true`, Buy now payments go into Fliiptech's
Paystack balance instead of straight to the seller. The seller's share (the
total less the commission) is transferred to them when the buyer taps "I've
got it", or `MARKETPLACE_RELEASE_DAYS` (3) days after the seller marks it
handed over with no problem reported. A reported problem freezes the money:
on the order in the back office, use *Release held payment to the seller* or
*Refund the buyer through Paystack*.

Before switching it on:

1. In the Paystack dashboard, make sure **Transfers** are enabled for the
   account and **turn off OTP for transfers** (Settings → Preferences);
   with OTP on, every release waits for a code and shows as failed here.
2. Keep enough balance for transfers: Fliiptech pays Paystack's collection
   and transfer fees out of its commission while payments are held.
3. Sellers who saved a payout account before this release must save it
   again (dashboard → *Orders* → *Change*), so a transfer recipient is made
   for them. Until they do, Buy now is hidden for them while holding is on.
4. The webhook URL is the same; it also receives `transfer.*` events.

---

## Marketplace: deposits, alerts and seller tools

Nothing to switch on for most of these; they arrive with the release.

- **Deposits for made-to-order work.** A seller chooses a deposit (30–70%)
  under *Your shop*. Their made-to-order products then get Buy now: the
  buyer pays the deposit, the seller taps *It's ready* on the order, the
  buyer is texted and pays the balance, and only then can it be handed over.
  Commission is split between the two payments. Balances are confirmed by
  the same webhook (references starting `fb-`).
- **Texts to buyers:** "it's back" for sold-out products they asked about,
  "handed over, did you get it?", "your balance is due", and one text a day
  at most about new products from shops they follow (sent by
  `marketplace_daily`).
- **Away mode:** a seller sets a date; Buy now is off until then.
- **Copy a product, listing tips, and monthly earnings** with a CSV download
  are in the seller dashboard.
- **Featured shops** (Shop plan shops) appear on the home page.
- **Terms of sale** are at `/marketplace/terms`, linked from the footer and
  every product. They are a plain-language draft: **have a lawyer read them**
  before relying on them, and edit the wording in
  `frontend/messages/en.json` under `MarketTerms`.
- **Instant page updates.** Product and shop pages are cached for five
  minutes. To have them update the moment a seller changes something (a
  price, back in stock, away mode), pick any long random string and set it
  in both env files, then deploy:
  ```
  # /home/safo/deploy-staging/backend.env
  FRONTEND_REVALIDATE_URL=http://127.0.0.1:3000/revalidate
  FRONTEND_REVALIDATE_SECRET=<the string>
  # /home/safo/deploy-staging/frontend.env.production
  REVALIDATE_SECRET=<the same string>
  ```
  You can make one with `openssl rand -hex 24`. Without it, pages simply
  update within five minutes, as before.
- **Holding a new seller's first payments:** set
  `MARKETPLACE_HOLD_FIRST_ORDERS=5` (in `backend.env`) to hold each seller's
  first five Buy now payments for buyer protection, then pay them straight.
  It needs Paystack Transfers, set up as for buyer protection above.

## Online learning: progress, certificates, the course studio

Arrives with the release; the migrations run during deploy. What changes:

- **For learners:** a new player (speed, 10-second skips, captions,
  picture choice, carry on where you stopped, "up next"), progress and
  ticks, *My courses* at `/learn/mine`, a certificate at
  `/certificates/<code>` once every lesson is finished (with a QR code
  anyone can scan to check it), reviews, questions under each lesson, and
  *Save to watch offline*, which keeps a lesson inside the site on the
  phone (`/learn/saved`), never as a loose file that could be passed on.
- **For trainers:** the course studio at `/trainer/course` (also linked
  from the Videos tab): numbers, lesson order and sections, descriptions,
  captions, the course page words, a launch price, promo codes, featuring,
  and learners' questions and reviews. A question texts the trainer; the
  answer texts the learner (through the SMS provider in `SMS_PROVIDER`).
- **Streaming copies (HLS).** After this deploy the video worker cuts a
  streaming copy of every approved lesson, the existing ones included, from
  the files already made. It is quick (no re-encoding) but uses about as
  much disk again as the lessons' MP4s. Watch it with
  `journalctl -u fliptech-video -f` (lines like `Video 12: stream ready`).
  The copies sit under `/media/videos/public/hls/`, which the existing
  Caddy rule already checks with Django, so paid lessons stay locked. To
  turn streaming off, set `VIDEO_HLS=False` in `backend.env`; players fall
  back to the MP4s.
- **Featuring a course** costs GH₵20 a week or GH₵60 a month by default
  (`COURSE_BOOST_WEEK_PRICE`, `COURSE_BOOST_MONTH_PRICE` in `backend.env`).
  Paid to Fliiptech through Paystack (references start `fk-`, confirmed by
  the same webhook). Staff can also feature a course for free: back office,
  *Courses*, set *Featured until*.
- **Back office:** reviews and lesson questions can be hidden, certificates
  revoked (the check page then says so), and captions deleted. Captions and
  lesson descriptions are not reviewed before they show; staff remove any
  that break the rules.
- **Instant updates** for course pages use the same `REVALIDATE_SECRET`
  setting as the marketplace above.

## One account per person

Everyone now signs in at `/account` with their phone and gets a customer
account. Learning, teaching and selling are added to that same login from the
account page (or through their old sign-up pages, which now also reuse it),
so one phone is one person everywhere.

Phone numbers that collected separate logins before this (say, a trainee who
later registered a workshop) are joined up once, after the release is live:

```bash
cd /opt/fliptech/backend && sudo -u fliptech .venv/bin/python manage.py merge_phone_accounts
```

That is a dry run: it lists what it would move. **Back up the database
first**, then run it again with `--yes`. It moves every account for a number
onto one login, points anything else that named the old login at the kept
one, and switches the old login off rather than deleting it. Logins with
staff rights or a password are never touched. It is safe to run again.

People already signed in on the old, switched-off logins are signed out and
simply sign in again.

## Messages instead of WhatsApp

Buyers, sellers, trainees and trainers talk in the site's own chat, on the
website and in the app (`backend/marketplace/chat.py`). Nothing to configure:
`./deploy.sh` runs the migration and `setup_groups`.

- **An enquiry opens a chat.** The trainee's question lands in the workshop's
  inbox (`/inbox` on the site, **Me → Business messages** in the app), and
  the workshop is told at once: an app notification, or a text with the link.
  A question about a product does the same for the shop. The person's
  number is hidden; either side can tap **Share my number**, which shares
  only their own.
- **Replies are timed by themselves.** An answer in the chat marks the
  enquiry replied (the trainer's list and the response rate use it), and a
  shop's question gets its `replied_at`.
- **Staff follow up after a day.** The back office messages pages (Providers
  → messages, Sellers → messages) now show an enquiry only when it is 24
  hours old with no reply. The WhatsApp text staff send no longer carries
  the person's number; it tells the owner to sign in and reply.
- **Workshops staff added themselves.** A workshop with no trainer account
  linked cannot reply in the chat, so its enquiries go to the staff queue
  straight away, as before. To let the owner answer: Back office → Providers
  → open the listing → **Trainer memberships** → add the owner's trainer
  account (they sign up at `/trainer/join` with their phone first).
- **Paid orders.** Sellers see **Message buyer** beside the phone number; a
  buyer who checked out without an account has no chat, and the seller is
  told to call. Buyers see **Message the seller** on the order page.
- **Reported chats.** Back office → Marketplace → Chat reports. Only the
  operations lead group (and superusers) can read the messages in a
  reported chat; other staff see the report alone.
- **Older app builds** keep working: their enquiry screen just shows "Done",
  and the old shop chat addresses still answer. Send the new screens to
  phones with `mobile/scripts/publish-update.sh` (no new build needed).

## The Android app: notifications, links, updates

All of it runs on this server. There is no Firebase and no Expo cloud.

**Notifications.** Every alert that used to be an SMS (orders, chat messages,
back in stock, price drops, training alerts, quotes) is now also kept as a
notice (`appsupport.Notice`). The app collects its notices when it opens and
about every 15 minutes in the background, and shows them as phone
notifications. The SMS is skipped for a number whose app checked in within
the last two days. Money messages (a new paid order, a receipt, a balance
paid) are always texted as well, and sign-in codes are only ever texted.
Nothing to set up. In the back office, **Mobile app → Notices** shows what
was sent and whether it also went by SMS.

The app does not ask for notification permission at sign-in. It asks once,
in its own words, right after the person's first message or enquiry (or the
next time they open it), then shows the phone's prompt. While notifications
are off, Messages, Business messages, My orders and Me show a "Notifications
are off" banner with a way to turn them on. On Android, once they are on, a
one-time card explains how to set the app's battery use to Unrestricted, as
some phones stop background apps. Test these on a real phone: the web
preview skips them.

**Crash reports.** The app reports errors it could not recover from to
`/api/app/crash/`. Read them in the back office under **Mobile app → Crash
reports**.

**Updates without the Play Store.** JavaScript and picture changes reach
phones the next time the app opens, served by Django from
`/var/lib/fliptech/app-updates`:

```bash
sudo mkdir -p /var/lib/fliptech/app-updates
sudo chown fliptech:fliptech /var/lib/fliptech/app-updates
```

In `/opt/fliptech/backend/.env`:

```
APP_UPDATES_ROOT=/var/lib/fliptech/app-updates
```

Publish from your computer, in `mobile/`:

```bash
EXPO_PUBLIC_API_URL=https://your-domain.com ./scripts/publish-update.sh safo@YOUR_SERVER
```

Native changes (a new Expo package, permissions, plugins in
`app.config.ts`) still need a new build: raise `version` in `mobile/app.json`
first, so the update never reaches a build that cannot run it. To roll back,
rename the newest folder under `app-updates/<version>/`.

**Links open the app.** Links to your domain open the app instead of the
browser (Android App Links). Android checks
`https://your-domain.com/.well-known/assetlinks.json`, which lists the
certificate the app was signed with. Get that certificate's SHA-256
fingerprint (from `eas credentials`, or from
`keytool -list -v -keystore your-release.keystore` if you build yourself),
then add it to `/opt/fliptech/frontend/.env.production`:

```
ANDROID_CERT_SHA256=AB:CD:EF:...
```

Restart the website (`sudo systemctl restart fliptech-web`). Once the app is
on the Play Store, add Google's app signing fingerprint too, separated by a
comma. You'll find it under Play Console → Setup → App signing.

The app builds its link and update addresses from `EXPO_PUBLIC_SITE_URL` and
`EXPO_PUBLIC_API_URL`, which are set in `mobile/eas.json`.


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

Nightly freshness prompts. `fliptech-freshness.timer` runs
`queue_freshness_prompts` at 05:00, which puts every listing due its 90-day
check into the back office's "Messages to send" page. Staff send each one from
there on WhatsApp. `bootstrap.sh` installs and enables it; on a server
bootstrapped before it existed, install it once:

```bash
sudo install -m 644 deploy/fliptech-freshness.service deploy/fliptech-freshness.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fliptech-freshness.timer
sudo systemctl start fliptech-freshness      # run it now, once
sudo journalctl -u fliptech-freshness        # what it queued
systemctl list-timers fliptech-freshness     # when it runs next
```

The message carries the owner's dashboard link only when `PUBLIC_SITE_URL` is
set in `backend/.env`.

---

## Not wired up yet

- **No push-on-merge.** CI lints, tests and builds, but deploying is a manual
  `./deploy.sh`. Deliberate: automatic deploys want a staging environment to
  prove a release against, and there is not one.
- **Media is on local disk** until R2 credentials are set. Storage switches
  automatically when they appear.
- **Texts through Arkesel.** In `backend/.env` set `SMS_PROVIDER=arkesel`,
  `SMS_API_KEY=` (Arkesel > API > Main SMS API Info > Generate new key) and
  `SMS_SENDER_ID=` a sender ID Arkesel has approved (SMS > Sender ID, at most
  11 characters). Restart the API, then text yourself:
  `cd /opt/fliptech/backend && sudo -u fliptech .venv/bin/python manage.py check_sms 0241234567`.
  It says plainly if the key is wrong, the sender ID is not approved or the
  balance is empty. A text Arkesel refuses never breaks a sign-up: it is
  logged, and the code shows as "Not sent: pass it on" on the back office's
  Recent sign-in codes page. Keep the SMS balance topped up in Arkesel.
- **Or texts through Twilio.** Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID=`
  and `TWILIO_AUTH_TOKEN=` (both on the Twilio console's front page) and
  `TWILIO_FROM=`, then check with `check_sms` as above. Before relying on it,
  know three things from Twilio's Ghana guidelines. It costs about US$0.37 a
  text to Ghana, far more than a local gateway. MTN blocks sender IDs that are
  not registered, and registering one through Twilio takes about three weeks.
  A text from a phone number rather than a name fails on MTN, AirtelTigo and
  Glo. A **trial** account can only send from its Twilio number (`+1...`), only
  to numbers verified in the console (up to five), with "Sent from a Twilio
  trial account" in front, and Ghana has to be ticked under Messaging >
  Settings > Geo permissions. So on a trial, an MTN phone should not expect the
  text; a verified Telecel phone may get it. Twilio accepting a text is not the
  text arriving: the console's message log says what each network did with it.
- **WhatsApp is inert** until Meta verification. Before Arkesel is set up,
  `SMS_PROVIDER=console` logs codes instead of sending them. To show
  the product to people before then, set `SMS_PROVIDER=backoffice` in
  `backend/.env` and restart the API: every sign-in code then appears on the
  back office's **Codes to send** page (operations lead and superusers only),
  where staff send it on by WhatsApp or text and mark it sent. A code there
  works for 10 minutes and is wiped from the database after that.
  Once a real gateway sends texts, every code is still copied to the same page
  (now called **Recent sign-in codes**) with whether the text went out, so
  staff can read a code to somebody whose text never arrived. Set
  `OTP_COPY_TO_BACK_OFFICE=false` to stop keeping the copy.
- **No staging.** Every deploy goes straight to the machine trainees will use.
