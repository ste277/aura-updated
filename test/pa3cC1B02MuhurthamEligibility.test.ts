/**
 * PA-3C-C1B-02 -- regression coverage for the three-state Muhurtham/
 * Chaturmas eligibility contract (ELIGIBLE/INELIGIBLE/UNAVAILABLE) and the
 * Muhurtham Finder's handling of it. Follows this repo's existing
 * standalone ts-node convention (no test framework): plain assertions,
 * console.log, exit code reflects pass/fail.
 *
 * Fixture note: 70N/Oslo is used for every polar case below. All fixtures
 * were independently verified by directly running the real functions
 * before being written here (not assumed) -- see the PA-3C-C1B-02
 * implementation report for the exact probe output.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spanOverlapsProhibitedPeriod, PeriodEligibilityResult } from '../packages/recommendation/src/ceremonialPeriods';
import { ACTIVITY_DEFINITIONS } from '../packages/recommendation/src/activityDefinitions';
import {
  findMuhurthams,
  findPersonalMuhurthams,
  findSharedMuhurthams,
  evaluateMuhurthamCandidateAt,
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS,
} from '../packages/recommendation/src/muhurthamFinder';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

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

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8');
}

const marriage = ACTIVITY_DEFINITIONS.find((a) => a.id === 'marriage')?.muhurta;
if (!marriage) throw new Error('fixture setup: marriage classification not found');

const polarLocation = { latitude: 70, longitude: 25.7, timezone: 'Europe/Oslo' };
const ordinaryLocation = { latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' }; // Delhi
const polarCandidateStart = new Date('2026-07-05T10:00:00.000Z'); // Chaturmas season
const polarCandidateEnd = new Date('2026-07-05T11:00:00.000Z');

const polarContext: DailyAssistantContext = { latitude: 70, longitude: 25.7, timezone: 'Europe/Oslo', now: new Date('2026-07-05T10:00:00.000Z'), tzOffsetMinutes: 120 };

// ============================================================
// A. ceremonialPeriods.ts -- the three-state contract itself
// ============================================================

{
  const result = spanOverlapsProhibitedPeriod(polarCandidateStart, polarCandidateEnd, marriage, polarLocation);
  check('A1. A Chaturmas-season candidate at a polar (70N) location returns UNAVAILABLE, not ELIGIBLE or INELIGIBLE', result.status === 'UNAVAILABLE');
  check('A2. UNAVAILABLE carries eligible: false (never true -- an unevaluated candidate must never look confirmed-eligible)', result.eligible === false);
  check('A3. UNAVAILABLE carries the CHATURMAS_UNAVAILABLE reason', result.status === 'UNAVAILABLE' && result.reason === 'CHATURMAS_UNAVAILABLE');
}

{
  const result = spanOverlapsProhibitedPeriod(polarCandidateStart, polarCandidateEnd, marriage, ordinaryLocation);
  check('A4. The identical candidate at an ordinary (Delhi) location does NOT return UNAVAILABLE', result.status !== 'UNAVAILABLE');
}

{
  // Known-good existing fixture (test/marriageRequiredEligibility.test.ts):
  // Delhi, 2026-09-01, well inside Chaturmas -- confirms zero regression to
  // the pre-existing evaluated-ineligible path.
  const result = spanOverlapsProhibitedPeriod(new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-01T01:00:00.000Z'), marriage, ordinaryLocation);
  check('A5. Existing INELIGIBLE/CHATURMAS behavior unchanged (Delhi, 2026-09-01, inside Chaturmas)', result.status === 'INELIGIBLE' && result.eligible === false && result.reason === 'CHATURMAS');
}

{
  // Existing eligible fixture: June 20 2026, Delhi -- outside Chaturmas.
  const result = spanOverlapsProhibitedPeriod(new Date('2026-06-20T06:00:00.000Z'), new Date('2026-06-20T07:00:00.000Z'), marriage, ordinaryLocation);
  check('A6. Existing ELIGIBLE behavior unchanged (Delhi, outside Chaturmas)', result.status === 'ELIGIBLE' && result.eligible === true);
}

{
  // Activities with no periodRules at all (every non-Marriage activity
  // today) must always report ELIGIBLE unconditionally, even at a polar
  // location -- there is no ceremonial check to become unavailable.
  const noPeriodRules = ACTIVITY_DEFINITIONS.find((a) => a.id === 'start-journey')?.muhurta;
  if (!noPeriodRules) throw new Error('fixture setup: start-journey classification not found');
  const result = spanOverlapsProhibitedPeriod(polarCandidateStart, polarCandidateEnd, noPeriodRules, polarLocation);
  check('A7. An activity with no periodRules reports ELIGIBLE unconditionally, even at a polar location (no ceremonial check to be unavailable)', result.status === 'ELIGIBLE' && result.eligible === true);
}

// ============================================================
// B. Finder entry points -- aggregate unavailableDateCount, never a
//    fabricated favorable/unfavorable date.
// ============================================================

{
  const res = findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-07-01', end: '2026-07-10' }, context: polarContext });
  check('B1. findMuhurthams: a 10-day Chaturmas-season search at a polar location returns zero dates (never a fabricated favorable Muhurtham)', res.dates.length === 0);
  check('B2. findMuhurthams: evaluatedDateCount still reports all 10 requested dates', res.evaluatedDateCount === 10);
  check('B3. findMuhurthams: unavailableDateCount reports all 10 as unavailable (not silently zero)', res.unavailableDateCount === 10);
}

{
  const nonMarriageId = SUPPORTED_MUHURTHAM_ACTIVITY_IDS.find((id) => id !== 'marriage');
  if (!nonMarriageId) throw new Error('fixture setup: no non-marriage supported activity found');
  const res = findMuhurthams({ activityId: nonMarriageId, dateRange: { start: '2026-06-20', end: '2026-06-22' }, context: polarContext });
  check('B4. A non-Marriage activity (no periodRules) still reports unavailableDateCount at a polar location -- the whole-date solar-window computation fails independently of any ceremonial rule', res.unavailableDateCount === 3 && res.dates.length === 0);
}

{
  const res = findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-06-01', end: '2026-06-03' }, context: { latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata', now: new Date(), tzOffsetMinutes: 330 } });
  check('B5. An ordinary (non-polar) search reports unavailableDateCount === 0', res.unavailableDateCount === 0);
}

{
  const incompleteProfileContext: DailyAssistantContext = { ...polarContext, personalContext: undefined };
  const res = findPersonalMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-07-01', end: '2026-07-10' }, context: incompleteProfileContext });
  check('B6. findPersonalMuhurthams: PERSONAL_PROFILE_INCOMPLETE still returned first when the profile is missing (unaffected by this change)', res.status === 'PERSONAL_PROFILE_INCOMPLETE');
}

{
  const res = findSharedMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-07-01', end: '2026-07-10' }, context: polarContext });
  check('B7. findSharedMuhurthams: USER_PROFILE_INCOMPLETE still returned first when the profile is missing (unaffected by this change)', res.status === 'USER_PROFILE_INCOMPLETE');
}

// ============================================================
// C. evaluateMuhurthamCandidateAt -- Ask Aura's single-instant check
// ============================================================

{
  const outcome = evaluateMuhurthamCandidateAt({ activityId: 'marriage', scope: 'GENERAL', start: polarCandidateStart, context: polarContext });
  check('C1. GENERAL scope at a polar instant returns status UNAVAILABLE, never a fabricated eligible/ineligible result', outcome.status === 'UNAVAILABLE');
  check('C2. UNAVAILABLE outcome carries a reason code', outcome.status === 'UNAVAILABLE' && typeof outcome.reason === 'string' && outcome.reason.length > 0);
}

{
  const outcome = evaluateMuhurthamCandidateAt({ activityId: 'marriage', scope: 'GENERAL', start: new Date('2026-06-20T06:00:00.000Z'), context: { latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata', now: new Date(), tzOffsetMinutes: 330 } });
  check('C3. GENERAL scope at an ordinary instant still returns status OK (unaffected by this change)', outcome.status === 'OK');
}

// ============================================================
// D. Structural guards -- confirm the actual source contains the expected
//    containment patterns (supplementary to the behavioral tests above,
//    per this repo's existing convention for no-DB-fixture coverage).
// ============================================================

{
  const src = readSource('packages/recommendation/src/ceremonialPeriods.ts');
  check('D1. ceremonialPeriods.ts imports SolarNoEventError', /import \{ computeSolarEphemeris, formatMinutes, SolarNoEventError \}/.test(src));
  check('D2. ceremonialPeriods.ts catches SolarNoEventError specifically around findChaturmasWindow (never a bare catch)', /err instanceof SolarNoEventError/.test(src));
  check('D3. ceremonialPeriods.ts does not catch-all and return UNAVAILABLE for any other error (the catch re-throws unmatched errors)', /throw err;/.test(src));
}

{
  const src = readSource('packages/recommendation/src/muhurthamFinder.ts');
  check("D4. muhurthamFinder.ts's evaluateMuhurthamCandidate can return the 'UNAVAILABLE' sentinel", /: TimingCandidate \| null \| 'UNAVAILABLE'/.test(src));
  check('D5. findBestWindowsForDate wraps computeAssistantWindows in a narrow SolarNoEventError catch', /buildSlotCandidates\(computeAssistantWindows\(dayContext\)\)/.test(src) && /if \(err instanceof SolarNoEventError\) return 'UNAVAILABLE';/.test(src));
  check('D6. unavailableDateCount is tracked and returned from all three finder entry points', (src.match(/unavailableDateCount/g) || []).length >= 6);
}

{
  const src = readSource('apps/web/lib/askAuraOrchestrator.ts');
  check("D7. askAuraOrchestrator.ts's buildMuhurthamCheckResponse explicitly handles outcome.status === 'UNAVAILABLE' before reading outcome.eligible/window/activity", /outcome\.status === 'UNAVAILABLE'/.test(src));
}

console.log(`\n${passed} passed, ${failed} failed.`);
console.log(failed === 0 ? 'ALL PA-3C-C1B-02 CHECKS PASSED' : 'SOME PA-3C-C1B-02 CHECKS FAILED');
process.exit(failed === 0 ? 0 : 1);
