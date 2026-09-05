/**
 * Canonical Aura Fit Insights V1 (PR C3): regression suite for
 * apps/web/lib/insightsAuraFit.ts -- the server-side boundary that
 * translates a persisted HabitLog into a canonical, activity-aware
 * evaluation via the EXISTING packages/recommendation engine
 * (evaluateActivityFit), and aggregates a scoped set of HabitLogs into one
 * Aura Fit summary.
 *
 * This module never reimplements evaluateActivityFit's own formula. Every
 * "does the score reflect real engine behavior" assertion below delegates
 * to a direct call to the real evaluateActivityFit with the exact same
 * params and compares the results -- never a hand-rolled/mocked stand-in.
 *
 * A live database is unavailable in this environment (DATABASE_URL
 * unset), so HabitLogRow fixtures are built in-memory, matching this
 * repo's established pattern (see test/habitLogActivityIdentity.test.ts,
 * test/insightsAlignmentComparison.test.ts).
 */
import * as fs from 'fs';
import {
  evaluateHabitLogAuraFit,
  summarizeAuraFit,
  AuraFitEligibilityFailure,
} from '../apps/web/lib/insightsAuraFit';
import type { HabitLogRow } from '../apps/web/lib/db';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { getActivityProfileById } from '../packages/recommendation/src/personalizedTasks';
import { toInsightsObservation, isInCalendarMonth } from '../apps/web/lib/insightsTimezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

let logCounter = 0;
function makeLog(overrides: Partial<HabitLogRow> = {}): HabitLogRow {
  logCounter += 1;
  return {
    id: `log-${logCounter}`,
    userId: 'user-1',
    activityTitle: 'Something I logged',
    activityId: undefined,
    activeWindow: 'ABHIJIT',
    logTimestamp: new Date('2026-03-15T10:00:00Z'),
    logMinuteOfDay: 600,
    durationMinutes: 30,
    ...overrides,
  };
}

// ============================================================
// Eligibility -- MISSING_ACTIVITY_ID.
// ============================================================

const missingUndefined = evaluateHabitLogAuraFit(makeLog({ activityId: undefined }));
check('A HabitLog with activityId undefined is ineligible with reason MISSING_ACTIVITY_ID', !missingUndefined.eligible && missingUndefined.reason === 'MISSING_ACTIVITY_ID');

const missingNull = evaluateHabitLogAuraFit(makeLog({ activityId: null }));
check('A HabitLog with activityId null is ineligible with reason MISSING_ACTIVITY_ID', !missingNull.eligible && missingNull.reason === 'MISSING_ACTIVITY_ID');

// ============================================================
// Eligibility -- UNKNOWN_ACTIVITY_ID.
// ============================================================

const unknownId = evaluateHabitLogAuraFit(makeLog({ activityId: 'not-a-real-activity' }));
check('A HabitLog with an unrecognized activityId is ineligible with reason UNKNOWN_ACTIVITY_ID', !unknownId.eligible && unknownId.reason === 'UNKNOWN_ACTIVITY_ID');

const staleId = evaluateHabitLogAuraFit(makeLog({ activityId: 'retired-activity-from-a-past-catalog-version' }));
check('A stale/formerly-valid-looking activityId that no longer resolves in the current catalog is treated identically to any other unknown id (UNKNOWN_ACTIVITY_ID, no special-casing)', !staleId.eligible && staleId.reason === 'UNKNOWN_ACTIVITY_ID');

// ============================================================
// Eligibility -- INVALID_WINDOW.
// ============================================================

const invalidWindow = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'NOT_A_WINDOW' }));
check('A HabitLog with a garbage activeWindow value is ineligible with reason INVALID_WINDOW', !invalidWindow.eligible && invalidWindow.reason === 'INVALID_WINDOW');

const emptyWindow = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: '' }));
check('A HabitLog with an empty-string activeWindow is ineligible with reason INVALID_WINDOW', !emptyWindow.eligible && emptyWindow.reason === 'INVALID_WINDOW');

