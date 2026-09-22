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
// Activity-level timeOfDayPreference default (Home Compactness follow-up
// -- "a date night or dinner with family shows time slots in the morning
// and afternoon"). See ActivityTimeOfDayPreference's own doc comment
// (activityDefinitions.ts) -- these are real-world clock-time defaults,
// completely independent of the Panchang solar-window scoring, applied
// ONLY when the caller doesn't explicitly ask for a different time.
// ============================================================
function istHourOf(iso: string): number {
  const d = new Date(iso);
  return (d.getUTCHours() + 5 + Math.floor((d.getUTCMinutes() + 30) / 60)) % 24;
}

const dateNightNoExplicitPreference = runTimingSearch({
  mode: 'FIND',
  activityId: 'date-night',
  durationMinutes: 90,
  horizon: 'TODAY',
  context: chennaiContext,
  limit: 5,
});
check(
  'Date Night with NO explicit timePreference defaults to EVENING (17:00-21:00 IST) -- the activity\'s own real-world convention',
  dateNightNoExplicitPreference.candidates.length > 0 && dateNightNoExplicitPreference.candidates.every((c) => istHourOf(c.start) >= 17 && istHourOf(c.start) < 21)
);

const coffeeNoExplicitPreference = runTimingSearch({
  mode: 'FIND',
  activityId: 'coffee-tea',
  durationMinutes: 45,
  horizon: 'SEVEN_DAYS',
  context: chennaiContext,
  limit: 8,
});
check(
  'Coffee/Tea has no timeOfDayPreference -- candidates are NOT constrained to evening hours (proves this is per-activity, not a blanket default)',
  coffeeNoExplicitPreference.candidates.some((c) => istHourOf(c.start) < 17 || istHourOf(c.start) >= 21)
);

const dateNightExplicitMorning = runTimingSearch({
  mode: 'FIND',
  activityId: 'date-night',
  durationMinutes: 90,
  horizon: 'TODAY',
  timePreference: 'MORNING',
  context: chennaiContext,
  limit: 3,
});
check(
  'An explicit request.timePreference overrides the activity\'s own default (caller intent always wins)',
  dateNightExplicitMorning.candidates.length > 0 && dateNightExplicitMorning.candidates.every((c) => istHourOf(c.start) >= 5 && istHourOf(c.start) < 12)
);

// A literal `timePreference: 'ANY'` must behave the SAME as omitting the
// field entirely -- apps/web/lib/timingSearchRequest.ts (the real
// /api/timing-search HTTP validation layer every manual Plan/Ask Aura
// search goes through) defaults a missing timePreference to the literal
// string 'ANY' before runTimingSearch ever sees the request, so treating
// 'ANY' as a real, distinct preference here would silently defeat the
// activity default for every manual search caller (this was a genuine bug
// caught via live manual verification, not a hypothetical).
const dateNightExplicitAny = runTimingSearch({
  mode: 'FIND',
  activityId: 'date-night',
  durationMinutes: 90,
  horizon: 'TODAY',
  timePreference: 'ANY',
  context: chennaiContext,
  limit: 5,
});
check(
  'timePreference: \'ANY\' (the manual-search API\'s own default for "not specified") still applies Date Night\'s EVENING default',
  dateNightExplicitAny.candidates.length > 0 && dateNightExplicitAny.candidates.every((c) => istHourOf(c.start) >= 17 && istHourOf(c.start) < 21)
);

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
// Duration is picked adaptively rather than hardcoded: the legacy planner's
// bestWindow can fall into its own NO_FIT fallback path
// (recommendTaskSlot/findOptimalTaskTimes's "nothing fits fully today,
// offer the chronologically-nearest window anyway" branch -- see its own
// `reason` text), which picks by chronological proximity, not by score --
// and exactly which duration triggers that on this fixed test date shifts
// whenever a real Panchang-window-overlap scoring refinement lands nearby
// (this happened once already, for Everyday Timing Flexibility V1's Rahu/
// Yama change, and again for Inauspicious Period Precedence Fix V1's
// overlap-resolution correction -- both intended, not regressions). Rather
// than re-hardcoding a new magic duration each time, try a short list and
// use the first that reaches the legacy engine's genuine best-fit path, to
// keep testing the real claim -- the two engines' *ranking* stays
// consistent -- without this check going stale on the next unrelated
// scoring fix.
const CROSS_ENGINE_TEST_DURATIONS = [15, 20, 25, 30, 45];
let legacyPlan = findOptimalTaskTimes('Deep Work', chennaiContext, CROSS_ENGINE_TEST_DURATIONS[0], 'TODAY', undefined, undefined, 'ANYTIME');
let crossEngineDuration = CROSS_ENGINE_TEST_DURATIONS[0];
for (const duration of CROSS_ENGINE_TEST_DURATIONS) {
  const attempt = findOptimalTaskTimes('Deep Work', chennaiContext, duration, 'TODAY', undefined, undefined, 'ANYTIME');
  legacyPlan = attempt;
  crossEngineDuration = duration;
  if (attempt.recommendationState !== 'NO_FIT') break;
}
const legacyBestOption = (legacyPlan.planningOptions ?? [])[0];
const newFindToday = runTimingSearch({ mode: 'FIND', taskTitle: 'Deep Work', durationMinutes: crossEngineDuration, horizon: 'TODAY', timePreference: 'ANY', context: chennaiContext, limit: 3 });
check('Legacy findOptimalTaskTimes still returns planning options for a representative request', Boolean(legacyBestOption));
check('New engine FIND still returns candidates for the equivalent representative request', newFindToday.candidates.length > 0);
check('Legacy planner reaches its genuine best-fit path for this request (not the NO_FIT chronological fallback)', legacyPlan.recommendationState !== 'NO_FIT');
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

