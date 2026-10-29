# AURA-GOV-02-I0-C: B2-B-R / B3-R Application-Role Rotation and Revalidation Plan

**Status:** PREPARATION AND PLANNING ONLY. Local and uncommitted; contains no secret values.
- **Owner decision D-1 (2026-11-11):** "Rotate the application role password before B4."
- **Not authorized:** any Production connection, credential rotation, SQL execution or software download.
- **B4, B5 and B6 remain HOLD. The Production merge freeze remains ACTIVE.**

## 1. Summary

- **Scope:** rotate **only** `aura_app_2026_11`, then revalidate pooled authentication and the exact pre-B4 baseline.
- **Production unchanged:** the application keeps its current `neondb_owner` store credential, and no Vercel value changes.
- **No human ever sees, copies or types the new password.**
  - A single launcher generates it locally, stores it in the macOS login Keychain as **PENDING** (readback-verified), and hands it to psql only through a private FIFO.
  - psql first passes a **pre-ALTER gate**:
    - the **pinned** direct endpoint;
    - the admin identity and database;
    - server version 17.11;
    - primary (not in recovery);
    - logging settings safe;
    - the role baseline and its single incoming membership.
  - psql then runs `ALTER ROLE` once, and uses the same value for a pooled `\connect` as the application role (verified TLS and channel binding). Over that connection it runs the **unchanged** B3 check file (`19e34d1b…ba1e`).
  - The Keychain item is promoted to **LIVE** only after psql reports `ALTER SUCCEEDED`, **including when the run is interrupted** (exit trap).
  - The only secret a human enters is the **existing** `neondb_owner` password, at psql's hidden prompt. That's the credential already scheduled for reset in Phase F.
- **Tests:**
  - **28 local end-to-end runs** across two design iterations, all behaving as designed, with 0 leaks (output, argv, environment) and no FIFOs or processes left;
  - the database password equals Keychain LIVE after every completed rotation;
  - 3 defects in my own design found and fixed in local testing (§6), plus all independent-review findings applied (§10).
- **Revision (R-2 option (b), D-4): EXECUTION READINESS HOLD; R-2 NOT resolved** (§12–§15). The FIFO transport was replaced by an anonymous stdin pipe after a reproduced hijack. Keychain items are now `-T ''`-restricted (user-mediated). PostgreSQL 17 validation passed.

## 2. Preserved history (unchanged by this plan)

- B2-B PASS (§7.13), B3 run 1 STOP (§7.17), run 2 STOP (§7.18), run 3 and closure **PASS, CLOSED WITH ACCEPTED SECURITY EXCEPTION** (§7.20–7.23), and the R0 acceptance text remain exactly as recorded in `AURA_GOV_02_I0_C_EXECUTION_EVIDENCE.md`.
- New evidence will be added in new sections only.
- **Effect on R0:**
  - PostgreSQL keeps one password per role, so a successful `ALTER ROLE … PASSWORD` invalidates the R0-exposed password **on `main`**.
  - R0 is recorded as **retired** only after the pooled login with the new password succeeds (B3-R PASS), together with a branch inventory showing only `main`.
  - Neon point-in-time history and any later-created branch still carry the old verifier. That's a recorded residual; it's not reinterpreted as a control.

## 3. Design and exposure inventory

**Artifacts** (durable copy in `AURA_GOV_02_I0_C_ARTIFACTS/rot/`, `SHA256SUMS` 27/27 OK; DRAFTS; **revised for R-2/D-4, see §13**):

| File | sha256 | Role |
|---|---|---|
| `rot_run_ROTATE.zsh` | `67067ae4ef0221667a9b61a24e5e6e5e241f9148c2b81906cb7336806ce71ef6` | launcher, MODE=rotate (**run this file unedited**) |
| `rot_run_VALIDATE.zsh` (= `rot_run_DRAFT.zsh`) | `7bb4e5b038df024a717c0a369d3220bc0ce45fb93be1942bd1be3d8d7bac8ecc` | launcher, MODE=validate |
| `rot_run_VALIDATE_PENDING.zsh` | `442495361acd76e78a420768785cb2a10a812f315c24e409e5ab25f9e2792d6d` | launcher, MODE=validate_pending |
| `rot_settings.sql` | `179d0e10b4bdab45fe062f5399c318f0e90f7bec0f7d49e98eab56931e603eec` | pinned host, version, pooled derivation, TLS (+ `gssencmode=disable`) |
| `rot_gate.sql` | `3aa0d889c9396bd5e97931f880039301dc71f64fdabb6647c96e679a977c71fa` | pre-ALTER gate |
| `rot_apply.sql` | `9686ac95ddf527a3f220ce38fc96f118330f40f88a08fd1bc7de8559c736066c` | gate → read → ALTER → validate |
| `rot_validate.sql` | `372c079e0ffa15de2e74f0b7c68c7444213e308bea7e15062de3694c76550340` | gate → read → validate |
| `rot_validate_core.sql` | `0347dfe0adf09fe18559b91bfa0624efe05e9c88fff2780637fba24451f4df2b` | pooled `\connect` + B3 checks |
| `b3_checks.sql` | `19e34d1b61315a7a5ae7ac93ce4e052fecabbabbcbeb38494fcdd05eb2caba1e` | unchanged B3 file |
| `psql16_pins.txt` | `6f4cba69d34eea7f51a486ea69cdf175ce21ffb2834a906eda6cb309be426e99` | sha256 of psql 16.14 and all 10 transitive Homebrew libraries (embedded in the launcher) |
| `r2_verify.zsh` | `8d28dad7079fba6f86b05f6d6d0366c2a3f96cc7eb75655fc4814c194bc4076d` | owner-run Keychain behaviour verification (throwaway keychain, dummy value) |
| `mk_rot.sh` | `a9d632101cf3bbe3c309dfe5916d23d822135704a7a8059a44dad9357f5d32f1` | generator |

