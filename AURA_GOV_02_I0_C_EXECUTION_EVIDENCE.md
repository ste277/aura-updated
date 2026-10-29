# AURA-GOV-02-I0-C: Execution Evidence (local, uncommitted; contains no secret values)

**Design:** O-min / M2, per `AURA_GOV_02_I0_C0_ROTATION_EXECUTION_PLAN.md` §11, §11.5a, §11.5b and §11.7.

## 1. Authorization record

| Item | Value |
|---|---|
| Authorization text | "I authorize **AURA-GOV-02-I0-C — PRODUCTION CREDENTIAL ROTATION (O-min, M2, PR-1 db.ts + PR-2 docs)**." |
| Received | 2026-11-10, before 16:41Z |
| Owner-limited scope of this instruction | **Step 0 only.** If all checks pass, prepare PR-1 and **stop** for explicit review and merge approval. No role creation, credential changes, D2 or revocation ahead of sequence. All credentials are entered by the owner; none are requested, displayed or recorded. |
| Separate go-aheads still required | PR-1 merge; PR-2 merge; crossing the revocation boundary; lifting the freeze |

## 2. Step 0 baseline (Claude, read-only, 2026-11-10T16:41:22Z)

| Check | Expected | Observed | Result |
|---|---|---|---|
| `main` | `e921f54` | `e921f54974c443966cd7d35953e8f03635b9d0ef` | PASS |
| Production deployment | `dpl_mYJA…` | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` (`e921f54`) | PASS |
| Last Vercel config change | 15:42:21Z | project and env max `updatedAt` 2026-11-10T15:42:21Z | PASS |
| `AURA_DATABASE_URL` | absent | absent (23 entries) | PASS |
| Neon store variables | Production-only | 18/18 Production-only, all `sensitive`; store link `['production']`; last rotation 2026-08-14 | PASS |
| Preview-targeted entries | only the 3 non-credential ones | `AURA_SHADOW_POLICY_MODE`, `AUTH_SECRET` (Preview's own), `RESEND_FROM_ADDRESS` | PASS |
| Neon project | `green-bar-78820765` | `green-bar-78820765` | PASS |
| Bypass secrets | 0 | 0 | PASS |
| Auto-assign / last rollback | `true` / none | `true` / null | PASS |
| Unauthorized deployments | none since 13:28:54Z | latest is still `dpl_6yzV…` (Preview, 13:28:54Z) | PASS |
| In-flight CI | none | 0 runs in progress; open drafts #346 (`63edaf8`) and #344 (`6a35da0`) unchanged | PASS |
| Production health | 200 + live database read | `/` → 200; `/moment/<nonexistent>` → `NOT_FOUND` (query OK) | PASS |
| Remote MCP | disabled | `/api/mcp` GET and POST → 404 | PASS |
| Palmistry | unpublished | `review-status.json` = `PENDING_HUMAN_REVIEW` | PASS |
| PR-1 target line | `lib/db.ts:36` | `const pool = new Pool({ connectionString: process.env.DATABASE_URL });` | Confirmed |

## 3. Step 0: owner checks (2026-11-10, Neon `main`)

| Check | Owner result | Result |
|---|---|---|
| Branch inventory | Branches page shows **one** branch. Identity `main` / `br-polished-morning-auhb1u2m` (owner-confirmed earlier today; Claude can't read Neon directly). Re-taken again immediately before revocation. | PASS |
| Q0 | PostgreSQL 17.11 (unchanged) | PASS |
| Q1 | `PUBLIC`: USAGE only. `pg_database_owner`: CREATE and USAGE (the PG15+ default owner of schema `public`; the new role isn't the database owner, and the step-3 `public_create=false` gate covers it) | PASS |
| Q2 | All 8 `_prisma_migrations` privileges held by `neondb_owner` only; no `PUBLIC`; no column-level grants (unchanged) | PASS |
| Q3 | `false, false, false, true` (unchanged) | PASS |
| Q4 | Database ACL unchanged: `PUBLIC` CONNECT + TEMPORARY, no CREATE (TEMPORARY accepted, P3) | PASS |
| Q5 | **Baseline, exactly 11 rows:** `for_role=cloud_admin`, `in_schema=public`, `grantee=neon_superuser`. Sequences (`S`): SELECT, UPDATE, USAGE (3). Tables (`r`): INSERT, SELECT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN (8). No `PUBLIC`. | PASS (baseline recorded) |
| Q6 | `true, true, true` (unchanged) | PASS |

**Step-3a gate 10 expectation:** exactly these 11 baseline rows plus 6 new rows (`for_role=neondb_owner`, `in_schema=public`, `grantee=aura_app_2026_11`; tables S/I/U/D, sequences USAGE/SELECT), so 17 rows in total, none with grantee `PUBLIC`.

## 4. Step 0 verdict: **PASS** (Claude baseline 16:41:22Z + owner checks). Proceeding to prepare PR-1 only.

## 5. Phase A: PR-1 prepared (awaiting CI and owner review; NOT merged)

| Item | Value |
|---|---|
| PR | ste277/aura-updated#347: https://github.com/ste277/aura-updated/pull/347 |
| Branch / base | `gov02/i0c-pr1-db-runtime-override`, from `e921f54` (isolated worktree `.claude/worktrees/gov02-i0c-pr1`; primary checkout untouched) |
| Commit | `7f8dad2755576979ab70d2e068cdb361cbaec7ef` |
| Diff | `apps/web/lib/db.ts` only, 1 line: `connectionString: process.env.AURA_DATABASE_URL \|\| process.env.DATABASE_URL` |
| Scope check | 1 file, +1/−1; no test asserts on the line; `schema.prisma` and `vercel-build.sh` unchanged, so migrations are unaffected |
| CI | Running at creation (4 required checks pending) |
| PR monitor | Auto-fix off, auto-merge off |
| Expected side effect | A Vercel **Preview** build of the branch. Preview has no Production database or Resend credentials (I0-A). |
| Next gate | All 4 required checks pass, then the **owner's explicit merge approval** for PR-1 |

### 5.1 PR-1 merge-gate check (2026-11-10, 16:52–16:54Z)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Diff only the approved line | 1 commit, 1 file (`apps/web/lib/db.ts`), +1/−1; line 36 → `AURA_DATABASE_URL \|\| DATABASE_URL` | PASS |
| 2 | Head and base | head `7f8dad2755576979ab70d2e068cdb361cbaec7ef`; base `main` = `e921f54` = current `origin/main` tip | PASS |
| 3 | 4 required checks on `7f8dad2` | Next.js production build **SUCCESS** (log: `[palmistry-bundle] OK: none of 8 …`); MCP Server **SUCCESS**; Database migration validation **SUCCESS**; **Ephemeris / panchang tests IN PROGRESS** (at 16:53:53Z) | **PENDING** |
| 4 | Production and Vercel baseline | Production `dpl_mYJA…` (`e921f54`); project and env `updatedAt` 15:42:21Z; 23 entries; no `AURA_DATABASE_URL`; bypass 0 | PASS |
| 5 | No credential exposure or unexpected deployment | Only new deployment: **Preview** `dpl_FsDGCsTWxL5UuoDzaW2Nca153hZ1` (`7f8dad2`, READY). Preview env holds only `AURA_SHADOW_POLICY_MODE`, Preview `AUTH_SECRET`, `RESEND_FROM_ADDRESS` (non-credential). No Production deployment. | PASS |
| 6 | Independent review | Diff, head, base, semantics (`\|\|` with unset/empty means `DATABASE_URL`; `AURA_DATABASE_URL` appears nowhere else, incl. CI and tests; Prisma unaffected; `lib/prisma*.ts` dead code), Production unaffected. **No P0/P1.** Merge-ready once Ephemeris passes. | PASS (conditional on #3) |

**Interim verdict (16:54Z): PR-1 BLOCKED, pending only the running required check "Ephemeris / panchang tests".**

### 5.2 Re-check (2026-11-10T17:03:57Z): **PR-1 MERGE READY**

- **Required checks on `7f8dad2`:** Ephemeris / panchang tests **SUCCESS**, Next.js production build **SUCCESS**, MCP Server **SUCCESS**, Database migration validation **SUCCESS**. All 4 pass.
- **Non-required:** Day Constructor acceptance DB tests FAILURE. Exactly the 3 known **#323** signatures (`DAILY RHYTHM (one outside-work candidate exists): …preferred outside-work window…`, `…surviving set is strictly narrower…`, `DAILY RHYTHM DISPLAY/COMMIT CONSISTENCY…`). Not a STOP. Vercel and Vercel Preview Comments SUCCESS.
- **PR state:** OPEN, head `7f8dad2`, base `e921f54` (= current `main`), 1 file, +1/−1, 1 commit, `MERGEABLE`. `mergeStateStatus=UNSTABLE` only because the non-required job failed. Auto-merge off.
- **Baseline unchanged:** Production `dpl_mYJA…`; project and env `updatedAt` 15:42:21Z; 23 entries; no `AURA_DATABASE_URL`; bypass 0. Latest deployment is the PR-1 Preview `dpl_FsDG…` (16:47:32Z); no Production deployment.
- **Independent review:** no P0/P1 (§5.1).

**Awaiting the owner's explicit PR-1 merge approval. Not merged.** _(Superseded by §6.)_

## 6. Phase A complete: PR-1 merged, D1 healthy

| Item | Evidence |
|---|---|
| Owner approval | "Approve PR-1 merge" (explicit) |
| Pre-merge recheck (17:06:24Z) | `main` `e921f54`; PR head `7f8dad2`, MERGEABLE; 4 required checks SUCCESS; Production `dpl_mYJA…`; env `updatedAt` 15:42:21Z; no `AURA_DATABASE_URL`; bypass 0 |
| Merge | `gh pr merge 347 --merge --match-head-commit 7f8dad2…` (normal merge commit, no admin bypass) at **17:06:43Z** by `ste277` |
| Merge commit | **`1741a95a3bc5c364f71a743442a8e31557756c33`** (parents `e921f54`, `7f8dad2`); `git diff e921f54 1741a95` = `apps/web/lib/db.ts` only, +1/−1 |
| **D1** | **`dpl_B9ERB3w3U2dT9p8Et95wzJDqkAQ6`** (`aura-updated-gps1ttifc-aura-56a1.vercel.app`): `source=git`, `target=production`, READY / PROMOTED, SHA `1741a95`, no `meta.action`; created 17:06:49Z, ready 17:07:40Z |
| Production target | `dpl_B9ERB3w3U2dT9p8Et95wzJDqkAQ6` (auto-assigned) |
| Build log | Clone `1741a95`; **"51 migrations found … No pending migrations to apply"** (no migration change); "Compiled successfully"; **`[palmistry-bundle] OK: none of 8`** |
| Health | `/` → 200; live database read `/moment/<nonexistent>` → `NOT_FOUND` (query succeeded); `/api/mcp` GET and POST → 404 |
| Credentials | `AURA_DATABASE_URL` **absent** (23 entries; env `updatedAt` still 15:42:21Z), so D1's pool falls back to the store `DATABASE_URL` (`neondb_owner`, old credential, still valid). Optional owner confirmation: `pg_stat_activity` shows `neondb_owner` app sessions after 17:07:40Z. |
| Palmistry | `PENDING_HUMAN_REVIEW` on `1741a95` |
| Settings | auto-assign `true`; bypass 0 |
| Rollback target from D1 | `dpl_mYJAoAr1h9MjhfQwAVSgGEWYxwGn` (previous Production deployment) |
| **Freeze** | Holding. `main` = `1741a95` is now the expected baseline. Exception 1 of 2 is used. |

**Phase A verdict: D1 HEALTHY.** Stopped before Phase B (role creation), which needs the owner's go-ahead.

## 7. Phase B: replacement role (owner-executed; owner go-ahead "Proceed with Phase B")

**Pre-check (17:11:22Z):**
- `main` `1741a95`; Production target = D1 `dpl_B9ERB3…` (`1741a95`); home page 200; bypass 0.
- Env: 23 entries, max `updatedAt` **15:42:21Z** (unchanged), no `AURA_DATABASE_URL`.
- Project `updatedAt` is now 17:07:40Z, caused by the D1 promotion (expected; no env change).
- No other deployment.

**B0 (owner):** password generated and stored in the owner's password manager; hosts identified; environment variables cleared; psql 16.14.

**B1 (owner):** `session_user`/`current_user` = `neondb_owner`; database `neondb`; PostgreSQL 17.11; SSL confirmed. **PASS.**

**B2 (owner): PARTIAL, STOPPED.**
- `CREATE ROLE aura_app_2026_11 LOGIN;` **succeeded**. Read-back: `aura_app_2026_11 | t | f | f | f | f | f` (`rolcanlogin`, then no super/createrole/createdb/bypassrls/replication).
- `\password aura_app_2026_11` **failed**: `Neon only supports being given plaintext passwords`. psql's `\password` sends a client-side SCRAM verifier, which Neon rejects.
- **Current state:** the role exists, **has no password** (password login impossible), has **no grants**, and isn't referenced anywhere. **No Production impact.**
- **Owner instruction:** don't recreate the role or change its privileges; design a Neon-supported secure method; get an independent review; Phase B **STOPPED at B2**.

### 7.1 Revised B2 password procedure (proposed; pending independent review and owner approval)

**Neon facts** (docs, 2026-11-10):
- "Passwords must be supplied in plain text but are encrypted when stored"; "Hashed passwords are not supported."
- Minimum **60 bits of entropy**; guidance: ≥ 12 characters, mixed classes, no sequences or dictionary words, no character repeated more than twice consecutively.
- "Resetting sets a generated password; to set your own value, use SQL."
- SQL-created roles "are not granted membership in the neon_superuser role".
- `log_min_error_statement = panic`, so errors don't log statement text. `log_statement` isn't documented.
- Only `neon_superuser` members can run `pg_stat_statements_reset()`.

**Not documented:**
- whether the Console Reset applies to SQL-created roles;
- whether statement text is retained by Neon (logs, Console "Query performance", which "works without" the extension).

**Password requirement (both routes):** the B0 hex password is **discarded**. Hex has a single character class and can contain triple repeats. **Delete that password-manager entry, or mark it unused.**

**Route A (preferred, no SQL text): Neon Console "Reset password"**
1. Read-only first: Neon Console → project `green-bar-78820765` → branch `main` → **Roles**. Is `aura_app_2026_11` listed, with a **Reset password** action?
2. If yes: **Reset password**. Neon generates a compliant password and shows it once (or makes it revealable). Copy it **straight into the password manager**. Nothing to chat, files or screenshots.
3. Re-run the membership and attribute read-back (B2 step 4 and G2 #1/#2). **STOP** if the reset added `neon_superuser` or any membership or attribute.
4. If the role isn't listed, or Reset isn't offered for it, **don't use the API**. Fall back to Route B.

**Route B (fallback): SQL `ALTER ROLE … PASSWORD` with history-safe plaintext transport**
1. **Generate** a compliant, URL-safe password (40 alphanumeric characters with all three classes and no character three times in a row; about 238 bits). Nothing is printed; it goes to the clipboard:

   ```bash
   python3 -I -c 'import secrets,string,re,subprocess
   a=string.ascii_letters+string.digits
   while True:
     p="".join(secrets.choice(a) for _ in range(40))
     if re.search(r"(.)\1\1",p) is None and any(c.islower() for c in p) and any(c.isupper() for c in p) and any(c.isdigit() for c in p): break
   subprocess.run(["pbcopy"],input=p.encode(),check=True)'
   ```

   Paste it into the password manager immediately.
2. **Pre-checks** in the existing `neondb_owner` psql session (read-only):

   ```sql
   SHOW log_statement;                                               -- record value (expect 'none' or 'ddl')
   SHOW log_min_duration_statement;                                  -- record (expect -1)
   SELECT extname FROM pg_extension WHERE extname = 'pg_stat_statements';   -- installed? (row or none)
   ```

   **STOP if `log_statement` is `ddl`, `mod` or `all`** (it would log the plaintext). Report the values.
3. **New psql session** with the password in a process-only environment variable. Hidden input; never in shell history, the command line or a file:

   ```bash
   read -rs AURA_NEW_PW && export AURA_NEW_PW           # paste at the blank prompt, then Enter (nothing echoes)
   HISTFILE=/dev/null psql "host=<DIRECT-HOST> dbname=neondb user=neondb_owner sslmode=require"
   ```

   In psql (the `:'newpw'` placeholder means **psql history stores only the placeholder, never the value**):

   ```sql
   \set HISTFILE /dev/null
   \getenv newpw AURA_NEW_PW
   ALTER ROLE aura_app_2026_11 WITH PASSWORD :'newpw';    -- expect: ALTER ROLE
   \unset newpw
   \q
   ```

   Then in the shell: `unset AURA_NEW_PW`.
4. **Post-scrub** (only if the pre-check showed `pg_stat_statements` installed). Check whether the statement text was recorded with a literal:

   ```sql
   SELECT queryid, (query ~* 'password\s+''') AS has_literal FROM pg_stat_statements
   WHERE query ILIKE '%alter role%aura_app_2026_11%';
   ```

   If any `has_literal = t`: `SELECT pg_stat_statements_reset(0, 0, <queryid>);` (allowed for `neon_superuser` members, so `neondb_owner` can run it), then re-check (zero literal rows). **Don't print the `query` column.**
5. **Residual risk, recorded:** Neon-side retention of statement text (Console "Query performance") is undocumented. It's visible only to project members (the owner). Before revocation, the old `neondb_owner` credential already grants full access to everything this role can reach, so it adds no reach. Route A avoids this entirely.

**After either route:** **B3** (pooled login as the new role) proves the password works.

### 7.2 Independent review of §7.1: APPROVED WITH CHANGES (no P0). Final procedure below supersedes §7.1.

**Key review findings:**
- **P1, Route A integrity:** a Console reset of a SQL-created role may bring it under Neon's role spec. `neon_superuser` could then appear **at the next compute restart**, and the password stays revealable in the Console. **So Route B is primary**, and Route A is a fallback only with extra safeguards.
- **P2:** psql ignores the shell's `HISTFILE`; an in-session `\set HISTFILE` has no effect (history picks its file at startup); `.psqlrc` `ECHO` or error `LINE 1:` output could display the value; `sslmode=require` doesn't verify the server; `export` keeps the value in the shell.
- **P2, logging pre-checks were too narrow** (sampling settings, pgaudit) and ran in a different session.
- **P2, role state isn't re-verified** before setting the password.
- **P2:** `pg_stat_activity` keeps the last statement text; `pg_stat_statements` is instance-preloaded by Neon (so "not in `neondb`" doesn't mean "not recorded") and likely keeps the `ALTER ROLE` literal on PG17; the scrub regex needed `[eE]?`.
- **P2:** `pbcopy` exposes the password to clipboard managers and Universal Clipboard.
- **P2:** the residual must be explicitly accepted by the owner (STOP #12 clarity), with a wider audience description.
- **P3:** Route A charset and URL-encoding; gate references must use §11.5b 3a queries 1–3.

#### FINAL B2 procedure: Route B (primary)

**Never use the Neon Console SQL Editor** (it keeps query history), the Neon API/CLI, or `vercel env pull`/`vercel curl`.

**B2-1, generate the password in the password manager** (preferred). Create a new entry "Neon aura_app_2026_11 (Production)" with a **40-character, letters + digits, no symbols** generated password. Mark the old B0 hex entry **unused/delete**. Before copying: pause clipboard-manager apps, and turn off Handoff/Universal Clipboard for the duration.

**B2-2, run in one subshell** (the value dies when psql exits; nothing is echoed; the local check prints only `pw_ok`/`pw_bad` and the length):

```bash
( read -rs AURA_NEW_PW; export AURA_NEW_PW
  echo "len=${#AURA_NEW_PW}"
  if [[ "$AURA_NEW_PW" =~ '^[A-Za-z0-9]{40}$' && "$AURA_NEW_PW" =~ '[a-z]' && "$AURA_NEW_PW" =~ '[A-Z]' && "$AURA_NEW_PW" =~ '[0-9]' ]] \
     && ! printf '%s' "$AURA_NEW_PW" | grep -Eq '(.)\1\1'; then echo pw_ok; else echo pw_bad; exit 1; fi
  PSQL_HISTORY=/dev/null psql -X -n "host=<DIRECT-HOST> dbname=neondb user=neondb_owner sslmode=verify-full sslrootcert=system channel_binding=require" )
