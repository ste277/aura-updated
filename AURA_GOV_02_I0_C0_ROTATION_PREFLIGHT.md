# AURA-GOV-02-I0-C0: Production Credential Rotation Preflight

**Date:** 2026-11-10 · **Repository:** `ste277/aura-updated` · **Vercel project:** `aura-updated` (`prj_iY4xteQOWUNsV85NnbyIylBAba6t`)
**Mode:** preflight only. No credential, setting, deployment or file was changed.

## 1. Executive summary

**Verdict: PREFLIGHT BLOCKED.** Two critical dependencies can't be verified yet:

1. **Self-hosted Production is live, and its credential linkage is unknown.**
   - `https://aura.voyforge.com` returns 200 (Next.js behind Cloudflare) and reports `{"status":"ok","db":"connected"}`.
   - Repository config says it uses its own Postgres container, MOM email and its own `AUTH_SECRET`. But its server-side `/srv/aura/app.env` can't be inspected, and the owner doesn't know its contents or who has server access.
   - If it uses the Neon Production database or the Vercel Resend key, the planned revocation would break it.
   - **Status: SELF-HOSTED DEPLOYMENT STATUS UNKNOWN** (credential linkage).
2. **The Neon login-role inventory isn't established.** The owner hasn't yet checked the Production branch's Roles page. Under the I0-B design, rotation can't be planned without knowing every exposed role.

**Ready:**
- the merge freeze (owner-confirmed, Greenaroz notified);
- containment state unchanged since I0-A;
- Production healthy;
- the dependency matrix for Vercel consumers;
- `AUTH_SECRET` impact;
- the rollback model;
- the local-copy inventory.

The execution plan is complete except for the two blockers.

## 2. Baseline (2026-11-10T14:11:07Z)

