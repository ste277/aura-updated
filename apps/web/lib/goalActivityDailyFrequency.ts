/**
 * HPG3-A1 -- the canonical, pure domain representation of "how many LIVE
 * occurrences of this GoalActivity may exist on the SAME local calendar
 * day?" Deliberately parallel in shape to goalActivityRhythm.ts (which this
 * module is orthogonal to in meaning, not a replacement for): Rhythm
 * answers "how many occurrences per WEEK, with no day-bucket concept at
 * all"; this module answers a DAY-scoped question Rhythm's own eligibility
 * engine was explicitly never built to express (see that module's own
 * GoalActivityRhythm doc comment). A daily-frequency policy never changes
 * a Rhythm policy, and vice versa -- a GoalActivity may legitimately carry
 * both at once.
 *
 * A1 establishes the pure policy representation only. No DB access here
 * (same convention as goalActivityRhythm.ts/goalCompletion.ts). No
 * production write path creates/updates a daily-frequency policy yet, no
 * production read path consults eligibility yet, and nothing here reads or
 * writes a GoalActivityOccurrence row -- this module does not decide
 * whether a NEW occurrence may be created; it only defines what the policy
 * values mean, exactly the scope migration 0051's own doc comment
 * describes. A LATER ticket (HPG3-A2) wires enforcement.
 */

// Reuses this repository's EXISTING canonical validators for the
// scheduledLocalDate/scheduledLocalTimezone pair below -- never a second
// algorithm: isValidCivilDateString (apps/web/lib/goals.ts) already
// rejects a syntactically-shaped but calendrically-invalid date (e.g.
// "2026-02-30"); isValidIanaTimezone (apps/web/lib/timezone.ts) is the
// same canonical timezone validator every other user-facing timezone
// field in this codebase already shares.
import { isValidCivilDateString } from './goals';
import { isValidIanaTimezone } from './timezone';

// ============================================================
// Canonical vocabulary. ONCE_PER_DAY and MULTIPLE_PER_DAY are the two
// values a later ticket may enforce; CUSTOM is RESERVED -- accepted,
// validated and persisted by this module like any other kind, but never
// treated as operational (see isGoalActivityDailyFrequencyEnforceable
// below, the one pure, explicit expression of "CUSTOM must not silently
// become an enforced scheduling policy").
// ============================================================

export type GoalActivityDailyFrequencyKind = 'ONCE_PER_DAY' | 'MULTIPLE_PER_DAY' | 'CUSTOM';

export const GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS: readonly GoalActivityDailyFrequencyKind[] = ['ONCE_PER_DAY', 'MULTIPLE_PER_DAY', 'CUSTOM'];

export function isGoalActivityDailyFrequencyKind(value: unknown): value is GoalActivityDailyFrequencyKind {
  return typeof value === 'string' && (GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS as readonly string[]).includes(value);
}

/**
 * ONCE_PER_DAY: at most one live occurrence of this GoalActivity per local
 * calendar day -- the product default (this ticket's own objective), and
 * what every existing/legacy row means today (see normalizeGoalActivityDailyFrequency
 * below).
 *
 * MULTIPLE_PER_DAY: explicit permission for more than one live occurrence
 * on the same local day. No count/limit of its own -- an unbounded "more
 * than one is fine" policy (meditation, water, medication -- the examples
 * this ticket's own objective names).
 *
 * CUSTOM: reserved for a future user-defined repeat count/weekday/timing
 * policy. `limit` is an explicit positive integer when present, NEVER
 * inferred from a GoalActivity title, template category, or past
 * behavior -- if the exact number is unknown, there is no valid CUSTOM
 * policy, only the default. RESERVED means exactly that: a value this
 * module can represent and round-trip, not one any writer in this slice
 * (or, by this module's own explicit contract, any FUTURE writer without
 * first consulting isGoalActivityDailyFrequencyEnforceable) may treat as
 * active scheduling policy.
 */
export interface GoalActivityDailyFrequency {
  kind: GoalActivityDailyFrequencyKind;
  limit?: number;
}

