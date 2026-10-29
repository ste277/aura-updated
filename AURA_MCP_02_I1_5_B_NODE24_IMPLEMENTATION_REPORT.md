# AURA-MCP-02-I1.5-B: Node 24 CI/Docker Alignment, Implementation Report

- **Date:** 2026-11-10, about 13:09–13:50 UTC
- **PR:** https://github.com/ste277/aura-updated/pull/346 (**draft**, not merged)
- **Branch:** `feature/aura-mcp-02-i1-5-b-node24`
- **Head:** `63edaf8ce2809d99c1e0c7618803d56f574b09d3`

---

## 1. Executive summary

- **What changed:** `.nvmrc`, all CI jobs, the Dockerfile, `apps/web` `engines` and `@types/node` now target Node 24, matching Vercel Production.
- **Required checks:** all four keep their exact names and **pass on real Node 24.22.2**.
- **Behaviour:** per-test results are **identical to the Node 20 baseline**:
  - Ephemeris/Panchang: 180 of 181 test files identical. The only change is the updated declaration guard, which has one extra check.
  - Day Constructor: 56/56 identical, still showing only the #323 baseline.
- **MCP stdio:** 40/40 on both Node 24 and Node 20.
- **Unchanged:** remote MCP is still disabled and the Palmistry scanner still passes.
- **Docker smoke test (owner-authorized):** passed. The image builds on `node:24-alpine`, `prisma generate` succeeds, and the container boots and serves with status codes identical to the Node 20 baseline image. One substitution needs your acknowledgement: the run had no database, because this ticket forbids creating one (section 11).
- **Verdict:** **READY FOR MERGE AUTHORIZATION.**

## 2. Baseline

