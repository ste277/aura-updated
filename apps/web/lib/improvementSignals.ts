/**
 * Insights V1 PR5 -- Evidence-Backed Improvement Prompts. Pure, DB-free
 * domain logic (same convention as insightsReporting.ts/goals.ts): no DB
 * access here -- see app/api/insights/reporting/route.ts for the real
 * reads this PR composes (listMoveChainLinksForUser, db.ts;
 * createRealDayConstructorOrchestratorDeps's own loadAvailabilityConfiguration/
 * loadBlockingPlans/loadDurationContext, dayConstructorOrchestrator.ts) and
 * for the live capacity/feasibility composition (resolveAvailability +
 * computeCapacitySnapshot, reused verbatim -- see this file's own
 * evaluateOverloadSignal/evaluateGoalOpportunitySignal doc comments for
 * exactly which already-computed facts each one consumes).
 *
 * This module defines NO second recommendation/scoring engine: every
 * eligibility decision below is a deterministic function of already-
 * verified evidence, never an inferred behavioral judgment, a numeric
 * confidence percentage, or an LLM call. See
 * AURA_INSIGHTS_PR5_ARCHITECTURE_AUDIT.md sections 3-6 for the full
 * per-signal eligibility contract this file implements.
 */

import type { MoveChainLinkRow } from './db';
import type { DayCapacityResult } from './dayCapacity';

export type SuggestionSignalType = 'AWAITING_CONFIRMATION' | 'PLANNING_OVERLOAD' | 'REPEATED_RESCHEDULING' | 'WEEKLY_GOAL_OPPORTUNITY';

export type SuggestionCtaAction = 'OPEN_PLAN_REVIEW' | 'OPEN_GOAL';

export interface ImprovementSuggestionCta {
  label: string;
  action: SuggestionCtaAction;
  /** Only present for action = 'OPEN_GOAL' -- the existing /goals/[goalId]
   * route this CTA links to. Always a real, currently-ACTIVE Goal's id
   * (the caller only ever constructs this suggestion from a Goal already
   * present in this same response's own `goals` list), never a
   * fabricated/stale id. */
  goalId?: string;
  /** Insights V1 PR7 (AURA_INSIGHTS_V1_PRODUCT_COMPLETION_AUDIT.md finding
   * F-4) -- only present for action = 'OPEN_PLAN_REVIEW' when this
   * suggestion is deterministically about exactly ONE real, already-
   * existing PlannedActivity (REPEATED_RESCHEDULING's own live chain
   * terminal; AWAITING_CONFIRMATION when there is exactly one unconfirmed
   * plan). Never fabricated/guessed -- always an id the caller already
   * resolved from real evidence. Mutually exclusive with `planFilter`. */
  planId?: string;
  /** Insights V1 PR7 -- only present for action = 'OPEN_PLAN_REVIEW' when
   * this suggestion's evidence spans MORE than one PlannedActivity, so no
   * single deterministic target exists (AWAITING_CONFIRMATION with 2+
   * unconfirmed plans). The Plan tab opens its existing "My Plans" list
   * pre-filtered to this criterion instead of pointing at one invented
   * plan. Mutually exclusive with `planId`. */
  planFilter?: 'AWAITING_CONFIRMATION';
}

export interface ImprovementSuggestion {
  /** Stable across requests for the same underlying evidence (same
   * terminal plan id / same fixed string / same goal id) -- never a
   * random id, so a client can key dismissal state on it. */
  id: string;
  signal: SuggestionSignalType;
  /** Plain-language explanation, verbatim from this ticket's own section
   * C-F approved copy -- never generated, never a behavioral label. */
  message: string;
  /** A short, machine-readable evidence tag (never shown to the user
   * directly) -- lets a reviewer/test assert WHY a suggestion fired
   * without re-deriving it from the message string. */
  evidence: string;
  cta: ImprovementSuggestionCta;
  /** The real underlying thing this suggestion is about (a specific plan
   * or Goal id) -- used ONLY for cross-signal duplicate suppression in
   * rankAndSelectSuggestions, never rendered. Two suggestions that are
   * really about the same plan/Goal must never both be shown. */
  subjectId: string;
}

// ============================================================
// Signal 1 -- Repeated Rescheduling. Chain identity is established
// PURELY by walking PlannedActivity.rescheduledFromPlanId backward from a
// live (UPCOMING) terminal -- never by title/activityId similarity (two
// independently-scheduled plans of the same activity are never confused
// with one repeatedly-moved commitment).
// ============================================================

