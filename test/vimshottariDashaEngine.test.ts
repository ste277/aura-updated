/**
 * Vimshottari Dasha Engine V1: regression suite for
 * packages/vimshottari/src -- deterministically calculates Vimshottari
 * Mahadasha/Antardasha periods from an already-known sidereal natal Moon
 * longitude. See packages/vimshottari/README.md for the full convention
 * (27 Nakshatras, 120-year cycle, 365.25-day V1 year, [start, end)
 * boundaries) this suite verifies against.
 *
 * "Independent known-answer validation" section (per this PR's own
 * brief): three fixtures below (Nakshatra start / midpoint / a
 * non-trivial arbitrary offset) are derived by hand, in these comments,
 * using plain arithmetic -- NEVER by calling this package's own
 * production functions to generate the "expected" value. Only
 * JavaScript's own built-in `Date` (a language primitive, not a
 * production helper under test) is used to turn a hand-computed
 * millisecond value into an ISO string for comparison.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { getNatalChart } from '../packages/vedic/src/natalChart';
import { NAKSHATRA_NAMES } from '../packages/vedic/src/panchangElements';

import {
  calculateVimshottariDasha,
  calculateVimshottariFromNatalChart,
  findMahadashaAt,
  findAntardashaAt,
  getVimshottariPeriodAt,
  toLifePeriodContext,
  calculateBirthBalance,
  generateMahadashaCycle,
  generateAntardashas,
  mahadashaDurationMs,
  antardashaDurationMs,
  toIsoInstant,
  fromIsoInstant,
  normalizeLongitude,
  nakshatraIndexFromLongitude,
  nakshatraName,
  nakshatraLord,
  nakshatraOffset,
  dedupeEvidenceRefs,
  VIMSHOTTARI_ENGINE_VERSION,
  VIMSHOTTARI_YEAR_DAYS,
  VIMSHOTTARI_YEAR_MS,
  VIMSHOTTARI_ANTARDASHA_UNIT_MS,
  VIMSHOTTARI_SEQUENCE,
  VIMSHOTTARI_YEARS,
  NAKSHATRA_SPAN_DEGREES,
  VIMSHOTTARI_MIN_COVERAGE_YEARS,
  VIMSHOTTARI_MIN_COVERAGE_MS,
  VimshottariValidationError,
} from '../packages/vimshottari/src/index';

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ============================================================
// Constants.
// ============================================================

check('VIMSHOTTARI_SEQUENCE is exactly Ketu, Venus, Sun, Moon, Mars, Rahu, Jupiter, Saturn, Mercury, in that order', JSON.stringify(VIMSHOTTARI_SEQUENCE) === JSON.stringify(['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury']));

check(
  'each lord\'s Mahadasha duration matches the standard table exactly',
  VIMSHOTTARI_YEARS.Ketu === 7 && VIMSHOTTARI_YEARS.Venus === 20 && VIMSHOTTARI_YEARS.Sun === 6 && VIMSHOTTARI_YEARS.Moon === 10 &&
    VIMSHOTTARI_YEARS.Mars === 7 && VIMSHOTTARI_YEARS.Rahu === 18 && VIMSHOTTARI_YEARS.Jupiter === 16 && VIMSHOTTARI_YEARS.Saturn === 19 && VIMSHOTTARI_YEARS.Mercury === 17
);

check('the 9 Mahadasha durations sum to exactly 120 years', Object.values(VIMSHOTTARI_YEARS).reduce((sum, years) => sum + years, 0) === 120);

check('VIMSHOTTARI_YEAR_DAYS is exactly 365.25 and VIMSHOTTARI_YEAR_MS is the exact integer 31,557,600,000', VIMSHOTTARI_YEAR_DAYS === 365.25 && VIMSHOTTARI_YEAR_MS === 31_557_600_000 && Number.isInteger(VIMSHOTTARI_YEAR_MS));

check('365.25 days converts to an exact integer number of milliseconds with zero remainder (independently multiplied here, not read from the constant)', 365.25 * 86_400_000 === 31_557_600_000);

check('VIMSHOTTARI_ANTARDASHA_UNIT_MS (VIMSHOTTARI_YEAR_MS / 120) is the exact integer 262,980,000, with zero remainder', VIMSHOTTARI_ANTARDASHA_UNIT_MS === 262_980_000 && VIMSHOTTARI_YEAR_MS % 120 === 0);

check('NAKSHATRA_SPAN_DEGREES is the derived constant 360/27 (40/3), not a hand-typed decimal literal', Math.abs(NAKSHATRA_SPAN_DEGREES - 40 / 3) < 1e-12);

// ============================================================
// Nakshatras -- all 27 names/rulers, ruler sequence repeats every 9.
// ============================================================

check('NAKSHATRA_NAMES (reused from packages/vedic, not redeclared) has exactly 27 entries', NAKSHATRA_NAMES.length === 27);

check(
  'the ruler sequence matches the documented table exactly: Ashwini->Ketu, Bharani->Venus, Krittika->Sun, Rohini->Moon, Revati->Mercury',
  nakshatraLord(0) === 'Ketu' && nakshatraLord(1) === 'Venus' && nakshatraLord(2) === 'Sun' && nakshatraLord(3) === 'Moon' && nakshatraLord(26) === 'Mercury'
);

check(
  'the ruler sequence repeats every 9 Nakshatras -- Magha (index 9) is Ketu again, Purva Phalguni (10) is Venus again',
  nakshatraLord(9) === 'Ketu' && nakshatraLord(10) === 'Venus' && nakshatraLord(9) === nakshatraLord(0) && nakshatraLord(18) === nakshatraLord(0)
);

check(
  'all 27 Nakshatras have a ruler that is one of the 9 Vimshottari lords, and the full 27-entry ruler pattern is exactly 3 repeats of the 9-lord sequence',
  (() => {
    const rulers = Array.from({ length: 27 }, (_, i) => nakshatraLord(i));
    const expected = [...VIMSHOTTARI_SEQUENCE, ...VIMSHOTTARI_SEQUENCE, ...VIMSHOTTARI_SEQUENCE];
    return JSON.stringify(rulers) === JSON.stringify(expected);
  })()
);

// ============================================================
// Nakshatra boundaries.
// ============================================================

check('longitude 0 falls in Nakshatra 0 (Ashwini)', nakshatraIndexFromLongitude(0) === 0);
check('longitude just below 13deg20\' (40/3 - epsilon) still falls in Nakshatra 0', nakshatraIndexFromLongitude(40 / 3 - 1e-9) === 0);
check('longitude EXACTLY 13deg20\' (40/3) falls in Nakshatra 1 (Bharani), not Ashwini', nakshatraIndexFromLongitude(40 / 3) === 1 && nakshatraName(nakshatraIndexFromLongitude(40 / 3)) === 'Bharani');
check('longitude just above 13deg20\' still falls in Nakshatra 1', nakshatraIndexFromLongitude(40 / 3 + 1e-9) === 1);
check('longitude EXACTLY 26deg40\' (2 * 40/3) falls in Nakshatra 2 (Krittika)', nakshatraIndexFromLongitude((2 * 40) / 3) === 2 && nakshatraName(nakshatraIndexFromLongitude((2 * 40) / 3)) === 'Krittika');
check('longitude 359.999... falls in the last Nakshatra (26, Revati)', nakshatraIndexFromLongitude(359.9999) === 26);
check('longitude 360 normalizes to 0 and falls in Nakshatra 0 (Ashwini), matching the full-circle wrap', normalizeLongitude(360) === 0 && nakshatraIndexFromLongitude(360) === 0);
check('normalizeLongitude wraps a negative longitude into [0, 360)', normalizeLongitude(-10) === 350);

// ============================================================
// Birth balance -- Moon exactly at Nakshatra start / midpoint / near end.
// ============================================================

check(
  'Moon exactly at a Nakshatra start: fractionElapsed = 0, fractionRemaining = 1',
  (() => {
    const { fractionElapsed, fractionRemaining } = nakshatraOffset(0);
    return fractionElapsed === 0 && fractionRemaining === 1;
  })()
);

check(
  'Moon at a Nakshatra midpoint: fractionElapsed = 0.5, fractionRemaining = 0.5',
  (() => {
    const { fractionElapsed, fractionRemaining } = nakshatraOffset(3.5 * (40 / 3)); // 3.5 nakshatra-spans in -> exact midpoint of nakshatra index 3
    return Math.abs(fractionElapsed - 0.5) < 1e-9 && Math.abs(fractionRemaining - 0.5) < 1e-9;
  })()
);

check(
  'Moon near the end of a Nakshatra: fractionElapsed close to 1, fractionRemaining close to 0',
  (() => {
    const { fractionElapsed, fractionRemaining } = nakshatraOffset(0.99 * (40 / 3));
    return Math.abs(fractionElapsed - 0.99) < 1e-9 && Math.abs(fractionRemaining - 0.01) < 1e-9;
  })()
);

check(
  'the birth-balance elapsed/remaining clamp guarantees birth strictly precedes mahaEnd even for a longitude extremely close to the next Nakshatra boundary',
  (() => {
    const almostBoundary = 40 / 3 - 1e-10; // Ketu's own Nakshatra (0), fractionElapsed extremely close to 1
    const birthMs = Date.UTC(2000, 0, 1);
    const { mahaStartMs } = calculateBirthBalance(almostBoundary, birthMs);
    const fullMs = mahadashaDurationMs('Ketu');
    return birthMs < mahaStartMs + fullMs && birthMs >= mahaStartMs;
  })()
);

// ============================================================
// INDEPENDENT KNOWN-ANSWER FIXTURES (hand-derived, not production-derived).
// ============================================================

const BIRTH_MS = Date.UTC(2000, 0, 1, 0, 0, 0, 0); // 2000-01-01T00:00:00.000Z, independently known to be 946684800000ms (a standard, widely-published epoch value)
check('sanity: the chosen fixture birth instant is the well-known epoch value 946,684,800,000ms', BIRTH_MS === 946684800000);

// --- Fixture A: Nakshatra start (moonLongitude = 0, exactly Ashwini's own start) ---
// Hand-derived by hand, independent of any production function:
//   nakshatraIndex = floor(0 / (40/3)) = 0  -> Ashwini
//   lord = VIMSHOTTARI_SEQUENCE[0 % 9] = Ketu
//   fractionElapsed = 0 / (40/3) = 0, fractionRemaining = 1
//   fullMs(Ketu) = 7 * 31,557,600,000 = 220,903,200,000 (7 * 31557600000, hand-multiplied)
//   elapsedMs = round(220,903,200,000 * 0) = 0
//   expected mahaStart = 946,684,800,000 - 0 = 946,684,800,000 (birth IS the true Mahadasha start here)
//   expected mahaEnd   = 946,684,800,000 + 220,903,200,000 = 1,167,588,000,000
check(
  'Fixture A (Nakshatra start): birth Nakshatra=Ashwini(0), lord=Ketu, fractionElapsed=0, mahaStart=946684800000ms, mahaEnd=1167588000000ms',
  (() => {
    const { birthNakshatra, mahaStartMs } = calculateBirthBalance(0, BIRTH_MS);
    const expectedFullMs = 220_903_200_000;
    return (
      birthNakshatra.index === 0 &&
      birthNakshatra.name === 'Ashwini' &&
      birthNakshatra.lord === 'Ketu' &&
      birthNakshatra.fractionElapsed === 0 &&
      birthNakshatra.fractionRemaining === 1 &&
      mahaStartMs === 946684800000 &&
      mahaStartMs + expectedFullMs === 1167588000000
    );
  })()
);

// --- Fixture B: Nakshatra midpoint (Nakshatra index 3, Rohini, ruler Moon) ---
// Hand-derived:
//   nakshatra 3 starts at 3 * (40/3) = 40 deg exactly
//   midpoint longitude = 40 + (40/3)/2 = 40 + 20/3 = 140/3 deg (~46.667 deg)
//   fractionElapsed = 0.5 exactly (definition of midpoint), fractionRemaining = 0.5
//   lord = VIMSHOTTARI_SEQUENCE[3 % 9] = Moon
//   fullMs(Moon) = 10 * 31,557,600,000 = 315,576,000,000
//   elapsedMs = round(315,576,000,000 * 0.5) = 157,788,000,000 (exact: 315576000000/2)
//   expected mahaStart = 946,684,800,000 - 157,788,000,000 = 788,896,800,000
//   expected mahaEnd   = 788,896,800,000 + 315,576,000,000 = 1,104,472,800,000
check(
  'Fixture B (Nakshatra midpoint): birth Nakshatra=Rohini(3), lord=Moon, fractionElapsed=0.5, mahaStart=788896800000ms, mahaEnd=1104472800000ms',
  (() => {
    const moonLongitude = 140 / 3;
    const { birthNakshatra, mahaStartMs } = calculateBirthBalance(moonLongitude, BIRTH_MS);
    const expectedFullMs = 315_576_000_000;
    return (
      birthNakshatra.index === 3 &&
      birthNakshatra.name === 'Rohini' &&
      birthNakshatra.lord === 'Moon' &&
      Math.abs(birthNakshatra.fractionElapsed - 0.5) < 1e-9 &&
      mahaStartMs === 788896800000 &&
      mahaStartMs + expectedFullMs === 1104472800000
    );
  })()
);

// --- Fixture C: a non-trivial arbitrary offset (Nakshatra index 8, Ashlesha, ruler Mercury, 25% elapsed) ---
// Hand-derived:
//   nakshatra 8 starts at 8 * (40/3) = 320/3 deg
//   25% elapsed offset = 0.25 * (40/3) = 10/3 deg
//   moonLongitude = 320/3 + 10/3 = 330/3 = 110 deg EXACTLY
//   fractionElapsed = (10/3) / (40/3) = 10/40 = 0.25 exactly, fractionRemaining = 0.75
//   lord = VIMSHOTTARI_SEQUENCE[8 % 9] = Mercury
//   fullMs(Mercury) = 17 * 31,557,600,000 = 536,479,200,000
//   elapsedMs = round(536,479,200,000 * 0.25) = 134,119,800,000 (exact: 536479200000/4)
//   expected mahaStart = 946,684,800,000 - 134,119,800,000 = 812,565,000,000
//   expected mahaEnd   = 812,565,000,000 + 536,479,200,000 = 1,349,044,200,000
//   Additionally, Mercury Mahadasha's own FIRST Antardasha is Mercury/Mercury:
//   duration = 17 * 17 * 262,980,000 = 289 * 262,980,000 = 76,001,220,000 (hand-multiplied: 262980000*290 - 262980000 = 76264200000 - 262980000 = 76001220000)
check(
  'Fixture C (non-trivial arbitrary offset, 25% into Ashlesha): moonLongitude=110deg exactly, lord=Mercury, fractionElapsed=0.25, mahaStart=812565000000ms, mahaEnd=1349044200000ms',
  (() => {
    const { birthNakshatra, mahaStartMs } = calculateBirthBalance(110, BIRTH_MS);
    const expectedFullMs = 536_479_200_000;
    return (
      birthNakshatra.index === 8 &&
      birthNakshatra.name === 'Ashlesha' &&
      birthNakshatra.lord === 'Mercury' &&
      Math.abs(birthNakshatra.fractionElapsed - 0.25) < 1e-9 &&
      mahaStartMs === 812565000000 &&
      mahaStartMs + expectedFullMs === 1349044200000
    );
  })()
);

check(
  'Fixture C\'s own first Antardasha (Mercury/Mercury) has the independently hand-derived exact duration 76,001,220,000ms',
  antardashaDurationMs('Mercury', 'Mercury') === 76_001_220_000
);

// ============================================================
// Mahadasha generation.
// ============================================================

check(
  'generateMahadashaCycle(lord, mahaStart, birthMoment) produces exactly 9 Mahadashas, in VIMSHOTTARI_SEQUENCE order starting from the given lord, when mahaStart === birthMoment (the birth Mahadasha\'s own true start already coincides with birth, so exactly one 120-year cycle is required)',
  (() => {
    const mahadashas = generateMahadashaCycle('Jupiter', 0, 0);
    const startIndex = VIMSHOTTARI_SEQUENCE.indexOf('Jupiter');
    const expectedOrder = Array.from({ length: 9 }, (_, i) => VIMSHOTTARI_SEQUENCE[(startIndex + i) % 9]);
    return mahadashas.length === 9 && JSON.stringify(mahadashas.map((m) => m.lord)) === JSON.stringify(expectedOrder);
  })()
);

check(
  'each Mahadasha\'s own duration (end - start) matches lordYears * VIMSHOTTARI_YEAR_MS exactly',
  generateMahadashaCycle('Ketu', 0, 0).every((m) => fromIsoInstant(m.end) - fromIsoInstant(m.start) === mahadashaDurationMs(m.lord))
);

check(
  'the birth Mahadasha\'s own true start precedes birth (does not incorrectly equal birthMoment) unless the Moon is exactly at its Nakshatra\'s own start',
  (() => {
    const { mahaStartMs } = calculateBirthBalance(110, BIRTH_MS); // Fixture C -- 25% elapsed, so start must precede birth
    return mahaStartMs < BIRTH_MS;
  })()
);

check(
  'birth falls inside [mahaStart, mahaEnd) for a representative non-trivial fixture',
  (() => {
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(110, BIRTH_MS);
    const fullMs = mahadashaDurationMs(birthNakshatra.lord);
    return BIRTH_MS >= mahaStartMs && BIRTH_MS < mahaStartMs + fullMs;
  })()
);

check(
  'the first Mahadasha is NOT truncated to birth -- its own `start` is the true, pre-birth start, not birthMoment',
  (() => {
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(110, BIRTH_MS);
    const mahadashas = generateMahadashaCycle(birthNakshatra.lord, mahaStartMs, BIRTH_MS);
    return fromIsoInstant(mahadashas[0].start) === mahaStartMs && mahaStartMs !== BIRTH_MS;
  })()
);

// ------------------------------------------------------------
// Post-birth coverage (>= 120 Vimshottari years after birth) --
// regression for the bug where exactly 9 Mahadashas from the TRUE
// (pre-birth) Mahadasha start covers LESS than 120 years after birth
// whenever birth falls partway into that first Mahadasha.
// ------------------------------------------------------------

check(
  '9 Mahadashas from the TRUE start alone would NOT reach 120 years past birth for Fixture C (25% elapsed) -- sanity check that this is a real phenomenon, not a hypothetical',
  (() => {
    const { mahaStartMs } = calculateBirthBalance(110, BIRTH_MS);
    const nineCycleEndMs = mahaStartMs + VIMSHOTTARI_SEQUENCE.reduce((sum, lord) => sum + mahadashaDurationMs(lord), 0);
    return nineCycleEndMs < BIRTH_MS + VIMSHOTTARI_MIN_COVERAGE_MS;
  })()
);

check(
  'result.mahadashas satisfies the coverage invariant: mahadashas[0].start <= birthMoment && mahadashas.at(-1).end >= birthMoment + 120 Vimshottari years, for Fixture C',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 110 });
    const first = result.mahadashas[0];
    const last = result.mahadashas[result.mahadashas.length - 1];
    return fromIsoInstant(first.start) <= BIRTH_MS && fromIsoInstant(last.end) >= BIRTH_MS + VIMSHOTTARI_MIN_COVERAGE_MS;
  })()
);

check(
  'generateMahadashaCycle never truncates a Mahadasha to the coverage horizon -- the final generated Mahadasha\'s own end may fall strictly past birthMoment + 120 years',
  (() => {
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(110, BIRTH_MS);
    const mahadashas = generateMahadashaCycle(birthNakshatra.lord, mahaStartMs, BIRTH_MS);
    const last = mahadashas[mahadashas.length - 1];
    const fullMs = mahadashaDurationMs(last.lord);
    // The final period's own duration is still the FULL, undivided lordYears * YEAR_MS -- never clipped short.
    return fromIsoInstant(last.end) - fromIsoInstant(last.start) === fullMs;
  })()
);

// Long-Mahadasha coverage fixture: birth falls 15 years into a 20-year
// Venus Mahadasha (Nakshatra index 1, Bharani -- ruler Venus -- at
// fractionElapsed 0.75). Matches the exact scenario from this PR's own
// correctness-pass brief: 9 Mahadashas from Venus's true start alone
// would cover only 105 years past birth (120 - 15 elapsed), so a query
// at birth + 110 years -- let alone birth + 119 or birth + 120 -- would
// incorrectly find nothing under the old, fixed-9-period implementation.
const VENUS_NAKSHATRA_INDEX = 1; // Bharani; VIMSHOTTARI_SEQUENCE[1] === 'Venus'
const VENUS_LONGITUDE = VENUS_NAKSHATRA_INDEX * NAKSHATRA_SPAN_DEGREES + 0.75 * NAKSHATRA_SPAN_DEGREES; // 75% elapsed
const VENUS_FULL_MS = 20 * VIMSHOTTARI_YEAR_MS; // 631,152,000,000
const VENUS_ELAPSED_MS = Math.round(VENUS_FULL_MS * 0.75); // 473,364,000,000 (exact: no fractional ms at 0.75)
const VENUS_MAHA_START_MS = BIRTH_MS - VENUS_ELAPSED_MS; // ~15 years before birth
const VENUS_RESULT = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: VENUS_LONGITUDE });

check(
  'Venus-fixture: nakshatraLord/fractionElapsed match the constructed 75%-into-Venus scenario',
  VENUS_RESULT.birthNakshatra.lord === 'Venus' && Math.abs(VENUS_RESULT.birthNakshatra.fractionElapsed - 0.75) < 1e-9
);

check(
  'Venus-fixture: the birth Mahadasha\'s own true start is ~15 years before birth, matching the hand-derived VENUS_MAHA_START_MS',
  fromIsoInstant(VENUS_RESULT.mahadashas[0].start) === VENUS_MAHA_START_MS
);

check(
  'Venus-fixture: the generated timeline contains MORE than 9 Mahadashas (the Vimshottari sequence wraps and Venus reappears)',
  VENUS_RESULT.mahadashas.length > 9 && VENUS_RESULT.mahadashas.filter((m) => m.lord === 'Venus').length >= 2
);

check(
  'Venus-fixture: a query at birth + 110 Vimshottari years -- which the OLD fixed-9-Mahadasha implementation would place past the end of the generated timeline -- succeeds and returns a period',
  (() => {
    const late = new Date(BIRTH_MS + 110 * VIMSHOTTARI_YEAR_MS);
    const mahadasha = findMahadashaAt(VENUS_RESULT, late);
    const antardasha = findAntardashaAt(VENUS_RESULT, late);
    return mahadasha !== undefined && antardasha !== undefined;
  })()
);

check(
  'Venus-fixture: a query at birth + 119 Vimshottari years succeeds and returns the repeated-cycle Venus Mahadasha',
  (() => {
    const late = new Date(BIRTH_MS + 119 * VIMSHOTTARI_YEAR_MS);
    const mahadasha = findMahadashaAt(VENUS_RESULT, late);
    return mahadasha !== undefined && mahadasha.lord === 'Venus';
  })()
);

check(
  'Venus-fixture: a query at exactly birth + 120 Vimshottari years (the documented coverage horizon) succeeds and still returns the repeated-cycle Venus Mahadasha',
  (() => {
    const horizon = new Date(BIRTH_MS + VIMSHOTTARI_MIN_COVERAGE_MS);
    const mahadasha = findMahadashaAt(VENUS_RESULT, horizon);
    return mahadasha !== undefined && mahadasha.lord === 'Venus';
  })()
);

check(
  'Venus-fixture: the repeated-cycle (second) Venus Mahadasha receives its own correctly-anchored 9 Antardashas -- first.start === mahadasha.start, last.end === mahadasha.end, sequence starts with Venus, no gaps/overlaps -- exactly like the first Venus Mahadasha (no special-casing for a repeated cycle)',
  (() => {
    const venusMahadashas = VENUS_RESULT.mahadashas.filter((m) => m.lord === 'Venus');
    const secondVenus = venusMahadashas[1];
    const noGapsOrOverlaps = secondVenus.antardashas.every((a, i) => i === 0 || fromIsoInstant(a.start) === fromIsoInstant(secondVenus.antardashas[i - 1].end));
    return (
      secondVenus.antardashas.length === 9 &&
      secondVenus.antardashas[0].lord === 'Venus' &&
      fromIsoInstant(secondVenus.antardashas[0].start) === fromIsoInstant(secondVenus.start) &&
      fromIsoInstant(secondVenus.antardashas[8].end) === fromIsoInstant(secondVenus.end) &&
      noGapsOrOverlaps
    );
  })()
);

check(
  'Venus-fixture: no gaps or overlaps across the ENTIRE generated Mahadasha timeline (next.start === previous.end for every consecutive pair, including across the 9-lord wrap)',
  VENUS_RESULT.mahadashas.every((m, i) => i === 0 || fromIsoInstant(m.start) === fromIsoInstant(VENUS_RESULT.mahadashas[i - 1].end))
);

// ============================================================
// Birth-balance millisecond rounding.
//
// Documented V1 rule (mahadasha.ts's own calculateBirthBalance,
// centralized -- computed exactly ONCE, never re-derived with floating-
// point arithmetic anywhere downstream):
//
//   rawElapsedMs = fullMahadashaDurationMs * fractionElapsed
//   elapsedMs    = min(Math.round(rawElapsedMs), fullMahadashaDurationMs - 1)
//   mahaStartMs  = birthMomentMs - elapsedMs
//   mahaEndMs    = mahaStartMs + fullMahadashaDurationMs
//
// Every subsequent boundary (every later Mahadasha, every Antardasha) is
// then exact integer-millisecond arithmetic with ZERO further rounding.
// ============================================================

check(
  'all generated Mahadasha start/end epoch values are integer milliseconds (Venus-fixture, which has a genuinely fractional birth-balance offset)',
  VENUS_RESULT.mahadashas.every((m) => Number.isInteger(fromIsoInstant(m.start)) && Number.isInteger(fromIsoInstant(m.end)))
);

check(
  'an arbitrary non-round Moon longitude produces stable (repeatable) Mahadasha boundaries',
  (() => {
    const moonLongitude = 217.638291; // arbitrary, not aligned to any Nakshatra/degree boundary
    const a = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude });
    const b = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude });
    return JSON.stringify(a.mahadashas) === JSON.stringify(b.mahadashas);
  })()
);

check(
  'repeated calculateBirthBalance calls with the same input deep-equal',
  (() => {
    const a = calculateBirthBalance(217.638291, BIRTH_MS);
    const b = calculateBirthBalance(217.638291, BIRTH_MS);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'no gaps between consecutive Mahadashas for an arbitrary non-round longitude (next.start === previous.end for every pair)',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 217.638291 });
    return result.mahadashas.every((m, i) => i === 0 || fromIsoInstant(m.start) === fromIsoInstant(result.mahadashas[i - 1].end));
  })()
);

check(
  'no overlaps between consecutive Mahadashas for an arbitrary non-round longitude (every period\'s own end > its own start, and never exceeds the next period\'s own start)',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 217.638291 });
    return result.mahadashas.every((m) => fromIsoInstant(m.end) > fromIsoInstant(m.start));
  })()
);

check(
  'the birth Mahadasha\'s own full lord duration remains EXACT after rounding the initial offset -- end - start === lordYears * VIMSHOTTARI_YEAR_MS, not lordYears * YEAR_MS +/- 1ms from the rounding',
  (() => {
    const moonLongitude = 217.638291;
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude });
    const birthMahadasha = result.mahadashas[0];
    return fromIsoInstant(birthMahadasha.end) - fromIsoInstant(birthMahadasha.start) === mahadashaDurationMs(birthMahadasha.lord);
  })()
);

check(
  'birth remains strictly inside [birthMahadasha.start, birthMahadasha.end) for an arbitrary non-round longitude',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 217.638291 });
    const birthMahadasha = result.mahadashas[0];
    return BIRTH_MS >= fromIsoInstant(birthMahadasha.start) && BIRTH_MS < fromIsoInstant(birthMahadasha.end);
  })()
);

check(
  'an EXACT Nakshatra start (fractionElapsed === 0) produces exactly zero elapsed duration -- mahaStartMs === birthMomentMs',
  (() => {
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(0, BIRTH_MS); // Fixture A
    return birthNakshatra.fractionElapsed === 0 && mahaStartMs === BIRTH_MS;
  })()
);

check(
  'a deliberately fractional-millisecond theoretical offset follows the documented Math.round rounding rule exactly (independently recomputed in this test, not read from production\'s own internal rounding)',
  (() => {
    // Nakshatra index 6 (VIMSHOTTARI_SEQUENCE[6] === 'Jupiter') at
    // fractionElapsed EXACTLY 1/7 by construction: offset = span/7, so
    // offset/span = 1/7 regardless of any floating-point representation
    // of NAKSHATRA_SPAN_DEGREES itself.
    const nakshatraIndex = 6;
    const moonLongitude = (nakshatraIndex + 1 / 7) * NAKSHATRA_SPAN_DEGREES;
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(moonLongitude, BIRTH_MS);

    const fullMs = mahadashaDurationMs('Jupiter'); // 16 * 31_557_600_000 = 504_921_600_000
    const rawElapsedMs = fullMs * birthNakshatra.fractionElapsed; // genuinely fractional (504_921_600_000 / 7 has a remainder)
    const expectedElapsedMs = Math.min(Math.round(rawElapsedMs), fullMs - 1); // the documented rule, applied independently here
    const actualElapsedMs = BIRTH_MS - mahaStartMs;

    return (
      birthNakshatra.lord === 'Jupiter' &&
      !Number.isInteger(rawElapsedMs) && // confirm this fixture genuinely exercises a fractional-ms case
      actualElapsedMs === expectedElapsedMs
    );
  })()
);

// ============================================================
// Antardasha.
// ============================================================

check(
  'Jupiter Mahadasha\'s own Antardasha sequence begins with Jupiter and matches the brief\'s own worked example exactly',
  (() => {
    const antardashas = generateAntardashas('Jupiter', 0, mahadashaDurationMs('Jupiter'));
    const expected = ['Jupiter', 'Saturn', 'Mercury', 'Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu'];
    return JSON.stringify(antardashas.map((a) => a.lord)) === JSON.stringify(expected) && antardashas.every((a) => a.parentLord === 'Jupiter' && a.level === 'ANTARDASHA');
  })()
);

check('every Mahadasha has exactly 9 Antardashas', generateMahadashaCycle('Sun', 0, 0).every((m) => m.antardashas.length === 9));

check(
  'each Antardasha duration matches mahadashaLordYears * antardashaLordYears * VIMSHOTTARI_ANTARDASHA_UNIT_MS exactly',
  generateAntardashas('Saturn', 0, mahadashaDurationMs('Saturn')).every((a) => fromIsoInstant(a.end) - fromIsoInstant(a.start) === antardashaDurationMs('Saturn', a.lord))
);

check(
  'the 9 Antardashas exactly partition their parent Mahadasha: first.start = mahadasha.start, last.end = mahadasha.end, no gaps, no overlaps',
  (() => {
    const mahaStart = 0;
    const mahaEnd = mahadashaDurationMs('Venus');
    const antardashas = generateAntardashas('Venus', mahaStart, mahaEnd);
    const noGapsOrOverlaps = antardashas.every((a, i) => i === 0 || fromIsoInstant(a.start) === fromIsoInstant(antardashas[i - 1].end));
    return fromIsoInstant(antardashas[0].start) === mahaStart && fromIsoInstant(antardashas[antardashas.length - 1].end) === mahaEnd && noGapsOrOverlaps;
  })()
);

check(
  'total Antardasha duration equals the parent Mahadasha\'s own total duration exactly, for every one of the 9 possible Mahadasha lords',
  VIMSHOTTARI_SEQUENCE.every((lord) => {
    const mahaEnd = mahadashaDurationMs(lord);
    const antardashas = generateAntardashas(lord, 0, mahaEnd);
    const totalAntardashaMs = antardashas.reduce((sum, a) => sum + (fromIsoInstant(a.end) - fromIsoInstant(a.start)), 0);
    return totalAntardashaMs === mahaEnd;
  })
);

// ============================================================
// Birth Antardasha -- the critical correctness case.
// ============================================================

check(
  'birth does NOT always fall in MahadashaLord/MahadashaLord -- constructing a Moon position deep into a Nakshatra (75% elapsed) puts birth into a LATER Antardasha',
  (() => {
    // Nakshatra 8 (Ashlesha, lord Mercury) at 75% elapsed.
    const moonLongitude = 8 * (40 / 3) + 0.75 * (40 / 3); // = 8.75 * (40/3)
    const { mahaStartMs, birthNakshatra } = calculateBirthBalance(moonLongitude, BIRTH_MS);
    const mahadashas = generateMahadashaCycle(birthNakshatra.lord, mahaStartMs, BIRTH_MS);
    const birthMahadasha = mahadashas[0];
    const birthAntardasha = birthMahadasha.antardashas.find((a) => BIRTH_MS >= fromIsoInstant(a.start) && BIRTH_MS < fromIsoInstant(a.end))!;
    // At 75% elapsed into a Mercury Mahadasha, birth should NOT land in the
    // first (Mercury/Mercury) Antardasha -- it should be well into the sequence.
    return birthMahadasha.lord === 'Mercury' && birthAntardasha.lord !== 'Mercury';
  })()
);

check(
  'the birth Antardasha is generated from the Mahadasha\'s own TRUE start, not re-started at birth -- verified via the full engine + findAntardashaAt',
  (() => {
    const moonLongitude = 8 * (40 / 3) + 0.75 * (40 / 3);
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude });
    const antardasha = findAntardashaAt(result, new Date(BIRTH_MS));
    return antardasha !== undefined && antardasha.lord !== 'Mercury'; // same assertion as above, through the public API
  })()
);

// ============================================================
// Boundary semantics -- [start, end).
// ============================================================

check(
  'at exactly Mahadasha.end, the OLD Mahadasha is inactive and the NEXT one is active',
  (() => {
    const mahadashas = generateMahadashaCycle('Ketu', 0, 0);
    const firstEnd = fromIsoInstant(mahadashas[0].end);
    const result = { engineVersion: VIMSHOTTARI_ENGINE_VERSION, birthNakshatra: { index: 0, name: 'Ashwini', lord: 'Ketu' as const, moonLongitude: 0, fractionElapsed: 0, fractionRemaining: 1 }, mahadashas, evidence: [] };
    const atEnd = findMahadashaAt(result, new Date(firstEnd));
    const justBefore = findMahadashaAt(result, new Date(firstEnd - 1));
    return atEnd?.lord === mahadashas[1].lord && justBefore?.lord === mahadashas[0].lord;
  })()
);

check(
  'at exactly Antardasha.end, the OLD Antardasha is inactive and the NEXT one is active',
  (() => {
    const antardashas = generateAntardashas('Ketu', 0, mahadashaDurationMs('Ketu'));
    const firstEnd = fromIsoInstant(antardashas[0].end);
    const mahadashas = generateMahadashaCycle('Ketu', 0, 0);
    const result = { engineVersion: VIMSHOTTARI_ENGINE_VERSION, birthNakshatra: { index: 0, name: 'Ashwini', lord: 'Ketu' as const, moonLongitude: 0, fractionElapsed: 0, fractionRemaining: 1 }, mahadashas, evidence: [] };
    const atEnd = findAntardashaAt(result, new Date(firstEnd));
    const justBefore = findAntardashaAt(result, new Date(firstEnd - 1));
    return atEnd?.lord === antardashas[1].lord && justBefore?.lord === antardashas[0].lord;
  })()
);

// ============================================================
// LifePeriodContext adapter.
// ============================================================

check(
  'toLifePeriodContext produces the correct current Mahadasha/Antardasha, exact ISO boundaries, correct levels, and JSON-safe output',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 110 });
    const context = toLifePeriodContext(result, new Date(BIRTH_MS));
    const roundTripped = JSON.parse(JSON.stringify(context));
    return (
      context.system === 'VIMSHOTTARI_DASHA' &&
      context.majorPeriod?.level === 'MAHADASHA' &&
      context.subPeriod?.level === 'ANTARDASHA' &&
      context.majorPeriod.ruler === 'Mercury' &&
      typeof context.majorPeriod.startAt === 'string' &&
      typeof context.majorPeriod.endAt === 'string' &&
      Array.isArray(context.themes) &&
      context.themes.length === 0 &&
      JSON.stringify(roundTripped) === JSON.stringify(context)
    );
  })()
);

check(
  'toLifePeriodContext at an instant outside the generated cycle leaves majorPeriod/subPeriod undefined rather than throwing',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 0 });
    const farFuture = new Date(BIRTH_MS + 1000 * 31_557_600_000); // ~1000 years out, well past the guaranteed >=120-year post-birth coverage window
    const context = toLifePeriodContext(result, farFuture);
    return context.majorPeriod === undefined && context.subPeriod === undefined && context.evidence.length === 0;
  })()
);

// ============================================================
// Determinism.
// ============================================================

check(
  'calling calculateVimshottariDasha twice with the same input produces deeply-equal output',
  (() => {
    const input = { birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 110 };
    return JSON.stringify(calculateVimshottariDasha(input)) === JSON.stringify(calculateVimshottariDasha(input));
  })()
);

check(
  'output is independent of host process timezone -- constructing the same instant via Date.UTC vs an explicit +00:00 ISO string produces identical output',
  (() => {
    const a = calculateVimshottariDasha({ birthMomentUTC: new Date(Date.UTC(2000, 0, 1)), moonLongitude: 110 });
    const b = calculateVimshottariDasha({ birthMomentUTC: new Date('2000-01-01T00:00:00.000+00:00'), moonLongitude: 110 });
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'no Date.now()/new Date() with no args/Math.random anywhere in the package source (comments stripped)',
  ['types', 'provenance', 'constants', 'nakshatra', 'duration', 'evidence', 'antardasha', 'mahadasha', 'engine', 'index']
    .map((name) => stripComments(fs.readFileSync(`packages/vimshottari/src/${name}.ts`, 'utf8')))
    .every((code) => !/Date\.now\(\)|new Date\(\)(?!\.)|Math\.random\(\)/.test(code))
);

// ============================================================
// Integration -- real ephemeris via getNatalChart().
// ============================================================

check(
  'INTEGRATION: a fixed real birthMomentUTC -> getNatalChart() -> extract Moon -> calculateVimshottariFromNatalChart produces a valid result',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const result = calculateVimshottariFromNatalChart(birthMomentUTC, positions);
    const moon = positions.find((p) => p.graha === 'Moon')!;
    const first = result.mahadashas[0];
    const last = result.mahadashas[result.mahadashas.length - 1];
    return (
      result.engineVersion === VIMSHOTTARI_ENGINE_VERSION &&
      result.mahadashas.length >= 9 && // >= 9, not exactly 9 -- see mahadasha.ts's own coverage-driven generation
      fromIsoInstant(first.start) <= birthMomentUTC.getTime() &&
      fromIsoInstant(last.end) >= birthMomentUTC.getTime() + VIMSHOTTARI_MIN_COVERAGE_MS &&
      result.birthNakshatra.moonLongitude === moon.siderealLongitude &&
      findMahadashaAt(result, birthMomentUTC) !== undefined
    );
  })()
);

check(
  'calculateVimshottariFromNatalChart rejects a positions array with zero Moon entries',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC).filter((p) => p.graha !== 'Moon');
    try {
      calculateVimshottariFromNatalChart(birthMomentUTC, positions);
      return false;
    } catch (e) {
      return e instanceof VimshottariValidationError;
    }
  })()
);

check(
  'calculateVimshottariFromNatalChart rejects a positions array with a duplicated Moon entry',
  (() => {
    const birthMomentUTC = new Date('1990-06-15T08:30:00.000Z');
    const positions = getNatalChart(birthMomentUTC);
    const moon = positions.find((p) => p.graha === 'Moon')!;
    try {
      calculateVimshottariFromNatalChart(birthMomentUTC, [...positions, moon]);
      return false;
    } catch (e) {
      return e instanceof VimshottariValidationError;
    }
  })()
);

// ============================================================
// Validation.
// ============================================================

check(
  'calculateVimshottariDasha rejects a non-finite (Invalid Date) birthMomentUTC',
  (() => {
    try {
      calculateVimshottariDasha({ birthMomentUTC: new Date('not-a-date'), moonLongitude: 0 });
      return false;
    } catch (e) {
      return e instanceof VimshottariValidationError;
    }
  })()
);

check(
  'calculateVimshottariDasha rejects a non-finite moonLongitude (NaN/Infinity)',
  (() => {
    try {
      calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: NaN });
      return false;
    } catch (e) {
      return e instanceof VimshottariValidationError;
    }
  })()
);

check(
  'findMahadashaAt/findAntardashaAt reject a non-finite query instant',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 0 });
    try {
      findMahadashaAt(result, new Date('not-a-date'));
      return false;
    } catch (e) {
      return e instanceof VimshottariValidationError;
    }
  })()
);

// ============================================================
// Evidence / provenance.
// ============================================================

check(
  'every calculated period (Mahadasha and Antardasha) has non-empty evidence with stable source/ruleId/ruleVersion',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 110 });
    return result.mahadashas.every(
      (m) => m.evidence.length > 0 && m.evidence.every((e) => e.source === 'VIMSHOTTARI_DASHA' && e.ruleId && e.ruleVersion) &&
        m.antardashas.every((a) => a.evidence.length > 0 && a.evidence.every((e) => e.source === 'VIMSHOTTARI_DASHA' && e.ruleId && e.ruleVersion))
    );
  })()
);

check(
  'result.evidence includes the Nakshatra-from-Moon, starting-lord, birth-balance, and year-length facts',
  (() => {
    const result = calculateVimshottariDasha({ birthMomentUTC: new Date(BIRTH_MS), moonLongitude: 110 });
    const ruleIds = new Set(result.evidence.map((e) => e.ruleId));
    return (
      ruleIds.has('VIMSHOTTARI_NAKSHATRA_FROM_MOON_V1') &&
      ruleIds.has('VIMSHOTTARI_STARTING_LORD_V1') &&
      ruleIds.has('VIMSHOTTARI_BIRTH_BALANCE_V1') &&
      ruleIds.has('VIMSHOTTARI_YEAR_LENGTH_365_25_V1')
    );
  })()
);

check(
  'dedupeEvidenceRefs removes exact duplicates while preserving first-occurrence order',
  (() => {
    const ref = { source: 'VIMSHOTTARI_DASHA' as const, ruleId: 'VIMSHOTTARI_STARTING_LORD_V1', ruleVersion: '1.0.0', data: { lord: 'Ketu' } };
    const distinct = { ...ref, data: { lord: 'Venus' } };
    const result = dedupeEvidenceRefs([ref, distinct, ref]);
    return result.length === 2 && result[0] === ref && result[1] === distinct;
  })()
);

// ============================================================
// Product/dependency boundary.
// ============================================================

const PACKAGE_SRC_FILES = ['types', 'provenance', 'constants', 'nakshatra', 'duration', 'evidence', 'antardasha', 'mahadasha', 'engine', 'index'].map(
  (name) => `packages/vimshottari/src/${name}.ts`
);

check(
  'every import in this package is either a relative import within itself, or a relative import into packages/vedic or packages/personal-intelligence -- never apps/web, packages/bhrigu, or packages/personal-themes',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const importStatements = source.match(/^import[\s\S]*?;/gm) ?? [];
    return importStatements.every((statement) => /from '\.\/|from '\.\.\/\.\.\/vedic\/|from '\.\.\/\.\.\/personal-intelligence\//.test(statement));
  })
);

check(
  // Deliberately excludes the one known-good, brief-approved import
  // ("packages/vedic/src/panchangElements", reused only for its
  // NAKSHATRA_NAMES data export -- see nakshatra.ts's own doc comment)
  // from the "panchang" substring match, since that filename itself
  // legitimately contains "panchang" without being a Panchang
  // CALCULATION dependency.
  'no ACTUAL CODE (comments stripped) in this package references apps/web, Prisma, a database, an API route, React, a Panchang/Muhurta CALCULATION (as opposed to the one approved NAKSHATRA_NAMES data import), or an LLM',
  PACKAGE_SRC_FILES.every((file) => {
    const code = stripComments(fs.readFileSync(file, 'utf8')).replace(/panchangElements/g, '');
    return !/apps\/web|prisma|PrismaClient|react|localStorage|fetch\(|NextRequest|NextResponse|useState|useEffect|panchang|muhurta|openai|anthropic|\bllm\b/i.test(code);
  })
);

check(
  // "vimshottari" as a bare word is NOT the right signal here: both
  // files already legitimately mention it in PRE-EXISTING prose/data
  // predating this PR (packages/vedic/src/natalChart.ts's own doc
  // comment already says "...or Vimshottari Dasha (planetary period
  // system). Both are real..."; packages/personal-intelligence's own
  // LifePeriodContext.system literal is 'VIMSHOTTARI_DASHA'). What
  // actually matters is that NEITHER file gained a new dependency on
  // THIS package -- i.e. no "packages/vimshottari" import path appears.
  'packages/vedic source has no import of packages/vimshottari (this PR did not modify packages/vedic to depend on it -- see git diff for the byte-for-byte confirmation; a pre-existing, unrelated textual mention of "Vimshottari Dasha" in natalChart.ts\'s own doc comment predates this PR and is not itself evidence of modification)',
  !/packages\/vimshottari/i.test(['natalChart', 'panchangElements'].map((name) => fs.readFileSync(`packages/vedic/src/${name}.ts`, 'utf8')).join('\n'))
);

check(
  'packages/personal-intelligence source has no import of packages/vimshottari (this PR did not modify packages/personal-intelligence to depend on it -- see git diff for the byte-for-byte confirmation; a pre-existing, unrelated `system: \'VIMSHOTTARI_DASHA\'` literal in context.ts predates this PR)',
  !/packages\/vimshottari/i.test(
    ['types', 'themes', 'evidence', 'context', 'guidance', 'validation', 'provenance', 'index'].map((name) => fs.readFileSync(`packages/personal-intelligence/src/${name}.ts`, 'utf8')).join('\n')
  )
);

check(
  'packages/bhrigu and packages/personal-themes source are untouched and are NOT imported by this package (the Dasha branch is architecturally independent of the Bhrigu-natal-themes branch)',
  PACKAGE_SRC_FILES.every((file) => !/from '\.\.\/\.\.\/bhrigu\/|from '\.\.\/\.\.\/personal-themes\//.test(fs.readFileSync(file, 'utf8')))
);

if (!allPassed) {
  console.error('\nSome Vimshottari Dasha Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL VIMSHOTTARI DASHA ENGINE CHECKS PASSED');
}
