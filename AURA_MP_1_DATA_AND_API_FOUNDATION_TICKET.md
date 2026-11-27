# AURA-MP-1 — My People: Data and API Foundation

| | |
|---|---|
| Status | **IMPLEMENTED (2026-11-27), awaiting independent verification.** HOLD lifted 2026-11-27 after REL-05 (ticket 62005). Merge and deployment need separate approval. My People stays **off** in Production. Handover: [AURA_MP_1_INDEPENDENT_VERIFICATION_HANDOVER.md](AURA_MP_1_INDEPENDENT_VERIFICATION_HANDOVER.md) |
| Design | [AURA_MP_01_PRODUCT_AND_ARCHITECTURE_DESIGN.md](AURA_MP_01_PRODUCT_AND_ARCHITECTURE_DESIGN.md). Decisions D1–D10 + R1–R3 approved 2026-11-26 |
| Base | Current `main` at start time, in its own worktree and branch, delivered as a PR. Not part of REL-05 |
| Size | One PR, about 1 migration + ~8 files changed + ~6 test files |
| Out of scope | New My People screens, Home card, catalog entries, Plan/Find a Time linking UI, GoalActivity link (MP-4), MCP, push, account deletion, contact import, invitations, sharing, scoring |

## Goal

Make a person **name-only-capable and special-day-aware** at the data and API level. Every existing screen, API and consumer must keep working with the switch **on or off**, and no saved data may ever be lost.

## Scope

### 1. Migration `0056_my_people_foundation` (additive only)

The number was coordinated at start: 0054 is the latest on `main`, and 0055 is reserved for AUTH-SESSION-01 I1, so My People uses 0056. A later 0055 still applies cleanly after 0056 (verified with `prisma migrate deploy` and `migrate status`; see the handover).

- **`SavedPerson`:**
  - `birthDate`, `birthTime`, `birthTimezone` `DROP NOT NULL`, plus an all-or-none CHECK on the three.
  - Add `relationshipLabel TEXT`, `locationName TEXT`, `timezone TEXT`, `interests TEXT[] NOT NULL DEFAULT '{}'`, `notes TEXT`.
  - Add `UNIQUE (id, "ownerUserId")` as the target of the composite FK below.
- **`PersonOccasion` (new table):**
  - Columns: `id`, `ownerUserId`, `savedPersonId`, `kind`, `label`, `calendar TEXT NOT NULL DEFAULT 'GREGORIAN'`, `month INT`, `day INT`, `year INT`, `remindDaysBefore INT DEFAULT 7`, `createdAt`, `updatedAt`.
  - Composite FK `("savedPersonId","ownerUserId") → "SavedPerson"(id,"ownerUserId") ON DELETE CASCADE`.
  - CHECKs: `calendar IN ('GREGORIAN')`, and `calendar <> 'GREGORIAN' OR (month BETWEEN 1 AND 12 AND day BETWEEN 1 AND 31)`. Written so a future calendar type only widens the CHECK (R3).
  - `kind IN ('BIRTHDAY','ANNIVERSARY','OTHER')`, and `remindDaysBefore IS NULL OR remindDaysBefore BETWEEN 0 AND 30`.
  - Partial unique index: one `BIRTHDAY` per person.
  - Index on `(ownerUserId)`.
- **`PlannedActivity`:** add `savedPersonId TEXT REFERENCES "SavedPerson"(id) ON DELETE SET NULL`, with an index on `("userId","savedPersonId")`. It is only written from MP-3 onwards.
- Update `schema.prisma` to match. No backfill. Validate in the `db-migration-validation` job.

### 2. Validation: `lib/savedPersonRequest.ts`
- **Name:** required, trimmed, 1–80.
- **Everything else optional:**
  - `relationshipType` adds PARENT, CHILD and SIBLING, with no default preselection in new clients;
  - `relationshipLabel` ≤40;
  - `locationName` ≤80;
  - `timezone` must be a valid IANA zone;
  - `interests` ≤10 × ≤40;
  - `notes` ≤1000.