`rot_settings.sql` and the launcher pin the Production direct endpoint host. It isn't secret, but don't commit it unmasked.

**Launcher flow:**
1. **Guards:**
   - zsh only;
   - the host charset, and the host must not be a pooler;
   - MODE;
   - working directory;
   - **all six SQL hashes**;
   - **host = the pinned `rot_direct_host`** (exact fixed-string match).
2. **rotate mode:**
   - **refuses to start if a PENDING item exists** (an unresolved earlier run);
   - generates 40 `[A-Za-z0-9]` (all classes, no triple repeats, about 238 bits);
   - stores it via `security -i` **with the command on stdin** (argv is only `security -i`);
   - reads it back into a shell variable and compares. Any failure means nothing is sent.
3. **validate / validate_pending:** load LIVE / PENDING from the Keychain and validate it.
4. **FIFO setup:** private FIFO (`umask 077`, 0700 directory). A forked background writer holds the copy; the parent's copy is cleared.
5. **Admin session:**
   - `env -i HOME TERM PATH=/usr/bin:/bin PSQL_HISTORY=/dev/null /opt/homebrew/bin/psql -X -n …` **non-interactive** (`-f`), as `neondb_owner` on the pinned direct host, with `verify-full`/`system`/`channel_binding=require`;
   - `-v fifo=<path>`;
   - output tee'd to a temporary file that holds no secret.
6. **SQL:**
   - **gate** (else `ROT GATE: STOP`; nothing is read from the FIFO);
   - `awk` single-line reader (the B2-B guards);
   - `ALTER ROLE`;
   - `ERROR`/`SQLSTATE` capture;
   - `SELECT 1`;
   - then the validation core.
7. **Failure exits:** any failed `\connect` makes non-interactive psql exit, so every copy dies with the process.
8. **Exit trap** (normal exit **or** INT/TERM/HUP):
   - kills a writer that is still blocked ("password was NOT consumed by psql (never sent)");
   - **rotate:** promotes PENDING → LIVE iff the output contains `ROT RESULT: ALTER SUCCEEDED - SQLSTATE 00000`;
   - **validate_pending:** promotes iff `B3 RESULT: PASS` and `ROT END` are both present;
   - promotion validates the PENDING read, verifies the LIVE readback, and **verifies the PENDING deletion**;
   - removes the FIFO, temporary file and directory;
   - always prints `ROT FINAL: mode=… psql_exit=… keychain_LIVE=… keychain_PENDING=…` (presence only, never values).

**Exposure inventory (requirement 4):**

| Channel | New app password | Basis / test |
|---|---|---|
| Clipboard / Handoff | **never** | never displayed or copied |
| Terminal / scrollback | **never printed** | output scan 0 in all runs |
| Shell history | **none** | launched as a file (`zsh -f`); nothing typed contains it. (`zsh -f` still reads `/etc/zshenv`) |
| Process arguments | **none** | `tr`, `head`, `security -i`, `security find/delete-generic-password` (account and service only), `awk` (FIFO path), `psql` (`-v fifo=<path>`); argv and environment snapshots: proc_leak 0 |
| Environment | **none** | never exported; psql runs under `env -i` |
| Plaintext files | **none** | FIFO only; the temporary output file contains no secret and is deleted |
| psql history / echo | **none** | `-X -n`, `PSQL_HISTORY=/dev/null`, `ECHO none`, terse; `\connect` errors print host and port only |
| Durable storage | **macOS login Keychain** (local, not iCloud-synced; Time Machine backs it up encrypted) | **Not an access boundary against same-user processes:** the item's ACL trusts `/usr/bin/security`, so any process running as this macOS user, **including AI coding agents with shell access**, can read it without a prompt. Decision **R-2** (§11) |
| **Server side** | **residual, now for the new credential** | Neon accepts only plaintext `ALTER ROLE … PASSWORD`, and `pg_stat_statements` doesn't normalize the password string. With `track_utility=on`, the plaintext can persist in the compute's statement-text store, readable by anyone holding the still-exposed `neondb_owner` until a restart or reset, and in Neon monitoring. **Mitigations:** the gate tries a session-level `track_utility=off` and prints the effective value; Phase F **must** restart compute after this rotation. **R-1 must re-accept this residual for the new password** |
| Admin password (`neondb_owner`) | typed at psql's hidden prompt | the already-exposed credential, reset in Phase F. Type it, or paste it with clipboard managers and Handoff off, then `pbcopy </dev/null` |