// ============================================================
// Construction-Window-Aware Timing Search V1 -- `searchWindow` (FIND
// only, optional). Root cause this fixes: FIND previously ranked
// candidates across the ENTIRE target day and truncated to a small
// default `limit` (3) with zero awareness of the caller's actual usable
// planning bounds, so a narrow real availability window could have its
// own genuinely-feasible candidates crowded out by higher-scoring but
// unusable day-wide ones before the caller (Day Constructor) ever saw
// them (see the "AURA -- Tomorrow Activity Placement Comparison Audit"
// completion report). These checks prove the new field in isolation,
// directly against the real engine -- no fake/mocked timing search.
// ============================================================

// Tomorrow (Aug 22 2026 IST) relative to chennaiContext's own `now` (Aug
// 21 2026 IST) -- narrow real availability window, 05:00-09:00 IST,
// expressed as the SAME absolute-instant shape ConstructionWindow.start/
// end already use (dayConstructorOrchestrator.ts passes this straight
// through with zero conversion).
const TOMORROW_DATE = '2026-08-22';
const narrowSearchWindow = { start: new Date('2026-08-21T23:30:00.000Z'), end: new Date('2026-08-22T03:30:00.000Z') }; // 05:00-09:00 IST

const boundedFind = runTimingSearch({
  mode: 'FIND',
  activityId: 'workout',
  durationMinutes: 30,
  dateRange: { start: TOMORROW_DATE, end: TOMORROW_DATE },
  context: chennaiContext,
  searchWindow: narrowSearchWindow,
  limit: 3,
});
check('searchWindow: FIND still returns candidates when real capacity exists inside the bounds', boundedFind.candidates.length > 0);
check('searchWindow: every returned candidate starts at/after the window start', boundedFind.candidates.every((c) => new Date(c.start).getTime() >= narrowSearchWindow.start.getTime()));
check('searchWindow: every returned candidate ends at/before the window end (half-open, same convention as isWithinWindow/ConstructionWindow)', boundedFind.candidates.every((c) => new Date(c.end).getTime() <= narrowSearchWindow.end.getTime()));

// The DAY-WIDE unbounded top candidate for this exact activity/day/context
// is NOT inside the narrow window (proven by the audit's own reproduction)
// -- confirms the bounded call is genuinely constraining generation, not
// coincidentally landing inside the window anyway.
const unboundedFindSameDay = runTimingSearch({
  mode: 'FIND',
  activityId: 'workout',
  durationMinutes: 30,
  dateRange: { start: TOMORROW_DATE, end: TOMORROW_DATE },
  context: chennaiContext,
  limit: 20,
});
const unboundedInWindowCount = unboundedFindSameDay.candidates.filter((c) => new Date(c.start).getTime() >= narrowSearchWindow.start.getTime() && new Date(c.end).getTime() <= narrowSearchWindow.end.getTime()).length;
const unboundedOutOfWindowCount = unboundedFindSameDay.candidates.length - unboundedInWindowCount;
check('searchWindow: the unbounded day-wide search (for comparison) does return at least one candidate outside the narrow window, proving the bound is doing real work', unboundedOutOfWindowCount > 0);

// Truncation-before-ranking regression -- the exact defect class the audit
// found: request a small `limit` while many more in-window candidates
// exist than the limit, confirming the returned set is drawn from WITHIN
// bounds first, never day-wide-ranked-then-filtered (which would often
// return zero in-window results, exactly the bug).
const tightLimitBounded = runTimingSearch({
  mode: 'FIND',
  activityId: 'meditation',
  durationMinutes: 30,
  dateRange: { start: TOMORROW_DATE, end: TOMORROW_DATE },
  context: chennaiContext,
  searchWindow: narrowSearchWindow,
  limit: 3,
});
check('searchWindow: filtering happens before the result limit is applied (limit=3 still returns in-window candidates, never an empty/out-of-window set)', tightLimitBounded.candidates.length > 0 && tightLimitBounded.candidates.every((c) => new Date(c.start).getTime() >= narrowSearchWindow.start.getTime()));

