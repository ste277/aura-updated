/**
 * Marriage Muhurtham Required Eligibility V1: planetary combustion (Asta)
 * primitive for Jupiter (Guru) and Venus (Shukra).
 *
 * Source: Surya Siddhanta, Chapter 9 ("Udayastadhikara" -- "Of Heliacal
 * Risings and Settings"), verses 6-8 -- verified directly in the primary
 * text and corroborated by a professional Panchang engine's own stated
 * methodology (see the Methodology Resolution audit). NOT Brihat Parashara
 * Hora Shastra -- that popular attribution was investigated and refuted
 * (BPHS discusses combustion only qualitatively, no degree table found).
 *
 * Thresholds (degrees of angular separation from the Sun, below which the
 * planet is "Asta"/invisible/combust):
 *   Jupiter: 11 deg, no direct/retrograde distinction in the source text.
 *   Venus:   10 deg direct, 8 deg retrograde.
 * The VALUES themselves are Level A (directly quoted from Surya Siddhanta
 * 9.6-9.7). The exact direct<->retrograde MAPPING for Venus relies on a
 * modern Panchang engine's stated methodology rather than a fully
 * cross-checked classical-translation wording -- Level B for that specific
 * mapping, not fully-closed Level A. Documented here rather than hidden.
 *
 * V1 measurement convention: simple ecliptic-longitude difference (shortest
 * arc, 0-180 deg), NOT the full classical heliacal-visibility calculation.
 * Surya Siddhanta 9.16-9.18 itself shows the complete traditional method
 * applies further latitude/visibility corrections (ayanadrikkarma,
 * akshadrikkarma) on top of this base table -- a true heliacal-visibility
 * calculation, not simple subtraction. This module deliberately implements
 * only the simplified, degree-based convention (matching what modern
 * professional Panchang engines actually ship), not a physical visibility
 * model (altitude, atmospheric extinction, magnitude) -- an explicit,
 * documented simplification, not the complete classical method.
 */
import { Body } from 'astronomy-engine';
import { getSiderealLongitude } from './panchangElements';

export type CombustibleGraha = 'Jupiter' | 'Venus';

const COMBUSTION_THRESHOLD_DEGREES: Record<CombustibleGraha, { direct: number; retrograde: number }> = {
  Jupiter: { direct: 11, retrograde: 11 },
  Venus: { direct: 10, retrograde: 8 },
};

function grahaBody(graha: CombustibleGraha): Body {
  return graha === 'Jupiter' ? Body.Jupiter : Body.Venus;
}

/** Short enough to reliably capture Venus/Jupiter's own apparent motion
 * (direction changes over days, not hours) while long enough to avoid
 * numerical noise from the underlying ephemeris -- a documented, explicit
 * choice, not an arbitrary one. */
const RETROGRADE_SAMPLE_INTERVAL_HOURS = 6;

/**
 * Retrograde state via apparent geocentric sidereal longitude direction of
 * motion: compares longitude at `date` against a sample
 * RETROGRADE_SAMPLE_INTERVAL_HOURS earlier, normalizing the signed delta
 * across the 0/360 wrap. Deliberately NOT a naive `longitude(now) <
 * longitude(previous)` comparison -- that breaks near the 0/360 boundary,
 * where a planet moving normally forward can appear to have a smaller raw
 * longitude value than before.
 */
export function isRetrograde(graha: CombustibleGraha, date: Date): boolean {
  const body = grahaBody(graha);
  const now = getSiderealLongitude(body, date);
  const prior = getSiderealLongitude(body, new Date(date.getTime() - RETROGRADE_SAMPLE_INTERVAL_HOURS * 3600_000));
  let delta = now - prior;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta < 0;
}

/**
 * Shortest-arc angular separation between two ecliptic longitudes, 0-180
 * deg. Ayanamsa-invariant for this purpose: ayanamsa subtracts equally
 * from both bodies' sidereal longitudes, so their DIFFERENCE is identical
 * whether computed from sidereal or tropical inputs -- the same reasoning
 * packages/vedic/src/panchangElements.ts's own Tithi-transition doc
 * comment already establishes for Moon-Sun separation, verified again here
 * directly by test (test/marriageRequiredEligibility.test.ts), not merely
 * asserted.
 */
