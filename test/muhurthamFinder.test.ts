import { blendStartSensitiveScore, findMuhurthams, isSupportedMuhurthamActivity, START_SENSITIVITY_PROBE_MINUTES, START_SENSITIVITY_WEIGHT, SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import { evaluateTimingCandidate } from '../packages/recommendation/src/timingSearch';
import { profileFromActivity } from '../packages/recommendation/src/dailyAssistant';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// DOMAIN
// ============================================================

const journeyResult = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});

check('Known SUPPORTED activity (start-journey) returns a non-empty result', journeyResult.dates.length > 0);
check('Returns at most `limit` dates', journeyResult.dates.length <= 5);
check('evaluatedDateCount matches the requested date range (30 days)', journeyResult.evaluatedDateCount === 30);
check('Returned dates are chronologically ordered for display', journeyResult.dates.every((d, i) => i === 0 || journeyResult.dates[i - 1].date <= d.date));
check('Every returned date falls within the requested range', journeyResult.dates.every((d) => d.date >= '2026-09-01' && d.date <= '2026-09-30'));
check('Every date has a bestWindow with a score on the 0-10 scale', journeyResult.dates.every((d) => d.bestWindow.score >= 0 && d.bestWindow.score <= 10));
check('bestWindow score matches the date-level score (best window IS the ranking score)', journeyResult.dates.every((d) => d.bestWindow.score === d.score));
check('bestWindow respects the requested 60-minute duration', journeyResult.dates.every((d) => new Date(d.bestWindow.end).getTime() - new Date(d.bestWindow.start).getTime() === 60 * 60000));
check('Each date carries a Panchang summary (Vara/Tithi/Nakshatra/Yoga/Karana)', journeyResult.dates.every((d) => d.panchangSummary.vara && d.panchangSummary.tithi && d.panchangSummary.nakshatra && d.panchangSummary.yoga && d.panchangSummary.karana));
check('reasons only carries SUPPORT-polarity entries', journeyResult.dates.every((d) => d.reasons.every((r) => r.polarity === 'SUPPORT')));
check('cautions only carries CAUTION/BLOCK-polarity entries', journeyResult.dates.every((d) => d.cautions.every((r) => r.polarity === 'CAUTION' || r.polarity === 'BLOCK')));
check('Activity metadata matches the catalog entry (id/title/icon)', journeyResult.activity.id === 'start-journey' && journeyResult.activity.title === 'Start a Journey' && journeyResult.activity.icon === '🚗');

// Global ranking: the set of returned dates must be the actual top-`limit`
// by score across the whole range, not merely the first N chronologically.
const journeyAllDates = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 30,
  context: chennaiContext,
});
const top5ByScore = [...journeyAllDates.dates].sort((a, b) => b.score - a.score).slice(0, 5).map((d) => d.date).sort();
check('Dates are ranked by score globally, not just the first N chronologically', JSON.stringify(top5ByScore) === JSON.stringify([...journeyResult.dates].map((d) => d.date).sort()));

// Rating thresholds respect BLOCK/CAUTION -- a date with cautions can't reach EXCELLENT.
check('A date with any caution/conflict never rates EXCELLENT', journeyAllDates.dates.every((d) => d.rating !== 'EXCELLENT' || d.cautions.length === 0));
check('EXCELLENT dates always score >= 9.0, STRONG >= 8.0, FAVORABLE >= 7.0 (documented thresholds)', journeyAllDates.dates.every((d) => {
  if (d.rating === 'EXCELLENT') return d.score >= 9.0;
  if (d.rating === 'STRONG') return d.score >= 8.0;
  if (d.rating === 'FAVORABLE') return d.score >= 7.0;
  return true;
}));

// Time preference is respected.
const morningOnly = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-10' },
  timePreference: 'MORNING',
  durationMinutes: 45,
  limit: 5,
  context: chennaiContext,
});
check('timePreference=MORNING restricts bestWindow start to the morning band (05:00-12:00 IST)', morningOnly.dates.every((d) => {
  const start = new Date(d.bestWindow.start);
  const istHour = (start.getUTCHours() + 5 + Math.floor((start.getUTCMinutes() + 30) / 60)) % 24;
  return istHour >= 5 && istHour < 12;
}));

