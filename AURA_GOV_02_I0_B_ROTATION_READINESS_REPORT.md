# AURA-GOV-02-I0-B: Production Credential Rotation Readiness Report

**Date:** 2026-11-10 · **Mode:** read-only preparation. No credentials were created or changed, no deployment was made, no PR was opened.

## Verdict: _see §10 (after independent review)_

---

## 1. Credential dependency matrix (from `origin/main` `e921f54`)

| Variable | Consumers (code and config) | Production required? | Rotation action (I0-C) |
|---|---|---|---|
| `DATABASE_URL` | `apps/web/lib/db.ts` (`new Pool({ connectionString })`: all runtime database access, including auth, API routes and the daily cron `/api/internal/reminders/dispatch`); `apps/web/prisma/schema.prisma` (`url = env("DATABASE_URL")`, so `prisma migrate deploy` in `vercel-build.sh`); `apps/web/scripts/retention-report.js` (operator script) | **Yes** | **Replace** with the new role's URL, same form (pooled or direct) as today |
| `RESEND_API_KEY` | `apps/web/lib/email.ts` (sign-in magic link); `app/api/auth/request-link/route.ts` (provider check) | **Yes** (sign-in email) | **Replace** with a new key; revoke the old one after verification |
| `RESEND_FROM_ADDRESS` | `apps/web/lib/email.ts` | Yes (non-secret) | Keep |
| `DATABASE_URL_UNPOOLED`, `PGHOST`, `PGHOST_UNPOOLED`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_URL_NO_SSL`, `POSTGRES_PRISMA_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `POSTGRES_HOST` | **No application consumer.** The only matches are `ci.yml` (CI's own local Postgres service variables) and `deploy/compose.yml` (the self-hosted stack's own local Postgres). | **No** | **Delete from Production in I0-C** (recommended), or leave them as dead values after revocation. Note: `node-postgres` falls back to `PG*` variables for fields missing from a connection string. The new `DATABASE_URL` is complete, so this doesn't apply, but deleting them removes any stale-credential fallback. |
| `NEON_PROJECT_ID`, `NEON_AUTH_BASE_URL`, `VITE_NEON_AUTH_URL` | None | No | Delete (recommended) or leave; not credentials |
| `AUTH_SECRET` (Production entry) | Session and magic-link HMAC | Yes | **Out of scope.** It was never targeted at Preview; Preview has its own value. |

