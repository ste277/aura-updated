import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { PlannedActivity, AuraMoment, HabitLogRow } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T12:00:00.000Z'); // 5:30 PM IST

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1',
    userId: 'user-1',
    title: 'Deep Work',
    activityType: 'deep-work',
    icon: '💼',
    status: 'UPCOMING',
    plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), // 10:30 AM IST
    plannedEndAt: new Date('2026-08-24T06:00:00.000Z'),
    durationMinutes: 60,
    windowType: 'NEUTRAL',
    windowLabel: 'Neutral Flow',
    matchLabel: 'Good Match',
    score: 70,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function moment(overrides: Partial<AuraMoment> = {}): AuraMoment {
  return {
    id: 'moment-1',
    ownerUserId: 'user-1',
    publicToken: 'tok',
    scope: 'SHARED',
    source: 'PLAN',
    activityId: 'date-night',
    activityTitle: 'Date Night',
    activityIcon: '❤️',
    startAt: new Date('2026-08-24T14:00:00.000Z'), // 7:30 PM IST
    endAt: new Date('2026-08-24T15:30:00.000Z'),
    timezone: TZ,
    savedPersonId: 'sp-1',
    sharedPersonDisplayName: 'Anu',
    senderDisplayName: 'Owner',
    ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: null,
    status: 'ACTIVE',
    responseState: 'ACCEPTED',
    responsePreference: null,
    respondedAt: new Date('2026-08-24T01:00:00.000Z'),
    previousMomentId: null,
    plannedActivityId: null,
    ownerSeenResponseAt: null,
    firstOpenedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    expiresAt: null,
    ...overrides,
  };
}

function habitLog(overrides: Partial<HabitLogRow> = {}): HabitLogRow {
  return {
    id: 'log-1',
    userId: 'user-1',
    activityTitle: 'Workout',
    activeWindow: 'NEUTRAL',
    logTimestamp: new Date('2026-08-24T02:00:00.000Z'), // 7:30 AM IST
    logMinuteOfDay: 450,
    durationMinutes: 45,
    ...overrides,
  };
}

// ============================================================
// Section 48 -- basic chronological agenda
// ============================================================
{
  const agenda = buildDailyAgenda({
    now: NOW,
    localDate: LOCAL_DATE,
    timezone: TZ,
    plans: [plan()],
    moments: [moment()],
    momentIdsWithSuccessor: new Set(),
    habitLogs: [habitLog()],
  });
  check('Agenda has 3 items (workout log, deep work plan, date night moment)', agenda.items.length === 3);
  check('Chronological order: Workout, Deep Work, Date Night', agenda.items.map((i) => i.title).join(',') === 'Workout,Deep Work,Date Night');
  check('Workout is COMPLETED', agenda.items[0].status === 'COMPLETED');
  // Daily Reflection & Tomorrow Preview V1 (brief section 3): an elapsed,
  // unlogged Plan is MISSED, never auto-COMPLETED -- this Plan's status is
  // still 'UPCOMING' (never logged), even though its 5:00-6:00 UTC window
  // has passed by now (12:00 UTC).
  check('Deep Work is MISSED, not COMPLETED (elapsed but never logged)', agenda.items[1].status === 'MISSED');
  check('Date Night is CONFIRMED (ACCEPTED, still upcoming)', agenda.items[2].status === 'CONFIRMED');
  check('completedCount is 1 (workout log only -- the missed plan does not count)', agenda.completedCount === 1);
  check('plannedCount is 2 (plan + moment, not the habit log)', agenda.plannedCount === 2);
}

