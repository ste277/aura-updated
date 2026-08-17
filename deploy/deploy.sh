#!/usr/bin/env bash
# Deploy a tagged RELEASE of Aura on vf-1. Run ON THE SERVER:
#   cd /srv/aura/src && bash deploy/deploy.sh v1.2.0
#
# Production tracks release tags, never a moving branch: the script fetches
# tags, checks the requested tag out (detached), and builds exactly that.
# With no argument it deploys the newest release tag. `--current` skips
# the checkout and rebuilds whatever is on disk (for hotfix testing only).
#
# Idempotent: safe to re-run. Touches only the `aura` compose project and
# /srv/aura/* — never the Parley containers, /srv/parley, or other nginx sites.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STACK_DIR=/srv/aura
COMPOSE=(docker compose -p aura -f "$STACK_DIR/compose.yml")
REQUESTED="${1:-}"

cd "$REPO_DIR"
if [ "$REQUESTED" != "--current" ]; then
  echo "==> fetching release tags"
  git fetch --tags --quiet origin
  if [ -z "$REQUESTED" ]; then
    # newest by version order (v1.10.0 > v1.9.0), not by tag creation date
    REQUESTED="$(git tag -l 'v*' --sort=-v:refname | head -1)"
    [ -n "$REQUESTED" ] || { echo "!!  no release tags found; cut one first (see deploy/README.md)"; exit 1; }
  fi
  git rev-parse -q --verify "refs/tags/$REQUESTED" >/dev/null \
    || { echo "!!  tag '$REQUESTED' does not exist"; exit 1; }
  echo "==> checking out release $REQUESTED"
  git checkout --quiet --detach "refs/tags/$REQUESTED"
fi
VERSION="$(git describe --tags --always)"
echo "==> deploying $VERSION ($(git rev-parse --short HEAD))"

echo "==> building image"
docker build -f "$REPO_DIR/deploy/Dockerfile" -t "aura-app:$VERSION" -t aura-app:latest "$REPO_DIR"

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
    echo "$VERSION $(date -Is)" >> "$STACK_DIR/deploys.log"
    echo "==> deployed $VERSION"
    exit 0
  fi
  sleep 2
done
echo "!!  app did not become healthy; recent logs:"
docker logs --tail 50 aura-app
exit 1
