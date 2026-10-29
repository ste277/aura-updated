# AURA — Insights & Reporting Architecture Audit V1

**Mode:** Read-only architecture audit. No implementation. No PR. No commits.
**Baseline:** `origin/main` @ `f2ba7e319a33281e168872ebb441c7380c6966c9`
**Objective:** Determine whether Aura can accurately measure Goal achievement, planning consistency, reporting confidence, and evidence-backed personal improvement — without ever inferring achievement from mere scheduling.

All claims below are tagged **[CONFIRMED]** (verified directly in code, with file:line citations) or **[RECOMMENDATION]** (this audit's proposal, not a fact about the existing system). Where a prior sub-investigation could not fully resolve something, it is tagged **[UNCONFIRMED]** explicitly rather than guessed.

---

## 1. Executive Verdict

**Aura's completion/outcome model is sound at its core and already better-engineered than most systems of this kind.** The single most important fact this audit found: **[CONFIRMED]** `PlannedActivity.status` has exactly five persisted values — `UPCOMING | LOGGED | CANCELLED | SKIPPED | MOVED` (`apps/web/prisma/schema.prisma:340`) — and **`COMPLETED` is set only by an explicit, user-initiated "Done" tap** (`logPlannedActivity`, `apps/web/lib/db.ts:1563`). No cron job, background process, or elapsed-time check anywhere in the codebase writes a completion-shaped status. The Goals subsystem's derived-state logic (`deriveGoalActivityState`, `apps/web/lib/goals.ts:29-63`) and the existing Insights surface (`apps/web/components/InsightsView.tsx`) both already practice careful evidence-gating — rendering "not enough data yet" rather than a fabricated statistic when the evidence threshold isn't met.

However, the audit found **six confirmed, concrete data-quality gaps** (§6) that would corrupt specific metrics if built naively on top of the current tables as-is, plus **one genuine product-policy tension** (§6, G10) between an existing, shipped presentation choice and this ticket's hard rule, which needs explicit human sign-off rather than silent inheritance or silent "fixing" by this audit.

None of the gaps found require a large, risky rearchitecture. All have a small, additive remediation path (§9–§11). **This audit does not find Aura's architecture blocked from building accurate Insights — it finds exactly the kind of fixable, well-scoped gaps that architecture-planning work exists to catch before implementation starts.**

**Verdict: READY FOR IMPLEMENTATION PLANNING** (see §12 for the specific decisions that must be made, by a human, before any PR in §11 begins).

---

## 2. Current Architecture Inventory

| Subsystem | Core files | Status |
|---|---|---|
| Goal | `apps/web/prisma/schema.prisma:672-692`, `apps/web/lib/goals.ts` | Persisted status: `ACTIVE`/`ARCHIVED` only. **[UNCONFIRMED]** No unarchive/reactivate code path was found — `ARCHIVED` may be permanent in practice despite being documented as "soft and reversible." |
| GoalActivity | `schema.prisma:706-793` | Persisted status: `SUGGESTED`/`DISMISSED` only. `PLANNED`/`COMPLETED` are derived, never persisted (`goals.ts:29-63`). |
| GoalActivityOccurrence | `schema.prisma:934-951` | **No status column at all** (deliberate, documented design — lines 890-896). Only timestamp is `createdAt`; **no `updatedAt`**, despite `plannedActivityId` being mutated in place by Move and SetNull. |
| GoalActivityExecution | `schema.prisma:814-872` | The model's own doc comment ("schema/domain-only, no production writer") is **stale** — `logPlannedActivity` (`db.ts:1754-1771`) does write it in production. Holds an immutable snapshot of the completion requirement plus a measured `currentValue`; **no "performed at" field**. |
| PlannedActivity | `schema.prisma:332-447` | The real source of truth for scheduling/completion. 5 persisted statuses (above). `loggedAt`/`skippedAt` exist; **no `cancelledAt`, no `movedAt`**. |
| HabitLog | `schema.prisma:284-325` | One timestamp (`logTimestamp`) conflates "recorded at" and "claimed occurred at." **Backdatable with no bound** via `POST /api/habit-logs` (route.ts:76-79, `db.ts:2095-2096`). |
| Day Constructor accept persistence | `apps/web/lib/dayConstructorAcceptancePersistence.ts` | Writes only `UPCOMING` rows — never anything completion-shaped. Idempotency is a hardened, previously-buggy-but-now-fixed claim mechanism, **not backed by any DB-level unique constraint** (the code's own comments at lines 263-274 acknowledge this as an open, named limitation). |
| Goal Rhythm | `apps/web/lib/goalActivityRhythm.ts`, `goalActivityOccurrenceCapacity.ts` | Weekly eligibility is correctly computed live, but week-bucketing uses the **scheduled** `plannedStartAt`, not any "actually performed" instant (none exists) — and is **not pinned to the timezone active at scheduling time**, so a later timezone change retroactively reshuffles historical week buckets. |
| Existing Insights UI/API | `apps/web/components/InsightsView.tsx`, `apps/web/app/api/daily-assistant/insights/route.ts` | Unusually well-built: every rendered number traces to a real query over `HabitLog`/`DailyReflection`, with consistent null-vs-zero evidence gating (`apps/web/lib/insightsEvidence.ts`). No fabricated/hardcoded/placeholder statistic was found anywhere in this surface. |
| Personalized Daily Story | `apps/web/lib/dailyStory.ts`, `dayBuilder.ts`, `myDayOrchestrator.ts` | **No LLM involvement at all** — pure deterministic template interpolation over typed, already-validated facts. One borderline design choice flagged (§6, G11/G12). |
| Traditional Guidance / Panchang | `packages/panchang/src/windows.ts`, `packages/astronomy/src/ephemeris.ts` | Pure, deterministic, recomputed-on-demand calculation — never a stored "fact." UI copy is consistently non-causal (zero grep hits for guarantee/causal language across the whole repo). |
| Historical reporting | Scattered — no dedicated "reports" subsystem exists | The closest things are Insights' own trend charts (7-day, 30-day heatmap) and Goals' progress labels. No weekly/monthly historical report feature exists today beyond these. |

---

## 3. Source-of-Truth Map

| Fact | Source of truth | Notes |
|---|---|---|
| "Was this activity completed?" | `PlannedActivity.status === 'LOGGED'` | **[CONFIRMED]** The *only* source of truth, repo-wide. `GoalActivityExecution.currentValue` never controls it, even when `currentValue` is 0 or below a `MEASURED_TARGET`'s target (`db.ts:1753-1756`). |
| "When was it completed?" | `PlannedActivity.loggedAt` | Set once, at the instant of the explicit Done tap (`db.ts:1686`). |
| "Was it explicitly skipped?" | `PlannedActivity.status === 'SKIPPED'` + `skippedAt` | **[CONFIRMED]** The cleanest of the five statuses — `skippedAt` is a dedicated, server-generated-only timestamp (schema comment: "never a client value," `schema.prisma:371`). |
| "Was it cancelled?" | `PlannedActivity.status === 'CANCELLED'` | No dedicated `cancelledAt` — only the shared, overwritable `updatedAt`. |
| "Was it moved, and how many times?" | A **backward-only** FK chain: `PlannedActivity.rescheduledFromPlanId` (`@unique`) | **[CONFIRMED]** Not destroyed, but not cheap either — reconstructing "how many times was X moved" requires a recursive walk, not a single-column read. No `movedAt`, no reason, no dedicated history table. |
| "Did a Rhythm GoalActivity hit its weekly target?" | `GoalActivityOccurrence` JOIN `PlannedActivity`, live-computed | Week bucket = `plannedStartAt` converted via the user's **current** timezone setting, re-derived on every read — not snapshotted. |
| "Is this GoalActivity done?" (finite/NONE rhythm) | `deriveGoalActivityState()` (`goals.ts:29-63`), joining `GoalActivity.plannedActivityId` → linked `PlannedActivity.status` | `COMPLETED` only when the linked plan is `LOGGED`. |
| "Was a specific Panchang window actually used, and did the user complete the activity in it?" | `PlannedActivity.windowType` (scheduling-time) + `HabitLog.activeWindow` (independently recomputed at the actual completion instant), joined via `PlannedActivity.habitLogId` | **[CONFIRMED]** The linkage technically exists and the two values can legitimately disagree (useful!), but **no production code ever queries this join** (§7), and the linkage is destroyed if the `LOGGED` plan is later hard-deleted. |

---

## 4. Outcome State Model

The ticket's own seven proposed states, mapped onto the real, confirmed persisted/derived model:

| Ticket state | Real system | Persisted / Derived | User-confirmed? | Confirmed facts |
|---|---|---|---|---|
| **PLANNED / COMMITTED** | `PlannedActivity.status === 'UPCOMING'` | Persisted | Yes (an explicit accept action created it) | Called `'PLANNED'` by Goal-level derived state (`goals.ts`), `'COMMITTED'` by Rhythm contribution logic (`goalActivityRhythm.ts:228-231`) — **same underlying fact, two different names in two subsystems.** Harmless but worth standardizing terminology before building a shared Insights vocabulary. |
| **COMPLETED** | `PlannedActivity.status === 'LOGGED'` | Persisted | Yes, explicit "Done" tap only | **[CONFIRMED]** No elapsed-time, cron, or background code path ever sets this. Caveat: for `MEASURED_TARGET`/`DURATION` completion kinds, hitting the numeric target is **never required** — "COMPLETED" means "tapped Done," not "met the target" (`db.ts:1753-1756`). |
| **SKIPPED** | `PlannedActivity.status === 'SKIPPED'` | Persisted | Yes, explicit tap | Cleanest state in the model — dedicated `skippedAt`. |
| **CANCELLED** | `PlannedActivity.status === 'CANCELLED'` | Persisted | Yes, explicit action | No dedicated `cancelledAt`. |
| **MOVED** | `PlannedActivity.status === 'MOVED'` (original row becomes a tombstone; a new `UPCOMING` row is created) | Persisted | Yes, explicit action | Never mutated in place — always a new row + a tombstone, linked backward only. |
| **ELAPSED_UNCONFIRMED** | **Not a persisted state anywhere.** | **Derived only**, computed live (`dailyAgenda.ts:62-71`: `status==='UPCOMING' && endAt < now`) | No — this is exactly the "no confirmation yet" case | **[CONFIRMED, SIGNIFICANT FINDING]** The derived label the app actually uses for this state today is **`'MISSED'`**, not "unknown." It is never written to the database and never feeds Goal/Rhythm achievement scoring (an elapsed-but-still-`UPCOMING` plan always contributes `'COMMITTED'`, never a negative/failed outcome — `goalActivityRhythm.ts:228-231`). **But it IS shown to users as a past-tense fact** in the Home timeline, a "Missed Recovery" prompt, and the evening Daily Reflection's `missed` bucket (`apps/web/lib/dailyReflection.ts:15,48`). This is a real tension with this ticket's own hard rule ("elapsed without confirmation is UNKNOWN... must never automatically become... MISSED") when read literally against *presentation*, even though it is honored at the *persistence/scoring* layer. **This is flagged as an open decision in §12, not silently resolved by this audit.** |

**Conclusion:** the persistence and achievement-scoring layers already honor the ticket's hard rule correctly. The one place it is in tension is a presentation-layer label choice, inherited from before this ticket existed.

---

## 5. Metric Definitions

Per the ticket's explicit instruction, **no single overall wellbeing/productivity score is proposed.** Each contract below is independent and must never be blended with another into one number.

### 5.1 Confirmed Goal Progress (finite / `NONE`-rhythm GoalActivity)

- **Definition:** whether a single, non-recurring GoalActivity has a confirmed completion.
- **Numerator:** 1 if the linked `PlannedActivity.status === 'LOGGED'`, else 0.
- **Denominator:** 1 (a finite GoalActivity has at most one live linked plan at a time).
- **Time attribution:** none — a point-in-time boolean, not date-scoped.
- **Timezone:** N/A.
- **Inclusion/exclusion:** only `GoalActivity.status === 'SUGGESTED'` (not `DISMISSED`) with `rhythmKind = NONE`.
- **Unknown handling:** `plannedActivityId IS NULL` means "not yet planned" — must render as "not started," never as 0% / failure.
- **Deduplication:** `GoalActivity.plannedActivityId` always points at the single current link; naturally deduplicated.
- **Source tables:** `Goal`, `GoalActivity`, `PlannedActivity`.
- **Query feasibility:** trivial — **this metric is already correctly computed today** by `computeGoalProgress`/`deriveGoalActivityState` (`goals.ts`), confirmed in production use by `goalsPresentation.ts:186-190`. Not new work.
- **Example:** GoalActivity "Read Atomic Habits" → linked plan `LOGGED` → Confirmed Goal Progress = 1/1.
- **Known limitation [CONFIRMED]:** if the `LOGGED` plan is later hard-deleted ("clear Recently Completed"), `GoalActivity.plannedActivityId` is `SetNull`'d (`schema.prisma:729`) and this fact is **silently lost** — the same architectural gap class as G1 below, applied to finite goals.

### 5.2 Weekly Goal Achievement (`N_PER_WEEK` rhythm GoalActivity)

- **Definition:** confirmed-completed vs. committed occurrences against the weekly target, for one calendar week.
- **Numerator:** `completedThisWeek` = count of `GoalActivityOccurrence` JOIN `PlannedActivity` WHERE `status='LOGGED'` AND the plan's local week matches. `committedThisWeek` = same, `status='UPCOMING'`.
- **Denominator:** `GoalActivity.rhythmTargetPerWeek` (explicit integer, never inferred).
- **Time attribution:** `PlannedActivity.plannedStartAt` — the **scheduled**, not performed, instant. **[CONFIRMED GAP]** `goalActivityRhythm.ts:190-195`'s own comment calls this "a distinction without a difference today... the same instant for every current production completion path" — this audit confirms that claim is **optimistic, not enforced**: `logPlannedActivity` has no restriction on how late a Done tap may occur, so a session logged a week after its scheduled time is still counted in the *originally scheduled* week.
- **Timezone:** the user's **current** `User.timezone`, read fresh at query time — not frozen at occurrence-creation time.
- **Inclusion/exclusion:** `CANCELLED`/`SKIPPED`/`MOVED` occurrences contribute `NONE` (correctly implemented already).
- **Unknown handling:** an occurrence whose linked plan was hard-deleted silently vanishes (INNER JOIN excludes it) — see G1.
- **Deduplication:** `GoalActivityOccurrence.plannedActivityId` is `@unique` — correctly enforced at the DB level.
- **Source tables:** `GoalActivity`, `GoalActivityOccurrence`, `PlannedActivity`.
- **Query feasibility:** the *live, current-week* version is already correctly implemented (`loadGoalActivityRhythmFacts`, `db.ts`). A *historical* (past-weeks) version is **not yet built** — same JOIN, different date range, so it's query-feasible, but is new reporting surface.
- **Example:** target 3/week; week of 2026-10-05 has 2 `LOGGED` + 1 `UPCOMING` → "2 of 3 done, 1 more planned."
- **Known limitations:** G1 (orphaning), G4 (timezone drift), and the scheduled-vs-performed week attribution above — all three apply.

### 5.3 Planning Consistency

- **Definition:** of all commitments accepted in a period, what fraction reached an explicit outcome (`LOGGED`/`SKIPPED`/`CANCELLED`) vs. remain unresolved.
- **Numerator:** count of logically-distinct commitments (see dedup below) resolved to `LOGGED`/`SKIPPED`/`CANCELLED`.
- **Denominator:** count of logically-distinct commitments whose `plannedStartAt` has already elapsed within the period.
- **Time attribution:** `plannedStartAt` of the *current* (latest-in-chain) row.
- **Timezone:** user's Timing-Location timezone, for period bucketing.
- **Inclusion/exclusion:** a `MOVED` row itself is **excluded** from both numerator and denominator (it is a tombstone, not an outcome) — only its live successor counts. A future, not-yet-elapsed `UPCOMING` row is excluded from the denominator entirely (it hasn't had a chance to resolve).
- **Unknown handling:** an elapsed, still-`UPCOMING` row is reported as its own, separate "unconfirmed" count — **never** folded into the numerator as resolved, and **never** treated as a failure (ticket's own explicit example of an invalid calculation).
- **Deduplication:** requires collapsing each `rescheduledFromPlanId` chain to its single terminal row — a **recursive query, not yet built anywhere in the app**.
- **Source tables:** `PlannedActivity` only.
- **Query feasibility:** moderate — the recursive Move-chain collapse is genuinely new query work (§9–§11).
- **Example:** 10 commitments this week; 8 resolved (6 `LOGGED`, 1 `SKIPPED`, 1 `CANCELLED`), 2 elapsed-unconfirmed → report "8 resolved, 2 unconfirmed," never a single misleading ratio.

### 5.4 Outcome Confirmation Coverage (= Reporting Confidence, §E)

- **Definition:** what fraction of *past* activity history carries a confirmed outcome — evidence coverage, not a performance judgment.
- **Numerator:** past, logically-distinct commitments resolved to `LOGGED`/`SKIPPED`/`CANCELLED`.
- **Denominator:** all past, logically-distinct commitments (`plannedStartAt < now`).
- **Time attribution:** `plannedStartAt < now`, server clock.
- **Timezone:** user's Timing-Location timezone for any period-scoped version.
- **Inclusion/exclusion:** `MOVED` rows excluded (not an outcome question themselves).
- **Unknown handling:** `(denominator − numerator)` is the honest "unconfirmed" count. Must render as "X% confirmed, Y unconfirmed" — **per the ticket's own explicit instruction, never as a discipline/performance score.**
- **Deduplication:** same Move-chain collapse as §5.3.
- **Source tables:** `PlannedActivity` only.
- **Query feasibility:** shares infrastructure with §5.3.
- **Example:** 40 past commitments in 30 days, 35 confirmed, 5 unconfirmed → "88% of the last 30 days have a confirmed outcome."
- **Known limitation [CONFIRMED]:** this metric is **not stable retroactively** — `logPlannedActivity` places no bound on how late a Done/Skip can occur, so re-running this report for the "same" past period next month can yield a different split as old items get confirmed later. This must be disclosed, never hidden.

### 5.5 Rescheduling Frequency

- **Definition:** how often the user moves/reschedules commitments (a planning-friction signal, per the ticket's own §H example).
- **Numerator:** count of `PlannedActivity` rows with `status='MOVED'` in a period (each such row is exactly one move event, by construction).
- **Denominator:** count of distinct logical commitments created/active in the period (simplest, most intuitive choice — avoids the full recursive collapse for this specific metric).
- **Time attribution:** the `MOVED` row's own `updatedAt` — **[CONFIRMED GAP]** this is imprecise (shared with any other mutation to that row); there is no dedicated `movedAt` field.
- **Timezone:** user's Timing-Location timezone.
- **Inclusion/exclusion:** count `MOVED` rows themselves, not their `UPCOMING` successors.
- **Unknown handling:** N/A — `MOVED` is always an explicit, confirmed fact.
- **Deduplication:** none needed at the row level; multiple moves of one logical intent correctly produce multiple `MOVED` rows.
- **Source tables:** `PlannedActivity`.
- **Query feasibility:** trivial `COUNT` — but the `updatedAt`-as-proxy imprecision should either be disclosed in copy ("around" the move time) or fixed with a dedicated column (§9–§11).
- **Example:** "You rescheduled 4 activities this week."

### 5.6 Explicit Skip Frequency

- **Definition:** how often the user explicitly chooses to skip, as distinct from silently letting something elapse unconfirmed.
- **Numerator:** count of `PlannedActivity` rows with `status='SKIPPED'` in a period.
- **Denominator:** [RECOMMENDATION] count of *resolved* commitments in the period (§5.4's numerator) — chosen so this metric isn't diluted by still-pending future commitments. (A `plannedStartAt`-within-period denominator is a defensible alternative; pick one and document it.)
- **Time attribution:** `skippedAt` — **the cleanest timestamp of all six contracts** (dedicated, server-generated-only, confirmed never client-settable).
- **Timezone:** user's Timing-Location timezone.
- **Inclusion/exclusion:** only explicit `SKIPPED` status — **never** infer a skip from an elapsed-unconfirmed row (the ticket's own named example of an invalid calculation).
- **Unknown handling:** N/A.
- **Deduplication:** none needed — terminal status, set once.
- **Source tables:** `PlannedActivity` only.
- **Query feasibility:** trivial, no new schema needed — **this is the most reliable, ready-today metric of the six.**
- **Example:** "2 of 8 resolved activities were explicitly skipped this week."

### 5.K Coverage Matrix

| Metric | Data source | Reliable now? | Missing evidence / gap | Required change |
|---|---|---|---|---|
| Confirmed Goal Progress (finite) | `GoalActivity`→`PlannedActivity` | **Mostly** — already correctly computed | Lost on hard-delete of the `LOGGED` plan | Snapshot-before-delete or soft-delete policy (§9–§11) |
| Weekly Goal Achievement | `GoalActivityOccurrence`→`PlannedActivity` | **No, for historical weeks** | Orphaning (G1), timezone drift (G4), scheduled≠performed week | Snapshot `localWeekStart` at creation; delete policy fix |
| Planning Consistency | `PlannedActivity` | **No** | Move-chain collapse not built | New recursive query (additive, no schema change required) |
| Outcome Confirmation Coverage | `PlannedActivity` | **No** | Same Move-chain gap; retroactive instability | Same query work; disclose instability in UI |
| Rescheduling Frequency | `PlannedActivity` | **Partially** — count is reliable, timing isn't | No `movedAt` | Additive `movedAt` column (§9–§11) |
| Explicit Skip Frequency | `PlannedActivity` | **Yes** | None significant | None — ready today |

---

## 6. Data-Quality Risks

### High severity

- **G1 [CONFIRMED]** — Orphaned `GoalActivityOccurrence`. `deletePlannedActivity` hard-deletes `LOGGED`/`CANCELLED` plans (`db.ts:1547-1553`, the "clear Recently Completed" action). `GoalActivityOccurrence.plannedActivityId` is `onDelete: SetNull` (`schema.prisma:946`), and Rhythm fact queries **INNER JOIN** to `PlannedActivity` (`db.ts:3044-3056`) — so a previously-fulfilled week's `completedThisWeek` **silently drops after the fact**, and `eligibleForAnotherOccurrence` can wrongly flip back to true for an already-satisfied week.
- **G2 [CONFIRMED, derived from the same mechanism]** — The identical `SetNull` cascade applies to `GoalActivity.plannedActivityId` (`schema.prisma:729`), meaning §5.1's "Confirmed Goal Progress" for a **finite** goal can be lost the same way.
- **G3 [CONFIRMED]** — `HabitLog.logTimestamp` is the *only* timestamp on the row, is fully client-settable via `POST /api/habit-logs` with no past/future bound check (`route.ts:76-79`), and conflates "recorded at" with "claimed occurred at." There is no immutable "actually inserted at" field to detect backdating after the fact.
- **G4 [CONFIRMED]** — Goal-Rhythm week bucketing reads the user's **current** `User.timezone` at query time, not a value frozen when the occurrence was created. A later timezone change retroactively reshuffles which week any historical occurrence counted toward, with no audit trail.

### Medium severity

- **G5 [CONFIRMED]** — No DB-level `@@unique` constraint backs `PlannedActivity` duplicate-prevention; it is entirely advisory-lock-dependent. The code's own comments (`dayConstructorAcceptancePersistence.ts:263-274`) name this as an open limitation against a write path that bypasses the lock.
- **G6 [CONFIRMED]** — Move history has no `movedAt`/reason/dedicated table — reconstructable only via a recursive FK walk.
- **G7 [CONFIRMED]** — Cross-midnight day attribution is inconsistent: daily-agenda bucketing is start-date-only (`db.ts:1028-1036`), while opportunity/blocking-interval code treats a cross-midnight plan as overlapping every day it touches (`opportunityRangeAdapter.ts:36`). No reconciliation exists.
- **G8 [CONFIRMED]** — Two incompatible "streak" definitions coexist: Insights' own streak correctly uses the user's Timing-Location timezone (`InsightsView.tsx:203-221`); the separate Habits feature's `currentStreak` uses the **database server's own** `CURRENT_DATE` (`db.ts:766-779`). These can silently disagree for any user not colocated with the DB server's timezone. This is a genuine, independent bug, unrelated to new Insights work.
- **G9 [CONFIRMED]** — `apps/web/lib/streak.ts`'s `computeStreak()` is dead code using process-local `Date.toDateString()` — currently unused, but a latent trap if ever revived.

### Policy judgment calls (not code defects)

- **G10 [CONFIRMED, see §4]** — `dailyAgenda.ts`'s derived `'MISSED'` label is computed automatically from elapsed time and shown to users as a past-tense fact, while never being persisted or feeding achievement scoring. Requires explicit product sign-off (§12).
- **G11** — Personalized Daily Story's `DailyPriorityCoverage.state === 'COVERED'` counts any non-`MISSED`/`SKIPPED`/`MOVED` status, including merely-scheduled future items, producing copy like "You've made room for X today." Carefully scoped to a scheduling claim, not an achievement claim — flagged for explicit confirmation this phrasing is intended.
- **G12** — The NIGHT-phase `completedHighlights` array can include `CONFIRMED`-but-not-yet-elapsed Moments alongside truly `COMPLETED` ones, under narrative framing ("Nice — that's done"). Smaller surface than G11, same family.
- **G13** — "COMPLETED" for a `MEASURED_TARGET`/`DURATION` GoalActivity means "tapped Done," not "hit the numeric target" — `currentValue` is never checked. Worth confirming this is disclosed wherever such progress is shown.

---

## 7. Traditional Guidance Boundaries

- **[CONFIRMED]** All Panchang/Muhurta windows are a pure, deterministic calculation (`packages/astronomy/src/ephemeris.ts`, `packages/panchang/src/windows.ts`) — recomputed on demand, never stored as a retrieved "fact."
- **[CONFIRMED]** A repo-wide grep for causal/guarantee language (`ensures success`, `guarantees`, `will lead to`, `worked better`, `more successful`, `higher completion`, `causal`, `caused`, `proves`) across every Panchang/Muhurta-adjacent file returned **zero matches**. Existing copy is consistently suggestive ("suitable," "suggests," "favorable," "conditions are supportive") — the closest-to-the-line phrase found, "Aura found this timing to work well for you" (`auraMoments.ts`), still describes timing suitability, not a caused outcome.
- **[CONFIRMED]** "A recommendation was shown" is **never persisted as an impression event** — the closest existing signals (`AURA_HOME_VIEWED`, `MUHURTHAM_SEARCH_COMPLETED`, `PANCHANG_CALENDAR_VIEWED`) record that a surface was viewed, never which specific window was displayed.
- **[CONFIRMED]** A real, persisted linkage *does* exist between a scheduled window (`PlannedActivity.windowType`, set at scheduling) and the actual completion instant's window (`HabitLog.activeWindow`, independently recomputed, joined via `habitLogId`) — these can legitimately disagree, which is useful. **But no production code anywhere joins or aggregates this today**, and the link is destroyed if the completed plan is later hard-deleted. "Completed" itself is self-report only — there is no independently verified outcome signal anywhere in the schema.
- **[CONFIRMED, positive finding]** The existing "Alignment" and `planningLift` metrics (`InsightsView.tsx`) already measure timing *adherence* (was a logged activity in a supportive window), and the code contains an explicit, deliberate comment guarding against exactly the overclaim this ticket warns about: *"kept explicitly observational/past-tense... never causal... a higher score among [Aura-planned activities] is expected by construction, not proof the user personally performs better during those windows"* (`InsightsView.tsx:720-732`). This is evidence the team has already identified and actively defended against this exact risk.

**Answer to the section's own question:** No — Aura cannot currently measure a real relationship between traditional timing guidance and *confirmed* outcomes. Building that honestly would require new work: a durable, non-deletable snapshot of the scheduled-window association; an actual impression event carrying window identity; a defined, verifiable notion of "outcome" beyond self-reported tap-to-complete; and an explicit, reviewed aggregate query joining all three. None of this exists today, and none of it should be presented as existing.

---

## 8. Personal Improvement Opportunities

For each: Source data → Eligibility → Minimum evidence → Calculation → Confidence/limitations → User-facing explanation → Next action.

### SUPPORTED NOW (data exists today; no schema change required)

1. **Preferred/supportive timing windows** — *already shipped.* Source: confirmed `HabitLog` rows. Eligibility: ≥3 confirmed logs this month. Calculation: `insightsWindowWeight`-weighted mean. Confidence: real, already correctly null-gated. Explanation: "X% of your logged activities fall in supportive windows." Next action: none — ship-complete.
2. **Explicit skip pattern worth reviewing.** Source: `PlannedActivity` (`status='SKIPPED'`, `activityId`, `skippedAt`). Eligibility: ≥3 explicit skips of the same `activityId` in a rolling period. Calculation: `COUNT ... GROUP BY activityId`. Confidence: high — `skippedAt` is a clean, dedicated, confirmed timestamp. Explanation: "You've skipped 'Evening run' 3 times this month — adjust its time, or drop it?" Next action: offer to edit/remove the recurring suggestion.
3. **Unconfirmed activities worth reviewing.** Source: §5.4 (Outcome Confirmation Coverage). Eligibility: any elapsed-unconfirmed `PlannedActivity` in the last 7 days. Calculation: direct query. Confidence: high, purely informational — "here are N items with no confirmed outcome, want to mark them?" Explanation must avoid any judgment language (per the ticket's own instruction). Next action: offer in-place Log/Skip actions.
4. **Goal progress requiring attention** (Rhythm goal below target for 2+ consecutive weeks). Source: §5.2. Eligibility: `N_PER_WEEK` GoalActivity with ≥2 full past weeks of history. Confidence: **subject to G1 and G4** — a past week's reading could silently change later; must be disclosed as a known limitation, not hidden. Explanation: "You've been below your 3x/week target for 2 weeks — adjust the target, or get help finding time?" Next action: offer to lower the target or jump into Plan My Day.

### SUPPORTED WITH CHANGES (needs an additive schema/query change, no new concept)

5. **Repeated rescheduling.** Source: §5.5. Needs the Move-chain collapsing query (or the additive `movedAt` column for cheap timing precision). No fundamentally new data — just new query/column work.
6. **Overloaded planning pattern.** Day Constructor's own capacity snapshot (`computeCapacitySnapshot`) is currently fully ephemeral — never persisted. Would need a new, lightweight historical log of capacity outcomes to report "you've been over capacity N days this month."

### NOT DEFENSIBLE for V1

- Any single overall wellbeing/productivity score — explicitly excluded by the ticket itself.
- Any claim that traditional timing guidance *caused* a better outcome — no verified-outcome concept or persisted shown/accepted/completed linkage exists (§7).
- Any inference of completion from elapsed time alone.
- Any streak/achievement metric built on the Habits feature's `currentStreak` until G8 (the two-definitions bug) is fixed — it would produce a confidently wrong number for some users.

---

## 9. Architecture Options

**Option A — Read-only aggregation from current tables.** Zero schema risk, fastest to ship, fully reversible. But inherits every confirmed gap above as-is: any metric built this way is only as reliable as the underlying tables already are (G1, G4, G5, G6 all apply unmitigated).

**Option B — Derived reporting views/projections.** A materialized or scheduled-recompute projection layer. Could fix the timezone-drift problem (G4) by snapshotting at computation time, and could survive G1 if written before a plan becomes deletable. Real new infrastructure: a projection table, a recompute/backfill strategy, staleness-invalidation logic — and must itself avoid becoming a second, drifting source of truth.

**Option C — New event/outcome model.** A dedicated, append-only, immutable outcome-event table, written at the moment of each confirmation, surviving even if the source `PlannedActivity` is later hard-deleted. Would durably fix G1/G2/G4 at the root and give every transition `movedAt`-equivalent precision (fixing G6), becoming the real audit trail §G of the ticket asks about. Largest change: every status-transition write path (`logPlannedActivity`, `skipPlannedActivity`, `cancelPlannedActivity`, `applyMoveWrites`, `materializeGoalActivityRhythmOccurrence`) would need to also write to it — a coordinated, multi-file migration. Historical data **cannot be honestly backfilled** for events that happened before this table existed; pre-migration history would simply have coarser precision, forever.

---

## 10. Recommended Minimum Architecture

**[RECOMMENDATION]** A **scoped hybrid**, not a sweeping new event model:

1. Ship the metrics that are **already reliable today** (§5.1 for finite goals net of G2, §5.6 Explicit Skip Frequency, §8's "SUPPORTED NOW" items) via plain Option-A read-only queries — zero schema change, immediate value.
2. Two small, additive schema changes to close the worst gaps cheaply:
   - `PlannedActivity.movedAt DateTime?` (nullable, additive) — stamped by `applyMoveWrites` going forward. Fixes G6's timing imprecision without a new table.
   - A `localWeekStart` (or equivalent) snapshot column on `GoalActivityOccurrence`, written **once, at creation time** by `materializeGoalActivityRhythmOccurrence`, never re-derived afterward. Fixes G4 (timezone drift) at the root.
3. **A required product decision before implementation** on G1/G2's remediation: either (a) stop hard-deleting `LOGGED`/Rhythm-linked plans (soft-delete instead), or (b) snapshot the completion fact into the Occurrence/GoalActivity row *before* the delete is allowed. This is not an audit-decidable engineering detail — it's a data-retention policy call (§12).
4. Defer the full Option-C append-only event/audit-trail model. Build §10.1–10.3 first, re-evaluate whether the richer model is still needed once they ship.

**API contracts:** purely additive `GET` endpoints per metric (e.g. `GET /api/insights/goal-progress`, `GET /api/insights/planning-consistency`), never modifying an existing route.

**Historical data limitations:** `movedAt` and the Occurrence week-snapshot cannot be backfilled for rows that already exist — pre-migration history keeps today's live-derivation behavior and its known limitations; only new data going forward gets the fix. This must be disclosed in any UI that shows a long historical trend, never silently smoothed over.

**Migration strategy:** both new columns are nullable and additive — zero backfill required, zero risk to existing reads.

**Backward compatibility:** complete — nothing existing is touched.

**Test requirements:** unit tests for the new snapshot-write logic (mirroring this repo's established pure-function convention); a real-DB integration test proving the G1 fix specifically (delete a `LOGGED`, Rhythm-linked plan and confirm the historical weekly count no longer drops); structural tests confirming no new Insights route ever renders a fabricated/zero-substituted number where evidence is insufficient (matching `insightsEvidence.ts`'s existing discipline).

---

## 11. Proposed Implementation PR Sequence

*(Proposed only — none of this is implemented by this audit.)*

1. **PR 1:** Add `PlannedActivity.movedAt`, wire `applyMoveWrites` to stamp it. No new reporting surface — ship the primitive first, matching this codebase's own established pattern elsewhere in this program.
2. **PR 2:** Add the `GoalActivityOccurrence` week-snapshot column, written at creation time; keep live-derivation as the fallback for historical `NULL` rows. Fixes G4.
3. **PR 3 (gated on §12 decision):** Implement whichever G1/G2 remediation policy is chosen — soft-delete, or pre-delete snapshot.
4. **PR 4:** Read-only Insights API + UI for the SUPPORTED NOW metrics (§5.1, §5.6, §8 items 1–3) plus Weekly Goal Achievement, now reliable given PR 2/3.
5. **PR 5:** "Repeated rescheduling" + "overloaded planning pattern" personal-improvement prompts, now cheap given PR 1.
6. **PR 6 (optional, decision-gated):** the fuller Option-C append-only event model, only if the team decides the richer audit trail is worth it after evaluating PR 1–5.
7. **Independent, unrelated fix:** G8 (the two incompatible streak definitions) is a genuine, confirmed cross-feature bug, sequenced independently of the Insights work — recommend fixing it regardless of which option above is chosen.

---

## 12. STOP Conditions and Open Decisions

These require explicit human/product sign-off before any PR above begins — this audit does not resolve them:

1. **G10 (§4, §6):** Is the existing, automatic `'MISSED'` presentation label (derived purely from elapsed time, shown as a past-tense fact in Home/Missed-Recovery/Daily Reflection) acceptable under this ticket's hard rule, or must it be relabeled/reframed toward "unconfirmed"? This is a product-policy call.
2. **G1/G2 remediation policy:** soft-delete vs. pre-delete-snapshot for `LOGGED`/Rhythm-linked plans — which fits the product's data-retention philosophy?
3. **Scheduled-week vs. performed-week attribution (§5.2):** is counting a late Done-tap in its *originally scheduled* week acceptable going forward, or does Weekly Goal Achievement need an actual-performed timestamp (which does not exist today and would be a larger change)?
4. **Scope of Option C:** does the product want the deeper, append-only audit-trail model at all, or is the scoped hybrid (§10) sufficient for the foreseeable roadmap?
5. **HabitLog backdating (G3):** is unrestricted backdating an intentional feature ("log yesterday's workout you forgot") that Insights must simply account for with lower confidence on backdated entries, or should a bound/flag be added?
6. **G8 fix sequencing:** should the two-streak-definitions bug be fixed as a prerequisite before any new Insights work ships, or tracked independently?

---

**FINAL VERDICT:**

```
AURA — INSIGHTS ARCHITECTURE V1 —
READY FOR IMPLEMENTATION PLANNING
```

No gap found in this audit is unsolvable or requires an irreconcilable rearchitecture — every one has a small, additive, scoped remediation path. The open items in §12 are exactly the kind of decision implementation planning exists to resolve next; they are not reasons to block starting that planning.
