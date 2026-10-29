# AURA — Insights V1 PR5 — Evidence-Backed Improvement Prompts Architecture Audit

**Mode:** Read-only architecture audit. No implementation. No PR. No commits. No migrations.
**Baseline verified:** `HEAD == origin/main == main == 1a20c0c87ab7b5aad73d960fdf699ff30876d867`. Migration count confirmed **48**. `git status --porcelain=v1`: only the standing untracked audit docs and `.claude/settings.local.json` in the original checkout — zero tracked modifications. The PR4 worktree (`.claude/worktrees/insights-v1-pr4-goal-planning-reporting`) still exists with its own untracked `node_modules` symlinks, exactly as the ticket anticipated — **not touched, not cleaned up, not removed**, per this ticket's own explicit instruction. No destructive git operation was run anywhere in this audit.

**Workspace safety note, stated plainly (not a recovery claim):** `e2e/fixtures/cleanup.ts` and `test/personalizedDailyStoryDb.test.ts` carry no local modifications right now — the same already-disclosed, pre-existing state from a `git reset --hard` run earlier in this program, unrelated to and unaffected by this audit.

Tags: **VERIFIED** (direct code reading), **RECOMMENDED** (engineering proposal), **UNRESOLVED** (needs a decision before implementation).

---

## 1. Executive Verdict

**Two of the four candidate signals are fully supportable today, deterministically, from evidence PR1–PR4 already made durable. One is supportable only as a live, forward-looking check (never a historical trend, since the underlying capacity model is deliberately ephemeral). One is a direct, near-zero-new-logic reuse of PR4's own reporting output.** No migration is required for any of them.

- **Signal 1 (Repeated Rescheduling):** **Supported**, via `rescheduledFromPlanId` chain-walking + `movedAt` (PR1). Reliable identity (never confused with independent activities); one confirmed edge case (a deleted chain terminal) requires an explicit suppression rule, not a new field.
- **Signal 2 (Overloaded Planning):** **Supported only as a live, forward-looking check** — `apps/web/lib/dayCapacity.ts`'s `computeCapacitySnapshot` is a deliberately pure, request-time-only function; **no capacity fact has ever been persisted**, by design (confirmed, re-reading the module's own purity contract). PR5 cannot report "you were overloaded 3 times this month" — only "today/this week, right now, your accepted commitments already exceed available time."
- **Signal 3 (Weekly Goal Opportunity):** **Supported, but only when gated by Signal 2's own feasibility check.** Remaining Rhythm capacity (`remainingOccurrences > 0`) is necessary but not sufficient — the ticket's own instruction ("remaining capacity alone does not prove a feasible time slot exists") is correct and independently confirmed here: `computeGoalActivityRhythmEligibility` has zero awareness of the day's actual open minutes.
- **Signal 4 (Awaiting Confirmation):** **Supported directly** — PR4's `awaitingConfirmation` output already is exactly this signal; no new evidence gathering needed at all.

**Verdict: ARCHITECTURE READY** (§13 lists product decisions that should be confirmed before implementation; none are engineering blockers).

---

## 2. Existing Evidence Inventory

**[VERIFIED]**, re-traced directly against `1a20c0c`:

