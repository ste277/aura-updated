import { deriveAuraSuggestion } from '../apps/web/lib/auraSuggests';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { PersonalizedTask } from '../packages/recommendation/src/personalizedTasks';
import type { PlannedActivity, AuraMoment } from '../apps/web/lib/db';

/**
 * Home Recommendation Hierarchy V1 -- Aura Suggests must (a) prefer actual
 * agenda context over a second, disconnected catalog ranking, (b) never
 * recommend a catalog activity except in its one ACTIVITY_FALLBACK tier,
 * deduped by canonical activityId, and (c) hide entirely rather than
 * duplicate/repeat when it has nothing additive to say.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T05:00:00.000Z'); // 10:30 AM IST

function task(overrides: Partial<PersonalizedTask> = {}): PersonalizedTask {
  return {
    id: 'deep-work', title: 'Deep Work', description: 'Protect a focused block.', category: 'FOCUS',
    recommendedWindowTypes: ['NEUTRAL'], acceptableWindowTypes: ['NEUTRAL'], avoidWindowTypes: [],
    significance: 'HIGH', requiresFreshStart: false, aliases: ['deep work'], icon: '🧠',
    ...overrides,
  };
}

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1', userId: 'user-1', title: 'Learning', activityType: 'learning', icon: '📚',
    status: 'UPCOMING', plannedStartAt: new Date('2026-08-24T06:30:00.000Z'), plannedEndAt: new Date('2026-08-24T07:30:00.000Z'),
    durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  };
}

function moment(overrides: Partial<AuraMoment> = {}): AuraMoment {
  return {
    id: 'moment-1', ownerUserId: 'user-1', publicToken: 'tok', scope: 'SHARED', source: 'PLAN', activityId: 'date-night',
    activityTitle: 'Date Night', activityIcon: '❤️', startAt: new Date('2026-08-24T11:30:00.000Z'), endAt: new Date('2026-08-24T13:00:00.000Z'),
    timezone: TZ, savedPersonId: 'sp-1', sharedPersonDisplayName: 'Anu', senderDisplayName: 'Owner', ratingLabel: 'STRONG_SHARED_FIT',
    explanationSnapshot: null, status: 'ACTIVE', responseState: 'ACCEPTED', responsePreference: null, respondedAt: new Date('2026-08-24T01:00:00.000Z'),
    previousMomentId: null, plannedActivityId: null, ownerSeenResponseAt: null, firstOpenedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'), expiresAt: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof deriveAuraSuggestion>[0]> = {}): Parameters<typeof deriveAuraSuggestion>[0] {
  return {
    agenda: null,
    activeWindowName: 'NEUTRAL',
    currentWindowEndTime: undefined,
    personalizedTasks: [task()],
    goodRightNowActivityIds: new Set(),
    timeLeftBeforeNextShift: '',
    ...overrides,
  };
}

// ============================================================
// A. next Plan exists -> PREPARE_FOR_PLAN
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('A. An UPCOMING next Plan produces PREPARE_FOR_PLAN', result?.type === 'PREPARE_FOR_PLAN');
  check('A. Title reads "Prepare for Learning"', result?.title === 'Prepare for Learning');
  check('A. Carries the agendaItem for View routing (not log-now)', result?.agendaItem?.id === agenda.nextItem?.id);
  check('A. No activityId on an agenda-based suggestion', result?.activityId === undefined);
}

// ============================================================
// B. next accepted Moment exists -> PREPARE_FOR_MOMENT; a WAITING one
//    -> COORDINATION
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [moment()], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('B. A CONFIRMED Moment produces PREPARE_FOR_MOMENT', result?.type === 'PREPARE_FOR_MOMENT');
  check('B. Names the confirmed participant', result?.description.includes('Anu is confirmed') ?? false);
}
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [moment({ responseState: null, respondedAt: null })], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('B. A WAITING Moment produces COORDINATION', result?.type === 'COORDINATION');
}

// ============================================================
// STARTING_SOON / CURRENT items are NOT re-surfaced -- owned by the
// Starting Soon reminder card / the Right Now hero panel.
// ============================================================
{
  const soonPlan = plan({ plannedStartAt: new Date('2026-08-24T05:10:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }); // 10 min out
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [soonPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('nextItem is STARTING_SOON (sanity check on the fixture)', agenda.nextItem?.status === 'STARTING_SOON');
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('A STARTING_SOON item falls through instead of being repeated', result?.agendaItem === undefined);
}

// ============================================================
// C. meaningful free gap exists (nothing left on the agenda, but there was
//    a day) -> OPEN_GAP. Never auto-filled with another activity.
// ============================================================
{
  const pastPlan = plan({ id: 'plan-past', title: 'Morning Standup', plannedStartAt: new Date('2026-08-24T02:00:00.000Z'), plannedEndAt: new Date('2026-08-24T02:30:00.000Z'), status: 'LOGGED' });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [pastPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('nextItem is absent but the agenda has a completed item (sanity check)', agenda.nextItem === undefined && agenda.items.length > 0);
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('C. A day with nothing left ahead produces OPEN_GAP', result?.type === 'OPEN_GAP');
  check('C. No activity is recommended', result?.activityId === undefined);
}

// ============================================================
// D. caution context + a later agenda item -> CAUTION_CONTEXT (not
//    PREPARE_FOR_PLAN) -- this is the exact scenario that used to duplicate
//    Good Right Now (brief section 12's worked example).
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda, activeWindowName: 'RAHU_KALAM', currentWindowEndTime: '9:04 AM', personalizedTasks: [task({ id: 'task-5', title: 'Process Optimization & Docs' })], goodRightNowActivityIds: new Set(['task-5']) }));
  check('D. A caution window with a later Plan produces CAUTION_CONTEXT, not PREPARE_FOR_PLAN', result?.type === 'CAUTION_CONTEXT');
  check('D. References the next Plan by name', result?.description.includes('Learning') ?? false);
  check('D. References the window end time', result?.description.includes('9:04 AM') ?? false);
  check('D. No action -- brief section 7: "no action required"', result?.actionLabel === undefined);
  check('D. No activity is recommended (the root-cause fix)', result?.activityId === undefined);
}
{
  // Caution window, empty agenda -- still CAUTION_CONTEXT, day-only framing.
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, activeWindowName: 'RAHU_KALAM' }));
  check('D. Caution window with an empty agenda still produces CAUTION_CONTEXT', result?.type === 'CAUTION_CONTEXT');
}

// ============================================================
// E. no agenda-aware context -> generic ACTIVITY_FALLBACK, if additive
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work', title: 'Deep Work' }), task({ id: 'learning', title: 'Study', icon: '📖' })];
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, personalizedTasks: tasks, goodRightNowActivityIds: new Set(['deep-work']) }));
  check('E. No agenda context -> ACTIVITY_FALLBACK', result?.type === 'ACTIVITY_FALLBACK');
  check('E. The top task (already in Good Right Now by id) is skipped', result?.title === 'Study');
  check('E. Carries the canonical activityId', result?.activityId === 'learning');
}

// ============================================================
// F. no additive context at all -> null (hidden entirely)
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work' })];
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, personalizedTasks: tasks, goodRightNowActivityIds: new Set(['deep-work']) }));
  check('F. Nothing additive to say -> null (hidden, not duplicated)', result === null);
}

// ============================================================
// Dedup (canonical activityId only, never fuzzy title matching) --
// ACTIVITY_FALLBACK is the only tier this applies to, since it's the only
// tier that ever recommends an activity.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work', title: 'Deep Work' })];
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, personalizedTasks: tasks, goodRightNowActivityIds: new Set(['some-other-id']) }));
  check('Dedup: a task whose id is NOT in Good Right Now still surfaces, even with unrelated ids present', result?.title === 'Deep Work');
}
{
  // A task with the SAME display title as a Good Right Now card but a
  // DIFFERENT canonical id must still surface -- dedup is id-based only.
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'sprint-backlog-execution', title: 'Deep Work' })];
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, personalizedTasks: tasks, goodRightNowActivityIds: new Set(['deep-work']) }));
  check('Dedup: same display title but a different canonical id is NOT excluded (id-based, never fuzzy title matching)', result?.title === 'Deep Work' && result?.activityId === 'sprint-backlog-execution');
}

if (!allPassed) {
  console.error('\nSome Aura Suggests checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL AURA SUGGESTS CHECKS PASSED');
}
