/**
 * Goals V2 Rhythm R2 -- the canonical, pure domain representation of "when
 * should another occurrence of this GoalActivity become eligible?" (G3.6
 * architecture audit, this ticket's own sections 3-22). No DB access here --
 * same convention as lib/goalCompletion.ts, which this module is
 * deliberately parallel to in shape (and orthogonal to in meaning):
 * CompletionRequirement answers "what counts as completing ONE occurrence";
 * GoalActivityRhythm answers "how often should Aura create the opportunity
 * for one." A Rhythm policy never changes a CompletionRequirement, and vice
 * versa.
 *
 * R2 establishes policy + pure eligibility only. No production write path
 * creates/updates a Rhythm policy yet, no production read path consumes
 * eligibility yet, and NOTHING here creates a GoalActivityOccurrence row --
 * eligibility is a derived ANSWER, never persisted (R1's own established
 * invariant, unchanged).
 */

import { getWeekdayForDateStr } from './availabilityContext';
import { addDaysToDateStr } from './timezone';

// ============================================================
// Canonical vocabulary (this ticket's own section 3/4) -- deliberately
// minimal. DAILY/WEEKDAYS/SPECIFIC_WEEKDAYS/AURA_DECIDES/RRULE/monthly/
// custom intervals are all explicitly OUT of scope for R2; adding any of
// them is a product decision for a later ticket, not an oversight here.
// ============================================================

export type GoalActivityRhythmKind = 'NONE' | 'N_PER_WEEK';

export const GOAL_ACTIVITY_RHYTHM_KINDS: readonly GoalActivityRhythmKind[] = ['NONE', 'N_PER_WEEK'];

export function isGoalActivityRhythmKind(value: unknown): value is GoalActivityRhythmKind {
  return typeof value === 'string' && (GOAL_ACTIVITY_RHYTHM_KINDS as readonly string[]).includes(value);
}

/**
 * NONE: this GoalActivity is finite under current behavior -- Rhythm never
 * requests another occurrence (this does NOT make an ordinary finite
 * SUGGESTED GoalActivity unplannable; it only means Rhythm has nothing to
 * add -- see computeGoalActivityRhythmEligibility's own doc comment).
 *
 * N_PER_WEEK: ongoing, aiming for `targetPerWeek` completed occurrences
 * during one user-local calendar week. `targetPerWeek` is an explicit
 * positive integer, NEVER inferred from a Goal/GoalActivity title, template
 * category, activity catalog metadata, target date, CompletionRequirement,
 * or past behavior (this ticket's own section 4) -- if the exact number is
 * unknown, there is no valid N_PER_WEEK policy, only NONE.
 */
export interface GoalActivityRhythm {
  kind: GoalActivityRhythmKind;
  targetPerWeek?: number;
}

/** The canonical, singleton NONE rhythm -- what every existing GoalActivity
 * means today, and what a legacy/unset row normalizes to (see
 * normalizeGoalActivityRhythm below). Same precedent as
 * goalCompletion.ts's own DONE_COMPLETION_REQUIREMENT. */
export const NONE_GOAL_ACTIVITY_RHYTHM: GoalActivityRhythm = { kind: 'NONE' };

export type GoalActivityRhythmValidationResult = { ok: true; rhythm: GoalActivityRhythm } | { ok: false; error: string };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/**
 * Pure validation of a candidate GoalActivityRhythm (this ticket's own
 * section 6): rejects 0, negative, fractional, missing, NaN and Infinity
 * targets outright -- never clamps, never coerces, never guesses. No
 * arbitrary maximum is imposed (no current product constraint establishes
 * one). Never throws -- callers decide what an invalid result means for
 * them, same convention as validateCompletionRequirement.
 */
export function validateGoalActivityRhythm(input: { kind: unknown; targetPerWeek?: unknown }): GoalActivityRhythmValidationResult {
  if (!isGoalActivityRhythmKind(input.kind)) {
    return { ok: false, error: `Unknown rhythm kind: ${String(input.kind)}.` };
  }

  const hasTarget = input.targetPerWeek !== undefined && input.targetPerWeek !== null;

  if (input.kind === 'NONE') {
    if (hasTarget) return { ok: false, error: 'NONE must not carry a targetPerWeek.' };
    return { ok: true, rhythm: { kind: 'NONE' } };
  }

  // N_PER_WEEK
  if (!hasTarget || !isPositiveInteger(input.targetPerWeek)) {
    return { ok: false, error: 'N_PER_WEEK requires an explicit positive integer targetPerWeek.' };
  }
  return { ok: true, rhythm: { kind: 'N_PER_WEEK', targetPerWeek: input.targetPerWeek } };
}

/** The exact nullable shape GoalActivity persists (two independent
 * nullable columns, no default -- see migration 0043's own doc comment). */
export interface PersistedGoalActivityRhythm {
  rhythmKind: string | null;
  rhythmTargetPerWeek: number | null;
}

