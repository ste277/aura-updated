# AURA-GOV-02-D2: Security & CI-Gated Production Deployment Design (Revision)

**Repository:** `ste277/aura-updated` · **Date:** 2026-11-10 · **Mode:** read-only investigation and design. Nothing was implemented, provisioned or reconfigured.

**Evidence labels:**
- **[CFG]:** observed in live configuration today.
- **[DOC-GH] / [DOC-V]:** stated in GitHub or Vercel documentation (quotes verified by a documentation-reading subagent).
- **[ASSUMPTION]:** not documented; must be proven by the named test before it is relied on.

---

## 1. Executive summary

The D1 architecture is revised in four main ways:
- **Credentials:** they live only in an **owner-gated GitHub environment**, and every Production promotion waits for the owner's approval in GitHub. GitHub enforces this at runtime, independent of code review.
- **Code review:** an **owner-approval ruleset** on `main` (1 required approval, stale-approval dismissal, last-push approval) plus `CODEOWNERS * @ste277` stops a write collaborator from merging anything unreviewed. Because the Vercel Production build has Production credentials, every file under `apps/web` counts as credential-bearing.
- **Preview isolation:** Preview gets its **own Neon project**, its own credentials and email key, and a **database identity guard** that fails closed.
- **Promotion and migrations:** staged Vercel builds are promoted only after the exact merged SHA passes all four checks, with migrations applied in the gated job and a strict trust contract for the deployment.

The cutover is reordered so that automatic go-live is turned off *before* migrations move out of the build, under a merge freeze.

**Every D1 P1 has a design resolution (§3).** Some resolutions depend on platform behaviour that isn't documented. Those are listed as **[ASSUMPTION]**s with mandatory proof tests, and each has a fail-closed fallback.

The verdict is in the decision report and §16.

## 2. Baseline (2026-11-10T13:21Z, read-only)

| Item | Value |
|---|---|
| Repository | `ste277/aura-updated`, **public**, owned by personal account `ste277` (User) |
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a…`. Unchanged since D1. |
| Local state | Primary checkout `main` at `f35d35a` (47 commits behind), 25 untracked files preserved, 1 stash preserved, 118 worktrees preserved. Nothing modified. |
| Collaborators | `ste277` (admin), **`Greenaroz` (write)**; no pending invitations [CFG] |
| Branch protection | Classic rule on `main`: 4 required checks (`Next.js production build`, `MCP Server`, `Database migration validation`, `Ephemeris / panchang tests`, all at app 15368), 0 approvals, `strict=false`, `enforce_admins=false`, no force pushes or deletions. **No rulesets. No CODEOWNERS file.** [CFG] |
| GitHub environments | `Preview` and `Production` (auto-created by Vercel). No protection rules. No repo or environment Actions secrets. [CFG] |
| Actions | One workflow, `CI`; default token permission `read`; no top-level `permissions:` in `ci.yml` |
| Vercel | Team `aura-56a1` (Hobby); project `aura-updated`, `link.repoId 1331993685`, production branch `main`, `autoAssignCustomDomains=true`, `productionDeploymentsFastLane=true`, SSO `all_except_custom_domains`, `gitForkProtection=true`, no Ignored Build Step, `lastRollbackTarget=null`; no team-level shared environment variables; Neon marketplace integration installed for the account (`projectSelection: selected`, linked projects `[]`) |
| **F-1** | **Confirmed resolved:** `protectionBypass` has 0 entries, and there is no `VERCEL_AUTOMATION_BYPASS_SECRET` variable [CFG] |
| Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, `source=git`, `readySubstate=PROMOTED`, SHA `e921f54`; public domain returns 200 |
| Remote MCP | Disabled: no `AURA_MCP_*` variables, and `/api/mcp` returns 404 for GET and POST |
| Palmistry | `review-status.json` = `PENDING_HUMAN_REVIEW` on `e921f54`; exclusion and scanner wired in |

### 2.1 Environment-variable inventory (names, scopes and types only)

| Variable | Scope today | Referenced by code? | Target classification |
|---|---|---|---|
| `DATABASE_URL` | preview + production (sensitive) | yes (runtime pool and Prisma) | **Split:** Production-only value, plus a new Preview-only value (Preview Neon project) |
| `AUTH_SECRET` | separate preview and production values | yes | Already split. Keep. |
| `RESEND_API_KEY` | preview + production | yes | **Split:** Production-only, plus a new restricted Preview key (or unset; owner choice §7.3) |
| `RESEND_FROM_ADDRESS` | production + preview (encrypted) | yes | Safe shared non-secret, but set per environment so Preview can use a distinct sender |
| `AURA_SHADOW_POLICY_MODE` | preview | yes | Preview-only. Keep. |
| `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_HOST`, `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | preview + production | **no** (per the I1.5-C code inventory) | **Remove from Preview.** Keep in Production for now (unused; removing them there is a separate Production change, deferred as G-D4). |

None are integration-linked (`configurationId` empty) [CFG]. That's why replacing only `DATABASE_URL` is not enough: 16 other Production database variables also reach Preview builds today.

## 3. D1 findings disposition