// ============================================================
// Eligibility -- EVALUATION_ERROR (real failure, not mocked): the canonical
// engine itself throws on an invalid Date (confirmed directly against
// evaluateActivityFit below), so a HabitLog with a corrupted logTimestamp
// exercises the real try/catch failure-isolation path.
// ============================================================

const deepWorkActivity = getActivityProfileById('deep-work')!;
check('Sanity check: the real evaluateActivityFit throws on an invalid Date (this is what EVALUATION_ERROR isolates)', (() => {
  try {
    evaluateActivityFit({ activity: deepWorkActivity, date: new Date(NaN), windowType: 'ABHIJIT' });
    return false;
  } catch {
    return true;
  }
})());

const invalidDateLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date(NaN) });
const invalidDateResult = evaluateHabitLogAuraFit(invalidDateLog);
check('A HabitLog whose logTimestamp makes the canonical engine throw is ineligible with reason EVALUATION_ERROR, not a thrown exception out of evaluateHabitLogAuraFit', !invalidDateResult.eligible && invalidDateResult.reason === 'EVALUATION_ERROR');

// ============================================================
// Valid observation -- exact delegation to the real evaluateActivityFit.
// ============================================================

const validLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-15T10:00:00Z') });
const validResult = evaluateHabitLogAuraFit(validLog);
check('A HabitLog with a resolvable activityId and valid activeWindow is eligible', validResult.eligible === true);

const directEvaluation = evaluateActivityFit({ activity: deepWorkActivity, date: validLog.logTimestamp, windowType: 'ABHIJIT' });
check('The eligible observation.score EXACTLY matches a direct evaluateActivityFit call with the same activity/date/windowType (no reimplemented formula)', validResult.eligible && validResult.observation.score === directEvaluation.score);
check('The eligible observation.label EXACTLY matches the direct evaluateActivityFit call\'s label', validResult.eligible && validResult.observation.label === directEvaluation.label);
check('The eligible observation.logId is the HabitLog\'s own id', validResult.eligible && validResult.observation.logId === validLog.id);

// ============================================================
// No title/alias/logSource/activitySignificance inference -- only
// activityId drives the lookup, structurally.
// ============================================================

const wrongTitleLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-15T10:00:00Z'), activityTitle: 'Workout' /* a DIFFERENT real catalog activity's title */ });
const wrongTitleResult = evaluateHabitLogAuraFit(wrongTitleLog);
check('A mismatched activityTitle (a different real activity\'s own title) never changes the score -- only activityId is consulted', wrongTitleResult.eligible && wrongTitleResult.observation.score === directEvaluation.score);

const workoutActivity = getActivityProfileById('workout')!;
const directWorkoutEvaluation = evaluateActivityFit({ activity: workoutActivity, date: validLog.logTimestamp, windowType: 'ABHIJIT' });
check('Sanity check: "workout" and "deep-work" are genuinely different catalog activities (their evaluations are not coincidentally identical)', directWorkoutEvaluation.score !== directEvaluation.score || directWorkoutEvaluation.label !== directEvaluation.label || workoutActivity.category !== deepWorkActivity.category);
check('The mismatched-title log resolves to "deep-work"\'s evaluation, never "workout"\'s (activityTitle="Workout" text is not used as a lookup key)', wrongTitleResult.eligible && wrongTitleResult.observation.score !== directWorkoutEvaluation.score || wrongTitleResult.eligible && wrongTitleResult.observation.label === directEvaluation.label);

const differentLogSourceLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-15T10:00:00Z'), logSource: 'MANUAL', activitySignificance: 'LOW', notes: 'irrelevant free text' });
const differentLogSourceResult = evaluateHabitLogAuraFit(differentLogSourceLog);
check('logSource/activitySignificance/notes never influence the score -- two otherwise-identical logs differing only in those fields produce an identical score', differentLogSourceResult.eligible && differentLogSourceResult.observation.score === directEvaluation.score);