## 4. Procedure (for a future, separately authorized execution)

> **Superseding notes (§13):**
> - Run the published per-mode file unedited, from `~/aura-rot/`: `rot_run_ROTATE.zsh`, `rot_run_VALIDATE.zsh` or `rot_run_VALIDATE_PENDING.zsh`. Verify its sha256 **immediately before** `zsh -f`. Steps 6–7 (editing line 3, `diff`) are obsolete.
> - Copy `psql16_pins.txt` is not needed; the pins are embedded.
> - Preflight adds: no computer-use or Accessibility-enabled agents running.
> - Expect exactly 2 Keychain dialogs in rotate mode (1 in validate). Click **Allow**, never Always Allow. More than one dialog for a step, or any dialog at another time: **Deny all and STOP**.
> - There is no FIFO and no "NOT consumed" line. `ROT FINAL` must show `keychain_LIVE=restricted keychain_PENDING=absent`.


**B2-B-R-0, preflight** (fresh terminal; each must match, otherwise STOP):
1. `unset HISTFILE`; clipboard managers and Handoff off for the session.
2. **No other shell-capable agents or tools running as this user** during the run (R-2).
3. Neon console → project `green-bar-78820765` → **Branches shows only `main`**. Its compute endpoint ID equals the pinned host's `ep-…f5t5`.
4. `no_pgpass`; `env_clean`; `/opt/homebrew/bin/psql --version` gives 16.14.
5. `cd ~/Desktop/Claude/auraschedule-math-core/AURA_GOV_02_I0_C_ARTIFACTS && shasum -a 256 -c SHA256SUMS` must show all `OK`. Then `mkdir -p ~/aura-rot && cp rot/{rot_settings.sql,rot_gate.sql,rot_apply.sql,rot_validate.sql,rot_validate_core.sql,b3_checks.sql,rot_run_DRAFT.zsh} ~/aura-rot/`.
6. `cp ~/aura-rot/rot_run_DRAFT.zsh ~/aura-rot/rot_run_RUN.zsh`; set **line 3 only** to `MODE='rotate'`. `diff` must show only `3c3`.
7. **No PENDING item exists:**

   ```bash
   /usr/bin/security find-generic-password -a aura_app_2026_11 -s AURA-Neon-aura_app_2026_11-PENDING >/dev/null 2>&1 && echo PENDING_PRESENT || echo no_pending
   ```

   This must print `no_pending`.

**B2-B-R, rotate:** `zsh -f ~/aura-rot/rot_run_RUN.zsh`. **The PASS criterion is this transcript, in order. The exit code alone is NOT a pass signal:**

```
ROT: new password generated and stored as PENDING in the keychain (readback verified; never displayed)
ROT GUARD: OK endpoint=ep-…f5t5 mode=rotate - enter the neondb_owner password at the psql prompt
Password for user neondb_owner:
DO
ROT TRACK_UTILITY (session, best effort): off | on         <- record the value; "on" = the residual stands (not a STOP)
ROT GATE: PASS - pinned direct host, admin identity, database, version, logging settings, role baseline
ALTER ROLE
 overwrite_activity / 1 / (1 row)
ROT RESULT: ALTER SUCCEEDED - SQLSTATE 00000 - confirm no NOTICE above
ROT VALIDATE: connecting as the application role through the pooler (verified TLS, channel binding)
You are now connected to database "neondb" as user "aura_app_2026_11" on host "ep-…f5t5-pooler.…" … SSL connection (protocol: TLSv1.3 …)
ROT VALIDATE: pooled login as the application role SUCCEEDED - running B3 checks
Pager usage is off.
You are connected to database "neondb" as user "aura_app_2026_11" on host "ep-…-pooler…" … SSL connection …
B3 HOST CHECK … host_is_pooler t … B3-1 … B3-6b rows … ROLLBACK
B3 RESULT: PASS - login, identity, attributes, memberships, ownership, table count and pre-B4 privileges match
B3 END
ROT END: secrets cleared
ROT KEYCHAIN: PENDING promoted to LIVE (readback verified); PENDING removed (verified)
ROT FINAL: mode=rotate psql_exit=0 keychain_LIVE=present keychain_PENDING=absent
```

