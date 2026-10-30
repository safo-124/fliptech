"""Django settings for Fliiptech Skills Hub.

One settings module, driven by environment variables through django-environ.
Production differences are gated on DEBUG rather than split across a settings
package, because Section 05 of the product documentation flags that this
codebase may be handed to a contractor: one file that can be read top to bottom
is worth more here than a clever inheritance chain.
"""

import os
import sys
from pathlib import Path

import environ
from corsheaders.defaults import default_headers
from django.conf.locale import LANG_INFO

from core.media import derive_public_origin

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DJANGO_DEBUG=(bool, False),
    DJANGO_ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:3000"]),
    REDIS_URL=(str, "redis://localhost:6379/0"),
    SENTRY_DSN=(str, ""),
    R2_ENDPOINT_URL=(str, ""),
    CSRF_TRUSTED_ORIGINS=(list, []),
    TRUSTED_PROXY_CIDRS=(
        list,
        [
            "127.0.0.0/8",
            "::1/128",
            "10.0.0.0/8",
            "172.16.0.0/12",
            "192.168.0.0/16",
        ],
    ),
)
# Which env file to load.
#
# Day-to-day development reads .env, which points at the server's database
# through the SSH tunnel (see tunnel.sh). Override it for a single command:
#
#     ENV_FILE=.env.local python manage.py dbshell
#
# Under pytest this is forced to .env.local, ignoring any override. A test run
# creates a database, migrates it and drops it again; against the server that
# would be slow, would litter a shared instance, and is destructive if the drop
# ever resolved to the wrong name. The server role has createdb=False, so it
# fails outright anyway — loudly, but only after wasting a round trip.
#
# This check lives here rather than in conftest.py because pytest-django calls
# django.setup() from pytest_load_initial_conftests, which runs BEFORE conftest
# files are imported. Anything set there is already too late.
_UNDER_PYTEST = "pytest" in sys.modules

if _UNDER_PYTEST and (BASE_DIR / ".env.local").exists():
    ENV_FILE = ".env.local"
else:
    ENV_FILE = os.environ.get("ENV_FILE", ".env")

# CI has no env file at all and supplies real environment variables instead;
# read_env simply does nothing when the file is absent.
environ.Env.read_env(BASE_DIR / ENV_FILE)

# The brand name appears in the back office, in every SMS and in the WhatsApp
# handover text. It is a setting rather than a literal because the ORC name
# search was still pending when this was built: correcting the spelling is one
# environment variable, not a search across the codebase.
BRAND_NAME = env("BRAND_NAME", default="Fliptech")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DJANGO_DEBUG")
ALLOWED_HOSTS = env("DJANGO_ALLOWED_HOSTS")


# --------------------------------------------------------------------------
# Applications
# --------------------------------------------------------------------------

DJANGO_APPS = [
    # Not "django.contrib.admin": this AppConfig substitutes the oversight
    # dashboard for the default admin index. See core/admin_site.py.
    "core.admin_apps.SkillsHubAdminConfig",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.gis",
    "django.contrib.postgres",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "django_filters",
    "drf_spectacular",
    "corsheaders",
    "simple_history",
    "axes",
    "import_export",
    "phonenumber_field",
]

# Apps map onto the tables in DATA_MODEL.md:
#   core       extensions migration, shared base models and utilities
#   geography  Region, Area
#   catalog    Trade, Programme, Intake
#   providers  Provider, ProviderMedia, Verification, GovernmentStatus,
#              ListingConfirmation, Suspension
#   enquiries  Enquiry, EnquiryOutcome, Enrolment
#   billing    Subscription
#   trainees   TraineeAccount, SavedProvider, SupportSession
LOCAL_APPS = [
    "core",
    "geography",
    "catalog",
    "providers",
    "enquiries",
    "billing",
    "trainees",
    "marketplace",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS


# --------------------------------------------------------------------------
# Middleware
# --------------------------------------------------------------------------

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    # The visitor's language on the API only. See Internationalisation below.
    "core.middleware.ApiLanguageMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Records the author of every change. Structural rule 2 in DATA_MODEL.md.
    "simple_history.middleware.HistoryRequestMiddleware",
    # AxesMiddleware must come last.
    "axes.middleware.AxesMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                # The back-office sidebar's work queues. Costs nothing outside
                # an admin view — see the module for the guards.
                "core.context_processors.back_office",
            ],
        },
    },
]