**Other Production consumers outside Vercel:**
- `deploy/` holds a self-hosted Docker stack (from PRs #12–#16): `compose.yml`, `deploy.sh`, `nginx-aura.conf`, server path `/srv/aura/app.env`. It uses **its own local `postgres:16` container**, not Neon.
- **Unknown:** whether that stack is still running and whether its `app.env` holds the **same Resend key**. If it does, revoking the old Resend key would break its email.
- **Owner must confirm before I0-C.** This is precondition P-5.

**Neon integration:** installed for the team, with linked projects `[]`. None of the 23 variables is integration-managed, so no integration will overwrite the new values.

## 2. Neon rotation procedure (owner performs in I0-C; designed here)

The current role name is held in the sensitive `PGUSER` and is known to the owner; it isn't recorded here. Call it `<old_role>`, for example the Neon default `neondb_owner`. It **owns** the schema objects.

1. **Create the new role** in the Production Neon project's console (Roles → New role), for example `aura_app_2026_11`. Neon generates the password. Copy it straight into the Vercel dashboard (step 4); never into chat, files or tickets.
2. **Grant equivalent privileges** (Neon SQL editor, Production branch):

   ```sql
   GRANT <old_role> TO aura_app_2026_11;              -- membership: can act on objects owned by <old_role>
   ALTER ROLE aura_app_2026_11 SET ROLE <old_role>;   -- sessions run as owner: DDL on existing tables works,
                                                      -- and objects created by migrations stay owned by <old_role>
   ```

   These are **Production role and DDL statements**, executed only under I0-C authorization.
3. **Verify read-only in the SQL editor:**
   - `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname IN ('<old_role>','aura_app_2026_11');`
   - `SELECT pg_has_role('aura_app_2026_11','<old_role>','MEMBER');` → `true`
4. **Update Vercel Production `DATABASE_URL`** (dashboard, Production target only): same host and form as the current value (pooled or direct; mirror exactly), new user and password. Claude reads back that `updatedAt` changed and the target is Production only.
5. **Leave `<old_role>` with login enabled** until §5 verification passes.
6. **Revoke** (after verification): `ALTER ROLE <old_role> NOLOGIN;`.
   - This disables the exposed password **without** dropping the role or changing object ownership.
   - **Reversible** with `ALTER ROLE <old_role> LOGIN;` if anything breaks.
   - Don't reset or drop `<old_role>`.

## 3. Resend rotation procedure (owner performs in I0-C)

1. In Resend, create a new API key with the **same permission** as the current one (sending access, restricted to the verified sending domain if the current key is). Name it, for example, `aura-production-2026-11`.
2. Update Vercel Production `RESEND_API_KEY` (dashboard, Production only). Claude reads back the target and `updatedAt`.
3. After deployment, verify: the owner requests a sign-in link to their own address and receives it.
4. Revoke the old key in Resend, **only after** step 3 and after P-5 confirms that no other system (for example the self-hosted stack) uses it.

## 4. Production deployment and migration assessment

| Check | Finding |
|---|---|
| Current Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` at `e921f54` |
| Migration state | The Production build log for `e921f54` shows "51 migrations found … No pending migrations to apply". `main` has 51 `migration.sql` files. Open PRs #344 and #346 change **no** migrations. |
| Deployment mechanism today | Every push to `main` auto-builds and auto-goes-live. `vercel-build.sh` runs `prisma migrate deploy` with the **current** `DATABASE_URL` before `next build`. |
| Why a deploy is needed | Vercel env changes apply only to new deployments. The new `DATABASE_URL` and `RESEND_API_KEY` reach Production only through a new build. |
| Proposed candidate | A docs-only PR (one line in `docs/`, for example an I0 completion note), on top of `main` at the time of I0-C. It needs the four GOV-01 checks; the owner merges. Its build runs `migrate deploy` with the **new role**, and **0 pending** is expected. |
| Why a docs-only PR isn't automatically "risk-free" | The build still connects to the Production database (migrate step) and goes live immediately (auto-assign on). Risks and controls: (a) a migration landing on `main` between now and then → **merge freeze** from I0-C start, and re-check `migrate status` at the candidate SHA; (b) the new role lacking privileges → step 3 verification before deploying, and `migrate deploy` with 0 pending needs only connect and read on `_prisma_migrations`; (c) a wrong role in use → post-deploy verification §5.4; (d) credentials in CI logs → CI uses only its local Postgres and never sees Production values, and Vercel build logs redact the datasource host (observed). |
| Not `vercel redeploy` | A CLI redeploy creates a `source=cli` deployment (seen in M3), which complicates GOV-02's git-only identity rule. Use a git merge. |
| Preview access to the new credentials | Enter the new values **Production-only**. Claude reads back the targets. |
| Exact candidate SHA | Decided at I0-C time: the merge commit of the docs PR. The I0-C request will name the base SHA, and Claude re-verifies it before merge. |

## 5. Production verification procedure (I0-C)

1. The new deployment is `source=git`, its SHA equals the docs-PR merge commit, READY, promoted; and the build log shows "No pending migrations" and `[palmistry-bundle] OK`.
2. `/` → 200.
3. Live database read: `/moment/<nonexistent>` → `NOT_FOUND`.
4. **New role in use:** in the Neon console, Monitoring or `pg_stat_activity` (read-only, owner), a connection from `aura_app_2026_11` appears after a request. Also check that a request still works.
5. Sign-in email: the owner receives a magic link.
6. `/api/mcp` → 404, Palmistry sentinels 0, `protectionBypass` 0.
7. **After revocation** (`<old_role>` NOLOGIN, old Resend key revoked): repeat 2–5.

## 6. Required owner actions (I0-C)

1. Confirm **P-5**: is the self-hosted `deploy/` stack still running, and does it use the Production Resend key?
2. Announce a **merge freeze** for the duration.
3. Create the Neon role and grants (§2.1–2.3).
4. Create the Resend key (§3.1).
5. Enter both new values in Vercel, Production only.
6. Merge the docs-only PR that Claude opens.
7. Perform the email check.
8. Revoke (§2.6, §3.4) after verification.
9. Optional: authorize deleting the 16 unused Production variables, and deleting the 145 old Preview deployments.

## 7. Rollback

| Stage | Rollback |
|---|---|
| Before the deploy | Restore the old values in Vercel (owner). Nothing is live yet. |
| After the deploy, before revocation | Restore the old Vercel values and deploy again through a git commit. The old credentials are still valid. Or Instant Rollback to `dpl_mYJA…`, which carries the old env (Hobby: previous deployment only). |
| After revocation | `ALTER ROLE <old_role> LOGIN;` restores the old database password immediately. A Resend key can't be un-revoked, so if email breaks, create another key and redeploy. |

Schema: no migrations are expected. Application rollback doesn't reverse schema in any case.

## 8. STOP conditions (I0-C)

Stop if:
- the candidate shows pending migrations, or any PR with migrations merges during the freeze;
- the role verification (§2.3) fails;
- the deploy fails, is not `source=git`, or the SHA differs;
- any step in §5 fails → **do not revoke**;
- the new values show a Preview target;
- any secret value appears in output;
- P-5 is unresolved and revoking the Resend key is due.

## 9. Independent review (I0-D)

### 9.1 Round 1: ROTATION DESIGN REVISION REQUIRED (3 × P1)

| ID | Sev | Finding | Revision |
|---|---|---|---|
| F-1 | **P1** | Production `AUTH_SECRET` probably reached Preview from 2026-08-14 to 2026-08-21 (entry timestamps fit a split; verified). §1 wrongly said it was out of scope. | **§11.1:** rotate Production `AUTH_SECRET` in I0-C |
| F-2 | **P1** | Sensitive values can't be read back, so nobody can learn the role from `PGUSER`. The exposed variables may hold **more than one** role (the local mirrors show different users across `DATABASE_URL`, the other URLs, and `PGUSER`/`POSTGRES_USER`). | **§11.2:** role inventory from the Neon console; revoke every old login role |
| F-3 | **P1** | `NOLOGIN` alone leaves existing and pooled sessions working, and may not survive Neon's control plane re-applying role state on compute start | **§11.2:** revoke with Neon **Reset password** for each old role, terminate old-role backends, verify after a compute restart |
| F-4 | P2 | The merge freeze isn't in force; Greenaroz (write) or the owner could trigger an auto-live build before I0-C. If a target-only edit had lost a value, an empty `RESEND_API_KEY` would ship silently broken email. | **§11.3:** freeze starts **now**, with notice to Greenaroz and monitoring of Production deployments. Technical enforcement is an optional separate authorization. |
| F-5 | P2 | Local plaintext copies and local consumers are missing | **§11.4** |
| F-6 | P2 | GRANT may need ADMIN OPTION (Postgres 16+); `SET ROLE` default and pooler behaviour unverified | **§11.2** verification steps |
| F-7 | P2 | Rollback after revocation is overstated | **§11.5:** after revocation, only fix forward; revocation is a separate step after a soak period |
| F-8–F-10 | P3 | Counts, log row, retention | Fixed in the I0-A report |
| F-11 | P3 | Least-privilege Resend key; P-5 wording; the self-hosted stack's README specifies MOM, not Resend | **§11.6** |
| F-12 | P3 | Console Neon roles are members of `neon_superuser` (over-privileged) | Accepted for parity; least privilege is a follow-up |
| F-13 | P3 | Build-time install and build vector | Recorded in I0-A §7; supports rotation |

**Confirmed by the reviewer:** containment is correct; Production is unaffected; secret handling is compliant (no values in the reports or evidence); scope is compliant.

### 9.2 Round 2: READY FOR I0-C AUTHORIZATION

- F-1, F-2 and F-3 are resolved; F-4 to F-7 are adequate; no new P0/P1.
- Live state unchanged: `e921f54`; Production `dpl_mYJA…`; project `updatedAt` = last env edit (13:50:53Z); 0 bypass entries; no deployments since 13:28:54Z.
- The reviewer didn't read local `.env` files this round.

**`AUTH_SECRET` impact** (from `lib/auth.ts`: `sign`/`verify`/`hashAuthCode`):

| Token | Effect of rotation |
|---|---|
| Session cookie (30 days) | Users sign in again |
| Magic links and sign-in codes (15 min) | Invalidated |
| Guest-state token (30 min) | Lost |
| Day Constructor preview and recomposition proposal tokens | In-flight ones fail and must be regenerated |

No long-lived stored token depends on `AUTH_SECRET`. Push subscriptions, public moment links and reminder links don't use it.

**P3 runbook notes, adopted into I0-C:**
- **R2-1:** add in-flight previews and proposals to the impact list.
- **R2-2:** the terminate query filters on `usename` (the login user). Don't change it to `current_user`. Run a health check after each password reset.
- **R2-3:** schedule the compute restart (brief database interruption), then run health checks.
- **R2-4:** classify Neon-managed or system roles during reconciliation; don't reset them blindly.
- **R2-5:** open the new-role verification session with the SQL editor's role selector, or a one-off `psql` with the password typed at the prompt and never saved.
- **R2-6:** verify email first after go-live. Instant Rollback to `dpl_mYJA…` restores all three old values until revocation.
- **R2-7:** the soak keeps the old database and Resend credentials valid about a day longer, which is accepted; revoke promptly. §11.7 step 4 count: the unused Production variables are **17** names (14 database plus 3 Neon). I0-A's "16" referred to the 16 database variables besides `DATABASE_URL`.

**Side observation (pre-existing, outside I0):** `INTERNAL_REMINDER_DISPATCH_SECRET` and `INTERNAL_METRICS_SECRET` aren't set in Vercel, so the daily reminder cron fails closed. Owner awareness only.

## 11. Revisions (supersede the referenced sections)

### 11.1 Add Production `AUTH_SECRET` rotation (F-1)

- Generate a new random value of at least 32 characters (owner, locally, e.g. `openssl rand -base64 48`). Enter it **only** in the Vercel Production `AUTH_SECRET` entry `5zHVNkKL8cSkGHcn`, Production target. Never share it.
- **Accepted impact:** all existing sessions, outstanding magic links and sign-in codes, and any other HMAC tokens signed with the old secret become invalid when the new deployment goes live. Users must sign in again.
- **Verify:** after the deploy, the owner signs in fresh with a new magic link. An old session cookie is rejected.
- **Rollback:** before revocation-equivalent effects, restore the old value and redeploy. In practice, fix forward.

### 11.2 Neon role identification and revocation (F-2, F-3, F-6). Replaces §2.

1. **Identify:**
   - In the Neon console, open the **exact project, branch and compute endpoint** that Production uses. The owner identifies it from the Neon project whose endpoint host matches Production; the host is visible in the Neon console, not from Vercel.
   - List **all roles** on that branch (Roles page). Record their names only in the owner's private notes, not in reports or chat.
   - **Treat every login role on that branch, other than the new one, as exposed.**
2. **Record versions:** `SHOW server_version;` (SQL editor).
3. **Create the new role** (console) and grant membership: `GRANT <owner_role> TO <new_role>;`
   - If this fails for lack of ADMIN OPTION, run it as a role that has it (the console's default owner role), or use Neon's role-management UI. Failure here is safe: nothing has switched yet.
   - Then `ALTER ROLE <new_role> SET ROLE <owner_role>;`
4. **Verify before deploying:**
   - `SELECT pg_has_role('<new_role>','<owner_role>','MEMBER');` → `true`
   - `SELECT rolconfig FROM pg_roles WHERE rolname='<new_role>';` shows `role=<owner_role>`
5. **After the deploy, verify on the pooled endpoint as Production uses it:** in a session as the new role, `SELECT current_user, session_user;` → `<owner_role>`, `<new_role>`. Day-to-day reads and writes work through inherited membership; the `SET ROLE` default matters only for future DDL, whose failure would stop a build.
6. **Revoke** (separate step, after the §5 checks and a soak of at least 24 h). For **each** exposed old login role:
   - **Neon console → Reset password.** This is control-plane managed and persistent, and it invalidates the exposed password itself. Optionally also `ALTER ROLE … NOLOGIN` for roles nothing needs.
   - Then terminate remaining sessions: `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename IN (<old roles>);`
   - **Verify:**
     - a connection attempt with an old credential fails (owner, locally, using the old string from their own records, not from Vercel);
     - after a **compute restart** (Neon console: Restart compute) the old credential still fails;
     - Production health checks still pass.
7. **Reconcile:** before closing I0-C, the role list from step 1 equals revoked roles plus the new role. No unexplained login role remains.

### 11.3 Merge freeze from now (F-4)

- **Effective from this report until I0-C closes:** no merges to `main`. The owner notifies Greenaroz.
- Claude monitors Production deployments read-only at each later ticket start. Any unexpected Production deployment is a STOP and gets reported.
- **Optional technical enforcement** (separate authorization; settings change): temporarily lower Greenaroz to read, or add a temporary 1-approval requirement.

### 11.4 Local copies (F-5)

- **I0-C precondition:** the owner lists local files holding Production values (key names only): `apps/web/.env.production.local` and `apps/web/.env.local` in the primary checkout, and worktree `.env.local` files.
- **After rotation:** delete `.env.production.local`. Confirm each `.env.local` points at a local or dev database, not Production. Local tools (`playwright.config.ts`, `e2e/fixtures/cleanup.ts`, `scripts/retention-report.js`) must never run against Production.
- **Exposure history (open question for the owner):** the CLI pulled non-empty values on 2026-09-22, which conflicts with "sensitive since 2026-08-14". Treat the variables as readable by any Vercel team member or CLI session before their switch to sensitive. Rotation covers this either way.

### 11.5 Rollback after revocation (F-7). Replaces §7's last row.

- After Reset password, the old Neon credentials can't be restored, and every older deployment (including `dpl_mYJA…`) carries dead credentials.
- **Instant Rollback is unsafe after revocation.** The only path is to fix forward with a new deployment using the new credentials.
- Hence revocation is a separate, later step after a soak period, once at least one healthy new-credential deployment exists.

### 11.6 Resend and P-5 (F-11)

- New key: **sending-only, restricted to the verified sending domain**.
- **P-5 reworded:** "Is the self-hosted `deploy/` stack running? Does it use Resend or MOM?" (Its README specifies MOM.) If it uses its own provider, the Resend revocation doesn't affect it.
- The old Resend key also sits in local `.env.production.local` (§11.4).

### 11.7 Updated I0-C sequence

1. Freeze already in force.
2. P-5 answered; local copies listed.
3. Owner creates the new Neon role (§11.2.3–4), the new Resend key, and the new `AUTH_SECRET`.
4. Owner enters the three new values in Vercel, **Production only**. Optionally delete the 16 unused database and Neon variables plus `DATABASE_URL_UNPOOLED` from Production. Claude reads back names, targets and `updatedAt`.
5. Claude opens a docs-only PR; the four checks pass; the owner merges.
6. Verify (§5, plus §11.2.5, plus a fresh sign-in under the new `AUTH_SECRET`).
7. **Soak ≥ 24 h.**
8. Revoke: Neon Reset password for each old role, terminate sessions, restart-compute check (§11.2.6), revoke the old Resend key.
9. Reconcile roles (§11.2.7). Delete local `.env.production.local`.
10. Final health check. Lift the freeze.

## 10. Verdict and I0-C authorization request

### I0-B verdict: **READY FOR I0-C AUTHORIZATION**

The independent review ran two rounds. Round 1 found 3 P1s; all were resolved. Round 2 approved.

### Explicit I0-C authorization request

| Item | Value |
|---|---|
| Current Production | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`, SHA `e921f54974c443966cd7d35953e8f03635b9d0ef`, `source=git` |
| Credentials to rotate | Neon: **every** login role on Production's branch except the new one (§11.2). Resend API key (sending-only, domain-restricted). Production `AUTH_SECRET` (§11.1). |
| Production variables to update (owner, Production target only) | `DATABASE_URL` (`3Q4UaRKHCFs1ZAvD`), `RESEND_API_KEY` (`9wIWbQWLA3QdQ288`), `AUTH_SECRET` Production entry (`5zHVNkKL8cSkGHcn`). Optional: delete the 17 unused database and Neon variables from Production. |
| Migration behaviour | 51 migrations on `main`, 0 pending in Production; open PRs #344 and #346 add none. The candidate build's `migrate deploy` must report "No pending migrations". |
| Deployment method and candidate | A docs-only PR that Claude opens on the then-current `main` (expected `e921f54`). The four GOV-01 checks must pass; the owner merges. The candidate is the resulting merge SHA, re-verified before merge. No `vercel redeploy`. |
| Verification | §5 plus §11.2.5 plus a fresh sign-in and email check (email first, R2-6) |
| Rollback | Before revocation: Instant Rollback to `dpl_mYJA…`, or restore the old values and redeploy. After revocation: fix forward only (§11.5). |
| STOP conditions | §8 plus §11: pending migrations; role verification failure; non-`git` or wrong-SHA deploy; any §5 check failing (no revocation); Preview target on new values; any secret value shown; an unexpected Production deployment during the freeze |
| Preconditions | Merge freeze in force (from now; Greenaroz notified). P-5 answered (self-hosted stack running? Resend or MOM?). Local copies listed. |

To proceed, the owner replies: **AUTHORIZE AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION**

Claude will never ask for secret values. All credential creation and entry happens in the Neon, Resend and Vercel dashboards.
