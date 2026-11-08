/**
 * Marriage Muhurtham Required Eligibility V1: generic ceremonial
 * period-exclusion primitive (Kharmas, Adhika Masa, Chaturmas) -- the
 * "period" half of the two coverage capabilities PR A's rule-pack
 * architecture reserved (coverage.periodExclusion). Consumes the resolved
 * MuhurtaRulePack's own `periodRules` (which Rashis/sub-rules a given
 * intent's traditional rule set actually requires) rather than hardcoding
 * Marriage anywhere in this file -- reusable, unchanged, by any future
 * ceremonial intent that declares the same requirement.
 *
 * Lives in packages/recommendation (not packages/vedic, where the pure
 * astronomy primitives this file consumes live) specifically because the
 * Chaturmas sub-rule needs Event-Location-aware sunrise computation
 * (packages/astronomy/src/ephemeris.ts, packages/panchang/src/localDate.ts)
 * -- packages/vedic must not depend on either of those (it would create a
 * cross-package dependency cycle, since packages/panchang already depends
 * on packages/vedic for Tithi/Nakshatra/Yoga/Karana). packages/recommendation
 * already depends on all three, so this is the correct, cycle-free home.
 */
import {
  classifySynodicMonthContaining,
  findNextSankranti,
  findSynodicMonthContainingIngress,
  findShuklaEkadashi,
  sunRashiIndex,
  KARKA_RASHI_INDEX,
  VRISHCHIKA_RASHI_INDEX,
} from '../../vedic/src/lunarCalendar';
import { computeSolarEphemeris, formatMinutes, SolarNoEventError } from '../../astronomy/src/ephemeris';
import { getDatePartsInTimezone, localDateTimeToUTC, resolveTzOffsetMinutes } from '../../panchang/src/localDate';
import { resolveMuhurtaRulePack } from '../../muhurta/src/muhurtaRulePacks';
import type { MuhurtaClassification } from '../../muhurta/src/activityOntology';

export interface CeremonialLocation {
  latitude: number;
  longitude: number;
  timezone: string;
}

export type PeriodExclusionReasonCode = 'CHATURMAS' | 'KHARMAS' | 'ADHIKA_MASA';

/** PA-3C-C1B-02: the only sub-rule that can currently become UNAVAILABLE is
 * Chaturmas (the only one with a solar-ephemeris dependency, via
 * sunriseInstantFor). Kharmas/Adhika Masa are purely sidereal and can never
 * produce this value -- kept as its own type (not folded into
 * PeriodExclusionReasonCode) so a reader can tell at the type level that an
 * UNAVAILABLE result was never an evaluated exclusion. */
export type PeriodUnavailableReasonCode = 'CHATURMAS_UNAVAILABLE';

/**
 * PA-3C-C1B-02: three-state result, additive over the pre-existing
 * `{eligible: boolean; reason?: PeriodExclusionReasonCode}` shape.
 *
 * Deliberately keeps `eligible` a real `boolean` (never `null`) for ALL
 * three states -- `UNAVAILABLE` sets `eligible: false`, not `eligible:
 * null`. This is a conscious deviation from the ticket's own illustrative
 * `eligible: null` shape: `test/marriageRequiredEligibility.test.ts` has
 * three pre-existing assertions (`typeof X.eligible === 'boolean'`) that a
 * `null` value would break, and more importantly, ANY not-yet-audited
 * caller that narrowly does `if (!result.eligible)` (exactly what
 * muhurthamFinder.ts's one call site already did before this change) keeps
 * failing CLOSED (excludes the candidate) rather than needing to be
 * rewritten to handle a third falsy-adjacent value. `status` is the single
 * source of truth for which of the three states this is; `eligible` is a
 * backward-compatible boolean projection of it (true only for ELIGIBLE).
 */
export type PeriodEligibilityStatus = 'ELIGIBLE' | 'INELIGIBLE' | 'UNAVAILABLE';