| ID | Sev | Original concern | Resolution in D2 | Evidence | Status |
|---|---|---|---|---|---|
| R-1 | P1 | Write collaborator plus 0 approvals means a merged workflow could get Production credentials | §6: owner-gated environment (required reviewer `ste277`, `main`-only, admin-only management of environment secrets), plus an owner-approval ruleset and CODEOWNERS | [DOC-GH] required reviewers available on public Free repos; secrets released only after approval; environment secrets owner-only in personal repos | **Resolved in design.** Proof tests T-I1-1..6. |
| R-2 | P1 | Re-run after rollback promotes the rejected deployment again | §10: freeze stored as an **environment variable** (owner-only), Vercel rollback state check, never-promoted eligibility, per-promotion owner approval | [DOC-GH] environment variables owner-only; [CFG] `readySubstate`, `lastRollbackTarget` exist | **Resolved in design.** T-I3-7..9. |
| R-3 | P1 | Cutover ships code before its migration | §11: merge freeze, auto-assign off while the build still migrates, then move migrations | Design | **Resolved in design.** |
| R-4 | P1 | Matching by SHA alone selects CLI deployments | §9: eligibility contract on verified fields (`source=="git"`, no `meta.action`, `readySubstate=="STAGED"`, repo id, ref, project, target) | [CFG] fields observed on git, CLI-redeploy and preview deployments | **Resolved in design.** |
| R-5 | P1 | Preview builds hold Production database credentials | §7: separate Preview Neon project, variable split, Preview credential purge, fail-closed identity guard | [CFG] inventory §2.1 | **Resolved in design** (provisioning in I2) |
| R-6 | P2 | `/api/health` is static and bakes a 503 | §12: new dynamic runtime health endpoint; the existing one is left alone | Code reading (no `dynamic` export) | Resolved in design |
| R-7 | P2 | Check re-verification not tied to the run | §8: verify `jobs` of `run_id`/`run_attempt` with event `push`, plus app 15368 check runs for the SHA | Design | Resolved in design |
| R-8 | P2 | Promote-job hygiene | §8.3: step-level secrets, `npm ci --ignore-scripts`, pinned tools, top-level `permissions: {}`, environment referenced by one job only, no `pull_request_target`/`workflow_run`/`workflow_dispatch` | Design | Resolved in design |
| R-9 | P2 | "Can't re-promote" claim doubtful | Not relied on. Eligibility requires `readySubstate=="STAGED"` and never-promoted (§9). | [CFG] `PROMOTED`/`STAGED` values observed | Resolved |
| R-10 | P2 | Conflict with I1.5-C staging migrations | §14: one shared guard and migration script; each environment owns its own migration point | I1.5-C §3.3 read | Resolved in design. I1.5-C needs a matching amendment (owner). |
| R-11 | P2 | `vercel --prod` behaviour with auto-assign off unverified | T-I4-3 is a **hard gate** before go-live; policy bans `vercel --prod` without `--skip-domain`; ticket boilerplate bans `vercel --prod` and `vercel curl` | Design | Resolved by gate |
| R-12 | P3 | Fast-lane already on | Removed from the plan | [CFG] | Resolved |
| R-13 | P3 | No "neutral" job conclusion | Superseded runs end `success` with a summary notice | Design | Resolved |
| R-14 | P3 | Emergency order and credential location unspecified | §10.4: migrate, then promote; credential only in the environment, retrieved through the owner's Neon console, never on disk | Design | Resolved |
| R-15 | P3 | READY timeout under the Hobby queue; Instant Rollback's "previous" with staged deployments in between | T-I3-10, T-I4-6 | Design | Resolved by test |
| R-16 | P3 | `palm01P4VercelGuard` asserts migrate before build | I3 inverts A7 and B13; adds promote-job shape checks | Code | Resolved in plan |
| R-17 | P3 | F-1 injected into every deployment | F-1 revoked and verified (§2) | [CFG] | **Closed** |

## 4. Owner decisions incorporated

- **Decision A:** Greenaroz keeps write access. The enforcement design (§6) doesn't depend on voluntary discipline, and permissions are not changed.
- **Decision B:** Preview is fully separated from the Production database and email credentials (§7). The shared-database risk is not accepted, and Preview stays distinct from I1.5-C staging.

## 5. Revised architecture (overview)

```
PR (any author) ──► ruleset: 4 checks + owner approval (CODEOWNERS * @ste277) ──► merge to main
                                                                                  │
         ┌────────────────────────────────────────────────────────────────────────┤
         ▼                                                                        ▼
Vercel Git build (Production env, auto-assign OFF)                     GitHub Actions CI (push)
 vercel-build.sh: identity guard → (no migrate for Production)          4 required jobs ─┐
                  next build → Palmistry scanner                                         ▼
 → READY / STAGED (no traffic)                                   promote-production (needs: 4)
                                                                   environment: production-promote
                                                                     • required reviewer: ste277  ◄── owner clicks Approve
                                                                     • branches: main only
                                                                     • secrets: VERCEL_PROMOTE_TOKEN, PROD_MIGRATION_DATABASE_URL
                                                                     • variable: PROMOTION_STATE (freeze)
                                                                   verify run/checks/HEAD/freeze/identity
                                                                   → identity guard → prisma migrate deploy (Prod)
                                                                   → re-verify → vercel promote <id>
                                                                   → runtime health + smoke → audit summary

Preview builds (branches/PRs): Preview-only env → identity guard (preview) → migrate Preview DB → build → scanner
```

## 6. Credential trust boundary (P1-1)

### 6.1 Principle

There are two layers, and **both are mandatory**. They protect different credentials (corrected after review V-2):
- The **runtime gate** protects the *Actions* secrets.
- The **merge gate** is the *only* protection for the Production credentials in the Vercel Production build environment. Every merge to `main` builds with `DATABASE_URL`, staged or not.

Neither layer substitutes for the other.

1. **Runtime gate (GitHub-enforced, independent of code):**
   - The secrets `VERCEL_PROMOTE_TOKEN` and `PROD_MIGRATION_DATABASE_URL` exist **only** as environment secrets of `production-promote`.
   - That environment has required reviewer `ste277`, deployment branches `main` only, and "allow administrators to bypass" left at its default. The owner is the only admin.
   - Facts [DOC-GH]:
     - A job "cannot access environment secrets until one of the required reviewers approves it."
     - Required reviewers are available for public repos on Free.
     - In a personal-account repo, environment secrets and variables can be managed only by the repository owner.
   - Greenaroz isn't a listed reviewer.
   - Therefore **any** workflow, including a malicious one merged without review, that references `production-promote` stalls until the owner approves. A workflow that doesn't reference it gets no secrets.
   - **No repository-level secrets** may ever hold Production credentials. Write collaborators *can* create and update repo-level secrets and variables in personal repos [DOC-GH], so repo level is untrusted.
2. **Merge gate (code integrity):**
   - The Vercel Production build itself runs with Production environment variables, including `DATABASE_URL` at build time. That makes **any merged change under `apps/web`** (scripts, `next.config.js`, any module evaluated during build) credential-bearing, even when nothing is promoted.
   - So owner approval is required for **all** non-owner merges, not only "sensitive" paths.

### 6.2 Enforcement mechanism

- **Repository ruleset `main-owner-approval`** (targets `main`, active), with a `pull_request` rule:
  - `required_approving_review_count: 1`
  - require review from Code Owners
  - dismiss stale approvals on push
  - require approval of the most recent reviewable push
  - required review thread resolution off
- **Bypass list:** Repository admin, mode **"For pull requests only"** [DOC-GH: admin bypass eligible; PR-only bypass forces a PR]. The owner's own PRs can't be self-approved [ASSUMPTION: standard GitHub behaviour, test T-I1-4], so they merge as a recorded PR bypass.
- **`.github/CODEOWNERS`** on `main`: `* @ste277`. Explicit entries for the matrix below make the reason visible. [DOC-GH] PRs use the base branch's CODEOWNERS, so a PR can't re-route its own review. Code owners need write access, which `ste277` has.
- **Classic rule (GOV-01) unchanged.** Rulesets and classic rules aggregate, and the most restrictive applies [DOC-GH]. The four required checks stay in the classic rule.
- **Workflow token hardening:** top-level `permissions: {}` in `ci.yml`, with per-job least privilege. The default token is already `read`.

**Fail-closed fallback** (corrected after review V-2) if T-I1-1..4 show rulesets or code-owner review are unavailable:
- Change the classic rule to `required_approving_review_count: 1` with `require_code_owner_reviews: true` and stale-approval dismissal, and prove it with the same tests.
- **If no merge gate can be proven, STOP before I2–I4**, and the owner must choose: reduce Greenaroz to read/triage, or formally accept the risk.

The runtime gate never substitutes for the merge gate.

### 6.3 Sensitive-file ownership matrix

