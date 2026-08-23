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
   - Email provider — **one of**: `MOM_API_KEY` + `MOM_FROM_EMAIL` (mail-o-mail,
     preferred; shared with Parley, sends from a verified @voyforge.com
     address) or `RESEND_API_KEY` + `RESEND_FROM_ADDRESS`. In production the
     sign-in endpoint refuses to work with neither configured (it fails
     closed rather than exposing credentials), so this is mandatory.
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

(This is the actual live deployment target as of Web Push V1 below — confirmed via
`apps/web/vercel.json` and the project's own `.vercel/` metadata.)

## Web Push V1 (reminder delivery)

Browser/PWA push notifications for approaching Plans and Aura Moments, sent when the
app isn't open. See `lib/webPushServer.ts`, `lib/reminderDelivery.ts`, and
`app/api/internal/reminders/dispatch/route.ts` for the implementation; this section is
only what's needed to actually turn it on in a deployed environment.

### Required env vars

- `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT` —
  standard Web Push authentication. Generate a real keypair once:
  ```bash
  cd apps/web && npx web-push generate-vapid-keys
  ```
  `WEB_PUSH_VAPID_SUBJECT` must be `mailto:you@example.com` or `https://your-domain`
  (the `web-push` library rejects anything else). If any of the three are unset, the
  feature fails closed and cleanly: `/api/push/public-key` returns 503, the client's
  "Enable notifications" button reports a `not_configured` error instead of a prompt,
  and `sendReminderDelivery` marks any claimed delivery `FAILED` with `errorCode:
  'not_configured'` rather than throwing. Nothing else in the app depends on these —
  in-app reminders (Bell/Home/Updates) work identically with push fully unconfigured.
- `INTERNAL_REMINDER_DISPATCH_SECRET` — gates `POST/GET /api/internal/reminders/dispatch`,
  the scheduler's only entry point. Generate with `openssl rand -hex 32`. A
  missing/wrong secret returns 404 (not 401), matching this app's other internal-route
  convention of not revealing the route exists.

### Scheduling the dispatch worker

`apps/web/vercel.json` defines a Vercel Cron Job hitting
`/api/internal/reminders/dispatch`. Two things to set up for that to actually work:

1. In the Vercel dashboard, set `CRON_SECRET` to the **same value** as
   `INTERNAL_REMINDER_DISPATCH_SECRET`. Vercel Cron sends
   `Authorization: Bearer $CRON_SECRET` automatically on every invocation — no other
   wiring needed.
2. **Plan-tier caveat (read this before assuming reminders are reliable):** Vercel's
   Hobby (free) tier doesn't just under-serve a sub-daily cron schedule — it now
   **rejects the deploy outright** if `vercel.json` declares a schedule that would run
   more than once a day (confirmed live: a `*/5 * * * *` schedule failed deployment
   with "Hobby accounts are limited to daily cron jobs"). That's why the checked-in
   schedule here is `0 13 * * *` (once daily, 13:00 UTC) — a deploy-safe default that
   does NOT give you real 15-minutes-before reminders; it gives you one dispatch run
   per day, so most reminders will simply never fire in time. Before relying on this
   feature in production, either upgrade to Pro (which allows a real interval — put a
   tighter schedule like `*/5 * * * *` back once you have it) or point an external
   scheduler (cron-job.org, a GitHub Actions scheduled workflow, or any host that can
   `curl` on a real interval) at the same endpoint with the same bearer secret instead
   of relying on `vercel.json`'s own cron at all.
3. Worst-case delay even on a correctly-running 5-minute schedule: up to ~5 minutes
   after a reminder becomes due before the next dispatch tick picks it up, plus
   actual send latency (single-digit seconds per user in local testing — see the
   Performance section of the PR's own completion report for real numbers). A
   "15-minute reminder" is therefore more accurately "somewhere between ~10 and ~15
   minutes before start," not an exact 15:00 mark. This is inherent to a polling
   scheduler and was a known, accepted tradeoff for V1 (brief explicitly ruled out
   building a true per-reminder job queue).

### Local dev

No cron runs automatically under `next dev`. Trigger a dispatch manually:
```bash
curl -X POST http://localhost:3000/api/internal/reminders/dispatch \
  -H "Authorization: Bearer $INTERNAL_REMINDER_DISPATCH_SECRET"
```
Returns `{ usersInspected, deliveriesPending, sent, failed, skipped, alreadyClaimed,
durationMs }`. Real device notifications also require Notification permission to
actually be granted in your OS browser — automated/sandboxed browser environments
(including this project's own preview tooling) deny that permission by default with
no way to override it, so the "does a real system notification appear" step can only
be confirmed in an actual local Chrome/Firefox/Edge window, not from an automation
sandbox. Everything else in the pipeline (subscription storage, delivery creation,
the atomic claim, re-validation against `deriveAuraReminders()`, the real send
attempt and its graceful failure handling) was verified end-to-end against the live
dev database and a real generated VAPID keypair.

### Supported browsers / platform limitations

- Desktop Chrome, Firefox, Edge: fully supported.
- Android Chrome/Firefox: fully supported.
- Safari (macOS 16+ / iOS 16.4+): supported, but **only after the site is added to
  the Home Screen** (installed as a PWA) — Safari does not support the Push API for
  a regular open browser tab, only for an installed web app.
- The Capacitor-wrapped iOS/Android app shells (see `MOBILE.md`) have **no native
  push plugin wired up** — this PR is Web Push (browser/PWA) only. A user running
  the native shell gets no push notifications from this feature at all, silently
  (they still get in-app reminders whenever they open the app). Native APNs/FCM
  integration is explicitly out of scope here and is the natural next step if the
  native shells need this.

### Disabling push safely

Unset the three `WEB_PUSH_VAPID_*` vars (or pause/delete the Cron Job). The app
degrades cleanly: existing `PushSubscription` rows are left alone (nothing is
deleted), `dispatchDueReminderPushes` keeps running if still scheduled and just marks
every claimed delivery `FAILED` (`not_configured`) instead of sending, and in-app
reminders are completely unaffected.

### Rotating VAPID keys

Generating a new keypair invalidates every existing browser subscription — a
subscription is cryptographically tied to the exact public key it was created with.
After rotating:
- Every existing `PushSubscription` row is now dead, but **the app does not know
  that automatically**. This PR's stale-subscription cleanup (`isGone` on the send
  result) only triggers on an HTTP 404/410 from the push provider, which means "this
  exact endpoint no longer exists." A key-mismatch after rotation is a different
  provider error (an auth failure, not a 404/410 in the providers tested), so it is
  NOT auto-detected — the delivery is marked `FAILED` and the subscription is left
  active, so `hasActiveSubscription`/the Settings UI will keep claiming "Enabled"
  even though no push will ever arrive again.
- The practical fix after a key rotation: affected users need to open Settings,
  turn notifications off, and re-enable them once (which re-subscribes with the new
  key). There is no server-side way to force this in V1 — flagging this explicitly
  as a known gap rather than a hidden one, since it's the kind of thing that's easy
  to discover the hard way in production.
