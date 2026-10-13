/**
 * Insights V1 PR5 -- Evidence-Backed Improvement Prompts: the DB-touching
 * composition layer. Orchestration only -- every actual decision is made
 * by the pure evaluators in improvementSignals.ts; every real read/
 * capacity calculation is made by functions this codebase already ships
 * elsewhere (db.ts's listMoveChainLinksForUser;
 * createRealDayConstructorOrchestratorDeps/isActivePlanBlocker,
 * dayConstructorOrchestrator.ts; resolveAvailability/
 * normalizeUsableWindowsToConstructionWindow, availabilityContext.ts;
 * computeCapacitySnapshot/normalizeBlockedIntervals, dayCapacity.ts;
 * durationMinutesFor, dayBuilderOrchestrator.ts). No second
 * recommendation/scheduling engine is defined anywhere in this file.
 *
 * Extracted out of app/api/insights/reporting/route.ts into its own
 * function (rather than left inline) so a real-DB test can exercise the
 * EXACT same composition the API route runs, with an explicit, injectable
 * `now` -- every function this composes already takes `now`/the clock as
 * an explicit argument (this codebase's own established discipline), so
 * nothing here ever reads a hidden `new Date()`.
 */

import {
  listMoveChainLinksForUser,
  type User,
  type GoalActivityWithLinkedPlanStatus,
} from './db';
import { addDaysToDateStr } from './timezone';
import { localCalendarWeekBounds } from './goalActivityRhythm';
import { localDayBoundsUTC } from './myDayOrchestrator';
import type { GoalSummaryView } from './insightsReporting';
import { createRealDayConstructorOrchestratorDeps, isActivePlanBlocker, type DayConstructorOrchestratorDeps } from './dayConstructorOrchestrator';
import { resolveAvailability, normalizeUsableWindowsToConstructionWindow, mergeUsableWindows, type AvailabilityConfiguration } from './availabilityContext';
import { computeCapacitySnapshot, type BlockedInterval } from './dayCapacity';
import type { ConstructionWindow } from './dayIntent';
import { durationMinutesFor, GENERIC_DURATION_FALLBACK_MINUTES } from './dayBuilderOrchestrator';
import {
  evaluateMoveChains,
  evaluateRepeatedReschedulingSignal,
  evaluateOverloadSignal,
  evaluateGoalOpportunitySignal,
  evaluateAwaitingConfirmationSignal,
  rankAndSelectSuggestions,
  type ImprovementSuggestion,
  type RankedSuggestions,
} from './improvementSignals';

function sumIntervalMinutes(intervals: readonly { start: Date; end: Date }[]): number {
  return intervals.reduce((sum, interval) => sum + (interval.end.getTime() - interval.start.getTime()) / 60000, 0);
}

export interface ComputeImprovementSuggestionsInput {
  user: User;
  now: Date;
  /** The caller's own local civil "today" (getDatePartsInTimezone(user.timezone, now).dateStr) -- never re-derived here, so there is exactly one place in the whole response that decides what "today" means. */
  todayLocalDate: string;
  /** Signal 4's only input -- PR4's own already-computed planningStatus.awaitingConfirmation count. */
  awaitingConfirmationCount: number;
  /** Already-built per-Goal summaries (insightsReporting.ts's own buildGoalSummary, called once by the caller for the main response) -- reused verbatim for Signal 3's Rhythm-remaining-capacity half, never re-derived. */
  goalSummaries: readonly GoalSummaryView[];
  /** The flat GoalActivity rows the caller already fetched (listGoalActivitiesWithLinkedPlanStatusForGoals) -- reused only for each activity's own catalog activityId (duration resolution), never re-queried. */
  rows: readonly GoalActivityWithLinkedPlanStatus[];
}