export type PeriodEligibilityResult =
  | { status: 'ELIGIBLE'; eligible: true; reason?: undefined }
  | { status: 'INELIGIBLE'; eligible: false; reason: PeriodExclusionReasonCode }
  | { status: 'UNAVAILABLE'; eligible: false; reason: PeriodUnavailableReasonCode };

function addOneDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** Sunrise instant (UTC) for a given local civil date at `location` --
 * reuses the exact same computeSolarEphemeris + localDateTimeToUTC pattern
 * packages/panchang/src/panchangDay.ts already established for every other
 * Event-Location-aware sunrise lookup in this codebase (never a second
 * sunrise algorithm). */
function sunriseInstantFor(localDate: string, location: CeremonialLocation): Date {
  const [year, month, day] = localDate.split('-').map(Number);
  const tzOffsetMinutes = resolveTzOffsetMinutes(location.timezone, localDateTimeToUTC(localDate, '12:00', location.timezone));
  const solar = computeSolarEphemeris({ year, month, day, latitude: location.latitude, longitude: location.longitude, tzOffsetMinutes });
  return localDateTimeToUTC(localDate, formatMinutes(solar.sunriseMinutes), location.timezone);
}

/**
 * Resolves which civil day's sunrise "owns" a given Tithi span (the
 * udaya-vyapini/sunrise-prevailing convention -- Methodology Resolution
 * audit, Chaturmas section): checks the tithi-start day and the following
 * day's sunrise for whichever one falls inside [tithiSpan.start,
 * tithiSpan.end). Falls back to the tithi-start day's own sunrise when
 * neither candidate sunrise falls inside the span (a short tithi entirely
 * between two sunrises) -- a documented, deliberate approximation for that
 * rare edge case, not a silent gap.
 */
function resolveSunriseOwningInstant(tithiSpan: { start: Date; end: Date }, location: CeremonialLocation): Date {
  const startLocalDate = getDatePartsInTimezone(location.timezone, tithiSpan.start).dateStr;
  for (const dateStr of [startLocalDate, addOneDay(startLocalDate)]) {
    const sunrise = sunriseInstantFor(dateStr, location);
    if (sunrise.getTime() >= tithiSpan.start.getTime() && sunrise.getTime() < tithiSpan.end.getTime()) {
      return sunrise;
    }
  }
  return sunriseInstantFor(startLocalDate, location);
}

export interface ChaturmasWindow {
  start: Date;
  end: Date;
}

/**
 * Ratified V1 Chaturmas methodology (Methodology Resolution audit):
 * Devshayani (Ashadha Shukla) Ekadashi -> Prabodhini (Kartika Shukla)
 * Ekadashi, Smarta end-date convention, sunrise-owning tithi boundary,
 * [start, end) -- an intentional, documented GENERAL-scope V1 default, not
 * a universal rule (does not represent Tamil Aadi/Purattasi practice or
 * the Vaishnava end-date variant).
 *
 * `referenceInstant` anchors the search: looks back 200 days (more than
 * Chaturmas's own ~120-day span) to guarantee landing on the Ashadha/
 * Kartika cycle that contains or most recently preceded it, regardless of
 * where in the year `referenceInstant` falls.
 */
