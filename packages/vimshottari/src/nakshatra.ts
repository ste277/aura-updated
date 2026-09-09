/**
 * Vimshottari Dasha Engine V1 -- Nakshatra derivation from a known
 * sidereal Moon longitude.
 *
 * REUSES packages/vedic/src/panchangElements.ts's own NAKSHATRA_NAMES
 * array (Ashwini..Revati, Sanskrit) rather than declaring a second,
 * possibly-divergent name list -- "Do not create a conflicting Nakshatra
 * system." Does NOT reuse that file's own `getNakshatra(date: Date)`
 * function: that function computes today's Moon longitude itself (a
 * fresh ephemeris call), whereas this package must derive a Nakshatra
 * from an ALREADY-KNOWN longitude (GrahaPosition.siderealLongitude for
 * the natal Moon) without ever calling into an ephemeris itself -- see
 * README.md's "Do not introduce another ephemeris" requirement. The
 * underlying math is identical: span = 360/27, floor(longitude/span).
 *
 * INDEXING CONVENTION NOTE (audited, not a silent conflict -- see this
 * PR's own implementation report "Phase 0" section): this repository
 * already has an established 1-27 Nakshatra index convention elsewhere
 * (packages/vedic/src/natalChart.ts's own NatalContext.natalNakshatraIndex,
 * packages/recommendation/src/auraFitEngine.ts's own
 * PersonalMuhurtaContext.natalNakshatraIndex, both "1-27, matching
 * getNakshatra()"). This package's own VimshottariBirthNakshatra.index is
 * 0-26 instead, per THIS package's own brief. This is a NEW, independent
 * field on a NEW type in a NEW package -- it does not read, write, or
 * contradict either existing 1-27 field, and the underlying Nakshatra
 * BOUNDARIES/spans/names are byte-identical either way (same 13deg20'
 * spans, same NAKSHATRA_NAMES order, same 0deg-sidereal-Aries starting
 * point) -- only the display/array-index numbering differs. Flagged here
 * explicitly rather than silently chosen.
 */
import { NAKSHATRA_NAMES } from '../../vedic/src/panchangElements';
import { NAKSHATRA_SPAN_DEGREES, NAKSHATRA_COUNT, VIMSHOTTARI_SEQUENCE } from './constants';
import type { VimshottariLord } from './types';

/**
 * Normalizes a longitude into [0, 360).
 *
 * Deliberately NOT the naive `((deg % 360) + 360) % 360` pattern used
 * elsewhere in this repository (e.g. packages/bhrigu/src/normalize.ts) --
 * that double-modulo, while a correct general-purpose idiom, introduces
 * measurable floating-point precision loss even for a value ALREADY in
 * [0, 360) (confirmed empirically: `((40/3 % 360) + 360) % 360` differs
 * from `40/3` in its last few significant digits, enough to push an
 * EXACT Nakshatra-boundary longitude like 13deg20' a hair below its own
 * span and misclassify it into the wrong Nakshatra). Since every real
 * caller here already supplies an in-range sidereal longitude
 * (GrahaPosition.siderealLongitude is already normalized to [0, 360) by
 * packages/vedic/src/natalChart.ts), this is an identity for the
 * overwhelmingly common case -- the double-modulo fallback only runs for
 * a genuinely out-of-range input (negative, or >= 360), where exact
 * boundary precision was never at stake in the first place.
 */
export function normalizeLongitude(longitude: number): number {
  if (longitude >= 0 && longitude < 360) return longitude;
  return ((longitude % 360) + 360) % 360;
}

/**
 * 0-26 Nakshatra index for a given (already sidereal) longitude --
 * `Math.floor(normalizedLongitude / NAKSHATRA_SPAN_DEGREES)`, clamped
 * defensively to 26 for the exact-360deg/floating-point-boundary edge
 * case (a normalized longitude arbitrarily close to but below 360 could,
 * in principle, floor-divide to 27 under floating-point representation
 * error -- see README.md's own "Longitude boundary handling" section).
 * At an EXACT Nakshatra boundary (e.g. exactly 13deg20'), the result
 * belongs to the NEXT Nakshatra (Bharani, not Ashwini) -- floor()
 * already gives this for free: floor(13.333.../13.333...) = floor(1) = 1.
 */
export function nakshatraIndexFromLongitude(longitude: number): number {
  const normalized = normalizeLongitude(longitude);
  const index = Math.floor(normalized / NAKSHATRA_SPAN_DEGREES);
  return Math.min(index, NAKSHATRA_COUNT - 1);
}

export function nakshatraName(index: number): string {
  return NAKSHATRA_NAMES[index] ?? `Nakshatra ${index}`;
}

/**
 * The Nakshatra ruler sequence follows VIMSHOTTARI_SEQUENCE and repeats
 * every 9 Nakshatras (27 / 9 = 3 full repeats across the zodiac) --
 * Ashwini (index 0) -> VIMSHOTTARI_SEQUENCE[0] (Ketu), Magha (index 9,
 * 9 % 9 === 0) -> VIMSHOTTARI_SEQUENCE[0] (Ketu) again, Revati (index 26,
 * 26 % 9 === 8) -> VIMSHOTTARI_SEQUENCE[8] (Mercury).
 */
export function nakshatraLord(index: number): VimshottariLord {
  return VIMSHOTTARI_SEQUENCE[index % VIMSHOTTARI_SEQUENCE.length];
}

/**
 * How far into its own Nakshatra a longitude falls: `offset` in
 * [0, NAKSHATRA_SPAN_DEGREES), `fractionElapsed` in [0, 1),
 * `fractionRemaining = 1 - fractionElapsed`. Computed as
 * `normalizedLongitude - nakshatraIndex * span` (matching
 * packages/bhrigu/src/normalize.ts's own degreeInSign pattern) rather
 * than a modulo, for the same reason: consistent with the already-
 * clamped `nakshatraIndexFromLongitude` above rather than an
 * independently-computed `% span` that could disagree with it at a
 * floating-point boundary.
 */
export function nakshatraOffset(longitude: number): { index: number; offset: number; fractionElapsed: number; fractionRemaining: number } {
  const normalized = normalizeLongitude(longitude);
  const index = nakshatraIndexFromLongitude(longitude);
  const offset = normalized - index * NAKSHATRA_SPAN_DEGREES;
  const fractionElapsed = offset / NAKSHATRA_SPAN_DEGREES;
  return { index, offset, fractionElapsed, fractionRemaining: 1 - fractionElapsed };
}