/** Resolves one local civil date's real usable window (availability-gap
 * blockers) + currently-ACTIVE PlannedActivity commitment intervals
 * (isActivePlanBlocker, the SAME lifecycle rule Day Constructor itself
 * uses). Returns null when there is no usable window at all for that
 * date (UNCONFIGURED availability, or a CONFIGURED day with zero saved
 * periods) -- per normalizeUsableWindowsToConstructionWindow's own
 * contract, this is the caller's responsibility to report as "nothing to
 * evaluate", never a fabricated zero-length window.
 *
 * `commitmentIntervals` is fetched over the date's FULL civil-day bounds
 * (localDayBoundsUTC), deliberately wider than the availability window
 * itself -- a commitment the user accepted OUTSIDE their own configured
 * hours (e.g. a 7pm plan when availability ends at 5pm) is real evidence
 * of competing demand on the day, not something Signal 2 should silently
 * drop just because it falls outside the window computeCapacitySnapshot
 * will separately clip TO for Signal 3's feasibility question. Signal 2
 * (evaluateOverloadSignal's caller, below) merges these intervals among
 * THEMSELVES only (mergeUsableWindows, never clipped to the window) before
 * summing, so overload is measured against total real commitment time,
 * not an artificially window-capped one; Signal 3 passes this same raw
 * list straight into computeCapacitySnapshot, which performs its own
 * window-clipping internally exactly as it always does. */
async function resolveDayCapacityContext(
  dateStr: string,
  timezone: string,
  now: Date,
  availabilityConfig: AvailabilityConfiguration,
  deps: Pick<DayConstructorOrchestratorDeps, 'loadBlockingPlans'>
): Promise<{ window: ConstructionWindow; gapBlockers: BlockedInterval[]; commitmentIntervals: BlockedInterval[] } | null> {
  const resolution = resolveAvailability({ targetDate: dateStr, timezone, now, configuration: availabilityConfig });
  if (resolution.status === 'UNCONFIGURED') return null;
  const normalized = normalizeUsableWindowsToConstructionWindow(resolution.usableWindows, dateStr, timezone);
  if (!normalized) return null;
  const { window, gapBlockers } = normalized;
  const dayBounds = localDayBoundsUTC(dateStr, timezone);
  const blockingCandidates = await deps.loadBlockingPlans({ from: dayBounds.from, to: dayBounds.to });
  const commitmentIntervals: BlockedInterval[] = blockingCandidates
    .filter((plan) => isActivePlanBlocker(plan, now))
    .map((plan) => ({ start: plan.start, end: plan.end, source: 'FIXED_PLAN' as const }));
  return { window, gapBlockers, commitmentIntervals };
}