# --------------------------------------------------------------------------
# Database
# --------------------------------------------------------------------------
# DATABASE_URL uses the postgis:// scheme, which django-environ maps to
# django.contrib.gis.db.backends.postgis. PointField needs that backend.

DATABASES = {"default": env.db("DATABASE_URL")}
DATABASES["default"]["CONN_MAX_AGE"] = 60
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --------------------------------------------------------------------------
# Cache
# --------------------------------------------------------------------------

# Tests use an in-process cache rather than Redis. DRF throttling and
# django-ratelimit both read the cache on ordinary API requests, so with Redis
# configured a test run needs a live Redis — which meant CI failed with
# "Connection refused" on 23 tests, and a developer without Redis running could
# not run the suite at all. Nothing under test depends on Redis specifically.
if _UNDER_PYTEST:
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
            "LOCATION": "skillshub-tests",
        }
    }
else:
    CACHES = {
        "default": {
            "BACKEND": "django_redis.cache.RedisCache",
            "LOCATION": env("REDIS_URL"),
            "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
        }
    }


# --------------------------------------------------------------------------
# Authentication
# --------------------------------------------------------------------------
# AxesStandaloneBackend must be first. It throttles staff login only — the
# trainee OTP endpoint needs its own django-ratelimit decorator and a hard
# daily cap per phone number and per IP. See SETUP.md.

AUTHENTICATION_BACKENDS = [
    "axes.backends.AxesStandaloneBackend",
    "django.contrib.auth.backends.ModelBackend",
]

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

AXES_FAILURE_LIMIT = 5
AXES_COOLOFF_TIME = 1  # hours
AXES_LOCKOUT_PARAMETERS = ["ip_address", "username"]
AXES_RESET_ON_SUCCESS = True

# Trainer access uses Django's server-side session after phone verification.
# The session credential must never be readable from JavaScript; the separate
# CSRF cookie remains readable so the frontend can echo it in X-CSRFToken.
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_HTTPONLY = False
CSRF_COOKIE_SAMESITE = "Lax"


# --------------------------------------------------------------------------
# Internationalisation
# --------------------------------------------------------------------------
# English at version 1, strings externalised so Twi and Ga become possible
# later without a rewrite (Section 10).
#
# The public site's language is a cookie its footer sets (frontend
# src/i18n/config.ts), and the API answers in the same one, so a trainee
# reading Twi is not shown an error in English. Only under /api/: the back
# office stays in English whatever cookie a member of staff's browser carries.
# See core.middleware.ApiLanguageMiddleware.
#
# INTERFACE_LANGUAGES is the server's half of the site's NEXT_PUBLIC_LOCALES,
# and the two should name the same languages. A language switched on before
# its catalogue under locale/ is compiled simply stays English, message by
# message: `makemessages -l tw -l gaa` to start one, `compilemessages` to use
# it. Both need GNU gettext installed.

LANGUAGE_CODE = "en-gb"
TIME_ZONE = "Africa/Accra"
USE_I18N = True
USE_TZ = True

# Neither language ships with Django, so it is told their names.
LANG_INFO.setdefault("tw", {"bidi": False, "code": "tw", "name": "Twi", "name_local": "Twi"})
LANG_INFO.setdefault("gaa", {"bidi": False, "code": "gaa", "name": "Ga", "name_local": "Ga"})

_LANGUAGE_NAMES = {"en-gb": "English", "tw": "Twi", "gaa": "Ga"}
_interface = {"en-gb"} | {
    code.strip() for code in env.list("INTERFACE_LANGUAGES", default=[]) if code.strip()
}
LANGUAGES = [(code, name) for code, name in _LANGUAGE_NAMES.items() if code in _interface]
LOCALE_PATHS = [BASE_DIR / "locale"]
# next-intl's cookie, so the site and the API agree without a second one.
LANGUAGE_COOKIE_NAME = "NEXT_LOCALE"

PHONENUMBER_DEFAULT_REGION = "GH"
PHONENUMBER_DEFAULT_FORMAT = "E164"


# --------------------------------------------------------------------------
# Static and media
# --------------------------------------------------------------------------
# Two buckets by design: workshop photographs are public CDN content, while
# verification evidence and owner identification are private and served only
# through short-lived signed URLs. See DATA_MODEL.md, ProviderMedia.