// Timing quality preserved (this ticket's own section 9) -- ranking/
// duration/scoring semantics inside the bounded search are byte-identical
// to the unbounded engine's own existing rules, never "first available
// minute."
check('searchWindow: bounded FIND still respects the requested duration exactly', boundedFind.candidates.every((c) => new Date(c.end).getTime() - new Date(c.start).getTime() === 30 * 60000));
// Ranking metric, not the separate presentation `.score` (scoreContinuousBlock-
// based, not guaranteed monotonic with the ranking metric even in the
// pre-existing unbounded engine -- a real, independent characteristic
// this PR does not touch): the engine's own final sort key is exactly
// `auraFitScore ?? muhurtaScore * 5 + 55` (runFind's own `toRanked` call,
// timingSearch.ts), reproduced verbatim here rather than asserting on a
// field the engine never promised to keep monotonic.
check('searchWindow: bounded FIND is still ranked by the engine\'s own real ranking metric (auraFitScore, unmodified)', boundedFind.candidates.every((c, i) => {
  if (i === 0) return true;
  const rank = (x: typeof c) => x.auraFitScore ?? x.muhurtaScore * 5 + 55;
  return rank(boundedFind.candidates[i - 1]) >= rank(c);
}));

// Full-day / unbounded callers (every EXISTING caller in the repository)
// omit `searchWindow` entirely -- proves omitting it is completely inert:
// the unbounded call above already exercises the exact same code path
// every pre-existing caller uses, and every ORIGINAL check earlier in
// this file (none of which set `searchWindow`) still passes unmodified,
// which is the real proof of "zero behavioral change for every existing
// caller" -- this additional check only re-confirms the unbounded
// day-wide candidate COUNT is unaffected by this field's mere existence
// in the type.
check('searchWindow: omitting the field entirely still returns the full day-wide candidate set (existing callers unaffected)', unboundedFindSameDay.candidates.length === 20);

// ============================================================
// excludedIntervals (FIND only, optional) -- PR #146 correctness
// amendment. `searchWindow` alone bounds only the OUTER span; it has no
// knowledge of a gap between two disjoint usable periods (or an existing
// blocking Plan) WITHIN that span. `selectDiversePlanningOptions`'s own
// fallback pass (no 90-minute spacing guarantee, used whenever passes 1-
// 2 can't find `limit` well-spread candidates) can let every one of a
// narrow day's top-N candidates cluster inside such a gap -- silently
// starving constructDay of genuinely feasible candidates elsewhere in
// the same outer span. This is the EXACT SAME truncation-before-
// feasibility-check defect class `searchWindow` itself was built to fix,
// just triggered by a known-unusable SUB-range instead of the outer
// bound.
//
// Mandatory regression (this ticket's own section 8): a DETERMINISTIC,
// REAL-engine (never mocked/contrived-score) reproduction of the
// fallback-pass-3 condition -- found by scanning real activity/duration/
// date combinations for one where the real Panchang/Muhurta scoring
// landscape genuinely produces exactly this clustering. New York,
// 2026-10-17, "workout", 30 minutes: the day's real top-3 candidates
// within an outer 05:00-09:00 ET span are 06:15, 07:15, 07:45 ET --
// EVERY one of them inside a 06:00-08:00 ET gap, none more than 90
// minutes from another (proving this is genuinely the no-spacing
// fallback pass, not the normally-diverse pass-1/2 result).
// ============================================================
const nyContext = {
  now: new Date('2026-09-22T15:00:00.000Z'),
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: -240, // EDT in October.
};
const NARROW_PEAK_DATE = '2026-10-17';
const outerSpan = { start: new Date(`${NARROW_PEAK_DATE}T09:00:00.000Z`), end: new Date(`${NARROW_PEAK_DATE}T13:00:00.000Z`) }; // 05:00-09:00 ET
const gapInterval = { start: new Date(`${NARROW_PEAK_DATE}T10:00:00.000Z`), end: new Date(`${NARROW_PEAK_DATE}T12:00:00.000Z`) }; // 06:00-08:00 ET

