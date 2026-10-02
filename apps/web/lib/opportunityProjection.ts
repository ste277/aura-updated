/**
 * Opportunity Scarcity V1 -- O1: the pure, generic opportunity
 * projection engine.
 *
 * For ONE candidate with a known duration, decides for each local
 * calendar day in an explicitly supplied inclusive horizon whether the
 * candidate could fit, and aggregates those day-level results into
 * factual counts.
 *
 * FACTS ONLY. This module states what is known about scheduling
 * feasibility; it never decides what that means. It produces counts and
 * states and nothing evaluative.
 *
 * PURE: synchronous, deterministic, no I/O, no clock (the caller
 * supplies `now`), no randomness, and no dependence on the process
 * timezone. It does not load availability or blockers -- it consumes
 * already-resolved, generic day inputs. Converting a weekly schedule or
 * stored plans into those inputs (including local-wall-time to instant
 * conversion, and therefore any DST handling) is the caller's concern.
 *
 * SOURCE-NEUTRAL: it knows nothing about where the candidate came from
 * or why a horizon ends where it does. It does not receive a required
 * count, so "how many days could this fit" stays independent of "how
 * many times must it happen".
 *
 * OPPORTUNITY UNIT: one local calendar day contributes at most one
 * viable opportunity. Start minutes, number of windows, and free-minute
 * capacity are deliberately not counted.
 *
 * THREE-STATE DAYS: KNOWN_FEASIBLE, KNOWN_INFEASIBLE, and UNKNOWN are
 * structurally distinct. A day whose availability is not supplied is
 * UNKNOWN, never infeasible; a day known to have no usable time is
 * KNOWN_INFEASIBLE, never unknown.
 *
 * ELAPSED DAYS: a day earlier than the local date of `now` has no
 * remaining opportunity. It is KNOWN_INFEASIBLE unconditionally -- never
 * UNKNOWN, never feasible -- whatever availability or windows were
 * supplied for it, because the local date label (not the supplied
 * instants) decides whether a day has elapsed. It still counts toward
 * `evaluatedDays` but toward neither `viableDays` nor `unknownDays`, so an
 * elapsed day never adds uncertainty. The local date of `now` is clipped
 * so only time after `now` counts; later days are evaluated in full.
 *
 * CANDIDATE-LOCAL: one candidate at a time, against the supplied
 * blockers only. Two candidates that each fit the same single window
 * are each reported as viable for that day; this is feasibility for
 * one candidate, not an allocation of shared capacity.
 *
 * Timing quality plays no role: existence of an opportunity is a
 * scheduling-feasibility question only.
 */

import { normalizeBlockedIntervals, type BlockedInterval } from './dayCapacity';
import { validateEstimatedDurationMinutes, type ConstructionWindow } from './dayIntent';
import { addDaysToDateStr, getDatePartsInTimezone } from './timezone';
import { isValidCalendarDateString } from '../../../packages/panchang/src/localDate';

export type OpportunityDayState = 'KNOWN_FEASIBLE' | 'KNOWN_INFEASIBLE' | 'UNKNOWN';

/** An absolute-instant span. */
export interface OpportunityInterval {
  start: Date;
  end: Date;
}

/**
 * What is known about one day's usable time. `UNKNOWN` means availability
 * could not be established. `KNOWN` with an empty `windows` array means
 * availability IS established and contains no usable time.
 */
export type DayAvailabilityInput = { kind: 'UNKNOWN' } | { kind: 'KNOWN'; windows: readonly OpportunityInterval[] };

export interface OpportunityProjectionInput {
  /** First local civil date of the horizon (YYYY-MM-DD), inclusive. */
  planningDate: string;
  /** Last local civil date of the horizon (YYYY-MM-DD), inclusive. */
  horizonEndDate: string;
  /** Resolved candidate duration, a positive whole number of minutes. */
  durationMinutes: number;
  /** IANA timezone used to decide which local date `now` falls on. */
  timezone: string;
  /** The explicit reference instant; no other clock is ever read. */
  now: Date;
  /** Per-date availability. A date with no entry is UNKNOWN. Entries
   * outside the horizon are ignored. */
  availabilityByDate: ReadonlyMap<string, DayAvailabilityInput>;
  /** Generic active blockers (any source tag is ignored). */
  blockers: readonly BlockedInterval[];
}