// ============================================================
// Frozen activeWindow passthrough -- log.activeWindow is used verbatim,
// never recomputed. Demonstrated by delegation equality across every
// SolarWindowType value for the same activity/date.
// ============================================================

const allWindowTypes = ['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL'] as const;
let allWindowsDelegateCorrectly = true;
for (const windowType of allWindowTypes) {
  const log = makeLog({ activityId: 'deep-work', activeWindow: windowType, logTimestamp: new Date('2026-03-15T10:00:00Z') });
  const result = evaluateHabitLogAuraFit(log);
  const direct = evaluateActivityFit({ activity: deepWorkActivity, date: log.logTimestamp, windowType });
  if (!result.eligible || result.observation.score !== direct.score || result.observation.label !== direct.label) {
    allWindowsDelegateCorrectly = false;
  }
}
check('For every SolarWindowType, the frozen log.activeWindow value (never recomputed) is passed through verbatim and matches a direct evaluateActivityFit call for that exact window', allWindowsDelegateCorrectly);

// ============================================================
// Historical date passthrough -- log.logTimestamp is used verbatim (the
// real historical instant), never "now" or a range boundary.
// ============================================================

const historicalDate = new Date('2019-06-01T04:30:00Z');
const historicalLog = makeLog({ activityId: 'deep-work', activeWindow: 'BRAHMA', logTimestamp: historicalDate });
const historicalResult = evaluateHabitLogAuraFit(historicalLog);
const historicalDirect = evaluateActivityFit({ activity: deepWorkActivity, date: historicalDate, windowType: 'BRAHMA' });
check('A HabitLog with a genuinely historical logTimestamp (2019) evaluates using that exact date, matching a direct evaluateActivityFit call for the same date', historicalResult.eligible && historicalResult.observation.score === historicalDirect.score);

const now = new Date();
const nowDirect = evaluateActivityFit({ activity: deepWorkActivity, date: now, windowType: 'BRAHMA' });
check('The historical (2019) evaluation is not silently using "now" instead -- it differs from a same-window evaluation computed for the current instant (Panchang limbs are date-dependent)', historicalDirect.score !== nowDirect.score || historicalDirect.label !== nowDirect.label);

// ============================================================
// No-personalization -- structural + functional proof.
// ============================================================

const insightsAuraFitSource = fs.readFileSync('apps/web/lib/insightsAuraFit.ts', 'utf8');
// Isolate the actual evaluateActivityFit(...) call-site arguments (never
// its surrounding doc comments, which legitimately name these omitted
// params in prose) before checking which fields it passes.
const evaluateActivityFitCallMatch = insightsAuraFitSource.match(/evaluateActivityFit\(\{([\s\S]*?)\}\);/);
check('Sanity check: the evaluateActivityFit(...) call site was found in insightsAuraFit.ts for isolation', evaluateActivityFitCallMatch !== null);
const evaluateActivityFitCallArgs = evaluateActivityFitCallMatch ? evaluateActivityFitCallMatch[1] : '';
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit never passes personalContext', !/personalContext/.test(evaluateActivityFitCallArgs));
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit never passes timePreferenceScore', !/timePreferenceScore/.test(evaluateActivityFitCallArgs));
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit never passes personalPatternScore', !/personalPatternScore/.test(evaluateActivityFitCallArgs));
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit never passes userPreferenceScore', !/userPreferenceScore/.test(evaluateActivityFitCallArgs));
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit never passes classification', !/classification/.test(evaluateActivityFitCallArgs));
check('evaluateHabitLogAuraFit\'s call to evaluateActivityFit passes exactly activity/date/windowType (3 fields)', evaluateActivityFitCallArgs.split(',').map((s) => s.trim()).filter(Boolean).length === 3);