/** The canonical, singleton ONCE_PER_DAY policy -- what every existing
 * GoalActivity means today, and what a legacy/unset row normalizes to (see
 * normalizeGoalActivityDailyFrequency below). Same precedent as
 * goalActivityRhythm.ts's own NONE_GOAL_ACTIVITY_RHYTHM. */
export const ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY: GoalActivityDailyFrequency = { kind: 'ONCE_PER_DAY' };

/**
 * Pure, explicit expression of "CUSTOM must not silently become an
 * enforced scheduling policy": the one function any future enforcement
 * code (HPG3-A2 and beyond) must consult before treating a GoalActivity's
 * daily-frequency policy as active. Returns false for CUSTOM only -- true
 * for every kind this module currently defines as operational. Adding a
 * kind to GOAL_ACTIVITY_DAILY_FREQUENCY_KINDS never automatically makes it
 * enforceable; that is always a separate, explicit decision made here.
 */
export function isGoalActivityDailyFrequencyEnforceable(kind: GoalActivityDailyFrequencyKind): boolean {
  return kind !== 'CUSTOM';
}

export type GoalActivityDailyFrequencyValidationResult = { ok: true; frequency: GoalActivityDailyFrequency } | { ok: false; error: string };

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

/**
 * Pure validation of a candidate GoalActivityDailyFrequency: rejects an
 * unrecognized kind outright (fail closed -- never defaults an unknown
 * value to ONCE_PER_DAY or any other kind here; that normalization only
 * happens for PERSISTED, possibly-legacy data, in
 * normalizeGoalActivityDailyFrequency below). ONCE_PER_DAY/MULTIPLE_PER_DAY
 * must never carry a limit; CUSTOM rejects 0, negative, fractional,
 * missing, NaN and Infinity limits outright -- never clamps, never
 * coerces, never guesses. No arbitrary maximum is imposed (no current
 * product constraint establishes one). Never throws -- callers decide what
 * an invalid result means for them, same convention as
 * validateGoalActivityRhythm/validateCompletionRequirement.
 */
export function validateGoalActivityDailyFrequency(input: { kind: unknown; limit?: unknown }): GoalActivityDailyFrequencyValidationResult {
  if (!isGoalActivityDailyFrequencyKind(input.kind)) {
    return { ok: false, error: `Unknown daily frequency kind: ${String(input.kind)}.` };
  }

  const hasLimit = input.limit !== undefined && input.limit !== null;

  if (input.kind === 'ONCE_PER_DAY' || input.kind === 'MULTIPLE_PER_DAY') {
    if (hasLimit) return { ok: false, error: `${input.kind} must not carry a dailyFrequencyLimit.` };
    return { ok: true, frequency: { kind: input.kind } };
  }

  // CUSTOM
  if (!hasLimit || !isPositiveInteger(input.limit)) {
    return { ok: false, error: 'CUSTOM requires an explicit positive integer dailyFrequencyLimit.' };
  }
  return { ok: true, frequency: { kind: 'CUSTOM', limit: input.limit } };
}

/** The exact nullable shape GoalActivity persists (two independent
 * nullable columns, no default -- see migration 0051's own doc comment). */
export interface PersistedGoalActivityDailyFrequency {
  dailyFrequencyKind: string | null;
  dailyFrequencyLimit: number | null;
}

/** Canonical -> persisted. ONCE_PER_DAY always persists as all-null
 * (identical reasoning to goalActivityRhythm.ts's own
 * toPersistedGoalActivityRhythm for NONE: there is no behavioral
 * difference between "explicitly ONCE_PER_DAY" and "never specified"). */
export function toPersistedGoalActivityDailyFrequency(frequency: GoalActivityDailyFrequency): PersistedGoalActivityDailyFrequency {
  if (frequency.kind === 'ONCE_PER_DAY') {
    return { dailyFrequencyKind: null, dailyFrequencyLimit: null };
  }
  if (frequency.kind === 'MULTIPLE_PER_DAY') {
    return { dailyFrequencyKind: 'MULTIPLE_PER_DAY', dailyFrequencyLimit: null };
  }
  return { dailyFrequencyKind: 'CUSTOM', dailyFrequencyLimit: frequency.limit ?? null };
}