// Duration is respected for a longer request too.
const longDuration = findMuhurthams({
  activityId: 'financial-decision',
  dateRange: { start: '2026-09-01', end: '2026-09-10' },
  timePreference: 'ANY',
  durationMinutes: 180,
  limit: 5,
  context: chennaiContext,
});
check('A 180-minute request produces 180-minute windows', longDuration.dates.every((d) => new Date(d.bestWindow.end).getTime() - new Date(d.bestWindow.start).getTime() === 180 * 60000));

// Unsupported / unknown activities are rejected, not silently degraded.
check('isSupportedMuhurthamActivity is true for all documented supported ids', SUPPORTED_MUHURTHAM_ACTIVITY_IDS.every((id) => isSupportedMuhurthamActivity(id)));
check('isSupportedMuhurthamActivity is false for a LIGHT-depth activity (tea-break)', !isSupportedMuhurthamActivity('tea-break'));
let threwForUnsupported = false;
try {
  findMuhurthams({ activityId: 'tea-break', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: chennaiContext });
} catch {
  threwForUnsupported = true;
}
check('findMuhurthams throws for a not-yet-supported activity rather than returning a manufactured result', threwForUnsupported);

let threwForUnknown = false;
try {
  findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: chennaiContext });
} catch {
  threwForUnknown = true;
}
check('findMuhurthams throws for an unknown activityId (marriage does not exist as a catalog activity yet)', threwForUnknown);

// ============================================================
// REJECTS/PENALIZES BLOCKERS, PRESERVES CAUTIONS (no new scoring formula)
// ============================================================

// Cross-check: findMuhurthams' bestWindow score for a given date must equal
// blendStartSensitiveScore() applied to two DIRECT evaluateTimingCandidate()
// calls (full duration + the start-sensitivity commencement probe) -- proves
// no second/hidden scoring formula exists, only the documented blend of the
// same reused primitive (start-journey is start-sensitive, see section 7).
const activity = findActivityIntent('start a journey')!;
const profile = profileFromActivity(activity);
const directFullCandidate = evaluateTimingCandidate({
  profile,
  start: new Date(journeyResult.dates[0].bestWindow.start),
  durationMinutes: 60,
  context: chennaiContext,
});
const directProbeCandidate = evaluateTimingCandidate({
  profile,
  start: new Date(journeyResult.dates[0].bestWindow.start),
  durationMinutes: Math.min(60, START_SENSITIVITY_PROBE_MINUTES),
  context: chennaiContext,
});
const expectedBlendedScore = blendStartSensitiveScore(directFullCandidate.score, directProbeCandidate.score);
check('bestWindow score for a date equals blendStartSensitiveScore() of two direct evaluateTimingCandidate() calls (no hidden scoring formula)', expectedBlendedScore === journeyResult.dates[0].bestWindow.score);
const combinedReasons = [...journeyResult.dates[0].reasons, ...journeyResult.dates[0].cautions];
const sortByCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
check('bestWindow reasons for a date match evaluateTimingCandidate() called directly (same reasons, not re-derived -- blending only ever touches score/label)', JSON.stringify([...directFullCandidate.reasons].sort(sortByCode)) === JSON.stringify([...combinedReasons].sort(sortByCode)));

// ============================================================
// INTERVAL OVERLAP AFFECTS SUITABILITY (brief section 7)
// ============================================================

// A candidate window whose evaluation carries FRICTION_WINDOW_BLOCKED must
// never surface as a bestWindow/alternateWindow -- confirmed indirectly by
// checking every returned window across a wide range never reports that
// conflict (findBestWindowsForDate excludes them before ranking).
const wideRangeForOverlapCheck = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 30,
  limit: 30,
  context: chennaiContext,
});
check('No surfaced window (best or alternate) ever carries a FRICTION_WINDOW_BLOCKED conflict', wideRangeForOverlapCheck.dates.every((d) => {
  const allWindows = [d.bestWindow, ...d.alternateWindows];
  return allWindows.every((w) => {
    const c = evaluateTimingCandidate({ profile, start: new Date(w.start), durationMinutes: 30, context: chennaiContext });
    return !c.conflicts?.some((conflict) => conflict.type === 'FRICTION_WINDOW_BLOCKED');
  });
}));

