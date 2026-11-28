# AURA-MP-4 — Relationship Rhythms (62025)

MP-4 implements design §6.2, D7 and D8/R1 of `AURA_MP_01_PRODUCT_AND_ARCHITECTURE_DESIGN.md`. It sits behind the existing switches (`AURA_MY_PEOPLE_ENABLED` and `NEXT_PUBLIC_AURA_MY_PEOPLE`), so it is off in Production.

## What it adds
- **"Keep in touch" on a person's page:**
  - **Activities:** Call, Visit, Dinner, Time together or Walk, each mapped to an existing catalog activity (no new catalog entries, so recommendation ranking is unchanged). The user can edit the default name, for example "Call Amma".
  - **Cadence:** once to 7 times a week.
  - **Goal:** either a **new visible goal** whose editable title defaults to "Stay close to {name}", or an **existing active goal** the user picks.
  - Nothing is created until **Save**. Adding or editing a person never creates a goal or a rhythm.
- **Lifecycle:** pause, resume, edit and remove use the existing Life Rhythm routes (`/api/goals/:goalId/activities/:id/rhythm` and `/dismiss`). Remove keeps the row as DISMISSED history.
- **Scheduling:** the existing weekly suggestions, Plan and Plan My Day handle availability, Daily Rhythm preferences, Panchang ranking and the user's explicit confirmation. MP-4 has no scheduling engine of its own, and the copy says to check the time with the person.
- **Person link:** a plan made for a person-linked rhythm carries the person (`carryGoalActivityPersonToPlan`, called by both planning transactions), and Move then keeps it (MP-3).

## Data: migration 0058 (additive)
- **Column:** `GoalActivity.savedPersonId` (nullable). Existing rows stay NULL, with no backfill.
- **Foreign key:** composite `(savedPersonId, userId) → SavedPerson(id, ownerUserId)`, which enforces the same account at the database level, following the PersonOccasion pattern.
  - It is **ON DELETE NO ACTION**, so a person delete that skips the pause step fails instead of leaving an unlinked rhythm running.
  - It also needs no PG15-only column-list SET NULL.
- **Index:** one partial index on linked rows.
- **0057 is reserved for AUTH-SESSION I2.** Migration guards 11o, S9 and G12 now also list only 0058. Whichever of #407 or this PR merges second reconciles those three lines.

## Integrity
- **Person deletion** (`deleteSavedPerson`, one READ COMMITTED transaction):
  - order: person FOR UPDATE, then the person's special days, then their rhythms, which are **paused and unlinked**;
  - then the delete itself, whose cascade clears plan links;
  - the goal, occurrences and plans are kept.
- **Lock order is person before rhythm before plan everywhere:**
  - rhythm creation takes FOR KEY SHARE on the person first;
  - both planning transactions call `lockLinkedPeopleForGoalActivities` before the Goal lifecycle lock.
  - Resume and edit lock only the rhythm row and never the person.
- **Not changed:** the MP-3 lock order (Move and Recomposition) and its READ COMMITTED guarantees.

## R1 — focused corrections (62029)
- **F1 (D7):** a resume or edit no longer undoes a concurrent person deletion. `updateGoalActivityRhythmSettings` now:
  - reads the person link before taking the row lock and again under it, at an explicit READ COMMITTED;
  - answers **409 `PERSON_LINK_CHANGED`** and writes nothing if the link vanished in between, or if it differs from the `savedPersonId` My People sends.
  - The rhythm therefore stays paused and its plans are refused.
  - Deliberately resuming a rhythm that was already unlinked (from Goals) still works, and unrelated rhythms behave as before.
- **F2:** Plan and Plan My Day success responses return the committed `savedPersonId`, because `carryGoalActivityPersonToPlan` now returns the updated row.
- **Unchanged:** migration 0058, the lock order, weekly acceptance and Move.

## Tests
| Test | Job | Checks |
|---|---|---|
| `test/myPeopleMp4Rules.test.ts` | math-core | 10 |
| `test/myPeopleMp4RhythmsDb.test.ts` | Day Constructor DB | 42: migration, ownership (API and FK), lifecycle, carry and Move, deletion, both orderings of person DELETE vs creation, planning, resume and edit (final state paused, planning refused), atomicity, isolation, switch |
| `test/myPeopleMp4UiDb.test.ts` | Day Constructor DB | 13: the real person screen, explicit create and attach, pause, resume, edit and remove, switch off |
