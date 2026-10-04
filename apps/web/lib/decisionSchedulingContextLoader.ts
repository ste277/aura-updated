/**
 * Constructor Decision Intelligence -- O5 P2d: the DECISION SCHEDULING CONTEXT LOADER (the database boundary).
 *
 * Reads every database-derived input of the decision evidence for ONE planning evaluation inside ONE PostgreSQL
 * `REPEATABLE READ` transaction (db.ts `withRepeatableReadSnapshot`) and returns the detached, deep-frozen
 * `DecisionSchedulingContext` (decisionSchedulingContext.ts). The transaction ends before the context is copied and
 * frozen, and before ANY CPU work consumes it.
 *
 * WHAT IS READ, in this order, on the single snapshot connection:
 *   1. the Rhythm demand candidates (the first statement: PostgreSQL takes the snapshot here, not at BEGIN)
 *   2. the occurrence rows of those candidates (ONE batched query, never per candidate) -- only if any candidate exists
 *   3. the stored activity-duration preferences
 *   4. the recent habit logs (the existing 50-most-recent read, unchanged)
 *   5. only if any candidate exists (otherwise no opportunity evidence can exist): the persisted availability flag and
 *      periods, and the persisted plans overlapping the opportunity horizon (the planning date through the end of its
 *      local calendar week -- exactly the range the O1/O2 projection will request)
 *
 * WHAT IS NEVER DONE INSIDE THE TRANSACTION: no Constructor, no opportunity projection, no timing / astronomy search, no
 * Rhythm counting, no duration resolution, no network call, no write, no lock beyond a plain SELECT's, no per-candidate
 * query. Query count is therefore constant in the number of candidates. The query semantics, filters, lifecycle and
 * overlap definition are those of the existing reads, unchanged -- only the executor differs.
 *
 * FAILURE: if any read fails the whole acquisition rejects (the transaction rolls back); a partially filled context is
 * never returned. The caller treats that as "no authoritative evidence" and must NOT fall back to the independent live
 * reads and label the result authoritative.
 *
 * SOURCE-NEUTRAL: it loads for a user and a planning date; it does not know why a candidate exists or where a request
 * came from. The runner is injectable ONLY so a test can interleave a concurrent commit at a precise point of a REAL
 * snapshot; production always uses the real REPEATABLE READ runner.
 */

import {
  withRepeatableReadSnapshot,
  loadCandidateGoalActivitiesForRhythmDemand,
  listGoalActivityOccurrenceRowsForActivities,
  listUserActivityPreferenceRows,
  listHabitLogs,
  readUserAvailabilityConfigured,
  listUserAvailabilityPeriods,
  listPlannedActivitiesOverlappingRange,
  type ReadQueryExecutor,
} from './db';
import { localCalendarWeekBounds } from './goalActivityRhythm';
import { computeOpportunityRangeBounds } from './opportunityRangeAdapter';
import { createDecisionSchedulingContext, type DecisionSchedulingContext, type DecisionSchedulingContextParts } from './decisionSchedulingContext';

export interface DecisionSchedulingContextRequest {
  userId: string;
  /** The local civil date being planned (YYYY-MM-DD). */
  planningDate: string;
  /** The user's IANA timezone: the civil dates and weekly template are read in it. */
  timezone: string;
}

export type SnapshotRunner = <T>(read: (executor: ReadQueryExecutor) => Promise<T>) => Promise<T>;

export async function loadDecisionSchedulingContext(request: DecisionSchedulingContextRequest, runSnapshot: SnapshotRunner = withRepeatableReadSnapshot): Promise<DecisionSchedulingContext> {
  // Pure civil-date / timezone arithmetic (no query, no clock): the opportunity horizon is the planning date through the end of its local calendar week.
  const horizonEndDate = localCalendarWeekBounds(request.planningDate).endDate;
  const planRange = computeOpportunityRangeBounds(request.planningDate, horizonEndDate, request.timezone);

  const parts = await runSnapshot<DecisionSchedulingContextParts>(async (executor) => {
    const candidateRows = await loadCandidateGoalActivitiesForRhythmDemand(request.userId, executor);
    const occurrenceRows = candidateRows.length > 0 ? await listGoalActivityOccurrenceRowsForActivities(request.userId, candidateRows.map((row) => row.goalActivityId), executor) : [];
    const preferenceRows = await listUserActivityPreferenceRows(request.userId, executor);
    const habitLogs = await listHabitLogs(request.userId, executor);
    if (candidateRows.length === 0) return { recurrence: { candidateRows, occurrenceRows }, durationSources: { preferenceRows, habitLogs } };
    const configured = await readUserAvailabilityConfigured(request.userId, executor);
    const periods = await listUserAvailabilityPeriods(request.userId, executor);
    const plans = await listPlannedActivitiesOverlappingRange(request.userId, planRange.from, planRange.to, executor);
    return {
      recurrence: { candidateRows, occurrenceRows },
      durationSources: { preferenceRows, habitLogs },
      opportunity: { configured, periods, planRangeFrom: planRange.from, planRangeTo: planRange.to, plans },
    };
  });

  // The transaction has ended. Copy and freeze (CPU only).
  return createDecisionSchedulingContext(parts);
}