| Item | Value |
|---|---|
| Remote | `https://github.com/ste277/aura-updated.git` |
| `origin/main` | `e921f54974c443966cd7d35953e8f03635b9d0ef`, tree `c5e1240a4ddbf879fb6389144c04b62cbc4a3f4b` (unchanged at 14:18:37Z) |
| Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, READY, `source=git`, SHA `e921f54` |
| Health | `/` → 200; live database read (`/moment/<nonexistent>`) → `NOT_FOUND` (query succeeded) |
| Env | 23 entries. **All 19 in-scope variables are Production-only.** Only `AURA_SHADOW_POLICY_MODE`, the Preview `AUTH_SECRET` entry and `RESEND_FROM_ADDRESS` target Preview. Project `updatedAt` = the last I0-A edit (13:50:53Z). |
| Safety | `protectionBypass` 0; auto-assign `true`; `/api/mcp` → 404; Palmistry `PENDING_HUMAN_REVIEW` |
| Open PRs | #346 (draft, `feature/aura-mcp-02-i1-5-b-node24`), #344 (draft, `feature/aura-mobile-01-m1`); no migrations in either |
| In flight | 0 running or queued Actions runs; latest deployment 13:28:54Z (Preview, #346) |
| Local state | Untracked reports, worktrees, branches and the stash preserved; nothing modified |

## 3. Merge freeze

- **Status: CONFIRMED by the owner** ("Active, Greenaroz told"). Recorded at **2026-11-10T14:18:37Z**, baseline SHA **`e921f54`**.
- **Procedural only:** it isn't technically enforced, because no branch-protection or permission change is authorized.
- **Rules until explicitly lifted:** no merges or pushes to `main`; no manual Production deploys; no Production env, migration or deployment-setting changes.
- **Monitoring:** `main` was unchanged between 14:11Z and 14:18Z. Every later ticket starts with a check that `main` = `e921f54` and that no new Production deployment exists; any change is a STOP.

## 4. Self-hosted `deploy/` findings

| Question | Repository evidence | Runtime evidence | Status |
|---|---|---|---|
| Active? | README: "Aura runs on the shared Hetzner box `vf-1`"; Cloudflare → nginx → `aura-app` (127.0.0.1:3001); releases track `v*` tags (`v1.0.0`, `v1.1.0`, both 2026-08-17) | **Yes:** `aura.voyforge.com` → 200, `x-powered-by: Next.js`, Cloudflare; `/api/health` → `{"status":"ok","db":"connected"}`; `/moment/<x>` → 404 (route added after `v1.1.0`, consistent with an old release) | **ACTIVE (verified)** |
| Connects to Production Neon? | `compose.yml` runs its own `postgres:16-alpine` (`db` service); README `app.env`: `DATABASE_URL=postgresql://aura:<pw>@db:5432/aura` | Can't see `app.env` | **UNKNOWN** |
| Which Neon roles? | None per config | — | **UNKNOWN** |
| Email provider | README: `MOM_API_KEY`, `MOM_FROM_EMAIL=aura@voyforge.com` | — | Config says MOM; **runtime unverified** |
| Same Resend key? | Not referenced in its README | — | **UNKNOWN** |
| Uses the Vercel `AUTH_SECRET`? | README: its own `openssl rand -hex 32` | — | Config says its own; **unverified** |
| Background jobs | `backup.sh` cron 03:30 (local `pg_dump`); no reminder cron in `deploy/` | — | Config only |
| Could rotation interrupt it? | Not if config matches runtime | — | **UNKNOWN until `app.env` is checked** |
| Who has access? | Built by Greenaroz (PRs #12–#16); the box also hosts "Parley" | Owner: "not sure" | **OPEN** |

**Separate observation (outside I0 scope, owner awareness):** `aura.voyforge.com` is a **second public Production surface**:
- it runs an old release, outside Vercel, outside GOV-01/02 governance;
- its own user database and email sender;
- server access unclear.

It deserves its own governance ticket: keep it and govern it, or decommission it.

## 5. Credential dependency matrix

| Credential | Consumer | Environment | Rotation impact | Verification |
|---|---|---|---|---|
| Neon login role(s) for Production | Vercel runtime (`lib/db.ts` pool); Vercel build (`prisma migrate deploy` via `schema.prisma` `DATABASE_URL`); daily cron route (currently fails closed: `INTERNAL_REMINDER_DISPATCH_SECRET` unset); operator `scripts/retention-report.js` (reads `.env.local`); **possibly self-hosted (UNKNOWN)** | Vercel Production; local; vf-1 (?) | Old-role revocation cuts every consumer still using it | Neon role list; `pg_stat_activity.usename` after cutover shows only the new role (plus Neon-internal) |
| `DATABASE_URL` (`3Q4UaRKHCFs1ZAvD`) | as above | Production | Replace; needs a new deployment | Build "No pending migrations"; dynamic database probe; Neon session user |
| Other PG/POSTGRES/NEON variables (17) | **No application consumer** (only `ci.yml`'s and `deploy/compose.yml`'s own local Postgres); `pg` would fall back to `PG*` only if `DATABASE_URL` were incomplete | Production | Delete from Production at I0-C (recommended) so no stale credentials remain | Env read-back |
| `RESEND_API_KEY` (`9wIWbQWLA3QdQ288`) | `lib/email.ts`, `api/auth/request-link`; **self-hosted: config says MOM (unverified)** | Production | Replace, then revoke the old key | Owner receives a magic link |
| `AUTH_SECRET` Production (`5zHVNkKL8cSkGHcn`) | `lib/auth.ts` `sign`/`verify`/`hashAuthCode`: sessions, magic links, auth codes, guest-state, Day Constructor preview and recomposition tokens | Production | Replace; all signed tokens are invalidated | Fresh sign-in works; old session cookie rejected |
| Local plaintext copies | §10 | developer machine | Become dead after revocation | §10 cleanup |

## 6. Neon role inventory

| Item | Status |
|---|---|
| Production Neon project and branch identity | **Not yet recorded.** The owner identifies it in the Neon console (the project whose endpoint serves Production). The Vercel `NEON_PROJECT_ID` value can't be read back (sensitive). |
| Existing login roles | **Not checked** ("Haven't checked") → **BLOCKER** |
| Roles referenced by Production config | Unknown. Sensitive values can't be read back. An earlier review's local-mirror analysis suggested up to **three** distinct users across the variables. |
| Roles possibly exposed | **All** login roles on the Production branch (I0-B §11.2) |
| Schema owner | Likely the console default owner role; to be confirmed with `SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' GROUP BY 1;` (read-only, owner) |
| Privileges for Prisma `migrate deploy` | Connect plus ownership of the affected objects for DDL; read and write on `_prisma_migrations` |
| Separate runtime and migration roles | Practical later (GOV-02-I3 introduces `PROD_MIGRATION_DATABASE_URL`). For I0-C, keep one new role with owner membership for parity (simplest safe cutover). |
| Session termination at revocation | Required: `pg_terminate_backend` by `usename` (login user) for old roles after Reset password |
| Invalidation verification | An old credential fails to connect, including after a compute restart; `pg_stat_activity` shows no old-role sessions |

## 7. Resend dependencies

- **Vercel:** `RESEND_API_KEY` Production-only; `RESEND_FROM_ADDRESS` (non-secret, Production and Preview).
- **Preview email:** disabled (D-3).
- **Self-hosted:** configured for MOM per README; whether it also holds the Resend key is **unknown**.
- **Local copies:** the old key sits in `apps/web/.env.production.local` and possibly `.env.local` (per the I0-D review; not re-read).
- **Rotation:** a new sending-only key restricted to the domain. Revoke the old key only after the email check and after the self-hosted linkage is confirmed.

## 8. `AUTH_SECRET` impact

| Token | Lifetime | Effect |
|---|---|---|
| Session cookie `as_session` | 30 days | **Every user is signed out** |
| Magic link | 15 min | Outstanding links fail |
| Sign-in code (HMAC stored in `AuthCode`) | 15 min | Outstanding codes fail |
| Guest-state token | 30 min | Lost |
| Day Constructor preview and recomposition proposal tokens | until used | In-flight ones fail (`PREVIEW_TOKEN_INVALID`); the user regenerates |

- No long-lived stored token depends on it. Push subscriptions, public moment links and reminder links don't.
- **The self-hosted stack has its own secret per config (unverified).** If it shared the Vercel value, rotating on Vercel wouldn't affect it, but its copy would remain an exposed secret on vf-1.
- **Communication:** optional in-app or email notice ("you'll be asked to sign in again"). Pick a low-traffic window.

## 9. Historical Preview exposure

- **146 retained non-production deployments (145 READY)** still carry the old values in their runtime environment, behind Vercel SSO (team-only).
- Vercel login protection limits access but doesn't neutralise copies made during builds (install scripts, build code; I0-A F-13).
- **Deletion:** possible through the API; no Production impact; loses historical Preview URLs. Active testing uses the latest Previews of #344 and #346, which were built before 13:50Z and also carry the credentials.
- Deletion adds **little** once revocation is verified. It's worthwhile only if revocation is delayed.
- **The primary remedy remains verified revocation.** The exposure stays **unresolved until then**.

## 10. Local plaintext credential inventory (paths only; contents not read)

| Path | Git-ignored | Ever committed | mtime |
|---|---|---|---|
| `.env.local` (repo root) | yes | no | 2026-08-14 |
| `apps/web/.env.local` | yes | no | 2026-10-09 |
| `apps/web/.env.production.local` | yes | no | 2026-09-22 (Vercel CLI pull) |
| `apps/web/.env.development.local` | yes | no | 2026-10-02 |
| 15 worktree `.env.local` files under `.claude/worktrees/*` (list in `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/i0c0/env-files.txt`) | yes | no | 2026-09-02 … 2026-11-10 |

- `.gitignore` covers `.env`, `.env.local` and `.env*`.
- **Local consumers:** `playwright.config.ts` and `e2e/fixtures/cleanup.ts` (database cleanup), `apps/web/scripts/retention-report.js`. Run against Production by mistake, the cleanup could **delete Production data**.
- **Risk after rotation:** stale old values are dead once revoked. The real risk is someone copying the **new** values into these files.

**Recommended cleanup** (owner, after I0-C revocation):
1. Delete `apps/web/.env.production.local` and the root `.env.local` (Aug 14 CLI artefact).
2. Rewrite each remaining `.env.local` to point only at local or dev databases.
3. Never `vercel env pull` Production again (already banned).
4. Optionally have local scripts refuse to run when `DATABASE_URL` matches the Production host hash.

## 11. Remaining blockers

| # | Blocker | Who resolves | How |
|---|---|---|---|
| B-1 | Self-hosted `app.env` credential linkage unknown (database, Resend, `AUTH_SECRET`) | Owner, or whoever has vf-1 access | On vf-1, check **key names and host** only (for example, whether the `DATABASE_URL` host is `db` and whether `MOM_*`/`RESEND_*` keys are present). Report yes/no to the four questions in §4, without values. |
| B-2 | Neon Production role inventory not checked | Owner | Neon console → Production project → branch → Roles: report the **count** and which role owns `public` tables (read-only query §6) |
| B-3 (open, non-blocking) | Who has vf-1 access | Owner | Clarify. Recommended as its own governance ticket. |

## 12. Independent review

The reviewer was an independent read-only subagent. It read no `.env` contents and changed nothing. It briefly saved the raw `/v9/projects` response to scratch, printed only named fields, and deleted it; `protectionBypass` is empty.

It recommended **PREFLIGHT REVISION REQUIRED, still blocked on owner input**. The revisions below are now applied, and the remaining state is **BLOCKED on owner inputs**.

**Live verification by the reviewer (14:20–14:27Z):** nothing changed since 14:11Z.
- `main` = `e921f54`; Production `dpl_mYJA…`; no deployment after 13:28:54Z; 0 runs in progress or queued.
- Project `updatedAt` = 13:50:53.718Z; env unchanged (19 Production-only); bypass 0; protection unchanged.
- `aura.voyforge.com` isn't a Vercel domain.
- **Scope compliance confirmed.**

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| F-1 | **P1** | B-1 could deadlock: only someone with `vf-1` access can clear it, and access is unknown. Meanwhile the exposed credentials stay valid. | **Fixed:** B-1 now has three clearing routes (§13.1) |
| F-2 | P2 | `aura.voyforge.com/api/health` (a live `SELECT 1`, returns error text) isn't used as a canary during revocation | **Fixed:** added to the execution plan §6 (§13.2) |
| F-3 | P2 | After Instant Rollback, Vercel turns off auto-assign, so a fix-forward commit won't go live without an explicit promote | **Fixed:** execution plan §7 (§13.3) |
| F-4 | P2 | A second production deployment during the overlap makes `dpl_mYJA…` unreachable for a Hobby rollback | **Fixed:** STOP condition (§13.3) |
| F-5 | P2 | Overlap conditions missing: no old-role sessions for ≥15 min (pooler idle); no second production deployment | **Fixed** (§13.4) |
| F-6 | P3 | Five `apps/web/.next/standalone/.env` build artefacts in worktrees are missing from the inventory | **Fixed** (§13.5) |
| F-7 | P3 | `v1.1.0` `email.ts` **falls back to Resend** when only `RESEND_API_KEY` is set, so "README says MOM" isn't enough | **Fixed:** B-1 question reworded (§13.1) |
| F-8 | P3 | `v1.0.0` and `v1.1.0` have identical routes | **Fixed:** "a v1.x release; exact tag unknown (vf-1 `deploys.log`)" |
| F-9 | P3 | The non-required Day Constructor job fails on `main` (#323/#340) | **Noted:** not a STOP for I0-C |
| F-10 | P3 | The freeze isn't monitored between tickets | **Fixed:** extra read-only check of `main` and deployments immediately before env entry (step 5) and PR creation (step 6) |
| F-11 | P3 | B-2 is a simple owner console task | **Noted:** record privately role names, `rolcanlogin`, the `public` table owner, and the endpoint form |
| F-12 | P3 | Second public surface: real sign-ins, its own user data, about 39 migrations behind, the health route leaks `err.message` | **Strengthened:** the separate governance ticket is a named follow-up (govern or decommission) |

**Reviewer's other evidence:**
- `aura.voyforge.com/api/health` is computed per request (`cf-cache-status: DYNAMIC`), so "db connected" proves that *some* `DATABASE_URL` is reachable, not which one.
- `deploy.sh` migrates only the local `aura-db` container, which is strong design intent but not proof.
- A matching `AUTH_SECRET` on `vf-1` couldn't break `vf-1` when Vercel rotates; it would only leave a dead copy there.

## 13. Revisions (supersede the referenced sections)

### 13.1 B-1: three clearing routes (F-1, F-7)

The owner chooses **one**:
- **(a) Key-name check on vf-1** (whoever has access). Report yes/no only:
  - Is the `DATABASE_URL` host `db`?
  - Is `RESEND_API_KEY` present?
  - Are **both** `MOM_API_KEY` and `MOM_FROM_EMAIL` present?
  - Is `AUTH_SECRET` present?
- **(b) Neon-side evidence during the overlap.** After the Vercel cutover, with old roles still valid:
  1. Idle more than 10 s (the `pg` pool idle timeout).
  2. Request `https://aura.voyforge.com/api/health`.
  3. Check `pg_stat_activity` for a *new* backend (by `backend_start`) under any **old** role.

  None means `vf-1` doesn't use Production Neon. For Resend, (b) can't prove anything, so revoking the old Resend key also needs (a) or (c). Caveat: pooler-held connections can mask it, so require the ≥15-minute quiet period (§13.4).
- **(c) Explicit owner risk acceptance**, recorded in the report: "Revoke even if `vf-1` loses its database or email. `vf-1` is to be governed or decommissioned under its own ticket."

  Justification: leaving exposed Production credentials valid is worse than possibly interrupting an ungoverned surface. A `vf-1` copy of the credentials would itself be another exposure.

### 13.2 Revocation canary (F-2)

Record `aura.voyforge.com/api/health` before revocation. Re-check it after each Neon Reset password, after session termination, and after the compute restart. If it changes to 503, **STOP and report**: `vf-1` was using that credential. Its error text identifies the failure without printing secrets.

### 13.3 Rollback corrections (F-3, F-4)

- After any Instant Rollback, Vercel sets auto-assign to `false` (expected and documented). Going live again needs an explicit **promote** by the owner, as a separate step. Baseline checks expect `autoAssignCustomDomains=false` after a rollback.
- **STOP:** no second successful production deployment during the overlap. Otherwise `dpl_mYJA…` stops being the Hobby "previous" deployment and the fast rollback is lost, unless the owner accepts that. After any failed build, re-confirm by API which deployment counts as previous.

### 13.4 Overlap conditions (F-5)

The overlap is ≥ 1 hour **and** all of these hold:
- (a) the execution plan's §4 checks pass;
- (b) real traffic is served through the new role;
- (c) no runtime errors;
- (d) B-1 is cleared by route a, b or c;
- **(e)** no old-role sessions in `pg_stat_activity` for ≥ 15 min after the cutover;
- **(f)** no second production deployment.

### 13.5 Local copies addendum (F-6)

Add five build artefacts: `.claude/worktrees/{agitated-swanson-bb3539, daily-briefing-db2-api-home, daily-briefing-db3-insights, daily-briefing-db4-polish, hpg1-activity-identity}/apps/web/.next/standalone/.env`.
- 131–151 bytes, 2026-10-21 … 10-27, git-ignored, untracked. Contents not read.
- **Cleanup:** delete those `.next` directories.
- Confirmed by the reviewer: no `.env*` file other than `.env.example` was ever added in any git ref, stash or archive.

### 13.6 Updated blockers

| # | Blocker | Clears when |
|---|---|---|
| **B-1** | Self-hosted credential linkage | The owner picks route (a), (b) or (c). Route (b) clears only the database side; Resend revocation needs (a) or (c). |
| **B-2** | Neon role inventory | The owner reports the role count and the `public` table owner (names kept private) |

### 13.7 B-1 resolution (owner, 2026-11-10)

**B-1: OWNER ACCEPTED — TEST DEPLOYMENT DISRUPTION RISK.**

The owner's statement:
- `aura.voyforge.com` was created for testing and isn't a Production service to be maintained;
- the owner explicitly accepts that rotating the exposed Neon, Resend or authentication credentials may disrupt this legacy test deployment;
- exposed credentials are **not** to be kept valid to preserve it;
- no further `vf-1` investigation is needed for availability purposes.

**Not authorized** by this statement: rotation, changes to `vf-1`, or shutting the test site down.

**Effects on the plan:**
- The revocation canary (execution plan §9a) is kept as **observation only**. A 503 from `aura.voyforge.com` is recorded, not a STOP.
- Overlap condition (d) is satisfied.
- Revoking the old Resend key no longer depends on `vf-1`.

**Remaining blocker: B-2** (Neon role inventory).

**Supersession pointer (R-3):** §1, §11, §13.2 (the canary 503 "STOP") and §13.6 are superseded by this section where they show B-1 as open. §13.4(e) is reworded per execution plan §9b: persistent old-role sessions are recorded and don't block.

### 13.8 B-2 status and re-review

- **B-2:** the owner couldn't check yet (role count, `public` table owner, whether the owner role can log in: "can't check now / not sure"). **Still open.**
- **Re-review (same independent reviewer, read-only):**
  - F-1 to F-12 are reflected; B-1 acceptance is recorded correctly; no credentials are kept for `vf-1`'s sake.
  - **No design-level P0/P1 remains.** R-1 and R-2 (P2) and R-3 (P3) are fixed as above.
  - Live state unchanged at 14:35:00Z: `e921f54`; `dpl_mYJA…`; project `updatedAt` 13:50:53.718Z; no new deployments.

### 13.9 B-2 resolution (owner, Neon console, 2026-11-10)

| Item | Owner's result |
|---|---|
| Login roles on the Production branch | **1** |
| Owners of `public` tables | **1** |
| Can the table-owning role log in? | **Yes** |

So the single login role **is** the schema owner, and it is the exposed credential. Names are kept private.

**Plan consequences (execution plan §2 and §6):**
- `<old_role>` = `<owner_role>` = that one role.
- The new role gets `GRANT <owner_role> TO <new_role>; ALTER ROLE <new_role> SET ROLE <owner_role>;`.
- **Reset password applies to exactly one role.** Ownership and the new role's membership are unaffected by a password reset.
- **Reconciliation target at close:** login roles = {owner role (password reset), new role}, plus any Neon-managed roles classified, not reset.
- **Note:** an earlier review's local-file analysis suggested up to three distinct user labels across variables. With one login role on the branch, the other labels are most likely pooler or endpoint-qualified forms of the same role, or variables pointing elsewhere. The I0-C step-1 check (`SELECT rolname, rolcanlogin FROM pg_roles WHERE rolcanlogin`) confirms this privately before any change. If more than one login role appears, **STOP** and update the plan.

### 13.10 Revalidation (2026-11-10T15:01:09Z)

| Check | Result |
|---|---|
| Merge freeze | `main` = `e921f54` (unchanged since the 14:18:37Z baseline); 0 Actions runs in progress; open PRs #346 (`63edaf8`) and #344 (`6a35da0`) are drafts with unchanged heads |
| Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` (`e921f54`); no deployment since 13:28:54Z (a Preview) |
| Health | `/` → 200; live database read → `NOT_FOUND` (query OK); `/api/mcp` → 404 |
| Vercel config | Project `updatedAt` 13:50:53.718Z (unchanged); 23 env entries; all 19 in-scope Production-only; Preview-targeted only `AURA_SHADOW_POLICY_MODE`, `AUTH_SECRET` (Preview entry), `RESEND_FROM_ADDRESS`; bypass 0; auto-assign `true` |
| Palmistry | `PENDING_HUMAN_REVIEW` |

## R2 — Verified Neon Role Reconciliation (2026-11-10)

**This supersedes §13.9.** "1 login role" there was the owner's count of user-visible roles. Direct SQL (`pg_roles WHERE rolcanlogin`) shows four roles that can log in.

**I0-C status: paused** by the R2 ticket.
- No owner rotation step should have been executed. The owner is asked to confirm whether a Neon role was created after the 15:10Z instructions.
- Vercel shows no change: the latest env `updatedAt` is still 13:50:53Z.

### R2.1 Owner-verified evidence

| Query | Result |
|---|---|
| A. Login-enabled roles | `cloud_admin` (superuser), `neon_auth` (no-inherit), `neon_service`, `neondb_owner` |
| B. `public` table owners | `neondb_owner`: **25 tables**, can log in |
| C. SQL Editor identity | `session_user` = `current_user` = `neondb_owner` |

### R2.2 Baseline (2026-11-10T15:18:29Z)

- `main` = `e921f54`; Production `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`; no deployment since 13:28:54Z (a Preview); #346 open, draft, `63edaf8`.
- `/` → 200; database read OK; `/api/mcp` → 404; Palmistry pending.
- 19 variables Production-only; project and env `updatedAt` 13:50:53Z; bypass 0; auto-assign `true`.
- **Freeze holding.**

### R2.3 Role classification (Gate R1)

| Role | Class | Evidence | In app connection strings? | Exposed via Preview? |
|---|---|---|---|---|
| `cloud_admin` | **Neon-managed internal** (control-plane superuser; reserved name) | Neon "Manage roles": listed among reserved role names; users "can't connect using the Postgres superuser account" | **No** (INFERRED: no user-obtainable password) | No (INFERRED) |
| `neon_service` | **Neon-managed internal** | Neon: credentials "managed by Neon", "not intended for you to use or modify" | **No** (INFERRED) | No (INFERRED) |
| `neon_auth` | **Neon-managed feature role** (Neon Auth). `rolinherit=false`. | Neon Auth stores data "under the neon_auth schema"; `NEON_AUTH_BASE_URL`/`VITE_NEON_AUTH_URL` are documented as auth **endpoints**, not database credentials | **No** (INFERRED) | **UNKNOWN**: the docs don't say whether any Neon Auth secret reached Vercel. No such variable exists in the inventory (only URLs), and the app has no Neon Auth code. |
| `neondb_owner` | **User or project role; schema owner** (25 `public` tables); member of `neon_superuser` (CREATEROLE, CREATEDB, BYPASSRLS) | Query B; Neon: the project role and console roles are granted `neon_superuser` | **Yes** (INFERRED: the only user-usable login role on the branch; the Vercel–Neon integration injects user credentials) | **Yes** (INFERRED) |

Don't reset or modify `cloud_admin`, `neon_service` or `neon_auth`.

### R2.4 Variable → role mapping (Gate R2)

| Variable | Consumer | Database role | Status |
|---|---|---|---|
| `DATABASE_URL` | App runtime (`lib/db.ts`) **and** build-time `prisma migrate deploy` (`schema.prisma`) | `neondb_owner` | **INFERRED** (only user-usable login role). Becomes VERIFIED with owner check O-1. |
| `DATABASE_URL_UNPOOLED` | None (unused) | `neondb_owner` | INFERRED |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL` | None (unused; legacy compatibility) | `neondb_owner` | INFERRED |
| `PGUSER`, `POSTGRES_USER` | None (unused) | `neondb_owner` | INFERRED |
| `PGPASSWORD`, `POSTGRES_PASSWORD` | None (unused) | `neondb_owner`'s password | INFERRED |

- **Caveat:** an earlier review saw different user labels across local mirror files. Possible explanations: local or dev URLs in `.env.local`, or values pointing at another branch or project.
- Only the owner checks O-1 and O-2 (below) can turn INFERRED into VERIFIED **without** exposing secrets.
- Integration fact [DOC]: `DATABASE_URL` is **pooled** (PgBouncer, transaction mode) and `DATABASE_URL_UNPOOLED` is **direct**.

### R2.5 Replacement-role design (Gate R3)

| Requirement | Finding |
|---|---|
| New role can connect | A console-created role gets `CONNECT` and `neon_superuser` membership [DOC] |
| Table and sequence access at runtime | Comes through **membership in the owner role**. Postgres inheritance (`rolinherit=true`, the default) gives all privileges of `neondb_owner`, including tables and sequences it owns. |
| Effective role for migrations | DDL on existing tables needs **ownership**. Membership alone doesn't make *new* objects owned by `neondb_owner`. The plan's `ALTER ROLE <new> SET ROLE neondb_owner` makes every session act as the owner. Neon documents role-level settings as the pooler-safe way to set session defaults [DOC]. |
| **Can the membership be granted?** | **UNVERIFIED, and this is the blocker.** On Postgres 16+, `GRANT neondb_owner TO <new>` needs ADMIN OPTION on `neondb_owner`. Neon doesn't document whether `neondb_owner` (or another console role) holds it. Check O-3 settles it read-only. |
| Unnecessary privileges | A console role also gets `neon_superuser` (CREATEROLE, CREATEDB, BYPASSRLS), the same as `neondb_owner` today. Accepted for parity. Least privilege is a follow-up (GOV-02-I3: a separate migration role). |
| Does resetting `neondb_owner`'s password affect the new role? | No. Membership and ownership are catalog relationships, not passwords. A reset changes only `neondb_owner`'s authentication. [Standard Postgres; Neon docs don't say otherwise.] |
| Prisma and pooling | Neon recommends the **direct** URL for `prisma migrate`. Production uses the pooled `DATABASE_URL` today and it works ("No pending migrations"). With 0 pending, the deploy needs only a read of `_prisma_migrations`. Unchanged in I0-C. Moving migrations to a direct URL is GOV-02-I3. |

**Design paths** (owner chooses after O-3):

| Path | Steps | Production impact | When |
|---|---|---|---|
| **A: new role with owner membership** (current plan) | Create role → `GRANT neondb_owner TO new` → `ALTER ROLE new SET ROLE neondb_owner` → switch Vercel → deploy → overlap → reset `neondb_owner` | No downtime; rollback available until reset | **Only if O-3 shows the grant is possible** |
| **C: reset `neondb_owner` in place, with a short planned window** | Docs PR opened and its checks green first. Then: reset `neondb_owner` in Neon → **immediately** put the new password into Vercel `DATABASE_URL` (Production) → owner merges the docs PR → deploy goes live (≈3–5 min) | **New database connections from the running deployment fail** between the reset and go-live. Existing pooled connections may continue. Roughly 3–5 min of database errors; users are signed out anyway (`AUTH_SECRET`). No role or ownership changes. No rollback to the old deployment (its password is dead). | If A isn't possible, or the owner prefers simplicity |
| B: group-owner role (Neon-documented pattern: `CREATE ROLE table_owners NOLOGIN` + `REASSIGN OWNED BY neondb_owner TO table_owners`) | Moves ownership of all 25 tables, plus any other objects `neondb_owner` owns, to a password-less group role | A Production ownership change; larger blast radius | **Not recommended for I0-C.** Consider in GOV-02-I3. |

### R2.6 Rotation scope (Gate R4)

- **Rotate exactly one database credential: `neondb_owner`'s password** (reset after the overlap in Path A; at cutover in Path C).
- Don't touch `cloud_admin`, `neon_service` or `neon_auth`.
- **Resend key and `AUTH_SECRET`:** unchanged scope.
- If O-1 or O-2 shows a variable using a role other than `neondb_owner`, **STOP** and revise the plan.

### R2.7 Rollback and revocation impact (Gate R5)

| Item | Path A | Path C |
|---|---|---|
| Docs-only deploy, 4 checks, Prisma 0 pending | unchanged | unchanged (PR prepared and green before the reset) |
| Instant Rollback to `dpl_mYJA…` | available until the reset | **not available** after the reset (dead password); fix forward only |
| Overlap | ≥1 h with conditions (a)–(f) | none; the reset *is* the cutover |
| Ending old sessions | `pg_terminate_backend` where `usename='neondb_owner'` **would also end the new role's sessions?** No: `usename` is the login (session) user, which is the new role for app sessions. The SQL Editor's own `neondb_owner` session is excluded with `pid <> pg_backend_pid()`. | Same query, right after the reset |
| Old-password check | Connection with the old string fails, including after a compute restart | Same |
| Resend and `AUTH_SECRET` | unchanged | unchanged (same deploy) |
| `aura.voyforge.com` | observation only (owner-accepted) | same |

### R2.8 Owner checks needed (secret-safe, read-only)

- **O-1 (runtime role, Neon SQL editor):** load `https://aura-updated.vercel.app` once, then run

  ```sql
  SELECT usename, application_name, count(*) FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid()
  GROUP BY 1,2 ORDER BY 3 DESC;
  ```

  Report the `usename` values only.
- **O-2 (usernames in the exposed variables, owner's machine):** prints variable name, username and pooled/direct only, never the password or host. It reads `apps/web/.env.production.local`, pulled 2026-09-22. Vercel's values haven't changed since 2026-08-14; today's edits changed targets only.

  ```bash
  cd apps/web && node -e '
  const fs=require("fs");const t=fs.readFileSync(".env.production.local","utf8");
  for(const l of t.split("\n")){const m=l.match(/^([A-Z_]+)="?([^"]*)"?$/);if(!m)continue;const[k,v]=[m[1],m[2]];
   if(/^(DATABASE_URL|DATABASE_URL_UNPOOLED|POSTGRES_URL|POSTGRES_URL_NON_POOLING|POSTGRES_URL_NO_SSL|POSTGRES_PRISMA_URL)$/.test(k)){try{const u=new URL(v);console.log(k,"user="+decodeURIComponent(u.username),u.hostname.includes("-pooler")?"pooled":"direct")}catch{console.log(k,"unparseable")}}
   if(/^(PGUSER|POSTGRES_USER)$/.test(k))console.log(k,"user="+v)}'
  ```

- **O-3 (can membership be granted?), Neon SQL editor:**

  ```sql
  SHOW server_version;
  SELECT r.rolname AS role, g.rolname AS member, m.admin_option
  FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles g ON g.oid=m.member
  WHERE r.rolname='neondb_owner' OR g.rolname='neondb_owner';
  ```

  Path A is possible if the version is below 16, or if some role the owner can act as holds `admin_option=true` on `neondb_owner`.
- **O-4:** confirm no Neon role was created and no Vercel value changed after the 15:10Z I0-C instructions.

### R2.9 Remaining blockers

- O-1 and O-2: mapping VERIFIED.
- O-3: Path A feasibility, otherwise the owner chooses Path C.
- O-4: confirm nothing was executed.

### R2.10 Independent review: ROTATION PLAN REVISION REQUIRED

The reviewer was an independent read-only subagent; no values were printed. Live freeze check at 15:24Z: holding.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | **P1** | **All 18 database and Neon variables are Vercel Marketplace integration-store secrets** (`contentHint.type = integration-store-secret`, store `store_L2B…`, Neon). Both paths assumed hand-editing `DATABASE_URL`, which isn't established, and would leave 17 siblings stale. | **Verified by operator (R2.11).** Plan redesigned around the store. |
| F2 | **P1** | Path C terminate query (`usename='neondb_owner'`) would also kill the *new* deployment's sessions, which log in as `neondb_owner` too | Fixed: run only after go-live, with `AND backend_start < '<rotation ts>' AND datname=current_database()` |
| F3 | P2 | Path C impact is understated. `pg` pools idle out after 10 s and reconnect with the dead password, so expect near-total database errors for about 2–5 min, mostly human latency. Builds take about 67–160 s. | Restated. Script the steps; avoid the 13:00Z cron. |
| F4 | P2 | Missing zero-downtime **Path D**: a new role with plain DML privileges. Runtime needs no DDL, and a build with 0 pending migrations only reads `_prisma_migrations`. | Recorded. It shares F1's override problem, so it's not preferred (R2.12). |
| F5 | P2 | O-3 is incomplete: role attributes aren't inherited; Postgres 16 removed self-ADMIN; no direct yes/no | Added `rolcreaterole/rolinherit/rolbypassrls` and `pg_has_role(current_user,'neondb_owner','MEMBER WITH ADMIN OPTION')` |
| F6 | P2 | `ALTER ROLE … SET ROLE` is valid and survives the pooler, but a bad setting only WARNs at login | Gate: `session_user, current_user` over the pooled URL. Run the `ALTER` as the new role. |
| F7 | P2 | O-1 can't separate app sessions from console sessions; neither check ties the variables to the branch being reset | O-1 adds `client_addr, backend_start` (before and after a page load). O-2 adds the endpoint ID (`ep-…`, not secret). |
| F8–F10 | P3 | Neon Auth provisioned (explains `neon_auth`); restart blip; don't use `CREATE ROLE … PASSWORD` in the SQL editor (query history keeps it) | Noted |

### R2.11 Operator verification of F1 (read-only, 2026-11-10 ~15:30Z, metadata only)

- **23 env entries:** 18 are `integration-store-secret` (store `neon-aquamarine-yacht`, product `neon`, Free plan, status available); 5 are manual (`RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, both `AUTH_SECRET` entries, `AURA_SHADOW_POLICY_MODE`).
- **Correction to I0-A §1 and §2:** "Integration-linked (`configurationId`): 0" was wrong. I checked the wrong field; the store link is in `contentHint`.
- **The store's project link for `aura-updated` still lists `environments: ['preview','production']`**, with 18 synced variable names.
  - I0-A changed each variable's target but **not the store's environment setting**.
  - **Risk:** any store sync (for example a Neon-side password change, which Neon pushes to Vercel, or a rotation) may re-apply both targets and **re-expose the new credentials to Preview**.
  - **The I0-A containment isn't durable** until the store link is set to Production only.
- **Store capabilities:** `secretsSync: true`; `secretRotation: { maxDelayHours: 0 }`; last rotation 2026-08-14 (at creation).
  - So Vercel–Neon has a **native rotation** that regenerates the credentials and syncs all 18 variables.
  - `maxDelayHours: 0` points to **immediate** invalidation of the old secret, with no overlap. It's undocumented here; the owner must confirm in the Vercel Storage UI or Neon docs.
- Store project-link `deployments: { required: true, actions: [] }`: meaning undocumented. Recorded.

### R2.12 Revised rotation design (replaces Paths A, C and D for the database credential)

**Recommended: Path S, store-native rotation.**
1. **Pre-step (Vercel setting change; needs authorization):** Vercel → Storage → `neon-aquamarine-yacht` → Projects → `aura-updated` → set environments to **Production only**. Verify by read-back that the store link shows `['production']` and the 18 variables stay Production-only. This makes the I0-A containment durable *before* any sync.
2. Owner enters the new `RESEND_API_KEY` and `AUTH_SECRET` (manual variables, Production only). This doesn't affect the running deployment.
3. Claude opens the docs-only PR; the four checks go green; **not merged yet**.
4. Owner triggers **Rotate secrets** on the store (Vercel Storage UI). Neon regenerates the credential, and all 18 variables sync. Claude reads back: all 18 `updatedAt` advanced, all still Production-only. **If any shows Preview: STOP.**
5. Owner **immediately** merges the docs PR. The deploy goes live in about 2–5 min; the running deployment's new database connections fail in the meantime. No Instant Rollback (the old credential is dead).
6. Verify:
   - `source=git` at the merge SHA; "No pending migrations"; health; database probe; magic link;
   - the new credential in use (`pg_stat_activity` after go-live; `backend_start` later than the rotation time).
7. Terminate leftover old sessions: `usename = <role> AND backend_start < '<rotation ts>' AND datname = current_database() AND pid <> pg_backend_pid()`.
8. Restart compute (brief blip), then confirm the old credential fails.
9. Revoke the old Resend key. Local cleanup. Lift the freeze.

**Owner must confirm before authorizing:**
- **S-1:** what Rotate secrets does for Neon: which role is rotated (expected `neondb_owner`), and whether the old password is invalidated immediately.
- **S-2:** that it re-syncs only to the store's configured environments, which after step 1 is Production only.
- **S-3:** that it doesn't create a new role or branch.

If store rotation is unavailable or unclear, the **fallback is Path C, done in the Neon console**: reset `neondb_owner`, after which Neon's own sync pushes the new values, so step 1 is still mandatory first.

**Path A and Path D (manual role switch) are not recommended.** They would require overriding store-managed variables. Whether that is allowed, and whether a later sync would overwrite it, is unverified.

**Rotation scope is unchanged:** one database credential (expected `neondb_owner`), plus the Resend key and `AUTH_SECRET`. `cloud_admin`, `neon_service` and `neon_auth` are not touched.

### R2.13 Path S pre-step executed: store link set to Production only (owner-authorized, 2026-11-10)

**Change:** the owner used Vercel → Team Integrations → Neon → `neon-aquamarine-yacht` → Projects → `aura-updated` → **Update Project Connection**, set Environments to **Production** (Preview unticked; Development unticked; the per-deployment row left unticked; prefix empty; Sensitive on), then **Save Changes**. Saved at **15:42:21Z**.

**Before (snapshot 15:33:45Z):** link environments `['preview','production']`; 18 store variables Production-only (from I0-A), with I0-A IDs.

**After (read-back 15:43:08Z):**

| Check | Result |
|---|---|
| Store link environments | **`['production']`**, prefix none, 18 variables |
| Store rotation | `secretRotationCompletedAt` unchanged (2026-08-14). **No credential rotation occurred.** |
| Store variables | Saving **re-synced and recreated all 18** with **new env IDs**, all created and updated at 15:42:21Z, type `sensitive`, target **`production` only** (18/18). Values come from the store's current secret (no rotation), so the same credentials are expected. Not readable to confirm. |
| Manual variables | Unchanged: `RESEND_API_KEY` (Production), `AUTH_SECRET` ×2, `AURA_SHADOW_POLICY_MODE` (Preview), `RESEND_FROM_ADDRESS` (Production + Preview) |
| Preview-targeted entries | Only `AURA_SHADOW_POLICY_MODE`, the Preview `AUTH_SECRET` and `RESEND_FROM_ADDRESS`. **No database or Neon credential reaches Preview.** |
| Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` unchanged; `/` → 200; database read OK; no new deployment (latest is still the 13:28:54Z Preview) |
| `main` / freeze | `e921f54`; freeze holding |
| Other | bypass 0; auto-assign `true` |

**Result:** the I0-A containment is now **durable at the source.** The store itself syncs only to Production.

**New freeze baseline:** project `updatedAt` and env max `updatedAt` = **2026-11-10T15:42:21Z** (was 13:50:53Z).

**New env IDs** (they replace the I0-A IDs in the execution plan): `DATABASE_URL` = `gyusaUxL8kqFdKHP`, `PGPASSWORD` = `eh3nLJmuU1NcM9ab`; the other 16 were recreated the same way. Manual IDs are unchanged: `RESEND_API_KEY` `9wIWbQWLA3QdQ288`, Production `AUTH_SECRET` `5zHVNkKL8cSkGHcn`.

**Lesson for Path S step 4:** a store save re-syncs and recreates variables. Expect the same on **Rotate secrets**, and check by name, target and type, not by ID.

### R2.14 O-1 completed (owner, 2026-11-10; supporting evidence only)

The owner opened `https://aura-updated.vercel.app`, then ran the read-only `pg_stat_activity` query in the Neon SQL editor.

| `usename` | Sessions | `application_name` | `client_addr` | `backend_start` |
|---|---|---|---|---|
| `neondb_owner` | 4 | `pgbouncer` | loopback (`127.0.0.1` / `::1`) | 15:43–15:45 UTC |
| `neon_auth` | 1 | `pgbouncer` | loopback | 15:43–15:45 UTC |

No other usernames appeared.

**Interpretation:**
- Server connections arrive through Neon's PgBouncer on the compute host, hence loopback addresses.
- The `neondb_owner` sessions started right after the page load. That fits the Vercel runtime connecting as `neondb_owner` through the **pooled** endpoint, which matches the integration's pooled `DATABASE_URL`.
- The `neon_auth` session is consistent with the Neon Auth service (Neon-managed, out of scope).

**This is not definitive proof** of the username embedded in the Vercel variables: console and app sessions are indistinguishable here. The mapping stays **INFERRED, strongly supported**, pending O-2.

### R2.15 S-1..S-3: what rotation does (documentation evidence, 2026-11-10)

Sources: Vercel KB "How to reset a secret for a Neon integration"; Vercel docs "Rotating secrets", "Secrets rotation" (integration API), "Marketplace storage" and "Secure your resource"; Neon "Vercel-managed integration".

| Question | Finding | Confidence |
|---|---|---|
| **Mechanism** | Two documented routes. (1) Vercel dashboard: Integrations → Neon → resource → Settings → Secure This Resource → **Rotate Secrets** (enter a reason, type the project name). (2) **Neon console → project → Connect → choose the role → Reset password.** In both cases Vercel then syncs the new secret to the linked project's variables. | High |
| **S-1: which role** | Route 1 doesn't state which role it resets. **Route 2 names the role explicitly** (selected in Neon's Connect dialog). | Route 1: not stated. Route 2: explicit. |
| **Old password** | "When you reset the Neon database secret, the current one will immediately stop working." `maxDelayHours: 0` on the store most likely means no overlap window is supported (inferred). | High / inferred |
| **Redeploy** | Required. Rotation "does not redeploy the projects"; deployments keep their old values. | High |
| **Downtime** | "All projects that rely on the secret will be unable to connect … until they are re-deployed." | High |
| **S-2: environments** | Vercel: "Existing deployments do not get new or changed variables." The values go to the connection's configured environments, which is now **Production only** (R2.13). | Medium (inferred from the connection model) |
| **S-3: new role, branch or database** | Not stated. Both routes describe a password reset on the existing role and project. Nothing is created. | Medium |

**Decision for the plan:** use **route 2**, the Neon console reset with the role chosen explicitly (expected `neondb_owner`, confirmed by O-2). That removes the S-1 ambiguity. Immediately after the reset:
1. Read back that the 18 store variables were re-synced, still Production-only, by name, target and type.
2. Owner merges the pre-greened docs PR.
3. Expect database errors until the new deployment is live (about 2–5 min). No Instant Rollback.

Route 1 is acceptable only if the owner confirms in the UI which role it resets. S-1..S-3 are **resolved by choosing route 2**, with S-2 to be confirmed by read-back during execution: any Preview target is a STOP.

### R2.16 O-2: BLOCKED — LOCAL VALUES NOT USABLE FOR VERIFICATION (owner, 2026-11-10)

**Owner's structural check:** the six database URL variables in local `apps/web/.env.production.local` are each 13 characters including quotes; non-empty; quoted; not `postgres://`/`postgresql://`; no variable references. They are **placeholders**, consistent with the Vercel CLI being unable to pull `sensitive` values. No further parsing.

**Corrections to earlier findings:**
- I0-A §7, I0-B §11.4 and I0-C0 §10 treated `.env.production.local` as holding plaintext Production credentials. **For these six variables it doesn't.**
- The earlier review's "three user labels" analysis of local mirrors therefore doesn't show multiple Production roles.
- Other local `.env.local` files weren't structurally checked. The cleanup recommendation stands as hygiene.

### R2.17 Secret-safe verification methods for the three open questions

**Q1. Database username in the Production connection configuration.**

| Method | What it shows | Status |
|---|---|---|
| (i) Inventory | Neon project `green-bar-78820765` (the Neon ID on the Vercel store page) has exactly one user login role on the branch: `neondb_owner`. The others are Neon-managed (Query A). The store's variables are generated by Neon for that project. | Done. Strong inference. |
| (ii) Runtime | Live connections after a page load are `neondb_owner` via the pooler (O-1) | Done. Supporting. |
| (iii) **Owner, Vercel UI, no reveal:** Storage → `neon-aquamarine-yacht` → its quickstart, `.env.local` or connection-details view. Many Marketplace pages show connection strings with the **password masked**. Read **only the username** in `postgresql://<user>:****@…`. **Don't click "Show secret" or copy.** If the page shows nothing without revealing, skip this method. | Username shown with password masked | Owner, optional |
| (iv) **Owner, Neon console:** project `green-bar-78820765` → **Integrations** (or project settings) → the Vercel integration entry, which may name the branch and role used for each environment | Role and branch per Vercel environment | Owner, optional |
| (v) **Built-in execution check (STOP gate):** after the role reset, Neon pushes new values to Vercel **only if the integration's credential uses that role**. If the 18 store variables re-sync (new `updatedAt`, same names, Production-only) within a few minutes, the integration's username is that role. **If no sync appears within 5 minutes, STOP before merging.** | Definitive, at execution | In the plan |

If (iii) or (iv) shows `neondb_owner`, Q1 becomes **VERIFIED** before execution. Otherwise it stays **INFERRED (strong)**, and (v) makes it definitive at the first step of execution.

**Q2. Neon endpoint and branch.**
- The Neon project is identified as `green-bar-78820765` (shown on the Vercel store page).
- **Owner, Neon console:** project `green-bar-78820765` → **Branches**. Note which branch is the **default (production)** branch and its compute **endpoint ID** (`ep-…`, not secret). Confirm the SQL editor used for Queries A–C and O-1 was on **that** branch; the editor's branch selector shows it.
- The docs say the Vercel integration's **Production** environment connects to the project's default branch. Preview branches are created per deployment and injected by webhook, which is no longer relevant now that the link is Production only.

**Q3. Does Vercel's "Rotate secrets" invalidate the old password immediately?**
- Vercel KB for Neon: "When you reset the Neon database secret, the current one will immediately stop working." (High.)
- Vercel's generic rotation contract allows an overlap (`delayOldSecretsExpirationHours`). But this store advertises `secretRotation: { maxDelayHours: 0 }`, meaning **no overlap supported**, so invalidation is immediate. (Inferred from the API field; consistent with the KB.)
- **Owner, optional, no confirmation:** open Integrations → Neon → resource → Settings → Secure This Resource → **Rotate Secrets** and look at the dialog **without confirming**. If it offers no delay field, that's corroboration. Close the dialog.
- **The plan uses route 2** (Neon console → Connect → choose `neondb_owner` → Reset password), where the role is explicit. Either way, treat invalidation as immediate.

### R2.18 Owner confirmations and cutover re-evaluation (2026-11-10)

**Recorded:**
- **Default branch `main`**, branch ID **`br-polished-morning-auhb1u2m`**. Queries A–C and O-1 ran on `main`.
- **O-4 complete:** no Neon roles created, and no Vercel changes after 15:10Z except the 15:42:21Z store save.

**Baseline re-check (15:58:45Z):** `main` `e921f54`; Production `dpl_mYJA…`; project and env `updatedAt` 15:42:21Z (the freeze baseline); bypass 0; only the 3 non-credential entries target Preview; no deployment since 13:28:54Z. **Unchanged.**

**1. Compute endpoint ID** (`br-…` is the branch, not the endpoint)
- There's no Neon API key here, and none should be created, so the **owner** reads it from the console: project `green-bar-78820765` → **Branches → `main` → Computes**. The primary read-write compute shows its **endpoint ID `ep-…`**, which isn't secret.
- **Optional SQL corroboration** on `main`: `SELECT current_setting('neon.endpoint_id', true);`. Whether this setting exists is unverified; a NULL result proves nothing.
- **Why it matters:** password resets are branch-scoped, and the reset must target the branch that serves Production (`main`). The endpoint ID ties the compute that serves the pooled connections to that branch.

**2. O-2 status:** **partially verified.** The local values are placeholders and aren't used. The username stays **INFERRED (strong)** from the single user login role (Query A), plus runtime sessions (O-1), plus the store→Neon project link.

**3. Rotation behavior** (documentation; residual unknowns stated)

| Aspect | Neon console Reset password (route 2) | Vercel "Rotate Secrets" (route 1) |
|---|---|---|
| Role affected | **The role you choose** in Connect (explicit) | **Not documented** for Neon |
| Old password | "Will immediately stop working" (Vercel KB for Neon) | `maxDelayHours: 0`, so no overlap supported (inferred) |
| Creates a role or branch | Not stated; documented as a reset of the existing role | Not stated |
| Redeploy | Required; deployments keep old values | Required |
| Values synced to | The store's connection environments (now **Production** only) | Same |

**4. Outage review of route 2 (direct reset).**
- The old password dies the moment it's reset. The running `dpl_mYJA…` pool reconnects (idle clients close after 10 s) and fails until the replacement deployment is READY: about 70–160 s of build, plus human latency to merge. **Expect roughly 2–5 minutes of database errors.**
- After the reset, **Instant Rollback is no longer possible**, because the old deployment holds a dead password.
- This **does not preserve** the previously approved requirement that rollback stays available until revocation.

**5. Can replacement-role-first (rollback preserved, no outage) work without Storage rotation?**

| Option | How | Verdict |
|---|---|---|
| A: hand-edit `DATABASE_URL` to a new role | Override a store-managed variable | **Not viable.** Editing is unverified, a later store sync could overwrite it, and 17 related variables would be left behind. |
| **O: override variable plus replacement role** | (1) Small code PR: `lib/db.ts` uses `process.env.AURA_DATABASE_URL \|\| process.env.DATABASE_URL`; `vercel-build.sh` exports `DATABASE_URL="${AURA_DATABASE_URL:-$DATABASE_URL}"` before Prisma; same for `scripts/retention-report.js`. Inert while unset. (2) Owner creates new role `aura_app_2026_11` (console) and, as `neondb_owner`, grants it access (below). (3) Manual **Production-only** variable `AURA_DATABASE_URL` = new role's **pooled** string; new Resend key and `AUTH_SECRET` too. (4) Docs-only PR deploy, so the app runs as the new role while the old deployment keeps old credentials (**Instant Rollback preserved**). (5) Overlap ≥1 h with the agreed conditions; verify `pg_stat_activity` shows the new role. (6) Reset `neondb_owner` in Neon (route 2): only the store's `DATABASE_URL` re-syncs, **which the app no longer uses**, so **no outage**. End old sessions (`usename='neondb_owner'`, started before the reset, excluding the editor). Restart compute; confirm the old password fails. (7) Revoke the old Resend key. | **Viable and preferred if rollback must be preserved.** Costs one reviewed code PR (an exception to the merge freeze) and grants on Production. |
| C/S: direct reset (route 2) | As in R2.12 | Viable, simplest, but means **about 2–5 min of errors and no rollback** |

**Option O grants**, run by `neondb_owner` in the SQL editor on `main`. A table owner can grant without ADMIN OPTION:

```sql
GRANT USAGE ON SCHEMA public TO aura_app_2026_11;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aura_app_2026_11;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aura_app_2026_11;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aura_app_2026_11;
ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aura_app_2026_11;
```

- **Fitness:** runtime is DML only (raw `pg`, upserts, transaction advisory locks; no DDL in `lib/` or `app/`). A build with 0 pending migrations only reads `_prisma_migrations` and takes an advisory lock.
- **Limitation:** a **future migration with DDL would fail at build** (fail-closed; the old deployment keeps serving) until GOV-02-I3 adds a dedicated migration credential. If O-3 shows ADMIN on `neondb_owner` is available, membership plus a `SET ROLE` default can be added for DDL parity.
- **Verify before switching:** connected as the new role (one-off `psql` with the password typed at the prompt, or the SQL editor's role selector), run `SELECT count(*) FROM "User";` and `SELECT count(*) FROM _prisma_migrations;`. Both must succeed. Read-only, then discard.

### R2.19 Independent review of R2.18: ROTATION PLAN REVISION REQUIRED → revisions applied

**Freeze live check:** holding. `main` `e921f54`; Production `dpl_mYJA…`; project and env `updatedAt` 15:42:21Z; no new deployments; bypass 0.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | **P1** | Non-`main` Neon branches were never inventoried. Resets are branch-scoped, and child branches keep the old `neondb_owner` password plus a copy of the data. | **Owner input:** branch count and names. Each non-`main` branch is deleted (preferred) or its `neondb_owner` is reset. Verification covers every remaining branch. |
| 2 | **P1** (route 2) | Route 2's sync STOP gate comes *after* an irreversible reset, so Production would stay down with no recovery | **Route 2 rejected** |
| 3 | P2 | Option O's build-script change is unnecessary: builds keep migrating as `neondb_owner` through the store-synced `DATABASE_URL`. It also conflicts with existing tests. | **Adopted O-min:** change `lib/db.ts` only |
| 4 | P2 | A DML-only role with write on `_prisma_migrations` could record failed migrations (P3009) | `REVOKE ALL ON public."_prisma_migrations" FROM aura_app_2026_11;` added |
| 5 | P2 | Console roles join `neon_superuser` (not least privilege; no worse than today) | Accepted for I0; least privilege deferred to I3. Verification queries added. |
| 6 | P3 | Route 2 outage estimate is fair (builds 55–80 s) | Moot: route 2 rejected |
| 9 | P3 | `pg` fills missing URL parts from `PG*`, so a partial URL would silently mix in `neondb_owner` | `AURA_DATABASE_URL` must be **complete** (user, password, `-pooler` host, dbname, `sslmode=require`), Sensitive, Production-only |
| 10 | P3 | The `\|\|` fallback fails open to `neondb_owner` | Go-live gate: `pg_stat_activity` shows `aura_app_2026_11` sessions and **no new** `neondb_owner` app sessions |
| 11, 13 | P3 | Rollback window and merge order unclear | Stated in R2.20 |
| 15 | P3 | The endpoint ID can't tie the store variables to `main` (`PGHOST` is unreadable); the `neon.endpoint_id` GUC is unverified | Endpoint ID becomes **optional**. Under O-min, sessions as `aura_app_2026_11` (which exists only on `main`) prove runtime→`main`. |
| 16 | P3 | §14 stale | Rewritten below |

### R2.20 Adopted plan: O-min (replacement role first; rollback preserved; no outage)

Executed only under a later, separate **I0-C authorization**.

1. **Freeze exception 1, code PR:** `apps/web/lib/db.ts` → `new Pool({ connectionString: process.env.AURA_DATABASE_URL || process.env.DATABASE_URL })`. One line, inert while the variable is unset; full CI green; the owner merges. It deploys as a normal Production deployment, with behaviour unchanged.
2. **Owner, Neon console (`main`):** create role `aura_app_2026_11` (console; password copied straight into Vercel in step 4, nowhere else).
3. **Owner, SQL editor as `neondb_owner` on `main`:**

   ```sql
   GRANT USAGE ON SCHEMA public TO aura_app_2026_11;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aura_app_2026_11;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aura_app_2026_11;
   REVOKE ALL ON public."_prisma_migrations" FROM aura_app_2026_11;
   ```

   Then read back:

   ```sql
   SELECT rolcreaterole, rolbypassrls FROM pg_roles WHERE rolname='aura_app_2026_11';
   SELECT has_table_privilege('aura_app_2026_11','public."User"','INSERT'),
          has_table_privilege('aura_app_2026_11','public."_prisma_migrations"','SELECT');   -- expect: true, false
   ```

4. **Owner, Vercel (Production only, Sensitive):** add `AURA_DATABASE_URL` = the **complete pooled** connection string for `aura_app_2026_11`. Also set the new `RESEND_API_KEY` and the new Production `AUTH_SECRET` (≥32 characters). Claude reads back names, targets and types only.
5. **Freeze exception 2:** Claude opens a docs-only PR; checks green; the owner merges. The new deployment runs as `aura_app_2026_11`; builds still migrate as `neondb_owner` (0 pending).
6. **Go-live gates:**
   - deployment `source=git` at the merge SHA, READY; "No pending migrations"; scanner OK;
   - magic-link sign-in works; `/` 200; database probe OK;
   - `pg_stat_activity` shows `aura_app_2026_11` sessions and **no new** `neondb_owner` app sessions after go-live.
   - **Any failure: Instant Rollback to the previous Production deployment** (old credentials, still valid).
7. **Overlap ≥ 1 h:** conditions as agreed; no other Production deployment.
8. **Revocation, owner, Neon console:**
   - Reset `neondb_owner` on `main` **and on every remaining non-`main` branch** (or delete those branches first, preferred).
   - **Sync gate:** the 18 store variables re-sync, Production-only. If they don't, the app is unaffected: it uses `AURA_DATABASE_URL`. Record and investigate; this isn't an outage.
   - End old sessions: `usename='neondb_owner' AND backend_start < '<reset ts>' AND datname=current_database() AND pid <> pg_backend_pid()`.
   - Restart compute (a blip of seconds); confirm the old password fails on every branch endpoint.
   - Revoke the old Resend key.
9. **Rollback window:** Instant Rollback stays available until step 8. After the reset, only deployments built with `AURA_DATABASE_URL` set (or after the sync) are valid rollback targets.
10. Close-out: local cleanup; lift the freeze.

**Follow-ups:**
- GOV-02-I3: least-privilege roles, a dedicated migration credential, and retiring the `||` fallback.
- Note the dead `lib/prisma.ts` / `prisma-db.ts` path, which reads `DATABASE_URL`.

### R2.21 Conditional-acceptance review items (2026-11-10)

**Owner position:** the two-PR scope (a `lib/db.ts` override PR and a docs-only deploy PR) is **conditionally accepted as design only**. Both still need explicit approval at the final I0-C gate. Nothing was merged, deployed or created.

**1. Prisma migration path vs runtime override (verified, `origin/main` `e921f54`)**
- `apps/web/prisma/schema.prisma`: `url = env("DATABASE_URL")`, no `directUrl`. No `prisma.config.*` in the repo, and no `prisma` field in `apps/web/package.json`.
- `apps/web/scripts/vercel-build.sh` (non-comment lines): Production-only `npx prisma migrate deploy`, then `next build`, then the Palmistry scanner. **It never reads `AURA_DATABASE_URL`.**
- So migrations keep running as the role in the store-managed `DATABASE_URL` (`neondb_owner`). **The override can't change migration execution.**
- Runtime has exactly one pool: `lib/db.ts:36`. `lib/prisma.ts` creates a `PrismaClient`, but nothing imports it (dead code).
- **Build-time side effect:** `/api/health` is prerendered during `next build`. Once `AURA_DATABASE_URL` is set, that prerender's `SELECT 1` connects as the new role, which is harmless.

**2. Replacement role's effective privileges**
- **Pre-check now (owner, read-only, SQL editor on `main` as `neondb_owner`).** `neondb_owner` was provisioned like a console role, so its memberships predict the new role's.

  ```sql
  SELECT g.rolname AS member, r.rolname AS member_of, m.admin_option
  FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles g ON g.oid=m.member
  WHERE g.rolname IN ('neondb_owner','neon_superuser') ORDER BY 1,2;
  SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication
  FROM pg_roles WHERE rolname IN ('neondb_owner','neon_superuser');
  ```

  This shows whether `neon_superuser` is a member of `pg_read_all_data`/`pg_write_all_data`. If so, a console role could read or write `_prisma_migrations` regardless of any `REVOKE`.
- **Post-creation gates (I0-C step 3; STOP if not as expected):**
  - `pg_has_role('aura_app_2026_11','neon_superuser','MEMBER')` is recorded. Expected `true` for a console role; accepted for I0 as no worse than today's `neondb_owner`. Least privilege in I3.
  - `pg_has_role('aura_app_2026_11','pg_write_all_data','MEMBER')` and `…'pg_read_all_data'…` are recorded.
  - `has_table_privilege('aura_app_2026_11','public."_prisma_migrations"', p)` for `p` in SELECT/INSERT/UPDATE/DELETE. **Target: all false.**
  - `has_table_privilege('aura_app_2026_11','public."User"','INSERT')` → true.
  - `pg_has_role('aura_app_2026_11','neondb_owner','MEMBER')` → **false** (no ownership, so no DDL).
- **If `_prisma_migrations` stays reachable** (through predefined roles): create the role scoped instead, with Neon CLI `neonctl roles create --name aura_app_2026_11 --access read_write --project-id green-bar-78820765 --branch main` (owner). Neon documents `--access` as giving a scoped role **without** `neon_superuser`. Re-run the gates; if still reachable, record it as an accepted P2. The build never uses this role (it migrates via `DATABASE_URL`), so the failed-migration-row (P3009) risk doesn't apply. Residual risk: a compromised app could tamper with migration history.
- Create the role in the console or CLI, never with `CREATE ROLE … PASSWORD` in the SQL editor (query history).

**3. Two-PR deployment and rollback sequence (Hobby: Instant Rollback reaches only the immediately previous production deployment)**

| Stage | Production deployment | DB credential used | Resend / `AUTH_SECRET` | Instant Rollback target | Rollback valid? |
|---|---|---|---|---|---|
| Now | `dpl_mYJA…` (`e921f54`) | `DATABASE_URL` → `neondb_owner` (old) | old / old | (previous: CLI `dpl_CGik…`) | n/a |
| After PR-1 merge (`db.ts` override; **no new variables yet**) | **D1** (PR-1 merge SHA) | `AURA_DATABASE_URL` unset, so falls back to `DATABASE_URL` → `neondb_owner` (old) | old / old | `dpl_mYJA…` | Yes (same behaviour) |
| Owner creates role, grants, gates; enters `AURA_DATABASE_URL`, new Resend key, new `AUTH_SECRET` (Production only) | D1 unchanged (deployment env is fixed at build) | old | old / old | `dpl_mYJA…` | Yes |
| After PR-2 merge (docs) | **D2** (PR-2 merge SHA) | `AURA_DATABASE_URL` → `aura_app_2026_11` (new); build migrations via `DATABASE_URL` → `neondb_owner` | new / new (all users signed out once) | **D1** | **Yes:** D1 carries the old database credential, old Resend key and old `AUTH_SECRET`, all still valid |
| Overlap ≥ 1 h | D2 | new | new / new | D1 | Yes |
| **First revocation step** (`neondb_owner` reset on `main` → store re-syncs `DATABASE_URL`) | D2 (unaffected) | new | new / new | D1 | **No longer valid:** D1's `DATABASE_URL` is dead. **Rollback ends here.** |
| Old Resend key revoked | D2 | new | new / new | D1 | No (also D1 email) |

**Rules:**
- No other Production deployment between D1 and the end of the overlap (it would displace D1 as the rollback target).
- After any Instant Rollback, auto-assign turns off and returning needs an owner promote.
- After revocation, recover only by fixing forward (new deployments get the re-synced `DATABASE_URL` or `AURA_DATABASE_URL`).
- Every gate in R2.20 step 6 must pass **before** revocation.

**4. Branch inventory and revocation scope**
- **Read-only metadata available here:** the Vercel store maps to Neon project `green-bar-78820765` (`externalResourceId`), region `iad1`, auth enabled. **No branch list is exposed through Vercel**, and no Neon API key exists (none may be created).
- **Supporting evidence of no per-deployment branching:**
  - the store connection's per-deployment branch option was **unticked** when it was saved (owner's screenshot);
  - the Preview deployment `dpl_6yzV…` shows integration status `ready` with start = completion (no branch provisioning);
  - PR comments come only from `vercel[bot]`, with no Neon branch bot.
- **Owner confirmation required** (supported, read-only): Neon console → project `green-bar-78820765` → **Branches**. Report the full list, **including archived or expired branches** if the view offers a filter. Earlier screenshot evidence shows one branch, `main` (`br-polished-morning-auhb1u2m`).
- **Revocation scope:** reset `neondb_owner` on **every** branch listed. Expected: only `main`. Other roles (`cloud_admin`, `neon_service`, `neon_auth`) aren't touched.

### R2.22 Independent review of R2.20/R2.21: GO (with conditions), no P0/P1. Amendments applied.

**Freeze live check (16:11Z):** holding.
- `main` `e921f54`; Production `dpl_mYJA…`; project and env `updatedAt` 15:42:21Z; 23 entries, **no `AURA_DATABASE_URL` yet**; bypass 0; latest deployment the 13:28:54Z Preview.
- Previous Production deployment is `dpl_CGik…` (CLI). Team plan **Hobby** confirmed.
- Open drafts #346 **and #344** (baseline note added).

**Confirmed by the reviewer:**
- The override can't alter migrations.
- The only build-time database use of `AURA_DATABASE_URL` is `/api/health`'s `SELECT 1`. All five `lib/db` pages are dynamic; there's no `generateStaticParams`, sitemap or robots route.
- Grants, `REVOKE` and default privileges are correct; runtime needs only DML plus `pg_advisory_xact_lock`.
- The rollback table is correct on Hobby.

**Amendments (supersede R2.20/R2.21 where they conflict):**

- **F1 + F2, choose the creation method before creating anything; secret-safe scoped role.**
  - **Default method (M2): an SQL-created role without `neon_superuser`.** In the SQL editor as `neondb_owner`, run `CREATE ROLE aura_app_2026_11 LOGIN;` (no password in SQL). Then the owner sets the password from **psql** with `\password aura_app_2026_11`. psql sends a SCRAM verifier, so no plaintext appears in any query history. The psql session connects as `neondb_owner` using the Neon console **Connect** string, typed or pasted only into the local psql prompt.
  - **Gate:** the new role must connect through the **pooled** endpoint, tested with one-off local psql (password typed at the prompt): `SELECT session_user, current_user;` → `aura_app_2026_11`. **If the pooler rejects the SQL-created role, STOP before Vercel entry**, and use method M1 below.
  - **Fallback (M1): a console-created role under a new name `aura_app_2026_11b`.** Use it only if the pre-check shows `neon_superuser` *does not* reach `pg_read_all_data`/`pg_write_all_data`, or the owner accepts the `_prisma_migrations` reachability risk as P2. Never reuse a name.
  - **`neonctl --access read_write` is not used.** Its flag behaviour is unverified, it needs local CLI auth or an API key, and it prints the password to the terminal.
- **F3, pre-check depth.** Add `SELECT pg_has_role('neon_superuser','pg_write_all_data','USAGE'), pg_has_role('neon_superuser','pg_read_all_data','USAGE');` (inheritance-aware). The **post-creation `has_table_privilege` gates are the authoritative STOP**: `_prisma_migrations` S/I/U/D must all be false, and `"User"` INSERT must be true.
- **F4, the database probe is named explicitly.**
  - `/api/health` on `aura-updated` is a **static prerender** (`x-vercel-cache: HIT`), so it isn't runtime evidence.
  - Runtime gates: (i) owner magic-link sign-in (a real dynamic read and write); (ii) `GET /moment/<nonexistent>` → `NOT_FOUND` (a real `SELECT`); (iii) the `pg_stat_activity` role gate.
  - Optional build-time signal: D2's prerendered `/api/health` body shows whether the new string connected at build.
- **F5, D1 env-timing gate.**
  - Enter `AURA_DATABASE_URL`, the new `RESEND_API_KEY` and the new `AUTH_SECRET` **only after D1 is READY and is the Production target**.
  - Claude reads back that each new or updated variable's `createdAt`/`updatedAt` is later than D1's `createdAt`, and that D1's runtime sessions are `neondb_owner`.
  - **No Redeploy of D1.**
- **F6, sequences.** Add `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aura_app_2026_11;`. (There are no serial columns today; this is future-proofing.) Objects outside `public` aren't covered; noted for I3.
- **F7, rollback trade-off (accepted).** Rolling back from D2 to D1 signs out D2 sign-ins and **re-validates tokens signed with the old (exposed) `AUTH_SECRET`** while D1 serves. Keep any rollback short and roll forward quickly.
- **F8:** after the reset, read back the deployment list. A new Production deployment is benign (it gets both new credentials) but must be recorded.
- **F9, branch inventory.**
  - The owner's Branches list (including archived, backup or restore branches) is the control.
  - It's **re-taken immediately before revocation**.
  - **Old-password-fails proof:** after the reset, a dynamic database route on **D1's unique deployment URL** fails (D1 uses the old credential through `DATABASE_URL`), while D2 stays healthy. The D1 URL is SSO-protected, so the **owner** opens it while logged in to Vercel.
- **F10, session gate precision.** Judge "no new `neondb_owner` app sessions" by `backend_start` after D2 go-live, excluding the editor's `pid` and the build's migrate window.
- **F11:** `AURA_DATABASE_URL` copies the same pooled format as the working store string: `-pooler` host, `sslmode=require`, complete user, password and database name.

### R2.23 Owner inputs VERIFIED and final sign-off (2026-11-10)

**Branch inventory: VERIFIED.** The Neon Branches page shows exactly one branch: `main` (default), `br-polished-morning-auhb1u2m`. No deletion needed. The list is re-taken immediately before revocation (F9).

**Privilege pre-check: VERIFIED.**
- `neondb_owner` is a member of `neon_auth` and `neon_superuser` (`admin_option=false` on both).
- `neon_superuser` is a member of `pg_create_subscription`, `pg_maintain`, `pg_monitor`, `pg_read_all_data`, `pg_signal_backend` and `pg_write_all_data`.
- Both roles have `rolsuper=false` and CREATEROLE, CREATEDB, BYPASSRLS and REPLICATION all true.
- `pg_has_role('neon_superuser','pg_write_all_data'/'pg_read_all_data','USAGE')` = true.
- **Consequence:** a console-created role would reach `_prisma_migrations` through `pg_write_all_data`, so **method M2 (SQL-created role) is selected.**
- **Also closed by the reset:** the exposed `neondb_owner` password currently reaches Neon Auth data too, through `neon_auth` membership. Resetting it closes this. The `neon_auth` role's own credentials aren't touched.

**Baseline (16:19:22Z):**
- `main` `e921f54`; Production `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`; project and env `updatedAt` 15:42:21Z; 23 entries; no `AURA_DATABASE_URL`.
- Store link `['production']`, last rotation 2026-08-14; bypass 0; auto-assign `true`; `lastRollbackTarget` null.
- Latest deployment is the 13:28:54Z Preview; #346 and #344 drafts unchanged; 0 runs in progress.
- `/` 200; database read OK; `/api/mcp` 404; Palmistry pending.

**Final independent sign-off: no P0/P1 remain. GO to request I0-C authorization.**
- M2 is confirmed correct: a CREATEROLE creator gets ADMIN on the role it creates, so `\password` and the grants work.
- All membership gates are STOP conditions, including a new `neon_auth` gate.
- P3 notes: use psql for `\password` (the SQL editor can't run it), with conninfo and the password typed at the prompt; generate the new password at random (≥32 bytes, never echoed); run the pooled-connect gate before the grants.

## G2-FINAL — Effective Privilege Verification (2026-11-10)

**Baseline (16:24:02Z):** `main` `e921f54`; Production `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`; project and env `updatedAt` 15:42:21Z; 23 env entries, no `AURA_DATABASE_URL`; bypass 0; no deployment after 13:28:54Z. **Unchanged.** Role not created.

**Owner concern addressed:** `REVOKE ALL … FROM aura_app_2026_11` removes only *direct* grants. A role can still reach a table through **`PUBLIC`** (every role is implicitly in it), through role **membership or inheritance**, through **ownership**, or through **column-level** grants. So G2 relies on **effective** privilege functions (`has_table_privilege`, `has_any_column_privilege`, `has_schema_privilege`, `pg_has_role`), which account for all of these, not on inspecting explicit grants.

### 1. Existing privilege findings

**Verified (owner, earlier):**
- `neondb_owner` owns all 25 `public` tables, including `_prisma_migrations`.
- `neondb_owner` is a member of `neon_superuser` and `neon_auth`. `neon_superuser` is a member of `pg_read_all_data` and `pg_write_all_data` (effective).
- The single branch is `main`.

**Verified (code inspection, `origin/main` `e921f54`, `apps/web/lib` + `apps/web/app`):**

| Operation in app SQL | Count | Privilege needed |
|---|---|---|
| `INSERT INTO` | 30 | INSERT |
| `UPDATE "…"` | 46 | UPDATE (+ SELECT for WHERE) |
| `DELETE FROM` | 10 | DELETE (+ SELECT) |
| `ON CONFLICT … DO UPDATE` | 16 | INSERT + UPDATE + SELECT |
| `RETURNING` | 67 | SELECT |
| `SELECT … FOR UPDATE` / `FOR SHARE` | 12 / 13 | SELECT + **UPDATE** (Postgres requires UPDATE for row locks) |
| `pg_advisory_xact_lock(...)` | 9 | EXECUTE on the function (default PUBLIC) |
| `TRUNCATE`, `DROP`, `CREATE`/`ALTER TABLE`, `COPY` (as SQL) | **0** | — (all text hits are comments or prose) |
| Sequences/`nextval`, temp tables, `LISTEN`, `SET ROLE` | **0** | — |
| `information_schema`, `pg_catalog`, `neon_auth`, `_prisma_migrations` | **0** | — |

- **Schema objects** (51 migrations): **24 application tables** (`AuraMoment`, `AuthCode`, `Capture`, `CustomCity`, `DailyReflection`, `DayBuilderDismissal`, `Goal`, `GoalActivity`, `GoalActivityExecution`, `GoalActivityOccurrence`, `GuestConversionRedemption`, `Habit`, `HabitLog`, `PlanCreationIdempotency`, `PlannedActivity`, `ProductEvent`, `PushSubscription`, `ReminderAttention`, `ReminderDelivery`, `SavedPerson`, `User`, `UserActivityPreference`, `UserAvailabilityPeriod`, `VisitLog`), plus `_prisma_migrations` = 25.
- No sequences, serial or identity columns, views, functions, triggers, extensions, RLS policies, or non-`public` schemas created by migrations.
- **Foreign keys:** checks run with the referenced table owner's rights (Postgres RI triggers), so no extra grant is needed.

**Not yet verified, needs owner read-only evidence (§5a):**
- `PUBLIC` privileges on `_prisma_migrations`, on the `public` schema, and on the database;
- existing default privileges;
- `PUBLIC` EXECUTE on `pg_advisory_xact_lock`;
- the Postgres server version (it determines whether `MAINTAIN` exists and whether `PUBLIC` has `CREATE` on `public`).

### 2. Proposed replacement-role grant design (M2; unchanged except where noted)

- `CREATE ROLE aura_app_2026_11 LOGIN;` (by `neondb_owner`, so it isn't in `neon_superuser`); password set via psql `\password`.
- `GRANT USAGE ON SCHEMA public` (no `CREATE`).
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public`, then `REVOKE ALL ON public."_prisma_migrations"`. Net effect: DML on the 24 application tables only.
- **No** TRUNCATE, REFERENCES, TRIGGER, MAINTAIN or CREATE.
- **If §5a shows `PUBLIC` lacks `CONNECT` on the database or `EXECUTE` on `pg_advisory_xact_lock`:** add `GRANT CONNECT ON DATABASE <db>` and/or `GRANT EXECUTE ON FUNCTION pg_advisory_xact_lock(bigint)` to the role. (Function grants on system functions may need elevated rights; STOP if refused.)
- **If §5a shows `PUBLIC` has any privilege on `_prisma_migrations` (G2-A):** the design is **not** sufficient by itself. It needs an additional, separately authorized `REVOKE ALL ON public."_prisma_migrations" FROM PUBLIC;` (Prisma runs as the owner, so it's unaffected). This becomes a **revision**, not something waived.

### 3. `PUBLIC` privileges: explicit treatment (G2-A)

- **Table:** Postgres's default ACL for a new table gives `PUBLIC` **nothing**. Only an explicit `GRANT … TO PUBLIC` would. Verify with §5a Q2.
- **Schema `public`:** in Postgres ≥ 15 the default is `PUBLIC` **USAGE only**. In ≤ 14, `PUBLIC` also had **CREATE**, which would let the new role create objects in `public`. Verify with §5a Q1 and Q3. If `CREATE` is granted to `PUBLIC`, the execution-time gate `has_schema_privilege(role,'public','CREATE') = false` **fails**, and the fix (`REVOKE CREATE ON SCHEMA public FROM PUBLIC`) needs separate authorization.
- **Database:** `PUBLIC` normally has `CONNECT` and `TEMPORARY` (harmless; recorded) but not `CREATE`. Verify with §5a Q4.

### 4. Default privilege implications (G2-E)

- **Existing objects:** covered by `GRANT … ON ALL TABLES` (a one-time snapshot of the 25 tables), then `REVOKE … _prisma_migrations`.
- **Future objects:** without default privileges, any table a later migration creates (as `neondb_owner`) would be unreadable by the app, and runtime would break after the next migration. `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aura_app_2026_11` covers them.
  - **Migration-object risk:** Prisma creates no migration objects other than `_prisma_migrations`, and only when it's **absent**. It exists now and is never recreated during `migrate deploy`. So default privileges reach a migration object only if `_prisma_migrations` is dropped and recreated (a database reset). The plan records this as a **standing runbook check** (§5b G2-E check) after any reset.
  - **Sequences:** default `USAGE, SELECT ON SEQUENCES` for future serial or identity columns. No `UPDATE` (`setval`) is granted.
  - **Maintainable alternative, if the owner prefers no broad defaults:** each migration that creates a table includes its own `GRANT … TO aura_app_2026_11`. This couples migrations to the role name and is deferred to GOV-02-I3 (least privilege). For I0-C the broad table default is retained, together with the explicit gate.
- **Existing default privileges** (§5a Q5): any default already granting rights to `PUBLIC` for objects `neondb_owner` creates would extend to the new role. That must be reviewed; any `PUBLIC` default ACL entry is a STOP for review.

### 5a. Design-time evidence the owner must provide (read-only, SQL editor on `main` as `neondb_owner`)

```sql
-- Q0: server version (MAINTAIN exists in PG17+; PG15+ changed public-schema defaults)
SHOW server_version;

-- Q1: public schema ACL (grantee 0 = PUBLIC)
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
WHERE n.nspname = 'public' ORDER BY 1,2;

-- Q2: _prisma_migrations ACL, incl. PUBLIC and column-level grants
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
WHERE c.oid = 'public."_prisma_migrations"'::regclass ORDER BY 1,2;
SELECT attname, attacl FROM pg_attribute
WHERE attrelid = 'public."_prisma_migrations"'::regclass AND attacl IS NOT NULL;

-- Q3: what PUBLIC can do, via effective checks
SELECT has_table_privilege('public','public."_prisma_migrations"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS public_on_migrations,
       has_any_column_privilege('public','public."_prisma_migrations"','SELECT,INSERT,UPDATE,REFERENCES') AS public_cols_on_migrations,
       has_schema_privilege('public','public','CREATE') AS public_create_in_public,
       has_schema_privilege('public','public','USAGE')  AS public_usage_in_public;

-- Q4: database ACL for PUBLIC
SELECT CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_database d, aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) a
WHERE d.datname = current_database() ORDER BY 1,2;

-- Q5: existing default privileges
SELECT d.defaclrole::regrole AS for_role, d.defaclnamespace::regnamespace AS in_schema, d.defaclobjtype,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_default_acl d, aclexplode(d.defaclacl) a ORDER BY 1,2,3,4;

-- Q6: PUBLIC execute on the advisory-lock function the app uses
SELECT has_function_privilege('public','pg_advisory_xact_lock(bigint)','EXECUTE') AS public_exec_xact_lock;
```

**Pass criteria for design verification:**
- Q2 and Q3 `public_on_migrations` and `public_cols_on_migrations` = **false**, with no `PUBLIC` row in Q2;
- Q3 `public_create_in_public` = **false**;
- Q4: `PUBLIC` has `CONNECT`;
- Q5: no `PUBLIC` grantee;
- Q6 = **true**.

Any deviation means **G2 REVISION REQUIRED**, with a narrowly scoped, separately authorized fix (§2/§3).

### 5b. Execution-time verification (I0-C step 3; after `CREATE ROLE`, `\password` and the grants; before any Vercel entry or D2)

**Part 1, effective checks** (as `neondb_owner`, naming the role):

```sql
-- Memberships, direct AND indirect (must return zero rows)
SELECT r.rolname FROM pg_roles r
WHERE r.rolname <> 'aura_app_2026_11' AND pg_has_role('aura_app_2026_11', r.oid, 'MEMBER');

-- Attributes (all false)
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolinherit
FROM pg_roles WHERE rolname = 'aura_app_2026_11';    -- rolinherit true is fine (no memberships to inherit)

-- Ownership (both 0)
SELECT (SELECT count(*) FROM pg_class WHERE relowner = 'aura_app_2026_11'::regrole) AS owned_relations,
       (SELECT count(*) FROM pg_namespace WHERE nspowner = 'aura_app_2026_11'::regrole) AS owned_schemas;

-- _prisma_migrations: every privilege (all false); add 'MAINTAIN' to the list if server_version >= 17
SELECT p, has_table_privilege('aura_app_2026_11','public."_prisma_migrations"', p) AS granted
FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p;
SELECT has_any_column_privilege('aura_app_2026_11','public."_prisma_migrations"','SELECT,INSERT,UPDATE,REFERENCES') AS any_column;  -- false

-- Application tables: every one of the 24 has S/I/U/D, and none has TRUNCATE/TRIGGER/REFERENCES
SELECT c.relname,
       has_table_privilege('aura_app_2026_11', c.oid, 'SELECT') AS s, has_table_privilege('aura_app_2026_11', c.oid, 'INSERT') AS i,
       has_table_privilege('aura_app_2026_11', c.oid, 'UPDATE') AS u, has_table_privilege('aura_app_2026_11', c.oid, 'DELETE') AS d,
       has_table_privilege('aura_app_2026_11', c.oid, 'TRUNCATE,TRIGGER,REFERENCES') AS extra
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
ORDER BY 1;    -- expect 24 rows: s,i,u,d = true; extra = false

-- Schema and database
SELECT has_schema_privilege('aura_app_2026_11','public','USAGE')  AS public_usage,    -- true
       has_schema_privilege('aura_app_2026_11','public','CREATE') AS public_create,   -- false
       has_database_privilege('aura_app_2026_11', current_database(), 'CONNECT') AS db_connect,  -- true
       has_database_privilege('aura_app_2026_11', current_database(), 'CREATE')  AS db_create,   -- false
       has_function_privilege('aura_app_2026_11','pg_advisory_xact_lock(bigint)','EXECUTE') AS xact_lock;  -- true

-- Neon Auth isolation (only if schema neon_auth exists): all false
SELECT n.nspname, has_schema_privilege('aura_app_2026_11', n.oid, 'USAGE') AS usage FROM pg_namespace n WHERE n.nspname = 'neon_auth';
SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'neon_auth'::regnamespace
  AND has_table_privilege('aura_app_2026_11', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER');   -- zero rows

-- Default privileges now in place (review): only the two entries for aura_app_2026_11, plus any pre-existing (Q5)
SELECT d.defaclrole::regrole, d.defaclnamespace::regnamespace, d.defaclobjtype, a.grantee::regrole, a.privilege_type
FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE a.grantee = 'aura_app_2026_11'::regrole;
```

**Part 2, authenticated as `aura_app_2026_11`** (one-off psql to the **pooled** endpoint, password typed at the prompt; read-only statements only):

```sql
SELECT session_user, current_user;                         -- aura_app_2026_11, aura_app_2026_11
SELECT count(*) FROM "User";                               -- succeeds (read)
SELECT 1 FROM public."_prisma_migrations" LIMIT 1;         -- MUST fail: permission denied
SELECT pg_advisory_xact_lock(0);                           -- succeeds (transaction-scoped; released at statement end)
```

- **Writes** are not executed manually against Production. They're proven at D2 go-live by the owner's magic-link sign-in, which writes `AuthCode`, `User` and `VisitLog`, and by the `pg_stat_activity` role gate.
- Rollback to D1 is available until revocation.

### 6. STOP conditions (G2; before any Vercel entry or D2; not to be weakened)

Stop if any of these holds:
- any membership row is returned;
- any admin attribute is true;
- the role owns any object;
- any `_prisma_migrations` privilege is true, including column-level, or MAINTAIN on PG17+;
- the authenticated read of `_prisma_migrations` succeeds;
- any of the 24 application tables lacks S/I/U/D, or has TRUNCATE/TRIGGER/REFERENCES;
- `public_create` or `db_create` is true;
- `db_connect` or `xact_lock` is false;
- any Neon Auth privilege is true;
- an unexpected default-privilege entry appears;
- the pooled connect fails.

**Any G2 STOP leaves the role unused:** no Vercel entry, no D2. The owner then decides on cleanup (`DROP ROLE` after `REVOKE`) under separate authorization.

### 7. Independent review result: design correct, amendments applied (no P0)

The reviewer was an independent read-only subagent with no database access. It checked the design against `origin/main` `e921f54` and all 51 migrations.

**Confirmed:**
- `has_table_privilege` and `has_any_column_privilege` count `PUBLIC`, ownership and INHERIT memberships.
- `pg_has_role(…,'MEMBER')` catches every membership path, including Postgres 16 SET-only memberships.
- `'public'` is a valid pseudo-role argument, and the `aclexplode`/`acldefault` usage is right.
- `createrole_self_grant` and creator auto-ADMIN run only in the direction creator → new role, so they don't trip the membership gate.
- The default-privilege design is valid.
- The app inventory privilege rules are correct.

**New fact:** `neon_superuser` is a member of `pg_maintain`, which exists only from **Postgres 17**. So the server is **PG ≥ 17** (inferred; `SHOW server_version` confirms it at step 0).

| ID | Sev | Finding | Applied amendment |
|---|---|---|---|
| F1 | P1 | §14 said READY while G2 §7 and §8 were pending | §14 rewritten (below) |
| F2 | P2 | MAINTAIN is mandatory on PG17 | Added **unconditionally**: `_prisma_migrations` list `…,'TRIGGER','MAINTAIN'`; app-table `extra` = `'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN'`; Q3 list adds `MAINTAIN` |
| F3 | P2 | Advisory locks call `pg_advisory_xact_lock(hashtext($1))`, so `hashtext(text)` EXECUTE is required and wasn't checked | Q6 and §5b add `has_function_privilege(role,'hashtext(text)','EXECUTE')` → true. Part 2 probe becomes `SELECT pg_advisory_xact_lock(hashtext('g2-probe'));`. Also `has_function_privilege(role,'now()','EXECUTE')` → true. |
| F4 | P2 | SECURITY DEFINER functions are indirect paths the privilege functions don't see | New gate: `SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema') AND has_function_privilege('aura_app_2026_11', p.oid, 'EXECUTE');`. Any row goes to owner review **before D2**. Unexpected rows touching `public` tables or `neon_auth` mean **STOP**. Note: no worse than today, when the app runs as the owner. |
| F5 | P2 | Q5 (`PUBLIC` default ACLs) had no execution-time equivalent | The §5b default-privilege query **drops the grantee filter**. Any `PUBLIC` grantee, or any entry other than the two new `aura_app_2026_11` entries plus the reviewed Q5 baseline, means **STOP**. |
| F6 | P3 | No row-count STOP | App-table gate: **row count ≠ 24 means STOP** |
| F7 | P3 | Attribute labelling | Attribute gate = `rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication` all **false**, and `rolcanlogin` **true** (`rolinherit` is informational) |
| F8 | P3 | Brief window between GRANT and REVOKE | GRANTs, `REVOKE … _prisma_migrations` and both `ALTER DEFAULT PRIVILEGES` run in a single `BEGIN; … COMMIT;` |
| F9 | P3 | Inventory drift | Corrected: advisory-lock calls are **7** (`app/api/plans/route.ts:298`, `lib/dayConstructorAcceptancePersistence.ts:318`, `lib/db.ts:1697/2006/3053`, `lib/planMove.ts:92`, `lib/remainingDayRecompositionAcceptance.ts:199`). Migration 0039 creates enum `"PlannedActivitySchedulingMode"` (DML needs no USAGE). `CustomCity.id DEFAULT gen_random_uuid()` is never invoked, because the app supplies `id` (`lib/db.ts:199`). `DEFAULT now()` runs as the inserter (PUBLIC EXECUTE). |
| F10 | P3 | Ownership coverage | The ownership check adds `pg_proc` and `pg_type` counts, both 0 |
| F11 | P3 | A fallback EXECUTE grant on system functions may be refused | STOP-if-refused, extended to `hashtext` |

**Placement of Q0–Q6:**
- **Moved to I0-C step 0.** They run read-only **before** `CREATE ROLE`. Any deviation from the §5a pass criteria (with MAINTAIN added) is a **STOP** needing a separately authorized revision, for example `REVOKE … FROM PUBLIC`.
- The amended §5b gates remain the **authoritative fail-safe STOP** before any Vercel entry or D2.
- Every failure mode of Q1–Q4 and Q6 is also caught by §5b (role-level effective checks include `PUBLIC`). Q5 is now covered by F5. A STOP at execution leaves only an unused role, with no Production impact.
- **Optional:** if the owner runs Q0–Q6 before authorizing, that condition is removed early.

### 8. Remaining blockers

**No design blockers.** Q0–Q6 are an **execution-time step-0 STOP gate**, not a pre-authorization blocker.

## G2-PRECHECK — Q0–Q6 results (owner-executed, Neon `main`, 2026-11-10)

**Baseline (16:32:12Z):** `main` `e921f54`; Production `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`; Vercel `updatedAt` 15:42:21Z; 23 env entries, no `AURA_DATABASE_URL`; Neon project `green-bar-78820765`, store link `['production']`, last rotation 2026-08-14; no deployment since 13:28:54Z; #346 and #344 unchanged. **No drift.**

| Query | Owner result | Criterion | Status |
|---|---|---|---|
| Q0 | PostgreSQL **17.11** | ≥ 17 (MAINTAIN exists; PG15+ public-schema defaults) | **PASS** |
| Q1 | `PUBLIC`: USAGE on `public`, **no CREATE** | USAGE only | **PASS** |
| Q2 | `_prisma_migrations` ACL: all 8 privileges (`arwdDxtm`, incl. MAINTAIN) to `neondb_owner` only; **no `PUBLIC`**; column-level query **no rows** | No `PUBLIC`, no column ACLs | **PASS** (owner ACL consistent with the PG17 default) |
| Q3 | `public_on_migrations=false`, `public_cols_on_migrations=false`, `public_create_in_public=false`, `public_usage_in_public=true` | First three false | **PASS**. MAINTAIN is necessarily false for `PUBLIC` given Q2. The step-0 re-run uses the amended list with MAINTAIN. |
| Q4 | `PUBLIC`: **CONNECT, TEMPORARY**; no CREATE | CONNECT present; no CREATE | **PASS** (no fallback CONNECT grant needed) |
| Q5 | Default ACLs only **`cloud_admin` → `neon_superuser`** (tables, sequences); **no `PUBLIC`** | No `PUBLIC` grantee | **PASS** |
| Q6 | `PUBLIC` EXECUTE on `pg_advisory_xact_lock(bigint)`, `hashtext(text)`, `now()`: all **true** | All true | **PASS** (no fallback EXECUTE grants needed) |

**Recorded decisions:**
- **`PUBLIC` TEMPORARY on the database: ACCEPTED (P3), deferred to GOV-02-I3.**
  - Temp objects are session-local (`pg_temp_N`), and the Neon pooler pools per user and database.
  - The app creates no temp tables (code inventory: 0). The risk is bounded disk use by a misused credential, which is less than the DML that credential legitimately has, and no worse than today (`neondb_owner`).
  - Revoking it means a database-wide `REVOKE … FROM PUBLIC`, which affects every role, including Neon tooling. It is out of I0-C scope. Large-object creation by `PUBLIC` is noted for I3 too.
- **Q5 baseline:**
  - `cloud_admin` → `neon_superuser` defaults apply only to objects created by `cloud_admin`, granted to `neon_superuser`. The new role isn't a member (membership gate), so there's **no path**. If `cloud_admin` created a table in `public`, the app-table row-count gate (≠ 24) would STOP.
  - At step 0 the owner captures the **exact** Q5 rows as the objective baseline. The step-3 default-ACL gate expects exactly that baseline plus **6 exploded rows** for grantee `aura_app_2026_11` (tables S/I/U/D, sequences USAGE/SELECT, for role `neondb_owner` in `public`), with the grantee rendered so `PUBLIC` shows as `PUBLIC`.
- **Execution-time coverage (independently confirmed):**
  - effective privileges including `PUBLIC`; direct and indirect membership;
  - ownership (`pg_class`, `pg_namespace`, `pg_proc`, `pg_type`);
  - `_prisma_migrations`, all 8 privileges plus column-level;
  - Neon Auth isolation;
  - 24 app tables with S/I/U/D and no extras, plus a row-count STOP;
  - EXECUTE on the 3 functions; no schema or database CREATE;
  - SECURITY DEFINER review; unfiltered default-ACL gate; authenticated pooled probe.
  - **Hardening added:** an all-schema relation census (any privilege outside `pg_catalog`/`information_schema` must be exactly the 24 `public` app tables); MAINTAIN in the Neon Auth check.
- **Procedural fix (P2):** the G2-FINAL §5b SQL text above is **superseded** by the consolidated script in execution plan **§11.5b**. Only §11.5b may be pasted at execution.

**Independent verification:** **PRECHECK PASSED — READY FOR I0-C AUTHORIZATION.** No P0/P1. The P2/P3 items above are applied.

## 14. Verdict (G2-PRECHECK, 2026-11-10; supersedes all earlier verdict lines)

**PRECHECK PASSED — READY FOR I0-C AUTHORIZATION.**
- Q0–Q6 all pass. `PUBLIC` TEMPORARY is recorded and accepted (P3, deferred to I3).
- No remediation required; no unresolved P0/P1.
- Q0–Q6 are re-run at I0-C step 0, and all execution-time G2 gates run from execution plan §11.5b.

## 14-prev. Verdict (rewritten 2026-11-10 after G2-FINAL)

**G2 DESIGN VERIFIED — READY FOR I0-C AUTHORIZATION.**
- The grant design is verified against code and Postgres semantics.
- Every effective-privilege condition is explicitly gated at execution (step 0: Q0–Q6; step 3: the amended §5b gates and the F4 SECURITY DEFINER review).
- No unresolved P0/P1. Baseline verified at 16:24Z; freeze holding.

_(The "FINAL: READY" text written at 16:19Z, before G2, is superseded by this verdict.)_

## 14-old. Verdict (pre-G2)

**FINAL: READY FOR I0-C AUTHORIZATION.** Owner inputs are verified, no P0/P1 remains, the independent review signs off, and the baseline and freeze are verified at 16:19Z. The authorization request is in the execution plan, §11.

_(Earlier "CONDITIONAL GO" text below is superseded.)_

**Final readiness verdict: CONDITIONAL GO.** No P0/P1 remains; the design is independently reviewed and the amendments are applied (R2.22). The I0-C authorization request may be issued **as soon as the owner provides:**
1. the **Neon branch list** for project `green-bar-78820765` (Branches page, including archived or backup branches; names only);
2. the **privilege pre-check output** (R2.21 §2 queries plus the F3 query), run read-only as `neondb_owner` on `main`.

At the I0-C gate, the owner explicitly approves the **two freeze exceptions** (the `db.ts` PR and the docs PR), plus the role-creation method that follows from the pre-check: **M2** (SQL-created, password via psql `\password`) by default, or **M1** (`aura_app_2026_11b`) as the fallback.

_(The paragraph below is superseded by this verdict.)_

**Readiness: NOT YET READY FOR I0-C AUTHORIZATION — OWNER INPUT REQUIRED.**

**Done:**
- merge freeze;
- B-1 (owner-accepted);
- role classification;
- O-1;
- O-4;
- the store link set to Production only;
- the cutover design (**O-min**, independently reviewed; revisions applied).

**Remaining blockers:**
1. **Neon branch inventory (P1):** the count and names of all branches in project `green-bar-78820765`, plus the owner's decision for each non-`main` branch (delete, or reset `neondb_owner`).
2. **Owner acceptance** of the two freeze exceptions (the `db.ts` code PR and the docs PR) and of the I0 over-privilege note (#5).

**Optional:** the `main` compute endpoint ID (`ep-…`, from Branches → main → Computes). It's no longer blocking.

_(Earlier verdict lines are superseded: "PREFLIGHT BLOCKED", "READY FOR I0-C AUTHORIZATION", "ROLE MAPPING INCOMPLETE", the earlier "ROTATION PLAN REVISION REQUIRED".)_

**Earlier note:** R2 verdict was ROTATION PLAN REVISION REQUIRED, with the pre-step (a) **now done**, **O-1 completed** and **S-1..S-3 resolved (route 2)**. O-2 is **blocked** (local placeholders); it's replaced by R2.17 methods (iii)/(iv) (optional, owner) and (v) (an execution STOP gate). Remaining owner inputs: **Q2 branch and endpoint confirmation**, **O-4**, and optionally Q1 (iii)/(iv). Still needed:
- (b) owner confirmation of S-1..S-3;
- (c) the O-1/O-2 checks (with the F7 additions) and O-4.

The database variables are Marketplace-managed, so the plan is now Path S (R2.12). It needs:
- (a) authorization for the store pre-step that sets the link to Production only;
- (b) owner confirmation of S-1..S-3;
- (c) the mapping checks O-1/O-2 (with the F7 additions) and O-4.

Supersedes the lines below.

_(Earlier R2 interim verdict "ROLE MAPPING INCOMPLETE — OWNER INPUT REQUIRED" superseded.)_

**AURA-GOV-02-I0-C0: READY FOR I0-C AUTHORIZATION** _(pre-R2; suspended)_

- Merge freeze: confirmed by the owner and revalidated.
- All credential consumers accounted for. The self-hosted test deployment's disruption risk is owner-accepted (B-1); the Neon inventory is complete (B-2).
- The rotation plan was independently reviewed in two rounds, with no unresolved P0/P1.
- No Production change was made under I0-C0.

_(Superseded: "PREFLIGHT BLOCKED, solely on B-2".)_

**When B-2 arrives:**
1. Record it in an addendum: role count, the `public` table owner, whether the owner role can log in. Names stay private.
2. Re-run the baseline and the freeze check.
3. Request **AUTHORIZE AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION**.

**Named follow-up (out of I0 scope):** a governance ticket for `aura.voyforge.com`: keep and govern (update, access review, health-route leak), or decommission.
