/**
 * HPG3-A3a -- a single, shared typed error contract for "this scheduling
 * write cannot proceed because of a Goal-linked eligibility rule," used by
 * the two Goal-linked write paths that did NOT already have one: Plan
 * creation (apps/web/app/api/plans/route.ts) and Day Constructor
 * acceptance (apps/web/lib/dayConstructorAcceptancePersistence.ts). Move
 * already has its own long-established MovePlanError/MovePlanErrorCode
 * (planMove.ts) -- this module does not replace or duplicate that, it
 * REUSES three of its own code strings verbatim (CAPACITY_EXCEEDED,
 * DAILY_CAPACITY_EXCEEDED, DAILY_ATTRIBUTION_UNRESOLVED), so a client
 * inspecting `code` sees the identical string regardless of which of the
 * three endpoints produced it.
 *
 * This module changes NO eligibility decision: it only gives the ALREADY
 * EXISTING MaterializeGoalActivityRhythmOccurrenceResult reasons (db.ts)
 * and the plain boolean `linkGoalActivityToPlannedActivity` failure a
 * shared, typed, non-database-leaking shape to travel from the
 * transaction's inner write loop to its outer HTTP/response boundary.
 */
import type { MaterializeGoalActivityRhythmOccurrenceResult } from './db';

export type SchedulingEligibilityErrorCode =
  | 'GOAL_NOT_ACTIVE'
  | 'CAPACITY_EXCEEDED'
  | 'DAILY_CAPACITY_EXCEEDED'
  | 'DAILY_ATTRIBUTION_UNRESOLVED'
  | 'GOAL_ACTIVITY_NOT_AVAILABLE';

export class SchedulingEligibilityError extends Error {
  constructor(public readonly code: SchedulingEligibilityErrorCode, message: string) {
    super(message);
    this.name = 'SchedulingEligibilityError';
  }
}

/** 409 for a genuine scheduling conflict (capacity/attribution), matching
 * the established convention Move's own STATUS_BY_CODE already uses for
 * these exact three codes (apps/web/app/api/plans/[planId]/move/route.ts).
 * GOAL_NOT_ACTIVE and GOAL_ACTIVITY_NOT_AVAILABLE stay 400, unchanged from
 * this endpoint's pre-A3a behavior for those two cases. */
export const SCHEDULING_ELIGIBILITY_STATUS_BY_CODE: Record<SchedulingEligibilityErrorCode, number> = {
  GOAL_NOT_ACTIVE: 400,
  GOAL_ACTIVITY_NOT_AVAILABLE: 400,
  CAPACITY_EXCEEDED: 409,
  DAILY_CAPACITY_EXCEEDED: 409,
  DAILY_ATTRIBUTION_UNRESOLVED: 409,
};

type MaterializeFailureReason = Exclude<Extract<MaterializeGoalActivityRhythmOccurrenceResult, { ok: false }>['reason'], 'NOT_RHYTHM_ELIGIBLE'>;

/** Maps a genuine (non-NOT_RHYTHM_ELIGIBLE) materialize failure reason to
 * its typed eligibility error. Never called for `ok: true` or for
 * `NOT_RHYTHM_ELIGIBLE` -- that case is not a failure, it falls through to
 * the existing finite link path, unchanged by this ticket. */
export function materializeFailureToSchedulingEligibilityError(reason: MaterializeFailureReason): SchedulingEligibilityError {
  switch (reason) {
    case 'CAPACITY_EXHAUSTED':
      return new SchedulingEligibilityError('CAPACITY_EXCEEDED', "This activity's weekly target has already been met.");
    case 'DAILY_CAPACITY_EXHAUSTED':
      return new SchedulingEligibilityError('DAILY_CAPACITY_EXCEEDED', 'That day already has another occurrence of this activity.');
    case 'DAILY_ATTRIBUTION_UNRESOLVED':
      return new SchedulingEligibilityError('DAILY_ATTRIBUTION_UNRESOLVED', 'Cannot confirm that day is free for this activity.');
    case 'NOT_FOUND':
      return goalActivityNotAvailableError();
  }
}

/** The pre-A3a generic bucket, unchanged message text: ownership, DISMISSED,
 * or a live link to a different plan via the finite (NONE-rhythm) path's own
 * `linkGoalActivityToPlannedActivity` returning false. */
export function goalActivityNotAvailableError(): SchedulingEligibilityError {
  return new SchedulingEligibilityError('GOAL_ACTIVITY_NOT_AVAILABLE', 'That goal activity is not available to link right now.');
}

/** The pre-A3a GOAL_NOT_ACTIVE case, unchanged message text, now carrying
 * the same typed `code` shape as every other case in this module. */
export function goalNotActiveError(): SchedulingEligibilityError {
  return new SchedulingEligibilityError('GOAL_NOT_ACTIVE', 'That goal is no longer active, so a new plan cannot be linked to it.');
}
