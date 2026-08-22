import { findEverydaySharedTiming } from '../packages/recommendation/src/everydayTimingFit';
import { runTimingSearch } from '../packages/recommendation/src/timingSearch';
import { SUPPORTED_MUHURTHAM_ACTIVITY_IDS } from '../packages/recommendation/src/muhurthamFinder';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

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

console.log(allPassed ? '\nALL EVERYDAY TIMING FIT CHECKS PASSED' : '\nSOME EVERYDAY TIMING FIT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