- **`chart`:** a whole object `{birthDate, birthTime, birthTimezone, birthCityName?, birthLatitude?, birthLongitude?}`, or `null` to clear it. A partial chart object → 400. The legacy flat body (chart fields at top level) is still accepted.
- **Special-day validation:**
  - `month`/`day` must be a valid date for that month, with 29 Feb always allowed;
  - `year` 1900–current, and it must be a leap year when the date is 29 Feb;
  - `label` is required for OTHER;
  - limits: ≤10 special days per person, ≤200 people per account.

### 3. Data access: `lib/db.ts` (raw SQL, owner-scoped like today)
- **`updateSavedPerson` becomes partial.** It builds its SET list only from the keys present. A **chart is never touched unless `chart` is in the input**; then it is replaced whole or cleared whole.
- **Special-day CRUD:** every query filters on both `"ownerUserId"` and `"savedPersonId"`.
- **`deleteSavedPerson` runs in one transaction**, using the existing `pool.connect()` + `BEGIN` idiom (`db.ts:47`):
  1. `SELECT … FOR UPDATE` the person by `(id, ownerUserId)`. If there is no row → "Person not found." (404).
  2. `UPDATE "User" SET "dayBuilderPriorityPersonIds" = array_remove(…, $id)`.
  3. `DELETE FROM "DayBuilderDismissal" WHERE "userId" = $owner AND "personId" = $id`.
  4. `DELETE FROM "ReminderAttention" WHERE "userId" = $owner AND "scheduledItemType" = 'PERSON_OCCASION' AND "scheduledItemId" IN (that person's special-day ids)`.
  5. `DELETE FROM "SavedPerson"`. Special days cascade; `PlannedActivity` and `AuraMoment` links are set to null.
  6. `COMMIT`. Any error → `ROLLBACK`, and nothing changes.
- Add `listAllSavedPeopleForExport(ownerUserId)`, which returns people with their special days.

### 4. Pure date logic: `lib/personOccasions.ts`
- `nextOccurrence(occasion, fromLocalDate, timezone)` branches on `calendar`; only GREGORIAN exists for now.
- Also provides `daysUntil` and `turning` (null when there is no year).
- 29 Feb falls on 28 Feb in non-leap years (D4). Calculations use civil dates in `User.timezone`.

### 5. Routes
- **`/api/people` and `/api/people/:id`:** follow the contract in design §4.1, with the switch-off behaviour in design §11.5.
  - `GET` adds `hasChartDetails`. Chart fields may be null.
- **New, switch-gated (404 when off):**
  - `POST /api/people/:id/occasions`
  - `PATCH` and `DELETE /api/people/:id/occasions/:occasionId`
  - `GET /api/people/occasions/upcoming?days=1–60`
