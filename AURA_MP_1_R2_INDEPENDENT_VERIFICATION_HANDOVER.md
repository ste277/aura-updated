# AURA-MP-1 R2: independent verification handover (62009, after the 62008 NO-GO)

| | |
|---|---|
| **PR** | [ste277/aura-updated#400](https://github.com/ste277/aura-updated/pull/400). Open, unmerged. Auto-merge **off**, Auto-fix off |
| **Reviewed (62008)** | Implementation `3e6bce5a6a57e075caa12b2f52f832584effeb60`, handover `39dea7f75df92d697d205255002d9c261e4436d8` |
| **R2 implementation head** | `831f38b661e7e1acc8102cc02bba0df4133bc969` |
| **R2 handover head** | The commit adding this file, directly on top of the implementation head (docs only) |
| **Integration (CI)** | GitHub's automatic test merge of the handover head into `main` at CI time (`refs/pull/400/merge`). The branch is not synchronized. The exact SHA and the run are reported in the closing report and in the evidence (`ci_*`) |
| **Scope** | F1 (P1) and F4 (P2) only. F2, F3 and F5 are independently CLOSED and preserved. No MP-2, redesign or dependency change |
| **Not done (by instruction)** | No deliberate CI rerun, branch sync, merge, deployment, Production database access, persistent migration or feature activation. My People stays disabled in Production |
| **Evidence** | `AURA_MP_1_R2_EVIDENCE/` (SHA256SUMS in §9) |

> **62008 disposition document:** it was not available to this session; it is not in the repository, the worktrees, the evidence folders or the PR. The reproductions below follow the cases named in 62009 exactly: chart-bearing PARENT/CHILD/SIBLING renames with the switch disabled, America/Chicago → Asia/Kolkata, empty location → Chennai, an unlisted custom city overwritten, and a NULL Gregorian month/day accepted.

## 1. Findings and corrections

| # | Finding | Root cause | Correction |
|---|---|---|---|
| **F1** (P1) | An unrelated edit overwrote birth timezone, city and coordinates | The legacy editor always resubmitted the whole chart. Its city select fell back to the first catalogue city (Chennai) for any saved city not in the list, or with no city | `PeopleView.tsx`: `buildPersonEditPayload` separates the **original** persisted snapshot, **presentation defaults**, **explicit edits** and **explicit clearing**. An EDIT sends only changed fields. Editing any birth field sends the full all-or-none chart, with untouched parts taken from the **original** record: timezone, city and coordinates, or their absence. The saved location appears as its own select option ("Naperville (saved)" or "Saved time zone: …"). A save with no changes sends **no request**. ADD now needs an explicit city choice instead of silently defaulting to Chennai. The API contract is unchanged |
| **F4** (P2) | The Gregorian CHECK accepted a NULL month and/or day | A PostgreSQL CHECK passes when its expression is UNKNOWN. With a NULL component every comparison was NULL, so the row was accepted | `0056`: `PersonOccasion_gregorian_date_check` now starts with `month IS NOT NULL AND day IS NOT NULL`. The year stays optional, the leap-year rule is unchanged, and unknown-year 29 Feb is still valid. `calendar` is `NOT NULL`, so the `calendar <> 'GREGORIAN'` branch can never be UNKNOWN, and the future calendar-type extension point is unchanged |

The F4 concurrency, transaction, lock-release and limit guarantees from R1 are unchanged; their suites pass (§4).

## 2. 0056 amendment: persistent-environment re-check

The checks were re-established **before** 0056 was changed again (`0056_persistent_env_recheck.txt`, `vercel_production_deployments_recheck.json`):
- **Migration execution configuration:** `vercel-build.sh` runs `prisma migrate deploy` only when `VERCEL_ENV=production`.
- **Deployment history:** since 0056 first existed, the only Production deployment is `main` `5551166`, which does not contain 0056 and was CANCELED by the Ignored Build Step. There have been no new Production deployments since R1.
- **Git:** 0056 exists only on the PR #400 branch and its PR refs. `origin/main` has none.
- **Authorized local ledgers:** all 19 local persistent databases (`localhost:5432`) have **0** rows of 0056.
- **Not accessed:** the Production database, by instruction. The conclusion rests on the above.

## 3. Before and after: reproduction (`r2_witness.ts`)

The witness is head-agnostic: the real People editor (jsdom) drives the real route handlers and a disposable Postgres migrated by the checkout under test, and F4 is tested by direct SQL.

| Check | R1 `3e6bce5` | R2 |
|---|---|---|
| Disabled: rename chart PARENT (Chicago, unlisted Naperville + coordinates) | **FAIL**: became Asia/Kolkata, Chennai, 13.0827/80.2707 | PASS |
| Disabled: rename chart CHILD | **FAIL** (same) | PASS |
| Disabled: rename chart SIBLING | **FAIL** (same) | PASS |
| Disabled: rename a chart with no optional location | **FAIL**: Chennai and its coordinates added; timezone → Asia/Kolkata | PASS |
| Disabled: save without changes | **FAIL**: full chart resubmitted and overwritten | PASS (no request) |
| Enabled: rename keeps the stored chart | **FAIL** (same overwrite) | PASS |
| SQL: NULL month / NULL day / both NULL | **FAIL** ×3 (accepted) | PASS ×3 (refused, 23514) |
| **Total** | **0/9** | **9/9** |

Files: `witness_BEFORE_r1_3e6bce5.txt`, `witness_AFTER_r2.txt`.

## 4. Regression suite, negative controls and full CI steps

**New suite `test/myPeopleR2Db.test.ts` (wired into CI): 60 checks.**
- For each editor operation it compares the full persisted record (13 columns) before and after, and checks the exact payload keys.
- Editor operations: name-only, relationship-only, save without changes, unlisted custom city, missing optional location, explicit birth-time edit (original location carried over), explicit birth-date edit on a chart with no location, explicit location change, name-only person.
- Through the API: notes and interests edits; explicit chart clearing (enabled: clears exactly the six chart columns; disabled: 400, nothing changes).
- In the editor: clearing only the birth time is refused client-side.
- Feature states: disabled → enabled → re-disabled → re-enabled.
- Direct-SQL **INSERT and UPDATE** matrix:
  - **refused:** NULL month, NULL day, both NULL, NULL month with a year, month 0 or 13, day 0 or 32, 31 April, 30 February, 29 Feb 1900, 29 Feb 2023;
  - **accepted:** ordinary dates, 29 Feb 2000 and 2024, unknown-year 29 Feb, 30 Apr and 1 Jan.

| Run | Result | File |
|---|---|---|
| R2 suite on R2 | **60/60** | `r2_suite_on_r2.txt` |
| R2 suite on unchanged R1 (`3e6bce5`, migrated by R1) | **23 FAIL** (F1 payload and persistence; all NULL INSERT/UPDATE cases) | `negative_control_r2_suite_on_R1_3e6bce5.txt` |
| **NC1a**: editor mutated to resubmit the ORIGINAL chart unconditionally | **6 FAIL** (payload keys) | `negative_control_NC1a_…` |
| **NC1b**: editor mutated to R1 behaviour (unconditional chart from the presentation-default city) | **14 FAIL** (payloads and persisted overwrites) | `negative_control_NC1b_…` |
| **NC2**: 0056 with the `month/day IS NOT NULL` terms removed | **7 FAIL**: exactly the NULL INSERT ×4 and UPDATE ×3 cases | `negative_control_NC2_…` |
| `math-core-tests`, every CI step with its `env:` | **245/245 PASS** | `local_ci_math_core_tests_all_steps.txt` |
| `day-constructor-acceptance-db-tests`, every step, fresh DB | **78/78 PASS** (includes the new R2 suite) | `local_ci_day_constructor_db_all_steps.txt` |
| `next build` (CI env) + 5 bundle/standalone checks | **build exit 0; 5/5 checks exit 0**; all 5 `/api/people*` routes ƒ (dynamic) | — |
| Typecheck (`tsconfig.web.json`, `apps/web`) | clean | — |

Every mutation was reverted and verified (`cmp` against the saved original) before anything was committed.

**Assertions changed (with notes in the tests):**

| Test | Change | Why |
|---|---|---|
| `peopleViewNullChartJsdom` "saving a chart person sends the full chart, exactly as before" | Replaced by "an unchanged save sends no request" and "an explicit birth-time edit sends the full chart with the ORIGINAL timezone, city and coordinates, and no name or relationship" | The old assertion **pinned the F1 defect**: unconditional chart resubmission |

Every other assertion is unchanged, including the R1 F1 relationship assertions, the F2 flag assertions, the F3 validation assertions, the F5 contract assertions, and the R0 isolation, atomic-delete, export, rollback and birth-date guards. The half-filled-chart refusal kept its original assertion: the corrected editor message still contains the asserted wording.

## 5. Migration compatibility (0055 from PR #401, amended 0056)

`0055_auth_session` is taken from the PR #401 branch head `864da6f` (`0055_auth_session.from_PR401_branch.sql`; hashes in `migration_sources.sha256`). Each order runs on a fresh disposable database. **Two pre-existing legacy SavedPerson rows are inserted at 0054**, one with a custom Chicago city and coordinates and one with no location, before either migration is applied.

| Order | Deploys | `migrate status` | Legacy rows | Corrected CHECK | AuthSession |
|---|---|---|---|---|---|
| A: 0055 then 0056 | exit 0, exit 0 | exit 0, "Database schema is up to date!" | digest identical before and after; new columns defaulted (`interests={}`, `notes` NULL) | NULL-month insert refused | ✔ |
| B: 0056 then 0055 | exit 0, exit 0 | exit 0, up to date | identical | refused | ✔ |

Files: `migration_order_A_0055_then_0056.txt`, `migration_order_B_0056_then_0055.txt`.

**Reconciliation with AUTH-SESSION I1 (PR #401), retained:**
- #401 re-baselines the same three exact-name migration guards (PREF-01 11o, MR3 G12, INS-01 S9) for `0055_auth_session`.
- Whichever PR merges second must update all three allow-lists to include **both** `0055_auth_session` and `0056_my_people_foundation`, as #401 documents.
- MP-1's guards still allow only their exact names, and their negative controls still fail on any other new migration (R0 mutation evidence).

## 6. Preserved behaviour (all suites pass, §4)

The following are covered by the local CI-step runs and the PR CI:
- **F2, server-authoritative switch:** the R1 F2 suites and `myPeopleRequest`.
- **F3, input validation:** `myPeopleRequest`, `myPeopleR1Db`.
- **F5, list contract, inline occasions and export:** `myPeopleR1Db`, `myPeopleDb`.
- **Legacy People compatibility:** `peopleViewLegacyEditorDb`, `peopleViewNullChartJsdom`.
- **Concurrent date updates, creation limits, rollback and lock release:** `myPeopleR1Db` F4.
- **Owner isolation and atomic deletion with an injected failure:** `myPeopleDb`.
- **Historical plan and moment retention, name-only people, the 9 birth-detail consumer guards:** `myPeopleDb`, `myPeopleSwitchRollbackDb`.
- **Panchang and time-recommendation ranking, planning and Day Constructor:** the unchanged existing suites in both jobs. No ranking or scheduling code changed.

## 7. Files changed in R2

- `apps/web/components/PeopleView.tsx` (F1)
- `apps/web/prisma/migrations/0056_my_people_foundation/migration.sql` (F4)
- `test/myPeopleR2Db.test.ts` (new)
- `test/peopleViewNullChartJsdom.test.ts` (one defect-pinning assertion replaced)
- `.github/workflows/ci.yml` (one step)
- design and ticket notes, and this handover

## 8. Final results

- **Unchanged R1 `3e6bce5`:**
  - witness **0/9**, so F1 and F4 are reproduced;
  - R2 suite: 23 FAIL.
- **R2 implementation head `831f38b`:**
  - witness **9/9**;
  - R2 suite 60/60;
  - negative controls fail as intended: NC1a 6, NC1b 14, NC2 7;
  - local CI steps 245/245 + 78/78;
  - build and 5 checks pass; typecheck clean;
  - 0055/0056 compatible in both orders, with legacy rows preserved.
- **PR CI:** triggered automatically by the push of these commits, not rerun deliberately. Results are in the closing report.
- **Status: MP-1 R2 READY FOR INDEPENDENT VERIFICATION.**

## 9. Evidence checksums

`AURA_MP_1_R2_EVIDENCE/SHA256SUMS.txt` covers every evidence file. It is untracked, so the PR head is not moved by evidence. Verify with:
```
cd .claude/worktrees/aura-mp-01 && shasum -a 256 -c AURA_MP_1_R2_EVIDENCE/SHA256SUMS.txt
```
The SHA-256 of `SHA256SUMS.txt` itself is reported in the closing report.