export interface MoveChainEvaluation {
  /** The chain's current, live terminal plan id -- the one and only
   * subject this evaluation's resulting suggestion (if any) points at. */
  terminalId: string;
  /** Count of MOVED hops walked backward from the terminal. Counts
   * chains, never independent plans -- one chain of length N contributes
   * exactly one evaluation, regardless of N. */
  hopCount: number;
  /** True when the backward walk hit a reference that does not resolve
   * to a row with status 'MOVED' in the supplied `rows` -- the documented
   * "broken/ambiguous chain" case (ticket section C). A broken chain is
   * never trusted for its partially-counted hopCount; the caller must
   * treat it as insufficient evidence and suppress. */
  broken: boolean;
}

/**
 * Pure. `rows` is expected to be the user's ENTIRE Move-chain edge set
 * (db.ts's listMoveChainLinksForUser) -- every row with status 'MOVED' or
 * a non-null rescheduledFromPlanId, for exactly one user. Reconstructs
 * every chain in memory with a single backward walk per live terminal; a
 * cycle guard (`seen`) exists only as a defensive invariant check (the
 * unique rescheduledFromPlanId FK makes a real cycle impossible) and is
 * itself treated as a broken chain, never an infinite loop.
 */
export function evaluateMoveChains(rows: readonly MoveChainLinkRow[]): MoveChainEvaluation[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const evaluations: MoveChainEvaluation[] = [];

  for (const row of rows) {
    // Only a LIVE (still UPCOMING), moved-at-least-once row is a
    // candidate terminal -- a resolved (LOGGED/SKIPPED/CANCELLED) or
    // never-moved row has no actionable "would another time work
    // better?" CTA to offer (ticket section C: "Terminal status =
    // UPCOMING").
    if (row.status !== 'UPCOMING' || !row.rescheduledFromPlanId) continue;

    let hopCount = 0;
    let broken = false;
    const seen = new Set<string>();
    let cursor: string | null = row.rescheduledFromPlanId;
    while (cursor) {
      if (seen.has(cursor)) { broken = true; break; }
      seen.add(cursor);
      const parent = byId.get(cursor);
      if (!parent || parent.status !== 'MOVED') { broken = true; break; }
      hopCount += 1;
      cursor = parent.rescheduledFromPlanId;
    }

    evaluations.push({ terminalId: row.id, hopCount, broken });
  }

  return evaluations;
}

const MIN_MOVE_HOPS_FOR_SUGGESTION = 2;

/** Pure. Null for a broken chain (insufficient evidence, never guessed)
 * or a chain shorter than the minimum (ticket section C: "at least 2
 * confirmed Move hops" -- a single ordinary Move is not itself
 * remarkable). */
export function evaluateRepeatedReschedulingSignal(evaluation: MoveChainEvaluation): ImprovementSuggestion | null {
  if (evaluation.broken || evaluation.hopCount < MIN_MOVE_HOPS_FOR_SUGGESTION) return null;
  return {
    id: `repeated-rescheduling:${evaluation.terminalId}`,
    signal: 'REPEATED_RESCHEDULING',
    message: 'This activity has been moved a few times. Would another time work better?',
    evidence: `move-chain-hop-count:${evaluation.hopCount}`,
    // Insights V1 PR7 (finding F-4) -- the chain's own live terminal id,
    // already established as this evaluation's one and only subject
    // (terminalId, above) -- not a new lookup, not an invented id.
    cta: { label: 'Open Plan', action: 'OPEN_PLAN_REVIEW', planId: evaluation.terminalId },
    subjectId: `plan:${evaluation.terminalId}`,
  };
}

// ============================================================
// Signal 2 -- Current Planning Overload. The caller computes a live
// DayCapacityResult by feeding computeCapacitySnapshot (dayCapacity.ts,
// reused verbatim, never re-implemented) the TODAY-local-date availability
// window as blockedIntervals (availability-gap blockers only) and the sum
// of currently-ACTIVE PlannedActivity commitment minutes as
// requestedMinutes -- i.e. "do my already-accepted commitments themselves
// exceed what the day's own configured hours can hold", the exact
// question this ticket's section D asks, never a placement attempt. This
// file never performs that composition itself -- see route.ts.
// ============================================================

