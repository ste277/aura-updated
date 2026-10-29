# AURA-MCP-02-I1-M1: Controlled Merge Preflight and Security Verification

- **PR:** https://github.com/ste277/aura-updated/pull/343 (`feature/aura-mcp-02-i1`)
- **Date:** 2026-11-10, about 11:00–11:25 UTC
- **Mode:** verification only

**What was not done:** no code changes, commits, pushes, merges or PR state changes; no deployments; no configuration, environment, OAuth or staging changes; no database access or migrations; no tokens sent anywhere.

---

## A. Executive Summary

| | |
|---|---|
| **Verdict** | **CONDITIONAL GO** |
| **Code and security posture** | Sound. The merged result adds exactly the reviewed I1 patch. Remote MCP is unreachable in every deployed configuration: 404 for every method; even when enabled the route always rejects tokens; it has no database in its module graph. |
| **CI** | Every required check passes on the merge commit `354015d`. The only failure is the exact #323 baseline (3 identical DAILY RHYTHM signatures), which `main` shows too. |
| **Independent review** | APPROVE WITH NOTES. No P0 or P1. One P2 (operational) and P3 notes. |
| **Outstanding (why not GO)** | (1) **`main`'s own Production build is failing.** The `afbe520` (#338) deploy errored in `prisma migrate deploy` with P1001 (database unreachable at build time). Live Production is still `9163eea`. (2) As a result, **the combined tree has never been built by Vercel**, and the Palmistry scanner has never run in a Vercel build. The PR #343 Preview was built from the branch head, which predates #338. Merging now would make the post-merge Production build the first Vercel build of Palmistry plus MCP. (3) `main` has no branch protection, so CI is advisory only. |

---

## B. Repository Baseline

