/**
 * AURA PCE-4A -- P0 regression coverage for the Lahiri ayanamsa epoch-offset
 * fix (packages/vedic/src/panchangElements.ts's lahiriAyanamsa()).
 *
 * Deterministic, network-free. Independent reference values below are NOT
 * derived from Aura's own code -- see each section's cited source.
 */
import { lahiriAyanamsa, getTithi, getNakshatra, getYoga, getKarana } from '../packages/vedic/src/panchangElements';
import { findNextSankranti, classifySynodicMonthContaining } from '../packages/vedic/src/lunarCalendar';
import { calculateNatalAscendant } from '../packages/lagna/src/engine';
import { spanOverlapsProhibitedPeriod } from '../packages/recommendation/src/ceremonialPeriods';

let pass = 0;
let fail = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    pass++;
    console.log('OK  ', label);
  } else {
    fail++;
    console.log('FAIL', label);
  }
}
function closeTo(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

// -----------------------------------------------------------------------
// 1. Independent Lahiri ayanamsa reference values.
// Source: Jagannath Hora historical Lahiri (Chitrapaksha) ayanamsa tables,
// https://jagannathhora.com/historical-lahiri-ayanamsa-values-tables/,
// stated as computed via Swiss Ephemeris, true/nutation-inclusive value at
// 00:00 UT on January 1 of the given year. Aura's lahiriAyanamsa() is a
// linear MEAN approximation (no nutation term, no secular-rate curvature),
// so a ~30 arcsecond (~0.0083 deg) residual against the true value is the
// expected agreement band for this model, not a bug -- tolerance below is
// deliberately loose enough to accept this known linear-model residual
// while being far tighter than the ~1.98 degree epoch-offset bug this
// fixture exists to catch.
// -----------------------------------------------------------------------
console.log('=== 1. Independent Lahiri ayanamsa reference check (multi-epoch) ===');
const LAHIRI_REFERENCE_TOLERANCE_DEG = 0.02; // ~72 arcsec
const lahiriReferences: Array<[string, string, number]> = [
  ['1950-01-01T00:00:00Z', '23d09m28s = 23.1578deg', 23.1578],
  ['2000-01-01T00:00:00Z', '23d51m12s = 23.8533deg', 23.8533],
  ['2026-01-01T00:00:00Z', '24d13m19s = 24.2219deg', 24.2219],
  ['2040-01-01T00:00:00Z', '24d24m42s = 24.4117deg', 24.4117],
];
for (const [iso, label, expected] of lahiriReferences) {
  const actual = lahiriAyanamsa(new Date(iso));
  check(`lahiriAyanamsa(${iso}) ~= independent reference (${label}): got ${actual.toFixed(4)}`, closeTo(actual, expected, LAHIRI_REFERENCE_TOLERANCE_DEG));
}
// Explicit regression guard against the specific prior bug (double J2000
// subtraction): the old formula was off by a CONSTANT ~1.976deg at every
// date. Assert the corrected value is nowhere near that old (wrong) value.
for (const [iso, , expected] of lahiriReferences) {
  const actual = lahiriAyanamsa(new Date(iso));
  const oldBuggyValue = expected - 1.976; // what the pre-fix formula would have produced, approximately
  check(`lahiriAyanamsa(${iso}) is NOT the old buggy ~1.98deg-low value (${oldBuggyValue.toFixed(2)})`, Math.abs(actual - oldBuggyValue) > 1.0);
}

// -----------------------------------------------------------------------
// 2. Independent sidereal Lagna reference.
// Source: livepanditji.com Ascendant (Lagna) Calculator, an independent
// Lahiri-sidereal tool (not Aura's code), queried live for 1995-03-15
// 13:30 IST, Delhi (28.6139N, 77.2090E): "Gemini Ascendant, Mithun, 26d50m
// into Gemini, sidereal (Lahiri)" -- i.e. absolute sidereal longitude
// 60 + 26.8333 = 86.8333deg (Gemini/Mithuna spans 60-90deg).
// -----------------------------------------------------------------------
console.log('\n=== 2. Independent sidereal Lagna reference check ===');
const lagnaSample = new Date('1995-03-15T08:00:00Z'); // 13:30 IST
const asc = calculateNatalAscendant(lagnaSample, 28.6139, 77.209);
check(`calculateNatalAscendant sidereal longitude ~= independent reference (86.8333deg, livepanditji.com): got ${asc.siderealLongitude.toFixed(4)}`, closeTo(asc.siderealLongitude, 86.8333, 0.05));
check('calculateNatalAscendant Rashi index matches independent reference (2 = Mithuna/Gemini)', asc.rashiIndex === 2);

// -----------------------------------------------------------------------
// 3. Tithi/Karana cancellation (ayanamsa-invariant, moon-sun difference).
// -----------------------------------------------------------------------
console.log('\n=== 3. Tithi/Karana ayanamsa-cancellation sanity ===');
check('Tithi for 2026-02-06 is Krishna Panchami (ayanamsa cancels in moon-sun difference)', getTithi(new Date('2026-02-06T12:00:00+05:30')).name === 'Krishna Panchami');
check('Karana for 2026-02-06 is Kaulava (ayanamsa cancels)', getKarana(new Date('2026-02-06T12:00:00+05:30')).name === 'Kaulava');

// -----------------------------------------------------------------------
// 4. Nakshatra boundary-adjacent case (exposed to the full ayanamsa shift).
// 2026-02-08T00:08 IST: with the bug, this produced "Swati"; corrected, it
// produces "Chitra" -- a categorical change caused directly by the ~1.98deg
// correction crossing a 13.33deg Nakshatra boundary near this instant.
// -----------------------------------------------------------------------
console.log('\n=== 4. Nakshatra boundary-adjacent regression ===');
check('Nakshatra for 2026-02-08T00:08 IST is Chitra after the fix (was Swati under the old bug)', getNakshatra(new Date('2026-02-08T00:08:00+05:30')).name === 'Chitra');

// -----------------------------------------------------------------------
// 5. Yoga boundary case (~2x ayanamsa exposure: sum, not difference).
// 2026-06-20 noon IST: with the bug, this produced "Siddhi"; corrected, it
// produces "Vajra".
// -----------------------------------------------------------------------
console.log('\n=== 5. Yoga boundary regression (2x ayanamsa exposure) ===');
check('Yoga for 2026-06-20 noon IST is Vajra after the fix (was Siddhi under the old bug)', getYoga(new Date('2026-06-20T12:00:00+05:30')).name === 'Vajra');

// -----------------------------------------------------------------------
// 6. Solar ingress (Sankranti) regression, cross-checked against 9+
// independent third-party sources (DrikPanchang's own Sankranti page and
// 8 other independent astrology sites) agreeing Mesha Sankranti 2026 =
// April 14 and Mithuna Sankranti 2026 = June 15 (~07:19-07:30Z).
// -----------------------------------------------------------------------
console.log('\n=== 6. Solar ingress (Sankranti) regression ===');
const meshaSankranti = findNextSankranti(new Date('2026-04-01T00:00:00Z'));
check(`Mesha Sankranti 2026 lands on April 14 (independent refs): got ${meshaSankranti.instant.toISOString()}`, meshaSankranti.instant.getUTCDate() === 14 && meshaSankranti.instant.getUTCMonth() === 3);
const mithunaSankranti = findNextSankranti(new Date('2026-06-01T00:00:00Z'));
check(`Mithuna Sankranti 2026 lands on June 15 (independent refs): got ${mithunaSankranti.instant.toISOString()}`, mithunaSankranti.instant.getUTCDate() === 15 && mithunaSankranti.instant.getUTCMonth() === 5);

// -----------------------------------------------------------------------
// 7. Adhika Masa classification regression.
// Source: DrikPanchang griha-pravesh-dates-with-muhurat.html (PCE-3B
// fixture), published Adhika Masa window May 17 - June 15, 2026.
// -----------------------------------------------------------------------
console.log('\n=== 7. Adhika Masa classification regression ===');
check('The synodic month containing 2026-05-20 (published Adhika window) classifies ADHIKA', classifySynodicMonthContaining(new Date('2026-05-20T00:00:00Z')).classification === 'ADHIKA');
check('The synodic month containing 2026-06-20 (ordinary month after the window) classifies NORMAL', classifySynodicMonthContaining(new Date('2026-06-20T00:00:00Z')).classification === 'NORMAL');

// -----------------------------------------------------------------------
// 8. Mandatory Marriage eligibility regression -- real production path
// (spanOverlapsProhibitedPeriod, as called by ceremonialPeriods.ts /
// muhurthamFinder.ts), New Delhi venue, matching PCE-3B-FIX1's exact
// reproduction context.
// -----------------------------------------------------------------------
console.log('\n=== 8. Marriage eligibility production-path regression ===');
const MARRIAGE_CLASSIFICATION = { family: 'RELATIONSHIP' as const, intent: 'MARRIAGE' as const };
const DELHI = { latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' };
const marriageCases: Array<[string, string, string, boolean, string | undefined]> = [
  ['2026-05-10 before published window -> eligible', '2026-05-10T10:00:00+05:30', '2026-05-10T11:00:00+05:30', true, undefined],
  ['2026-05-20 inside published Adhika window -> excluded', '2026-05-20T10:00:00+05:30', '2026-05-20T11:00:00+05:30', false, 'ADHIKA_MASA'],
  ['2026-06-01 inside published Adhika window -> excluded', '2026-06-01T10:00:00+05:30', '2026-06-01T11:00:00+05:30', false, 'ADHIKA_MASA'],
  ['2026-06-20 outside published window -> eligible (was falsely excluded under the bug)', '2026-06-20T10:00:00+05:30', '2026-06-20T11:00:00+05:30', true, undefined],
  ['2026-07-20 well after both windows -> eligible', '2026-07-20T10:00:00+05:30', '2026-07-20T11:00:00+05:30', true, undefined],
];
for (const [label, s, e, expectedEligible, expectedReason] of marriageCases) {
  const result = spanOverlapsProhibitedPeriod(new Date(s), new Date(e), MARRIAGE_CLASSIFICATION as any, DELHI as any);
  check(`${label}: got ${JSON.stringify(result)}`, result.eligible === expectedEligible && (result as any).reason === expectedReason);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) {
  console.log('SOME PCE-4A LAHIRI AYANAMSA EPOCH FIX CHECKS FAILED');
  process.exit(1);
} else {
  console.log('ALL PCE-4A LAHIRI AYANAMSA EPOCH FIX CHECKS PASSED');
}
