import { evaluateEverydaySharedCandidate, findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import { profileFromActivity, TaskProfile, type DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const baseContext: DailyAssistantContext = {
  now: new Date('2026-08-21T04:00:00.000Z'),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

const userContext = { natalNakshatraIndex: 2 };
const partnerContext = { natalNakshatraIndex: 4 };

// ============================================================
// Works for an EVERYDAY (non-Muhurtham-eligible) activity -- the entire
// point of this module (brief section 12: do not route these through
// findSharedMuhurthams, which would throw).
// ============================================================

check('date-night is NOT Muhurtham-eligible (sanity check this test is exercising the right path)', !SUPPORTED_MUHURTHAM_ACTIVITY_IDS.includes('date-night'));

const dateNightResult = findEverydaySharedTiming({
  activityId: 'date-night',
  durationMinutes: 90,
  dateRange: { start: '2026-08-22', end: '2026-08-24' },
  context: { ...baseContext, personalContext: userContext },
  partnerContext,
});
check('findEverydaySharedTiming returns OK for an everyday activity', dateNightResult.status === 'OK');
if (dateNightResult.status === 'OK') {
  check('Returns at least one candidate for a real 3-day window', dateNightResult.candidates.length > 0);
  check('Every candidate has a sharedScore between 0 and 10', dateNightResult.candidates.every((c) => c.sharedScore >= 0 && c.sharedScore <= 10));
  check('Every candidate has a rating in the everyday vocabulary (never Muhurtham language)', dateNightResult.candidates.every((c) => ['STRONG_TOGETHER_FIT', 'GOOD_TOGETHER_FIT', 'EASY_TOGETHER_FIT'].includes(c.rating)));
  check('Candidates are ranked by sharedScore descending', dateNightResult.candidates.every((c, i) => i === 0 || dateNightResult.candidates[i - 1].sharedScore >= c.sharedScore));
  check('Each candidate carries the underlying GENERAL candidate untouched', dateNightResult.candidates.every((c) => c.generalCandidate.start === c.start));
}

// ============================================================
// UNSUPPORTED_ACTIVITY for an unknown activityId (never a throw)
// ============================================================

const unknownResult = findEverydaySharedTiming({
  activityId: 'not-a-real-activity',
  durationMinutes: 60,
  dateRange: { start: '2026-08-22', end: '2026-08-23' },
  context: { ...baseContext, personalContext: userContext },
  partnerContext,
});
check('An unknown activityId returns UNSUPPORTED_ACTIVITY, not a throw', unknownResult.status === 'UNSUPPORTED_ACTIVITY');

// ============================================================
// Optional personal context -- brief section 11: "Do not require birth
// data merely to create an invitation." A missing partner profile should
// not crash; it scores as evaluatePersonalMuhurtaFit's own neutral default.
// ============================================================

const noNatalPartner = findEverydaySharedTiming({
  activityId: 'coffee-tea',
  durationMinutes: 45,
  dateRange: { start: '2026-08-22', end: '2026-08-23' },
  context: { ...baseContext, personalContext: undefined },
  partnerContext: {},
});
check('A partner/user with no natal data still returns OK (personal context is optional)', noNatalPartner.status === 'OK');

// ============================================================
// GENERAL foundation: the general candidate pool comes from the SAME
// runTimingSearch() FIND path -- not a second engine.
// ============================================================

const generalPool = runTimingSearch({
  mode: 'FIND',
  activityId: 'date-night',
  durationMinutes: 90,
  dateRange: { start: '2026-08-22', end: '2026-08-24' },
  limit: 12,
  context: { ...baseContext, personalContext: undefined },
});
if (dateNightResult.status === 'OK' && dateNightResult.candidates.length > 0) {
  const top = dateNightResult.candidates[0];
  const matchingGeneral = generalPool.candidates.find((c) => c.start === top.start);
  check('The shared result\'s generalCandidate score matches a plain GENERAL FIND search for the same instant (reused, not reinvented)', matchingGeneral !== undefined && matchingGeneral.score === top.generalCandidate.score);
}

// ============================================================
// blendSharedDelta reuse: a candidate where the two participants diverge
// should score below a plain average of their two combined scores (the
// same non-averaging floor-weighted model SHARED Muhurtham uses).
// ============================================================

if (dateNightResult.status === 'OK') {
  for (const c of dateNightResult.candidates) {
    const userDelta = c.userScore - c.generalCandidate.score;
    const partnerDelta = c.partnerScore - c.generalCandidate.score;
    if (Math.abs(userDelta - partnerDelta) > 0.05) {
      const plainAverageScore = c.generalCandidate.score + (userDelta + partnerDelta) / 2;
      check('When participants diverge, sharedScore is not simply the plain average (min-weighted floor applies)', c.sharedScore <= plainAverageScore + 0.05);
      break;
    }
  }
}

// ============================================================
// Ask Aura Scope-Aware Everyday TIMING_CHECK V1: evaluateEverydaySharedCandidate
// is the extracted per-candidate helper findEverydaySharedTiming's own
// per-candidate .map() step now calls -- these tests prove it independently,
// on a SINGLE caller-supplied instant (the CHECK use case), not just as an
// implicit implementation detail of the FIND pool above.
// ============================================================

{
  const meditation = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'meditation')!;
  const profile: TaskProfile = profileFromActivity(meditation);
  const instant = new Date('2026-08-22T04:30:00.000Z');
  const generalContext: DailyAssistantContext = { ...baseContext, now: instant, personalContext: undefined };
  const generalResult = runTimingSearch({ mode: 'CHECK', activityId: 'meditation', durationMinutes: 30, candidateStart: instant.toISOString(), context: generalContext });
  const generalCandidate = generalResult.requestedCandidate!;

  const shared = evaluateEverydaySharedCandidate({
    profile,
    generalCandidate,
    durationMinutes: 30,
    context: { ...baseContext, now: instant, personalContext: userContext },
    partnerContext,
  });

  check('evaluateEverydaySharedCandidate preserves the exact instant (start/end untouched)', shared.start === generalCandidate.start && shared.end === generalCandidate.end);
  check('evaluateEverydaySharedCandidate carries the general candidate untouched', shared.generalCandidate === generalCandidate);
  check('sharedScore is within 0-10', shared.sharedScore >= 0 && shared.sharedScore <= 10);
  check('rating is everyday vocabulary, never Muhurtham language', ['STRONG_TOGETHER_FIT', 'GOOD_TOGETHER_FIT', 'EASY_TOGETHER_FIT'].includes(shared.rating));

  // Cross-check against findEverydaySharedTiming's own pool computation for
  // the IDENTICAL instant/activity/duration/contexts -- proves the
  // extraction is a pure refactor (byte-identical result), not a
  // reimplementation that could silently drift.
  const poolResult = findEverydaySharedTiming({
    activityId: 'meditation',
    durationMinutes: 30,
    dateRange: { start: '2026-08-22', end: '2026-08-22' },
    limit: 20,
    context: { ...baseContext, personalContext: userContext },
    partnerContext,
  });
  if (poolResult.status === 'OK') {
    const matching = poolResult.candidates.find((c) => c.start === generalCandidate.start);
    if (matching) {
      check('evaluateEverydaySharedCandidate matches findEverydaySharedTiming\'s own pool computation for the identical instant (pure extraction, not reimplementation)', matching.sharedScore === shared.sharedScore && matching.userScore === shared.userScore && matching.partnerScore === shared.partnerScore);
    }
  }
}

// Divergent owner/partner signals produce a genuinely different sharedScore
// from either individual score, and from the unpersonalized general score --
// the exact "SHARED CHECK must not be byte-identical to GENERAL when the
// fixture creates different personal signals" proof the Scope-Aware
// TIMING_CHECK brief requires.
{
  const meditation = FULL_ACTIVITY_CATALOG.find((a) => a.id === 'meditation')!;
  const profile: TaskProfile = profileFromActivity(meditation);
  const instant = new Date('2026-09-04T04:30:00.000Z');
  const generalContext: DailyAssistantContext = { ...baseContext, now: instant, personalContext: undefined };
  const generalResult = runTimingSearch({ mode: 'CHECK', activityId: 'meditation', durationMinutes: 30, candidateStart: instant.toISOString(), context: generalContext });
  const generalCandidate = generalResult.requestedCandidate!;

  const shared = evaluateEverydaySharedCandidate({
    profile,
    generalCandidate,
    durationMinutes: 30,
    context: { ...baseContext, now: instant, personalContext: { natalNakshatraIndex: 1 } }, // favorable Tara Bala for this date
    partnerContext: { natalNakshatraIndex: 0 }, // unfavorable Tara Bala for this date
  });

  check('owner and partner scores genuinely differ for divergent natal signals', shared.userScore !== shared.partnerScore);
  check('sharedScore differs from the owner-only score (a real blend, not owner-only)', shared.sharedScore !== shared.userScore);
  check('sharedScore differs from the unpersonalized general score', shared.sharedScore !== generalCandidate.score);
  // 70/30 weaker-floor blend (SHARED_FLOOR_WEIGHT): since partner is the
  // weaker (unfavorable) signal here, sharedScore should sit closer to the
  // partner-driven side than a plain 50/50 average would.
  const userDelta = shared.userScore - generalCandidate.score;
  const partnerDelta = shared.partnerScore - generalCandidate.score;
  const plainAverageScore = generalCandidate.score + (userDelta + partnerDelta) / 2;
  check('weaker-floor blend pulls sharedScore below the plain average when partner is the weaker signal', shared.sharedScore <= plainAverageScore);
}

console.log(allPassed ? '\nALL EVERYDAY TIMING FIT CHECKS PASSED' : '\nSOME EVERYDAY TIMING FIT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