- **B3-R** is included (the pooled login plus the unchanged checks).
- A standalone B3-R uses `MODE='validate'` (LIVE, no ALTER, no promotion).
- **Close:** `pbcopy </dev/null`; restore clipboard managers and Handoff. Mark the old password-manager entry **RETIRED: superseded by Keychain AURA-Neon-aura_app_2026_11-Production**.

## 5. STOP conditions and failure handling

**STOP on any of these:**
- any preflight mismatch;
- any `ROT GUARD:` line other than `OK`, including PENDING present, a hash or pin mismatch, or not zsh;
- `ROT GATE: STOP`;
- any `ERROR`/`WARNING`/`NOTICE` line;
- `ALTER FAILED`;
- any missing transcript line in §4;
- a `\connect` host that isn't `ep-…f5t5-pooler…`;
- `ROT FINAL` not showing `LIVE=present PENDING=absent`;
- anything resembling a password in output (burn rule: re-rotation needs authorization).

| Situation | Database password | Keychain | Action |
|---|---|---|---|
| Guard, hash, pin or PENDING-present refusal | unchanged | unchanged | STOP; nothing sent |
| Generation or Keychain readback failure | unchanged | PENDING may exist | STOP |
| Admin auth or TLS failure at start | unchanged | PENDING retained, LIVE untouched (H7) | STOP; writer killed, "NOT consumed" |
| `ROT GATE: STOP` | unchanged (nothing read) | PENDING retained (H3) | STOP; report which assumption changed (re-run the gate SELECT pieces read-only under authorization) |
| `ALTER FAILED` with a definite SQLSTATE (e.g. 42xxx) | unchanged | PENDING retained | STOP; report the code |
| `ALTER FAILED` with class **08** or an empty SQLSTATE (connection lost) | **uncertain** | PENDING retained | STOP → separately authorized `MODE=validate_pending` (PASS promotes; failure means unchanged) |
| ALTER OK, pooled-leg TLS or channel-binding failure | **new** | LIVE (promoted) | STOP; later `MODE=validate` |
| ALTER OK, pooled `password authentication failed` | **new** | LIVE | STOP. Possible Neon proxy caching after a SQL password change (undocumented). Wait ≥10 min, then a separately authorized `MODE=validate` |
| ALTER OK, `B3 RESULT: STOP` | new | LIVE | STOP; report the B3 rows |
| **Interrupt after ALTER** | new | **promoted by the exit trap** (M3) | STOP; then `MODE=validate` |
| Interrupt before ALTER | unchanged | PENDING retained | STOP; clear PENDING (below), then a fresh rotate under authorization |
| Rerun while PENDING exists | — | refused (H4) | resolve first: `validate_pending` if the database state is uncertain, else delete PENDING |
| PENDING present but never applied | unchanged | PENDING | `validate_pending` fails safely, with no promotion (H5, H8). Delete PENDING with `security delete-generic-password -a aura_app_2026_11 -s AURA-Neon-aura_app_2026_11-PENDING` (no secret involved) |

## 6. Tests (throwaway local PostgreSQL 16.14; TLS with a private CA; SCRAM for both roles; throwaway Keychain file; no Production)

- The sim differs from the drafts **only** in `rot_settings.sql` lines 1–8 (local values) and the launcher config lines 2 and 4–8, plus their embedded hashes. All logic files are byte-identical.
- The harness generated and never printed dummy secrets, and scanned output, argv and environments against the Keychain values.

**Iteration 1** (15 runs: R1–R11, R7b, R8, R9, R10×3, RZ):
- rotate, validate and re-rotate PASS;
- admin-auth failure, stale LIVE, ALTER failure, pooled-leg TLS failure, interrupt, tamper and host guard all behave as designed.

**Iteration 2** (final files; 13 runs):