STATIC_URL = "static/"
STATIC_ROOT = env("DJANGO_STATIC_ROOT", default=str(BASE_DIR / "staticfiles"))
MEDIA_URL = "media/"

# Public media: workshop photographs. The web server is pointed at this
# directory, so anything in it is world-readable by design.
MEDIA_ROOT = env("DJANGO_MEDIA_ROOT", default=str(BASE_DIR / "media"))

# Private media: verification evidence and owner identification. Section 10
# requires these are "never publicly served", so this MUST stay outside
# MEDIA_ROOT — the web server is never pointed at it, and Django only hands
# these files out through a view that checks permissions.
PRIVATE_MEDIA_ROOT = env("DJANGO_PRIVATE_MEDIA_ROOT", default=str(BASE_DIR / "private-media"))

# Cloudflare R2 is the eventual home for both, but the sender-ID and bucket
# setup runs on its own timetable. Rather than block the first deploy on it,
# storage falls back to the local filesystem and switches over the moment
# credentials appear. Without this, a production deploy with blank R2 settings
# raises ImproperlyConfigured at startup.
_R2_CONFIGURED = bool(env("R2_ACCESS_KEY_ID", default=""))

if _R2_CONFIGURED:
    _r2 = {
        "endpoint_url": env("R2_ENDPOINT_URL"),
        "access_key": env("R2_ACCESS_KEY_ID"),
        "secret_key": env("R2_SECRET_ACCESS_KEY"),
        "region_name": "auto",
        "signature_version": "s3v4",
    }
    _media_storages = {
        "default": {
            "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
            "OPTIONS": {**_r2, "bucket_name": env("R2_BUCKET_PUBLIC"), "querystring_auth": False},
        },
        "private": {
            "BACKEND": "storages.backends.s3boto3.S3Boto3Storage",
            "OPTIONS": {
                **_r2,
                "bucket_name": env("R2_BUCKET_PRIVATE"),
                "querystring_auth": True,
                "querystring_expire": 300,
                "default_acl": "private",
            },
        },
    }
else:
    _media_storages = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "private": {
            "BACKEND": "django.core.files.storage.FileSystemStorage",
            "OPTIONS": {"location": PRIVATE_MEDIA_ROOT, "base_url": None},
        },
    }

STORAGES = {
    **_media_storages,
    # Plain storage in development and under test. The manifest variant refuses
    # to serve any file missing from staticfiles.json, which breaks every admin
    # page until collectstatic has run.
    "staticfiles": {
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        )
    },
}


# --------------------------------------------------------------------------
# API
# --------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_FILTER_BACKENDS": ["django_filters.rest_framework.DjangoFilterBackend"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {"anon": "120/min"},
}

SPECTACULAR_SETTINGS = {
    "TITLE": f"{BRAND_NAME} Skills Hub API",
    "DESCRIPTION": "Provider search, enquiries and provider dashboard.",
    "VERSION": "1.0.0",
    "SERVE_INCLUDE_SCHEMA": False,
    # registration_status and accreditation_status draw on the same choice set,
    # which spectacular cannot name on its own.
    "ENUM_NAME_OVERRIDES": {
        "GovernmentRecordStatusEnum": "providers.models.GOVERNMENT_RECORD_STATUS_CHOICES",
        # A video's player, not a photo's kind: both fields are named "kind".
        "VideoKindEnum": [("upload", "upload"), ("youtube", "youtube")],
    },
}

CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True
# Upload-Offset says where a piece of a video upload starts. Only matters when
# the site and the API are on different origins, as in development.
CORS_ALLOW_HEADERS = (*default_headers, "upload-offset")

# Origins allowed to send cookie-carrying POSTs. In development the Next.js dev
# server is a different origin from Django (another port), so a signed-in
# trainee or trainer would otherwise get "Origin checking failed" on every
# write. In production everything is one origin behind Caddy; set this to the
# public https origin.
CSRF_TRUSTED_ORIGINS = env(
    "CSRF_TRUSTED_ORIGINS",
    default=["http://127.0.0.1:3000", "http://localhost:3000"] if DEBUG else [],
)


