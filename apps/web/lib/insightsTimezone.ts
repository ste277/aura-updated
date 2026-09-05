import { getDatePartsInTimezone, getMinuteOfDayInTimezone, addDaysToDateStr } from './timezone';

/**
 * Insights Timezone Consistency V1 -- the shared, timezone-aware
 * normalization primitives every Insights calendar/daypart calculation
 * (server route, InsightsView.tsx) must go through, replacing ad-hoc
 * browser-local `new Date().getFullYear()/getMonth()/getDate()/getHours()`
 * calls and UTC `.toISOString().slice(0,10)` calls with a single, tested
 * implementation.
 *
 * This module answers ONE question: "what calendar day / clock daypart
 * does this absolute instant belong to, in a given (current) Timing
 * Location timezone?" -- always derived on demand from `HabitLog.
 * logTimestamp` (a real instant) + the CALLER-SUPPLIED timezone (always
 * the owner's CURRENT `user.timezone`, per the approved Option A temporal
 * model). It never reads or infers a timezone itself, and never touches
 * `HabitLog.activeWindow`, which answers a different, already-solved
 * question ("what Panchang/solar window was active when this was
 * logged?", a frozen historical snapshot from PR #75) that this module
 * does not recompute, extend, or unify with.
 *
 * All calendar-day stepping goes through addDaysToDateStr() (pure
 * "YYYY-MM-DD" string arithmetic, apps/web/lib/timezone.ts) rather than
 * `24*60*60*1000` millisecond arithmetic, so results stay correct across a
 * DST transition -- a real local calendar day can be 23, 24, or 25 hours
 * long, but a date STRING has no time-of-day component to be thrown off by
 * that.
 */

export type InsightsDayPart = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NIGHT';

export interface InsightsObservation {
  /** "YYYY-MM-DD" calendar date this instant falls on, in the given timezone. */
  dateKey: string;
  /** 0-1439 minute-of-day this instant falls on, in the given timezone. */
  minuteOfDay: number;
  /** Clock-hour daypart bucket -- a distinct concept from a Panchang solar
   * window (Abhijit/Rahu/etc.); see classifyDayPart()'s own doc comment. */
  dayPart: InsightsDayPart;
}

/**
 * Clock-hour daypart classification, preserving the exact pre-existing
 * boundaries (previously computed from `new Date(loggedAt).getHours()` in
 * InsightsView.tsx, unchanged here -- only the timezone source changes,
 * not the boundaries themselves):
 *
 *   MORNING   05:00 (300) <= minute < 12:00 (720)
 *   AFTERNOON 12:00 (720) <= minute < 17:00 (1020)
 *   EVENING   17:00 (1020) <= minute < 22:00 (1320)
 *   NIGHT     everything else (22:00-04:59, wrapping past midnight)
 *
 * This is deliberately a plain clock-hour bucket, NOT a Panchang solar
 * window -- "morning" and "Abhijit"/"Rahu Kalam"/etc. remain separate
 * concepts, exactly as they already are throughout the rest of the app.
 */
export function classifyDayPart(minuteOfDay: number): InsightsDayPart {
  if (minuteOfDay >= 300 && minuteOfDay < 720) return 'MORNING';
  if (minuteOfDay >= 720 && minuteOfDay < 1020) return 'AFTERNOON';
  if (minuteOfDay >= 1020 && minuteOfDay < 1320) return 'EVENING';
  return 'NIGHT';
}

/**
 * The one normalization entry point: given an absolute instant and a
 * timezone, returns its Timing-Location-derived calendar date, minute-of-
 * day, and daypart -- composed entirely from the existing canonical
 * getDatePartsInTimezone()/getMinuteOfDayInTimezone() primitives (no new
 * timezone math), never from `instant.getFullYear()`/`getHours()`/etc.
 * (which would read the executing process/browser's own local timezone,
 * not the caller-supplied one).
 */
export function toInsightsObservation(instant: Date, timezone: string): InsightsObservation {
  const dateKey = getDatePartsInTimezone(timezone, instant).dateStr;
  const minuteOfDay = getMinuteOfDayInTimezone(timezone, instant);
  return { dateKey, minuteOfDay, dayPart: classifyDayPart(minuteOfDay) };
}

/** "Today"'s calendar date ("YYYY-MM-DD") in the given timezone, for the
 * given current instant. The one definition of "today" every Insights
 * concept (This Month, past 7 days, 30-day heatmap, streak) is built on. */
export function todayDateKey(timezone: string, now: Date): string {
  return getDatePartsInTimezone(timezone, now).dateStr;
}

/**
 * The `count` most recent calendar dates in `timezone`, ending at (and
 * including) "today" -- e.g. count=7 returns today and the previous 6
 * calendar dates, oldest first. Built entirely from addDaysToDateStr()'s
 * pure date-string stepping, never millisecond arithmetic, so a DST
 * transition anywhere in the range cannot skip or duplicate a calendar day.
 */
export function lastNCalendarDateKeys(timezone: string, now: Date, count: number): string[] {
  const today = todayDateKey(timezone, now);
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    keys.push(addDaysToDateStr(today, -i));
  }
  return keys;
}

/** True if a "YYYY-MM-DD" dateKey falls within the given calendar year
 * (full 4-digit) and month (1-12) -- a plain string-component comparison,
 * never a re-parsed Date object (which would risk re-introducing an
 * implicit-timezone bug on the very value this module exists to keep
 * timezone-explicit). */
export function isInCalendarMonth(dateKey: string, year: number, month: number): boolean {
  const [y, m] = dateKey.split('-').map(Number);
  return y === year && m === month;
}