/** Canonical -> persisted. NONE always persists as all-null (identical
 * reasoning to toPersistedCompletionRequirement: there is no behavioral
 * difference between "explicitly NONE" and "never specified"). */
export function toPersistedGoalActivityRhythm(rhythm: GoalActivityRhythm): PersistedGoalActivityRhythm {
  if (rhythm.kind === 'NONE') {
    return { rhythmKind: null, rhythmTargetPerWeek: null };
  }
  return { rhythmKind: rhythm.kind, rhythmTargetPerWeek: rhythm.targetPerWeek ?? null };
}

/**
 * Persisted (possibly legacy/null/corrupt) -> canonical. A null/unrecognized
 * rhythmKind ALWAYS normalizes to NONE (this ticket's own section 7
 * critical invariant: "unknown/corrupt persisted Rhythm must NOT silently
 * become recurrent") -- this covers both a genuinely legacy pre-R2 row and
 * a new row created without an explicit policy, identically, on purpose.
 * A persisted row that fails validation (should not happen via the one
 * future writer, but never trusted blindly) ALSO falls back to NONE rather
 * than surfacing a domain error or, worse, defaulting to some inferred
 * frequency. Same convention as normalizeGoalActivityCompletionRequirement.
 */
export function normalizeGoalActivityRhythm(persisted: PersistedGoalActivityRhythm): GoalActivityRhythm {
  if (persisted.rhythmKind === null) return NONE_GOAL_ACTIVITY_RHYTHM;
  const result = validateGoalActivityRhythm({ kind: persisted.rhythmKind, targetPerWeek: persisted.rhythmTargetPerWeek });
  return result.ok ? result.rhythm : NONE_GOAL_ACTIVITY_RHYTHM;
}

// ============================================================
// Local calendar week (this ticket's own section 10). Monday 00:00 local
// through the next Monday 00:00 local -- a NEW, explicit V1 product
// convention (this repository's existing weekday indexing,
// getWeekdayForDateStr/WEEKDAY_LABELS, numbers weekdays 0=Sunday..6=Saturday
// for DISPLAY/lookup purposes only; it establishes no prior WEEK-START
// convention to reuse, so Monday is chosen here per this ticket's own
// stated fallback preference, not inferred from stronger existing
// evidence). Deliberately a fixed calendar week, never a rolling 7-day
// window (this ticket's own section 10: a rolling window would make
// "3/week" ambiguous as time passes).
//
// Built entirely from this repository's EXISTING local-date primitives
// (getWeekdayForDateStr, addDaysToDateStr) -- no new timezone model, no
// Date-object arithmetic of its own.
// ============================================================

/** The "YYYY-MM-DD" Monday that starts the local calendar week containing
 * `localDateStr`. Pure string/date-string arithmetic -- never touches a
 * real instant or timezone itself (the caller is responsible for having
 * already derived `localDateStr` via getDatePartsInTimezone or equivalent,
 * same division of responsibility as everywhere else in this codebase). */
export function localCalendarWeekStart(localDateStr: string): string {
  const weekday = getWeekdayForDateStr(localDateStr); // 0=Sunday..6=Saturday
  const daysSinceMonday = (weekday + 6) % 7; // Monday=0, Tuesday=1, ..., Sunday=6
  return addDaysToDateStr(localDateStr, -daysSinceMonday);
}

// ============================================================
// Pure eligibility engine (this ticket's own sections 11-22). Accepts
// FACTS, never queries the DB itself (section 11) and never reads
// Date.now() (section 20) -- the caller (a future, separate read-model
// layer) is responsible for resolving `planningLocalDate` and each
// occurrence's own `localDate` via the user's real timezone BEFORE calling
// this function. This keeps the engine itself fully deterministic and
// testable with plain strings, exactly like compareTimingTiers/
// classifyPlansForRecomposition in remainingDayRecomposition.ts.
// ============================================================

/**
 * One fact about an existing, LIVE GoalActivityOccurrence (R1) -- derived
 * from its CURRENT linked PlannedActivity's own status (never from a
 * historical/MOVED-away row; an occurrence's `plannedActivityId` points at
 * exactly one live plan at a time, R1's own invariant, so a Move can never
 * produce two simultaneous facts for the same occurrence -- this ticket's
 * own section 15).
 *
 * `localDate` is the occurrence's own PlannedActivity.plannedStartAt,
 * already converted to a "YYYY-MM-DD" string in the user's real timezone by
 * the caller -- the SAME date is used for both COMPLETED and COMMITTED
 * contributions (which week an occurrence belongs to is always "the week it
 * is/was scheduled for", not "the week it happened to be logged in" --
 * these are the same instant for every current production completion path,
 * so this is a distinction without a difference today, but stated
 * explicitly so a future caller does not have to guess).
 */
export interface GoalActivityRhythmOccurrenceFact {
  localDate: string;
  contribution: 'COMPLETED' | 'COMMITTED' | 'NONE';
}

