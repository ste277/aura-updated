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
import { computeCapacitySnapshot, normalizeBlockedIntervals, type BlockedInterval } from './dayCapacity';
import type { ConstructionWindow } from './dayIntent';
import { durationMinutesFor, GENERIC_DURATION_FALLBACK_MINUTES } from './dayBuilderOrchestrator';
import {
  evaluateMoveChains,
  evaluateRepeatedReschedulingSignal,
  evaluateOverloadSignal,
  evaluateGoalOpportunitySignal,
  evaluateAwaitingConfirmationSignal,
  hasContiguousFreeSlot,
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
  /** Insights V1 PR7 (finding F-4) -- the single awaiting-confirmation
   * plan's id when `awaitingConfirmationCount === 1`, so Signal 4's CTA
   * can point at it directly instead of a generic list. Always drawn from
   * the caller's own already-fetched awaiting-confirmation item list
   * (route.ts) -- never a second query. Omit/null when the count is 0 or
   * 2+; evaluateAwaitingConfirmationSignal falls back to a filtered-list
   * CTA in both of those cases. */
  soleUnconfirmedPlanId?: string | null;
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
 * (localDayBoundsUTC), wider than the availability window itself, so a
 * commitment crossing the window's own boundary (starts inside, runs past
 * the end) is fetched in full rather than silently truncated at the
 * query layer. It is each SIGNAL's own job to decide which of these raw
 * candidates are relevant to it: Signal 2 (below) keeps only commitments
 * that actually OVERLAP the window -- one with zero overlap (e.g. a 10pm
 * plan when availability ends at 5pm) has no relationship to the hours
 * being measured and must never inflate the overload ratio (PR5 final-
 * review correction -- see Signal 2's own comment for the confirmed
 * false-positive this closes). Signal 3 passes this same raw list
 * straight into computeCapacitySnapshot, which performs its own window-
 * clipping internally exactly as it always does -- an out-of-window
 * commitment is naturally irrelevant to a feasibility check within the
 * window regardless. */
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
  const { user, now, todayLocalDate, awaitingConfirmationCount, soleUnconfirmedPlanId, goalSummaries, rows } = input;
  const candidateSuggestions: ImprovementSuggestion[] = [];

  // Signal 4 -- Awaiting Confirmation. Zero new evidence.
  const awaitingSuggestion = evaluateAwaitingConfirmationSignal(awaitingConfirmationCount, soleUnconfirmedPlanId ?? null);
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
    // PR5 final-review correction: a commitment that does not OVERLAP the
    // availability window at all (e.g. a 10pm plan when availability ends
    // at 5pm) must never contribute to the overload ratio -- it has no
    // relationship to the configured hours this signal is measuring
    // against, and counting its full duration regardless of placement was
    // a real false-positive risk (a confirmed reproduction: a user with a
    // completely FREE, fully-available window could still be told
    // "OVERLOADED" purely from an unrelated evening commitment that never
    // competed for any of that window's own time). A commitment that
    // overlaps the window even partially (crosses its start/end boundary)
    // is counted at its FULL raw duration, never clipped down to only the
    // in-window portion -- that overrun past the boundary is itself real
    // overload evidence, which window-clipping would have silently erased.
    // `intervalsOverlap`'s own formula (dayCapacity.ts, reproduced here --
    // this repository's established precedent over cross-importing a
    // private helper): touching at an endpoint is NOT overlap.
    const overlappingCommitments = todayContext.commitmentIntervals.filter(
      (interval) =>
        interval.start.getTime() < todayContext.window.end.getTime() &&
        todayContext.window.start.getTime() < interval.end.getTime()
    );
    // Merge the surviving (window-relevant) commitments among THEMSELVES
    // only -- never clipped to the window -- so a boundary-crossing
    // commitment's full overrun still counts (see above), while two
    // overlapping commitments are never double-counted.
    const mergedCommitments = mergeUsableWindows(overlappingCommitments);
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

      // PR5 final-review correction: aggregate remaining capacity (a plain
      // utilization ratio) is NOT sufficient proof a slot exists -- a day
      // with enough TOTAL free minutes, fragmented across several small
      // gaps by existing commitments, can report "feasible" by that ratio
      // alone while no single gap is actually long enough to hold the
      // activity (confirmed by direct reproduction). computeCapacitySnapshot
      // is still called first, for its own window-validation/NO_USABLE_
      // CAPACITY fail-closed handling (cheap short-circuit before ever
      // normalizing); hasContiguousFreeSlot then proves a REAL, single,
      // unbroken span of at least `durationMinutes` exists within the
      // window, net of every blocker -- the actual minimum bar for "the
      // existing planning system could place this", not merely "the day
      // isn't full".
      const feasibleSlotFound = remainingDates.some((dateStr) => {
        const dayContext = dayContextsByDate.get(dateStr);
        if (!dayContext) return false;
        const blockedForDay = [...dayContext.gapBlockers, ...dayContext.commitmentIntervals];
        const aggregateResult = computeCapacitySnapshot(dayContext.window, blockedForDay, durationMinutes);
        if (aggregateResult.status !== 'READY' || aggregateResult.snapshot.utilization > 1) return false;
        const normalizedBlockers = normalizeBlockedIntervals(blockedForDay, dayContext.window);
        return hasContiguousFreeSlot(dayContext.window, normalizedBlockers, durationMinutes);
      });

      const opportunitySuggestion = evaluateGoalOpportunitySignal({ goalId, feasibleSlotFound });
      if (opportunitySuggestion) candidateSuggestions.push(opportunitySuggestion);
    }
  }

  return rankAndSelectSuggestions(candidateSuggestions);
}
