# AURA-GOV-02-I0-C-B4: Production Least-Privilege Grants, Readiness Plan

**Status:** PLANNING ONLY. Local and uncommitted; contains no secret values.
- **Authorization in force:** B4 planning and independent review only.
- **Not authorized:** B4 execution, any Production connection or SQL, grants or revocations, credential changes, Vercel changes, deployments, merges, B5/B6.
- **The Production merge freeze remains ACTIVE.**

Prepared 2026-11-11. All artifacts below are **DRAFTS**, unexecuted against Production. They were tested only on a throwaway local PostgreSQL 16.14 cluster.

---

## 1. Executive summary

- **Grant set:** the approved §11.2/§11.5a grant set is **unchanged** (5 statements). It is sufficient for the application's runtime database use.
  - Runtime access goes only through `apps/web/lib/db.ts` (raw SQL via `pg`).
  - It needs DML on the 24 app tables plus PUBLIC-default function, type, schema and database access.
  - Two default-privilege rules in the baseline are **not needed today** (decisions D-2 and D-3).
- **The existing B4 procedure does not provide the guarantees this ticket requires.** It was given only in conversation (§7 transcript, "Safeguard 1") and is recorded in no file.
  - It is a hand-typed transaction with **no assertions before COMMIT**.
  - Its G2 checks run **after** COMMIT.
  - A `GRANT` that grants nothing raises only a **WARNING**, so it would still commit.
  - It is **replaced** by a hash-pinned, file-driven design. The same five statements run inside one transaction, bracketed by fail-closed baseline and post-grant assertions, and COMMIT runs only if every assertion passes (§7).
- **PostgreSQL 17 `MAINTAIN` (B3 residual R3) is covered without version-specific syntax.**
  - The plan asserts no membership (including `pg_maintain`), no ownership, an exact direct ACL, and no `PUBLIC` ACL entry of any kind on `public` relations.
  - It uses no `has_table_privilege('MAINTAIN')` call.
- **All B3 residuals R2–R7 are addressed by enforced assertions.**
- **R0 (the accepted clipboard exception) becomes material with B4.** B4 turns a possibly exposed app password from login-only into DML on all app data, through a path independent of the `neondb_owner` exposure. **Decision D-1 is therefore a precondition of B4 execution authorization** (§5, review P1-1).
- **Draft tests:** **48 local runs** on the final logic, all behaving as designed. That includes 22 perturbation STOPs, rollback on a post-grant assertion failure, rollback when the process is killed before COMMIT, no blocking of concurrent application traffic, positive-evidence state classification (including missing include files), the compensating revoke, and 8 launcher dry runs.
- **Not empirically tested:** PostgreSQL **17** semantics (no local PG17; decision D-4).
- **Recommendation: CONDITIONAL GO** (§13).

## 2. B3 closure reference

- B3 is **PASS, CLOSED WITH ACCEPTED SECURITY EXCEPTION** (`AURA_GOV_02_I0_C_EXECUTION_EVIDENCE.md` §7.23). It is not reopened.
- Carried-forward baseline for `aura_app_2026_11`:
  - database `neondb`, PostgreSQL 17.11;
  - 25 `public` tables;
  - 0 owned objects (checked categories);
  - 0 outgoing memberships;
  - exactly 1 incoming membership (`neondb_owner`, ADMIN t / INHERIT f / SET f, grantor 10);
  - 0 direct grants.
- Residuals R0–R7 are listed in §7.21–7.23.

## 3. Grant matrix (baseline §11.2 / §11.5a, unchanged)

**Sources verified:**
- `AURA_GOV_02_I0_C0_ROTATION_EXECUTION_PLAN.md` §11.5a (grant transaction) and §11.5b (G2 SQL).
- Preflight §5a Q0–Q6 results and the Q5 baseline.
- Execution evidence §7.6 (membership baseline).
- Code at `origin/main` `1741a95`:
  - `apps/web/lib/db.ts` (≈198 KB of raw SQL);
  - `lib/planMove.ts` and `lib/dayConstructorAcceptancePersistence.ts`;
  - `prisma/schema.prisma`;
  - 51 migrations.

**Code facts:**
- **Runtime database access:**
  - `lib/db.ts` creates the only runtime pool (`AURA_DATABASE_URL || DATABASE_URL`). SQL is also issued through that pool from `app/api/plans/route.ts`, `lib/remainingDayRecompositionAcceptance.ts`, `lib/planMove.ts` and `lib/dayConstructorAcceptancePersistence.ts`. A grep of `app/` and `lib/` (by the reviewer) finds no additional privilege class.
  - `lib/prisma.ts` and `lib/prisma-db.ts` are **not imported** by any route.
  - `scripts/retention-report.js` is a manual script using `DATABASE_URL`.
