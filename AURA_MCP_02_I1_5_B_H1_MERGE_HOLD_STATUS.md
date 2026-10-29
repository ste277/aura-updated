# AURA-MCP-02-I1.5-B-H1: Merge Hold Status

- **Date:** 2026-11-10, about 14:15 UTC
- **Mode:** read-only verification and documentation

**Nothing changed:** PR #346, its branch and worktree, the repository, CI, branch protection, Vercel and Production are all untouched. No `vercel curl` was used.

---

## 1. PR status and head

| Item | Value |
|---|---|
| PR | https://github.com/ste277/aura-updated/pull/346, **OPEN, draft** |
| Head | `63edaf8ce2809d99c1e0c7618803d56f574b09d3`. Commits: `e864cd4` (implementation), `63edaf8` (declaration guard). **Unchanged since review.** |
| Base | `e921f54974c443966cd7d35953e8f03635b9d0ef`, still equal to `origin/main` (no new commits on `main`) |
| Mergeability | `MERGEABLE` / `UNSTABLE` (only the non-required Day Constructor #323 job is red) |
| Auto-merge | **Disabled** (`null`). Auto-fix is also off. |
| Remote branch | `feature/aura-mcp-02-i1-5-b-node24` at `63edaf8` |
| Local branch and worktree | `.claude/worktrees/aura-mcp-02-i1-5-b`, `HEAD` at `63edaf8`, **clean** (0 changes) |
| Branch protection | Active. Required: `Next.js production build`, `MCP Server`, `Database migration validation`, `Ephemeris / panchang tests`. |

## 2. Verified evidence (unchanged)

**CI run `42824896128`** (merge ref `cba3e0b`, Node v24.22.2):
- All four required checks succeeded.
- **Ephemeris/Panchang:** 180 of 181 test files have per-test counts identical to the Node 20 baseline. The only difference is the guard's extra check.
- **Day Constructor:** 56/56 identical, failing only on the three #323 lines.
- **MCP stdio:** 40/40 on Node 24, and 40/40 on Node 20.20.2 in the compatibility job.
- **Remote MCP:** 67/67.
- **Palmistry scanner:** `OK: none of 8`.
- **Migration validation:** passed.

**Docker smoke test** (14:03–14:20 UTC):
- The image built on `node:24-alpine` (Alpine 3.24.4), and Prisma Client generation succeeded.
- The runtime container started (Node v24.22.2, non-root user).
- Routes: `/` 200, `/find` 200, `/api/health` 503 (no database), `/api/mcp` 404, metadata 404.
- These match the Node 20 baseline image exactly.

**Independent review:** APPROVE WITH NOTES. No P0 or P1.

**Full evidence:** `AURA_MCP_02_I1_5_B_NODE24_IMPLEMENTATION_REPORT.md`. Its sections 11, 14 and 17 record the substitution and the reviewer's condition that you acknowledge it.

## 3. Docker smoke-test substitution: formally acknowledged

The owner's decision, from the H1 ticket, recorded verbatim:

> The no-database Docker smoke-test substitution is accepted for I1.5-B merge-readiness purposes. This acceptance does not authorize Production changes or waive unrelated database safety requirements.

This satisfies the reviewer's sole remaining condition (the addendum in implementation report section 14).

## 4. Production baseline

Checked at 14:15 UTC, read-only:

| Item | Value |
|---|---|
| Active deployment | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, Ready, aliased to `aura-updated.vercel.app` |
| Source | `e921f54974c443966cd7d35953e8f03635b9d0ef` (`main`) |
| Health | `GET /api/health` returns `{"status":"ok","db":"connected"}` [200] (plain unauthenticated curl) |

## 5. Merge-freeze status

**ACTIVE.** The owner has directed that PR #346 stay unmerged until AURA-GOV-02-I0 security remediation is complete and the freeze is explicitly lifted.

Local GOV-02 reports, read as data:

| Report | Status |
|---|---|
| `AURA_GOV_02_I0_A_PREVIEW_CONTAINMENT_REPORT.md` (19:32 local) | Verdict **PARTIALLY CONTAINED — EXISTING DEPLOYMENT RISK**. New Preview builds no longer get Production credentials, but retained historical Preview deployments keep the previously exposed values. It says the remedy is I0-C rotation (revoking the old credentials) or deleting those deployments, either needing owner approval. |
| `AURA_GOV_02_I0_B_ROTATION_READINESS_REPORT.md` (19:33 local) | A rotation **readiness** plan (Neon role and Resend key procedures). It describes an I0-C window that includes announcing a merge freeze and merging a docs-only rollout PR. |
| I0-C (rotation executed) | **No report found.** Rotation and revocation haven't been confirmed complete. |

## 6. Outstanding security dependency

PR #346 is blocked on **GOV-02-I0-C**, which is all of:
- the Neon credential rotated and the old role revoked;
- the Resend key rotated and the old key revoked;
- Production verified on the new credentials;
- the residual exposure from historical Previews confirmed closed.

Then the **owner must explicitly lift the freeze**.

**Sequencing:** the GOV-02 plan uses its own docs-only PR as the Production rollout candidate during the I0-C freeze window. **PR #346 must not be merged before or during that window.** Doing so would trigger a Production build, including `prisma migrate deploy`, on whichever credentials are active at that moment, and would confound GOV-02's rollout verification.

## 7. Deferred follow-ups

These are separate technical debt and must **not** be added to PR #346:

| ID | Item | Notes |
|---|---|---|
| F1 | Prisma 5.22 OpenSSL detection on Alpine | Engines can't load in the build stage on both `node:20-alpine` and `node:24-alpine` (no `openssl` binary, so detection falls back to 1.1.x). Doesn't affect runtime today. Candidate fixes: `apk add openssl` in the build stage, or `binaryTargets`. amd64 unverified. |
| F2 | Build-time `/api/health` behaviour | Vercel Preview and Production builds prerender `/api/health`, which runs `SELECT 1` against the shared `DATABASE_URL` at build time. In the Docker runtime it evaluates live. Coordinate with GOV-02's runtime health-check design. |
| F3 | Guard-test parser hardening | `test/seededFixtureReproducibility.test.ts` splits jobs with a key-format regex and matches the compatibility job by display name. Make it more robust in a scoped change. |

## 8. Future merge authorization checklist

All of these must be satisfied **before requesting** merge permission. Passing them doesn't by itself authorize a merge.

**Security gate:**
- [ ] GOV-02-I0 Production credential rotation completed
- [ ] Previously exposed credentials revoked and invalidated
- [ ] Production health verified after rotation
- [ ] No unresolved critical credential exposure remains
- [ ] Owner explicitly lifts the merge freeze

**Repository gate:**
- [ ] Re-fetch `origin/main` and record its SHA. If it is no longer `e921f54`, assess the changes and decide whether the PR needs updating against `main`.
- [ ] PR head still `63edaf8` (or a reviewed successor); diff limited to the 8 I1.5-B files
- [ ] No unrelated changes in the PR
- [ ] Branch protection active with the same four required contexts
- [ ] The four required checks pass for the current merge candidate (re-run CI if `main` moved)

**Application gate:**
- [ ] Remote MCP disabled: no `AURA_MCP_*` variables, and the MCP routes return 404
- [ ] Palmistry unpublished: `review-status.json` `PENDING_HUMAN_REVIEW` / `approvedBy: null`, scanner OK
- [ ] Production health 200
- [ ] The Node 24 evidence still applies (no dependency or runtime changes on `main` that invalidate it)
- [ ] No new P0 or P1 review findings

**Authorization gate:**
- [ ] Explicit owner approval for the controlled squash merge of #346

## 9. Final verdict

**MERGE READY — SECURITY HOLD ACTIVE**

Technical verification for PR #346 remains valid: the head, base, CI evidence and review are unchanged, and the Docker substitution is now acknowledged. GOV-02 credential remediation (I0-C) is incomplete, and the owner's merge freeze is in effect. PR #346 stays a draft and unmerged.
