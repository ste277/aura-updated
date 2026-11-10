import { computeSolarEphemeris } from '../../../packages/astronomy/src/ephemeris';
import { computePanchangWindows, evaluatePanchangOverlap, getActiveWindow, SolarWindowType, WeekdayIndex } from '../../../packages/panchang/src/windows';
import { getDatePartsInTimezone } from '../../../packages/panchang/src/localDate';
import { resolveTzOffsetMinutes, getMinuteOfDayInTimezone } from './timezone';

/**
 * Insights Correctness + Historical Integrity V1 -- resolves the canonical
 * solar/Panchang window active at an ARBITRARY historical instant, for a
 * given Timing Location. This is the exact same
 * computeSolarEphemeris -> computePanchangWindows -> getActiveWindow
 * pipeline apps/web/app/page.tsx's own windows/activeType computation
 * already uses for "today" -- generalized here to any date so a habit log's
 * activeWindow can be computed correctly server-side for ANY logTimestamp
 * (live "now" or backdated), not just the current day. No new Panchang/
 * solar-window math is introduced: this only composes the same primitives
 * packages/panchang/src/panchangDay.ts's getPanchangForDate() already
 * composes for its own (different) purpose, plus the same
 * resolveTzOffsetMinutes/getMinuteOfDayInTimezone helpers
 * apps/web/lib/useCurrentMinuteOfDay.ts already uses for the live "current
 * minute of day" reading.
 *
 * PANCH-OVERLAP-01-I1 -- PD-05: the overlap precedence between
 * simultaneously-active windows (e.g. Abhijit vs. Rahu Kalam) previously
 * followed getActiveWindow()'s own array-order-first-match, which silently
 * preferred Abhijit on every weekday it geometrically overlaps a
 * commencement-caution window (see issue #331) -- causing a habit logged
 * during that overlap to be stored (and later counted by Insights) as a
 * SUPPORTIVE Abhijit log, never acknowledging the caution it was actually
 * also inside. Now uses evaluatePanchangOverlap(), the SAME shared policy
 * Timing Search's resolveOverlappingCandidate() is built on, and stores the
 * caution window's type instead whenever one overlaps -- otherwise
 * byte-identical to before (evaluatePanchangOverlap's non-overlap result is
 * always the same single window getActiveWindow() alone would return).
 *
 * This change is PROSPECTIVE ONLY, by construction: both call sites
 * (apps/web/app/api/habit-logs/route.ts, apps/web/lib/
 * planCompletionHistory.ts) invoke this function once, at write time, to
 * compute a value that is then PERSISTED into HabitLog.activeWindow /
 * PlannedActivity's completion record -- never recomputed from this
 * function on a later read. An already-stored row keeps whatever value was
 * written at the time, forever; only a NEW write after this change is
 * affected. No migration, no backfill, no historical reinterpretation.
 */
export function resolveHistoricalActiveWindow(
  logTimestamp: Date,
  latitude: number,
  longitude: number,
  timezone: string
): SolarWindowType {
  const { year, month, day, weekday } = getDatePartsInTimezone(timezone, logTimestamp);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, logTimestamp);
  const solar = computeSolarEphemeris({ year, month, day, latitude, longitude, tzOffsetMinutes });
  const windows = computePanchangWindows(solar, weekday as WeekdayIndex);
  const minuteOfDay = getMinuteOfDayInTimezone(timezone, logTimestamp);
  const overlap = evaluatePanchangOverlap(windows, minuteOfDay);
  if (overlap.commencementCaution && overlap.primaryCautionWindow) {
    return overlap.primaryCautionWindow.type;
  }
  // Non-overlap case: byte-identical to the original getActiveWindow() call
  // (evaluatePanchangOverlap's activeWindows[0] in the no-caution case is
  // always the same first-match window getActiveWindow() would return).
  return getActiveWindow(windows, minuteOfDay);
}
