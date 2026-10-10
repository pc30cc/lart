# syntax=docker/dockerfile:1
# Lart / Limer website. Built and run by Coolify (build pack: Dockerfile, port 3000).

FROM node:24-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@12.9.1 && npm cache clean --force
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build needs no secrets and never touches the database: placeholder values
# only satisfy the environment check. Real values come from Coolify at runtime.
RUN DATABASE_URL=postgres://build:build@127.0.0.1:5432/build \
    APP_URL=https://build.invalid \
    ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= \
    pnpm build

FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# curl: for Coolify's health check, so a new version only goes live once it answers.
# pg_dump 18 (PostgreSQL's own apt repository, signed): Settings → Backup dumps the
# database with it, and pg_dump must not be older than the server.
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
# Local uploads (until a CDN is set in the settings) live in a persistent volume here.
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
# Each start applies new migrations and the default templates (both idempotent),
# then serves the site. Scripts (pnpm jobs, pnpm admin:create, ...) run in this image too.
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed && exec node_modules/.bin/next start"]
