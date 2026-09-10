/**
 * Forward Planner V1 -- pure logic.
 *
 * No DB, no React, no API concerns -- every function here is a plain,
 * deterministic transformation over already-fetched data, testable in
 * isolation the same way bestForYouViewModel.ts/whyAuraViewModel.ts
 * already are. This file owns:
 *   - future-range resolution (Tomorrow/This weekend/Next 7 days/custom),
 *     entirely locally, WITHOUT calling packages/recommendation's own
 *     resolveHorizonDayOffsets/PlanningHorizon machinery -- see
 *     resolveForwardPlannerRange's own doc comment for why.
 *   - one-candidate-per-local-date dedup over an already-ranked
 *     TimingCandidate[] (never rescoring, never re-searching).
 *   - Plan-conflict filtering (a candidate overlapping an existing
 *     UPCOMING Plan is dropped whole, never clipped/moved/split).
 *   - the cross-day ranking tuple that combines the personal-relevance
 *     axis with the timing axis -- a NEW, Forward-Planner-owned policy,
 *     never a reuse of #104's own cross-FAMILY selectionReason vocabulary
 *     (that composer answers a different question: which family wins one
 *     slot today; this one answers which DATE is best for one family).
 */
import { getDatePartsInTimezone, addDaysToDateStr, localDateTimeToUTC } from './timezone';
import type { TimingCandidate, TimingCandidateLabel } from '../../../packages/recommendation/src/timingSearch';
import type { PersonalRelevance, DailyPersonalFitRelevantTheme } from '../../../packages/personal-intelligence/src/context';

// ============================================================
// Range resolution.
// ============================================================

export type ForwardPlannerHorizon = 'TOMORROW' | 'WEEKEND' | 'SEVEN_DAYS' | 'CUSTOM';

/** Inclusive local-calendar-date span. Both ends are 'YYYY-MM-DD' strings, matching TimingSearchDateRange's own convention -- passed straight through to runTimingSearch's own `dateRange`, never a `horizon` value (see resolveForwardPlannerRange's own doc comment). */
export interface ForwardPlannerRange {
  startLocalDate: string;
  endLocalDate: string;
}

/** Inclusive day count, e.g. Tomorrow-only = 1, a Sat+Sun weekend = 2. */
export function rangeDayCount(range: ForwardPlannerRange): number {
  const [sy, sm, sd] = range.startLocalDate.split('-').map(Number);
  const [ey, em, ed] = range.endLocalDate.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  return Math.round((endMs - startMs) / 86400000) + 1;
}

/** Product cap (7 days) -- well within the underlying engine's own much larger technical ceiling (90 days, timingSearchRequest.ts), a deliberate product-level restriction, not an engine limit. */
export const MAX_FORWARD_PLANNER_RANGE_DAYS = 7;

/**
 * Resolves a named horizon (or explicit custom dates) into an explicit
 * `ForwardPlannerRange`, entirely locally -- this function NEVER calls
 * packages/recommendation's own resolveHorizonDayOffsets/PlanningHorizon
 * WEEKEND path. That shared resolver is used elsewhere (PlanWithAuraView,
 * MuhurthamFinder) and its own WEEKEND semantics have a real, pre-existing,
 * untested asymmetry when `now` itself falls on a Sunday (jumps to NEXT
 * Saturday, a week away, rather than staying within the current weekend --
 * see this feature's own architecture audit). Forward Planner's own
 * desired product semantics ("this weekend" always means the REMAINING
 * Saturday/Sunday of the CURRENT weekend, never a future one) are
 * achievable as a safe, local, additive boundary normalization -- this
 * function -- without touching that shared resolver or risking any
 * existing PlanWithAuraView/MuhurthamFinder behavior change.
 *
 * `now`/`timezone` determine "today" (via getDatePartsInTimezone); every
 * offset below is pure calendar-date arithmetic (addDaysToDateStr), never
 * a millisecond/24h computation -- correct across a DST boundary the same
 * way addDaysToDateStr's own doc comment already establishes.
 */