| Source | What it can prove | What it cannot prove |
|---|---|---|
| `PlannedActivity.status`/`loggedAt`/`skippedAt` | Explicit completion/skip, with clean dedicated timestamps | Actual performance time (never inferred from `loggedAt`, PR3/PR4's own standing rule) |
| `PlannedActivity.rescheduledFromPlanId`/`movedAt` (PR1) | A single Move event's exact commit instant; a full chain's length, walked via the `@unique` backward FK | Whether two *independently scheduled* plans are "the same intended activity" — title/`activityId` similarity is never sufficient evidence on its own |
| `GoalActivityOccurrence.scheduledWeekStart`/`scheduledWeekTimezone` (PR2) | Which local week a Rhythm occurrence counts toward, immune to later Move/timezone changes | Nothing about non-Rhythm plans — this snapshot exists only on Rhythm occurrences |
| `GoalActivityExecution.goalActivityOccurrenceId` (PR3) | Durable per-occurrence completion evidence surviving the linked plan's deletion | Completion for a *non*-Goal-linked plan once its row is hard-deleted — confirmed, re-verified: no durable fallback exists outside the Goal-linked path |
| PR4's `insightsReporting.ts` (`classifyPlanningStatus`, `buildGoalSummary`) | The six-fact planning-status model and per-Goal Rhythm/finite progress, already batched account-wide | Anything beyond what it already reports — PR5 should call it, never re-derive it |
| `apps/web/lib/dayCapacity.ts` (`computeCapacitySnapshot`) | A point-in-time utilization ratio for one construction window, given an explicit blocked-interval list and requested minutes | **Nothing historical** — this is a pure function with zero DB access and zero persistence; re-confirmed directly from its own header ("no DB import... every instant is an explicit argument"). No row in the schema ever stores a past `CapacitySnapshot`. |
| `apps/web/lib/availabilityContext.ts` (`resolveAvailability`) | A user's configured usable windows for a given target date, from their persisted `AvailabilityConfiguration` | Nothing about commitments — must be combined with a fresh `PlannedActivity` read to become a real `BlockedInterval` list |
| `apps/web/lib/auraSuggests.ts` | Confirmed **out of scope / non-overlapping**: a same-day, real-time Home-surface card interpreting `DailyAgenda` ("what should I know about the day I've already built") — a different question, different data model, different surface from PR5's retrospective, evidence-based Insights suggestions. PR5 does not duplicate it and should not reuse its code. | — |
| Day Constructor / `goalDemandCandidates.ts` | Which Goal activities are currently *eligible* to be suggested for planning | Nothing about whether a feasible time slot exists on any given day — that is `dayCapacity.ts`'s question, not this module's |

---

## 3. Candidate Signal Evaluation

### Signal 1 — Repeated Rescheduling

**[VERIFIED]** `rescheduledFromPlanId` is `@unique` on `PlannedActivity` — at most one successor per row, enforced at the DB level, so the chain is a true linked list, walkable in either direction with simple indexed lookups (backward: follow `rescheduledFromPlanId`; forward: `WHERE "rescheduledFromPlanId" = $1`, guaranteed ≤1 row).

**Chain identity**: the *only* reliable signal that two plans are the same repeatedly-moved commitment is this FK chain — never title, never `activityId` (two genuinely independent "Workout" plans scheduled on different days, never moved, must never be conflated with one Workout moved twice). This directly satisfies the ticket's own "do not confuse multiple independent activities with repeated moves of one activity" instruction.

**Deleted source rows**: **structurally cannot happen** for any non-terminal chain member — confirmed by re-reading `deletePlannedActivity`'s own `WHERE status IN ('LOGGED','CANCELLED')` clause: a `MOVED` row's status can never match it, so every tombstone in a chain is permanent *except* the terminal (live) row, which only becomes deletable once it itself resolves to `LOGGED`/`CANCELLED`.

**New edge case found, not previously documented**: if the chain's terminal row *is* later deleted (the user completed it, then cleared it from "Recently Completed"), a forward walk from the chain's origin correctly stops at the last surviving `MOVED` tombstone — but that tombstone is not a live commitment, so there is nothing to act on. **Signal 1 must only fire when the chain's current terminal row is confirmed `UPCOMING`** (still live, still actionable) — a chain whose terminal has resolved (`LOGGED`/`SKIPPED`/`CANCELLED`) or been deleted is suppressed, satisfying the ticket's own "no dead CTAs."

**Legacy `NULL` `movedAt`**: pre-PR1 Move rows have no timestamp (never backfilled, by design) — the chain *length* (count of `MOVED` hops) remains fully computable without it; only "how long ago did the last move happen" is unavailable for those rows, which simply degrades the suggestion's own recency framing, never blocks detection.

**Verdict: Supported**, with the terminal-liveness exclusion above as a required (not optional) eligibility rule.

### Signal 2 — Overloaded Planning

**[VERIFIED]** Re-confirmed by direct, full reading of `dayCapacity.ts`: `computeCapacitySnapshot` is purity-contracted (no DB import, no server clock read, every instant an explicit argument) and its result (`CapacitySnapshot`/`DayCapacityResult`) is **never persisted anywhere** — confirmed by a repo-wide check for any write of `CapacityState`/`CapacitySnapshot` to the database: none exists. This is not an oversight; the module's own header explains it is deliberately request-scoped.

**Consequence**: PR5 **cannot** report a historical "you were overloaded N times" trend — there is no stored fact to count. It **can** compute a *live* snapshot, on demand, by: (1) reading the user's `AvailabilityConfiguration` and calling `resolveAvailability` for today/this week (existing, pure), (2) reading currently-`UPCOMING` `PlannedActivity` rows for that window via the existing `listPlannedActivitiesOverlappingRange` (or PR4's own `listPlannedActivitiesForReporting`, filtered to `UPCOMING`) as `BlockedInterval`s, (3) calling `computeCapacitySnapshot` fresh, exactly as Day Constructor itself already does. This is a genuine reuse, not a new capacity engine.

