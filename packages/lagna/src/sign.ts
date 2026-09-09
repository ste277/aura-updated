/**
 * Natal Ascendant / Lagna Foundation V1 -- longitude normalization and
 * Rashi (zodiac sign) reduction.
 */
import { RASHI_SPAN_DEGREES, RASHI_COUNT, RASHI_NAMES } from './constants';

/**
 * Normalizes a longitude into [0, 360).
 *
 * Deliberately an identity for any longitude already in [0, 360)
 * (the overwhelmingly common case for every real caller here), falling
 * back to the double-modulo idiom `((deg % 360) + 360) % 360` only for a
 * genuinely out-of-range input -- exactly the fix packages/vimshottari's
 * own nakshatra.ts discovered and applied in PR #97: the naive
 * double-modulo pattern measurably loses floating-point precision even
 * for an already-in-range value, which can misclassify an exact 30-degree
 * Rashi boundary into the wrong sign. This package independently
 * reproduces that same fix (rather than importing it, since
 * packages/vimshottari is not a dependency this package has any other
 * reason to take) -- see README.md's "Sign convention" section.
 */
export function normalize360(degrees: number): number {
  if (degrees >= 0 && degrees < 360) return degrees;
  return ((degrees % 360) + 360) % 360;
}

export interface RashiPlacement {
  rashiIndex: number;
  rashiName: string;
  degreeInRashi: number;
}

/**
 * Reduces an already-normalized-or-normalizable longitude into its Rashi
 * placement -- `rashiIndex = floor(longitude / 30)`, matching
 * packages/vedic/src/natalChart.ts's own `toRashiPlacement` exactly (see
 * constants.ts's own RASHI_NAMES doc comment for why the name array is a
 * local re-declaration rather than an import). `rashiIndex` is clamped
 * defensively to 11 for the exact-360-degree/floating-point-boundary edge
 * case, matching packages/vimshottari's own nakshatraIndexFromLongitude
 * clamp for the identical reason.
 */
export function toRashiPlacement(longitude: number): RashiPlacement {
  const normalized = normalize360(longitude);
  const rashiIndex = Math.min(Math.floor(normalized / RASHI_SPAN_DEGREES), RASHI_COUNT - 1);
  const degreeInRashi = normalized - rashiIndex * RASHI_SPAN_DEGREES;
  return { rashiIndex, rashiName: RASHI_NAMES[rashiIndex], degreeInRashi };
}
