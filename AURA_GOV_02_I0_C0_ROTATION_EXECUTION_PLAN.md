# AURA-GOV-02-I0-C0: Production Credential Rotation Execution Plan (for I0-C)

**Status:** execution-ready **except** for preflight blockers B-1 (self-hosted credential linkage) and B-2 (Neon role inventory).
**Builds on:** I0-B §5, §8 and §11, with the I0-D round-2 runbook notes.
**Not authorized:** nothing here may run until the owner replies **AUTHORIZE AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION** after B-1 and B-2 are cleared.

## 1. Exact owner actions (in order)

| # | Owner action | Claude action |
|---|---|---|
| 0 | Confirm the freeze is still active; resolve B-1 and B-2 | Verify `main` = `e921f54` and no new Production deployment; run the baseline again |
| 1 | Neon: create the new role (Production branch), grant owner membership and set its default role (§2) | — |
| 2 | Neon: run the read-only verification queries (§2) | — |
| 3 | Resend: create a new **sending-only, domain-restricted** key | — |
| 4 | Generate a new `AUTH_SECRET` locally (≥32 characters; for example `openssl rand -base64 48`) and don't save it to disk | — |
| 5 | Vercel dashboard: update **Production-only** `DATABASE_URL` (`3Q4UaRKHCFs1ZAvD`), `RESEND_API_KEY` (`9wIWbQWLA3QdQ288`), `AUTH_SECRET` (`5zHVNkKL8cSkGHcn`). Optionally delete the 17 unused database and Neon variables from Production. | Read back names, targets and `updatedAt` only; confirm no Preview target |
| 6 | — | Open a docs-only PR on `main` (`e921f54`, re-verified) |
| 7 | Wait for the 4 GOV-01 checks; **merge** (owner) | Watch the build: `source=git`, SHA = merge commit, "No pending migrations", scanner OK, READY, live |
| 8 | **Email check first:** request a magic link to your own address and sign in | Health checks (§4) |
| 9 | Overlap window (§5), then revoke (§6) | Post-revocation checks |
| 10 | Local cleanup (preflight §10); lift the freeze | Final baseline |

## 2. Credential creation order and Neon commands

1. **Role inventory (B-2):** list all login roles on the Production branch; identify the schema owner with `SELECT tableowner, count(*) FROM pg_tables WHERE schemaname='public' GROUP BY 1;` and run `SHOW server_version;`.
2. **Create the new role** in the console (for example `aura_app_2026_11`). Copy its password straight into Vercel at step 5 and nowhere else.
3. `GRANT <owner_role> TO <new_role>;` If ADMIN OPTION is missing, run it as the owner role or use the console. Failure is safe.
4. `ALTER ROLE <new_role> SET ROLE <owner_role>;`
5. **Verify:**
   - `SELECT pg_has_role('<new_role>','<owner_role>','MEMBER');` → `true`
   - `SELECT rolconfig FROM pg_roles WHERE rolname='<new_role>';` → contains `role=<owner_role>`
6. Create the Resend key, then generate `AUTH_SECRET`.

## 3. Environment variable update order

1. `DATABASE_URL` → new role, **same host and endpoint form** (pooled or direct) as the current value. The owner compares host and form in the Neon console; neither is shown here.
2. `RESEND_API_KEY` → new key.
3. `AUTH_SECRET` (Production entry) → new value.
4. (Optional) Delete the 17 unused Production variables: `DATABASE_URL_UNPOOLED`, `PG*` ×5, `POSTGRES_*` ×8, `NEON_*` ×2, `VITE_NEON_AUTH_URL`.

Nothing takes effect until the step-7 deployment.

## 4. Deployment procedure and verification

- **Method:** a docs-only PR (one line under `docs/`) against `main` `e921f54`. Re-verify that the diff is docs-only and that there's no pending migration (`main` has 51; Production reports 0 pending). Not `vercel redeploy`.
- **Owner acknowledges:** the Vercel build goes live as soon as it's READY, because post-merge CI gating (GOV-02) isn't implemented. The four checks gate only the merge.
- **Verification** (Claude, unless marked owner):
  1. Deployment `source=git`, SHA = merge commit, READY, promoted; build log "No pending migrations" and `[palmistry-bundle] OK`.
  2. **Owner:** a magic-link email arrives, sign-in succeeds, and an old session cookie is rejected.
  3. `/` → 200; `/moment/<nonexistent>` → `NOT_FOUND` (database OK).
  4. **Owner (Neon):** `pg_stat_activity` shows sessions from `<new_role>`. In a session as the new role (SQL editor role selector, or `psql` with the password typed at the prompt), `SELECT current_user, session_user;` → `<owner_role>`, `<new_role>`.
  5. `/api/mcp` → 404; Palmistry sentinels 0; `protectionBypass` 0.