| Item | Value |
|---|---|
| `origin/main` | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` (Merge PR #338, Palmistry) |
| PR head | `07a3ecd30947889b09cf96b70226d9158748616b` |
| PR base (GitHub) | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` |
| Original I1 base | `9163eeaa1ffd1d97ce8a2fb56286c6834714d557` |
| Commits (3, as reviewed, none unexpected) | `ab9d36d7af1ef47f946ec2423c815879a6ace076`, `0010435d18d31af57abe7a3ce2c8cad29f451682`, `07a3ecd30947889b09cf96b70226d9158748616b` |
| State | OPEN, **draft**; mergeable `MERGEABLE`; mergeStateStatus `UNSTABLE` (because of the #323 job); auto-merge **off** (`null`); Auto-fix **off** (app monitor) |
| Scope | 21 files, +1274/−355 |
| GitHub merge-test commit | `354015d8ec684fbed2c7e04292a58ef93d76fd71` (parents `afbe520`, `07a3ecd`) |
| CI run | `42804820274`, attempt 1, event `pull_request`, checked out `refs/remotes/pull/343/merge` (`354015d`) |
| Vercel Preview | `dpl_FC2k8TWcpkhxcXkMxCPM8CfGsBSQ` (source commit `07a3ecd`, the branch head) |

The PR head equals the reviewed implementation, with no scope expansion.

---

## C. Merge Simulation

- **Simulated tree:** `git merge-tree --write-tree origin/main 07a3ecd` gave `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b`. That is **identical** to the tree of GitHub's merge-test commit `354015d`.
- **Conflicts:** none. `ci.yml` was auto-merged.
- **Nothing dropped or added:** for each of the 21 files, the added and removed lines of `main → merged` are byte-identical to the PR's own patch (`9163eea → 07a3ecd`). Only hunk offsets differ. Nothing from `main` was dropped, and no unexpected source changed.
- **Untouched by the merge:** `packages/palmistry/**`, `apps/web/scripts/**`, `apps/web/prisma/**` (no migration), `apps/web/next.config.js`, and the `apps/web` and `apps/mcp` package and lock files. The Panchangam engine is also untouched; the timing search tests pass.

### Combined `.github/workflows/ci.yml`

| Check | main `afbe520` | merged `c5e1240` |
|---|---|---|
| Jobs | 6 | 6 |
| Named steps | 252 | 253 (+1: "Run remote MCP transport test") |
| `if:` / `continue-on-error` / `\|\| true` | 0 / 0 / 0 | 0 / 0 / 0 |

The diff against `main` is exactly the six added lines (comment plus step) in `math-core-tests`. Everything else is preserved:

- **Palmistry:** content, privacy and isolation test; Explore and guide jsdom test; Vercel build guard test (`palm01P4VercelGuard`, which includes planted-leak scanner failure, B5); and the web-build step "Verify unapproved Palmistry content is excluded from the build" (`check-palmistry-bundle.js`).
- **MCP:** the `mcp-server` job (`npm ci` + `npm test`) and the new remote transport step after the root `npm install`.
- **Application:** Next.js production build (including type checking), ephemeris and Panchangam tests, database migration validation, and Day Constructor acceptance DB tests.

**Result: the combined workflow is complete.**

---

## D. CI Results

Run `42804820274`, attempt 1, on merge commit `354015d`. Node 20.20.2.

| Job | ID | Result | Evidence |
|---|---|---|---|
| Ephemeris / panchang tests | 129791145466 | ✅ success | "All AURA-MCP-02-I1 remote transport checks passed."; Palmistry tests OK (A2, B5, C2, E4 and others). Every `FAIL` token in the log is inside an `OK` line (test names). |
| Next.js production build | 129791145376 | ✅ success | ✓ Compiled; types checked; `[palmistry-bundle] OK: none of 8 Palmistry sentinels present` |
| MCP Server | 129791145508 | ✅ success | `# tests 40 / # pass 40 / # fail 0` |
| Database migration validation | 129791145179 | ✅ success | |
| Day Constructor acceptance DB tests | 129791145649 | ❌ failure (**known #323**) | Exactly 3 `FAIL` lines in `dailyGuidanceOrchestratorDb.test.ts` (the job's last test step), with text identical to #323. 65 steps succeeded; the only skipped step is the post-action cleanup, so no test was masked. |
| Vercel and Vercel Preview Comments | — | ✅ | |

- **Baseline:** `main` CI on `afbe520` (run `42803840888`) fails in the same job with the same 3 signatures. So do `9163eea` and `9a487a9`.
- **New failures:** none.
- **Pending checks:** none. The run is complete; its overall conclusion is "failure" only because of #323.
- **#340:** not observed in this run.

---

## E. MCP Contract

| Check | Result |
|---|---|
| Single authoritative definition | `FIND_BEST_TIME_TOOL` and `toFindBestTimeToolResult` live in `packages/mcp-tools/src/findBestTimeTool.ts`. Both `apps/mcp/src/server.ts` (SDK v1) and `remoteMcpHandler.ts` (SDK v2) register from it. There is no duplicate definition. |
| stdio export compatibility | `apps/mcp/src/schemas/findBestTime.ts` and `src/tools/findBestTime.ts` re-export the moved modules. The 39 original MCP-01 test files are byte-identical. |
| stdio tests (merged tree, local and CI) | **40/40** |
| Remote transport tests (merged tree, local and CI) | **67/67** |
| Schema snapshot | Both transports match `packages/mcp-tools/fixtures/findBestTimeInputSchema.json`. The only difference is `$schema` (v1 draft-07, v2 2020-12). |
| DST-crossing parity | Passes (New York, range 2026-10-30 to 11-03 across the 2026-11-01 change) |
| Panchangam ranking and constraints | The engine is unchanged; remote results deep-equal the shared executor; `timingSearch` and `timingSearchApi` tests pass on the merged tree |
| Birth profile | Not used (no `personalContext`; D-2) |
| Deferred | The `activityId` description example `"exercise"` is not a catalog id. This predates I1 and is documented in `packages/mcp-tools/README.md`. Not changed. |

---

## F. Security

All checks ran on the merged tree's compiled routes, locally, with no database.

**Feature flag.** Note that the real variable is `AURA_MCP_REMOTE_ENABLED`; the ticket's `AURA_REMOTE_MCP_ENABLED` is not read and has no effect (verified).

| Configuration | `/api/mcp` (POST, GET, DELETE, PUT, PATCH, OPTIONS, HEAD) | Both metadata URLs (all methods) |
|---|---|---|
| Unset | all 404 | all 404 |
| `true`, `TRUE`, `yes`, `on`, `0`, `" 1"`, `"1 "` (plus the reviewer's `01`, `1.0`, `""`) | all 404 | all 404 |
| `AURA_REMOTE_MCP_ENABLED=true` (ticket name) | all 404 | all 404 |
| `"1"` without URLs, or with an http (non-localhost) or query-string URL | all 404 | all 404 |
| `"1"` with valid https URLs (**local fixture only**) | POST 401, others 405 | GET 200, others 405 |

No `AURA_MCP_*` or `AURA_REMOTE_*` variable exists in any Vercel environment (`vercel env ls`, names only).

| Area | Result |
|---|---|
| **Authentication** | The deployed route hard-wires `rejectAllAccessTokens` (a test asserts it). A forged bearer token gets 401 with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="aura.planning.read"`. Accepting verifiers exist only in `test/`. No principal reaches execution without passing the verifier and the scope check. A client-supplied `userId` is rejected by the strict schema. |
| **Origin and CORS** | A foreign Origin gets 403 (the reviewer also tested `null`). An absent Origin is allowed for server-to-server calls. **No `Access-Control-*` headers.** The SDK's wildcard-CORS metadata helper is not used. |
| **Body** | A declared size over 16 KB gets 413 before authentication. A streamed body without Content-Length is cut off at 16 KB with 413. Invalid JSON gets 400. A JSON-RPC batch gets 400 / −32600. |
| **Search bounds** | A `dateRange` span of 14 days or less is accepted and 15 is rejected with the remote-cap message. Horizons are 7 days or less. Limit is 10 or less, duration 360 or less, title 200 characters or less. |
| **Statelessness and isolation** | A fresh `McpServer` and transport per request; `sessionIdGenerator: undefined`; JSON responses; no module state. |
| **Data exposure and logging** | No account, birth profile or database. The route's `.nft.json` trace (29 files) contains no `pg`, Prisma, auth or Palmistry modules. Logging records only the error class name, never tokens, arguments or bodies. |
| **Read-only** | Single tool, `readOnlyHint: true`. Unknown or write tool names are not callable (tested). |

**No authentication bypass and no unauthorized tool execution was found. No P0.**

---

## G. Dependencies and Runtime

| Item | Result |
|---|---|
| Root additions | `@modelcontextprotocol/server` **2.4.0** (published 2026-10-23) and `zod` **4.6.7**, exact pins. Lockfile entries carry integrity hashes. Only the root lockfile changed (server, core, zod). |
| Lockfile consistency | A fresh root `npm install` on the merged tree left `package-lock.json` byte-identical |
| zod copies | Root 4.6.7 (no nested copies); `apps/mcp` 4.6.7 (pin guard test); `apps/web` has none. **One** zod instance in the server bundle (version marker count = 1). |
| `apps/mcp` | Builds and passes without root dependencies (CI `mcp-server` job and an earlier clean-archive simulation) |
| Runtime | CI runs Node 20.20.2 (`setup-node 20`; GitHub warns that Node 20 actions are deprecated and forced onto Node 24). Vercel builds on Node 24.x (Preview log: Vercel CLI 65.11.0). SDK v2 declares `engines >=20`. Local verification ran on 26.5. **No incompatibility observed.** |
| **I1.5 requirements** | Align CI `setup-node` and `deploy/Dockerfile` (`node:20-alpine`) to Node 24, matching Vercel. Consider `npm ci` instead of `npm install` in the Vercel install command; today the exact pins limit drift. Pre-existing: `apps/web` `npm audit` reports 13 vulnerabilities; the `apps/web` lockfile is unchanged by this PR. |

---

## H. Vercel Preview

| Item | Value |
|---|---|
| Deployment | `dpl_FC2k8TWcpkhxcXkMxCPM8CfGsBSQ` (`aura-updated-j4tpdbsal-aura-56a1.vercel.app`, alias `aura-updated-git-feature-aura-mcp-02-i1-…`) |
| Source | Branch `feature/aura-mcp-02-i1`, **commit `07a3ecd` (branch head, not the merge)** |
| Timing | Build 11:06:46–11:07:58 UTC; status **Ready** |
| Install | `npm install --prefix ../.. && npm install` (root: "added 3 packages") |
| Migrations | `[vercel-build] VERCEL_ENV=preview -- skipping migration step (Production only).` **No migration ran.** |
| Build | ✓ Compiled; types checked; routes `ƒ /api/mcp`, `ƒ /.well-known/oauth-protected-resource`, `ƒ /.well-known/oauth-protected-resource/api/mcp` |
| Palmistry scanner | **Did not run, and couldn't:** the `07a3ecd` tree contains no `packages/palmistry` and its `vercel-build.sh` has no scanner (both arrived with #338). No Palmistry content could be exposed by this Preview. |

### Endpoint checks

All via `vercel curl` using existing CLI authentication, with no bearer tokens and no protection changes:

| Path | GET | POST | PUT | DELETE | OPTIONS |
|---|---|---|---|---|---|
| `/api/mcp` | 404 | 404 | 404 | 404 | 404 |
| `/.well-known/oauth-protected-resource` | 404 | 404 | 404 | 404 | 404 |
| `/.well-known/oauth-protected-resource/api/mcp` | 404 | 404 | 404 | 404 | 404 |
| `/.well-known/oauth-authorization-server` (not implemented in I1) | 404 | 404 | 404 | 404 | 204 \* |
| `/api/health` (control) | 200 | | | | |

\* This 204 is the platform's generic answer for **any** unknown path (`x-matched-path: /404`); `/definitely-not-a-route` behaves identically. It is not an I1 route.

Without Vercel authentication, every path returns a 302 to Vercel SSO, so the Preview is not publicly reachable at all.

**Database isolation.** Preview shares the Production `DATABASE_URL` (known, from D2). While disabled, the MCP route returns 404 from `parseRemoteMcpConfig` before any other code runs, and its bundle contains no database module. No database query was used to prove isolation.

---

## I. Palmistry Safety

| Item | Result |
|---|---|
| `packages/palmistry/src/review-status.json` (merged tree) | `{"status": "PENDING_HUMAN_REVIEW", "approvedBy": null}`. Untouched by the PR. |
| Bundle scanner, merged tree (local) | `[palmistry-bundle] OK: none of 8 Palmistry sentinels present in .next/static, .next/server, .next/standalone` |
| Bundle scanner, CI on merge commit | Same OK line (job 129791145376) |
| Scanner in the Vercel build path | The merged `apps/web/scripts/vercel-build.sh` runs `check-palmistry-bundle.js` after `next build` under `set -e`. **Never yet executed on Vercel** (see K and L). |
| Palmistry tests (merged tree, local) | `palm01I1Content`, `palm01I1ExploreJsdom`, `palm01P4VercelGuard`: all pass |
| Runtime visibility | Behind the approval gate (jsdom test E4). No fourth Explore card while pending. |

---

## J. Independent Review

The reviewer examined the actual merge result (`c5e1240` / `354015d`), not just the branch, and changed nothing.

**Verdict: APPROVE WITH NOTES. No P0 or P1.**

| ID | Sev | Finding | Remediation (future, not M1) |
|---|---|---|---|
| P2-a | P2 | **The combined tree has never been built by Vercel.** The Preview built `07a3ecd`, which has no Palmistry. `main`'s Production deploy of `afbe520` (`dpl_3UywtP5qxL19qSuTs8H8MHHUF77f`) is **Error**: `P1001: Can't reach database server` during `prisma migrate deploy`, before `next build` or the scanner ran. Live Production is `9163eea` (`dpl_FKCyndEsgUmnSbn1uWji86VEkmcd`), so #338 isn't live and the scanner has never run in a Vercel Production build. The merge adds no migration, so `migrate deploy` would be a no-op if the database is reachable. If it isn't, the build fails safely and nothing is promoted. | Before merging #343, get `main` (`afbe520`) to a Ready Production deployment under separate authorization, proving the Palmistry build and scanner alone. After merging, confirm the Production log shows the scanner OK and the MCP routes returning 404. |
| P3-a | P3 | No per-principal or per-IP rate, concurrency or time limits yet. The engine is synchronous, about 1.1 s CPU at 14 days. Acceptable while nothing can authenticate. | Must land before or with I2. |
| P3-b | P3 | The Vercel install uses `npm install`, not `npm ci` | Consider in I1.5 |
| P3-c | P3 | CI on Node 20 vs Vercel on Node 24 | I1.5 |
| P3-d | P3 | The Day Constructor job was pending when the reviewer checked | **Resolved:** completed with exactly the #323 signatures (section D) |
| P3-e | P3 | HEAD behaviour (404 while disabled, 405 when enabled) | None |

**Author verification of P2-a:**
- `vercel ls --prod` shows `nlwu7stjt` (`afbe520`) with status Error, and `ci3co628r` (`9163eea`) Ready and aliased.
- The failing build log contains `Error: P1001: Can't reach database server at [REDACTED]:5432`.
- A read-only `GET /api/health` on live Production at 11:22 UTC returned `{"status":"ok","db":"connected"}`, which suggests the build-time failure was transient or build-network specific. Its cause is **not established**.

---

## K. Merge Governance

- `main` is **not protected**: `GET /branches/main/protection` returns 404 "Branch not protected", `protected: false`, and there are 0 rulesets.
- CI is therefore **advisory**. GitHub would allow a merge regardless of check state.
- `main` CI has failed on its last three runs because of #323, so a red status is normal and is easy to wave through. The known #323 failures do **not** authorize ignoring any other failure.

**Required manual gate immediately before any merge of #343:**
1. `origin/main` is still `afbe5204ce8a17a22e3a44d3f41726753cae11f2`. If not, rerun the merge simulation and CI review.
2. The PR head is still `07a3ecd30947889b09cf96b70226d9158748616b`.
3. The CI run on the current merge ref has completed. Every job is green except Day Constructor, and that job's failures are exactly the three #323 signatures.
4. `main`'s Production deployment is Ready on `afbe520` (P2-a).
5. No `AURA_MCP_*` variable exists in any Vercel environment.

---

## L. Final Verdict

**AURA-MCP-02-I1-M1 — CONDITIONAL GO**

The implementation is sound and the merged result is verified: all required checks pass, the only failure is the exact #323 baseline, there are no P0 or P1 findings, and remote MCP is unreachable in every deployed configuration.

Outstanding before an unconditional GO:
- `main`'s current Production deployment (`afbe520`, #338) failed at the migration step with P1001.
- The combined Palmistry and MCP tree has never been built or scanned by Vercel.
- `main` has no enforced merge gate.

## M. Next Authorization

**AURA-MAIN-PROD-R1: Restore `main` Production deployment.** Diagnose the P1001 build-time database failure for `afbe520` and redeploy `main` to a Ready Production deployment, with explicit Production authorization.

Acceptance:
- the build log shows "No pending migrations",
- `[palmistry-bundle] OK`,
- `/api/health` returns 200,
- no Palmistry exposure.

After it succeeds, re-run the section K gate and request merge authorization for #343. **Do not execute without explicit authorization.**

---

### Evidence locations (session scratchpad)

The CI job logs `m1-job-*.log` and `m1-dc.log`, the Preview build log `m1-preview-build.log`, and the local logs `m1-*.log` are in `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/7d785297-1714-4261-a70a-d650039fbe62/scratchpad/`. The merged-tree copy (`m1-merged/`) and the probe script `m1-probe.cjs` are in the same folder. Nothing was written to any tracked worktree.
