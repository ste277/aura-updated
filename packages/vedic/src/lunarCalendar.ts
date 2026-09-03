/**
 * Marriage Muhurtham Required Eligibility V1: shared solar-ingress
 * (Sankranti) and synodic-lunar-month primitives -- the common substrate
 * Kharmas, Adhika Masa, and Chaturmas all depend on (see the Methodology
 * Resolution audit's own finding: these three period-exclusion factors
 * share one prerequisite, not three separate ones).
 *
 * Deliberately NOT a general-purpose Hindu calendar engine: no month
 * display naming, no Amanta/Purnimanta rendering, no Adhika-month-name
 * disambiguation (Nija/Shuddha). Just enough to (a) classify a synodic
 * month as NORMAL/ADHIKA/KSHAYA_OR_UNSUPPORTED, and (b) locate the specific
 * synodic months containing a Karka or Vrishchika solar ingress (sufficient
 * to identify "Ashadha" and "Kartika" for Chaturmas without full ordinal
 * month-numbering -- see findSynodicMonthContainingIngress's own doc
 * comment).
 */
import { Body, SearchMoonPhase, SearchSunLongitude } from 'astronomy-engine';
import { getSiderealLongitude, lahiriAyanamsa } from './panchangElements';

/** Sidereal Rashi (zodiac sign) indices, 0=Mesha..11=Meena -- matching
 * packages/vedic/src/natalChart.ts's RASHI_NAMES ordering. Not imported
 * from there (that module's RASHI_NAMES is private, and this is pure
 * arithmetic on a longitude, not a graha-position lookup) -- kept as a
 * small local constant instead of introducing a new shared export for a
 * value only used as an index here. */
export const KARKA_RASHI_INDEX = 3;
export const VRISHCHIKA_RASHI_INDEX = 7;
export const DHANU_RASHI_INDEX = 8;
export const MEENA_RASHI_INDEX = 11;

const RASHI_SPAN = 30;

export interface SankrantiEvent {
  instant: Date;
  /** The Rashi (0-11) the Sun ENTERS at this instant. */
  rashiIndex: number;
}

/**
 * Finds the next sidereal solar ingress (Sankranti) after `date` -- the
 * exact instant the Sun's SIDEREAL longitude crosses a 30-degree Rashi
 * boundary. Reuses astronomy-engine's own SearchSunLongitude (a TROPICAL
 * longitude search, already an unused dependency of this package) by
 * converting the target sidereal boundary to its tropical equivalent via
 * the same Lahiri ayanamsa this codebase already uses everywhere else.
 * `lahiriAyanamsa()` is evaluated once at `date` and held constant for the
 * search: ayanamsa drifts ~0.000038 deg/day (1.4 deg/century), utterly
 * negligible against the Sun's own ~1 deg/day motion over the ~40-day
 * search window a Sankranti search needs.
 */
export function findNextSankranti(date: Date): SankrantiEvent {
  const currentSiderealLongitude = getSiderealLongitude(Body.Sun, date);
  const currentRashiIndex = Math.floor(currentSiderealLongitude / RASHI_SPAN);
  const targetRashiIndex = (currentRashiIndex + 1) % 12;
  const targetSiderealLongitude = (targetRashiIndex * RASHI_SPAN) % 360;
  const targetTropicalLongitude = (targetSiderealLongitude + lahiriAyanamsa(date) + 360) % 360;
  const result = SearchSunLongitude(targetTropicalLongitude, date, 40);
  if (!result) throw new Error(`findNextSankranti: no Sankranti found within 40 days of ${date.toISOString()}.`);
  return { instant: result.date, rashiIndex: targetRashiIndex };
}

/**
 * findNextSankranti, called from a point extremely close to (but nominally
 * after) a Sankranti instant, can re-find that same transition -- not
 * merely at sub-second offsets (the 1-second nudge that suffices for
 * findNextTransition's own Moon-based searches in panchangElements.ts is
 * NOT enough here; verified directly by test that 1 second still
 * re-triggers this for SearchSunLongitude, which has coarser convergence
 * near a boundary than SearchMoonPhase does). 1 hour is functionally
 * negligible against a ~30-day Sankranti spacing while being safely past
 * any search-precision noise.
 */
const SANKRANTI_SEARCH_NUDGE_MS = 3_600_000;

/** The sidereal Rashi (0-11) the Sun occupies at `date`. */
export function sunRashiIndex(date: Date): number {
  return Math.floor(getSiderealLongitude(Body.Sun, date) / RASHI_SPAN);
}

/**
 * Finds the nearest Amavasya (new moon, Moon-Sun elongation 0) relative to
 * `from`. `limitDays` follows astronomy-engine's own SearchMoonPhase
 * convention exactly: positive searches forward, negative searches
 * backward -- one shared function for both a synodic month's start and its
 * end, rather than two.
 */
export function findAmavasya(from: Date, limitDays: number): Date {
  const result = SearchMoonPhase(0, from, limitDays);
  if (!result) throw new Error(`findAmavasya: no Amavasya found within ${limitDays} days of ${from.toISOString()}.`);
  return result.date;
}

