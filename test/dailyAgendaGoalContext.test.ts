/**
 * Goals V2 G3.1 -- pure domain regression suite for goalContext threading
 * through buildDailyAgenda/planToAgendaItem (dailyAgenda.ts) and its
 * passthrough into HomeTimelineItem.metadata (homeTimelineComposer.ts). No
 * DB access -- see goalContextDb.test.ts for the live-Postgres batched
 * loader coverage.
 */
import { buildDailyAgenda, planToAgendaItem } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import type { PlannedActivity, PlanGoalContext } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';
const NOW = new Date('2026-08-24T12:00:00.000Z');

function plan(overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id: 'plan-1',
    userId: 'user-1',
    title: 'Read',
    activityType: null,
    icon: null,
    status: 'UPCOMING',
    plannedStartAt: new Date('2026-08-24T05:00:00.000Z'),
    plannedEndAt: new Date('2026-08-24T06:00:00.000Z'),
    durationMinutes: 60,
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
    activityId: null,
    schedulingMode: null,
    rescheduledFromPlanId: null,
    skippedAt: null,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    ...overrides,
  } as PlannedActivity;
}

function goalContext(overrides: Partial<PlanGoalContext> = {}): PlanGoalContext {
  return {
    goal: { id: 'goal-1', title: 'Read more' },
    goalActivity: { id: 'ga-1', completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } },
    currentValue: null,
    ...overrides,
  };
}

// ============================================================
// 27. non-Goal regression
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const item = agenda.items[0];
  check('27. non-Goal plan: existing fields unchanged (title/target)', item.title === 'Read' && item.target.id === 'plan-1');
  check('27. non-Goal plan: goalContext absent', item.goalContext === undefined);
}

// ============================================================
// Threading: goalContextsByPlanId -> DailyAgendaItem.goalContext
// ============================================================
{
  const ctx = goalContext({ currentValue: null });
  const agenda = buildDailyAgenda({
    now: NOW,
    localDate: LOCAL_DATE,
    timezone: TZ,
    plans: [plan()],
    moments: [],
    momentIdsWithSuccessor: new Set(),
    habitLogs: [],
    goalContextsByPlanId: new Map([['plan-1', ctx]]),
  });
  const item = agenda.items[0];
  check('goalContextsByPlanId threads onto the matching PLAN item', item.goalContext === ctx);
  check('goal identity present', item.goalContext?.goal.id === 'goal-1' && item.goalContext?.goal.title === 'Read more');
  check('goalActivity id present', item.goalContext?.goalActivity.id === 'ga-1');
}

// ============================================================
// 8. semantic distinction: target vs currentValue (before completion)
// ============================================================
{
  const ctx = goalContext({ goalActivity: { id: 'ga-2', completionRequirement: { kind: 'DURATION', targetValue: 30 } }, currentValue: null });
  const item = planToAgendaItem(plan({ id: 'plan-2' }), NOW, ctx);
  check('DURATION target = 30, currentValue = null (NOT 30) before completion -- target and actual are never collapsed', item.goalContext?.goalActivity.completionRequirement.targetValue === 30 && item.goalContext?.currentValue === null);
}

// ============================================================
// Map lookup keyed by plan id -- a plan NOT in the map gets no goalContext
// ============================================================
{
  const agenda = buildDailyAgenda({
    now: NOW,
    localDate: LOCAL_DATE,
    timezone: TZ,
    plans: [plan({ id: 'plan-a' }), plan({ id: 'plan-b', title: 'Unrelated' })],
    moments: [],
    momentIdsWithSuccessor: new Set(),
    habitLogs: [],
    goalContextsByPlanId: new Map([['plan-a', goalContext()]]),
  });
  const a = agenda.items.find((i) => i.target.id === 'plan-a')!;
  const b = agenda.items.find((i) => i.target.id === 'plan-b')!;
  check('plan-a (in the map) receives goalContext', a.goalContext !== undefined);
  check('plan-b (not in the map) has no goalContext', b.goalContext === undefined);
}

// ============================================================
// omitted goalContextsByPlanId entirely -- identical to an empty Map
// ============================================================
{
  const agenda = buildDailyAgenda({ now: NOW, localDate: LOCAL_DATE, timezone: TZ, plans: [plan()], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  check('omitting goalContextsByPlanId entirely behaves exactly like an empty map (no crash, no goalContext)', agenda.items[0].goalContext === undefined);
}

// ============================================================
// Home Timeline passthrough (metadata.goalContext), no rendering, no
// influence on rank/status/copy/icon
// ============================================================
{
  const ctx = goalContext();
  const agendaItem = planToAgendaItem(plan(), NOW, ctx);
  const timeline = buildHomeTimeline({ agenda: { localDate: LOCAL_DATE, timezone: TZ, items: [agendaItem], completedCount: 0, plannedCount: 1 }, currentMinuteOfDay: 630, timezone: TZ });
  const timelineItem = timeline.find((t) => t.id === agendaItem.id)!;
  check('HomeTimelineItem.metadata.goalContext is the SAME object, pure passthrough', timelineItem.metadata?.goalContext === ctx);
  check('goalContext does not affect status/icon/title', timelineItem.title === 'Read' && timelineItem.icon === null);
}
{
  // A non-Goal item alongside a Goal item -- goalContext must not leak or influence composition.
  const goalPlan = plan({ id: 'plan-goal' });
  const plainPlan = plan({ id: 'plan-plain', title: 'Plain', plannedStartAt: new Date('2026-08-24T06:30:00.000Z'), plannedEndAt: new Date('2026-08-24T07:00:00.000Z') });
  const ctx = goalContext();
  const items = [planToAgendaItem(goalPlan, NOW, ctx), planToAgendaItem(plainPlan, NOW)];
  const timeline = buildHomeTimeline({ agenda: { localDate: LOCAL_DATE, timezone: TZ, items, completedCount: 0, plannedCount: 2 }, currentMinuteOfDay: 630, timezone: TZ });
  const plainTimelineItem = timeline.find((t) => t.id === 'plan:plan-plain')!;
  check('a sibling non-Goal item never acquires goalContext from an unrelated Goal item in the same batch', plainTimelineItem.metadata?.goalContext === undefined);
}

if (!allPassed) {
  console.error('SOME DAILY AGENDA GOAL CONTEXT CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DAILY AGENDA GOAL CONTEXT CHECKS PASSED');