- **Statements used:** SELECT, INSERT, UPDATE, DELETE; `FOR UPDATE` ×8 and `FOR SHARE` ×6; `ON CONFLICT … DO UPDATE` ×12; `RETURNING` ×47; `pg_advisory_xact_lock(hashtext($1))` (7 call sites per preflight F9); `clock_timestamp()` and `now()`.
- **Not used:** TRUNCATE, sequences (`nextval`/`setval`), `LOCK TABLE`, temp tables, COPY, LISTEN/NOTIFY, `SET ROLE`, or any `pg_catalog` query.
- **Migrations** create 24 app tables (21 `CREATE TABLE` plus 3 `CREATE TABLE IF NOT EXISTS`) and 1 enum (`PlannedActivitySchedulingMode`).
  - No sequences, SERIAL, views, functions, triggers, extensions, policies or grants.
  - All ids are text.
  - 24 app tables plus `_prisma_migrations` = **25**, matching B3.

| # | Statement | Scope | Privilege | Application need (evidence) | Runtime-necessary | Narrowable? | Escalation risk | Verified by |
|---|---|---|---|---|---|---|---|---|
| G-1 | `GRANT USAGE ON SCHEMA public` | schema `public` | USAGE | name resolution for every query | Yes. Already effective via the PUBLIC default (Q1); the explicit grant survives a future PUBLIC revoke | No | None (lookup only; no CREATE) | POST-4, C-8a, C-7b |
| G-2 | `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` | 25 tables (24 app + `_prisma_migrations`) | S/I/U/D | SELECT plus `RETURNING`; INSERT; UPDATE (also required for `FOR UPDATE`/`FOR SHARE` and `ON CONFLICT DO UPDATE`); DELETE | Yes | Per-table narrowing is possible in principle. A static scan suggests some tables are insert/select-only (e.g. `ProductEvent`, `VisitLog`). **Not proposed:** the scan is heuristic, and a wrong narrowing breaks Production writes. Deferred to GOV-02-I3 with tests (D-5) | None beyond DML. No TRUNCATE/REFERENCES/TRIGGER/MAINTAIN. FK actions run as the table owner. **Note:** UPDATE/DELETE let a holder take explicit `LOCK TABLE` locks up to ACCESS EXCLUSIVE (an inherent DoS capability; the same as the current `neondb_owner` app credential; P3) | POST-1b, POST-2a, POST-3a/3c |
| G-3 | `REVOKE ALL ON public."_prisma_migrations"` | 1 table | removes G-2's grant there | the app never reads migration history | n/a (removal) | n/a | Reduces risk | POST-2a (no entry), POST-3b |
| G-4 | `ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT S/I/U/D ON TABLES` | future tables `neondb_owner` creates in `public` | S/I/U/D | **not needed today**. It makes tables created by future migrations usable without a manual grant | No (operational convenience) | Could be dropped in favour of per-migration grants (D-2) | Any **future** table `neondb_owner` creates in `public` is auto-granted, including an internal or sensitive one, or a re-created `_prisma_migrations` | POST-5 |
| G-5 | `ALTER DEFAULT PRIVILEGES … GRANT USAGE, SELECT ON SEQUENCES` | future sequences | USAGE, SELECT | **not needed:** no sequences exist and all ids are text | No | Least privilege favours removal (D-3; needs separate approval) | Low (`nextval`/`currval` on future sequences) | POST-5 |

**Assessed and intentionally NOT granted (state asserted before and after):**

| Area | Expected | Source | Assertion |
|---|---|---|---|
| Database CONNECT | true via PUBLIC (Q4) | default | C-8a; C-7c (`PUBLIC` exactly CONNECT, TEMPORARY) |
| Database CREATE | false | default | C-8a |
| Database TEMPORARY | true via PUBLIC. **Accepted P3** (§11.5b, deferred to I3); the app creates no temp objects | default | C-7c (exact PUBLIC set) |
| Schema `public` CREATE | false (PG15+ default; Q1/Q3) | default | C-8a, C-7b |
| Function EXECUTE | `pg_advisory_xact_lock(bigint)`, `hashtext(text)`, `now()`, `clock_timestamp()` true via PUBLIC (Q6) | default | C-8a |
| Type USAGE | enum `PlannedActivitySchedulingMode` USAGE true via PUBLIC | default | C-8b |
| Sequences | none exist | inventory | C-6b (none of relkind `S` in `public`) |
| Ownership | none | — | C-5 (`pg_shdepend` owner deps = 0, **all databases**) |
| Memberships | 0 outgoing; exactly the approved incoming row | — | C-3, C-4 |
| PG17 MAINTAIN | none (owner, direct, PUBLIC or `pg_maintain`) | — | C-3, C-5, C-7a, PRE-1, POST-1/2 |
| `neon_auth` | no USAGE; no reachable relation | — | C-9a, C-10 |
| SECURITY DEFINER routines outside system schemas | none executable | — | C-9b |

## 4. PostgreSQL 17 security assessment

