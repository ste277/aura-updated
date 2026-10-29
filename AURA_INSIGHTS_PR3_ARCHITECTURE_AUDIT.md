# AURA — Insights V1 PR3 — Goal Completion History Preservation Architecture Audit

**Mode:** Read-only deep architecture audit. No implementation. No PR. No commits. No migrations.
**Baseline verified:** `HEAD == origin/main == f6f3bfb864d6692878e984679791c10b09cad0d4`. Migration count confirmed **47** (`0047_goal_activity_occurrence_scheduled_week` is the latest). Working tree: only the two standing protected local files (`e2e/fixtures/cleanup.ts`, `test/personalizedDailyStoryDb.test.ts`) and `.claude/settings.local.json` modified/untracked, untouched by this audit. `AURA_INSIGHTS_ARCHITECTURE_AUDIT_V1.md` and `AURA_INSIGHTS_PR2_ARCHITECTURE_AUDIT.md` present, untracked, both read in full. The "Insights V1 product decision resolution" the ticket asks for is **not present as a file anywhere in this repository** — it was delivered as a chat response in an earlier session and is not independently re-readable here; see §14.

Every claim below is tagged **VERIFIED** (confirmed directly in code, or by live, instrumented reproduction against the real dev database), **INFERRED** (a reasonable conclusion from verified facts, not itself directly observed), **RECOMMENDED** (this audit's engineering proposal, not yet decided), or **UNRESOLVED** (genuinely open, needs a decision before implementation).

---

## 1. Executive Verdict

**The data loss is real, confirmed by direct live reproduction, and has a small, additive, surgical fix that touches exactly one write path and three read paths — no new table, no change to the deletion contract's actual erasure of `PlannedActivity` itself.**

Two independently confirmed root causes, not one:

1. **[VERIFIED, already named by the V1 audit as G1/G2]** `deletePlannedActivity` hard-deletes a `LOGGED`/`CANCELLED` `PlannedActivity` row; `GoalActivityOccurrence.plannedActivityId` and `GoalActivity.plannedActivityId` both `SetNull` on that delete (`schema.prisma:963`, `746`); every Rhythm read is an `INNER JOIN` to `PlannedActivity` (`db.ts:3055`, `3100`, `planMove.ts:223`); and `deriveGoalActivityState` (`goals.ts:49-65`) treats a `NULL` link identically to "never planned." The result: a confirmed Goal Rhythm week's completed count, and a confirmed finite Goal's `COMPLETED` state, both **silently revert** the instant the underlying plan is cleared from "Recently Completed."

2. **[VERIFIED, newly discovered by this audit — not previously named]** `GoalActivityExecution`, the model that already exists specifically to hold durable, per-occurrence completion evidence, is **not reliably written for Rhythm (`N_PER_WEEK`) GoalActivities today, independent of any deletion**. `logPlannedActivity` (`db.ts:1621`) resolves which `GoalActivity` a completion belongs to via `GoalActivity.plannedActivityId = $1` — but `materializeGoalActivityRhythmOccurrence` repoints that SAME column to "most recently materialized," never "the one being completed," every time a new occurrence is created (`db.ts:3270-3274`). A live reproduction (§4) confirms directly: completing an older occurrence after a newer sibling has already been materialized writes **zero** `GoalActivityExecution` rows for it. This means Option C of §6 ("use `GoalActivityExecution` as the per-occurrence evidence snapshot") **cannot be adopted as-is** — it must be rejected in its current write-gated form, per the ticket's own explicit §F instruction, and fixed at its root (the lookup key) rather than papered over.

A third, secondary finding: **[VERIFIED]** `deleteGoal`'s own existing safety gate (`goalHasRetainedPlanLinkage`, `db.ts:2805-2820`) checks only `plannedActivityId` linkage, never retained completion evidence. Once a Goal's occurrences/activities have all had their plans cleared (finding 1 above), the Goal becomes deletable again, and the `Cascade` FK from `Goal → GoalActivity → GoalActivityExecution`/`GoalActivityOccurrence` (`schema.prisma:728`, `842`, `956`) destroys whatever evidence survived finding 1. Confirmed by live reproduction, §4, Scenario 4.

**Recommended fix (§7): a single new nullable `completedAt` timestamp on `GoalActivityOccurrence`, written once by `logPlannedActivity` at the moment of Done (never at delete time), keyed by the occurrence's OWN `plannedActivityId` (fixing finding 2 as a side effect) rather than `GoalActivity`'s shared pointer; a parallel, smaller fix for the finite/`NONE` case that makes the existing, already-correctly-written `GoalActivityExecution` row actually readable after its plan is deleted; and a widened `deleteGoal` gate that also blocks on retained evidence, not just retained linkage.** This preserves every independent achievement distinctly (§8), requires zero change to `deletePlannedActivity`, `skipPlannedActivity`, `cancelPlannedActivity`, or `applyMoveWrites`, and never retains the deleted `PlannedActivity` row's own content (title, notes, exact timestamps) — only a minimal, purpose-built "this occurred, in this week" fact, on the rows that already exist specifically to survive relinking.

**Verdict: ARCHITECTURE READY** (see §12 for STOP conditions; §14 for product decisions this audit does not resolve).

---

## 2. Verified Deletion Lifecycle

**[VERIFIED]** Every production code path capable of removing, terminating, or re-pointing a `PlannedActivity`, traced directly:

| # | Path | Entry point | Txn/lock | Status eligibility | Statement | FK/cascade consequence |
|---|---|---|---|---|---|---|
| 1 | **User-initiated hard delete** ("clear Recently Completed") | `deletePlannedActivity`, `db.ts:1554-1560` | None — single `pool.query`, no transaction, no advisory lock | `status IN ('LOGGED','CANCELLED')` only (never `UPCOMING`/`SKIPPED`/`MOVED`) | `DELETE FROM "PlannedActivity" WHERE id=$1 AND "userId"=$2 AND status IN (...)` | `GoalActivity.plannedActivityId` → `SetNull`; `GoalActivityOccurrence.plannedActivityId` → `SetNull`; `GoalActivityExecution.plannedActivityId` → `SetNull`; `Capture.plannedActivityId` → `SetNull`; `AuraMoment.plannedActivityId` → (not checked by this audit, out of scope); **`HabitLog` is NOT touched at all** — no FK exists from either side (`HabitLog` has no `plannedActivityId` column; `PlannedActivity.habitLogId` is a plain, non-relational `String?`) |
| 2 | **Goal-linked deletion** | Same function as #1 — there is no separate "Goal-aware" delete path; the caller is unaware of Goal linkage | Same as #1 | Same as #1 | Same as #1 | Same consequence as #1 — this IS the mechanism the ticket is asking about |
| 3 | **`LOGGED` deletion** | Subset of #1 | — | `status='LOGGED'` matches | — | The exact case this audit's reproduction (§4) exercises |
| 4 | **`CANCELLED` deletion** | Subset of #1 | — | `status='CANCELLED'` matches | — | A `CANCELLED` occurrence/GoalActivity link, already contributing `NONE` to Rhythm (`deriveGoalActivityRhythmContribution`, `goalActivityRhythm.ts:264-268`), loses its link the same way — **no completion evidence to lose** (nothing was ever completed), but the occurrence row itself still survives, orphaned |
| 5 | **`SKIPPED` deletion** | **Not possible** — `deletePlannedActivity`'s `WHERE` clause excludes `SKIPPED` | — | — | — | N/A — a `SKIPPED` plan can never be hard-deleted by this function; it has no other delete path either |
| 6 | **`UPCOMING` deletion** | **Not possible** by this function — `cancelPlannedActivity` (`db.ts:1501-1512`) is the only way to terminate an `UPCOMING` plan, and it only ever `UPDATE`s to `CANCELLED`, never deletes | — | — | — | N/A |
| 7 | **`MOVED` source deletion** | **Not possible** — a `MOVED` row's status is never `LOGGED`/`CANCELLED`; `deletePlannedActivity` can never match it | — | — | — | N/A — a `MOVED` tombstone can never be hard-deleted directly |
| 8 | **Recomposition / replacement paths** | `applyMoveWrites`, `planMove.ts:280-337` (shared by manual `movePlannedActivity` and Remaining-Day Recomposition acceptance) | Caller's transaction, `pg_advisory_xact_lock` keyed `day-constructor-accept:${userId}` | Source must be `UPCOMING` | `UPDATE ... SET status='MOVED'` (tombstone) + new row `INSERT` | **Never a delete.** Repoints `GoalActivity`/`GoalActivityExecution`/`GoalActivityOccurrence.plannedActivityId` to the successor (`planMove.ts:290,307,335`) — continuity is preserved by construction; confirmed no completion evidence loss on Move itself |
| 9 | **Cascading database deletion (User)** | `onDelete: Cascade` from `User` on `PlannedActivity` (`schema.prisma:335`), `Goal` (`692`), `GoalActivity` (`726`), `GoalActivityOccurrence` (`954`), `GoalActivityExecution` (`834`), `HabitLog` (`287`) | DB-enforced | N/A — whole-account deletion | — | **[VERIFIED, out of scope for this ticket]** Full-account deletion already correctly and completely erases everything, consistently, with no partial/orphaned state possible. This is the one case where "erase everything" is unambiguously the correct, intended behavior — not a gap. |
| 10 | **Goal hard-delete** | `deleteGoal`, `db.ts:2836-2857` | Own transaction (`beginTransaction`), `FOR UPDATE` row-lock on the `Goal` | Gated on `goalHasRetainedPlanLinkage` (`db.ts:2805-2820`) returning `false` | `DELETE FROM "Goal" ...` | `onDelete: Cascade` from `Goal` removes every `GoalActivity` row under it, which in turn cascades to every `GoalActivityExecution`/`GoalActivityOccurrence` row under THOSE (`schema.prisma:728,842,956`) — **including rows whose `plannedActivityId` is already `NULL` from path #1/#2**, i.e. evidence that survived the plan-delete gets destroyed here instead (§4 Scenario 4) |
| 11 | **GoalActivity deletion** | **No such function exists.** Confirmed: `grep` for `deleteGoalActivity`/`removeGoalActivity` across the full `apps/web` tree returns zero hits. The only way a `GoalActivity` row is ever removed is the `Cascade` from its parent `Goal` (#10) — it is never individually hard-deleted; the only individual-level lifecycle action is `dismissGoalActivity` (`db.ts:2915`), a status `UPDATE` to `DISMISSED`, never a delete | — | — | — | Same cascade as #10, one level down |

**[VERIFIED]** `deletePlannedActivity`'s own doc comment (`db.ts:1550-1553`) states the product intent precisely: *"Permanently removes a plan from the list... Lets the user actually clear old completed plans instead of them only ever accumulating in 'Recently Completed'."* This is a genuine, already-shipped declutter feature, not a bug to be removed — the fix must preserve this UX exactly while stopping the silent loss of a different kind of fact (Goal achievement) that happens to be anchored to the same row.

---

## 3. Completion Evidence Model

**[VERIFIED]** For each model, what it represents and its authority:

| Model | Represents | Authoritative / derived / cached / merely linked | Survives plan deletion today? |
|---|---|---|---|
| `PlannedActivity.status` | A scheduled commitment, and (via `LOGGED`) the *only* source of truth for "was this explicitly completed" repo-wide | **Authoritative** for completion itself | N/A — this IS the fact, and it is this exact row that gets deleted |
| `PlannedActivity.loggedAt` | When the explicit Done tap happened | **Authoritative**, set once | No — deleted with the row |
| `GoalActivityOccurrence` | A stable identity for ONE concrete occurrence of a Rhythm GoalActivity, independent of which `PlannedActivity` currently fills it (`schema.prisma:891-950`'s own doc comment) | **Authoritative for occurrence identity and (since PR2) scheduled-week attribution**; derived/absent for completion (has no status column by design) | **Partially** — the row itself survives (only `plannedActivityId` goes `NULL`); `scheduledWeekStart`/`scheduledWeekTimezone` survive untouched (they are columns on THIS row, never read from the joined plan); but **whether it was ever completed is lost**, because that fact lives only on the now-gone `PlannedActivity.status` |
| `GoalActivityExecution` | A durable, per-GoalActivity-occurrence measured-progress fact, with an immutable `completionKindSnapshot`/`completionTargetValueSnapshot`/`completionUnitSnapshot` taken at creation | **Authoritative** for its own `currentValue`, but **never read by any production reporting code today** (`computeGoalProgress`, `goals.ts:83`, takes only `derivedStates`, never queries this table — confirmed by grep) | Survives a `SetNull` from plan deletion (its own `plannedActivityId` just goes `NULL`), **but is only reliably created for finite/`NONE` GoalActivities** — for Rhythm, see §1 finding 2 and §4 |
| `GoalActivity` (persisted `status`) | `SUGGESTED`/`DISMISSED` only — never `PLANNED`/`COMPLETED` | **Authoritative** for the two it stores | N/A |
| `GoalActivity.plannedActivityId` | "The currently/most-recently relevant live commitment" | **Authoritative pointer**, but for Rhythm GoalActivities means "most recently materialized," **never** "the one being completed" (`db.ts:3235-3242`'s own doc comment, confirmed) | `SetNull`'d by plan deletion, which is how finding 1 (§1) manifests for the finite case |
| `Goal` | A collection of GoalActivities with a target date and `ACTIVE`/`ARCHIVED` status | **Authoritative** for its own two fields; has no completion concept of its own (no "Goal completion transition" exists in the schema — confirmed: no `completedAt`/`completed` field anywhere on `Goal`) | — |
| `HabitLog` | An independent, free-standing record: "an activity titled X, in window Y, at instant Z, was logged" | **Authoritative for its own fact**, with **zero FK relationship to `PlannedActivity` in either direction** (confirmed: `HabitLog` has no `plannedActivityId` column at all; `PlannedActivity.habitLogId` is a plain `String?`, not a `@relation`) | **Yes — completely unaffected by `deletePlannedActivity`.** This is the one genuinely independent historical-achievement record that already survives today, by construction, because nothing connects it via an FK that could cascade |
| Goal Rhythm weekly aggregation (`loadGoalActivityRhythmFacts` et al.) | "How many occurrences this week are `COMPLETED`/`COMMITTED`" | **Derived, live, every read** — re-joins `GoalActivityOccurrence` to `PlannedActivity` on every call, no caching | Lost per-row exactly when the underlying plan is deleted (INNER JOIN excludes it) |
| Finite Goal progress (`deriveGoalActivityState`/`computeGoalProgress`) | "Is this one-shot GoalActivity done" | **Derived, live, every read**, purely from the `GoalActivity → PlannedActivity` join | Lost exactly when the underlying plan is deleted |

**Answering the ticket's exact question — which facts survive deletion today:**
- **Survives:** the raw `HabitLog` row (if one was created — only `logPlannedActivity`'s `AURA_PLANNED` path always creates one; a plan logged via other paths may not). The `GoalActivityOccurrence`/`GoalActivity`/`GoalActivityExecution` *rows* themselves survive (`SetNull`, not cascade) — but with their link cleared, and (per the models above) with no field on any of them that durably records "this was completed" independent of the now-gone `PlannedActivity.status`.
- **Lost:** every reporting fact that depends on joining to `PlannedActivity.status`/`loggedAt` — Weekly Goal Achievement's `completedThisWeek`, Finite Goal Progress's `COMPLETED` derivation, and (per §1 finding 2) for many real Rhythm completion orderings, the `GoalActivityExecution` fact was **never even written in the first place**, independent of deletion.

---

## 4. Real-DB Reproduction

**[VERIFIED by direct, live, instrumented reproduction]** against the real dev database, using only existing, unmodified production functions (`upsertUserByEmail`, `createGoalWithActivities`, `addGoalActivity`, `persistAcceptedConstructedDay`, `logPlannedActivity`, `deletePlannedActivity`, `deleteGoal`, `loadGoalActivityRhythmFacts`, `computeGoalActivityRhythmEligibility`, `deriveGoalActivityState`). Disposable script, deleted after use; cleanup ran in a `finally` block; `git status --short` confirmed no artifacts remain and no production code was touched.

### Scenario 1 — out-of-order completion of a multi-occurrence Rhythm goal (finding 2, §1)

1. `N_PER_WEEK=3` GoalActivity created. Occurrence #1 materialized → plan `P1` (`UPCOMING`). Occurrence #2 materialized → plan `P2` (`UPCOMING`).
2. Confirmed: `GoalActivity.plannedActivityId` now points at **`P2`**, not `P1` (the "most recently materialized" repoint, `db.ts:3270-3274`).
3. `logPlannedActivity(P1)` (completing the OLDER occurrence first) → **0** `GoalActivityExecution` rows created for `P1`. (Expected under the model's own stated purpose: 1.)
4. `logPlannedActivity(P2)` → **1** `GoalActivityExecution` row created for `P2` (the one `GoalActivity.plannedActivityId` happened to point at).

**This single result is sufficient to reject "use `GoalActivityExecution` as the per-occurrence evidence snapshot" in its current form** — it already silently fails to capture most real multi-session-per-week completions, with or without any later deletion.

### Scenario 2 — deleting a `LOGGED` Rhythm plan drops it from weekly facts (finding 1, §1)

Weekly facts before deleting `P1` (now `LOGGED` from Scenario 1): `completedThisWeek=2, committedThisWeek=0, remainingOccurrences=1`.
After `deletePlannedActivity(P1)`: the `GoalActivityOccurrence` row for `P1` survives with `plannedActivityId=NULL`; `completedThisWeek` **drops to 1**; `remainingOccurrences` **rises from 1 to 2** — the system now believes the user has two more free slots this week when they have genuinely completed two occurrences, one of which it simply forgot about.

### Scenario 3 — finite Goal progress reverts to `SUGGESTED`

A finite (`NONE`-rhythm) GoalActivity, planned and completed (`derivedGoalActivityState = COMPLETED`, confirmed, with a `GoalActivityExecution` row correctly created — the finite path has no repoint-ordering bug). After `deletePlannedActivity`: `GoalActivity.plannedActivityId → NULL`; derived state **flips to `SUGGESTED`** — indistinguishable from "never attempted." The underlying `GoalActivityExecution` row **does survive** (orphaned, `plannedActivityId=NULL`), but nothing reads it.

### Scenario 4 — Goal deletion cascades away whatever survived Scenario 3

With the plan already deleted (Scenario 3), `deleteGoal`'s `goalHasRetainedPlanLinkage` gate sees no linkage (correctly, per its own narrow check) and returns `'DELETED'`. The `GoalActivityExecution` row that survived Scenario 3 — count 1 before — is **cascaded away to 0** by the `Goal → GoalActivity → GoalActivityExecution` FK chain.

**Root-cause classification (ticket's own list):** not a broken join bug and not double-counting — it is **(a) missing evidence by design** (nothing on `PlannedActivity`'s dependents durably records "completed, independent of the join" at all, for either Rhythm or finite Goals) compounded by **(b) a second, independent write-side defect** (finding 2) that means the one model that theoretically could already hold that evidence (`GoalActivityExecution`) frequently never receives it for Rhythm goals in the first place, and **(c) a cascading-deletion gap** (Scenario 4) in the Goal-delete safety gate.

---

## 5. Preservation Alternatives

Evaluated against: correctness, schema impact, transaction safety, read-path changes, authorization, migration requirements, reporting compatibility, historical `NULL` behavior, concurrency, idempotency, deletion/privacy semantics, implementation complexity.

### Option A — Pre-delete completion snapshot
Snapshot the completion fact into a durable location *inside `deletePlannedActivity`, just before the `DELETE`*. **Correctness:** sound, if done atomically in one transaction. **Schema impact:** needs either a new table or new columns on an existing durable row. **Transaction safety:** requires wrapping today's single unconditional `DELETE` in a new transaction — a real, non-trivial change to a function three other production call sites might reasonably assume is a single fast statement (not independently verified here; a RECOMMENDED follow-up check before implementation). **Read-path changes:** same as Option C below. **Historical `NULL`:** fine, additive. **Concurrency:** a delete-time snapshot must re-read current state under lock, since a plan can only be deleted after its terminal status is already committed — so there is no genuine Delete-vs-Done race to protect against, but the code still needs the extra round trip. **Complexity:** strictly more than Option E (below), for the identical outcome, because it performs the same stamping work *lazily, at risk of being forgotten on every future delete-adjacent code path* instead of *eagerly, exactly once, at the one true completion event*.

### Option B — Soft deletion of `PlannedActivity`
Add `deletedAt`, turn the `DELETE` into an `UPDATE`, filter every "Recently Completed" list query by `deletedAt IS NULL`. **Correctness:** every existing join (`GoalActivityOccurrence`/`GoalActivityExecution`/`deriveGoalActivityState`/Rhythm facts) keeps working with **zero changes**, since the row and its `status`/`loggedAt` still physically exist. **Schema impact:** smallest possible for the Rhythm/finite correctness problem alone — one column. **Transaction safety:** trivial, same single-statement shape as today. **Reporting compatibility:** perfect, by construction. **Deletion/privacy semantics:** **this is where Option B fails the ticket's own explicit instruction** ("do not silently retain data that the existing deletion contract explicitly promises to erase," §I). Today's mechanism is a true SQL `DELETE` — at the data layer, the existing contract already *is* "erase the row," not merely "hide it from one list." Switching to soft-delete retains the plan's full content (title, notes, exact timestamps, `calendarUrl`) forever, which is a genuine, user-visible change to what "delete" means, not an engineering detail — **flagged as UNRESOLVED, §14**, not decided by this audit.

### Option C — Independent completion evidence stored per occurrence (`GoalActivityExecution`)
This is the ticket's own named Section F concern. **Proven, directly, by §4 Scenario 1: cannot be adopted as-is.** The write is gated on `GoalActivity.plannedActivityId`, a single pointer that is explicitly documented and confirmed to mean "most recently materialized," not "the occurrence currently being completed" — for any `N_PER_WEEK` GoalActivity where occurrences are created before all of them are completed (the normal case for target > 1), most completions never produce a row at all. **This design is REJECTED in its current form**, per the ticket's own explicit instruction ("If it cannot [represent independent per-occurrence evidence], reject that design"). A corrected version — keying the write off `GoalActivityOccurrence.plannedActivityId` (unique per plan, never repointed by a sibling's materialization) instead — fixes this, and is incorporated into the recommended Option E below for the finite case specifically, where no repoint-ordering bug exists.

### Option D — Disallow deletion of completed Goal-linked activities
Smallest possible code change: add a WHERE-clause/guard to `deletePlannedActivity` rejecting any plan whose `GoalActivity.plannedActivityId` or any `GoalActivityOccurrence.plannedActivityId` still points at it. **Correctness:** trivially correct (nothing can ever be lost if it can never be deleted). **Schema impact:** zero. **Reporting compatibility:** perfect (nothing changes about reads). **Product/UX impact — the real cost:** silently makes a whole class of "Recently Completed" items permanently undeletable, with no visible reason to the user, directly contradicting the function's own shipped purpose ("lets the user actually clear old completed plans"). **REJECTED as the primary solution** — a real product regression — but noted as a defensible, zero-risk *interim* measure if the team wants to stop the bleeding before Option E ships (§12).

### Option E — Minimal hybrid (RECOMMENDED, §7)
Combines a corrected, narrowly-targeted version of Option C (fixing the write-gating bug it exposed) for the Rhythm case, with a small read-path fix (not a schema change) for the finite case, plus a widened `deleteGoal` safety gate. Detailed in §7.

**Per the ticket's own instruction ("do not select a counter-only snapshot unless it can be proven safe")**: Option E is explicitly NOT a counter-only snapshot — it stores a **timestamp** (`completedAt`), not a count, on the same row that already durably identifies the occurrence, and that row's own existing `plannedActivityId` UNIQUE constraint (already proven in PR1/PR2's own test suites) is exactly the mechanism that already prevents any double-counting risk a bare counter would introduce.

---

## 6. Recommended Design

**[RECOMMENDED — not implemented by this audit]**

### For Rhythm (`N_PER_WEEK`) GoalActivities

1. **New column**: `GoalActivityOccurrence.completedAt DateTime? @db.Timestamptz(3)` — nullable, additive, same precedent as `movedAt`/`scheduledWeekStart`. Written **once**, by `logPlannedActivity`, at the exact moment it sets `PlannedActivity.status = 'LOGGED'` — never at delete time, never re-derived.
2. **Fix the lookup `logPlannedActivity` uses to find Goal linkage**: today it queries `GoalActivity WHERE "plannedActivityId" = $1` (`db.ts:1621`) — the shared, repointed pointer. Add a parallel lookup, `GoalActivityOccurrence WHERE "plannedActivityId" = $1` (unique per plan, never repointed by a sibling's materialization), and stamp `completedAt` on THAT specific occurrence row when found. This single change also fixes §1 finding 2 (the write-gating bug) as a direct side effect, since the occurrence-level lookup is correct by construction regardless of which plan `GoalActivity.plannedActivityId` currently happens to point at.
3. **Read-path change** (three sites, all already identified by the PR2 audit as the complete set of Rhythm readers): `loadGoalActivityRhythmFacts` (`db.ts:3051-3067`), `listGoalActivityOccurrenceRowsForActivities`/`buildGoalActivityRhythmFactsFromOccurrenceRows` (`db.ts:3095-3125`), and `enforceDestinationWeekCapacity`'s inline query (`planMove.ts:223`) — each changes its `JOIN` to a `LEFT JOIN`, and `deriveGoalActivityRhythmContribution`'s caller becomes: `completedAt IS NOT NULL → COMPLETED` (regardless of whether the join still resolves); else if the join resolves, derive from `pa.status` exactly as today; else (orphaned, never completed — e.g. a hard-deleted `CANCELLED` plan) → `NONE`.

### For finite (`NONE`-rhythm) GoalActivities

`GoalActivityExecution` is **already reliably written** for this case (no repoint-ordering bug — a finite GoalActivity never has more than one live link at a time). The gap here is purely a **read-path** gap, not a write-path gap:
4. `deriveGoalActivityState` (`goals.ts:49-65`) gains an optional 4th input — e.g. `everCompleted: boolean` (or `lastCompletedAt: Date | null`) — consulted ONLY when `plannedActivityId` is `NULL`, to distinguish "never planned" (true `SUGGESTED`) from "was planned, completed, and its plan was later deleted" (should still derive `COMPLETED`). The caller supplies this from a `SELECT EXISTS(... GoalActivityExecution WHERE "goalActivityId" = $1)` (or, more cheaply, a new `GoalActivity.lastCompletedAt DateTime?` column stamped by `logPlannedActivity` at the same moment as step 1 above, avoiding a second query entirely — **RECOMMENDED** for consistency with the Rhythm design and to avoid a dependency on a model nothing else reads).

### For both — the `deleteGoal` safety gate (fixing §4 Scenario 4)

5. Widen `goalHasRetainedPlanLinkage` (`db.ts:2805-2820`) to **also** check for retained evidence — `EXISTS (... GoalActivityOccurrence WHERE "goalActivityId"=ga.id AND "completedAt" IS NOT NULL)` for Rhythm, and the new `GoalActivity.lastCompletedAt IS NOT NULL` for finite — returning `'HAS_HISTORY'` exactly as it already does for retained linkage today. This is a **widening of an existing, already-shipped safety check**, not a new mechanism — Goal deletion already correctly blocks on real history; it simply needs to recognize this new kind of history too.

### What explicitly does NOT change

`deletePlannedActivity`, `skipPlannedActivity`, `cancelPlannedActivity`, `applyMoveWrites`, `updateUserLocation` — **zero changes to any of these**. The hard `DELETE` in `deletePlannedActivity` remains a true, full erasure of the `PlannedActivity` row's own content, exactly as today's product contract already promises.

**Migration**: one new migration (`0048`, proposed), two nullable additive columns (`GoalActivityOccurrence.completedAt`, `GoalActivity.lastCompletedAt`), no backfill — mirrors the `movedAt`/`scheduledWeekStart` precedent exactly. Historical rows predating this migration simply have `NULL` in both; a deletion that already happened before this fix ships cannot be retroactively recovered (the evidence is already gone) — this must be disclosed, never silently backfilled with a fabricated value.

---

## 7. PR2 Compatibility

**[VERIFIED]** `scheduledWeekStart`/`scheduledWeekTimezone` are columns on `GoalActivityOccurrence` itself, never read from the joined `PlannedActivity` — they already survive `deletePlannedActivity`'s `SetNull` untouched, with zero change needed. The new `completedAt` column (§6) lives on the exact same row, so a deleted-but-completed occurrence retains **both** "which week it was scheduled for" and "was it completed," with neither fact silently drifting.

**[VERIFIED, confirms the ticket's own explicit instruction]** `loggedAt` is never used as a proxy for scheduled-week attribution anywhere in this design — `completedAt` answers only "was this done," a boolean-shaped fact; `scheduledWeekStart` (unchanged, PR2) remains the sole week-attribution key, exactly as the approved policy already establishes. A completed-then-deleted occurrence's week credit is read from `scheduledWeekStart`, computed once at materialization/Move time from `plannedStartAt` — never recomputed from `completedAt`, so a late Done-tap (long after the scheduled week) still cannot silently move an occurrence's attribution, satisfying the ticket's explicit "must not silently move to a different week" requirement.

**Legacy `NULL` snapshots**: a pre-PR2 `GoalActivityOccurrence` row (both `scheduledWeekStart`/`scheduledWeekTimezone` `NULL`) that is also missing the new `completedAt` (pre-PR3) is read exactly as today — live-derivation fallback for the week, and (after PR3) `NONE` contribution unless its plan still resolves via the join. No new field ever retroactively changes a legacy row's documented behavior.

---

## 8. Concurrency and Idempotency

**[VERIFIED]**

1. **Which operations share the same advisory lock?** Only Move-family operations (`day-constructor-accept:${userId}`). `logPlannedActivity`/`skipPlannedActivity`/`cancelPlannedActivity`/`deletePlannedActivity` each take none — confirmed by the PR2 audit's own §6.2 table, re-verified here against current `70edca4`.
2. **Is completed status checked inside the transaction?** Yes — `logPlannedActivity` takes `FOR UPDATE` on the `PlannedActivity` row before checking/setting status (`db.ts:1576`); the new `completedAt` stamp (§6) is written inside this SAME transaction, on the SAME lock.
3. **Can a completion snapshot commit without the deletion?** Yes, and this is exactly the point — `completedAt` is stamped eagerly, at completion, entirely independent of whether a deletion will ever happen.
4. **Can deletion commit without the required completion evidence?** **No, by construction** — `deletePlannedActivity`'s `WHERE status IN ('LOGGED','CANCELLED')` can only ever match a plan whose terminal status (and, for `LOGGED`, its `completedAt` stamp) has **already committed** in a prior, separate transaction. There is no "Delete vs Done" race on the same plan: Done must fully commit before Delete's `WHERE` clause can even match. [VERIFIED, confirmed by reading both functions' full bodies — not merely inferred.]
5. **Can concurrent retries duplicate achievement credit?** No — `logPlannedActivity`'s existing idempotent-replay early-return (`db.ts:1582-1598`, `status==='LOGGED' && habitLogId` → return existing, never re-execute the write block) already guarantees the new `completedAt` stamp, sitting inside that same guarded block, is written exactly once, identical to how `movedAt` already inherits this guarantee today (PR1's own proven pattern).
6. **Can an old Move-chain source incorrectly contribute completion?** No — a `MOVED` row's status can never become `LOGGED` (Move only operates on `UPCOMING` plans, and a plan's status is a one-way ratchet away from `UPCOMING`); `completedAt` can therefore never be stamped on a tombstoned source row.

**Required serialization/rollback contract for the recommended design**: none beyond what already exists. The new write lives inside `logPlannedActivity`'s existing transaction and rolls back with it automatically on any failure; no new lock is needed because no new cross-operation race is introduced (confirmed by points 1-6 above, mirroring the PR2 audit's own §6.3/§6.4 reasoning for `scheduledWeekStart`).

---

## 9. Product Deletion Semantics

**[VERIFIED]** The current UI/API does **not** distinguish these two intentions anywhere:

- **DELETE PLANNED ACTIVITY** — "stop showing me this item in Recently Completed."
- **REMOVE CONFIRMED ACHIEVEMENT** — "actually undo/revoke the fact that I completed this."

Today, `deletePlannedActivity` is the ONLY action available, and it conflates both: tapping "clear" on a Recently Completed item is understood by the user as intention #1, but today's mechanism *also* silently performs intention #2 as an unintended side effect on Goal-linked items — per the ticket's own example, these "are not automatically equivalent," and here they are currently, incorrectly, treated as if they were.

**[RECOMMENDED]** The smallest honest product contract: adopt §6/§7's design so that intention #1 (declutter) no longer has intention #2 (revoke achievement) as a side effect — deleting the `PlannedActivity` row removes it from any list that reads `PlannedActivity` directly, while the durable `completedAt`/`lastCompletedAt` facts (on rows that already exist specifically to survive relinking) continue to correctly back Goal Rhythm and finite-progress reporting. This does not require adding a second, explicit "revoke achievement" action to the product today — it only requires that the existing, single "delete" action stop accidentally performing a revocation nobody asked for. Whether a genuine, explicit "undo my achievement" action should ever be added is a **separate, new product feature**, not something this audit recommends building.

**[VERIFIED]** This design does not silently retain anything the existing contract promises to erase: the `PlannedActivity` row itself — title, notes, exact timestamps, `calendarUrl`, event-location snapshot — is still genuinely, permanently gone. Only a timestamp already-adjacent fact ("this occurrence was completed, in this scheduled week") on an already-existing, Goal-specific, non-PII-bearing durable row survives.

---

## 10. Real-DB Test Matrix

**[RECOMMENDED]** All 20 required scenarios, following this repo's established real-DB convention (direct function calls, not HTTP; `check()`-based assertions against persisted rows and reporting function outputs, never UI-only):

| # | Scenario | Verifies |
|---|---|---|
| 1 | Delete `LOGGED` Goal-linked plan (Rhythm) | `GoalActivityOccurrence.completedAt` was already stamped before delete; weekly `completedThisWeek` is unchanged by the delete |
| 2 | Delete multiple `LOGGED` plans (same GoalActivity, different occurrences) | Each occurrence's own `completedAt` is independent; deleting one never affects another's weekly credit |
| 3 | Delete `UPCOMING` plan | Confirms `deletePlannedActivity` cannot match it at all (existing behavior, regression-guard) |
| 4 | Delete `CANCELLED` plan | Occurrence becomes orphaned with `completedAt` still `NULL` (never was completed) → contribution reads `NONE`, never silently becomes `COMPLETED` or crashes |
| 5 | Delete `SKIPPED` plan | Confirms `deletePlannedActivity`'s `WHERE` clause still excludes it (existing behavior, regression-guard) |
| 6 | Delete `MOVED` source | Confirms impossible — a `MOVED` row's status can never match `deletePlannedActivity`'s `WHERE` clause (regression-guard) |
| 7 | Delete Move-chain successor (after completion) | `completedAt` was stamped on the live occurrence row (repointed by Move, §2 path #8); deleting the successor plan still preserves the occurrence's `completedAt` |
| 8 | Delete vs Done (sequencing) | Confirms, live, that Done always commits (with its `completedAt` stamp) strictly before a Delete on the same plan can ever match (§8 point 4) |
| 9 | Delete vs Move | A plan cannot be both Moved (requires `UPCOMING`) and deleted (requires `LOGGED`/`CANCELLED`) at once — confirms this is structurally impossible, not merely untested |
| 10 | Repeated Delete | Second delete attempt on an already-deleted plan throws cleanly (`rowCount===0`), no corruption, no duplicate side effect |
| 11 | Delete vs Goal deletion | Deleting the plan first, then the Goal: confirms the widened `goalHasRetainedPlanLinkage` (§6 step 5) still blocks (`'HAS_HISTORY'`) while `completedAt`/`lastCompletedAt` evidence remains, where today it would incorrectly return `'DELETED'` |
| 12 | Delete vs GoalActivity deletion | Confirms no such path exists (§2 #11) — included for completeness/regression-guard only |
| 13 | Goal Rhythm weekly completion (direct regression test for §4 Scenario 2) | Delete a `LOGGED`, Rhythm-linked plan; confirm `completedThisWeek` does NOT drop, with the fix in place |
| 14 | Scheduled-week preservation | A deleted-but-completed occurrence's `scheduledWeekStart` is unchanged (§7) |
| 15 | Finite Goal progress (direct regression test for §4 Scenario 3) | Delete a `LOGGED`, finite-GoalActivity-linked plan; confirm `deriveGoalActivityState` still reads `COMPLETED`, not `SUGGESTED`, with the fix in place |
| 16 | Goal completion transition | Confirmed N/A — no such persisted concept exists on `Goal` itself (§3); included to document this explicitly rather than silently skip it |
| 17 | Legacy `NULL` week snapshot, now also legacy `NULL` `completedAt` | A pre-PR3 row with both fields `NULL` reads via the existing live-derivation fallback exactly as before — no crash, no fabricated value |
| 18 | Multiple independent occurrences (direct regression test for §F's hard requirement) | Two occurrences under one GoalActivity, both completed, one deleted: confirms the surviving one's `completedAt`/weekly credit is entirely untouched — no erasure, no duplication |
| 19 | Transaction rollback | A forced failure inside `logPlannedActivity` after the `completedAt` stamp but before `COMMIT` leaves zero trace (the existing `ROLLBACK` path, `db.ts:1787-1789`, already covers this — regression-guard, no new rollback logic needed) |
| 20 | No duplicate achievement credit (direct regression test for finding 2, §1/§4 Scenario 1) | The corrected occurrence-keyed lookup (§6 step 2) stamps `completedAt` correctly regardless of completion order relative to materialization order — proves the write-gating bug is actually fixed, not merely worked around |

---

## 11. Risks and STOP Conditions

**None of the following block starting implementation planning**, but should be confirmed first:

1. **[UNRESOLVED, §14]** Soft-delete (Option B) vs. the recommended Option E — a genuine data-retention/privacy policy choice, not an engineering detail.
2. **[OPEN QUESTION]** Should `GoalActivity.lastCompletedAt` be a single timestamp (last completion only) or does the product want to support a finite GoalActivity being completed, deleted, re-linked, and completed again as multiple independent historical achievements? Today's `linkGoalActivityToPlannedActivity` eligibility rule (`db.ts:3306-3320`) already permits re-linking after a `CANCELLED`/`SKIPPED` plan, and — once a `LOGGED` plan is deleted — re-linking becomes possible again too (its `plannedActivityId` goes `NULL`). This audit recommends the single-timestamp version as the smallest scope matching what the ticket actually asks (preserve the fact this GoalActivity's occurrence was completed), but flags that a full repeatable-achievement history for finite goals is a larger, different, not-yet-requested feature.
3. **[OPEN QUESTION]** Whether `deleteGoal`'s widened gate (§6 step 5) should be a hard block (`'HAS_HISTORY'`, matching today's behavior exactly) or whether the product wants an explicit "delete anyway, I understand this erases history" override path. This audit recommends the hard block, matching existing precedent, pending product confirmation.
4. A repo-wide check for any OTHER code path that reads `GoalActivity.plannedActivityId`/`GoalActivityOccurrence.plannedActivityId`/`GoalActivityExecution.plannedActivityId` and assumes it is never `NULL` for a completed item was not performed exhaustively in this audit (scope was the lifecycle/evidence model itself, not every presentation consumer) — **RECOMMENDED** as a first step of the implementation PR itself (mirroring this program's own established "exhaustive audit" discipline from the PR2 correction phase), not a reason to block this audit's verdict.

No STOP condition was found that blocks beginning implementation planning.

---

## 12. Exact Proposed Implementation Scope

**[RECOMMENDED — not implemented by this audit]**

- Migration `0048`: `GoalActivityOccurrence.completedAt DateTime? @db.Timestamptz(3)`, `GoalActivity.lastCompletedAt DateTime? @db.Timestamptz(3)`. Both nullable, additive, no backfill.
- Edit `logPlannedActivity` (`db.ts:1570-1793`): add the occurrence-keyed lookup (§6 step 2); stamp `completedAt` on the matched occurrence; stamp `lastCompletedAt` on the matched finite `GoalActivity` (the existing `goalActivityRes` lookup at `db.ts:1621` already resolves this one correctly for the finite case — no change needed to that specific query, only an additional `UPDATE` alongside the existing `GoalActivityExecution` write at `db.ts:1766-1783`).
- Edit `deriveGoalActivityState` (`goals.ts:49-65`): new optional input, consulted only when `plannedActivityId IS NULL`.
- Edit the three Rhythm read sites (§6 step 3): `loadGoalActivityRhythmFacts`, `listGoalActivityOccurrenceRowsForActivities`, `enforceDestinationWeekCapacity`'s inline query — `INNER JOIN → LEFT JOIN` plus the `completedAt`-aware contribution derivation.
- Edit `goalHasRetainedPlanLinkage` (`db.ts:2805-2820`): widen to also check `completedAt`/`lastCompletedAt`.
- The 20 tests in §10.
- **No other file touched** — no change to `deletePlannedActivity`, `skipPlannedActivity`, `cancelPlannedActivity`, `applyMoveWrites`, `updateUserLocation`, Prisma's `GoalActivityExecution` write itself (only a sibling `UPDATE` added alongside it), or any API route.
- **Rollback considerations**: purely additive migration — reversing it drops two nullable columns with zero impact elsewhere. The coupled read-site `LEFT JOIN` edits would need reverting together with the schema rollback (same coupling pattern the PR2 audit already called out for its own `COALESCE`-style read-site edits).

---

## 13. Delivery Checklist Cross-Reference

| Ticket requirement | Where addressed |
|---|---|
| A. Verify baseline | Header, this document |
| B. Trace deletion lifecycle | §2 |
| C. Trace completion evidence | §3 |
| D. Verify current data loss | §4 |
| E. Evaluate preservation models | §5 |
| F. Independent completion facts | §4 Scenario 1 (proves/rejects Option C as-is), §6 steps 1-2 (the corrected design), §10 test 18/20 |
| G. PR2 attribution compatibility | §7 |
| H. Concurrency and idempotency | §8 |
| I. Product semantics | §9 |
| J. Test design | §10 |
| K. Implementation design | §6, §12 |
| L. Deliverable | This document |

---

## 14. Unresolved Product Decisions

These require explicit human/product sign-off before implementation — this audit does not resolve them:

1. **The "Insights V1 product decision resolution" the ticket asks this audit to read is not present as a file in this repository.** It was delivered as a chat response in an earlier phase of this program and could not be independently re-read here. If it already settled any of the questions below, that prior decision should be restated/re-confirmed before implementation, not silently assumed by this audit.
2. **Option B (soft-delete) vs. Option E (recommended)** — whether retaining a `PlannedActivity`'s full content indefinitely (Option B) is an acceptable trade for a smaller diff, versus Option E's smaller retained-evidence footprint but slightly larger set of touched files. This audit recommends Option E specifically because it keeps today's "delete" meaning what it already means (true erasure of the plan's own content) — but the product may have reasons to prefer otherwise.
3. **Finite-goal repeatable achievement** (§12, item 2) — single last-completion timestamp (recommended, smallest scope) vs. a fuller multi-completion history for finite GoalActivities.
4. **`deleteGoal`'s widened gate** (§12, item 3) — hard block (recommended, matches existing precedent) vs. an explicit "delete anyway" override.
5. **Escalating a genuine tension**: the ticket's own Section I instructs "do not silently retain data that the existing deletion contract explicitly promises to erase" — this audit's recommended design satisfies that instruction (§6/§9), but flags explicitly that ANY design preserving Goal-achievement evidence across a plan deletion is, by definition, retaining *something* the user's "clear Recently Completed" tap did not ask them to keep. The product should explicitly confirm that preserving a minimal, non-identifying "this occurred, in this week" fact — never the plan's own title/notes/timestamps — is the correct line to draw, rather than this audit drawing it unilaterally.

---

**FINAL VERDICT:**

```
AURA — INSIGHTS V1 PR3 —
ARCHITECTURE READY
```

The data-loss mechanism is fully traced and confirmed by live reproduction, including a previously-undiscovered second root cause (the `GoalActivityExecution` write-gating bug) that a naive fix would have missed. The recommended design is small, additive, requires no change to the deletion path's own erasure behavior, and has a clear, complete test matrix. The open items in §11/§14 are product decisions implementation planning exists to resolve next — none block starting that planning.
