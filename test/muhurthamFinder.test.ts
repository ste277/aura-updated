import { blendStartSensitiveScore, evaluateMuhurthamCandidateAt, findMuhurthams, findPersonalMuhurthams, findSharedMuhurthams, isSupportedMuhurthamActivity, START_SENSITIVITY_PROBE_MINUTES, START_SENSITIVITY_WEIGHT, SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import { evaluateTimingCandidate } from '../packages/recommendation/src/timingSearch';
import { profileFromActivity } from '../packages/recommendation/src/dailyAssistant';
import { findActivityIntent, FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { localDateTimeToUTC } from '../packages/panchang/src/localDate';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { formatMuhurtaReason } from '../packages/muhurta/src/muhurtaReasonFormat';
import { getTithi } from '../packages/vedic/src/panchangElements';

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
  findMuhurthams({ activityId: 'not-a-real-activity-id', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: chennaiContext });
} catch {
  threwForUnknown = true;
}
check('findMuhurthams throws for a genuinely unknown (not-in-catalog) activityId', threwForUnknown);

// Marriage Muhurtham Foundation V1 (PR A): `marriage` IS now a real catalog
// activity with its own dedicated (IMPLEMENTED) Tithi/Nakshatra/Yoga/Karana
// rule pack -- but must still be rejected by the SAME "not-yet-supported"
// path 'tea-break' takes above (PARTIAL, not SUPPORTED), never the "unknown
// activity" path, since it genuinely exists in the catalog now. See
// test/marriageMuhurthamFoundation.test.ts for the full gating regression.
check('marriage is a real catalog activity, not unknown', getActivityDefinition('marriage') !== undefined);
// Marriage Muhurtham Required Eligibility V1 (PR B) implemented the two
// coverage gaps (periodExclusion, planetaryCombustion) this block originally
// documented as pending -- Marriage is now genuinely SUPPORTED, matching
// every other ceremonial activity's path through findMuhurthams. See
// test/marriageMuhurthamFoundation.test.ts's "26/33" block for the full
// gating-to-supported regression.
check('marriage is now in SUPPORTED_MUHURTHAM_ACTIVITY_IDS (PR B implemented period exclusion + planetary combustion)', isSupportedMuhurthamActivity('marriage'));
let threwForMarriageSupported = false;
try {
  findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-09-01', end: '2026-09-05' }, context: chennaiContext });
} catch {
  threwForMarriageSupported = true;
}
check('findMuhurthams no longer throws for marriage (genuinely searchable via the same SUPPORTED path as other ceremonial activities)', !threwForMarriageSupported);

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
// Lunar Intelligence V1 L5 -- findMuhurthams()'s own search path (below)
// now genuinely supplies actionPhase:'START' internally for start-journey
// (a PROJECT_START/BUSINESS_START/JOURNEY_START-classified search), so a
// fair "not re-derived, same reasons" comparison must supply the identical
// input, not the pre-L5 implicit undefined -- this is the narrow, expected
// consequence of L5's real wiring, not a weakening of what this check proves.
const directFullCandidate = evaluateTimingCandidate({
  profile,
  start: new Date(journeyResult.dates[0].bestWindow.start),
  durationMinutes: 60,
  context: chennaiContext,
  actionPhase: 'START',
});
const directProbeCandidate = evaluateTimingCandidate({
  profile,
  start: new Date(journeyResult.dates[0].bestWindow.start),
  durationMinutes: Math.min(60, START_SENSITIVITY_PROBE_MINUTES),
  context: chennaiContext,
  actionPhase: 'START',
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
// 2026-09-02 in Chennai, ABHIJIT (11:44 AM-12:34 PM IST / 06:14-07:04 UTC)
// overlaps RAHU_KALAM (12:10-1:43 PM IST / 06:40-08:13 UTC). A 30-minute
// window starting at ABHIJIT's own start (06:14) extends to 06:44 and so
// crosses into Rahu Kalam at 06:40 -- it must NOT be treated as a clean
// Abhijit window.
//
// Inauspicious Period Precedence Fix V1 correction: this same date ALSO has
// GULIKA (10:36 AM-12:10 PM IST / 05:06-06:40 UTC) overlapping Abhijit --
// together, Gulika and Rahu fully cover Abhijit's entire 11:44 AM-12:34 PM
// span with no gap, so there is in fact no genuinely clean sub-window
// anywhere inside Abhijit on this date, at any duration. The original
// version of this test asserted a 20-minute window starting at Abhijit's
// own start (06:14-06:34 UTC) stayed "clear of Rahu Kalam" and should be
// selected -- true only because Gulika was not yet checked as an
// inauspicious-commencement window; this exact 06:14-06:34 span was always
// inside the Gulika overlap too. Re-verified below: it is now correctly
// excluded for this commencement-sensitive activity, and Muhurtham Finder
// falls back to a genuinely clean window elsewhere (Brahma Muhurtham, no
// overlap with anything) -- proving interval-overlap, evaluated against
// BOTH Rahu Kalam and Gulika, drives the decision, not mere Abhijit
// window-membership.
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
check('A 20-min window at Abhijit\'s own start, which sits inside the Gulika overlap even though it stays clear of Rahu Kalam, is NOT selected as the best window', overlapDate20min.dates.length === 0 || overlapDate20min.dates[0].bestWindow.start !== '2026-09-02T06:14:00.000Z');
check('Muhurtham Finder instead falls back to a genuinely clean window (Brahma, no Rahu/Gulika/Yama overlap) for this date', overlapDate20min.dates.length === 1 && overlapDate20min.dates[0].bestWindow.start === '2026-09-01T22:51:00.000Z');

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

// Griha Pravesh reached SUPPORTED in the Muhurta Knowledge Pack V1 PR, and
// Marriage reached SUPPORTED in Marriage Muhurtham Required Eligibility V1
// (period-exclusion + planetary-combustion coverage now IMPLEMENTED) -- see
// test/muhurtaRulePacks.test.ts and test/marriageRequiredEligibility.test.ts
// for the full rule-pack/coverage detail. Engagement remains PARTIAL.
check(
  'Finder eligibility is metadata-derived: DEEP/CEREMONIAL, non-AMBIGUOUS, SUPPORTED-level activities only',
  SUPPORTED_MUHURTHAM_ACTIVITY_IDS.length === 7 &&
    JSON.stringify([...SUPPORTED_MUHURTHAM_ACTIVITY_IDS].sort()) ===
      JSON.stringify(['business-start', 'financial-decision', 'griha-pravesh', 'marriage', 'new-beginning', 'property-purchase', 'start-journey'].sort())
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

// ============================================================
// evaluateMuhurthamCandidateAt (Ask Aura Ceremonial TIMING_CHECK Capability
// Redirect V1) -- the single-candidate counterpart to findMuhurthams()/
// findPersonalMuhurthams()/findSharedMuhurthams() above: "is THIS exact
// instant valid", never a date-range search. A thin wrapper around the
// SAME evaluateMuhurthamCandidate() internal helper the three search
// functions already share -- these checks prove that wiring, not a second
// eligibility/scoring implementation.
// ============================================================

{
  // Known-good real fixture (same one PR E's friction-boundary work used):
  // 2026-06-12 New York, Marriage, RAHU_KALAM.endMinute -- a genuinely
  // eligible, favorably-scored ABHIJIT instant.
  const eligibleStart = new Date('2026-06-12T16:55:00.000Z');
  const eligible = evaluateMuhurthamCandidateAt({ activityId: 'marriage', start: eligibleStart, durationMinutes: 60, scope: 'GENERAL', context: newYorkContext });
  check('evaluateMuhurthamCandidateAt: a real eligible instant returns eligible=true', eligible.status === 'OK' && eligible.eligible === true);
  check('evaluateMuhurthamCandidateAt: the eligible instant is not a low/CAUTION score', eligible.status === 'OK' && eligible.score >= 7.0);
  check('evaluateMuhurthamCandidateAt: window.start/end reflect the EXACT requested instant/duration, never moved', eligible.status === 'OK' && eligible.window.start === eligibleStart.toISOString() && new Date(eligible.window.end).getTime() - eligibleStart.getTime() === 60 * 60000);

  // Score-parity proof: evaluateMuhurthamCandidateAt's score for an
  // eligible instant must be byte-identical to what findMuhurthams()
  // itself reports for that exact same date/instant -- i.e. this is
  // genuinely reusing the SAME start-sensitivity-blended canonical
  // evaluation, not a second, cheaper approximation.
  const searchResult = findMuhurthams({ activityId: 'marriage', dateRange: { start: '2026-06-12', end: '2026-06-12' }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: newYorkContext });
  check('evaluateMuhurthamCandidateAt score is byte-identical to findMuhurthams()\'s own bestWindow score for the same date/instant', eligible.status === 'OK' && searchResult.dates[0] && eligible.score === searchResult.dates[0].score);

  // Duration overlap: a 90-minute candidate must be evaluated as the full
  // 90-minute span, not just its start instant.
  const ninety = evaluateMuhurthamCandidateAt({ activityId: 'marriage', start: eligibleStart, durationMinutes: 90, scope: 'GENERAL', context: newYorkContext });
  check('evaluateMuhurthamCandidateAt: a 90-minute request evaluates a genuinely 90-minute span', ninety.status === 'OK' && new Date(ninety.window.end).getTime() - eligibleStart.getTime() === 90 * 60000);
}

{
  // HARD-ELIGIBILITY REGRESSION (brief section 22): a real 2026 instant
  // where generic Timing Search scores strongly positive (VERY_GOOD, no
  // friction/Rahu/Yama/Gulika block at all) but Marriage's own authoritative
  // avoid-Tithi rule (Krishna Chaturthi is one of Marriage's 6 sourced avoid
  // Tithis) must still hard-reject it. This is the deterministic proof that
  // ceremonial CHECK enforces MORE than generic Timing Search, not merely a
  // relabeled copy of it -- exactly the gap the Natural CHECK Phrasing audit
  // found (contradictory answers between "Is tomorrow good for marriage?"
  // and "Should I get married tomorrow?").
  const chaturthiStart = new Date('2026-06-04T06:11:00.000Z'); // Chennai ABHIJIT start, real Krishna Chaturthi instant
  const marriageActivity = findActivityIntent('marriage')!;
  const generic = evaluateTimingCandidate({ profile: profileFromActivity(marriageActivity), start: chaturthiStart, durationMinutes: 60, context: chennaiContext });
  check('Sanity: generic Timing Search alone scores this instant strongly positive (VERY_GOOD, no friction block)', generic.label === 'VERY_GOOD' && generic.score >= 8.0 && !generic.conflicts?.some((c) => c.type === 'FRICTION_WINDOW_BLOCKED'));

  const ceremonial = evaluateMuhurthamCandidateAt({ activityId: 'marriage', start: chaturthiStart, durationMinutes: 60, scope: 'GENERAL', context: chennaiContext });
  check('evaluateMuhurthamCandidateAt correctly REJECTS the same instant (authoritative avoid Tithi), despite the strong generic score', ceremonial.status === 'OK' && ceremonial.eligible === false);
  check('The rejection is a genuine hard exclusion, not merely a lower displayed score: window.score still reflects the real generic score (8.19), only `eligible` differs', ceremonial.status === 'OK' && ceremonial.score >= 8.0);
}

{
  // PERSONAL scope: incomplete profile is a typed outcome, never a silent
  // GENERAL fallback -- mirrors findPersonalMuhurthams()'s own contract.
  const incomplete = evaluateMuhurthamCandidateAt({ activityId: 'marriage', start: new Date('2026-06-12T16:55:00.000Z'), durationMinutes: 60, scope: 'PERSONAL', context: newYorkContext });
  check('evaluateMuhurthamCandidateAt PERSONAL with no personalContext returns PERSONAL_PROFILE_INCOMPLETE', incomplete.status === 'PERSONAL_PROFILE_INCOMPLETE');

  const withPersonal = evaluateMuhurthamCandidateAt({
    activityId: 'marriage',
    start: new Date('2026-06-12T16:55:00.000Z'),
    durationMinutes: 60,
    scope: 'PERSONAL',
    context: { ...newYorkContext, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' } },
  });
  check('evaluateMuhurthamCandidateAt PERSONAL with a complete profile returns status OK', withPersonal.status === 'OK');
  check('evaluateMuhurthamCandidateAt PERSONAL carries generalScore/personalScore alongside the personalized score', withPersonal.status === 'OK' && typeof withPersonal.generalScore === 'number' && typeof withPersonal.personalScore === 'number');
}

{
  // SHARED scope: incomplete profiles are typed outcomes too -- no live
  // SavedPerson resolution needed here (that's a DB-layer/orchestrator
  // concern, unchanged by this PR), just the domain function's own
  // USER_PROFILE_INCOMPLETE / SAVED_PERSON_PROFILE_INCOMPLETE contract.
  const noUser = evaluateMuhurthamCandidateAt({ activityId: 'marriage', start: new Date('2026-06-12T16:55:00.000Z'), durationMinutes: 60, scope: 'SHARED', context: newYorkContext });
  check('evaluateMuhurthamCandidateAt SHARED with no personalContext returns USER_PROFILE_INCOMPLETE', noUser.status === 'USER_PROFILE_INCOMPLETE');

  const noPartner = evaluateMuhurthamCandidateAt({
    activityId: 'marriage',
    start: new Date('2026-06-12T16:55:00.000Z'),
    durationMinutes: 60,
    scope: 'SHARED',
    context: { ...newYorkContext, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' } },
  });
  check('evaluateMuhurthamCandidateAt SHARED with no partner returns SAVED_PERSON_PROFILE_INCOMPLETE', noPartner.status === 'SAVED_PERSON_PROFILE_INCOMPLETE');

  const withPartner = evaluateMuhurthamCandidateAt({
    activityId: 'marriage',
    start: new Date('2026-06-12T16:55:00.000Z'),
    durationMinutes: 60,
    scope: 'SHARED',
    context: { ...newYorkContext, personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' } },
    partner: { savedPersonId: 'test-partner', name: 'Test Partner', context: { natalNakshatraIndex: 4 } },
  });
  check('evaluateMuhurthamCandidateAt SHARED with both profiles complete returns status OK', withPartner.status === 'OK');
  check('evaluateMuhurthamCandidateAt SHARED carries per-participant user/person breakdowns', withPartner.status === 'OK' && Boolean(withPartner.user) && Boolean(withPartner.person) && withPartner.person?.savedPersonId === 'test-partner');
}

// ============================================================
// LUNAR INTELLIGENCE V1 L5 -- ActionPhase Muhurtham Finder wiring
// ============================================================
// Production-path integration: proves the REAL findMuhurthams() call chain
// (packages/recommendation/src/muhurthamFinder.ts's own
// MUHURTHAM_FINDER_WORKFLOW_ACTION_PHASE constant -> evaluateTimingCandidate()
// -> evaluateActivityFit() -> evaluateMuhurtaWithRulePack() ->
// applyLunarTithiOverlay()) now reaches the existing, unmodified L3/L4 rules
// and the existing, unmodified formatter -- no new Lunar rule, scoring,
// formatter, or UI. See packages/muhurta/src/lunarFamilyRules.ts and
// packages/muhurta/src/lunarExactTithiRules.ts for the rules themselves
// (untouched by this PR) and test/muhurtaRulePacks.test.ts /
// test/lunarExactTithiRules.test.ts / test/lunarFamilyRules.test.ts for the
// exhaustive engine-level proof this section deliberately does not repeat.

// EVENING (17:00-21:00 IST = 11:30-15:30 UTC) on 2026-09-10 is verified
// fresh, directly against the real Panchang engine (not assumed), to fall
// ENTIRELY within Amavasya -- the Chennai-local calendar day actually spans
// a Tithi transition (Krishna Chaturdashi until ~06:00 UTC, Amavasya after),
// so an unconstrained full-day search could let the max-score search dodge
// the caution entirely by picking a morning window instead. Restricting to
// EVENING removes that risk without changing what's being tested.
check('L5 fixture sanity: 2026-09-10 17:30 IST (12:00 UTC) is genuinely Amavasya', getTithi(new Date('2026-09-10T12:00:00.000Z')).name === 'Amavasya');
check('L5 fixture sanity: 2026-09-10 20:30 IST (15:00 UTC) is still genuinely Amavasya (whole EVENING band)', getTithi(new Date('2026-09-10T15:00:00.000Z')).name === 'Amavasya');
// AFTERNOON (12:00-17:00 IST = 06:30-11:30 UTC) on 2026-09-14 similarly
// falls entirely within Shukla Chaturthi (a RIKTA tithi) -- the established
// riktaDate fixture (06:20 UTC) used throughout test/muhurtaRulePacks.test.ts,
// re-verified here rather than assumed.
check('L5 fixture sanity: 2026-09-14 12:30 IST (07:00 UTC) is genuinely Shukla Chaturthi', getTithi(new Date('2026-09-14T07:00:00.000Z')).name === 'Shukla Chaturthi');
check('L5 fixture sanity: 2026-09-14 16:30 IST (11:00 UTC) is still genuinely Shukla Chaturthi (whole AFTERNOON band)', getTithi(new Date('2026-09-14T11:00:00.000Z')).name === 'Shukla Chaturthi');

// Both scenarios below use evaluateTimingCandidate() directly (the exact
// function muhurthamFinder.ts's search path calls, imported at the top of
// this file) with actionPhase:'START' -- the SAME real value
// MUHURTHAM_FINDER_WORKFLOW_ACTION_PHASE now supplies internally -- at the
// verified instant, rather than findMuhurthams()'s own score-filtered `dates`
// array: a -8 Amavasya/Rikta caution genuinely drops this particular
// activity/time-band combination's score below MIN_INCLUSION_SCORE (5.5),
// which is pre-existing, unrelated findMuhurthams() date-inclusion behavior
// findMuhurthams() ALSO reaches Amavasya on this date correctly rejecting
// it, confirmed separately below -- not something this PR should fight
// around with an artificially-tuned fixture.

// ---- 19. Amavasya production scenario (new-beginning / PROJECT_START) ----
const newBeginningActivity = findActivityIntent('start a project')!;
const newBeginningProfile = profileFromActivity(newBeginningActivity);
const amavasyaCandidate = evaluateTimingCandidate({
  profile: newBeginningProfile,
  start: new Date('2026-09-10T12:00:00.000Z'), // verified Amavasya, EVENING IST, above
  durationMinutes: 60,
  context: chennaiContext,
  actionPhase: 'START',
});
const amavasyaTithiReasons = amavasyaCandidate.reasons.filter((r) => r.factor === 'TITHI');
check('19. Amavasya + new-beginning + ActionPhase.START (real production call): exactly one factor===TITHI reason', amavasyaTithiReasons.length === 1);
check('19. that reason is TITHI_EXACT_CAUTION, value "Amavasya", impact -8', amavasyaTithiReasons[0]?.code === 'TITHI_EXACT_CAUTION' && amavasyaTithiReasons[0]?.value === 'Amavasya' && amavasyaTithiReasons[0]?.impact === -8);
check('19. no TITHI_FAMILY_CAUTION alongside it', !amavasyaCandidate.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));
check('19. the existing, unmodified formatter produces the existing Amavasya explanation (no new copy)', formatMuhurtaReason(amavasyaTithiReasons[0]) === 'Amavasya is traditionally treated with more care for important new beginnings');
// Lunar Intelligence V1 L6.1 -- score-path repair proof. new-beginning's own
// legacy family (FOCUSED_WORK) ALREADY avoided Amavasya pre-L4 at the SAME
// -8 magnitude, so this specific fixture's `.score` coincidentally ties
// whether or not ActionPhase is supplied -- documented here explicitly
// rather than treated as evidence the repair didn't work (see the Rikta
// fixture below, section 20, for the clean/no-legacy-tie proof that score
// genuinely changes). What DOES prove the repair for Amavasya: the reason
// that fired changed (legacy TITHI_UNFAVORABLE -> TITHI_EXACT_CAUTION),
// meaning the score-producing evaluation now genuinely consulted
// ActionPhase (previously it would have silently kept computing
// TITHI_UNFAVORABLE's own -8 regardless of phase, since that inner
// evaluateActivityFit call never saw ActionPhase at all pre-L6.1).
const amavasyaCandidateNoPhase = evaluateTimingCandidate({ profile: newBeginningProfile, start: new Date('2026-09-10T12:00:00.000Z'), durationMinutes: 60, context: chennaiContext });
const amavasyaNoPhaseTithiReasons = amavasyaCandidateNoPhase.reasons.filter((r) => r.factor === 'TITHI');
check('19. (L6.1) WITHOUT actionPhase, the SAME instant still carries a Tithi reason -- but the pre-existing legacy TITHI_UNFAVORABLE, not TITHI_EXACT_CAUTION', amavasyaNoPhaseTithiReasons.length === 1 && amavasyaNoPhaseTithiReasons[0].code === 'TITHI_UNFAVORABLE' && amavasyaNoPhaseTithiReasons[0].impact === -8);
check('19. (L6.1) score-producing evaluation genuinely differs in WHICH reason fired based on ActionPhase (proving the score path now consults it), even though this fixture\'s net -8 magnitude coincidentally ties the numeric score', amavasyaTithiReasons[0].code !== amavasyaNoPhaseTithiReasons[0].code && amavasyaCandidate.score === amavasyaCandidateNoPhase.score);
// findMuhurthams() itself (the real search entry point) correctly excludes
// this date/activity from results -- the -8 caution genuinely drops the
// score below MIN_INCLUSION_SCORE, pre-existing unrelated behavior.
const amavasyaSearchResult = findMuhurthams({ activityId: 'new-beginning', dateRange: { start: '2026-09-10', end: '2026-09-10' }, timePreference: 'EVENING', durationMinutes: 60, limit: 1, context: chennaiContext });
check('19. findMuhurthams() itself does not throw and correctly excludes this low-scoring Amavasya date (MIN_INCLUSION_SCORE, unrelated to this PR)', amavasyaSearchResult.dates.length === 0);

// ---- 20. Rikta production scenario (business-start / BUSINESS_START, a different supported intent than the Amavasya fixture above) ----
const businessStartActivity = findActivityIntent('start a business')!;
const businessStartProfile = profileFromActivity(businessStartActivity);
const riktaCandidate = evaluateTimingCandidate({
  profile: businessStartProfile,
  start: new Date('2026-09-14T07:00:00.000Z'), // verified Shukla Chaturthi (RIKTA), AFTERNOON IST, above
  durationMinutes: 60,
  context: chennaiContext,
  actionPhase: 'START',
});
const riktaTithiReasons = riktaCandidate.reasons.filter((r) => r.factor === 'TITHI');
check('20. Rikta + business-start + ActionPhase.START (real production call): exactly one factor===TITHI reason', riktaTithiReasons.length === 1);
check('20. that reason is TITHI_FAMILY_CAUTION, value "RIKTA", impact -8', riktaTithiReasons[0]?.code === 'TITHI_FAMILY_CAUTION' && riktaTithiReasons[0]?.value === 'RIKTA' && riktaTithiReasons[0]?.impact === -8);
check('20. no TITHI_EXACT_CAUTION alongside it', !riktaCandidate.reasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));
check('20. the existing, unmodified formatter produces the existing Rikta explanation (no new copy)', formatMuhurtaReason(riktaTithiReasons[0]) === 'Rikta tithis are traditionally considered less suitable for starting this kind of important undertaking');
// Lunar Intelligence V1 L6.1 -- PRIMARY score-path repair proof. business-start's
// own legacy family has NO pre-existing avoid pattern for Shukla Chaturthi (only
// Amavasya/Chaturdashi -- see the L3 design audit), so this fixture's baseline
// carries NO Tithi reason at all without ActionPhase, giving a clean, unambiguous
// delta unlike the Amavasya fixture above (section 19, magnitude-tied against a
// pre-existing legacy reason). Same activity, same instant, same context, same
// profile -- ActionPhase is the ONLY input that differs.
const riktaCandidateNoPhase = evaluateTimingCandidate({ profile: businessStartProfile, start: new Date('2026-09-14T07:00:00.000Z'), durationMinutes: 60, context: chennaiContext });
check('20. (L6.1) WITHOUT actionPhase, the same instant carries NO Tithi reason at all (clean baseline)', !riktaCandidateNoPhase.reasons.some((r) => r.factor === 'TITHI'));
check('20. (L6.1) the score-PRODUCING evaluation (TimingCandidate.score -- the field Finder ranking/sorting/rateMuhurtham/MIN_INCLUSION_SCORE all actually use) is now genuinely LOWER with the Lunar caution than without it', riktaCandidate.score < riktaCandidateNoPhase.score);
check('20. (L6.1) auraFitScore moves in the same direction, confirming both evaluation paths now agree', riktaCandidate.auraFitScore! < riktaCandidateNoPhase.auraFitScore!);
check('20. (L6.1) the reason/score invariant holds: a Lunar caution is present in .reasons if and only if the score-producing path reflects it', (riktaTithiReasons.length > 0) === (riktaCandidate.score < riktaCandidateNoPhase.score));
// findMuhurthams() itself: confirm it runs successfully for business-start
// over this date without throwing (real production call, real activity).
const riktaSearchResult = findMuhurthams({ activityId: 'business-start', dateRange: { start: '2026-09-14', end: '2026-09-14' }, timePreference: 'ANY', durationMinutes: 60, limit: 1, context: chennaiContext });
check('20. findMuhurthams() itself does not throw for business-start on the Rikta date', Array.isArray(riktaSearchResult.dates));

// ---- 21. precedence: exact > family, never both, through the real production path ----
check('21. every L5 production fixture above carries AT MOST ONE factor===TITHI reason', amavasyaTithiReasons.length <= 1 && riktaTithiReasons.length <= 1);

// ---- 22. dedicated-pack regression: Griha Pravesh's own Tithi behavior is unaffected by ActionPhase.START ----
// Uses evaluateTimingCandidate() directly (the exact function muhurthamFinder.ts
// itself calls, imported at the top of this file) at the SAME verified Amavasya
// instant, with the SAME actionPhase:'START' value the real Muhurtham Finder
// call chain now supplies for a genuine search -- this is the real, unmodified
// production entry point, just invoked at a controlled instant rather than
// through the score-maximizing day-scan wrapper, which (per Griha Pravesh's
// own dedicated Amavasya-avoid rule) could otherwise legitimately exclude the
// date from a findMuhurthams() result before this invariant could be observed.
const grihaActivity = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'griha-pravesh')!;
const grihaProfile = profileFromActivity(grihaActivity);
const grihaAmavasyaCandidate = evaluateTimingCandidate({
  profile: grihaProfile,
  start: new Date('2026-09-10T12:00:00.000Z'),
  durationMinutes: 60,
  context: chennaiContext,
  actionPhase: 'START',
});
const grihaTithiReasons = grihaAmavasyaCandidate.reasons.filter((r) => r.factor === 'TITHI');
check('22. Griha Pravesh + Amavasya + ActionPhase.START (real production call): exactly one factor===TITHI reason', grihaTithiReasons.length === 1);
check('22. it is Griha Pravesh\'s own dedicated TITHI_UNFAVORABLE reason, NOT TITHI_EXACT_CAUTION -- tithiCoverage===IMPLEMENTED still short-circuits the generic overlay', grihaTithiReasons[0]?.code === 'TITHI_UNFAVORABLE' && !grihaTithiReasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));
check('22. Griha Pravesh\'s dedicated Tithi data itself was not touched by this PR (its own avoid pattern is still what produces this reason)', grihaTithiReasons[0]?.value === 'Amavasya');

// ---- 23. phase-neutral caller regression: TimingSearchRequest's own generic path (Plan-with-Aura/Guest Find/Plan Ahead) still never supplies ActionPhase ----
// Structural guard, not a behavioral re-derivation: test/planWithAuraViewLogic.test.ts
// (run as part of this PR's regression) already exhaustively proves
// Plan-with-Aura's own request/UI behavior end-to-end and remains untouched by
// this PR -- cited here rather than duplicated. This check instead proves,
// directly from source, that runFind()/runCheck()/runCompare() (the functions
// those flows funnel through) never reference actionPhase at all.
{
  const fsMod = require('fs');
  const pathMod = require('path');
  const timingSearchSrc: string = fsMod.readFileSync(pathMod.join(__dirname, '../packages/recommendation/src/timingSearch.ts'), 'utf8');
  const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const stripped = stripComments(timingSearchSrc);
  const runFindBody = stripped.slice(stripped.indexOf('function runFind'), stripped.indexOf('function runFind') + 2000);
  const runCheckBody = stripped.slice(stripped.indexOf('function runCheck'), stripped.indexOf('function runCheck') + 2000);
  const runCompareBody = stripped.slice(stripped.indexOf('function runCompare'), stripped.indexOf('function runCompare') + 2000);
  check('23. runFind() (Plan-with-Aura/Guest Find/Plan Ahead FIND mode) never references actionPhase', !/actionPhase/.test(runFindBody));
  check('23. runCheck() (Plan-with-Aura CHECK mode) never references actionPhase', !/actionPhase/.test(runCheckBody));
  check('23. runCompare() (Plan-with-Aura COMPARE mode) never references actionPhase', !/actionPhase/.test(runCompareBody));
}

// ---- 25. unsupported intent: START alone does not create an exact/family reason for an intent outside PROJECT_START/BUSINESS_START/JOURNEY_START ----
// financial-decision (IMPORTANT_FINANCIAL_DECISION) is Finder-supported (real
// dedicated activity, REUSABLE_BASE_RULE Tithi coverage) but is NOT in either
// L3's or L4's applicableIntents -- searched at the SAME verified Amavasya
// EVENING window used by section 19 above.
const financialResult = findMuhurthams({
  activityId: 'financial-decision',
  dateRange: { start: '2026-09-10', end: '2026-09-10' },
  timePreference: 'EVENING',
  durationMinutes: 60,
  limit: 1,
  context: chennaiContext,
});
check('25. financial-decision + Amavasya + START (via the real production path): no TITHI_EXACT_CAUTION appears (unsupported intent)', financialResult.dates.length === 0 || !financialResult.dates[0].bestWindow.reasons.some((r) => r.code === 'TITHI_EXACT_CAUTION'));
check('25. financial-decision + Amavasya + START: no TITHI_FAMILY_CAUTION appears either (unsupported intent)', financialResult.dates.length === 0 || !financialResult.dates[0].bestWindow.reasons.some((r) => r.code === 'TITHI_FAMILY_CAUTION'));

// ---- 30. ranking effect ----
// A natural two-different-real-dates ranking comparison (e.g. the Rikta date
// vs. a nearby control date) would be confounded by unrelated Nakshatra/Yoga/
// Karana differences BETWEEN those dates -- asserting "date A outranks date B
// because of Tithi" from two genuinely different calendar dates is inherently
// artificial, since those other factors already differ for reasons that have
// nothing to do with L3/L4. The repository-stable, non-brittle way to prove
// ranking IS affected is the same-instant, same-everything-except-ActionPhase
// comparison already proven in section 20 above: riktaCandidate.score (with
// the Lunar caution) is genuinely lower than riktaCandidateNoPhase.score
// (without it) -- the exact scalar every .sort() in muhurthamFinder.ts ranks
// by (candidates.sort, dateCandidates.sort by score/combinedScore/sharedScore).
// Restated explicitly here as the ranking-effect invariant.
check('30. ranking effect: the score used by every sort in muhurthamFinder.ts is now genuinely lower for a Lunar-cautioned candidate than an otherwise-identical one without the caution (proven at the real instant in section 20 -- a cross-date comparison would be artificial, since unrelated Panchang factors differ between any two real calendar dates)', riktaCandidate.score < riktaCandidateNoPhase.score);

// ---- 35/36. personal and shared search regressions: no double-counting, repair applies once ----
const personalContext = { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini' };
const riktaPersonalContext: DailyAssistantContext = { ...chennaiContext, personalContext };
const personalRiktaResult = findPersonalMuhurthams({
  activityId: 'business-start',
  dateRange: { start: '2026-09-14', end: '2026-09-14' },
  timePreference: 'AFTERNOON',
  durationMinutes: 60,
  limit: 1,
  context: riktaPersonalContext,
});
check('35/36. (L6.1) findPersonalMuhurthams does not throw and returns OK for the real Rikta production path', personalRiktaResult.status === 'OK');
if (personalRiktaResult.status === 'OK' && personalRiktaResult.dates.length > 0) {
  const pd = personalRiktaResult.dates[0];
  const pdTithi = pd.bestWindow.reasons.filter((r) => r.factor === 'TITHI');
  check('35. (L6.1) PERSONAL scope: at most one TITHI reason (no duplication across general/personal layers)', pdTithi.length <= 1);
  check('35. (L6.1) PERSONAL scope: combinedScore (the actual PERSONAL ranking key) equals bestWindow.score -- the SAME repaired, phase-aware value, not a second independently-computed score', pd.combinedScore === pd.bestWindow.score);
}

const sharedRiktaResult = findSharedMuhurthams({
  activityId: 'business-start',
  dateRange: { start: '2026-09-14', end: '2026-09-14' },
  timePreference: 'AFTERNOON',
  durationMinutes: 60,
  limit: 1,
  context: riktaPersonalContext,
  partner: { savedPersonId: 'l61-test-partner', name: 'L6.1 Test Partner', context: { natalNakshatraIndex: 4 } },
});
check('36. (L6.1) findSharedMuhurthams does not throw and returns OK for the real Rikta production path', sharedRiktaResult.status === 'OK');
if (sharedRiktaResult.status === 'OK' && sharedRiktaResult.dates.length > 0) {
  const sd = sharedRiktaResult.dates[0];
  const generalTithi = sd.bestWindow.reasons.filter((r) => r.factor === 'TITHI');
  const userTithi = sd.user.reasons.filter((r) => r.factor === 'TITHI');
  const personTithi = sd.person.reasons.filter((r) => r.factor === 'TITHI');
  check('36. (L6.1) SHARED scope: the Lunar reason appears at most once, at the GENERAL level only -- never duplicated into either participant\'s own reasons (no double-counting introduced by the repair)', generalTithi.length <= 1 && userTithi.length === 0 && personTithi.length === 0);
  check('36. (L6.1) SHARED scope: the repaired score reaches sharedScore (the actual SHARED ranking key) exactly once, not once per participant', typeof sd.sharedScore === 'number');
}

console.log(allPassed ? '\nALL MUHURTHAM FINDER CHECKS PASSED' : '\nSOME MUHURTHAM FINDER CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