// Deterministic fixture matching the brief's own section-7 example: on
// 2026-09-02 in Chennai, ABHIJIT (06:14-07:04 UTC) overlaps RAHU_KALAM
// (06:40-08:13 UTC). A 30-minute window starting at ABHIJIT's own start
// (06:14) extends to 06:44 and so crosses into Rahu Kalam at 06:40 -- it
// must NOT be treated as a clean Abhijit window. A 20-minute window from
// the same start (06:14-06:34) stays entirely before Rahu begins and should
// remain the clean, higher-scoring option.
const overlapDate30min = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-02', end: '2026-09-02' },
  timePreference: 'ANY',
  durationMinutes: 30,
  limit: 5,
  context: chennaiContext,
});
check('A 30-min window whose span crosses from Abhijit into Rahu Kalam is not selected as the best window', overlapDate30min.dates.length === 0 || new Date(overlapDate30min.dates[0].bestWindow.start).toISOString() !== '2026-09-02T06:14:00.000Z');

const overlapDate20min = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-02', end: '2026-09-02' },
  timePreference: 'ANY',
  durationMinutes: 20,
  limit: 5,
  context: chennaiContext,
});
check('A 20-min window at the same start, which stays clear of Rahu Kalam, IS selected as the best window (interval-overlap, not window-membership, drives the decision)', overlapDate20min.dates.length === 1 && overlapDate20min.dates[0].bestWindow.start === '2026-09-02T06:14:00.000Z');
check('The 20-min clean Abhijit window scores higher than an inclusion floor and reflects Abhijit support', overlapDate20min.dates.length === 1 && overlapDate20min.dates[0].reasons.some((r) => r.code === 'ABHIJIT_SUPPORT'));

// ============================================================
// RANGE / TIMEZONE
// ============================================================

