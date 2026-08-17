#!/usr/bin/env bash
# Nightly logical backup of the Aura database. Cron on vf-1:
#   30 3 * * * /srv/aura/backup.sh >> /srv/aura/backup.log 2>&1
# Keeps 14 days locally in /srv/aura/backups. Copy that directory off-box
# (rsync/rclone) for real disaster recovery — a backup on the same disk only
# protects against bad migrations and operator error, not disk loss.
set -euo pipefail

OUT_DIR=/srv/aura/backups
KEEP_DAYS=14
mkdir -p "$OUT_DIR"

stamp="$(date +%Y%m%d-%H%M%S)"
file="$OUT_DIR/aura-$stamp.sql.gz"
docker exec aura-db pg_dump -U aura -d aura --no-owner | gzip > "$file"
echo "$(date -Is) wrote $file ($(du -h "$file" | cut -f1))"

find "$OUT_DIR" -name 'aura-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
