/**
 * Vimshottari Dasha Engine V1 -- constants.
 *
 * Repository audit (see ../README.md's "Convention" section and this PR's
 * own implementation report for the full trace): no Dasha/Vimshottari
 * calculation exists anywhere else in this repository prior to this
 * package (confirmed by a repo-wide search for "dasha"/"vimshottari" --
 * every existing hit is either an unrelated Tithi name coincidence
 * ("Dashami", the 10th tithi), a doc comment explicitly noting Dasha is
 * NOT_IMPLEMENTED anywhere, or packages/personal-intelligence's own
 * forward-looking `LifePeriodContext.system: 'VIMSHOTTARI_DASHA'`
 * placeholder -- which this package is the first real producer for).
 * There is therefore no existing year-length/boundary convention this
 * package could silently conflict with; the V1 convention below is a new,
 * explicit, versioned choice.
 */
import type { GrahaName } from '../../vedic/src/natalChart';

/**
 * V1 Vimshottari year length: 365.25 days. A calculation convention, not
 * a claim that every tradition/software uses this same year basis --
 * see README.md's own "Convention" section. Deliberately NOT computed via
 * JavaScript calendar operations (setFullYear, etc.) -- Dasha durations
 * are deterministic elapsed-time arithmetic, immune to calendar
 * peculiarities (leap years, DST, host timezone).
 */
export const VIMSHOTTARI_YEAR_DAYS = 365.25;

/**
 * 365.25 days in milliseconds -- an EXACT integer (365.25 * 86_400_000 =
 * 31_557_600_000, no floating-point remainder), verified by
 * test/vimshottariDashaEngine.test.ts's own dedicated check.
 */
export const VIMSHOTTARI_YEAR_MS = 31_557_600_000;

/**
 * VIMSHOTTARI_YEAR_MS / 120 -- also an EXACT integer (262_980_000). This
 * is the key fact duration.ts's own antardashaDurationMs relies on: since
 * this unit is itself a whole number of milliseconds, EVERY Antardasha
 * duration (mahadashaLordYears * antardashaLordYears * this unit) is an
 * exact integer with zero floating-point rounding anywhere, for every one
 * of the 81 Antardashas across a full 9-Mahadasha V1 cycle -- see
 * duration.ts's own module doc comment for the full derivation.
 */
export const VIMSHOTTARI_ANTARDASHA_UNIT_MS = VIMSHOTTARI_YEAR_MS / 120;

/**
 * The fixed Vimshottari planet sequence -- do not reorder. Both the
 * Mahadasha rotation and each Mahadasha's own internal Antardasha
 * rotation (starting from that Mahadasha's own lord) follow this exact
 * order, repeating. Also the Nakshatra-ruler repeating-every-9 sequence
 * (nakshatra.ts) -- Ashwini's ruler (index 0) is this array's own first
 * entry, Magha's ruler (index 9) is this same first entry again, etc.
 */
export const VIMSHOTTARI_SEQUENCE: readonly GrahaName[] = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];

/**
 * Each lord's own Mahadasha duration in years -- the standard 120-year
 * Vimshottari table. Sum is exactly 120 (verified by test).
 */
export const VIMSHOTTARI_YEARS: Readonly<Record<GrahaName, number>> = {
  Ketu: 7,
  Venus: 20,
  Sun: 6,
  Moon: 10,
  Mars: 7,
  Rahu: 18,
  Jupiter: 16,
  Saturn: 19,
  Mercury: 17,
};

/**
 * 27 equal Nakshatras over the sidereal zodiac -- 360/27, a DERIVED
 * constant rather than a fragile decimal literal (13.333...), so no
 * hand-typed approximation of 13⅓° ever silently drifts from the exact
 * fraction -- see nakshatra.ts and README.md's own "Longitude boundary
 * handling" section.
 */
export const NAKSHATRA_SPAN_DEGREES = 360 / 27;

/** How many Nakshatras a Vimshottari ruler-lord cycle spans before repeating (9 lords -> ruler repeats every 9 Nakshatras: 27 / 9 = 3 full repeats across the zodiac). */
export const NAKSHATRA_COUNT = 27;

/** One full Vimshottari cycle: all 9 Mahadashas, in sequence, sum to VIMSHOTTARI_MIN_COVERAGE_YEARS. */
export const MAHADASHA_COUNT_PER_CYCLE = VIMSHOTTARI_SEQUENCE.length;

/** Every Mahadasha always has exactly 9 Antardashas (one per Vimshottari lord, starting from the Mahadasha's own lord). */
export const ANTARDASHA_COUNT_PER_MAHADASHA = VIMSHOTTARI_SEQUENCE.length;

/**
 * The minimum number of Vimshottari years of Mahadasha/Antardasha
 * coverage this engine guarantees AFTER the supplied birth moment --
 * one full 120-year cycle. This is a coverage guarantee, not a count of
 * generated Mahadashas: mahadasha.ts's own generateMahadashaCycle keeps
 * generating complete Mahadashas (wrapping VIMSHOTTARI_SEQUENCE as many
 * times as needed) until the timeline reaches
 * `birthMomentMs + VIMSHOTTARI_MIN_COVERAGE_MS`, which -- because the
 * birth Mahadasha's own TRUE start typically precedes birth -- usually
 * requires MORE than 9 generated Mahadashas (the starting lord's own
 * Mahadasha reappears partway through generation). See mahadasha.ts and
 * README.md's own "Coverage" section.
 */
export const VIMSHOTTARI_MIN_COVERAGE_YEARS = 120;

/** VIMSHOTTARI_MIN_COVERAGE_YEARS expressed in exact integer milliseconds. */
export const VIMSHOTTARI_MIN_COVERAGE_MS = VIMSHOTTARI_MIN_COVERAGE_YEARS * VIMSHOTTARI_YEAR_MS;