/**
 * Finds the [start, end) instant span of the Shukla-Paksha Ekadashi Tithi
 * (11th tithi of the bright fortnight) within the synodic month beginning
 * at `monthStart` (an Amavasya instant). A direct SearchMoonPhase call, not
 * a transition-walk loop: Tithi n begins at Moon-Sun elongation
 * (n-1)*12 deg, so Shukla Ekadashi (Tithi 11) begins at 120 deg and ends
 * (Shukla Dvadashi begins) at 132 deg.
 */
export function findShuklaEkadashi(monthStart: Date): { start: Date; end: Date } {
  const startResult = SearchMoonPhase(120, monthStart, 20);
  if (!startResult) throw new Error(`findShuklaEkadashi: could not locate Ekadashi tithi start from ${monthStart.toISOString()}.`);
  const endResult = SearchMoonPhase(132, startResult.date, 3);
  if (!endResult) throw new Error(`findShuklaEkadashi: could not locate Ekadashi tithi end from ${startResult.date.toISOString()}.`);
  return { start: startResult.date, end: endResult.date };
}

export type SynodicMonthClassification = 'NORMAL' | 'ADHIKA' | 'KSHAYA_OR_UNSUPPORTED';

export interface SynodicMonth {
  start: Date;
  end: Date;
  sankrantiCount: number;
  classification: SynodicMonthClassification;
}

/** A synodic month spans ~29.5 days; at most one Sankranti falls inside an
 * ordinary month, zero in an Adhika month, two in the rare Kshaya case --
 * this guard is a defensive ceiling, never expected to bind. */
const SANKRANTI_WALK_GUARD = 3;

/**
 * Classifies the synodic (Amanta) lunar month [start, end) by counting how
 * many Sankrantis fall within it (Dharma Sindhu Ch.3, corroborated by the
 * standard astronomical account of how the lunisolar calendar reconciles
 * lunar and solar years): zero Sankranti = ADHIKA (intercalary), exactly
 * one = an ordinary NORMAL month, two = the rare Kshaya Masa case --
 * returned as its own explicit classification, never silently folded into
 * NORMAL or ADHIKA (full Kshaya Masa handling is out of scope for this PR;
 * see this module's own doc comment and the Methodology Resolution audit).
 */
export function classifySynodicMonth(start: Date, end: Date): SynodicMonth {
  let count = 0;
  let cursor = start;
  for (let i = 0; i < SANKRANTI_WALK_GUARD; i++) {
    let next: SankrantiEvent;
    try {
      next = findNextSankranti(cursor);
    } catch {
      break;
    }
    if (next.instant.getTime() < start.getTime() || next.instant.getTime() >= end.getTime()) break;
    count++;
    cursor = new Date(next.instant.getTime() + SANKRANTI_SEARCH_NUDGE_MS);
  }
  const classification: SynodicMonthClassification = count === 0 ? 'ADHIKA' : count === 1 ? 'NORMAL' : 'KSHAYA_OR_UNSUPPORTED';
  return { start, end, sankrantiCount: count, classification };
}

/** Classifies the synodic month containing `instant`. */
export function classifySynodicMonthContaining(instant: Date): SynodicMonth {
  const start = findAmavasya(instant, -35);
  const end = findAmavasya(instant, 35);
  return classifySynodicMonth(start, end);
}

/**
 * Finds the synodic month whose Sankranti-set includes an ingress into
 * `targetRashiIndex` -- sufficient to identify "Ashadha" (Karka ingress,
 * KARKA_RASHI_INDEX) and "Kartika" (Vrishchika ingress,
 * VRISHCHIKA_RASHI_INDEX) for Chaturmas without a full ordinal
 * lunar-month-naming engine (brief section 10: "implement only enough to
 * distinguish Ashadha/Kartika... do not duplicate Panchang naming logic").
 * An Adhika month (zero Sankranti, by definition) can never be "the month
 * containing Karka Sankranti" -- so this search is naturally robust to
 * Adhika-Masa years, always landing on the one synodic month that
 * genuinely contains the target ingress, wherever it falls in the
 * sequence, without needing to track ordinal position at all.
 */
export function findSynodicMonthContainingIngress(targetRashiIndex: number, searchFrom: Date): SynodicMonth {
  let cursor = searchFrom;
  let found: SankrantiEvent | undefined;
  for (let i = 0; i < 13; i++) {
    const next = findNextSankranti(cursor);
    if (next.rashiIndex === targetRashiIndex) {
      found = next;
      break;
    }
    cursor = new Date(next.instant.getTime() + SANKRANTI_SEARCH_NUDGE_MS);
  }
  if (!found) throw new Error(`findSynodicMonthContainingIngress: Rashi ${targetRashiIndex} not found within a year of ${searchFrom.toISOString()}.`);
  return classifySynodicMonth(findAmavasya(found.instant, -40), findAmavasya(found.instant, 40));
}