**B4-S1: PUBLIC `MAINTAIN`**
- **Semantics:** PG17 `MAINTAIN` permits VACUUM, ANALYZE, CLUSTER, REFRESH MATERIALIZED VIEW, REINDEX and `LOCK TABLE` in any mode. That is an availability risk (ACCESS EXCLUSIVE locks, rewrites), not data access.
- **Sources of effective `MAINTAIN` on a relation:** ownership; a direct ACL entry; a `PUBLIC` ACL entry; or membership (including predefined `pg_maintain`, and any role holding it).
- **Zero direct grants does not imply zero effective privilege.** The design therefore asserts every source:
  - no membership at all, direct or indirect (C-3; covers `pg_maintain`);
  - no ownership in any database (C-5);
  - **no `PUBLIC` ACL entry of any kind** on any `public` relation or column, computed from `coalesce(relacl, acldefault(...))` so implicit defaults are included (C-7a). This catches PUBLIC `MAINTAIN`;
  - direct ACL exactly `{SELECT,INSERT,UPDATE,DELETE}` per app table, nothing on `_prisma_migrations` (POST-2a), and a pre-grant shared-dependency count of zero (PRE-1).
- **PG17-native check as well (C-11, review P2-1):** on PG ≥17, `has_table_privilege(role, rel, 'MAINTAIN')` must be false for **every** non-system relation, in any schema. It's guarded by a nested `IF server_version_num >= 170000`, so it is a no-op on the PG16 test cluster (plpgsql plans the inner query lazily; verified by the reviewer). On Production it is the authoritative check. The ACL-based route (above) is the equivalent, testable cross-check.
- **Supersession:** POST-1…POST-5 plus C-1…C-12 **supersede §11.5b step 3a items 1–10** (memberships, attributes, ownership, `_prisma_migrations`, the 24 app tables, the all-schema census, schema/database/function privileges, `neon_auth`, SECURITY DEFINER, default ACLs). Each 3a item maps to an equal or stricter assertion. §11.5b **step 3b** (the authenticated probe) remains the separate **B5** gate.
- **Baseline expectation:** Q2 showed `MAINTAIN` only for the owner on `_prisma_migrations` (PG17 owner default). `GRANT … ON ALL TABLES` lists S/I/U/D explicitly, so it cannot confer `MAINTAIN`.

**B4-S2: displayed-only values are now enforced**

| Value | Pre-B4 | Post-B4 | Assertion |
|---|---|---|---|
| `schema_usage` | t (PUBLIC) | t (PUBLIC + direct) | C-8a; POST-4 (direct USAGE exact) |
| `db_connect` | t (PUBLIC) | t | C-8a |
| `db_temp` | t (PUBLIC; accepted P3) | t | C-7c (PUBLIC set exactly CONNECT, TEMPORARY) |
| `schema_create` / `db_create` | f | f | C-8a, C-7b |

**B4-S3: object inventory (re-validated at execution, before and after the grants, in the same transaction)**
- **C-6a:** the `public` table set must equal the exact 25 names (C-collation, order-independent).
- **C-6b:**
  - every table owned by `neondb_owner`;
  - **zero** sequences, views, materialized views, foreign tables, composite types or partitions in `public`.
- **C-6c:** the enum set is exactly `{PlannedActivitySchedulingMode}`, owned by `neondb_owner`. No domains, ranges or other user base types.
- **C-6d:** zero routines in `public`.
- **Any difference means STOP and rollback.** A changed inventory means the grant snapshot (`ON ALL TABLES`) and the expectations no longer match.

**C-12 (review P3-1):** the database is owned by `neondb_owner`, and `neondb_owner` holds `USAGE WITH GRANT OPTION` on schema `public` (via `pg_database_owner`). Without these, `GRANT USAGE ON SCHEMA public` would only WARN. The state gate now detects this before an authorized grants run.

**C-9b refinement (review P3-2):** a SECURITY DEFINER routine counts only if the role also has USAGE on its schema, so it is actually callable. This avoids false STOPs from Neon-installed routines in schemas the role can't use.

**B4-S4: membership and ownership are re-verified inside the B4 session.** Decision: **yes, both before and after the grants, in the same transaction** (C-3, C-4, C-5). Rationale:
- the grants are authored by `neondb_owner`, whose ADMIN-only incoming membership is the approved baseline;
- any drift since B3 (an added option, another member, an outgoing membership) must block the grants, not be discovered afterwards;
- the check costs nothing.

The plan changes **no** membership or ownership.

## 5. Residual-risk disposition (R0–R7)

| Residual | Disposition in B4 |
|---|---|
| **R0** (accepted clipboard/Handoff exception, B3 runs 2–3) | **Carried forward; not reinterpreted as a control.** See the analysis below. Decision **D-1** is required before Phase C. |
| R1 (attestation-only B3 evidence) | B4 evidence is **deterministic markers** printed by the files (`B4 … PASS`, `B4 STOP: <id>`, `B4 RESULT: …`, `B4 STATE: …`, `B4 PSQL EXIT CODE: n`) and pasted by the owner. Nothing relies on inspecting raw rows. |
| R2 (ungated `schema_usage`, `db_connect`, `db_temp`) | **Resolved:** enforced (B4-S2). |
| R3 (PUBLIC `MAINTAIN`) | **Resolved:** B4-S1. |
| R4 (ownership checked only for 4 catalogs, current database) | **Resolved:** C-5 uses `pg_shdepend` owner dependencies across **all databases and object classes**. PRE-1 and POST-1 also bound every ACL or policy dependency on the role. |
| R5 (endpoint equality attested) | B4 uses the **direct** host. The connect script prints the endpoint ID, and C-1 rejects a pooler host. The owner attests that it equals B1/B2. |
| R6 (Vercel not re-queried) | B4 changes nothing in Vercel. The Phase C gates are unchanged. |
| R7 (banner not pasted) | B4 runs psql non-interactively (`-f`): no banner or version notice. `\conninfo` prints the TLS line. |

