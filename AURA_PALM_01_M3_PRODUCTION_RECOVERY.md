# AURA-PALM-01-M3: Production Database Connectivity Recovery

**Date:** 2026-11-10 · **Repository:** `ste277/aura-updated` · **Target commit:** `afbe5204ce8a17a22e3a44d3f41726753cae11f2` (merge of #338)

## H. Final verdict: **DEPLOYED AND VERIFIED, CONTENT UNPUBLISHED**

- The exact target commit is live in Production as `dpl_CGikLT8HSYtvLmHhAAfZ1PWjWAb7`.
- The deployment is healthy: migrations were a no-op, the build passed, the scanner passed, and runtime requests return 200/204.
- Palmistry content can't be reached. All 8 sentinels are absent, and the guide and its Explore card don't render.
- One redeploy of the one authorized was used.

---

## A. Executive summary

| Item | Status |
|---|---|
| Recovery status | **Recovered.** Production serves afbe520. |
| Root-cause classification | **1. Transient, recovered.** Confidence is medium; the exact mechanism isn't proven (B.7). |
| Deployment status | `dpl_CGikLT8HSYtvLmHhAAfZ1PWjWAb7`: Ready at 11:26:51Z, aliased to https://aura-updated.vercel.app. GitHub deployment 7680259143 now shows **success** (11:26:52Z). |
| Palmistry publication status | **Unpublished.** `review-status.json` = `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}`. Live bundles: 0/8 sentinels. The only case-insensitive "palmistry" matches are 10 code identifiers that are never shown to users (E.3). |

## B. Database investigation

### B.1 Failed deployment `dpl_3UywtP5qxL19qSuTs8H8MHHUF77f`

| Fact | Evidence |
|---|---|
| Source / target | git `main`, sha `afbe5204ce8a…` (full, from metadata and the `Cloning … Commit: afbe520` log line) / `production` |
| Region | iad1. Build cache restored from `FKCyndEsg…`. |
| Script | `npm run vercel-build` → `sh scripts/vercel-build.sh` |
| Migration step | 11:00:30.350Z `[vercel-build] VERCEL_ENV=production -- applying pending database migrations…` |
| Datasource → error | 11:00:31.521Z datasource line, then **11:00:36.575Z `Error: P1001: Can't reach database server at [redacted]:5432`** (a 5.05 s gap) |
| Failure | 11:00:36.615Z `Command "npm run vercel-build" exited with 1`, status Error |
| Before Next.js? | **Yes.** The log has no `next build` or "Compiled" output. |

### B.2 Neon status

- **Not inspectable directly.** No Neon CLI, API key or connector was available, and creating one wasn't authorized. I couldn't see compute state, suspend or restart events, plan limits, the IP allow-list, endpoint configuration or credential-rotation metadata.
- The public status page (neonstatus.com, about 11:30Z) showed "All Systems Operational", including Database Connectivity for AWS us-east-1 and us-east-2. There was no incident on 2026-11-10; the last connectivity incident was in us-east-2 on 2026-11-02. This is supporting evidence only.

### B.3 Connection configuration (metadata only)

- `apps/web/prisma/schema.prisma` uses only `url = env("DATABASE_URL")` and has no `directUrl`. There's no `DIRECT_URL` variable. `DATABASE_URL_UNPOOLED` exists but isn't used.
- The runtime `pg` pool (`lib/db.ts:36`) also uses `DATABASE_URL`, so the migrations and the app share one connection string.
- All 18 database variables are type **sensitive** (target preview + production), created and last updated at **2026-08-14T06:51:01Z**, so neither changed between the two builds.
- **Limitations:**
  - Sensitive values can't be read back, so I didn't compare hostname, pooled vs direct, port or SSL mode with Neon.
  - Credential changes made on the integration or Neon side wouldn't necessarily show in this metadata.
  - The fact that the current connection works (B.6) makes both limitations moot for recovery.

### B.4 Successful build vs failed build

| | `FKCyndEsg…` (9163eea) | `3UywtP5…` (afbe520, failed) | `CGikLT8…` (afbe520, redeploy) |
|---|---|---|---|
| Region / buildCmd / install / node | iad1 / null → vercel-build / same / 24.x | same | same |
| Datasource → result | 10:42:07.886 → 08.628: connected in **0.74 s**, no pending migrations | 11:00:31.5 → 36.6: **5.05 s timeout**, P1001 | 11:25:51.472 → .588: connected in **0.12 s**, no pending migrations |
| DB env vars | unchanged since 2026-08-14 | same | same |

### B.5 Timeline (UTC)

| Time | Event |
|---|---|
| 10:42:08 | 9163eea build: database reachable, no pending migrations |
| 10:43:02 | `FKCyndEsg…` Ready, serving Production |
| 11:00:15 | #338 merged → afbe520 |
| 11:00:36.6 | afbe520 build fails with P1001; Production stays on `FKCyndEsg…` |
| 11:20:06 | Reviewer's read-only probe: database reachable from Production (B.6) |
| 11:23:32 | Operator's own read-only probe: database reachable |
| 11:23:54 | Pre-deployment checks pass |
| 11:24:07 | Single redeploy issued (`dpl_CGik…` created 11:24:12; build starts 11:25:31 after about 79 s in the queue) |
| 11:25:51 | Migrations: 51 found, none pending |
| 11:26:45 | Scanner: OK, none of 8 |
| 11:26:51 | Ready and aliased to Production; GitHub deployment status → success 11:26:52 |

### B.6 Connectivity evidence (§3.6)

**Positive evidence: an authorized read-only connection over the same connection path.**
- `GET https://aura-updated.vercel.app/moment/m3-operator-nonexistent-probe-0001` was sent unauthenticated at 11:23:32Z.
- The response was HTTP 200, with `x-matched-path: /moment/[token]`, cache MISS, and function region **iad1** (the same region as the build).
- The rendered page contained `initialOutcome: {"status":"NOT_FOUND"}`.
- **Code path:** `resolvePublicAuraMoment()` (`lib/auraMoments.ts:189`) calls `getAuraMomentByToken()`, which runs `SELECT * FROM "AuraMoment" WHERE "publicToken" = $1` through the `DATABASE_URL` pool. There's no try/catch, and `NOT_FOUND` is returned only after that SELECT succeeds. A connection failure would surface as an error, not as `NOT_FOUND`.
- The only write, `markAuraMomentFirstOpened`, runs only when the status is `OK`. **No customer records were accessed and nothing was written.**
- The independent reviewer found this route at 11:20:06Z, and I reproduced it myself before relying on it.

**Caveat:** the probe uses the `pg` driver, not the Prisma migrate engine. It is the same connection string and the same region, and the Prisma engine had worked with that string at 10:42.

**Evidence I rejected as insufficient:**
- `/api/health` is prerendered statically at build time, so it can't show the current state.
- Earlier runtime logs contained no database-backed requests.
- The status page counts as supporting evidence only.

Phase 1 had first concluded that connectivity was unverified, because this route hadn't been found yet. The independent review corrected that, and the gate was re-run.

### B.7 Root cause

**1. Transient, recovered.** Confidence is medium.
- **For:**
  - Nothing changed in Vercel configuration, schema or migrations.
  - The same connection string worked 18 minutes earlier (0.74 s) and 25 minutes later (0.12 s).
  - The 5.05 s gap matches Prisma's default connect timeout.
- **Hypothesis, not proven:** a Neon compute wake-up or brief connectivity problem. It can't be confirmed without Neon console access.

## C. Phase 1 gate

| Prerequisite | Result |
|---|---|
| Exact target commit confirmed | **PASS.** `origin/main` = `afbe5204…` at 11:23:54Z. |
| No unexpected migrations | **PASS.** `apps/web/prisma` is identical between 9163eea and afbe520: 51 migrations, latest `0051_goal_activity_daily_frequency_foundation`. |
| Database connectivity positively verified | **PASS** (B.6, 11:23:32Z). |
| No configuration or secret change required | **PASS.** The existing configuration connects. |
| No unresolved P0/P1 security concern | PASS |
| Standard redeploy mechanism available | PASS (`vercel redeploy`) |
| Restricted to exact commit | PASS. A redeploy of the failed afbe520 deployment reuses its source. |
| Palmistry approval pending | PASS |

**Decision: PROCEED** (re-evaluated after the B.6 evidence; the first pass had stopped on connectivity).

## D. Redeployment (one of one authorized)

| Item | Value |
|---|---|
| Command | `vercel redeploy dpl_3UywtP5qxL19qSuTs8H8MHHUF77f --target production` |
| Deployment ID | `dpl_CGikLT8HSYtvLmHhAAfZ1PWjWAb7` (`aura-updated-godr5vu7b-aura-56a1.vercel.app`) |
| Source commit | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` (metadata `githubCommitSha`; clone log `Commit: afbe520`; meta `source: cli` because it's a redeploy) |
| Start / complete | issued 11:24:07Z; created 11:24:12Z; build 11:25:31Z; Ready 11:26:51Z |
| Migration result | `51 migrations found` → `No pending migrations to apply.` → `Migrations applied (or already up to date). Proceeding to build.` Nothing applied. |
| Next.js build | `✓ Compiled successfully`; 70/70 static pages |
| Scanner | `[palmistry-bundle] OK: none of 8 Palmistry sentinels present in .next/static, .next/server, .next/standalone.` |
| Errors | none (warnings only: npm config and deprecation, pg SSL mode) |

Other deployments: an unrelated git-triggered Preview (`dpl_5TJf…`, 6a35da0) was created at 11:24:03Z and finished at 11:25:30Z. No other Production deployment was created.

## E. Production verification

### E.1 Identity

- Project `targets.production` = `dpl_CGik…` (READY, afbe520).
- `vercel inspect aura-updated.vercel.app` → `dpl_CGik…`.
- The served webpack runtime chunk embeds `dpl_CGik…`.
- Runtime logs show live traffic on `dpl_CGik…`.
- `FKCyndEsg…` is no longer the active deployment.

### E.2 Unauthenticated scan (11:27:34Z)

- **URLs:** `/` and `/?tab=palmistry` return HTTP 200 with byte-identical HTML.
- **Assets:** 15 JS files referenced by the HTML, plus 2 on-demand chunks from the webpack runtime map (`50.92e893b7b290bdd0.js`, `151.6064ff3b9027eb07.js`). All 17 returned 200 (about 1.1 MB). The independent reviewer re-scanned, also including the CSS (18 files).
- **8 sentinels:** 0 / 0 / 0 / 0 / 0 / 0 / 0 / 0.

### E.3 The term "palmistry" (case-insensitive): 10 matches, all in `app/page-210990518ac8cbde.js`

| Count | Reference | Classification |
|---|---|---|
| 2 | `onOpenPalmistry`, `palmistryCard` prop destructuring | technical |
| 2 | `[…,"palmistry"].filter(e=>"palmistry"!==e)`: tab removed from the valid tabs | technical (the gate working) |
| 2 | `"palmistry"===eE ? trackEvent("PALMISTRY_GUIDE_OPENED")`: can never run | technical |
| 3 | `onOpenPalmistry: void 0`, `palmistryCard: null`, and render branch `"palmistry"===eE && !1` | technical (the gate working) |
| 1 | dock highlight comparison | technical |

**No user-visible leakage.** These identifiers come from `page.tsx` importing the unpublished stand-in, which is the intended design. They reveal that the feature exists but none of the reviewed content. The independent reviewer classified them the same way.

### E.4 Functional smoke

The in-app browser was already signed in to the owner's account. I only navigated between views and clicked no actions. Normal page-view analytics and a visit record were written, as for any visit.

- `/?tab=palmistry` falls back to **Home** (briefing, Right Now, Daily Rhythm "Your rhythm this week", Plan my day, Your Day). No "palm" text appears.
- **Explore** shows exactly three cards (Panchang Calendar, Muhurtham Finder, Plan Ahead) plus Quick Explore. No Palmistry card.
- **Plan** shows My Plans, Find a Time, Check a Time, Compare.
- Console errors: none.

### E.5 Existing functionality

- Runtime logs for `dpl_CGik…` (about 50 entries): only 200/204. Database-backed routes such as `/api/my-day`, `/api/daily-assistant/{guidance,briefing,reflection,goal-rhythm}`, `/api/aura-updates`, `/api/insights/reporting` and `/api/product-events` all succeeded.
- The 10 error-level lines are all the pg SSL-mode deprecation warning, which was already present on `FKCyndEsg…`.
- `/api/health` → `{"status":"ok","db":"connected"}` (prerendered by the 11:26 build).
- **Not exercised:** Notifications delivery, MCP (remote MCP not enabled), and Panchangam detail views beyond the Explore card. No destructive or data-changing tests were run.

## F. CI reconciliation (run `42803840888`, afbe520, finished: failure)

| Job | Result |
|---|---|
| Next.js production build | success. Scanner `OK: none of 8`. |
| MCP Server | success |
| Database migration validation | success |
| Ephemeris / panchang tests | success |
| Day Constructor acceptance DB tests (job 129787887966) | failure: 1730 OK, **3 FAIL**, in step "Run Daily Guidance orchestrator DB test" (`test/dailyGuidanceOrchestratorDb.test.ts`) |

The 3 failures exactly match the signatures listed in **#323**:
1. `DAILY RHYTHM (one outside-work candidate exists): the preferred outside-work window is genuinely promoted to rank 1 …`
2. `DAILY RHYTHM (one outside-work candidate exists): the surviving set is strictly narrower than the unfiltered baseline …`
3. `DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY: the recommendation's displayed/committed timing.start is EXACTLY the Daily-Rhythm-preferred …`

The same job also failed on the previous main run, 42801333679. **#340** (`dayConstructorPreviewItemDb` assertion 13) passed in this run, consistent with it depending on the time of day. **New failures: none.** #323 and #340 are still open.

## G. Independent review

The review was run in two rounds by an independent reviewer subagent with read-only access.

**Round 1 (Phase 1 evidence): VERIFIED WITH NOTES.**
- It confirmed the failure facts, the absence of configuration and migration changes, the CI reconciliation and the content scan.
- **It found an unsupported claim:** "connectivity cannot be verified" was wrong, because the public dynamic `/moment/[token]` route gives an authorized read-only database check. I verified this independently and re-ran the gate.
- It also pointed out an unrelated Preview deployment at 11:06:45Z (PR #343) that I hadn't mentioned.

**Round 2 (redeploy and verification): VERIFIED WITH NOTES.** It agreed with **DEPLOYED AND VERIFIED, CONTENT UNPUBLISHED**.
- **One correction:** I had said GitHub deployment 7680259143 still showed failure. It actually shows **success** at 11:26:52Z, because Vercel posted the redeploy's status to the existing deployment record. I confirmed this and corrected the report.
- **Notes:**
  - an unrelated Preview at 11:24:03Z;
  - about 79 s of queue time in "Ready in 3m";
  - the deployment ID appears in the webpack chunk, not the HTML;
  - the signed-in smoke test can't be reproduced unauthenticated, but the unauthenticated evidence is consistent with it.

**Unresolved risks:**
- The root cause isn't proven without Neon console access, so a repeat P1001 on a later Production build is possible.
- `vercel-build.sh` fails closed on P1001, so a repeat would block a deploy, not break Production.
- The pg SSL-mode deprecation warning is pre-existing.

## I. Next action (exactly one)

**Governance ticket: protect `main`.** Add branch protection that requires the `Next.js production build` job, which includes the Palmistry bundle scanner, to pass before merge. Other jobs stay unrequired until #323 and #340 are fixed. This replaces the manual pre-merge gate used for #338.

## Compliance

- **Not done:** no source, config, env var, secret, Neon, Vercel or branch-protection changes; no manual migrations; no database modifications; no rollback or hotfix; no `vercel curl`, bypass credentials or `vercel env pull`.
- **Done:** exactly one Production redeploy, of the exact target commit, after the gate passed.
- No secret values or database hostnames were printed.
- `review-status.json` is unchanged, #323 and #340 are still open, and Auto-fix and auto-merge are still off.
- **Evidence:**
  - `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/m3/`
  - `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/m3-review/`
