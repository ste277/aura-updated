/**
 * Reusable "Panchang for any local calendar date" service.
 *
 * getPanchangForDate() is the single canonical entry point for computing a
 * full day's Panchang -- solar times, all five timing windows, and the five
 * core Panchanga elements -- for ANY requested local calendar date, not just
 * "today". It exists so /api/panchang/today, the new /api/panchang date
 * route, and future features (Panchang Calendar, Muhurtham Finder) all
 * share one calculation path instead of each re-deriving dates/instants
 * their own way.
 *
 * No hidden "today" assumptions: every calculation here is driven entirely
 * by the caller-supplied `localDate` (a "YYYY-MM-DD" string) + `timezone`,
 * never by `new Date()` / the server's own clock or timezone. The one
 * exception is the optional `referenceInstant` override -- see its doc
 * comment below.
 */

import { computeSolarEphemeris, formatMinutes } from '../../astronomy/src/ephemeris';
import { computePanchangWindows, SolarWindowType, WeekdayIndex } from './windows';
import {
  findNextNamedTransition,
  findNextTransition,
  getKarana,
  getNakshatra,
  getTithi,
  getVara,
  getYoga,
} from '../../vedic/src/panchangElements';
import { isValidCalendarDateString, localDateTimeToUTC, resolveTzOffsetMinutes } from './localDate';

export interface PanchangElementValue {
  name: string;
  /** ISO instant the currently-active value transitions to the next one, or
   * null if no transition was found within the search window (see
   * "Panchanga transition limitations" below). */
  endsAt: string | null;
}

export interface PanchangDay {
  /** Echoes the requested local calendar date -- confirms no day shift occurred. */
  date: string;
  location: {
    latitude: number;
    longitude: number;
    timezone: string;
  };
  panchanga: {
    vara: string;
    tithi: PanchangElementValue & { paksha: 'Shukla' | 'Krishna' };
    nakshatra: PanchangElementValue;
    yoga: PanchangElementValue;
    karana: PanchangElementValue;
  };
  solar: {
    /** ISO instant */
    sunrise: string;
    /** ISO instant */
    sunset: string;
  };
  /** All currently-supported windows, independent and overlap-preserving --
   * NOT flattened into a mutually-exclusive timeline. A future Muhurta
   * evaluation over this date must be able to see every window that covers
   * a given instant, not just one. */
  windows: PanchangWindowSpan[];
}

export interface PanchangWindowSpan {
  type: SolarWindowType;
  label: string;
  /** ISO instant */
  start: string;
  /** ISO instant */
  end: string;
}

export interface GetPanchangForDateParams {
  /** The user's local calendar date, e.g. "2026-08-21". Treated as a local
   * date, never as UTC midnight -- see the module doc comment. */
  localDate: string;
  latitude: number;
  longitude: number;
  /** IANA timezone name, e.g. "Asia/Kolkata". */
  timezone: string;
  /**
   * Panchanga transition limitation: Tithi/Nakshatra/Yoga/Karana are each
   * evaluated (and their `endsAt` transition searched for) starting from
   * ONE reference instant, not tracked continuously across the whole day.
   * If an element changes value more than once within the requested date
   * (rare but possible for fast-moving elements like Karana), only the
   * transition immediately after this instant is reported -- earlier or
   * later same-day transitions are not surfaced. This mirrors the
   * pre-existing behavior of /api/panchang/today (which has always reported
   * "the value as of one instant"), not a new limitation introduced here.
   *
   * Defaults to local noon of `localDate` -- a deterministic, date-anchored
   * choice appropriate for arbitrary-date queries (avoids sitting close to
   * a midnight/sunrise boundary where transitions cluster). Pass the actual
   * current instant (`new Date()`) to reproduce legacy /today's exact
   * "as of right now" behavior for the user's real current local date.
   */
  referenceInstant?: Date;
}

function buildElementValue(name: string, endsAt: Date | null): PanchangElementValue {
  return { name, endsAt: endsAt ? endsAt.toISOString() : null };
}

