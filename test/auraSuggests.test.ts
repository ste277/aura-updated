import { deriveAuraSuggestion } from '../apps/web/lib/auraSuggests';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { PersonalizedTask } from '../packages/recommendation/src/personalizedTasks';
import type { PlannedActivity, AuraMoment } from '../apps/web/lib/db';

/**
 * Product Journey / E2E Hardening V1 (brief section 14-17) -- Aura
 * Suggests must (a) prefer agenda context over a second, disconnected
 * catalog ranking, (b) never repeat a canonical activityId already shown
 * in Good Right Now, and (c) hide entirely rather than duplicate when it
 * has nothing additive to say.
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

// ============================================================
// Tier 1 -- prepare for an UPCOMING next agenda item
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion({ agenda, activeWindowName: 'NEUTRAL', personalizedTasks: [task()], goodRightNowActivityIds: new Set(), timeLeftBeforeNextShift: '' });
  check('An UPCOMING next Plan produces a "Prepare for" suggestion', result?.title === 'Prepare for Learning');
  check('The suggestion carries the agendaItem for View routing (not log-now)', result?.agendaItem?.id === agenda.nextItem?.id);
}

// ============================================================
// Tier 1 -- a CONFIRMED shared Moment gets "confirmed" phrasing
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [moment()], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion({ agenda, activeWindowName: 'NEUTRAL', personalizedTasks: [task()], goodRightNowActivityIds: new Set(), timeLeftBeforeNextShift: '' });
  check('A CONFIRMED Moment produces "confirmed" phrasing', result?.description.includes('confirmed for') ?? false);
}

// ============================================================
// STARTING_SOON / CURRENT items are NOT re-surfaced by Aura Suggests --
// those are already owned by the Starting Soon reminder card / the Right
// Now hero panel (brief section 19: avoid simultaneous "next" claims).
// ============================================================
{
  const soonPlan = plan({ plannedStartAt: new Date('2026-08-24T05:10:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }); // 10 min out
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [soonPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('nextItem is STARTING_SOON (sanity check on the fixture)', agenda.nextItem?.status === 'STARTING_SOON');
  const result = deriveAuraSuggestion({ agenda, activeWindowName: 'NEUTRAL', personalizedTasks: [task()], goodRightNowActivityIds: new Set(), timeLeftBeforeNextShift: '' });
  check('A STARTING_SOON item falls through to the generic tier instead of being repeated', result?.agendaItem === undefined);
}

// ============================================================
// Dedup (brief section 17): never repeat a canonical activityId already
// shown in Good Right Now, by id -- not by fuzzy title matching.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work', title: 'Deep Work' }), task({ id: 'learning', title: 'Study', icon: '📖' })];
  const result = deriveAuraSuggestion({ agenda: emptyAgenda, activeWindowName: 'NEUTRAL', personalizedTasks: tasks, goodRightNowActivityIds: new Set(['deep-work']), timeLeftBeforeNextShift: '' });
  check('The top task (already in Good Right Now by id) is skipped', result?.title === 'Study');
}
{
  // A DIFFERENT activity that merely shares similar display text must NOT
  // be treated as a duplicate -- dedup is by canonical id only.
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work', title: 'Deep Work' })];
  const result = deriveAuraSuggestion({ agenda: emptyAgenda, activeWindowName: 'NEUTRAL', personalizedTasks: tasks, goodRightNowActivityIds: new Set(['some-other-id']), timeLeftBeforeNextShift: '' });
  check('A task whose id is NOT in Good Right Now still surfaces, even with unrelated ids present', result?.title === 'Deep Work');
}

// ============================================================
// Hidden entirely (brief section 16) when every candidate task is already
// shown in Good Right Now and there's no agenda context or caution window.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const tasks = [task({ id: 'deep-work' })];
  const result = deriveAuraSuggestion({ agenda: emptyAgenda, activeWindowName: 'NEUTRAL', personalizedTasks: tasks, goodRightNowActivityIds: new Set(['deep-work']), timeLeftBeforeNextShift: '' });
  check('Nothing additive to say -> null (hidden entirely, not duplicated)', result === null);
}

// ============================================================
// Caution-window adjustment guidance (existing rule, reused verbatim) --
// takes priority over the generic dedup tier.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const lightTask = task({ id: 'hydration', title: 'Hydration Check', significance: 'LOW' });
  const result = deriveAuraSuggestion({ agenda: emptyAgenda, activeWindowName: 'RAHU_KALAM', personalizedTasks: [task(), lightTask], goodRightNowActivityIds: new Set(), timeLeftBeforeNextShift: '' });
  check('A caution window surfaces the LOW-significance task with low-stakes framing', result?.title === 'Hydration Check' && result?.description.includes('caution window'));
}

if (!allPassed) {
  console.error('\nSome Aura Suggests checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL AURA SUGGESTS CHECKS PASSED');
}