/**
 * Pure. `capacityResult` must already reflect TODAY's real availability
 * window and TODAY's real active commitments (route.ts's own
 * composition) -- this function adds no new evidence, it only decides
 * whether the already-computed result counts as "overloaded":
 *   - READY with capacityState 'OVERLOADED' (utilization > 1, the SAME
 *     LOCKED threshold dayCapacity.ts already enforces everywhere else)
 *   - NO_USABLE_CAPACITY (zero usable minutes once availability gaps are
 *     removed) AND committedMinutes > 0 -- the availability window is
 *     already entirely consumed by real commitments, an even stronger
 *     overload signal than a >1.0 ratio.
 * NO_USABLE_CAPACITY with committedMinutes === 0 (a day with simply no
 * configured open hours and nothing scheduled) is explicitly NOT
 * overload -- there is nothing competing for time. Never infers overload
 * from activity count, from low remaining capacity alone, or from a
 * rejected proposed activity -- this function never receives any of
 * those inputs to infer from in the first place.
 */
export function evaluateOverloadSignal(capacityResult: DayCapacityResult, committedMinutes: number): ImprovementSuggestion | null {
  const isOverloaded =
    (capacityResult.status === 'READY' && capacityResult.snapshot.capacityState === 'OVERLOADED') ||
    (capacityResult.status === 'NO_USABLE_CAPACITY' && committedMinutes > 0);
  if (!isOverloaded) return null;
  return {
    id: 'planning-overload:today',
    signal: 'PLANNING_OVERLOAD',
    message: 'Your current plans may need more time than you have available.',
    evidence: 'accepted-commitments-exceed-available-time-today',
    cta: { label: 'Review today’s plan', action: 'OPEN_PLAN_REVIEW' },
    subjectId: 'planning-overload:today',
  };
}

// ============================================================
// Signal 3 -- Weekly Goal Opportunity. Eligible only when BOTH an
// existing Rhythm eligibility check (goalActivityOccurrenceCapacity.ts,
// already computed by insightsReporting.ts's own buildGoalSummary --
// reused, never re-derived) AND a live feasibility recheck (route.ts,
// reusing resolveAvailability + computeCapacitySnapshot exactly as Signal
// 2 does, just with the activity's own duration as requestedMinutes
// instead of the day's total commitments) both hold.
// ============================================================

/**
 * PR5 final-review correction. Pure. A day's AGGREGATE remaining minutes
 * (computeCapacitySnapshot's own `usableMinutes - requestedMinutes`) is
 * NOT sufficient proof that `durationMinutes` can actually be placed --
 * confirmed by direct reproduction: a day with three scattered
 * commitments leaving 120 total free minutes, requesting 90, reports
 * "feasible" by aggregate math even though the single largest contiguous
 * free span is only 75 minutes and nothing would ever actually fit. This
 * function finds that largest contiguous gap instead, so a claimed
 * opportunity can always be substantiated by a real, single, unbroken
 * span at least as long as the activity itself needs -- the minimum bar
 * the ticket's own section 2 requires ("do not promise a scheduling
 * opportunity unless the existing planning system can substantiate it").
 * Deliberately does NOT reach for timing-search/muhurta equivalence
 * (`runTimingSearch`) -- this signal's own copy ("there's room for
 * another activity") claims structural capacity only, never an auspicious
 * or specific time, so proving a genuine open span is the right-sized bar,
 * not a full placement-engine simulation (which would itself be the
 * "duplicated scheduling rule" this ticket's own Signal 2 section
 * explicitly warns against).
 *
 * `normalizedBlockedIntervals` MUST already be dayCapacity.ts's own
 * `normalizeBlockedIntervals(blockedIntervals, window)` output (clipped to
 * the window, merged, sorted) -- this function does not re-normalize.
 */
export function hasContiguousFreeSlot(
  window: { start: Date; end: Date },
  normalizedBlockedIntervals: readonly { start: Date; end: Date }[],
  durationMinutes: number
): boolean {
  let cursor = window.start.getTime();
  let maxGapMinutes = 0;
  for (const block of normalizedBlockedIntervals) {
    maxGapMinutes = Math.max(maxGapMinutes, (block.start.getTime() - cursor) / 60000);
    cursor = Math.max(cursor, block.end.getTime());
  }
  maxGapMinutes = Math.max(maxGapMinutes, (window.end.getTime() - cursor) / 60000);
  return maxGapMinutes >= durationMinutes;
}

/**
 * Pure. `feasibleSlotFound` must already be the result of checking every
 * remaining day of the current local week (route.ts) -- this function
 * never claims a slot exists on its own authority, and never names which
 * day/time it is (ticket section E: "avoid promising a specific time"
 * when a verified slot cannot be passed into the scheduling flow
 * reliably) -- the CTA opens the Goal itself, where the user chooses
 * when, exactly like every other existing "Plan with Aura" entry point.
 */
