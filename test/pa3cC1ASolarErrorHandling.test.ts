/**
 * PA-3C-C1A -- regression coverage for typed solar errors, eager input
 * validation, and the safe-containment narrowing added at six consumer
 * entry points. Follows this repo's existing standalone ts-node
 * convention (no test framework): plain assertions, console.log, exit
 * code reflects pass/fail.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  computeSolarEphemeris,
  SolarInputValidationError,
  SolarNoEventError,
  SolarComputationError,
  isSolarError,
} from '../packages/astronomy/src/ephemeris';
import { getDailySolarWindows } from '../packages/astronomy/src/solarWindows';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

function expectThrows<T extends Error>(
  label: string,
  fn: () => void,
  ErrorClass: new (...args: any[]) => T,
  extra?: (err: T) => boolean
): void {
  try {
    fn();
    check(label, false);
  } catch (err) {
    const matchesClass = err instanceof ErrorClass;
    const matchesExtra = extra ? matchesClass && extra(err as T) : true;
    check(label, matchesClass && matchesExtra);
  }
}

function expectSucceeds(label: string, fn: () => void): void {
  try {
    fn();
    check(label, true);
  } catch (err) {
    check(`${label} (threw unexpectedly: ${err instanceof Error ? err.message : String(err)})`, false);
  }
}

// ---- Core astronomy: polar day / polar night sign classification -------

const base = { year: 2026, longitude: 25.7, tzOffsetMinutes: 180 };

expectThrows(
  '70N, June solstice 2026-06-21 -> POLAR_DAY (cosH < -1, continuous daylight)',
  () => computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: 70 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_DAY'
);

expectThrows(
  '70N, Dec solstice 2026-12-21 -> POLAR_NIGHT (cosH > 1, continuous darkness)',
  () => computeSolarEphemeris({ ...base, month: 12, day: 21, latitude: 70 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_NIGHT'
);

expectThrows(
  '70S, Dec solstice 2026-12-21 -> POLAR_DAY (Southern summer)',
  () => computeSolarEphemeris({ ...base, month: 12, day: 21, latitude: -70 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_DAY'
);

expectThrows(
  '70S, June solstice 2026-06-21 -> POLAR_NIGHT (Southern winter)',
  () => computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: -70 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_NIGHT'
);

// ---- Accepted-boundary (66.5 deg) no-event fixtures ---------------------

expectThrows(
  '66.5N (accepted MAX_VALID_LATITUDE), June solstice -> still throws SolarNoEventError/POLAR_DAY',
  () => computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: 66.5 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_DAY'
);

expectThrows(
  '66.5S (accepted MIN_VALID_LATITUDE), Dec solstice -> still throws SolarNoEventError/POLAR_DAY',
  () => computeSolarEphemeris({ ...base, month: 12, day: 21, latitude: -66.5 }),
  SolarNoEventError,
  (e) => e.condition === 'POLAR_DAY'
);

expectThrows(
  '65.6N (below the 66.5 cutoff, above the real ~65.448 threshold), June solstice -> still throws (confirms the cutoff is not a complete guarantee)',
  () => computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: 65.6 }),
  SolarNoEventError
);

// ---- Nearby valid-event controls ----------------------------------------

expectSucceeds('66.5N, March equinox (same lat that no-events in June) -> succeeds', () =>
  computeSolarEphemeris({ ...base, month: 3, day: 20, latitude: 66.5 })
);

expectSucceeds('60N, June solstice -> succeeds (mid-latitude control)', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: 60 })
);

expectSucceeds('Chennai 13.08N equatorial-ish control -> succeeds', () =>
  computeSolarEphemeris({ year: 2026, month: 7, day: 28, latitude: 13.0827, longitude: 80.2707, tzOffsetMinutes: 330 })
);

// ---- Near-boundary floating-point behavior: no arbitrary tolerance ------
// Binary-searches the REAL function (not a reimplementation) for the exact
// June-solstice no-event threshold near 65.45N, then asserts the boundary
// is a hard line: a hair below succeeds, a hair above throws. Confirms no
// epsilon/tolerance band has been introduced that would clamp a
// materially out-of-range cosH into a fabricated valid event.
{
  let lo = 65.0;
  let hi = 66.0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    try {
      computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: mid });
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  expectSucceeds(`boundary-1e-9: ${lo.toFixed(9)}N succeeds`, () =>
    computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: lo })
  );
  expectThrows(
    `boundary+1e-9: ${hi.toFixed(9)}N throws SolarNoEventError (no tolerance band smoothing the knife-edge)`,
    () => computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: hi }),
    SolarNoEventError
  );
  check('boundary gap is a genuine floating-point knife-edge, not a wide fabricated band', hi - lo < 1e-6);
}

// ---- Invalid latitude / longitude ----------------------------------------

expectThrows('NaN latitude -> SolarInputValidationError (not silent NaN propagation)', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: NaN }), SolarInputValidationError);

expectThrows('Infinity latitude -> SolarInputValidationError', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: Infinity }), SolarInputValidationError);

expectThrows('-Infinity latitude -> SolarInputValidationError', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: -Infinity }), SolarInputValidationError);

expectThrows('latitude = 200 (out of physical range) -> SolarInputValidationError (previously silently "succeeded")', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: 200 }), SolarInputValidationError);

expectThrows('latitude = -91 (out of physical range) -> SolarInputValidationError', () =>
  computeSolarEphemeris({ ...base, month: 6, day: 21, latitude: -91 }), SolarInputValidationError);

// latitude = 90 is INSIDE the accepted inclusive range (not rejected as
// invalid input), but the hour-angle denominator is always near-zero at
// the exact pole, so every day of the year legitimately resolves to a
// no-event condition (never a genuine sunrise/sunset) -- confirmed here
// as SolarNoEventError, not SolarInputValidationError (input was valid)
// and not SolarComputationError (cosH stays a huge-but-finite number in
// floating point, never NaN/Infinity, so this is the ordinary no-event
// branch, not the defensive non-finite backstop).
expectThrows('latitude = 90 exactly (inclusive boundary, pole) -> accepted as valid input, but always resolves to SolarNoEventError, never silently "succeeds"', () =>
  computeSolarEphemeris({ year: 2026, month: 3, day: 20, latitude: 90, longitude: 0, tzOffsetMinutes: 0 }), SolarNoEventError);

expectThrows('NaN longitude -> SolarInputValidationError', () =>
  computeSolarEphemeris({ year: 2026, month: 6, day: 21, latitude: 20, longitude: NaN, tzOffsetMinutes: 0 }), SolarInputValidationError);

expectThrows('Infinity longitude -> SolarInputValidationError', () =>
  computeSolarEphemeris({ year: 2026, month: 6, day: 21, latitude: 20, longitude: Infinity, tzOffsetMinutes: 0 }), SolarInputValidationError);

expectThrows('longitude = 300 (out of [-180,180]) -> SolarInputValidationError', () =>
  computeSolarEphemeris({ year: 2026, month: 6, day: 21, latitude: 20, longitude: 300, tzOffsetMinutes: 0 }), SolarInputValidationError);

// ---- Invalid date components / non-finite intermediate guard ------------

expectThrows('NaN day component -> SolarInputValidationError', () =>
  computeSolarEphemeris({ year: 2026, month: 6, day: NaN, latitude: 20, longitude: 0, tzOffsetMinutes: 0 }), SolarInputValidationError);

expectThrows('NaN tzOffsetMinutes -> SolarInputValidationError', () =>
  computeSolarEphemeris({ year: 2026, month: 6, day: 21, latitude: 20, longitude: 0, tzOffsetMinutes: NaN }), SolarInputValidationError);

// isSolarError type-guard discrimination (used by the narrowed catches at
// the My Day / Home consumer boundaries) -- confirms it correctly accepts
// all three typed errors and rejects a plain unrelated Error, which is
// exactly what lets those catches propagate unrelated bugs instead of
// silently swallowing them.
check('isSolarError(SolarNoEventError) -> true', isSolarError(new SolarNoEventError('POLAR_DAY', 'x')));
check('isSolarError(SolarInputValidationError) -> true', isSolarError(new SolarInputValidationError('x')));
check('isSolarError(SolarComputationError) -> true', isSolarError(new SolarComputationError('x')));
check('isSolarError(plain Error) -> false (unrelated errors are not swallowed)', !isSolarError(new Error('unrelated bug')));
check('isSolarError(non-error value) -> false', !isSolarError('not an error'));

// ---- getDailySolarWindows: Invalid Date guard ----------------------------
// Confirmed (PA-3C-A3) that before this fix, an Invalid Date silently
// propagated past computeSolarEphemeris and threw an unrelated RangeError
// several calls downstream inside Intl.DateTimeFormat. Now rejected eagerly.

expectThrows('getDailySolarWindows with an Invalid Date -> SolarInputValidationError (not a downstream RangeError)', () =>
  getDailySolarWindows(new Date(NaN), 20, 0, 'UTC'), SolarInputValidationError);

expectSucceeds('getDailySolarWindows with a valid Date/location -> succeeds', () =>
  getDailySolarWindows(new Date('2026-07-28T12:00:00Z'), 13.0827, 80.2707, 'Asia/Kolkata')
);

expectThrows('getDailySolarWindows at a polar no-event location/date -> SolarNoEventError propagates (not swallowed at this layer)', () =>
  getDailySolarWindows(new Date('2026-06-21T12:00:00Z'), 70, 25.7, 'UTC'), SolarNoEventError);

// ---- Structural guards: confirm the six C1A consumer entry points -------
// contain the expected typed-error import + catch pattern. Mirrors this
// repo's existing structural-guard test convention (e.g.
// goalActivityRhythmStructuralGuards.test.ts) for source areas where a
// full behavioral/integration test would require infrastructure (a React
// renderer, or DB/session fixtures) this repo does not otherwise have.

const repoRoot = path.resolve(__dirname, '..');
function readSource(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

{
  const src = readSource('apps/web/app/page.tsx');
  check('C1A-01 Home: imports isSolarError', /isSolarError/.test(src));
  check('C1A-01 Home: computeSolarEphemeris call is wrapped in try/catch', /try\s*{\s*\n\s*return computeSolarEphemeris/.test(src));
}
{
  const src = readSource('apps/web/app/api/panchang/route.ts');
  check('C1A-02 Panchangam API: uses solarErrorResponse (no raw err.message leak)', /solarErrorResponse\(err\)/.test(src));
  check('C1A-02 Panchangam API: no longer returns err.message directly', !/err instanceof Error \? err\.message/.test(src));
}
{
  const src = readSource('apps/web/app/api/panchang/today/route.ts');
  check("C1A-03 Today's Panchangam: catches around getPanchangForDate", /try\s*{\s*\n\s*panchangDay = getPanchangForDate/.test(src));
}
{
  const src = readSource('apps/web/lib/myDayOrchestrator.ts');
  check('C1A-04 My Day: narrowed catch uses isSolarError and rethrows otherwise', /if \(!isSolarError\(err\)\) throw err;/.test(src));
  check('C1A-04 My Day: buildTomorrowPreview is called OUTSIDE the narrowed try block', /}\s*\n\s*if \(!panchangDay\) {[\s\S]*?return buildTomorrowPreview\(tomorrowAgenda, panchangDay\);/.test(src));
}
{
  const src = readSource('apps/web/lib/askAuraOrchestrator.ts');
  check('C1A-05 Ask Aura: handlePanchangQuery catches and checks SOLAR_NO_EVENT specifically', /err\.code === 'SOLAR_NO_EVENT'/.test(src));
}
{
  const src = readSource('apps/web/app/api/calendar/feed/route.ts');
  check('C1A-08 Calendar feed: catches SolarNoEventError around getDailySolarWindows', /err instanceof SolarNoEventError/.test(src));
}

// ---- Negative check: confirm C1A-07 was correctly left untouched,
// documented as blocked rather than worked around with a fabricated result.
// (C1A-06's own PeriodEligibilityResult blocker was deliberately RESOLVED by
// PA-3C-C1B-02 -- see test/pa3cC1B02MuhurthamEligibility.test.ts for the
// positive coverage of the three-state contract that replaced this negative
// check's old "still blocked" assertion.)

{
  const src = readSource('packages/recommendation/src/ceremonialPeriods.ts');
  check('C1B-02 Muhurtham/Chaturmas: PeriodEligibilityResult now has an explicit UNAVAILABLE status distinct from ELIGIBLE/INELIGIBLE', /status: 'UNAVAILABLE'/.test(src) && /status: 'ELIGIBLE'/.test(src) && /status: 'INELIGIBLE'/.test(src));
}
{
  const src = readSource('packages/recommendation/src/dailyAssistant.ts');
  check('C1A-07 Daily assistant: DailyBriefing.peakWindow NOT made optional/nullable (confirmed blocker left as-is, not worked around)', /peakWindow: \{\s*\n\s*name: string;/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed.`);
console.log(failed === 0 ? 'ALL PA-3C-C1A CHECKS PASSED' : 'SOME PA-3C-C1A CHECKS FAILED');
process.exit(failed === 0 ? 0 : 1);