| # | Case | Result | Keychain after | Leak / FIFOs / processes |
|---|---|---|---|---|
| H1 | rotate | gate PASS → ALTER SUCCEEDED → pooled login → **B3 PASS** → `ROT END` → promoted (delete verified); FINAL LIVE present, PENDING absent; DB = LIVE | LIVE | 0/0/0 |
| H2 | validate | gate PASS → **B3 PASS** | LIVE | 0/0/0 |
| H3 | gate fails (admin `log_statement=all`) | `ROT GATE: STOP - … nothing read, nothing changed`; "NOT consumed"; PENDING retained; DB unchanged | LIVE+PENDING | 0/0/0 |
| H4 | rotate with PENDING present | refused before anything else | unchanged | 0/0/0 |
| H5 | validate_pending (never applied) | 28P01 → psql exits; **not promoted** | LIVE+PENDING | 0/0/0 |
| H6 | delete PENDING, rotate | as H1 | LIVE | 0/0/0 |
| H7 | admin password wrong | psql exits 2; "NOT consumed"; PENDING retained | LIVE+PENDING | 0/0/0 |
| H8 | validate_pending after H7 | not promoted | LIVE+PENDING | 0/0/0 |
| M3 | **Ctrl-C after ALTER** (injected delay) | exit trap: `PENDING promoted to LIVE`; FINAL `psql_exit=interrupted`; DB = LIVE | LIVE | 0/–/0 |
| VP | validate_pending, PENDING applied but not promoted | **B3 PASS** → promoted | LIVE | 0/0/0 |
| T | tampered `rot_gate.sql` | `FILE HASH MISMATCH - nothing done` | — | — |
| P | host ≠ pinned | `HOST DOES NOT MATCH THE PINNED rot_direct_host - nothing done` | — | — |
| B | launched with bash | `must run under zsh - nothing done` | — | — |

**Defects found in my own design during testing (fixed):**
- **(1)** In interactive `\i`, a failed `\connect` aborts the file and **leaves the conninfo variable set at the prompt**. Fixed by the non-interactive (`-f`) design.
- **(2)** Writing LIVE before ALTER could desynchronize the Keychain. Fixed by PENDING → LIVE.
- **(3)** My first host-pin `grep` used a regex (dots as wildcards). Fixed to an exact fixed-string match.