pbcopy </dev/null    # clear the clipboard afterwards
```

- Paste the password at the blank prompt (from `read`), then Enter.
- If it prints `pw_bad`: regenerate in the password manager and repeat.
- At psql's prompt, enter the `neondb_owner` password (from Neon Connect).
- If certificate verification fails: **STOP and report.** Don't downgrade `sslmode` without the owner's decision.

**B2-3, in that psql session, in this order:**

```sql
\set ON_ERROR_STOP on
\set ECHO none
-- (a) logging / extension pre-checks (same session, right before the ALTER)
SELECT name, setting FROM pg_settings WHERE name IN
 ('log_statement','log_min_duration_statement','log_min_duration_sample','log_statement_sample_rate',
  'log_transaction_sample_rate','log_min_error_statement','track_activities');
SELECT current_setting('pg_stat_statements.track_utility', true) AS pss_track_utility;
SELECT extname, extversion FROM pg_extension ORDER BY 1;
-- (b) role re-verification (expect: aura_app_2026_11 | f | t | f | f | t | f | f | -1 | (null) | (null))
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls,
       rolconnlimit, rolvaliduntil, rolconfig FROM pg_roles WHERE rolname = 'aura_app_2026_11';
SELECT r.rolname FROM pg_roles r WHERE r.rolname <> 'aura_app_2026_11' AND pg_has_role('aura_app_2026_11', r.oid, 'MEMBER');   -- ZERO rows
SELECT (SELECT count(*) FROM pg_class WHERE relowner='aura_app_2026_11'::regrole) AS rel,
       (SELECT count(*) FROM pg_namespace WHERE nspowner='aura_app_2026_11'::regrole) AS nsp,
       (SELECT count(*) FROM pg_proc WHERE proowner='aura_app_2026_11'::regrole) AS proc,
       (SELECT count(*) FROM pg_type WHERE typowner='aura_app_2026_11'::regrole) AS typ;                                      -- 0,0,0,0
```

**STOP before the ALTER** (send the outputs and stop) if any of these hold:
- `log_statement` ∈ {ddl, mod, all};
- `log_min_duration_statement = 0`;
- `log_min_duration_sample = 0` with `log_statement_sample_rate > 0`;
- `log_transaction_sample_rate > 0`;
- `log_min_error_statement ≠ panic`;
- `pgaudit` appears in `pg_extension`;
- any role re-verification row differs.

Otherwise, continue in the same session:

```sql
\getenv newpw AURA_NEW_PW
ALTER ROLE aura_app_2026_11 WITH PASSWORD :'newpw';     -- expect: ALTER ROLE
\unset newpw
SELECT 1;                                                -- overwrite pg_stat_activity.query for this backend
-- only if pg_stat_statements appears in pg_extension above:
SELECT queryid, (query ~* 'password\s+[eE]?''') AS has_literal FROM pg_stat_statements
WHERE query ILIKE '%alter role%aura_app_2026_11%';       -- never select the query column itself
-- for any has_literal = t:   SELECT pg_stat_statements_reset(0, 0, <queryid>);   then re-run the check: zero literal rows
\q
```

- **Don't create** `pg_stat_statements` if it's absent (that needs separate authorization).
- **Burn rule:** if any output ever shows the password (for example an error with `LINE 1: … PASSWORD '…'`), clear the terminal scrollback and treat that password as **burned** (STOP #12). Regenerate in the password manager and repeat B2-2/B2-3 (`ALTER ROLE` again; the role is **not** recreated).

**Residual (requires the owner's explicit acceptance before running):**
- The plaintext crosses verified TLS to Neon (required by Neon).
- Transient copies may exist server-side: `pg_stat_activity` until `SELECT 1`; the instance-level `pg_stat_statements`, which can't be scrubbed from `neondb` if the extension isn't installed there, and is likely lost at the revocation-step compute restart (unverified); and Neon's Console monitoring (retention undocumented).
- Reachable only by Neon project and org members, Vercel team members who can open the linked Neon store, and Neon operators. Before revocation, the live `neondb_owner` credential already grants wider access.

#### 7.3 Owner clarification round (Phase B still paused at B2): final exact Route B procedure

These changes supersede the B2-2/B2-3 text above where they differ:
- **All local format checks use `printf … | grep`** (shell-agnostic). `printf` is a shell builtin, so the value is never a process argument.
- **Tracing is disabled** explicitly.
- psql runs with `VERBOSITY terse`, `SHOW_CONTEXT never`, `ECHO none` and `ECHO_HIDDEN off`.
- psql's copy of the environment variable is removed with `\setenv` right after `\getenv`.
- A **post-ALTER role re-verification** (identical to the pre-check) proves no membership or privilege change.

**Stated limitations:**
1. Neon's proxy terminates TLS before the compute, so Neon infrastructure necessarily handles the plaintext.
2. Neon's own query monitoring and statement-statistics retention are undocumented.
3. `pg_stat_statements` at instance level very likely keeps the `ALTER ROLE` text verbatim, and it can only be removed if the extension is visible in `neondb`.
4. On macOS, a process's initial environment can be read by **other processes of the same OS user** while psql runs (`ps -E`). `\setenv` doesn't erase that copy, so the psql session is kept short.

**Complete server-side absence can't be guaranteed.**

#### 7.4 Owner final corrections: FINAL Route B procedure (supersedes 7.2/7.3 B2-2 and B2-3)

**Corrections applied:**
- No `export`: the password never enters any process environment.
- A **protected input channel**: a private FIFO (named pipe, which stores no data on disk) read by psql's backtick command. The value stays out of every process argument, the environment, terminal output and history.
- The read-only checks (**B2-A**) are separated from the modification (**B2-B**). There's a **mandatory stop and owner confirmation** between them.
- **No automatic `pg_stat_statements` reset.** It's detection only (read-only, boolean); any cleanup is a separate, reviewed proposal.
- Verified TLS, the least-privilege role and every G1/G2 gate are preserved.

**B2-1, password (password manager):** a new entry, 40 letters + digits, no symbols. Mark the B0 hex entry unused. Pause clipboard managers and Handoff.

**B2-A, read-only checks** (terminal 1; one psql session, kept open):

```bash
( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null; unset PGPASSWORD PGUSER PGHOST DATABASE_URL
  PSQL_HISTORY=/dev/null psql -X -n "host=<DIRECT-HOST> dbname=neondb user=neondb_owner sslmode=verify-full sslrootcert=system channel_binding=require" )
```

```sql
\set ON_ERROR_STOP on
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
SELECT name, setting FROM pg_settings WHERE name IN ('log_statement','log_min_duration_statement','log_min_duration_sample',
 'log_statement_sample_rate','log_transaction_sample_rate','log_min_error_statement','track_activities') ORDER BY 1;
SELECT current_setting('pg_stat_statements.track_utility', true) AS pss_track_utility;
SELECT extname, extversion FROM pg_extension ORDER BY 1;
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil, rolconfig
FROM pg_roles WHERE rolname = 'aura_app_2026_11';
SELECT r.rolname FROM pg_roles r WHERE r.rolname <> 'aura_app_2026_11' AND pg_has_role('aura_app_2026_11', r.oid, 'MEMBER');
SELECT (SELECT count(*) FROM pg_class WHERE relowner='aura_app_2026_11'::regrole) AS rel,
       (SELECT count(*) FROM pg_namespace WHERE nspowner='aura_app_2026_11'::regrole) AS nsp,
       (SELECT count(*) FROM pg_proc WHERE proowner='aura_app_2026_11'::regrole) AS proc,
       (SELECT count(*) FROM pg_type WHERE typowner='aura_app_2026_11'::regrole) AS typ;
```

**→ STOP. Send these outputs to Claude. Keep the session open. Do nothing further until Claude confirms the pass criteria AND the owner gives an explicit go-ahead for B2-B.**

**B2-A pass criteria:**
- `log_statement` ∉ {ddl, mod, all};
- `log_min_duration_statement` ≠ 0;
- not (`log_min_duration_sample` = 0 and `log_statement_sample_rate` > 0);
- `log_transaction_sample_rate` = 0;
- `log_min_error_statement` = `panic`;
- no `pgaudit` in `pg_extension`;
- role row = `aura_app_2026_11 | f | t | f | f | t | f | f | -1 | (null) | (null)`;
- membership: 0 rows;
- ownership: 0,0,0,0.

(If the session drops before B2-B, reconnect and re-run B2-A first.)

**B2-B, modification** (only after the B2-A pass and the owner's explicit go-ahead):

1. **Terminal 2**, create a private FIFO (stores no data on disk):

   ```bash
   umask 077; D=$(mktemp -d); mkfifo "$D/pw"; printf 'FIFO=%s\n' "$D/pw"
   ```

   Note the printed path; it isn't secret.
2. **Terminal 1** (the open psql session), start the read. It blocks until data arrives:

   ```sql
   \set newpw `cat '<FIFO-PATH>'`
   ```
3. **Terminal 2**, write the password into the FIFO (hidden input; local format check; built-in `printf`, no process arguments):

   ```bash
   ( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
     printf 'Paste password, then Enter: '; read -rs P; echo
     printf 'len=%s\n' "${#P}"
     if printf '%s' "$P" | grep -Eq '^[A-Za-z0-9]{40}$' && printf '%s' "$P" | grep -q '[a-z]' \
        && printf '%s' "$P" | grep -q '[A-Z]' && printf '%s' "$P" | grep -q '[0-9]' \
        && ! printf '%s' "$P" | grep -Eq '(.)\1\1'
     then echo pw_ok; printf '%s' "$P" > "$D/pw"; else echo pw_bad; printf '' > "$D/pw"; fi )
   rm -f "$D/pw"; rmdir "$D"; pbcopy </dev/null
   ```

   - On `pw_bad`, an empty string is sent. In terminal 1, run `\unset newpw` and **don't** proceed. Regenerate and repeat steps 1–3.
4. **Terminal 1:**

   ```sql
   SELECT length(:'newpw') > 0 AS received;          -- prints only t/f. (Note: this sends a SELECT containing the
                                                     -- literal; skip it if preferred. ALTER fails visibly if empty.)
   ALTER ROLE aura_app_2026_11 WITH PASSWORD :'newpw';   -- expect: ALTER ROLE
   \unset newpw
   SELECT 1;                                         -- overwrite pg_stat_activity.query
   -- post-check: re-run the three role-state queries from B2-A; output must be IDENTICAL
   -- detection only (read-only; never select the query column):
   SELECT queryid, (query ~* 'password\s+[eE]?''') AS has_literal
   FROM pg_stat_statements WHERE query ILIKE '%alter role%aura_app_2026_11%';   -- only if pg_stat_statements was listed in B2-A
   \q
   ```

**Rules:**
- **Never run `\set` with no arguments** (it lists variables).
- Never select `query`.
- **Burn rule:** any appearance of the value in output means clear the scrollback, treat the password as burned (STOP #12), regenerate, and repeat B2-B (`ALTER` again; the role is never recreated).

**`pg_stat_statements` exposure, documented:**
- At instance level the statement text very likely contains the literal. It's readable by roles holding `pg_read_all_stats` (here `neondb_owner`, via `neon_superuser` → `pg_monitor`). It's probably cleared at the revocation-step compute restart (unverified).
- **No automatic reset.** If detection shows `has_literal = t`, Claude proposes a **separately reviewed** cleanup: a single targeted `pg_stat_statements_reset(0, 0, <queryid>)` that removes only that entry, with no effect on other statistics.

**Stated limitations (owner-accepted in principle):**
- Neon's proxy terminates TLS (Neon infrastructure handles the plaintext).
- Neon's own monitoring retention is undocumented.
- Instance-level `pg_stat_statements` (above).
- The value necessarily exists in psql's process memory during B2-B.

**Then, unchanged:** B3 (G1 pooled login; verified TLS) → B4 (single transaction, error-safe) → §11.5b 3a + 3b → B6 (17 default-ACL rows). All STOP gates stay as they are.

#### 7.5 Focused review of 7.4: APPROVED WITH CHANGES (no P0/P1). FINAL CONSOLIDATED Route B (supersedes 7.2–7.4)

**Review method:** psql 16.14 against a throwaway **local** PG 16 cluster in the scratchpad (Unix socket only; since deleted); macOS BSD grep and zsh. No Production, Neon or Vercel contact.

**P2 fixes applied:**
- **P2-1:** `ALTER ROLE … PASSWORD ''` **succeeds** (NOTICE "empty string is not a valid password, clearing password"). The reader now re-validates the format itself, `\if :SHELL_ERROR` gates the `ALTER`, and the literal-bearing `SELECT length(...)` probe is removed.
- **P2-2:** the repeat check failed open on a grep error. It now calls `/usr/bin/grep` and requires rc = 1.
- **P2-3:** psql's query buffer holds the interpolated value. `SELECT 1` comes straight after the `ALTER`, and `\p \e \w \g \gx \watch \gset \echo :newpw` are banned.

**P3 items applied:** umask confined to subshells; more libpq variables unset; pgaudit preload and setting checks; TLS STOP restated; a fresh FIFO for every retry; the same-user FIFO race recorded; the `pg_stat_statements` text-file note; an optional reverse-membership check.

**B2-1, password:** in the password manager, 40 letters + digits, no symbols. Mark the B0 hex entry unused. Pause clipboard managers and Handoff.

**B2-A, read-only checks** (terminal 1; keep the session open):

```bash
( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  unset PGPASSWORD PGUSER PGHOST DATABASE_URL PGOPTIONS PGSERVICE PGSERVICEFILE
  PSQL_HISTORY=/dev/null psql -X -n "host=<DIRECT-HOST> dbname=neondb user=neondb_owner sslmode=verify-full sslrootcert=system channel_binding=require" )