export async function computeImprovementSuggestions(input: ComputeImprovementSuggestionsInput): Promise<RankedSuggestions> {
  const { user, now, todayLocalDate, awaitingConfirmationCount, goalSummaries, rows } = input;
  const candidateSuggestions: ImprovementSuggestion[] = [];

  // Signal 4 -- Awaiting Confirmation. Zero new evidence.
  const awaitingSuggestion = evaluateAwaitingConfirmationSignal(awaitingConfirmationCount);
  if (awaitingSuggestion) candidateSuggestions.push(awaitingSuggestion);

  // Signal 1 -- Repeated Rescheduling. Unbounded by any reporting date
  // range -- a chain's own age is irrelevant, only its current terminal's
  // live status matters (db.ts's own listMoveChainLinksForUser doc comment).
  const moveChainLinks = await listMoveChainLinksForUser(user.id);
  for (const evaluation of evaluateMoveChains(moveChainLinks)) {
    const suggestion = evaluateRepeatedReschedulingSignal(evaluation);
    if (suggestion) candidateSuggestions.push(suggestion);
  }

  // Signals 2 & 3 -- both need a live, point-in-time capacity/feasibility
  // recheck over the user's real availability + real currently-active
  // commitments. Composed via the exact same dependency factory Day
  // Constructor's own real orchestration uses -- never a parallel/
  // duplicated scheduling-rule implementation.
  const deps: DayConstructorOrchestratorDeps = createRealDayConstructorOrchestratorDeps(user, now);
  const availabilityConfig: AvailabilityConfiguration = await deps.loadAvailabilityConfiguration();

  // Signal 2 -- Current Planning Overload. TODAY only (the copy itself,
  // "Your current plans may need more time than you have available", is
  // deliberately present-tense, never a historical-frequency claim --
  // dayCapacity.ts's own capacity math has nothing persisted to claim a
  // trend from in the first place).
  const todayContext = await resolveDayCapacityContext(todayLocalDate, user.timezone, now, availabilityConfig, deps);
  if (todayContext) {
    // Merge commitments among THEMSELVES only (never clipped to the
    // availability window) -- see resolveDayCapacityContext's own doc
    // comment for why: a commitment exceeding the configured window is
    // exactly the overload this signal exists to catch, so it must not
    // be silently truncated down to "fits perfectly" before the ratio is
    // computed.
    const mergedCommitments = mergeUsableWindows(todayContext.commitmentIntervals);
    const committedMinutesToday = sumIntervalMinutes(mergedCommitments);
    const todayCapacityResult = computeCapacitySnapshot(todayContext.window, todayContext.gapBlockers, committedMinutesToday);
    const overloadSuggestion = evaluateOverloadSignal(todayCapacityResult, committedMinutesToday);
    if (overloadSuggestion) candidateSuggestions.push(overloadSuggestion);
  }

  // Signal 3 -- Weekly Goal Opportunity. Eligible only when BOTH an
  // existing Rhythm remaining-capacity fact (already computed by the
  // caller, in goalSummaries) AND a live feasibility recheck across the
  // remaining days of the current local week both hold -- remaining Goal
  // capacity alone never promises a feasible slot exists.
  const rhythmOpportunityCandidates = goalSummaries
    .flatMap((goal) => goal.activities.map((activity) => ({ goalId: goal.id, activity })))
    .filter(({ activity }) => activity.rhythm.kind === 'N_PER_WEEK' && activity.rhythm.remainingThisWeek > 0 && activity.rhythm.eligibleForAnotherOccurrence);

  if (rhythmOpportunityCandidates.length > 0) {
    const activityIdByRowId = new Map(rows.map((row) => [row.id, row.activityId]));
    const durationContext = await deps.loadDurationContext();

    const weekBounds = localCalendarWeekBounds(todayLocalDate);
    const remainingDates: string[] = [];
    for (let dateStr = todayLocalDate; dateStr <= weekBounds.endDate; dateStr = addDaysToDateStr(dateStr, 1)) {
      remainingDates.push(dateStr);
    }
    const dayContextsByDate = new Map<string, Awaited<ReturnType<typeof resolveDayCapacityContext>>>();
    for (const dateStr of remainingDates) {
      dayContextsByDate.set(
        dateStr,
        dateStr === todayLocalDate ? todayContext : await resolveDayCapacityContext(dateStr, user.timezone, now, availabilityConfig, deps)
      );
    }

    for (const { goalId, activity } of rhythmOpportunityCandidates) {
      const activityCatalogId = activityIdByRowId.get(activity.id) ?? undefined;
      const durationMinutes = activityCatalogId
        ? durationMinutesFor(activityCatalogId, durationContext.preferredDurationByActivityId, durationContext.behavioralDurationByActivityId)
        : GENERIC_DURATION_FALLBACK_MINUTES;

      const feasibleSlotFound = remainingDates.some((dateStr) => {
        const dayContext = dayContextsByDate.get(dateStr);
        if (!dayContext) return false;
        const blockedForDay = [...dayContext.gapBlockers, ...dayContext.commitmentIntervals];
        const result = computeCapacitySnapshot(dayContext.window, blockedForDay, durationMinutes);
        return result.status === 'READY' && result.snapshot.utilization <= 1;
      });

      const opportunitySuggestion = evaluateGoalOpportunitySignal({ goalId, feasibleSlotFound });
      if (opportunitySuggestion) candidateSuggestions.push(opportunitySuggestion);
    }
  }

  return rankAndSelectSuggestions(candidateSuggestions);
}