/**
 * This ticket's own section 14 audit of PlannedActivity's five statuses:
 *
 *   LOGGED      -> COMPLETED (explicit Done is the only completion truth --
 *                  never GoalActivityExecution.currentValue, never elapsed
 *                  time, this ticket's own section 18)
 *   UPCOMING    -> COMMITTED (a still-live, not-yet-done commitment that
 *                  already occupies this week's capacity -- this ticket's
 *                  own section 13 critical correction to G3.6)
 *   SKIPPED     -> NONE (a deliberate non-execution does not satisfy the
 *                  target AND must not permanently consume a weekly slot --
 *                  this ticket's own section 16; no debt carries anywhere)
 *   CANCELLED   -> NONE (same treatment as SKIPPED for Rhythm purposes --
 *                  this ticket's own section 17 default, documented here
 *                  since no stronger existing product semantics demand
 *                  otherwise)
 *   MOVED       -> NONE (a MOVED row is the OLD, no-longer-live plan a
 *                  Move repointed AWAY from; the occurrence's own current
 *                  `plannedActivityId` already points at the successor,
 *                  which produces its OWN fact from ITS OWN status -- a
 *                  MOVED row must never itself be read as a fact at all in
 *                  a correct caller, so this mapping exists only to fail
 *                  safe -- NONE, never COMMITTED -- if one ever is)
 */
export type PlannedActivityStatusForRhythm = 'UPCOMING' | 'LOGGED' | 'CANCELLED' | 'SKIPPED' | 'MOVED';

export function deriveGoalActivityRhythmContribution(status: PlannedActivityStatusForRhythm): GoalActivityRhythmOccurrenceFact['contribution'] {
  if (status === 'LOGGED') return 'COMPLETED';
  if (status === 'UPCOMING') return 'COMMITTED';
  return 'NONE'; // CANCELLED, SKIPPED, MOVED
}

export interface GoalActivityRhythmEligibilityInput {
  rhythm: GoalActivityRhythm;
  /** "YYYY-MM-DD" in the user's own timezone -- the date Aura is currently
   * planning for (today OR tomorrow; this ticket's own section 20: NEVER
   * derived from the server's own current instant inside this function). */
  planningLocalDate: string;
  /** Every known occurrence fact for this GoalActivity, from any week --
   * this function filters to the relevant week itself (this ticket's own
   * section 19: counts are week-scoped only, no debt carries across
   * weeks). */
  occurrences: readonly GoalActivityRhythmOccurrenceFact[];
}

export interface GoalActivityRhythmEligibilityResult {
  eligible: boolean;
  /** This ticket's own section 21 -- exposes remaining CAPACITY, never
   * merely a boolean, so a future caller (R3+) can decide how many
   * occurrences to actually materialize in one planning session. R2 itself
   * makes no such decision. Never negative (section 23). */
  remainingOccurrences: number;
  /** Rhythm R4 (a later, separately-authorized ticket: Goal Detail
   * presentation) -- the exact COMPLETED/COMMITTED counts already computed
   * internally below, exposed so a presentation caller can show factual
   * weekly progress WITHOUT a second counting implementation (R4's own
   * section 6 "Single Source of Truth" -- this remains the one place that
   * counts). Purely additive to this result; the eligible/remainingOccurrences
   * fields and the formula itself are completely unchanged. Always 0 for
   * NONE. */
  completedThisWeek: number;
  committedThisWeek: number;
}

/**
 * NONE -> never eligible (no Rhythm-GENERATED occurrence is ever requested;
 * this says nothing about whether an ordinary finite SUGGESTED GoalActivity
 * can still be planned through the existing, entirely separate "Plan with
 * Aura" flow -- this ticket's own section 12).
 *
 * N_PER_WEEK(N) -> remaining = max(0, N - completed - committed), where
 * completed/committed are counted ONLY among occurrence facts whose
 * `localDate` falls in the SAME local calendar week as `planningLocalDate`.
 * eligible = remaining > 0. Accounting for BOTH completed and committed
 * occurrences (not completed alone) is this ticket's own section 13
 * correction to the G3.6 audit's original, insufficient formula -- it
 * prevents repeated Home/Plan requests from claiming the same weekly
 * capacity before an already-materialized occurrence has even been
 * completed.
 */
export function computeGoalActivityRhythmEligibility(input: GoalActivityRhythmEligibilityInput): GoalActivityRhythmEligibilityResult {
  if (input.rhythm.kind === 'NONE') return { eligible: false, remainingOccurrences: 0, completedThisWeek: 0, committedThisWeek: 0 };

  const weekStart = localCalendarWeekStart(input.planningLocalDate);
  const inWeek = input.occurrences.filter((o) => localCalendarWeekStart(o.localDate) === weekStart);
  const completed = inWeek.filter((o) => o.contribution === 'COMPLETED').length;
  const committed = inWeek.filter((o) => o.contribution === 'COMMITTED').length;

  const remaining = Math.max(0, (input.rhythm.targetPerWeek ?? 0) - completed - committed);
  return { eligible: remaining > 0, remainingOccurrences: remaining, completedThisWeek: completed, committedThisWeek: committed };
}
