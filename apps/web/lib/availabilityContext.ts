/**
 * Availability Context V1 -- PR H1: pure availability resolution.
 *
 * ARCHITECTURAL BOUNDARY (architecture audit's own section 15/37/55):
 * this file is a PURE domain/resolution layer -- no DB import, no fetch,
 * no `pool.query`, no provider-specific type or string (no "Google
 * Calendar"/"HealthKit"/etc. anywhere). It never reads a clock itself
 * (`now` is always an explicit input) and never touches
 * `next/server`/React. `dayConstructorOrchestrator.ts` is responsible
 * for loading a user's real `AvailabilityConfiguration` (db.ts) and
 * handing it to `resolveAvailability` below -- this module has no idea
 * that a database exists.
 *
 * WHAT THIS FILE DOES NOT CHANGE (architecture audit's own section 38/56,
 * confirmed by direct evidence, not merely argued): `dayConstructor.ts`'s
 * pure placement engine and `dayCapacity.ts`'s capacity math already
 * consume exactly ONE `ConstructionWindow` + a `BlockedInterval[]`, and
 * `normalizeBlockedIntervals` (dayCapacity.ts) already clips/merges an
 * arbitrary blocker list against one window with zero changes needed.
 * This file's only job is turning a set of POSITIVE usable-window facts
 * into that SAME existing negative (outer-window-minus-blockers) shape,
 * immediately before `dayConstructor.ts` ever runs -- it never
 * introduces a second window concept downstream.
 */

import { localDateTimeToUTC, getDatePartsInTimezone } from './timezone';
import type { ConstructionWindow } from './dayIntent';
import type { BlockedInterval } from './dayCapacity';

// ============================================================
// Weekday (architecture audit's own section 14) -- 0=Sunday..6=Saturday,
// the SAME `Date.UTC(...).getUTCDay()` convention `planDayEntry.ts`'s own
// `resolveThisWeekDeadline` (Intent Fidelity V1 PR G3/G4) already
// established in this exact codebase for weekday arithmetic -- reused
// for consistency, not reinvented.
// ============================================================

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Pure calendar-arithmetic weekday of a `YYYY-MM-DD` civil date string --
 * `Date.UTC` used only as calendar-math scratch space (explicit y/m/d
 * input), never a clock read. Timezone-agnostic by design: a civil date
 * string has no time-of-day component, so its weekday is the same
 * regardless of which IANA zone it is ultimately interpreted in. */
export function getWeekdayForDateStr(dateStr: string): Weekday {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;
}

const VALID_TIME_STR = /^([01]\d|2[0-3]):[0-5]\d$/;

// ============================================================
// Raw period input + validation (architecture audit's own section 16).
// Mirrors dayIntent.ts's own `validateDayIntentDateStr`/
// `validateEstimatedDurationMinutes` convention: pure, REJECTS (throws),
// never silently coerces or clamps. No cross-midnight period is ever
// accepted -- "20:00"-"01:00" is rejected outright (start < end fails
// lexically for correctly zero-padded HH:mm strings), never
// automatically split into two periods.
// ============================================================

export interface AvailabilityPeriodInput {
  weekday: Weekday;
  /** "HH:mm", 24h, civil to whichever `timezone` the caller later
   * resolves it against -- this type carries no timezone of its own
   * (User.timezone remains the single authority, architecture audit's
   * own section 17/23). */
  startTime: string;
  endTime: string;
}

/** Throws a deterministic Error on any invalid field -- never silently
 * drops/clamps/splits. Returns the input unchanged (never mutated) on
 * success. */
export function validateAvailabilityPeriodInput(period: AvailabilityPeriodInput): AvailabilityPeriodInput {
  if (!Number.isInteger(period.weekday) || period.weekday < 0 || period.weekday > 6) {
    throw new Error(`AvailabilityPeriodInput.weekday must be an integer 0-6 (Sunday=0), got: ${period.weekday}.`);
  }
  if (typeof period.startTime !== 'string' || !VALID_TIME_STR.test(period.startTime)) {
    throw new Error(`AvailabilityPeriodInput.startTime must be a valid "HH:mm" 24h time, got: "${period.startTime}".`);
  }
  if (typeof period.endTime !== 'string' || !VALID_TIME_STR.test(period.endTime)) {
    throw new Error(`AvailabilityPeriodInput.endTime must be a valid "HH:mm" 24h time, got: "${period.endTime}".`);
  }
  if (period.startTime >= period.endTime) {
    throw new Error(`AvailabilityPeriodInput must have startTime before endTime (no cross-midnight period in V1), got: "${period.startTime}"-"${period.endTime}".`);
  }
  return period;
}

// ============================================================
// Configuration + resolution result (architecture audit's own section
// 34/35/54, LOCKED by this ticket's own section 4/6).
//
// `configured: false` (or configured with zero periods across the
// entire saved week) is the ONLY honest way to represent "no schedule
// saved at all" -- see `AvailabilityConfiguration.configured`'s own doc
// comment for the exact UNCONFIGURED-vs-CONFIGURED_EMPTY distinction
// this whole file exists to preserve.
// ============================================================

export interface AvailabilityConfiguration {
  /** `false` means the user has never saved an availability
   * configuration at all (db.ts's `User.availabilityConfigured`,
   * defaulted to `false` for every existing user by migration --
   * architecture audit's own section 54/83). `true` means a real
   * configuration exists, even if `periods` happens to be empty or has
   * no rows for the specific weekday being resolved -- that is the
   * CONFIGURED_EMPTY case (section 55), never collapsed into
   * UNCONFIGURED. */
  configured: boolean;
  /** Every saved period, across every weekday -- `resolveAvailability`
   * itself filters to the relevant weekday. Order is never significant
   * (section 49: row-order independence). */
  periods: readonly AvailabilityPeriodInput[];
}

