import { evaluateMuhurta } from '../packages/muhurta/src/muhurtaEngine';
import { evaluateActivityFit } from '../packages/recommendation/src/auraFitEngine';
import { findBestTimeForActivity, findOptimalTaskTimes } from '../packages/recommendation/src/dailyAssistant';
import { findActivityIntent } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDiscoveryCards } from '../packages/recommendation/src/actionCards';

const chennaiContext = {
  now: new Date(Date.UTC(2026, 6, 28, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

let allPassed = true;

function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const date = new Date(Date.UTC(2026, 6, 28, 6, 45, 0));
const abhijit = evaluateMuhurta({
  taskTitle: 'Start a new business',
  date,
  windowType: 'ABHIJIT',
});
const rahu = evaluateMuhurta({
  taskTitle: 'Start a new business',
  date,
  windowType: 'RAHU_KALAM',
});

check('Panchanga snapshot includes all four elements', Boolean(abhijit.panchanga.tithi && abhijit.panchanga.nakshatra && abhijit.panchanga.yoga && abhijit.panchanga.karana));
check('Abhijit scores higher than Rahu Kalam for an important start', abhijit.modifier > rahu.modifier);
check('Rahu Kalam explains the blocker', rahu.blockers.some((item) => item.includes('Rahu Kalam')));

const modifiers = Array.from({ length: 10 }, (_, offset) => {
  const nextDate = new Date(date.getTime() + offset * 86400000);
  return evaluateMuhurta({ taskTitle: 'Deep Work', date: nextDate, windowType: 'ABHIJIT' }).modifier;
});
check('Panchanga factors change recommendation strength across dates', new Set(modifiers).size > 1);

const plan = findOptimalTaskTimes('Deep Work', chennaiContext, 60, 'TODAY', undefined, undefined, 'ANYTIME');
const options = plan.planningOptions ?? [];
check('Plan returns one to three opportunities', options.length >= 1 && options.length <= 3);
check('Plan opportunities are score-sorted', options.every((option, index) => index === 0 || options[index - 1].score >= option.score));
check('Plan summaries include Muhurtham context', options.some((option) => /tithi|nakshatra|yoga|karana|Abhijit|Brahma|Gulika|supports|friction|helpful/i.test(option.summary)));

const afternoonContext = {
  ...chennaiContext,
  now: new Date(Date.UTC(2026, 7, 19, 10, 30, 0)), // 4:00 PM IST on Aug 19, 2026
};
const sevenDayPlan = findOptimalTaskTimes('Deep Work', afternoonContext, 60, 'SEVEN_DAYS', undefined, undefined, 'ANYTIME');
const sevenDayOptions = sevenDayPlan.planningOptions ?? [];
const todayPastOptions = sevenDayOptions.filter((option) => option.dateLabel === 'Wed, Aug 19' && /AM/.test(option.startTime));
check('Seven-day planning excludes already-passed moments from today', todayPastOptions.length === 0);
check('Seven-day planning returns a daily option for each day', sevenDayOptions.length === 7);
check('Seven-day planning returns varied start times when alternatives exist', new Set(sevenDayOptions.map((option) => option.startTime)).size > 1);
const sevenDayBestOption = [...sevenDayOptions].sort((a, b) => b.score - a.score)[0];
check('Seven-day base calendar matches the best returned option', sevenDayPlan.calendar.startsAtLocal === sevenDayBestOption?.startsAtLocal);

const weekendPlan = findOptimalTaskTimes('Deep Work', afternoonContext, 30, 'WEEKEND', undefined, undefined, 'ANYTIME');
const weekendBestOption = [...(weekendPlan.planningOptions ?? [])].sort((a, b) => b.score - a.score)[0];
check('Weekend base calendar matches the best returned option', weekendPlan.calendar.startsAtLocal === weekendBestOption?.startsAtLocal);

const customPlan = findOptimalTaskTimes('Deep Work', afternoonContext, 30, 'CUSTOM', '2026-08-21', '2026-08-23', 'ANYTIME');
const customBestOption = [...(customPlan.planningOptions ?? [])].sort((a, b) => b.score - a.score)[0];
check('Custom-range base calendar matches the best returned option', customPlan.calendar.startsAtLocal === customBestOption?.startsAtLocal);

const longPlan = findOptimalTaskTimes('Tea break', afternoonContext, 240, 'TOMORROW', undefined, undefined, 'ANYTIME');
check('Planner preserves long requested durations in base recommendation', longPlan.durationMinutes === 240);

const roadTripIntent = findActivityIntent('I need to start my road trip');
check('Activity catalog resolves start-journey intent', roadTripIntent?.id === 'start-journey');
if (roadTripIntent) {
  const universalFit = evaluateActivityFit({ activity: roadTripIntent, date, windowType: 'ABHIJIT' });
  const personalFit = evaluateActivityFit({
    activity: roadTripIntent,
    date,
    windowType: 'ABHIJIT',
    personalContext: { natalNakshatraIndex: 1, janmaNakshatra: 'Ashwini', moonElement: 'FIRE' },
  });
  check('Birth context adds a secondary personal Muhurtham signal', Boolean(personalFit.personalSummary) && personalFit.score !== universalFit.score);
}
const journeyPlan = findBestTimeForActivity({
  activity: 'I need to start my road trip',
  context: afternoonContext,
  durationMinutes: 90,
  horizon: 'TOMORROW',
  timePreference: 'ANYTIME',
});
check('Planner uses catalog profile for journey starts', journeyPlan.activityType === 'Start a Journey');
check('Tomorrow planning from Aug 19 IST labels Aug 20', (journeyPlan.planningOptions ?? []).every((option) => option.dateLabel === 'Thu, Aug 20'));

const noonIstPlan = findOptimalTaskTimes('Deep Work', afternoonContext, 30, 'TOMORROW', undefined, undefined, 'ANYTIME');
const noonIstOption = (noonIstPlan.planningOptions ?? []).find((option) => option.startTime === '12:00 PM');
check('Planner calendar timestamps use user timezone offset', noonIstOption?.startsAtLocal === '2026-08-20T06:30:00.000Z');

const newYorkBeforeDst = {
  now: new Date(Date.UTC(2026, 2, 7, 15, 0, 0)), // 10:00 AM EST on Mar 7, 2026
  latitude: 40.7128,
  longitude: -74.006,
  timezone: 'America/New_York',
  tzOffsetMinutes: -300,
};
const newYorkDstPlan = findOptimalTaskTimes('Deep Work', newYorkBeforeDst, 30, 'TOMORROW', undefined, undefined, 'ANYTIME');
const newYorkAfternoon = (newYorkDstPlan.planningOptions ?? []).find((option) => option.startTime === '12:45 PM');
check('Planner recomputes timezone offset for future DST dates', newYorkAfternoon?.startsAtLocal === '2026-03-08T16:45:00.000Z');

const newYorkLateBeforeDst = {
  ...newYorkBeforeDst,
  now: new Date(Date.UTC(2026, 2, 8, 4, 30, 0)), // 11:30 PM EST on Mar 7, 2026
};
const newYorkLateDstPlan = findOptimalTaskTimes('Deep Work', newYorkLateBeforeDst, 30, 'TOMORROW', undefined, undefined, 'ANYTIME');
check('Tomorrow planning adds local calendar days across DST', (newYorkLateDstPlan.planningOptions ?? []).every((option) => option.dateLabel === 'Sun, Mar 8'));

const teaPlan = findOptimalTaskTimes('tea break', afternoonContext, 15, 'TODAY', undefined, undefined, 'ANYTIME');
check('Low-stakes catalog activities can remain usable today', (teaPlan.planningOptions ?? []).length >= 1);

// Regression coverage for the catalog-match scoring-quality question raised in
// the activity-ontology work: profileFromActivity() (dailyAssistant.ts) sets
// TaskProfile.scores to {} for every catalog match, but scoreCandidate()
// (dailyAssistant.ts:690-699) routes any profile carrying `activity` through
// evaluateActivityFit() whenever a date is available -- which is true for
// every current caller (recommendTaskSlot, findOptimalTaskTimes,
// findBestWindowToday, scoreContinuousBlock) -- bypassing the empty map
// entirely. These checks pin down that a catalog match gets real,
// window-differentiated scores today, not the generic flat-55 fallback.
const SOLAR_WINDOW_TYPES = ['ABHIJIT', 'BRAHMA', 'GULIKA', 'NEUTRAL', 'RAHU_KALAM', 'YAMA'] as const;
if (roadTripIntent) {
  const windowScores = SOLAR_WINDOW_TYPES.map((windowType) => ({
    windowType,
    score: evaluateActivityFit({ activity: roadTripIntent, date, windowType }).score,
  }));
  check('Catalog-matched activity scores differ across window types (not flat 55)', new Set(windowScores.map((entry) => entry.score)).size > 1);
  check('Catalog-matched activity scores are never the generic flat-55 fallback value', windowScores.every((entry) => entry.score !== 55));
  const abhijitScore = windowScores.find((entry) => entry.windowType === 'ABHIJIT')!.score;
  const rahuScore = windowScores.find((entry) => entry.windowType === 'RAHU_KALAM')!.score;
  check('Catalog-matched activity scores its recommended window meaningfully higher than its avoid window', abhijitScore - rahuScore >= 20);
}

const deepWorkIntent = findActivityIntent('Deep Work');
check('Deep Work resolves to the deep-work catalog entry', deepWorkIntent?.id === 'deep-work');
if (deepWorkIntent) {
  const deepWorkScores = SOLAR_WINDOW_TYPES.map((windowType) => evaluateActivityFit({ activity: deepWorkIntent, date, windowType }).score);
  check('Deep Work (catalog match) window scores are differentiated, not flat', new Set(deepWorkScores).size > 1);
  const abhijitScore = evaluateActivityFit({ activity: deepWorkIntent, date, windowType: 'ABHIJIT' }).score;
  const rahuScore = evaluateActivityFit({ activity: deepWorkIntent, date, windowType: 'RAHU_KALAM' }).score;
  check('Deep Work scores its recommended window meaningfully higher than its avoid window', abhijitScore - rahuScore >= 20);
}

const neutralDiscovery = getActivityDiscoveryCards('Neutral Flow', 20);
check('Discovery cards expose fit labels', neutralDiscovery.every((card) => Boolean(card.fit)));
check('Discovery is catalog-backed for dating in Neutral Flow', neutralDiscovery.some((card) => card.activityId === 'dating'));
check('Discovery uses nuanced fit labels', new Set(neutralDiscovery.map((card) => card.fit)).size > 1);
const abhijitDiscovery = getActivityDiscoveryCards('Abhijit Muhurtham', 8);
check('Muhurta fit favors stronger starts during Abhijit', abhijitDiscovery.some((card) => card.activityId === 'start-journey' && (card.fit === 'BEST' || card.fit === 'GOOD')));
check('Tea break is not best fit during Abhijit', !abhijitDiscovery.some((card) => card.activityId === 'tea-break' && card.fit === 'BEST'));

console.log(allPassed ? '\nALL MUHURTA CHECKS PASSED' : '\nSOME MUHURTA CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
