# AURA-GOV-02-D1: CI-Gated Production Deployment, Feasibility & Design

**Repository:** `ste277/aura-updated` · **Date:** 2026-11-10 · **Mode:** read-only audit and design. Nothing was implemented.

---

## 1. Executive summary

**Problem.** Vercel builds every push to `main` and serves it to Production immediately.
- The build runs **`prisma migrate deploy` against the Production database** before `next build`.
- So a merged commit both changes the Production schema and receives user traffic before its post-merge CI finishes.
- Example: #343 (`e921f54`) was serving Production at 12:10Z, while its post-merge Ephemeris job only finished at 12:15Z.

**Recommendation: Option C, build first and promote after CI, with migrations moved out of the build.**
1. Turn off automatic assignment of production domains in Vercel. Pushes to `main` still build, but only as a *staged* deployment that receives no traffic.
2. Add a `promote-production` job to `ci.yml`. It runs only on `push` to `main` and `needs` all four required jobs.
3. Before promoting, the job:
   - re-verifies the exact SHA and its four check runs from GitHub Actions;
   - refuses anything that isn't the current `main` HEAD;
   - runs migrations;
   - promotes the exact staged deployment built from that SHA;
   - health-checks it.

**Why not the alternatives:**
- **Option A (Vercel Deployment Checks)** gates promotion but still runs migrations before checks pass. Its availability on Hobby isn't documented.
- **Option B (build and deploy from Actions)** puts every Production secret into CI, which widens exposure.

**Platform fit.** Staged production deployments and `vercel promote` are documented for **all plans**, which includes this project's Hobby plan.

**Separate finding (P1, outside this design).** The Vercel project now has an **automation protection-bypass secret**, created 2026-11-10T11:13:53Z.
- The secret revoked during PALM-01-P3 was a different one.
- The timing matches another session's use of `vercel curl` (MCP-02-I1 M1 preflight), which creates such secrets silently.
- During this audit the project read-back printed its value into local tool output. It has been redacted from the saved evidence and is not reproduced here.
- Revoking it needs your authorization.

**Verdict: DESIGN REVISION REQUIRED.** The independent review endorsed Option C as the direction but raised **five P1 blockers**, R-1 to R-5 in §12, which I verified:
- the repo has a **write collaborator** (`Greenaroz`), so the "single owner" trust model is wrong;
- an incident rollback can be undone by re-running CI;
- the cutover order ships code before its migrations;
- matching deployments by SHA alone also matches CLI deployments;
- **Production database credentials are also targeted at Preview builds**, so migrations aren't fully gated today.

Two of these need your decisions (R-1, R-5). The rest are design-text fixes, listed in §12.

## 2. Baseline (2026-11-10T12:57Z, read-only)

