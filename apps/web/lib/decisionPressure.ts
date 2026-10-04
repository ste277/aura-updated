/**
 * Constructor Decision Intelligence -- O5 P2b: pure Decision Pressure derivation.
 *
 * DECISION PRESSURE is the temporal cost of deferring a candidate, given the
 * requirement that remains and the scheduling opportunities known for it. It
 * is NOT importance: importance is the user's own value judgment and is a
 * separate authority this module never reads.
 *
 * V1 is a CATEGORICAL, positive-evidence-only classification with exactly two
 * values -- there is no score, weight, rank or numeric shortfall:
 *
 *   NONE                    the evidence does not establish pressure (the
 *                           default: absent, uncertain, malformed or
 *                           non-qualifying evidence all land here)
 *   LAST_KNOWN_OPPORTUNITY  the candidate's current day is known feasible, at
 *                           least one recurrence occurrence remains, and NO
 *                           later day of the aligned period is known viable
 *                           or unknown
 *
 * LAST_KNOWN_OPPORTUNITY means "the last KNOWN opportunity for at least one
 * remaining occurrence". It does not mean the weekly target is still fully
 * achievable, that the work must be done now, or that any slot is guaranteed;
 * demand (occurrences) and supply (viable civil days) are different units and
 * are never subtracted or compared. `viableDays` is read only as a count of
 * days known to offer a contiguous fit, never as slots, timing quality or
 * schedulability. COMPLETE means complete relative to the current Aura
 * scheduling model (P0b), and is not reinterpreted here.
 *
 * AUTHORITY: the only fact authority is the immutable `DecisionEvidence`
 * (decisionEvidence.ts). This module never imports or reads the mutable
 * `DecisionFacts` transport shape.
 *
 * PURE and SOURCE-NEUTRAL: no I/O, no async, no clock, no environment, no
 * global state, no logging. It knows nothing about where evidence came from
 * (no Goal, manual/automatic entry, intent-id scheme, title or UI), reads no
 * importance, deadline, original order, timing fit, capacity or contention, and
 * does not look at any Constructor result. It fails CLOSED: any absent,
 * malformed or inconsistent evidence yields NONE and never throws.
 *
 * INERT: nothing in the Constructor or any other production path calls this
 * yet. Wiring, contention tracing, shadow evaluation, active policy and
 * explanation are separate, later slices.
 */

import type { DecisionEvidence } from './decisionEvidence';
import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';

export type DecisionPressure = 'NONE' | 'LAST_KNOWN_OPPORTUNITY';

/** The only candidate property pressure depends on: whether the work can be deferred. Pressure is a policy for deferrable work. */
export type PressureCandidateFlexibility = 'FLEXIBLE' | 'FIXED';

export interface DecisionPressureInput {
  /** The immutable evidence prepared for this candidate, or `undefined` when none exists. */
  readonly evidence: DecisionEvidence | undefined;
  /** The local civil date ('YYYY-MM-DD') the evidence was prepared for. */
  readonly planningDate: string;
  readonly flexibility: PressureCandidateFlexibility;
}

/** A nonnegative finite integer (rejects NaN, Infinity, fractions, negatives and non-numbers). */
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
/** A strictly valid civil date -- the existing timezone-independent validator, not a JavaScript Date heuristic. */
const isCivilDate = (value: unknown): value is string => typeof value === 'string' && isValidCalendarDateString(value);