export function evaluateGoalOpportunitySignal(input: { goalId: string; feasibleSlotFound: boolean }): ImprovementSuggestion | null {
  if (!input.feasibleSlotFound) return null;
  return {
    id: `weekly-goal-opportunity:${input.goalId}`,
    signal: 'WEEKLY_GOAL_OPPORTUNITY',
    message: 'There’s room for another activity toward your weekly goal.',
    evidence: 'remaining-weekly-capacity-with-feasible-slot',
    cta: { label: 'Open Goal', action: 'OPEN_GOAL', goalId: input.goalId },
    subjectId: `goal:${input.goalId}`,
  };
}

// ============================================================
// Signal 4 -- Awaiting Confirmation. Zero new evidence -- reuses PR4's
// own already-computed planningStatus.awaitingConfirmation count
// verbatim. Never treats a missing outcome as a failure.
// ============================================================

/**
 * `soleUnconfirmedPlanId` -- the one real PlannedActivity id, when (and
 * only when) `awaitingConfirmationCount === 1` (the caller already has
 * this from the same already-fetched awaiting-confirmation item list used
 * elsewhere in the response -- never a second query, never guessed).
 * Insights V1 PR7 (finding F-4): with exactly one unconfirmed plan, the
 * CTA points at that specific plan directly (`cta.planId`); with more than
 * one, no single plan is the deterministic subject, so the CTA instead
 * opens the Plan tab's existing "My Plans" list pre-filtered to
 * AWAITING_CONFIRMATION (`cta.planFilter`) rather than inventing a target.
 */
export function evaluateAwaitingConfirmationSignal(awaitingConfirmationCount: number, soleUnconfirmedPlanId: string | null = null): ImprovementSuggestion | null {
  if (awaitingConfirmationCount < 1) return null;
  const cta: ImprovementSuggestionCta =
    awaitingConfirmationCount === 1 && soleUnconfirmedPlanId
      ? { label: 'Review plan', action: 'OPEN_PLAN_REVIEW', planId: soleUnconfirmedPlanId }
      : { label: 'Review plans', action: 'OPEN_PLAN_REVIEW', planFilter: 'AWAITING_CONFIRMATION' };
  return {
    id: 'awaiting-confirmation',
    signal: 'AWAITING_CONFIRMATION',
    message: 'Some past plans don’t have a recorded outcome yet.',
    evidence: `awaiting-confirmation-count:${awaitingConfirmationCount}`,
    cta,
    subjectId: 'awaiting-confirmation',
  };
}

// ============================================================
// Deterministic ranking + suppression (ticket section G). No LLM, no
// invented productivity score/confidence percentage -- a fixed priority
// ORDER among the four qualitatively distinct signal types, with a
// per-signal tie-break on each candidate's OWN already-computed evidence
// strength (e.g. a longer Move chain outranks a shorter one), never a
// blended numeric score across signal types.
// ============================================================

const SIGNAL_PRIORITY: Record<SuggestionSignalType, number> = {
  AWAITING_CONFIRMATION: 0,
  PLANNING_OVERLOAD: 1,
  REPEATED_RESCHEDULING: 2,
  WEEKLY_GOAL_OPPORTUNITY: 3,
};

const MAX_SECONDARY_SUGGESTIONS = 2;

export interface RankedSuggestions {
  primary: ImprovementSuggestion | null;
  secondary: ImprovementSuggestion[];
}

/**
 * Pure. Sorts by the fixed signal-type priority above (stable sort, so
 * candidates of the same type keep whatever order the caller already
 * ranked them in -- e.g. longest Move chain first), then deduplicates by
 * `subjectId` (keeping the first/highest-priority occurrence only, so the
 * same plan or Goal is never the subject of two visible suggestions at
 * once), then caps the result to one primary + up to two secondary.
 */
export function rankAndSelectSuggestions(candidates: readonly ImprovementSuggestion[]): RankedSuggestions {
  const sorted = [...candidates].sort((a, b) => SIGNAL_PRIORITY[a.signal] - SIGNAL_PRIORITY[b.signal]);
  const seenSubjects = new Set<string>();
  const deduped: ImprovementSuggestion[] = [];
  for (const candidate of sorted) {
    if (seenSubjects.has(candidate.subjectId)) continue;
    seenSubjects.add(candidate.subjectId);
    deduped.push(candidate);
  }
  return { primary: deduped[0] ?? null, secondary: deduped.slice(1, 1 + MAX_SECONDARY_SUGGESTIONS) };
}
