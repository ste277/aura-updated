# AURA-GOV-02-D2: Decision Report

**Date:** 2026-11-10 · **Design:** `AURA_GOV_02_D2_SECURITY_AND_DEPLOYMENT_DESIGN.md` · **Mode:** read-only. No implementation occurred.

## 1. Final verdict

# AURA-GOV-02-D2: READY FOR IMPLEMENTATION AUTHORIZATION

- All five D1 P1 blockers (R-1..R-5) and both round-1 D2 P1s (V-1, V-2) are resolved in the design.
- All D1 P2/P3 findings (R-6..R-17) and D2 review findings (V-3..V-17, N-1..N-5) are dispositioned.
- The independent review (round 2) gave **APPROVE WITH NOTES**, with no unresolved P0/P1.
- Capabilities the design relies on but that aren't documented are listed as [ASSUMPTION]s. Each has a **hard-gate proof test** and a fail-closed fallback:
  - environment write-ability;
  - self-approval;
  - re-run re-approval;
  - variable precedence;
  - `readySubstate` and `lastRollbackTarget` semantics;
  - whether `vercel promote` re-enables auto-assign;
  - Prisma transaction behaviour.

**This verdict does not authorize implementation.**

## 2. Remaining blockers and open risks

| Item | Status |
|---|---|
| **LIVE EXPOSURE (V-1).** Preview deployments of `aura-updated` currently receive the **Production** `DATABASE_URL`, 16 other Production database and Neon variables, and the Production `RESEND_API_KEY`. Any branch push by a write collaborator can read them during a Preview build. They have targeted Preview since 2026-08-14. | **Open until GOV-02-I0 is executed.** Not closed by this design approval. Recorded as an open risk. |
| Implementation-time hard gates: T-I1-1..7, T-I2-1..5, T-I3-6..11, T-I4-3/6 | Must pass in their phases; each has a STOP or fallback |
| Merge gate must be proven (T-I1-1..4) | If not provable, STOP before I2–I4 and the owner decides (§6.2) |
| If `vercel promote` re-enables auto-assign | Automated promotion is not activated; promotion stays owner-manual (N-3) |
| Accepted design limits | G-D1 (no pre-promotion runtime probe without an SSO bypass), G-D3 (post-merge CI is the real gate), G-D5 (one owner click per promotion), G-D4 (unused Production database variables, deferred) |

## 3. Owner decisions required

1. **Authorize GOV-02-I0 now, separately** (Preview credential purge). Choose:
   - **(a) purge** the Preview target from the 18 variables (recommended), or
   - **(b)** a dashboard-only Ignored Build Step that skips non-production builds.
2. **Rotation vs risk acceptance for I0:**
   - rotate the Production Neon credential (new role) and the Resend key using the N-2 sequence, which needs one owner-approved git deploy to Production; **or**
   - record a formal risk acceptance for the exposure since 2026-08-14.
3. **Preview email (I2):** a restricted separate Resend key (recommended), or no Preview email.
4. **T-I1-2/T-I1-7 test actor:** Greenaroz's cooperation, or a temporary test account invited as a write collaborator.
5. **Accept the design limits** G-D1, G-D3 and G-D5. G-D4 is a later ticket.
6. **I1.5-C amendment** (separate ticket): switch staging to the shared identity guard (§14).

## 4. Proposed implementation order

| Phase | Purpose | Key gate |
|---|---|---|
| **GOV-02-I0** | Purge Production credentials from Preview; rotate or accept | Production healthy; Preview has none of the 18 variables |
| **GOV-02-I1** | Ruleset (owner approval), CODEOWNERS, `production-promote` environment (no secrets yet), `permissions: {}` | T-I1-1..7: a non-owner can't merge or obtain environment secrets or write environment state |
| **GOV-02-I2** | `aura-preview` Neon project, Preview variable split, shared identity guard (build and runtime), restricted Preview email | Negative identity test fails before any database statement |
| **GOV-02-I3** | Promote job in dry-run; health/live endpoint; migration lint; log masking; environment secrets; `PROMOTION_STATE=FROZEN`; marker row `production` (authorized Production write) | Dry-run correct on ≥2 real merges; T-I3-6..11 |
| **GOV-02-I4** | Merge freeze → auto-assign off (build still migrates) → staged proof → manual promote → OPEN → activation PR → negative tests → lift freeze | Live deployment changes only at steps 7 and 8, with read-backs |

Each phase needs its own authorization, its own independent review, and stops at its STOP conditions.

## 5. Explicit next authorization request

**Request: authorize AURA-GOV-02-I0, the Preview Production-credential purge, now**, with the owner's choice of (a) purge or (b) Ignored Build Step, and (rotate) or (accept risk).

I0 is pure risk reduction, independent of the rest of GOV-02, and puts no credentials into GitHub Actions.

GOV-02-I1..I4 should be requested afterwards, one at a time.

## 6. Confirmation that no implementation occurred

**Not changed:**
- GitHub branch protection, rulesets, collaborators, CODEOWNERS, environments or workflows (re-verified by the reviewer: classic rule identical to GOV-01, 0 rulesets, environments unprotected);
- Vercel settings (auto-assign still on), environment variables (23 entries unchanged) or projects;
- Neon databases or URLs;
- deployments (Production still `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, `e921f54`);
- deployment scripts or source code.

**Not done:**
- no tokens created;
- no `vercel curl`, no bypass secrets (count 0);
- no commits, pushes, merges or branch deletions;
- the primary checkout, untracked reports, the stash and worktrees were preserved;
- remote MCP is still disabled (404);
- Palmistry is still pending;
- no I1.5 staging work; MCP-02-I2 not started.

**What I did:** read-only `git`, `gh api` GET and field-filtered `vercel api` GET calls (credential values never printed), documentation reads, and two independent review rounds.

Both reports are written locally and are not committed.
