import { runTimingSearch, evaluateTimingCandidate } from '../packages/recommendation/src/timingSearch';
import { findOptimalTaskTimes } from '../packages/recommendation/src/dailyAssistant';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)), // Fri Aug 21 2026, ~9:30 AM IST
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// FIND
// ============================================================

const findWeekend = runTimingSearch({
  mode: 'FIND',
  activityId: 'dating',
  durationMinutes: 120,
  horizon: 'WEEKEND',
  timePreference: 'EVENING',
  context: chennaiContext,
  limit: 3,
});
check('FIND returns ranked candidates', findWeekend.candidates.length > 0 && findWeekend.candidates.length <= 3);
check('FIND scores are descending', findWeekend.candidates.every((c, i) => i === 0 || findWeekend.candidates[i - 1].score >= c.score));
check('FIND respects requested duration', findWeekend.candidates.every((c) => new Date(c.end).getTime() - new Date(c.start).getTime() === 120 * 60000));
check('FIND (WEEKEND horizon) only returns Saturday/Sunday candidates', findWeekend.candidates.every((c) => c.metadata.dateLabel === 'Sat, Aug 22' || c.metadata.dateLabel === 'Sun, Aug 23'));
check('FIND respects the EVENING time preference (17:00-21:00 IST)', findWeekend.candidates.every((c) => {
  const istHour = (new Date(c.start).getUTCHours() + 5 + Math.floor((new Date(c.start).getUTCMinutes() + 30) / 60)) % 24;
  return istHour >= 17 && istHour < 21;
}));

// Diversity: no two returned candidates within 90 minutes of each other on the same date.
check('FIND does not return near-duplicate overlapping options', findWeekend.candidates.every((a, i) =>
  findWeekend.candidates.every((b, j) => i === j || a.metadata.dateLabel !== b.metadata.dateLabel
    || Math.abs(new Date(a.start).getTime() - new Date(b.start).getTime()) >= 90 * 60000)));

const findSevenDays = runTimingSearch({
  mode: 'FIND',
  taskTitle: 'Deep Work',
  durationMinutes: 60,
  horizon: 'SEVEN_DAYS',
  timePreference: 'MORNING',
  context: chennaiContext,
  limit: 3,
});
check('FIND (SEVEN_DAYS, >=4-day range) prefers distinct days for its top candidates', new Set(findSevenDays.candidates.map((c) => c.metadata.dateLabel)).size === findSevenDays.candidates.length);
check('FIND respects the MORNING time preference (05:00-12:00 IST)', findSevenDays.candidates.every((c) => {
  const istHour = (new Date(c.start).getUTCHours() + 5 + Math.floor((new Date(c.start).getUTCMinutes() + 30) / 60)) % 24;
  return istHour >= 5 && istHour < 12;
}));

// Explicit dateRange (not a named horizon) should behave identically to the equivalent horizon.
const findExplicitRange = runTimingSearch({
  mode: 'FIND',
  activityId: 'dating',
  durationMinutes: 120,
  dateRange: { start: '2026-08-22', end: '2026-08-23' },
  timePreference: 'EVENING',
  context: chennaiContext,
  limit: 3,
});
check('FIND with an explicit dateRange respects that range', findExplicitRange.candidates.every((c) => c.metadata.dateLabel === 'Sat, Aug 22' || c.metadata.dateLabel === 'Sun, Aug 23'));

// A near-impossible constraint (tiny range + narrow preference + long duration) should
// yield fewer than the requested limit rather than manufacturing candidates.
const findScarce = runTimingSearch({
  mode: 'FIND',
  taskTitle: 'Deep Work',
  durationMinutes: 350,
  dateRange: { start: '2026-08-21', end: '2026-08-21' },
  timePreference: 'NIGHT',
  context: chennaiContext,
  limit: 5,
});
check('FIND returns fewer than the limit when insufficient valid candidates exist (does not manufacture options)', findScarce.candidates.length < 5);

// ============================================================
// CHECK
// ============================================================

const checkStart = '2026-08-27T04:30:00.000Z'; // Thu Aug 27, 10:00 IST
const checkResult = runTimingSearch({
  mode: 'CHECK',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
  candidateStart: checkStart,
  context: chennaiContext,
});
check('CHECK evaluates exactly the requested start', checkResult.requestedCandidate?.start === new Date(checkStart).toISOString());
check('CHECK does not silently move the candidate (candidates[0] matches requestedCandidate)', checkResult.candidates[0]?.start === checkResult.requestedCandidate?.start);
check('CHECK found a better nearby candidate for a deliberately poor slot', Boolean(checkResult.betterNearby) && (checkResult.betterNearby!.score > checkResult.requestedCandidate!.score));
check('CHECK betterNearby is a different instant than the requested one', checkResult.betterNearby!.start !== checkResult.requestedCandidate!.start);