**R0 analysis (corrected after review P1-1):**
- **Scope:** the possible transient presence of the `aura_app_2026_11` password on the macOS pasteboard and, if enabled, Universal Clipboard during and between B3 runs 2–3. No third-party clipboard manager. **Exposure not demonstrated; isolation not verified.** It is an accepted exception, not a control.
- **Impact today (no grants):**
  - login;
  - catalog reads;
  - connection-slot use;
  - **through PUBLIC EXECUTE, holding `pg_advisory_lock`/`pg_advisory_xact_lock` on the app's predictable keys** (e.g. `hashtext('day-constructor-accept:<userId>')`) to block application writes for a user.
- **Impact after B4:**
  - SELECT/INSERT/UPDATE/DELETE on all 24 app tables, including `User` (emails), `AuthCode` (sign-in codes) and `PushSubscription` (endpoints and keys);
  - explicit `LOCK TABLE` up to ACCESS EXCLUSIVE.
  - Neon's Hobby plan has no IP allow-list.
- **Why B4 changes the R0 decision:**
  - The exposed `neondb_owner` credential dominates the app role, so B4 does not raise the **worst-case** impact before Phase F.
  - But an adversary who obtained **only** the app password (a different leak path: pasteboard/Handoff) goes from login-only to full DML on application data. That is a **second, independent path** to the data.
  - The owner's acceptance in evidence §7.23 explicitly relied on "the role had no privileges at the time". **B4 removes that premise.**
- **Required control (review P1-1, adopted):** **D-1 must be decided before B4 execution is authorized.**
  - **Recommended: rotate before B4.** Run a separately authorized B2-B + B3 repeat with clipboard managers and Handoff **off continuously** from copy to `pbcopy`. The role is unused either way, so the cost is the same as rotating later, and it removes the exposure window entirely.
  - **Alternative: accept.** The B4 execution authorization must then **re-accept R0 explicitly for the post-B4 privilege state.**

## 6. Pre-execution verification requirements (for a future, separately authorized execution)

1. **Authorization:** the owner states, explicitly, "Authorize B4 execution", naming this plan and the file hashes (§7.1), **and records the D-1 outcome**: either rotation completed (B2-B + B3 PASS after this plan) or an explicit re-acceptance of R0 for the post-B4 state.
2. **Freeze and state:** the freeze is active; no Production deployment or migration is in progress (prevents C-6 inventory races); `main` = `1741a95` or a documented successor with **no new migrations**.
3. **Owner preflight (as B3):**
   - `unset HISTFILE`;
   - clipboard managers and Handoff **off for the whole session**, with `pbcopy </dev/null` before and after;
   - `no_pgpass`; `env_clean`; `/opt/homebrew/bin/psql --version` gives 16.14.
4. **Files:**
   - copy the 6 SQL files into `~/aura-b4/` and check their hashes;
   - copy the connect script and check its hash;
   - make the run copy by editing **line 2 only** (direct host). The `diff` must show only `2c2`, and only `3c3` when switching MODE to `grants`.
5. **Credential:** the `neondb_owner` password, typed only at psql's hidden prompt. (This is the already-exposed credential reset in Phase F; no new credential is created.)
6. **Read-only gate first:** run with `MODE='state'` (the session also sets `default_transaction_read_only = on`). **The exact expected transcript (deterministic; review P2-2):**

   ```
   B4 GUARD: OK endpoint=ep-… mode=state
   B4 SETTINGS LOADED
   SET
   You are connected to database "neondb" as user "neondb_owner" on host "ep-…" … SSL connection (protocol: TLSv1.3 …)
   BEGIN / DO / B4 COMMON ASSERTIONS: PASS / DO / B4 PRE-GRANT BASELINE: PASS / ROLLBACK
   BEGIN / DO / B4 COMMON ASSERTIONS: PASS
   ERROR:  B4 STOP: POST-1b ACL dependency set differs        <- the ONE permitted ERROR in state mode (post-state not present)
   ERROR:  current transaction is aborted, commands ignored until end of transaction block   <- its consequence
   ROLLBACK
   B4 STATE: NOT_APPLIED - exact B3 baseline
   B4 STATE END
   B4 PSQL EXIT CODE: 0
   ```

   - Classification uses **positive evidence flags**: each assertion block sets a flag only on its last line. A missing or failed include therefore **cannot** produce `NOT_APPLIED` (tested: missing common, pre or settings files all give `INCONSISTENT`).
   - **Any other ERROR, a different STOP id, or a different `B4 STATE` line means STOP**, and `grants` mode is not run.

