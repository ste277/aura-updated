import {
  buildDayProfile,
  deriveAgendaOpenings,
  candidateFitsOpenings,
  selectIntentionCandidates,
  PEOPLE_GROUP_IDS,
} from '../apps/web/lib/dayBuilder';
import { buildDailyAgenda, DailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { DailyIntentionGroupId } from '../apps/web/lib/dailyIntentions';
import type { PlannedActivity } from '../apps/web/lib/db';

/**
 * Intentional Day Builder V1 -- pure-domain tests for dayBuilder.ts (brief
 * section 40). Same plain check()/allPassed harness as dailyStory.test.ts,
 * run standalone via `npx ts-node test/dayBuilder.test.ts`.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';

function plan(over: Partial<PlannedActivity> & { id: string; title: string; plannedStartAt: Date; plannedEndAt: Date }): PlannedActivity {
  return {
    userId: 'u',
    activityType: null,
    icon: null,
    status: 'UPCOMING',
    durationMinutes: Math.round((over.plannedEndAt.getTime() - over.plannedStartAt.getTime()) / 60000),
    windowType: 'NEUTRAL',
    windowLabel: null,
    matchLabel: null,
    score: null,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    createdAt: over.plannedStartAt,
    updatedAt: over.plannedStartAt,
    ...over,
  };
}

function agendaWithPlans(plans: PlannedActivity[], now: Date): DailyAgenda {
  return buildDailyAgenda({ now, localDate: LOCAL_DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
}

// ============================================================
// deriveAgendaOpenings
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans([], now);
  const openings = deriveAgendaOpenings({ agenda, minuteOfDay: 8 * 60 });
  check('Empty agenda -> exactly one opening covering the rest of the day', openings.length === 1);
  check('Empty agenda opening starts at now', openings[0]?.startMinute === 8 * 60);
  check('Empty agenda opening ends at midnight (1440)', openings[0]?.endMinute === 1440);
}
{
  // 10:00-11:00 IST plan, now = 8:00 AM IST -> two openings around it.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T04:30:00.000Z'), plannedEndAt: new Date('2026-08-24T05:30:00.000Z') })],
    now
  );
  const openings = deriveAgendaOpenings({ agenda, minuteOfDay: 8 * 60 });
  check('One mid-day plan -> two openings (before and after)', openings.length === 2);
  check('First opening ends exactly at the plan start (10:00 = 600min)', openings[0]?.endMinute === 10 * 60);
  check('Second opening starts exactly at the plan end (11:00 = 660min)', openings[1]?.startMinute === 11 * 60);
}
{
  // A tiny 10-minute gap should be dropped (below MIN_OPENING_MINUTES).
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans(
    [
      plan({ id: 'p1', title: 'A', plannedStartAt: new Date('2026-08-24T02:30:00.000Z'), plannedEndAt: new Date('2026-08-24T02:40:00.000Z') }), // 8:00-8:10
      plan({ id: 'p2', title: 'B', plannedStartAt: new Date('2026-08-24T02:50:00.000Z'), plannedEndAt: new Date('2026-08-24T03:00:00.000Z') }), // 8:20-8:30
    ],
    now
  );
  const openings = deriveAgendaOpenings({ agenda, minuteOfDay: 8 * 60 });
  check('A 10-minute gap between two plans is dropped as unusably short', !openings.some((o) => o.startMinute === 8 * 60 + 10 && o.endMinute === 8 * 60 + 20));
}

// ============================================================
// candidateFitsOpenings
// ============================================================
{
  const openings = [{ startMinute: 10 * 60, endMinute: 12 * 60 }];
  check(
    'A candidate fully inside an opening fits',
    candidateFitsOpenings({ start: '2026-08-24T04:30:00.000Z', end: '2026-08-24T05:00:00.000Z' }, openings, TZ, LOCAL_DATE) // 10:00-10:30 IST
  );
  check(
    'A candidate that starts after the opening ends does not fit',
    !candidateFitsOpenings({ start: '2026-08-24T07:00:00.000Z', end: '2026-08-24T07:30:00.000Z' }, openings, TZ, LOCAL_DATE) // 12:30-1:00 PM IST, opening ends at 12:00
  );
  check(
    'A candidate on a different local date never fits, even at a matching time of day',
    !candidateFitsOpenings({ start: '2026-08-25T04:30:00.000Z', end: '2026-08-25T05:00:00.000Z' }, openings, TZ, LOCAL_DATE)
  );
}

// ============================================================
// buildDayProfile
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);
  check('Empty agenda -> isEmpty', profile.isEmpty);
  check('Empty agenda -> not busy', !profile.isBusy);
  check('Empty agenda -> evening open', profile.hasEveningOpen);
  check('Empty agenda -> no groups present', profile.presentGroupIds.size === 0);
}
{
  // 3 upcoming plans -> busy, zero suggestions territory.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = agendaWithPlans(
    [
      plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') }),
      plan({ id: 'p2', title: 'Learning', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }),
      plan({ id: 'p3', title: 'Workout', plannedStartAt: new Date('2026-08-24T07:00:00.000Z'), plannedEndAt: new Date('2026-08-24T08:00:00.000Z') }),
    ],
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  check('3 upcoming plans -> isBusy', profile.isBusy);
  check('WORK activity title resolves into presentActivityIds', profile.presentActivityIds.has('deep-work'));
  check('WORK group marked present via resolved activity', profile.presentGroupIds.has('WORK'));
}
{
  // An evening plan -> evening not open. Deliberately a UTC evening hour
  // (>=17 in UTC directly, not just after a +5:30 IST shift) so this check
  // is portable across whatever timezone the test process itself runs in
  // -- hasEveningOpen (like dailyStory.ts's own isEveningOpen it mirrors)
  // reads Date#getHours() in the RUNTIME's local timezone, not agenda.timezone.
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Dinner Date', plannedStartAt: new Date('2026-08-24T18:00:00.000Z'), plannedEndAt: new Date('2026-08-24T19:00:00.000Z') })],
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  check('An evening plan -> hasEveningOpen is false', !profile.hasEveningOpen);
  check('An evening plan -> RELATIONSHIPS group marked present', profile.presentGroupIds.has('RELATIONSHIPS'));
}

// ============================================================
// selectIntentionCandidates -- zero-suggestion cases (brief section 13)
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z');
  const busyProfile = buildDayProfile(
    agendaWithPlans(
      [
        plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') }),
        plan({ id: 'p2', title: 'Learning', plannedStartAt: new Date('2026-08-24T05:00:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }),
        plan({ id: 'p3', title: 'Workout', plannedStartAt: new Date('2026-08-24T07:00:00.000Z'), plannedEndAt: new Date('2026-08-24T08:00:00.000Z') }),
      ],
      now
    ),
    8 * 60
  );
  check('A busy day (3+ upcoming items) -> zero candidates, not fewer', selectIntentionCandidates(busyProfile, new Set(), 5).length === 0);
}
{
  // Fully muted -> zero candidates even on a wide-open day.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);
  const allGroups = new Set<DailyIntentionGroupId>(['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK', 'SELF', 'ENJOYMENT']);
  check('Every real group muted -> zero candidates', selectIntentionCandidates(profile, allGroups, 5).length === 0);
}

// ============================================================
// selectIntentionCandidates -- diversity / dedup (brief section 11/12)
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST, wide open day
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);
  const candidates = selectIntentionCandidates(profile, new Set(), 5);
  check('Open day produces at least one candidate', candidates.length > 0);
  const groupIds = candidates.map((c) => c.groupId);
  check('No group appears twice (one activity per group -- diversity)', new Set(groupIds).size === groupIds.length);
  const activityIds = candidates.map((c) => c.activity.activityId);
  check('No activityId appears twice across groups (level-1 exact-id dedup)', new Set(activityIds).size === activityIds.length);
  check('Every candidate has a non-null activityId', candidates.every((c) => c.activity.activityId !== null));
  check('isPeopleOriented is true only for RELATIONSHIPS/FAMILY/SOCIAL', candidates.every((c) => c.isPeopleOriented === PEOPLE_GROUP_IDS.includes(c.groupId)));
}
{
  // A group already represented on the real agenda is never re-suggested.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') })],
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  const candidates = selectIntentionCandidates(profile, new Set(), 5);
  check('WORK already on the agenda -> WORK is never suggested again', !candidates.some((c) => c.groupId === 'WORK'));
}
{
  // Muting a specific group excludes it, others remain.
  const now = new Date('2026-08-24T02:30:00.000Z');
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);
  const candidates = selectIntentionCandidates(profile, new Set(['SELF']), 5);
  check('Muting SELF -> SELF never appears', !candidates.some((c) => c.groupId === 'SELF'));
  check('Muting SELF -> other groups can still appear', candidates.length > 0);
}
{
  // Evening open -> people-oriented groups prioritized ahead of WORK.
  const now = new Date('2026-08-24T02:30:00.000Z'); // wide open day, evening open
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);
  const candidates = selectIntentionCandidates(profile, new Set(), 5);
  const firstPeopleIndex = candidates.findIndex((c) => PEOPLE_GROUP_IDS.includes(c.groupId));
  const workIndex = candidates.findIndex((c) => c.groupId === 'WORK');
  check(
    'Evening open -> a people-oriented candidate is prioritized ahead of WORK',
    firstPeopleIndex !== -1 && (workIndex === -1 || firstPeopleIndex < workIndex)
  );
}
{
  // No openings at all (e.g. a single plan spanning the entire rest of the
  // day) -> zero candidates even though the day isn't technically "busy"
  // by count. Ends at 23:59, not exactly midnight -- deriveAgendaOpenings'
  // own minute-of-day math treats an exact-midnight end as the START of
  // the next local day (minute 0), not minute 1440 of today, so a plan
  // genuinely ending at local midnight is a separate, documented edge case
  // this test isn't about.
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Deep Work', plannedStartAt: new Date('2026-08-24T02:30:00.000Z'), plannedEndAt: new Date('2026-08-24T18:29:00.000Z') })], // 8:00 AM - 11:59 PM IST
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  check('No real openings left today -> zero candidates', selectIntentionCandidates(profile, new Set(), 5).length === 0);
}

if (!allPassed) {
  console.error('\nSome Day Builder domain checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAY BUILDER DOMAIN CHECKS PASSED');
}