- Cross-owner or missing ids → 404 everywhere.
- `/api/plans` accepts `savedPersonId` only when the switch is on. It is checked with `getSavedPersonForOwner` (404 if not the user's), and otherwise ignored.

### 6. Compatibility (always on)
- Add `natalContextForSavedPerson(person): NatalContext | null` in `lib/savedPersonNatalContext.ts`, then replace all 9 read sites with it:
  - `muhurtham-search/route.ts:108`
  - `timing-search/shared/route.ts:72`
  - `askAuraOrchestrator.ts:713, 884, 1006, 1435`
  - `savedPersonNatalContext.ts:39`
  - `dayBuilderOrchestrator.ts:297`
  - `PeopleView.tsx:216`
- The nullable types make the compiler find any other read site.
- **Shared Muhurtham** (route and Ask Aura): a person without chart details → **422 `CHART_DETAILS_REQUIRED`** with friendly copy, and the Muhurtham "Us" picker lists only `hasChartDetails` people.
- **Everyday shared timing and Day Builder** use a null partner context, which scores neutral, as they already do.
- **Day Builder** maps PARENT, CHILD and SIBLING to FAMILY (`lib/dayBuilder.ts:202`).
- **Legacy `PeopleView` is made null-safe:**
  - detail shows "No birth details" when chart is null (`:216`);
  - edit no longer requires chart fields for a person who has none, and does not send chart keys when they are left empty (`:283`, `:351–356`);
  - otherwise unchanged.

### 7. Switch: `lib/myPeopleGate.ts`
- `isMyPeopleEnabled(env = process.env)` is true when `NEXT_PUBLIC_AURA_MY_PEOPLE === '1'`, or when `NODE_ENV !== 'production'`.
- It is fail-closed in Production and read by both the routes and the client.
- What it gates, and what is always on, is listed in design §11.5. Leave it off in Production.

### 8. Privacy
- `/api/users/export` adds `people[]`: fields, chart (when present), special days, notes. It is owner-scoped and does not include derived natal context.
- Add `notes` to `FORBIDDEN_METADATA_KEYS` (`lib/productEvents.ts:283`). `SAVED_PERSON_CREATED` metadata gets `hasOccasion: boolean`. Names and notes are never logged.

## Acceptance criteria

1. **No regressions.** These suites pass unchanged against existing chart profiles:
   - SavedPerson request, DB and natal tests
   - muhurthamSearchApi, sharedMuhurtham, dayBuilderDb and dayBuilderOrchestrator
   - auraMomentsDb, askAuraOrchestratorDb and personalizedDailyStoryDb
2. **Partial update preserves chart details.**
   - A PATCH with only `name`/`notes` leaves all six chart fields byte-identical.
   - A partial chart object → 400.
   - `chart: null` clears all three required chart fields together.
3. **Name-only person (switch on).**
   - It is created, listed and fetched without errors.
   - Shared Muhurtham returns 422.
   - Everyday shared timing, Day Builder, Ask Aura (everyday) and Aura Moments succeed.
4. **Rollback (R2):** the three-step on → off → on test in design §11.5.
   - No 500s and no jsdom render crash of the legacy `PeopleView`.
   - Every field and special day is unchanged afterwards.
5. **Atomic delete.**
   - After deletion: no row in SavedPerson, PersonOccasion, `ReminderAttention(PERSON_OCCASION)` or `DayBuilderDismissal` for that person, and their id is not in `dayBuilderPriorityPersonIds`.
   - Plans and Moments still exist, with their links null.
   - An injected failure mid-transaction leaves everything unchanged.
6. **Isolation.** User B gets 404 and no change on every person and special-day route used with User A's ids, and `/api/plans` with A's `savedPersonId` → 404. A DB insert of a special day whose `savedPersonId`/`ownerUserId` pair doesn't match is rejected by the composite FK.
7. **Export.** User A's export contains exactly A's people, special days and notes, and none of B's.
8. **Date logic.** Unit tests cover: unknown year (no age), 29 Feb in a leap and a non-leap year, invalid dates (31 Apr), Dec→Jan rollover, and the user's midnight in a non-UTC timezone.
9. **Switch off.** The legacy contract holds (POST needs a chart, new keys → 400), new routes → 404, and `savedPersonId` on plans is ignored.
10. **CI.**
    - The migration passes `db-migration-validation`.
    - Each new test file has its own step in `.github/workflows/ci.yml`: DB tests in the Postgres job, jsdom tests with `tsconfig.jsdom-tests.json`.
    - Main CI is green.

## Proposed tests (new files)
- `test/savedPersonPartialUpdate.test.ts`
- `test/personOccasions.test.ts`
- `test/personOccasionsDb.test.ts`
- `test/savedPersonDeleteAtomicDb.test.ts`
- `test/myPeopleSwitchRollbackDb.test.ts`
- `test/peopleViewNullChart.jsdom.test.tsx`
- Extend `test/savedPersonDb.test.ts` (isolation) and the export tests.

## Constraints
- Do not touch Android, Palmistry, MCP, AUTH-01 or PREF-01 files.
- No dependency changes, no deploys, no Production access, and no applying the migration to any shared database.
- Panchang ranking weights are unchanged.
- No contact import, invitations, sharing, relationship scoring, or nagging copy.
- Account deletion is **not** in this ticket. It stays a platform-wide public-launch requirement, and the cascades above already cover My People.