const checkNoNearbySearch = runTimingSearch({
  mode: 'CHECK',
  taskTitle: 'Important meeting',
  durationMinutes: 60,
  candidateStart: checkStart,
  checkNearbyWindowMinutes: 0,
  context: chennaiContext,
});
check('CHECK with checkNearbyWindowMinutes: 0 never searches for a nearby alternative', checkNoNearbySearch.betterNearby === undefined);

// ============================================================
// COMPARE
// ============================================================

const compareStarts = ['2026-08-21T13:30:00.000Z', '2026-08-22T13:30:00.000Z']; // Fri 19:00 vs Sat 19:00 IST
const compareResult = runTimingSearch({
  mode: 'COMPARE',
  activityId: 'dating',
  durationMinutes: 120,
  candidateStarts: compareStarts,
  context: chennaiContext,
});
check('COMPARE evaluates every supplied candidate', compareResult.candidates.length === compareStarts.length);
check('COMPARE ranks candidates by descending score', compareResult.candidates.every((c, i) => i === 0 || compareResult.candidates[i - 1].score >= c.score));
check('COMPARE preserves original candidate identity (every result start matches a supplied start)', compareResult.candidates.every((c) => compareStarts.includes(c.start) || compareStarts.some((iso) => new Date(iso).toISOString() === c.start)));
check('COMPARE does not introduce candidates beyond what was supplied', new Set(compareResult.candidates.map((c) => c.start)).size === compareStarts.length);

// ============================================================
// ONTOLOGY
// ============================================================

// evaluateTimingCandidate() is the canonical evaluator FIND/CHECK/COMPARE all
// share -- called directly here (not just indirectly via runTimingSearch) to
// pin down its own contract.
const directEvalDeepWork = evaluateTimingCandidate({
  profile: (() => { const activity = findActivityIntent('deep work')!; return { activityId: activity.id, type: activity.title, icon: activity.icon, significance: activity.significance, scores: {}, reason: activity.description, preferredWindows: activity.recommendedWindowTypes, acceptableWindows: activity.acceptableWindowTypes, avoidWindows: activity.avoidWindowTypes, activity }; })(),
  start: new Date('2026-07-28T06:45:00.000Z'),
  durationMinutes: 30,
  context: chennaiContext,
});
check('evaluateTimingCandidate() called directly produces the same auraFitScore as evaluateActivityFit()', directEvalDeepWork.auraFitScore === evaluateActivityFit({ activity: findActivityIntent('deep work')!, date: new Date('2026-07-28T06:45:00.000Z'), windowType: 'ABHIJIT' }).score);
check('evaluateTimingCandidate() result carries a windowLabel matching its windowType', directEvalDeepWork.metadata.windowType === 'ABHIJIT' && directEvalDeepWork.metadata.windowLabel === 'Abhijit Muhurta');

const knownCheck = runTimingSearch({ mode: 'CHECK', activityId: 'deep-work', durationMinutes: 30, candidateStart: '2026-07-28T06:45:00.000Z', context: chennaiContext, checkNearbyWindowMinutes: 0 });
check('Known activityId resolves through the explicit ActivityDefinition/ActivityProfile path (auraFitScore defined)', knownCheck.requestedCandidate?.auraFitScore !== undefined);
check('Known activityId reasons include an activity-rule or Aura Fit reason', (knownCheck.requestedCandidate?.reasons ?? []).some((r) => r.factor === 'ACTIVITY' || r.factor === 'SOLAR_WINDOW' || r.factor === 'NAKSHATRA' || r.factor === 'TITHI' || r.factor === 'YOGA' || r.factor === 'KARANA'));

const fallbackCheck = runTimingSearch({ mode: 'CHECK', taskTitle: 'organize my expense filing', durationMinutes: 30, candidateStart: '2026-07-28T06:45:00.000Z', context: chennaiContext, checkNearbyWindowMinutes: 0 });
check('Free-text (no catalog match) still uses the fallback classifier (auraFitScore undefined)', fallbackCheck.requestedCandidate?.auraFitScore === undefined);
check('Free-text fallback still produces structured Muhurta reasons', Array.isArray(fallbackCheck.requestedCandidate?.reasons));

// ============================================================
// REGRESSION
// ============================================================