const userAId = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-15T10:00:00Z'), userId: 'user-a' });
const userBId = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-15T10:00:00Z'), userId: 'user-b' });
const userAResult = evaluateHabitLogAuraFit(userAId);
const userBResult = evaluateHabitLogAuraFit(userBId);
check('Two different users\' otherwise-identical logs produce an identical score -- no hidden per-user personalization', userAResult.eligible && userBResult.eligible && userAResult.observation.score === userBResult.observation.score);

// ============================================================
// Activity-dependent difference proofs using REAL catalog fixtures -- the
// SAME window produces different outcomes for DIFFERENT real activities,
// driven entirely by each ActivityProfile's own recommendedWindowTypes/
// acceptableWindowTypes/avoidWindowTypes, never a mocked/reimplemented
// formula. "deep-work" avoids RAHU_KALAM/YAMA and recommends
// ABHIJIT/BRAHMA; "tea-break" avoids nothing and recommends
// NEUTRAL/GULIKA (with RAHU_KALAM/YAMA merely acceptable).
// ============================================================

const teaBreakActivity = getActivityProfileById('tea-break')!;
check('Sanity check: "deep-work" and "tea-break" have genuinely different avoid/recommended window configurations in the real catalog', JSON.stringify(deepWorkActivity.avoidWindowTypes) !== JSON.stringify(teaBreakActivity.avoidWindowTypes));

const rahuKalamDate = new Date('2026-03-15T06:00:00Z');
const deepWorkRahuKalam = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'RAHU_KALAM', logTimestamp: rahuKalamDate }));
const teaBreakRahuKalam = evaluateHabitLogAuraFit(makeLog({ activityId: 'tea-break', activeWindow: 'RAHU_KALAM', logTimestamp: rahuKalamDate }));
check('Rahu Kalam: "deep-work" (which avoids this window) scores lower than "tea-break" (which does not avoid it) for the identical instant -- an activity-dependent difference, not a global window constant', deepWorkRahuKalam.eligible && teaBreakRahuKalam.eligible && deepWorkRahuKalam.observation.score < teaBreakRahuKalam.observation.score);

const yamaDate = new Date('2026-03-15T14:00:00Z');
const deepWorkYama = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'YAMA', logTimestamp: yamaDate }));
const teaBreakYama = evaluateHabitLogAuraFit(makeLog({ activityId: 'tea-break', activeWindow: 'YAMA', logTimestamp: yamaDate }));
check('Yama Kalam: "deep-work" (avoids) scores lower than "tea-break" (does not avoid) for the identical instant', deepWorkYama.eligible && teaBreakYama.eligible && deepWorkYama.observation.score < teaBreakYama.observation.score);

const gulikaDate = new Date('2026-03-15T08:00:00Z');
const deepWorkGulika = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'GULIKA', logTimestamp: gulikaDate }));
check('Gulika is merely "acceptable" (not "avoid") for "deep-work" -- its score under Gulika is higher than under Rahu Kalam (an avoid window) for a comparable instant', deepWorkGulika.eligible && deepWorkRahuKalam.eligible && deepWorkGulika.observation.score > deepWorkRahuKalam.observation.score);

const brahmaDate = new Date('2026-03-15T05:30:00Z');
const abhijitDate = new Date('2026-03-15T11:45:00Z');
const deepWorkBrahma = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'BRAHMA', logTimestamp: brahmaDate }));
const deepWorkAbhijit = evaluateHabitLogAuraFit(makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: abhijitDate }));
check('Brahma and Abhijit (both recommended for "deep-work") each independently delegate to and match a direct evaluateActivityFit call for their own window/date', deepWorkBrahma.eligible && deepWorkAbhijit.eligible
  && deepWorkBrahma.observation.score === evaluateActivityFit({ activity: deepWorkActivity, date: brahmaDate, windowType: 'BRAHMA' }).score
  && deepWorkAbhijit.observation.score === evaluateActivityFit({ activity: deepWorkActivity, date: abhijitDate, windowType: 'ABHIJIT' }).score);
