/**
 * Natal chart planetary positions and Tara Bala (personalized daily favorability).
 *
 * Scope note: this covers planetary sign placements (a "D1 chart" in the loose
 * sense) and Tara Bala. It does NOT compute the Ascendant/Lagna or house cusps
 * (needs sidereal-time + latitude-dependent spherical trig — meaningfully more
 * machinery) or Vimshottari Dasha (planetary period system). Both are real,
 * separate scope — see README.
 */

import * as Astronomy from 'astronomy-engine';
import { lahiriAyanamsa, getNakshatra } from './panchangElements';

const RASHI_NAMES = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrishchika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
];

export type GrahaName = 'Sun' | 'Moon' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Rahu' | 'Ketu';

export interface GrahaPosition {
  graha: GrahaName;
  siderealLongitude: number;
  rashiIndex: number; // 0-11
  rashiName: string;
  degreeInRashi: number; // 0-30
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function toRashiPlacement(siderealLongitude: number): { rashiIndex: number; rashiName: string; degreeInRashi: number } {
  const rashiIndex = Math.floor(siderealLongitude / 30);
  const degreeInRashi = siderealLongitude - rashiIndex * 30;
  return { rashiIndex, rashiName: RASHI_NAMES[rashiIndex], degreeInRashi };
}

function getSiderealLongitude(body: Astronomy.Body, date: Date): number {
  const vector = body === Astronomy.Body.Moon ? Astronomy.GeoMoon(date) : Astronomy.GeoVector(body, date, true);
  const ecliptic = Astronomy.Ecliptic(vector);
  return normalizeDegrees(ecliptic.elon - lahiriAyanamsa(date));
}

/** All 9 classical grahas' sidereal positions at a given moment (birth or otherwise). */
export function getNatalChart(birthMomentUTC: Date): GrahaPosition[] {
  const classicalBodies: { graha: GrahaName; body: Astronomy.Body }[] = [
    { graha: 'Sun', body: Astronomy.Body.Sun },
    { graha: 'Moon', body: Astronomy.Body.Moon },
    { graha: 'Mercury', body: Astronomy.Body.Mercury },
    { graha: 'Venus', body: Astronomy.Body.Venus },
    { graha: 'Mars', body: Astronomy.Body.Mars },
    { graha: 'Jupiter', body: Astronomy.Body.Jupiter },
    { graha: 'Saturn', body: Astronomy.Body.Saturn },
  ];

  const positions: GrahaPosition[] = classicalBodies.map(({ graha, body }) => {
    const siderealLongitude = getSiderealLongitude(body, birthMomentUTC);
    return { graha, siderealLongitude, ...toRashiPlacement(siderealLongitude) };
  });

  // Rahu/Ketu: lunar nodes. astronomy-engine gives node *crossing events*, not a
  // direct longitude function, so we derive the current node longitude from the
  // Moon's ecliptic latitude crossing points via SearchMoonNode both directions.
  const rahuLongitude = getMeanLunarNodeLongitude(birthMomentUTC);
  const ketuLongitude = normalizeDegrees(rahuLongitude + 180);

  positions.push({ graha: 'Rahu', siderealLongitude: rahuLongitude, ...toRashiPlacement(rahuLongitude) });
  positions.push({ graha: 'Ketu', siderealLongitude: ketuLongitude, ...toRashiPlacement(ketuLongitude) });

  return positions;
}

/**
 * Mean lunar node longitude (Rahu, sidereal) via a standard polynomial
 * approximation (Meeus, "Astronomical Algorithms", ch. 47) rather than
 * astronomy-engine's true-node event search, since we need a longitude at an
 * arbitrary moment, not just crossing events. Mean node is standard for Vedic
 * astrology use (as opposed to "true node," which oscillates faster).
 */
function getMeanLunarNodeLongitude(date: Date): number {
  const J2000 = new Date('2000-01-01T12:00:00Z');
  const T = (date.getTime() - J2000.getTime()) / (36525 * 86400000); // Julian centuries since J2000
  const meanNodeTropical = normalizeDegrees(125.0445222 - 1934.1362608 * T);
  return normalizeDegrees(meanNodeTropical - lahiriAyanamsa(date));
}

export interface TaraBala {
  taraNumber: number; // 1-9
  name: string;
  favorable: boolean;
  natalNakshatraName: string;
  todayNakshatraName: string;
}

const TARA_NAMES = [
  'Janma', 'Sampat', 'Vipat', 'Kshema', 'Pratyak', 'Sadhaka', 'Vadha', 'Mitra', 'Ati-Mitra',
];
// Vipat (3), Pratyak (5), Vadha (7) are traditionally inauspicious; the rest favorable.
const UNFAVORABLE_TARA_NUMBERS = new Set([3, 5, 7]);

/** Tara Bala: today's favorability relative to the person's own birth nakshatra —
 * a real, well-defined "personalized auspicious window" concept, distinct from
 * the generic (non-personalized) panchang elements. */
export function getTaraBala(natalNakshatraIndex: number, today: Date): TaraBala {
  const todayNakshatra = getNakshatra(today);
  // Count inclusive from natal nakshatra (1) to today's, wrapping through 27.
  const distance = ((todayNakshatra.index - natalNakshatraIndex + 27) % 27) + 1;
  const taraNumber = ((distance - 1) % 9) + 1;

  const NAKSHATRA_NAMES_LOCAL = [
    'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu',
    'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta',
    'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha',
    'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada',
    'Uttara Bhadrapada', 'Revati',
  ];

  return {
    taraNumber,
    name: TARA_NAMES[taraNumber - 1],
    favorable: !UNFAVORABLE_TARA_NUMBERS.has(taraNumber),
    natalNakshatraName: NAKSHATRA_NAMES_LOCAL[natalNakshatraIndex],
    todayNakshatraName: todayNakshatra.name,
  };
}