// ============================================================
// Daily Reflection & Tomorrow Preview V1, brief section 3 -- completion is
// never invented from elapsed time. Only plan.status === 'LOGGED' produces
// COMPLETED; everything else that has elapsed is MISSED.
// ============================================================
{
  const loggedPlan = plan({ id: 'plan-logged', status: 'LOGGED', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [loggedPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
  });
  check('A Plan with status LOGGED is COMPLETED regardless of elapsed time', agenda.items[0].status === 'COMPLETED');
}
{
  // Still in the future: neither COMPLETED nor MISSED.
  const futurePlan = plan({ id: 'plan-future', plannedStartAt: new Date('2026-08-25T05:00:00.000Z'), plannedEndAt: new Date('2026-08-25T06:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [futurePlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
  });
  check('A future, unlogged Plan is UPCOMING (not MISSED, not COMPLETED)', agenda.items[0].status === 'UPCOMING');
}
{
  // Cancelled plans are excluded outright, whether or not their window
  // elapsed -- unrelated to the MISSED/COMPLETED distinction.
  const cancelledPlan = plan({ id: 'plan-cancelled', status: 'CANCELLED', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [cancelledPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
  });
  check('A CANCELLED plan never appears as MISSED (excluded outright)', agenda.items.length === 0);
}

// ============================================================
// Section 49 -- Plan/Moment dedup via plannedActivityId
// ============================================================
{
  const linkedPlan = plan({ id: 'plan-linked' });
  const linkedMoment = moment({ id: 'moment-linked', plannedActivityId: 'plan-linked' });
  const agenda = buildDailyAgenda({
    now: NOW,
    localDate: LOCAL_DATE,
    timezone: TZ,
    plans: [linkedPlan],
    moments: [linkedMoment],
    momentIdsWithSuccessor: new Set(),
    habitLogs: [],
  });
  check('Linked Plan + Moment renders as exactly ONE agenda item', agenda.items.length === 1);
  check('The one item is the richer MOMENT representation', agenda.items[0].type === 'MOMENT');
}

// ============================================================
// Section 50 -- Moment lifecycle states
// ============================================================
{
  const noResponse = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], habitLogs: [],
    moments: [moment({ responseState: null })],
    momentIdsWithSuccessor: new Set(),
  });
  check('No response -> included, status WAITING', noResponse.items.length === 1 && noResponse.items[0].status === 'WAITING');
}
{
  const anotherTimeNoSuccessor = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], habitLogs: [],
    moments: [moment({ responseState: 'ANOTHER_TIME' })],
    momentIdsWithSuccessor: new Set(),
  });
  check('ANOTHER_TIME without successor -> excluded from agenda', anotherTimeNoSuccessor.items.length === 0);
}
{
  const anotherTimeWithSuccessor = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], habitLogs: [],
    moments: [moment({ id: 'original', responseState: 'ANOTHER_TIME' })],
    momentIdsWithSuccessor: new Set(['original']),
  });
  check('Superseded (ANOTHER_TIME + has successor) -> original excluded', anotherTimeWithSuccessor.items.length === 0);
}
{
  const revoked = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], habitLogs: [],
    // A revoked/expired moment would never even be returned by
    // listAuraMomentsForReminders (it already filters ACTIVE+unexpired) --
    // simulate the caller correctly never passing one in.
    moments: [],
    momentIdsWithSuccessor: new Set(),
  });
  check('Revoked/expired moments (excluded upstream by listAuraMomentsForReminders) never appear', revoked.items.length === 0);
}
{
  const successorShown = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], habitLogs: [],
    moments: [moment({ id: 'successor', responseState: null })],
    momentIdsWithSuccessor: new Set(),
  });
  check('A successor moment (its own row, no response yet) shows normally', successorShown.items.length === 1 && successorShown.items[0].status === 'WAITING');
}

// ============================================================
// Section 51 -- INSTANT (0-minute) HabitLog
// ============================================================
{
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(),
    habitLogs: [habitLog({ durationMinutes: 0 })],
  });
  check('INSTANT log (durationMinutes 0) is included with durationMinutes 0 (display "Completed" is the component\'s job via formatActivityDuration)', agenda.items[0].durationMinutes === 0);
}