/**
 * Persisted (possibly legacy/null/corrupt) -> canonical. A null/unrecognized
 * dailyFrequencyKind ALWAYS normalizes to ONCE_PER_DAY (this ticket's own
 * stated rule: "NULL normalizes to ONCE_PER_DAY") -- this covers both a
 * genuinely legacy pre-A1 row and a new row created without an explicit
 * policy, identically, on purpose: EVERY existing GoalActivity keeps
 * meaning exactly "at most one live occurrence per local day" without any
 * migration or backfill. A persisted row that fails validation (should not
 * happen via any future writer, but never trusted blindly) ALSO falls back
 * to ONCE_PER_DAY rather than surfacing a domain error or, worse,
 * defaulting to the more permissive MULTIPLE_PER_DAY. Same convention as
 * normalizeGoalActivityRhythm/normalizeGoalActivityCompletionRequirement.
 */
export function normalizeGoalActivityDailyFrequency(persisted: PersistedGoalActivityDailyFrequency): GoalActivityDailyFrequency {
  if (persisted.dailyFrequencyKind === null) return ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY;
  const result = validateGoalActivityDailyFrequency({ kind: persisted.dailyFrequencyKind, limit: persisted.dailyFrequencyLimit });
  return result.ok ? result.frequency : ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY;
}

// ============================================================
// scheduledLocalDate / scheduledLocalTimezone pair validation
// (GoalActivityOccurrence's own new columns, migration 0051).
// ============================================================

export type ScheduledLocalDatePairValidationResult =
  | { ok: true; localDate: string | null; timezone: string | null }
  | { ok: false; error: string };

/**
 * Pure validation of a candidate (scheduledLocalDate, scheduledLocalTimezone)
 * pair: both populated, or both NULL -- never one without the other (this
 * ticket's own rule, and the exact same "impossible, corrupt state" the
 * schema's own doc comment already documents for this pair, and the one
 * scheduledWeekStart/scheduledWeekTimezone already relies on). A partially
 * populated pair is REJECTED outright, never silently repaired by clearing
 * the one present field or fabricating the missing one. A populated date
 * that is syntactically shaped but calendrically invalid, or a timezone
 * that is not a real IANA zone, is rejected the same way. Never throws --
 * same convention as every other validate* function in this module. (A
 * found, pre-existing edge case in the reused isValidCivilDateString
 * itself: a regex-shaped but out-of-range value, e.g. month "13", reaches
 * an Invalid Date whose toISOString() throws a RangeError instead of that
 * function returning false -- apps/web/lib/goals.ts:398-405, not touched
 * by this slice. Caught here defensively so THIS function's own
 * never-throws contract holds regardless; see this slice's own delivery
 * notes for the upstream finding.)
 */
export function validateScheduledLocalDatePair(input: { localDate: unknown; timezone: unknown }): ScheduledLocalDatePairValidationResult {
  const hasDate = input.localDate !== undefined && input.localDate !== null;
  const hasTimezone = input.timezone !== undefined && input.timezone !== null;

  if (!hasDate && !hasTimezone) return { ok: true, localDate: null, timezone: null };
  if (hasDate !== hasTimezone) {
    return { ok: false, error: 'scheduledLocalDate and scheduledLocalTimezone must be both populated or both NULL.' };
  }

  let dateIsValid: boolean;
  try {
    dateIsValid = isValidCivilDateString(input.localDate);
  } catch {
    dateIsValid = false;
  }
  if (!dateIsValid) {
    return { ok: false, error: `Invalid scheduledLocalDate: ${String(input.localDate)}.` };
  }
  if (typeof input.timezone !== 'string' || !isValidIanaTimezone(input.timezone)) {
    return { ok: false, error: `Invalid scheduledLocalTimezone: ${String(input.timezone)}.` };
  }

  // Safe: dateIsValid is only ever true when isValidCivilDateString's own
  // type guard confirmed input.localDate is a string -- the intervening
  // try/catch above is what defeats TypeScript's own narrowing here, not
  // a genuine type uncertainty.
  return { ok: true, localDate: input.localDate as string, timezone: input.timezone };
}
