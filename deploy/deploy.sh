#!/usr/bin/env bash
# Build & (re)deploy Aura on vf-1. Run ON THE SERVER from a checkout of the repo:
#   cd /srv/aura/src && git pull && bash deploy/deploy.sh
#
# Idempotent: safe to re-run. Touches only the `aura` compose project and
# /srv/aura/* — never the Parley containers, /srv/parley, or other nginx sites.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STACK_DIR=/srv/aura
COMPOSE=(docker compose -p aura -f "$STACK_DIR/compose.yml")

echo "==> building image"
docker build -f "$REPO_DIR/deploy/Dockerfile" -t aura-app:latest "$REPO_DIR"

echo "==> syncing compose file"
cp "$REPO_DIR/deploy/compose.yml" "$STACK_DIR/compose.yml"

echo "==> starting database"
"${COMPOSE[@]}" up -d db
until docker exec aura-db pg_isready -U aura -d aura >/dev/null 2>&1; do sleep 1; done

echo "==> applying migrations (idempotent: each file is skipped if already recorded)"
docker exec aura-db psql -U aura -d aura -v ON_ERROR_STOP=1 -q \
  -c 'CREATE TABLE IF NOT EXISTS "_migrations" (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());'
for dir in "$REPO_DIR"/apps/web/prisma/migrations/*/; do
  name="$(basename "$dir")"
  applied="$(docker exec aura-db psql -U aura -d aura -tAc "SELECT 1 FROM \"_migrations\" WHERE name='$name'")"
  if [ "$applied" = "1" ]; then continue; fi
  echo "    applying $name"
  docker exec -i aura-db psql -U aura -d aura -v ON_ERROR_STOP=1 -q < "$dir/migration.sql"
  docker exec aura-db psql -U aura -d aura -q -c "INSERT INTO \"_migrations\"(name) VALUES ('$name')"
done

echo "==> starting app"
"${COMPOSE[@]}" up -d app

echo "==> waiting for health"
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "    healthy: $(curl -fsS http://127.0.0.1:3001/api/health)"
    exit 0
  fi
  sleep 2
done
echo "!!  app did not become healthy; recent logs:"
docker logs --tail 50 aura-app
exit 1
