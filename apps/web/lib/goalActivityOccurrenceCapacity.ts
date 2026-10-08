/**
 * Goals V2 -- Multi-Occurrence Rhythm, PR 1: the pure, EXPLICIT decision point
 * for "may ANOTHER occurrence of this N_PER_WEEK GoalActivity be created,
 * while zero or more are already UPCOMING this week?"
 *
 * WHY THIS MODULE EXISTS, SEPARATELY FROM goalActivityRhythm.ts. The
 * underlying arithmetic already exists and is already correct and fully
 * tested: `computeGoalActivityRhythmEligibility`'s own `eligible` field IS
 * exactly `remainingOccurrences > 0`, computed from the occurrence ledger
 * alone -- it has never read `GoalActivity.plannedActivityId` and was never
 * a single-occurrence gate. This module adds NO new arithmetic. It exists
 * to give the multi-occurrence feature its OWN explicit, named, separately
 * pinned contract -- `evaluateNewOccurrenceEligibility` -- so a later PR can
 * wire ONE clearly-documented call instead of reaching back into R2's
 * original, differently-framed API, and so THIS exact decision (capacity
 * for a FURTHER occurrence, independent of any already-live one) has its
 * own regression suite that cannot silently drift from the base formula.
 *
 * NOT WIRED ANYWHERE (PR 1's own scope). No production read or write path
 * imports this module yet. `materializeGoalActivityRhythmOccurrence`
 * (db.ts) and `loadCandidateGoalActivitiesForRhythmDemand` (db.ts) are
 * UNCHANGED and still enforce the existing single-live-link rule -- this
 * module does not relax, replace or shadow that guard; it only establishes,
 * ahead of time, the decision a LATER PR may choose to wire in instead.
 *
 * NEVER READS GoalActivity.plannedActivityId, a Plan id, or any linkage
 * concept -- by construction, since its only input is the same
 * `GoalActivityRhythmEligibilityInput` shape R2 already defined (rhythm +
 * planning date + the occurrence ledger's own facts). This is the one
 * property this module exists to GUARANTEE, not merely document: "a single
 * live occurrence can never, by itself, exhaust the capacity for another"
 * is enforced structurally by never giving this function a way to even see
 * which (if any) occurrence is "the live one."
 *
 * PURE: no I/O, no clock, no database, no environment. Deterministic;
 * never mutates its input.
 */

import { computeGoalActivityRhythmEligibility, type GoalActivityRhythmEligibilityInput, type GoalActivityRhythmEligibilityResult } from './goalActivityRhythm';

/** Identical input shape to R2's own eligibility input -- the occurrence
 * ledger (every known fact, any week; this function's own callee filters to
 * the relevant week) plus the Rhythm policy and the planning date. No
 * additional field exists, and in particular none for "the current single
 * link's status" -- there is no such concept here. */
export type NewOccurrenceEligibilityInput = GoalActivityRhythmEligibilityInput;

export interface NewOccurrenceEligibilityResult {
  /** True iff a FURTHER occurrence -- in addition to however many are
   * already COMMITTED (UPCOMING) or COMPLETED this week -- may be created.
   * Exactly `remainingOccurrences > 0`; never anything else. */
  eligible: boolean;
  /** Weekly capacity remaining for a further occurrence, after every
   * already-known COMPLETED and COMMITTED occurrence this week (however
   * many there are -- zero, one, or several) has already been subtracted.
   * Never negative. */
  remainingOccurrences: number;
  /** Passed through verbatim from the same underlying computation, for a
   * caller that wants to present weekly progress without a second counting
   * implementation (same provenance guarantee R2's own result already
   * makes). */
  completedThisWeek: number;
  committedThisWeek: number;
}

/**
 * THE multi-occurrence decision: may Aura create ANOTHER occurrence right
 * now, given every occurrence fact already on record for this week
 * (regardless of how many of them are already live/UPCOMING)?
 *
 * A direct, unmodified delegation to `computeGoalActivityRhythmEligibility`
 * -- this function adds no formula of its own. What it adds is the
 * guarantee, enforced by its own narrower input type and this module's own
 * architecture guard, that nothing resembling "is there already exactly one
 * live occurrence" can ever reach this decision: the ONLY facts that can
 * ever influence it are the occurrence ledger's own COMPLETED/COMMITTED
 * counts against the weekly target.
 */
export function evaluateNewOccurrenceEligibility(input: NewOccurrenceEligibilityInput): NewOccurrenceEligibilityResult {
  const result: GoalActivityRhythmEligibilityResult = computeGoalActivityRhythmEligibility(input);
  return { eligible: result.eligible, remainingOccurrences: result.remainingOccurrences, completedThisWeek: result.completedThisWeek, committedThisWeek: result.committedThisWeek };
}
