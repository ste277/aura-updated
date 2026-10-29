# AURA-MCP-02-I1.5-A + C: Decision Report

- **Date:** 2026-11-10
- **Scope executed:** I1.5-A (Node 24 compatibility audit) and I1.5-C (isolated staging design). Audit and design only.
- **Detailed reports:**
  - `AURA_MCP_02_I1_5_A_NODE24_COMPATIBILITY_AUDIT.md`
  - `AURA_MCP_02_I1_5_C_ISOLATED_STAGING_DESIGN.md`

## Baseline

| Item | Value |
|---|---|
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b`. Matches the M4 closure baseline; unchanged throughout. |
| Required checks (post-merge run `42813270945`) | Next.js production build, MCP Server, Database migration validation, Ephemeris / panchang tests: all success. Day Constructor: #323 baseline only. |
| Primary checkout | Local `main` and `HEAD` at `f35d35a` (not updated); 0 tracked changes; 1 unrelated stash (not touched); 117 worktrees (not touched) |
| Known debt (unchanged) | #323, #340, `dailyRhythmSettingsWiring` check 14 |

## Audit findings: I1.5-A (Node 24)

- **Production already runs Node 24.** The Vercel project is set to 24.x, and Production `e921f54` built and runs on it (Prisma `migrate deploy`, Next build, scanner, healthy database).
- **The tested runtime is still 20:**
  - `.nvmrc` = 20;
  - `ci.yml` uses `node-version: 20` in all 5 jobs, including the 4 required checks;
  - `deploy/Dockerfile` uses `node:20-alpine` in 3 stages;
  - `@types/node` is `^20`;
  - there's no `engines` field in root or web.

  So CI doesn't exercise the Production runtime.
- **No node-gyp native modules.** The only native code is prebuilt Prisma engines, SWC and fsevents.
- **Main risks:**
  - Prisma 5.22 `generate` and engine loading on `node:24-alpine` (Medium);
  - the ts-node CommonJS harness under Node 24 (Medium);
  - ICU/tzdata drift affecting Panchangam and DST assertions (Low–Medium);
  - deprecation warnings (Low).
- **Lifecycle:** Node 20 is past end-of-life (Vercel deprecated it from 2026-10-01). Vercel's default for new projects is 26.x.

## Audit findings: I1.5-C (staging)

- **Preview isn't staging:**
  - Preview shares the Production `DATABASE_URL` (one variable scoped to Preview and Production) and the Production `RESEND_API_KEY`.
  - Its migrations are skipped.
  - An automation protection-bypass secret exists on `aura-updated`.
- **Integrations found in the code:**
  - Resend and Mail-o-Mail (email);
  - OpenCage (geocoding);
  - Web Push/VAPID;
  - Vercel Cron (reminder dispatch);
  - internal metrics;
  - first-party product events;
  - shadow policy;
  - remote MCP.

  There are no payments and no third-party OAuth. Production has no OpenCage, VAPID, cron or metrics secrets configured.
- **Staging migrates by default.** A separate project with Production Branch `staging` runs `VERCEL_ENV=production`, so `vercel-build.sh` **will migrate** the staging database. A fail-closed database identity guard is therefore mandatory before the first staging build.
- **Sign-in needs email.** Under `NODE_ENV=production`, sign-in requires an email provider and refuses dev codes, so staging needs a restricted Resend key.
- **Native shells:** the Capacitor `CAP_SERVER_URL` is free-form and its synced config is git-ignored, so a native shell can silently point at Production or a Production-backed Preview.

## Proposed changes (not implemented)

**I1.5-B (Node 24 alignment):**
- `.nvmrc` → 24;
- `ci.yml` `node-version` → 24 in all 5 jobs;
- `checkout` and `setup-node` → v5;
- `mcp-server` job as a matrix [20, 24], with the required-check name kept stable;
- `deploy/Dockerfile` → `node:24-alpine`;
- `apps/web` `engines.node` = `"24.x"`;
- `@types/node` → `^24`;
- an optional lockfile-drift guard.

**Gates:**
- the 4 required checks green on 24, with the same counts;
- #323 signatures only;
- Docker build plus health smoke test (needs Docker authorization);
- the Preview log shows Node 24;
- review and checklist.

**Rollback:** a single revertible commit.

**I1.5-D (staging), in the mandatory order of design §3.4:**
1. Merge the fail-closed database guard to `main`.
2. Add the `aura-updated` Ignored Build Step for `staging`, or record an owner risk acceptance.
3. Create a protected `staging` branch from `main`.
4. Create a new, empty Neon project and run the empty check.
5. Create the `aura-staging` project without deploying.
6. Configure it: Production Branch `staging`, Node 24.x, Ignored Build Step, `ssoProtection: all`, no bypass, allowlisted variables only.
7. Pin the staging project ID in the guard.
8. Connect Git and run the first build.

Then run acceptance tests 1–20, including the negative guard test 3b and the unauthenticated-access test 13.

## Remaining blockers and owner decisions

- **No P0 or P1 remains.**
- **Owner approvals needed before I1.5-D:**
  - creating the Vercel project and Neon project, and the plan and cost implications (Hobby team; Pro only if a Hobby limit blocks the design);
  - the `aura-updated` Ignored Build Step, a Production project configuration change;
  - `staging` branch protection;
  - a restricted Resend key;
  - optionally, an OpenCage key and a custom staging domain.
- **To confirm at provisioning:**
  - Hobby support for `ssoProtection: all` (STOP if it isn't available);
  - Neon project limits;
  - the Hobby cron limit;
  - whether Production's `DATABASE_URL` is pooled or direct.

## Independent review

| Report | Round 1 | Round 2 (final) |
|---|---|---|
| A: Node 24 | APPROVE WITH NOTES (P3s only) | **APPROVE WITH NOTES.** No P0 or P1. Residual P3 applied. |
| C: Staging | REQUEST CHANGES: P1 fail-open guard; P1 unresolved staging protection; 5 P2s | **APPROVE WITH NOTES.** Both P1s resolved, all P2s addressed, residual P3s applied. |

Reviewer's blocking statement: *no P0 or P1 remains in either report; I1.5-B may proceed; I1.5-D may proceed on owner approval of provisioning.*

## Confirmation of scope

- **No implementation or provisioning occurred.** No source, dependency, lockfile, CI or Docker change, and no commit, push or PR. Node was neither installed nor switched; the installed `node@24` wasn't used.
- **No infrastructure or configuration change.** No Vercel project, database, environment variable or secret was created or changed, and nothing was deployed.
- **No access to sensitive data.** No Production data was accessed, and no secret values were printed.
- **Read-only actions used:** `git fetch`, a `git archive` inspection copy in the session scratchpad, `vercel project inspect`, `vercel env ls` (names), `vercel api` GETs, and `gh` reads.

## Verdict

**READY FOR IMPLEMENTATION AUTHORIZATION**

## Recommended next authorization

**AURA-MCP-02-I1.5-B: Node 24 runtime alignment (CI, Docker, `.nvmrc`, `engines`).** It is a code-only PR with the gates above, plus Docker authorization for the build smoke test. It doesn't depend on staging and carries no Production risk, because Vercel is already on 24.

I1.5-D (staging provisioning) follows as a separate authorization once the owner approves the section 8 prerequisites.
