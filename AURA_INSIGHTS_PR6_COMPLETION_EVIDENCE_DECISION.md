# AURA — Insights V1 PR6 — Durable Completion Attribution — Architecture Decision V2

**Mode:** Read-only architecture audit. No implementation. No PR. No commits. No migrations.
**Baseline [VERIFIED]:** `HEAD == origin/main == 7e1358642b000c8aff4b1e4058ac906b5eaa4373`. Migration count: **48**. Working tree clean except the standing untracked files (now including the PR6 blocked-implementation report and this document's own predecessor). 46 worktrees present and untouched, including PR4's and PR5's. No destructive git command was run.

**The prior PR6 blocker report's findings are treated as established** (per this ticket's own Section A instruction) and are re-verified, not re-litigated, below: (1) `HabitLog` has no `plannedStartAt`-equivalent column, confirmed live by direct reproduction; (2) an orphaned (Plan-deleted) `HabitLog` cannot be distinguished Goal-linked vs. non-Goal using only its own existing fields, also confirmed live. Both facts are re-cited with their original line citations and are the two gaps this document designs a fix for.

Tags: **VERIFIED** (direct code/schema inspection or live reproduction), **INFERRED** (reasonable conclusion from verified facts), **RECOMMENDED** (proposal, not approved policy), **UNRESOLVED** (open question).

---

## 1. Executive Recommendation

**Option A — extend `HabitLog` with four additive, nullable, immutable-at-creation snapshot columns** (`originatingPlannedActivityId`, `scheduledStartAtSnapshot`, `completionAttribution`, `originatingGoalActivityExecutionId`), written inside `logPlannedActivity`'s own existing transaction, at the exact same moment the `HabitLog` row itself is already created. This closes both gaps the prior audit found, with the smallest possible schema footprint: one migration, one existing table extended, zero new tables, zero new write paths beyond widening two already-existing INSERT statements with already-known values.