## 5. Overlap period: recommendation

- **The I0-B "≥24 h" soak is reduced.**
- **Why an overlap exists:** it keeps a fast rollback (Instant Rollback to `dpl_mYJA…`, which carries the old values) available while confirming every consumer has moved.
- **Verified consumers:**
  - Vercel runtime and build: confirmed at step 7.
  - The cron: fails closed today, so it isn't a consumer.
  - Operator scripts: local, not in Production.
  - The only unverified consumer is the **self-hosted stack (B-1)**. Once B-1 is answered, nothing else needs a day.
- **Recommended overlap: ≥ 1 hour, ending when all of these are true:**
  - (a) the §4 checks pass;
  - (b) at least one real user request has succeeded through the new role (`pg_stat_activity`);
  - (c) no errors in Vercel runtime logs for the new deployment;
  - (d) B-1 confirms no other consumer.
- **Security trade-off:** every hour of overlap keeps the exposed old credentials valid. Given exposure since 2026-08-14, revoke as soon as (a)–(d) hold; target the same day.

## 6. Revocation order

1. **Neon:** for **each** old login role (from the B-2 inventory, excluding Neon-managed or system roles, which are classified, not blindly reset):
   - console **Reset password**;
   - then run a health check (§4.3).
2. Terminate leftover sessions:

   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename IN (<old roles>);
   ```

   Filter on `usename` (the login user). Don't change it to `current_user`.
3. **Compute restart** (scheduled; a brief database interruption): Neon console → Restart compute. Then run the health checks.
4. **Verify:**
   - an old credential fails to connect, both before and after the restart (owner, using their own records);
   - Production is healthy.
5. **Resend:** revoke the old key (only if B-1 confirms the self-hosted stack doesn't use it); then send a magic-link test.
6. **Reconcile:** the role list = revoked roles + new role (+ classified Neon-managed roles).
7. Local cleanup (preflight §10).

## 7. Recovery matrix

**Rollback facts:**
- Vercel Instant Rollback re-points traffic to an earlier deployment **with that deployment's original environment**. Per the docs, rollback doesn't pick up changed project env values. On Hobby, only the immediately previous deployment is reachable.
- Env-value rollback means re-entering old values and redeploying.
- Neon: Reset password is one-way.
- Resend: a revoked key can't be restored.
- Schema: no migrations are expected, and application rollback never reverses schema.

| Failure | Before old-credential revocation | After revocation |
|---|---|---|
| New database role fails (auth or privilege) | The build fails at `migrate deploy`, so nothing goes live; fix the role (owner) and push another docs commit. If it fails at runtime: Instant Rollback to `dpl_mYJA…` (old values). **STOP** further steps. | Fix forward: correct the role's grants or password in Neon, update Vercel, redeploy through git. The old deployment is unusable (dead credentials). |
| Prisma migration fails | None expected (0 pending). If it fails, nothing goes live; investigate `_prisma_migrations` read-only; STOP. | Same: fix forward with a corrective migration, only under a separate authorization. |
| Production database connection fails | Instant Rollback to `dpl_mYJA…`; owner checks the host and endpoint form of the new URL | Fix forward: correct the Vercel value and redeploy |
| Email delivery fails | Instant Rollback (restores the old Resend key, and also the old `AUTH_SECRET` and database values); fix the key (owner); retry | Create another Resend key, update and redeploy. Users can't sign in until fixed. |
| Authentication fails after `AUTH_SECRET` rotation | Instant Rollback (old secret); check the value's length (≥32) | Fix forward: set a valid new value and redeploy. Users sign in again. |
| Self-hosted service fails | Only possible if B-1 shows it shares credentials. In that case the plan must first add a vf-1 `app.env` update step (owner); **STOP revocation** | Its owner updates `app.env` on vf-1 with new credentials, or decides to decommission it |

Every row: the owner performs credential actions; Claude verifies with read-only checks. STOP means no further rotation step until the owner decides.

## 8. STOP conditions

Stop if:
- the freeze is broken (`main` ≠ `e921f54` or an unexpected Production deployment);
- B-1 or B-2 is unresolved;
- role verification (§2.5) fails;
- the candidate has pending migrations or a non-docs diff;
- the deploy isn't `source=git` or the SHA differs;
- any §4 check fails, in which case **don't revoke**;
- a new value shows a Preview target;
- any secret value appears in output;
- the self-hosted stack is found to share a credential and isn't yet updated.

## 9. Expected downtime and sign-out impact

| Impact | Detail |
|---|---|
| Downtime | None expected for the cutover (the deploy is atomic). Compute restart: a brief database interruption of seconds, scheduled. Neon password resets: possible brief connection drops for old-role sessions only. |
| Sign-out | **All users are signed out** when the new deployment goes live (`AUTH_SECRET`). Outstanding magic links, codes and in-flight previews are invalidated. Optional user notice. |
| Email | Unaffected if the new key works. Email is checked first. |

## 9a. Review amendments (supersede §5–§8 where they conflict)

- **§1 steps 5 and 6:** immediately before each, Claude re-checks read-only that `main` = `e921f54` and that no new Production deployment exists (F-10). The known non-required Day Constructor failure (#323/#340) is **not** a STOP (F-9).
- **§5 overlap:** add (e) no old-role sessions for ≥ 15 min after the cutover, and (f) no second production deployment. Condition (d) is met by B-1 route (a), (b) or (c) (preflight §13.1).
- **§6 revocation canary:** record `https://aura.voyforge.com/api/health` before step 1, and re-check after every Reset password, the session termination and the compute restart. A change to 503 is a **STOP**. **Old Resend key:** revoke only if B-1 route (a) shows `vf-1` doesn't hold it, or route (c) is accepted.
- **§7 rollback:**
  - after any Instant Rollback, auto-assign becomes `false`, and a later fix-forward needs an explicit **owner promote** (a git push alone won't go live);
  - a second production deployment makes `dpl_mYJA…` unreachable on Hobby (**STOP** unless the owner accepts);
  - after a failed build, re-confirm the "previous" deployment by API.
- **§8 STOP additions:**
  - the self-hosted canary turns 503;
  - a second successful production deployment during the overlap;
  - auto-assign unexpectedly `false` without a rollback.

## 9b. B-1 owner acceptance (2026-11-10)

B-1 is **OWNER ACCEPTED — TEST DEPLOYMENT DISRUPTION RISK** (preflight §13.7). These parts of §9a are therefore superseded:
- The `aura.voyforge.com` canary is **observation only**. A 503 is recorded, not a STOP.
- The old Resend key is revoked on schedule, regardless of `vf-1`.
- The "self-hosted service fails" row in §7 becomes "record the outcome; no recovery action". The site's future is handled by the separate governance ticket.
- **B-1 is closed (R-2).** Every reference to B-1 or the self-hosted stack as a blocker or STOP is **superseded**: the header, §1 step 0, §5, §6.5, the §7 row, §8 (both "B-1 … unresolved" and "self-hosted … shares a credential"), §9a's "canary turns 503" STOP, and §10 item 1. **The only remaining blocker is B-2.**
- **Overlap condition (e), reworded (R-1).** Old-role sessions that keep appearing (for example from `aura.voyforge.com`'s 30-second Docker healthcheck, or a local tool) are **recorded** and treated as expected. They **don't block revocation** once the owner confirms that no local script or tool is running against Production. Revocation then ends them.

## 9c. B-2 recorded (2026-11-10)

Exactly **1 login role**, which is also the sole `public` table owner and can log in (preflight §13.9). §2 and §6 apply with `<old_role>` = `<owner_role>` = that role:
- **Step 1 of I0-C:** confirm privately that `pg_roles` shows exactly one login role (other than Neon-managed ones). If there are more, **STOP**.
- **Revocation:** Reset password on that one role, then terminate its old sessions by `usename`, then restart compute.
- **Reconciliation:** {owner role (reset), new role}.

**Status: no blockers remain.** The plan is ready for authorization.

## 9d. Final cutover review corrections (2026-11-10, read-only review; supersede §3, §7 and §8 where they conflict)

1. **`DATABASE_URL` form (replaces "same host and form as the current value").**
   - The current value is `sensitive` and can't be read back by anyone, so the owner can't compare it.
   - Instead, build the new value from the **Neon console connection string for the new role, with connection pooling ON (pooled endpoint)**, including the parameters Neon generates (`sslmode=require` …).
   - Evidence that the current value is the pooled one:
     - the Vercel–Neon variable set (created together 2026-08-14) uses `DATABASE_URL` = pooled and `DATABASE_URL_UNPOOLED` = direct;
     - Production runtime logs show `pg`'s sslmode notice, consistent with `sslmode=require`;
     - `prisma migrate deploy` succeeds today on that value.
   - **Fail-safe:** if the form is wrong or the role lacks rights, the docs-PR build fails at `migrate deploy` (or at prerender) and nothing goes live.
2. **Rollback before revocation = Vercel Instant Rollback only.**
   - The plan's "restore the old Vercel values and redeploy" option **isn't available**: the sensitive old values can't be read back; a Resend key is shown only at creation; the old `AUTH_SECRET` isn't recoverable from Vercel.
   - Instant Rollback to `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` restores the old runtime environment (DB, Resend, `AUTH_SECRET`) without needing any value. That deployment's environment is fixed when it is built, and the docs say rollback doesn't pick up changed project values.
   - Conditions: it must be the immediately previous production deployment (Hobby), which holds as long as no other production deployment happens. After a rollback, auto-assign turns off, so going live again needs an owner promote.
3. **Freeze exception (explicit).**
   - The docs-only PR opened by Claude under I0-C is the **sole** exception to the merge freeze: a single PR, files under `docs/` only, merged once by the owner, after the four GOV-01 checks pass.
   - After its merge, the expected `main` is **that merge commit**, and the expected Production deployment is **its** `source=git` deployment.
   - Any other change to `main`, or any other Production deployment, from env entry until the freeze is lifted is a **STOP**.
   - Evidence that a docs-only commit really deploys (despite `enableAffectedProjectsDeployments=true`, root `apps/web`): docs-only commits `0579191` and `8a08c93` (only `docs/HPG_TRACKER.md`) each produced a completed Production deployment ("Deployment has completed").
4. **`AUTH_SECRET` length gate.** `lib/auth.ts` throws in production if the secret is missing or shorter than 32 characters. The owner generates it with `openssl rand -base64 48` (64 characters) and confirms the length before entry. If it's wrong, sign-in breaks on the new deployment, and the remedy is Instant Rollback.

## R2 — Verified Neon Role Reconciliation (supersedes §9c)

Full evidence is in preflight R2.
- **Rotation scope:** `neondb_owner`'s password only. `cloud_admin`, `neon_service` and `neon_auth` are Neon-managed and must not be touched.
- **Path A** (new role + membership + `SET ROLE` default, then reset after the overlap) is kept **only if** owner check O-3 shows that `GRANT neondb_owner TO <new>` is permitted (ADMIN OPTION on Postgres 16+).
- **Otherwise Path C** applies:
  1. Prepare the docs PR and get its four checks green.
  2. Reset `neondb_owner` (Neon console).
  3. Immediately enter the new `DATABASE_URL` (pooled; Production only), together with the new Resend key and `AUTH_SECRET`.
  4. Owner merges the docs PR. It goes live in about 3–5 min, during which new database connections fail.
  5. Verify.
  6. End old sessions (`usename='neondb_owner' AND pid <> pg_backend_pid()`), restart compute, confirm the old credential fails.
  7. Revoke the old Resend key.

  In Path C there is **no Instant Rollback** after the reset; fix forward only.
- **Path B** (group-owner role with `REASSIGN OWNED`) is deferred to GOV-02-I3.
- **STOP** if O-1 or O-2 shows any connection variable using a role other than `neondb_owner`.

### R2 revision after independent review (supersedes Paths A, C and D above)

The database variables are **Vercel Marketplace Neon store secrets**, and the store link still lists Preview and Production. **Use Path S** (preflight R2.12):
1. Store environments → Production only (authorization required).
2. Enter the new Resend key and `AUTH_SECRET`.
3. Docs PR green, not merged.
4. **Rotate secrets** on the store; read back that all 18 variables advanced and are Production-only.
5. Merge immediately. About 2–5 min of database errors; no Instant Rollback.
6. Verify.
7. Terminate old sessions with `backend_start < rotation ts`.
8. Restart compute; confirm the old credential fails.
9. Revoke the old Resend key; cleanup; lift the freeze.

**Fallback:** Neon-console reset of `neondb_owner` (Path C), still after step 1.

**Update (R2.15–R2.17):**
- Step 1 is **done** (the store link is Production only, 15:42:21Z).
- Step 4 uses **route 2**: Neon console → project `green-bar-78820765` → default branch → **Connect** → role `neondb_owner` → **Reset password**.
- **New STOP gate after step 4:** within 5 min, all 18 store variables must re-sync (same names, new `updatedAt`, Production-only, `sensitive`). If no sync appears, **STOP before merging** and report: the integration doesn't use `neondb_owner`. If any Preview target appears, **STOP**.
- Then merge the pre-greened docs PR immediately.
- Freeze baseline for the pre-execution re-check: project and env `updatedAt` **15:42:21Z**, `main` `e921f54`, Production `dpl_mYJA…`.

### Final design: O-min (supersedes Path S, route 2 and all earlier paths)

The full step list is in **preflight R2.20**.
- **Replacement role first:** a one-line `lib/db.ts` override (`AURA_DATABASE_URL || DATABASE_URL`), a console role `aura_app_2026_11` with DML grants (`_prisma_migrations` excluded), and a Sensitive, Production-only `AURA_DATABASE_URL`.
- **Deploy and overlap:** a docs-PR deploy, then ≥1 h overlap with **Instant Rollback preserved**.
- **Revocation:** reset `neondb_owner` on `main` and every remaining branch (or delete those branches); sync gate (not an outage risk); end old sessions; compute restart; old password fails everywhere; revoke the old Resend key.
- **Freeze exceptions:** exactly two PRs (the `db.ts` change, then the docs PR), merged by the owner with all checks green.
- **Blocked on:** the Neon branch inventory (preflight §14).

Owner confirmations S-1..S-3 and checks O-1/O-2/O-4 are needed before authorization.

## 11. FINAL I0-C AUTHORIZATION REQUEST (2026-11-10; supersedes every earlier step list)

**Baseline (must still hold at step 0):** `main` `e921f54`; Production `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn`; project and env `updatedAt` 15:42:21Z; 23 env entries, no `AURA_DATABASE_URL`; store link `['production']`; bypass 0; auto-assign `true`; no deployment after 13:28:54Z.

### 11.1 The two permitted freeze exceptions and the deployment sequence

| # | PR | Content | Merge | Result |
|---|---|---|---|---|
| **PR-1** | Opened by Claude | **Only** `apps/web/lib/db.ts` line 36 → `new Pool({ connectionString: process.env.AURA_DATABASE_URL \|\| process.env.DATABASE_URL })` | Owner, after **all** CI checks (4 required) pass | Production deployment **D1**. Behaviour identical to today (the variable is unset). |
| **PR-2** | Opened by Claude | **Only** one new file or line under `docs/` | Owner, after all checks pass, **only after** §11.2 gates and the variable entry | Production deployment **D2**, running as the new role with the new Resend key and `AUTH_SECRET` |

No other merge, push, Redeploy, CLI deploy or Production deployment is permitted until the freeze is lifted.

**Sequence:**
1. Step 0 baseline.
2. PR-1 → D1 READY and live; verify D1 sessions are `neondb_owner` and health is fine.
3. Owner creates and validates the role (§11.2).
4. Owner enters the Vercel values. Claude reads back names, targets and types, and that each `createdAt`/`updatedAt` is later than D1's `createdAt` (F5).
5. PR-2 → D2 go-live gates (§11.4).
6. Overlap ≥ 1 h.
7. Revocation (§11.3).
8. Close-out.

### 11.2 Replacement-role creation (method M2) and privilege gates

Owner actions, Neon project `green-bar-78820765`, branch `main`.

1. **Psql as `neondb_owner`:** connect with conninfo fields. Type the password at the prompt; never put it in a URL, the command line, an environment variable or shell history.
2. In psql:
   - `CREATE ROLE aura_app_2026_11 LOGIN;`
   - `\password aura_app_2026_11`: enter a newly generated random password of ≥32 bytes, never echoed or saved. Psql sends a SCRAM verifier.
3. **Gate G1 (pooled connect):** a one-off psql to the **pooled** endpoint as `aura_app_2026_11` (password at the prompt). `SELECT session_user, current_user;` → `aura_app_2026_11` both. **If it fails: STOP.**
4. Grants (as `neondb_owner`):

   ```sql
   GRANT USAGE ON SCHEMA public TO aura_app_2026_11;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aura_app_2026_11;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aura_app_2026_11;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aura_app_2026_11;
   REVOKE ALL ON public."_prisma_migrations" FROM aura_app_2026_11;
   ```

5. **Gate G2 (every row must match exactly, otherwise STOP):**
   - `has_table_privilege('aura_app_2026_11','public."_prisma_migrations"', X)` for X in SELECT, INSERT, UPDATE, DELETE → **false**
   - `has_table_privilege('aura_app_2026_11','public."User"','INSERT')` → **true**
   - `pg_has_role('aura_app_2026_11', R, 'MEMBER')` for R in `neondb_owner`, `neon_superuser`, `neon_auth`, `pg_read_all_data`, `pg_write_all_data` → **false**
   - `SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname='aura_app_2026_11';` → **all false**
6. **Vercel (owner), only after D1 is live:**
   - add **`AURA_DATABASE_URL`**: Sensitive, Production only. The complete pooled string for `aura_app_2026_11` (`-pooler` host, database name, `sslmode=require`), in the same format as the working store string.
   - update **`RESEND_API_KEY`** (new sending-only, domain-restricted key) and the Production **`AUTH_SECRET`** (`openssl rand -base64 48`, 64 characters).
   - Change nothing else.

### 11.3 Rollback window and revocation point

| Stage | Live | Instant Rollback target | Valid? |
|---|---|---|---|
| D1 live | D1 | `dpl_mYJA…` | Yes |
| D2 live and overlap | D2 | **D1** (old database credential, Resend key and `AUTH_SECRET`) | **Yes.** Accepted trade-off (F7): rollback signs out D2 sign-ins and re-validates old-secret tokens while D1 serves. Keep any rollback short. |
| **Revocation point: `neondb_owner` reset on `main`** | D2 | D1 | **No.** Rollback ends here. Only fix forward after this. |

**Revocation** happens only after every go-live gate passes and an overlap of ≥ 1 h:
1. Re-take the branch list (expect `main` only).
2. Neon console → Connect → `neondb_owner` → **Reset password** on `main` (and on any other branch found).
3. **Sync gate:** the 18 store variables re-sync, Production-only, `sensitive`. If they don't, the app is unaffected (it uses `AURA_DATABASE_URL`); record and investigate.
4. End old sessions: `usename='neondb_owner' AND backend_start < '<reset ts>' AND datname=current_database() AND pid <> pg_backend_pid()`.
5. Restart compute (seconds).
6. **Old-password proof:** a dynamic database route on **D1's unique deployment URL** (owner, logged in to Vercel) fails, while D2 stays healthy.
7. Revoke the old Resend key.
8. Read back the deployment list: no unexpected Production deployment (F8).

### 11.4 Go-live gates for D2 (all required; any failure means Instant Rollback to D1, then STOP)

- D2 is `source=git` at the PR-2 merge SHA, READY and promoted; the build log shows "No pending migrations" and `[palmistry-bundle] OK`.
- **Dynamic database probes:** owner magic-link sign-in succeeds (a real read and write); `GET /moment/<nonexistent>` → `NOT_FOUND`. (`/api/health` is a static prerender and doesn't count.)
- `pg_stat_activity`: sessions from `aura_app_2026_11`, and **no** `neondb_owner` app sessions with `backend_start` after go-live (excluding the editor `pid` and the build's migrate window).
- `/` → 200; `/api/mcp` → 404; Palmistry sentinels 0; bypass 0.

### 11.5 STOP conditions (complete list)

STOP immediately on any of these:
1. The step-0 baseline differs (an unexpected `main` change, Production deployment, or env/project `updatedAt`).
2. A PR contains anything beyond its permitted scope.
3. CI checks are not all green.
4. D1 shows unexpected behaviour or doesn't connect as `neondb_owner`.
5. G1 or G2 fails, or **any** membership or attribute gate shows an unexpected value.
6. A new Vercel value has a Preview target, is not Sensitive, or was created before D1.
7. A D2 go-live gate fails, in which case Instant Rollback to D1 comes first.
8. Any other Production deployment during the overlap.
9. The re-taken branch list shows more than `main` without a decision.
10. The store sync introduces a Preview target.
11. The old password still works after the reset and restart.
12. Any secret value appears in any output, file, chat or log.
13. `vercel curl`, `vercel env pull`, or any bypass-secret creation would be needed.

### 11.5a G2-FINAL amendments (supersede §11.2 step 4–5 and extend §11.5)

- **Step 0 (new, read-only, before `CREATE ROLE`):** owner runs preflight G2-FINAL §5a **Q0–Q6** (Q3 with MAINTAIN; Q6 also checks `hashtext(text)`). Any deviation from the pass criteria means **STOP**.
- **Grants in one transaction:**

  ```sql
  BEGIN;
  GRANT USAGE ON SCHEMA public TO aura_app_2026_11;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aura_app_2026_11;
  REVOKE ALL ON public."_prisma_migrations" FROM aura_app_2026_11;
  ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aura_app_2026_11;
  ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aura_app_2026_11;
  COMMIT;
  ```

- **Gate G2 = the full preflight G2-FINAL §5b set, as amended by its §7:**
  - membership query (zero rows);
  - admin attributes false, `rolcanlogin` true;
  - ownership counts 0 (`pg_class`, `pg_namespace`, `pg_proc`, `pg_type`);
  - `_prisma_migrations`: all of SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER/**MAINTAIN** false, and column-level false;
  - **24** app tables with S/I/U/D true and TRUNCATE/TRIGGER/REFERENCES/MAINTAIN false;
  - schema CREATE false, USAGE true; database CREATE false, CONNECT true;
  - `pg_advisory_xact_lock(bigint)`, `hashtext(text)` and `now()` EXECUTE true;
  - no Neon Auth access;
  - default-privilege list (no grantee filter): only the two new entries plus the Q5 baseline, with no `PUBLIC` entries;
  - SECURITY DEFINER review (F4).
- **Authenticated probe** (pooled, as the new role): `session_user`/`current_user` = the new role; `SELECT count(*) FROM "User"` succeeds; `SELECT 1 FROM public."_prisma_migrations" LIMIT 1` is **denied**; `SELECT pg_advisory_xact_lock(hashtext('g2-probe'))` succeeds.
- **Added STOP conditions:**
  - any step-0 Q deviation;
  - any amended G2 check failing;
  - app-table row count ≠ 24;
  - unexpected SECURITY DEFINER exposure;
  - a `PUBLIC` default-ACL entry.

  A G2 STOP means the role stays unused (no Vercel entry, no D2). Cleanup needs separate authorization.

### 11.5b Consolidated G2 SQL: the ONLY script to paste at execution (supersedes preflight G2-FINAL §5b text)

**Step 0** (before `CREATE ROLE`; as `neondb_owner` on `main`): re-run preflight G2-FINAL §5a Q0–Q6, with Q3 including `MAINTAIN` and Q6 including `hashtext(text)` and `now()`. Capture the **exact Q5 rows** as the baseline. Expected: the G2-PRECHECK results (all PASS). Any difference means **STOP**.

**Step 3a** (as `neondb_owner`, after `CREATE ROLE`, `\password` and the single-transaction grants in §11.5a):

```sql
-- 1. memberships, direct + indirect: expect ZERO rows
SELECT r.rolname FROM pg_roles r
WHERE r.rolname <> 'aura_app_2026_11' AND pg_has_role('aura_app_2026_11', r.oid, 'MEMBER');

-- 1b. incoming membership (PG16+ automatic creator ADMIN grant): EXACTLY 1 row
--     neondb_owner | aura_app_2026_11 | t | f | f | t   (any other row/value: STOP)
SELECT m.member::regrole AS member, m.roleid::regrole AS role, m.admin_option, m.inherit_option, m.set_option,
       (m.grantor = 10) AS grantor_is_bootstrap
FROM pg_auth_members m WHERE m.roleid = 'aura_app_2026_11'::regrole;
SELECT pg_has_role('neondb_owner','aura_app_2026_11','MEMBER') AS m, pg_has_role('neondb_owner','aura_app_2026_11','USAGE') AS u,
       pg_has_role('neondb_owner','aura_app_2026_11','SET') AS s, current_setting('createrole_self_grant') AS crsg;   -- t | f | f | (empty)

-- 2. attributes: super/createrole/createdb/bypassrls/replication all false; canlogin true
SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolcanlogin
FROM pg_roles WHERE rolname = 'aura_app_2026_11';

-- 3. ownership: all four 0
SELECT (SELECT count(*) FROM pg_class     WHERE relowner  = 'aura_app_2026_11'::regrole) AS rel,
       (SELECT count(*) FROM pg_namespace WHERE nspowner  = 'aura_app_2026_11'::regrole) AS nsp,
       (SELECT count(*) FROM pg_proc      WHERE proowner  = 'aura_app_2026_11'::regrole) AS proc,
       (SELECT count(*) FROM pg_type      WHERE typowner  = 'aura_app_2026_11'::regrole) AS typ;

-- 4. _prisma_migrations: all 8 false; column-level false
SELECT p, has_table_privilege('aura_app_2026_11','public."_prisma_migrations"', p) AS granted
FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p;
SELECT has_any_column_privilege('aura_app_2026_11','public."_prisma_migrations"','SELECT,INSERT,UPDATE,REFERENCES') AS any_column;

-- 5. app tables: exactly 24 rows; s,i,u,d true; extra false
SELECT c.relname,
       has_table_privilege('aura_app_2026_11', c.oid, 'SELECT') AS s, has_table_privilege('aura_app_2026_11', c.oid, 'INSERT') AS i,
       has_table_privilege('aura_app_2026_11', c.oid, 'UPDATE') AS u, has_table_privilege('aura_app_2026_11', c.oid, 'DELETE') AS d,
       has_table_privilege('aura_app_2026_11', c.oid, 'TRUNCATE,TRIGGER,REFERENCES,MAINTAIN') AS extra
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p') AND c.relname <> '_prisma_migrations'
ORDER BY 1;

-- 6. all-schema census: every relation with ANY privilege must be one of the 24 public app tables (expect 24 rows, all schema=public)
SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
  AND c.relkind IN ('r','p','v','m','f','S')
  AND (has_table_privilege('aura_app_2026_11', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
       OR (c.relkind = 'S' AND has_sequence_privilege('aura_app_2026_11', c.oid, 'USAGE,SELECT,UPDATE')))
ORDER BY 1,2;

-- 7. schema / database / functions
SELECT has_schema_privilege('aura_app_2026_11','public','USAGE')  AS public_usage,    -- true
       has_schema_privilege('aura_app_2026_11','public','CREATE') AS public_create,   -- false
       has_database_privilege('aura_app_2026_11', current_database(), 'CONNECT') AS db_connect, -- true
       has_database_privilege('aura_app_2026_11', current_database(), 'CREATE')  AS db_create,  -- false
       has_function_privilege('aura_app_2026_11','pg_advisory_xact_lock(bigint)','EXECUTE') AS f_lock,  -- true
       has_function_privilege('aura_app_2026_11','hashtext(text)','EXECUTE') AS f_hashtext,             -- true
       has_function_privilege('aura_app_2026_11','now()','EXECUTE') AS f_now;                           -- true

-- 8. Neon Auth isolation (if schema exists): usage false; zero table rows
SELECT has_schema_privilege('aura_app_2026_11', n.oid, 'USAGE') AS neon_auth_usage FROM pg_namespace n WHERE n.nspname = 'neon_auth';
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'neon_auth'
  AND has_table_privilege('aura_app_2026_11', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN');

-- 9. SECURITY DEFINER functions the role can execute (outside system schemas): any row goes to owner review before D2
SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')
  AND has_function_privilege('aura_app_2026_11', p.oid, 'EXECUTE');

-- 10. default ACLs, UNFILTERED: expect exactly the step-0 Q5 baseline + 6 rows for grantee aura_app_2026_11; no PUBLIC
SELECT d.defaclrole::regrole AS for_role, d.defaclnamespace::regnamespace AS in_schema, d.defaclobjtype,
       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee, a.privilege_type
FROM pg_default_acl d, aclexplode(d.defaclacl) a ORDER BY 1,2,3,4,5;
```

**Step 3b** (authenticated as `aura_app_2026_11`, one-off psql to the **pooled** endpoint, password typed at the prompt; read-only):

```sql
SELECT session_user, current_user;                       -- aura_app_2026_11 / aura_app_2026_11
SELECT count(*) FROM "User";                             -- succeeds
SELECT 1 FROM public."_prisma_migrations" LIMIT 1;       -- MUST fail: permission denied
SELECT pg_advisory_xact_lock(hashtext('g2-probe'));      -- succeeds
```

**Any deviation in 3a or 3b means STOP before any Vercel entry or D2** (§11.5 and §11.5a). Accepted and recorded, not a STOP: `PUBLIC` TEMPORARY on the database (P3, deferred to I3).

### 11.6 Remaining P0/P1 blockers

**None.** Owner inputs are verified, the independent final sign-off is GO, and the baseline is verified at 16:19Z.

### 11.7 Authorization phrase

> **AUTHORIZE AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION (O-min, M2, PR-1 db.ts + PR-2 docs)**

## 10. Required authorization

1. The owner resolves **B-1** by route (a) a key-name check on `vf-1`, (b) Neon-side session evidence during the overlap, or (c) explicit risk acceptance (preflight §13.1). The owner also resolves **B-2** (Neon role count and `public` table owner).
2. Claude records them in a short addendum and re-confirms the baseline and freeze.
3. The owner replies: **AUTHORIZE AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION**
