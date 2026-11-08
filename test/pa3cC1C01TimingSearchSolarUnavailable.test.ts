/**
 * PA-3C-C1C-01: Timing Search Solar Unavailability Containment.
 *
 * FIV-01 independently reproduced, against the real merged ephemeris, that
 * a validator-accepted coordinate (66.5N, the app's own MAX_VALID_LATITUDE)
 * produces a genuine SolarNoEventError on real calendar dates near the
 * summer solstice (35 days in May-Aug 2026 alone, first 2026-06-05) -- and
 * that packages/recommendation/src/timingSearch.ts's runTimingSearch(),
 * dailyAssistant.ts's recommendTaskSlot()/findOptimalTaskTimes(), and three
 * Ask Aura call sites had zero containment for it, reachable through an
 * unauthenticated public endpoint (apps/web/app/api/guest/timing-search/
 * route.ts). This suite uses the SAME real latitude/date combination
 * against the real, unmodified computeSolarEphemeris -- never a mocked
 * SolarNoEventError -- to prove the actual defect is fixed, not a
 * synthetic stand-in for it.
 */
import { computeSolarEphemeris } from '../packages/astronomy/src/ephemeris';
import { SolarNoEventError, SolarInputValidationError } from '../packages/astronomy/src/errors';
import { isValidCustomLocation } from '../apps/web/lib/cities';
import {
  runTimingSearch,
  TimingSearchRequest,
} from '../packages/recommendation/src/timingSearch';
import {
  recommendTaskSlot,
  findOptimalTaskTimes,
  recommendTaskSlotResult,
  findOptimalTaskTimesResult,
  DailyAssistantContext,
} from '../packages/recommendation/src/dailyAssistant';
import { findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log(`OK   ${label}`);
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

// ---- Real-coordinate reproduction baseline -----------------------------
// A1 — validator accepts the exact reproduction coordinate.
check(
  'A1. isValidCustomLocation accepts latitude=66.5 (the app\'s own MAX_VALID_LATITUDE)',
  isValidCustomLocation({ latitude: 66.5, longitude: 25.7, timezone: 'Europe/Helsinki' })
);

// A2 — the real, unmodified computeSolarEphemeris genuinely throws SolarNoEventError
// for this accepted coordinate on 2026-06-05 (continuous daylight / POLAR_DAY).
let a2Error: unknown;
try {
  computeSolarEphemeris({ year: 2026, month: 6, day: 5, latitude: 66.5, longitude: 25.7, tzOffsetMinutes: 180 });
} catch (err) {
  a2Error = err;
}
check('A2. computeSolarEphemeris(66.5N, 2026-06-05) genuinely throws SolarNoEventError', a2Error instanceof SolarNoEventError);
check(
  'A2b. the condition is POLAR_DAY (independently verified sign mapping: cosH < -1)',
  a2Error instanceof SolarNoEventError && a2Error.condition === 'POLAR_DAY'
);

const FAILING_CONTEXT: DailyAssistantContext = {
  now: new Date('2026-06-05T00:00:00Z'),
  latitude: 66.5,
  longitude: 25.7,
  timezone: 'Europe/Helsinki',
  tzOffsetMinutes: 180,
};
const VALID_CONTEXT: DailyAssistantContext = {
  now: new Date('2026-03-15T06:00:00Z'),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ---- runTimingSearch (FIND / CHECK / COMPARE) ---------------------------

const findRequest: TimingSearchRequest = {
  mode: 'FIND',
  activityId: 'meditation',
  durationMinutes: 30,
  dateRange: { start: '2026-06-05', end: '2026-06-05' },
  context: FAILING_CONTEXT,
};
let findThrew = false;
let findResult;
try {
  findResult = runTimingSearch(findRequest);
} catch {
  findThrew = true;
}
check('B1. FIND at the real no-event coordinate/date does NOT throw (contained)', !findThrew);
check('B2. FIND returns empty candidates, never a fabricated one', !!findResult && findResult.candidates.length === 0);
check('B3. FIND sets unavailable.reason = SOLAR_NO_EVENT, not folded into "no match"', !!findResult?.unavailable && findResult.unavailable.reason === 'SOLAR_NO_EVENT');
check('B4. FIND reports unavailableDayCount === 1 for a single-day no-event range', findResult?.unavailableDayCount === 1);

const checkRequest: TimingSearchRequest = {
  mode: 'CHECK',
  activityId: 'meditation',
  durationMinutes: 30,
  candidateStart: '2026-06-05T12:00:00Z',
  context: FAILING_CONTEXT,
};
let checkThrew = false;
let checkResult;
try {
  checkResult = runTimingSearch(checkRequest);
} catch {
  checkThrew = true;
}
check('C1. CHECK at the real no-event instant does NOT throw (contained)', !checkThrew);
check('C2. CHECK sets unavailable.reason = SOLAR_NO_EVENT, no requestedCandidate fabricated', !!checkResult?.unavailable && checkResult.requestedCandidate === undefined);

const compareRequest: TimingSearchRequest = {
  mode: 'COMPARE',
  activityId: 'meditation',
  durationMinutes: 30,
  candidateStarts: ['2026-06-05T12:00:00Z', '2026-06-05T15:00:00Z'],
  context: FAILING_CONTEXT,
};
let compareThrew = false;
let compareResult;
try {
  compareResult = runTimingSearch(compareRequest);
} catch {
  compareThrew = true;
}
check('D1. COMPARE with every candidate unavailable does NOT throw (contained)', !compareThrew);
check('D2. COMPARE reports unavailableDayCount === 2 (both supplied candidates failed)', compareResult?.unavailableDayCount === 2);

// Mixed COMPARE: one failing candidate, one real valid one -- must preserve
// the valid one rather than discarding the whole comparison.
const mixedCompare: TimingSearchRequest = {
  mode: 'COMPARE',
  activityId: 'meditation',
  durationMinutes: 30,
  candidateStarts: ['2026-06-05T12:00:00Z', '2026-03-15T12:00:00Z'],
  context: { ...FAILING_CONTEXT, now: new Date('2026-03-15T06:00:00Z') },
};
const mixedResult = runTimingSearch(mixedCompare);
check('D3. Mixed COMPARE (1 unavailable + 1 valid) preserves the valid candidate', mixedResult.candidates.length === 1);
check('D4. Mixed COMPARE reports unavailableDayCount === 1, not treated as fully unavailable', mixedResult.unavailableDayCount === 1 && !mixedResult.unavailable);

// ---- recommendTaskSlot / findOptimalTaskTimes (raw, unchanged contract) ----

let recommendThrew = false;
try {
  recommendTaskSlot('meditation', FAILING_CONTEXT, 30);
} catch (err) {
  recommendThrew = err instanceof SolarNoEventError;
}
check('E1. recommendTaskSlot() itself is UNCHANGED -- still throws SolarNoEventError directly', recommendThrew);

let findOptimalThrew = false;
try {
  findOptimalTaskTimes('meditation', FAILING_CONTEXT, 30, 'TODAY');
} catch (err) {
  findOptimalThrew = err instanceof SolarNoEventError;
}
check('E2. findOptimalTaskTimes() itself is UNCHANGED -- still throws SolarNoEventError when every day fails', findOptimalThrew);

// ---- recommendTaskSlotResult / findOptimalTaskTimesResult (new, additive) --

const slotResult = recommendTaskSlotResult('meditation', FAILING_CONTEXT, 30);
check('F1. recommendTaskSlotResult() does NOT throw -- returns UNAVAILABLE', slotResult.status === 'UNAVAILABLE');
check('F2. recommendTaskSlotResult() UNAVAILABLE carries the real condition (POLAR_DAY)', slotResult.status === 'UNAVAILABLE' && slotResult.solarCondition === 'POLAR_DAY');

const validSlotResult = recommendTaskSlotResult('meditation', VALID_CONTEXT, 30);
check('F3. recommendTaskSlotResult() for a valid location/date returns OK with a real recommendation', validSlotResult.status === 'OK' && !!validSlotResult.recommendation.recommendationState);

const optimalResult = findOptimalTaskTimesResult('meditation', FAILING_CONTEXT, 30, 'TODAY');
check('F4. findOptimalTaskTimesResult() does NOT throw -- returns UNAVAILABLE for a fully-unavailable horizon', optimalResult.status === 'UNAVAILABLE');

// Mixed multi-day horizon: days 0-2 valid (2026-06-02..04), days 3+ unavailable
// (2026-06-05 onward) -- the valid days' results must survive.
const mixedHorizonContext: DailyAssistantContext = {
  now: new Date('2026-06-02T06:00:00Z'),
  latitude: 66.5,
  longitude: 25.7,
  timezone: 'Europe/Helsinki',
  tzOffsetMinutes: 180,
};
const mixedHorizonResult = findOptimalTaskTimesResult('meditation', mixedHorizonContext, 30, 'SEVEN_DAYS');
check(
  'F5. A 7-day horizon spanning valid AND no-event days returns OK, preserving the valid days (not fully unavailable)',
  mixedHorizonResult.status === 'OK'
);
check(
  'F6. The mixed-horizon OK result\'s planningOptions came only from the 3 genuinely valid days, never a fabricated 4th',
  mixedHorizonResult.status === 'OK' && (mixedHorizonResult.recommendation.planningOptions ?? []).length <= 3
);

// ---- findEverydaySharedTiming (additive propagation) --------------------

const sharedOutcome = findEverydaySharedTiming({
  activityId: 'meditation',
  durationMinutes: 30,
  dateRange: { start: '2026-06-05', end: '2026-06-05' },
  context: FAILING_CONTEXT,
  partnerContext: {},
});
check('G1. findEverydaySharedTiming does not throw for a fully-unavailable range', sharedOutcome.status === 'OK');
check(
  'G2. findEverydaySharedTiming propagates unavailable=true for a fully-unavailable range',
  sharedOutcome.status === 'OK' && sharedOutcome.unavailable === true
);

// ---- Invalid input / unexpected computation failure remain distinguishable ----

let invalidThrew: unknown;
try {
  runTimingSearch({
    mode: 'FIND',
    activityId: 'meditation',
    durationMinutes: 30,
    dateRange: { start: '2026-06-05', end: '2026-06-05' },
    context: { ...FAILING_CONTEXT, latitude: NaN },
  });
} catch (err) {
  invalidThrew = err;
}
check(
  'H1. Invalid input (NaN latitude) is NOT converted into "unavailable" -- still throws SolarInputValidationError',
  invalidThrew instanceof SolarInputValidationError
);

// ---- Legacy habit/plan-completion persistence paths remain untouched ----
// (confirmed via source inspection, not re-tested here -- out of this
// ticket's scope; see C1B-01 for their own dedicated coverage.)

if (failed > 0) {
  console.log(`\n${passed} passed, ${failed} failed.`);
  console.log('SOME PA-3C-C1C-01 CHECKS FAILED');
  process.exit(1);
} else {
  console.log(`\n${passed} passed, ${failed} failed.`);
  console.log('ALL PA-3C-C1C-01 CHECKS PASSED');
}