```

If certificate verification or channel binding fails: **STOP**. Don't weaken `sslmode` or `channel_binding`.

```sql
\set ON_ERROR_STOP on
\set ECHO none
\set ECHO_HIDDEN off
\set VERBOSITY terse
\set SHOW_CONTEXT never
SELECT name, setting FROM pg_settings WHERE name IN ('log_statement','log_min_duration_statement','log_min_duration_sample',
 'log_statement_sample_rate','log_transaction_sample_rate','log_min_error_statement','track_activities') ORDER BY 1;
SELECT current_setting('pg_stat_statements.track_utility', true) AS pss_track_utility,
       current_setting('shared_preload_libraries') AS spl,
       current_setting('pgaudit.log', true) AS pgaudit_log;
SELECT extname, extversion FROM pg_extension ORDER BY 1;
SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin, rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil, rolconfig
FROM pg_roles WHERE rolname = 'aura_app_2026_11';
SELECT r.rolname FROM pg_roles r WHERE r.rolname <> 'aura_app_2026_11' AND pg_has_role('aura_app_2026_11', r.oid, 'MEMBER');
SELECT count(*) AS members_of_new_role FROM pg_auth_members WHERE roleid = 'aura_app_2026_11'::regrole;
SELECT (SELECT count(*) FROM pg_class WHERE relowner='aura_app_2026_11'::regrole) AS rel,
       (SELECT count(*) FROM pg_namespace WHERE nspowner='aura_app_2026_11'::regrole) AS nsp,
       (SELECT count(*) FROM pg_proc WHERE proowner='aura_app_2026_11'::regrole) AS proc,
       (SELECT count(*) FROM pg_type WHERE typowner='aura_app_2026_11'::regrole) AS typ;
```

**→ STOP.** Send the outputs. Wait for Claude's evaluation **and** the owner's explicit go-ahead.

**Pass criteria:**
- `log_statement` ∉ {ddl, mod, all};
- `log_min_duration_statement` ≠ 0;
- not (`log_min_duration_sample` = 0 and `log_statement_sample_rate` > 0);
- `log_transaction_sample_rate` = 0;
- `log_min_error_statement` = `panic`;
- no `pgaudit` in `pg_extension`, and if `spl` contains pgaudit, `pgaudit_log` must be empty or `none`;
- role row = `aura_app_2026_11 | f | t | f | f | t | f | f | -1 | (null) | (null)`;
- membership 0 rows;
- `members_of_new_role` is recorded: it may be 1 if Neon's `createrole_self_grant` made `neondb_owner` a member **of** the new role, which gives the new role nothing. It must be the same before and after.
- ownership 0,0,0,0.

If the session drops before B2-B: reconnect and re-run B2-A.

**B2-B, modification** (only after the B2-A pass and the owner's go-ahead; any retry uses a **new FIFO**, repeating steps 1–4):

1. Terminal 2:

   ```bash
   D=$(umask 077; mktemp -d) && (umask 077; mkfifo "$D/pw") && printf 'FIFO=%s\n' "$D/pw"
   ```
2. Terminal 1 (blocks until data arrives; the reader re-validates the format, so empty or invalid input gives `SHELL_ERROR=true`):

   ```sql
   \set newpw `/usr/bin/grep -Ex '[A-Za-z0-9]{40}' '<FIFO-PATH>'`
   ```
3. Terminal 2:

   ```bash
   ( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
     printf 'Paste password, then Enter: '; read -rs P; echo
     printf 'len=%s\n' "${#P}"
     G=/usr/bin/grep; ok=1
     printf '%s' "$P" | $G -Eq '^[A-Za-z0-9]{40}$' || ok=0
     printf '%s' "$P" | $G -q '[a-z]' || ok=0
     printf '%s' "$P" | $G -q '[A-Z]' || ok=0
     printf '%s' "$P" | $G -q '[0-9]' || ok=0
     printf '%s' "$P" | $G -Eq '(.)\1\1'; [ $? -eq 1 ] || ok=0
     if [ $ok -eq 1 ]; then echo pw_ok; printf '%s' "$P" > "$D/pw"; else echo pw_bad; printf '' > "$D/pw"; fi )
   rm -f "$D/pw"; rmdir "$D"; pbcopy </dev/null
   ```

   If interrupted with Ctrl-C, run the `rm`/`rmdir` line by hand.
4. Terminal 1:

   ```sql
   \if :SHELL_ERROR
     \echo 'NOT RECEIVED: do not proceed'
     \unset newpw
   \else
     ALTER ROLE aura_app_2026_11 WITH PASSWORD :'newpw';
     SELECT 1;
   \endif
   \unset newpw
   -- post-check: re-run ALL B2-A role-state queries; output must be IDENTICAL to B2-A
   -- detection only (only if pg_stat_statements was listed in B2-A; never select the query column):
   SELECT queryid, (query ~* 'password\s+[eE]?''') AS has_literal
   FROM pg_stat_statements WHERE query ILIKE '%alter role%aura_app_2026_11%';
   \q
   ```

**Success requires all of these:**
- terminal 2 printed `pw_ok`;
- terminal 1 printed `ALTER ROLE` with **no NOTICE**, then the `SELECT 1` result;
- the post-check is identical to B2-A.

**STOP if any of these hold:** a NOTICE (for example "empty string … clearing password"); `NOT RECEIVED`; any error; any difference in the post-check.

**Rules for that psql session:**
- never run `\set` with no arguments;
- never use `\p`, `\e`, `\w`, `\g`, `\gx`, `\watch`, `\gset` or `\echo :newpw`;
- never select `query`.

**Burn rule:** if the value appears in any output, clear the scrollback, treat the password as burned (STOP #12), regenerate it, and repeat B2-B with a new FIFO. The role is never recreated.

**`pg_stat_statements`:**
- **No automatic reset.** If detection shows `has_literal = t`, Claude proposes a separately reviewed targeted cleanup.
- Note for that proposal: a reset removes the entry, but the text may persist in the external query-text file until garbage collection.

**Accepted residuals (owner, in principle):**
- Neon's proxy terminates TLS;
- Neon monitoring retention is undocumented;
- instance-level `pg_stat_statements` text;
- the value is in psql's memory during B2-B;
- **same-OS-user processes** could open the FIFO, a risk no larger than their existing ability to inspect psql. A split value would surface as a B3 failure.

**Then, unchanged:** B3 (G1 pooled login, verified TLS) → B4 (single transaction, error-safe) → §11.5b 3a + 3b → B6 (17 default-ACL rows). Every STOP gate is preserved.

#### 7.6 Owner authorization: "Authorize B2-A checks" (read-only checks only; B2-B needs a separate go-ahead)

_B2-A outputs recorded below as received._

**B2-A finding (owner): incoming membership**

`member=neondb_owner | role=aura_app_2026_11 | admin_option=t | inherit_option=f | set_option=f`

- The new role has **zero outgoing memberships**, no elevated attributes, and owns nothing.
- Owner instruction: don't revoke or modify; assess; update the baseline if acceptable; get reviewer approval. **B2-B on HOLD.**

**Assessment: EXPECTED, standard PostgreSQL 16+ behaviour (not Neon-specific).**
- When a non-superuser role with `CREATEROLE` (here `neondb_owner`) runs `CREATE ROLE`, PostgreSQL 16+ automatically grants the **creator** membership **in** the new role `WITH ADMIN OPTION`. That's how the creator can manage the role it created.
- The `INHERIT` and `SET` options of that automatic grant come from `createrole_self_grant` (default empty), so both are **false**. That matches `inherit_option=f, set_option=f` exactly.
- **Direction:** `neondb_owner` is a member **of** `aura_app_2026_11`, not the reverse. So `aura_app_2026_11` gains **nothing**: no privileges, no role switching. Outgoing memberships stay **zero**, which the authoritative `pg_has_role(aura_app_2026_11, *, 'MEMBER')` gate checks.
- **What `neondb_owner` gets:** `ADMIN` lets it manage `aura_app_2026_11`: `ALTER ROLE` (including its password), `GRANT aura_app_2026_11 TO …`, `COMMENT`, and similar.
  - With `INHERIT=f`/`SET=f` it does **not** use or inherit the new role's privileges (which are a subset of its own anyway).
  - `neondb_owner` already holds `CREATEROLE`, and **this ADMIN grant is exactly what makes B2-B (`ALTER ROLE … PASSWORD`) and B4 (the grants) possible**.
- **Least-privilege model unchanged:** the application credential (`aura_app_2026_11`) gets no extra rights. The management path belongs to the owner/migration credential, which is rotated in Phase F.
- **Residual:** whoever holds the `neondb_owner` credential can manage the app role. That's inherent to `neondb_owner` being the administrative role, and it holds before and after rotation. Phase F resets the exposed `neondb_owner` password, which closes the exposed path. Optional later hardening (GOV-02-I3): manage application roles from a dedicated admin role.
- **Correction:** my earlier criterion attributed a possible incoming row to `createrole_self_grant`. In fact the ADMIN grant is **automatic**; `createrole_self_grant` only controls its INHERIT and SET options (both off here).

**Updated B2-A / B2-B membership baseline** (supersedes the `members_of_new_role` line in the §7.5 pass criteria):
- Outgoing memberships of `aura_app_2026_11` (`pg_has_role` query): **0 rows**. Any row means STOP.
- Incoming memberships in `aura_app_2026_11` (`pg_auth_members WHERE roleid = 'aura_app_2026_11'::regrole`): **exactly 1 row**, `member=neondb_owner`, `admin_option=t`, `inherit_option=f`, `set_option=f`. Any other row, or any of these options differing, means STOP.
- The B2-B post-check must show the **identical** incoming row. The same applies at G2 (§11.5b 3a) before D2.
- Exact query for the incoming baseline:

  ```sql
  SELECT m.member::regrole AS member, m.roleid::regrole AS role, m.admin_option, m.inherit_option, m.set_option, m.grantor::regrole AS grantor
  FROM pg_auth_members m WHERE m.roleid = 'aura_app_2026_11'::regrole;
  ```

  `grantor` is recorded for evidence; expected the bootstrap superuser or `neondb_owner`. _(Superseded by the review amendments below.)_

**Independent review of the membership assessment: APPROVE WITH CHANGES (no P0/P1).**
- **Confirmed:** this is PG16+ `CreateRole()` behaviour. A non-superuser `CREATEROLE` creator is added as admin of the new role through `AddRoleMems(…, BOOTSTRAP_SUPERUSERID, …)`, with INHERIT and SET taken from `createrole_self_grant` (default empty, so both false).
- **Confirmed:** the direction gives `aura_app_2026_11` nothing. Every `has_*_privilege` check and the `pg_has_role(aura_app_2026_11, r, 'MEMBER')` gate are unaffected.
- **Confirmed:** revoking is **not recommended**. It would remove `neondb_owner`'s ability to set the password (B2-B), to rotate in future, and to `DROP` the role for cleanup. A non-superuser generally can't revoke a bootstrap-superuser-granted row anyway.

**Amendments applied:**
- **P2-1, grantor:** the expected grantor is **OID 10 (bootstrap superuser; on Neon typically `cloud_admin`)**, not `neondb_owner`. A grantor of `neondb_owner` would indicate an extra or manual grant, which means **STOP**.
- **P2-2:** the incoming check is added to the authoritative G2 script (execution plan §11.5b) as **query 1b**.
- **P3-1, correction:** the ADMIN grant is what makes **B2-B** (`ALTER ROLE … PASSWORD`) possible, and the `DROP ROLE` cleanup path. **B4 does not depend on it:** the table and schema grants rely on `neondb_owner` owning the objects, and `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner` relies on being `neondb_owner`.
- **P3-2:** reverse-membership expectations: `pg_has_role('neondb_owner','aura_app_2026_11','MEMBER')` = **t**, `'USAGE'` = **f**, `'SET'` = **f**.
- **P3-3:** record `current_setting('createrole_self_grant')` (expected empty).

**FINAL incoming-membership baseline query** (B2-A, B2-B post-check, and G2 1b):

```sql
SELECT m.member::regrole AS member, m.roleid::regrole AS role, m.admin_option, m.inherit_option, m.set_option,
       (m.grantor = 10) AS grantor_is_bootstrap
FROM pg_auth_members m WHERE m.roleid = 'aura_app_2026_11'::regrole;
-- expect EXACTLY 1 row: neondb_owner | aura_app_2026_11 | t | f | f | t
SELECT pg_has_role('neondb_owner','aura_app_2026_11','MEMBER') AS m, pg_has_role('neondb_owner','aura_app_2026_11','USAGE') AS u,
       pg_has_role('neondb_owner','aura_app_2026_11','SET') AS s, current_setting('createrole_self_grant') AS crsg;
