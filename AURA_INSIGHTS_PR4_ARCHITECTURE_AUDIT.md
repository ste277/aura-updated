# AURA — Insights V1 PR4 — Read-Only Reporting Architecture Audit

**Mode:** Read-only. No implementation. No PR. No commits. No migrations.
**Baseline verified:** `HEAD == origin/main == main == ff4f9ef4c16754d9d24deb2c32dbbf343f10d750`. Migration count confirmed **48**. `git status --porcelain=v1`: only the standing untracked audit docs and `.claude/settings.local.json`; **zero tracked modifications**. No reset/clean/stash/checkout was run. No unrelated local work existed to preserve beyond what the ticket itself already named.

**Workspace safety note, stated plainly per the ticket's own instruction:** `e2e/fixtures/cleanup.ts` and `test/personalizedDailyStoryDb.test.ts` carry **no local modifications** right now. This is not a recovery — a `git reset --hard origin/main` run earlier in this program (while correcting an accidental commit onto `main` during PR3) discarded those files' prior, never-committed, never-stashed local edits, and git has no mechanism to recover an uncommitted, unstashed working-tree diff. This audit did not attempt recovery and performed no destructive git operation of any kind.

Tags: **VERIFIED** (direct code reading), **RECOMMENDED** (engineering proposal), **UNRESOLVED** (needs a decision before implementation).

---

## 1. Executive Verdict

**A reliable, honest Insights reporting layer is buildable today, read-only, from evidence that already exists — with zero new tables and (at most) one narrow, optional index.** PR1–PR3 already did the hard part: `PlannedActivity.movedAt`, `GoalActivityOccurrence.scheduledWeekStart`/`scheduledWeekTimezone`, and `GoalActivityExecution.goalActivityOccurrenceId` together give this reporting layer exactly the durable, deletion-tolerant facts it needs for Goal-Rhythm and finite-Goal progress. The gap PR4 closes is **presentational and query-shaping, not foundational**: today's only reporting surface (`InsightsView.tsx`, fed by `HabitLog`/`DailyReflection`) has zero visibility into Goals or planning status at all, and no cross-Goal aggregate query exists yet (confirmed: `GET /api/goals` lists per-Goal detail, never a single "all Goals this week" summary).

**Verdict: ARCHITECTURE READY** (§12 lists the handful of product decisions that should be confirmed before implementation; none are blocking).

---

## 2. Existing Insights Inventory

**[VERIFIED]**