export type AvailabilityResolution =
  | { status: 'UNCONFIGURED' }
  | { status: 'CONFIGURED'; usableWindows: { start: Date; end: Date }[] };

/** Sorts by start, merges overlapping AND touching windows into the
 * smallest disjoint set (the SAME merge philosophy
 * `normalizeBlockedIntervals`, dayCapacity.ts, already uses for
 * blockers -- reproduced here at a smaller scope, since this step has no
 * outer window to clip against yet, so `normalizeBlockedIntervals`
 * itself does not apply, per this ticket's own section 23 "do not
 * duplicate normalizeBlockedIntervals"). Never mutates its input. */
function mergeUsableWindows(windows: readonly { start: Date; end: Date }[]): { start: Date; end: Date }[] {
  const sorted = [...windows].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: { start: Date; end: Date }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start.getTime() <= last.end.getTime()) {
      if (w.end.getTime() > last.end.getTime()) last.end = w.end;
    } else {
      merged.push({ start: w.start, end: w.end });
    }
  }
  return merged;
}

/**
 * The single pure entry point (architecture audit's own section 36/54).
 * `now` is always required (even for a future `targetDate`) so this
 * function can determine, on its own and without a second clock read
 * anywhere else, whether `targetDate` IS the caller's current civil day
 * -- clipping only ever applies in that one case (section 10/11/25/26).
 * A past `targetDate` is treated identically to a future one (never
 * clipped) -- see this file's own module doc comment / the accompanying
 * report's own section 28 for why: today's existing REMAINING_TODAY
 * path has no deliberate past-date policy of its own (a past date
 * already fails closed there via ordinary start>=end validation, an
 * emergent property, not a designed rule) -- this function introduces no
 * NEW policy, it only generalizes "clip exclusively when targetDate is
 * today" uniformly to every non-today date, past or future alike.
 */
export function resolveAvailability(input: { targetDate: string; timezone: string; now: Date; configuration: AvailabilityConfiguration }): AvailabilityResolution {
  const { targetDate, timezone, now, configuration } = input;
  if (!configuration.configured) return { status: 'UNCONFIGURED' };

  const weekday = getWeekdayForDateStr(targetDate);
  const periodsForWeekday = configuration.periods.filter((period) => period.weekday === weekday);

  const rawWindows = periodsForWeekday.map((period) => ({
    start: localDateTimeToUTC(targetDate, period.startTime, timezone),
    end: localDateTimeToUTC(targetDate, period.endTime, timezone),
  }));

  const merged = mergeUsableWindows(rawWindows);

  const isTargetDateToday = targetDate === getDatePartsInTimezone(timezone, now).dateStr;
  if (!isTargetDateToday) return { status: 'CONFIGURED', usableWindows: merged };

  const clipped: { start: Date; end: Date }[] = [];
  for (const window of merged) {
    if (window.end.getTime() <= now.getTime()) continue; // elapsed entirely -- dropped.
    const start = window.start.getTime() < now.getTime() ? now : window.start; // straddles now -- clip start.
    clipped.push({ start, end: window.end });
  }
  return { status: 'CONFIGURED', usableWindows: clipped };
}

// ============================================================
// Constructor-facing normalization (architecture audit's own section
// 23/56, LOCKED by this ticket's own section 21/22/23).
// ============================================================

/**
 * usableWindows -> ONE outer ConstructionWindow + AVAILABILITY_GAP
 * blockers for the gaps BETWEEN usable sub-windows. `ConstructDayInput.
 * window` stays a single `ConstructionWindow` -- never an array (this
 * ticket's own section 21: "Do not change ConstructDayInput.window to
 * an array"). `source: 'REMAINING_TODAY'` is reused verbatim on the
 * outer window -- this ticket's own section 22 authorizes exactly ONE
 * new domain-level addition (`BlockedIntervalSource.AVAILABILITY_GAP`),
 * not a new `ConstructionWindowSource` value, so `dayIntent.ts`'s own
 * `ConstructionWindowSource` type stays completely untouched.
 *
 * PRECONDITION: `usableWindows` must be the already-sorted, already-
 * merged (disjoint) output of `resolveAvailability` above -- this
 * function does not re-sort or re-merge; a caller passing a raw,
 * unmerged list would get an incorrect outer span/gap set. Returns
 * `null` for an empty list (the caller's own responsibility to report
 * `NO_USABLE_CAPACITY` directly, without ever calling this function --
 * this ticket's own section 28: never fabricate a zero-length window).
 */
export function normalizeUsableWindowsToConstructionWindow(
  usableWindows: readonly { start: Date; end: Date }[],
  date: string,
  timezone: string
): { window: ConstructionWindow; gapBlockers: BlockedInterval[] } | null {
  if (usableWindows.length === 0) return null;

  const window: ConstructionWindow = {
    date,
    start: usableWindows[0].start,
    end: usableWindows[usableWindows.length - 1].end,
    timezone,
    source: 'REMAINING_TODAY',
  };

  const gapBlockers: BlockedInterval[] = [];
  for (let i = 0; i < usableWindows.length - 1; i += 1) {
    const gapStart = usableWindows[i].end;
    const gapEnd = usableWindows[i + 1].start;
    if (gapStart.getTime() < gapEnd.getTime()) {
      gapBlockers.push({ start: gapStart, end: gapEnd, source: 'AVAILABILITY_GAP' });
    }
  }

  return { window, gapBlockers };
}
