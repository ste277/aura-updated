# AURA — Insights V1 PR3 — Evidence Persistence Contract Addendum

**Mode:** Read-only targeted investigation. No implementation. No PR. No commits. No migrations.
**Baseline verified:** `HEAD == origin/main == f6f3bfb864d6692878e984679791c10b09cad0d4`. Migration count confirmed **47**. Working tree: only the two standing protected files and `.claude/settings.local.json`, untouched. `AURA_INSIGHTS_PR3_ARCHITECTURE_AUDIT.md` (this ticket's own source document) read in full; this addendum corrects and sharpens one part of that audit's recommendation (§4, §8 below) based on deeper investigation this ticket specifically demanded.

Tags: **VERIFIED** (direct code reading or live, instrumented reproduction), **RECOMMENDED** (engineering proposal), **UNRESOLVED** (needs a decision before implementation).

---

## 1. Executive Decision

**The prior audit's recommended design (`GoalActivityOccurrence.completedAt` + `GoalActivity.lastCompletedAt`, two new timestamp columns) is corrected here: it is unnecessarily lossy and is superseded by a smaller, single-column fix that reuses the existing `GoalActivityExecution` model instead of duplicating a thinner fact beside it.**

This investigation's own Section C test (§4 below) proves why: a finite `MEASURED_TARGET` GoalActivity completed at 25 of a 20-page target already has that real number — `25` — durably held in `GoalActivityExecution.currentValue`, surviving `deletePlannedActivity` untouched today. A bare `completedAt`/`lastCompletedAt` timestamp would answer "was it done, and when" but would never have carried that `25` at all — exactly the trap the ticket's own Section C/H instructions warn against ("do not assume a timestamp is a substitute for a progress value"; "reject any approach that stores a timestamp without preserving the corresponding progress semantics").

**The corrected minimal fix is one new column**: `GoalActivityExecution.goalActivityOccurrenceId String? @unique` — a durable link from an execution record to the occurrence it belongs to, which (unlike `plannedActivityId`) is never cleared by `deletePlannedActivity`. Combined with fixing the completion lookup to be occurrence-keyed (not `GoalActivity`'s shared, repointed pointer), this single column:
- Fixes the write-gating defect (prior audit's finding 2) — the lookup becomes correct regardless of materialization order.
- Fixes the orphaning problem (prior audit's finding 1) — because the link used to find an execution's week/identity after deletion no longer depends on `PlannedActivity` surviving.
- Preserves the *actual recorded value* (`currentValue`), not just a boolean-shaped timestamp — directly answering this ticket's Section C concern.
- Requires **zero** new column for the finite case at all — `GoalActivityExecution.goalActivityId` was **never** nullable or `SetNull`'d in the first place (confirmed, §3); the finite-case fix is a pure read-path change.

**Verdict: EVIDENCE CONTRACT READY** (§12 lists what remains open; none block implementation planning).

---

## 2. Exact Done Lifecycle

**[VERIFIED]**

- **API entry point**: `POST /api/plans/[planId]/log` (`apps/web/app/api/plans/[planId]/log/route.ts`). Session-authenticated (`getSessionFromRequest`); returns 401 if absent. Optional JSON body, `actualValue` (finite number), validated only for shape here — semantic validation ("is this value valid for this GoalActivity's completion requirement") lives entirely in `resolveCompletionActualValue`/`logPlannedActivity`, never duplicated at the route.
- **Every production caller, confirmed**: exactly one — this route. (`behavioralAffinity.ts`, `dailyAgenda.ts`, `planCompletionHistory.ts` reference `logPlannedActivity` only in doc comments, never invoke it — confirmed by grep.)
- **Authorization**: enforced inside `logPlannedActivity` itself, via `WHERE id=$1 AND "userId"=$2 FOR UPDATE` (`db.ts:1576`) — ownership is structural, not a separate check layered on top.
- **Transaction boundary**: one transaction, `client.query('BEGIN')` at `db.ts:1573` through `COMMIT` at `db.ts:1785`, or `ROLLBACK` in the `catch` (`db.ts:1787-1789`).
- **Advisory locking**: **none** — concurrency safety comes entirely from `FOR UPDATE` on the single `PlannedActivity` row (`db.ts:1576`), confirmed sufficient for every Done-adjacent race this and the prior audit traced (§6 below).
- **`PlannedActivity` update**: `status='LOGGED'`, `loggedAt`, `habitLogId` (`db.ts:1736-1745`).
- **`GoalActivityOccurrence` lookup**: **does not happen today at all.** `logPlannedActivity` never queries `GoalActivityOccurrence`; the string does not appear anywhere in its body (confirmed, re-read in full, `db.ts:1570-1793`). This is the precise mechanism of the write-gating defect (§4).
- **`GoalActivity` lookup**: `SELECT * FROM "GoalActivity" WHERE "plannedActivityId" = $1 AND "userId" = $2` (`db.ts:1621`) — the single shared pointer, repointed to "most recently materialized" by every new Rhythm occurrence (`db.ts:3270-3274`).
- **`GoalActivityExecution` writes**: an `INSERT` (first completion of this specific `plannedActivityId`) or `UPDATE` (only reachable if an execution already exists for this exact plan — confirmed dead code today, since nothing creates one before Done; `db.ts:1766-1783`).
- **`GoalActivity` progress writes**: **none.** `GoalActivity` has no `currentValue`/progress column of its own (confirmed, full field list re-read, §3) — only `completionTargetValue` (the *target*, immutable per-activity configuration, never a running value).
- **`Goal` completion transition**: **does not exist.** `Goal` persists only `status: 'ACTIVE'|'ARCHIVED'` and has no completion-shaped field anywhere (confirmed, full field list re-read). No code path ever marks a `Goal` "complete" based on its activities' states.
- **Idempotent replay**: `plan.status==='LOGGED' && plan.habitLogId` → return the existing row/log unchanged, **before** any Goal-linkage lookup or write is attempted (`db.ts:1582-1598`) — structurally idempotent, not merely accidental.

**Answers to this section's own questions:**
- **Which persisted row proves a specific Goal-linked occurrence was explicitly completed?** Today: the existence of a `GoalActivityExecution` row whose `plannedActivityId` equals that occurrence's plan — **but only for the finite case.** For Rhythm, there is no row-level proof *tied to the occurrence* at all; the only proof is `PlannedActivity.status='LOGGED'` on the (deletable) plan itself.
- **Does that proof exist for every valid completion sequence?** **No.** Confirmed by direct, row-ID-level live reproduction (§4): for a Rhythm GoalActivity, completing an occurrence whose plan is not the one `GoalActivity.plannedActivityId` currently points at produces **zero** `GoalActivityExecution` rows, full stop — independent of any later deletion.
- **The precise defect**: `logPlannedActivity`'s Goal-linkage lookup is keyed to the wrong identity. `GoalActivity.plannedActivityId` answers "which plan is most recently materialized," never "which GoalActivity does THIS plan belong to." The correct key for that question, for a Rhythm occurrence, is `GoalActivityOccurrence.plannedActivityId` (unique per plan, by construction never repointed by a sibling's materialization) — a lookup `logPlannedActivity` never performs today.

---

## 3. Execution Record Lifecycle

**[VERIFIED]**, re-read directly from `schema.prisma:831-889`:

- **Primary key**: `id String @id @default(uuid())`.
- **Foreign keys**: `userId → User` (`onDelete: Cascade`); `goalActivityId → GoalActivity` (`onDelete: Cascade`, **required, non-nullable** — confirmed: this column has never been nullable and is never `SetNull`'d by anything); `plannedActivityId → PlannedActivity` (`onDelete: SetNull`, nullable).
- **Unique constraints**: only `plannedActivityId` (`@unique`). **No unique constraint on `goalActivityId` alone** — the model's own doc comment confirms this is deliberate ("many rows over time are legitimate here... NOT a 0..1 relationship").
- **Index**: `@@index([userId, goalActivityId])` — already supports an efficient "all executions for this GoalActivity" query with zero new index work.
- **Creation**: exactly one call site, `logPlannedActivity`'s `INSERT` (`db.ts:1774-1781`), first completion of a given plan only.
- **Updates**: one call site (`db.ts:1770-1773`), confirmed currently unreachable in production (§2).
- **Reads**: **zero production call sites today.** Confirmed by grep — no file outside `db.ts` itself and test files queries this table. `computeGoalProgress` (`goals.ts:83`) takes only `derivedStates`, never touches it.
- **Deletion**: no direct hard-delete function exists for a single `GoalActivityExecution` row.
- **Cascade behavior**: removed only when its `GoalActivity` is deleted (which itself only happens via its `Goal`'s cascade, §2 of the prior audit) — **never** by `deletePlannedActivity` (which only clears `plannedActivityId`).
- **Historical usage**: the model's own schema doc comment still says *"G2.2.1 is schema/domain-only: no production code path creates, updates, reads, or displays a row of this model yet"* — **stale**, confirmed by the prior audit and re-confirmed here: `logPlannedActivity` has created rows since G2.2.2 shipped. Worth a documentation fix independent of this ticket's scope (not flagged as blocking).

### The 7-step scenario, live, row-ID-level [VERIFIED by direct reproduction]

Using a 3×/week Rhythm GoalActivity:

| Step | Action | Result |
|---|---|---|
| 1 | Occurrence #1 materialized (plan `P1`, `UPCOMING`) | Occurrence row `O1` created, `plannedActivityId=P1` |
| 2 | Occurrence #2 materialized (plan `P2`, `UPCOMING`) | Occurrence row `O2` created; `GoalActivity.plannedActivityId` repoints `P1→P2` |
| 3 | Complete the OLDER occurrence (`logPlannedActivity(P1)`) | **Zero** `GoalActivityExecution` rows exist afterward |
| 4 | Complete the NEWER occurrence (`logPlannedActivity(P2)`) | Exactly **one** row created — linked to `P2`, for GoalActivity `ga` |
| 5 | Delete the older completed plan (`deletePlannedActivity(P1)`) | `O1.plannedActivityId → NULL`; execution-row count unchanged (there was never one for `P1`) |
| 6 | Delete the newer completed plan (`deletePlannedActivity(P2)`) | `O2.plannedActivityId → NULL`; the ONE execution row's `plannedActivityId → NULL` too |
| 7 | Re-query | The surviving execution row (for `P2`'s completion) and occurrence `O2` **each independently became `plannedActivityId=NULL`** — and **nothing in the current schema links them back to each other anymore.** There is no column on either row that answers "which occurrence does this execution belong to" once both have orphaned. |

**Direct answers:**
- **Survive plan deletion?** Yes, the row itself — but only for the ONE occurrence (of two) that happened to produce a row at all.
- **Retain occurrence identity?** **No — this is the key new finding of this addendum.** Even where an execution row exists and survives, nothing durably ties it back to *which occurrence* it came from once `plannedActivityId` is cleared. `GoalActivityOccurrence.scheduledWeekStart` (the PR2 week-attribution key) becomes unreachable from the surviving execution row.
- **Retain GoalActivity identity?** Yes — `goalActivityId` is never cleared.
- **Independently countable?** Yes, in principle (no cap on rows per `GoalActivity`) — but only for the subset that was ever actually written.
- **Can be duplicated?** No — `plannedActivityId`'s `@unique` constraint prevents two rows for the same plan; the idempotent-replay guard (§2) prevents a second write attempt from ever reaching the `INSERT`.
- **Can be overwritten?** Not in current production practice (the `UPDATE` branch is dead code, §2) — but the *data model* permits it if that ever changes, with no append-only history.

---

## 4. Finite Goal Progress Semantics

**[VERIFIED]**

1. **Which field is authoritative?** For completion itself: `PlannedActivity.status==='LOGGED'`, exactly as the prior audit found, repo-wide, with no exception. For the *measured value* (pages, minutes, reps — whatever a `MEASURED_TARGET`/`DURATION` completion kind requires): `GoalActivityExecution.currentValue`, confirmed the **only** place this number is ever durably recorded — `GoalActivity` itself has no such field (re-confirmed, full field list, §3 of the prior audit, re-checked here: only `completionTargetValue`, the configured target, never a running "current" value).
2. **Which fields are derived?** `DerivedGoalActivityState` (`SUGGESTED|DISMISSED|PLANNED|COMPLETED`, `goals.ts:49-65`) and `GoalProgress` (`{total, completed}`, `goals.ts:83-88`) — both pure, computed fresh on every read, never persisted.
3. **Can completion be reversed?** **No.** Confirmed by repo-wide grep: no `unlog`/`undoLog`/`revertLog`/equivalent function exists anywhere. Once `LOGGED`, a `PlannedActivity`'s status is a one-way ratchet (no code path transitions it to anything else).
4. **Can a Goal be reopened?** **No code path exists.** `Goal.status` is `ACTIVE`/`ARCHIVED`; grep for an unarchive/reactivate function returns zero hits — confirms and sharpens the prior V1 audit's own "UNCONFIRMED... may be permanent in practice" note to a direct **VERIFIED: no such path exists today.**
5. **Does deleting a plan change already-confirmed progress?** For the *display* layer, yes (per PR3's original finding: `deriveGoalActivityState` reverts to `SUGGESTED`). For the *underlying* `GoalActivityExecution.currentValue`, **no** — confirmed by direct reproduction (§5): a `25`-of-`20` measured value survives `deletePlannedActivity` completely unchanged, orphaned but intact.
6. **Can `lastCompletedAt` safely preserve the existing finite Goal contract?** **No — this is the corrected conclusion of this addendum.** A timestamp alone would correctly fix the `SUGGESTED`-reversion display bug, but would silently discard the measured value entirely (there is nowhere else for it to live once the plan is gone, if `lastCompletedAt` is the only new field) — a strictly worse outcome than today's status quo, where the value at least survives *unreachably* in `GoalActivityExecution`. Adopting `lastCompletedAt` as proposed in the prior audit would have been adopting a design that actively obscures real data that already exists.
7. **Could it overwrite or obscure independent progress?** Yes, per point 6 — rejected for exactly this reason.

**Smallest correct alternative [RECOMMENDED]:** no new field on `GoalActivity` at all. Fix the **read path**: `deriveGoalActivityState`'s caller, when `plannedActivityId IS NULL`, additionally checks `EXISTS (SELECT 1 FROM "GoalActivityExecution" WHERE "goalActivityId" = $1)` — a query the existing `@@index([userId, goalActivityId])` already serves efficiently, zero schema change required for the finite case specifically. When true, derive `COMPLETED` (and expose `currentValue` for display, already present, already correct) instead of reverting to `SUGGESTED`.

---

## 5. Occurrence Completion Contract — `completedAt`, Evaluated and Superseded

**[VERIFIED/RECOMMENDED]** Evaluating the prior audit's own proposal precisely, as this section asks, before explaining why §1's corrected design replaces it:

- **Proposed meaning**: time the user explicitly tapped Done for this occurrence — never inferred actual-performance time. Consistent with the approved PR2 policy that `loggedAt`/completion timing is never used to re-attribute scheduled week.
- **Exact write location** (as originally proposed): inside `logPlannedActivity`, same transaction, same moment as the `PlannedActivity` status write.
- **Exact occurrence lookup** (as originally proposed): `GoalActivityOccurrence WHERE "plannedActivityId" = $1` — correctly occurrence-keyed, which is exactly the fix that matters (independent of which field ultimately receives the result).
- **Idempotency**: inherits `logPlannedActivity`'s existing structural replay guard (§2) — written exactly once, never re-stamped, same precedent as `movedAt`.
- **Transaction guarantees**: commits or rolls back atomically with the `PlannedActivity` write — no new lock needed (§6, Section G below).
- **Historical `NULL` semantics**: every pre-migration row `NULL`; never backfilled; live-derivation-equivalent fallback (`NONE` contribution) for a row with no completion evidence.
- **Relationship to `PlannedActivity`**: would be written once, at completion, and **never** touched again by Move, Skip, Cancel, or deletion — correctly tracks "was Done ever tapped for this occurrence," independent of the plan's own fate.
- **Relationship to execution records**: **this is the gap.** A bare `completedAt` on `GoalActivityOccurrence` answers "was it done, when" but carries no measured value — §4 proves this is insufficient whenever `completionKind` is `MEASURED_TARGET`/`DURATION`, not `DONE`.
- **Relationship to PR2 scheduled-week attribution**: fully compatible — `scheduledWeekStart` lives on the same row and is untouched by any of this (§7, prior audit).

**Verified directly**: an older occurrence CAN be completed after a newer sibling is created (§3's step 3) — the occurrence-keyed lookup, once fixed, handles this correctly regardless of ordering, because `GoalActivityOccurrence.plannedActivityId`'s uniqueness means the lookup for *this specific plan* is never affected by which plan `GoalActivity.plannedActivityId` separately happens to point at.

**Resolution**: fix the lookup exactly as proposed here, but write its result's identity (the occurrence's id) onto `GoalActivityExecution.goalActivityOccurrenceId` (§1's corrected design) rather than a parallel `completedAt` on `GoalActivityOccurrence` itself — this preserves everything this section verifies while also preserving the measured value §4 requires, in one column instead of two.

---

## 6. Goal Deletion Contract

**[VERIFIED]**

- **Current deletion eligibility**: `deleteGoal` (`db.ts:2836-2857`) — `FOR UPDATE` row-lock on the `Goal`, then gated on `goalHasRetainedPlanLinkage` returning `false`.
- **Existing linked-plan checks**: `goalHasRetainedPlanLinkage` (`db.ts:2805-2820`) — `GoalActivity.plannedActivityId IS NOT NULL` OR any `GoalActivityOccurrence.plannedActivityId IS NOT NULL` under this Goal.
- **Retained evidence checks**: **none exist today.** The gate has no awareness of `GoalActivityExecution` at all.
- **Cascade behavior**: `Goal → GoalActivity` (`Cascade`) → `GoalActivity → GoalActivityExecution`/`GoalActivityOccurrence` (both `Cascade`) — confirmed, re-read directly.
- **Authorization**: `userId` ownership check in the initial `SELECT ... FOR UPDATE`.
- **Transaction boundary**: one transaction, `beginTransaction()` through `COMMIT`/`ROLLBACK` (`db.ts:2837-2856`).
- **Race conditions**: **[VERIFIED by code reading — not independently live-reproduced, given the sub-millisecond timing window involved]** `deleteGoal` locks only the `Goal` row; `logPlannedActivity` locks only the `PlannedActivity` row. These share no common lock. A genuine TOCTOU window exists: `deleteGoal`'s retained-evidence check can read "no evidence," and a concurrent `logPlannedActivity` completing a sibling occurrence under the SAME Goal can commit a brand-new execution row microseconds later, which `deleteGoal`'s subsequent `DELETE` would then cascade away — a window neither this nor the prior audit previously identified, surfaced specifically by this ticket's Section G instruction to investigate "Delete vs Goal deletion" concurrency rigorously. Flagged in §12/§9 as requiring a locking decision at implementation time (not resolved here, per the ticket's own "do not modify locking yet").

**Proposed policy evaluated**: "ordinary Goal deletion must not silently destroy retained confirmed achievement evidence; explicit destructive deletion is a separate, later operation."

**Can this be implemented without making ordinary Goal cleanup permanently impossible?** **Yes.** Widening `goalHasRetainedPlanLinkage` to also check `EXISTS (GoalActivityExecution WHERE "goalActivityId" IN (... this Goal's activities ...))` returns `'HAS_HISTORY'` under the exact same existing response the function already uses for retained linkage — this is additive to an already-shipped, already-understood gate, not a new deletion mode. A Goal with genuinely zero history (never planned, or everything only `DISMISSED`/`CANCELLED`-without-completion) remains exactly as deletable as today. **No product conflict was found** between "preserve evidence" and "allow ordinary cleanup" — they coexist: a Goal becomes undeletable only once it has something real to protect, exactly mirroring the existing linkage gate's own already-accepted philosophy.

---

## 7. Product Decisions (per the ticket's own §F) — Technical Feasibility Check

All six are technically satisfiable by the design in §1/§8:

1. Keep hard-delete semantics for `PlannedActivity` — **satisfied**: zero change to `deletePlannedActivity`.
2. Preserve independently confirmed achievement evidence — **satisfied**: §1's corrected design, verified by reproduction.
3. No general-purpose event history in PR3 — **satisfied**: one column, one existing model reused, no new append-only ledger.
4. Never infer performance date from the Done timestamp — **satisfied**: `scheduledWeekStart` (PR2, unchanged) remains the sole week-attribution key; `GoalActivityExecution.createdAt` records only "when Done was tapped," never conflated with "when performed."
5. No broad finite-goal achievement-history feature — **satisfied**: the recommended finite-case fix is a read-path existence check, not a new history surface. (Open question, §12: whether a finite GoalActivity re-completed after delete+relink should ever be shown as more than one achievement — explicitly NOT built here, flagged as a separate, future decision if ever wanted.)
6. Prevent accidental Goal deletion when retained achievements exist — **satisfied**, modulo the TOCTOU window in §6, which is a locking decision, not a feasibility blocker.

**No remaining decision from this list was found to be technically unresolvable.**

---

## 8. Concurrency

**[VERIFIED / RECOMMENDED]**

| Interaction | Current protection | Risk under the recommended design |
|---|---|---|
| Done vs Delete | Structurally impossible to race — `deletePlannedActivity`'s `WHERE status IN ('LOGGED','CANCELLED')` can only ever match a plan whose terminal status (and, for `LOGGED`, its execution row) already committed in a prior, separate transaction | None — unchanged |
| Done vs Move | Structurally impossible — Move requires `status='UPCOMING'`; Done requires the same, and transitions it away; `FOR UPDATE` on the plan row makes whichever commits first win cleanly | None — unchanged |
| Done vs Skip | Same `FOR UPDATE`/conditional-`UPDATE` pattern already proven safe (PR2 audit §6.2) | None |
| Done vs Cancel | Same | None |
| Delete vs Goal deletion | **Genuine TOCTOU window, confirmed by code reading (§6)** | Unresolved — needs either a shared advisory lock (deleteGoal and logPlannedActivity both acquiring the same per-user key) or a re-check-immediately-before-`DELETE` pattern (narrows but does not fully close the window, since `logPlannedActivity` still isn't serialized against it) |
| Repeated Done | Existing idempotent-replay guard (§2) — proven, unchanged | None |
| Repeated Delete | Second delete attempt matches zero rows, throws cleanly | None |
| Multiple sibling completions | **This is the defect §1 fixes** — today, under-counted (§3); after the fix, each sibling's completion is independently, correctly recorded via its own occurrence-keyed lookup and its own unique `goalActivityOccurrenceId` | Fixed, not introduced |

**Proposed transaction/locking behavior [RECOMMENDED, not implemented]:**
- **Completion without evidence**: prevented structurally — the fix makes the `GoalActivityOccurrence`/`GoalActivityExecution` write happen in the SAME transaction as the `PlannedActivity` status write, so one cannot commit without the other.
- **Evidence without valid completion**: prevented — the `INSERT` only happens inside the already-guarded `plan.status !== 'UPCOMING'` rejection branch of `logPlannedActivity`, never independently.
- **Duplicate achievement credit**: prevented at the DB level by `goalActivityOccurrenceId @unique` (new) and `plannedActivityId @unique` (existing) — two independent, structural backstops, not merely app-logic discipline.
- **Partial progress updates / lost updates**: unaffected — same `FOR UPDATE` pattern already in place.
- **Accidental cascade deletion** (the `deleteGoal` TOCTOU, §6): **requires a locking decision this audit does not make** — RECOMMENDED options, for implementation time: (a) have `deleteGoal` acquire the SAME per-user advisory lock Day-Constructor-accept/Move already use, and have `logPlannedActivity` acquire it too (closes the race fully, but adds lock overhead to the hottest write path in the app — a real cost/benefit call); or (b) accept the narrow, already-rare window as a documented limitation (Goal deletion is a deliberate, infrequent user action, not a hot path, and the window is sub-transaction-length) — **UNRESOLVED, flagged for explicit product/engineering sign-off, not decided here.**

---

## 9. Proposed Schema

**[RECOMMENDED — supersedes the prior audit's two-column proposal]**

```prisma
model GoalActivityExecution {
  // ...existing fields unchanged...
  goalActivityOccurrenceId String?               @unique
  goalActivityOccurrence   GoalActivityOccurrence? @relation(fields: [goalActivityOccurrenceId], references: [id], onDelete: Cascade)
}
```

- **New field(s)**: exactly one — `GoalActivityExecution.goalActivityOccurrenceId String? @unique`. Nullable (stays `NULL` for every finite/`NONE`-rhythm execution, which has no occurrence row to point at — mirrors the existing `plannedActivityId` nullability precedent exactly).
- **Migration number**: `0048` (proposed).
- **Existing models reused**: `GoalActivityExecution` (already exists, already correctly captures `currentValue`/snapshot fields — this design makes it reliable and reachable, rather than replacing it), `GoalActivityOccurrence` (unchanged — `scheduledWeekStart`/`scheduledWeekTimezone` already correct and untouched).
- **Required unique constraint**: `goalActivityOccurrenceId @unique` — enforces exactly 0..1 execution per occurrence, the same cardinality `plannedActivityId`'s own unique constraint already enforces, now durable across plan deletion too.
- **Canonical Done write location**: `logPlannedActivity` (`db.ts`), unchanged transaction.
- **Occurrence identity lookup**: new — `SELECT id, "goalActivityId" FROM "GoalActivityOccurrence" WHERE "plannedActivityId" = $1 AND "userId" = $2`, added to `logPlannedActivity`, tried alongside (not instead of) the existing `GoalActivity.plannedActivityId` lookup: if the occurrence lookup succeeds, its `goalActivityId` is authoritative (correct for Rhythm); if it returns nothing (finite/`NONE` case, no occurrence row exists), fall back to today's existing `GoalActivity.plannedActivityId` lookup exactly as now.
- **Execution write correction**: the `INSERT` (`db.ts:1774-1781`) gains the resolved `goalActivityOccurrenceId` (or `NULL` for the finite case).
- **Goal Rhythm query changes**: the three Rhythm read sites (`loadGoalActivityRhythmFacts`, `listGoalActivityOccurrenceRowsForActivities`, `enforceDestinationWeekCapacity`'s inline query) each add a `LEFT JOIN "GoalActivityExecution" gae ON gae."goalActivityOccurrenceId" = gao.id`, alongside the existing (now `LEFT`, not `INNER`) join to `PlannedActivity`. Contribution derivation becomes: `gae.id IS NOT NULL → COMPLETED`; else if the `PlannedActivity` join resolves, derive from `pa.status` exactly as today; else (orphaned, never completed) → `NONE`.
- **Finite Goal progress changes**: `deriveGoalActivityState`'s caller gains the `EXISTS (GoalActivityExecution WHERE "goalActivityId" = $1)` check (§4) — no schema change for this half.
- **Goal deletion gate changes**: `goalHasRetainedPlanLinkage` widened to also check `EXISTS (GoalActivityExecution WHERE "goalActivityId" IN (SELECT id FROM "GoalActivity" WHERE "goalId" = $2))` (§6).
- **Historical compatibility**: every pre-migration `GoalActivityExecution` row has `goalActivityOccurrenceId = NULL` — for a Rhythm execution created before this migration, this means a since-deleted plan's completion is **not retroactively recoverable** (the evidence is already gone; this fix only protects completions going forward) — must be disclosed, never silently backfilled.
- **Rollback**: purely additive — dropping the column and reverting the three read-site `LEFT JOIN`s together restores exactly today's behavior.

**Explicitly rejected**: `GoalActivityOccurrence.completedAt` and `GoalActivity.lastCompletedAt` (the prior audit's own proposal) — neither is necessary (§1), and `lastCompletedAt` specifically would have obscured real progress data (§4).

---

## 10. Historical Compatibility

**[VERIFIED/RECOMMENDED]** No backfill, matching every precedent in this program (`movedAt`, `scheduledWeekStart`). A `GoalActivityExecution` row written before migration `0048` has `goalActivityOccurrenceId = NULL` regardless of whether it logically belongs to a Rhythm occurrence — it is read exactly as today (via the `plannedActivityId` join only), meaning a Rhythm completion already evidenced *before* this fix ships, whose plan is deleted *after* this fix ships, is **still vulnerable to the original defect** for that one row, since the durable link was never recorded for it. This is a genuine, disclosed limitation of any additive-only fix, not an oversight — recovering already-occurred history would require fabricating a link that was never captured, which this program's own established discipline (§5, `scheduledWeekStart`'s own doc comment) already rejects as a matter of principle.

---

## 11. Test Matrix

**[RECOMMENDED]** All 20 required scenarios:

| # | Scenario | Verifies |
|---|---|---|
| 1 | Rhythm completion (simple, in-order) | `goalActivityOccurrenceId` correctly set when completing the occurrence currently pointed at |
| 2 | Older sibling completed later (the defect, §3) | `goalActivityOccurrenceId` correctly set via the occurrence-keyed lookup even when `GoalActivity.plannedActivityId` points elsewhere |
| 3 | Multiple completed occurrences (3×/week, all completed in varying orders) | Three independent execution rows, each with its own correct `goalActivityOccurrenceId`, none merged/overwritten |
| 4 | Completed plan deletion | Execution row survives; `plannedActivityId → NULL`; `goalActivityOccurrenceId` **unchanged** — the occurrence is still identifiable |
| 5 | Multiple completed plan deletions | Each occurrence's execution row independently survives with its own intact `goalActivityOccurrenceId` |
| 6 | Finite Goal completion | Execution row created via the existing (already-correct) `GoalActivity.plannedActivityId` lookup; `goalActivityOccurrenceId` stays `NULL` (no occurrence row exists for finite) |
| 7 | Finite Goal progress preservation | `deriveGoalActivityState` reads `COMPLETED` (not `SUGGESTED`) after the plan is deleted, via the new `EXISTS` check |
| 8 | Manual progress coexistence | A `MEASURED_TARGET` execution's `currentValue` (e.g. 25 of a 20 target) is preserved and remains readable after deletion — direct regression test for §4/§5's root finding |
| 9 | Scheduled-week preservation | `GoalActivityOccurrence.scheduledWeekStart` unaffected by any of this (unchanged from PR2); a deleted-but-completed occurrence's week credit is read correctly via the new `LEFT JOIN` through `goalActivityOccurrenceId`, not through the (now-gone) `PlannedActivity` |
| 10 | Legacy `NULL` snapshots | A pre-migration-shaped execution row (`goalActivityOccurrenceId` forced `NULL`) reads via the unchanged `plannedActivityId`-only path, no crash, no fabricated link |
| 11 | Done vs Delete | Confirms structurally impossible to race (§8) — direct regression/documentation test |
| 12 | Done vs Move | Confirms structurally impossible (§8) |
| 13 | Done vs Skip | Confirms existing safety (§8), unaffected by this change |
| 14 | Done vs Cancel | Same |
| 15 | Repeated Done | Idempotent-replay guard still prevents a second `INSERT`/relink attempt |
| 16 | Repeated Delete | Second delete attempt on an already-deleted plan throws cleanly, no corruption |
| 17 | Goal deletion gate | Widened `goalHasRetainedPlanLinkage` correctly returns `'HAS_HISTORY'` once a plan is deleted but its execution evidence survives — direct regression test for §6/prior-audit Scenario 4 |
| 18 | GoalActivity deletion | Confirms no such path exists (§2 of the prior audit) — regression-guard only |
| 19 | Transaction rollback | A forced failure after the new write but before `COMMIT` leaves zero trace (existing `ROLLBACK` path, unchanged, already covers this) |
| 20 | No duplicate completion credit | `goalActivityOccurrenceId @unique` rejects a hypothetical second `INSERT` attempt for the same occurrence outright — direct proof the new constraint, not just app logic, prevents double-crediting |

---

## 12. Remaining Risks / Implementation STOP Conditions

**None block starting implementation planning.** Confirm before finalizing the implementation PR:

1. **[UNRESOLVED, §6/§8]** The `deleteGoal` vs. `logPlannedActivity` TOCTOU window — needs an explicit locking decision (shared advisory lock vs. accepted, documented, narrow residual risk). Not resolved by this audit per the ticket's own "do not modify locking yet."
2. **[UNRESOLVED, carried from the prior audit, §4 here]** Whether a finite GoalActivity completed, deleted, re-linked, and completed again should ever be shown/counted as more than one historical achievement — explicitly not built in this design (the `EXISTS` check only proves "at least one completion ever happened"), flagged as a separate, future product decision if ever wanted.
3. **[RECOMMENDED, not yet performed]** An exhaustive check for any OTHER presentation consumer that reads `GoalActivity.plannedActivityId`/`GoalActivityOccurrence.plannedActivityId` and assumes non-`NULL` for a completed item, beyond the Rhythm/finite paths this and the prior audit traced — scoped as the first step of the implementation PR itself, not a reason to delay this audit's verdict.
4. **Stale schema doc comment** (`GoalActivityExecution`'s own "no production code path... yet," §3) — a pre-existing documentation accuracy issue, independent of this ticket, worth a trivial fix whenever convenient.

---

## 13. Recommended PR3 Scope

**[RECOMMENDED — supersedes §12 of the prior audit's own scope list]**

- Migration `0048`: one nullable, additive, unique column — `GoalActivityExecution.goalActivityOccurrenceId`.
- Edit `logPlannedActivity` (`db.ts`): add the occurrence-keyed lookup; set `goalActivityOccurrenceId` on the execution `INSERT`.
- Edit `deriveGoalActivityState` (`goals.ts`): new optional "ever completed" input, consulted only when `plannedActivityId IS NULL`.
- Edit the three Rhythm read sites (`db.ts` ×2, `planMove.ts` ×1): `INNER JOIN → LEFT JOIN` on `PlannedActivity`, plus the new `LEFT JOIN` on `GoalActivityExecution`.
- Edit `goalHasRetainedPlanLinkage` (`db.ts`): widen to also check retained execution evidence.
- The 20 tests in §11.
- A locking decision for §12 item 1, made explicitly before (or alongside) this PR, not silently deferred.
- **No change to**: `deletePlannedActivity`, `skipPlannedActivity`, `cancelPlannedActivity`, `applyMoveWrites`, `updateUserLocation`, `GoalActivityOccurrence`'s own schema (no new column there at all — the prior audit's `completedAt` proposal is dropped entirely).

---

**FINAL VERDICT:**

```
AURA — INSIGHTS V1 PR3 —
EVIDENCE CONTRACT READY
```

This addendum corrects the prior audit's own recommendation after this ticket's deeper investigation surfaced a concrete case (§4, a measured 25-of-20-page completion) where the originally proposed timestamp-only design would have silently discarded real progress data. The corrected design is smaller (one column, not two), reuses existing, already-correct infrastructure (`GoalActivityExecution`) instead of duplicating a thinner fact beside it, and has a complete test matrix. The one genuinely open engineering question (§12 item 1, the Goal-deletion TOCTOU window) is a locking decision appropriately deferred to implementation time, not a defect in this design.