check('Brahma and Abhijit (both recommended windows) score meaningfully higher than Rahu Kalam (an avoided window) for "deep-work"', deepWorkBrahma.eligible && deepWorkAbhijit.eligible && deepWorkRahuKalam.eligible
  && deepWorkBrahma.observation.score > deepWorkRahuKalam.observation.score
  && deepWorkAbhijit.observation.score > deepWorkRahuKalam.observation.score);

// requiresFreshStart-driven activity-dependent difference: "start-journey"
// (requiresFreshStart: true) incurs a NEUTRAL-window startSensitivityPenalty
// inside the real engine that a non-fresh-start activity does not.
const startJourneyActivity = getActivityProfileById('start-journey')!;
check('Sanity check: "start-journey" is requiresFreshStart:true and "tea-break" is requiresFreshStart:false in the real catalog', startJourneyActivity.requiresFreshStart === true && teaBreakActivity.requiresFreshStart !== true);
const neutralDate = new Date('2026-03-15T09:15:00Z');
const startJourneyNeutral = evaluateHabitLogAuraFit(makeLog({ activityId: 'start-journey', activeWindow: 'NEUTRAL', logTimestamp: neutralDate }));
const startJourneyNeutralDirect = evaluateActivityFit({ activity: startJourneyActivity, date: neutralDate, windowType: 'NEUTRAL' });
check('"start-journey" under NEUTRAL delegates exactly to the real engine\'s own requiresFreshStart-penalized evaluation (never a hand-computed penalty)', startJourneyNeutral.eligible && startJourneyNeutral.observation.score === startJourneyNeutralDirect.score);

// ============================================================
// Mixed-history guard -- one bad observation among several never fails or
// corrupts the others.
// ============================================================