function qualifies(input: DecisionPressureInput): boolean {
  // A. only deferrable (FLEXIBLE) work can carry pressure; FIXED is always NONE.
  if (input.flexibility !== 'FLEXIBLE') return false;

  // B / F. both evidence categories must exist.
  const recurrence = input.evidence?.recurrence;
  const opportunity = input.evidence?.opportunity;
  if (!recurrence || !opportunity) return false;

  // C. the one recurrence period kind with documented semantics; no inference for any other.
  if (recurrence.period !== 'LOCAL_CALENDAR_WEEK') return false;

  // Dates: strict civil dates, correctly ordered. Civil-date strings of this shape order chronologically as strings.
  const planningDate = input.planningDate;
  if (!isCivilDate(planningDate)) return false;
  if (!isCivilDate(recurrence.periodStartDate) || !isCivilDate(recurrence.periodEndDate)) return false;
  if (!isCivilDate(opportunity.horizonStartDate) || !isCivilDate(opportunity.horizonEndDate)) return false;
  if (recurrence.periodStartDate > recurrence.periodEndDate) return false;
  if (opportunity.horizonStartDate > opportunity.horizonEndDate) return false;

  // D. the planning date lies inside the recurrence period.
  if (planningDate < recurrence.periodStartDate || planningDate > recurrence.periodEndDate) return false;

  // Recurrence counts: nonnegative integers, and `remainingInPeriod` is exactly what the producer computes
  // (Rhythm eligibility: max(0, target - completed - committed)).
  if (!isCount(recurrence.targetPerPeriod) || !isCount(recurrence.completedInPeriod) || !isCount(recurrence.committedInPeriod) || !isCount(recurrence.remainingInPeriod)) return false;
  if (recurrence.remainingInPeriod !== Math.max(0, recurrence.targetPerPeriod - recurrence.completedInPeriod - recurrence.committedInPeriod)) return false;

  // E. at least one occurrence remains (any positive number; not only one).
  if (recurrence.remainingInPeriod < 1) return false;

  // G / H. the opportunity horizon is aligned with the planning date and the recurrence period's end.
  if (opportunity.horizonStartDate !== planningDate) return false;
  if (opportunity.horizonEndDate !== recurrence.periodEndDate) return false;

  // I. only a RESOLVED duration is real knowledge; the generic fallback never qualifies.
  if (opportunity.durationBasis !== 'RESOLVED') return false;
  if (!isCount(opportunity.durationMinutes) || opportunity.durationMinutes < 1) return false;

  // Opportunity counts: nonnegative integers.
  if (!isCount(opportunity.evaluatedDays) || !isCount(opportunity.viableDays) || !isCount(opportunity.unknownDays)) return false;
  if (!isCount(opportunity.afterStartEvaluatedDays) || !isCount(opportunity.afterStartViableDays) || !isCount(opportunity.afterStartUnknownDays)) return false;

  // N. the first day is reported apart from the later days, and with them partitions the totals exactly (P0b).
  if (opportunity.evaluatedDays !== 1 + opportunity.afterStartEvaluatedDays) return false;
  if (opportunity.viableDays !== (opportunity.startDateState === 'KNOWN_FEASIBLE' ? 1 : 0) + opportunity.afterStartViableDays) return false;
  if (opportunity.unknownDays !== (opportunity.startDateState === 'UNKNOWN' ? 1 : 0) + opportunity.afterStartUnknownDays) return false;

  // J. the current day is KNOWN feasible (KNOWN_INFEASIBLE and UNKNOWN never qualify).
  if (opportunity.startDateState !== 'KNOWN_FEASIBLE') return false;

  // K / L. no later day of the aligned period is known viable, and none is unknown.
  if (opportunity.afterStartViableDays !== 0) return false;
  if (opportunity.afterStartUnknownDays !== 0) return false;

  // M. the horizon was evaluated completely (PARTIAL and UNKNOWN coverage never qualify).
  if (opportunity.coverage !== 'COMPLETE') return false;

  return true;
}

/**
 * Derives the decision pressure of ONE candidate from its immutable evidence.
 * Deterministic and idempotent; never mutates its input; never throws -- any
 * absent, malformed or inconsistent evidence is NONE.
 */
export function deriveDecisionPressure(input: DecisionPressureInput): DecisionPressure {
  try {
    return qualifies(input) ? 'LAST_KNOWN_OPPORTUNITY' : 'NONE';
  } catch {
    return 'NONE';
  }
}
