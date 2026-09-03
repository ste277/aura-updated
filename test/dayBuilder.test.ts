import {
  buildDayProfile,
  deriveAgendaOpenings,
  candidateFitsOpenings,
  selectIntentionCandidates,
  swapSuggestion,
  applyUserPriorities,
  resolvePrioritizedIntentionGroups,
  buildDailyPriorityCoverage,
  coveredIntentionGroupIds,
  USER_PRIORITY_GROUPS,
  PEOPLE_GROUP_IDS,
  IntentionalDaySuggestion,
  resolvePeopleContextTimePreference,
} from '../apps/web/lib/dayBuilder';
import { buildDailyAgenda, DailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { DailyIntentionGroupId } from '../apps/web/lib/dailyIntentions';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { TimingCandidate } from '../packages/recommendation/src/timingSearch';

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
    eventTimezone: null,
    eventLocationName: null,
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
  // An evening plan -> evening not open (agenda's own IST timezone, 6pm IST).
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Dinner Date', plannedStartAt: new Date('2026-08-24T18:00:00.000Z'), plannedEndAt: new Date('2026-08-24T19:00:00.000Z') })],
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  check('An evening plan -> hasEveningOpen is false', !profile.hasEveningOpen);
  check('An evening plan -> RELATIONSHIPS group marked present', profile.presentGroupIds.has('RELATIONSHIPS'));
}
{
  // Regression -- hasEveningOpen used to read Date#getHours() in the
  // SERVER PROCESS's own local timezone (UTC in production), never
  // agenda.timezone -- silently wrong for any user configured in a
  // non-UTC zone, and invisible to every test on an IST dev machine since
  // IST happened to match the fixtures' own assumed zone. Machine-
  // independent proof: an America/New_York agenda with a real 7pm New
  // York Plan -- only correct if the fix genuinely reads the Date in the
  // AGENDA's timezone, not whatever zone this test happens to run in.
  const NY_TZ = 'America/New_York';
  const now = new Date('2026-08-24T18:00:00.000Z'); // 2:00 PM EDT (UTC-4)
  const sevenPmNewYorkPlan = plan({ id: 'ny-evening', title: 'Family Dinner', plannedStartAt: new Date('2026-08-24T23:00:00.000Z'), plannedEndAt: new Date('2026-08-25T00:30:00.000Z') }); // 7:00-8:30 PM EDT
  const nyAgenda = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: NY_TZ, plans: [sevenPmNewYorkPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const nyProfile = buildDayProfile(nyAgenda, 14 * 60);
  check('A real 7pm New York Plan -> hasEveningOpen is correctly false (timezone-correct, not server-local)', !nyProfile.hasEveningOpen);
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

// ============================================================
// swapSuggestion -- "Another idea" reserve-pool swap (brief section 24,
// hardening pass). Pure array recombination -- no fetch, no timing
// search, no scoring: swapSuggestion's own signature (array in, array
// out, no async, no imports of anything I/O-capable) makes it structurally
// impossible for a call to this function to create a Plan/Moment or invoke
// a new search/scoring algorithm. These tests cover its actual selection
// behavior; the "cannot perform I/O" half of the guarantee is a property
// of the function's own definition (see dayBuilder.ts), reinforced by an
// E2E check in dayBuilderJourney.spec.ts that browsing produces zero new
// Plans/Moments end to end.
// ============================================================
function fakeSolo(start: string, activityId: string): TimingCandidate {
  return {
    start,
    end: new Date(new Date(start).getTime() + 30 * 60000).toISOString(),
    score: 7,
    label: 'GOOD',
    muhurtaScore: 0,
    reasons: [],
    metadata: { windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', activityType: activityId, dateLabel: 'Mon, Aug 24' },
  };
}

function fakeSuggestion(id: string, groupId: DailyIntentionGroupId, activityId: string): IntentionalDaySuggestion {
  return {
    id,
    groupId,
    activityId,
    label: activityId,
    icon: '✨',
    durationMinutes: 30,
    reason: 'test reason',
    candidate: { kind: 'SOLO', candidates: [fakeSolo('2026-08-24T10:00:00.000Z', activityId)] },
  };
}

{
  const all: IntentionalDaySuggestion[] = [
    fakeSuggestion('WORK:deep-work', 'WORK', 'deep-work'),
    fakeSuggestion('SELF:workout', 'SELF', 'workout'),
    fakeSuggestion('ENJOYMENT:movie-night', 'ENJOYMENT', 'movie-night'),
    fakeSuggestion('RELATIONSHIPS:coffee-tea', 'RELATIONSHIPS', 'coffee-tea'), // reserve
    fakeSuggestion('SOCIAL:catch-up', 'SOCIAL', 'catch-up'), // reserve
  ];
  const initialVisible = all.slice(0, 3).map((s) => s.id);

  check(
    'Initial suggestion set has no duplicate activityId (nothing to accidentally re-show)',
    new Set(all.map((s) => s.activityId)).size === all.length
  );

  const afterSwap = swapSuggestion(initialVisible, all, 'WORK:deep-work');
  check('Swap replaces a suggestion -- visible count stays the same', afterSwap.length === initialVisible.length);
  check('Swap removes the outgoing suggestion', !afterSwap.includes('WORK:deep-work'));
  check(
    'Swap\'s replacement comes from the already-resolved reserve pool (was NOT visible before)',
    afterSwap.some((id) => !initialVisible.includes(id) && all.some((s) => s.id === id))
  );
  check('Swap never introduces an id absent from the original resolved set', afterSwap.every((id) => all.some((s) => s.id === id)));

  const afterSwapActivityIds = afterSwap.map((id) => all.find((s) => s.id === id)!.activityId);
  check('Replacement does not duplicate another still-visible suggestion (no repeated activityId)', new Set(afterSwapActivityIds).size === afterSwapActivityIds.length);

  // Swap a second time -- the reserve pool is recomputed fresh each call
  // as "everything not currently visible" (a rotating pool, not a
  // one-time-use queue), so as long as total > visible.length there is
  // always a next candidate -- including, potentially, a suggestion
  // dismissed by an EARLIER swap of a different card. That's fine: it's
  // still a real, already-resolved suggestion, and the pool math still
  // guarantees it's never shown twice AT ONCE (see the dedup check below).
  const afterSecondSwap = swapSuggestion(afterSwap, all, afterSwap.find((id) => !initialVisible.includes(id))!);
  check('A second swap still succeeds while total exceeds the visible count', afterSecondSwap.length === 3);
  const secondActivityIds = afterSecondSwap.map((id) => all.find((s) => s.id === id)!.activityId);
  check('After a second swap, still no duplicate activityId among visible suggestions', new Set(secondActivityIds).size === secondActivityIds.length);
}
{
  // Swapping when there is genuinely no reserve at all (3 total resolved,
  // all 3 visible) -- the very first swap already has nothing to replace
  // with, matching the component's own `reserve.length > 0` gate that
  // hides the "Another idea" control in this exact situation.
  const all: IntentionalDaySuggestion[] = [
    fakeSuggestion('WORK:deep-work', 'WORK', 'deep-work'),
    fakeSuggestion('SELF:workout', 'SELF', 'workout'),
    fakeSuggestion('ENJOYMENT:movie-night', 'ENJOYMENT', 'movie-night'),
  ];
  const visible = all.map((s) => s.id);
  const result = swapSuggestion(visible, all, 'SELF:workout');
  check('No reserve candidates -> swap just removes the outgoing suggestion, nothing added', result.length === 2 && !result.includes('SELF:workout'));
}

// ============================================================
// Personalization Foundation V1 -- applyUserPriorities /
// resolvePrioritizedIntentionGroups (ordering only, pure).
// ============================================================
{
  check('USER_PRIORITY_GROUPS has exactly 6 entries', USER_PRIORITY_GROUPS.length === 6);
  check('USER_PRIORITY_GROUPS ids are all unique', new Set(USER_PRIORITY_GROUPS.map((g) => g.id)).size === 6);
}
{
  const groups = resolvePrioritizedIntentionGroups(['RELATIONSHIPS']);
  check('RELATIONSHIPS priority resolves to the people-oriented taxonomy groups', groups.has('RELATIONSHIPS') && groups.has('FAMILY') && groups.has('SOCIAL'));
}
{
  const groups = resolvePrioritizedIntentionGroups(['WORK']);
  check('WORK priority resolves to exactly {WORK}', groups.size === 1 && groups.has('WORK'));
}
{
  const groups = resolvePrioritizedIntentionGroups(['WELLBEING']);
  check('WELLBEING priority resolves to the SELF taxonomy group (reuse, not a new one)', groups.size === 1 && groups.has('SELF'));
}
{
  const groups = resolvePrioritizedIntentionGroups(['PERSONAL_GROWTH']);
  check('PERSONAL_GROWTH priority reuses WORK (Learning lives there, no dedicated growth group exists)', groups.size === 1 && groups.has('WORK'));
}
{
  const groups = resolvePrioritizedIntentionGroups(['ROUTINE']);
  check('ROUTINE priority resolves to the LIFE taxonomy group', groups.size === 1 && groups.has('LIFE'));
}
{
  check('No priorities selected -> empty prioritized-group set (a fully valid state)', resolvePrioritizedIntentionGroups([]).size === 0);
}
{
  const base: DailyIntentionGroupId[] = ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT', 'WORK'];
  check('Empty prioritized set -> applyUserPriorities is a no-op (same order back)', JSON.stringify(applyUserPriorities(base, new Set())) === JSON.stringify(base));

  const reordered = applyUserPriorities(base, new Set(['WORK', 'SELF']));
  check('Prioritized groups move to the front', reordered[0] === 'SELF' && reordered[1] === 'WORK');
  check('Prioritized groups keep THEIR OWN relative order from baseOrder (SELF before WORK in base, so SELF before WORK here too)', reordered.indexOf('SELF') < reordered.indexOf('WORK'));
  check('Non-prioritized groups keep their own relative order too, just pushed after', reordered.slice(2).join(',') === 'RELATIONSHIPS,FAMILY,SOCIAL,ENJOYMENT');
  check('applyUserPriorities never adds or removes a group -- same 6 groups, just reordered', new Set(reordered).size === 6 && base.every((g) => reordered.includes(g)));
}

// ============================================================
// Personalization Foundation V1 -- selectIntentionCandidates integration:
// priorities affect ORDERING only, and can NEVER override a mute (brief
// section 6's explicit ordering: dismissed -> muted -> priorities ->
// diversity -> timing engine).
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST, wide-open day
  const profile = buildDayProfile(agendaWithPlans([], now), 8 * 60);

  const withoutPriorities = selectIntentionCandidates(profile, new Set(), 5);
  const withWorkPriority = selectIntentionCandidates(profile, new Set(), 5, resolvePrioritizedIntentionGroups(['WORK']));
  check('Selected priorities change candidate ordering -- WORK moves to the front when prioritized', withWorkPriority[0]?.groupId === 'WORK');
  check('Without priorities, WORK is NOT first (evening-open day\'s own default order puts people-time first)', withoutPriorities[0]?.groupId !== 'WORK');
  check(
    'Priorities change ORDERING only -- the same set of candidate groups is produced either way (no group added/removed by prioritizing)',
    new Set(withoutPriorities.map((c) => c.groupId)).size === new Set(withWorkPriority.map((c) => c.groupId)).size
  );

  // Muted groups override positive priorities -- prioritizing WORK while
  // ALSO muting it must never resurrect it.
  const workMutedAndPrioritized = selectIntentionCandidates(profile, new Set(['WORK']), 5, resolvePrioritizedIntentionGroups(['WORK']));
  check('A muted group is never suggested even when it is also the user\'s #1 priority', !workMutedAndPrioritized.some((c) => c.groupId === 'WORK'));
}

// ============================================================
// Personalized Daily Story V2 -- buildDailyPriorityCoverage /
// coveredIntentionGroupIds (pure, no timing search involved).
// ============================================================
{
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  check('No priorities -> empty coverage array', buildDailyPriorityCoverage(agendaWithPlans([], now), []).length === 0);
}
{
  // Completed items count as covered.
  const now = new Date('2026-08-24T09:00:00.000Z'); // 2:30 PM IST
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Deep Work', status: 'LOGGED', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') })],
    now
  );
  const coverage = buildDailyPriorityCoverage(agenda, ['WORK']);
  check('A COMPLETED (LOGGED) item counts as covered', coverage[0]?.state === 'COVERED' && coverage[0]?.agendaItemIds.length === 1);
}
{
  // Cancelled/missed items do not falsely imply accomplishment.
  const now = new Date('2026-08-24T09:00:00.000Z'); // 2:30 PM IST -- after the plan's own end time, and never logged
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Deep Work', status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T03:00:00.000Z'), plannedEndAt: new Date('2026-08-24T04:00:00.000Z') })],
    now
  );
  const coverage = buildDailyPriorityCoverage(agenda, ['WORK']);
  check('A MISSED item (elapsed, never logged) is OPEN, never falsely COVERED', coverage[0]?.state === 'OPEN' && coverage[0]?.agendaItemIds.length === 0);
}
{
  // An UPCOMING (not-yet-happened) item still counts as "already made room for".
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST, plan is later today
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Dinner Date', status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T13:30:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z') })],
    now
  );
  const coverage = buildDailyPriorityCoverage(agenda, ['RELATIONSHIPS']);
  check('An UPCOMING (not yet happened) matching item still counts as covered', coverage[0]?.state === 'COVERED');
}
{
  const now = new Date('2026-08-24T02:30:00.000Z');
  const coverage = buildDailyPriorityCoverage(agendaWithPlans([], now), ['RELATIONSHIPS', 'WORK']);
  check('Nothing on the agenda -> every priority is OPEN', coverage.every((c) => c.state === 'OPEN'));
  check('coveredIntentionGroupIds of an all-OPEN coverage is empty', coveredIntentionGroupIds(coverage).size === 0);
}
{
  const now = new Date('2026-08-24T02:30:00.000Z');
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Dinner Date', status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T13:30:00.000Z'), plannedEndAt: new Date('2026-08-24T15:00:00.000Z') })],
    now
  );
  const coverage = buildDailyPriorityCoverage(agenda, ['RELATIONSHIPS']);
  const covered = coveredIntentionGroupIds(coverage);
  check('coveredIntentionGroupIds expands a covered UserPriorityGroup to its FULL taxonomy-group mapping', covered.has('RELATIONSHIPS') && covered.has('FAMILY') && covered.has('SOCIAL'));
}