export type OpportunityCoverage = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN';

/**
 * Aggregate facts. `viableDays` is a LOWER BOUND whenever
 * `coverage !== 'COMPLETE'`: the true number of viable days lies within
 * `[viableDays, viableDays + unknownDays]`. The count of days known to
 * be infeasible is `evaluatedDays - viableDays - unknownDays` and is
 * deliberately not stored separately.
 *
 * Coverage describes missing information, not probabilistic confidence:
 *   COMPLETE -- no evaluated day is UNKNOWN.
 *   PARTIAL  -- some, but not all, evaluated days are UNKNOWN.
 *   UNKNOWN  -- every evaluated day is UNKNOWN (this does not mean zero
 *               true opportunities).
 */
export interface OpportunityFacts {
  horizonStartDate: string;
  horizonEndDate: string;
  evaluatedDays: number;
  viableDays: number;
  unknownDays: number;
  coverage: OpportunityCoverage;
}

export interface OpportunityDayResult {
  date: string;
  state: OpportunityDayState;
}

export type OpportunityProjectionErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_HORIZON'
  | 'HORIZON_TOO_LONG'
  | 'INVALID_DURATION'
  | 'INVALID_TIMEZONE'
  | 'INVALID_NOW'
  | 'MALFORMED_INTERVAL';

export type OpportunityProjectionResult =
  | { status: 'OK'; facts: OpportunityFacts; days: readonly OpportunityDayResult[] }
  | { status: 'INVALID_INPUT'; code: OpportunityProjectionErrorCode };

/** A defensive bound on horizon length so a malformed range can never
 * cause an unbounded loop. Not a product limit. */
export const MAX_PROJECTION_HORIZON_DAYS = 366;

const MS_PER_MINUTE = 60000;

/**
 * Accepts exactly the timezone identifiers the canonical date helpers
 * (`getDatePartsInTimezone`, `localDateTimeToUTC`) can resolve: anything
 * `Intl.DateTimeFormat` accepts, including 'UTC' and 'Etc/UTC'. This is
 * deliberately NOT `isValidIanaTimezone`, which is a user-input form
 * validator that additionally requires an Area/Location shape; the
 * planning stack itself only needs a zone it can resolve.
 */