export function findChaturmasWindow(referenceInstant: Date, location: CeremonialLocation): ChaturmasWindow {
  const searchAnchor = new Date(referenceInstant.getTime() - 200 * 86400_000);
  const ashadhaMonth = findSynodicMonthContainingIngress(KARKA_RASHI_INDEX, searchAnchor);
  const kartikaMonth = findSynodicMonthContainingIngress(VRISHCHIKA_RASHI_INDEX, ashadhaMonth.end);
  const devshayani = findShuklaEkadashi(ashadhaMonth.start);
  const prabodhini = findShuklaEkadashi(kartikaMonth.start);
  return {
    start: resolveSunriseOwningInstant(devshayani, location),
    end: resolveSunriseOwningInstant(prabodhini, location),
  };
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Ceremonial period-exclusion eligibility for [start, end) under
 * `classification`'s resolved rule pack -- Kharmas (sidereal Sun Rashi,
 * global/instant), Adhika Masa (synodic-month classification,
 * global/instant), Chaturmas (lunar Ekadashi window, Event-Location
 * sunrise-sensitive). Only checks the sub-rules the pack's own
 * `periodRules` actually declares, and only when
 * coverage.periodExclusion is genuinely IMPLEMENTED -- a pack with no
 * periodRules (every activity except Marriage today) always returns
 * eligible: true, unconditionally.
 *
 * Full half-open [start, end) span safety throughout: a candidate that
 * starts clean and crosses into a prohibited period mid-span is rejected,
 * matching the exact discipline packages/recommendation/src/
 * muhurthamFinder.ts's spanOverlapsAuthoritativeEventAvoid() already
 * established for Tithi/Nakshatra/Yoga/Karana.
 */
export function spanOverlapsProhibitedPeriod(start: Date, end: Date, classification: MuhurtaClassification, location: CeremonialLocation): PeriodEligibilityResult {
  const pack = resolveMuhurtaRulePack(classification);
  if (pack.coverage.periodExclusion !== 'IMPLEMENTED' || !pack.periodRules) return { status: 'ELIGIBLE', eligible: true };
  const { periodRules } = pack;

  if (periodRules.kharmasRashiIndices.length > 0) {
    const startRashi = sunRashiIndex(start);
    if (periodRules.kharmasRashiIndices.includes(startRashi)) return { status: 'INELIGIBLE', eligible: false, reason: 'KHARMAS' };
    // A candidate span (<=360 min) is far shorter than a Rashi transit
    // (~30 days), so at most one Sankranti can ever fall inside it --
    // check whether that one, if any, crosses INTO a prohibited Rashi.
    try {
      const next = findNextSankranti(start);
      if (next.instant.getTime() < end.getTime() && periodRules.kharmasRashiIndices.includes(next.rashiIndex)) {
        return { status: 'INELIGIBLE', eligible: false, reason: 'KHARMAS' };
      }
    } catch {
      // No Sankranti within the search bound -- nothing to flag.
    }
  }

  if (periodRules.adhikaMasa) {
    const startMonth = classifySynodicMonthContaining(start);
    if (startMonth.classification === 'ADHIKA') return { status: 'INELIGIBLE', eligible: false, reason: 'ADHIKA_MASA' };
    if (end.getTime() > startMonth.end.getTime()) {
      const nextMonth = classifySynodicMonthContaining(new Date(startMonth.end.getTime() + 1000));
      if (nextMonth.classification === 'ADHIKA') return { status: 'INELIGIBLE', eligible: false, reason: 'ADHIKA_MASA' };
    }
  }

  if (periodRules.chaturmas) {
    // PA-3C-C1B-02: findChaturmasWindow -> resolveSunriseOwningInstant ->
    // sunriseInstantFor -> computeSolarEphemeris can throw SolarNoEventError
    // for a legitimate polar no-event location/date. Catch ONLY that typed
    // error -- SolarInputValidationError/SolarComputationError are real
    // bugs/bad input, not a legitimate "could not evaluate" condition, and
    // must keep propagating uncaught so they get fixed rather than silently
    // producing a plausible-looking UNAVAILABLE result.
    let window: ChaturmasWindow;
    try {
      window = findChaturmasWindow(start, location);
    } catch (err) {
      if (err instanceof SolarNoEventError) {
        return { status: 'UNAVAILABLE', eligible: false, reason: 'CHATURMAS_UNAVAILABLE' };
      }
      throw err;
    }
    if (intervalsOverlap(start.getTime(), end.getTime(), window.start.getTime(), window.end.getTime())) {
      return { status: 'INELIGIBLE', eligible: false, reason: 'CHATURMAS' };
    }
  }

  return { status: 'ELIGIBLE', eligible: true };
}
