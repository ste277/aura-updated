# Deploying AuraSchedule v1

## Recommended: Railway

Why Railway over Vercel for this stack specifically: `lib/db.ts` holds a persistent
`pg.Pool`, which wants a long-running Node process. Railway runs `next start` as one
persistent process (verified locally — see below) and offers one-click managed
Postgres in the same project. Vercel's API routes are short-lived serverless
functions; a raw `pg.Pool` there risks exhausting Postgres's connection limit under
load unless you add a pooler (Neon's built-in pooler, or PgBouncer) — solvable, just
unnecessary complexity for a v1 with ~20-50 users.

### CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: the ephemeris/panchang
tests, and a full `next build`. Both were run exactly as CI runs them, in a fully
clean environment (stripped env vars, no live DB, fresh `node_modules`) — confirmed
the build doesn't need a real database at build time, since all data fetching in
this app is client-side.

## Health check

`GET /api/health` — checks actual DB connectivity (not just "is the process up"),
returns 200 `{"status":"ok","db":"connected"}` or 503 with an error message if
Postgres is unreachable. Point Railway's health check at this path. Both the healthy
and unhealthy responses were tested directly (stopped Postgres mid-request to confirm
the 503 path).

## Env vars

Copy `apps/web/.env.example` to `.env.local` for local dev, or set the same keys in
Railway's project settings.

## Steps

1. Push this repo to GitHub.
2. On [railway.app](https://railway.app): New Project → Deploy from GitHub repo.
3. Set the service's root directory to `apps/web`.
4. Add a Postgres database to the same Railway project (one click — "New" → "Database"
   → "PostgreSQL"). Railway auto-injects `DATABASE_URL` into your app service if you
   reference it as a variable (`${{Postgres.DATABASE_URL}}`).
5. Set these env vars on the app service:
   - `DATABASE_URL` — from the Postgres addon (step 4)
   - `AUTH_SECRET` — generate a real random value, e.g. `openssl rand -hex 32`.
     **Do not deploy with the insecure default in `lib/auth.ts`.**
   - `RESEND_API_KEY` and `RESEND_FROM_ADDRESS` — once you've set up Resend
     (see README's Auth section). Omit these and it'll fall back to dev-mode
     direct-link responses, which you do NOT want in production — real users
     can't see a JSON response, they need an actual email. Set these before
     inviting anyone.
   - `GEMINI_API_KEY` (optional) — enables real LLM answers in Ask Aura.
     Without it, deterministic panchang answers still work and the rest falls
     back to canned guidance.
6. Apply the schema to the new production database once, before first deploy:
   ```bash
   psql "$DATABASE_URL" -f prisma/migrations/0001_init/migration.sql
   ```
   (Or, once you've swapped to `lib/prisma-db.ts` per the README: `npx prisma migrate deploy`.)
7. Build command: `npm run build`. Start command: `npm start`. Both were verified
   working locally against a real Postgres instance — see "What's verified" below.

## What's actually verified before you deploy

- `npm run build` — clean production build, no type errors, all 6 API routes plus
  the page compiled correctly.
- `npm start` (the actual production server, not `next dev`) — booted and served
  real requests: `GET /` returned 200, `POST /api/auth/request-link` responded
  correctly.
- Everything else (auth flow, habit logging, location picker) was verified earlier
  against `next dev` + local Postgres — see the rest of this README. The production
  build wraps the same code paths.

## Not verified (can't be, from this sandbox)

- An actual deploy to Railway/Vercel/anywhere — this sandbox can only reach the
  domains in its network allowlist (npm, GitHub, PyPI, etc.), which doesn't include
  Railway's or Vercel's deployment APIs.
- Real email delivery via Resend (see README's Auth section for details on that
  specific limitation).

## Alternative: Vercel + Neon

If you'd rather use Vercel (nicer DX for Next.js specifically): use
[Neon](https://neon.tech) for Postgres (serverless-friendly, built-in pooling) rather
than a self-hosted instance, set the same env vars in Vercel's project settings, and
set the project's root directory to `apps/web`. Everything else is the same. Worth
revisiting once you're past the "does anyone actually use this" stage from the MVP
spec's kill criteria.
