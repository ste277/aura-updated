/**
 * Vimshottari Dasha Engine V1 -- duration arithmetic.
 *
 * The ONE canonical duration representation this whole engine uses:
 * integer epoch milliseconds. Never converts years -> days -> Date ->
 * years -> ... repeatedly, and never uses JavaScript calendar operations
 * (setFullYear, etc.) to represent a Dasha span -- see README.md's
 * "Precision" section.
 *
 * Exactness proof: VIMSHOTTARI_YEAR_MS (31_557_600_000) is itself an
 * exact integer (365.25 * 86_400_000 has no fractional remainder), and
 * VIMSHOTTARI_ANTARDASHA_UNIT_MS (= VIMSHOTTARI_YEAR_MS / 120 =
 * 262_980_000) is ALSO an exact integer (constants.ts's own doc comment
 * has the full derivation). Every Mahadasha duration is
 * `lordYears * VIMSHOTTARI_YEAR_MS` (product of two integers -- exact).
 * Every Antardasha duration is
 * `mahadashaLordYears * antardashaLordYears * VIMSHOTTARI_ANTARDASHA_UNIT_MS`
 * (product of three integers -- exact). Summing a Mahadasha's own 9
 * Antardasha durations therefore always reconstructs that Mahadasha's
 * own exact duration with ZERO floating-point rounding anywhere -- see
 * antardasha.ts's own doc comment and this suite's own exact-partition
 * tests. The one genuinely fractional value in this whole engine is the
 * birth-balance elapsed offset (mahadasha.ts) -- a real, continuous
 * quantity derived from the actual Moon longitude, rounded exactly once
 * at that single point (never re-derived independently downstream).
 */
import { VIMSHOTTARI_YEAR_MS, VIMSHOTTARI_ANTARDASHA_UNIT_MS, VIMSHOTTARI_YEARS } from './constants';
import type { VimshottariLord } from './types';

/** A lord's own full Mahadasha duration, in exact integer milliseconds. */
export function mahadashaDurationMs(lord: VimshottariLord): number {
  return VIMSHOTTARI_YEARS[lord] * VIMSHOTTARI_YEAR_MS;
}

/**
 * One Antardasha's exact duration within a given Mahadasha, in integer
 * milliseconds -- `mahadashaLordYears * antardashaLordYears * VIMSHOTTARI_ANTARDASHA_UNIT_MS`,
 * mathematically identical to the brief's own
 * `mahadashaDurationMs * antardashaYears / 120` (since
 * mahadashaDurationMs = mahadashaLordYears * VIMSHOTTARI_YEAR_MS and
 * VIMSHOTTARI_YEAR_MS / 120 = VIMSHOTTARI_ANTARDASHA_UNIT_MS exactly) but
 * computed as a product of three integers instead of a
 * multiply-then-divide, so it can never introduce floating-point
 * rounding in the first place -- see this file's own module doc comment.
 */
export function antardashaDurationMs(mahadashaLord: VimshottariLord, antardashaLord: VimshottariLord): number {
  return VIMSHOTTARI_YEARS[mahadashaLord] * VIMSHOTTARI_YEARS[antardashaLord] * VIMSHOTTARI_ANTARDASHA_UNIT_MS;
}

/** ISO-8601 UTC instant string for an integer epoch-millisecond value -- the one place this engine converts an internal ms value into the public string boundary representation. */
export function toIsoInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** Epoch milliseconds for an ISO-8601 instant string -- the inverse of toIsoInstant, used by engine.ts's own findMahadashaAt/findAntardashaAt to compare a period's own start/end against a caller-supplied query instant. */
export function fromIsoInstant(iso: string): number {
  return new Date(iso).getTime();
}
