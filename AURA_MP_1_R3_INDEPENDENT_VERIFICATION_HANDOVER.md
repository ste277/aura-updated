# AURA-MP-1 R3: independent verification handover (62011, after the 62010 NO-GO)

| | |
|---|---|
| **PR** | [ste277/aura-updated#400](https://github.com/ste277/aura-updated/pull/400). Open, unmerged. Auto-merge **off**, Auto-fix **off** |
| **Reviewed (62010)** | R2 implementation `831f38b661e7e1acc8102cc02bba0df4133bc969`, R2 handover `72ca7b90978cf9a21df7840853047b5a68e1742d` |
| **R3 head** | The single commit that adds this file. Implementation, tests, CI step and this handover are in **one** commit, so there is no docs-only commit. The exact SHA is in the closing report and `ci_*` evidence |
| **Integration** | GitHub's automatic test merge of the R3 head into current `main` (`refs/pull/400/merge`). The branch is **not** synchronized. The exact base and commit are in the closing report and evidence |
| **Scope** | The one remaining blocker: the Add Person form made the optional birth city mandatory. No migration, Prisma schema or API change (0056 is byte-identical, SHA-256 `4f40cee7…5dc2`) |
| **Not done (by instruction)** | No MP-2, redesign, dependency, migration amendment, branch sync, deliberate CI rerun, merge, deployment, Production access or activation |
| **Evidence** | `AURA_MP_1_R3_EVIDENCE/` (SHA256SUMS in §8) |

> **62010 disposition:** not available to this session; it is not in the repository, the worktrees, the evidence folders or the PR. The work follows the cases named in 62011.
>
> **PR #401 (AUTH-SESSION I1):** still OPEN, not merged, so no guard reconciliation was due. The second-merge requirement is retained (§6).

## 1. The defect, reproduced on unchanged R2 (`r3_witness.ts`, real form + real API + disposable Postgres)

| Check | R2 `831f38b` | R3 |
|---|---|---|
| Add form has an independent birth-timezone control | **FAIL**: none | PASS |
| Disabled: Add with date + time + timezone and no city | **FAIL**: UI blocks ("Choose a birth location."), no request | PASS (201, no city/coordinates) |
| Disabled: the API accepts the equivalent request | PASS (201) | PASS |
| Enabled: Add with only a name | **FAIL**: UI blocks | PASS (201, no birth info) |
| Enabled: date + time + non-default timezone (Europe/London), no city | **FAIL**: UI blocks | PASS |
| Enabled: the API accepts a name-only request | PASS | PASS |
| **Total** | **2/6** (only the two API checks) | **6/6** |

**Coverage gap reproduced:** with R2's implicit Add default city (Chennai) reintroduced, R2's own suites still pass (`myPeopleR2Db`, `peopleViewLegacyEditorDb`, `peopleViewNullChartJsdom`), because none of them covered creation. File: `coverage_gap_repro_r2_default_city.txt`.

## 2. Correction (`apps/web/components/PeopleView.tsx` only)

- **Independent timezone control:** a new "Birth time zone" select lists the platform's IANA zones. Choosing a city **pre-fills** that city's timezone and supplies its coordinates. Choosing "No city" keeps the timezone. A timezone chosen after a city wins. No city is ever needed to supply a timezone.
- **Create (`buildPersonCreatePayload`):**
  - Name and relationship are always sent.
  - Birth information is sent only if the user entered any of it, and then as the full date + time + timezone trio, plus an **explicitly** chosen city's name and coordinates.
  - **Server enabled:** a name-only person is valid.
  - **Server disabled:** the legacy contract requires the trio, and the UI says so.
  - Nothing is pre-selected: no timezone, no city.
- **Edit (`buildPersonEditPayload`, R2 behaviour kept):**
  - The timezone and city are now part of change detection.
  - A person without a chart can gain one without a city.
  - A saved city can be cleared while keeping date, time and timezone.
  - Changing only the timezone keeps the saved city and coordinates.
  - All other R2 rules are unchanged: only changed fields are sent, the untouched location comes from the original record, and an unchanged save sends nothing.
- **Contract:** the API contract and the all-or-none validation are unchanged. The client refuses incomplete charts before any request, and the server still refuses them independently (F3, closed).

## 3. Regression suite `test/myPeopleR3Db.test.ts`: 40 checks, real form + real API + real Postgres, wired into CI

Each case asserts the **exact payload keys and values** and the **persisted record**. It runs with the server **enabled** and **disabled**:
- Add form opens with no timezone and no city pre-selected.
- Name-only / no birth information: enabled → 201, nothing persisted beyond name and relationship; disabled → refused in the UI with a clear message.
- Date + time + timezone without a city.
- An explicit non-default timezone (Pacific/Auckland) without a city.
- An explicit city (Mumbai: its coordinates and timezone).
- Changing the selected city (Chennai → London: no trace of Chennai).
- Clearing a selected city while keeping the timezone it filled in.
- An explicit timezone after a city (Mumbai + Asia/Dubai).
- Refusals before any request: date only; date + time without a timezone; timezone only; city only; time without a date. Also API refusals of an impossible date and an incomplete trio.
- **Edit:**
  - adding a chart without a city;
  - changing only the timezone (saved Naperville kept);
  - re-selecting the same timezone sends no request;
  - clearing the saved city keeps date, time and timezone.
- **No implicit location:** the only persisted cities are the explicitly chosen ones; Chennai is never persisted by default.

| Run | Result | File |
|---|---|---|
| R3 suite on R3 | **40/40** | `r3_suite_on_r3.txt` |
| R3 suite on unchanged R2 | **31 FAIL** | `negative_control_r3_suite_on_R2_831f38b.txt` |
| **NC1**: birth city made mandatory again | **16 FAIL** | `negative_control_NC1_city_mandatory_again.txt` |
| **NC2**: implicit Add default city restored | **11 FAIL** | `negative_control_NC2_implicit_add_city_default.txt` |
| **NC3**: missing location replaced with the default city + coordinates | **13 FAIL** | `negative_control_NC3_default_coordinates_for_missing_location.txt` |
| **NC4**: timezone made dependent on the city | **16 FAIL** | `negative_control_NC4_timezone_dependent_on_city.txt` |

After each mutation the file was restored and verified with `cmp`, and the final SHA-256 is identical to the pre-mutation hash (`negative_controls_restore_log.txt`, `PeopleView_r3_pre_mutation.sha256`).

## 4. Closed findings still protected

| Protection | Evidence |
|---|---|
| R2 F1: unrelated edits preserve the saved chart, custom city and timezone; missing optional fields stay absent; unchanged saves send nothing; explicit birth edits keep untouched information | `myPeopleR2Db` **60/60**, unchanged; `peopleViewNullChartJsdom` and `peopleViewLegacyEditorDb` pass |
| F2, F3, F5; F4 concurrency, limits and Gregorian CHECKs; owner isolation; atomic deletion; historical plans; the 9 birth-detail consumer guards | `myPeopleR1Db`, `myPeopleDb`, `myPeopleSwitchRollbackDb`, `myPeopleRequest`, `myPeopleR2Db` (SQL matrix), all passing in the full local runs and in CI |
| Panchang and planning | No ranking, scheduling or planning code changed; the existing suites pass |
| No existing assertion weakened | R3 adds a test file and changes no existing assertion |

| Full run | Result | File |
|---|---|---|
| `math-core-tests`, every CI step with its `env:` | **245/245 PASS** | `local_ci_math_core_tests_all_steps.txt` |
| `day-constructor-acceptance-db-tests`, every step, fresh DB | **78/79**, the R2 and R3 suites included. The one failure, `weeklyPlanReviewClientDb` setup check 8, is **pre-existing and time-of-day dependent**: its fixture adds 4 h to an evening slot and crosses local midnight. It fails identically on unchanged R2 at the same minute (18:44 IST), and its file has not changed since #289. Not touched (`preexisting_weeklyPlanReviewClientDb_time_of_day.txt`) | `local_ci_day_constructor_db_all_steps.txt` |
| `next build` (CI env) + 5 bundle/standalone checks | **build exit 0; 5/5 checks exit 0**; all 5 `/api/people*` routes ƒ | — |
| Real browser (built-in browser, production standalone build, local scratch DB) | **Server enabled:** the form opens with no timezone and no city selected; name-only → 201; date + time + America/Chicago, no city → 201. **Server disabled:** the date, time and timezone trio is required and the city is not; name-only is blocked by browser validation (no POST); date + time + Europe/London, no city → 201. All records match, and none has a Chennai city | `browser_creation_check.txt` |

## 5. Migration

**No migration change.** `0056_my_people_foundation/migration.sql` is byte-identical to R2 (SHA-256 `4f40cee79aa29f43e370b34b23b1ee54534f63ddea6b5663fd0728291bd95dc2`), and `apps/web/prisma` has no diff against `72ca7b9`. The R2 compatibility results with `0055_auth_session` in both orders therefore still apply.

## 6. AUTH-SESSION I1 (PR #401): second-merge reconciliation, retained

#401 is **OPEN** (head `8419631`) and has not merged, so nothing is due now. Whichever of #400 and #401 merges second must update all three exact-name migration guards (PREF-01 11o, MR3 G12, INS-01 S9) to allow **both** `0055_auth_session` and `0056_my_people_foundation`.

## 7. Files changed in R3

- `apps/web/components/PeopleView.tsx` (the correction)
- `test/myPeopleR3Db.test.ts` (new)
- `.github/workflows/ci.yml` (one step)
- short notes in the design and ticket documents
- this handover

## 8. Evidence checksums

`AURA_MP_1_R3_EVIDENCE/SHA256SUMS.txt` covers every evidence file. It is untracked. Verify with:
```
cd .claude/worktrees/aura-mp-01 && shasum -a 256 -c AURA_MP_1_R3_EVIDENCE/SHA256SUMS.txt
```
The SHA-256 of `SHA256SUMS.txt` itself is reported in the closing report.

**Status: MP-1 R3 READY FOR INDEPENDENT VERIFICATION** (subject to the naturally triggered CI reported in the closing report).
