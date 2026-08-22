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

export interface PanchangDaySummary {
  date: string;
  vara: string;
  tithi: { name: string };
  nakshatra: { name: string };
  /**
   * hasAbhijit/hasBrahma/cautionCount are always {true, true, 3} with
   * today's engine -- computePanchangWindows() unconditionally returns all
   * 5 windows every day (there is no "no Abhijit today" case for ordinary
   * latitudes), so these are NOT meaningful per-day differentiators right
   * now. Kept as literal, honest presence/count data (future-ready, per the
   * brief) rather than omitted -- but the calendar UI deliberately does NOT
   * render a per-day star/caution badge from them, since a marker that's
   * identical on every cell would misleadingly imply daily variation that
   * doesn't exist. See the completion report.
   */
  notableWindows: {
    hasAbhijit: boolean;
    hasBrahma: boolean;
    cautionCount: number;
  };
  /**
   * The one genuinely sparse, already-reliable per-day signal the current
   * engine provides: Purnima (full moon) and Amavasya (new moon) are each
   * one specific named Tithi (see TITHI_NAMES), occurring once per lunar
   * cycle (~29.5 days) -- a real reason to mark a specific day, unlike the
   * always-true window-presence fields above.
   */
  moonPhaseMarker?: 'NEW_MOON' | 'FULL_MOON';
}

/** Derives the lightweight month-calendar summary from a full PanchangDay --
 * pure, no recalculation; every field is read directly off `day`. */
export function summarizePanchangDay(day: PanchangDay): PanchangDaySummary {
  const hasWindowType = (type: SolarWindowType) => day.windows.some((w) => w.type === type);
  const cautionCount = (['RAHU_KALAM', 'YAMA', 'GULIKA'] as SolarWindowType[]).filter(hasWindowType).length;
  const moonPhaseMarker: PanchangDaySummary['moonPhaseMarker'] =
    day.panchanga.tithi.name === 'Purnima' ? 'FULL_MOON' : day.panchanga.tithi.name === 'Amavasya' ? 'NEW_MOON' : undefined;

  return {
    date: day.date,
    vara: day.panchanga.vara,
    tithi: { name: day.panchanga.tithi.name },
    nakshatra: { name: day.panchanga.nakshatra.name },
    notableWindows: {
      hasAbhijit: hasWindowType('ABHIJIT'),
      hasBrahma: hasWindowType('BRAHMA'),
      cautionCount,
    },
    moonPhaseMarker,
  };
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

export interface GetMonthOfPanchangSummariesParams {
  /** Calendar year, e.g. 2026. */
  year: number;
  /** 1-12 (not 0-indexed). */
  month: number;
  latitude: number;
  longitude: number;
  timezone: string;
}

/** Days in `month` (1-12) of `year`, leap-year-correct (calendar-date
 * arithmetic, not tied to any timezone or instant). */
function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The one canonical entry point for a month of Panchang summaries -- used
 * by GET /api/panchang/month, and unit-testable independent of the HTTP
 * layer. Calls getPanchangForDate() once per local calendar date in the
 * month (28-31 calls) and reduces each to a PanchangDaySummary; never
 * assembles or returns a full PanchangDay per date. Produces exactly one
 * summary per calendar date in the month, in ascending date order -- no
 * duplicates, no gaps, regardless of the caller's timezone (the loop is
 * driven by calendar-date arithmetic, not by iterating instants).
 */
export function getMonthOfPanchangSummaries(params: GetMonthOfPanchangSummariesParams): PanchangDaySummary[] {
  const { year, month, latitude, longitude, timezone } = params;
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`getMonthOfPanchangSummaries: month must be an integer 1-12, got ${month}.`);
  }

  const totalDays = daysInCalendarMonth(year, month);
  const pad2 = (n: number) => String(n).padStart(2, '0');

  return Array.from({ length: totalDays }, (_, index) => {
    const localDate = `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(index + 1)}`;
    return summarizePanchangDay(getPanchangForDate({ localDate, latitude, longitude, timezone }));
  });
}