This design is **DESIGN READY**. It is a genuinely narrow, single-PR-sized change: the write-side change is a precise, pre-generate-before-use reordering of one `randomUUID()` call (exactly mirroring the codebase's own existing `habitLogId = randomUUID()` precedent, `db.ts:1727`) plus four new columns on two already-executing INSERT statements; the read-side change is one additive, indexed, bounded `SELECT` against `HabitLog`, summed into the existing `confirmedCompleted` count. No existing reporting field changes meaning; no PR5 signal is touched.

---

## 2. Verified Current Write Path

**[VERIFIED]** Full re-trace of `logPlannedActivity` (`apps/web/lib/db.ts:1571-1847`), one `pool.connect()` transaction (`BEGIN` at 1574, `COMMIT`/`ROLLBACK` at 1839/1842):

1. `SELECT * FROM "PlannedActivity" ... FOR UPDATE` (1576-1579) — row lock.
2. Idempotent short-circuit: if `status==='LOGGED' && habitLogId` set, re-select and return the existing `HabitLog` unchanged (1583-1599) — no write.
3. Require `status==='UPCOMING'` (1601-1603).
4. Resolve Goal linkage (read-only): `GoalActivityOccurrence.plannedActivityId` first, `GoalActivity.plannedActivityId` fallback (1641-1653).
5. If Goal-linked: acquire `pg_advisory_xact_lock('goal-evidence:<userId>')` (1672), check for an existing `GoalActivityExecution` row (1681), resolve the completion requirement/value (1683-1699). **`executionWrite` is fully resolved here — well before the `HabitLog` INSERT.**
6. Read `User.latitude/longitude/timezone` (1720-1723).
7. **`habitLogId = randomUUID()`** (1727) — generated BEFORE the `HabitLog` INSERT, specifically so the value is available to pass into the SAME statement and into the following `PlannedActivity` UPDATE. **This is the exact precedent the new `originatingGoalActivityExecutionId` write needs to mirror.**
8. Derive `logTimestamp`/`activeWindow`/`logMinuteOfDay` from `completionInstant = new Date()` (1744-1750) — the real completion instant, independent of `plannedStartAt`.
9. **`INSERT INTO "HabitLog" (...)`** (1764-1781).
10. **`UPDATE "PlannedActivity" SET status='LOGGED', "loggedAt"=$3, "habitLogId"=$4, "updatedAt"=now()`** (1783-1792).
11. `UPDATE "Capture" ...` (1800-1804).
12. If Goal-linked: `UPDATE "GoalActivityExecution"` (existing execution, 1817-1820) **or** `INSERT INTO "GoalActivityExecution" (id=randomUUID(), ...)` (1830-1835) — **this is the FIRST point the execution's own id is generated for a brand-new completion, which is AFTER the `HabitLog` INSERT at step 9.**
13. `COMMIT` (1839).

**The one precise reordering this design requires**: step 5 already resolves whether this is Goal-linked and whether an execution row already exists. The new design pre-generates the execution id (`const goalActivityExecutionId = executionWrite ? (executionWrite.existingExecutionId ?? randomUUID()) : null`) immediately after step 5, uses it in the `HabitLog` INSERT at step 9, and passes that SAME value explicitly into the `GoalActivityExecution` INSERT at step 12 (replacing its own inline `randomUUID()`) for the first-time case. **No other reordering is needed** — this is a single, well-contained, generate-before-use change, not a restructuring.

### Facts confirmed for this document's own use

| Fact | Status |
|---|---|
| User ownership | `HabitLog.userId` / `PlannedActivity.userId` — direct, unambiguous |
| Plan identity | `PlannedActivity.id`, available throughout `logPlannedActivity` as `planId` |
| Scheduled timestamp | `plan.plannedStartAt` — read at step 1 (`FOR UPDATE` select), the plan's own CURRENT (post any prior Move) committed schedule |
| Completion timestamp | `completionInstant`, step 8 |
| Goal association | `goalActivity.id` (`executionWrite.goalActivityId`), resolved at step 4-5 |
| Goal occurrence association | `occurrenceId` (`executionWrite.occurrenceId`), resolved at step 4 |
| HabitLog identity | `habitLogId`, generated step 7 |
| Goal execution identity | Generated at step 12 today; **moved earlier** under this design |
| `clientRequestId` behavior | Not used by this path at all — idempotency here is structural (`status==='UPCOMING'` guard + `FOR UPDATE`), not client-key-based |

---

## 3. Existing Schema and FK Behavior

**[VERIFIED]**, re-confirmed from both the prior audit and this ticket's own fresh trace (no changes since).

- `PlannedActivity.habitLogId TEXT REFERENCES "HabitLog"(id) ON DELETE SET NULL` (migration `0013_planned_activities`) — a real Postgres FK, not represented as a Prisma `@relation`. Runs `PlannedActivity → HabitLog` only; `HabitLog` has no reverse column.
- `deletePlannedActivity`: `DELETE FROM "PlannedActivity" WHERE status IN ('LOGGED','CANCELLED')` (`db.ts:1555-1561`) — a true hard delete, no tombstone.
- `GoalActivityExecution.plannedActivityId` → `PlannedActivity`: `SetNull`. `GoalActivityExecution.goalActivityOccurrenceId` → `GoalActivityOccurrence`: `SetNull`. `GoalActivityExecution.goalActivityId` → `GoalActivity`: `Cascade` (dies only with its own Goal).
- `deleteGoal` is gated (`goalHasRetainedPlanLinkage`) — refuses whenever any `GoalActivityExecution` exists for the Goal. In practice, `GoalActivityExecution` rows are essentially never actually cascade-deleted via this path.
- `HabitLog` itself: no `DELETE FROM "HabitLog"` anywhere in the codebase (re-confirmed, zero matches); no `UPDATE "HabitLog"` either — insert-only.
- No account/user-deletion flow exists anywhere in this codebase today (`grep` for `DELETE FROM "User"`/`deleteUser`/`deleteAccount`: zero matches) — `HabitLog.user`'s own relation has no `onDelete` specified (Postgres default `NO ACTION`/`RESTRICT`), meaning a future account-deletion feature would already need to handle `HabitLog` deliberately, independent of anything in this design.

---

## 4. Storage Option Comparison

**[RECOMMENDED]**

| | Min. schema change | Reliable scheduled attribution | Goal/non-Goal distinction | PR3 compatibility | Reporting simplicity | Txn atomicity | Retry safety | Deletion behavior | Privacy | Migration/backfill safety |
|---|---|---|---|---|---|---|---|---|---|---|
| **A — Extend `HabitLog`** | 4 nullable columns, 1 table | Yes — snapshotted at completion | Yes — explicit 3-state + stable id | Full — reuses `GoalActivityExecution`'s own id, zero duplication | One additional indexed `SELECT`, same table already queried for personalization | Same transaction as the existing `HabitLog` INSERT — no new boundary | Unchanged — existing idempotent-retry already covers it | Unaffected — `HabitLog` already outlives Plan deletion today | No new descriptive content, only ids/timestamp/enum | Live-linked rows: safely backfillable. Already-orphaned legacy rows: `UNKNOWN_LEGACY`, explicit, bounded |
| **B — Extend `GoalActivityExecution` + new non-Goal equivalent** | A whole new model duplicating `HabitLog`'s own role for non-Goal completions | Yes, if designed carefully | Yes, by model choice alone | Redundant — re-implements what `HabitLog` already is | Two sources to reconcile instead of one | New transaction boundary to design from scratch | New idempotency scheme to design from scratch | New deletion policy to design from scratch | Duplicates personal content (title etc.) across two models | New backfill problem, not a smaller one |
| **C — Separate 1:1 attribution record keyed on `habitLogId`** | A new table, always 1:1, always written in lockstep with `HabitLog` | Yes | Yes | Full | A mandatory JOIN on every read, for data with no independent lifecycle | Same transaction, but now 2 INSERTs instead of 1 widened one | Same as A | Same as A | Same as A | Same as A |
| **D — Tombstone/archive `PlannedActivity`** | Touches the `PlannedActivity` model's own fundamental semantics; every existing query assuming "row exists ⇒ relevant" (Day Constructor blockers, Move conflict checks, `listPlannedActivitiesOverlappingRange`, etc.) needs auditing | Yes, trivially (the row itself survives) | Yes, trivially | Unaffected | Simpler reporting, much larger blast radius elsewhere | Unaffected | Unaffected | **Changes an existing, deliberate user-facing promise** ("clear old completed plans," `db.ts:1551-1554`'s own doc comment) | **Materially weakens deletion** — the user asked for removal and would get retention instead | N/A — this isn't the kind of change migrated incrementally, it's a behavior change |
| **E — No persistence change** | None | No — permanent gap | No — permanent gap | N/A | N/A | N/A | N/A | Unaffected | Unaffected | N/A |