**Not exercised locally:**
- the login-Keychain path (`KC_FILE=''`); it fails safe because a readback failure means nothing is sent;
- a real pooler (the sim's pooled leg reuses the same server; the derivation was verified separately);
- Neon's `pg_stat_statements` (the sim's `track_utility` line is meaningless because the module isn't loaded).

**Clean-up:** cluster stopped; `pg_hba.conf` restored; dummy role settings and passwords reset; test Keychain deleted (not in the search list); dummy-secret file deleted; no processes left.

## 7. Relationship to B4 (requirement 6)

- The B4 grant set and controls are **unchanged**. `AURA_GOV_02_I0_C_ARTIFACTS/b4/` is byte-identical to readiness plan §7.1 (manifest-verified).
- D-1 is satisfied once B2-B-R + B3-R PASS are recorded.
- B4's first execution step remains the read-only `MODE=state` gate.

## 8. Phase C and Phase F notes (not authorized; for planning continuity)

- **Phase C:** `AURA_DATABASE_URL` needs the LIVE value. The preferred future method is a stdin pipeline from the Keychain into the Vercel CLI (`vercel env add … --sensitive`), with no clipboard. A dashboard paste would reintroduce the clipboard. It needs its own authorization and review.
- **Phase F:** **restart compute after B2-B-R** (clears in-memory `pg_stat_statements`) together with the `neondb_owner` reset, and record it.

## 9. Local PostgreSQL 17 validation plan (D-4; planning only; the download is not authorized)

1. `brew install postgresql@17` (separate authorization). Use the PG17 **server** binaries only; keep the client at psql 16.14 (the Production client).
2. **Throwaway TLS cluster:**
   - recreate `neondb_b4` (25 tables, enum, `neon_auth`) with the `cloud_admin_sim` → `neon_superuser_sim` default ACLs (PG17 `GRANT ALL` gives the exact 11-row Q5 shape including MAINTAIN);
   - run the PG17 build of `pg_stat_statements` with `track_utility=on` to observe the rotation residual and whether `track_utility=off` can be set by a non-superuser.
3. **Re-run:**
   - B4 core and negatives (`exp_vnum` 1700xx; PG17 default-ACL line), plus new PG17 cases: PUBLIC `MAINTAIN`, direct `MAINTAIN` (C-11/PRE-1), `pg_maintain` membership (C-3);
   - B4 transaction tests;
   - the B3 sim checks;
   - the rotation suite H1–H8, M3 and VP.
4. Record the results in a new evidence section; stop the cluster; optionally `brew uninstall postgresql@17`.

## 10. Independent review: APPROVE WITH CHANGES (no P0/P1). All findings addressed.

| ID | Sev | Finding | Disposition |
|---|---|---|---|
| P2-1 | P2 | Identity and host gate ran after ALTER; any Neon direct endpoint accepted (wrong-branch risk); no version or logging re-check | **Fixed:** pre-ALTER `rot_gate.sql` (pinned host, identity, database, version, primary, logging, role baseline, memberships); launcher pins the exact host; branch-inventory preflight (H3, P) |
| P2-2 | P2 | Interrupt after ALTER exited without promotion; rerun could overwrite the only copy | **Fixed:** exit-trap promotion (M3); PENDING-present refusal (H4); `validate_pending` (H5, H8, VP); failure table extended |
| P2-3 | P2 | Keychain isn't an access boundary against same-user processes | **Stated honestly** (§3); decision R-2 with options; preflight item 2 |
| P2-4 | P2 | Plaintext `ALTER` residual now applies to the new credential | **Adopted:** R-1 must re-accept it; Phase F restart required; best-effort `track_utility=off` with the effective value printed |
| P3-1 | P3 | Empty PENDING read during promotion | **Fixed:** validated before use |
| P3-2 | P3 | Delete not verified | **Fixed:** verified (`PENDING removed (verified)`) |
| P3-3 | P3 | "ALTER FAILED" may be uncertain (class 08, empty) | **Fixed** in the failure table |
| P3-4 | P3 | Exit 0 isn't a PASS | **Fixed:** the transcript is the criterion; FINAL line added |
| P3-5 | P3 | Missing "Pager usage is off." line | **Added** to the transcript |
| P3-6 | P3 | Environment denylist incomplete | **Fixed:** psql under `env -i` |
| P3-7 | P3 | No zsh guard | **Fixed** (B) |
| P3-8 | P3 | Login-Keychain path untested | Stated (§6); fails safe |
| P3-9 | P3 | Sim pooled leg | Stated (§6) |
| P3-10 | P3 | R0 retirement wording; branch history | **Fixed** (§2; branch preflight) |
| P3-11 | P3 | `application_name` on the pooled leg | **Added** |
| P3-12 | P3 | Untracked artifacts in the repo folder | Noted. Recommended owner action: add `AURA_GOV_02_I0_C_ARTIFACTS/` to `.git/info/exclude` (not done; local git configuration is the owner's choice) |

**Verified fine by the reviewer:**
- the manifest, and the launcher reproduced byte-for-byte from the generator;
- `security -i` stdin handling (no echo, no history, no secret in errors);
- readbacks through pipes;
- the FIFO permissions;
- the awk guards;
- variable lifetimes (`newpw` unset before `\connect`, `rot_ci` after);
- a failed `\connect` exits psql;
- the promotion grep cannot be spoofed by server output;
- `pipestatus[1]`;
- `verify-full` + channel binding + SNI prevent a different endpoint behind the derived host;
- Production and B4 unchanged.

## 11. Outstanding decisions

| ID | Decision |
|---|---|
| **R2-V** | Owner runs `zsh -f AURA_GOV_02_I0_C_ARTIFACTS/rot/r2_verify.zsh` (throwaway keychain, dummy value; ~2 min; follow the on-screen Deny/Allow instructions) and reports the R2-* lines and observations O1–O3 |
| **R-2c** | Adopt the dedicated, locked keychain (recommended), or accept the user-mediated `-T ''` control with the residuals in §13 |
| **R-1** | Production rotation execution: **not yet requestable.** It requires R2-V and R-2c first, then the residual re-acceptances (server-side plaintext statement; Keychain residuals) |
| D-4-c | Optional clean-up: delete `/opt/homebrew/var/postgresql@17`; optionally uninstall `postgresql@17` and its build-only dependencies |
| R-3 | Optionally commit `AURA_GOV_02_I0_C_ARTIFACTS/` later (docs-only; freeze exception; mask the pinned host) |

## 12. Recommendation

**EXECUTION READINESS: HOLD.**
- The FIFO hijack (P1-A) is fixed and re-tested, and the PostgreSQL 17 validation passes.
- **R-2 is not resolved.** The `-T ''` control prevents silent reads at rest (verified), but it is **user-mediated**. It doesn't protect integrity or availability, and the interactive dialog semantics are unverified on this Mac.
- **Next authorizations, in order:**
  - **(1)** the owner runs R2-V;
  - **(2)** the R-2c decision. If the dedicated keychain is chosen, I implement it, re-test, and get it re-reviewed;
  - **(3)** only then can R-1 be requested.
- **B4, B5 and B6 remain HOLD. The Production merge freeze remains ACTIVE.**

## 13. R-2 revision (owner decision (b)) and evidence. **R-2 is NOT resolved**

**Implemented:**
- **Restricted items:** both Keychain items are created with an empty trusted-application list (`-T ''`), in the login keychain by explicit path, so shadow items in other keychains are ignored.
- **Expected prompts:** every read is announced ("click ALLOW, never Always Allow; more than one dialog for a step, or any dialog at another time: Deny ALL and STOP"). A rotation has 2 expected prompts (PENDING readback, LIVE readback); validate has 1.
- **No ALTER from a Keychain read:** promotion uses the in-memory value.
- **Integrity signals:** `ROT FINAL` prints the record-exact ACL state (`restricted`/`OPEN`/`OPEN(duplicate)`) and the LIVE modification time. `OPEN` means STOP.
- **Remediation for OPEN:** delete both items, then run a fresh, separately authorized rotation.

**Measured (throwaway keychains, dummy values):**

| # | Behaviour | Result |
|---|---|---|
| K1 | ACL of a default `security`-created item | decrypt trusted: `com.apple.security` (**silent reads by any same-user process**) |
| K2 | ACL of a `-T ''` item (via the exact launcher code path) | decrypt `applications (0)`, `change_acl` `applications (0)` |
| K3 | same-user `find-generic-password -w` on a `-T ''` item | **blocked awaiting authorization; no data** (default item: returned in 0 s) |
| K4 | same-user `add -U` overwrite of a `-T ''` item | **silent data replacement** (mdat changed, ACL unchanged), i.e. an **integrity** gap |
| K5 | same-user delete | **silent**, i.e. an **availability** gap |
| K6 | `-U -T /usr/bin/security`, `-U -A` (ACL change) | refused; ACL stays `(0)` (reviewer) |
| K7 | partition-list change | needs the keychain password (reviewer) |
| K8 | record-exact ACL parser vs decoy items (other account, same service, either order) | correct in all cases |

**Fixed after the independent review (HOLD):**
- **P1-A FIFO hijack (reproduced by the reviewer):** a same-user process could read **and substitute** the password through the named FIFO while the admin typed their password. The database then accepted the attacker's value, and validation passed.
  - **Fixed:** the value now goes to psql through an **anonymous pipe on stdin** (`-v fifo=/dev/stdin`); no FIFO exists.
  - **Re-tested with the reviewer's attacker running concurrently (W1, W2):** "no fifo seen", nothing stolen, the database accepts exactly Keychain LIVE.
- **P2-C ACL parser false "restricted":** fixed (K8).
- **P1-B (partial):**
  - the launcher now verifies the sha256 of psql 16.14, libpq and **all 11 transitive libraries** before running (tampered or missing means `nothing done`; tested with a pin mismatch);
  - per-mode launcher files are published, so no editing is needed. Check their hash **immediately before** `zsh -f`;
  - dialog rule added;
  - preflight: no computer-use or Accessibility-enabled agents running.
- **P2-D:** psql now connects with `gssencmode=disable`, so the changed krb5 (below) is loaded but never exercised.
- **P3:** `kcput` errors reported; OPEN remediation written; the PG17 harness corrected.

**Why R-2 cannot be reported resolved:**
1. **The control is user-mediated.** A single "Always Allow" click, or approving a prompt fired by another process during an announced window (the dialogs are indistinguishable), permanently or silently opens the item. Not yet verified on this Mac: whether "Allow" persists, whether a password is demanded, and what the dialog shows. This needs the owner-run `r2_verify.zsh` (R2-1…R2-6, plus observations O1–O3).
2. **Integrity and availability aren't protected** (K4, K5). Mitigated by detection, since a substituted value fails validation (28P01) and is never used for ALTER, but not prevented.
3. **Paths outside the Keychain API remain:** user-writable launcher files between hash check and run (TOCTOU), and Accessibility- or computer-use-capable agents (untested, deliberately). The library pins narrow but don't eliminate tampering by a same-user process.
4. **Scoped statement of what IS enforced:** *silent reads of the item at rest through the Keychain API are prevented.*

**Stronger option (recommended next decision, R-2c): a dedicated, locked keychain**
- `~/Library/Keychains/aura-rot.keychain-db` with its **own password** (kept in the password manager, not the login keychain), `set-keychain-settings -l -t <longer than the maximum run time>` plus an explicit lock in `finalize`, outside the search list, items with `-T ''`.
- The launcher unlocks it interactively (tty prompt, nothing in argv) at the start of a run and locks it in `finalize`.
- **Reviewer-measured:** a write to a locked keychain requires the keychain password and fails if the unlock prompt is cancelled. Reads while locked: **UNVERIFIED** (see `AURA_GOV_02_R2B/R2B_LOCKED_KEYCHAIN_DESIGN.md`).
- **Remaining:** the file can be deleted or replaced (detectable). During the unlocked run window, the properties are the same as `-T ''`.
- **Even then, R-2 would be "user-mediated + at-rest lock" with the residuals above, not "resolved".**

## 14. D-4: local PostgreSQL 17 validation (approved; done)

**Install:**
- `postgresql@17` 17.11 from `homebrew/core` (the same minor as Neon), **built from source** (no Sonoma bottle); the source tarball and patches are pinned by sha256 in the formula.
- Installed with auto-update, dependency upgrades and cleanup disabled. Keg-only, so `/opt/homebrew/bin/psql` still points to psql **16.14**.
- No service started.
- Homebrew post-install created `/opt/homebrew/var/postgresql@17` (trust auth, port 5432, not running). Recommend deleting it, or never starting it (it would clash with the running PostgreSQL 16 service).

**Client integrity (corrected after review P2-D):**
- psql 16.14, libpq, libintl, libreadline and OpenSSL 3.6.3 are byte-identical to the pre-install snapshot.
- **But libpq's krb5 libraries changed.** `/opt/homebrew/opt/krb5` now points to the newly built `krb5 1.22.2_2`, for example `libgssapi_krb5` `779694…` → `4c3db8…`.
- **Mitigation:** `gssencmode=disable` (krb5 never exercised), plus the transitive pin list, which records the current state.
- Optional later: uninstall `postgresql@17` and its build-only dependencies (this does not revert the krb5 link).

**PG17 throwaway cluster** (psql 16.14 client → PG17 17.11 server; TLS with a private CA; SCRAM; `pg_stat_statements` preloaded with `track_utility=on` and **not installed in the test databases, matching Production**):
- **Baseline:** exactly Production's shape: the 11-row Q5 default-ACL set **including MAINTAIN**, and creator membership `t/f/f/grantor 10`.
- **B4 core:** NOT_APPLIED → grants **COMMITTED AND VERIFIED** → APPLIED → re-grant STOP PRE-1 → revoke **baseline verified** → NOT_APPLIED.
- **New PG17 MAINTAIN cases:**

  | Case | Caught by |
  |---|---|
  | PUBLIC `MAINTAIN` | C-7a |
  | direct `MAINTAIN` | **C-11 (native check exercised)** |
  | `pg_maintain` membership | C-3 |
  | `MAINTAIN` outside `public` | C-11 |

- **B4 negatives:** all 22 stop with the expected check ID.
- **B4 transaction tests:**
  - post-grant failure rolls back (state NOT_APPLIED);
  - `kill -9` before COMMIT leaves NOT_APPLIED;
  - concurrent application reads, writes and `FOR UPDATE` are not blocked;
  - an ACCESS EXCLUSIVE holder causes no wait;
  - drift is classified INCONSISTENT;
  - the compensating revoke restores the baseline.
- **Rotation, first build:**
  - Q1 rotate, Q2 validate, Q3 gate STOP, Q4 PENDING refusal, Q5 validate_pending no-promote, Q6 admin wrong, Q7 rotate;
  - M3 interrupt after ALTER is promoted by the exit trap;
  - VP validate_pending promotes.
- **Rotation, final build (pipe):**
  - W1/W2 with the concurrent FIFO attacker: no FIFO, nothing stolen;
  - W3 gate STOP, W4 admin wrong, W5 rotate;
  - M3b interrupt promotion, VPb recovery;
  - PIN mismatch: `nothing done`;
  - Z1 after transitive pins: PASS.
  - Every run: leak 0, proc_leak 0, no FIFOs or processes left, and the database always accepts Keychain LIVE after a completed rotation.
- **Empirical residual confirmation:**
  - a non-superuser **cannot** set `pg_stat_statements.track_utility=off` (it stayed `on`);
  - `pg_stat_statements` **recorded the `ALTER ROLE` with the plaintext 40-character literal** (1 entry per rotation; the reviewer saw 2 for 2).
  - This confirms the R-1 re-acceptance requirement and the mandatory Phase F compute restart.
  - (Reviewer note: on PG17 a non-superuser *with EXECUTE granted* can remove its own entries via `pg_stat_statements_reset(userid,dbid,queryid)`. On Neon the extension isn't installed in `neondb`, so this isn't usable without a separately authorized schema change.)
- **Clean-up:** clusters stopped; test keychains deleted (search list unchanged); dummy secrets deleted; no processes left. The `b4/` artifacts are unchanged (9 files, hashes identical to readiness plan §7.1).

## 15. Independent review (R-2 revision + D-4)

- **Verdict: R-2 HOLD; D-4 APPROVE WITH CHANGES.**
- **All findings addressed:**
  - P1-A fixed and re-tested;
  - P1-B partially mitigated, with the rest stated as residuals;
  - P2-C fixed;
  - P2-D claim corrected and mitigated;
  - P2-E integrity gap documented, with the Phase C pre-check below;
  - P2-F noted;
  - P3s fixed.
- **Phase C pre-check (adopted for the future plan):**
  - read LIVE **once** into memory;
  - validate it with a pooled app-role login using that same in-memory value;
  - push that same value onward; never re-read between validate and push;
  - require ACL=`restricted` and LIVE mdat equal to the last `ROT FINAL`.
