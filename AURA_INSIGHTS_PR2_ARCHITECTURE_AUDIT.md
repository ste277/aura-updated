# AURA — Insights V1 PR2 — Scheduled-Week Attribution & Concurrency Architecture Audit

**Mode:** Read-only deep audit. No implementation. No PR. No migrations.
**Baseline verified:** `HEAD == origin/main == 3c46b03d8c12799230e340fa5cda94af5b5d29da`. Working tree: only the two standing protected local files (`e2e/fixtures/cleanup.ts`, `test/personalizedDailyStoryDb.test.ts`) and `.claude/settings.local.json` modified/untracked, exactly as before — untouched by this audit. `AURA_INSIGHTS_ARCHITECTURE_AUDIT_V1.md` present, untracked, read in full (already in this session's own context — written by this same program). Migration count confirmed **46** (`0046_planned_activity_moved_at` is the latest).

**Approved policy (restated, binding on this design):** Weekly Goal attribution follows the *scheduled* week, never the date the user eventually taps Done. This does not establish when an activity was actually performed.

Every claim below is tagged **[VERIFIED]** (confirmed directly in code or by live, instrumented reproduction against the real dev database), **[PRODUCT DECISION]** (already settled by prior human sign-off, restated for traceability), **[RECOMMENDATION]** (this audit's engineering proposal, not yet decided), or **[OPEN QUESTION]** (genuinely unresolved, needs a decision before implementation).

---

## 1. Executive Verdict

The scheduled-week attribution gap is small, well-understood, and fixable with **two nullable, additive columns and exactly two write-site edits** — no new table, no new week-algorithm, no change to any unrelated code path. The canonical week-defining logic (`localCalendarWeekStart`, `getDatePartsInTimezone`) already exists and is already used correctly everywhere in *production* code; the fix is to **snapshot** its output once, at write time, instead of re-deriving it live forever.

The concurrency investigation produced a genuinely important, higher-confidence finding than either of this audit's own two dispatched sub-investigations individually reached: **direct, instrumented, live reproduction against the real database found that `multiOccurrenceRhythmMoveCapacityDb.test.ts`'s "negative remainingThisWeek" failure is not a negative number at all, and not a data-integrity defect** — it is a concrete, demonstrable **date-computation bug in the test's own diagnostic helper** (`dateOf()`, which slices a UTC calendar date instead of deriving the Asia/Kolkata local date), confirmed absent from all production code. `movePlannedActivityRace.test.ts`'s "Move loses every race" finding is a genuine, well-explained **structural asymmetry** (Move alone takes a per-user advisory lock and performs ~8 sequential round trips before its decisive write; Done/Skip/Cancel take none and need 1) — real, but a fairness-expectation mismatch, not data corruption. **Neither finding is a real data-integrity defect, and neither blocks or is made worse by PR2.**

**Verdict: ARCHITECTURE READY** (see §10 for the specific STOP conditions/open questions that remain, none of which block starting PR2's implementation).

---

## 2. Existing Week Attribution — Source of Truth Map

**[VERIFIED]** Every current write/read site, traced directly against `3c46b03`:

### Write sites for `GoalActivityOccurrence` (exhaustive — confirmed by grepping the full repo; no hits outside `apps/web/lib/db.ts` and `apps/web/lib/planMove.ts`, none in any API route file directly)

| Operation | Function | File:line | Trigger |
|---|---|---|---|
| **Create** (the only INSERT) | `materializeGoalActivityRhythmOccurrence` | `apps/web/lib/db.ts:3231-3269` (INSERT at 3264-3267) | Day Constructor accept, Goal-linked write-intent — called once from `dayConstructorAcceptancePersistence.ts:480` |
| **Repoint** (the only UPDATE; never an INSERT) | inside `applyMoveWrites` | `apps/web/lib/planMove.ts:302` | Every Move (manual `movePlannedActivity` and Recomposition acceptance, both calling the same shared `applyMoveWrites`) |

No DELETE of `GoalActivityOccurrence` exists in application code anywhere; the only row removal is a DB-level cascade from deleting the parent `Goal` (§2, lifecycle table below).

### Read sites computing committed/completed Rhythm facts

| Function | File:line | Join | Timezone source |
|---|---|---|---|
| `loadGoalActivityRhythmFacts` | `db.ts:3049-3061` | **INNER JOIN** to `PlannedActivity` | caller-supplied parameter |
| `listGoalActivityOccurrenceRowsForActivities` → `buildGoalActivityRhythmFactsFromOccurrenceRows` | `db.ts:3086-3112` | **INNER JOIN** | caller-supplied, applied in the pure shaping function |
| `enforceDestinationWeekCapacity`'s inline facts query | `planMove.ts:208-211` | **INNER JOIN**, excludes the mover's own occurrence (`gao.id <> $2`) | **fresh `SELECT timezone FROM "User"`**, `planMove.ts:202-203`, read inside the Move transaction, milliseconds before use |
| `loadEligibleGoalDemand` | `goalDemandCandidates.ts:111-162` | delegates to the above | caller-supplied (`planningLocalDate`/`timezone` both explicit, "never `Date.now()`, never re-derived" per the function's own doc comment) |

**Every reader uses a plain `JOIN` (INNER), never `LEFT JOIN`.** This is the mechanism behind one of the two data-quality gaps the prior audit (V1) already flagged: an occurrence whose `plannedActivityId` has gone `NULL` (via the cascade in the lifecycle table below) becomes **invisible** to every one of these readers — not an error, simply absent from the result set.

### Lifecycle interactions [VERIFIED, fresh reads of each function]

| Event | Function | Touches `GoalActivityOccurrence`? |
|---|---|---|
| Completion (Done) | `logPlannedActivity`, `db.ts:1568-1791` | **No** — confirmed by reading the full 224-line body; the string `"GoalActivityOccurrence"` does not appear anywhere in it. Only `PlannedActivity.status`/`loggedAt` change; every reader picks this up live via the INNER JOIN on `pa.status`. |
| Skip | `skipPlannedActivity`, `db.ts:1530-1546` | **No** — single conditional `UPDATE`, own doc comment states "writes no HabitLog, Capture or GoalActivity row." |
| Cancel | `cancelPlannedActivity`, `db.ts:1499-1510` | **No** — same shape. |
| Plan hard-delete | `deletePlannedActivity`, `db.ts:1552-1558` | `plannedActivityId` FK is `onDelete: SetNull` (`schema.prisma:963`) — the occurrence row **survives, orphaned** (NULL link), silently invisible to every reader above (the already-flagged "G1" gap from the prior audit). |
| Goal hard-delete | `deleteGoal`, `db.ts:2834-2855` | `GoalActivity.goal`/`GoalActivityOccurrence.goalActivity` relations are both `onDelete: Cascade` (`schema.prisma:728`, `956`) — genuinely removes every occurrence row under that Goal, **including already-orphaned ones**. Blocked (`'HAS_HISTORY'`) if any `GoalActivity.plannedActivityId` or any occurrence's `plannedActivityId` is still non-NULL. |
| User timezone change | `updateUserLocation`, `db.ts:1838-1848` | **No** — a single, non-transactional `UPDATE "User" SET ... timezone = $5 ...`. Confirmed: touches only the `User` row (plus `CustomCity` for the custom-location path). This is the exact mechanism of the drift PR2 exists to fix: nothing about any existing occurrence changes at the moment of a timezone update; every reader simply re-derives a different week for the SAME stored `plannedStartAt` on its very next query. |

### Day Constructor accept — exact materialization sequence [VERIFIED]

Inside `persistAcceptedConstructedDay` (`dayConstructorAcceptancePersistence.ts:277-522`), one transaction (`beginTransaction()` at line 305), advisory lock taken immediately after (line 309, key `` `day-constructor-accept:${userId}` ``). Per write-intent (loop at 444-512):
1. **Line 445** — `PlannedActivity` INSERT.
2. **Line 480** — `materializeGoalActivityRhythmOccurrence(..., user.timezone, client)`, same `client`. Inside it: **db.ts:3252** reads fresh facts (`loadGoalActivityRhythmFacts`, same client) → **db.ts:3253-3254** capacity check (`evaluateNewOccurrenceEligibility`) → **db.ts:3264-3267** the occurrence INSERT.

All on the same transaction client, committed together at line 514; any failure rolls back everything including step 1 (line 517). `user.timezone` itself is sourced at **line 302**, via a plain-`pool` `getUserById` call issued *before* `beginTransaction()` — a small, practically-irrelevant TOCTOU window (the whole request completes in one round trip), noted for completeness.

---

## 3. Canonical Week-Key Recommendation

Evaluated against the four alternatives and all ten sub-questions:

| Option | Verdict |
|---|---|
| **A. Local week-start DATE + explicit timezone basis** | **[RECOMMENDATION] Adopt.** |
| B. ISO week-year + week number + timezone basis | Reject — introduces a second, parallel week-numbering scheme (ISO week-year can diverge from the calendar year at year boundaries) that nothing else in this codebase uses; `localCalendarWeekStart` already returns a plain civil date, never an ISO week number. Adopting B would itself violate the ticket's own "do not create a second week algorithm" instruction. |
| C. Raw `plannedStartAt` + stored timezone snapshot, week re-derived at read time | Reject as the *primary* representation — this is functionally "store the inputs, recompute the output every time," which reintroduces exactly the live-recomputation pattern causing today's drift (the inputs would be frozen, which is an improvement over today, but still requires every reader to re-run the week algorithm instead of a simple equality/range filter — strictly more read-side work and more places the logic could diverge, for no benefit over A). |
| D. Another existing representation | None found — `localCalendarWeekStart`/`localCalendarWeekBounds` (`goalActivityRhythm.ts`) are the *only* week-defining logic anywhere in the repo; there is no competing convention to prefer instead. |

**Answers to the ten sub-questions, all already settled by existing, canonical code — none require a new decision:**
1. **Which calendar?** Gregorian civil calendar, via `getDatePartsInTimezone` (Intl-based, IANA timezone aware) — already the sole mechanism used throughout Rhythm code.
2. **Week start day?** Monday — `localCalendarWeekStart`'s own established, hard-coded convention (goalActivityRhythm.ts).
3. **Stable across years?** Yes, for a plain `YYYY-MM-DD` Monday-date string — no ambiguity at year boundaries, unlike ISO week numbers (one of the reasons Option B is rejected).
4/5. **Timezone offsets / DST?** Already correctly handled by `getDatePartsInTimezone`'s own Intl-based implementation — DST transitions are a non-issue for a once-computed civil date string.
6. **Near midnight?** Already correctly handled by the canonical helper — **the exact failure mode found in §6 below is what happens when this canonical helper is bypassed**, not a flaw in the helper itself.
7. **Timezone changes later?** Irrelevant to a snapshot by construction — once written, it is never re-derived.
8. **Existing rows?** `NULL` — see §5.
9. **Query efficiency?** A plain string/date column is trivially indexable and filterable; no range reconstruction needed at read time.
10. **Derivable consistently across writers/readers?** Yes — both of PR2's two write sites can call the exact same existing `localCalendarWeekStart` function; **no new algorithm is written anywhere.**

**[RECOMMENDATION]** Store two fields together: `scheduledWeekStart` (the Monday's `YYYY-MM-DD`, matching `localCalendarWeekStart`'s own return shape exactly) **and** `scheduledWeekTimezone` (the IANA zone name used to compute it, e.g. `"Asia/Kolkata"`) — the second field is not required for correct weekly aggregation (the date string alone is the key), but costs nothing, matches the ticket's own Option A phrasing ("plus explicit timezone basis"), and gives a future engineer/auditor a direct, self-contained answer to "under what timezone was this occurrence's week decided" without having to cross-reference `User.timezone`'s history (which does not exist).

---

## 4. Snapshot Lifecycle

**[RECOMMENDATION]** Exactly two write locations — both already identified in §2, confirmed to be the *only* two writers of `GoalActivityOccurrence` in the entire codebase:

| Case | Write location | Behavior |
|---|---|---|
| New Rhythm occurrence | `materializeGoalActivityRhythmOccurrence` INSERT, `db.ts:3264-3267` | Compute `localCalendarWeekStart(getDatePartsInTimezone(timezone, plannedStartAt).dateStr)` using the SAME `timezone`/`plannedStartAt` already in scope at this call site; include in the same INSERT statement. |
| Day Constructor accepted occurrence | *(same call site as above — this is the only occurrence-creation path; there is no separate "Day Constructor" vs. "Goal-linked activity creation" write site)* | — |
| Goal-linked activity creation (no new occurrence) | N/A | Only `GoalActivityOccurrence` rows carry this field; linking an existing plan to a GoalActivity without creating a Rhythm occurrence never touches it. |
| Same-week Move | `applyMoveWrites`'s repoint `UPDATE`, `planMove.ts:302` | **Must** re-stamp both columns in the same `UPDATE`, using the destination `newStartAt` and the timezone already freshly read by `enforceDestinationWeekCapacity` (`planMove.ts:202-203`) moments earlier in the same transaction. |
| Cross-week Move | *(same site)* | Re-stamping naturally transfers attribution to the destination week — this satisfies the ticket's own explicit "critical" requirement, with no special-casing needed (the snapshot is simply recomputed from the new instant, same as any other Move). |
| Repeated Move chain | *(same site, once per hop)* | Each hop's own `UPDATE` re-stamps the one occurrence row (which is always repointed to whichever plan is currently live — never duplicated across the chain). |
| Concurrent Move | *(same site)* | Confirmed safe — Move-vs-Move for one user is fully serialized by the existing shared advisory lock (`day-constructor-accept:${userId}`, §6); adding two more columns to an already-lock-protected single `UPDATE` introduces no new race. |
| Idempotent Move replay | *(none — by design)* | Replay short-circuits **before** `applyMoveWrites` is ever re-invoked (`planMove.ts:86-94`) — inherits PR1's own proven "never re-stamp on replay" guarantee for free, with zero new code. |
| User timezone update | *(none — must remain untouched)* | `updateUserLocation` must continue to touch only the `User` row. **This is the whole point of the feature** — confirmed achievable with zero change to that function. |
| Completion after scheduled week (late Done) | *(none)* | **[PRODUCT DECISION, restated]** `logPlannedActivity` never references `GoalActivityOccurrence` today and must not start — the approved policy is explicit that attribution follows the *scheduled* week regardless of when Done is tapped. No change required to this function. |
| Historical occurrence without snapshot | *(none — pre-existing rows simply have `NULL`)* | See §5. |

---

## 5. Historical Compatibility

**[RECOMMENDATION]** Two nullable, additive columns on `GoalActivityOccurrence`:
```prisma
scheduledWeekStart    String?  // 'YYYY-MM-DD', the Monday of the week, per localCalendarWeekStart
scheduledWeekTimezone String?  // IANA zone name used to compute it
```
**No backfill.** Mirrors PR1's `movedAt` migration philosophy exactly — a historical occurrence that predates this migration has no reliable original-timezone record anywhere in the database (`updateUserLocation` overwrites `User.timezone` in place with no history table), so fabricating one would misrepresent a precision the system never actually captured. Both columns stay `NULL` for every pre-migration row.

For a `NULL`-snapshot row, every read site **preserves today's exact live-derivation fallback** — `getDatePartsInTimezone(CURRENT user.timezone, plannedStartAt)` — with its already-documented, already-disclosed timezone-drift limitation (from the V1 audit's own G4 finding). **Do not fabricate** an original timezone for these rows; **do not** change their weekly credit silently.

**Mixed-population question, answered directly:** does a population with some snapshotted and some legacy `NULL` rows create double-counting or filtering problems? **No double-counting** — each occurrence row is still counted exactly once per read, regardless of which code path (snapshot vs. live-derive) decided *which* week it counts toward; the two paths are mutually exclusive per row (`COALESCE(scheduledWeekStart, <live-derived value>)`), never both. The real, intentional consequence — which must be **documented, not treated as a bug** — is that a single weekly aggregate report can legitimately combine snapshot-stable dates (new rows) with live-drifting dates (legacy rows) for different rows in the same result set. This is the correct, by-design behavior: new data gets the fix, old data keeps its known, already-disclosed limitation, exactly as the ticket's own §E instructs ("do not silently change weekly credit").

---

## 6. Concurrency Root-Cause Analysis

Two independent deep-dive investigations were run (full read-only code tracing), followed by a **third, direct, instrumented, live-database reproduction** performed to resolve a tension between the first investigation's own code analysis and the originally-reported empirical symptom.

### 6.1 `multiOccurrenceRhythmMoveCapacityDb.test.ts`, scenario E — "negative `remainingThisWeek`"

**[VERIFIED by direct, live, instrumented reproduction]** — this is the single most important finding of this audit, because it overturns the literal framing of the originally-reported symptom.

The static code trace independently found that `remainingThisWeek`'s only consumer formula clamps at zero (`Math.max(0, targetPerWeek - completed - committed)`, `goalActivityRhythm.ts:290`) and that Move-vs-Move for one user is fully serialized by the shared advisory lock — both facts structurally rule out a literal negative value or genuine over-commitment. This created a direct tension with the empirically-reported failure, which the investigation honestly flagged as needing instrumented verification rather than guessing.

**That verification was performed**: an instrumented reproduction of scenario E was run live against the real database, 8 independent trials, printing the raw `remainingThisWeek` value and the ground-truth occurrence rows on every result. On the one trial that reproduced the failure:
```
raw occurrence->plan rows: [... two rows, both genuinely inside the correct destination week ...]
remainingDestE RAW VALUE: 2   (not negative — the full, untouched target)
```
**Root cause, confirmed directly**: the test's own diagnostic helper,
```ts
function dateOf(ms: number): string { return new Date(ms).toISOString().slice(0, 10); }
```
computes the **UTC** calendar date of an instant and passes it as `planningLocalDate` into `loadEligibleGoalDemand`, which interprets that string as a **local civil date in `Asia/Kolkata` (UTC+5:30)**. For an instant late in the UTC day, the true Kolkata-local date is already the *next* day — so this helper occasionally asks `loadEligibleGoalDemand` about an entirely different, genuinely empty calendar week than the one its own just-created occurrences actually live in (confirmed: both occurrence rows' real local dates, computed correctly, fell on a different calendar day than the one `dateOf()` reported). The result is not a negative number and not an over-commitment — it is the system correctly reporting full capacity for the **wrong week**, because the test asked about the wrong week.

**Confirmed confined to test code**: a repo-wide grep for this exact UTC-slice pattern inside the production files relevant to Rhythm/Move (`planMove.ts`, `db.ts`, `goalDemandCandidates.ts`, `dayConstructorAcceptancePersistence.ts`) returned **zero matches** — every one of those files exclusively uses `getDatePartsInTimezone`, the canonical, correct helper. This bug exists only in `test/multiOccurrenceRhythmMoveCapacityDb.test.ts`'s own `dateOf()` function, used only to compute the argument for its own diagnostic `remaining()` call — never in any code path that actually enforces capacity.

### 6.2 `movePlannedActivityRace.test.ts` — "Move loses 16/16 races"

**[VERIFIED]** A clean, fully-explained structural asymmetry, confirmed by direct code reading of all four competing operations:

| Operation | Advisory lock? | Round trips before decisive write |
|---|---|---|
| Move (`movePlannedActivity`) | **Yes** — `pg_advisory_xact_lock`, `planMove.ts:80` | ~8 sequential statements (lock → row lock → moment check → clock read → conflict query → capacity lookup → successor insert → the decisive conditional `UPDATE`) |
| Done (`logPlannedActivity`) | **No** | 1 (`SELECT ... FOR UPDATE` immediately followed by the status check) |
| Skip (`skipPlannedActivity`) | **No** | 1 (single unconditional-transaction `UPDATE`) |
| Cancel (`cancelPlannedActivity`) | **No** | 1 (same shape as Skip) |

Against a real, remote Postgres connection (the test's own header documents a real `DATABASE_URL`, not an in-process database), this fixed, structural latency deficit — not random scheduling — explains a deterministic 16/16 result. The underlying locking mechanics themselves are sound: whichever write reaches the row first wins cleanly, and the conditional `WHERE status = 'UPCOMING'` guarantees exactly one terminal state, never a hybrid, confirmed by the suite's own passing invariant checks (UNIQUE `rescheduledFromPlanId` as a DB-level backstop; no plan ever ends up with two successors).

### 6.3 Answers to the ten specific sub-questions

1. **Negative only transient, or persisted?** Neither — not negative anywhere, ever (structurally clamped at the formula level); the observed failure is a *positive*, wrong-week read (§6.1).
2. **Can the database persist more than the weekly target?** No — Move-vs-Move for one user is fully serialized by the shared lock; the destination week in scenario E always lands at exactly target, never over.
3. **Does the capacity calculation count source and successor simultaneously?** No — the exclusion clause (`gao.id <> $2`) correctly excludes only the mover's own in-flight occurrence, and full serialization means there's never a window where both are counted.
4. **Are moved occurrences counted once?** Yes — `GoalActivityOccurrence.plannedActivityId` is `@unique`, structurally preventing any double-link.
5. **Do all competing operations acquire the same advisory lock?** **No** — only Move (and its two shared callers) does; Done/Skip/Cancel take none. This is the single most load-bearing fact behind §6.2.
6. **Are transactions serialized for the same user and Goal?** Only Move-family operations are serialized against each other; Done/Skip/Cancel are each individually atomic (via `FOR UPDATE` or a single conditional statement) but not serialized against Move via this lock.
7. **Does the Move capacity check use fresh state under the lock?** Yes, confirmed — reads happen strictly after the lock is held, on the transaction's own client.
8. **Can an idempotent replay bypass a required capacity revalidation?** No, and it is not relevant to scenario E at all — the replay short-circuit is keyed per-`planId`; scenario E's two concurrent movers are two genuinely distinct plans, so neither ever reaches that code path.
9. **Are the race tests asserting an unsupported winner distribution rather than a correctness invariant?** Yes, for `movePlannedActivityRace.test.ts`'s three fairness assertions — Move's own documented concurrency contract never promised parity against a single-statement competitor.
10. **Does the observed result threaten PR2 snapshot correctness?** No. A snapshot write added inside `applyMoveWrites`'s already-lock-protected `UPDATE` introduces no new Move-vs-Move race (§4). The one genuine, forward-looking caution (not a defect today): if a *future* change ever gave Skip/Cancel/Done their own reason to write this new column without adopting the same lock, that would reproduce today's asymmetry on a second column — a scope-creep risk to flag for later designs, not a reason to delay PR2 as scoped (Move is the only writer).

### 6.4 Classification

| Finding | Classification |
|---|---|
| `multiOccurrenceRhythmMoveCapacityDb.test.ts` scenario E | **TEST EXPECTATION DEFECT** — specifically, a concrete, confirmed date-computation bug in the test's own `dateOf()` helper. Not a production code defect. |
| `movePlannedActivityRace.test.ts` checks 23-25 | **TEST EXPECTATION DEFECT** — asserts an architectural fairness guarantee the system never provided or promised. Not a data-corruption defect. |

**Neither is classified as REAL DATA INTEGRITY DEFECT, NONDETERMINISTIC TIMING, or INSUFFICIENT EVIDENCE** — in both cases the code reading plus (for 6.1) direct live instrumentation produced a definite, reproducible, mechanistic explanation.

---

## 7. Verified Invariants

| Invariant | True domain invariant, or presentation clamping? |
|---|---|
| One occurrence is counted once | **True invariant** — enforced structurally (`@unique plannedActivityId`, single-row read per occurrence). |
| Move does not create an additional logical occurrence | **True invariant** — `applyMoveWrites` only ever `UPDATE`s/repoints `GoalActivityOccurrence`, never `INSERT`s one. |
| Completed credit is not duplicated | **True invariant** — one row, one status, read once per aggregation. |
| Cancelled/skipped contributions follow the approved policy (no debt carried) | **True invariant**, already correctly implemented (`deriveGoalActivityRhythmContribution` maps both to `NONE`). |
| `remainingThisWeek` cannot be negative | **Presentation-level clamping**, not a domain invariant — `Math.max(0, ...)` in the read-time *formula* (`goalActivityRhythm.ts:290`) only prevents a negative *display* number. The real enforcement against genuine over-commitment is a separate, write-time invariant: `enforceDestinationWeekCapacity`'s pre-write gate, which throws `CAPACITY_EXCEEDED` before any write. These are two different mechanisms for two different purposes and must not be conflated in the design or in future tests. |
| Cross-week Move transfers attribution without double-counting | **True invariant by design** — one row, repointed, snapshot recomputed at the same moment as the repoint. |
| A timezone change cannot rewrite a snapshotted historical week | **True invariant once PR2 ships**, by construction — no code path updates an existing snapshot except a future Move of that same occurrence. |
| A replay cannot reassign attribution unexpectedly | **True invariant**, inherited directly from PR1's proven idempotent-replay pattern (the write statement that would re-stamp anything is never re-executed on replay). |

---

## 8. Proposed Schema/API Changes

**[RECOMMENDATION — not implemented by this audit]**

```prisma
model GoalActivityOccurrence {
  // ...existing fields unchanged...
  scheduledWeekStart    String?  // 'YYYY-MM-DD' (the Monday), via localCalendarWeekStart -- snapshotted once
  scheduledWeekTimezone String?  // IANA zone used to compute it -- snapshotted once
}
```

- **Migration number**: `0047` (next after PR1's `0046`).
- **Write locations**: exactly two — `materializeGoalActivityRhythmOccurrence`'s INSERT (`db.ts:3264-3267`) and `applyMoveWrites`'s repoint `UPDATE` (`planMove.ts:302`). No other file changes required for the write side.
- **Read locations requiring a `COALESCE`-style fallback edit**: `loadGoalActivityRhythmFacts` (`db.ts:3049-3061`), `listGoalActivityOccurrenceRowsForActivities`/`buildGoalActivityRhythmFactsFromOccurrenceRows` (`db.ts:3086-3112`), and `enforceDestinationWeekCapacity`'s inline facts query (`planMove.ts:208-211`). Each becomes: prefer the row's own `scheduledWeekStart` when non-`NULL`; otherwise fall back to today's exact live derivation.
- **No new API routes required** for the snapshot itself — this is a persistence-layer correctness fix, not a new reporting surface (consistent with PR1's own "no new reporting UI" scoping).
- **Compatibility fallback**: `NULL` → live-derive, exactly as today, with the already-documented drift limitation preserved and disclosed for legacy rows only.
- **Rollback considerations**: purely additive — reversing the migration drops two nullable columns with zero impact on any other table. The coupled code change (the `COALESCE` read-site edits) would also need reverting together with the schema rollback, since those functions would otherwise reference columns that no longer exist — this coupling should be called out explicitly in the implementation PR's own rollback notes.

**Separate corrective PR for the two test failures**: **[RECOMMENDATION]** Yes, but scoped as a small, independent **test-hygiene fix**, not a production code change:
1. Fix `multiOccurrenceRhythmMoveCapacityDb.test.ts`'s `dateOf()` to use `getDatePartsInTimezone(TZ, new Date(ms)).dateStr` instead of the UTC-slice pattern.
2. Rewrite `movePlannedActivityRace.test.ts` checks 23-25 to assert the invariant the system actually provides ("exactly one terminal outcome, never a hybrid, regardless of which operation wins") instead of a specific winner distribution.

**This corrective PR does NOT need to precede PR2** — PR2's own correctness does not depend on either test's assertions being fixed first (confirmed in §6.3, item 10), since the underlying capacity-enforcement and locking code these tests exercise is unaffected by either finding.

---

## 9. Test Matrix

**[RECOMMENDATION]** All 16 required scenarios, verifying persisted records directly (not rendered UI), using a controlled/relative clock consistent with this repo's own established real-DB test convention (`movePlannedActivityDb.test.ts`'s `src()`/`dst()` pattern):

| # | Scenario | Verifies |
|---|---|---|
| 1 | Same-week Move | `scheduledWeekStart` unchanged after a Move whose destination falls in the same local week. |
| 2 | Cross-week Move | `scheduledWeekStart` updates to the destination week's Monday; the source week's facts query no longer counts it. |
| 3 | Repeated Move chain (A→B→C) | Each hop's own occurrence row carries the snapshot matching *that* hop's destination; no stale value survives from an earlier hop. |
| 4 | Concurrent Move (scenario E's shape) | Exactly one snapshot write commits per occurrence; no contradictory/partial snapshot ever persists (mirrors PR1's own `movedAt` concurrency test design). |
| 5 | Move vs Done | Whichever operation wins leaves a coherent state: if Move wins, the snapshot is set on the new row; if Done wins, no snapshot write was ever attempted (Move's transaction never reached the point of writing it). |
| 6 | Move vs Skip | Same shape as 5. |
| 7 | Move vs Cancel | Same shape as 5. |
| 8 | Idempotent replay | A replayed Move returns the identical, already-set snapshot — never recomputed or re-stamped (mirrors PR1's `movedAt` replay test exactly). |
| 9 | User timezone change | After `updateUserLocation`, an existing occurrence's `scheduledWeekStart` is **provably unchanged** — a direct regression test for the fix's whole purpose. |
| 10 | Week-year boundary | An occurrence scheduled in the last week of December / first week of January snapshots a correct, year-stable `YYYY-MM-DD` Monday date — no ISO week-year ambiguity (confirms the Option-A choice in §3). |
| 11 | DST boundary | An occurrence scheduled across a DST transition in a DST-observing zone snapshots the correct local date via `getDatePartsInTimezone`'s own Intl-based handling. |
| 12 | Legacy `NULL` snapshot | A pre-migration-shaped row (snapshot forced `NULL` via direct SQL, mirroring PR1's own "historical row" test pattern) reads correctly via the live-derivation fallback, with no crash and no fabricated snapshot ever written back to it. |
| 13 | Completion logged weeks later | Tapping Done long after the scheduled week does **not** alter `scheduledWeekStart` — a direct test of the approved policy restated in §A. |
| 14 | Goal Rhythm capacity | `enforceDestinationWeekCapacity`'s own gate still correctly rejects a would-be-over-capacity Move, using the snapshot-aware read path. |
| 15 | Finite Goal completion | A `NONE`-rhythm GoalActivity (no occurrence row at all) is entirely unaffected — confirms the schema/read changes are scoped correctly. |
| 16 | Mixed legacy/new occurrences | A single weekly aggregate query correctly combines one snapshot-backed and one legacy `NULL` row for the same `GoalActivity`/week without double-counting or crashing (§5's own mixed-population analysis, verified). |

---

## 10. Risks and STOP Conditions

**[OPEN QUESTION]** None of the following block starting implementation, but should be confirmed before the PR is considered final:

1. Confirm `scheduledWeekTimezone` is wanted as a stored field (useful audit metadata, not strictly required for the week-key itself) — or whether `scheduledWeekStart` alone is preferred for a smaller diff.
2. Confirm the recommended **test-hygiene fix** (§8) is wanted as a separate, small PR, and whether it should land before, after, or interleaved with PR2 (this audit finds no technical dependency either way).
3. Confirm storing the date as `String` (matching `localCalendarWeekStart`'s own return type exactly, zero conversion) vs. a native `DATE` column is acceptable — a `String` avoids any Prisma `@db.Date`/timezone-interpretation ambiguity at the ORM layer, consistent with how `Goal.targetDate`'s own doc comment already reasons about civil dates in this codebase.

No STOP condition was found that blocks beginning PR2's implementation.

---

## 11. Exact PR Implementation Scope

**PR2 (this audit's subject), minimal scope:**
- Migration `0047`: two nullable, additive columns on `GoalActivityOccurrence`.
- Edit `materializeGoalActivityRhythmOccurrence` (one INSERT, `db.ts`).
- Edit `applyMoveWrites`'s repoint `UPDATE` (`planMove.ts:302`).
- Edit the three read sites in §8 for `COALESCE`-style fallback.
- The 16 tests in §9.
- **No other file touched** — no new route, no new UI, no change to `logPlannedActivity`/`skipPlannedActivity`/`cancelPlannedActivity`/`updateUserLocation` (all three must remain provably untouched, per §4/§9's own regression tests).

**Separate, independent PR (optional, not blocking):** the test-hygiene fix from §8 (items 1-2), sequenced at the team's discretion.

---

## 12. Recommended Implementation Order

1. Decide the three open questions in §10 (quick product/engineering sign-off, not architecturally significant).
2. Implement PR2 exactly as scoped in §11.
3. (Independently, any time) land the test-hygiene fix for the two pre-existing, now-explained test failures.

---

**FINAL VERDICT:**

```
AURA — INSIGHTS V1 PR2 —
ARCHITECTURE READY
```