-- expect: t | f | f | (empty)
```

Any other row or value means **STOP**. It must be identical before and after B2-B and at G2.

#### 7.7 B2-A results (owner, 2026-11-10) and decision

| Check | Result | Criterion | Status |
|---|---|---|---|
| `log_statement` | none | ∉ {ddl, mod, all} | PASS |
| `log_min_duration_statement` | -1 | ≠ 0 | PASS |
| `log_min_duration_sample` / `log_statement_sample_rate` | -1 / 1 | not (= 0 and rate > 0); sampling disabled because duration = -1 | PASS |
| `log_transaction_sample_rate` | 0 | = 0 | PASS |
| `log_min_error_statement` | panic | = panic | PASS |
| `track_activities` | on | recorded (the `SELECT 1` overwrite is relevant) | recorded |
| pgaudit | not in `shared_preload_libraries`; `pgaudit.log` empty; not in `pg_extension` | absent | PASS |
| `pg_stat_statements` | **preloaded** (`shared_preload_libraries`), `track_utility = on`, **extension not installed in `neondb`** (`pg_extension` = `plpgsql` only) | recorded | **Residual:** the `ALTER ROLE` text is **very likely recorded in instance shared memory**, and can't be detected or scrubbed from `neondb` (the view doesn't exist there; creating the extension needs separate authorization). Probably cleared at the Phase F compute restart (unverified). The detection query in B2-B is **skipped**. |
| Role row | `aura_app_2026_11 \| f \| t \| f \| f \| t \| f \| f \| -1 \| NULL \| NULL` | exact | PASS |
| Outgoing memberships | 0 rows | 0 | PASS |
| Incoming memberships | 1 row: `neondb_owner \| aura_app_2026_11 \| t \| f \| f` | matches the §7.6 baseline | PASS (grantor not yet captured) |
| Ownership | 0, 0, 0, 0 | all 0 | PASS |
| Independent review of §7.6 | APPROVE WITH CHANGES (applied) | — | Confirmed |

**Not yet captured:** `grantor_is_bootstrap`, and the reverse check (`m/u/s`, `createrole_self_grant`) from the final §7.6 baseline queries. They're made the **first gate of B2-B** (B2-B step 0, same session, before the FIFO). Any mismatch means **STOP**.

**B2-A decision: PASS**, conditional on B2-B step 0 confirming `grantor_is_bootstrap = t`, `t | f | f` and an empty `createrole_self_grant`. B2-B awaits the owner's separate authorization.

**Owner (2026-11-11):**
- B2-A accepted as PASS, including the creator-membership baseline.
- **The Neon-side monitoring residual is accepted.**
- Final FIFO corrections requested.
- **Authorization: B2-B baseline checks only; the password change is on HOLD.**

#### 7.8 Corrected FIFO procedure: TESTED (throwaway local cluster)

**Test environment:**
- `initdb` PostgreSQL 16.14 (Homebrew) cluster in the scratchpad: Unix socket only, short private socket directory, C locale, trust auth.
- Roles: `owner_sim` (LOGIN CREATEROLE, owner of database `neondb_sim`) and `app_sim`, created by `owner_sim`.
- The PG16+ creator grant reproduced exactly as in Production: `owner_sim | app_sim | t | f | f | grantor_is_bootstrap=t`.
- Dummy passwords were generated by the harness and never printed. The harness compared the outputs against each dummy and deleted it.
- **No Production, Neon or Vercel contact.** The cluster is stopped and its socket directory removed. The test data stays in the scratchpad, which is temporary.

**Corrections:**
1. **Newline-terminated input:** the writer sends `printf '%s\n'`, and the bad or abort path sends `'\n'`.
2. **Strict reader:** BSD `awk` accepts **exactly one line of exactly 40 `[A-Za-z0-9]` characters**. Anything else exits 1, so psql sets `SHELL_ERROR = true`. This replaces `grep`, which would accept multiple matching lines.
3. **Gate:** `\if :SHELL_ERROR` blocks the `ALTER`.
4. **Reliable cleanup:**
   - the writer's `trap cleanup EXIT` plus `INT/TERM/HUP → exit`;
   - if the password wasn't sent, cleanup releases a waiting reader **without blocking** (opens the FIFO read-write and writes `'\n'`, so the reader gets `NOT RECEIVED`), then removes the FIFO and directory and clears the clipboard.

**Test matrix (all PASS):**

| # | Input | Order | Writer | Reader | Password set | FIFO / dir left | Leak* |
|---|---|---|---|---|---|---|---|
| 1 | valid | reader first | len=40 `pw_sent` | `ALTER ROLE`, `1`, no NOTICE (stderr 0 bytes) | **t** | no / no | 0 |
| 2 | valid | writer first | len=40 `pw_sent` | `ALTER ROLE`, `1` | **t** | no / no | 0 |
| 3 | empty | reader first | `pw_bad_sent_empty` | `NOT RECEIVED` | f | no / no | 0 |
| 4 | 39 chars | reader first | `pw_bad_sent_empty` | `NOT RECEIVED` | f | no / no | 0 |
| 5 | symbols | reader first | `pw_bad_sent_empty` | `NOT RECEIVED` | f | no / no | 0 |
| 6 | triple repeat | reader first | `pw_bad_sent_empty` | `NOT RECEIVED` | f | no / no | 0 |
| 7 | **interrupted** (SIGINT, no input) | reader waiting | (exits) | released: `NOT RECEIVED` | f | no / no | — |
| 8 | **interrupted** | no reader | (exits, no hang) | — | f | no / no | — |
| 9 | **two valid lines injected directly** (writer bypassed) | — | — | `NOT RECEIVED` | f | cleaned | — |
| 10 | **wrong or missing FIFO path** | — | — | awk error (shows the path only), then `NOT RECEIVED` | f | — | — |

\*Leak check: the dummy password was searched for in writer stdout/stderr, reader stdout/stderr, a full `ps -axww` argument snapshot taken while the reader was blocked, and `ps -E` environment dumps of psql and its reader child. **0 matches in all.** The process arguments show only the `awk` program and the FIFO path. The server log has no `ALTER ROLE` text (`log_statement=none`). `~/.psql_history` is unmodified (`PSQL_HISTORY=/dev/null`, `-n`). _(Overstated. Corrected in 7.9.)_

#### 7.9 Focused review of 7.8: APPROVED WITH CHANGES (no P0). Corrections, incident record, re-test

| # | Sev | Finding | Disposition |
|---|---|---|---|
| P1-1 | P1 | The writer, **pasted** into the owner's interactive zsh (`interactivecomments` off), fails to parse on an inline `#` comment. Line-by-line continuation could then run `read` in the **parent** shell. | **Fixed:** the writer is run **as a file**, `zsh -f <path>`, from a **hash-verified** copy. The inline comment is removed. |
| P2-1 | P2 | `\if :SHELL_ERROR` fails open on psql < 16 | **Fixed:** `\echo :VERSION_NUM` must be ≥ 160000, plus an outer `\if :{?SHELL_ERROR}` guard |
| P2-2 | P2 | The owner's long-lived psql session is on the **pooler** host; with transaction pooling, `SELECT 1` may not overwrite the `ALTER` backend's `pg_stat_activity` | **Fixed:** B2-B runs in a **fresh DIRECT-host session**, with Step 0 as its first gate |
| P2-3 | P2 | §7.8 overstated the leak scan: the env dump didn't include the reader child (stale `pgrep` pattern), and the snapshots were taken **before** sending | **Corrected:** §7.8's footnote is superseded. The re-test (below) checks process args and env of awk, psql and the writer **after** sending, **in memory only (boolean)**. Non-exposure also holds **by construction**: non-exported zsh variable, builtin `printf`, stdin to `grep`, FIFO to `awk`, psql client variable. |
| P2-4 | P2 | **Harness artifacts held secrets:** `run_case*/ps_env.txt` contained **Claude's own session environment** (including token-type variables), and `ps_args.txt` the full machine process list, including the Production psql command line | **Remediated:** all `ps_env.txt` and `ps_args.txt` files **deleted** (0 remain). The harness no longer writes process or env data to disk. |
| P2-5 | P2 | **Incident:** an earlier harness run (arguments mis-split by zsh word splitting) left **8 orphaned writer subshells** (PIDs 17519, 17617, 17712, 17807, 17903, 18033, 18128, 18227), blocked writing to FIFOs with no reader, plus 8 FIFO directories. No secrets: each wrote an empty line. | **Remediated:** each PID was confirmed to be `zsh -f …/scratchpad/…/writer.zsh`, then sent SIGINT. **All 8 exited and all 8 FIFO directories were removed by the writer's trap.** That also exercises "interrupt while blocked on write". 0 orphans remain. |
| P2-6 | P2 | Ctrl-C while blocked writing (valid input, no reader), and Ctrl-C at `read -rs` in a **real TTY**, weren't tested | **Fixed:** the first is tested (r9 below, plus the P2-5 remediation). The second is covered by owner **Step D** (a TTY dry run), plus `stty echo` in cleanup. |
| P3 | P3 | Bad path blocked with no reader; `pw_sent` before a confirmed write; no `stty` restore | **Applied:** bad input now **exits without writing** (cleanup releases any waiting reader without blocking); `sent=1` / `pw_sent` only after a successful `printf`; `stty echo` in cleanup |

**Re-test** (fresh throwaway cluster, same harness, in-memory leak flags; cluster stopped afterwards, socket directory removed, 0 orphans):

| # | Input / order | Writer | Reader | pw set | FIFO/dir left | leak (outputs) | proc_leak (args+env after send) |
|---|---|---|---|---|---|---|---|
| r1 | valid, reader first | `len=40 pw_sent` | `ALTER ROLE`, `1` (no NOTICE) | t | no/no | 0 | 0 |
| r2 | valid, writer first | `len=40 pw_sent` | `ALTER ROLE`, `1` | t | no/no | 0 | 0 |
| r3 | empty | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0 | 0 |
| r4 | 39 chars | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0 | 0 |
| r5 | symbols | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0 | 0 |
| r6 | triple | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0 | 0 |
| r7 | interrupted at prompt, reader waiting | — | `NOT RECEIVED` | f | no/no | 0 | 0 |
| r8 | interrupted at prompt, no reader | — | — | f | no/no | 0 | 0 |
| r9 | **valid, no reader, SIGINT while blocked on write** | `len=40` (exits) | — | f | no/no | 0 | 0 |

The earlier tests 9–10 (two-line injection and a missing FIFO path, both giving `NOT RECEIVED`) concern only the reader, which is unchanged.

**Final writer artifact** (to be copied and hash-verified by the owner):
- `…/scratchpad/b2b-test/bin/writer.zsh`
- **sha256 `634b68f124981f4568f4106b506661be9ac3c8695ec2793058b0516fe50c1bab`**

**Status:** owner-authorized **Step 0 only**. The password change (Steps A–C) is on **HOLD** pending separate approval.

**B2-B Step 0 (owner, fresh DIRECT-host session): PASS.**
- `VERSION_NUM` 160014.
- Incoming membership: exactly 1, `neondb_owner → aura_app_2026_11`, ADMIN t / INHERIT f / SET f, `grantor_is_bootstrap` t.
- Reverse check: MEMBER t / USAGE f / SET f.
- `createrole_self_grant`: empty.
- Matches the §7.6/§7.9 baseline.

**Owner request:** inspect the final `writer.zsh` before executing it. Contents shown to the owner verbatim (27 lines, sha256 `634b68f1…0c1bab`). The password change is still on **HOLD**.

#### 7.10 Final preparation confirmations (owner request; no procedure changes; no defects found)

**Gap closed:** r1–r9 had used the single-`\if` reader. The **exact final reader** (version echo plus the outer `\if :{?SHELL_ERROR}` guard) has now been tested with the **exact writer** (sha256 verified as `634b68f1…0c1bab` before and after the run).
- Environment: throwaway local cluster, restarted then stopped; socket directory removed; 0 orphans.

| # | Input / order | Writer | Reader (final guarded form) | pw set | FIFO/dir left | leak / proc_leak |
|---|---|---|---|---|---|---|
| g1 | valid, reader first | `len=40 pw_sent` | `VERSION_NUM 160014`, `ALTER ROLE`, `1`, no NOTICE | t | no/no | 0/0 |
| g2 | valid, writer first | `len=40 pw_sent` | same | t | no/no | 0/0 |
| g3 | empty | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0/0 |
| g4 | symbols | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0/0 |
| g5 | triple repeat | `pw_bad_not_sent` | `NOT RECEIVED` | f | no/no | 0/0 |
| g6 | interrupted at prompt, reader waiting | — | `NOT RECEIVED` | f | no/no | 0/0 |
| g7 | valid, no reader, interrupted while blocked on write | `len=40` (exits) | — | f | no/no | 0/0 |