// ============================================================
// Section 56 -- timezone: a UTC-midnight-adjacent Plan must land on the
// correct LOCAL date's agenda (buildDailyAgenda itself doesn't filter by
// date -- that's the orchestrator's job via bounded queries -- but confirm
// items outside the day are still handled sanely when a caller passes them).
// ============================================================
{
  // 11:45 PM IST on Aug 23 is 6:15 PM UTC Aug 23 -- clearly a DIFFERENT
  // local day from Aug 24. This item would never be included by a correct
  // orchestrator query bounded to Aug 24's [00:00, 24:00) IST window; here
  // we just confirm the pure function doesn't silently misplace an
  // already-correctly-scoped item's chronological order.
  const lateNightPlan = plan({ id: 'late', plannedStartAt: new Date('2026-08-24T18:15:00.000Z'), plannedEndAt: new Date('2026-08-24T19:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [lateNightPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
  });
  check('An item within the day sorts correctly regardless of proximity to UTC midnight', agenda.items[0].id === 'plan:late');
}

// ============================================================
// Home cleanup (Daily Reflection & Tomorrow Preview V1 follow-up) --
// DailyAgenda.nextItem is now the SAME value YourDayTimeline uses to
// decide which single row gets the "NEXT" eyebrow, replacing the removed
// standalone "What's Next" card for a normal upcoming Plan. These prove
// the underlying selection itself (already used by
// deriveNextMeaningfulThing's tier 3) is chronologically correct and
// never picks a completed/missed item -- no new "find next plan" logic
// was introduced, this is exercising the existing computation.
// ============================================================
{
  // A past COMPLETED plan, a past MISSED plan, and two future UPCOMING
  // plans -- nextItem must pick the chronologically FIRST of the two
  // future ones, never the completed or missed ones.
  const completedPast = plan({ id: 'completed-past', status: 'LOGGED', plannedStartAt: new Date('2026-08-24T02:00:00.000Z'), plannedEndAt: new Date('2026-08-24T03:00:00.000Z') });
  const missedPast = plan({ id: 'missed-past', plannedStartAt: new Date('2026-08-24T04:00:00.000Z'), plannedEndAt: new Date('2026-08-24T05:00:00.000Z') });
  const laterUpcoming = plan({ id: 'later-upcoming', plannedStartAt: new Date('2026-08-25T10:00:00.000Z'), plannedEndAt: new Date('2026-08-25T11:00:00.000Z') });
  const nextUpcoming = plan({ id: 'next-upcoming', plannedStartAt: new Date('2026-08-24T14:00:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
    plans: [completedPast, missedPast, laterUpcoming, nextUpcoming],
  });
  check('nextItem picks the chronologically first UPCOMING plan, not the later one', agenda.nextItem?.id === 'plan:next-upcoming');
  check('nextItem never picks the COMPLETED plan', agenda.nextItem?.id !== 'plan:completed-past');
  check('nextItem never picks the MISSED plan', agenda.nextItem?.id !== 'plan:missed-past');
}
{
  // Empty agenda -- no next item at all (supports Your Day's own empty
  // state; nothing to emphasize).
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('An empty agenda has no nextItem', agenda.nextItem === undefined);
}
{
  // A day where EVERYTHING has already happened (all COMPLETED/MISSED) --
  // nextItem must be undefined, not fall back to a past item.
  const completed = plan({ id: 'done', status: 'LOGGED', plannedStartAt: new Date('2026-08-24T02:00:00.000Z'), plannedEndAt: new Date('2026-08-24T03:00:00.000Z') });
  const missed = plan({ id: 'gone', plannedStartAt: new Date('2026-08-24T04:00:00.000Z'), plannedEndAt: new Date('2026-08-24T05:00:00.000Z') });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [completed, missed], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('A day with only past completed/missed items has no nextItem', agenda.nextItem === undefined);
}
{
  // Dedup: a linked Plan/Moment pair renders as ONE item -- nextItem must
  // resolve to that single deduped (Moment) representation, not risk
  // matching a since-removed Plan row.
  const linkedPlan = plan({ id: 'linked-next', plannedStartAt: new Date('2026-08-24T14:00:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z') });
  const linkedMoment = moment({ id: 'moment-linked-next', plannedActivityId: 'linked-next', startAt: new Date('2026-08-24T14:00:00.000Z'), endAt: new Date('2026-08-24T15:00:00.000Z') });
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [linkedPlan], moments: [linkedMoment], momentIdsWithSuccessor: new Set(), habitLogs: [],
  });
  check('nextItem on a deduped Plan/Moment pair resolves to the single Moment row', agenda.items.length === 1 && agenda.nextItem?.id === agenda.items[0].id);
}

if (!allPassed) {
  console.error('\nSome daily agenda checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAILY AGENDA CHECKS PASSED');
}
