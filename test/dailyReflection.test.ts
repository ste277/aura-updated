import { buildDailyReflection } from '../apps/web/lib/dailyReflection';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { PlannedActivity, AuraMoment, HabitLogRow } from '../apps/web/lib/db';

/**
 * Daily Reflection & Tomorrow Preview V1 -- section 17's test list, the
 * parts that concern buildDailyReflection() specifically: completed /
 * missed / instant-logged / timed-logged / upcoming / past-without-
 * completion / shared-Moment / cancelled / quiet-day.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T15:00:00.000Z'); // 8:30 PM IST

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1', userId: 'user-1', title: 'Deep Work', activityType: 'deep-work', icon: '💼',
    status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z'),
    durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function moment(overrides: Partial<AuraMoment> = {}): AuraMoment {
  return {
    id: 'moment-1', ownerUserId: 'user-1', publicToken: 'tok', scope: 'SHARED', source: 'PLAN', activityId: 'date-night',
    activityTitle: 'Date Night', activityIcon: '❤️', startAt: new Date('2026-08-24T02:00:00.000Z'), endAt: new Date('2026-08-24T03:30:00.000Z'),
    timezone: TZ, locationName: null, savedPersonId: 'sp-1', sharedPersonDisplayName: 'Anu', senderDisplayName: 'Owner', ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: null, status: 'ACTIVE', responseState: 'ACCEPTED', responsePreference: null, respondedAt: new Date('2026-08-24T01:00:00.000Z'),
    previousMomentId: null, plannedActivityId: null, ownerSeenResponseAt: null, firstOpenedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), expiresAt: null,
    ...overrides,
  };
}

function habitLog(overrides: Partial<HabitLogRow> = {}): HabitLogRow {
  return {
    id: 'log-1', userId: 'user-1', activityTitle: 'Workout', activeWindow: 'NEUTRAL',
    logTimestamp: new Date('2026-08-24T02:00:00.000Z'), logMinuteOfDay: 450, durationMinutes: 45,
    ...overrides,
  };
}

// ============================================================
// Quiet day -- no fake accomplishments manufactured
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const reflection = buildDailyReflection(agenda);
  check('Quiet day -> all buckets empty', reflection.completed.length === 0 && reflection.missed.length === 0 && reflection.loggedActivities.length === 0 && reflection.meaningfulMoments.length === 0);
  check('Quiet day -> summary is calm, not fabricated', reflection.summary === "Today was quieter than most. Nothing logged, and that's alright.");
}

// ============================================================
// Completed (LOGGED plan) vs missed (elapsed, unlogged plan)
// ============================================================
{
  const logged = plan({ id: 'logged', status: 'LOGGED' });
  const missed = plan({ id: 'missed', plannedStartAt: new Date('2026-08-24T07:00:00.000Z'), plannedEndAt: new Date('2026-08-24T08:00:00.000Z') });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [logged, missed], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const reflection = buildDailyReflection(agenda);
  check('LOGGED plan lands in completed[]', reflection.completed.length === 1 && reflection.completed[0].id === 'plan:logged');
  check('Elapsed, unlogged plan lands in missed[]', reflection.missed.length === 1 && reflection.missed[0].id === 'plan:missed');
  check('Summary never mentions the missed item (no guilt language)', !reflection.summary.toLowerCase().includes('miss'));
  check('Summary never uses "you failed to..." phrasing', !reflection.summary.toLowerCase().includes('fail'));
}

// ============================================================
// Instant-logged (0-minute) vs timed-logged HabitLogs
// ============================================================
{
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(),
    habitLogs: [habitLog({ id: 'instant', durationMinutes: 0 }), habitLog({ id: 'timed', durationMinutes: 45 })],
  });
  const reflection = buildDailyReflection(agenda);
  check('Both an INSTANT and a timed log land in loggedActivities[]', reflection.loggedActivities.length === 2);
  check('Summary counts both logged activities', reflection.summary.includes('2 activities you logged'));
}

// ============================================================
// Upcoming (still-future) items are excluded from completed/missed/logged
// ============================================================
{
  const future = plan({ id: 'future', plannedStartAt: new Date('2026-08-25T05:00:00.000Z'), plannedEndAt: new Date('2026-08-25T06:00:00.000Z') });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [future], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const reflection = buildDailyReflection(agenda);
  check('A future plan lands in upcoming[], not completed/missed', reflection.upcoming.length === 1 && reflection.completed.length === 0 && reflection.missed.length === 0);
}

// ============================================================
// A cancelled plan never appears anywhere in the reflection
// ============================================================
{
  const cancelled = plan({ id: 'cancelled', status: 'CANCELLED' });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [cancelled], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const reflection = buildDailyReflection(agenda);
  check('Cancelled plan appears in no reflection bucket', reflection.completed.length === 0 && reflection.missed.length === 0 && reflection.upcoming.length === 0);
}

// ============================================================
// A shared, accepted Moment that already happened is a meaningful moment
// ============================================================
{
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
    moments: [moment()], // ends 03:30 UTC, now is 15:00 UTC -- already happened
  });
  const reflection = buildDailyReflection(agenda);
  check('An accepted, elapsed Moment lands in meaningfulMoments[]', reflection.meaningfulMoments.length === 1);
  check('Summary mentions a shared moment', reflection.summary.includes('1 moment shared with someone'));
}
{
  // A Moment nobody responded to is NOT a "meaningful moment" -- it never
  // actually happened as a coordinated event.
  const agenda = buildDailyAgenda({
    now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], momentIdsWithSuccessor: new Set(), habitLogs: [],
    moments: [moment({ responseState: null, endAt: new Date('2026-08-24T20:00:00.000Z') })],
  });
  const reflection = buildDailyReflection(agenda);
  check('A WAITING (unanswered) Moment is not counted as meaningful', reflection.meaningfulMoments.length === 0);
}

if (!allPassed) {
  console.error('\nSome daily reflection checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAILY REFLECTION CHECKS PASSED');
}
