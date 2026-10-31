# AURA DR4-F: Rescheduling Consistency & History Audit

**Status:** Audit only. No code changed. Based on `origin/main` as of merged PR [#252](https://github.com/ste277/aura-updated/pull/252) (merge SHA `70522ef8f7209a732bf7cb528e2abc636fdb5df9`).

**Headline finding:** Home's Move and the Plan tab's Reschedule are not two presentations of one contract — they are two unrelated mechanisms with materially different, and in one direction confirmed-defective, outcomes. The Plan tab's Reschedule **silently severs goal association** and **can silently rename the activity**, for any goal-linked plan a user reschedules from that surface. This is empirically reproduced below with real database rows, not inferred.

---

## 1. Entry-point inventory

| Entry point | UI component | Trigger | API endpoint | Mutation | Replacement created? | Lineage preserved? |
|---|---|---|---|---|---|---|
| Home — Right Now spotlight | `HomeDashboard.tsx` `renderMovePicker`/`openMovePicker` (components/HomeDashboard.tsx:710,749,797) via the spotlight's own Move trigger (line 1174/1206) | "Move" action on the current/imminent plan | `POST /api/plans/{id}/move` | `movePlannedActivity` → `applyMoveWrites` | Yes | Yes (`rescheduledFromPlanId`) |
| Home — Your Day timeline row | Same `renderMovePicker`/`openMovePicker` (components/HomeDashboard.tsx:861,875), generic per-row trigger | "Move" on any UPCOMING row in the day's timeline | `POST /api/plans/{id}/move` | Same | Yes | Yes |
| Home — Missed Recovery | `renderMissedRecovery` (components/HomeDashboard.tsx, documented in `lib/homeMissedRecovery.ts`) offers Done/Skip/**Move** — the SAME `openMovePicker`/`handleMoveRightNow` as the two rows above, no separate code path | "Move" on a derived-MISSED row | `POST /api/plans/{id}/move` | Same | Yes | Yes |
| Plan tab — Upcoming Plans | `PlanWithAuraView.tsx` `UpcomingPlan` card's "Reschedule" button (line ~1818) → `handleReschedulePlan` (line 669) | "Reschedule" on any upcoming card | `POST /api/plans` then `DELETE /api/plans/{id}` | `createPlannedActivity` (new, unrelated row) + `cancelPlannedActivity` (old → CANCELLED) | Yes, but **unlinked** | **No** |
| Plan tab — Missed Activities | `MissedActivityCard`'s "Reschedule" button, wired to the **identical** `handleReschedulePlan`/`handleSavePlan` pair (components/PlanWithAuraView.tsx, `<MissedActivityCard onReschedule={() => handleReschedulePlan(plan)}>`) | "Reschedule" on a derived-MISSED card | Same as above | Same as above | Same | **No** |
| Goal-linked activities | No dedicated entry point. `app/goals/` has no reschedule affordance of its own (confirmed: no match for "Reschedule"/Move in that directory). A goal-linked activity is just an ordinary `PlannedActivity` row that happens to have a `GoalActivity`/`GoalActivityOccurrence` FK pointing at it, so it is rescheduled through whichever of the above surfaces the user happens to use — Home or Plan — with no awareness of its own goal linkage at either surface. | — | — | — | — | Depends entirely on which surface was used (see above) |

**Confirmed, not assumed:** Plan's "Missed Activities" Reschedule is not a separate implementation — it is literally the same `handleReschedulePlan` function DR4-E2 wired onto `MissedActivityCard`, inheriting every property (and defect) of the Upcoming-card flow. A derived-MISSED plan's **persisted** status is still `UPCOMING` (DR4-E1), so `handleReschedulePlan`'s own `plan.status === 'UPCOMING' ? plan.id : null` check (line 681) treats it identically to a genuinely-upcoming plan.

---

## 2. Existing Move contract and limitations

Source: `lib/planMove.ts` (`movePlannedActivity`, `applyMoveWrites`, `enforceDestinationWeekCapacity`, `findBlockingPlanForRange`), `app/api/plans/[planId]/move/route.ts`.

### What Move does

```
A (UPCOMING) --Move--> A (MOVED, movedAt stamped) ---> B (UPCOMING, rescheduledFromPlanId = A.id)
```

One atomic transaction (`beginTransaction()` ... `COMMIT`/`ROLLBACK`, planMove.ts:78-120):

1. Per-user advisory lock (`pg_advisory_xact_lock(hashtext('day-constructor-accept:' + userId))`) — the **same** key Day Constructor acceptance takes, so the two serialize against each other.
2. `SELECT ... FOR UPDATE` row-locks the plan being moved.
3. Ownership is enforced on every query (`WHERE id = $1 AND "userId" = $2`).
4. Idempotent replay: if the plan is already `MOVED`, it looks up the existing successor via `rescheduledFromPlanId` and, if the **same** destination was requested, returns the existing pair without re-writing; otherwise `ALREADY_MOVED` (409).
5. Terminal-state protection: `if (a.status !== 'UPCOMING') throw INVALID_STATE` — blocks moving a `LOGGED`/`CANCELLED`/`SKIPPED` plan outright.
6. `HAS_LINKED_MOMENT` (409) blocks moving a plan with an active shared `AuraMoment` — must be rescheduled from the Moment instead.
7. Destination validation (`validateMoveDestination`, lines 56-69): whole-minute instant, strictly in the future, must differ from the current start.
8. Conflict check (`findBlockingPlanForRange`): any other **active-blocker** plan whose `[start, end)` overlaps the destination → `CONFLICT` (409).
9. `CAPACITY_EXCEEDED` (409): for an `N_PER_WEEK` goal-rhythm-linked plan, the destination week's existing capacity is re-checked before the move is allowed to cross into it.

### Fields copied to the replacement (verbatim, `applyMoveWrites` INSERT, lines 276-288)

`title`, `activityType`, `icon`, `durationMinutes`, `eventTimezone`, `eventLocationName`, `schedulingMode` (parsed/inherited), `activityId`, `rescheduledFromPlanId = a.id`.

### Fields intentionally recalculated or dropped (same INSERT)

`windowType` is hardcoded `'NEUTRAL'`; `windowLabel`, `matchLabel`, `score`, `recommendation` are all explicitly `NULL`. `calendarUrl` is rebuilt for the new instant. The code's own comment is explicit: *"Time-specific Aura evaluation is NOT carried over: it described A's time."* This is exactly the "no fabricated rating" discipline DR4-E3 just enforced for display — Move already produces a successor with **no** match data, which DR4-E3's updated `mapPlanRow` now renders correctly (no badge) rather than fabricating one.

### Goal/source continuity (applyMoveWrites, lines 304-352)

In the **same transaction**, after A transitions to MOVED:
- `UPDATE "Capture" SET "plannedActivityId" = B WHERE "plannedActivityId" = A`
- `UPDATE "GoalActivity" SET "plannedActivityId" = B WHERE "plannedActivityId" = A`
- `UPDATE "GoalActivityExecution" SET "plannedActivityId" = B WHERE "plannedActivityId" = A` (in practice almost always a no-op today — see Limitation 1 below)
- `UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = B, "scheduledWeekStart" = ..., "scheduledWeekTimezone" = ... WHERE "plannedActivityId" = A` — also re-stamps the occurrence's scheduled-week snapshot for the new instant, so cross-week moves correctly re-attribute weekly-rhythm credit.

**No new occurrence is ever created.** The code's own comment: *"a Move repoints an EXISTING occurrence's association; it never creates a new one."* This directly satisfies the ticket's stated product principle (Section 4): rescheduling must not count as completing an activity or creating additional goal progress.

### Atomicity, duplicate prevention, and repeated moves

- **Atomic**: yes — single transaction, any thrown error triggers `ROLLBACK` before the catch re-throws (lines 115-120).
- **Duplicate prevention**: the `UNIQUE("rescheduledFromPlanId")` constraint (migration `0038_planned_activity_move_lineage`) is a database-level backstop against a fork (A → B and A → C). Application-level idempotent replay (point 4 above) prevents a retry from even attempting a second write in the common case.
- **Repeated moves form a traversable history, not a flat pointer.** Each move sets `rescheduledFromPlanId` to its own **immediate predecessor** (`a.id`, whatever `a` is at that moment), so a chain of N moves is a true linked list (A ← B ← C ← ...), not a single pointer collapsed to the original. Migration `0046_planned_activity_moved_at`'s own comment confirms this explicitly: *"this field answers 'when did this ONE row's move commit,' never 'how many times has this logical commitment been moved in total' — that still requires walking the rescheduledFromPlanId chain backward."* There is no convenience field for "find the root ancestor" or "count of hops" — a consumer must walk the chain itself.
- **Failed operations leave the original unchanged**: guaranteed by the transaction wrapper; directly covered by an existing passing test (`test/movePlannedActivityDb.test.ts`, check 20/52: *"a forced source-repoint failure rolls EVERYTHING back: A stays UPCOMING, no B, the Capture still points at A, no HabitLog"*).
- **The API supports an explicitly selected replacement time** — `POST /api/plans/{id}/move` takes exactly `{ newStartAt }` (app/api/plans/[planId]/move/route.ts:26-30); duration/title/etc. are always inherited from the original, never separately specified.

### Limitations to weigh before reuse

1. **`GoalActivityExecution` repoint is defensive, not currently exercised.** Per the code's own comment (planMove.ts:306-321), an execution row is only ever created at completion time (`logPlannedActivity`), and a `LOGGED` plan can never be moved (terminal-state check blocks it) — so in production today, no `UPCOMING` plan ever has an execution row to repoint. This line is forward-looking correctness, not a currently load-bearing path.
2. **Move requires a future destination** (`newStartAt must be in the future`, line 64). It cannot move a plan to a past instant — not a limitation for this ticket's purposes, but worth noting if any future UI wanted to "correct" a plan's time retroactively.
3. **`HAS_LINKED_MOMENT` blocks Move outright** for a plan with an active shared Moment — the user must reschedule via the Moment flow instead. This is a real, existing constraint that any unified contract must keep respecting (Plan tab's own Reschedule does **not** currently check for this at all — see Section 3).
4. **Capacity enforcement (`CAPACITY_EXCEEDED`) only applies when a `GoalActivityOccurrence` row exists.** A goal-linked activity whose `GoalActivity` was created without ever materializing an occurrence (e.g., a one-off/finite goal activity with no rhythm) is unaffected — correctly, since capacity is an `N_PER_WEEK`-only concept.

---

## 3. Plan's current Reschedule workflow — confirmed defects

Source: `components/PlanWithAuraView.tsx` — `handleReschedulePlan` (line 669), `handleSavePlan` (line 611), `saveOpportunity` (line ~1018), `createPlannedActivity`/`cancelPlannedActivity` (lib/db.ts:1401,1516).

**The ticket's own trace is accurate** with one clarification: the original is not "updated" — it is cancelled. The real sequence is:

```
Reschedule (local UI state only, no server call)
  → Find a Time / search (no server mutation)
    → Select a candidate, "Use this time" (saveOpportunity, has a client-side busy guard)
      → POST /api/plans (createPlannedActivity: NEW, independent row)
      → DELETE /api/plans/{originalId} (cancelPlannedActivity: UPCOMING → CANCELLED), fire-and-forget
```

### Confirmed defect 1 — goal association is silently severed (empirically reproduced, Section 6)

`createPlannedActivity` (lib/db.ts:1401-1446) and `cancelPlannedActivity` (lib/db.ts:1516-1527) touch **only** the `PlannedActivity` table. Neither one references `GoalActivity`, `GoalActivityExecution`, `GoalActivityOccurrence`, or `Capture` anywhere in their bodies — confirmed by direct reading, not inference. Every one of those four tables' `plannedActivityId` FK is `onDelete: SetNull` (prisma/schema.prisma:815-816, 923-924, 1061-1062, 1120-1121) — but `cancelPlannedActivity` never deletes the row, only changes its `status`, so `SetNull` never fires either. The FK simply keeps pointing at the now-CANCELLED original forever.

### Confirmed defect 2 — the activity's title can silently change

`handleReschedulePlan` pre-fills the search box with the original's **title as free text** (`setTaskTitle(plan.title)`, line 670), then re-runs it through the normal Find-a-Time search. The saved result's title is `candidate.metadata.activityType` (`planPayloadFromCandidate`, lib/planFormatting.ts) — the **matched catalog entry's own canonical title**, not necessarily the original's literal title. Reproduced live twice independently: "Strength Training" → "Workout"; "Evening Walk" → "Walk Together" (Section 6).

### Confirmed defect 3 — no lineage is ever recorded

`createPlannedActivity`'s INSERT (lib/db.ts:1417-1444) has no `rescheduledFromPlanId` column at all in its column list. Every plan created through Plan's Reschedule flow has `rescheduledFromPlanId = NULL`, confirmed in Section 6's live rows. A chain of repeated Plan-tab reschedules produces a sequence of entirely disconnected rows, each one's only trace of the last being the CANCELLED original sitting in history with no forward pointer.

### Confirmed defect 4 — Insights misclassifies a Plan-tab reschedule as a cancellation

`lib/insightsReporting.ts`'s `classifyPlanningStatus` (lines 63-80) maps persisted `status` directly: `'MOVED' → 'RESCHEDULED'`, `'CANCELLED' → 'CANCELLED'`. Since Plan's Reschedule leaves the original as `CANCELLED` (never `MOVED`), every reschedule done from the Plan tab is counted in the user's own Insights as a **cancellation**, not a reschedule — inflating the "cancelled" stat and leaving "rescheduled" permanently at the count of Home-only moves. This is visible today in `InsightsView.tsx`'s own "Planning Patterns" card (`reporting.planningStatus.rescheduled`/`.cancelled`, line 1390).

### Confirmed, not hypothetical — "replacement succeeds, cancel fails"

The cancel call (line 643) is explicitly fire-and-forget: `fetch(...).catch((err) => { console.warn(...); })` — no retry, no compensating action, no user-facing error, and the new plan has already been added to local state and treated as a success by this point. If that one `DELETE` fails (network blip, a 409 race against some other concurrent mutation of the original, etc.), the UI will not reflect it until the next full `GET /api/plans` refetch (since the local optimistic filter already hid the "cancelled" id) — at which point the user will suddenly see **both** the old, still-`UPCOMING` original and the new plan, genuinely duplicated. This is directly readable from the code, not a hypothetical: there is no code path that retries, surfaces, or reconciles this failure.

### Verified correct / not defects

- **Duplicate creation from a user's own double-click** is guarded: every "Use this time" button goes through `saveOpportunity`, which checks `savingOpportunityKey`/`plannedOpportunityKeys` before allowing a second submit. `createPlannedActivity`'s own soft content-dedup (`WHERE status='UPCOMING' AND lower(title)=lower($2) AND plannedStartAt=$3 AND plannedEndAt=$4`) is a second backstop against an exact-duplicate POST.
- **Abandoning the flow is safe.** `handleReschedulePlan` performs **no server call at all** — it only sets local component state (pre-fills the search form). Reproduced live: clicking Reschedule then navigating away without saving leaves the original row completely untouched (`status: UPCOMING`, confirmed via direct query).
- **The original remains visible in history** in the sense that the CANCELLED row is not hard-deleted (only `deletePlannedActivity`, scoped to `LOGGED`/`CANCELLED` rows via an explicit user action, removes it) — but nothing in the current UI labels it as "rescheduled" specifically; see Section 5.
- **Recommendation data is recalculated appropriately** for the NEW row (a real Find-a-Time search runs), which is itself correct behavior — the defect is not that it's recalculated, but that nothing connects the new recommendation back to the old commitment.

---

## 4. Goal/metadata preservation matrix

| Field | Home Move | Plan Reschedule |
|---|---|---|
| Goal ID (via `GoalActivity.goalId`, unchanged since `GoalActivity` itself isn't touched) | Preserved (the `GoalActivity` row is untouched; only its `plannedActivityId` repoints) | Preserved on the **old**, now-orphaned `GoalActivity` row — but it points at a cancelled plan the user can no longer act on from Goals |
| Goal Activity ID / `GoalActivity.plannedActivityId` | Repointed to the new plan (`UPDATE ... SET plannedActivityId = B`) | **Never repointed** — still points at the cancelled original |
| `GoalActivityOccurrence` association | Repointed, plus scheduled-week snapshot re-stamped for the new instant | **Never repointed** |
| `GoalActivityExecution` association | Repointed (defensive; not reachable in practice today — see Limitation 1) | **Never repointed** (same caveat — but moot anyway since execution only exists post-completion) |
| Activity title / intent | Preserved verbatim | **Not guaranteed** — re-resolved via catalog title match, can silently change |
| `activityId` (catalog identity) | Preserved verbatim (`a.activityId`) | Re-derived via `resolveActivitySelection(taskTitle)` against the (possibly already-changed) title, not copied from the original |
| User-provided notes/metadata | `PlannedActivity` has no free-text notes field independent of `recommendation`/title; `recommendation` is intentionally **not** carried over by Move either (see Section 2) — both mechanisms treat recommendation text as time-specific, correctly | Same: `recommendation` is freshly computed by the new search, not an issue specific to goal continuity |
| Scheduling preferences (`schedulingMode`) | Inherited exactly (FIXED stays FIXED, FLEXIBLE stays FLEXIBLE) | Not threaded at all — the new plan is created via the generic `createPlannedActivity` path, which defaults `schedulingMode` via `parseSchedulingMode(undefined)` (DIRECT_PLAN_SCHEDULING_MODE semantics), regardless of what the original had |
| Goal progress / completion count | **Unaffected by either mechanism** — progress is created exclusively by `logPlannedActivity`'s own completion transaction (confirmed in DR4-E3's own audit), and neither Move nor Plan's Reschedule calls it. Rescheduling, via either path, correctly never counts as completing anything or creating new goal progress. | Same |

**Expected product principle from the ticket — "Rescheduling should not count as completing an activity or creating additional goal progress" — already holds for both mechanisms.** The defect is specifically about **continuity of identity**, not about progress/completion semantics.

---

## 5. History and user experience

What a user currently sees after each kind of reschedule:

| Question | Home Move | Plan Reschedule |
|---|---|---|
| Old activity disappears from Upcoming/Missed? | Yes (status MOVED → excluded from both `isUpcomingOrCurrentPlan`/`isMissedPlan`, DR4-E1) | Yes (status CANCELLED → same exclusion) |
| Replacement appears at its new time? | Yes, in Upcoming Plans | Yes, in Upcoming Plans |
| Does the UI show that it was rescheduled (vs. cancelled)? | **No explicit UI label either way** — a MOVED plan has no representation on the Plan tab at all (`isActionableUpcomingPlan` excludes anything but UPCOMING; DR4-E2's "Recently Completed" only shows LOGGED). Insights' own stats (Section 3, defect 4) are the only place `RESCHEDULED` is surfaced today, and only correctly for Home-originated moves. | Same — no explicit label, and Insights miscounts it as Cancelled |
| Can the user distinguish Rescheduled from Cancelled? | **Only via Insights' aggregate stats**, not per-activity, and not in the Plan tab itself | **No** — both Home-cancelled-for-real and Plan-rescheduled activities look identical (both end as status CANCELLED, with zero means of telling them apart) |
| Does the replacement retain a visible link to the original? | Via `rescheduledFromPlanId` in the database — but **nothing in the UI currently surfaces this chain to the user** at all, for either mechanism | No link exists to surface |
| Do repeated reschedules remain understandable? | The chain is traversable in the database, but equally invisible in the UI as a single reschedule | Each hop is a fresh, disconnected row; nothing to trace even if the UI wanted to |

**Minimal history presentation recommendation (not implemented in this audit):** `movePlannedActivityDb.test.ts`'s own pattern already answers "how do I find a plan's full move history" (walk `rescheduledFromPlanId` backward); the Plan tab has no history screen or rescheduled-count UI of any kind to extend. Per the ticket's constraint ("do not introduce a new activity-history screen"), the smallest additions worth considering later are: (a) a small "Rescheduled" badge on `MissedActivityCard`/`UpcomingPlan` reusing the exact neutral-badge pattern DR4-E3 just established for "Missed" (`colors.caution`-style chip, no new visual language), shown only for a plan whose `rescheduledFromPlanId` is non-null; (b) nothing deeper — a full timeline view is explicitly out of scope per the ticket.

---

## 6. Live reproduction evidence

Disposable local Postgres database, fully migrated (50/50), seeded fresh, dropped after. No production data touched.

### 6a. Goal-linked activity rescheduled via Plan tab — the headline defect

Seeded: `Goal "Get fit"` → `GoalActivity "Strength Training"` (id `cccacef1-...`, status `SUGGESTED`) → `PlannedActivity "Strength Training"` (id `7eaf27d8-...`, UPCOMING, future).

Action: expanded the card on the **Plan tab**, clicked Reschedule, ran Find a Time, clicked "Use this time" on the Best Match result.

Observed network calls: `POST /api/plans` (200) immediately followed by `DELETE /api/plans/7eaf27d8-...` (200) — exactly the predicted sequence.

Database after:

```
PlannedActivity (id=7eaf27d8..., title='Strength Training', status=CANCELLED)
PlannedActivity (id=1190c0eb..., title='Workout',            status=UPCOMING)   -- the "replacement"; title silently changed
GoalActivity    (id=cccacef1..., title='Strength Training', status=SUGGESTED, plannedActivityId=7eaf27d8...)  -- still points at the CANCELLED row
```

```sql
SELECT id, title, "plannedActivityId" FROM "GoalActivity" WHERE "plannedActivityId" = '1190c0eb-...';
-- 0 rows: the new plan is completely unknown to the Goal.
```

This is unambiguous: the goal's own activity record now references a cancelled commitment, and the actual live, actionable plan has zero relationship to any goal.

### 6b. Home Move — correct behavior, confirmed via the existing automated suite against the same local database

Rather than fight transient Browser-pane navigation flakiness for a redundant manual proof, `test/movePlannedActivityDb.test.ts` was run fresh against this same disposable database:

```
OK   14/32. GoalActivity now points at B and derives PLANNED (never SUGGESTED)
ALL MOVE DB CHECKS PASSED
```

This is the same `applyMoveWrites` code path documented in Section 2, independently and automatically re-verified live rather than assumed from reading alone.

### 6c. Reschedule a missed activity from Plan — same mechanism, same defects

Seeded a `Missed` card ("Stretch Routine"). Its Reschedule button is wired to the identical `handleReschedulePlan`; behavior (new unrelated row, old cancelled, no lineage) is identical to 6a's non-goal-linked case — confirmed by code identity (Section 1), not re-run separately since it is literally the same function.

### 6d. Reschedule the same activity more than once (Plan tab)

"Evening Walk" (plain, no goal) → rescheduled → became **"Walk Together"** (title changed again, independently confirming defect 2 is not a one-off artifact of the first fixture). A second Reschedule attempt on "Walk Together" resolved back to a dedup-matching slot (`createPlannedActivity`'s own soft dedup, Section 3) and collapsed into a no-op rather than producing a third row — itself a minor, separately-worth-noting edge case: Plan's Reschedule can silently no-op under `createPlannedActivity`'s title+exact-time dedup if the new search happens to recommend returning to an existing row's exact slot. In every case observed, `rescheduledFromPlanId` was `NULL` on every Plan-tab-created row.

### 6e. Abandon a rescheduling flow before saving

Clicked Reschedule on "Read a Book", then navigated to Home without completing Find-a-Time/Save.

```sql
SELECT status FROM "PlannedActivity" WHERE id = 'ff677f74-...'; -- UPCOMING, unchanged.
```

Confirmed safe: `handleReschedulePlan` performs no server call, so an abandoned flow leaves the original completely untouched — this matches the ticket's own expected-behavior table already, with no defect to report.

---

## 7. Transaction and concurrency findings

| Guarantee | Move | Plan Reschedule |
|---|---|---|
| Atomic updates | Yes — single DB transaction, explicit ROLLBACK on any error | **No** — two independent, unrelated HTTP requests (`POST` then `DELETE`), no transaction spans them |
| Duplicate prevention | DB-level `UNIQUE("rescheduledFromPlanId")` + app-level idempotent replay | Client-side busy guard + server-side soft content-dedup on the `POST`; **no protection at all** on the `DELETE` (fire-and-forget, Section 3) |
| Ownership validation | Every query scoped to `WHERE ... AND "userId" = $2` | Every query scoped the same way (both `createPlannedActivity`/`cancelPlannedActivity` take `userId`) — ownership itself is fine on both mechanisms |
| Protection against acting on a terminal activity | `if (a.status !== 'UPCOMING') throw INVALID_STATE` | `cancelPlannedActivity`'s own `WHERE status = 'UPCOMING'` conditional UPDATE protects the cancel step itself, but there is no equivalent guard tying the **create** step to the **cancel** step — they are not one operation |
| Consistent behavior for simultaneous requests | Per-user advisory lock + row-level `FOR UPDATE` serializes concurrent Move attempts on the same plan | No lock of any kind; two concurrent Reschedule attempts on the same original could both succeed in creating a replacement before either `DELETE` lands, though the server's one hard guarantee here is that `cancelPlannedActivity`'s conditional UPDATE means only the **first** DELETE actually cancels anything — a second DELETE on an already-CANCELLED row simply affects zero rows and throws (caught, logged, swallowed) |
| Clear failure responses | Six distinct, well-defined error codes mapped to HTTP statuses (`app/api/plans/[planId]/move/route.ts`) | The `POST` can fail with a real, surfaced error (`handleSavePlan`'s own catch sets `error` state); the `DELETE`'s failure is deliberately **not** surfaced to the user at all |
| Safe retry behavior | Yes — replaying an identical Move request returns the same existing successor rather than erroring or duplicating | Retrying the **save** step is reasonably safe (soft dedup); retrying after a failed cancel has no defined behavior — nothing in the code attempts it |

**Missing guarantee, stated plainly:** Plan's Reschedule has no single guarantee that "create succeeded AND cancel succeeded, or neither did." It has two independently-successful-or-failed halves glued together by a client-side `.catch` that only logs a warning.

---

## 8. Regression inventory

Existing tests found and their relevance:

- **Move**: `test/movePlannedActivity.test.ts` (pure/structural), `test/movePlannedActivityDb.test.ts` (live DB, including the goal-continuity assertion re-run in Section 6b), `test/movePlanApiDb.test.ts` (route-level, status codes, conflict/capacity/linked-moment cases).
- **Reschedule (Plan tab)**: no dedicated test file exists for `handleReschedulePlan`/`handleSavePlan`'s own cancel-the-old-create-the-new sequence or its goal-continuity behavior. `test/planWithAuraViewLogic.test.ts` covers `planPayloadFromCandidate`'s own field mapping (the save-time data shape) but not the reschedule orchestration itself, and nothing anywhere asserts whether a `GoalActivity`/`GoalActivityOccurrence` is or isn't repointed by this path — this audit's Section 6a reproduction is, as far as this search found, the **first time this specific behavior has been checked at all**, automated or manual.
- **Cancellation**: `test/skipPlannedActivity.test.ts` and `test/planStatusPreservationDb.test.ts` cover `cancelPlannedActivity`'s own conditional-UPDATE contract in isolation (status preservation across replay, etc.), but not in the context of being half of a reschedule.
- **Activity creation**: `test/plannedActivityCanonicalIdentity.test.ts`, `test/plannedActivitySchedulingMode.test.ts` cover `createPlannedActivity`'s own `activityId`/`schedulingMode` handling in isolation — again, not in the reschedule context.
- **Goal continuity**: `test/movePlannedActivityDb.test.ts` is the only test file found that exercises `GoalActivity`/`GoalActivityOccurrence` repoint behavior at all, and it only covers Move.
- **Missed activity handling**: `test/timeAwareUpcomingPlans.test.ts` (DR4-E1), `test/missedActivityPresentation.test.ts` (DR4-E2), `test/recommendationStatusClarity.test.ts` (DR4-E3) — none of these touch the Reschedule action's own server-side behavior; they test classification, section presentation, and indicator correctness respectively.

### The two previously-reported `movePlannedActivity.test.ts` failures

```
FAIL 3/69. 0038 is D2's only migration: it is present, and no OTHER migration directory's own
           contents also reference rescheduledFromPlanId/move lineage
FAIL 2.    schema: one nullable UNIQUE self-relation with ON DELETE SET NULL; no movedAt, no
           forward pointer column, no reason, status stays a text column
```

**Confirmed stale test fixtures, not a defect.** Migration `0046_planned_activity_moved_at` (its own header comment, quoted in Section 2) deliberately and additively introduced the `movedAt` column *after* migration 0038 and after this test's own assertions were written, explicitly building on 0038's lineage mechanism rather than conflicting with it ("Insights V1 PR 1 — Move Timestamp Foundation... the one shared write path both a manual Move and Remaining-Day Recomposition acceptance use"). The test was pinned to the schema's state as of 0038 and was never updated when 0046 landed. The current Move implementation is strictly more capable than what the test expects, not defective relative to it. Per the ticket's own instruction, these were **not** repaired during this audit.

---

## 9. Proposed unified rescheduling behavior

Evaluating the ticket's own proposal table against everything above:

| Scenario | Proposed | Currently true? |
|---|---|---|
| Reschedule upcoming activity | Original marked MOVED; replacement created | True for Home; **false** for Plan (CANCELLED, unrelated replacement) |
| Reschedule missed activity | Original marked MOVED; replacement created | True for Home (Missed Recovery's Move); **false** for Plan's Missed Activities (same defect as Upcoming) |
| Reschedule goal-linked activity | Goal association preserved | True for Home; **confirmed false** for Plan (Section 6a) |
| Reschedule repeatedly | Move lineage preserved | True for Home (chain, walkable); **false** for Plan (no lineage at all, ever) |
| Abandon rescheduling | Original unchanged | **True for both** (Plan's flow performs no server call until save; confirmed live, Section 6e) |
| Replacement creation fails | Original unchanged | True for Move (transactional); true for Plan **only incidentally** — if `createPlannedActivity`'s POST itself fails, the DELETE is never reached (it's sequenced after, inside the same `try`), so the original does survive a *create* failure. The proposal doesn't hold for the *opposite* failure (create succeeds, cancel fails) — Section 3's confirmed defect. |
| Move succeeds | Only replacement remains actionable | True for Home; true for Plan **in the common case**, false in the fire-and-forget-cancel-failure case |
| Activity completed | Existing completion/history behavior preserved | True for both — neither mechanism touches completion/goal-progress semantics (Section 4) |

**The existing Move implementation already supports every scenario in this table correctly, for the Home surface.** The gap is entirely that the Plan tab never adopted it.

---

## 10. Product decisions requiring approval

1. **Should the Plan tab's Reschedule be re-implemented to call the existing Move contract (`POST /api/plans/{id}/move`) instead of create+delete?** This is the audit's own recommendation (see Completion Criteria below), but it is a real behavior change the product should explicitly approve: Move requires a **future** destination (today's Plan reschedule has no such restriction beyond what Find-a-Time naturally offers) and will reject a destination that conflicts with another active plan (`CONFLICT`) or that exceeds a goal's weekly capacity (`CAPACITY_EXCEEDED`) — both currently-silent-in-Plan's-flow constraints that a user would newly encounter.
2. **Should `HAS_LINKED_MOMENT` block Plan's Reschedule too?** Today it doesn't (Plan's flow never checks for a linked Moment at all) — adopting Move would introduce this restriction to the Plan tab for the first time.
3. **Should the replacement's title always be forced to match the original exactly**, rather than being re-derived from a fresh catalog search? Move already does this (copies `a.title` verbatim) — adopting Move's contract would fix defect 2 as a side effect, but this should be an explicit, acknowledged decision, not just an implementation detail, since some users may have relied on the free-text "Reschedule" flow precisely to also *tweak* the title.
4. **Should a minimal "Rescheduled" indicator be added to the Plan tab's cards** (reusing the DR4-E2/E3 badge convention), once lineage is actually being recorded? Section 5's recommendation, requires approval since it's new UI, however small.
5. **Should Insights' "Cancelled" vs. "Rescheduled" stats be corrected retroactively**, or only going forward? Historical rows already created via Plan's Reschedule are permanently `CANCELLED` with no way to distinguish them after the fact — there is no data to recover; this is a product call about whether that historical inaccuracy needs any acknowledgment.

---

## 11. Recommended implementation PR sequence (if approved)

Not implemented in this audit; offered for planning only, smallest-safe-change first:

1. **PR 1 — Route Plan's Reschedule through the existing Move API.** Replace `handleReschedulePlan`'s "pre-fill Find-a-Time, then create+delete on save" with a flow that, when the user selects a new time for an **existing, still-`UPCOMING`-or-derived-MISSED** plan, calls `POST /api/plans/{id}/move` with the chosen `newStartAt` directly — no new search-driven title/recommendation recompute at all, matching Home's own Move UX (pick a time, not a "best match"). This is the smallest change that closes defects 1-4 in one step, because it reuses Move's already-correct, already-tested contract verbatim. Requires deciding #1/#2/#3 above first.
2. **PR 2 (optional, smaller) — Surface Move's CONFLICT/CAPACITY_EXCEEDED/HAS_LINKED_MOMENT errors in the Plan tab's UI**, reusing whatever error-presentation convention Home's own Move picker already has, rather than Plan's current generic `error` state string.
3. **PR 3 (optional, separate ticket) — Minimal "Rescheduled" indicator** per Section 5/decision 4, once PR 1 means `rescheduledFromPlanId` is actually populated from both surfaces.

## 12. Regression-test requirements for the above

If PR 1 proceeds: a new DB-backed test file (mirroring `movePlannedActivityDb.test.ts`'s own conventions) asserting, from the **Plan tab's own reschedule trigger**, that: a goal-linked plan's `GoalActivity`/`GoalActivityOccurrence` correctly repoint; the title is preserved verbatim; `rescheduledFromPlanId` is populated; a missed-activity reschedule behaves identically to an upcoming one; abandoning the flow still leaves the original untouched; and the existing Move-specific tests (`movePlannedActivityDb.test.ts`, `movePlanApiDb.test.ts`) continue to pass completely unmodified (since this PR would be a **consumer** of Move, not a change to Move itself).

---

## Completion criteria

**Can Aura use one reliable rescheduling contract across Home and Plan while preserving activity history, goal continuity, and atomicity?**

**Yes.** The contract already exists, is already atomic, already preserves goal continuity and lineage, and is already covered by a real passing test suite — it is simply not used by the Plan tab today. The blocker is not a missing capability; it is that the Plan tab independently reinvented a weaker, untested, non-atomic two-step sequence instead of calling the Move API Home already relies on. The smallest safe implementation is Section 11's PR 1: make the Plan tab's Reschedule button call `POST /api/plans/{id}/move`, the same endpoint Home already uses, rather than `POST /api/plans` + `DELETE /api/plans/{id}`.

---

*No code was changed to produce this audit. Live verification used a disposable local Postgres database, migrated and seeded fresh, dropped afterward. No production or real user data was read or modified.*