/**
 * Computes a full PanchangDay for any local calendar date. See the module
 * doc comment for the no-hidden-"today" design principle and
 * GetPanchangForDateParams.referenceInstant for the Panchanga-element
 * evaluation-instant tradeoff.
 *
 * Cost per call (see also the perf-cache note on getSiderealLongitude in
 * panchangElements.ts): 1 computeSolarEphemeris (closed-form NOAA trig, O(1))
 * + 5 window calculations (pure arithmetic on the ephemeris result, O(1)) +
 * 4 Panchanga element lookups at referenceInstant (2 distinct Sun/Moon
 * ephemeris evaluations after caching, down from 7 naive calls) + up to 4
 * transition searches (each up to ~20 binary-search steps, or one closed-form
 * SearchRelativeLongitude call for Tithi) -- the transition searches are the
 * dominant cost, roughly 60-80 additional ephemeris evaluations in the worst
 * case. No I/O, no allocation beyond plain objects; safe to call repeatedly
 * in a loop (e.g. 28-31 times for a month calendar) without batching for
 * this PR's scope, though see the completion report for when that would
 * change.
 */
export function getPanchangForDate(params: GetPanchangForDateParams): PanchangDay {
  const { localDate, latitude, longitude, timezone } = params;

  if (!isValidCalendarDateString(localDate)) {
    throw new Error(`getPanchangForDate: "${localDate}" is not a valid YYYY-MM-DD calendar date.`);
  }

  const [year, month, day] = localDate.split('-').map(Number);

  // Weekday of a calendar date is timezone-independent (Aug 21 2026 is a
  // Friday everywhere on Earth), so this is safe to derive directly from
  // the requested y/m/d rather than from any instant/timezone conversion.
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() as WeekdayIndex;

  // DST-correct offset for this specific calendar date (resolved via local
  // noon, matching the convention dailyAssistant.ts's contextForDayOffset
  // uses for the same purpose).
  const noonInstant = localDateTimeToUTC(localDate, '12:00', timezone);
  const tzOffsetMinutes = resolveTzOffsetMinutes(timezone, noonInstant);

  const solar = computeSolarEphemeris({ year, month, day, latitude, longitude, tzOffsetMinutes });
  const windows = computePanchangWindows(solar, weekday);

  const toInstant = (minuteOfDay: number): string =>
    localDateTimeToUTC(localDate, formatMinutes(minuteOfDay), timezone).toISOString();

  const referenceInstant = params.referenceInstant ?? noonInstant;

  const tithi = getTithi(referenceInstant);
  const nakshatra = getNakshatra(referenceInstant);
  const yoga = getYoga(referenceInstant);
  const karana = getKarana(referenceInstant);
  const paksha: 'Shukla' | 'Krishna' = tithi.index <= 15 ? 'Shukla' : 'Krishna';

  const tithiEndsAt = findNextTransition(referenceInstant, 'TITHI');
  const nakshatraEndsAt = findNextTransition(referenceInstant, 'NAKSHATRA');
  const yogaEndsAt = findNextNamedTransition(referenceInstant, (d) => getYoga(d).name, 36);
  const karanaEndsAt = findNextNamedTransition(referenceInstant, (d) => getKarana(d).name, 15);

  return {
    date: localDate,
    location: { latitude, longitude, timezone },
    panchanga: {
      vara: getVara(weekday),
      tithi: { ...buildElementValue(tithi.name, tithiEndsAt), paksha },
      nakshatra: buildElementValue(nakshatra.name, nakshatraEndsAt),
      yoga: buildElementValue(yoga.name, yogaEndsAt),
      karana: buildElementValue(karana.name, karanaEndsAt),
    },
    solar: {
      sunrise: toInstant(solar.sunriseMinutes),
      sunset: toInstant(solar.sunsetMinutes),
    },
    windows: windows.map((w) => ({
      type: w.type,
      label: w.label,
      start: toInstant(w.startMinutes),
      end: toInstant(w.endMinutes),
    })),
  };
}
