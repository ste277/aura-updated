# AURA-MP-1 R4: form contract and chart preservation (62014)

Handover for independent verification **62015**. R4 answers the 62012 NO-GO on reviewed head `4afc2f53347c6496459eb0465e952200b1db76c1` (integration `33995ad28d967e9f2d157061ff85a355b078988d`).

- **Changed:** the People Add/Edit form only (`apps/web/components/PeopleView.tsx`), plus tests and one CI step.
- **Unchanged:**
  - the API and its validation;
  - `lib/`, the routes, the Prisma schema and migrations;
  - migration 0056, byte-identical (SHA-256 `4f40cee79aa29f43e370b34b23b1ee54534f63ddea6b5663fd0728291bd95dc2`).
- **Inputs:**
  - The 62012 disposition and its evidence were read from the owner's Product Onboarding workspace (`AURA_MP_1_R3_INDEPENDENT_DISPOSITION_62012.md`, `AURA_MP_1_R3_INDEPENDENT_EVIDENCE_62012/`). They are outside this repository and are not copied here.
  - No 62012 material was unavailable.

## 1. Original failing witnesses (Chromium, production standalone build, real API, disposable PostgreSQL 16)

`AURA_MP_1_R4_EVIDENCE/r4_browser_witness.cjs` works on any checkout:
- It builds nothing itself. You give it a checkout that already has a production build.
- It starts that checkout's standalone server twice: once with the server switch on, once with it off.
- It drives the real form in Chromium (Playwright 1.62.1).
- It records every POST and PATCH body with its HTTP status, then reads the persisted row.
- Every check asserts the **correct** behaviour, so a check fails on an affected head.

| Head | Result | Detail |
|---|---|---|
| R3 `4afc2f5` | **0/5** (`witness_BEFORE_r3.txt`) | **P3:** PARTNER is shown, sent and persisted. **P2** (both switch states): POST → **400** with `UTC` + Mumbai 19.076/72.8777. **P1** (both states): the edit payload is only date/time/timezone, and the coordinates become NULL |
| R2 `831f38b` | 2/5 (`witness_BEFORE_r2.txt`) | P1 passes in both states (R2 preserved cityless coordinates, so this is an R3 regression). P3 fails (PARTNER default, inherited from earlier rounds). P2 is not applicable, because R2 has no timezone control |
| **R4** (this head) | **5/5** (`witness_AFTER_r4.txt`) | All three findings hold in both switch states |

The witness also records the API facts. The API is unchanged, and a separate server run gives:
- `UTC` without coordinates → **201**;
- `UTC` with coordinates → **400**;
- `Etc/UTC` with coordinates → **201**.

## 2. Root causes

| Finding | Root cause (R3) |
|---|---|
| **P1:** coordinates erased | `buildPersonEditPayload` and the editor's initial location used `original.birthCityName` alone to decide whether a saved location existed. A record holding coordinates but no city was treated as "no location". A chart edit then sent the trio with no coordinates, and the API's all-or-none chart write cleared them |
| **P2:** UTC + location → 400 | The API rule is `validateChart` → `isValidCustomLocation` → `isValidIanaTimezone`. Coordinates need a **region** timezone, meaning one containing `/`. A bare `UTC` passes `Intl` on its own, which is why UTC without coordinates gives 201. `timezoneOptions` added a bare `'UTC'` explicitly, and the form never checked the combination |
| **P3:** implicit PARTNER | The Add form initialised `relationshipType` to `'PARTNER'` and had no "not specified" option. `buildPersonCreatePayload` always sent the field |

## 3. Corrections (`apps/web/components/PeopleView.tsx`, about 60 lines net)

- **P1:**
  - New `hasSavedLocation(original)`: a saved location is a saved city **or** a saved latitude/longitude pair, on a record with a chart.
  - The Edit form's initial location and the edit payload's "untouched" comparison both use it.
  - The saved-location option is labelled with the city, or "Saved coordinates (lat, lng)" when there is no city.
  - Explicit clearing ("No location") stays distinct, and is the only way coordinates are removed.
- **P2:**
  - The timezone list offers region zones plus `Etc/UTC`; the bare `UTC` is canonicalised to `Etc/UTC`.
  - A saved non-region zone, such as a legacy `UTC` record, is still shown, so it is never silently replaced.
  - `chartFromValues` refuses a location combined with a non-region zone **before any request**, with an actionable message: *"The time zone "UTC" can't be saved with a birth location. Choose a region time zone (for example Etc/UTC), or choose No location."*
  - Nothing is erased, substituted or defaulted, and server validation is unchanged.
- **P3:**
  - Add starts at "Not specified" (value `''`).
  - An untouched relationship is **omitted** from the POST, so the API default `OTHER` applies.
  - An explicit selection is sent.
  - Edit has no "Not specified" option and shows the saved relationship. The R1 rule still applies: the field is sent only when changed.
  - With the switch disabled, the legacy options are kept.

### Add/Edit field-handling contract (one rule set, both switch states)