| Item | Value |
|---|---|
| Repository | `ste277/aura-updated` (public) |
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b` |
| Difference from the GOV-01 report | `main` moved from `afbe520` to `e921f54` (#343, merged by the owner at 12:08:49Z) |
| Primary checkout | branch `main` at `f35d35a`, 47 commits behind `origin/main`. Untracked reports preserved, including GOV-01, M3, MCP-02 M1/M2/M4 and PALM-01 D1/P5. Nothing was modified. |
| Worktrees | about 120 under `.claude/worktrees/`. All untouched. |
| Branch protection | 4 required checks: `Next.js production build`, `MCP Server`, `Database migration validation`, `Ephemeris / panchang tests`, all at app 15368 (GitHub Actions). `strict=false`, `enforce_admins=false`, 0 approvals, no force pushes or deletions. Rulesets: none. Unchanged since GOV-01. |
| GitHub environments | `Preview` and `Production`, created by the Vercel integration. Neither has protection rules or a branch policy. |
| GitHub Actions | one workflow (`CI`); default token permission `read`; Actions can't approve PRs; no repository Actions secrets |
| Vercel team / plan | `aura-56a1`, **Hobby** |
| Vercel project | `aura-updated`, root `apps/web`, Git `ste277/aura-updated`, production branch `main`, `gitProviderOptions.createDeployments=enabled`, **`autoAssignCustomDomains=true`**, `productionDeploymentsFastLane=true`, SSO `all_except_custom_domains`, no deploy hooks. `apps/web/vercel.json` holds only one cron (`/api/internal/reminders/dispatch`, daily). |
| Current Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` (`e921f54`), created by the Git push at 12:08:52Z; GitHub deployment 7681668466 at 12:10:01Z (`vercel[bot]`) |
| Post-merge CI for `e921f54` | run 42813270945, finished 12:20:20Z. All 4 required checks passed; Day Constructor failed (#323). |
| Remote MCP | disabled. No `AURA_MCP_*` variables exist in Vercel; `lib/mcpRemoteConfig.ts` needs `AURA_MCP_REMOTE_ENABLED === "1"`. Live `GET` and `POST` to `/api/mcp` and `/.well-known/oauth-protected-resource/api/mcp` return 404. |
| Palmistry | `review-status.json` on `e921f54` = `{"status":"PENDING_HUMAN_REVIEW","approvedBy":null}`. Build exclusion and scanner still wired into `vercel-build.sh`. |
| Deployment protection | `protectionBypass` has **1 automation-bypass entry** (created 11:13:53Z, `isEnvVar: true`). See §12, finding F-1. |

## 3. Current deployment flow

```
merge to main ──► GitHub push event ──┬─► GitHub Actions CI (5 jobs, ~10-15 min)
                                      └─► Vercel Git integration (immediately)
                                            build: npm install
                                            vercel-build.sh:
                                              VERCEL_ENV=production → prisma migrate deploy   ← Production DB changed
                                              next build
                                              check-palmistry-bundle.js (fail-closed)
                                            READY → production domains auto-assigned        ← traffic switches
```

The two branches are independent. Nothing connects the Vercel deployment to the CI result.

## 4. Root cause of the gap

1. `autoAssignCustomDomains=true`: every successful `main` build is promoted straight away.
2. The Vercel Git integration doesn't consult GitHub checks, and no Deployment Checks are configured.
3. Migrations run inside the Production build, so even a deployment that is never promoted has already changed the Production database.
4. GOV-01 gates the *merge* on PR CI, which runs against the merge ref. `strict=false` lets that merge ref go stale, so the commit that lands on `main` may never have been tested.

## 5. Verified platform capabilities

Sources: the Vercel docs pages listed, read 2026-11-10, plus this project's configuration. Labels: **[DOC]** documented; **[CFG]** observed in project config; **[ASSUMPTION]** not documented, needs a test before relying on it.

| Capability | Status |
|---|---|
| Deployment Checks hold *promotion*, not the build: "Production deployments will still be created, but will not be automatically assigned" | [DOC] vercel.com/docs/deployment-checks |
| The build (including migrations) runs before Deployment Checks are evaluated | [DOC] ordering on the same page |
| Deployment Checks select GitHub checks by **name** (any GitHub Check or status, not only Actions); renaming a job breaks the check | [DOC] |
| Deployment Checks require automatic production aliasing to be **on** | [DOC] |
| Deployment Checks can be skipped with **Force Promote** | [DOC] |
| Deployment Checks: behaviour on a failed or never-finishing check | not stated |
| Deployment Checks on Hobby | **not stated** (no row in the Hobby plan table) |
| Deployment Checks match a push-triggered check to the exact deployment SHA | not stated (stated only for `repository_dispatch`) |
| Staged production: turning off "Auto-assign Custom Production Domains" means deployments "won't automatically be served" | [DOC] vercel.com/docs/deployments/promoting-a-deployment |
| Staged production workflow available on **all plans** | [DOC] vercel.com/docs/deployments/environments |
| `vercel promote <id>` assigns production domains **without rebuilding** | [DOC] |
| A deployment that was already promoted can't be promoted again | Docs wording reported, but it conflicts with Instant Rollback and re-promotion behaviour. **Treated as [ASSUMPTION]**; not relied on (R-2, R-9). |
| Staged production builds use **production** environment variables | [DOC] |
| `vercel --prod --skip-domain` creates a staged deployment and overrides the project setting | [DOC] vercel.com/docs/cli/deploy |
| Instant Rollback on Hobby: only to the immediately previous deployment. Rollback turns off auto-assignment until the next promote. | [DOC] vercel.com/docs/instant-rollback |
| A new promotion supersedes one still in progress | [DOC] |
| Hobby: 1 concurrent build, queued first-in-first-out; "Prioritize production builds" available on all plans | [DOC] vercel.com/docs/builds/managing-builds |
| `git.deploymentEnabled` per-branch disable (`{"main": false}`) | [DOC] vercel.com/docs/project-configuration/git-configuration |
| Actions deploy pattern: `vercel pull` / `vercel build --prod` / `vercel deploy --prebuilt --prod`; build runs in the runner; system env vars unavailable at build time with `--prebuilt` | [DOC] Vercel KB guide |
| Tokens scoped to a single project (`vercel tokens add --project`) | [DOC, KB only]. Fine-grained scopes not verified (the tokens page returned 404). |
| GitHub environment secrets are released only to jobs that reference the environment, and can be limited to `main` by a deployment-branch policy | [DOC] GitHub Actions environments (standard behaviour; the environments in this repo currently have no policy) |
| A plain `vercel --prod` (without `--skip-domain`) also stays staged when auto-assign is off | **[ASSUMPTION]**: test in Phase T |
| The Vercel API lists deployments filtered by `meta-githubCommitSha` | **[ASSUMPTION]**: fall back to listing and filtering on `meta.githubCommitSha` client-side, which was observed in this project's API output |

## 6. Option comparison

### Option A: Vercel Deployment Checks
Keep auto-deploy. Configure Deployment Checks to require the four GitHub check names before Vercel aliases the deployment.
- **For:** native, minimal code.
- **Against:**
  - Migrations still run before checks.
  - Hobby availability isn't documented.
  - Checks match by **name only**, with no app binding, so any GitHub App or commit status with that name could satisfy them.
  - SHA matching for push events isn't documented.
  - Behaviour on failure or a pending check isn't documented.
  - Force Promote is an ungoverned bypass.

### Option B: GitHub Actions builds and deploys
Disable Git deploys for `main` (`git.deploymentEnabled: {"main": false}`). After the four checks pass, a job runs `vercel pull/build --prod` and `deploy --prebuilt --prod`.
- **For:** exact SHA by construction; CI fully controls timing.
- **Against:**
  - The runner needs **every** Production secret (`vercel pull --environment=production` downloads all non-sensitive Production variables, and the build needs `DATABASE_URL`).
  - The Production build stops happening on Vercel's infrastructure.
  - System environment variables are unavailable with `--prebuilt`.
  - It changes the build environment the Palmistry scanner was verified in.
  - It also changes Preview behaviour if `deploymentEnabled` is misconfigured.

### Option C: build first, promote after CI (recommended)
Turn off auto-assign. Vercel keeps building `main` with Production variables, but as a **staged** deployment. A post-merge job runs migrations and `vercel promote` once all four checks pass for the same SHA.
- **For:**
  - Documented for all plans.
  - The build environment is unchanged, so the Palmistry exclusion and scanner run exactly as today.
  - Promote doesn't rebuild, so the artifact that is promoted is the one that was built.
  - The runner needs only a project-scoped Vercel token and a migration database credential.
  - Previews are untouched.
- **Against:**
  - Migrations must move out of `vercel-build.sh`.
  - A staged build may still run prerender-time database reads (for example the `/api/health` `SELECT 1`) against the *old* schema. That is harmless for additive migrations (see §9).

### Comparison matrix

| Criterion | A. Native Vercel controls | B. GitHub-controlled deployment | C. Build and promote |
|---|---|---|---|
| Exact SHA enforcement | Not documented for push events | Yes, by construction | Yes: the job looks up the deployment whose `meta.githubCommitSha` equals `github.sha` and promotes that exact ID |
| Post-merge CI gating | Yes, for promotion [DOC] | Yes | Yes (`needs:` on all 4 jobs plus an API re-check) |
| Prevents premature Production traffic | Yes [DOC] | Yes | Yes [DOC: staged deployments not served] |
| Prevents premature Production *migrations* | **No** [DOC: build runs first] | Yes (migrate step after checks) | Yes (migrations moved to the promote job) |
| Race handling | Vercel promotes "most recent successful" build; check ordering not documented | Needs a concurrency group and a HEAD check | Concurrency group, HEAD check, and an ancestor check against the live deployment |
| Check-origin trust | Name only, so a spoofable status context is possible | Job graph inside one workflow | Job graph, plus an API re-check requiring app 15368 |
| Rollback simplicity | Instant Rollback (Hobby: previous deployment only) | Same, plus redeploy | Same. Previous deployment stays live until promotion, so most failures need no rollback. |
| Secret exposure risk | Lowest (no CI secrets) | **Highest** (all Production variables in CI) | Medium: two secrets in a branch-restricted environment |
| Database migration safety | Unchanged (migrations before the gate) | Good | Good; needs an additive-migration rule |
| Preview impact | None | Risk if `deploymentEnabled` is misapplied | None |
| Cost / plan | Hobby availability **not stated** | Hobby OK; Actions minutes free (public repo) | Hobby OK [DOC "All plans"]; Actions minutes free (public repo) |
| Operational complexity | Low | High | Medium |

**Recommended: C.** It is the only option that is documented for Hobby, gates both traffic *and* migrations, keeps the verified Vercel build environment, and limits CI secrets to two.

## 7. Recommended architecture (Option C)

```
merge to main ─► push ─┬─► Vercel Git build (Production env vars, NO migrations) ─► READY, STAGED (no traffic)
                       │
                       └─► CI on push:
                             web-build ─┐
                             mcp-server ├─(needs, all must succeed)─► promote-production
                             db-migr.   │      environment: production-promote (branch policy: main only)
                             math-core ─┘      concurrency: production-promote, cancel-in-progress: false
                             day-constructor (not in needs; non-blocking until #323/#340 are fixed)

promote-production:
  1. HEAD check: refuse unless github.sha == current refs/heads/main (a newer commit will promote itself)
  2. Check re-verification via REST: for github.sha, the 4 check runs named exactly as required,
     app.id == 15368, status completed, conclusion success, latest run per name, check suite from this workflow
  3. Find the Vercel deployment: target=production, meta.githubCommitSha == github.sha, readyState READY,
     not yet promoted; wait (bounded, e.g. 20 min) for it to become READY; exactly one match, else fail
  4. Ancestor check: the live production deployment's SHA must be an ancestor of github.sha
     (never promote an older commit over a newer one)
  5. Migrations: npx prisma migrate deploy  (secret PROD_MIGRATION_DATABASE_URL)
  6. Re-run step 1 (main still == github.sha); then: vercel promote <deploymentId>
  7. Verify: project targets.production == deploymentId; GET https://aura-updated.vercel.app/ serves
     data-deployment-id == deploymentId; dynamic DB probe 200; Palmistry sentinel scan of served chunks == 0;
     /api/mcp == 404
  8. Write the job summary (SHA, deployment id, migrations applied, checks) as the audit trail
```

## 8. Exact-commit and CI verification model

- **Same SHA everywhere:** `github.sha` of the push event = commit the four jobs ran on = `meta.githubCommitSha` of the deployment that is promoted. Step 3 fails if zero or more than one deployment matches.
- **Complete checks:** the `needs:` graph already requires `success`. Step 2 independently rejects `pending`, `skipped`, `cancelled`, `timed_out`, `neutral`, `action_required`, `failure` and missing checks.
- **Trusted origin:**
  - The check runs must come from GitHub Actions (app 15368). A third-party App or commit status with the same name can't pass.
  - A PR that edits `ci.yml` only affects the *post-merge* run once merged. That merged content is protected only by GOV-01 PR checks and owner review (0 approvals). This residual risk is accepted, the same as GOV-01. The follow-up is CODEOWNERS on `.github/workflows/**` and `apps/web/scripts/**` if more maintainers join.
- **Fork and PR isolation:**
  - `promote-production` has `if: github.event_name == 'push' && github.ref == 'refs/heads/main'`.
  - The environment's deployment-branch policy is `main` only, so PR runs can't access its secrets even if the condition were removed in a PR.
- **Races:**
  - The concurrency group serialises promotions.
  - The HEAD check in steps 1 and 6 skips superseded commits. If A then B land, A's job exits *neutral* ("superseded by B") and B's job applies both migrations and promotes B.
  - The ancestor check stops out-of-order promotion.
  - Vercel itself: "a new promotion supersedes one in progress" [DOC].
- **Bypass paths and controls:**

| Path | Control |
|---|---|
| Git push to `main` | Builds a staged deployment only (auto-assign off) |
| `vercel --prod` from a laptop | Should be staged when auto-assign is off **[ASSUMPTION, test T5]**. Policy: `--skip-domain` is mandatory. |
| `vercel promote` / Instant Rollback / dashboard Promote | Admin-only (Hobby: single owner). Documented as the emergency path (§10). |
| A second workflow promoting | Only the `production-promote` environment holds `VERCEL_PROMOTE_TOKEN` |
| Automation-bypass secret | Grants *access* to protected deployments, not promotion. Revoke anyway (F-1). |

## 9. Migration and secret safety

**Migrations:**
- Today they run at Vercel build time against Production, before any check (they already did for #338 and #343).
- In the design they run **only** in `promote-production`, after all four checks, immediately before promotion.
- `prisma migrate deploy` holds an advisory lock, so concurrent runs are serialised; the concurrency group prevents them anyway.
- **Expand/contract rule (new policy):** a migration must stay compatible with the *previously live* code, because the old deployment keeps serving between migration and promotion, and stays live if promotion fails. Destructive changes (drop or rename a column) need two releases. This is already implicitly required today, because the old deployment serves while the new build runs.
- The staged build itself never migrates. `vercel-build.sh` keeps `next build` and the Palmistry scanner.
- **Build-time database reads.** The staged build may prerender pages that read the database, for example `/api/health` `SELECT 1`. With additive migrations these reads succeed against the old schema. If a prerender needs the *new* schema, the build fails safely and nothing is promoted. Rule: prerendered pages must not depend on new columns.

**Secrets** (names only; all in GitHub environment `production-promote`, branch policy `main`):
- `VERCEL_PROMOTE_TOKEN`: Vercel token scoped to project `aura-updated` (KB: `vercel tokens add --project`; fine-grained permissions not verified).
- `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`: identifiers, not secret.
- `PROD_MIGRATION_DATABASE_URL`: preferably a dedicated Neon role with DDL rights on `neondb`, separate from the app's `DATABASE_URL`.

**What stays protected:**
- No *new* Production secret reaches PR workflows or forks (`gitForkProtection=true`; no `pull_request_target`).
- **Correction (R-5, verified):** this does **not** hold for Preview deployments today.
  - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `POSTGRES_URL` and `POSTGRES_PRISMA_URL` (sensitive) are targeted at **both preview and production**.
  - Preview builds skip migrations only because of the `VERCEL_ENV` guard in `vercel-build.sh`. Any same-repo branch can edit that guard, so its Preview build could run SQL against the Production database before review or CI.
  - A separate Preview database (or an explicit owner-accepted residual risk) is therefore a **prerequisite** for the claim that migrations are gated.

## 10. Failure, rollback and emergency procedures

**Production stays on its previous healthy deployment whenever any of these is true:**
- one of the four checks isn't `success`;
- the HEAD, ancestor or SHA match fails;
- the staged deployment isn't READY within the timeout;
- migrations fail;
- `vercel promote` fails.

In all of these cases no promotion happens.

| Scenario | Behaviour |
|---|---|
| A required check fails | `needs:` stops the job (skipped); the staged deployment stays unpromoted; Production unchanged. Fix forward with a new PR. |
| A required check never starts or hangs | The job never runs; Production unchanged. Alert: GOV-01 status plus a job-timeout notification. Re-run CI. |
| GitHub Actions down | No promotion; Production unchanged. Emergency path only if a security fix is urgent. |
| Vercel down | No build or promote; Production unchanged (Vercel serving availability is independent). Re-run the job when it recovers. |
| Promoted, but post-promote health check fails | Job fails loudly. **Rollback (manual, authorized):** Instant Rollback to the previous deployment (Hobby: immediate predecessor only) [DOC]. Rollback turns off auto-assign, which is already off in this design. |
| Migration succeeds, promotion fails | Old code keeps running on the migrated schema (safe by the expand/contract rule). Re-run the job; `migrate deploy` is idempotent and the promote is retried. |
| Newer commit arrives while an older one waits | The older job exits neutral at the HEAD check; the newer job promotes. |
| Out-of-sequence manual promotion | The next job's ancestor check reports a mismatch and fails, asking for an operator decision. Policy forbids manual promotion outside §10. |
| Emergency security fix | See below |

**Emergency bypass procedure:**
1. Explicit written authorization from the owner (an issue titled `EMERGENCY-DEPLOY: <sha>`), giving the justification and the checks being bypassed.
2. Run `vercel promote <deploymentId>` on the exact staged deployment for that SHA, or let the job run if CI finishes in time.
3. Run migrations manually only if the fix needs them, with the same credential and logged in the issue.
4. Retrospective independent review and follow-up issue within 48 h.

GOV-01's `enforce_admins=false` remains the matching merge-side escape hatch. Neither is weakened.

## 11. Implementation and cutover plan (future ticket, not executed)

**Files and settings that would change:**

| Change | Approval needed |
|---|---|
| `.github/workflows/ci.yml`: add the `promote-production` job (§7), `permissions: contents: read, checks: read, deployments: read`, a concurrency group, `environment: production-promote`. The four existing jobs are unchanged, so GOV-01 check names are preserved. | PR review |
| `apps/web/scripts/vercel-build.sh`: remove the `prisma migrate deploy` block; keep `next build` and the scanner. Update `test/palm01P4VercelGuard.test.ts` for the new script (it currently asserts migration-before-build ordering). | PR review |
| New `scripts/promote-production.sh` (or an inline step) implementing steps 1–8, plus its unit tests (pure functions for check and SHA matching). | PR review |
| GitHub: create environment `production-promote` with branch policy `main`; add the three secrets. Optional: a required reviewer on the environment as a manual gate (free for public repos). | **Your approval (settings and secrets)** |
| Vercel: create a project-scoped token; set **Auto-assign Custom Production Domains = off**. ("Prioritize production builds" is already on: `productionDeploymentsFastLane=true`.) | **Your approval (Production settings)** |
| Neon: create a dedicated migration role (optional but recommended). | **Your approval** |
| Revoke the automation-bypass secret (F-1). | **Your approval** |

**Test plan (no Production impact):**
- **T1.** Unit tests for check-run filtering: app id, latest attempt, every non-success conclusion, a missing check, a duplicate name from another app.
- **T2.** A disposable Vercel project (Hobby allows several) connected to a disposable fork or branch, with a disposable Neon branch. Run the full flow: staged build, CI, promote, verify. **Needs approval**, because it creates infrastructure.
- **T3.** Race test on the disposable project: two quick pushes. Expect A to exit neutral and B to promote, with no older-over-newer promotion.
- **T4.** Failure injection: a failing required check, a migration failure, a deployment-not-READY timeout, a health-check failure. Expect no promotion, or a documented rollback.
- **T5.** Verify the **[ASSUMPTION]**s: a plain `vercel --prod` stays staged with auto-assign off, and the deployment-list SHA filter works.
- **T6.** Confirm PR Previews are unchanged and receive no environment secrets (inspect run logs and the environment access log).

> **Superseded: see R-3 in §12.** The order below opens a code-before-migration window. The revised order is: merge freeze → auto-assign off while the build still migrates → merge the job and script PR, which its own job promotes → lift the freeze.

**Cutover as originally drafted (do not use):**
1. Merge the PR containing the job and the `vercel-build.sh` change while auto-assign is **still on**. That merge deploys the old way one last time, but already without build-time migrations. Its `promote-production` job finds the deployment already live and exits as a no-op. Run `prisma migrate status` before merging to confirm nothing is pending.
2. Turn auto-assign off (your approval).
3. Make a trivial docs-only commit to `main` through a PR. Observe: staged build, CI, promote, verify. If promotion fails, Production simply stays on step 1's deployment.
4. Record the evidence and close.

**Rollback of the cutover:** turn auto-assign back on and restore the migration block via PR. Both need authorization.

## 12. Independent review findings

**Reviewer:** an independent read-only reviewer subagent. It ran `git` reads, `gh api` GETs, and field-filtered `vercel api` GETs. It edited nothing and never printed the secret.

**Verdict: REQUEST CHANGES.** It endorses Option C over A and B. Five P1 blockers. I verified the facts behind R-1 and R-5 directly.

| ID | Sev | Finding | Required revision |
|---|---|---|---|
| R-1 | **P1** | The repo has a **write collaborator, `Greenaroz`** (verified with `GET /collaborators`). With 0 required approvals, a write user can merge a PR that edits `ci.yml` or adds a `push: main` workflow using `environment: production-promote`. The `main` branch policy doesn't stop that, so the Vercel token and migration credential could be exfiltrated. This also corrects GOV-01's "sole maintainer" assumption. | **Owner decision:** reduce the collaborator's access, **or** make a required reviewer (the owner) mandatory on `production-promote` **and** add CODEOWNERS with required code-owner review for `.github/workflows/**`, `apps/web/scripts/**` and `apps/web/prisma/migrations/**`. |
| R-2 | **P1** | After an Instant Rollback from B to A, re-running B's CI passes the HEAD and ancestor checks and promotes B again. | Add a promotion freeze (repo variable `PRODUCTION_PROMOTION_FROZEN`, checked in steps 1 and 6), set by the rollback procedure. Reject any deployment that was ever production, judged from Vercel history. The required reviewer also covers this. |
| R-3 | **P1** | The cutover removes build-time migrations while auto-assign is still on, so any merge in that window ships code before its migration. The step-1 "no-op" also contradicts the "not yet promoted" match. | Reverse the order (see the §11 note) under an explicit merge freeze. Define an already-live deployment as an explicit success no-op. |
| R-4 | **P1** | Matching on `meta.githubCommitSha` alone also matches **CLI** deployments. This happened today: `dpl_CGik…` (`source=cli`, sha afbe520) during the M3 recovery. | Require `source == "git"`, the matching repo, no `gitDirty`, and `target == production`. Count matches across all states before filtering on READY. Fail if any non-git production deployment exists for that SHA. |
| R-5 | **P1** | Production database credentials are targeted at Preview builds (verified), so a branch can bypass the `VERCEL_ENV` guard. The claim that migrations are gated doesn't hold today. | **Owner decision:** a separate Preview database (prerequisite), or explicitly accepted residual risk tracked in its own ticket. §9 corrected. |
| R-6 | P2 | `/api/health` is prerendered (static) and its catch bakes a 503 into the build, so it isn't a live probe and doesn't fail the build. | Make it `force-dynamic`, or use the `/moment/<token>`-style dynamic probe. Add a test that no prerendered route reads the database. |
| R-7 | P2 | The step 2 re-check isn't tied to this run; a SHA can carry PR-run check runs. | Verify through `/actions/runs/{run_id}/attempts/{attempt}/jobs` (event `push`). |
| R-8 | P2 | Promote-job hygiene not specified. | Secrets as step-level env only; `npm ci --ignore-scripts` before secrets; pinned `vercel` and `prisma` versions; top-level `permissions:` in `ci.yml`; forbid `pull_request_target`, `workflow_run` and `workflow_dispatch` from using the environment; document what the project token can do (it can read `protectionBypass`). |
| R-9 | P2 | The "can't re-promote" [DOC] claim is doubtful. | Re-labelled [ASSUMPTION] in §5; not relied on. |
| R-10 | P2 | Conflicts with MCP-02-I1.5-C, where staging migrations and the database-identity guard live in `vercel-build.sh`. | Staging gets its own migrate-and-promote job. Move the identity guard into a shared migration script. Cross-reference both designs. |
| R-11 | P2 | `vercel --prod` staying staged is unverified, and CLI production deploys happen in practice. | Make T5 a hard gate before turning auto-assign off. The emergency procedure uses `--skip-domain` then promote. Agent tickets ban `vercel --prod` and `vercel curl`. |
| R-12 | P3 | "Prioritize production builds" is already on. | Fixed in §11. |
| R-13 | P3 | GitHub jobs have no "neutral" conclusion. | Use success plus a summary notice. |
| R-14 | P3 | The emergency procedure's order and where the credential lives aren't stated. | Migrate first, then promote; name the credential's location. |
| R-15 | P3 | The READY timeout under the Hobby single-build queue, and what "previous" means for rollback when staged deployments sit in between. | Add to T3 and T4. |
| R-16 | P3 | `palm01P4VercelGuard` A7 and B13 assert migrate before build. | Invert them; add checks on the promote job's shape. |
| R-17 | P3 | The F-1 secret is `isEnvVar: true`, so it's injected into every deployment, Preview branches included. | Raises the urgency of revoking F-1. |

**Read-only confirmed by the reviewer:**
- Branch protection is unchanged.
- Environments still have no rules.
- `origin/main` is still `e921f54`, and Production is `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`.
- No deployments were created after 12:57Z.
- F-1 exists: 1 automation-bypass entry, created 11:13:53.871Z.

**Audit finding F-1 (P1, outside the design scope).**
- **What:** Vercel project `protectionBypass` contains an `automation-bypass` secret created 2026-11-10T11:13:53Z by the owner account (`isEnvVar: true`).
- **Likely cause:** `vercel curl`, which creates these silently (seen in PALM-01-P3). The MCP-02-I1 M1 preflight report, finished 11:23:44Z, states its requests were made "via `vercel curl`".
- **Exposure:** the value appeared in this audit's local tool output. It is redacted from saved evidence and has not been shared further.
- **Effect:** anyone holding it can reach SSO-protected deployments (Preview and `*.vercel.app` URLs). It cannot promote or deploy.
- **Recommendation:** revoke it (needs authorization), and ban `vercel curl` in ticket boundaries.

## 13. Scope compliance

- **Not changed:** GitHub Actions, branch protection, repository settings, Vercel settings, environment variables, credentials or the database.
- **Not done:** no deployments created, promoted or rolled back; no code changes; no commits, pushes, merges or branch deletions; no change to the primary checkout or untracked reports; remote MCP not enabled; Palmistry not published; no staging work; MCP-02-I2 not started.
- **What I did:**
  - read-only `gh api` GETs and `vercel api` GETs;
  - unauthenticated GETs/POSTs to the public MCP paths (404);
  - documentation reads.
- **Exposure:** the read of `/v9/projects/<id>` exposed the bypass secret's value in local tool output (F-1). It was redacted from saved files.

## 14. Final verdict

**AURA-GOV-02-D1: DESIGN REVISION REQUIRED**

Option C is feasible on Hobby and is the recommended direction. Five P1 findings (R-1 to R-5) are unresolved, and two of them depend on owner decisions, so the design isn't ready for implementation review.

## 15. Next required authorization

These are owner decisions; none is executed here:
1. **R-1:** reduce `Greenaroz`'s access, **or** require owner review via CODEOWNERS on workflows, scripts and migrations, plus a mandatory required reviewer on the future `production-promote` environment.
2. **R-5:** provision a separate Preview database (preferred), **or** formally accept and track the risk that Preview builds hold Production database credentials.
3. **F-1: RESOLVED.** The owner authorized revocation after D1.
   - Revoked with `PATCH /v1/projects/<id>/protection-bypass` (`revoke`, `regenerate: false`). The value was piped directly and never printed.
   - Verified: 0 bypass entries remain; no `VERCEL_AUTOMATION_BYPASS_SECRET` in the project env list.
   - SSO protection is unchanged (`all_except_custom_domains`; the protected `*.vercel.app` alias returns 302). Production `aura-updated.vercel.app` still returns 200.
   - No other setting was touched.
4. Then authorize **AURA-GOV-02-D2**: revise this design for R-1 to R-17, then re-review. Implementation and T2 test infrastructure remain unauthorized until D2 passes.