| Surface | File | What it actually does | Scope |
|---|---|---|---|
| Insights tab | `apps/web/components/InsightsView.tsx` (1092 lines) | Pure presentation component — takes `logEntries`/`assistantInsight` as **props**, does no fetching itself. Computes: 7-day trend, 30-day heatmap, time-of-day pattern, a client-side **day streak** (correctly computed in the user's Timing-Location timezone), "This Month" Aura-fit card. Embedded directly inside `apps/web/app/page.tsx` (Home) — **there is no dedicated `/insights` route**; `/goals` and `/goals/[goalId]` are the only other reporting-adjacent pages. | `HabitLog` only. Zero Goal/`PlannedActivity` awareness. |
| Insights API | `apps/web/app/api/daily-assistant/insights/route.ts` | Reads `HabitLog` (via `listHabitLogsForInsights`, date-range-bounded) and `DailyReflection`, computes the window-alignment comparison (`alignmentDeltaPoints`) and the separate Aura-Fit summary. | `HabitLog` + `DailyReflection` only. |
| Evidence gating | `apps/web/lib/insightsEvidence.ts` (36 lines) | A single pure function, `deriveInsightsEvidenceState(count)`, with a calibrated `NO_DATA`/`LIMITED` (1-2)/`AVAILABLE` (3+) taxonomy, domain-agnostic (`count` is "whatever the caller's own evidence unit is"). | Reusable as-is — **recommended directly for PR4**, §7. |
| Timing/window classification | `apps/web/lib/insightsWindowAlignment.ts`, `apps/web/lib/insightsTimezone.ts` | Pure helpers: `classifyInsightsWindow`, `toInsightsObservation`/`isInCalendarMonth` (Timing-Location-aware month bucketing). | Unrelated to Goal/planning reporting; not reused by PR4, no overlap to resolve. |
| Aura-Fit scoring | `apps/web/lib/insightsAuraFit.ts` (146 lines) | A separate, HabitLog-activity-aware metric, deliberately never blended with the window-alignment numbers. | Unrelated to PR4's scope. |
| Daily Reflection | `apps/web/lib/dailyReflection.ts` (65 lines) | Confirmed, from the V1 audit and re-checked here: still buckets a `MISSED` bucket by elapsed time, used only for the evening narrative, never for scoring. | Out of scope for PR4 (no change requested or needed; its own `missed` bucket is a narrative/presentation concept the V1 audit already flagged as a product-policy question, G10, not resolved here either). |
| Goal presentation helpers | `apps/web/lib/goalsPresentation.ts` | **Existing, reusable** formatters: `formatGoalProgressLabel`, `formatGoalActivityRhythmWeeklyProgressLabel`, `formatGoalActivityRhythmRemainingCapacityLabel`, `presentGoalActivityRhythmAwareStateLabel`. Already used by `GoalDetailClient.tsx` for per-Goal display. | **Recommended for reuse**, §9 — PR4 should not write a second set of progress-label formatters. |
| "MISSED" derivation | `apps/web/lib/dailyAgenda.ts`'s `timeBasedStatus` | Re-confirmed unchanged: `endAt < now → 'MISSED'`, purely time-based, never persisted, never feeds achievement scoring. This is the exact UI label PR4's fact model (§4) must **not** inherit — the ticket's own "AWAITING CONFIRMATION" fact is the correctly-neutral replacement for reporting purposes; `dailyAgenda.ts` itself is unrelated-screen territory and is not touched. | Confirms §4's naming choice is deliberate, not arbitrary. |
| Habit (recurring-habit) streak | `apps/web/lib/db.ts` (`currentStreak`/`longestStreak` on the `Habit` model) | Re-confirmed, unchanged since the V1 audit: computed from the **database server's own** `CURRENT_DATE`, not the user's Timing-Location date — the same, still-live G8 bug (two incompatible streak definitions co-existing: this one, and `InsightsView.tsx`'s own correct one). | **Not fixed by PR4** (out of scope per the ticket's own K section — "Home redesign" territory, and an independent, pre-existing bug unrelated to Goal/planning reporting); flagged again here so PR4 does not accidentally reuse `Habit.currentStreak` as a reporting source. |
| Cross-Goal aggregate | — | **Confirmed absent.** `GET /api/goals` returns each Goal with its own activities (via `listGoalActivitiesWithLinkedPlanStatus`, one Goal at a time); no endpoint or query batches "every Rhythm GoalActivity's current-week status across all of a user's Goals" in one call. | **This is the one genuine new query PR4 needs** (§8) — not a new concept, a new aggregation of already-correct per-Goal reads. |

**Duplicate reporting logic found:** none beyond the already-documented, pre-existing G8 streak split (two independent, already-shipped streak implementations — not something PR4 introduces or must reconcile to proceed).

**Incorrect status assumptions found:** none new. The one standing concern (`dailyAgenda.ts`'s `'MISSED'` presentation label, V1 audit's G10) is unchanged and is explicitly why this audit's own fact model (§4) is worded the way it is.

**Inconsistent timezone handling found:** none new in the Goal/Rhythm path (PR2/PR3 already fixed the Rhythm-specific case). The pre-existing `Habit.currentStreak` DB-server-clock bug (G8) remains the one confirmed inconsistency in the whole codebase, orthogonal to PR4.

**UI claims unsupported by data:** none found in the current Insights/Goal surfaces (re-confirms the V1 audit's own positive finding — this team's existing code is already evidence-gated carefully). The gap is coverage (Goals aren't reported on at all), not an existing false claim.

---

## 3. Reporting Fact Model

**[RECOMMENDED]** Seven facts, each backed by a specific persisted column, never inferred:

| Fact | Backed by | Precedence rule |
|---|---|---|
| **CONFIRMED COMPLETED** | `PlannedActivity.status === 'LOGGED'` (the sole, repo-wide completion truth, unchanged since the V1 audit), **and/or** a `GoalActivityExecution` row reachable via the durable `goalActivityOccurrenceId` link (PR3) when the plan itself has since been deleted | Checked FIRST, before any plan-status read, for Rhythm occurrences — see §5's exact precedence. |
| **SCHEDULED / COMMITTED** | `PlannedActivity.status === 'UPCOMING'` with `plannedStartAt` still in the future relative to the report's reference instant | Never implies achievement; always phrased as a plan, not a result. |
| **SKIPPED** | `PlannedActivity.status === 'SKIPPED'` (+ `skippedAt`, the cleanest timestamp in the schema — confirmed dedicated, server-generated-only) | Explicit action only; never inferred from elapsed time. |
| **CANCELLED** | `PlannedActivity.status === 'CANCELLED'` | Explicit action only. |
| **MOVED** | `PlannedActivity.status === 'MOVED'` (the source/tombstone row) **excluded** from every count; only its live successor (walked via `rescheduledFromPlanId`, or — for Rhythm — the occurrence's own current `plannedActivityId`) is counted, once | A reschedule is a planning event, never a completion or a failure (ticket's own explicit instruction) — the source and successor are **one logical commitment**, counted once. |
| **AWAITING CONFIRMATION** | `PlannedActivity.status === 'UPCOMING'` **and** `plannedEndAt < reference instant` | The direct, deliberately neutral replacement for `dailyAgenda.ts`'s `'MISSED'` label, used **only** in this reporting layer — never backported into `dailyAgenda.ts` itself (out of scope, §11). Never counted as a failure, never averaged into any score. |
| *(derived, not a status)* **Dedup identity for Move chains** | `PlannedActivity.rescheduledFromPlanId` walked backward to the terminal row | A reschedule chain of any length is one commitment with one current outcome — required by the ticket's own "do not count MOVED source and successor as separate commitments" instruction. |

**Exact precedence rule (the one rule every metric in §6 must follow identically):** for a Rhythm occurrence, check durable `GoalActivityExecution` evidence (via `goalActivityOccurrenceId`) **first** — if found, the fact is `CONFIRMED COMPLETED`, full stop, regardless of whether the live `PlannedActivity` row still exists or what its status is. Only when no such evidence exists does the live plan's `status` decide the fact (`UPCOMING`→`SCHEDULED/COMMITTED` or `AWAITING CONFIRMATION` depending on elapsed time, `SKIPPED`/`CANCELLED`→themselves, `MOVED`→excluded). An occurrence with neither durable evidence nor a resolvable live plan (an orphaned, never-completed row — e.g. a hard-deleted `CANCELLED` plan) resolves to no fact at all (excluded from every count, never fabricated as `SKIPPED`/`CANCELLED` after the fact). This is exactly `deriveGoalActivityRhythmContributionWithEvidence`'s already-shipped PR3 logic (`apps/web/lib/goalActivityRhythm.ts`) — PR4 reuses it verbatim, never reimplements it.

---

## 4. PR3 Evidence Integration

**[VERIFIED]**, re-confirmed directly against the current, merged `main` (`ff4f9ef`):

- **Durable occurrence FK**: `GoalActivityExecution.goalActivityOccurrenceId` — nullable, `@unique`, `ON DELETE SET NULL` — confirmed present in `schema.prisma` and on the live dev DB's constraint list.
- **Correct older-sibling completion**: `logPlannedActivity` resolves Goal linkage via `GoalActivityOccurrence.plannedActivityId` first (unique per plan), falling back to `GoalActivity.plannedActivityId` only for the finite case — confirmed, `db.ts`.
- **Completion after plan deletion**: the three Rhythm readers (`loadGoalActivityRhythmFacts`, `listGoalActivityOccurrenceRowsForActivities`, `enforceDestinationWeekCapacity`) all `LEFT JOIN` both `PlannedActivity` and `GoalActivityExecution`, preferring the latter — confirmed.
- **Legacy `NULL` fallback**: a pre-PR3 execution row (`goalActivityOccurrenceId IS NULL`) is read via the live `plannedActivityId` join exactly as before PR3; if that plan is later deleted, the fact correctly reverts to excluded (not fabricated) rather than crashing — confirmed by the merged real-DB suite (`goalActivityExecutionOccurrenceLinkDb.test.ts`, scenario 17).
- **Finite Goal progress**: `deriveGoalActivityState`'s `everCompleted` input, sourced from a `LATERAL`-joined fallback in `listGoalActivitiesWithLinkedPlanStatus` — confirmed.
- **No duplicate achievement credit**: `goalActivityOccurrenceId @unique` is a DB-level backstop, confirmed live (the merged suite's scenario 21 proves a second `INSERT` claiming the same occurrence is rejected at the constraint level).

### Reporting behavior for the seven required cases

| # | Case | Reporting behavior |
|---|---|---|
| 1 | Live completed plan | `CONFIRMED COMPLETED`, via the live `PlannedActivity.status='LOGGED'` join (durable evidence also exists but isn't strictly needed here). |
| 2 | Deleted completed plan | `CONFIRMED COMPLETED`, via durable `GoalActivityExecution.goalActivityOccurrenceId` alone — this is PR3's whole purpose, and the case every pre-PR3 reporting attempt would have silently lost. |
| 3 | Multiple sibling occurrences | Each occurrence/plan pair resolves its own fact independently — confirmed no merge/overwrite risk (the unique FK, verified live). |
| 4 | Moved occurrence | The occurrence's own identity is unchanged by Move (only its `plannedActivityId` repoints); `scheduledWeekStart` is re-stamped to the destination week in the same statement — reporting reads the occurrence's current state, which is always coherent (never a stale pre-Move value), confirmed live (merged suite scenario 19). |
| 5 | Legacy execution with `NULL` FK | Falls back to the live-plan join; if that plan is gone too, the occurrence is excluded from the report, not fabricated (§3's precedence rule, bottom case). |
| 6 | Finite Goal with actual value | `GoalActivityExecution.currentValue` (never clamped to the target) remains the authoritative progress number, reachable via `goalActivityId` even after `plannedActivityId` goes `NULL` — confirmed (merged suite scenario 6-8, the 25-of-20 proof). |
| 7 | Execution without a linked plan | Can **only** arise via later deletion (confirmed: the `INSERT` always sets a real `plannedActivityId` at creation time — there is no production path that ever creates a `plannedActivityId IS NULL` execution row from the start). Reporting treats this identically to case 2/5 above — the durable evidence (via `goalActivityOccurrenceId`, or `goalActivityId` for the finite case) is what's read; the live-plan join is just unavailable, never required. |

**[VERIFIED]** This confirms the ticket's own explicit instruction — "avoid joining exclusively through a live `PlannedActivity` when durable execution evidence is available" — is already satisfied by PR3's shipped read paths; PR4 must simply **call** them (`loadGoalActivityRhythmFacts`/`loadGoalActivityRhythmFactsForActivities`, `listGoalActivitiesWithLinkedPlanStatus`), never re-derive a parallel, join-through-`PlannedActivity`-only query.

---

## 5. Time Attribution Rules

**[VERIFIED/RECOMMENDED]**

| Dimension | Source | Defensible for reporting? |
|---|---|---|
| Scheduled date/instant | `PlannedActivity.plannedStartAt`/`plannedEndAt` | Yes — the plan's own commitment, always known while the plan exists. |
| Scheduled local week (Rhythm) | `GoalActivityOccurrence.scheduledWeekStart`/`scheduledWeekTimezone` (PR2), with live-derivation fallback for legacy `NULL` rows | Yes — this is the one and only week-attribution key for Rhythm reporting; see below. |
| Time Done was recorded | `PlannedActivity.loggedAt` | Defensible only as "when the user tapped Done," never as "when the activity happened." |
| Actual performed date | **Not captured anywhere** | **Not defensible.** No field in the schema distinguishes "scheduled for 6pm, actually done at 9pm" — `loggedAt` conflates both. PR4 must never present `loggedAt` as a performance date. |

**For Goal Rhythm: use the PR2 scheduled-week snapshot, exactly as written — never `loggedAt`.** This is already enforced by every production read path (`resolveOccurrenceLocalDate`/`resolveOccurrenceLocalDateOrNull`); PR4 inherits it for free by calling the existing readers.

**For general activity reporting** (non-Rhythm, e.g. "confirmed activities completed this week" across ALL plans, not just Goal-linked ones): the only defensible date dimension is `plannedStartAt`'s own local calendar date, computed via `getDatePartsInTimezone(user.timezone, plannedStartAt)` — the SAME canonical helper PR2/PR3 already use, applied fresh at read time (there is no snapshot for non-Rhythm plans, and none is needed: ordinary `PlannedActivity` rows are never re-pointed the way Rhythm occurrences are, so live derivation carries no drift risk here — the only drift risk PR2 fixed was specific to the Occurrence's survive-a-Move/survive-a-timezone-change requirement, which ordinary plans don't have).

**Explicit non-claim required by the ticket:** the Done timestamp must never be presented as proof of *when* an activity actually happened — only that it was confirmed, and (separately, only for Rhythm) which scheduled week it counts toward.

**Behavior across the five required conditions:**
- **User timezone changes**: a scheduled-week snapshot (Rhythm) is immune by construction (PR2's whole purpose). A non-Rhythm plan's reporting date is read fresh at render time in the user's *current* timezone — this is a live-derivation, not a snapshot, so (same already-disclosed limitation as the V1 audit's own G4, now narrowed to apply only outside Rhythm) a historical plan's reporting date could shift if timezone changes are frequent; must be disclosed, never silently smoothed.
- **Midnight boundaries**: handled identically to every other date computation in this codebase via `getDatePartsInTimezone` — no new edge case introduced.
- **DST transitions**: already correctly handled by the same Intl-based helper (confirmed by PR2's own DST test scenario, still passing).
- **Cross-week Move**: scheduled-week attribution correctly transfers to the destination week (confirmed live, merged suite scenario 19) — reporting reads the occurrence's current snapshot, always coherent.
- **Historical `NULL` snapshots**: read via the documented live-derivation fallback, with the same already-disclosed drift limitation as any pre-PR2 row — must be surfaced in the UI's limitations copy (§9), never hidden.

---

## 6. Reporting Metrics

**[RECOMMENDED]** For each: definition, source, eligibility, dedup identity, time attribution, historical limitations, query cost, empty-state, exact wording.

### 6.1 Confirmed activities completed
- **Definition**: count of logically-distinct commitments resolved to `CONFIRMED COMPLETED` in a period.
- **Source**: `PlannedActivity` (+ `GoalActivityExecution` for Goal-linked rows per §3's precedence).
- **Eligibility**: `plannedStartAt` within the requested range; Move chains collapsed to their terminal row.
- **Dedup identity**: terminal row of the `rescheduledFromPlanId` chain (or the occurrence, for Rhythm).
- **Time attribution**: `plannedStartAt`'s local date (non-Rhythm) or `scheduledWeekStart` (Rhythm).
- **Historical limitations**: timezone-drift disclosure for non-Rhythm historical dates (§5).
- **Query cost**: one indexed range scan on `(userId, plannedStartAt)` (existing index) + the already-batched Rhythm reader for Goal-linked rows.
- **Empty state**: "No confirmed activities yet in this period" — never "0%", never implying failure.
- **Exact wording**: *"X confirmed completed."*

### 6.2 Weekly Goal Rhythm progress
- **Definition**: per-`N_PER_WEEK` GoalActivity, `completedThisWeek`/`committedThisWeek` against `rhythmTargetPerWeek`, for the current local week.
- **Source**: `loadGoalActivityRhythmFactsForActivities` (already batched across every Rhythm activity for ONE Goal) — **needs widening to batch across ALL of a user's Goals** (§8, the one genuinely new query).
- **Eligibility**: `GoalActivity.status='SUGGESTED'`, `rhythmKind='N_PER_WEEK'`.
- **Dedup identity**: the occurrence (`GoalActivityOccurrence.id`), already unique per plan.
- **Time attribution**: `scheduledWeekStart` (§5).
- **Historical limitations**: legacy `NULL`-snapshot rows live-derive, disclosed.
- **Query cost**: already proven cheap and N+1-free for one Goal (R4's own batching); the cross-Goal widening is the same shape, one more level of batching.
- **Empty state**: "No weekly goals set up yet."
- **Exact wording**: *"2 of 3 this week."* (Already the exact convention `formatGoalActivityRhythmWeeklyProgressLabel` produces — reuse verbatim.)

### 6.3 Finite Goal progress
- **Definition**: `COMPLETED`/`SUGGESTED` derived state (`deriveGoalActivityState`, now `everCompleted`-aware) plus, when available, `GoalActivityExecution.currentValue` against its own snapshotted target.
- **Source**: `listGoalActivitiesWithLinkedPlanStatus` + `computeGoalProgress`.
- **Eligibility**: `rhythmKind='NONE'`, not `DISMISSED`.
- **Dedup identity**: the `GoalActivity` itself (at most one live link at a time; see §12 for the open "repeated finite completion" question, carried over unresolved from PR3).
- **Time attribution**: N/A — a point-in-time boolean/value, not date-scoped.
- **Historical limitations**: none beyond PR3's own (already disclosed) ones.
- **Query cost**: already shipped, zero new work.
- **Empty state**: "Not started yet."
- **Exact wording**: *"Completed"* / *"X of Y"* (reuse `formatGoalProgressLabel`).

### 6.4 Future scheduled commitments
- **Definition**: count of `SCHEDULED/COMMITTED` facts with `plannedStartAt` in the future.
- **Source**: `PlannedActivity` only.
- **Eligibility/dedup/time attribution**: same as 6.1.
- **Query cost**: trivial indexed scan.
- **Empty state**: "Nothing scheduled yet."
- **Exact wording**: *"X upcoming."*

### 6.5 Explicit skips
- **Definition**: count of `SKIPPED` facts in a period.
- **Source/eligibility/dedup**: `PlannedActivity` only, `skippedAt`-bounded.
- **Query cost**: trivial.
- **Empty state**: omit the row entirely rather than show "0 skips" (a zero here reads as judgment-adjacent; the ticket's own "calm and readable" instruction, §10, favors omission over a technically-true but needling zero). **[UNRESOLVED — product call, §12]**
- **Exact wording**: *"X explicitly skipped."*

### 6.6 Explicit cancellations
- Same shape as 6.5, substituting `CANCELLED`.

### 6.7 Rescheduled activities
- **Definition**: count of `MOVED` rows (each one real move event) in a period — **[CONFIRMED GAP, inherited from the V1 audit]** `updatedAt` remains the only available timing field for aggregate counting beyond `movedAt` itself... actually `movedAt` (PR1) IS the correct, dedicated field now — re-confirmed: PR1 already shipped this, so this metric is now **fully reliable**, not merely "partially" as the V1 audit originally found before PR1 shipped.
- **Query cost**: trivial `COUNT`.
- **Empty state**: omit, same reasoning as 6.5.
- **Exact wording**: *"You rescheduled X activities."*

### 6.8 Past plans awaiting confirmation
- **Definition**: count of `AWAITING CONFIRMATION` facts (§3).
- **Source**: `PlannedActivity` only.
- **Query cost**: trivial.
- **Empty state**: "Everything's confirmed." (a genuinely good state, phrased positively, never silently hidden).
- **Exact wording**: *"X past activities have no recorded outcome."* — the ticket's own example, used verbatim.

**No metric was rejected for lack of evidence** — all eight are buildable from existing, already-correct data.

---

## 7. Reporting Confidence

**[RECOMMENDED]** Reuse `apps/web/lib/insightsEvidence.ts`'s `deriveInsightsEvidenceState` verbatim — do not invent a second taxonomy or any numeric score. Its existing `NO_DATA`/`LIMITED`/`AVAILABLE` boundary already matches the ticket's own four-way distinction closely enough to extend directly:

- **Confirmed** → a fact with `CONFIRMED COMPLETED` status (§3).
- **Explicitly not completed** → `SKIPPED`/`CANCELLED` (§3) — a real, confirmed fact, just not a completion.
- **Unconfirmed** → `AWAITING CONFIRMATION` (§3) — exactly the state the ticket's own example sentence describes.
- **Unavailable historical evidence** → an occurrence that resolves to no fact at all under §3's bottom precedence case (orphaned, no durable evidence, no live plan) — surfaced as a disclosed coverage gap ("some history before a certain point may be incomplete"), never silently dropped from a denominator without mention.

No new confidence score, no p-values, no fabricated percentage of "how sure" the report is — exactly matching `insightsEvidence.ts`'s own already-reviewed discipline.

---

## 8. API Contract

**[RECOMMENDED]**

- **New route**: `GET /api/insights/reporting` (or similar; naming is a product call, not architectural) — **one** new read-only endpoint, not one per metric, to avoid a proliferation of near-identical small routes.
- **Reuse, don't extend, the existing routes**: `GET /api/daily-assistant/insights` (HabitLog/Reflection) and `GET /api/goals`/`GET /api/goals/[goalId]` (per-Goal detail) are **structurally different concerns** — extending either to also carry Goal-Rhythm-aggregate or planning-status data would conflate two independent read models the ticket itself asks to keep separate (§C's own "do not redesign unrelated screens"). A new, additive route is cleaner than overloading either.
- **Authentication**: `getSessionFromRequest`, identical to every existing route — 401 if absent.
- **User ownership**: every underlying query is already `userId`-scoped by construction (no new ownership logic needed).
- **Date-range input**: optional `from`/`to` query params (ISO date strings), defaulting to a sensible window (e.g. the last 30 days for activity-level metrics; "this week" is inherent to the Rhythm metric and needs no range param).
- **Timezone handling**: resolved server-side from `user.timezone` (the Timing-Location), exactly as every other date-bucketing call in this codebase already does — never accepted from the client.
- **Response shape**: one flat JSON object with a key per metric (§6), each metric's own shape documented by its own TypeScript interface — never one giant undifferentiated blob, never a single opaque "score."
- **Pagination/limits**: the per-metric counts are cheap aggregates (no row-level pagination needed); "past activities awaiting confirmation" should cap its own returned list (if item-level detail is shown, not just a count) at a reasonable limit (e.g. 20) with a "see all" affordance deferred to the UI layer, not this audit.
- **Query efficiency**: every metric maps to either an existing, already-optimized reader or a straightforward indexed aggregate — no N+1 risk if the one new cross-Goal batching query (§6.2) is built correctly (mirroring R4's own existing one-query-per-Goal-set pattern).
- **Empty state**: every field returns its own honest zero/empty shape (§6's per-metric empty states) — never a 404, never an error, for a genuinely-empty-but-valid account.
- **Partial historical coverage**: a dedicated `coverageNote` field (or similar), populated only when the "unavailable historical evidence" case (§7) actually applies — absent otherwise, never a permanent fixture of the response.
- **No write endpoints, no new tables**: fully satisfied by construction — every metric is a `SELECT`-only aggregate over existing tables.

---

## 9. Minimal Insights UI

**[RECOMMENDED]**

```
1. Confirmed progress        -- 6.1, 6.3 (finite Goals' "Completed"/X-of-Y)
2. Goals this week           -- 6.2 (Rhythm weekly progress, reusing
                                 formatGoalActivityRhythmWeeklyProgressLabel
                                 verbatim)
3. Planning patterns         -- 6.4, 6.5, 6.6, 6.7 (scheduled/skipped/
                                 cancelled/rescheduled counts)
4. Items awaiting confirmation -- 6.8, the ticket's own example sentence
```

- **Reuse existing Aura design patterns** — this is a new section of the existing Insights surface (or a new tab within it), not a new visual language; reuse `InlineStat`/`MiniStat`-style primitives already defined in `InsightsView.tsx`.
- **No arbitrary scores** — every number on screen traces directly to one of §6's eight metrics; no blended/weighted composite.
- **No streak claims** for this new surface **unless** reusing `InsightsView.tsx`'s own already-timezone-correct streak (never `Habit.currentStreak`, the known-buggy one, §2) — and only if the product wants a streak here at all, which is not required by anything in §6.
- **No causal astrology claims** — this reporting layer doesn't touch Panchang/Muhurta data at all; nothing to guard here beyond not introducing it.
- **Traditional timing**, if ever shown adjacent to this reporting layer, may appear only where it's directly relevant to a specific reporting question the user is asking (e.g. the existing, separate Alignment/Aura-Fit cards already do this correctly) — PR4 itself introduces no new traditional-timing claim.
- **Calm and readable**: favor omission over a needling zero (§6.5/6.6's own open question), plain percentage-point or count language (matching the existing Insights route's own established `alignmentDeltaPoints` convention), no exclamation-point urgency copy.

---

## 10. Reporting Limitations (to disclose in-product, not hide)

1. Non-Rhythm historical dates are live-derived, not snapshotted — a timezone change can shift where a historical (non-Goal) plan's date buckets, same already-disclosed limitation class as the V1 audit's G4, now narrowed to apply outside Rhythm reporting only.
2. Pre-PR2 Rhythm occurrences and pre-PR3 executions carry the same documented legacy-`NULL` fallback behavior — correct, but not retroactively upgraded.
3. "Confirmed" means "the user tapped Done," never "met a numeric target" for `MEASURED_TARGET`/`DURATION` Goal activities (inherited, unchanged, from the V1 audit's own G13 finding) — must be disclosed wherever a finite Goal's "Completed" label appears without its `currentValue`.
4. Data predating a user's account creation or predating this reporting layer's own ship date simply doesn't exist — never backfilled, never estimated.

---

## 11. Real-DB Test Matrix

**[RECOMMENDED]** All 20 required scenarios — every assertion checks persisted facts AND the reporting API's actual JSON output, never UI-only:

| # | Scenario | Verifies |
|---|---|---|
| 1 | Confirmed completion | A `LOGGED` plan appears as `CONFIRMED COMPLETED` in the report, with the correct period attribution. |
| 2 | Future `UPCOMING` | Appears under "future scheduled," never under "awaiting confirmation" (not yet elapsed). |
| 3 | Past `UPCOMING` unconfirmed | Appears under `AWAITING CONFIRMATION` (§3), never silently labeled `MISSED` or counted as a failure. |
| 4 | `SKIPPED` | Appears under explicit skips, with `skippedAt` as its timestamp. |
| 5 | `CANCELLED` | Appears under explicit cancellations. |
| 6 | `MOVED` source/successor | The source row is excluded entirely; only the successor is counted, exactly once — direct regression test for the ticket's own explicit instruction. |
| 7 | Deleted completed plan | Still reports `CONFIRMED COMPLETED`, via durable `GoalActivityExecution` evidence alone (§4 case 2) — the PR3 regression this whole layer depends on. |
| 8 | Older sibling completion | A Rhythm occurrence completed out of materialization order still reports correctly (reuses PR3's own fixed write path; this test proves the READ side surfaces it correctly too). |
| 9 | Multiple Rhythm occurrences | Each occurrence's fact is independent; no merge, no double-count in the weekly aggregate. |
| 10 | Finite Goal progress | `currentValue` (e.g. 25 of a 20 target) surfaces correctly in the report, survives the plan's deletion. |
| 11 | Legacy `NULL` execution FK | Reads correctly via the live-plan fallback; degrades to excluded (not fabricated) once that plan, too, is gone. |
| 12 | Scheduled-week snapshot | A Rhythm occurrence's week attribution in the report matches `scheduledWeekStart`, never a live re-derivation for a snapshotted row. |
| 13 | Cross-week Move | The occurrence's week attribution in the report updates to the destination week. |
| 14 | Timezone change | A non-Rhythm historical plan's reporting date is confirmed to shift with a timezone change (documenting the limitation, §10, not a bug) — a Rhythm occurrence's week attribution is confirmed to NOT shift (PR2's own guarantee). |
| 15 | DST boundary | A plan scheduled across a DST transition reports the correct local date. |
| 16 | Empty account | A brand-new user's report returns every metric's own honest empty state (§6), never an error. |
| 17 | User isolation | User A's report never includes User B's plans/Goals/executions. |
| 18 | Duplicate prevention | Two occurrences cannot report the same completion twice (DB-level unique-constraint backstop, re-confirmed from the reporting layer's own read, not just the write side). |
| 19 | Date-range boundaries | A plan exactly at the edge of a requested `from`/`to` range is included/excluded consistently and correctly (inclusive/exclusive convention documented once, applied everywhere). |
| 20 | Historical missing evidence | An orphaned occurrence (no durable evidence, no live plan) is excluded from every count and surfaces the `coverageNote` (§8), never silently absorbed into any other bucket. |

---

## 12. Exact Implementation Scope (for a future, separately-authorized PR)

**[RECOMMENDED — not implemented by this audit]**

- One new route: `GET /api/insights/reporting` (or equivalent name — product call).
- One new, cross-Goal batching query (widening the existing `loadGoalActivityRhythmFactsForActivities` pattern to span every Rhythm `GoalActivity` for a user, not just one Goal's) — the only genuinely new query in this entire design; everything else calls an existing, already-shipped reader.
- Pure helper functions for the Move-chain collapse (§3's dedup identity) and the eight metric computations (§6) — all pure, all testable without a DB, mirroring this codebase's own established `goals.ts`/`goalActivityRhythm.ts` convention.
- UI: a new section/tab reusing `InsightsView.tsx`'s existing primitives and `goalsPresentation.ts`'s existing formatters — no new design system.
- **No migration** — every field this design needs already exists (PR1's `movedAt`, PR2's `scheduledWeekStart`/`scheduledWeekTimezone`, PR3's `goalActivityOccurrenceId`). The ticket's own "new migrations unless a genuine blocker is demonstrated" condition is **not triggered** — no blocker was found.
- The 20 tests in §11.

---

## 13. Risks and Blockers

**None found that block starting implementation planning.**

- The cross-Goal batching query (§8/§12) needs the SAME care PR2/PR3's own audits already modeled (explicit `userId` scoping, no N+1, correct `LEFT JOIN` semantics) — a design detail for the implementation PR, not a blocker now.
- `dailyAgenda.ts`'s `'MISSED'` label (V1 audit's G10) remains an **unresolved, pre-existing product-policy question**, independent of PR4 — PR4's own `AWAITING CONFIRMATION` fact deliberately sidesteps it rather than resolving it, which is explicitly in scope per the ticket's own "no automatic status transitions" instruction.
- `Habit.currentStreak`'s DB-server-clock bug (G8) remains unfixed, unrelated, and explicitly out of scope (Home redesign territory).

---

## 14. Product Decisions Required

**[UNRESOLVED]**

1. Should explicit-skip/cancellation/reschedule counts of zero be **omitted** from the report entirely, or shown as an honest "0" (§6.5/6.6)? Recommended: omit, for a calmer surface — but this is the product's call, not an architectural one.
2. Exact route naming and whether this ships as a tab within the existing Insights surface or a new top-level section (§9) — a product/navigation decision, not resolved here.
3. Whether a finite Goal that is completed, has its plan deleted, and is later re-linked and completed again should ever report as more than one historical achievement — **carried over, still unresolved, from the PR3 evidence-contract audit**; PR4's own metrics (§6.3) report only the current/most-recent state, consistent with that prior audit's own narrow scope decision, but the underlying question (does the product ever want a repeatable finite-Goal achievement history) remains open.
4. Whether "past activities awaiting confirmation" should offer in-place Log/Skip actions directly from the reporting surface (the V1 audit's own "SUPPORTED NOW" item 3 suggestion) — a UI/product scope call for the eventual implementation PR, not this audit's to decide.

---

**FINAL VERDICT:**

```
AURA — INSIGHTS V1 PR4 —
ARCHITECTURE READY
```

Every metric in §6 is backed by evidence that already exists and is already correctly written, thanks to PR1–PR3. The one new query this design requires is a straightforward widening of an existing, already-proven batching pattern. No migration is needed. The open items in §14 are product decisions, not engineering unknowns, and none block starting implementation planning.