| State | Add | Edit |
|---|---|---|
| **Untouched** | Field omitted, so the API default applies: relationship `OTHER`, no chart, no location | Field omitted. The record is unchanged |
| **Explicitly changed** | Sent | Sent. A change to date, time, timezone or location sends the full chart, with the **untouched location taken from the saved record** (city and/or coordinates) |
| **Explicitly cleared** | n/a | "No location" clears city **and** coordinates and keeps the chart. Clearing date or time on a chart person is refused |
| **Missing optional** | City/location optional. A name-only person needs the server switch enabled; disabled keeps the legacy chart-required rule | Same rules. A chart can be added to a name-only person |
| **Persisted values** | n/a | Shown as saved, including cityless coordinates, unlisted cities and legacy `UTC` |
| **API defaults** | Relied on, never imitated in the form | — |
| **Invalid combinations** | Partial chart, or location with a non-region zone: refused before any request, with a message | Same |
| **No-change save** | — | No request is sent |

## 4. Regression results (all local; disposable Postgres 16, port 55491)

- **New `test/myPeopleR4Db.test.ts`: 85/85** (`r4_suite_on_r4.txt`). It uses the real form (jsdom), the real route handlers and the real DB, in both switch states. It covers every case listed in 62014:
  - name-only creation and an untouched relationship;
  - every explicit relationship for each state;
  - birth details without a city or coordinates;
  - coordinates without a city;
  - a city with coordinates, plus custom and unlisted locations;
  - `Etc/UTC`, Mumbai then `Etc/UTC`, `Australia/Adelaide` and a saved `UTC`;
  - edits to only date, time or timezone, and to unrelated name or relationship;
  - an explicit city change, explicit city clearing and explicit coordinate clearing;
  - incomplete and invalid combinations;
  - no-change saves and reopening a saved profile;
  - notes and interests surviving every operation;
  - a final check that no PARTNER or Chennai value was implied.
  - Payload keys, HTTP status and the persisted record are checked exactly.
- **Negative controls** (`r4_negative_controls.py` → `negative_controls_r4.txt`). Each R3 defect was restored in a mutated `PeopleView.tsx`, and the R4 suite **detected all three**:
  - NC-P1: 12 failing checks;
  - NC-P2: 10 failing checks;
  - NC-P3: 8 failing checks.
  - The file was then restored byte-identical (SHA-256 checked).
- **`test/myPeopleR3Db.test.ts`:** two exact-key lists dropped `relationshipType`. Those lists had pinned the implicit PARTNER default, which is defect P3. Every other R3 assertion is unchanged.
- **R4 suite on the unchanged R3 head `4afc2f5`:** 30 checks fail, 55 pass (`r4_suite_on_unchanged_r3.txt`).
- **Original R2→R3 mandatory-city witness** (`AURA_MP_1_R3_EVIDENCE/r3_witness.ts`) on R4: **6/6** (`r3_mandatory_city_witness_on_r4.txt`).
- **Full local Day Constructor DB job, every step with its CI env: 80/80** (`local_dbjob_r4.txt`). This includes:
  - My People DB, switch rollback, R1, R1 legacy editor, R2, R3 and R4;
  - SavedPerson DB;
  - Weekly Plan Review client DB.
- **Full local math-core job: 245/245** (`local_mathcore_r4.txt`). This includes the MP-1 request test, the People null-chart jsdom test and the SavedPerson tests.
- **`tsc --noEmit`:** clean.
- **Production build:** succeeds, with all 5 bundle and standalone checks (palmistry, palm-engine, palm-e1, artifact-startup, standalone-oauth) passing.

## 5. Preserved

- **Earlier rounds:**
  - F1–F5 corrections;
  - owner isolation, limits and concurrency;
  - Gregorian CHECK;
  - export and atomic deletion;
  - historical plans;
  - SavedPerson compatibility;
  - Panchangam and scheduling consumers.
- **Unchanged code:** API, `lib/`, schema and migrations are untouched.
- **Earlier handovers and evidence:** R0–R3 handovers, evidence folders and checksums, and the 71044 integration addendum, all unchanged.
- **Original R2→R3 mandatory-city witness:** still holds (closing report).
- **AUTH-SESSION:** PR #401 is not incorporated.

## 6. Remaining limitations and requirements

- **PR #401 second-merge reconciliation (mandatory):** whichever of #400 and #401 merges second must update PREF-01 11o, MR3 G12 and INS-01 S9 to allow both `0055_auth_session` and `0056_my_people_foundation`. #401 is OPEN at `696e584`, a newer head than the `92c3a26` seen by 62012.
- **Legacy bare-`UTC` records stay as they are:**
  - They remain editable without a location.
  - Adding a location requires choosing a region zone.
  - No data migration is made, by design.
- **Chromium production-build coverage is targeted.** It covers the three findings in both states. The full case matrix runs on the real form in jsdom, the CI harness used for all MP-1 form suites.
- **Not done:** no merge, deployment, Production database access or activation. Auto-merge and Auto-fix are off. My People stays disabled in Production (`AURA_MY_PEOPLE_ENABLED` is unset).
