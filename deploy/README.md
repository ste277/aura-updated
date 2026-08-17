# Production deploy — vf-1 (Docker)

Aura runs on the shared Hetzner box `vf-1` as an isolated Docker Compose
stack. **Nothing here touches the Parley tenant** (its containers, `/srv/parley`,
its nginx site, its crons) — see the isolation rules below.

```
browser → Cloudflare (proxied, orange cloud) → nginx :443 on vf-1
        → aura-app (127.0.0.1:3001 → :3000 in container) → aura-db (docker network only)
```

| Piece | Location on vf-1 |
|---|---|
| Source checkout | `/srv/aura/src` (this repo, `main`) |
| Compose stack | `/srv/aura/compose.yml` (copied by deploy.sh) |
| App env (secrets) | `/srv/aura/app.env` — never committed |
| DB password | `/srv/aura/db_password` |
| Postgres data | `/srv/aura/pgdata` (bind mount — survives container rebuilds) |
| TLS | reuses `/etc/nginx/certs/voyforge-origin.{pem,key}` (existing wildcard Cloudflare Origin cert) |
| nginx site | `/etc/nginx/conf.d/aura.conf` (from `deploy/nginx-aura.conf`) |
| Backups | `/srv/aura/backups/` via `backup.sh` cron 03:30 |

## First-time setup (once)

1. `sudo mkdir -p /srv/aura/{pgdata,tls,backups}` and clone the repo to `/srv/aura/src`.
2. `/srv/aura/db_password`: `openssl rand -hex 24 > /srv/aura/db_password; chmod 600 …`
3. `/srv/aura/app.env` (chmod 600):
   ```
   DATABASE_URL=postgresql://aura:<db_password>@db:5432/aura
   AUTH_SECRET=<openssl rand -hex 32>
   MOM_API_KEY=<from Parley's config>
   MOM_FROM_EMAIL=aura@voyforge.com
   # GEMINI_API_KEY=   (optional)
   ```
   Note the DB host is `db` — the compose service name — not localhost.
4. TLS: nothing to create — the site config references the wildcard Cloudflare Origin
   cert already on the box (`/etc/nginx/certs/voyforge-origin.{pem,key}`, covers
   `*.voyforge.com`; zone SSL mode already Full (strict)).
5. `sudo cp deploy/nginx-aura.conf /etc/nginx/conf.d/aura.conf && sudo nginx -t && sudo systemctl reload nginx`
   (reload is zero-downtime for the other sites).
6. `bash deploy/deploy.sh` — builds the image, starts db, applies migrations, starts app, waits for health.
7. Cron: `30 3 * * * /srv/aura/backup.sh >> /srv/aura/backup.log 2>&1`

## Releasing (production tracks tags, never `main`)

Production only ever runs a **tagged release** — a specific, reviewed,
CI-passed commit. `main` can move freely; nothing reaches vf-1 until it's
tagged.

```bash
# 1. Cut a release from origin/main (locally)
bash deploy/release.sh v1.2.0 "Window notifications + code sign-in"

# 2. Deploy that exact tag on the server
ssh vf-1 'cd /srv/aura/src && bash deploy/deploy.sh v1.2.0'
```

`deploy.sh` with no argument deploys the newest `v*` tag. New migrations are
applied automatically (tracked in the `_migrations` table). Every deploy is
appended to `/srv/aura/deploys.log`; images are tagged `aura-app:<version>`
so rolling back is `bash deploy/deploy.sh v1.1.0`.

Note that first-time setup step 6 above becomes `bash deploy/deploy.sh <tag>`.

## Isolation rules (Parley shares this machine)

- Separate compose project (`-p aura`), network, Postgres container, data dir, host port (3001 vs Parley's 3000).
- nginx changes are **additive only** — a new `conf.d/aura.conf`; never edit existing files; always `nginx -t` before reload.
- Memory/CPU limits on both containers so Aura can never starve Parley.
- Rollback / full removal: `docker compose -p aura down`, delete `/srv/aura`, remove `conf.d/aura.conf`, reload nginx. Parley never notices.

## Mobile shells

Point the Capacitor shells at production: `CAP_SERVER_URL=https://aura.voyforge.com npx cap sync`.
