/**
 * Dynamic panchang window partitioners.
 * Pure functions on top of packages/astronomy's SolarResult — no I/O, no DB.
 */

import type { SolarResult } from '../../astronomy/src/ephemeris';

export type SolarWindowType =
  | 'BRAHMA'
  | 'ABHIJIT'
  | 'RAHU_KALAM'
  | 'GULIKA'
  | 'YAMA'
  | 'NEUTRAL'
  | 'UNAVAILABLE';

/**
 * The subset of SolarWindowType that a successful solar-ephemeris
 * computation can ever produce (computePanchangWindows/getActiveWindow
 * below). 'UNAVAILABLE' is never returned by those functions -- it is
 * assigned one layer up, by a caller that caught a SolarNoEventError
 * (packages/astronomy/src/errors.ts) before a WindowSpan[] could even be
 * computed. Keeping this as a distinct type (rather than widening
 * SolarWindowType everywhere) lets consumers that only ever see a
 * successful computation's output -- computePanchangWindows,
 * getActiveWindow, and anything typed against their return values --
 * keep compile-time exhaustiveness over exactly the 6 real values,
 * while callers that persist/display a classification that may ALSO be
 * 'UNAVAILABLE' (HabitLog.activeWindow, scoring, formatting, Insights)
 * use the full SolarWindowType.
 */
export type ComputedSolarWindowType = Exclude<SolarWindowType, 'UNAVAILABLE'>;

/**
 * PA-3C-C1B-01: the single canonical runtime list of every SolarWindowType
 * member, kept next to the type itself so the two can never silently
 * drift apart. Any trust boundary that must validate a client-supplied or
 * persisted string against the real domain (e.g. the legacy habit-
 * completion endpoint) should import this rather than hand-listing its
 * own copy -- "avoid a second independent enum definition."
 */
export const ALL_SOLAR_WINDOW_TYPES: readonly SolarWindowType[] = [
  'BRAHMA',
  'ABHIJIT',
  'RAHU_KALAM',
  'GULIKA',
  'YAMA',
  'NEUTRAL',
  'UNAVAILABLE',
];

const SOLAR_WINDOW_TYPE_SET: ReadonlySet<string> = new Set(ALL_SOLAR_WINDOW_TYPES);

export function isSolarWindowType(value: string): value is SolarWindowType {
  return SOLAR_WINDOW_TYPE_SET.has(value);
}

export interface WindowSpan {
  type: SolarWindowType;
  label: string;
  startMinutes: number; // local clock, 0-1439
  endMinutes: number;   // local clock, 0-1439
  // Aliases added for backwards-compatibility with page.tsx UI mappers
  startMinute?: number;
  endMinute?: number;
}

/** 0 = Sunday ... 6 = Saturday, matching JS Date#getDay(). */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

// 0-indexed segment offsets (0 = 1st segment, 7 = 8th segment):
// Sun: 8th (7), Mon: 2nd (1), Tue: 7th (6), Wed: 5th (4), Thu: 6th (5), Fri: 4th (3), Sat: 3rd (2)
const RAHU_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 7, // Sunday (8th segment)
  1: 1, // Monday (2nd segment)
  2: 6, // Tuesday (7th segment)
  3: 4, // Wednesday (5th segment)
  4: 5, // Thursday (6th segment)
  5: 3, // Friday (4th segment)
  6: 2, // Saturday (3rd segment)
};

const GULIKA_KALAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 6, // Sunday (7th segment)
  1: 5, // Monday (6th segment)
  2: 4, // Tuesday (5th segment)
  3: 3, // Wednesday (4th segment)
  4: 2, // Thursday (3rd segment)
  5: 1, // Friday (2nd segment)
  6: 0, // Saturday (1st segment)
};

const YAMA_GANDAM_SEGMENT: Record<WeekdayIndex, number> = {
  0: 4, // Sunday (5th segment)
  1: 3, // Monday (4th segment)
  2: 2, // Tuesday (3rd segment)
  3: 1, // Wednesday (2nd segment)
  4: 0, // Thursday (1st segment)
  5: 5, // Friday (6th segment)
  6: 6, // Saturday (7th segment)
};

function segmentSpan(
  sunrise: number,
  daylight: number,
  segmentIndex: number
): { start: number; end: number } {
  const eighth = daylight / 8;
  const start = sunrise + eighth * segmentIndex;
  const end = start + eighth;
  return { start, end };
}

/**
 * Inauspicious Period Precedence Fix V1: windows that must override an
 * otherwise-positive commencement for timing-sensitive/significant
 * activities. Deliberately distinct from dailyAssistant.ts's isFriction()
 * (RAHU_KALAM/YAMA only), which governs EVERYDAY scoring/ranking and must
 * keep excluding Gulika -- an everyday activity during Gulika stays
 * rankable/usable, never hard-blocked. This is the narrower,
 * commencement-safety-specific concept: for a significant beginning, Rahu
 * Kalam, Yamaganda, AND Gulika all count as inauspicious, regardless of
 * what an overlapping Abhijit/Brahma window sharing the same span would
 * otherwise suggest.
 */
