import { buildTomorrowPreview } from '../apps/web/lib/tomorrowPreview';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import type { PlannedActivity } from '../apps/web/lib/db';

/**
 * Daily Reflection & Tomorrow Preview V1 -- section 17's tomorrow-preview
 * tests: reuses buildDailyAgenda (no duplicate agenda logic) and the
 * existing getGoodForDayCategories()/Panchang infra without dumping raw
 * Tithi/Nakshatra/Yoga/Karana/Rahu into the output.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const TOMORROW = '2026-07-29';
const chennaiDay = getPanchangForDate({ localDate: TOMORROW, latitude: 13.0827, longitude: 80.2707, timezone: TZ });

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1', userId: 'user-1', title: 'Date Night', activityType: 'date-night', icon: '❤️',
    status: 'UPCOMING', plannedStartAt: new Date('2026-07-29T14:00:00.000Z'), plannedEndAt: new Date('2026-07-29T16:00:00.000Z'),
    durationMinutes: 120, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'), updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  };
}

// ============================================================
// Empty tomorrow -- no Plans/Moments yet
// ============================================================
{
  const agenda = buildDailyAgenda({ now: new Date('2026-07-28T12:00:00.000Z'), localDate: TOMORROW, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const preview = buildTomorrowPreview(agenda, chennaiDay);
  check('Empty tomorrow -> agenda has no items', preview.agenda.items.length === 0);
  check('Narrative never dumps raw Panchang element names', !/tithi|nakshatra|yoga|karana|rahu/i.test(preview.narrative));
  check('goodForCategories is an array (possibly empty, thresholded by the existing BEST bar)', Array.isArray(preview.goodForCategories));
}

// ============================================================
// Tomorrow already has a shared Moment/Plan scheduled -- section 17's
// "tomorrow already has a shared Moment" test: it must be reflected, not
// duplicated or invented.
// ============================================================
{
  const now = new Date('2026-07-28T12:00:00.000Z');
  const agenda = buildDailyAgenda({ now, localDate: TOMORROW, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const preview = buildTomorrowPreview(agenda, chennaiDay);
  check('Tomorrow with a Plan -> the preview agenda includes it (derived, not duplicated)', preview.agenda.items.length === 1 && preview.agenda.items[0].title === 'Date Night');
  check('Narrative mentions the already-scheduled thing', preview.narrative.includes('Date Night'));
  check('No raw Panchang element names leak into the narrative', !/tithi|nakshatra|yoga|karana|rahu/i.test(preview.narrative));
}

// ============================================================
// A section-16 acquisition-source-agnostic Plan (e.g. Recipient
// Conversion-created) appears in Tomorrow Preview exactly like a native one
// -- buildDailyAgenda/buildTomorrowPreview never inspect acquisition
// source, so there is nothing to special-case; this proves it by using a
// plain PlannedActivity row (the same shape every acquisition path writes).
// ============================================================
{
  const now = new Date('2026-07-28T12:00:00.000Z');
  const anyOriginPlan = plan({ id: 'from-anywhere', title: 'Coffee / Tea' });
  const agenda = buildDailyAgenda({ now, localDate: TOMORROW, timezone: TZ, plans: [anyOriginPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const preview = buildTomorrowPreview(agenda, chennaiDay);
  check('A Plan with no acquisition-source field renders normally in Tomorrow Preview', preview.agenda.items[0].title === 'Coffee / Tea' && preview.agenda.items[0].type === 'PLAN');
}

console.log(allPassed ? '\nALL TOMORROW PREVIEW CHECKS PASSED' : '\nSOME TOMORROW PREVIEW CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