| File or configuration | Risk | Required reviewer | Enforcement | Plan compatibility |
|---|---|---|---|---|
| `.github/workflows/**` | Workflow obtains environment secrets or rewires the gate | `ste277` | Ruleset approval + CODEOWNERS; runtime environment approval | Public repo: rulesets [DOC-GH, medium: plan table silent], required reviewers [DOC-GH, high] |
| `.github/CODEOWNERS` | Removing ownership | `ste277` | Base-branch CODEOWNERS governs [DOC-GH]; ruleset approval | as above |
| `apps/web/scripts/vercel-build.sh`, `check-palmistry-bundle.js`, `palmistry-build-exclusion.js`, `next.config.js` | Build-time access to Production database credentials; scanner bypass | `ste277` | Ruleset approval (all files) + CODEOWNERS | as above |
| `scripts/promote-production.*`, `scripts/db-identity-guard.*`, `scripts/migrate.*` (new) | Gate logic, identity checks, migration credentials | `ste277` | Ruleset + CODEOWNERS; runtime environment approval | as above |
| `apps/web/prisma/schema.prisma`, `apps/web/prisma/migrations/**` | Production schema change | `ste277` | Ruleset + CODEOWNERS; applied only in the approved promote job | as above |
| `apps/web/vercel.json`, root `package.json`, `apps/web/package.json`, lockfiles | Build commands, cron, dependency supply chain | `ste277` | Ruleset + CODEOWNERS | as above |
| `packages/palmistry/src/review-status.json` | Palmistry publication | `ste277` (plus the existing human-review rule) | Ruleset + CODEOWNERS | as above |
| `apps/web/lib/mcpRemoteConfig.ts`, `apps/web/app/api/mcp/**`, `packages/mcp-tools/**` | Enabling remote MCP | `ste277` | Ruleset + CODEOWNERS | as above |
| Everything else under `apps/web/**`, `packages/**` | Code executed during the Production build has Production credentials | `ste277` | Ruleset + CODEOWNERS `*` | as above |
| GitHub settings (rulesets, branch protection, environments, environment secrets and variables) | Weakening controls | Owner only | Admin-only by platform [DOC-GH personal repos] | — |
| Vercel project settings, environment variables, tokens | Disabling staged mode, adding bypass, exfiltration | Owner only | Vercel team membership (Greenaroz isn't a team member [ASSUMPTION: verify in T-I1-6]) | — |

### 6.4 Remaining write-collaborator capabilities and why they're contained

| Capability | Containment |
|---|---|
| Push branches, so Preview builds run | Preview has only Preview credentials after I2 (§7) |
| Open PRs; their CI runs (`pull_request`) | No secrets; `pull_request_target` banned; environment `main`-only |
| Re-run workflows | A re-run uses the original SHA and ref [DOC-GH]. Promotion still needs owner approval [ASSUMPTION: approval re-requested on re-run, T-I3-8] **and** passes the freeze and eligibility checks (§10). |
| Create repo-level variables or secrets | Never used for trust decisions. Freeze is environment-level; environment values take precedence over repository values with the same name [DOC-GH store-information-in-variables, verify T-I3-9]. |
| Approve environment deployments | Not a listed reviewer |
| Merge PRs | Needs owner approval (ruleset) |

## 7. Preview database isolation (P1-5)

### 7.1 Database

- **New Neon project `aura-preview`**, separate from the Production project. It is not a branch of Production, so no copy-on-write Production data can reach it.
- Region `iad1`; its own role, password and connection string.
- **Created empty.** Schema comes from `prisma migrate deploy` of the repository chain. Seed data is synthetic only (`@example.test`).
- **Credentials can't reach Production:** Neon roles are per project, so the Preview role doesn't exist in the Production project [ASSUMPTION: Neon project isolation semantics, check at provisioning].
- **Reset:** a disposable reset procedure (drop the schema or recreate the project) is the documented recovery from preview migration drift caused by branches with diverging migrations.
- **Distinct from staging:** I1.5-C uses its own Neon project and its own Vercel project. Preview and staging never share a database.

### 7.2 Variable changes (I2)

- **Production `aura-updated`:**
  - set `DATABASE_URL` and `RESEND_API_KEY` to **Production target only**;
  - add `AURA_DB_EXPECTED_ENV=production` and `AURA_DB_EXPECTED_HOST_SHA256` (Production);
  - Production values themselves don't change.
- **Preview:**
  - new `DATABASE_URL` (Preview Neon);
  - `AURA_DB_EXPECTED_ENV=preview`;
  - `AURA_DB_EXPECTED_HOST_SHA256` (Preview host);
  - `AURA_DB_FORBIDDEN_HOST_SHA256` (Production host hash);
  - new restricted `RESEND_API_KEY` or none (§7.3);
  - `RESEND_FROM_ADDRESS` (Preview sender).
- **Remove from Preview:** the 16 unreferenced database and Neon variables in §2.1.
- **Never connect** the Neon marketplace integration to `aura-updated` Preview branching. Its linked projects are `[]` today [CFG].
- Team-level shared variables: none exist [CFG], and none may be created.

### 7.3 Email

Preview must not send with the Production Resend key. Owner choice:
- **(a, recommended)** a separate Resend API key, sending-only and restricted to a Preview sender domain or address, with a low quota;
- **(b)** no key, so Preview sign-in email is disabled. The app must fail closed (error, no fallback sender) [ASSUMPTION: verify current behaviour with the key unset, T-I2-5].

### 7.4 Database identity guard (shared with staging)

`scripts/db-identity-guard.js` runs **before any migration and before the app opens its pool at startup**. Every unknown means exit 1, and no query runs.

1. Derive the expected environment from the platform:
   - `VERCEL_PROJECT_ID` = pinned Production ID, `VERCEL_ENV=production` → `production`;
   - Production ID with `VERCEL_ENV=preview` → `preview`;
   - pinned staging ID → `staging`;
   - anything else, or missing → **exit 1**.
2. Require `AURA_DB_EXPECTED_ENV` to equal the derived environment. Missing means exit 1.
3. Parse `DATABASE_URL` with a URL parser; normalise the host (lowercase, strip `-pooler`); compute its SHA-256.
4. Require it to equal `AURA_DB_EXPECTED_HOST_SHA256`. For preview and staging, also require it **not** to be in `AURA_DB_FORBIDDEN_HOST_SHA256`.
5. **Database-side marker** (defence in depth): a read-only `SELECT env FROM aura_environment_identity` must return the expected environment. A missing table or row means exit 1.
   - The marker row is written once per database at provisioning by the owner. For Production that write is an authorized I3 step.
   - The marker isn't created by a migration, so it can't be the same value everywhere.
6. Log only `DB identity verified (<env>)` or `REFUSED: <code>`. Never the URL or host.

### 7.5 Negative test (designed; not run in D2)

- **Where:** a disposable local Postgres container labelled with a fake "production" host, and a marker row `production`. No Production systems involved.
- **How:** run the guard as a Preview build would (`VERCEL_ENV=preview`, Production project ID, `AURA_DB_EXPECTED_ENV=preview`, `DATABASE_URL` pointing at the fake-production container).
- **Expected:** exit 1 at step 4 (forbidden hash) or step 5 (marker mismatch). Postgres `log_statement=all` shows **no DDL or DML** — only the marker `SELECT`, or no connection at all at step 4.
- **Variants:** a missing `AURA_DB_EXPECTED_ENV`; a missing `VERCEL_PROJECT_ID`; an unknown project ID. All must exit 1 before connecting.

## 8. CI-to-deployment authorization model

### 8.1 Conditions, all fail-closed

1. **Event and ref:** `github.event_name == 'push'`, `github.ref == 'refs/heads/main'`, `github.repository == 'ste277/aura-updated'`.
2. **Run integrity:** via `GET /repos/{r}/actions/runs/{run_id}/attempts/{run_attempt}/jobs`, the four jobs named exactly `Ephemeris / panchang tests`, `Next.js production build`, `MCP Server`, `Database migration validation` are `completed`/`success` **in this run attempt**. The run's `head_sha == github.sha` and the workflow path is `.github/workflows/ci.yml`.
3. **Check-run cross-check:** `GET /commits/{sha}/check-runs` shows the latest check run per required name with `app.id == 15368`, `conclusion == success`, and a check suite equal to this run's suite. Pending, skipped, cancelled, timed-out, neutral, stale, action-required, missing or duplicate (ambiguous) checks all **fail**.
4. **Freshness:** `github.sha` equals current `refs/heads/main` (checked in step 1 and again just before promote). If superseded: exit successfully with notice "superseded by <sha>"; no migration, no promotion.
5. **Freeze:** §10.
6. **Deployment identity:** §9.
7. **Ordering:** the live production deployment's `gitSource.sha` is an ancestor of `github.sha` (`git merge-base --is-ancestor`). Otherwise fail and require an operator decision.
8. **Migration safety:** the identity guard (`production`) passes; `prisma migrate status` shows only pending migrations from the repository chain; then `migrate deploy`.
9. **Health:** post-promotion runtime health and smoke (§12).

### 8.2 Workflow-file integrity

The promote job lives in `ci.yml`, which is owner-reviewed (§6). The owner's environment approval screen names the workflow and job; the approval checklist requires `CI / promote-production` at the expected SHA. A merged workflow that references the environment from a different file or job is visible at approval time and must be rejected.

### 8.3 Job hygiene

- `permissions: { contents: read, actions: read, checks: read }` on the job; `{}` at the top level.
- `environment: production-promote` on **this one job only**.
- Triggers limited to `push` and `pull_request`; `pull_request_target`, `workflow_run` and `workflow_dispatch` are banned.
- Secrets passed as **step-level** `env` only, to the migrate and promote steps.
- `npm ci --ignore-scripts` runs before any secret-bearing step.
- Pinned `vercel@<exact>` and `prisma@<exact>`.
- `concurrency: { group: production-promote, cancel-in-progress: false }`.
- `timeout-minutes` set.

## 9. Trusted deployment identity (P1-4)

Fields verified on real deployments [CFG]:
- Git build `dpl_mYJA…`: `source="git"`, no `meta.action`.
- CLI redeploy `dpl_CGik…`: `source="cli"`, `meta.action="redeploy"`, `meta.originalDeploymentId`.
- Preview `dpl_4CRL…`: `target=null`, `readySubstate="STAGED"`.

All of them carry the full `meta.github*` fields, so Git metadata alone proves nothing.

**Eligibility contract.** List with `GET /v6/deployments?projectId=…&target=production`, then filter client-side. **Exactly one** deployment across *all* states must satisfy every condition below, and **no** deployment with `source != "git"` may exist for the SHA; otherwise fail.

| Field | Required value |
|---|---|
| `projectId` | `prj_iY4xteQOWUNsV85NnbyIylBAba6t` |
| `source` | `"git"` |
| `meta.action` | absent (excludes redeploys) |
| `gitSource.type` | `"github"` |
| `gitSource.repoId` / `meta.githubRepoId` | `1331993685` |
| `meta.githubOrg` / `meta.githubRepo` | `ste277` / `aura-updated` |
| `gitSource.ref` / `meta.githubCommitRef` | `"main"` |
| `gitSource.sha` / `meta.githubCommitSha` | `github.sha` (both must match) |
| `meta.gitDirty` | absent |
| `target` | `"production"` |
| `readyState` | `"READY"`. Wait up to 30 min (Hobby builds one at a time, queued in order); a timeout fails. |
| `readySubstate` | `"STAGED"`. `PROMOTED` means it was promoted before, so it is ineligible. |
| Deployment ID | recorded, and passed verbatim to `vercel promote` |

**Fallback** if `readySubstate` turns out unreliable (T-I3-6): keep a list of promoted deployment IDs in the job summary history, and reject any ID that has ever been promoted.

## 10. Promotion freeze and rollback (P1-2)

1. **Freeze-state storage:** environment variable `PROMOTION_STATE` on `production-promote`.
   - **Owner-only** to change [DOC-GH personal repo, environment variables]. Workflows can't write it (`GITHUB_TOKEN` has no variables write).
   - Format: `OPEN:<YYYY-MM-DD>:<issue#>` or `FROZEN:<reason>:<issue#>`.
   - **Anything else, or missing, counts as FROZEN.** Even if a repo-level variable shadowed a deleted environment variable, it would also need the exact format. The job additionally checks that the `OPEN` date is later than Vercel's last rollback (below).
2. **Vercel-side rollback signal:** the job reads the project's `lastRollbackTarget`. If it is set, or if the live production deployment isn't the newest promoted git deployment, treat it as **FROZEN** [ASSUMPTION: `lastRollbackTarget` semantics, T-I3-7].
3. **Authority:** only the owner sets `PROMOTION_STATE` and approves environment runs.
4. **Procedures:**
   - *Freeze:* Instant Rollback, which turns off auto-assign [DOC-V] (already off). Set `FROZEN:<reason>:<issue>` and open an incident issue.
   - *Unfreeze:* fix forward on `main`; set `OPEN:<date>:<issue>`; the issue records who, why, the SHA and the evidence.
5. **Concurrency:** GitHub `concurrency` serialises promote jobs. Freshness (§8.1.4) and ancestor checks reject stale ones. Vercel: "a new promotion supersedes one in progress" [DOC-V].
6. **Re-runs:**
   - Re-runs keep the original SHA [DOC-GH], need owner approval, re-read the freeze, and are rejected if the deployment is already `PROMOTED` or the SHA is no longer HEAD.
   - So a re-run of rolled-back B fails on three counts: freeze, `PROMOTED`, and the Vercel rollback signal.
7. **Outages:**
   - GitHub down: no promotion; Production unchanged.
   - Vercel down: promote fails; re-run after recovery (fresh checks).
   - A promotion half-applied by Vercel is handled by its own promote job semantics; verify `targets.production`.
8. **Negative tests:** T-I3-7..9 (§15).
9. **Audit evidence:** environment approval history (GitHub), job summary (SHA, deployment ID, migrations applied, checks, freeze value), the incident or unfreeze issue, and Vercel deployment history.

### 10.4 Emergency procedure

1. Owner opens `EMERGENCY-DEPLOY: <sha>` with the justification and the checks being skipped.
2. If CI can finish, approve the job normally.
3. Otherwise, the owner runs `prisma migrate deploy` (identity guard first) using the credential copied from the Neon console for that session only, never saved to disk. **Then** `vercel promote <exact staged id>` (never `vercel --prod`).
4. Set `PROMOTION_STATE` as appropriate.
5. Retrospective independent review within 48 h.

## 11. Safe cutover sequence (P1-3; executed in I4)

| Step | Action | Verification | Rollback |
|---|---|---|---|
| 1 | Announce merge freeze (issue); Greenaroz notified | No open PRs being merged | Lift freeze |
| 2 | Verify no deploy or merge in flight | Vercel queue empty; `main` HEAD = live production SHA | — |
| 3 | Record the live deployment ID (rollback anchor) | `targets.production` | — |
| 4 | **Turn off Auto-assign Custom Production Domains** while `vercel-build.sh` **still migrates** | Setting read-back | Turn it back on |
| 5 | Trivial docs-only PR → staged deployment | `readySubstate=STAGED`; live ID unchanged; public domain still serves the anchor | Close PR; nothing promoted |
| 6 | **T-I4-3 hard gate:** a `vercel --prod --skip-domain` deployment stays staged; a plain `vercel --prod` behaves as documented | Read-back | — |
| 7 | Manually promote step 5's staged deployment (owner) to prove the promote path | Live ID = step 5 ID; health OK | Instant Rollback to the anchor |
| 8 | Merge the I3 activation PR (removes build-time migration for the Production project; turns off dry-run). Its own staged deployment is promoted by `promote-production` after owner approval, which also runs `migrate deploy` (none pending expected). | Job summary; live ID = activation deployment | Instant Rollback; freeze; revert PR |
| 9 | Negative tests on Production-safe paths: a re-run of an old run is rejected (stale); `PROMOTION_STATE=FROZEN` blocks; a superseded commit is skipped | Job logs | — |
| 10 | Owner accepts; lift the merge freeze | Issue closed | — |

Throughout, the live deployment changes only at steps 7 and 8, each with an explicit owner action and a recorded rollback anchor.

## 12. Health verification (R-6)

| Layer | Signal |
|---|---|
| Build success | Vercel build log, plus the scanner line `[palmistry-bundle] OK: none of 8` |
| Deployment readiness | `readyState=READY`, `readySubstate=STAGED` |
| Runtime health (new) | `GET /api/health/live`: `dynamic='force-dynamic'`, `Cache-Control: no-store`. Returns `{status, db:"ok"\|"fail", schema:"match"\|"mismatch", deploymentId, sha}` with no hostnames, error text or secrets. `schema` compares the latest applied `_prisma_migrations` name with the latest migration directory compiled into the build. HTTP 503 on any failure. |
| Database connectivity | Part of the above (`SELECT 1`) |
| Post-promotion smoke | Public `/` returns 200 with `data-deployment-id` = the promoted ID; `/api/health/live` is 200 and matches the ID and SHA; Palmistry sentinel scan of served chunks = 0; `/api/mcp` returns 404 |

**Constraint:** staged deployments sit behind Vercel SSO, and creating a bypass secret is prohibited. So runtime health can only be checked **after** promotion, on the public domain. On failure the job fails loudly, sets nothing automatically, and the owner follows §10.4 (Instant Rollback plus `FROZEN`). Accepted as a design limitation (G-D2).

## 13. Platform and plan feasibility

| Capability | Status |
|---|---|
| Staged production plus `vercel promote` without rebuild | [DOC-V] "All plans" (Hobby) |
| Environment required reviewers, branch policy, environment secrets and variables (public repo, Free) | [DOC-GH] high |
| Rulesets on a public personal repo; Repository admin bypass, PR-only | [DOC-GH] medium (plan table silent) → T-I1-1 |
| Code-owner review on public Free | [DOC-GH] medium → T-I1-3 |
| Author can't self-approve | [ASSUMPTION] → T-I1-4 |
| Environment approval re-requested on re-run | [ASSUMPTION] → T-I3-8 |
| Environment values override repository values | [DOC-GH store-information-in-variables; to confirm] → T-I3-9 |
| `readySubstate` and `lastRollbackTarget` semantics | [CFG observed values; semantics are ASSUMPTION] → T-I3-6/7 |
| Neon projects per environment on the current Neon plan | [ASSUMPTION] owner check at I2 |
| Push rulesets (file-path restriction) | Docs say private and internal repos only, so **not used** |

## 14. Integration with I1.5-C staging

- **Shared code:** I1.5-C's guard (§3.3 there) becomes the shared `db-identity-guard.js` (§7.4). It covers `staging` with the same pinned-project-ID logic and its own expected and forbidden host hashes. That is compatible with I1.5-C's eight-variable staging allowlist; the `AURA_STAGING_*` names map to the generic `AURA_DB_*` names, or the guard accepts both.
- **Migration ownership:**

| Environment | Migrations run in | Gate |
|---|---|---|
| Production | `promote-production` | after CI and owner approval |
| Staging | `aura-staging` build | per I1.5-C; staging is fast-forward-only from CI-green `main` |
| Preview | Preview build | guard (preview), Preview database |

- `vercel-build.sh` therefore branches on the derived environment, with migration *off* for Production.
- **`aura-updated` Preview of the `staging` branch:** after I2 that Preview has only Preview credentials, so I1.5-C's prerequisite (Ignored Build Step or risk acceptance) becomes much lower risk. The Ignored Build Step is still recommended to save builds.
- **Native app staging configuration:** unaffected. Preview and staging stay distinct.
- **Amendment needed** (owner, separate ticket): I1.5-C §3.3/§3.4 should reference the shared guard. No change to the approved I1.5-C design is made here.

## 15. Implementation phases and STOP conditions

Order rationale:
- I1 first: no credentials may enter Actions before the trust boundary exists.
- I2 before I3: a Preview with Production credentials would make "migrations gated" false.
- I3 before I4: the code ships in dry-run first.

| Phase | Preconditions | Changes | Permissions | Tests (incl. negative) | Rollback | STOP if | Review | Authorization |
|---|---|---|---|---|---|---|---|---|
| **GOV-02-I1** Credential and workflow trust | D2 approved | `.github/CODEOWNERS` (PR); ruleset `main-owner-approval`; environment `production-promote` (reviewer, `main` policy, no secrets yet); `permissions: {}` in `ci.yml` | Owner (admin) | **T-I1-1** ruleset active; **T-I1-2** a Greenaroz-authored test PR (needs their cooperation, or a test account invited as a write collaborator) can't merge without owner approval; **T-I1-3** code-owner request routed; **T-I1-4** owner can't self-approve, and the PR-only bypass works and is logged; **T-I1-5** a test workflow referencing the environment from a non-`main` branch is refused, and from `main` waits for approval; **T-I1-6** Greenaroz has no Vercel team access | Delete the ruleset or environment; revert the CODEOWNERS PR | Any test shows a non-owner can merge or obtain environment secrets | Independent | **Separate** |
| **GOV-02-I2** Preview isolation | I1 done | Neon project `aura-preview` (empty; marker `preview`); Vercel variable split (§7.2); remove 16 Preview variables; Preview Resend key; shared guard in `vercel-build.sh` for preview and staging | Owner (Neon, Vercel) | **T-I2-1** Preview build uses the Preview database (marker); **T-I2-2** the §7.5 negative test (local); **T-I2-3** Preview has none of the Production database variables (inventory); **T-I2-4** a Preview migration only touches the Preview database; **T-I2-5** email fails closed with no key, or the restricted key works | Restore the previous Preview variables (values held in Vercel history); revert the guard PR | A Preview can resolve a Production identity; any Production write | Independent | **Separate** |
| **GOV-02-I3** Gate implementation (dry-run) | I1, I2 | `promote-production` job in **dry-run** (verify only); `scripts/promote-production`, unit tests; `/api/health/live`; marker row `production` (an authorized Production write); environment secrets `VERCEL_PROMOTE_TOKEN` (project-scoped), `PROD_MIGRATION_DATABASE_URL` (dedicated role preferred); `PROMOTION_STATE=FROZEN`; guard test updates | Owner | Unit tests for every non-success check state, duplicate names, foreign app, CLI or redeploy deployment, PROMOTED, ref mismatch; **T-I3-6** substate semantics; **T-I3-7** rollback signal; **T-I3-8** re-run re-approval; **T-I3-9** variable precedence; **T-I3-10** READY timeout; dry-run on real merges reports the correct eligible ID | Revert the PR; delete environment secrets | Dry-run selects a wrong or ambiguous deployment; secrets visible to non-env jobs | Independent | **Separate** |
| **GOV-02-I4** Controlled cutover | I3 dry-run green on ≥2 real merges | §11 steps 1–10 | Owner | §11 verifications; T-I4-3 hard gate; T-I4-6 rollback "previous" semantics | §11 rollback column | Any step's verification fails; Production changes outside steps 7 or 8 | Independent | **Separate** |

**Global STOP:** the credential boundary is bypassable; Production credentials appear anywhere other than the environment or Vercel Production; any unplanned Production write; `vercel curl` or bypass-secret creation is needed.

**Deferred items (with owner and acceptance needed):**
- **G-D1:** pre-promotion runtime health isn't possible without an SSO bypass. Owner accepts post-promotion verification.
- **G-D2:** as G-D1 (§12).
- **G-D3:** PR CI runs on the merge ref with `strict=false`, so post-merge CI is the real gate. Accepted by design.
- **G-D4:** remove the unused Neon and Postgres variables from Production too. Separate Production change; owner.
- **G-D5:** every promotion needs one owner click (the cost of the runtime gate). Owner accepts, or later adopts a custom deployment protection rule (GitHub App).

## 16. Independent review findings

### 16.1 Round 1: REQUEST CHANGES

The reviewer was an independent, adversarial, read-only subagent. It ran `git` reads, `gh api` GETs, and field-filtered `vercel api` GETs, and printed no secrets.

| ID | Sev | Finding (summary) | Disposition |
|---|---|---|---|
| **V-1** | **P1** | Preview builds hold Production database and Resend credentials **today** (verified against 23 env entries), and keep them throughout I1. Any branch push can exfiltrate them. Live Previews (PR #346, 13:14Z and 13:28Z) were built with them. | **Fixed: new phase I0** (§17.1) before I1, plus credential rotation |
| **V-2** | **P1** | The claim that either layer alone suffices is false: the merge gate alone protects the Vercel Production build credentials | **Fixed in §6.1/§6.2** (both mandatory; STOP if no merge gate) |
| V-3 | P2 | Whether environment secrets and variables are owner-only is unverified (the docs are ambiguous) | **Fixed:** T-I1-7, with fallback (§17.2) |
| V-4 | P2 | Freeze rules contradict each other; the summary-history ledger can't be implemented; run logs can be deleted | **Fixed** (§17.3) |
| V-5 | P2 | Nothing asserts auto-assign stays off; a promote may re-enable it | **Fixed** (§17.4); hard-gate test |
| V-6 | P2 | Prisma prints the database host into public Actions logs | **Fixed** (§17.5) |
| V-7 | P2 | The identity guard can't run in the GitHub job or operator contexts; runtime guard mechanism undefined; user and database matching dropped | **Fixed** (§17.6) |
| V-8 | P2 | Expand/contract, "rollback doesn't reverse schema", and the P3009 runbook are missing | **Fixed** (§17.7) |
| V-9 | P2 | Cutover: no OPEN step; dry-run precondition impossible; plain `vercel --prod` test on Production | **Fixed** (§17.8) |
| V-10 | P2 | Routine owner bypass; collaborator pushes to owner branches; agents holding the owner token | **Fixed** (§17.9) |
| V-11 | P3 | STAGED is also the substate of every Preview; target filter is essential | **Fixed:** STAGED always paired with `target=="production"`; relabelled [ASSUMPTION] until §11 step 5; paginate; add `meta.githubPrId` absent; never use alias fields |
| V-12 | P3 | Concurrency cancels older pending or waiting runs (`cancelled`, not `success`) | **Documented;** concurrency is **job-level on `promote-production` only** |
| V-13 | P3 | Event denylist incomplete; environment policy type; checklist should check the file path | **Fixed:** trigger allowlist (`push` only for the job; workflow triggers limited to `push`/`pull_request`); policy "Selected branches: `main`"; approval checklist verifies `.github/workflows/ci.yml` |
| V-14 | P3 | Prerender database-read test dropped; old health route leaks `err.message`; `data-deployment-id` not emitted | **Fixed:** prerender test added to I3; smoke uses `/api/health/live` `deploymentId` (`VERCEL_DEPLOYMENT_ID`); removing `err.message` from the old route is recommended in I3 |
| V-15 | P3 | Promote token can create production builds from any ref, so it's equivalent to the database credential; `--ignore-scripts` may break Prisma engines | **Fixed:** token documented as database-equivalent; rotation every 90 days and on any suspicion; install test in I3 |
| V-16 | P3 | `VERCEL_OIDC_TOKEN` in Previews; host hash is low-entropy | **Noted:** no cloud federation may trust the team OIDC issuer; the hash is integrity, not secrecy |
| V-17 | P3 | Duplicate G-D1/G-D2; numbering; open PR #346 changes `ci.yml` | **Fixed:** G-D2 removed (merged into G-D1); I1/I3 rebase on #346 if merged |

### 16.2 Round 2: APPROVE WITH NOTES

- **V-1 and V-2 are resolved in the design.** No new P0/P1.
- Live state unchanged: `origin/main` `e921f54`, 0 rulesets, environments unprotected, auto-assign on, 0 bypass entries, Production `dpl_mYJA…`.
- **V-1 framing endorsed:** the exposure is **live until I0 is executed**. It doesn't block design readiness, but I0 should be authorized immediately and separately.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| N-1 | P2 | The unfreeze runbook promotes manually without migrating | **Fixed** in §17.11 |
| N-2 | P2 | The I0 rotation sequence could cause an outage (Neon reset is immediate; redeploy while auto-assign is on; CLI redeploy creates a non-git deployment) | **Fixed** in §17.11 (new role, git-commit deploy, revoke last) |
| N-3 | P2 | Routine auto-assign patch-back leaves a race | **Fixed:** if a promote turns auto-assign on, **automation stops** (owner-manual promotion); patch-back is emergency containment only; the token's settings-write capability is documented |
| N-4 | P2 | The "last push" `pull_request` job can be neutered and goes stale | **Fixed:** dropped as a control; replaced by an owner's pre-bypass `gh api graphql` check of push and commit actors (checklist) |
| N-5 | P3 | The issue audit log isn't tamper-resistant; it would add `issues: write` to the secret-holding job | **Fixed:** issue posting moves to a separate, environment-less job and is convenience only. The authoritative audit is Vercel history plus the owner's monthly export. |
| P3 notes | P3 | §6.1 "environment secrets owner-only" should be marked pending T-I1-7; T-I1-7 fallback wording muddled; `gha-promote` must pass the environment name explicitly; "Prisma migration per transaction" should be [ASSUMPTION], proven in `db-migration-validation` | Accepted. Carried as implementation notes for I1 and I3. |

## 17. Revision 2 amendments (supersede the referenced sections)

### 17.1 New phase GOV-02-I0: interim Preview credential purge (V-1). Urgent, and before I1.

**Why it can't wait for I2:** I0 puts nothing into Actions, so the "I1 first" rationale doesn't apply.

**Changes:**
- Remove the **Preview** target from `DATABASE_URL`, the 16 other database and Neon variables, and `RESEND_API_KEY`. Production values are unchanged.
- **Or**, if a Preview without a database is unacceptable, set a dashboard-only Ignored Build Step on `aura-updated` that skips every non-production build: `[ "$VERCEL_ENV" != "production" ]` exits 0, which skips. This is a dashboard setting, so a branch can't edit it.
- The purge is recommended. Previews will fail at runtime on any database route until I2, which is acceptable and fails closed.

**Then rotate** the Production Neon role password and the Resend API key (owner, in Neon and Resend), and update the Production values. Exposure since 2026-08-14 can't be ruled out. Alternatively, the owner records a risk acceptance.

**Rotation sequence:**
1. Create the new credential.
2. Update the Vercel Production value.
3. Redeploy or promote Production. This needs explicit authorization.
4. Revoke the old credential.

| | |
|---|---|
| Verification | env read-back: no Preview targets on those 18 variables; a new Preview build has none of them (build-log `printenv` names only, in a throwaway branch); Production health 200 |
| Rollback | Re-add the Preview targets (not recommended) |
| STOP | Production returns non-200 after rotation |

### 17.2 T-I1-7: environment write-ability (V-3)

- **Test:** as Greenaroz or a write test account, attempt REST `PUT` on (a) an environment secret, (b) an environment variable and (c) the environment's protection rules. Then attempt (d) a repo-level variable.
- **Expected:** a–c refused. (d) may succeed; it is never trusted.
- **If a or b succeeds:**
  - move the freeze state and the expected-host hashes **into code**, owner-reviewed through the merge gate, for example a pinned constant file;
  - store migration credentials only via the owner's Neon or Vercel, using a different credential path: the migration step obtains the connection string through the Vercel API (sensitive variables aren't readable, so this would need a non-sensitive Production-only variable, which is undesirable). That makes the fallback **STOP and redesign**.

### 17.3 Freeze (V-4): replaces §10.1–10.2 and the §9 fallback

- **One rule.** The job proceeds only if **all** of these hold:
  - `vars.PROMOTION_STATE` matches `^OPEN:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z:#\d+$`;
  - Vercel project `lastRollbackTarget` is null;
  - `autoAssignCustomDomains` is false (§17.4).

  Anything else means FROZEN.
- **Clearing `lastRollbackTarget`.** Per the docs, a promote re-enables things after a rollback. The unfreeze runbook is:
  1. Fix forward on `main`; CI green.
  2. The owner manually runs `vercel promote <staged git deployment of the fix>` (the identity contract is applied by hand, using a checklist script in read-only mode).
  3. Verify `lastRollbackTarget` is null **and** re-assert `autoAssignCustomDomains=false` (§17.4).
  4. Set `PROMOTION_STATE=OPEN:<UTC ts>:#<issue>`.

  The exact clearing behaviour is a T-I3-7 hard gate. If `lastRollbackTarget` doesn't clear on promote, the job uses "the live production deployment equals the newest `PROMOTED` git deployment" instead, and the variable's timestamp must be later than the rollback's `aliasAssignedAt`.
- **Ever-promoted ledger:** from **Vercel deployment history** (target `production`, `readySubstate` `PROMOTED`, or a past alias) and **GitHub Deployments** records of environment `production-promote`. Workflow-run summaries are not used.
- **Tamper-resistant audit:** the promote job posts an append-only comment to a pinned owner-locked issue ("Production promotion log"; issue locked to collaborators). The owner exports Vercel history monthly. Run logs are treated as convenience only.

### 17.4 Auto-assign invariant (V-5)

- **Promote job:**
  - require `autoAssignCustomDomains==false` **before** promotion;
  - read it **after** `vercel promote`;
  - if it's true afterwards, immediately `PATCH` it back to false using the same token (requires settings permission), verify, mark the job failed, and alert.
- **Hard gate T-I3-11 / §11 step 7:** determine whether `vercel promote` flips auto-assign. If it does and can't be safely re-set by the job, the staged design is **not viable as automation**, and promotion stays owner-manual.
- §11 steps 7 and 8 and T-I4-6 get explicit read-backs.

### 17.5 Log redaction (V-6)

- Before any Prisma command, a step parses the connection string with Node's `URL` and emits `::add-mask::` for the host, normalised host, user, database and password.
- Prisma output is piped through a filter that replaces `at "…"` with `at "[redacted]"`.
- **Test:** grep the job log (downloaded via API) for the host and endpoint ID. Expect 0 hits.

### 17.6 Identity guard contexts (V-7): replaces §7.4 step 1

| Context | Detection | Variable parsed | Expected environment |
|---|---|---|---|
| `vercel-build` | `VERCEL=1` and build phase | `DATABASE_URL` | Derived from `VERCEL_PROJECT_ID` plus `VERCEL_ENV` (as §7.4; staging by pinned project ID) |
| `vercel-runtime` | `VERCEL=1` or `VERCEL_ENV` set | `DATABASE_URL` | Same derivation |
| `gha-promote` | `GITHUB_REPOSITORY=ste277/aura-updated`, `GITHUB_WORKFLOW_REF` = `ste277/aura-updated/.github/workflows/ci.yml@refs/heads/main`, job environment `production-promote` | `PROD_MIGRATION_DATABASE_URL` | `production` |
| `operator` | Explicit `--env production --i-am-owner` flags | `--url-from-stdin` | `production`; requires an interactive confirmation of the host-hash prefix |
| CI test jobs and local | none of the above | — | **Guard not invoked.** These jobs use local Postgres. The runtime guard activates only under `VERCEL`/`VERCEL_ENV`, so absence of `VERCEL*` can't fail open on Vercel, where those variables are platform-injected and their absence is treated as error in `vercel-build`. |

- **Matching:** host **and** user **and** database name must all match (restoring I1.5-C), plus the forbidden-host list and the marker row.
- **Runtime mechanism:** `lib/db.ts` wraps the pool in a memoized `ensureIdentity()` promise awaited before the first `query`/`connect`. One central change, since the pool is module-private. If it fails, every database call throws `DB_IDENTITY_REFUSED`.
- **Purpose, stated:** the guard defends against **misconfiguration**. It isn't a defence against malicious branch code, which can skip the guard; that is what credential isolation (I0/I2) is for.
- Negative-test variants added: marker `production` with both hashes misconfigured; malformed URL; missing marker table; `gha-promote` context with a wrong `GITHUB_WORKFLOW_REF`.

### 17.7 Migration safety (V-8)

- **Statement:** an application rollback (Instant Rollback or promoting an older deployment) **does not reverse database schema changes**.
- **Expand/contract rule:**
  - every migration must be compatible with the previously live code;
  - destructive changes (DROP, RENAME, type change, SET NOT NULL without a default) need two releases: expand, deploy, then contract in a later release.
- **Automated check (I3):** a CI step lints migration files **added relative to `main`**. It flags `DROP`, `RENAME`, `ALTER … TYPE`, `SET NOT NULL` and `TRUNCATE` unless the migration directory contains `CONTRACT_APPROVED.md`, which is owner-owned via CODEOWNERS.
- **Failure runbook:**
  1. If `migrate deploy` fails (for example P3009), nothing is promoted and the old code keeps serving.
  2. Set FROZEN.
  3. Inspect `_prisma_migrations` (read-only).
  4. Fix forward with a corrective migration, or `prisma migrate resolve --rolled-back|--applied` (owner, operator context, after review).
  5. Re-run the job; set OPEN.
- **Partial DDL:** Prisma runs each migration in a transaction where Postgres allows. Non-transactional statements (for example `CREATE INDEX CONCURRENTLY`) are banned unless they are alone in their own migration.

### 17.8 Cutover corrections (V-9): replaces parts of §11 and §15

- **I3 dry-run expectation (auto-assign still ON):** on each real merge, the dry-run must find exactly one git deployment for the SHA with `target=production`, report it as **`PROMOTED` → "ineligible (already live; auto-assign on)"**, and pass every other check. The STAGED-path proof moves to **§11 step 5**.
- **T-I4-3:** the plain `vercel --prod` behaviour is tested **on a disposable Vercel project** with auto-assign off, never on `aura-updated`. On Production, only `--skip-domain` behaviour is checked, and only as a read-only review of the docs and the disposable result.
- **New step 7b**, after step 7: the owner sets `PROMOTION_STATE=OPEN:<UTC ts>:#<cutover issue>`, and verifies `lastRollbackTarget` is null and `autoAssignCustomDomains` is false.
- Steps 7 and 8 gain auto-assign read-backs (§17.4).

### 17.9 Bypass and automation policy (V-10)

- **Before any owner PR-bypass merge,** the last push on the PR head must be by `ste277`. This is checked by a required CI job that runs on `pull_request` and fails if the PR's last commit or pusher isn't the owner while the PR has no approving review. Without such a job, it is a merge checklist item.
- Agent tickets permanently ban:
  - `gh pr merge --admin` and ruleset-bypass merges;
  - `POST /repos/{r}/actions/runs/{id}/pending_deployments` (environment approvals);
  - writes to environment variables or secrets;
  - `vercel promote` and `vercel --prod`;
  - `vercel curl`.

  Approvals and promotions are **human clicks only**.

### 17.11 Round-2 amendments (N-1..N-5)

**N-1, unfreeze runbook.** Before the manual `vercel promote` in §17.3 step 2:
- run `prisma migrate deploy` at that exact SHA in the **operator** guard context (§17.6); **or**
- confirm with `prisma migrate status` that the fix contains no pending migrations.

Order is always migrate, then promote.

**N-2, I0 rotation sequence** (replaces the §17.1 sequence):
1. In Neon, create a **new role** with equivalent privileges, including ownership of, or membership in, the role that owns the schema objects, since DDL needs ownership. Don't reset the existing password.
2. Update the Vercel **Production** `DATABASE_URL` and `RESEND_API_KEY` to the new values. Use a new Resend key; the old one stays active for now.
3. Deploy through a trivial owner-approved **git** commit merged to `main`, not `vercel redeploy`. Before I4, auto-assign is still on, so this goes live through the normal path; its build runs `migrate deploy` with nothing pending.
4. Verify Production health (dynamic probe) and sign-in email.
5. Only then revoke the old Neon role's login (or reset its password) and revoke the old Resend key.

The 16 unused Production database variables (G-D4) still hold the old credentials; once the old role is revoked they are dead values. Build-log verification prints **variable names only** (`printenv | cut -d= -f1`).

**N-3, auto-assign.**
- If T-I3-11 shows `vercel promote` re-enables auto-assign, **automated promotion is not activated**, and promotion stays owner-manual using the same verification script in read-only mode.
- The job's `PATCH` back to false is an emergency containment only.
- The token can write any project setting, including `ssoProtection` and `protectionBypass`, and can create production builds. Treat it as equivalent to the Production database credential.

**N-4, owner bypass.**
- No `pull_request` "last push" job.
- Before any bypass merge, the owner runs a read-only `gh api graphql` query of the PR timeline (head-ref force-push and commit events, with their actors) and confirms that every push after review is by `ste277`.
- Optional hardening: a branch ruleset restricting updates to owner branch patterns (for example `owner/*`), with admin bypass.

**N-5, audit.**
- The promotion-log issue comment is posted by a **separate job without the environment**, with only `issues: write`. It is convenience only.
- The authoritative audit is Vercel deployment history (sticky `PROMOTED` state), GitHub environment approval history, and the owner's monthly export.

### 17.10 Updated phase order

**I0** (purge and rotate) → **I1** (trust boundary, including T-I1-7) → **I2** (Preview database and guard) → **I3** (gate dry-run, health, lint, redaction) → **I4** (cutover with step 7b). Each phase needs separate authorization and an independent review.
