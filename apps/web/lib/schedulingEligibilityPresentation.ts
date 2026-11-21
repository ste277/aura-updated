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

// ============================================================
// AURA-HPG5-V2-I1 -- Find a Time conflict and empty-result presentation.
// Pure and client-safe (no DB import). `PLAN_OVERLAP` is deliberately NOT
// a SchedulingEligibilityErrorCode: it is an overridable overlap warning
// (the user may "Save anyway"), not an eligibility refusal.
// ============================================================

export const PLAN_OVERLAP_RESPONSE_CODE = 'PLAN_OVERLAP';

export interface PlanOverlapConflictView {
  title: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

export interface PlanOverlapPresentation {
  headline: string;
  detail: string;
  /** Screen-reader-friendly label for the explicit override action. */
  saveAnywayLabel: string;
}

/** True only for the 409 body POST /api/plans returns when
 * overlapPolicy REJECT_ACTIVE_OVERLAP found a blocking plan. */
export function isPlanOverlapResponse(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === PLAN_OVERLAP_RESPONSE_CODE;
}

/** Validates the untrusted `conflict` field; null when absent or malformed
 * (e.g. the conflicting plan vanished between the check and the read). */
export function parsePlanOverlapConflict(body: unknown): PlanOverlapConflictView | null {
  const conflict = typeof body === 'object' && body !== null ? (body as { conflict?: unknown }).conflict : undefined;
  if (typeof conflict !== 'object' || conflict === null) return null;
  const { title, plannedStartAt, plannedEndAt } = conflict as Record<string, unknown>;
  if (typeof title !== 'string' || typeof plannedStartAt !== 'string' || typeof plannedEndAt !== 'string') return null;
  if (Number.isNaN(new Date(plannedStartAt).getTime()) || Number.isNaN(new Date(plannedEndAt).getTime())) return null;
  return { title: title.slice(0, 200), plannedStartAt, plannedEndAt };
}

export function formatPlanOverlapTime(conflict: Pick<PlanOverlapConflictView, 'plannedStartAt' | 'plannedEndAt'>, timezone: string): string {
  const start = new Date(conflict.plannedStartAt);
  const end = new Date(conflict.plannedEndAt);
  const time: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit', timeZone: timezone };
  const day: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone };
  const startDay = start.toLocaleDateString('en-US', day);
  const endDay = end.toLocaleDateString('en-US', day);
  // AURA-HPG5-V2-I2 -- a range that crosses local midnight names its end
  // date too, so "11:30 PM – 12:30 AM" is never read as the same day.
  const endText = endDay === startDay ? end.toLocaleTimeString('en-US', time) : `${endDay}, ${end.toLocaleTimeString('en-US', time)}`;
  return `${startDay}, ${start.toLocaleTimeString('en-US', time)} – ${endText}`;
}

/** AURA-HPG5-V2-I2 (R1-04) -- the save that was refused: exactly the payload
 * "Save anyway" re-sends (title + instants), never a different card's. */
export interface PlanOverlapProposedView {
  title: string;
  plannedStartAt: string;
  plannedEndAt: string;
}

export interface PlanOverlapProposedPresentation {
  headline: string;
  /** "You're trying to schedule X for <date, start – end>." */
  proposedLine: string;
  /** "It overlaps with Y at <date, start – end>. Nothing was saved." */
  conflictLine: string;
  /** Both lines, for aria-describedby consumers that want one string. */
  detail: string;
  /** Visible button text: "Save anyway at 8:07 PM". */
  saveAnywayText: string;
  /** Accessible name: proposed activity, full date/time and the conflict. */
  saveAnywayLabel: string;
}

/**
 * AURA-HPG5-V2-I2 (R1-04) -- conflict copy that names BOTH sides: the
 * proposed save being refused (title, date, start and end) and the existing
 * plan it overlaps, in the user's timezone, plus an override label that
 * carries the exact proposed time so it can never be mistaken for a
 * different result card's time.
 */
export function presentProposedPlanOverlap(proposed: PlanOverlapProposedView, conflict: PlanOverlapConflictView | null, timezone: string): PlanOverlapProposedPresentation {
  const proposedWhen = formatPlanOverlapTime(proposed, timezone);
  const proposedStartTime = new Date(proposed.plannedStartAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: timezone });
  const proposedLine = `You’re trying to schedule ${proposed.title} for ${proposedWhen}.`;
  const conflictLine = conflict
    ? `It overlaps with “${conflict.title}” at ${formatPlanOverlapTime(conflict, timezone)}. Nothing was saved.`
    : 'It overlaps with another plan on your schedule. Nothing was saved.';
  return {
    headline: 'This time overlaps with another plan',
    proposedLine,
    conflictLine,
    detail: `${proposedLine} ${conflictLine}`,
    saveAnywayText: `Save anyway at ${proposedStartTime}`,
    saveAnywayLabel: `Save anyway at ${proposedWhen}: ${proposed.title}, overlapping ${conflict ? conflict.title : 'another plan'}`,
  };
}

export function presentPlanOverlap(conflict: PlanOverlapConflictView | null, timezone: string): PlanOverlapPresentation {
  if (!conflict) {
    return {
      headline: 'This time overlaps another plan',
      detail: 'It overlaps another plan on your schedule. Nothing was saved.',
      saveAnywayLabel: 'Save anyway, overlapping another plan',
    };
  }
  return {
    headline: 'This time overlaps another plan',
    detail: `It overlaps “${conflict.title}” (${formatPlanOverlapTime(conflict, timezone)}). Nothing was saved.`,
    saveAnywayLabel: `Save anyway, overlapping ${conflict.title}`,
  };
}

/** Copy for an empty constrained Find a Time result (`emptyReason`). */
export function presentFindATimeEmptyReason(reason: unknown): string | null {
  if (reason === 'NO_AVAILABILITY_IN_RANGE') {
    return 'None of your saved availability falls in this date range. Try another day, or update your availability.';
  }
  if (reason === 'NO_ELIGIBLE_TIME') {
    return 'No free time found for this request — Aura only suggests times inside your availability that don’t overlap your existing plans. Try a shorter duration, a wider date range, or a different preferred time.';
  }
  return null;
}