// ============================================================
// Personalized Daily Story V2 -- applyUserPriorities with coveredGroupIds
// (brief section 6: "diversity, not exclusion").
// ============================================================
{
  const base: DailyIntentionGroupId[] = ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT', 'WORK'];
  const prioritized = new Set<DailyIntentionGroupId>(['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK']); // RELATIONSHIPS + WORK user priorities
  const covered = new Set<DailyIntentionGroupId>(['RELATIONSHIPS', 'FAMILY', 'SOCIAL']); // RELATIONSHIPS priority already covered (Date Night)
  const reordered = applyUserPriorities(base, prioritized, covered);
  check('An open prioritized group (WORK) still comes first', reordered[0] === 'WORK');
  check('A covered prioritized group (RELATIONSHIPS) is demoted below the unprioritized groups, not removed', reordered.includes('RELATIONSHIPS') && reordered.indexOf('SELF') < reordered.indexOf('RELATIONSHIPS'));
  check('Do not completely suppress the covered priority -- it is still present in the output', new Set(reordered).size === 6);
}
{
  // Zero coveredGroupIds -> identical to the pre-coverage applyUserPriorities behavior.
  const base: DailyIntentionGroupId[] = ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'SELF', 'ENJOYMENT', 'WORK'];
  const prioritized = new Set<DailyIntentionGroupId>(['WORK']);
  check('No coverage -> applyUserPriorities behaves exactly as before (backward compatible)', JSON.stringify(applyUserPriorities(base, prioritized)) === JSON.stringify(applyUserPriorities(base, prioritized, new Set())));
}