**Cleanup and interruption limits:**
- Every operation in `cleanup` is non-blocking: `stty`, opening the FIFO read-write (macOS doesn't block), a 1-byte write into an empty pipe buffer, `rm`, `rmdir` and `pbcopy`. Tested in r7–r9 and g6–g7, plus the 8-orphan SIGINT remediation.
- The only blocking points are `read` (line 17) and the write in line 26. Both are interrupted by Ctrl-C (INT), which leads to `exit 130`, which runs cleanup.
- **SIGKILL (`kill -9`), SIGSTOP and power loss can't be trapped**, so cleanup doesn't run. The empty FIFO directory remains (a FIFO stores no data) and a waiting psql reader stays blocked.
  - **Recovery:** in terminal 1 press Ctrl-C (it ends the backtick's `awk` child, so `SHELL_ERROR=true` and `NOT RECEIVED`). If the session hangs, close it and start a new session. Remove the leftover `$TMPDIR/tmp.*` directory by hand.
- **Ctrl-\ (SIGQUIT) and Ctrl-Z (SIGTSTP) aren't trapped:** use **Ctrl-C only**.
- Ctrl-C at the real-TTY `read -s` prompt, and terminal echo restoration, are verified by the owner's **Step D dry run**.

**Tracing:**
- The writer runs as `zsh -f <file>`, a fresh non-interactive shell with no rc files, so `xtrace` is **off** at start.
- Line 1 also runs `set +x` / `unsetopt xtrace` before anything reads the password.
- `read -rs` produces no echo.
- In an earlier review test with xtrace forced on, only the `set +x` line was traced, and the value never appeared.
- psql: `ECHO none`, `ECHO_HIDDEN off`, `-n` (no readline or history). The `\if` blocks print nothing but the expected messages.

#### 7.11 Production attempt 1 (owner-run): FAILED SAFE. Root cause reproduced; corrected procedure tested

**Owner report:**
- The FIFO transfer succeeded (`pw_sent`).
- The guarded `\if` block was pasted into psql all at once. psql then showed `\echo command ignored; use \endif…`, the `neondb@>` prompt, `ERROR: syntax error at or near ":"`, and `SELECT 1` succeeding. **No `ALTER ROLE`.**
- The owner exited the session.

**Exposure assessment:**
- `syntax error at or near ":"` proves psql sent `ALTER ROLE … PASSWORD :'newpw'` with the placeholder **uninterpolated**, so **the password was not sent to the server** and wasn't printed.
- The role's password is unchanged (still none), to be re-verified by the retry's Step 0 and role-state checks.
- The psql session holding any value has exited. Burn rule: not triggered (no output showed the value). Regenerating anyway is recommended (free).

**Reproduction** (throwaway local PG 16.14 cluster; **interactive** psql via pseudo-terminal, `script -q /dev/null psql …`; block pasted at once):

| Hypothesis | Setup | Observed | Matches owner? |
|---|---|---|---|
| H1 | backtick OK (`SHELL_ERROR=false`) **and `newpw` set** | `\echo command ignored`, `@>`, then `ALTER ROLE`, `1`; password set | no (works) |
| **H2** | backtick OK (`SHELL_ERROR=false`) but **`newpw` not set** | `\echo command ignored`, `@>`, **`ERROR: syntax error at or near ":" at character 34`**, `1`; **not set** | **YES, exact** |
| H3 | no backtick in session (`SHELL_ERROR` undefined) | inner block ignored; `NO SHELL_ERROR` | no |

**Root cause:** not multiline pasting, and not conditional parsing. `\echo command ignored` is psql's normal message for the skipped `NOT RECEIVED` branch. **The `newpw` variable didn't exist in the session that ran the block, while a backtick had succeeded in that session.** The gate checked `SHELL_ERROR` but not the variable's presence, and psql leaves an undefined `:'var'` unsubstituted. The likely trigger: the `\set newpw …` read wasn't executed in, or wasn't retained by, that exact session. That happens with a different session, a re-paste or an intervening `\unset`.

**Additional psql facts (tested):**
- `SHELL_ERROR` can be `\unset` and is set again by the next backtick.
- **A failed backtick still defines the target variable, as an empty string.** So a variable-existence check alone isn't sufficient; it must be combined with `SHELL_ERROR` from the same read.

**Correction:** one hash-verified psql script, **`apply.sql`**, run with `\i`. The owner types only **two single-line commands** (`\set fifo '<path>'` and `\i …`), so nothing multi-line is pasted. The script:
1. sets `ON_ERROR_STOP off` (so it always reaches its cleanup lines), `pager off` (a pager opened in the pty test and swallowed input), `ECHO none` and terse errors;
2. `\unset newpw` and `\unset SHELL_ERROR` (no stale state);
3. requires `fifo` to be set;
4. reads the FIFO **inside the script** (the same session is guaranteed), with the strict `awk` reader;
5. runs `ALTER ROLE` **only if** `SHELL_ERROR` is defined **and** false **and** `newpw` is defined. Every other path prints `APPLY RESULT: … nothing changed`;
6. `SELECT 1` (overwrites `pg_stat_activity`);
7. **always** `\unset newpw` and `\unset fifo`.

**Interactive (pty) test matrix** (exact `writer.zsh` sha256 `634b68f1…0c1bab`; `apply.sql` identical except the test role name, verified by `diff`: 2 lines):

| # | Case | Writer | psql result | pw set | `newpw`/`fifo` after | FIFO/dir left | leak / proc_leak |
|---|---|---|---|---|---|---|---|
| i1 | valid | `len=40 pw_sent` | `ALTER ROLE`, `APPLY RESULT: ALTER ATTEMPTED…`, `APPLY END` | **t** | FALSE/FALSE | no/no | 0/0 |
| i2 | malformed (symbols) | `pw_bad_not_sent` | `NOT RECEIVED - nothing changed` | f | FALSE/FALSE | no/no | 0/0 |
| i3 | writer interrupted (Ctrl-C) | — | `NOT RECEIVED` | f | FALSE/FALSE | no/no | 0/0 |
| i4 | `fifo` not set | — | `NO FIFO PATH SET` | f | FALSE/FALSE | — | 0/0 |
| i5 | stale `SHELL_ERROR=false` + no `fifo` (**the attempt-1 class**) | — | `NO FIFO PATH SET` | f | FALSE/FALSE | — | 0/0 |
| i6 | wrong FIFO path | — | `NOT RECEIVED` | f | FALSE/FALSE | no/no | 0/0 |
| i7 | valid, **`ALTER` errors** (`ON_ERROR_STOP on` in session) | `pw_sent` | `ERROR: role … does not exist`, then `ALTER ATTEMPTED`, `APPLY END: newpw cleared` | f | **FALSE**/FALSE | no/no | 0/0 |

Notes:
- A first harness attempt hung because of a harness input-timing bug (psql got a partial input file). The stuck test writer was correctly **blocked waiting for a reader** and was cleared with SIGINT, which exercised cleanup again (0 writers left). The cluster is stopped and its socket directory removed.
- **Final `apply.sql` sha256: `d94ac5e9c433e13acd7e88293e8fa434abf22d8726ba42770e1c71b7135f92fc`** (31 lines). **`writer.zsh` is unchanged**: `634b68f124981f4568f4106b506661be9ac3c8695ec2793058b0516fe50c1bab`.

**Focused independent review of 7.11: APPROVED WITH CHANGES (no P0/P1). The changes are to instructions only; both files are used unchanged (hashes recomputed and matching).**

**Corrections to the text above:**
- **Root cause, reworded:** the `ALTER` ran with an **uninterpolated placeholder**. Either `newpw` was undefined (H2, reproduced exactly), **or** the `:'newpw'` token was mangled in the paste (curly quotes, a lookalike character, or a typo), which gives identical output. In both cases the password wasn't sent: an interpolated 40-character alphanumeric literal can't produce a `:` token. The new design removes both causes, because nothing secret-bearing is hand-pasted.
- **Optional owner confirmation:** if the attempt-1 error position is still visible, it should read **`at character 43`**, and the scrollback should contain no other statements.
- "Still none, re-verified by Step 0" is **not verifiable** that way (`pg_roles.rolpassword` always shows `********`). Only **B3 (login)** proves the password state.
- `apply.sql` is **29 lines** (not 31).
- **i5 relabelled:** "stale `SHELL_ERROR` + no `fifo`", which short-circuits at line 9. The attempt-1 class **can't occur** in the new design, because line 10 always sets `newpw` and `SHELL_ERROR` together.

**Required instruction-level changes (adopted in the retry instructions):**
- **P2-1:** Ctrl-C **in psql** during `\i` aborts the script before its cleanup lines, and could leave `newpw` set. So: **abort only with Ctrl-C in terminal 2 (the writer)**, which is tested (i3) and gives `NOT RECEIVED` plus `APPLY END`. If `APPLY END: newpw cleared` doesn't appear, or Ctrl-C was pressed in terminal 1, **`\q` immediately** (close the window if it hangs). This supersedes the §7.10 recovery text for the `\i` design.
- **P2-2:** `ON_ERROR_STOP off` persists after `\i`. Run `\set ON_ERROR_STOP on` right after, then `\q` after the post-check. B3/B4 use a **fresh** session.
- **P2-3:** an empty `fifo` makes `awk` read the **terminal** (BSD awk skips empty operands). **`\echo FIFO_CHECK :'fifo'`** before `\i` must match the writer's `FIFO=` line, otherwise STOP. (Optional `</dev/null` hardening is not applied, to keep the tested hash.)
- The prompt must end in **`=>`** before `\i`; `@>` or `->` means an inactive or continued buffer, so `\q` and STOP.
- **Accepted residual (P3):** a theoretical pipe-read error with a clean `awk` exit would give `PASSWORD ''`. That produces a NOTICE, which is a STOP, on a role that already has no password, so it's harmless.

**Untested and covered by instruction:** Ctrl-C in psql while blocked inside `\i` (the `\q` rule); writer-first ordering with `\i` (the same mechanism as r2/g2).

**Attempt 2 approval review (owner request; no changes):**
- `apply.sql` shown verbatim to the owner: sha256 `d94ac5e9…92fc`, **29 lines**.
- **Test provenance:** all of i1–i7 ran against copies generated from this exact file at 15:22:28: `apply_test.sql` (i1–i6) and `apply_err.sql` (i7).
  - Each copy is verified byte-identical to `sed`-substituting **only the role name on line 15** (`aura_app_2026_11` → `app_sim` / `app_missing_role`), confirmed by `cmp` and `diff`.
  - The run outputs are timestamped 15:22:35–15:23:12, after the files were generated.
  - (An earlier i1 run, pre-pager-fix, used a superseded version and isn't part of the seven.)
- **No defects** found on inspection.

#### 7.12 Attempt 2 final correction: SQL success vs failure detection (supersedes `apply.sql` `d94ac5e9…`)

**Owner finding:** with `ON_ERROR_STOP off` (needed to preserve cleanup), "ALTER ATTEMPTED" printed even when the `ALTER` failed.

**Change:**
- psql's built-in `ERROR` and `SQLSTATE` variables are captured **immediately after** the `ALTER` (`\set alter_error :ERROR`, `\set alter_sqlstate :SQLSTATE`), before `SELECT 1` resets them. `newpw` is unset at the same point.
- The script then prints **`APPLY RESULT: ALTER SUCCEEDED - SQLSTATE 00000`** or **`APPLY RESULT: ALTER FAILED - password NOT changed - SQLSTATE <code>`**.
- Only the 5-character SQLSTATE code is printed, never `LAST_ERROR_MESSAGE`.
- The new variables are unset at the start and at the end.
- The FIFO, `SHELL_ERROR`, existence guards and cleanup are unchanged.
- **New `apply.sql`: 40 lines, sha256 `34a123ec286a62356f705468ed28ccef3758b42567eb96ee38165355029c2639`. `writer.zsh` is unchanged (`634b68f1…0c1bab`).**

**Tests** (throwaway local PG 16.14 cluster; interactive psql via pty with `ON_ERROR_STOP on` set in the session beforehand; exact writer).
- Test copies are byte-identical to `sed`-substituting only the role name on line 17 (verified by `cmp`).
- Cluster stopped and socket directory removed afterwards; 0 writers left.

| # | Case | Writer | psql result | pw set | After: `newpw`/`fifo`/`alter_error`/`alter_sqlstate` | FIFO/dir left | leak / proc_leak |
|---|---|---|---|---|---|---|---|
| c1 | **successful ALTER** | `len=40 pw_sent` | `ALTER ROLE`, **`ALTER SUCCEEDED - SQLSTATE 00000`**, `APPLY END` | **t** | all FALSE | no/no | 0/0 |
| c2 | **forced failure: role doesn't exist** | `pw_sent` | `ERROR: role … does not exist`, **`ALTER FAILED - password NOT changed - SQLSTATE 42704`**, `APPLY END` | f | all FALSE | no/no | 0/0 |
| c3 | **forced failure: permission denied** (target a superuser) | `pw_sent` | `ERROR: permission denied to alter role`, **`ALTER FAILED … SQLSTATE 42501`**, `APPLY END` | f (target's password untouched) | all FALSE | no/no | 0/0 |
| c4 | **missing FIFO** (`fifo` unset) | — | `NO FIFO PATH SET - nothing changed` | f | all FALSE | — | 0/0 |
| c5 | **missing FIFO** (wrong path) | — | `NOT RECEIVED - nothing changed` | f | all FALSE | no/no | 0/0 |
| c6 | **invalid password** (symbols) | `pw_bad_not_sent` | `NOT RECEIVED - nothing changed` | f | all FALSE | no/no | 0/0 |
| c7 | **interrupted writer** (Ctrl-C) | — | `NOT RECEIVED - nothing changed` | f | all FALSE | no/no | 0/0 |

Notes:
- Error text printed by the server (`role … does not exist`, `permission denied to alter role`) contains no statement text. `VERBOSITY terse` shows no `LINE 1:` excerpt.
- **A NOTICE** (for example "empty string … clearing password") isn't an error, so `ALTER SUCCEEDED` would still print. The success line therefore says "confirm no NOTICE above", and **any NOTICE remains a STOP**. (The empty-password path is unreachable through the `awk` guard.)

**Retry-instruction update:** the expected terminal-1 output is `ALTER ROLE`, then `overwrite_activity 1 (1 row)`, then **`APPLY RESULT: ALTER SUCCEEDED - SQLSTATE 00000 - confirm no NOTICE above`**, then `APPLY END: newpw cleared`. **`ALTER FAILED`** (any SQLSTATE) is a **STOP**: the password wasn't changed; report the code. Hash check: `apply.sql` = `34a123ec…2639`.

#### 7.13 B2-B CLOSED: **PASS** (owner-reported, 2026-11-11)

| Item | Result |
|---|---|
| Attempt 1 | **FAILED SAFE.** Syntax error at `:` (uninterpolated placeholder), no `ALTER` executed, password not sent (§7.11) |
| Attempt 2 | **SUCCEEDED** with hash-verified files: `apply.sql` `34a123ec286a62356f705468ed28ccef3758b42567eb96ee38165355029c2639` (40 lines), `writer.zsh` `634b68f124981f4568f4106b506661be9ac3c8695ec2793058b0516fe50c1bab` |
| Writer | `len=40`, `pw_sent` |
| psql | `ALTER ROLE`; `APPLY RESULT: ALTER SUCCEEDED - SQLSTATE 00000`; **no NOTICE, no ERROR**; `APPLY END: newpw cleared` |
| Post-run variables | `newpw=FALSE`, `fifo=FALSE` |
| Cleanup | FIFO directory removed; psql session closed |
| Role attributes | `aura_app_2026_11`: LOGIN; no SUPERUSER, CREATEROLE, CREATEDB, REPLICATION or BYPASSRLS (matches baseline) |
| Outgoing memberships | 0 |
| Incoming memberships | exactly 1, the approved creator row (`neondb_owner`, ADMIN t / INHERIT f / SET f, bootstrap grantor) |
| Reverse membership (`m/u/s`) | `t \| f \| f` |
| Ownership | `0 / 0 / 0 / 0` |

**Status:**
- **B2-B: PASS, closed.**
- **Not yet proven:** that the new password authenticates. That is B3.
- No Production change beyond the single `ALTER ROLE … PASSWORD` on `aura_app_2026_11`.
- No Vercel, grant, schema or `neondb_owner` change. Freeze active.

**Owner-side leftovers (not secret-bearing, delete at leisure):** `~/aura-b2b-writer.zsh` and the local `apply.sql` copy, if made.

#### 7.14 B3 readiness package: pooled login validation (PREPARED; **not authorized, not executed**)

**Design:**
- **Password handling:** typed only at **psql's own hidden prompt** (`Password for user aura_app_2026_11:`), pasted from the password manager. It's never placed in an argument, an environment variable, a file, a FIFO, a URL or psql history.
- No `-W`: psql first connects without a password, so **TLS verification and channel-binding negotiation happen before the prompt appears**. A TLS failure surfaces **before** the password is ever typed (tested, t3).
- **TLS:** `sslmode=verify-full sslrootcert=system channel_binding=require`, the same parameters as B1/B2, which worked against the direct host.
- **Checks:** all of them run from a **hash-pinned file via `\i`**, so nothing is multi-line pasted. They run inside `BEGIN TRANSACTION READ ONLY … ROLLBACK`, which also pins a single backend under PgBouncer transaction pooling.
- **Verdict:** the file computes one fail-closed boolean. A NULL value, an SQL error or a missing verdict line all mean STOP.
- **Scope:** catalog reads and `has_*_privilege` / `pg_has_role` only. No application table is read. No write, `SET ROLE`, grant or DDL.

**`b3_checks.sql` (FINAL, after the §7.15 review): 124 lines, sha256 `19e34d1b61315a7a5ae7ac93ce4e052fecabbabbcbeb38494fcdd05eb2caba1e`** (supersedes `a2b5aaf3…79f9`)
- Source: `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/b2b-test/bin/b3_checks.sql`.
- Lines 1–6 are the expectations: `exp_role` `aura_app_2026_11`, `exp_owner` `neondb_owner`, `exp_db` `neondb`, `exp_vnum` 170011, `exp_host_re` `^ep-[a-z0-9-]+-pooler[.][a-z0-9.-]+[.]aws[.]neon[.]tech$`, `exp_tables` 25.
- Every expectation is in the automated verdict, including the table count and a census of direct ACL entries across every privilege catalog.

**Procedure (owner-run, after separate authorization):**

**B3-0, preconditions** (fresh terminal; each must print the expected value, otherwise STOP):
1. `unset HISTFILE`, so a mis-paste at the shell prompt can't reach `~/.zsh_history`. Optional: Terminal → Secure Keyboard Entry.
2. Clipboard managers paused; Handoff / Universal Clipboard off.
3. Copy the file to `~/aura-b3-checks.sql`. `shasum -a 256 ~/aura-b3-checks.sql` must give `19e34d1b…ba1e`.
4. `[ -e ~/.pgpass ] && echo PGPASS_PRESENT || echo no_pgpass` must give `no_pgpass`.
5. `env | /usr/bin/cut -d= -f1 | /usr/bin/grep -E '^(PG|SSL_CERT_|OPENSSL_|DYLD_|DATABASE_URL$|PSQL)' || echo env_clean` must give `env_clean`. Otherwise report the variable **names** only.
6. `/opt/homebrew/bin/psql --version` must give `psql (PostgreSQL) 16.14 (Homebrew)`.
7. **POOLED-HOST:** the B2-B DIRECT-HOST with **`-pooler` appended to the endpoint ID** (first DNS label) and nothing else changed. **Never copy a connection string** from Vercel, Neon Connect or `.env`.

   ```bash
   H='<POOLED-HOST>'; [[ $H =~ '^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.aws\.neon\.tech$' ]] && echo host_ok || echo HOST_BAD
   ```

   This must print `host_ok`. Also confirm by eye that the endpoint ID equals the DIRECT-HOST's.

**B3-1, connect** (same terminal; `$H` from B3-0; libpq variables cleared):

```bash
( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  unset PGPASSWORD PGPASSFILE PGUSER PGHOST PGHOSTADDR PGPORT PGDATABASE PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLMODE PGSSLROOTCERT PGCHANNELBINDING PGSSLNEGOTIATION DATABASE_URL
  PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n "host=$H dbname=neondb user=aura_app_2026_11 sslmode=verify-full sslrootcert=system channel_binding=require" )
```

- **Copy the password only after** `Password for user aura_app_2026_11:` is visible. Paste it and press Enter; nothing echoes.
- **Security property:** `verify-full` + `channel_binding=require` guarantee the password is never sent over an unverified or non-channel-bound connection. Not using `-W` also makes any such failure visible **before** anything is typed (tested t3; channel binding confirmed by review).
- If a paste ever lands at the **shell** prompt (psql already exited), press **Ctrl-U or Ctrl-C, never Enter**, and apply the burn rule.
- The banner must show `SSL connection (protocol: TLSv1.3 …)` (TLSv1.2 acceptable; record it). The prompt must end in `=>`.

**B3-2, checks.** Run `\i /Users/<you>/aura-b3-checks.sql` using the full absolute path.

**Expected output:**

| Item | Expected |
|---|---|
| `\conninfo` | user `aura_app_2026_11`, database `neondb`, host `ep-…-pooler.…aws.neon.tech`, `SSL connection (protocol: TLSv1.3 …)` |
| `host_is_pooler` | `t` |
| B3-1 identity | `aura_app_2026_11 \| aura_app_2026_11 \| neondb \| 17.11… \| on` |
| B3-2 role attributes | `aura_app_2026_11 \| f \| t \| f \| f \| t \| f \| f \| -1 \| (empty) \| (empty)` |
| B3-3 outgoing memberships | `(0 rows)` |
| B3-4 incoming memberships | exactly `neondb_owner \| t \| f \| f \| t` |
| B3-5 ownership | `0 \| 0 \| 0 \| 0` |
| B3-6 privileges | `public_tables` **25**, then `0 \| 0 \| 0`, `schema_usage` t, `schema_create` **f**, `db_connect` t, `db_create` **f**, `db_temp` t (record) |
| B3-6b `direct_acl_entries` | **0** |
| Final lines | `ROLLBACK`, **`B3 RESULT: PASS - …`**, `B3 END` |

**B3-3, close:**
- `\q`.
- `pbcopy </dev/null`.
- Re-enable clipboard managers / Handoff.
- Report the B3-1…B3-6b rows, the TLS line and the `B3 RESULT` line. The hostname may be omitted. **Never the password.**

**B3 STOP conditions** (report and stop; no improvisation):
1. Any B3-0 precondition is not as expected: hash, `PGPASS_PRESENT`, environment names, psql version, `HOST_BAD`, or an endpoint-ID mismatch.
2. Any connection error **before** the password prompt (TLS, certificate, channel binding, DNS, timeout). Don't weaken any parameter.
3. An error **after** the prompt:
   - **only** an error containing `password authentication failed` allows **one** retry, after re-copying from `Neon aura_app_2026_11 (Production)`;
   - a second failure means STOP;
   - **any other** post-prompt error (compute unavailable, too many connections, other Neon proxy errors) means STOP with no retry. Report the error text.
   - **No re-run of `apply.sql`**: another rotation needs separate authorization.
4. Banner without `SSL connection`, or a prompt other than `=>` before `\i`.
5. Any `ERROR`, `WARNING` or `NOTICE` during `\i`, a `=!>` prompt, or **no `B3 RESULT` line**. Then `\q`.
6. `B3 RESULT: STOP …` (either variant).
   - If the **only** difference is `server_version` (for example a Neon minor update to 17.12), report it. It's a benign mismatch, not an incident, but still a STOP until reviewed.
7. Any output that appears to contain the password, or a paste that reached the shell. **Burn rule:** clear scrollback; the password is burned; re-rotation needs separate authorization.

**Production impact:**
- One short client session through the pooler as a role with **no privileges**.
- Read-only transaction, rolled back.
- It may wake an autosuspended compute. The role appears in Neon connection logs and `pg_stat_activity`.
- No change to roles, grants, schema, Vercel or the application. Freeze unaffected.

**Accepted residuals (unchanged from B2):** Neon's proxy terminates TLS, so the password reaches Neon infrastructure (inherent to SCRAM-over-proxy authentication). Neon connection logging is outside our control.

**Not testable locally:**
- `sslrootcert=system` against Neon's real chain on the pooled host. It worked on the direct host with the same chain; failure is fail-closed before the prompt.
- Neon pooler channel-binding support (fail-closed).
- PG17 `MAINTAIN` (covered by the ACL census, which counts any privilege bit).
- The exact zsh B3-1 invocation through PgBouncer.

**Tests** (FINAL file logic; throwaway local PG 16.14 cluster; TLS with a private test CA and a `localhost` certificate; `hostssl … scram-sha-256` for `app_sim`, everything else rejected; interactive psql via pty; dummy passwords generated by the harness and never printed).
- The test copy `b3_checks_sim.sql` differs from the final file **only in lines 1–6** (verified by `diff`).
- t1–t18 ran on the post-review file. Line 5 (`exp_host_re`) was then widened to allow dotted Neon region labels. That line is substituted in the test copy, so the logic tested is identical. The new pattern was verified separately in PostgreSQL (below).
- Afterwards: cluster stopped, `pg_hba.conf` restored, socket directories removed, `app_sim` password NULL, memberships at baseline (1), test schema, table and grants reverted, 0 test psql processes left.

| # | Case | Result | Prompts | leak / proc_leak | sessions left |
|---|---|---|---|---|---|
| t1 | correct password, verified TLS | `SSL connection (TLSv1.3)`, `host_is_pooler t`, `direct_acl_entries 0`, **`B3 RESULT: PASS`**, `B3 END`; `b3_ok` unset afterwards | 1 | 0/0 | 0 |
| t2 | wrong password | `FATAL: password authentication failed`; no checks run | 1 | 0/0 | 0 |
| t3 | TLS verification failure | `SSL error: certificate verify failed` **before** any prompt | **0** | 0/0 | 0 |
| t4 | production expectations off-target | `host_is_pooler f`, **STOP** | 1 | 0/0 | 0 |
| t5 | table `SELECT` grant | **STOP** | 1 | 0/0 | 0 |
| t6 | column-level grant only | **STOP** | 1 | 0/0 | 0 |
| t7 | sequence `USAGE` grant | **STOP** | 1 | 0/0 | 0 |
| t8 | outgoing membership (`pg_read_all_data`) | **STOP** | 1 | 0/0 | 0 |
| t9 | attribute changed (`CREATEDB`) | **STOP** | 1 | 0/0 | 0 |
| t10 | `PUBLIC` `CREATE` on schema `public` | **STOP** | 1 | 0/0 | 0 |
| t11 | extra incoming membership | **STOP** | 1 | 0/0 | 0 |
| t13 | SQL error mid-file | `ERROR`, **no `B3 RESULT` line**, prompt `=!>` | 1 | 0/0 | 0 |
| t14 | **non-public schema** `USAGE` + table `SELECT` (new) | **STOP** | 1 | 0/0 | 0 |
| t15 | **default ACL** granting to the role (new) | **STOP** | 1 | 0/0 | 0 |
| t16 | **function `EXECUTE`** (`pg_read_file`) (new) | **STOP** | 1 | 0/0 | 0 |
| t17 | **database `TEMP`** direct grant (new) | **STOP** | 1 | 0/0 | 0 |
| t18 | **`public_tables` mismatch** (extra table) (new) | **STOP** | 1 | 0/0 | 0 |
| t12 | regression after reverting everything | **PASS** | 1 | 0/0 | 0 |

**Host-pattern verification** (PostgreSQL regex, final line 5, and the zsh pre-check):
- Accepted: `ep-abc-123-pooler.c-2.us-east-1.aws.neon.tech` and `ep-abc-123-pooler.us-east-2.aws.neon.tech` (t).
- Rejected (f): the direct host, `ep-x-pooler.attacker.tld`, `…aws.neon.tech.evil.com`, `localhost`.
- The zsh pre-check gave the same results.
- Environment pre-check: clean environment → `env_clean`; with `SSL_CERT_FILE` and `PGHOST` set → prints only those **names**.

#### 7.15 Independent review of §7.14: **APPROVE WITH CHANGES** (no P0). All findings applied.

**Verified by the reviewer** (including offline experiments on its own throwaway cluster, since deleted):
- With `channel_binding=require`, libpq refuses scram, md5 and cleartext before the prompt.
- `sslrootcert=system` requires and pairs with `verify-full`; SNI is sent by default; Neon's wildcard certificate covers `-pooler`.
- Explicit conninfo can't be overridden by `PG*` variables.
- Every `\gset` NULL and zero-row path fails closed. No false-PASS path exists in the AND chain.
- `pg_has_role` gives no false STOPs (`pg_database_owner`, PUBLIC, `neon_superuser`).
- The catalogs are readable by an unprivileged role.
- `server_version_num` 170011 is 17.11.
- `BEGIN READ ONLY … ROLLBACK` pins one PgBouncer backend.
- TLS evidence is client-side only, which is correct; `pg_stat_ssl` would show the pooler hop.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| P1-1 | P1 | The privilege census missed non-`public` schemas, default ACLs, function `EXECUTE`, database ACLs and PG17 `MAINTAIN`. The reviewer reproduced a false PASS. | **Fixed:** a direct-ACL census over 13 privilege catalogs (`aclexplode`), shown as B3-6b and gated in the verdict. Tests t14–t17 added. Direct grants are sufficient because outgoing memberships are gated at 0 and PUBLIC is covered by the `has_*` checks. |
| P2-1 | P2 | Environment clearing omitted OpenSSL trust overrides (`SSL_CERT_FILE`/`DIR`, `OPENSSL_CONF`) and `DYLD_*` | **Fixed:** B3-0 names-only environment pre-check; absolute `/opt/homebrew/bin/psql`; version check |
| P2-2 | P2 | `public_tables = 25` was not in the verdict | **Fixed:** `exp_tables 25` in the verdict (t18) |
| P2-3 | P2 | Host regex too loose, and checked only after authentication | **Fixed:** anchored `…aws.neon.tech$` pattern, plus a pre-connect zsh `host_ok` check. (A follow-up correction of mine allows dotted region labels such as `c-2.us-east-1`.) |
| P2-4 | P2 | A mis-paste at the shell after psql exits could reach zsh history | **Fixed:** `unset HISTFILE`; copy only after the prompt is visible; Ctrl-U/Ctrl-C rule; burn rule |
| P2-5 | P2 | Post-prompt errors other than authentication failure were not covered | **Fixed:** the retry applies only to `password authentication failed`; anything else is a STOP with no retry |
| P3-1 | P3 | A Neon minor version update would cause a false STOP | **Noted** in STOP 6 (benign, report) |
| P3-2 | P3 | Impact note: compute wake-up, log visibility | **Added** |
| P3-3 | P3 | Wording of the no-`-W` guarantee | **Reworded** |

**Self-found defect (fixed before release):** the reviewer's tightened pattern `[a-z0-9-]+` for the region would have **rejected real Neon hosts** with dotted labels (`c-2.us-east-1`), causing a false STOP in Production. Corrected to `[a-z0-9.-]+` and verified in PostgreSQL and zsh.

**Readiness: B3 READY. Execution remains HOLD until explicit owner authorization.**

#### 7.16 B3 authorization (owner, 2026-11-11): **AUTHORIZED (CONDITIONAL)**

**Conditions:**
- B3 pooled-login validation only, after every §7.14 B3-0 precondition passes.
- Use the hash-verified file `b3_checks.sql` `19e34d1b…ba1e`, exactly as in §7.14.
- **Stop immediately** on unexpected output, a failed precondition, an SQL error, or a missing `B3 RESULT: PASS`.

**Not authorized:** repeating B2-B, grants, Vercel changes, deployments, `neondb_owner` credential changes.

**B4 and all later gates: HOLD. Freeze: active.**

**Execution:** owner-run; the operator has no access to the password by design. _Results to be recorded below as received._

#### 7.17 B3 run 1 (owner, 2026-11-11): **STOP, SETUP FAILURE** (not an authentication failure)

**Observed:** `psql: could not translate host name "dbname=neondb" to address`. The owner's diagnostic was `HOST_EMPTY`: `$H` was empty when the B3-1 command ran.

**Root cause** (reproduced offline with psql 16.14):
- With `H` empty, the conninfo string becomes `host= dbname=neondb …`.
- libpq skips the whitespace after `host=` and takes the next token as the value, so the host became the literal `dbname=neondb`.
- Name resolution failed **before any network connection**.

**Consequences:**
- No TCP connection, no TLS, **no password prompt**, nothing sent to Neon.
- No credential exposure.
- B3 is **not** counted as an authentication attempt, so the single authentication retry stays unused.

**Procedural cause:** §7.14 assigned `H` in a separate B3-0 line and relied on that shell state carrying over into B3-1. Nothing guarded against an unset value immediately before `psql`.

**Correction (proposed; pending review and owner go-ahead):**
- B3-0 item 7 and B3-1 are replaced by **one self-contained block** (`b3_connect.zsh`, 8 lines).
- The owner edits only line 2 (`D=` the B2-B direct host).
- The pooled host is **derived** (`-pooler` appended to the endpoint label), so the endpoint ID matches by construction.
- Two anchored format guards `exit 1` before `psql` on any empty or invalid value.
- All other B3-0 checks (history, clipboard, hash, `.pgpass`, env, psql version), B3-2 and B3-3 are unchanged. `b3_checks.sql` is unchanged (`19e34d1b…ba1e`).

**Corrected B3-0 item 7 + B3-1: `b3_connect.zsh`**
- 8 lines, sha256 `f3c5abb9848415fb83d99c4202fdf60d5f80598f79c743ff3a69ed39ae368586`.
- Source: `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/b2b-test/bin/b3_connect.zsh`.
- Supersedes the separate `H=` pre-check and the B3-1 command in §7.14.

```zsh
( set +x 2>/dev/null; unsetopt xtrace 2>/dev/null
  D='<DIRECT-HOST>'
  [[ -n $D && -z ${D//[a-z0-9.-]/} && $D != *..* && $D != *.-* && $D != *-.* && $D =~ '^ep-[a-z0-9-]+\.[a-z0-9.-]+\.aws\.neon\.tech$' && $D != *-pooler.* ]] || { echo 'B3 GUARD: DIRECT HOST INVALID - not connecting'; exit 1; }
  H="${D%%.*}-pooler.${D#*.}"
  [[ -n $H && $H =~ '^ep-[a-z0-9-]+-pooler\.[a-z0-9.-]+\.aws\.neon\.tech$' && "${H%%-pooler.*}" == "${D%%.*}" && "${H#*.}" == "${D#*.}" ]] || { echo 'B3 GUARD: POOLED HOST INVALID - not connecting'; exit 1; }
  printf 'B3 GUARD: OK endpoint=%s pooled_host=%s\n' "${D%%.*}" "$H"
  unset PGPASSWORD PGPASSFILE PGUSER PGHOST PGHOSTADDR PGPORT PGDATABASE PGOPTIONS PGSERVICE PGSERVICEFILE PGSSLMODE PGSSLROOTCERT PGCHANNELBINDING PGSSLNEGOTIATION PGSSLCERT PGSSLKEY PGSSLCRL PGSSLCRLDIR PGREQUIREAUTH PGGSSENCMODE PGSSLSNI PGTARGETSESSIONATTRS SSL_CERT_FILE SSL_CERT_DIR DATABASE_URL
  PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n "host=$H dbname=neondb user=aura_app_2026_11 sslmode=verify-full sslrootcert=system channel_binding=require" )
```

**Dry-run tests** (zsh 5.9; `/opt/homebrew/bin/psql` replaced by a stub that prints its argv and counts `PG*` and `SSL_CERT_*` env vars; only line 2 and that path differ; run under `LC_ALL=C` and `en_US.UTF-8`, with `SSL_CERT_FILE` and `PGSSLSNI` pre-set):
- **Pass, reaching the stub:**
  - `ep-abc-123.c-2.us-east-1.aws.neon.tech` gives `host=ep-abc-123-pooler.c-2.us-east-1.aws.neon.tech`.
  - `ep-abc-123.us-east-2.aws.neon.tech` gives `host=ep-abc-123-pooler.us-east-2.aws.neon.tech`.
  - In both, the remaining conninfo is unchanged, and there are 0 `PG*` and 0 `SSL_CERT_*` variables.
- **`DIRECT HOST INVALID`, psql never reached:**
  - empty, or the untouched placeholder;
  - an already `-pooler` host;
  - `ep-ébc…` (non-ASCII; under UTF-8 too);
  - `ep-a...`, `ep-a.-.`, `ep--.x.`, `ep-a.c-.`;
  - `….aws.neon.tech.evil.com`;
  - embedded ` sslmode=disable`, a trailing or leading space, uppercase;
  - an embedded NUL plus ` sslmode=disable`.
- **Shell variants:**
  - interactive zsh with the owner's rc behaves identically;
  - `setopt rematchpcre` makes the subshell abort (rc 2) before psql;
  - under bash, guard 1 never matches, so it fails closed.
- `zsh -n` syntax check: OK.

**Independent review of `b3_connect.zsh`: APPROVE WITH CHANGES (no P0/P1). All changes applied.**
- P2: non-ASCII letters passed `[a-z]` under a UTF-8 locale.
- P2: empty or dash-only labels passed.
- P3: a NUL byte truncated the regex input and argv, so `sslmode` was dropped (needs a typed control character; not reachable by an ordinary paste).
- **Fixed by:** a code-point character-class check `-z ${D//[a-z0-9.-]/}` plus `..`, `.-` and `-.` exclusions on line 3. Re-tested above.
- P3: the `unset` list was extended with the remaining `PGSSL*`/`PGREQUIREAUTH`/`PGGSSENCMODE`/`PGSSLSNI`/`PGTARGETSESSIONATTRS` variables and `SSL_CERT_FILE`/`SSL_CERT_DIR`. **Applied.**
- P3: `-W` was suggested. **Not adopted:** prompting only after the connection keeps TLS and channel-binding failures visible before the password is typed. `~/.pgpass` absence is a B3-0 precondition.
- **Verified fine by the reviewer:**
  - quoting and history-expansion safety;
  - a multi-line paste executes only at the closing `)`;
  - `exit 1` leaves only the subshell;
  - a single `host=` in one argv word;
  - no secret in argv, env, history or output;
  - the absolute psql path defeats aliases;
  - `verify-full` + `channel_binding=require` mean any host the guards admit still needs a valid Neon certificate before a password is sent.

**Readiness of the B3 retry: READY. Execution needs the owner's go-ahead** (the B3 authorization in §7.16 is unchanged; run 1 consumed no authentication attempt).

#### 7.18 B3 retry (run 2): **AUTHORIZED (CONDITIONAL)**, owner, 2026-11-11

**Authorization conditions:**
1. All B3-0 preflight checks pass.
2. `b3_connect.zsh` hash `f3c5abb9…8586` is verified and its contents inspected.
3. Only the placeholder on line 2 is replaced, with the verified B2-B direct host.
4. `B3 GUARD: OK` and the correct endpoint are confirmed **before** any password is entered.
5. Verified TLS and channel binding.
6. The password is entered only at psql's hidden prompt.
7. `b3_checks.sql` (`19e34d1b…ba1e`) is run unmodified.
8. STOP on anything unexpected, following the approved retry rules.

**Scope:** B3 only. **Not authorized:** B2-B repeat, grants, Vercel changes, deployments, `neondb_owner` reset. **B4 on HOLD; freeze ACTIVE.**

**Execution detail adopted for condition 2:**
- The block runs as a **file** (`zsh -f ~/aura-b3-connect-run.zsh`), not pasted.
- The run copy is checked with `diff` against the hash-verified original, which must show **only line 2 changed**.
- So the executed text is exactly the reviewed text plus the hostname. This is the same mechanism as the dry-run tests (`zsh -f <file>`).
- If the printed endpoint is wrong after `GUARD: OK`, press **Ctrl-C at the password prompt without typing**, then STOP.

**Run 2 result (owner, 2026-11-11): STOP after successful authentication. Validation incomplete.**

**Confirmed outcomes:**

| Item | Result |
|---|---|
| Preflight | `.pgpass` absent; environment clean; psql 16.14 (Homebrew); `b3_checks.sql` hash verified; `b3_connect.zsh` hash verified; run copy differs **only in line 2** (direct host) |
| Host | pooled host derived by the script |
| **Authentication** | **Succeeded.** The new `aura_app_2026_11` password authenticates through the pooled endpoint. |
| TLS | `SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)`; `verify-full` + `channel_binding=require` were in force, so certificate verification and channel binding necessarily succeeded |
| Server | `psql (16.14 (Homebrew), server 17.11 (9045acd))` |
| Prompt | `neondb=>` |
| Startup banner | `WARNING: psql major version 16, server major version 17.` / `Some psql features might not work.` |

**Not yet verified:**
- B3-1…B3-6b (identity, attributes, memberships, ownership, privileges); `b3_checks.sql` was not run.
- No `B3 RESULT` line.

**Owner decision:** STOP, because the procedure says STOP on any WARNING and this one had no explicit exemption. **B3 is not PASS.**

**To be confirmed by the owner (not in the report):**
- the psql session was closed with `\q`;
- the clipboard was cleared;
- the `B3 GUARD: OK` endpoint matched B2-B.

#### 7.19 Version-warning assessment and correction (PROPOSED; pending independent review and owner authorization)

**Root cause:**
- The text is **psql's own client-side startup notice**, not a server message.
- psql 16 (`connection_warnings()` in `src/bin/psql/command.c`) prints it with `printf` when the server's major version is **newer** than the client's (or the server is older than 9.2).
- It is printed **only at connection time** (interactive startup, `\c`, or an interactive reconnect after `Attempting reset`), never in response to a query. While `\i` reads a file no reset happens: a lost connection ends psql with no RESULT line (STOP).
- It is not a PostgreSQL `WARNING` (no SQLSTATE, no server involvement) and doesn't affect the connection or authentication.
- **Procedure gap (mine):**
  - §7.14 STOP 5 applies to messages **during `\i`**, and STOP 4 only requires `SSL connection` in the banner.
  - The expected banner for a 16-client/17-server pairing should have listed this line, and didn't.
  - The owner's STOP was the correct conservative reading.

**What "some psql features" means:** psql's **describe and catalog backslash commands** (`\d…`, `\l`, `\du`, `\df` …). These build version-specific catalog SQL, and psql 16 doesn't know the 17 catalog layout. Purely client-side meta-commands are unaffected.

**Compatibility of `b3_checks.sql` (124 lines) with psql 16 → server 17:**

| Element | Used in file | PG17 impact |
|---|---|---|
| Describe commands (`\d`, `\du`, …) | **none** | n/a |
| Client meta-commands: `\set`, `\unset`, `\pset pager`, `\echo`, `\if`/`\else`/`\endif`, `:{?var}`, `\gset`, `\conninfo` | yes | client-only. `\conninfo` uses libpq (`PQdb`, `PQuser`, `PQhost`, `PQport`, SSL attributes) and queries no catalog |
| `:'HOST'` interpolation | yes | client-only |
| Catalogs `pg_roles`, `pg_auth_members` (`admin_option`, `inherit_option`, `set_option`, `grantor`), `pg_class`, `pg_namespace`, `pg_proc`, `pg_type`, `pg_attribute`, `pg_default_acl`, `pg_database`, `pg_language`, `pg_tablespace`, `pg_foreign_data_wrapper`, `pg_foreign_server`, `pg_largeobject_metadata`, `pg_parameter_acl` | yes | all present in 17 with the same columns. `inherit_option`/`set_option` are PG16+; `pg_parameter_acl` is PG15+ |
| `aclexplode`, `has_table_privilege` (privilege list without `MAINTAIN`), `has_any_column_privilege`, `has_sequence_privilege`, `has_schema_privilege`, `has_database_privilege`, `pg_has_role` | yes | unchanged in 17. `MAINTAIN` (new in 17) is covered by the `aclexplode` census, which counts any privilege bit |
| `server_version_num` = 170011 | yes | matches the server reported (17.11) |
| `server_version` display | yes | Neon reports `17.11 (9045acd)`; display only. The verdict uses `server_version_num` |

**Fail-closed property:**
- Any version incompatibility in the SQL would raise an `ERROR`. That aborts `\i` under `ON_ERROR_STOP`, so **no `B3 RESULT` line** prints, which is a STOP (tested t13).
- A NULL verdict also prints STOP (reviewer-verified).
- So a client/server mismatch can cause a false **STOP**, never a false **PASS**.

**Options:**

| | A: install a PostgreSQL 17 client | B: exempt exactly this startup notice |
|---|---|---|
| Change | new toolchain (`brew install postgresql@17`, a download) | procedure text only; **no file changes; both hashes unchanged** |
| Re-validation needed | the full B3 test set and the `b3_connect.zsh` dry-runs against a new libpq/psql (new defaults such as `sslnegotiation`) | none for the files. The exemption is a fixed, exact text match |
| Risk | new, untested client in a security-critical step | none to safety (fail-closed above). Possible false STOP only |
| Matches the B1/B2 history | no | yes. B1/B2 were interactive psql 16.14 sessions against 17.x, so they **would have** shown the same notice (not recorded at the time) |

**Recommendation: Option B.**
- The notice is client-side and expected.
- The check file uses no affected feature.
- Every incompatibility path fails closed.
- Option A would put an unvalidated toolchain into the credential step. Option A stays the right choice for **later** gates that need describe commands; none do.

**Exact procedure amendment (§7.14 B3-1 banner and STOP 4/5):**
- **Allowed once, at connection only:** exactly these two lines, matching byte for byte (including the 9-space indent on the second line), immediately after the `psql (16.14 (Homebrew), server 17.11 (…))` line:

  ```
  WARNING: psql major version 16, server major version 17.
           Some psql features might not work.
  ```

- **Still STOP:**
  - **a second occurrence** of the notice, or any appearance after `Attempting reset` or `\c`: STOP and `\q`;
  - a server version other than **17.11** in the banner: STOP before `\i` (report it; benign, as in STOP 6). The build tag in parentheses (`9045acd`) may differ and is not a STOP;
  - any other `WARNING`, `NOTICE` or `ERROR` before `\i`, including this notice with different version numbers;
  - any `WARNING`, `NOTICE` or `ERROR` during `\i`;
  - a missing `SSL connection (protocol: TLSv1.3 …)` line;
  - a prompt other than `neondb=>`;
  - a missing `B3 RESULT: PASS`.
- **Updated expected banner:**
  1. `psql (16.14 (Homebrew), server 17.11 (…))`
  2. the two allowed lines
  3. `SSL connection (protocol: TLSv1.3, …)`
  4. `Type "help" for help.`
  5. a blank line
  6. `neondb=>`
- Everything else in §7.14/§7.17/§7.18 is unchanged: the same files and hashes, preflight, `diff` rule, guard, single authentication retry (unused; run 2 authenticated), checks, close-out and STOP list.

**Independent review of §7.19: APPROVE WITH CHANGES** (no P0/P1). **No file changes; both hashes unchanged.**
- **Verified:**
  - the notice is client-only, printed by `connection_warnings()` at connection time, and can't appear mid-`\i` (the file has no `\c`; there is no reset during `\i`);
  - every meta-command works with psql 16 against server 17;
  - every catalog, column and function exists in PG17 with the same meaning;
  - `pg_parameter_acl` and `pg_largeobject_metadata` are readable by unprivileged roles;
  - no PG17 predefined role (including `pg_maintain`) can give a false STOP through `pg_has_role`;
  - a false PASS from the version mismatch is **impossible**;
  - Option B is sound.
- **P2, applied:**
  - B1/B2 wording changed to "would have shown, not recorded";
  - a second occurrence, or any occurrence after a reset or `\c`, is a STOP.
- **P3, applied:**
  - trigger wording corrected (server newer than client);
  - banner line 1 pinned to 17.11 with any build tag;
  - blank line added to the expected banner;
  - byte-exact match required.
- **P3, informational (carried forward, not blocking B3):** a `MAINTAIN` grant **to PUBLIC** on public tables would go undetected by B3 (B3 checks only direct grants and the listed privilege strings). `MAINTAIN` gives no data access. **Add a PUBLIC-`MAINTAIN` check at §11.5b / B6.**
- **Run 2 password status:** **not burned.** It was typed only at psql's hidden prompt, and the session authenticated normally.

**Production impact of run 3:** one more short pooled session (authentication plus a read-only, rolled-back transaction). No other change.


#### 7.20 B3 run 3: **AUTHORIZED (CONDITIONAL)**, owner, 2026-11-11

**Run 2 confirmations (owner):**
- the session was closed with `\q`;
- the direct host is `ep-…f5t5.c-10.us-east-1.aws.neon.tech`, matching B2-B;
- B3 SQL validation was not executed.
- **Clipboard clearing after run 2 is uncertain.** So `pbcopy </dev/null` runs **before** run 3 and again after it, and clipboard managers stay paused.

**Authorization:**
- One controlled run 3 with `b3_connect.zsh` `f3c5abb9…8586` and `b3_checks.sql` `19e34d1b…ba1e`, both unchanged.
- **Approved exception:** the exact two-line psql 16/17 version notice, **once, in the initial startup banner only** (§7.19).
- Every other WARNING, NOTICE, ERROR, unexpected output or failed check is a STOP.

**Not authorized:**
- grants, migrations, Vercel changes, deployments, merges, `neondb_owner` changes;
- repeating B2-B.

**B4: HOLD whatever the outcome. Freeze: ACTIVE.**

**Operator pre-check (offline, 2026-11-11):**
- Both source hashes re-verified.
- A run copy with the confirmed direct host gives a `diff` of exactly `2c2`.
- A dry run with psql replaced by a stub (no network) gives:
  - `B3 GUARD: OK endpoint=ep-…f5t5 pooled_host=ep-…f5t5-pooler.c-10.us-east-1.aws.neon.tech`;
  - psql argv `host=ep-…f5t5-pooler.c-10.us-east-1.aws.neon.tech dbname=neondb user=aura_app_2026_11 sslmode=verify-full sslrootcert=system channel_binding=require`.
- The pooled host also matches `b3_checks.sql`'s `exp_host_re`.

**Run 3 result (owner-reported, 2026-11-11): SQL verdict PASS. Closure: HOLD pending evidence (see checklist).**

**Reported by the owner:**
- Pre-session `pbcopy </dev/null`.
- `b3_checks.sql` `19e34d1b…ba1e` ✔; `b3_connect.zsh` `f3c5abb9…8586` ✔.
- `diff` shows only `2c2` (placeholder → `ep-…f5t5.c-10.us-east-1.aws.neon.tech`).
- psql 16.14 client, 17.11 server.
- "Expected client/server version warning appeared".
- `SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384 …)`.
- `neondb=>`.
- Final lines:

```
ROLLBACK
B3 RESULT: PASS - login, identity, attributes, memberships, ownership, table count and pre-B4 privileges match
B3 END
```

**What the PASS line establishes by construction** (analysis; no new connection; amended after the independent review):
- **Verdict logic:** `B3 RESULT: PASS` prints only when `b3_ok` is true. `b3_ok` is unset at line 13; a NULL leaves it unset ("not computed"); an ERROR under `ON_ERROR_STOP` means no RESULT line at all.
- **The boolean** is evaluated server-side, as the AND of:
  - the **host conjunct**: the client's `PQhost` value (the hostname psql connected to) matches `^ep-…-pooler….aws.neon.tech$`;
  - `session_user` = `current_user` = `aura_app_2026_11`; database `neondb`; `server_version_num` 170011; read-only transaction;
  - all 10 role attributes exact; 0 outgoing memberships; exactly 1 incoming row (`neondb_owner`, admin t / inherit f / set f, grantor 10);
  - **0 owned relations, schemas, functions or types (current database)**;
  - 25 public tables;
  - 0 table, column or sequence privileges in `public` (**excluding PUBLIC `MAINTAIN`**, carried to §11.5b/B6);
  - no `CREATE` on schema `public` or the database;
  - 0 direct ACL entries in 13 privilege catalogs (this database plus shared catalogs).
- **TLS and channel binding:** with the script's conninfo, libpq authenticates only if `verify-full` and `channel_binding=require` both hold, so a successful login proves both. _This is conditional on_:
  - the diffed run copy being what was executed (`zsh -f`), unmodified after the diff;
  - a clean environment (1c). The script doesn't clear `OPENSSL_*`/`DYLD_*`, which the B3-0 env check covers.
- **Guard:** psql starts only after both guards pass, so a successful login implies `B3 GUARD: OK`.
- **Endpoint:** the run-3 pooled host equals line 2 plus `-pooler` by construction. Its equality to the B2-B host rests on the **owner's attestation** (§7.20), because the B2-B record shows only `<DIRECT-HOST>`.
- **No changes:** by construction **for the `\i` file only** (catalog reads; `ROLLBACK`). Anything typed interactively before `\i` or after `B3 END` needs attestation.

**What the PASS line does not establish:**
- `WARNING`/`NOTICE` during `\i`;
- the exact, single startup notice;
- the B3-0 items not reported;
- the execution method;
- authentication attempts;
- STOP 7 (no password exposure);
- other interactive commands;
- the B3-3 cleanup;
- the ungated values `schema_usage`, `db_connect`, `db_temp` and the `\conninfo` text.

**Evidence completeness checklist (final):**

| # | Item | Status |
|---|---|---|
| 1a | `unset HISTFILE` | **MISSING** |
| 1b | `no_pgpass` (run 3) | **MISSING** (reported for run 2 only) |
| 1c | `env_clean` (run 3) | **MISSING** (reported for run 2 only) |
| 1d | psql 16.14 | Verified (owner-reported) |
| 1e | clipboard managers and Handoff paused **from run 2 through the post-run-3 `pbcopy`** (or history purged) | **MISSING**. Clearing after run 2 is uncertain; `pbcopy` doesn't purge a manager's history |
| 1f | pre-session clipboard cleared | Verified (owner-reported) |
| 1g | both hashes | Verified (owner-reported) |
| 2 | `diff` = `2c2` only | Verified (owner-reported summary) |
| 2b | run copy executed via `zsh -f ~/aura-b3-connect-run.zsh`, unmodified after the diff; `\i` used the hash-verified absolute path | **MISSING** |
| 3 | `B3 GUARD: OK` line | Implied by a successful login. The output line is corroborating, optional |
| 3b | endpoint = B2-B | By construction to line 2; equality to B2-B is **owner-attested** |
| 4 | exact two-line notice, **once**, no other banner warning, server 17.11 | **PARTIAL** ("expected warning appeared") |
| 5a | TLSv1.3 | Verified (owner-reported) |
| 5b | `verify-full` + channel binding | By construction, **conditional on 1c and 2b** |
| 5c | pooled host | Verified by construction (host conjunct plus derivation) |
| 5d | authentication on the first attempt (or count); no other post-prompt error | **MISSING** |
| 6 | B3-1…B3-6b | **Verdict-gated values script-verified.** `schema_usage`, `db_connect`, `db_temp` are not gated (**unverified**); rows not in the record |
| 6x | no `WARNING`/`NOTICE`/`ERROR` between `\i` and `B3 END` | ERROR excluded by construction; **WARNING/NOTICE MISSING** |
| 7 | `ROLLBACK` / `B3 RESULT: PASS` / `B3 END` | Verified (owner-reported) |
| 7b | STOP 7: password only at the hidden prompt, never in output, scrollback or at the shell | **MISSING** |
| 8 | only `\i` and `\q` entered; exit by `\q` | **MISSING** |
| 9 | post-session `pbcopy </dev/null`; managers and Handoff restored | **MISSING** |
| 10 | no grants, migrations or config changes from run 3 | By construction for `\i`. The interactive session depends on 8. Vercel and deploy state not re-queried (not authorized) |

**Independent review of this section: AGREE WITH CHANGES** (no P0). All changes applied above.
- **P1:** credential-exposure attestations added (1e window, 5d, 7b).
- **P2:**
  - 5b made conditional;
  - execution-method item 2b added;
  - ownership claim narrowed;
  - item 6 split into gated and ungated values;
  - item 10 limited to `\i`.
- **P3:**
  - PUBLIC `MAINTAIN` exclusion noted;
  - endpoint-equality basis stated;
  - guard line made optional;
  - host conjunct described as the client's `PQhost`;
  - endpoint ID masked in this file (`ep-…f5t5`), and the file stays uncommitted.

**VERDICT: PASS WITH EVIDENCE GAPS, CLOSURE HOLD.**
- No failed check, unexpected change, security deviation or contradiction has been identified.
- The script-reported SQL verdict is PASS, and the authentication and TLS posture are established conditional on 1c and 2b.
- B3 is **not closed**.

**Required to close B3** (owner attestation or pasted lines; never the password; hostname may be masked):
1. 1a `unset HISTFILE`, 1b `no_pgpass`, 1c `env_clean` (names only if not clean), for run 3.
2. 1e: clipboard managers and Universal Clipboard/Handoff paused for the whole window from run 2 to after the post-run-3 `pbcopy`, **or** their history checked and purged.
3. 2b: executed as `zsh -f ~/aura-b3-connect-run.zsh`, unmodified after the diff; `\i /Users/stephen/aura-b3-checks.sql`.
4. 4: the byte-exact two-line psql 16/17 notice, once, no other banner WARNING/NOTICE, server 17.11.
5. 5d + 7b: authentication succeeded on the first attempt (or state the count); password typed only at the hidden prompt; no shell paste; nothing printed resembling it.
6. 6x: no WARNING/NOTICE/ERROR between `\i` and `B3 END`.
7. 8: no commands other than `\i` and `\q`; ended with `\q`.
8. 9: post-session `pbcopy </dev/null`; managers and Handoff restored.

Optional: the B3-1…B3-6b rows (covers the ungated values) and the guard line.

**If 1e or 7b cannot be attested, apply the burn rule:**
- the password is treated as exposed;
- re-rotation (a B2-B repeat) needs **separate authorization**;
- B3 would be re-run afterwards.

**B4 readiness (planning only; not authorized):** B4 planning can start once B3 is closed. Inputs already available:
- the §11.2 grant set;
- the §B4 error-safe single-transaction procedure;
- §11.5b G2 3a/3b with query 1b;
- B6 (17 default-ACL rows).

Additions carried forward:
- a PUBLIC-`MAINTAIN` check (PG17);
- re-confirmation of `public_tables` = 25 at execution time;
- an explicit B4 decision on whether `neondb_owner`'s ADMIN membership baseline must be re-verified in the same session.

**B4 remains HOLD. Freeze ACTIVE.**

#### 7.21 B3 closure attestations (owner, 2026-11-11) and reassessment

**Evidence classes:**
- **Observed terminal evidence:** lines the owner pasted from the terminal.
  - Run 2 banner: `psql (16.14 (Homebrew), server 17.11 (9045acd))`, the version notice, `SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)`, `neondb=>`.
  - Run 3 final lines: `ROLLBACK`, `B3 RESULT: PASS - …`, `B3 END`.
- **Owner-reported:** results stated without a full paste (run 3 hashes, the `diff` = `2c2` summary, TLSv1.3, the pre-session `pbcopy`).
- **User attestations (new):** the eight items below. They're recorded as **attested, not observed**.

**Reassessment of the eight closure requirements (§7.20).** Attestations are quoted as given by the owner.

| # | Requirement | Owner attestation (verbatim) | Status |
|---|---|---|---|
| 1 | `unset HISTFILE`, `no_pgpass`, `env_clean` (run 3) | "Run 3 preflight completed: `unset HISTFILE`, `no_pgpass`, `env_clean`." | **Satisfied (attested)** |
| 2 | clipboard managers and Handoff paused across the **run 2 → post-run-3 `pbcopy`** window, or history checked/purged | "Clipboard managers and Handoff precautions were maintained, including history safety." | **OPEN: wording gap.** It names no window and doesn't say whether history was checked or purged. Run 2's post-session clearing was recorded as uncertain, and B3-3 re-enables managers after `\q`. **Bears on the burn rule.** |
| 3 | `zsh -f` on the unchanged run copy; approved SQL file | "The unchanged, diff-verified connection script was executed using `zsh -f`, and the approved SQL file was used." | **Satisfied (attested).** The SQL path isn't stated; the file was hash-verified. 5b (TLS / channel binding) is **satisfied on attestation** of items 1 and 3 (R1) |
| 4 | exact notice once; no other banner warning; server 17.11 | "The exact permitted PostgreSQL version warning appeared once; server version 17.11 was confirmed by the previously shared banner." | **Partly satisfied.** (a) The notice is satisfied (attested). (b) The run-3 banner server version isn't separately attested (the owner cites the run-2 banner), but run-3 17.11 is **established by the gated `server_version_num = 170011` check**, so the STOP-before-`\i` condition is moot. (c) **"No other banner WARNING/NOTICE before `\i`" is OPEN** |
| 5 | first-try authentication; hidden prompt only; no exposure | "Authentication succeeded on the first attempt. Password entry occurred only at the hidden prompt, without shell or output exposure." | **Satisfied (attested)**; covers 5d and 7b. The retry was never used |
| 6 | **no** WARNING/NOTICE/ERROR between `\i` and `B3 END` (absolute; no exemption applies inside `\i`) | "No unexpected WARNING, NOTICE or ERROR occurred during SQL validation." | **OPEN: the qualifier "unexpected"** leaves room for a message judged expected. ERROR is excluded by construction; WARNING/NOTICE need an unqualified confirmation |
| 7 | only `\i` and `\q`; clean exit | "Only the approved `\i` and `\q` commands were entered; the session exited successfully." | **Satisfied (attested)**. Item 10 ("no changes from run 3") now covers the whole session |
| 8 | post-session `pbcopy </dev/null`; services restored | "The clipboard was cleared after exiting, and paused services were restored." | **Satisfied (attested)**; method not stated |

**Credential-exposure assessment:**
- No exposure has been reported or observed in runs 1–3. Run 1 never reached a prompt. Runs 2 and 3 typed the password only at psql's hidden prompt (attested for run 3).
- **The clipboard path between run 2 and run 3 is not yet attested specifically** (item 2). **The burn rule is not triggered on the available evidence**, but this assessment is **provisional until item 2 is clarified.**

**Residual limitations (non-blocking once F1/F2 are clarified):**
- **R1:** items 1–8 rest on owner attestation, not on observed transcript lines. That includes the authentication-attempt count; no Neon-side log review was authorized.
- **R2:** the B3-1…B3-6b rows and the run-3 `\conninfo` text weren't captured. `schema_usage`, `db_connect` and `db_temp` (displayed but not gated) are **unverified**. B4/G2 re-checks effective privileges.
- **R3:** PUBLIC `MAINTAIN` on public tables isn't covered by B3. It is carried to the B4 plan (§11.5b/B6).
- **R4:** ownership is checked only for relations, schemas, functions and types in the current database. Shared-object ownership isn't.
- **R5:** endpoint equality to B2-B rests on the owner's attestation (the B2-B record carries no hostname).
- **R6:** Vercel and deployment state weren't re-queried. Run 3 couldn't affect them.
- **R7:** the run-3 banner wasn't pasted. The server version rests on the gated check; banner cleanliness rests on the pending clarification.

**Independent completeness review: AGREE WITH CHANGES** (no P0). Earlier STOPs are preserved without contradiction.
- **P1-F1:** the item-2 wording gap (above).
- **P1-F2:** the "unexpected" qualifier in item 6.
- **P2:**
  - F3: item-4 server-version basis reworded; banner cleanliness opened.
  - F4: TLS conclusion marked "on attestation".
  - F5: verbatim attestations quoted.
- **P3:**
  - F6: residuals R7 added; R8 merged into R2, R9 into R1.
  - F7: item-8 method not stated.
- **All rewording applied.**

**VERDICT: B3 SQL PASS. CLOSURE HOLD pending two owner clarifications.** No failed check, contradiction or security deviation has been identified.

**To close, the owner states one line for each:**
- **C1 (item 2):** one of these:
  - (a) "Clipboard managers and Handoff were not re-enabled at any point from run 2 until after the post-run-3 `pbcopy`" (or "no clipboard manager is installed and Handoff was off throughout");
  - (b) "Clipboard-manager history was checked and the password entries from runs 2 and 3 were absent or purged."
  - **If neither can be stated, the burn rule applies:** the password is treated as exposed, and re-rotation needs separate authorization.
- **C2 (items 4c and 6):** "No WARNING, NOTICE or ERROR line of any kind appeared in the startup banner other than the permitted version notice, or anywhere between `\i` and `B3 END`." Otherwise report any such line verbatim.

On C1(a) or C1(b) plus C2, the verdict becomes **B3 PASS, CLOSED**.

- **Earlier records are unchanged:** run 1 STOP (§7.17); run 2 STOP (§7.18); run 3 §7.20 "PASS WITH EVIDENCE GAPS, CLOSURE HOLD".
- **B4: HOLD. Freeze: ACTIVE.**

#### 7.22 C1 clarification and procedural exception (owner, 2026-11-11)

**Owner clarification (C1):** the owner used **standard macOS copy-and-paste**, not a third-party clipboard manager. Continuous clipboard and Handoff isolation between runs 2 and 3 **was not independently established**.

**C1 status:** **UNRESOLVED PROCEDURAL EXCEPTION.** Not technically verified.
- Neither C1(a), "managers and Handoff not re-enabled throughout", nor C1(b), "history checked and purged", can be stated.
- The §7.20 burn rule ("if 1e cannot be attested, treat as exposed") is therefore **formally met**.
- **No actual exposure has been identified.**

**Risk assessment** (no new connection; analysis only):
- **No third-party manager:** the standard macOS pasteboard holds one item and keeps **no history**, so no durable local copy is expected. The value is overwritten by the next copy and was cleared by `pbcopy` after run 3 (attested).
- **Remaining paths:**
  - **(i) Universal Clipboard/Handoff,** if enabled during the window. It syncs the clipboard to the owner's own Apple devices on the same Apple ID, nearby, for a short time (about 2 minutes). Exposure is limited to the owner's own devices.
  - **(ii) Other local apps** running as the same user could read the pasteboard while the value was present. This is the same trust boundary as the psql process itself.
- **Impact if exposed:**
  - `aura_app_2026_11` currently has **no privileges**. B3 confirmed this: 0 grants, 0 ownership, no `CREATE`, 0 direct ACLs. It can log in only, and read catalogs.
  - The role isn't yet used by the application (`AURA_DATABASE_URL` isn't set).
  - Exposure becomes material **only after B4** grants table access.
- **Likelihood:** low (own devices and processes only; no evidence of compromise).
- **Cost of recovery:** lowest **now**. Re-rotation affects no application, because the role is unused. It needs a separately authorized B2-B repeat (the same hash-pinned `apply.sql`/`writer.zsh`) plus a B3 repeat. After Phase C, rotation also needs a Vercel env update and redeploy.

**Options for the owner:**

| | A: accept the exception | B: rotation recovery before B4 |
|---|---|---|
| Action | Owner explicitly accepts the C1 residual; B3 **PASS, CLOSED WITH ACCEPTED SECURITY EXCEPTION** | Keep **CLOSURE HOLD**; separately authorize a B2-B repeat (new password; burn-rule recovery) and a B3 repeat with C1 held continuously (managers/Handoff off from the copy until after `pbcopy`) |
| Residual | low-likelihood exposure to the owner's own devices and processes, persisting into B4 | none from C1 |
| Production impact | none | none (role unused) |
| Effort and risk | none | two more owner-run gates, with a small chance of further procedural STOPs |

**Operator recommendation:**
- **If Handoff/Universal Clipboard was off** during runs 2–3, or the owner's other Apple devices are trusted: **Option A is reasonable.** The residual is confined to the owner's own devices, and the role is currently privilege-less.
- **Otherwise, or for a strictly clean record: Option B.** Now is the cheapest point it will ever be.
- **The decision is the owner's.** It must be an explicit statement of acceptance, or an explicit authorization of the recovery.

**C2 note:** the latest summary again says "No *unexpected* WARNING, NOTICE or ERROR". The unqualified C2 statement (§7.21) **has not yet been given**. It's needed for closure under either option.

**Status:**

| Gate | Status |
|---|---|
| B3 technical validation | **PASS** (unchanged; §7.20–7.21 evidence preserved) |
| B3 formal closure | **PENDING:** (1) the owner's explicit decision on the C1 exception (accept, or authorize recovery); (2) the C2 unqualified confirmation |
| B4 | **HOLD** |
| Freeze | **ACTIVE** |

**Wording for acceptance** (owner, if choosing A): "I accept the C1 clipboard/Handoff procedural exception for B3 runs 2–3 as a residual risk; close B3 as PASS — CLOSED WITH ACCEPTED SECURITY EXCEPTION." Plus C2: "No WARNING, NOTICE or ERROR line of any kind appeared other than the permitted startup version notice."

#### 7.23 B3 closure decision (owner, 2026-11-11): **PASS, CLOSED WITH ACCEPTED SECURITY EXCEPTION**

**C1, owner decision (Option A), verbatim:**
> "I accept the C1 clipboard/Handoff procedural exception for B3 Runs 2–3 as a documented residual risk."

- C1 is recorded as an **ACCEPTED EXCEPTION, not a verified security control**.
- The burn-rule trigger (§7.20) is formally met. The owner accepts the residual instead of re-rotating, based on the §7.22 risk assessment:
  - standard macOS pasteboard only, no third-party manager;
  - any exposure limited to the owner's own devices and processes;
  - the role had no privileges at the time;
  - no actual exposure identified.

**C2, owner statement, verbatim (stated by the owner as the run-3 attestation):**
> "No WARNING, NOTICE or ERROR appeared in the Run 3 startup banner other than the permitted version warning, or anywhere between `\i` and `B3 END`."

- The earlier relayed summaries (§7.21 item 6, §7.22) carried an "unexpected" qualifier. **The owner's verbatim wording above governs** and contains no qualifier.

**Final closure consistency check:**

| # | Requirement | Basis | Status |
|---|---|---|---|
| 1 | preflight (`HISTFILE`, `.pgpass`, env) | attestation §7.21 | met |
| 2 | clipboard/Handoff isolation runs 2→3 | **owner-accepted exception** (§7.22–7.23) | **closed by acceptance (not verified)** |
| 3 | execution method / files | attestation; hashes; `diff` `2c2` | met |
| 4 | exact notice once; no other banner messages; server 17.11 | attestation (4a), **C2 verbatim** (4c), gated `server_version_num` (4b) | met |
| 5 | first-try authentication; no exposure at prompt, shell or output | attestation | met |
| 6 | no WARNING/NOTICE/ERROR in `\i` | **C2 verbatim**; ERROR also by construction | met |
| 7 | only `\i`/`\q`; clean exit | attestation | met |
| 8 | post-session clearing; services restored | attestation | met |
| SQL | `B3 RESULT: PASS`, `ROLLBACK`, `B3 END` | observed final lines; hash-pinned, fail-closed verdict | met |

- No contradictions with §7.17–§7.22.
- No mandatory condition remains unresolved.

**Earlier records preserved unchanged:**
- run 1 STOP (§7.17);
- run 2 STOP (§7.18);
- run 3 "PASS WITH EVIDENCE GAPS, CLOSURE HOLD" (§7.20);
- closure HOLD pending C1/C2 (§7.21–§7.22).

**Residuals carried forward:**
- **R0 (new, accepted):** C1 clipboard/Handoff exception.
- **R1–R7** (§7.21), including PUBLIC `MAINTAIN` (R3, for the B4 plan) and the ungated `schema_usage`/`db_connect`/`db_temp` (R2, re-checked at G2).

**FINAL: B3 PASS, CLOSED WITH ACCEPTED SECURITY EXCEPTION.**
- No new connection, SQL or credential change was made in closing.
- **B4: HOLD** pending separate authorization; planning may be proposed separately.
- **Freeze: ACTIVE.**

#### Route A (fallback, only if Route B is blocked)

Console → `main` → Roles → `aura_app_2026_11` → Reset password. Safeguards:
- (a) take the B2-3(b) snapshot before and after;
- (b) repeat the snapshot after the revocation-step compute restart and before D2 go-live; any change is a STOP;
- (c) a Production health canary across the reset;
- (d) record that the password stays revealable in the Console (standing residual);
- (e) confirm by eye that the password is only `[A-Za-z0-9_.~-]`, otherwise percent-encode it locally before building `AURA_DATABASE_URL`.

#### Then, unchanged

B3 / G1 pooled login as the new role (with `sslmode=verify-full sslrootcert=system channel_binding=require`), then B4 single-transaction grants (with the §B4 error-safe procedure), then the full §11.5b 3a + 3b, then the B6 17-row default-privilege comparison. All STOP conditions are unchanged.