export function isInauspiciousCommencementWindow(type: SolarWindowType): boolean {
  return type === 'RAHU_KALAM' || type === 'YAMA' || type === 'GULIKA';
}

/**
 * True if [aStart, aEnd) and [bStart, bEnd) intersect at all, on any shared
 * linear numeric axis -- minute-of-day (dailyAssistant.ts's commencement-
 * safety check) or epoch milliseconds via Date.parse (muhurthamFinder.ts's
 * ISO-instant one). The one canonical interval-overlap primitive: kept here
 * (rather than duplicated per caller, each with its own unit) so the actual
 * overlap math -- `aStart < bEnd && bStart < aEnd` -- exists exactly once.
 */
export function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Computes all five panchang windows for a given day's solar ephemeris.
 */
export function computePanchangWindows(
  solar: SolarResult,
  weekday: WeekdayIndex
): WindowSpan[] {
  const { sunriseMinutes, solarNoonMinutes, daylightMinutes } = solar;

  // Drik Panchang calculates Abhijit as the 8th Muhurta out of 15 equal day divisions
  const muhurtaLength = daylightMinutes / 15;
  const abhijitHalf = muhurtaLength / 2;

  const abhijit: WindowSpan = {
    type: 'ABHIJIT',
    label: 'Abhijit Muhurtham',
    startMinutes: solarNoonMinutes - abhijitHalf,
    endMinutes: solarNoonMinutes + abhijitHalf,
  };

  const brahma: WindowSpan = {
    type: 'BRAHMA',
    label: 'Brahma Muhurtham',
    startMinutes: sunriseMinutes - 96,
    endMinutes: sunriseMinutes - 48,
  };

  const rahuSeg = segmentSpan(sunriseMinutes, daylightMinutes, RAHU_KALAM_SEGMENT[weekday]);
  const rahuKalam: WindowSpan = {
    type: 'RAHU_KALAM',
    label: 'Rahu Kalam',
    startMinutes: rahuSeg.start,
    endMinutes: rahuSeg.end,
  };

  const gulikaSeg = segmentSpan(sunriseMinutes, daylightMinutes, GULIKA_KALAM_SEGMENT[weekday]);
  const gulikaKalam: WindowSpan = {
    type: 'GULIKA',
    label: 'Gulika Kalam',
    startMinutes: gulikaSeg.start,
    endMinutes: gulikaSeg.end,
  };

  const yamaSeg = segmentSpan(sunriseMinutes, daylightMinutes, YAMA_GANDAM_SEGMENT[weekday]);
  const yamaGandam: WindowSpan = {
    type: 'YAMA',
    label: 'Yama Gandam',
    startMinutes: yamaSeg.start,
    endMinutes: yamaSeg.end,
  };

  return [brahma, abhijit, rahuKalam, gulikaKalam, yamaGandam].map((w) => {
    const sMin = Math.round(((w.startMinutes % 1440) + 1440) % 1440);
    const eMin = Math.round(((w.endMinutes % 1440) + 1440) % 1440);
    return {
      ...w,
      startMinutes: sMin,
      endMinutes: eMin,
      startMinute: sMin,
      endMinute: eMin,
    };
  });
}

/**
 * PANCH-OVERLAP-01-I1 -- the single containment check both getActiveWindow()
 * (below, unchanged in behavior) and evaluatePanchangOverlap() (below) use,
 * so "is this window active at this minute" can never silently diverge
 * between the two. End-minute inclusive (`<=`), matching getActiveWindow()'s
 * pre-existing semantics exactly -- this is a pure extraction, not a
 * behavior change.
 */
function windowContainsMinute(w: WindowSpan, currentMinuteOfDay: number): boolean {
  if (w.startMinutes <= w.endMinutes) {
    return currentMinuteOfDay >= w.startMinutes && currentMinuteOfDay <= w.endMinutes;
  }
  return currentMinuteOfDay >= w.startMinutes || currentMinuteOfDay <= w.endMinutes;
}

/**
 * Given current minute-of-day, returns active window or 'NEUTRAL'.
 *
 * PANCH-OVERLAP-01-I1 -- deliberately UNCHANGED: still first-match array
 * order, still returns a single SolarWindowType. This remains correct for
 * "what is the single factually-current window" display purposes (e.g. the
 * live client-side current-window label) and for briefingState's own
 * UPCOMING/ACTIVE/COMPLETED transitions, which are anchored to Abhijit
 * specifically and would transition incorrectly if this were changed to
 * prefer a caution window instead (see evaluatePanchangOverlap()'s own doc
 * comment for why that responsibility was given a separate function
 * instead). Do not use this function's return value alone to decide
 * commencement-caution semantics -- use evaluatePanchangOverlap() for that.
 */
export function getActiveWindow(
  windows: WindowSpan[],
  currentMinuteOfDay: number
): SolarWindowType {
  for (const w of windows) {
    if (windowContainsMinute(w, currentMinuteOfDay)) {
      return w.type;
    }
  }
  return 'NEUTRAL';
}

