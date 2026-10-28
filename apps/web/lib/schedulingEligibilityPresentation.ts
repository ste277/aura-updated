/**
 * HPG3-A3b -- plain-language, non-technical presentation for the typed
 * `SchedulingEligibilityErrorCode`s HPG3-A3a introduced
 * (schedulingEligibilityError.ts). Pure, DI-free mapping only: this file
 * makes ZERO scheduling decisions, calls no route, reads no state -- it
 * only turns an already-decided `code` into copy a non-technical user can
 * act on, shared by every caller that surfaces one of these codes (Plan
 * creation and Day Constructor acceptance today; Move already has its own
 * long-established, separately-maintained copy in homeMove.ts/the
 * reschedule-via-Move path, which this file's callers may also choose to
 * adopt for the 3 codes the two modules share verbatim -- see this
 * ticket's own delivery report for exactly where that was and wasn't done).
 *
 * `severity` distinguishes two cases this ticket's own sections 2/3/4
 * treat differently:
 *   - 'conflict' (CAPACITY_EXCEEDED, DAILY_CAPACITY_EXCEEDED,
 *     DAILY_ATTRIBUTION_UNRESOLVED): a genuine scheduling conflict against
 *     an ALREADY-EXISTING occurrence somewhere else. A caller that already
 *     has a safe, real, already-wired way to point the user at their
 *     existing scheduled activities (never a fabricated deep link to the
 *     ONE specific conflicting session -- no route anywhere resolves
 *     "which PlannedActivity is linked to this GoalActivity today," see
 *     the delivery report's audit section) may offer that as a secondary
 *     action alongside this copy.
 *   - 'blocked' (GOAL_NOT_ACTIVE, GOAL_ACTIVITY_NOT_AVAILABLE): an
 *     ordinary validation failure with no "existing session" to look at
 *     at all -- these keep their exact pre-A3b message text (the same
 *     strings schedulingEligibilityError.ts already used), just now
 *     exposed through this shared, typed shape instead of being silently
 *     discarded by callers that previously read only `res.ok`.
 */
import type { SchedulingEligibilityErrorCode } from './schedulingEligibilityError';

export type SchedulingEligibilitySeverity = 'conflict' | 'blocked';

export interface SchedulingEligibilityPresentation {
  code: SchedulingEligibilityErrorCode;
  /** Short, non-technical headline (a card/banner title, never a full sentence). */
  headline: string;
  /** One or two plain-language sentences. Never implies that retrying the
   * identical request, or simply picking a different TIME within the
   * same conflict window, would resolve a genuine capacity/attribution
   * conflict (this ticket's own sections 3/4). */
  detail: string;
  severity: SchedulingEligibilitySeverity;
}

const KNOWN_CODES = new Set<string>(['GOAL_NOT_ACTIVE', 'CAPACITY_EXCEEDED', 'DAILY_CAPACITY_EXCEEDED', 'DAILY_ATTRIBUTION_UNRESOLVED', 'GOAL_ACTIVITY_NOT_AVAILABLE']);

/** Validates an arbitrary, possibly-untrusted value (a raw response
 * field) against the closed code set -- never trusts a string merely
 * because it is present, same discipline as every other response parser
 * in this codebase (e.g. acceptConstructedDay.ts's own KNOWN_SCHEDULING_ELIGIBILITY_CODES). */
export function isKnownSchedulingEligibilityCode(code: unknown): code is SchedulingEligibilityErrorCode {
  return typeof code === 'string' && KNOWN_CODES.has(code);
}

export function presentSchedulingEligibilityError(code: SchedulingEligibilityErrorCode): SchedulingEligibilityPresentation {
  switch (code) {
    case 'DAILY_CAPACITY_EXCEEDED':
      return {
        code,
        headline: 'Already scheduled for that day',
        detail: "This activity already has a session scheduled for that day. Choose a different day, or check your existing plans before trying again.",
        severity: 'conflict',
      };
    case 'CAPACITY_EXCEEDED':
      return {
        code,
        headline: 'Weekly limit reached',
        detail: "This activity has already reached its scheduled limit for the week. A different time won't change that -- it will be available again next week, or you can check your existing plans for this activity.",
        severity: 'conflict',
      };
    case 'DAILY_ATTRIBUTION_UNRESOLVED':
      return {
        code,
        headline: "Can't confirm that day is free",
        detail: "Aura can't safely confirm whether this activity was already scheduled that day, so nothing new was created. Check your existing plans for that day, then try again.",
        severity: 'conflict',
      };
    case 'GOAL_NOT_ACTIVE':
      return {
        code,
        headline: 'Goal no longer active',
        // Verbatim pre-A3b server message (goalNotActiveError, schedulingEligibilityError.ts).
        detail: 'That goal is no longer active, so a new plan cannot be linked to it.',
        severity: 'blocked',
      };
    case 'GOAL_ACTIVITY_NOT_AVAILABLE':
      return {
        code,
        headline: 'Not available to link',
        // Verbatim pre-A3b server message (goalActivityNotAvailableError, schedulingEligibilityError.ts).
        detail: 'That goal activity is not available to link right now.',
        severity: 'blocked',
      };
  }
}