## 7. Transaction-safe procedure (DRAFT; reviewed design; unexecuted)

### 7.1 Artifacts

These are in the scratchpad: `/private/tmp/claude-501/-Users-stephen-Desktop-Claude-auraschedule-math-core/b1121d49-418e-41ef-a69a-ffd7ecb8d667/scratchpad/b4/`.
- **The scratchpad is temporary.** Copy the files somewhere durable before any reboot.
- **Final hashes** (after the §11 fixes):

| File | Lines | sha256 |
|---|---|---|
| `b4_settings.sql` | 27 | `f1ffb0ff428c7c23aa7258a2cef6a0733eb9a86fb794b46e3d358cd70dec6a95` |
| `b4_assert_common.sql` | 132 | `643f0b5971d5c51fd9d0a1f5de58ee80fcb8261862305f2402246c1dc74566c3` |
| `b4_assert_pre.sql` | 30 | `b2e2f6720c51a5641fec91242cfd4bb164a0393d0bdc945466285e08d61cebfc` |
| `b4_assert_post.sql` | 84 | `aea3371267a323c19201ea3c0e65267a8446e8f30b5dbb3ac64e294f1270d478` |
| `b4_state.sql` | 30 | `d1f1e67883d35e67de4e209aa319aef3a1094fdb782a6e8505321b580fc37c98` |
| `b4_grants_DRAFT.sql` | 28 | `62a17842d3f97f454e8e015051bd69e8a803962e9d5742b4cf37bf2934501bd4` |
| `b4_revoke_DRAFT.sql` | 22 | `ca05915c50725cfc4223c282dc88118f63dc5b57038a54e09d0ea17577689eb8` (**not** in the launcher's hash list; separate authorization only) |
| `b4_connect_DRAFT.zsh` | 21 | `5bf47d499ed3f07a737475cd419fda3a2b8cc5b138774e38c12294b89cfe3fd1` (embeds the first six hashes) |

| File | Role |
|---|---|
| `b4_settings.sql` | **single source of expectations** (lines 1–8): role, owner, database, `server_version_num`, direct-host regex, the 25 table names, the enum name, the 11-row default-ACL baseline. Also sets psql safety options and loads the values into session settings for the assertion blocks |
| `b4_assert_common.sql` | invariants that must hold before **and** after (C-0…C-10) |
| `b4_assert_pre.sql` | common + exact B3 baseline (PRE-1…PRE-3) |
| `b4_assert_post.sql` | common + exact post-grant state (POST-1…POST-5) |
| `b4_grants_DRAFT.sql` | the transaction (below) |
| `b4_state.sql` | read-only classifier: `NOT_APPLIED` / `APPLIED` / `INCONSISTENT` |
| `b4_revoke_DRAFT.sql` | compensating revoke (separate authorization only) |
| `b4_connect_DRAFT.zsh` | guarded launcher: direct-host guard, MODE guard (`state`/`grants` only; revoke deliberately excluded), **checks all six SQL hashes before connecting**, verified TLS and channel binding, `psql -X -n -f`, prints the exit code |

### 7.2 `b4_grants_DRAFT.sql` flow

1. `ON_ERROR_STOP on`, `ON_ERROR_ROLLBACK off`, `AUTOCOMMIT on`. Any error ends psql (exit 3). The server then rolls back the open transaction when the connection closes. **No human ROLLBACK step exists.**
2. `\conninfo` (evidence: host, user, TLS).
3. `BEGIN`; `SET LOCAL lock_timeout='5s'`, `statement_timeout='60s'`, `idle_in_transaction_session_timeout='120s'`; assert the transaction isn't read-only.
4. **Phase 1:** `b4_assert_pre.sql`, the identity check and the full baseline, **inside the transaction**.
5. **Phase 2:** the five approved statements, echoed. Identifiers are bound from `b4_settings.sql` (`:"exp_role"`, `:"exp_owner"`); the text is otherwise identical to §11.5a.
6. **Phase 3:** `b4_assert_post.sql`, the exact resulting privilege state, **before COMMIT**. This catches `GRANT`'s "no privileges were granted" WARNING case and any concurrent change.
7. **Phase 4:** `COMMIT`. **This is the irreversible point.** After the server acknowledges it, only a compensating REVOKE can undo the grants.
8. **Phase 5:** a new `READ ONLY` transaction re-runs the post assertions against the committed state; `ROLLBACK`.
9. Prints `B4 RESULT: COMMITTED AND VERIFIED`. The launcher then prints `B4 PSQL EXIT CODE: 0`.

### 7.3 Evaluation against the ticket's requirements

| Requirement | Met by |
|---|---|
| Intended endpoint and admin identity | launcher host guard + C-1 (`session_user`/`current_user` = `neondb_owner`, database `neondb`, `server_version_num` 170011, not in recovery, direct non-pooler host) |
| Database identity before grants | Phase 1 runs before Phase 2 |
| Target role and baseline | C-2…C-5, PRE-1…PRE-3 |
| Fail closed on unexpected privileges or inventory | C-6, C-7, C-10, PRE-1/3 raise `B4 STOP: <id>`, so psql exits and the transaction is aborted |
| Only the approved grant set | Phase 2 is exactly the five statements; POST-1b/2a/4/5 prove nothing else changed |
| Verify before COMMIT | Phase 3 |
| Roll back on any failed assertion | `ON_ERROR_STOP` + transaction; tested (t1, t2) |
| No partial grants | a single transaction; tested by an injected post-grant failure (t1: state `NOT_APPLIED` afterwards) |
| Preserve existing application access | the app still uses `neondb_owner` (no `AURA_DATABASE_URL`). B4 touches only the new role's ACL entries. Tested: concurrent application reads and writes are **not blocked** during an open B4 transaction, and B4 does not wait on application locks (t3a–c) |
| Sanitized evidence | markers and `\conninfo`; no row data; no secrets |

**Measured lock behaviour (author and reviewer, PG16):**
- GRANT takes **no relation lock**. It didn't wait behind an application ACCESS EXCLUSIVE holder.
- It **does** wait on uncommitted DDL that touched the same `pg_class` row; `lock_timeout` 5 s then fires, giving exit 3 and `NOT_APPLIED`.
- Manual or auto ANALYZE on a granted table waits until B4 commits (about 4.5 s measured).
- Application SELECT, INSERT, `FOR UPDATE` and DELETE were **not blocked** during an open B4 transaction.

**Version pin:** `exp_vnum` 170011 will false-STOP (C-1) after a Neon minor update. **Pre-decided handling:** STOP; then update line 4 of `b4_settings.sql` (and re-hash the launcher), with a focused review limited to that change.

**Why the earlier procedure was insufficient:**
- manual typing (risk of paste mangling, as in B2-B attempt 1);
- no in-transaction baseline;
- G2 after COMMIT;
- a WARNING-only failure mode would still commit;
- rollback depended on a human noticing.

The **five statements themselves are unchanged**.

## 8. Post-grant verification matrix (all enforced by assertions; none by eye)

| Area | Pre-B4 expected | Post-B4 expected | ID |
|---|---|---|---|
| Database identity | `neondb`, primary, direct host | same | C-1 |
| Role identity (session) | `neondb_owner` | same | C-1 |
| PostgreSQL version | `server_version_num` 170011 | same | C-1 |
| Role attributes | LOGIN, INHERIT, conn limit −1, no validity/config; no SUPER/CREATEROLE/CREATEDB/REPLICATION/BYPASSRLS | unchanged | C-2 |
| Memberships | 0 outgoing; exactly 1 incoming `neondb_owner` t/f/f grantor 10; reverse t/f/f; `createrole_self_grant` empty | unchanged | C-3, C-4 |
| Ownership | 0 in all databases | 0 | C-5 |
| Table inventory | exactly the 25 names, all owned by `neondb_owner`; no other relation kinds; 1 enum; 0 routines | unchanged | C-6 |
| PUBLIC privileges | none on `public` relations or columns (incl. MAINTAIN); schema = USAGE; database = CONNECT, TEMPORARY; no PUBLIC default ACL | unchanged | C-7 |
| Schema privileges (role) | USAGE (PUBLIC), no CREATE | + direct USAGE (not grantable, granted by the schema owner) | C-8a, POST-4 |
| Table privileges (role) | none anywhere | exactly S/I/U/D on each of 24 app tables, grantor `neondb_owner`, not grantable; none on `_prisma_migrations`; no column ACLs; reachable relations = 24 | PRE-3, POST-2, POST-3 |
| Sequence and function privileges | functions via PUBLIC; no sequences | unchanged | C-6b, C-8a |
| Direct ACL dependencies (`pg_shdepend`) | **0** | exactly 24 tables + `public` + 2 default-ACL rows, only in `neondb`, ACL type only | PRE-1, POST-1 |
| Default ACLs | exactly the 11-row Q5 baseline | baseline + exactly 6 rows (`neondb_owner`/`public`: tables S/I/U/D; sequences USAGE/SELECT) | PRE-2, POST-5 |
| CREATE | none | none | C-8a |
| Isolation | no `neon_auth`; no SECURITY DEFINER; nothing outside `public` | unchanged | C-9, C-10 |
| Runtime access | n/a | sufficient for every statement class in §3 (DML, locking reads, upsert, RETURNING, advisory lock, enum) | POST-3a, C-8 |
| Transaction outcome | — | `B4 RESULT: COMMITTED AND VERIFIED` + exit 0; independently `B4 STATE: APPLIED` | Phase 5, `b4_state.sql` |

## 9. Rollback and recovery plan (no recovery SQL may run under this ticket)

| Situation | What happens | Owner action | Verified by |
|---|---|---|---|
| Error or failed assertion **before COMMIT** | psql exits 3; server aborts the transaction | none (automatic); report the `B4 STOP: <id>` line | run `MODE=state` → `NOT_APPLIED` |
| Failure during post-grant verification (Phase 3) | same, before COMMIT | same | same (tested t1) |
| Unexpected role privileges found at baseline | STOP at C-*/PRE-*, no grants | report; investigate under a new ticket | `NOT_APPLIED`, or `INCONSISTENT` if drift pre-exists |
| Connection interruption before COMMIT | server aborts on disconnect; idle-in-transaction timeout 120 s as a backstop | none | `MODE=state` → `NOT_APPLIED` (tested t2, kill -9) |
| **Uncertain outcome** (the connection drops while COMMIT is in flight) | committed or not, atomically | **do not re-run grants**; run `MODE=state` | `APPLIED` → treat as committed and run Phase-5-equivalent evidence; `NOT_APPLIED` → nothing happened (re-run needs fresh authorization); `INCONSISTENT` → STOP |
| Failure in Phase 5 (committed but re-verification fails) | grants committed | STOP; no further action | `MODE=state` output; then the compensating revoke **only with separate authorization** |
| Problem discovered after commit | grants in place; the app is unaffected (still on `neondb_owner`) | separately authorized `b4_revoke_DRAFT.sql`: one transaction; REVOKE ALL on tables, sequences and schema, plus both default-ACL rules; asserts the **exact B3 baseline before COMMIT** | `B4-R RESULT: REVOKED AND BASELINE VERIFIED`; `MODE=state` → `NOT_APPLIED` (tested r1, r3, r5) |

**Transaction rollback versus post-commit revocation:**
- **Rollback** is automatic, leaves no trace and needs no authorization.
- **Revocation** is a new, committed change. It requires its own authorization and its own evidence.
- B4's availability blast radius is nil either way until Phase C, because the application doesn't use the role yet.

## 10. B5/B6 dependencies

**What a successful B4 would establish:**
- the role's exact least-privilege ACL state, proven before and after commit by the same assertions;
- the default-ACL rows;
- that inventory and isolation are unchanged.

**What it would not establish (later gates; each needs separate authorization):**
- **B5:** authenticated probe **as** `aura_app_2026_11` over the pooler (§11.5b step 3b): `SELECT count(*) FROM "User"` succeeds; `_prisma_migrations` is denied (run alone and last); the advisory lock works.
- **B6:** formal default-privilege comparison (17 rows). POST-5 already enforces it, but the B6 gate remains as defined.
- **Application compatibility:** not proven by grants alone. It's proven by the D2 go-live probes (§11.4: magic-link sign-in read/write, `/moment/<nonexistent>`, `pg_stat_activity` attribution).
- **Credential switch:** B4 does **not** authorize `AURA_DATABASE_URL` (Phase C) or D2. Production traffic stays on the current `neondb_owner` credential until separately authorized.
- **Other dependencies noted:**
  - (a) migrations at build time must keep using `DATABASE_URL` (`neondb_owner`); the app role cannot run DDL;
  - (b) `lib/prisma.ts` reads `DATABASE_URL`; it's unused at runtime today, and if ever wired it would bypass `AURA_DATABASE_URL`;
  - (c) `scripts/retention-report.js` uses `DATABASE_URL` (manual);
  - (d) the daily cron route uses `lib/db.ts`, so it is covered.
- **Milestone order unchanged:** B4 → B5 → B6 → Phase C (with D-1) → D → E → F.

## 11. Independent security review

**Fresh independent review: CONDITIONAL GO. No P0.** The grant set is correct and sufficient. The transaction design fails closed on every error path tested.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| P1-1 | P1 | R0 analysis unsound: B4 makes the app password a second, independent path to DML on app data; R0 acceptance (§7.23) rested on "no privileges". The today-impact also omitted advisory-lock DoS | **Adopted:** §5 rewritten; **D-1 is now a precondition of B4 execution authorization** (recommended: rotate before B4) |
| P2-1 | P2 | PG17-native MAINTAIN never evaluated; C-10 omitted MAINTAIN; disposition of §11.5b 3a unstated | **Fixed:** C-11 (nested version guard; a no-op on 16); supersession of 3a stated (§4) |
| P2-2 | P2 | State gate output not deterministic; classifier inferred PASS from no-error; a missing `\ir` did not set `:ERROR` (a false `NOT_APPLIED` was demonstrated) | **Fixed:** positive evidence flags; exact transcript documented (§6.6); missing common/pre/settings now give `INCONSISTENT` (tested) |
| P3-1 | P3 | State gate couldn't detect that the admin can't grant on `public` | **Fixed:** C-12 (tested n22) |
| P3-2 | P3 | C-9b false STOP for SECURITY DEFINER routines in unusable schemas | **Fixed:** requires schema USAGE (tested n14 STOP / n14b PASS) |
| P3-3 | P3 | Version pin false-STOP | Handling pre-decided (§7) |
| P3-4 | P3 | Lock nuances | Documented (§7) |
| P3-5 | P3 | Code inventory incomplete; advisory-lock count | Corrected (§3) |
| P3-6 | P3 | Launcher didn't scrub `OPENSSL_*`, `PGSYSCONFDIR`, `DYLD_*` | **Fixed:** added, plus `unset -m 'DYLD_*' 'OPENSSL_*'` (dry run: 0 such variables reach psql) |
| P3-7 | P3 | State mode should enforce read-only | **Fixed:** `SET default_transaction_read_only = on` in `b4_state.sql` (no dependency on proxy `options`) |
| P3-8 | P3 | Pin the revoke hash | Pinned (§7.1) |
| P3-9 | P3 | "Pager usage is off." printed | **Fixed** (QUIET around `\pset`) |

**Verified fine by the reviewer:**
- **Sufficiency**, exercised as the app role: advisory lock + `hashtext`, `ON CONFLICT DO UPDATE … RETURNING`, enum literal and cast, `FOR SHARE OF`, `FOR UPDATE`, `UPDATE`/`DELETE … RETURNING`, `now()`, `clock_timestamp()`.
- **Denials:** TRUNCATE, `_prisma_migrations` and CREATE are denied. TEMP and `LOCK TABLE` are allowed (both P3).
- **Excess-privilege decisions** recorded (G-4, G-5, D-5).
- **Escalation paths** closed: ADMIN direction, no routines in `public`, `cloud_admin` defaults unreachable, PUBLIC fully asserted.
- **MAINTAIN equivalence** for `public` relations.
- **PG17 catalog behaviour:** `acldefault('r')` owner-only, including `m`; `aclexplode` emits MAINTAIN; `defaclobjtype` `r`/`S`; unquoted `regrole`/`regnamespace`; the schema-grant grantor is `pg_database_owner` = `nspowner`.
- **No path reaches COMMIT after an error:** nested `\ir` with `ON_ERROR_STOP`; an injected failure; a terminated backend (exit 2, no reconnect); a concurrent CREATE TABLE (C-6a).
- **Launcher:** host/MODE/hash guards; exit-code propagation; fails closed under bash.
- **Evidence:** contains no secrets.

**Re-test after the fixes (author, PG16 throwaway cluster, now stopped):**
- core 6;
- negatives n1–n22 including the new n14b and n22 (23 runs, all with the expected STOP id from the true baseline, or PASS for n14b);
- missing-include mi1–mi4 (all `INCONSISTENT` / exit 3);
- transaction t1, t2, t3a, t3c, t5, r5, plus the revokes r1/r2;
- launcher dry runs ×8.

## 12. Outstanding decisions

| ID | Decision | Recommendation |
|---|---|---|
| **D-1** | **R0 (precondition of B4 execution authorization):** rotate `aura_app_2026_11` **before B4** (B2-B + B3 repeat, continuous clipboard isolation), **or** explicitly re-accept R0 for the post-B4 privilege state | **Rotate before B4** (same cost as later; removes the exposure window before the role gains data access) |
| D-2 | Keep G-4 (default table grants for future `neondb_owner` tables) | Keep (baseline; avoids migration-time breakage). Future migrations must be reviewed knowing new tables are auto-granted |
| D-3 | Keep G-5 (default sequence grants; currently unused) | Optional removal for least privilege. **Any change needs separate approval** and re-hashing; B4 as drafted keeps it |
| D-4 | Empirical PostgreSQL 17 test of the drafts (`brew install postgresql@17` locally, a download) | Recommended before execution authorization. PG16 testing doesn't exercise PG17 catalogs (`MAINTAIN` bits, the Neon build) |
| D-5 | Per-table privilege narrowing | Defer to GOV-02-I3 with integration tests |
| D-6 | PUBLIC TEMPORARY on the database | Remains accepted P3 (I3) |

## 13. GO/HOLD recommendation

**CONDITIONAL GO: READY FOR B4 EXECUTION AUTHORIZATION REVIEW once these conditions are met:**
1. **D-1 decided by the owner** (precondition): rotation before B4 (recommended; separately authorized B2-B + B3), or explicit re-acceptance of R0 for the post-B4 state.
2. **D-4 recommended:** the owner approves a local PostgreSQL 17 install (`brew install postgresql@17`, a download). The drafts then get re-run against PG17 catalogs before execution. Otherwise the first PG17 exercise is the read-only `MODE=state` gate on Production, whose failure mode is a STOP, not a change.
3. D-2 and D-3 acknowledged (the drafts keep the §11.2 baseline unchanged).
4. The drafts are copied out of the temporary scratchpad and re-hashed against §7.1.

- **No unresolved P0/P1 planning defects remain.** P1-1 is resolved by making D-1 a precondition.
- **The exact next authorization required:**
  - **(a)** the D-1 decision, and if "rotate", a separately authorized B2-B + B3 repeat;
  - **(b)** optionally, the D-4 local PG17 install;
  - **(c)** then "Authorize B4 execution" naming this plan, the §7.1 hashes and the D-1 outcome. The first execution step is the read-only `MODE=state` gate.
- **B4 execution remains HOLD. B5/B6 remain HOLD. The Production merge freeze remains ACTIVE.**
