# Next.js, built once and served from the standalone output.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# The hoisted node-linker in pnpm-workspace.yaml exists for the exFAT dev
# volume; inside the image it is harmless and keeps install behaviour identical
# between the two environments.
RUN pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at build time, so they must be present here
# rather than only at run time. They are public by definition — no secrets.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_BRAND_NAME
ARG NEXT_PUBLIC_MEDIA_HOST
# Turns on standalone output. Off by default so local Windows builds skip the
# file tracing that intermittently exhausts handles on the exFAT dev volume.
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME \
    NEXT_PUBLIC_MEDIA_HOST=$NEXT_PUBLIC_MEDIA_HOST

RUN pnpm build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install --no-install-recommends -y curl \
    && rm -rf /var/lib/apt/lists/*

# `output: "standalone"` bundles only the server and the modules it actually
# imports, so the runtime image carries no build toolchain.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

RUN useradd --system --create-home --uid 10002 web && chown -R web:web /app
USER web

EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:3000/ || exit 1

CMD ["node", "server.js"]
