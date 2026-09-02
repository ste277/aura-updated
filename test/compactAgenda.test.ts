import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { selectCompactAgendaRows, groupAdjacentByFormattedTime, MAX_COMPACT_ROWS } from '../apps/web/lib/compactAgenda';
import type { PlannedActivity, HabitLogRow } from '../apps/web/lib/db';

/**
 * Home Compactness + Flexible Day Story V1 (brief section 4/5/6/7/8/9/61)
 * -- pure tests for the compact "Your Day" row-selection algorithm and the
 * same-timestamp grouping helper. YourDayTimeline.tsx used to render
 * agenda.items.map(...) unconditionally; this is the new selection logic
 * that caps it.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T14:00:00.000Z'); // 7:30 PM IST -- late enough that several earlier items are COMPLETED/MISSED

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1', userId: 'user-1', title: 'Deep Work', activityType: 'deep-work', icon: '💼', status: 'UPCOMING',
    plannedStartAt: new Date('2026-08-24T16:00:00.000Z'), plannedEndAt: new Date('2026-08-24T17:00:00.000Z'),
    durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function log(overrides: Partial<HabitLogRow> = {}): HabitLogRow {
  return {
    id: 'log-1', userId: 'user-1', activityTitle: 'Workout', activeWindow: 'NEUTRAL',
    logTimestamp: new Date('2026-08-24T11:00:00.000Z'), logMinuteOfDay: 990, durationMinutes: 30,
    ...overrides,
  };
}

// ============================================================
// Empty agenda
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  check('Empty agenda -> zero rows, zero hidden', rows.length === 0 && hiddenCount === 0);
  check('Null agenda -> zero rows, zero hidden (never throws)', selectCompactAgendaRows(null).rows.length === 0 && selectCompactAgendaRows(undefined).hiddenCount === 0);
}

// ============================================================
// Never more than MAX_COMPACT_ROWS, and always <= 4 per brief section 4.
// ============================================================
{
  const habitLogs = Array.from({ length: 6 }, (_, i) =>
    log({ id: `log-${i}`, activityTitle: `Completed ${i}`, logTimestamp: new Date(new Date('2026-08-24T04:00:00.000Z').getTime() + i * 3600_000) })
  );
  const plans = [
    plan({ id: 'up-1', title: 'Upcoming A', plannedStartAt: new Date('2026-08-24T15:00:00.000Z'), plannedEndAt: new Date('2026-08-24T15:30:00.000Z'), status: 'UPCOMING' }),
    plan({ id: 'up-2', title: 'Upcoming B', plannedStartAt: new Date('2026-08-24T16:00:00.000Z'), plannedEndAt: new Date('2026-08-24T16:30:00.000Z'), status: 'UPCOMING' }),
    plan({ id: 'up-3', title: 'Upcoming C', plannedStartAt: new Date('2026-08-24T17:00:00.000Z'), plannedEndAt: new Date('2026-08-24T17:30:00.000Z'), status: 'UPCOMING' }),
  ];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs });
  check('Fixture sanity: 9 total items on the agenda', agenda.items.length === 9);
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  check('MAX_COMPACT_ROWS is 4 (brief section 4: "3-4")', MAX_COMPACT_ROWS === 4);
  check('Never more than MAX_COMPACT_ROWS visible rows', rows.length <= MAX_COMPACT_ROWS);
  check('9 items, 4 shown -> hiddenCount is 5', hiddenCount === 5);
  check('Not just the first 4 chronologically -- the selection is completed+next, not a blind slice', rows.some((r) => r.status === 'COMPLETED') && rows.some((r) => r.status !== 'COMPLETED'));
}

// ============================================================
// "Up to 2 most recent completed" -- prefers the LATEST completions, not
// the earliest.
// ============================================================
{
  const habitLogs = [
    log({ id: 'log-early', activityTitle: 'Early Task', logTimestamp: new Date('2026-08-24T02:00:00.000Z') }),
    log({ id: 'log-mid', activityTitle: 'Mid Task', logTimestamp: new Date('2026-08-24T06:00:00.000Z') }),
    log({ id: 'log-late', activityTitle: 'Late Task', logTimestamp: new Date('2026-08-24T10:00:00.000Z') }),
  ];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs });
  const { rows } = selectCompactAgendaRows(agenda);
  const completedTitles = rows.filter((r) => r.status === 'COMPLETED').map((r) => r.title);
  check('Only the 2 MOST RECENT completions are kept', completedTitles.length === 2 && completedTitles.includes('Late Task') && completedTitles.includes('Mid Task'));
  check('The earliest completion is the one omitted', !completedTitles.includes('Early Task'));
}

// ============================================================
// Next upcoming + optional second upcoming.
// ============================================================
{
  const plans = [
    plan({ id: 'up-1', title: 'First Upcoming', plannedStartAt: new Date('2026-08-24T15:00:00.000Z'), plannedEndAt: new Date('2026-08-24T15:30:00.000Z'), status: 'UPCOMING' }),
    plan({ id: 'up-2', title: 'Second Upcoming', plannedStartAt: new Date('2026-08-24T16:00:00.000Z'), plannedEndAt: new Date('2026-08-24T16:30:00.000Z'), status: 'UPCOMING' }),
  ];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  check('No completions, 2 upcoming, budget allows both -> both shown', rows.length === 2 && rows[0].title === 'First Upcoming' && rows[1].title === 'Second Upcoming');
  check('Nothing hidden when everything fits the budget', hiddenCount === 0);
}

// ============================================================
// MISSED items stay visible on Home (an existing, deliberate guarantee --
// see missedPlanRegression.spec.ts) but are never elevated into the
// grouped/checkmarked COMPLETED presentation (brief section 5: "distinct
// from completed", "never accidentally elevate MISSED activities into the
// compact completed list as accomplishments" -- distinctness, not hiding).
// ============================================================
{
  const plans = [
    plan({ id: 'missed-1', title: 'Missed Plan', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T03:30:00.000Z'), status: 'UPCOMING' }), // elapsed, unlogged -> MISSED
  ];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('Fixture sanity: the plan is MISSED, not COMPLETED', agenda.items[0]?.status === 'MISSED');
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  check('A MISSED-only day -> the MISSED item still appears on Home (a pre-existing, deliberate guarantee)', rows.length === 1 && rows[0].status === 'MISSED');
  check('Nothing hidden -- it was shown, not omitted', hiddenCount === 0);
}
{
  // A day with both a completion and a miss -- both are "recent past",
  // but the MISSED one must never be treated AS a completion (never
  // counted toward/replacing the completed bucket, never eligible for
  // groupAdjacentByFormattedTime's checkmark grouping -- that grouping is
  // only ever invoked by the caller on status==='COMPLETED' rows).
  const habitLogs = [log({ id: 'log-1', activityTitle: 'Real Completion', logTimestamp: new Date('2026-08-24T09:00:00.000Z') })];
  const plans = [plan({ id: 'missed-2', title: 'Missed Plan', plannedStartAt: new Date('2026-08-24T10:00:00.000Z'), plannedEndAt: new Date('2026-08-24T10:30:00.000Z'), status: 'UPCOMING' })];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs });
  const { rows } = selectCompactAgendaRows(agenda);
  check('Both the completion and the miss appear (2 most recent past items, mixed statuses)', rows.length === 2 && rows.some((r) => r.status === 'COMPLETED') && rows.some((r) => r.status === 'MISSED'));
}

// ============================================================
// A day with only 1 completed item and no upcoming -- budget allows
// showing just that one row, not padding with anything else.
// ============================================================
{
  const habitLogs = [log({ id: 'log-1', activityTitle: 'Solo Completion', logTimestamp: new Date('2026-08-24T09:00:00.000Z') })];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs });
  const { rows, hiddenCount } = selectCompactAgendaRows(agenda);
  check('Exactly 1 completed item, nothing upcoming -> exactly 1 row', rows.length === 1 && rows[0].title === 'Solo Completion');
  check('Nothing hidden', hiddenCount === 0);
}

// ============================================================
// groupAdjacentByFormattedTime -- pure presentation grouping, brief
// section 9.
// ============================================================
{
  const habitLogs = [
    log({ id: 'a', activityTitle: 'A', logTimestamp: new Date('2026-08-24T13:02:10.000Z') }), // 6:32 PM IST
    log({ id: 'b', activityTitle: 'B', logTimestamp: new Date('2026-08-24T13:02:40.000Z') }), // also 6:32 PM IST (40s later, same displayed minute)
    log({ id: 'c', activityTitle: 'C', logTimestamp: new Date('2026-08-24T13:02:55.000Z') }), // also 6:32 PM IST
  ];
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs });
  const formatTime = (item: { startAt: string }) => new Date(item.startAt).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
  const groups = groupAdjacentByFormattedTime(agenda.items, formatTime);
  check('3 items with distinct real timestamps but the same DISPLAYED minute -> grouped into ONE group', groups.length === 1 && groups[0].items.length === 3);
  check('The underlying real timestamps are untouched (still 3 distinct items, not merged/deduped)', new Set(groups[0].items.map((i) => i.id)).size === 3);

  const distinctTimesAgenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(),
    habitLogs: [
      log({ id: 'x', activityTitle: 'X', logTimestamp: new Date('2026-08-24T02:00:00.000Z') }),
      log({ id: 'y', activityTitle: 'Y', logTimestamp: new Date('2026-08-24T09:00:00.000Z') }),
    ],
  });
  const groups2 = groupAdjacentByFormattedTime(distinctTimesAgenda.items, formatTime);
  check('Items at genuinely different times -> never grouped together', groups2.length === 2 && groups2.every((g) => g.items.length === 1));

  check('Empty input -> empty output, never throws', groupAdjacentByFormattedTime([], formatTime).length === 0);
}

if (!allPassed) {
  console.error('\nSome Compact Agenda checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL COMPACT AGENDA CHECKS PASSED');
}
