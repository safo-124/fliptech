# Django + GeoDjango runtime.
#
# GDAL, GEOS and PROJ are C libraries that pip cannot supply, so they are
# installed with apt. This is the same requirement that made WSL necessary for
# local development on Windows — see SETUP.md.

FROM python:3.12-slim-bookworm AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# libgdal/libgeos/libproj are the runtime halves; the -dev packages are not
# needed once psycopg ships as a binary wheel.
RUN apt-get update && apt-get install --no-install-recommends -y \
        gdal-bin \
        libgdal32 \
        libgeos-c1v5 \
        libproj25 \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Static files are collected at build time so the image is immutable and the
# container starts without needing write access to a shared volume.
# A throwaway key and a real-looking database URL satisfy settings import;
# neither is used at runtime.
RUN DJANGO_SECRET_KEY=build-only \
    DJANGO_DEBUG=False \
    DATABASE_URL=postgis://u:p@127.0.0.1:5432/db \
    python manage.py collectstatic --noinput

# Run unprivileged. Nothing in the image needs to write to itself.
RUN useradd --system --create-home --uid 10001 app \
    && chown -R app:app /app
USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/healthz/ || exit 1

# Two workers is right for a small VPS. Raise it once the box has cores to
# spare; each worker holds its own database connections.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--threads", "4", \
     "--timeout", "60", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