**"Do not infer overload merely from a high activity count"**: directly satisfied by construction — `computeCapacitySnapshot`'s `utilization` is `requestedMinutes / usableMinutes`, never a raw count; a day with 15 short activities and ample open time correctly classifies `OPEN`/`BALANCED`, never `OVERLOADED` by count alone.

**Verdict: Supported, live-only** (today or the current week, computed at suggestion-generation time) — never a historical pattern claim.

### Signal 3 — Weekly Goal Opportunity

**[VERIFIED]** `computeGoalActivityRhythmEligibility`/`evaluateNewOccurrenceEligibility` correctly compute `remainingOccurrences > 0` from durable, already-proven-correct evidence (PR2/PR3). But re-confirmed by reading `goalActivityOccurrenceCapacity.ts` in full: **this computation has zero awareness of actual clock time, availability, or competing commitments** — it only answers "has this Goal's own weekly counter room," never "is there anywhere on the user's actual calendar this week to put it."

**The ticket's own instruction is independently confirmed correct**: a GoalActivity can show `remainingOccurrences: 2` while the user's entire remaining week is already fully booked — promising a "you have room for another session" suggestion in that state would be a false, unsupported claim.

**Required composition**: Signal 3 is only eligible when (a) `remainingOccurrences > 0` for a Rhythm GoalActivity (PR4's own reporting output, reused directly) **AND** (b) a live Signal-2-style capacity check against the *remaining days of the current local week* finds at least one day with `usableMinutes` sufficient for the activity's own typical/configured duration. This is a genuine, new composition of two existing engines — not a new one.

**Verdict: Supported, but only as the conjunction of Signal 3's own Rhythm-eligibility check and Signal 2's live capacity check** — never Signal 3 alone.

### Signal 4 — Awaiting Confirmation

**[VERIFIED]** PR4's `GET /api/insights/reporting` already returns `awaitingConfirmation.count`/`items` — past, still-`UPCOMING` plans with no confirmed outcome, correctly never labeled a failure. This signal requires **zero new evidence gathering**; PR5's only job is presentation (framing, suggested action, suppression of repetition) over data that already exists.

**"Avoid repetitive or guilt-inducing reminders"**: this is a presentation/frequency concern (§5, §12), not an evidence-sourcing one — the underlying fact (count of unconfirmed items) is already correctly, neutrally computed.

**Verdict: Supported directly, no new reads.**

---

## 4. Supported vs. Unsupported Signals — Summary

| Signal | Status | New evidence gathering required |
|---|---|---|
| 1. Repeated Rescheduling | **Supported** | None — chain-walk over existing `rescheduledFromPlanId`/`movedAt` |
| 2. Overloaded Planning | **Supported, live-only** | A new, read-only composition of existing `resolveAvailability` + `PlannedActivity` range reads + `computeCapacitySnapshot` — no new primitive |
| 3. Weekly Goal Opportunity | **Supported, gated** | Reuses PR4's Rhythm reporting + Signal 2's own live capacity check |
| 4. Awaiting Confirmation | **Supported directly** | None — PR4's existing output |

No signal was rejected as unsupportable.

---

## 5. Deterministic Eligibility Rules

**[RECOMMENDED]**

### 5.1 Repeated Rescheduling
- **Required evidence**: a `PlannedActivity` chain (walked via `rescheduledFromPlanId`) of length ≥ the minimum threshold (§13, UNRESOLVED — recommend 2 moves, i.e. 3 total rows, as the safe V1 default: a single Move is an ordinary, unremarkable planning action).
- **Minimum evidence threshold**: ≥2 `MOVED` hops in one chain.
- **User ownership**: `userId`-scoped at every query.
- **Dedup identity**: the chain's own terminal row id — one suggestion per chain, never per hop.
- **Time attribution**: each hop's own `movedAt` (null-safe; a legacy `NULL` hop simply has no "when," never blocking detection of the hop itself).
- **Historical coverage**: chains predating PR1 (`movedAt` migration) are still correctly counted by hop quantity; only per-hop recency is unavailable for those hops.
- **Exclusions**: a chain whose current terminal is not `UPCOMING` (resolved or deleted, §3).
- **False-positive risks**: none identified beyond the terminal-liveness case, which is explicitly excluded.
- **Suppression conditions**: terminal not live; chain already suggested and not yet dismissed within the suppression window (§12, UNRESOLVED on exact duration).
- **Suggested user action**: open the current (terminal) plan — an existing, already-supported action (view/open a plan), never an automatic reschedule.

### 5.2 Overloaded Planning
- **Required evidence**: live `PlannedActivity` (`UPCOMING`) rows for the target window + the user's persisted `AvailabilityConfiguration`.
- **Minimum evidence threshold**: a `READY` `DayCapacityResult` classifying `OVERLOADED` (`utilization > 1`) for today or the current local week — `NO_USABLE_CAPACITY`/`INVALID_CONSTRUCTION_WINDOW`/`TIMEZONE_MISSING` results must suppress the signal entirely (fail-closed, matching the module's own existing discipline), never be reinterpreted as "overloaded."
- **User ownership**: `userId`-scoped.
- **Dedup identity**: one suggestion per `(userId, local date or week)` — never one per conflicting plan.
- **Time attribution**: the live computation's own `now`/window, never a historical date.
- **Historical coverage**: none — this signal has no memory, by design (§3).
- **Exclusions**: a user with no configured availability (`AvailabilityConfiguration` absent/unconfigured) — suppressed, never defaulted to a fabricated "always open" or "always overloaded" assumption.
- **False-positive risks**: a single, short, already-completed (`LOGGED`) activity should not count as a blocking interval for a *forward-looking* capacity check — only genuinely still-`UPCOMING` commitments block remaining capacity.
- **Suggested user action**: open Plan My Day / review today's plan — existing, already-supported entry points.

### 5.3 Weekly Goal Opportunity
- **Required evidence**: PR4's own per-Goal `rhythm` view (`remainingThisWeek > 0`) **AND** a live capacity check (§5.2's own engine) against the remaining days of the current local week finding ≥1 day with `usableMinutes` ≥ the activity's typical duration (duration source: existing `activityDuration.ts`/user preference, never invented).
- **Dedup identity**: the `GoalActivity.id` — one suggestion per activity, never per remaining occurrence slot.
- **Time attribution**: the current local week (PR2's own `scheduledWeekStart` convention for consistency).
- **Exclusions**: a Goal already at target this week; no feasible day found.
- **Suggested user action**: open Plan My Day pre-scoped to this Goal, or the existing Goal Detail "Plan with Aura" entry point — never an automatic occurrence materialization.

### 5.4 Awaiting Confirmation
- **Required evidence**: PR4's `awaitingConfirmation.items`.
- **Minimum evidence threshold**: count ≥1.
- **Dedup identity**: per-item, but surfaced as one aggregate suggestion ("X plans need a status"), never one card per item (avoids flooding, §E).
- **Suggested user action**: open the existing Log/Skip action for each listed item — already-supported, no new mutation path.

**Explicitly rejected, repo-wide**: any behavioral label (lazy, inconsistent, undisciplined, unproductive) — none of the above rules produce or require one; every rule is phrased as a fact about evidence, never a judgment about the person.

---

## 6. Ranking and Suppression Design

**[RECOMMENDED]**

A single deterministic priority order, evaluated fresh on each request (no stored "suggestion state" beyond optional dismissal, §12):

1. **Awaiting Confirmation** (highest — lowest evidence bar, most directly actionable, zero risk of being wrong).
2. **Overloaded Planning** (today specifically) — time-sensitive, actionable right now.
3. **Repeated Rescheduling** — a real friction signal, less time-critical than an active overload.
4. **Weekly Goal Opportunity** — the most "optional"/positive-framed of the four; lowest urgency.

**Suppression / duplicate avoidance**:
- At most one suggestion per signal type is ever surfaced at once (e.g., never one card per Move chain — the single worst/longest chain, if multiple exist, or an aggregate count).
- A maximum of N total visible suggestions (§13, UNRESOLVED exact N — recommend 1 primary + up to 2 secondary, matching the ticket's own §J framing).
- No numeric productivity/urgency SCORE is computed — ranking is a fixed, documented ORDER among qualitatively distinct signal types, never a blended number.

---

## 7. Existing User Actions (no new mutation paths)

**[VERIFIED]** Every suggested action already exists in production:

| Signal | Existing action | Entry point |
|---|---|---|
| Repeated Rescheduling | Open/review the current plan; reschedule via existing Move | `movePlannedActivity` (already gated by its own auth/validation) |
| Overloaded Planning | Open Plan My Day / review today | Existing Plan My Day flow |
| Weekly Goal Opportunity | Open Plan My Day pre-scoped to a Goal, or Goal Detail's own "Plan with Aura" | Existing `goalDemandCandidates.ts`-backed flow |
| Awaiting Confirmation | Log / Skip an activity | `logPlannedActivity`/`skipPlannedActivity` (existing, already-authenticated) |

No new write path, no automatic rescheduling, no silent commitment creation — every CTA routes to an already-shipped, already-tested mutation the user explicitly triggers.

---

## 8. API Architecture Recommendation

**[RECOMMENDED]** **Option C** — compute suggestions entirely within an existing reporting composition layer, exposed via a thin extension of PR4's response (not a wholly separate endpoint, and not folded into `insightsReporting.ts`'s own pure fact model).

- **Data access**: every signal reuses an existing reader (`listPlannedActivitiesForReporting`, `listGoalActivitiesWithLinkedPlanStatusForGoals`, availability/capacity modules) — no new query primitive beyond the capacity-check composition in §5.2/§5.3.
- **Query performance**: all four signals can be derived from data the existing `GET /api/insights/reporting` call already fetches, plus one additional live capacity computation (cheap, pure, in-memory) — no new N+1 risk.
- **Duplication risk**: lowest with Option C, since it sits directly on top of already-correct, already-tested PR4 output rather than re-querying independently.
- **Testability**: a new pure module (mirroring `insightsReporting.ts`'s own convention) keeps signal-selection logic DB-free and unit-testable, with a thin DB-touching composition function for the one new capacity read.
- **Caching**: not required for V1 (the underlying data is already cheap); explicitly defer rather than introduce a new caching layer.
- **Response stability**: additive field(s) on the existing response shape — no breaking change to PR4's own contract.
- **User isolation**: inherits PR4's own `userId`-scoping on every underlying call; the new capacity read must be scoped identically.
- **UI integration**: simplest under Option C — the existing Insights fetch already has everything; no second round trip needed.

**Option A** (extend the existing endpoint further) is effectively what Option C recommends at the API-shape level; **Option B** (a wholly separate endpoint) is rejected as unnecessary duplication of auth/isolation/fetch wiring for data the existing endpoint already assembles most of.

**No schema change — no blocker demonstrated.** Every signal is computable from already-persisted, already-correct PR1–PR4 evidence plus one new, purely computational composition.

---

## 9. Minimal UI Proposal

**[RECOMMENDED]**

- **One primary actionable insight** (the top of §6's ranking, whichever signal currently applies) rendered prominently; **at most two secondary items** below it, collapsed/compact.
- **Clear evidence explanation**: every suggestion states its own basis inline (§G's own approved examples — "This activity has been moved several times," "You have room for another activity toward this week's goal") — never a bare CTA with no stated reason.
- **Direct action**: the CTA routes straight to the existing action (§7) — no intermediate "are you sure" unless the underlying action itself already requires confirmation (e.g. a real Move still goes through its own existing validation).
- **Dismissal behavior**: **[UNRESOLVED, §12]** — investigated below (§10).
- **Empty state**: zero suggestions is a valid, expected, positively-framed state ("Nothing needs your attention right now") — never an error, never a fabricated placeholder.
- **Mobile readability**: reuse the exact card primitives PR4 already proved readable at 375×812 (`SurfaceCard`/`InlineStat`) — no new visual language.
- **Placement**: Insights surface only for V1 (§13) — not proactive/push, consistent with "MINIMUM INPUT → MAXIMUM ASSISTANCE" meaning *minimum user effort to get value*, not *maximum interruption*.

**Avoid creating another large dashboard section**: this is explicitly a *compact* addition — one card, not a fifth major Insights section alongside PR4's four.

---

## 10. Historical Limitations

**[VERIFIED]**

- **Deleted plans**: a non-Goal-linked deleted plan leaves no trace for any signal (consistent with PR4's own already-disclosed asymmetry); a Move-chain's deleted terminal correctly suppresses Signal 1 (§3).
- **Legacy Move records**: pre-PR1 chains are still detectable by hop count; only per-hop timing is unavailable.
- **Missing completion evidence / legacy `NULL` execution links**: inherited unchanged from PR3/PR4's own already-proven-correct fallback behavior (exclude, never fabricate).
- **User timezone changes**: Signal 2/3's live capacity check always uses the user's *current* timezone (consistent with every other live-derivation in this codebase) — no historical drift risk, since nothing is stored.
- **Cross-week Move**: Signal 3's weekly-opportunity check always reads the *current* week's facts fresh (PR2's own snapshot), never a stale cached week.
- **Goal deletion**: a deleted Goal simply has nothing to suggest — no special handling needed, since PR4's own Goal list already reflects only currently-existing Goals.
- **Historical partial coverage**: Signal 2 has *no* historical coverage at all, by design (§3) — this must be disclosed as a hard limitation, not a gap to "fix" by inventing a new persisted trend without explicit authorization.

**No deleted content is ever reconstructed from guesses anywhere in this design** — every suppression rule above defaults to *silence*, never fabrication, when evidence is insufficient.

---

## 11. Real-DB Test Matrix

**[RECOMMENDED]** All 22 required scenarios, assertions against persisted facts and returned suggestions:

| # | Scenario | Verifies |
|---|---|---|
| 1 | One Move | Chain length 1 — below Signal 1's own threshold, correctly suppressed |
| 2 | Multiple Moves, same chain | Chain length ≥2 — Signal 1 fires, pointing at the correct terminal |
| 3 | Independent Move chains | Two separate, unrelated single-hop chains never merge into a false "repeated" signal |
| 4 | Deleted Move source | Confirmed structurally impossible (§3) — regression-guard test |
| 5 | Legacy `NULL` `movedAt` | Chain-length detection unaffected; recency framing gracefully degrades |
| 6 | Actual availability conflict | Signal 2 fires only when a real `UPCOMING`-commitment-vs-availability overlap exists |
| 7 | High activity count, no capacity conflict | Signal 2 does NOT fire from count alone (direct regression test for the ticket's own instruction) |
| 8 | Weekly Goal remaining capacity | Signal 3's Rhythm-eligibility half correctly identifies room |
| 9 | Weekly Goal, no feasible slot | Signal 3 correctly suppressed when Signal 2's own capacity check finds no open day |
| 10 | Completed weekly target | Signal 3 does not fire once `remainingThisWeek = 0` |
| 11 | Past UPCOMING unconfirmed | Signal 4 count includes it, framed neutrally |
| 12 | Confirmed completion | Correctly excluded from Signal 4 |
| 13 | Deleted completed plan | Goal-linked: still excluded correctly from Signal 4 (it has an outcome); PR3 evidence intact |
| 14 | Legacy `NULL` execution link | Inherited PR3/PR4 fallback behavior, unaffected by PR5 |
| 15 | Cross-week Move | Signal 3 reads the correct, current week post-Move |
| 16 | Timezone change | Signal 2/3's live check uses the current timezone, no stale drift |
| 17 | User isolation | No signal ever surfaces another user's data |
| 18 | Empty account | All four signals correctly return empty/suppressed, no error |
| 19 | Duplicate signal suppression | Two Move chains for the same GoalActivity collapse to one Signal-1 suggestion, never two |
| 20 | No mutation / read-only guarantee | Zero rows change after computing all four signals |
| 21 | Deterministic priority ordering | Given multiple eligible signals, the returned order always matches §6 exactly |
| 22 | Correct CTA eligibility | Every returned suggestion's action target actually exists and is owned by the requesting user |

---

## 12. Performance Considerations

**[VERIFIED/RECOMMENDED]** Signals 1 and 4 are cheap, already-batched reads (PR4-level cost). Signal 2/3's live capacity composition adds: one `AvailabilityConfiguration` read, one bounded `PlannedActivity` range read (already indexed on `(userId, plannedStartAt)`), and one pure in-memory `computeCapacitySnapshot` call — no loop-per-day-per-Goal risk if implemented as one batched read for the whole remaining week, mirroring PR4's own batching discipline. No caching layer is required for V1; revisit only if production load data shows otherwise (not speculated here).

---

## 13. Product Decisions

**[UNRESOLVED]** — recommended safe V1 defaults given, not approved policy:

1. **Minimum Move-chain length for Signal 1**: recommend 2 moves (3 rows). Not approved.
2. **Suggestion frequency / re-surfacing after dismissal**: recommend a simple, time-based re-eligibility window (e.g., don't re-show a dismissed suggestion for 7 days) — **requires the dismissal storage question below to be resolved first**.
3. **Dismissal semantics and storage**: **investigated, not authorized**. Persistent dismissal (surviving a session/device change) would require *some* persisted per-user, per-suggestion-identity record — which is a schema change this audit is explicitly not authorized to propose without a demonstrated blocker. **Recommended V1 default: client-local (browser-storage) dismissal only, non-persistent across devices** — explicitly the smallest, authorization-free option; a durable dismissal store is a distinct, future, separately-authorized decision, not assumed here.
4. **Maximum visible suggestions**: recommend 1 primary + 2 secondary (§9).
5. **Where suggestions appear**: recommend Insights-only for V1 (not Home, not proactive/push) — the ticket's own §L question, answered conservatively; Home placement would compete with `auraSuggests.ts`'s own established territory (§2) and should be a separate, explicit future decision.
6. **Proactive vs. Insights-only**: recommend Insights-only (pull, not push) for V1 — no notification/push infrastructure is invoked by this design.
7. **Which signals belong in V1**: recommend all four — each is independently supportable (§4); none requires the others to ship first.

---

## 14. Exact Proposed Implementation Scope

**[RECOMMENDED — not implemented by this audit]**

- A new pure module (e.g. `apps/web/lib/improvementSignals.ts`) implementing §5's four eligibility rules and §6's ranking, mirroring `insightsReporting.ts`'s own DB-free convention.
- One new, small DB composition (live availability + near-term `PlannedActivity` read) feeding `computeCapacitySnapshot` for Signals 2/3 — reusing existing readers, no new SQL primitive beyond a bounded range query already proven elsewhere.
- An additive field on `GET /api/insights/reporting`'s existing response (Option C, §8) — no new route.
- UI: one compact new card/section in `InsightsView.tsx`, reusing existing primitives.
- Client-local (non-persistent) dismissal only, per §13 item 3.
- The 22 tests in §11.
- **No migration, no new table, no Goal model change, no write-path change, no new scoring engine.**

---

## 15. Risks and STOP Conditions

**None found that block starting implementation planning.**

- Signal 2/3's capacity composition must correctly treat a user with no configured `AvailabilityConfiguration` as "insufficient evidence" (suppress), never silently assume unlimited or zero availability — a real correctness risk if implemented carelessly, flagged explicitly as a required eligibility rule (§5.2), not a blocker.
- The dismissal-persistence question (§13 item 3) is the one item most likely to need a human product decision before a *full* V1 ships, but the recommended client-local default is fully authorization-free and lets implementation proceed without waiting on it.

---

## FINAL VERDICT

```
AURA — INSIGHTS V1 PR5 —
ARCHITECTURE READY
```

All four candidate signals are either directly supportable from PR1–PR4's own durable evidence, or supportable as a live, honest, pure-function composition of already-existing engines (`dayCapacity.ts`, `availabilityContext.ts`). No fabricated metric, no behavioral label, and no new migration is required anywhere in this design. The one product decision most worth resolving before a complete V1 (dismissal persistence) has a safe, zero-authorization-needed default that does not block starting implementation.