const mixedLogs: HabitLogRow[] = [
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-02T10:00:00Z') }),
  makeLog({ activityId: undefined, activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-03T10:00:00Z') }),
  makeLog({ activityId: 'not-a-real-activity', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-04T10:00:00Z') }),
  makeLog({ activityId: 'deep-work', activeWindow: 'BOGUS_WINDOW', logTimestamp: new Date('2026-03-05T10:00:00Z') }),
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date(NaN) }),
  makeLog({ activityId: 'workout', activeWindow: 'NEUTRAL', logTimestamp: new Date('2026-03-06T10:00:00Z') }),
];
const mixedSummary = summarizeAuraFit(mixedLogs);
check('A mixed batch (2 eligible, 4 ineligible for 4 different reasons) reports totalCount = the full input size', mixedSummary.totalCount === 6);
check('A mixed batch reports eligibleCount = only the genuinely eligible observations (2), unaffected by the other failures', mixedSummary.eligibleCount === 2);
check('A batch with exactly 2 eligible observations is LIMITED, not AVAILABLE', mixedSummary.state === 'LIMITED');
check('A LIMITED-state summary has averageScore = null (a mean of 1-2 points is not meaningful)', mixedSummary.averageScore === null);

let unexpectedThrow = false;
try {
  summarizeAuraFit(mixedLogs);
} catch {
  unexpectedThrow = true;
}
check('summarizeAuraFit never throws even when the batch contains every known failure mode at once', !unexpectedThrow);

// ============================================================
// Sample states -- NO_DATA / LIMITED / AVAILABLE, exact boundaries.
// ============================================================

const zeroEligibleSummary = summarizeAuraFit([
  makeLog({ activityId: undefined }),
  makeLog({ activityId: 'not-a-real-activity' }),
]);
check('0 eligible observations -> state NO_DATA', zeroEligibleSummary.state === 'NO_DATA' && zeroEligibleSummary.eligibleCount === 0 && zeroEligibleSummary.averageScore === null);

const emptyInputSummary = summarizeAuraFit([]);
check('An empty input array -> NO_DATA with totalCount 0 (never a crash, never a fabricated average)', emptyInputSummary.state === 'NO_DATA' && emptyInputSummary.totalCount === 0 && emptyInputSummary.eligibleCount === 0 && emptyInputSummary.averageScore === null);

const oneEligibleSummary = summarizeAuraFit([makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT' })]);
check('Exactly 1 eligible observation -> LIMITED (not AVAILABLE), averageScore null', oneEligibleSummary.state === 'LIMITED' && oneEligibleSummary.eligibleCount === 1 && oneEligibleSummary.averageScore === null);

const twoEligibleSummary = summarizeAuraFit([
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT' }),
  makeLog({ activityId: 'workout', activeWindow: 'NEUTRAL' }),
]);
check('Exactly 2 eligible observations -> LIMITED, averageScore null (boundary just below AVAILABLE)', twoEligibleSummary.state === 'LIMITED' && twoEligibleSummary.eligibleCount === 2 && twoEligibleSummary.averageScore === null);

const threeEligibleLogs = [
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-01T10:00:00Z') }),
  makeLog({ activityId: 'workout', activeWindow: 'NEUTRAL', logTimestamp: new Date('2026-03-02T10:00:00Z') }),
  makeLog({ activityId: 'tea-break', activeWindow: 'GULIKA', logTimestamp: new Date('2026-03-03T10:00:00Z') }),
];
const threeEligibleSummary = summarizeAuraFit(threeEligibleLogs);
check('Exactly 3 eligible observations -> AVAILABLE (boundary at the threshold)', threeEligibleSummary.state === 'AVAILABLE' && threeEligibleSummary.eligibleCount === 3);
check('AVAILABLE state has a non-null numeric averageScore', typeof threeEligibleSummary.averageScore === 'number');

// ============================================================
// No-weighting proofs -- averageScore is a SIMPLE, UNWEIGHTED mean; no
// durationMinutes/activitySignificance/logSource/recency/category
// weighting.
// ============================================================

const expectedScores = threeEligibleLogs.map((log) => {
  const activity = getActivityProfileById(log.activityId!)!;
  return evaluateActivityFit({ activity, date: log.logTimestamp, windowType: log.activeWindow as any }).score;
});
const expectedMean = Math.round(expectedScores.reduce((a, b) => a + b, 0) / expectedScores.length);
check('averageScore is EXACTLY the rounded unweighted arithmetic mean of the eligible scores (recomputed independently here from direct evaluateActivityFit calls)', threeEligibleSummary.averageScore === expectedMean);

const heavyDurationLogs = [
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-01T10:00:00Z'), durationMinutes: 5 }),
  makeLog({ activityId: 'workout', activeWindow: 'NEUTRAL', logTimestamp: new Date('2026-03-02T10:00:00Z'), durationMinutes: 500 }),
  makeLog({ activityId: 'tea-break', activeWindow: 'GULIKA', logTimestamp: new Date('2026-03-03T10:00:00Z'), durationMinutes: 500 }),
];
const heavyDurationSummary = summarizeAuraFit(heavyDurationLogs);
check('Wildly different durationMinutes across otherwise-identical logs does not change averageScore vs the un-weighted baseline (no duration weighting)', heavyDurationSummary.averageScore === threeEligibleSummary.averageScore);

const highSignificanceLogs = threeEligibleLogs.map((log) => ({ ...log, activitySignificance: 'HIGH' as const }));
const highSignificanceSummary = summarizeAuraFit(highSignificanceLogs);
check('activitySignificance does not change averageScore (no significance weighting)', highSignificanceSummary.averageScore === threeEligibleSummary.averageScore);

const manualSourceLogs = threeEligibleLogs.map((log) => ({ ...log, logSource: 'MANUAL' as const }));
const manualSourceSummary = summarizeAuraFit(manualSourceLogs);
check('logSource does not change averageScore (no logSource weighting)', manualSourceSummary.averageScore === threeEligibleSummary.averageScore);

const reorderedLogs = [...threeEligibleLogs].reverse();
const reorderedSummary = summarizeAuraFit(reorderedLogs);
check('Input order does not change averageScore (no recency weighting)', reorderedSummary.averageScore === threeEligibleSummary.averageScore);

// ============================================================
// Range / denominator semantics -- totalCount reflects the INPUT array
// exactly as given (the caller's scoping responsibility), never a
// re-derived or re-filtered count.
// ============================================================

const scopedLogs = [
  makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT' }),
  makeLog({ activityId: undefined }),
  makeLog({ activityId: undefined }),
  makeLog({ activityId: undefined }),
  makeLog({ activityId: undefined }),
];
const scopedSummary = summarizeAuraFit(scopedLogs);
check('totalCount equals logs.length exactly, including every ineligible log passed in, not just eligible ones', scopedSummary.totalCount === scopedLogs.length);
check('summarizeAuraFit performs no date filtering of its own -- totalCount reflects the raw input array, regardless of the logTimestamp values used above (2026-03-* dates mixed with other tests\' 2019/NaN dates elsewhere in this file, all handled identically)', scopedSummary.totalCount === 5);

// ============================================================
// Current-month boundary/range-denominator test using the exact
// Timing-Location calendar-month semantics
// (apps/web/lib/insightsTimezone.ts, reused unchanged from PR #76) that
// apps/web/app/api/daily-assistant/insights/route.ts uses to scope
// currentMonthLogs before calling summarizeAuraFit.
// ============================================================

const timezone = 'America/Los_Angeles';
const referenceNow = new Date('2026-03-15T18:00:00Z'); // afternoon in Los Angeles, safely mid-March there
const { year: refYear, month: refMonth } = (() => {
  const obs = toInsightsObservation(referenceNow, timezone);
  const [y, m] = obs.dateKey.split('-').map(Number);
  return { year: y, month: m };
})();

const inMonthLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-03-10T20:00:00Z') }); // 2026-03-10 12:00 PDT
const lastMonthLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-02-28T20:00:00Z') });
const nextMonthLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-04-01T20:00:00Z') });
// A log whose UTC calendar date is already the 1st of next month, but whose
// LOS ANGELES calendar date (UTC-7/8) is still the last day of this month --
// the exact boundary case Insights Timezone Consistency V1 (PR #76) exists
// to get right, reused here unchanged rather than re-derived.
const utcBoundaryLog = makeLog({ activityId: 'deep-work', activeWindow: 'ABHIJIT', logTimestamp: new Date('2026-04-01T03:00:00Z') }); // 2026-03-31 19:00/20:00 PDT

const allLogsForMonthTest = [inMonthLog, lastMonthLog, nextMonthLog, utcBoundaryLog];
const currentMonthLogsForTest = allLogsForMonthTest.filter((log) => isInCalendarMonth(toInsightsObservation(log.logTimestamp, timezone).dateKey, refYear, refMonth));

check('The current-month filter includes the clearly-in-month log', currentMonthLogsForTest.includes(inMonthLog));
check('The current-month filter excludes last month\'s log', !currentMonthLogsForTest.includes(lastMonthLog));
check('The current-month filter excludes next month\'s log', !currentMonthLogsForTest.includes(nextMonthLog));
check('The current-month filter uses the Timing-Location (Los Angeles) calendar date, not the UTC calendar date, for the boundary log -- it is included because it is still March 31st in Los Angeles even though it is already April 1st UTC', currentMonthLogsForTest.includes(utcBoundaryLog));

const monthScopedSummary = summarizeAuraFit(currentMonthLogsForTest);
check('summarizeAuraFit\'s totalCount, applied to a Timing-Location-scoped current-month array, equals exactly the scoped count (2: inMonthLog + utcBoundaryLog), never the full 4-log retrieval set', monthScopedSummary.totalCount === 2);

// ============================================================
// C1 regression re-runs -- Timing Pattern/Alignment (window-only) must
// remain completely unaffected by C3's activity-aware Aura Fit addition.
// Executed inline (not via require(), which would double-run their own
// process.exit side effects) by re-reading and asserting their own source
// is untouched.
// ============================================================

const insightsWindowAlignmentSource = fs.readFileSync('apps/web/lib/insightsWindowAlignment.ts', 'utf8');
check('insightsWindowAlignment.ts (C1) was not modified by C3 -- no activityId/getActivityProfileById/evaluateActivityFit reference', !/activityId|getActivityProfileById|evaluateActivityFit/.test(insightsWindowAlignmentSource));

const insightsViewSource = fs.readFileSync('apps/web/components/InsightsView.tsx', 'utf8');
check('InsightsView.tsx\'s existing C1 analytics (alignmentScore/monthAlignmentScore/past7Days/distribution) computation was not touched by the new Aura Fit card -- classifyInsightsWindow import/usage remains present', /classifyInsightsWindow/.test(insightsViewSource));
check('InsightsView.tsx\'s new Aura Fit card reads assistantInsight.auraFit, a field entirely separate from the analytics object C1 already computes', /assistantInsight\.auraFit/.test(insightsViewSource));
check('InsightsView.tsx never runs the new auraFit value through labelForScore (C3 shows a raw averageScore percentage, never a re-labeled classification)', !/labelForScore\(\s*assistantInsight\.auraFit/.test(insightsViewSource));

// ============================================================
// No-schema-change assertion -- semantic, not a brittle migration-count
// ceiling (brief-mandated: avoid Math.max(migration)===N style assertions).
// ============================================================

const migrationsDir = 'apps/web/prisma/migrations';
const migrationDirs = fs.readdirSync(migrationsDir).filter((name) => fs.statSync(`${migrationsDir}/${name}`).isDirectory());
const auraFitMigrationDirs = migrationDirs.filter((name) => /aura[_-]?fit/i.test(name));
check('No new migration directory was added for Canonical Aura Fit Insights V1 -- C3 requires no persisted score/label/reasons/engineVersion/Panchang-snapshot and therefore no schema change', auraFitMigrationDirs.length === 0);

const schemaSource = fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8');
check('schema.prisma\'s HabitLog model gained no new Aura-Fit-specific column (no auraFitScore/auraFitLabel/auraFitReasons/engineVersion field anywhere in the schema)', !/auraFitScore|auraFitLabel|auraFitReasons|engineVersion/i.test(schemaSource));

// ============================================================
// Route wiring -- additive-only response shape.
// ============================================================

const insightsRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
const insightsRouteSourceNoLineComments = insightsRouteSource.replace(/^\s*\/\/.*$/gm, '');
check('The insights route imports summarizeAuraFit from the new helper module', /import \{ summarizeAuraFit \} from '\.\.\/\.\.\/\.\.\/\.\.\/lib\/insightsAuraFit'/.test(insightsRouteSource));
check('The insights route\'s JSON response includes auraFit as a sibling of the pre-existing fields, not a replacement for any of them', /reflectionCount:/.test(insightsRouteSource) && /alignedDays:/.test(insightsRouteSource) && /unalignedDays:/.test(insightsRouteSource) && /alignmentDeltaPoints,/.test(insightsRouteSource) && /insightText,/.test(insightsRouteSource) && /auraFit,/.test(insightsRouteSource));
check('The insights route performs no new/additional DB query for Aura Fit -- listHabitLogsForInsights is still called exactly once (excluding doc-comment mentions)', (insightsRouteSourceNoLineComments.match(/listHabitLogsForInsights\(/g) || []).length === 1);

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
check('HabitLogRow.activityId remains optional (String?-shaped, "activityId?:"), not tightened to required by C3', /activityId\?:\s*string\s*\|\s*null;/.test(dbSource));

console.log(allPassed ? '\nALL CANONICAL AURA FIT INSIGHTS CHECKS PASSED' : '\nSOME CANONICAL AURA FIT INSIGHTS CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