function isSupportedTimezone(timezone: unknown): timezone is string {
  if (typeof timezone !== 'string' || !timezone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function isValidInstant(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isWellFormedInterval(interval: { start: unknown; end: unknown }): boolean {
  return isValidInstant(interval.start) && isValidInstant(interval.end) && interval.end.getTime() >= interval.start.getTime();
}

/** Sorts a COPY by start and merges overlapping or touching spans, so a
 * fit that spans two touching windows is seen as one contiguous span.
 * Never mutates its input. */
function mergeIntervals(intervals: readonly OpportunityInterval[]): OpportunityInterval[] {
  const sorted = intervals.map((interval) => ({ start: interval.start, end: interval.end })).sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: OpportunityInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && interval.start.getTime() <= last.end.getTime()) {
      if (interval.end.getTime() > last.end.getTime()) last.end = interval.end;
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/** True when some contiguous span of `window` not covered by a blocker is
 * at least `durationMs` long. Blocker clipping/merging reuses the
 * canonical `normalizeBlockedIntervals`. */
function windowFitsDuration(window: OpportunityInterval, date: string, timezone: string, blockers: readonly BlockedInterval[], durationMs: number): boolean {
  if (window.end.getTime() <= window.start.getTime()) return false;
  const constructionWindow: ConstructionWindow = { date, start: window.start, end: window.end, timezone, source: 'EXPLICIT_RANGE' };
  const merged = normalizeBlockedIntervals(blockers, constructionWindow);
  let cursor = window.start.getTime();
  for (const blocker of merged) {
    if (blocker.start.getTime() - cursor >= durationMs) return true;
    cursor = Math.max(cursor, blocker.end.getTime());
  }
  return window.end.getTime() - cursor >= durationMs;
}

function evaluateDay(
  date: string,
  todayLocal: string,
  availability: DayAvailabilityInput | undefined,
  now: Date,
  timezone: string,
  blockers: readonly BlockedInterval[],
  durationMs: number
): OpportunityDayState {
  // The civil-date relation is decided FIRST, so nothing supplied for an
  // elapsed day (missing availability, windows, blockers) can change its
  // result.
  if (date < todayLocal) return 'KNOWN_INFEASIBLE';
  if (!availability || availability.kind === 'UNKNOWN') return 'UNKNOWN';
  const clipAtNow = date === todayLocal;

  const usable: OpportunityInterval[] = [];
  for (const window of mergeIntervals(availability.windows)) {
    if (clipAtNow) {
      if (window.end.getTime() <= now.getTime()) continue; // elapsed entirely
      usable.push({ start: window.start.getTime() < now.getTime() ? now : window.start, end: window.end });
    } else {
      usable.push(window);
    }
  }

  for (const window of usable) {
    if (windowFitsDuration(window, date, timezone, blockers, durationMs)) return 'KNOWN_FEASIBLE';
  }
  return 'KNOWN_INFEASIBLE';
}

/**
 * Projects opportunity facts for one candidate over an inclusive civil-
 * date horizon. Deterministic for identical inputs; never mutates them.
 *
 * Days before the local date of `now` are KNOWN_INFEASIBLE; the local
 * date of `now` is clipped so elapsed time never counts; later days are
 * not clipped.
 */
export function projectOpportunityFacts(input: OpportunityProjectionInput): OpportunityProjectionResult {
  const { planningDate, horizonEndDate, durationMinutes, timezone, now, availabilityByDate, blockers } = input;

  if (typeof planningDate !== 'string' || typeof horizonEndDate !== 'string' || !isValidCalendarDateString(planningDate) || !isValidCalendarDateString(horizonEndDate)) {
    return { status: 'INVALID_INPUT', code: 'INVALID_DATE' };
  }
  if (horizonEndDate < planningDate) return { status: 'INVALID_INPUT', code: 'INVALID_HORIZON' };
  try {
    validateEstimatedDurationMinutes(durationMinutes);
  } catch {
    return { status: 'INVALID_INPUT', code: 'INVALID_DURATION' };
  }
  if (!isSupportedTimezone(timezone)) return { status: 'INVALID_INPUT', code: 'INVALID_TIMEZONE' };
  if (!isValidInstant(now)) return { status: 'INVALID_INPUT', code: 'INVALID_NOW' };
  if (!blockers.every(isWellFormedInterval)) return { status: 'INVALID_INPUT', code: 'MALFORMED_INTERVAL' };

  const dates: string[] = [];
  for (let date = planningDate; date <= horizonEndDate; date = addDaysToDateStr(date, 1)) {
    dates.push(date);
    if (dates.length > MAX_PROJECTION_HORIZON_DAYS) return { status: 'INVALID_INPUT', code: 'HORIZON_TOO_LONG' };
  }

  for (const date of dates) {
    const availability = availabilityByDate.get(date);
    if (availability && availability.kind === 'KNOWN' && !availability.windows.every(isWellFormedInterval)) {
      return { status: 'INVALID_INPUT', code: 'MALFORMED_INTERVAL' };
    }
  }

  const todayLocal = getDatePartsInTimezone(timezone, now).dateStr;
  const durationMs = durationMinutes * MS_PER_MINUTE;
  const days: OpportunityDayResult[] = dates.map((date) => ({
    date,
    state: evaluateDay(date, todayLocal, availabilityByDate.get(date), now, timezone, blockers, durationMs),
  }));

  const viableDays = days.filter((day) => day.state === 'KNOWN_FEASIBLE').length;
  const unknownDays = days.filter((day) => day.state === 'UNKNOWN').length;
  const coverage: OpportunityCoverage = unknownDays === 0 ? 'COMPLETE' : unknownDays === days.length ? 'UNKNOWN' : 'PARTIAL';

  return {
    status: 'OK',
    facts: { horizonStartDate: planningDate, horizonEndDate, evaluatedDays: days.length, viableDays, unknownDays, coverage },
    days,
  };
}