`origin/main` `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b`. It is unchanged from I1.5-A and C. The one open PR (#344, mobile) touches none of these files.

**Required checks** (branch protection contexts, app 15368): `Next.js production build`, `MCP Server`, `Database migration validation`, `Ephemeris / panchang tests`.

**Reference reports read:**
- `AURA_MCP_02_I1_5_A_NODE24_COMPATIBILITY_AUDIT.md`
- `AURA_MCP_02_I1_5_C_ISOLATED_STAGING_DESIGN.md`
- `AURA_MCP_02_I1_5_A_C_DECISION_REPORT.md`
- `AURA_MCP_02_I1_M4_POST_MERGE_CLOSURE.md`

**Correction to Report A:** it said `node@24` was installed locally. In fact `/opt/homebrew/opt/node@24` is a symlink to Node **26.5.0**, and no real Node 24 or Node 20 binary exists locally.

## 3. Files modified (2 commits: `e864cd4`, `63edaf8`)

| File | Change |
|---|---|
| `.nvmrc` | `20` → `24` |
| `apps/web/package.json` | add `"engines": { "node": "24.x" }`; `@types/node` `^20.14.0` → `^24.19.2` |
| `apps/web/package-lock.json` | `@types/node` 20.19.43 → 24.19.2; `undici-types` 6.21.0 → 7.24.6; `engines` block |
| `package.json` (root) | `@types/node` `^20.14.0` → `^24.19.2` |
| `package-lock.json` (root) | `@types/node` 20.19.43 → 24.19.2; `undici-types` 6.21.0 → 7.24.6 |
| `.github/workflows/ci.yml` | `node-version: 24` in the 5 existing jobs; `checkout` and `setup-node` `@v4` → `@v5`; new job `mcp-server-node20-compat` |
| `deploy/Dockerfile` | `FROM node:20-alpine` → `node:24-alpine` (×3 stages). Nothing else. |
| `test/seededFixtureReproducibility.test.ts` | Node declaration guard updated from 20 to 24 (section 5) |

## 4. Runtime declaration changes

- **`.nvmrc` = 24:** for local development.
- **`apps/web` `engines.node` = `"24.x"`:**
  - Vercel reads it from the Root Directory and it overrides the dashboard setting. The dashboard already says 24.x, so merging changes nothing for Production. It only stops a future Vercel default (now 26.x) from silently moving the project.
  - Both PR Previews report deployment `nodeVersion: 24.x` through the API. The build log itself doesn't print a Node version.
- **Root `package.json`:** no `engines` added. It's irrelevant to Vercel, and adding it would cause `EBADENGINE` warnings on the Node 20 job.
- **`apps/mcp`:** kept at `engines >=20` and `@types/node 20.14.0`, per Report A A7. It's covered by the Node 20 compatibility job.

## 5. CI changes and required-check preservation

- **Node version:** all 5 jobs moved to `node-version: 24`. Actions are on `@v5`, which uses the node24 action runtime and removes GitHub's Node 20 runtime warning. v7 exists, but I stayed on v5 as approved.
- **Node 20 coverage:** a **separate job**, `MCP Server (Node 20 compatibility)`, runs `apps/mcp` `npm ci && npm test` on Node 20.
  - A matrix wasn't used, because it would rename the required `MCP Server` check.
  - The new job is non-required, has `contents: read` and no secrets.
- **Unchanged:** no `if:` or `continue-on-error` added; `services` blocks unchanged; job graph unchanged. The YAML parses cleanly (Ruby stdlib).
- **Required-check identity:** the PR rollup lists all four required contexts with exact names. Branch protection recognized them: the PR showed `BLOCKED` while they were pending and `UNSTABLE` afterwards, the latter only because of the non-required #323 job.

### Declaration guard (in-scope test change)

- **Why it changed:** the first CI run (`42822737682`, `e864cd4`) failed only on `test/seededFixtureReproducibility.test.ts`, check "SUPPORTED NODE IS DECLARED: CI declares Node 20 and `.nvmrc` records the same major". That test is the repository's own guard that CI and `.nvmrc` agree; Report A had missed it.
- **The updated guard** (commit `63edaf8`) requires:
  - `.nvmrc` = 24;
  - every job under `jobs:` declares only Node 24;
  - exactly one job named `MCP Server (Node 20 compatibility)` pins exactly 20.
- **Negative checks** (temporary copies): `.nvmrc` = 20 fails; a Node 22 job fails; a renamed compatibility job fails both checks.
- **Assessment:** test-only, no engine logic. The reviewer judged it in scope and noted P3 parser limits (it identifies jobs by key format and the compatibility job by display name).

## 6. Docker changes

All three stages use `node:24-alpine`. The build commands, `npm ci --ignore-scripts`, `npx prisma generate`, the non-root user, `HEALTHCHECK`, `CMD` and the copied artifacts are all unchanged. Prisma stays at 5.22.0, and `schema.prisma` has no `binaryTargets`, so engine detection for musl/OpenSSL 3 is automatic.

## 7. Dependency and lockfile changes

- **Packages:** only `@types/node` (20.19.43 → 24.19.2) and its declared dependency `undici-types` (6.21.0 → 7.24.6), plus the `engines` block in the `apps/web` lockfile.
- **Tooling:** npm 11.17.0 (local).
- **Unchanged:** no other packages moved, and Prisma, Next, Capacitor and TypeScript versions are the same.
- **Type checking:** passes with `@types/node` 24 under TypeScript 5.5.4, in both the Next build and the ts-node suites.

## 8. Local verification

These ran on **Node 26.5.0**; no Node 24 binary exists locally, so CI provides the Node 24 evidence.

| Command | Exit | Result |
|---|---|---|
| `cd apps/web && npm run build` (CI placeholder env) | 0 | ✓ Compiled; **types checked** with `@types/node` 24; MCP routes present |
| `cd apps/web && node scripts/check-palmistry-bundle.js` | 0 | `[palmistry-bundle] OK: none of 8` |
| `cd apps/mcp && npm ci && npm test` | 0 | `tests 40 / pass 40 / fail 0` |
| All 181 `npx ts-node` steps of the `math-core-tests` job, run sequentially | — | 174 identical to the Node 20 CI baseline at first. 7 JSX tests exited early because my runner dropped CI's per-step `TS_NODE_COMPILER_OPTIONS={"jsx":"react"}`. Re-run with that env, all 7 matched exactly. **Final: 180 of 181 identical; the guard went from 9 to 10 checks.** |
| `npx ts-node test/seededFixtureReproducibility.test.ts` | 0 | All checks pass, including the two new guard checks |
| `npx ts-node test/mcpRemoteTransport.test.ts` (part of the suite) | 0 | 67 OK |

**Not run locally:**
- **Database migration validation:** creating a local database isn't authorized. It's covered by CI, which uses a disposable service container.
- **Docker:** see section 11.

## 9. Node 20 and 24 MCP compatibility

| Job | Node | Result |
|---|---|---|
| `MCP Server` (required) | **v24.22.2** | 40/40 |
| `MCP Server (Node 20 compatibility)` | **v20.20.2** | 40/40 |

The remote MCP suite (67 OK, in Ephemeris on Node 24) still confirms:
- disabled-by-default 404s;
- 401 for unauthorized requests;
- 403 for a foreign Origin;
- the 16 KB body cap and batch rejection;
- the 14-day window;
- a strict schema with no `userId`.

No MCP code changed, and nothing was enabled.

## 10. Panchangam and timezone regression

Per-test `OK`/`FAIL` counts were compared between the Node 20 baseline (post-merge run `42813270945`) and Node 24 (run `42824896128`). I recomputed this myself, and the independent reviewer recomputed it too:

| Job | Node 20 baseline | Node 24 | Identical |
|---|---|---|---|
| Ephemeris / panchang tests | 181 test files, 7553 OK / 0 FAIL | 181 test files, 7554 OK / 0 FAIL | **180 of 181.** Only the guard changed (+1 OK). |
| Day Constructor acceptance DB tests | 56 test files, 1730 OK / 3 FAIL | 56 test files, 1730 OK / 3 FAIL | **56 of 56.** The same 3 #323 lines, byte-identical. |

**Identical suites include:**
- ephemeris;
- sunrise/sunset and solar windows (PA-3B timezone fix);
- Panchang day and month;
- timezone;
- Muhurta and Muhurtham Finder;
- Lahiri ayanamsa (PCE-4A);
- the PCE-3B reference validation;
- DST parity;
- timing search and Daily Rhythm;
- the engine-sensitive seeded incidence sweeps.

**No behavioural difference from Node 24 was observed.** New Node 24 log output: a `punycode` `DEP0040` deprecation warning and an npm `whatwg-encoding` deprecation notice. Both are warnings, not failures.

## 11. Docker smoke test: PASSED (owner-authorized, run 14:03–14:20 UTC)

**First attempt (blocked):** the Docker daemon wasn't running, and another session's `brew install cocoapods` was compiling LLVM, with free disk falling from 23 to 18 GiB. The owner then authorized the smoke test. I waited, in the background, for that Homebrew build to finish (14:03 UTC) and rechecked disk (26 GiB free) before starting Docker Desktop.

**Side effects, all outside my control:**
- Starting the daemon brought back a pre-existing user container through its own restart policy (`auraschedule-api-1`); it wasn't touched.
- Docker Desktop then **auto-updated itself** (engine 29.4.3 → 29.9.3) and restarted.

| Step | Node 24 (PR `63edaf8`) | Node 20 baseline (`e921f54`) |
|---|---|---|
| Build context | Clean `git archive` of `63edaf8` | Clean `git archive` of `e921f54` |
| Base | `node:24-alpine@sha256:a34ab6d7…`, Alpine 3.24.4 | `node:20-alpine`, Alpine 3.23.4 |
| `docker build -f deploy/Dockerfile .` | exit 0 | exit 0 |
| `npx prisma generate` (build stage) | ✔ Generated Prisma Client (v5.22.0) | ✔ |
| Next build in image | ✓ Compiled, types checked | ✓ |
| `npx prisma -v` (build stage) | Fails to detect OpenSSL; defaults to `openssl-1.1.x`; Query/Schema Engine `E_CANNOT_RESOLVE_VERSION` (`libssl.so.1.1` missing) | **Identical** |
| Runtime container (local; placeholder `AUTH_SECRET`; `DATABASE_URL` pointing at unreachable `127.0.0.1:1`; no Production credentials; no database) | Node v24.22.2, user `aura`, `✓ Ready in 57ms`, 0 restarts | Node v20.20.2, 0 restarts |
| `GET /`, `/find` | 200, 200 | 200, 200 |
| `GET /api/health` | 503 `{"db":"unreachable","message":"connect ECONNREFUSED 127.0.0.1:1"}` | 503 (same) |
| `/api/mcp` (GET, POST, OPTIONS), protected-resource metadata | 404 | 404 |
| Container healthcheck | Failing streak (expected with no database) | Same |
| Runtime image size | 189 MB | 158 MB |
| Prisma packages in runtime image | 0 | — |

**Findings:**
- **Gate 3 is substantively met.** The image builds, `prisma generate` succeeds on musl, and the container boots and serves with status codes identical to the Node 20 image.
- **Substitution to acknowledge:** the plan's wording asked for `/api/health` 200 against a **disposable Postgres**. That wasn't run, because this ticket prohibits creating databases. The database-connected `pg` path on Node 24 is already proven by CI (migration validation and Day Constructor database jobs on Node 24.22.2) and by Vercel Production.
- **Pre-existing, P3:** Prisma 5.22's OpenSSL detection fails on both Alpine images. Each has `libssl.so.3` and `libcrypto.so.3` but no `openssl` binary. This is **not a Node 24 regression**, and it affects nothing that runs today: the runtime image has no Prisma, the app uses `pg`, and `deploy.sh` migrates with `psql`. Suggested separate ticket: add `apk add openssl` to the build stage, or set `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`. The smoke test ran on arm64, so the amd64 engine target is unverified.
- **Correction:** the earlier concern that `/api/health` might be frozen into the image at build time was wrong. The 503 carries the live runtime connection error, so the reviewer withdrew that P2.

**Cleanup:**
- The two smoke containers and four images I created are removed, and the scratch build contexts are deleted.
- **Docker Desktop was quit**, restoring its original stopped state.
- Docker's build cache was **not** pruned (no approval).
- Disk is at 21 GiB free.

## 12. GitHub Actions results

| Run | Head / merge ref | Result |
|---|---|---|
| `42822737682` (attempt 1) | `e864cd4` | Ephemeris **failed**: old Node 20 declaration guard only (13 later steps skipped). MCP Server, Node 20 compatibility, Next build and migration validation **success**. Day Constructor: #323 baseline. |
| **`42824896128`** (attempt 1) | **`63edaf8`** / merge `cba3e0b` | **All 4 required checks success** on v24.22.2. Node 20 compatibility success (v20.20.2). Day Constructor: #323 baseline only. Palmistry scanner `OK: none of 8`. Migration validation: 51 migrations, schema up to date. |

**Vercel Previews** (automatic):

| Deployment | Source | Result |
|---|---|---|
| `dpl_AWt1ef5BNc4zaVY24uQotjt3v3iH` | `e864cd4` | Ready |
| `dpl_6yzVAJQr1TMuGNRgBH9KTFzgS2Lk` | `63edaf8` | Ready |

Both report `nodeVersion 24.x`, show `VERCEL_ENV=preview -- skipping migration step`, and have the Palmistry scanner OK.

**Pre-existing, not introduced here:** a statically prerendered `/api/health` runs `SELECT 1` against the shared database at build time in every Preview and Production build. That's a connectivity check, not data access.

## 13. Draft PR

https://github.com/ste277/aura-updated/pull/346, head `63edaf8ce2809d99c1e0c7618803d56f574b09d3`, **draft**, `MERGEABLE`/`UNSTABLE`, auto-merge off, Auto-fix off.

## 14. Independent review

**Verdict: APPROVE WITH NOTES on the code. No P0 or P1.**

The reviewer recomputed both CI comparisons from the job logs, read branch protection, and confirmed the Preview `nodeVersion`s.

| Sev | Finding | Disposition |
|---|---|---|
| ~~P2~~ | Docker smoke gate (plan §6 gate 3) not met | **Resolved.** The smoke test ran (section 11). The reviewer's addendum calls gate 3 "substantively met", subject to your acknowledgement of the no-database substitution. |
| ~~P2~~ | The Docker image might freeze `/api/health` at build time | **Withdrawn by the reviewer.** The runtime 503 carries the live connection error. |
| P2 (pre-existing) | Vercel Preview and Production builds run `SELECT 1` against the shared `DATABASE_URL` at build time (`/api/health` prerender) | Out of scope; recommend a separate ticket |
| P3 (pre-existing) | Prisma 5.22 OpenSSL detection fails on Alpine (both `node:20-alpine` and `node:24-alpine`); engines can't load in the build stage | Not a Node 24 regression and doesn't affect runtime. Separate ticket (`apk add openssl` or `binaryTargets`). |
| P3 | Guard parser limits (job-key regex; compatibility job matched by display name) | Accepted |
| P3 | Vercel build log doesn't print the Node version; the evidence comes from the deployment API (`nodeVersion 24.x`) | Documented (corrects Report A's wording) |
| P3 | `engines` "24.x" equals the dashboard setting, so no Production change at merge | Noted |
| P3 (pre-existing) | npm `allowScripts` warning for Prisma; `pg` SSL-mode warning | Noted |
| P3 | Day Constructor check still red (#323, non-required) | Carried forward |

**Reviewer addendum** (after the smoke evidence): *APPROVE WITH NOTES. READY FOR MERGE AUTHORIZATION, once the owner acknowledges the healthcheck substitution.* The remaining notes are all P3: guard-test robustness, Prisma OpenSSL detection, and Day Constructor #323, which is identical to main.

## 15. Known pre-existing failures

- **#323:** 3 DAILY RHYTHM failures in `dailyGuidanceOrchestratorDb`. They match exactly on Node 24.
- **#340:** not observed.
- **`dailyRhythmSettingsWiring` check 14:** local-only and not in CI. Not touched.

## 16. Scope compliance

- **Changed:** only the approved files, plus the in-scope declaration guard test.
- **Not changed:**
  - application, Panchangam or scheduling code;
  - the Prisma version;
  - Vercel settings, branch protection, secrets or databases;
  - MCP enablement or OAuth;
  - Palmistry state;
  - the primary checkout, untracked reports, the stash or other worktrees.
- **Not done:** no merge, and no deployment beyond the automatic Preview.
- **Docker:** started only after your authorization and after the concurrent Homebrew build finished. Nothing was installed or pruned, only the artifacts I created were removed, and Docker Desktop was quit afterwards. No databases were created.
- **Worktree:** `.claude/worktrees/aura-mcp-02-i1-5-b`, clean. The report is kept untracked in the repository root.

## 17. Final verdict

**READY FOR MERGE AUTHORIZATION**

The implementation is complete, all required CI checks pass on Node 24 with results identical to Node 20, and the Docker smoke test passed. The independent review approves, with no P0 or P1. The merge authorization should **acknowledge the Docker healthcheck substitution** (section 11): the container ran with no database, because creating one wasn't authorized. The database path is proven on Node 24 by CI and by Vercel Production.

## 18. Next required authorization

**AURA-MCP-02-I1.5-B-M: controlled merge of PR #346.** It needs explicit authorization, including the acknowledgement above. It would cover:
1. Re-checking `main`, the head (`63edaf8`), CI and Production immediately before merging.
2. Marking the PR ready.
3. Squash-merging.
4. Verifying the post-merge Production build: Node 24, "No pending migrations", `[palmistry-bundle] OK`, health 200, MCP routes 404.

**Suggested follow-up tickets** (not this PR):
- Fix Prisma OpenSSL detection on Alpine.
- Stop the build-time `/api/health` prerender from querying the shared database.
- Harden the guard parser.