const range90 = findMuhurthams({
  activityId: 'new-beginning',
  dateRange: { start: '2026-09-01', end: '2026-11-29' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('90-day range is evaluated correctly (evaluatedDateCount === 90)', range90.evaluatedDateCount === 90);

const range30 = findMuhurthams({
  activityId: 'new-beginning',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('30-day range is evaluated correctly (evaluatedDateCount === 30)', range30.evaluatedDateCount === 30);

const singleDayRange = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-01' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('Single-day range (start === end) is accepted and evaluates exactly 1 date', singleDayRange.evaluatedDateCount === 1);

let threwForInvertedRange = false;
try {
  findMuhurthams({ activityId: 'start-journey', dateRange: { start: '2026-09-10', end: '2026-09-01' }, context: chennaiContext });
} catch {
  threwForInvertedRange = true;
}
check('findMuhurthams throws when dateRange.end precedes dateRange.start', threwForInvertedRange);

// Local timezone boundary: a date near a US DST transition should still
// resolve to the correct calendar date's Panchang, not drift a day.
const newYorkContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 2, 1, 12, 0, 0)),
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: -300,
};
const dstRange = findMuhurthams({
  activityId: 'start-journey',
  dateRange: { start: '2026-03-06', end: '2026-03-10' }, // spans the 2026 US DST transition (Mar 8)
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: newYorkContext,
});
check('A date range spanning a DST transition evaluates every requested calendar date without drift', dstRange.evaluatedDateCount === 5);
check('Every returned date across the DST boundary is within the requested range', dstRange.dates.every((d) => d.date >= '2026-03-06' && d.date <= '2026-03-10'));

// ============================================================
// KNOWN ACTIVITY USES ONTOLOGY (no invented rules)
// ============================================================

// Griha Pravesh reached SUPPORTED in the Muhurta Knowledge Pack V1 PR (see
// test/muhurtaRulePacks.test.ts for the full rule-pack/coverage detail) and
// now appears in Finder automatically -- Engagement remains PARTIAL.
check(
  'Finder eligibility is metadata-derived: DEEP/CEREMONIAL, non-AMBIGUOUS, SUPPORTED-level activities only',
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS.length === 6 &&
    JSON.stringify([...SUPPORTED_MUHURTHAM_ACTIVITY_IDS].sort()) ===
      JSON.stringify(['business-start', 'financial-decision', 'griha-pravesh', 'new-beginning', 'property-purchase', 'start-journey'])
);
check('Engagement remains PARTIAL and hidden from Finder (no intent-specific rule pack yet)', !isSupportedMuhurthamActivity('engagement'));
check('Griha Pravesh is now exposed in Finder (SUPPORTED as of the Muhurta Knowledge Pack V1 PR)', isSupportedMuhurthamActivity('griha-pravesh'));

const propertyResult = findMuhurthams({
  activityId: 'property-purchase',
  dateRange: { start: '2026-09-01', end: '2026-09-15' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('The newly-exposed property-purchase activity searches successfully and returns dates', propertyResult.dates.length > 0);
check('property-purchase activity metadata matches its catalog entry', propertyResult.activity.id === 'property-purchase' && propertyResult.activity.title === 'Property Purchase');

const businessResult = findMuhurthams({
  activityId: 'business-start',
  dateRange: { start: '2026-09-01', end: '2026-09-15' },
  timePreference: 'ANY',
  durationMinutes: 60,
  limit: 5,
  context: chennaiContext,
});
check('The newly-exposed business-start activity searches successfully and returns dates', businessResult.dates.length > 0);

const grihaResult = findMuhurthams({
  activityId: 'griha-pravesh',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'ANY',
  durationMinutes: 90,
  limit: 5,
  context: chennaiContext,
});
check('The newly-SUPPORTED griha-pravesh activity searches successfully and returns dates', grihaResult.dates.length > 0);
check('griha-pravesh activity metadata matches its catalog entry', grihaResult.activity.id === 'griha-pravesh' && grihaResult.activity.title === 'Griha Pravesh');

let threwForPartialEngagement = false;
try {
  findMuhurthams({ activityId: 'engagement', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: chennaiContext });
} catch {
  threwForPartialEngagement = true;
}
check('findMuhurthams throws for engagement (PARTIAL support, not exposed) rather than silently searching it', threwForPartialEngagement);

// ============================================================
// START SENSITIVITY (brief section 7 -- first real use of timingSensitivity)
// ============================================================

check('blendStartSensitiveScore is a documented, bounded weighted average (not a new formula)', blendStartSensitiveScore(10, 0) === Math.round(10 * (1 - START_SENSITIVITY_WEIGHT) * 10) / 10);
check('blendStartSensitiveScore returns the full-duration score unchanged when both inputs are equal', blendStartSensitiveScore(7.5, 7.5) === 7.5);
check('blendStartSensitiveScore weights the commencement probe by START_SENSITIVITY_WEIGHT (a stronger probe raises the blend)', blendStartSensitiveScore(5.0, 10.0) > 5.0 && blendStartSensitiveScore(5.0, 10.0) < 10.0);
check('START_SENSITIVITY_WEIGHT keeps the full-duration score dominant (< 50%)', START_SENSITIVITY_WEIGHT < 0.5);

// Every activity currently exposed in Muhurtham Finder has
// timingSensitivity.start === 'HIGH' (all 5 are commencement-defined
// occasions), so the START_HIGH blending path is exercised by every FIND
// above. The cross-check earlier in this file (bestWindow score equals
// blendStartSensitiveScore() of two direct evaluateTimingCandidate() calls,
// not a raw single call) is the deterministic proof that the gate is wired:
// if it were removed or mis-wired, that check would fail because the
// reported score would equal the raw single-call score instead of the
// blended one whenever the full-duration and probe scores actually differ.

console.log(allPassed ? '\nALL MUHURTHAM FINDER CHECKS PASSED' : '\nSOME MUHURTHAM FINDER CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