export function shortestAngularSeparation(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

export function angularSeparationFromSun(graha: CombustibleGraha, date: Date): number {
  const sunLongitude = getSiderealLongitude(Body.Sun, date);
  const grahaLongitude = getSiderealLongitude(grahaBody(graha), date);
  return shortestAngularSeparation(sunLongitude, grahaLongitude);
}

/**
 * Pure boundary predicate, deliberately separated from the ephemeris
 * lookup in isCombust() below so it can be unit-tested at exact degree
 * values (10.99/11/11.01, ...) without needing to locate a real instant
 * where the true angular separation happens to equal a threshold exactly.
 * Strict `<` -- matches Surya Siddhanta's own phrasing ("planets are
 * invisible closer than these distances"); at exactly the threshold, not
 * combust.
 */
export function isCombustAtSeparation(graha: CombustibleGraha, separationDegrees: number, retrograde: boolean): boolean {
  const thresholds = COMBUSTION_THRESHOLD_DEGREES[graha];
  const threshold = retrograde ? thresholds.retrograde : thresholds.direct;
  return separationDegrees < threshold;
}

export function isCombust(graha: CombustibleGraha, date: Date): boolean {
  return isCombustAtSeparation(graha, angularSeparationFromSun(graha, date), isRetrograde(graha, date));
}

/** 3 days is short enough that a combustion period (weeks long) can never
 * fully enter AND exit between two consecutive samples -- so a coarse
 * forward step at this granularity is guaranteed to detect the FIRST
 * transition, even when a second transition (e.g. entry then exit) also
 * falls within the overall search window. Checking only the two
 * window ENDPOINTS' states (as an earlier version of this function did)
 * is NOT sufficient: if the state exits and re-enters its starting value
 * before the window closes, the endpoints agree even though a transition
 * genuinely occurred in between -- caught by a real test in
 * test/marriageRequiredEligibility.test.ts (Guru's ~28-day Asta window
 * starting and ending non-combust within a 60-day search from just before
 * it). */
const COMBUSTION_STEP_MS = 3 * 86400_000;
const COMBUSTION_SEARCH_STEPS = 20; // 20 * 3 days = 60 days

/**
 * Finds the next instant after `date` at which `graha`'s combustion state
 * (per isCombust) changes -- entry into or exit from Asta. Coarse forward
 * stepping (COMBUSTION_STEP_MS) to bracket the FIRST transition, then
 * binary search within that bracket -- the same two-phase technique
 * packages/recommendation/src/muhurthamFinder.ts's boundary-augmentation
 * logic already uses elsewhere for a coarse-then-fine search, adapted here
 * because a single global binary search over the whole window (as Yoga's
 * simpler, always-exactly-one-transition-nearby search can get away with)
 * is not safe when TWO transitions can occur inside the window.
 */
export function findNextCombustionTransition(graha: CombustibleGraha, date: Date): Date {
  const startState = isCombust(graha, date);
  let bracketLow = date;
  let bracketHigh: Date | undefined;
  let cursor = date;
  for (let i = 0; i < COMBUSTION_SEARCH_STEPS; i++) {
    const next = new Date(cursor.getTime() + COMBUSTION_STEP_MS);
    if (isCombust(graha, next) !== startState) {
      bracketHigh = next;
      break;
    }
    bracketLow = next;
    cursor = next;
  }
  if (!bracketHigh) {
    throw new Error(`findNextCombustionTransition: no ${graha} combustion-state change found within ${COMBUSTION_SEARCH_STEPS * 3} days of ${date.toISOString()}.`);
  }
  let low = bracketLow.getTime();
  let high = bracketHigh.getTime();
  for (let i = 0; i < 30; i++) {
    const mid = Math.floor((low + high) / 2);
    if (isCombust(graha, new Date(mid)) === startState) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return new Date(high);
}