const beforeFix = runTimingSearch({
  mode: 'FIND',
  activityId: 'workout',
  durationMinutes: 30,
  dateRange: { start: NARROW_PEAK_DATE, end: NARROW_PEAK_DATE },
  context: nyContext,
  searchWindow: outerSpan,
  limit: 3,
});
// Overlap semantics (not full containment): the real 3rd candidate here
// (11:45-12:15 UTC) starts inside the gap but straddles past its end --
// still a genuine defect instance under the SAME half-open overlap
// formula the fix itself uses (aStart < bEnd && bStart < aEnd), which is
// the correct test here since that is exactly what excludedIntervals
// checks.
function overlapsGap(candidateStart: string, candidateEnd: string): boolean {
  return new Date(candidateStart).getTime() < gapInterval.end.getTime() && gapInterval.start.getTime() < new Date(candidateEnd).getTime();
}
check(
  'excludedIntervals regression setup: WITHOUT excludedIntervals, this real date/activity genuinely reproduces the pass-3 defect (every one of the 3 returned candidates overlaps the gap)',
  beforeFix.candidates.length === 3 && beforeFix.candidates.every((c) => overlapsGap(c.start, c.end))
);

const afterFix = runTimingSearch({
  mode: 'FIND',
  activityId: 'workout',
  durationMinutes: 30,
  dateRange: { start: NARROW_PEAK_DATE, end: NARROW_PEAK_DATE },
  context: nyContext,
  searchWindow: outerSpan,
  excludedIntervals: [gapInterval],
  limit: 3,
});
check('excludedIntervals: the SAME real defect date now returns candidates when excludedIntervals covers the gap', afterFix.candidates.length > 0);
check(
  'excludedIntervals: none of the returned candidates overlap the excluded gap (half-open overlap check, full candidate span not just start)',
  afterFix.candidates.every((c) => !(new Date(c.start).getTime() < gapInterval.end.getTime() && gapInterval.start.getTime() < new Date(c.end).getTime()))
);
check(
  'excludedIntervals: every returned candidate lies inside one of the two genuinely usable periods (05:00-06:00 or 08:00-09:00 ET)',
  afterFix.candidates.every((c) => {
    const startMs = new Date(c.start).getTime();
    const endMs = new Date(c.end).getTime();
    const firstPeriod = startMs >= outerSpan.start.getTime() && endMs <= gapInterval.start.getTime();
    const secondPeriod = startMs >= gapInterval.end.getTime() && endMs <= outerSpan.end.getTime();
    return firstPeriod || secondPeriod;
  })
);

// Duration-aware filtering (this ticket's own section 6): a candidate
// that only STARTS in usable time but whose own required duration would
// extend into the excluded interval must still be excluded -- checked
// against the FULL candidate span, never just its start instant.
const boundaryStraddle = runTimingSearch({
  mode: 'FIND',
  activityId: 'workout',
  durationMinutes: 30,
  dateRange: { start: NARROW_PEAK_DATE, end: NARROW_PEAK_DATE },
  context: nyContext,
  searchWindow: outerSpan,
  excludedIntervals: [gapInterval],
  limit: 60,
});
check(
  'excludedIntervals: a 30-minute candidate starting at 05:45 ET (would end at 06:15, straddling into the 06:00 gap boundary) is excluded, not merely checked at its start',
  !boundaryStraddle.candidates.some((c) => new Date(c.start).getTime() === new Date(`${NARROW_PEAK_DATE}T09:45:00.000Z`).getTime())
);

// Adjacency (this ticket's own section 5): a candidate ending EXACTLY at
// the excluded interval's start, or starting EXACTLY at its end, is NOT
// excluded -- same half-open [start, end) convention as isWithinWindow.
check(
  'excludedIntervals: a candidate ending exactly at the gap start (05:30-06:00 ET) is NOT excluded -- adjacency remains legal',
  boundaryStraddle.candidates.some((c) => new Date(c.start).getTime() === new Date(`${NARROW_PEAK_DATE}T09:30:00.000Z`).getTime() && new Date(c.end).getTime() === gapInterval.start.getTime())
);
check(
  'excludedIntervals: a candidate starting exactly at the gap end (08:00-08:30 ET) is NOT excluded -- adjacency remains legal',
  boundaryStraddle.candidates.some((c) => new Date(c.start).getTime() === gapInterval.end.getTime())
);

// Full-day / existing callers omitting excludedIntervals entirely are
// unaffected (this ticket's own section 14) -- re-confirms the exact
// unbounded call from earlier in this file already proves this (it
// omits both searchWindow and excludedIntervals and is untouched); this
// check additionally proves supplying searchWindow WITHOUT
// excludedIntervals (PR #146's original, pre-amendment shape) still
// works exactly as it did before this amendment -- the fields are
// independent, neither requires the other.
check('excludedIntervals: searchWindow alone (no excludedIntervals) still works exactly as before this amendment', beforeFix.candidates.length > 0);

console.log(allPassed ? '\nALL TIMING SEARCH CHECKS PASSED' : '\nSOME TIMING SEARCH CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
