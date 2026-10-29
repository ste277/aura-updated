# AURA-GOV-01: Main Branch Protection & Required CI Governance

**Repository:** `ste277/aura-updated` · **Date:** 2026-11-10 · **Acting account:** `ste277` (admin), via the authenticated `gh` CLI

## I. Final verdict: **AURA-GOV-01: PROTECTED AND VERIFIED**

---

## A. Executive summary

- **Protection applied:** yes, at 2026-11-10T12:02:12Z. One classic branch-protection rule on `main`.
- **Required checks:** `Next.js production build` (includes the Palmistry scanner), `MCP Server`, `Database migration validation` and `Ephemeris / panchang tests`. Each is bound to the GitHub Actions app (`app_id 15368`). Day Constructor is not required.
- **Verification:** a disposable PR (#345) showed `BLOCKED` while required checks were pending, *after* it was marked non-draft with 0 approvals required. It changed to `UNSTABLE` once all required checks passed and only the non-required Day Constructor failure remained. It was closed without merging and its branch deleted.
- **Independent review:** APPROVE WITH NOTES. No P0/P1 findings.
- **External event:** #343 was squash-merged by `ste277` at 12:08:49Z, 6 minutes after the protection went on. I didn't do it. It met every rule (B.4).

## B. Baseline (captured 12:00:33Z, before any change)

### B.1 Repository and protection

| Item | Value |
|---|---|
| Repository | `ste277/aura-updated` (id 1331993685), **public**, default branch `main` |
| `main` SHA | `afbe5204ce8a17a22e3a44d3f41726753cae11f2` |
| Classic branch protection | **None** (`GET /branches/main/protection` → 404 "Branch not protected") |
| Rulesets | `[]`; effective rules on `main`: none |
| Admin enforcement / force pushes / deletions / required checks | n/a: there was no protection at all |
| Acting permissions | admin, maintain, push, triage, pull |
| Merge methods | merge commit ✓, squash ✓, rebase ✓ |
| Auto-merge / delete branch on merge / update branch | off / off / off |
| Workflows | one: `CI` (`.github/workflows/ci.yml`, id 332733482, active) |
| Open PRs | #343 (draft, MCP-02-I1), #344 (draft, MOBILE-01-M1); neither had auto-merge |

The evidence files are `prot-before.json`, `rulesets-before.json` and `repo.json` in the evidence folder (§K).

### B.2 Rollback reference state

**No branch protection and no rulesets.** See H.

### B.3 Workflow integrity (`ci.yml` on `main`)

- **Triggers:** `push` and `pull_request` on `[main]`, with **no `paths`/`paths-ignore`**.
- **No job-level `if:`, no `continue-on-error`, no `needs`, no matrix.** Every job reports on every PR.
- **Job names match the check names:**
  - `web-build` → `Next.js production build`
  - `mcp-server` → `MCP Server`
  - `db-migration-validation` → `Database migration validation`
  - `math-core-tests` → `Ephemeris / panchang tests`
  - `day-constructor-acceptance-db-tests` → `Day Constructor acceptance DB tests`
- **Scanner:** `web-build` runs step 4 `npm run build`, then step 5 `node scripts/check-palmistry-bundle.js`. The scanner calls `process.exit(1)` on any hit or when the build is missing. It exits 0 early only when `review-status.json` is `APPROVED`, which is by design.
- **Check sources:** on afbe520, f10e07b and 07a3ecd, all five CI check runs come from `github-actions` (app 15368). Vercel reports under different names: commit status `Vercel` and check `Vercel Preview Comments` (app 8329). Nothing else reports a status with a matching name.

### B.4 External change during the ticket

- At 12:08:46Z `ste277` marked #343 ready for review, and at 12:08:49Z merged it (squash, `e921f54`, single parent `afbe520`).
- Vercel then deployed `e921f54` to Production automatically (`dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, created 12:08:52Z).
- **This was not done by this ticket.**
- **Consistent with the protection:**
  - All 4 required checks on head `07a3ecd` had succeeded by 11:14:18Z.
  - With `strict=false` and 0 approvals, every rule was met, so no bypass was needed.
  - The merged tree matches the merge ref that CI tested (`git merge-tree afbe520 07a3ecd`).
  - A personal repo has no queryable audit log, so "no bypass" is inferred from every requirement being met.
- `#343` changed `ci.yml` only by adding one test step to the Ephemeris job. Job names, triggers and scanner wiring are unchanged on `e921f54`.

## C. CI stability (last 10 completed `CI` runs, latest attempts)

| Run | Event | Head | Next.js build | MCP Server | DB migration | Ephemeris | Day Constructor |
|---|---|---|---|---|---|---|---|
| 42807570300 | PR #344 | 6a35da0 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42804820274 | PR #343 | 07a3ecd | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42803840888 | push main | afbe520 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42801333679 | push main | 9163eea | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42795545367 | PR (#335 branch) | 1f9eb92 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42785052957 (att. 2) | PR #338 | 0c8d0d6 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42782322850 | push main | 9a487a9 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42780693488 | push main | 64fdbd2 | ✅ | ✅ | ✅ | ✅ | ❌ #323 |
| 42780020276 | PR #338 | 97d092e | ✅ | *not reported¹* | ✅ | ✅ | ❌ #323 |
| 42778400253 | PR #338 | 2e55a86 | ✅ | *not reported¹* | ✅ | ✅ | ❌ #323 |
| **Total** | | | **10/10** | **8/8** | **10/10** | **10/10** | 0/10 |

¹ These runs predate #337, which added the `mcp-server` job and merged at 08:11:26Z. Those heads' `ci.yml` had no such job, so this is explained and is not a failure.

**Failure classification:**
- **#323:** every Day Constructor failure in the latest attempts is exactly the three `DAILY RHYTHM …` assertions in `test/dailyGuidanceOrchestratorDb.test.ts`. The log signatures are identical across all runs.
- **#340:** attempt 1 of 42785052957 failed instead on `13. an edited item is accepted via the EXISTING … path`. That is the time-of-day issue tracked in #340, found by the independent reviewer.
- **Outcome:** Day Constructor is correctly excluded from the required checks. The probe run 42812403991 also passed all four candidates.

**Decision:** all three mandatory checks are stable. `Ephemeris / panchang tests` has no unexplained failures (10/10), so per §5 it **is required**.

## D. Applied configuration

### D.1 How it was applied

- **When:** 2026-11-10T12:02:12Z.
- **Mechanism:** `PUT /repos/ste277/aura-updated/branches/main/protection` (REST, through `gh api`), by `ste277`. No secrets were involved.
- **Payload:**

```json
{
  "required_status_checks": { "strict": false, "checks": [
    {"context": "Next.js production build", "app_id": 15368},
    {"context": "MCP Server", "app_id": 15368},
    {"context": "Database migration validation", "app_id": 15368},
    {"context": "Ephemeris / panchang tests", "app_id": 15368} ]},
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0,
    "dismiss_stale_reviews": false, "require_code_owner_reviews": false, "require_last_push_approval": false },
  "restrictions": null,
  "required_linear_history": false, "allow_force_pushes": false, "allow_deletions": false,
  "required_conversation_resolution": false, "block_creations": false, "lock_branch": false, "allow_fork_syncing": false
}
```

### D.2 Settings read back (12:02Z; unchanged at 12:14Z and when the reviewer checked)

| Setting | Value |
|---|---|
| Require PR before merging | ON, 0 approvals, code-owner review off |
| Required checks (source) | `Next.js production build`, `MCP Server`, `Database migration validation`, `Ephemeris / panchang tests` (all `app_id 15368`, GitHub Actions) |
| Day Constructor | not required |
| Require up to date (`strict`) | OFF |
| Enforce for administrators | OFF |
| Force pushes / deletions | OFF / OFF |
| Linear history / conversation resolution / signed commits | OFF / OFF / OFF |
| Required deployments | none |
| Lock branch / block creations / push restrictions | OFF / OFF / none |
| Rulesets | still `[]` |
| Repository settings (merge methods, auto-merge, etc.) | unchanged (compared against `repo.json`) |

### D.3 Administrator override policy

Admin enforcement is intentionally off because the repo has a single maintainer. That makes it an emergency escape hatch, **not** a way around CI in normal development.

**Administrator bypass is permitted only for an exceptional recovery situation where waiting for normal CI enforcement would materially worsen an active incident.** Any bypass must:
- be explicitly authorized;
- include a documented justification;
- identify the exact commit being merged;
- record which required checks were bypassed;
- receive a retrospective independent review;
- produce follow-up fixes where necessary.

No bypass was tested or performed in this ticket.

## E. Verification

### E.1 Disposable PR

- **PR:** ste277/aura-updated#345, "AURA-GOV-01: disposable branch-protection probe — DO NOT MERGE".
- **Branch and commit:** branch `gov01-protection-probe` was created at `afbe520`. One commit, `f10e07b`, adds only the new file `tmp/gov01-protection-probe.txt`. No code, workflow, test, dependency or config file was touched.
- **Auto-merge:** disabled for the whole repo (`allow_auto_merge=false`), and the PR never had an auto-merge request.

### E.2 Behaviour over time

| Snapshot | Draft | Required checks | `mergeStateStatus` / REST | Meaning |
|---|---|---|---|---|
| 12:03:07Z | yes | 4 in progress, all `isRequired=true` (github-actions); Day Constructor and Vercel `isRequired=false` | BLOCKED / blocked | Not conclusive on its own, because it was still a draft |
| 12:03:26Z, after `gh pr ready` | **no** | MCP and DB done; Next.js build and Ephemeris still running | **BLOCKED** / blocked | **This proves required-check enforcement.** The PR was non-draft, had no conflicts (`MERGEABLE`) and needed 0 approvals, so the pending required checks were the only thing left. |
| 12:14:25Z | no | all 4 SUCCESS; Day Constructor FAILURE (the 3 #323 assertions), not required | **UNSTABLE** / unstable | All required checks passed; the non-required failure doesn't block |

**Control evidence:**
- Drafts #343 and #344, with all checks finished, reported `UNSTABLE`, not `BLOCKED`. So in this repo, draft state alone doesn't produce `BLOCKED`.
- In the probe's CI run 42812403991 the scanner logged `[palmistry-bundle] OK: none of 8 Palmistry sentinels present …`.
- No required check stayed pending for good, and all four were recognized by exact name and source (`isRequired=true`).

**Limitations (P3, from the review):**
- `BLOCKED` doesn't name its cause.
- Only *pending* required checks were shown to block. A *failing* required check uses the same mechanism but wasn't tested directly.
- No merge was attempted, as the ticket required.

### E.3 Cleanup

- #345 was closed without merging at 12:14:50Z.
- Branch `gov01-protection-probe` was deleted at 12:14:52Z (now 404).
- `tmp/gov01-protection-probe.txt` is not on `main`.
- No temporary PR is left open. No other branch was touched.
- **Side effect:** Vercel's Git integration automatically created a **Preview** deployment for the probe branch (`dpl_4CRLHr3i9BhDL6jwLGtofESTtrvk`, GitHub deployment 7681545071, environment Preview). It is not Production, it can't be avoided without changing Vercel configuration, and it was left as is.

## F. Existing PR impact

| PR | State | Required checks | Merge state | New blocker? |
|---|---|---|---|---|
| #343 (MCP-02-I1) | Draft at about 12:05Z. Then marked ready and **merged externally by `ste277` at 12:08:49Z** (B.4) | all 4 SUCCESS on `07a3ecd` | `UNSTABLE` before the merge | No. It merged under the rule's normal path. |
| #344 (MOBILE-01-M1) | open, draft, head `6a35da0`, no auto-merge | all 4 SUCCESS | `UNSTABLE` (only Day Constructor failing) | No |

Neither PR was changed by this ticket.

## G. Independent review: **APPROVE WITH NOTES**

**Verified** (by an independent reviewer subagent with read-only access):
- the baseline;
- the CI history, re-derived across the 10 runs plus the probe run;
- workflow integrity and check sources;
- the live protection exactly matching the payload;
- the probe timeline;
- cleanup;
- the #343 merge meeting every rule;
- #344's state;
- rollback readiness;
- scope.

**Findings:**

| Sev | Finding | Disposition |
|---|---|---|
| P2 | `enforce_admins=false`, and the only actor is an admin, so protection depends on the admin following it | Intended (§6 policy, D.3). Follow-up 2 in §L. |
| P3 | Day Constructor also fails intermittently on #340, not only #323 | Corrected in C; supports keeping it non-required |
| P3 | #323 and #340 were called PRs in the review brief; they are issues | Correct wording used here |
| P3 | Vercel deploys Production on every push to `main` regardless of CI. `e921f54` reached Production at 12:10Z, before its push CI finished (Ephemeris at 12:15Z). | Outside branch protection. Recommended as the next action (J). |
| P3 | The probe created a Preview deployment of an unmerged branch | Recorded (E.3) |

**Remaining risks:**
- **A PR can edit its own `ci.yml`.** PR CI uses the merge ref's workflow, so binding checks to the GitHub Actions app doesn't stop a PR from hollowing out a required job. With 0 approvals, the maintainer's own review is the only guard.
- **A branch whose `ci.yml` lacks a required job never reports that check.** That leaves the PR blocked, which fails safe. Most branches pick up `main`'s jobs because PR CI runs on the merge ref.
- **`strict=false`:** a PR can merge even if it was tested against an older `main`.
- **No required reviews or conversation resolution:** intended for a single maintainer.

There are no P0/P1 findings.

## H. Rollback readiness

- **Original configuration:** no classic protection on `main` and no rulesets (`prot-before.json` = 404, `rulesets-before.json` = `[]`).
- **Possible rollback:** `DELETE /repos/ste277/aura-updated/branches/main/protection`, which restores the exact original state. A narrower fix (for example `PATCH …/required_status_checks` to remove one check) would usually be enough.
- **Risk of rollback:** `main` would again accept merges with failing or missing CI, including the Palmistry scanner.
- **Not executed.** Any change to or removal of this protection needs explicit authorization. Nothing has behaved unexpectedly, so no rollback is proposed.

## J. Next action (recommendation only, not executed)

**Make Vercel Production deployments of `main` wait for the required GitHub checks** (Vercel Deployment Checks on the `aura-updated` project, or an equivalent gate). This closes the gap seen today, where `e921f54` reached Production before its post-merge CI finished. It needs separate authorization to change Vercel settings.

## K. Evidence

`/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/gov01/` contains:
- `prot-before.json`, `rulesets-before.json`, `repo.json`, `repo-after.json`
- `runs.json`, `jobs.tsv`, `ci.yml`
- `payload.json`, `put-response.json`, `prot-after.json`, `prot-final.json`
- `snap1.txt`, `snap2.txt`, `snap3.txt`, `existing-prs.txt`, `q.graphql`

The reviewer's files are in `…/scratchpad/gov01-review/`.

## L. Future governance improvements (not authorized, follow-ups only)

1. Resolve #323 and #340, then consider making Day Constructor acceptance tests required.
2. Consider enforcing protection for administrators once the emergency recovery process is established.
3. Consider requiring branches to be up to date with `main`.
4. Consider required independent review approvals if the repository gains more maintainers.
5. Consider a dedicated Palmistry publication gate separate from the general Next.js build.

## Compliance

- **Not changed:** source code, workflows, tests, dependencies, Vercel, Neon, secrets or environment variables, repository visibility, collaborators or merge settings.
- **Not done:** no auto-merge or Auto-fix enabled, no deployment initiated, no admin bypass, no direct push to `main`, no change to Palmistry review status.
- #323 and #340 are still open. #344 was untouched; #343 was merged by the owner outside this ticket.
- **The only changes made:** one protection rule, and the disposable branch and PR, both cleaned up.
