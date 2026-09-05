import { computeSolarEphemeris } from '../../../packages/astronomy/src/ephemeris';
import { computePanchangWindows, getActiveWindow, SolarWindowType, WeekdayIndex } from '../../../packages/panchang/src/windows';
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
 * The overlap precedence between simultaneously-active windows (e.g.
 * Abhijit vs. Rahu Kalam) is entirely governed by getActiveWindow()'s own
 * existing, unmodified ordering -- this function never reimplements or
 * second-guesses that precedence.
 *
 * Uses ONLY the Timing Location (latitude/longitude/timezone) supplied by
 * the caller -- never Birth Location, never Event Location, never
 * SavedPerson/SHARED context. An ordinary owner activity log is always
 * evaluated against the owner's own Timing Location, exactly as live
 * logging already does.
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
  return getActiveWindow(windows, minuteOfDay);
}