export function resolveForwardPlannerRange(
  horizon: ForwardPlannerHorizon,
  now: Date,
  timezone: string,
  customStartDate?: string,
  customEndDate?: string
): { ok: true; range: ForwardPlannerRange } | { ok: false; error: string } {
  const today = getDatePartsInTimezone(timezone, now);
  const tomorrow = addDaysToDateStr(today.dateStr, 1);

  if (horizon === 'TOMORROW') {
    return { ok: true, range: { startLocalDate: tomorrow, endLocalDate: tomorrow } };
  }

  if (horizon === 'WEEKEND') {
    // today.weekday: 0=Sunday .. 6=Saturday (ZonedDateParts's own convention).
    if (today.weekday === 6) {
      // Today is Saturday -- the remainder of the current weekend is today + tomorrow (Sunday).
      return { ok: true, range: { startLocalDate: today.dateStr, endLocalDate: addDaysToDateStr(today.dateStr, 1) } };
    }
    if (today.weekday === 0) {
      // Today is Sunday -- the current weekend's only remaining day is today itself. Deliberately
      // NOT "today + next Saturday" (the shared resolver's own behavior) -- see this function's own doc comment.
      return { ok: true, range: { startLocalDate: today.dateStr, endLocalDate: today.dateStr } };
    }
    // Monday(1)..Friday(5) -- the upcoming Saturday is (6 - weekday) days away.
    const daysUntilSaturday = 6 - today.weekday;
    const saturday = addDaysToDateStr(today.dateStr, daysUntilSaturday);
    return { ok: true, range: { startLocalDate: saturday, endLocalDate: addDaysToDateStr(saturday, 1) } };
  }

  if (horizon === 'SEVEN_DAYS') {
    return { ok: true, range: { startLocalDate: tomorrow, endLocalDate: addDaysToDateStr(today.dateStr, MAX_FORWARD_PLANNER_RANGE_DAYS) } };
  }

  // CUSTOM.
  if (!customStartDate || !customEndDate) return { ok: false, error: 'customStartDate and customEndDate are required for a CUSTOM range.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(customStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(customEndDate)) {
    return { ok: false, error: 'customStartDate/customEndDate must be YYYY-MM-DD.' };
  }
  if (customStartDate < tomorrow) return { ok: false, error: 'The search range must start tomorrow or later.' };
  if (customEndDate < customStartDate) return { ok: false, error: 'customEndDate must not be before customStartDate.' };
  const range: ForwardPlannerRange = { startLocalDate: customStartDate, endLocalDate: customEndDate };
  if (rangeDayCount(range) > MAX_FORWARD_PLANNER_RANGE_DAYS) {
    return { ok: false, error: `The search range must not exceed ${MAX_FORWARD_PLANNER_RANGE_DAYS} days.` };
  }
  return { ok: true, range };
}

// ============================================================
// One-candidate-per-local-date dedup.
// ============================================================

/**
 * Reduces an already-ranked (score-descending, per runTimingSearch's own
 * FIND implementation) TimingCandidate[] to at most one entry per local
 * calendar date -- keeping the FIRST occurrence of each date (i.e. that
 * date's own best-scoring candidate, since the input is already sorted),
 * per this feature's own "take the first candidate for that local date,
 * never rescore" policy. Applied uniformly regardless of range length --
 * never trusting the underlying engine's own short-range diversity
 * behavior alone (that behavior is a soft preference for ranges under 4
 * days, not a hard guarantee -- see this feature's own architecture
 * audit). Never mutates `candidates`.
 */
export function selectOneCandidatePerLocalDate(candidates: readonly TimingCandidate[], timezone: string): TimingCandidate[] {
  const seenDates = new Set<string>();
  const result: TimingCandidate[] = [];
  for (const candidate of candidates) {
    const localDate = getDatePartsInTimezone(timezone, new Date(candidate.start)).dateStr;
    if (seenDates.has(localDate)) continue;
    seenDates.add(localDate);
    result.push(candidate);
  }
  return result;
}

// ============================================================
// CAUTION floor.
// ============================================================

/** Forward Planner's own explicit floor -- runTimingSearch(FIND) does NOT already exclude a CAUTION-labeled candidate on its own (it only skips FRICTION_WINDOW_BLOCKED conflicts, not score-floor); a day whose only available window is CAUTION-labeled must never be recommended. */
export function isAboveForwardPlannerFloor(label: TimingCandidateLabel): boolean {
  return label !== 'CAUTION';
}

// ============================================================
// Plan-conflict filtering.
// ============================================================

export interface ForwardPlannerBlockingInterval {
  start: Date;
  end: Date;
}