**Recommendation: Option A.** It is strictly smaller than B or C (one table widened, not a new model), has no blast radius beyond `logPlannedActivity` and the one new reporting query (unlike D), and — unlike E — actually closes the gap. **C is rejected specifically because the four new fields have no independent lifecycle from `HabitLog` itself** (always written together, in the same transaction, never present without it) — splitting them into a second table buys nothing and costs a mandatory join on every read.

---

## 5. Proposed Minimal Schema

**[RECOMMENDED — candidate fields, not approved schema, per this ticket's own framing]**

```prisma
model HabitLog {
  // ...existing fields, unchanged...

  // PR6 candidate -- a plain value, deliberately NOT a live-cascading FK
  // (same "not a foreign key" precedent as activityId): must retain its
  // value even after the referenced PlannedActivity row is hard-deleted.
  originatingPlannedActivityId String?

  // PR6 candidate -- plan.plannedStartAt, snapshotted inside
  // logPlannedActivity's own transaction at completion time (the plan's
  // own CURRENT, post-Move, committed schedule -- never re-derived,
  // never backfilled from logTimestamp).
  scheduledStartAtSnapshot DateTime? @db.Timestamptz(3)

  // PR6 candidate -- explicit three-state, NULL = UNKNOWN_LEGACY (a row
  // written before this column existed, or whose attribution could not
  // be established) -- never silently treated as NON_GOAL.
  // 'GOAL_LINKED' | 'NON_GOAL'
  completionAttribution String?

  // PR6 candidate -- set only when completionAttribution = 'GOAL_LINKED'.
  // Plain value for the same survive-deletion reason as
  // originatingPlannedActivityId above (see §9 for the SetNull-vs-plain
  // tradeoff this audit leaves as a product decision).
  originatingGoalActivityExecutionId String?

  @@index([userId, completionAttribution, scheduledStartAtSnapshot])
}
```

Plus two raw-SQL indexes (matching this codebase's own established precedent of partial/defensive indexes living in migration SQL, not the Prisma DSL — e.g. `clientRequestId`'s own partial unique index):

```sql
-- Defensive backstop: one HabitLog per originating Plan per user. Not
-- load-bearing for correctness (idempotency is already structural, §6),
-- but costs nothing and matches clientRequestId's own precedent.
CREATE UNIQUE INDEX "HabitLog_userId_originatingPlannedActivityId_key"
  ON "HabitLog" ("userId", "originatingPlannedActivityId")
  WHERE "originatingPlannedActivityId" IS NOT NULL;

-- Speeds the reporting fallback's own NOT EXISTS correlated subquery
-- against PlannedActivity (no index currently exists on this FK column).
CREATE INDEX "PlannedActivity_habitLogId_idx"
  ON "PlannedActivity" ("habitLogId")
  WHERE "habitLogId" IS NOT NULL;
```

**Zero new tables. One migration. Fully additive — every existing row's four new columns are simply `NULL`.**

---

## 6. Attribution Identity Contract

**[VERIFIED/RECOMMENDED]**, answering Section D directly:

1. **Can one Plan create multiple HabitLogs?** **No.** The idempotent-retry short-circuit (`db.ts:1583-1599`) means a second Done-tap on an already-`LOGGED` plan never reaches the INSERT code path at all — structurally impossible, not merely guarded.
2. **Can retries create duplicates?** **No**, same reason.
3. **Can a Plan be completed twice?** **No** — `UPCOMING→LOGGED` is a one-way, guard-conditional transition; a second attempt hits the idempotent-retry path.
4. **Is `clientRequestId` sufficient?** **Not needed for this path.** `clientRequestId` protects the MANUAL-logging endpoint against network-retry ambiguity (the client doesn't know if its first request landed). `logPlannedActivity` doesn't need it — `planId` itself, combined with the `FOR UPDATE` lock and the `status==='UPCOMING'` guard, already provides equivalent protection, and the new columns inherit that same guarantee by being part of the same INSERT.
5. **Should originating Plan identity be unique?** **Yes, as a defensive backstop** (§5's partial unique index) — not load-bearing for correctness, which is already structural, but a standard, cheap, already-precedented safety net.
6. **How does a deleted Plan retain an authoritative relationship to its HabitLog?** It doesn't need to, after this change — the necessary facts are copied FORWARD onto `HabitLog` BEFORE the Plan can ever be deleted, exactly mirroring PR3's own `GoalActivityExecution` snapshot-at-creation pattern and PR2's `scheduledWeekStart` pattern. This is the SAME established idiom this codebase already uses twice, not a new one.
7. **How are Goal-linked completions excluded from the non-Goal fallback?** Directly: the fallback query filters `completionAttribution = 'NON_GOAL'` explicitly — `'GOAL_LINKED'` and `NULL` (`UNKNOWN_LEGACY`) are both excluded.
8. **What happens when Goal execution evidence also exists?** It is the SOLE representation for that completion in the fallback's own scope — `originatingGoalActivityExecutionId` is a stable, explicit pointer to the exact `GoalActivityExecution` row, eliminating the "no shared key found" gap the prior phase proved live. No double-count is possible because `'GOAL_LINKED'` rows never enter the non-Goal fallback query at all.

**Do not rely on matching titles, timestamps, or activity IDs alone — fully honored**: every piece of new evidence is a precise, explicit reference or snapshot value, never a correlation inferred from proximity.

---

## 7. Scheduled-Date Contract

**[VERIFIED/RECOMMENDED]**

**The snapshot moment is Done-tap time, reading the Plan row's own `plannedStartAt` at that instant** — which is already, by construction, "the final accepted schedule": if the Plan was Moved earlier, Move creates a NEW successor row (`planMove.ts`'s own `applyMoveWrites`) with its OWN `plannedStartAt`, and `logPlannedActivity` always operates on whichever row is CURRENTLY being completed. No Move-awareness logic is needed in the new write — it falls out naturally from where in the code this value is read (step 1's `FOR UPDATE` select, before any further mutation).

**Live-reproduced proof this closes the exact gap found**: the prior phase's reproduction scheduled a plan for `2026-09-01T04:00:00Z` and logged it on `2026-10-13T23:41:43Z` — a different calendar month. Under this design, `scheduledStartAtSnapshot` would correctly capture `2026-09-01T04:00:00Z` (read at Done-time from `plan.plannedStartAt`, which has not changed since creation in that scenario), regardless of how much later the Done-tap itself occurs.

**Explicitly never substituted**: `HabitLog.logTimestamp`, `HabitLog.createdAt` (doesn't exist as a separate field — `logTimestamp` already serves that role), `PlannedActivity.updatedAt`, or the user's current timezone at REPORT-read time — none of these feed `scheduledStartAtSnapshot`. The value is written once, from `plannedStartAt` directly, as a `Timestamptz` (an absolute instant, not re-interpreted through any timezone on read, matching `movedAt`/`DailyReflection.reflectionDate`'s own established convention).

---

## 8. Goal/Non-Goal Classification

**[RECOMMENDED]** Explicit three-state, stored as a nullable `String` column rather than a boolean, per this ticket's own instruction — `NULL` is never silently read as `NON_GOAL`:

- **`GOAL_LINKED`** — `executionWrite` was non-null at the moment of writing (i.e., the plan was resolved to a `GoalActivity`, Goal-linked, in the SAME transaction). `originatingGoalActivityExecutionId` is always set alongside.
- **`NON_GOAL`** — `executionWrite` was null (no Goal linkage resolved). `originatingGoalActivityExecutionId` is always `NULL` alongside.
- **`UNKNOWN_LEGACY`** (represented as a `NULL` `completionAttribution` column value) — any row written before this feature existed. The reader must treat this as a THIRD, distinct, excluded state — never coerced to `NON_GOAL`.

**Compatibility with PR3's `GoalActivityExecution` evidence**: total compatibility — this design adds no second completion/progress truth. `GoalActivityExecution` remains the sole authority for Goal progress values; the new `HabitLog` columns only ever POINT at it (via `originatingGoalActivityExecutionId`) for the narrow purpose of excluding it from a DIFFERENT metric's fallback count. **Never fabricates Goal progress from non-Goal evidence** — the reverse direction (deriving anything Goal-related FROM a `NON_GOAL`-classified row) is structurally impossible since that classification, by definition, never carries an execution reference.

---

## 9. Deletion and Privacy Policy

**[VERIFIED/RECOMMENDED]**

- `deletePlannedActivity`: unaffected — the new columns live on the independent, already-surviving `HabitLog` row, exactly like every existing `HabitLog` field already does.
- `deleteGoal`/`GoalActivity` deletion: `originatingGoalActivityExecutionId`, **if implemented as a real FK**, should use `SetNull` on `GoalActivityExecution` deletion — mirroring every other such FK in this schema (`plannedActivityId`, `goalActivityOccurrenceId` on the SAME `GoalActivityExecution` model). Since `deleteGoal` is already gated to refuse deletion while execution evidence exists, this branch is — like its siblings — structurally rare in practice, not a new risk. **UNRESOLVED, left as a product/implementation decision**: a plain (non-FK) value, like `originatingPlannedActivityId`, is also defensible — it would leave `completionAttribution='GOAL_LINKED'` permanently true with a now-dangling id after a (rare, gated) Goal deletion, which is honest ("this completion WAS Goal-linked, historically") but means the fallback-exclusion logic keeps correctly excluding it forever even though the Goal evidence itself is gone — arguably the MORE correct behavior (never re-counting a historically-Goal-linked completion as non-Goal), so this audit leans toward the plain-value option, consistent with `originatingPlannedActivityId`'s own reasoning, but flags it explicitly for confirmation.
- `HabitLog` deletion: no path exists today, unaffected by this design either way.
- **Account/user deletion**: no such flow exists in this codebase at all (§3). This design adds **zero new personal/descriptive content** — `originatingPlannedActivityId`/`originatingGoalActivityExecutionId` are opaque ids, `scheduledStartAtSnapshot` is a timestamp, `completionAttribution` is a three-value enum. None of these duplicate `activityTitle`/`notes`, which `HabitLog` already stores today, unaffected by this change. **Durable reporting evidence is explicitly NOT treated as permission to retain data past account deletion** — this design neither improves nor worsens whatever a FUTURE account-deletion feature would need to do with `HabitLog` as a whole; it is already in scope for that (unbuilt) feature regardless of this PR.
- **Minimal attribution metadata preferred over duplicating descriptions — fully honored**: no title, notes, or other descriptive text is newly stored; every new field is an id, a timestamp, or an enum.

---

## 10. Legacy and Backfill Policy

**[VERIFIED/RECOMMENDED]**

| Existing `HabitLog` case | `scheduledStartAtSnapshot` | `completionAttribution` | Classification |
|---|---|---|---|
| Linked to a STILL-LIVE Plan (`PlannedActivity.habitLogId` still points to it) | **DERIVABLE** — the live Plan's own `plannedStartAt` can still be read right now | **DERIVABLE** — the live Plan's own current Goal linkage can still be checked right now | **DERIVABLE, via a one-time, optional backfill script run at deploy time** (see below) |
| Deleted non-Goal Plan (orphaned, `logSource='AURA_PLANNED'`) | **NOT RECOVERABLE** — no live Plan to read, and `logTimestamp` is explicitly prohibited as a substitute | **NOT RECOVERABLE** — no live Plan, no shared key to any Goal evidence | **UNKNOWN_LEGACY, permanently** |
| Deleted Goal-linked Plan | **NOT RECOVERABLE**, same reasoning | **NOT RECOVERABLE** — even though `GoalActivityExecution` itself still durably exists, there remains NO reliable, non-fuzzy way to PAIR a specific orphaned `HabitLog` row with a specific surviving `GoalActivityExecution` row after the fact (live-reproven in the prior phase: "no shared key found") | **UNKNOWN_LEGACY, permanently — even though the OTHER evidence (`GoalActivityExecution`) survives independently and unaffected** |
| Standalone `HabitLog` (`logSource != 'AURA_PLANNED'`) | N/A — never had an originating Plan | N/A | **NOT APPLICABLE** — the fallback query must ALSO filter `logSource='AURA_PLANNED'` as an independent guard, never relying on the new columns alone to exclude these |
| Any row with ambiguous/partial new-column state (should be structurally impossible — all four new columns are always written together or not at all) | — | — | **NOT RECOVERABLE**, fail closed, same "partial snapshot throws" discipline `resolveOccurrenceLocalDateOrNull` already established |

**Do not backfill `scheduledStartAt` from `logTimestamp` — fully honored, no such path proposed.** **Do not infer Goal linkage from activity titles or proximity — fully honored.**

**Can live Plans be safely backfilled before future deletion?** **Yes — this is the one safe, RECOMMENDED, optional backfill**: a one-time script, run once at deploy time (not a schema migration, a data-population script), that finds every `HabitLog` row whose `id` is still referenced by a live `PlannedActivity.habitLogId`, and populates the four new columns by reading that STILL-LIVE Plan's own current `plannedStartAt` and Goal-linkage state — real, currently-existing ground truth, not fabrication. This maximizes future coverage (any of these Plans that get deleted LATER will already have correct attribution) without touching anything already-deleted.

**Explicit historical coverage boundary**: any `HabitLog` whose originating Plan was deleted BEFORE this feature's deploy (and before the above optional backfill runs) is a permanent `UNKNOWN_LEGACY` — a closed, non-growing set, exactly like `movedAt`'s own pre-migration-0046 gap. Every `HabitLog` created AFTER deploy is correctly attributed from the start.

---

## 11. Reporting Integration Design

**[RECOMMENDED]**

Preserves `GET /api/insights/reporting` entirely — `confirmedCompleted` keeps its exact existing name and meaning ("confirmed completions, attributed by scheduled date, within the requested range"), now simply more complete.

```sql
-- Authoritative live-Plan path: UNCHANGED, PR4's own existing query.
SELECT * FROM "PlannedActivity" WHERE "userId" = $1 AND "plannedStartAt" BETWEEN $2 AND $3;

-- NEW, additive fallback path:
SELECT count(*) FROM "HabitLog" hl
WHERE hl."userId" = $1
  AND hl."logSource" = 'AURA_PLANNED'
  AND hl."completionAttribution" = 'NON_GOAL'
  AND hl."scheduledStartAtSnapshot" BETWEEN $2 AND $3
  AND NOT EXISTS (
    SELECT 1 FROM "PlannedActivity" pa WHERE pa."habitLogId" = hl.id
  );
```

`confirmedCompleted` (the field PR4 already returns) = `summarizePlanningStatus(...).confirmedCompleted` (unchanged) **+** the new fallback count above.

- **Deduplication**: the `NOT EXISTS` clause excludes any `HabitLog` whose originating Plan still exists (already counted via the live path) — a completion can never appear in both counts.
- **Goal exclusion**: `completionAttribution = 'NON_GOAL'` — exact, explicit, no proximity matching.
- **Range filtering**: `scheduledStartAtSnapshot BETWEEN $2 AND $3` — the SAME two range parameters PR4's own query already receives, preserving the exact existing contract.
- **User isolation**: `WHERE hl."userId" = $1` — direct, unambiguous.
- **Indexes**: `@@index([userId, completionAttribution, scheduledStartAtSnapshot])` (§5) covers this query's own access pattern directly; the new `PlannedActivity.habitLogId` index (§5) keeps the `NOT EXISTS` subquery an index lookup, not a scan.
- **Bounded query count**: exactly ONE additional query per `GET /api/insights/reporting` call — no N+1, matching PR4/PR5's own established discipline.
- **PR5 signal eligibility**: **unaffected** — no PR5 signal reads `HabitLog` at all (confirmed by direct re-inspection of `improvementSignals.ts`/`improvementSignalsComposition.ts`); this change is isolated entirely to the `confirmedCompleted` metric.

---

## 12. Transaction/Concurrency Design

**[VERIFIED/RECOMMENDED]**

- **Repeated/concurrent Done requests**: unaffected — the existing `FOR UPDATE` row lock + idempotent-retry short-circuit already serializes this; the new columns are written as part of the SAME `INSERT INTO "HabitLog"` statement, inheriting the identical guarantee.
- **Transaction rollback**: if ANY later step in `logPlannedActivity` fails (e.g. the `GoalActivityExecution` insert), the WHOLE transaction rolls back, including the widened `HabitLog` INSERT — no new partial-write state is possible, since nothing about this design introduces a second transaction or a second statement outside the existing boundary.
- **HabitLog/Goal-execution insert failure**: unaffected, same rollback guarantee as today.
- **Plan deletion racing with Done**: structurally impossible to produce inconsistency — a row must be `LOGGED` (via Done, which this design doesn't change the locking of) before it is delete-eligible; any concurrent `deletePlannedActivity` attempt on the same row blocks on standard Postgres row-level locking until Done's transaction commits or rolls back, unchanged from today.
- **Move racing with Done**: unaffected — Move's own `FOR UPDATE` + `day-constructor-accept:<userId>` lock already serializes against a concurrent Done on the same row; this design touches no Move code at all.
- **API response failure after commit**: the data is already durably committed regardless of HTTP delivery; a client retry hits the SAME idempotent-retry path, which now also correctly returns the already-written snapshot fields.
- **New locks required**: **none.** The pre-generated `goalActivityExecutionId` is computed and used entirely within the SAME transaction already holding the `FOR UPDATE` lock and (when Goal-linked) the existing `goal-evidence:<userId>` advisory lock — no new lock, no new lock-ordering question.
- **Database constraints**: the one partial unique index (§5) is the only new constraint, purely defensive, never load-bearing for correctness (which remains structural, §6).

**The new attribution evidence is committed atomically with the authoritative completion by construction** — it is not a second write, it is four additional columns on a write that already exists, in the same statement, in the same transaction. **No asynchronous best-effort snapshot write of any kind is introduced.**

---

## 13. Performance/Index Analysis

**[RECOMMENDED]** Two new indexes (§5), both standard B-tree, both narrowly scoped (one composite covering index for the fallback query, one covering the existing-but-unindexed `PlannedActivity.habitLogId` FK column). No change to `HabitLog`'s existing `@@index([userId, logTimestamp])` (still used by the unrelated behavioral-duration/Insights-trend readers). The reporting endpoint gains exactly one additional query, same cost class as its existing queries, no pagination concern (a count aggregation, not an item list, matching PR4's own `AWAITING_CONFIRMATION_ITEM_LIMIT` precedent for where item-level detail WOULD need bounding).

---

## 14. Real-DB Test Matrix

**[RECOMMENDED]**, mapped to the ticket's own 26 scenarios — design only, no code written:

| # | Scenario | Assertion focus |
|---|---|---|
| 1 | Non-Goal Done | `HabitLog` row gets `completionAttribution='NON_GOAL'`, `originatingGoalActivityExecutionId=NULL`, correct `scheduledStartAtSnapshot` |
| 2 | Goal-linked Done | `completionAttribution='GOAL_LINKED'`, `originatingGoalActivityExecutionId` matches the real, newly-created `GoalActivityExecution.id` exactly |
| 3 | Live Plan reporting | `confirmedCompleted` unchanged from PR4's own existing behavior while the Plan is live (fallback contributes 0, `NOT EXISTS` correctly finds the live row) |
| 4 | Deleted non-Goal Plan | After delete, `confirmedCompleted` still includes it via the fallback; `HabitLog` row's four new columns intact |
| 5 | Deleted Goal-linked Plan | Fallback does NOT include it (`completionAttribution='GOAL_LINKED'` excluded); Goal Rhythm/progress reporting still correctly shows it via `GoalActivityExecution`, unaffected |
| 6 | Same activity multiple times | Two independent `HabitLog` rows, two independent `originatingPlannedActivityId` values, both counted independently, never merged |
| 7 | Duplicate Done replay | Second call returns the SAME `HabitLog` row unchanged (idempotent-retry path); no second write, new columns unaffected |
| 8 | Concurrent Done | Only one of two simultaneous requests wins the `FOR UPDATE` lock; the loser hits the idempotent-retry path; exactly one `HabitLog` row with correct snapshot values |
| 9 | Scheduled date differs from completion date | Direct re-run of the prior phase's own live reproduction (Sept-scheduled, Oct-logged) — `scheduledStartAtSnapshot` matches `plannedStartAt`, NOT `logTimestamp` |
| 10 | Cross-month completion | Reporting range anchored on the scheduled month correctly includes it even though `logTimestamp` falls in a different month |
| 11 | Cross-week Move then Done | `scheduledStartAtSnapshot` reflects the POST-Move (destination) `plannedStartAt`, never the pre-Move original |
| 12 | Timezone change | `scheduledStartAtSnapshot` is an absolute instant (`Timestamptz`), unaffected by a later user timezone change — re-derivation on read never occurs |
| 13 | Legacy linked HabitLog | Pre-existing `HabitLog` with a still-live Plan: new columns are `NULL` until/unless the optional backfill script runs; after backfill, correctly populated from the live Plan |
| 14 | Legacy orphan HabitLog | Pre-existing `HabitLog` whose Plan was ALREADY deleted before this feature's deploy: new columns remain permanently `NULL`; correctly excluded from the fallback (`UNKNOWN_LEGACY`) |
| 15 | Standalone HabitLog | `logSource != 'AURA_PLANNED'` row: never enters the fallback query regardless of its (NULL) new-column state |
| 16 | Partial Goal completion | `GoalActivityExecution.currentValue` below target: `completionAttribution='GOAL_LINKED'` still correctly excludes it from the non-Goal fallback — this PR never touches Goal progress values |
| 17 | Over-target Goal completion | Same as 16, `currentValue` above target — unaffected, excluded the same way |
| 18 | Goal deletion | Gated as today (`deleteGoal` refuses while execution evidence exists); if a `GoalActivityExecution` row is ever legitimately removed, `originatingGoalActivityExecutionId`'s own FK behavior (§9, product decision) determines whether the `HabitLog` row's pointer survives or SetNulls — test both configurations |
| 19 | Plan deletion race | Concurrent `deletePlannedActivity` + `logPlannedActivity` on the same row: standard row-lock serialization, no inconsistent intermediate state |
| 20 | Move/Done race | Concurrent `movePlannedActivity` + `logPlannedActivity` on the same row: existing lock discipline unaffected by this design |
| 21 | Transaction rollback | Force a failure after the widened `HabitLog` INSERT (e.g. invalid `actualValue`): assert ZERO rows persisted, including the new columns — full rollback, not partial |
| 22 | Cross-user isolation | User A's fallback query never includes User B's orphaned `HabitLog` rows |
| 23 | No double-counting | A single real completion event appears in `confirmedCompleted` exactly once, whether the Plan is live, deleted-non-Goal, or deleted-Goal-linked (via Goal progress, a separate metric) |
| 24 | No read-side writes | `GET /api/insights/reporting` with the new fallback query produces zero row changes, same as PR4/PR5's own existing zero-write-side-effect proofs |
| 25 | Indexed bounded reporting | `EXPLAIN` the fallback query, assert an index scan (not a sequential scan) on both the new composite index and the new `habitLogId` index |
| 26 | Account deletion behavior | **N/A today** — no account-deletion flow exists; document this explicitly as out-of-scope rather than fabricating a test for a feature that doesn't exist |

---

## 15. Product Decisions Required

**[UNRESOLVED — product sign-off, not an engineering call]**

1. **Is preserving completion attribution worth a migration?** This audit's own assessment: **yes** — it is one small, additive migration closing a real (if narrow) undercounting gap, with a well-understood, low-risk implementation shape.
2. **Which storage option is best?** **Option A** (§4), unambiguously, among those compared.
3. **What exact fields are required?** The four in §5 — no more, no fewer.
4. **What constraints are required?** One partial unique index (defensive, not load-bearing) + one new index on `PlannedActivity.habitLogId` (§5).
5. **What is the authoritative scheduled timestamp?** `plan.plannedStartAt`, read at Done-time, inside the existing transaction (§7).
6. **How is Goal linkage classified?** Explicit three-state (`GOAL_LINKED`/`NON_GOAL`/`UNKNOWN_LEGACY`-via-`NULL`), §8.
7. **What historical data remains permanently unrecoverable?** Every `HabitLog` whose originating Plan was ALREADY deleted before this feature's deploy — a closed, bounded, non-growing set (§10).
8. **Does the design preserve PR4's existing reporting contract?** **Yes, exactly** — same field name, same meaning, same range semantics, now simply more complete (§11).
9. **Can implementation be completed as one narrow PR?** **Yes** — one migration (4 columns + 2 indexes on existing tables), one precise reordering inside `logPlannedActivity` (pre-generate one id, mirroring an existing precedent), one additive reporting query. No new files beyond the existing `improvementSignalsComposition.ts`-style composition pattern PR5 already established, if the implementer chooses to mirror it for this read too.
10. **What should be deferred?** The optional live-Plan backfill script (§10) — valuable but not blocking, can ship in the same PR or a fast-follow. The `originatingGoalActivityExecutionId` FK-vs-plain-value choice (§9) — needs one explicit decision before implementation, but does not block this audit's own READY verdict.

**This audit explicitly does NOT recommend a generic event log** — nothing discovered in this pass changes the prior audit's own conclusion; the two gaps it found are fully closed by four additive columns on an already-existing, already-correct-purpose table.

---

## 16. Explicit STOP Conditions

- **STOP** if implementation ever substitutes `logTimestamp`/`createdAt`/`updatedAt` for `scheduledStartAtSnapshot` "to save a column" — this was the exact, explicitly-prohibited shortcut that caused the PRIOR phase's block.
- **STOP** if implementation ever defaults `completionAttribution` to `'NON_GOAL'` for a `NULL`/legacy row instead of treating `NULL` as `UNKNOWN_LEGACY` and excluding it.
- **STOP** if any backfill script attempts to populate the new columns for a `HabitLog` row whose originating Plan is ALREADY deleted — only live-Plan backfill (§10) is authorized.
- **STOP** if the new `HabitLog` columns are ever used to drive a PR5 improvement signal without a separate, explicit audit — this design's own scope is the `confirmedCompleted` reporting metric only.

---

## 17. Recommended Implementation Scope

**[RECOMMENDED]**

One migration: four nullable columns + two indexes on `HabitLog`/`PlannedActivity`, as specified in §5. One precise, narrow change to `logPlannedActivity` (pre-generate the Goal-execution id, write four more values into the already-existing `HabitLog` INSERT). One additive, read-only query composed into the existing Insights reporting path, summed into the existing `confirmedCompleted` field. Optionally, one one-time backfill script for still-live-linked legacy `HabitLog` rows. The 26-scenario real-DB test matrix (§14). No UI change beyond, at most, the explanatory copy already governed by PR4/PR5's own established tone rules, if the implementer judges one is needed (this audit finds none strictly required — the field's own meaning doesn't change, only its completeness).

---

## FINAL VERDICT

```
AURA — INSIGHTS V1 PR6 —
DESIGN READY
```

Both gaps the prior, correctly-cautious blocked-proof phase found are closed by the smallest schema change that could close them: four additive, nullable columns on the one table (`HabitLog`) that was already, structurally, the right place for this evidence to live — no new tables, no generic event log, no change to `deletePlannedActivity`'s existing hard-delete semantics, and no change to PR4's existing reporting contract beyond making it more complete.
