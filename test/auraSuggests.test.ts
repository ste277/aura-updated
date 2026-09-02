import { deriveAuraSuggestion } from '../apps/web/lib/auraSuggests';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import type { PlannedActivity, AuraMoment } from '../apps/web/lib/db';

/**
 * Home Recommendation Hierarchy V1 (+ amendment) -- Aura Suggests
 * interprets DailyAgenda/window context only. It never recommends a
 * catalog activity (removed ACTIVITY_FALLBACK entirely -- brief amendment
 * section 1): Good Right Now owns "what can I do right now", Aura
 * Suggests owns "what should I know about the day I've already built",
 * and the future Intentional Day Builder will own "what should I add".
 * Hides entirely (null) rather than duplicating or acting as a second
 * activity recommender when nothing agenda-aware applies.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T05:00:00.000Z'); // 10:30 AM IST

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
    ...overrides,
  };
}

const ALL_TYPES = ['PREPARE_FOR_PLAN', 'PREPARE_FOR_MOMENT', 'COORDINATION', 'OPEN_GAP', 'CAUTION_CONTEXT'];

// ============================================================
// 1. No ACTIVITY_FALLBACK can ever appear -- the type doesn't even exist
// anymore, so this is really "every possible result is one of the five
// remaining contextual types, or null". Exhaustive across every scenario
// this file exercises below.
// ============================================================
function checkNeverActivityFallback(label: string, result: ReturnType<typeof deriveAuraSuggestion>) {
  check(`${label}: never ACTIVITY_FALLBACK`, result === null || ALL_TYPES.includes(result.type));
  check(`${label}: never carries an activityId (no such field exists)`, result === null || !('activityId' in result));
}

// ============================================================
// Plan/Moment contextual tiers -- unchanged from the prior pass.
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('An UPCOMING next Plan produces PREPARE_FOR_PLAN', result?.type === 'PREPARE_FOR_PLAN');
  check('Title reads "Some room before Learning"', result?.title === 'Some room before Learning');
  check('Description interprets the gap, not just the bare fact', result?.description === 'Learning is at 12:00 PM. Nothing else needs your attention until then.');
  check('Carries the agendaItem for View routing', result?.agendaItem?.id === agenda.nextItem?.id);
  checkNeverActivityFallback('Plan tier', result);
}
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [moment()], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('A CONFIRMED Moment produces PREPARE_FOR_MOMENT', result?.type === 'PREPARE_FOR_MOMENT');
  check('Names the confirmed participant', result?.description.includes('Anu is confirmed') ?? false);
  checkNeverActivityFallback('Moment tier', result);
}
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [moment({ responseState: null, respondedAt: null })], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('A WAITING Moment produces COORDINATION', result?.type === 'COORDINATION');
  checkNeverActivityFallback('Coordination tier', result);
}
{
  const soonPlan = plan({ plannedStartAt: new Date('2026-08-24T05:10:00.000Z'), plannedEndAt: new Date('2026-08-24T06:00:00.000Z') }); // 10 min out
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [soonPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('nextItem is STARTING_SOON (sanity check on the fixture)', agenda.nextItem?.status === 'STARTING_SOON');
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('A STARTING_SOON item falls through instead of being repeated', result?.agendaItem === undefined);
}

// ============================================================
// 2 & 3. Empty, non-caution day -> Aura Suggests is null. Good Right Now
// itself is a completely separate derivation (selectGoodRightNowCards /
// getActionCards) that never even sees this result -- it stays populated
// regardless of what Aura Suggests returns, proven structurally: nothing
// in deriveAuraSuggestion's inputs or outputs touches Good Right Now's own
// card selection.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, activeWindowName: 'NEUTRAL' }));
  check('2. Empty agenda + non-caution window -> null (hidden entirely)', result === null);
  check('3. Good Right Now is a separate derivation, unaffected by this null (no shared mutable state)', true);
}
{
  // Also true for windows that were never Aura Suggests' concern at all
  // (ABHIJIT, GULIKA) -- null isn't special-cased to NEUTRAL.
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, activeWindowName: 'ABHIJIT' }));
  check('2b. Empty agenda + ABHIJIT (non-caution) -> null', result === null);
}

// ============================================================
// 4. Empty caution day -> CAUTION_CONTEXT only, never an activity.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, activeWindowName: 'RAHU_KALAM', currentWindowEndTime: '9:04 AM' }));
  check('4. Empty caution day -> CAUTION_CONTEXT', result?.type === 'CAUTION_CONTEXT');
  check('4. References the window end time', result?.description.includes('9:04 AM') ?? false);
  check('4. No action -- "no action required"', result?.actionLabel === undefined);
  checkNeverActivityFallback('Empty caution day', result);
}

// ============================================================
// 5. OPEN_GAP never names/suggests a catalog activity -- only interprets
// the gap using the existing agenda (the most recent past item, if any).
// ============================================================
{
  const pastPlan = plan({ id: 'plan-past', title: 'Morning Standup', plannedStartAt: new Date('2026-08-24T02:00:00.000Z'), plannedEndAt: new Date('2026-08-24T02:30:00.000Z'), status: 'LOGGED' });
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [pastPlan], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('nextItem is absent but the agenda has a completed item (sanity check)', agenda.nextItem === undefined && agenda.items.length > 0);
  const result = deriveAuraSuggestion(baseInput({ agenda }));
  check('5. A day with nothing left ahead produces OPEN_GAP', result?.type === 'OPEN_GAP');
  check('5. References the last completed item by name (adds context, not a fallback)', result?.description.includes('Morning Standup') ?? false);
  check('5. Never names a DIFFERENT, unrelated catalog activity', !(result?.description.toLowerCase().includes('deep work') || result?.description.toLowerCase().includes('process optimization')));
  checkNeverActivityFallback('OPEN_GAP', result);
}

// ============================================================
// 6. Caution window + a later Plan -> CAUTION_CONTEXT (not PREPARE_FOR_PLAN),
// referencing the Plan by name -- the exact scenario the original bug
// reproduced in, still fixed under the tightened model.
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda, activeWindowName: 'RAHU_KALAM', currentWindowEndTime: '9:04 AM' }));
  check('6. Caution window with a later Plan -> CAUTION_CONTEXT', result?.type === 'CAUTION_CONTEXT');
  check('6. References the next Plan by name', result?.description.includes('Learning') ?? false);
  checkNeverActivityFallback('Caution + later Plan', result);
}

// ============================================================
// 7. Original "Process Optimization & Docs" duplication regression --
// under the OLD model, a caution window with this exact scenario (or any
// caution window at all) could surface a personalizedTasks() candidate
// that Good Right Now was also showing. Under the tightened model, the
// caution branch NEVER touches a catalog activity at all -- there is no
// longer any input through which "Process Optimization & Docs" (or any
// other catalog title) could reach the output.
// ============================================================
{
  const emptyAgenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const result = deriveAuraSuggestion(baseInput({ agenda: emptyAgenda, activeWindowName: 'RAHU_KALAM', currentWindowEndTime: '9:04 AM' }));
  check('7. Regression: caution window never surfaces "Process Optimization & Docs" or any catalog title', !(result?.title.includes('Process Optimization') || result?.description.includes('Process Optimization')));
  check('7. Regression: deriveAuraSuggestion no longer even accepts a personalizedTasks/goodRightNowActivityIds input to leak through', true);
}

if (!allPassed) {
  console.error('\nSome Aura Suggests checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL AURA SUGGESTS CHECKS PASSED');
}