/**
 * PANCH-OVERLAP-01-I1 -- the shared commencement-caution-overlap decision.
 *
 * Root cause this exists to fix: getActiveWindow() above answers "what is
 * THE (single, first-match, array-order) active window" -- correct for
 * display/briefingState purposes, but NEVER safe to use for "is it okay to
 * START something now," because Abhijit is listed before RAHU_KALAM/
 * GULIKA/YAMA in computePanchangWindows()'s returned array, so
 * getActiveWindow() silently prefers Abhijit on every one of the (gemetrically
 * guaranteed, not rare -- see issue #331) days/instants where Abhijit's
 * solar-noon-centered span overlaps a weekday-indexed caution segment.
 * dailyAssistant.ts's resolveOverlappingCandidate() already solves this
 * correctly for Timing Search (prefers isInauspiciousCommencementWindow()
 * when multiple candidates overlap a minute) -- this function is the SAME
 * policy, exposed here so Home (and any other consumer) can ask the
 * identical question Timing Search already answers, instead of relying on
 * getActiveWindow()'s array-order-only result for a decision it was never
 * safe to drive.
 *
 * Returns ALL windows active at this minute as facts (never hides a
 * concurrent window -- Explore's traditional-reference role depends on
 * this), plus the derived favorable/caution split and a single boolean a
 * commencement-oriented consumer (Home's Green Light/Next Action) can gate
 * on. `commencementCaution` is TRUE whenever ANY active window is
 * inauspicious-for-commencement (isInauspiciousCommencementWindow: RAHU_KALAM,
 * YAMA, or GULIKA) -- regardless of what other favorable window(s) (e.g.
 * ABHIJIT) are ALSO active at the same minute, and regardless of the
 * windows array's order (every active window is found by filtering, not by
 * first-match).
 *
 * `primaryCautionWindow` is a convenience for a consumer that structurally
 * needs exactly one window (e.g. a single-line UI label) when MORE than one
 * caution window is simultaneously active (confirmed real: Wednesdays,
 * where Gulika's second half and Rahu Kalam's first half both fall inside
 * Abhijit's span). The tie-break is deliberately policy-neutral -- earliest
 * startMinutes first, then alphabetical type as a final deterministic
 * tie-break -- NOT a religious/traditional precedence among Rahu Kalam,
 * Yamaganda and Gulika, which this repository does not document and which
 * this function does not invent. `cautionWindows` (plural) remains the
 * authoritative data; always prefer it over `primaryCautionWindow` unless a
 * consumer is structurally limited to one value.
 *
 * Commencement caution is NOT a universal prohibition (PD-02): this
 * function only reports the factual overlap. Whether a given activity is
 * actually blocked, discouraged, or unaffected by that overlap remains each
 * consumer's own, separate decision (e.g. isCommencementSensitiveProfile()/
 * isFriction() in dailyAssistant.ts) -- this function deliberately does not
 * take an activity/profile parameter, so it can never be the thing that
 * decides eligibility, only the thing that reports the facts eligibility
 * decisions must be consistent with.
 */
export interface PanchangOverlapDecision {
  /** Every window active at this minute, unfiltered, in the order
   * `windows` was passed in -- never hidden or reordered; this is the
   * factual record Explore's traditional-reference display depends on. */
  activeWindows: WindowSpan[];
  /** Subset of activeWindows that are NOT inauspicious-for-commencement
   * (i.e. ABHIJIT, BRAHMA, or NEUTRAL-type windows that happen to be
   * modeled as a WindowSpan in some future extension). */
  favorableWindows: WindowSpan[];
  /** Subset of activeWindows where isInauspiciousCommencementWindow() is
   * true (RAHU_KALAM, YAMA, GULIKA). May contain more than one entry
   * (confirmed real on Wednesdays). */
  cautionWindows: WindowSpan[];
  /** True iff cautionWindows.length > 0 -- independent of windows[] order,
   * independent of how many favorable windows are ALSO active. */
  commencementCaution: boolean;
  /** Deterministic (earliest-start, then alphabetical-type) tie-break pick
   * among cautionWindows, for a consumer that structurally needs a single
   * window. Undefined when commencementCaution is false. Never the
   * authoritative data -- see cautionWindows. */
  primaryCautionWindow?: WindowSpan;
}

export function evaluatePanchangOverlap(
  windows: WindowSpan[],
  currentMinuteOfDay: number
): PanchangOverlapDecision {
  const activeWindows = windows.filter((w) => windowContainsMinute(w, currentMinuteOfDay));
  const cautionWindows = activeWindows.filter((w) => isInauspiciousCommencementWindow(w.type));
  const favorableWindows = activeWindows.filter((w) => !isInauspiciousCommencementWindow(w.type));
  const primaryCautionWindow = cautionWindows.length > 0
    ? [...cautionWindows].sort((a, b) => a.startMinutes - b.startMinutes || a.type.localeCompare(b.type))[0]
    : undefined;
  return {
    activeWindows,
    favorableWindows,
    cautionWindows,
    commencementCaution: cautionWindows.length > 0,
    primaryCautionWindow,
  };
}