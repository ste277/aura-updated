#!/bin/sh
# Production Migration Release Safety V1.
#
# WHY THIS LIVES IN THE VERCEL BUILD STEP, NOT A SEPARATE GITHUB ACTIONS
# JOB: Vercel's own "a deployment is only promoted to serve traffic if
# its build step exits 0" semantics are the ONE genuine ordering
# primitive this architecture has for "migration succeeds strictly
# before the new application code goes live." A GitHub Actions workflow
# triggered by the same push would run as a second, independent process
# racing Vercel's own auto-deploy -- nothing coordinates which one
# finishes first, so it cannot guarantee the migration completes before
# the new code is serving traffic. Running the migration here, before
# `next build`, means: migration fails -> this script exits non-zero ->
# the Vercel build fails -> this deployment is never promoted -> the
# PREVIOUS (migration-compatible) deployment keeps serving traffic. No
# incompatible code can go live without its own migration having
# already succeeded.
#
# WHY GATED ON VERCEL_ENV, NOT DATABASE_URL/branch inspection: whether
# Preview deployments' DATABASE_URL points at a database genuinely
# isolated from Production could not be established with confidence
# from this repository's own configuration (see DEPLOY.md's "Production
# migrations" section). Rather than infer that topology, this gates on
# `VERCEL_ENV`, a system environment variable Vercel itself injects into
# every build (never configured by this repo, not something a Preview
# deployment can spoof into reporting "production") -- so this is safe
# regardless of how Preview/Production databases are actually related.
#
# WHY `prisma migrate deploy` specifically: the ONLY Prisma command
# considered safe for an existing, already-live database -- additive by
# construction against already-applied migrations (re-running it when
# nothing is pending is a documented no-op, not a re-application), and
# serialized against concurrent invocations via Prisma's own Postgres
# advisory lock. Never `migrate dev` (would prompt/reset) or `db push`
# (bypasses the migration history entirely) -- see DEPLOY.md.
set -e

if [ "$VERCEL_ENV" = "production" ]; then
  echo "[vercel-build] VERCEL_ENV=production -- applying pending database migrations before building..."
  npx prisma migrate deploy
  echo "[vercel-build] Migrations applied (or already up to date). Proceeding to build."
else
  echo "[vercel-build] VERCEL_ENV=${VERCEL_ENV:-<unset>} -- skipping migration step (Production only)."
fi

next build

# AURA-PALM-01-P4 -- Palmistry publication guard for EVERY Vercel build
# (Preview and Production both run this script: Vercel's project has no custom
# build command, so it runs this package's `vercel-build` script).
#
# While packages/palmistry/src/review-status.json is not exactly "APPROVED",
# the build swaps the Palmistry module tree for an empty stand-in
# (palmistry-build-exclusion.js). This scanner then proves it: it inspects
# the artifacts `next build` just produced (.next/static, .next/server,
# .next/standalone -- next build clears its own output dir, except .next/cache,
# before compiling, so nothing stale is scanned) and exits non-zero if any
# unpublished-content sentinel is present, if no build output exists, or if
# the approval file is missing/unreadable. Under `set -e` a non-zero exit
# fails this script, so Vercel fails the build and the deployment is never
# promoted. Do NOT append `|| true` or otherwise swallow its exit code.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "[vercel-build] verifying no unapproved Palmistry content is in the build..."
node "$SCRIPT_DIR/check-palmistry-bundle.js"