// ============================================================
// Personalized Daily Story V2 -- reasonForCandidate's isPrioritized
// branch (via selectIntentionCandidates) produces different, still
// deterministic, still non-repetitive-with-the-generic-case text.
// ============================================================
{
  // An evening-NOT-open day so WORK sits inside the top-5 candidate-attempt
  // cap regardless of prioritization (baseOrder without evening-open puts
  // WORK 3rd; on an evening-open day it's 6th/last and would otherwise be
  // excluded by the cap even before priority is considered, confounding
  // this specific comparison).
  const now = new Date('2026-08-24T02:30:00.000Z'); // 8:00 AM IST
  const agenda = agendaWithPlans(
    [plan({ id: 'p1', title: 'Dinner Date', status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T18:00:00.000Z'), plannedEndAt: new Date('2026-08-24T19:00:00.000Z') })],
    now
  );
  const profile = buildDayProfile(agenda, 8 * 60);
  check('Sanity: this agenda has evening NOT open', !profile.hasEveningOpen);
  const withoutPriority = selectIntentionCandidates(profile, new Set(), 5).find((c) => c.groupId === 'WORK');
  const withPriority = selectIntentionCandidates(profile, new Set(), 5, resolvePrioritizedIntentionGroups(['WORK'])).find((c) => c.groupId === 'WORK');
  check('A prioritized candidate gets different reason text than the generic one', Boolean(withoutPriority) && Boolean(withPriority) && withoutPriority!.reason !== withPriority!.reason);
  check('The personalized reason never spells out the internal group/priority name', !/WORK|UserPriorityGroup|DailyIntentionGroupId/.test(withPriority!.reason));
}

// ============================================================
// Home Compactness follow-up ("a date night or an evening walk shows time
// slots in the morning and afternoon") -- resolvePeopleContextTimePreference()
// is the ONE place the dual-context activity (walk-together) is resolved
// to EVENING or left unconstrained, keyed on the taxonomy GROUP the
// suggestion actually came from (not a blanket catalog-level default,
// which would also wrongly constrain SELF's own daytime "Walk").
// ============================================================
{
  check(
    '"walk-together", selected from a people-oriented group (RELATIONSHIPS/FAMILY/SOCIAL) -> EVENING',
    resolvePeopleContextTimePreference('walk-together', true) === 'EVENING'
  );
  check(
    '"walk-together", selected from SELF (not people-oriented) -> no override (undefined)',
    resolvePeopleContextTimePreference('walk-together', false) === undefined
  );
  check(
    'Any OTHER activityId, even if people-oriented, is untouched here -- it relies on its own catalog default instead',
    resolvePeopleContextTimePreference('dinner-date', true) === undefined && resolvePeopleContextTimePreference('coffee-tea', true) === undefined
  );
}

if (!allPassed) {
  console.error('\nSome Day Builder domain checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL DAY BUILDER DOMAIN CHECKS PASSED');
}
