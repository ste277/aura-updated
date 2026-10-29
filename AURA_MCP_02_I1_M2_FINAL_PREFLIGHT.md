# AURA-MCP-02-I1-M2: Production Reconciliation and Final Merge Preflight

- **PR:** https://github.com/ste277/aura-updated/pull/343 (`feature/aura-mcp-02-i1`)
- **Date:** 2026-11-10, about 11:58–12:10 UTC
- **Mode:** verification only

**What was not done:** no merges, pushes, source changes, PR state changes, deployments, configuration changes, OAuth work, staging or governance changes; no database access; no protection-bypass credentials. Preview checks used plain unauthenticated curl.

---

## A. Executive Summary

| | |
|---|---|
| **Overall readiness** | **Ready for controlled merge authorization** |
| **Production** | Healthy. Alias `aura-updated.vercel.app` points to `dpl_CGikLT8HSYtvLmHhAAfZ1PWjWAb7`, source `afbe520` (Palmistry #338), Ready. The build log shows "51 migrations found / No pending migrations" and the Palmistry scanner OK. `/api/health` reports `db: connected`. |
| **Merge result** | Unchanged since M1: `main` `afbe520` plus head `07a3ecd` gives tree `c5e1240`, identical to GitHub's merge-test commit `354015d`. Clean, MCP scope only, no migration. |
| **Tests** | Every required check passes on the merge ref. The only CI failure is the exact #323 baseline. Fresh local build, type check, scanner and all relevant suites pass on the exact merged tree. |
| **Security** | Remote MCP is unreachable in every deployed configuration (404 for every method). Even when enabled, the route always rejects tokens. No database in the route's module graph. No `AURA_MCP_*` variables anywhere. |
| **Governance** | **New since M1:** `main` is now protected with four required checks, all green on #343. |
| **Independent review** | APPROVE WITH NOTES. Its recommended final verdict is **GO**. No P0 or P1. |
| **Remaining (procedural, not blockers)** | (1) The PR is a draft, and marking it ready needs authorization. (2) Re-run the section I checklist immediately before merging. (3) After merging, verify the Production build log and endpoints (section G). |

---

## B. Repository Baseline

| Item | Value |
|---|---|
| `origin/main` | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` (unchanged since M1) |
| PR head | `07a3ecd30947889b09cf96b70226d9158748616b` (unchanged since M1) |
| PR base | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` |
| Merge base | `9163eeaa1ffd1d97ce8a2fb56286c6834714d557` |
| Commits (exactly the three reviewed) | `ab9d36d7af1ef47f946ec2423c815879a6ace076`, `0010435d18d31af57abe7a3ce2c8cad29f451682`, `07a3ecd30947889b09cf96b70226d9158748616b` |
| Simulated merge tree | `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b`, equal to the tree of GitHub's `refs/pull/343/merge` = `354015d8ec684fbed2c7e04292a58ef93d76fd71` (parents `afbe520`, `07a3ecd`) |
| Changed files | 21 (+1274/−355), all in MCP scope |
| State | OPEN, **draft**, `MERGEABLE`, `UNSTABLE` (because of the #323 job), auto-merge `null`, Auto-fix off |
| CI run | `42804820274`, attempt 1, on the merge ref `354015d` |
| PR Preview | `dpl_FC2k8TWcpkhxcXkMxCPM8CfGsBSQ` (source `07a3ecd`). A newer Preview, `dpl_5TJf57iLdxh75kgbYQwYUKtZFNuK`, belongs to a different branch (`feature/aura-mobile-01-m1`). |

The PR head has not changed and contains no unreviewed changes.

---

## C. Production Reconciliation

The M1 report and the AURA-PALM-01-M3 report were both accurate at their times. M1 was written while the P1001 deploy had just failed; M3's recovery came after it.

| Time (UTC) | Deployment | Source | State |
|---|---|---|---|
| ~10:41 | `dpl_FKCyndEsgUmnSbn1uWji86VEkmcd` (`ci3co628r`) | `9163eea` | Ready. Was Production at M1. |
| 11:00 | `dpl_3UywtP5qxL19qSuTs8H8MHHUF77f` (`nlwu7stjt`) | `afbe520` | **Error**: `P1001` in `prisma migrate deploy` |
| 11:24 → Ready 11:26:51 | **`dpl_CGikLT8HSYtvLmHhAAfZ1PWjWAb7`** (`godr5vu7b`, M3 recovery) | **`afbe5204ce8a17a22e3a44d3f41726753cae11f2`** | **Ready, the active Production deployment** |

**Current Production, verified 11:58 UTC:**
- **Alias assignment:** `vercel inspect aura-updated.vercel.app` resolves to `dpl_CGikLT8…`, target production, Ready. Its aliases are `aura-updated.vercel.app`, `aura-updated-aura-56a1.vercel.app` and `aura-updated-git-main-aura-56a1.vercel.app`. No newer Production deployment exists.
- **Build log:** `Cloning … (Branch: main, Commit: afbe520)`, `51 migrations found in prisma/migrations`, `No pending migrations to apply.`, `✓ Compiled successfully`, `[palmistry-bundle] OK: none of 8 Palmistry sentinels present`, `Deployment completed`.
- **GitHub deployment `7680259143`** (sha `afbe520`, Production): latest status **success** at 11:26:52Z, with the earlier failure at 11:00:38Z.
- **Runtime:** `GET https://aura-updated.vercel.app/api/health` returned `{"status":"ok","db":"connected"}` [200], and `/` returned 200.
- **MCP paths on Production:** `POST /api/mcp` and `POST /.well-known/oauth-protected-resource` return 404, as expected; that code isn't in `afbe520`.

**M3 evidence reconciled:** the original P1001 failure, the recovery redeploy, "51 migrations / no pending", the successful Next build and GitHub success status are all corroborated. No redeploy or migration was run here, and no customer data was accessed.

---

## D. Combined Merge Verification

- **Merge simulation:** clean. The tree is identical to M1's and to GitHub's merge commit, because both inputs are unchanged.
- **Nothing dropped:** in M1, a per-file comparison of added and removed lines matched the PR patch exactly (only hunk offsets differ). The inputs are identical, so this still holds.
- **Changed-file assessment:** `apps/mcp/**`, `packages/mcp-tools/**`, the three `apps/web` MCP routes, `apps/web/lib/mcpRemoteConfig.ts`, `test/mcpRemoteTransport.test.ts`, root `package.json` and `package-lock.json`, and `.github/workflows/ci.yml`.
  - **Not touched:** `apps/web/prisma/**` (no migration), `packages/palmistry/**`, `apps/web/scripts/**`, `vercel.json`, `next.config.js`, the Panchangam or Daily Rhythm engine, and the `apps/web` or `apps/mcp` lockfiles.
- **Workflow integrity:** compared with `main`, the only change is one added step ("Run remote MCP transport test") in the required "Ephemeris / panchang tests" job.
  - Still present: the Next build with type check; the Palmistry content, jsdom and Vercel-guard tests; the bundle scanner step; the `mcp-server` job; migration validation; the Day Constructor jobs.
  - No `if:` or `continue-on-error`. The job graph and runtime (`setup-node 20`) are unchanged.
- **Dependency integrity:** root exact pins `@modelcontextprotocol/server` 2.4.0 and `zod` 4.6.7. The lockfile adds only `server`, `core` and `zod`. A fresh root `npm install` left `package-lock.json` byte-identical. There is a single zod instance in the server bundle.

---

## E. Test Results

**Fresh local run** on an export of the exact merged tree `c5e1240` (session scratchpad, not a tracked worktree):

| Check | Result |
|---|---|
| Next.js production build (`npm run build`, CI placeholder env) | ✅ Compiled successfully; **types checked**; routes `ƒ /api/mcp` and both `ƒ /.well-known/oauth-protected-resource…` |
| Palmistry bundle scanner (`check-palmistry-bundle.js`) | ✅ `OK: none of 8 Palmistry sentinels present in .next/static, .next/server, .next/standalone` |
| MCP stdio (`apps/mcp`, `npm test`) | ✅ 40/40 |
| MCP remote (`test/mcpRemoteTransport.test.ts`) | ✅ 67/67 |
| Panchangam and timing | ✅ `timingSearch` 60, `timingSearchApi` 38, `ephemeris`, `panchangDay`, `windowOverlap`: all pass |
| Daily Rhythm | ✅ `timingSearchDailyRhythm`, `dailyRhythmScheduling`, `dailyRhythmOrchestratorIntegration`, `dailyRhythmCandidateCoverageIntegration`: all pass |
| Palmistry | ✅ content 220, Vercel guard 30, Explore jsdom 78: all OK |
| Migration compatibility | ✅ No migration added. `apps/web/prisma` is identical to `main`, so the post-merge `prisma migrate deploy` is a no-op. CI's migration validation job passed on the merge ref. |

**Pre-existing, unrelated:** `test/dailyRhythmSettingsWiring.test.ts` check 14 fails ("`dayConstructorOrchestrator.ts` never references `dailyRhythmWork`"). It's a DR1-era assertion that was invalidated by DR2 commit `a7d0cce` on 2026-10-14. It isn't in `ci.yml`, the PR touches neither file, and it fails identically on `main`; the independent reviewer confirmed this. Tracked as a P3 note.

**CI** (run `42804820274`, attempt 1, merge ref `354015d`, Node 20.20.2):

| Job | Required? | Result |
|---|---|---|
| Next.js production build (includes type check and Palmistry scanner) | ✅ required | success |
| MCP Server (stdio 40/40) | ✅ required | success |
| Database migration validation | ✅ required | success |
| Ephemeris / panchang tests (includes remote MCP 67/67 and Palmistry tests) | ✅ required | success |
| Day Constructor acceptance DB tests | not required | failure: **exactly** the 3 #323 `DAILY RHYTHM` signatures in `dailyGuidanceOrchestratorDb` |

- **Matches `main`:** `main`'s own run `42803840888` (`afbe520`) fails with the same 3 signatures.
- **Nothing skipped:** only the post-action cleanup step was skipped.
- **Not observed:** #340.
- **Pending:** nothing. **New failures:** none.

---

## F. Security

Tested on the merged tree's compiled routes. The enabled mode ran in a local fixture only.

| Area | Result |
|---|---|
| **Disabled by default** | With `AURA_MCP_REMOTE_ENABLED` unset, or set to `true`, `0`, `" 1"` or `yes`, or with the wrong name `AURA_REMOTE_MCP_ENABLED`: **404 for POST, GET, DELETE, PUT, PATCH, OPTIONS and HEAD** on `/api/mcp`, and for all methods on both metadata URLs. No tool executes. |
| **Authentication** | With `"1"` and valid https URLs locally, POST returns **401** with `Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="aura.planning.read"`. The deployed route hard-wires `rejectAllAccessTokens`. Synthetic principals exist only in `test/`. A client-supplied `userId` is rejected by the strict schema. |
| **Origin and methods** | A foreign Origin gets **403**. Only POST is accepted (others 405). **0 `Access-Control-*` headers** on POST, preflight-style OPTIONS and metadata. |
| **Resource limits** | 16 KB body cap (declared size and streaming), batches get 400 / −32600, `dateRange` span is 14 days or less: all asserted in the 67-check suite. |
| **Identity isolation** | Stateless: a fresh server and transport per request, no session ID, no module state. |
| **Data exposure** | Each route's `.nft.json` (29 files) has no `pg`, Prisma, `db`, `auth`, `session` or Palmistry modules. No birth profile. The only log line records the error class name, never tokens, arguments or bodies. |

---

## G. Preview and Deployment

- **Existing PR Preview** (`dpl_FC2k8…`, source `07a3ecd`): plain unauthenticated requests to all three MCP paths return **302 to Vercel SSO**. That's access protection, not application behaviour. The application-level 404 for every method was established in M1 against this same deployment ID. It wasn't re-checked here because M2 forbids protection-bypass credentials.
- **Combined-tree Vercel build:** none exists. Vercel builds branch heads, and no Vercel build of `354015d`/`c5e1240` has been made. None was created, as that would need authorization.
- **What has been verified on Vercel:**
  - The **MCP half** (`07a3ecd`, Preview Ready): Vercel resolves the new root dependencies and the `packages/mcp-tools` imports.
  - The **Palmistry half** (`afbe520`, Production Ready, scanner OK).
  - The halves share no build-relevant files.
- **Exact combined tree:** verified by CI's required Next build on `354015d` and by the local build above. The local build is not a Vercel build.
- **Still unverified on Vercel:** only Vercel-environment differences for the combined tree. The post-merge Production build **fails safe**: `vercel-build.sh` runs under `set -e`, `migrate deploy` is a no-op, and the scanner must pass. If any step fails, the deployment isn't promoted and `afbe520` keeps serving.
- **Assessment:** this gap does **not** prevent GO (the independent reviewer agrees). It is covered by the post-merge check below.

**Required post-merge verification:**
1. The Production build log shows "No pending migrations to apply" and `[palmistry-bundle] OK`.
2. `/api/health` returns 200 with `db: connected`.
3. `/api/mcp` and both metadata URLs return 404.

---

## H. Palmistry Protection

| Check | Result |
|---|---|
| `packages/palmistry/src/review-status.json` (merged tree) | `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}`. Untouched by the PR. |
| Sentinel scan | 8 of 8 excluded (local merged build, CI on the merge ref, and the live Production build) |
| Guide inaccessible | Gate closed in production builds (jsdom A10, A13). `PalmistryView` renders only when `palmistryAvailable` (`apps/web/app/page.tsx:2090`). |
| Explore cards | Only the original three while the gate is closed (A9, A14) |
| `?tab=palmistry` | `VALID_TABS` includes `palmistry` only when the gate is open (E2), and the Explore→palmistry route is gated (E3). |
| Approval introduced? | No. The PR touches no Palmistry, gate or tab file. Internal identifiers (`AppTab` type members, event names) aren't user-visible content. |

---

## I. Manual Merge Checklist

These are the five checks exactly as written in `AURA_MCP_02_I1_M1_MERGE_PREFLIGHT.md` section K. They were re-checked at 11:58–12:02 UTC and again by the independent reviewer.

| # | Requirement (M1 §K) | Evidence | Result |
|---|---|---|---|
| 1 | `origin/main` is still `afbe5204ce8a17a22e3a44d3f41726753cae11f2`. If not, rerun the merge simulation and CI review. | `git fetch` then `origin/main` = `afbe520…` | **PASS** |
| 2 | The PR head is still `07a3ecd30947889b09cf96b70226d9158748616b`. | `gh pr view` `headRefOid` | **PASS** |
| 3 | The CI run on the current merge ref has completed. Every job is green except Day Constructor, whose failures are exactly the three #323 signatures. | Run `42804820274` on `354015d` (the current merge ref, unchanged): 4 green, Day Constructor = exactly 3 #323 lines | **PASS** |
| 4 | `main`'s Production deployment is Ready on `afbe520` (P2-a). | `dpl_CGikLT8…`, source `afbe520`, Ready, aliased | **PASS** (newly satisfied since M1) |
| 5 | No `AURA_MCP_*` variable exists in any Vercel environment. | `vercel env ls` (names only) at 12:02:17Z: 0 matches for `AURA_MCP`, `AURA_REMOTE` or `MCP` | **PASS** |

**Governance:**
- `main` is **now protected**. M1 found none.
- **Required checks:** Next.js production build, MCP Server, Database migration validation, Ephemeris / panchang tests. All are green on #343.
- **Limitations:**
  - `enforce_admins=false`, so an admin can bypass the checks.
  - `strict=false`, so a branch need not be up to date with `main`.
  - 0 required reviews.
  - Day Constructor isn't required, which is consistent with #323.
- Because of these, **items 1–3 must be repeated immediately before the merge**. If `main` moves, the existing merge-ref CI no longer represents the merge.

---

## J. Independent Review

The reviewer independently verified Production, the merge tree, CI, `ci.yml`, security, Palmistry, dependencies, database safety and the checklist. It changed no files. It did run `git fetch`, which created the local-only ref `refs/remotes/review/pr343` (metadata, nothing pushed).

**Verdict: APPROVE WITH NOTES. Recommended final verdict: GO. No P0 or P1.**

| Sev | Finding | Disposition |
|---|---|---|
| P2 | No Vercel build of the exact combined tree | Not blocking. The halves don't overlap, CI's required build passed on the exact merge ref, and the Production build fails safe. Covered by the post-merge check (section G). |
| P2 | Protection allows an admin bypass (`enforce_admins=false`) and doesn't require up-to-date branches (`strict=false`) | Not blocking if checklist items 1–3 are repeated immediately before merging. The four required checks are the real gate and are green. The rule that #323 excuses only its three signatures still has to be applied by hand. |
| P3 | The PR is still a draft | Marking it ready is a PR state change that needs explicit authorization |
| P3 | Section K checklist | All 5 pass. Protection now partially closes M1's governance item. |
| P3 | `dailyRhythmSettingsWiring` check 14 | Confirmed pre-existing (DR2 `a7d0cce`), not in CI, untouched by the PR. Suggested as separate cleanup. |

**Remaining risks:** Vercel-environment differences for the combined tree (fail-safe); a transient build-time P1001 recurring on the post-merge build (availability only, since `afbe520` keeps serving); admin bypass of the required checks (procedural).

---

## K. Final Verdict

**AURA-MCP-02-I1-M2 — GO: READY FOR CONTROLLED MERGE AUTHORIZATION**

- **Production is healthy** on the M3 recovery deployment (`afbe520`).
- **The merge is verified:** the exact merge result is clean, MCP-only and adds no migration.
- **Checks pass:** every required CI check and all local builds, tests and scanners pass. The only failure is the exact #323 baseline.
- **Remote MCP is unreachable** in every deployed configuration.
- **Palmistry stays locked.**
- **The checklist passes:** all five M1 checks pass, and `main` now has enforced required checks.
- **No P0 or P1** findings remain.

## L. Next Authorization

**AURA-MCP-02-I1-M3: Controlled Merge of PR #343.** It would need explicit authorization for:
1. marking PR #343 ready for review;
2. re-running checklist items 1–3 immediately beforehand, and stopping if `main` or the head has moved;
3. squash-merging as `AURA: MCP-02-I1 - Remote MCP transport foundation (#343)`;
4. post-merge verification: Production build log "No pending migrations" and `[palmistry-bundle] OK`, `/api/health` 200, the three MCP paths 404, and no `AURA_MCP_*` variables.

No flag enabling, OAuth or I1.5/I2 work is included. **Not executed.**

---

### Evidence locations (session scratchpad, untracked)

All in `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/7d785297-1714-4261-a70a-d650039fbe62/scratchpad/`: the merged-tree export `m2-merged/`, the local logs `m2-*.log`, the probe script `m1-probe.cjs`, and M1's CI and Preview logs (`m1-job-*.log`, `m1-dc.log`, `m1-preview-build.log`).