# The origin the public site is served from, used to address public media.
#
# It cannot be taken from the request: server-rendered pages reach Django over
# loopback and build_absolute_uri() then answers https://127.0.0.1:8000/...
# See core/media.py for the full account and for how this is derived.
#
# Derived from configuration a deployment already has, so an existing install
# needs no new environment variable. Set DJANGO_PUBLIC_ORIGIN to override, or
# when media moves to its own hostname.
PUBLIC_ORIGIN = env("DJANGO_PUBLIC_ORIGIN", default="") or derive_public_origin(
    CSRF_TRUSTED_ORIGINS, ALLOWED_HOSTS, debug=DEBUG
)

# Caddy is the sole public peer. In Docker it reaches Django over a private
# bridge rather than loopback, so forwarded client addresses are trusted only
# when the socket peer belongs to one of these explicitly configured networks.
TRUSTED_PROXY_CIDRS = env("TRUSTED_PROXY_CIDRS")


# --------------------------------------------------------------------------
# Enquiry flow
# --------------------------------------------------------------------------
# Every one-time code costs money, so the caps here are a spend control as much
# as an abuse control. SMS pumping fraud — an attacker cycling numbers on a
# premium range to farm carrier revenue — is a direct cash loss, and django-axes
# does not cover it because it only guards login.

# console     writes each text to the log (development)
# backoffice  shows each code in the back office for staff to send by hand —
#             a stand-in for demonstrations until a gateway is registered;
#             see core/relay.py
# arkesel / hubtel  the real gateways, not implemented until a sender ID exists
SMS_PROVIDER = env("SMS_PROVIDER", default="console")
SMS_SENDER_ID = env("SMS_SENDER_ID", default="SkillsHub")

# --------------------------------------------------------------------------
# Email one-time codes
# --------------------------------------------------------------------------
# The code system is ours end to end — see enquiries/email_otp.py. Only the
# transport is configurable, and on this deployment it is the hard part:
# outbound port 25 is blocked by the host, reverse DNS is the provider's
# generic hostname, and there is no domain yet to sign mail for. So "console"
# is the honest default; it logs the code rather than pretending to send it.
#
# Switch to "smtp" once there is either an unblocked port 25 with SPF, DKIM,
# DMARC and rDNS on a real domain, or a submission host to relay through on
# 587. Nothing above core/mail.py changes either way.
EMAIL_PROVIDER = env("EMAIL_PROVIDER", default="console")

# Back-office sign-in by emailed code, as an alternative to the password form.
#
# Off by default, and that default is the point. It makes back-office access
# exactly as strong as the staff member's mailbox: a password plus django-axes
# means an attacker needs the password, this means they need the inbox. For a
# field officer on a phone that is usually a fair trade. For a superuser who
# can publish listings and open trainee records it is a real reduction.
#
# Turn it on once mail actually delivers, and prefer addresses on a mailbox
# with its own second factor. See core/staff_email_login.py.
STAFF_EMAIL_LOGIN_ENABLED = env.bool("STAFF_EMAIL_LOGIN_ENABLED", default=False)

EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
# STARTTLS on 587. Implicit TLS on 465 is blocked here anyway.
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=10)
DEFAULT_FROM_EMAIL = env(
    "DEFAULT_FROM_EMAIL", default=f"{BRAND_NAME} Skills Hub <no-reply@localhost>"
)

OTP_CODE_LENGTH = 6
OTP_TTL_SECONDS = 600  # 10 minutes
OTP_MAX_ATTEMPTS = 5  # wrong guesses before the code is burned
OTP_MAX_PER_PHONE_PER_DAY = 5
OTP_MAX_PER_IP_PER_DAY = 20

# Screen 4 encourages enquiring with three providers. Verifying once per session
# rather than once per enquiry keeps that from costing three SMS and three
# rounds of friction on the free side of the marketplace.
OTP_SESSION_TRUST_SECONDS = 3600

# The provider dashboard is reached by a tokenised link sent over WhatsApp. No
# password, no username, no account creation — Section 03 names being asked to
# log in as what makes a workshop owner give up.
DASHBOARD_TOKEN_TTL_SECONDS = 7 * 24 * 3600


# --------------------------------------------------------------------------
# Teaching videos
# --------------------------------------------------------------------------
# Uploaded here and encoded here with ffmpeg; no video service is involved.
# See providers/video_uploads.py and providers/video_encoding.py.
#
# Where uploads are assembled and encoded. Always a local directory, whatever
# STORAGES says: ffmpeg reads a file, and appending a piece at a time to an
# object in a bucket is not possible. Outside MEDIA_ROOT, because an upload
# is unreviewed and must never be reachable at a public address.
VIDEO_WORK_DIR = env("VIDEO_WORK_DIR", default=str(Path(PRIVATE_MEDIA_ROOT) / "video-work"))