/** `aStart < bEnd && bStart < aEnd` -- the exact formula already established at packages/panchang/src/windows.ts's own intervalsOverlap, reapplied here to real Date instants (candidate vs. existing Plan) rather than minute-of-day panchang windows. Adjacent intervals (one ends exactly when the other starts) are never a conflict. */
function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Drops (never clips/moves/splits) any candidate whose [start,end) overlaps ANY of `blockingIntervals` -- callers are expected to have already filtered `blockingIntervals` to only UPCOMING Plans (never LOGGED/CANCELLED) and only the requested search range. */
export function filterConflictingCandidates(candidates: readonly TimingCandidate[], blockingIntervals: readonly ForwardPlannerBlockingInterval[]): TimingCandidate[] {
  return candidates.filter((candidate) => {
    const start = new Date(candidate.start);
    const end = new Date(candidate.end);
    return !blockingIntervals.some((interval) => intervalsOverlap(start, end, interval.start, interval.end));
  });
}

// ============================================================
// Cross-day ranking.
// ============================================================

const PERSONAL_RELEVANCE_RANK: Record<PersonalRelevance, number> = { HIGHLY_RELEVANT: 0, RELEVANT: 1, BASELINE: 2 };
const TIMING_LABEL_RANK: Record<TimingCandidateLabel, number> = { EXCELLENT: 0, VERY_GOOD: 1, GOOD: 2, USABLE: 3, CAUTION: 4 };

/** One already-personalized, already-conflict-filtered daily candidate, ready for cross-day ranking. `timingScore` is retained here (internal ranking input) but deliberately never carried into the public ForwardPlannerOption shape. */
export interface ForwardPlannerRankInput {
  localDate: string;
  start: string;
  end: string;
  personalRelevance: PersonalRelevance;
  relevantThemes: DailyPersonalFitRelevantTheme[];
  timingLabel: TimingCandidateLabel;
  timingScore: number;
}

/**
 * Sorts by the explicit, transparent, ordinal tuple this feature's own
 * architecture audit specified -- NEVER a numeric composite (no
 * `personalScore * X + timingScore * Y` anywhere in this file):
 *   1. personal relevance tier (HIGHLY_RELEVANT > RELEVANT > BASELINE)
 *   2. timing label tier (EXCELLENT > VERY_GOOD > GOOD > USABLE)
 *   3. timing score, descending
 *   4. start time, ascending (earlier wins a genuine tie)
 * This is a NEW policy Forward Planner owns outright -- not a reuse of
 * #104's own DailyGuidanceSelectionReason (PRIMARY_FLOOR_MET/etc), which
 * answers a structurally different question (cross-FAMILY selection for
 * one day), never rendered or referenced here. Never mutates `items`.
 */
export function rankForwardPlannerCandidates(items: readonly ForwardPlannerRankInput[]): ForwardPlannerRankInput[] {
  return [...items].sort((a, b) => {
    const relevanceDiff = PERSONAL_RELEVANCE_RANK[a.personalRelevance] - PERSONAL_RELEVANCE_RANK[b.personalRelevance];
    if (relevanceDiff !== 0) return relevanceDiff;
    const labelDiff = TIMING_LABEL_RANK[a.timingLabel] - TIMING_LABEL_RANK[b.timingLabel];
    if (labelDiff !== 0) return labelDiff;
    if (a.timingScore !== b.timingScore) return b.timingScore - a.timingScore;
    return new Date(a.start).getTime() - new Date(b.start).getTime();
  });
}

export const MAX_FORWARD_PLANNER_RESULTS = 3;

// ============================================================
// Target evaluation time.
// ============================================================

/**
 * Local noon on `localDate`, in `timezone` -- the representative instant
 * future personalization (buildDailyPersonalFitForUser) is evaluated at
 * for that candidate date, NEVER the request's own `now`/requestNow (see
 * forwardPlannerOrchestrator.ts's own module doc comment on the
 * requestNow-vs-target-evaluation-time separation). Kept here, pure and
 * DB-free, specifically so the property "a different date produces a
 * different target instant" is directly, deterministically testable
 * without any database round-trip.
 */
export function buildTargetEvaluationTime(localDate: string, timezone: string): Date {
  return localDateTimeToUTC(localDate, '12:00', timezone);
}