// Aura Fit score must be bit-identical to calling evaluateActivityFit() directly
// for the same candidate/context -- proving the new engine reuses, not
// reimplements, Aura Fit scoring.
const auraFitPinDate = '2026-07-28T06:45:00.000Z'; // inside the Abhijit window (see ephemeris.test.ts)
for (const [activityId, expectedAbhijitScore] of [['start-journey', 76], ['deep-work', 75], ['tea-break', 76]] as const) {
  const activity = findActivityIntent(activityId === 'start-journey' ? 'start a journey' : activityId === 'deep-work' ? 'deep work' : 'tea break')!;
  const direct = evaluateActivityFit({ activity, date: new Date(auraFitPinDate), windowType: 'ABHIJIT' });
  const viaTimingSearch = runTimingSearch({ mode: 'CHECK', activityId, durationMinutes: 30, candidateStart: auraFitPinDate, context: chennaiContext, checkNearbyWindowMinutes: 0 });
  check(`Aura Fit score for ${activityId} via timingSearch matches evaluateActivityFit() directly (${viaTimingSearch.requestedCandidate?.auraFitScore} === ${direct.score})`, viaTimingSearch.requestedCandidate?.auraFitScore === direct.score);
  check(`Aura Fit score for ${activityId} matches the pre-existing pinned baseline (${direct.score} === ${expectedAbhijitScore})`, direct.score === expectedAbhijitScore);
}

// Representative existing slot-task request: the new engine's top FIND
// candidate for "today" should land in the same window as the legacy
// planner's own best pick for the identical request.
const legacyPlan = findOptimalTaskTimes('Deep Work', chennaiContext, 60, 'TODAY', undefined, undefined, 'ANYTIME');
const legacyBestOption = (legacyPlan.planningOptions ?? [])[0];
const newFindToday = runTimingSearch({ mode: 'FIND', taskTitle: 'Deep Work', durationMinutes: 60, horizon: 'TODAY', timePreference: 'ANY', context: chennaiContext, limit: 3 });
check('Legacy findOptimalTaskTimes still returns planning options for a representative request', Boolean(legacyBestOption));
check('New engine FIND still returns candidates for the equivalent representative request', newFindToday.candidates.length > 0);
// Both engines share the same scoreContinuousBlock/evaluateActivityFit core, so
// for an identical activity+context+duration+horizon their top pick should be
// the same solar window (the legacy planner's `bestWindow.label` encodes the
// window name, e.g. "Abhijit Muhurta" / "Neutral Flow" / "Gulika steady window").
check('New engine\'s top FIND candidate lands in the same solar window as the legacy planner\'s top pick', newFindToday.candidates[0]?.metadata.windowLabel === legacyPlan.bestWindow.label);

// Structured reasons survive end-to-end through the new engine.
check('FIND candidates carry structured MuhurtaReason objects', findWeekend.candidates.every((c) => Array.isArray(c.reasons)));
check('CHECK candidate carries structured MuhurtaReason objects', Array.isArray(checkResult.requestedCandidate?.reasons));
check('COMPARE candidates carry structured MuhurtaReason objects', compareResult.candidates.every((c) => Array.isArray(c.reasons)));

// ============================================================
// TIMEZONE
// ============================================================

const newYorkContext = {
  now: new Date(Date.UTC(2026, 2, 7, 15, 0, 0)), // 10:00 AM EST, Mar 7 2026 (pre-DST)
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: -300,
};
const nyFind = runTimingSearch({
  mode: 'FIND',
  taskTitle: 'Deep Work',
  durationMinutes: 30,
  horizon: 'TOMORROW',
  timePreference: 'ANY',
  context: newYorkContext,
  limit: 3,
});
check('Explicit-range FIND in a non-IST timezone lands on the correct local date (DST-correct)', nyFind.candidates.every((c) => c.metadata.dateLabel === 'Sun, Mar 8'));

// Midnight/date-boundary: a duration that would cross midnight is flagged, not silently miscalculated.
const midnightCheck = runTimingSearch({
  mode: 'CHECK',
  taskTitle: 'Tea break',
  durationMinutes: 30,
  candidateStart: (() => {
    // 23:45 IST on Aug 21 2026 -> crosses into Aug 22 local before duration ends.
    return new Date(Date.UTC(2026, 7, 21, 18, 15, 0)).toISOString();
  })(),
  context: chennaiContext,
  checkNearbyWindowMinutes: 0,
});
check('CHECK flags a duration that would cross local midnight instead of silently mis-scoring it', Boolean(midnightCheck.requestedCandidate?.conflicts?.some((conflict) => conflict.type === 'DURATION_EXCEEDS_DAY')));

console.log(allPassed ? '\nALL TIMING SEARCH CHECKS PASSED' : '\nSOME TIMING SEARCH CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