# One piece of an upload. Under DATA_UPLOAD_MAX_MEMORY_SIZE (2.5 MB), and
# small enough that a dropped 3G connection loses seconds, not minutes.
VIDEO_CHUNK_BYTES = 2 * 1024 * 1024

# The limits below are placeholders until pricing is decided. They are
# settings so changing them is an .env edit and a restart, not a release.
#
# Largest single upload. An hour filmed at 720p on a phone is about 3–5 GB.
VIDEO_MAX_UPLOAD_BYTES = env.int("VIDEO_MAX_UPLOAD_BYTES", default=4 * 1024**3)
# Longest single lesson. A longer course goes up as several lessons.
VIDEO_MAX_MINUTES = env.int("VIDEO_MAX_MINUTES", default=60)
# Teaching a listing may hold in total, and how many lessons.
VIDEO_MAX_HOURS_PER_PROVIDER = env.int("VIDEO_MAX_HOURS_PER_PROVIDER", default=24)
VIDEO_MAX_PER_PROVIDER = env.int("VIDEO_MAX_PER_PROVIDER", default=40)
# Uploads are refused while the disk holding VIDEO_WORK_DIR has less free than
# this, whatever any listing's allowance. The database is on the same disk.
VIDEO_MIN_FREE_BYTES = env.int("VIDEO_MIN_FREE_BYTES", default=10 * 1024**3)
# An upload nobody has added to for this long is abandoned and removed.
VIDEO_ABANDONED_UPLOAD_HOURS = 48
# An encoding still marked running after this long is assumed to have died
# with its worker, and is queued again.
VIDEO_ENCODE_LEASE_HOURS = 6

VIDEO_FFMPEG = env("VIDEO_FFMPEG", default="ffmpeg")
VIDEO_FFPROBE = env("VIDEO_FFPROBE", default="ffprobe")
# Threads each ffmpeg run may use. One keeps a two-CPU server answering web
# requests while it encodes; a dedicated encoding server can raise it.
VIDEO_FFMPEG_THREADS = env.int("VIDEO_FFMPEG_THREADS", default=1)


# --------------------------------------------------------------------------
# Trainee accounts and staff support access
# --------------------------------------------------------------------------
# Where staff land after opening a trainee dashboard. In production Caddy puts
# Django and Next.js on one origin, so a relative path is right. In development
# they run on different ports, so point this at the Next.js dev server. Use the
# same host as the API (127.0.0.1): browsers treat localhost as a different
# site and would not send the staff session cookie.
PUBLIC_SITE_URL = env("PUBLIC_SITE_URL", default="http://127.0.0.1:3000" if DEBUG else "")

# A support session ends on its own after this long. Short on purpose: it is
# someone else's personal data on the screen.
SUPPORT_SESSION_SECONDS = 30 * 60


# --------------------------------------------------------------------------
# Security (production only)
# --------------------------------------------------------------------------

if not DEBUG:
    # Behind Caddy, Django sees plain HTTP. Without these the admin login form
    # fails CSRF validation with "Origin checking failed", which is the single
    # most common first-deploy failure for a Django app behind a proxy.
    SECURE_SSL_REDIRECT = True
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = "DENY"


# --------------------------------------------------------------------------
# Monitoring
# --------------------------------------------------------------------------

if env("SENTRY_DSN"):
    import sentry_sdk

    sentry_sdk.init(
        dsn=env("SENTRY_DSN"),
        # So a staging error is not read as one trainees saw.
        environment=env("SENTRY_ENVIRONMENT", default="production"),
        traces_sample_rate=0.1,
        # Phone numbers are personal data under Act 843. Do not ship PII to a
        # third-party error tracker: not cookies, users or IP addresses
        # (send_default_pii), and not request bodies either. The Django
        # integration attaches those regardless of send_default_pii, and every
        # enquiry, sign-in and complaint body carries a phone number.
        send_default_pii=False,
        max_request_body_size="never",
    )


LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"simple": {"format": "{levelname} {asctime} {name} {message}", "style": "{"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "simple"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
