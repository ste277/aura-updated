import { buildHomeTimeline, mapTimingLabelToHomeStatus } from '../apps/web/lib/homeTimelineComposer';
import type { DailyAgenda, DailyAgendaItem } from '../apps/web/lib/dailyAgenda';
import type { DailyGuidanceContext, DailyGuidanceRecommendation } from '../packages/personal-intelligence/src/context';
import type { PersonalEvidenceRef } from '../packages/personal-intelligence/src/evidence';
import type { SelectedActivityMetadata } from '../apps/web/lib/dailyGuidanceTypes';
import type { HomeTimelineContextWindow } from '../apps/web/lib/homeTimelineTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const LOCAL_DATE = '2026-08-24';

// IST clock -> UTC ISO (IST = UTC+5:30), matching this repo's own established
// test convention (see test/dailyAgenda.test.ts's own literal-ISO-with-IST-
// comment style).
const IST = {
  '06:00': '2026-08-24T00:30:00.000Z',
  '07:00': '2026-08-24T01:30:00.000Z',
  '08:00': '2026-08-24T02:30:00.000Z',
  '08:30': '2026-08-24T03:00:00.000Z',
  '09:00': '2026-08-24T03:30:00.000Z',
  '09:30': '2026-08-24T04:00:00.000Z',
  '10:00': '2026-08-24T04:30:00.000Z',
  '10:30': '2026-08-24T05:00:00.000Z',
  '11:00': '2026-08-24T05:30:00.000Z',
  '12:00': '2026-08-24T06:30:00.000Z',
  '12:30': '2026-08-24T07:00:00.000Z',
  '13:00': '2026-08-24T07:30:00.000Z',
  '14:00': '2026-08-24T08:30:00.000Z',
  '15:00': '2026-08-24T09:30:00.000Z',
  '16:00': '2026-08-24T10:30:00.000Z',
  '17:00': '2026-08-24T11:30:00.000Z',
  '18:00': '2026-08-24T12:30:00.000Z',
  '18:30': '2026-08-24T13:00:00.000Z',
  '19:00': '2026-08-24T13:30:00.000Z',
} as const;

// IST clock -> minute-of-day, for currentMinuteOfDay / context-window inputs.
const MIN = {
  '06:00': 360,
  '07:00': 420,
  '08:00': 480,
  '08:20': 500,
  '08:30': 510,
  '09:00': 540,
  '10:00': 600,
  '10:30': 630,
  '11:00': 660,
  '11:40': 700,
  '12:00': 720,
  '12:30': 750,
  '13:00': 780,
  '14:00': 840,
  '15:00': 900,
  '15:30': 930,
  '18:00': 1080,
  '19:00': 1140,
  '20:00': 1200,
} as const;

function agendaItem(overrides: Partial<DailyAgendaItem> = {}): DailyAgendaItem {
  return {
    id: 'plan:default',
    type: 'PLAN',
    title: 'Untitled',
    icon: null,
    startAt: IST['09:00'],
    endAt: IST['10:00'],
    status: 'UPCOMING',
    durationMinutes: 60,
    target: { type: 'PLAN', id: 'default' },
    ...overrides,
  };
}

function dailyAgenda(items: DailyAgendaItem[]): DailyAgenda {
  return {
    localDate: LOCAL_DATE,
    timezone: TZ,
    items,
    completedCount: items.filter((i) => i.status === 'COMPLETED').length,
    plannedCount: items.filter((i) => i.type !== 'COMPLETED_ACTIVITY').length,
  };
}

function recommendation(overrides: Partial<DailyGuidanceRecommendation> = {}): DailyGuidanceRecommendation {
  return {
    rank: 1,
    activityFamily: 'WORK',
    personalRelevance: 'RELEVANT',
    relevantThemes: [],
    timing: { start: IST['09:00'], end: IST['10:00'], score: 7.5, label: 'GOOD', windowRank: 1 },
    selectionReason: 'PRIMARY_FLOOR_MET',
    evidence: [],
    ...overrides,
  };
}

function guidanceContext(recommendations: DailyGuidanceRecommendation[]): DailyGuidanceContext {
  return {
    engineVersion: 'test',
    selectionPolicyVersion: 'test',
    evaluationTime: IST['09:00'],
    recommendations,
    evidence: [],
  };
}

function selectedActivity(overrides: Partial<SelectedActivityMetadata> = {}): SelectedActivityMetadata {
  return {
    activityId: 'deep-work',
    title: 'Deep Work',
    source: 'PLAN',
    sourceEntityId: 'default',
    ...overrides,
  };
}

function contextWindow(overrides: Partial<HomeTimelineContextWindow> = {}): HomeTimelineContextWindow {
  return {
    label: 'Rahu Kalam',
    startMinute: MIN['12:00'],
    endMinute: MIN['13:00'],
    type: 'friction',
    ...overrides,
  };
}

// ============================================================
// 1. Agenda only
// ============================================================
{
  const plan = agendaItem({ id: 'plan:p1', type: 'PLAN', title: 'Deep Work', icon: '💼', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'p1' } });
  const moment = agendaItem({ id: 'moment:m1', type: 'MOMENT', title: 'Coffee with Reena', icon: '☕', startAt: IST['14:00'], endAt: IST['15:00'], target: { type: 'MOMENT', id: 'm1' } });
  const completed = agendaItem({ id: 'log:l1', type: 'COMPLETED_ACTIVITY', title: 'Workout', icon: '🏋️', startAt: IST['07:00'], endAt: undefined, status: 'COMPLETED', target: { type: 'HABIT_LOG', id: 'l1' } });

  // Deliberately NOT pre-sorted -- proves the composer's own chronological sort, not input order.
  const agenda = dailyAgenda([plan, moment, completed]);
  const result = buildHomeTimeline({ agenda, currentMinuteOfDay: MIN['20:00'], timezone: TZ });

  check('Agenda-only: 3 items produced', result.length === 3);
  check('Agenda-only: chronological order (Workout, Deep Work, Coffee)', result.map((i) => i.id).join(',') === 'log:l1,plan:p1,moment:m1');
  check('Agenda-only: ids preserved verbatim', result[1].id === 'plan:p1' && result[2].id === 'moment:m1');
  check('Agenda-only: PLAN/MOMENT are planned, COMPLETED_ACTIVITY is not', result[1].planned === true && result[2].planned === true && result[0].planned === false);
  check('Agenda-only: icon carried through', result[0].icon === '🏋️' && result[1].icon === '💼');
  check('Agenda-only: source mapping (PLAN/MOMENT/HABIT_LOG)', result[1].source === 'PLAN' && result[2].source === 'MOMENT' && result[0].source === 'HABIT_LOG');
}

// ============================================================
// 2 & 5. Guidance Plan join (merge-critical) + dedupe trust (exactly one row)
// ============================================================
{
  const plan = agendaItem({ id: 'plan:plan-1', title: 'Deep Work', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'plan-1' } });
  const agenda = dailyAgenda([plan]);
  const guidance = guidanceContext([
    recommendation({ rank: 1, activityFamily: 'WORK', personalRelevance: 'HIGHLY_RELEVANT', timing: { start: IST['09:00'], end: IST['10:00'], score: 8.2, label: 'EXCELLENT', windowRank: 1 } }),
  ]);
  const selectedActivities = { WORK: selectedActivity({ activityId: 'deep-work', sourceEntityId: 'plan-1' }) };

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Plan join: exactly one row (no second opportunity row fabricated)', result.length === 1);
  check('Plan join: rank attached', result[0].rank === 1);
  check('Plan join: status mapped from timing label', result[0].status === 'Best');
  check('Plan join: personalRelevance carried as metadata', result[0].metadata?.personalRelevance === 'HIGHLY_RELEVANT');
  check('Plan join: timingLabel/selectionReason carried', result[0].metadata?.timingLabel === 'EXCELLENT' && result[0].metadata?.selectionReason === 'PRIMARY_FLOOR_MET');
  check('Plan join: activityId carried', result[0].metadata?.activityId === 'deep-work');
  check('Plan join: still the original Plan id, kind, source', result[0].id === 'plan:plan-1' && result[0].kind === 'PLAN' && result[0].source === 'PLAN');
}

// ============================================================
// 3. Plan join is by sourceEntityId, never by title
// ============================================================
{
  const plan = agendaItem({ id: 'plan:plan-2', title: 'Deep Work', target: { type: 'PLAN', id: 'plan-2' } });
  const agenda = dailyAgenda([plan]);
  const guidance = guidanceContext([recommendation({ rank: 1, activityFamily: 'WORK' })]);
  // Same title ("Deep Work"), but sourceEntityId points at a DIFFERENT plan id.
  const selectedActivities = { WORK: selectedActivity({ title: 'Deep Work', sourceEntityId: 'plan-999' }) };

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Title-mismatch join: still exactly one row', result.length === 1);
  check('Title-mismatch join: no false annotation applied', result[0].rank === undefined && result[0].status === undefined);
}

// ============================================================
// 4. Day Builder opportunity row
// ============================================================
{
  const guidance = guidanceContext([
    recommendation({ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', timing: { start: IST['16:00'], end: IST['17:00'], score: 7.1, label: 'GOOD', windowRank: 1 } }),
  ]);
  const selectedActivities = { SELF: selectedActivity({ activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'suggestion-1' }) };

  const result = buildHomeTimeline({ guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Opportunity: one OPPORTUNITY row', result.length === 1 && result[0].kind === 'OPPORTUNITY');
  check('Opportunity: planned=false, source=DAY_BUILDER_INTENTION', result[0].planned === false && result[0].source === 'DAY_BUILDER_INTENTION');
  check('Opportunity: timing preserved verbatim', result[0].start === IST['16:00'] && result[0].end === IST['17:00']);
  check('Opportunity: title from selected activity metadata', result[0].title === 'Meditation');
  check('Opportunity: status mapped (GOOD -> Good)', result[0].status === 'Good');
  check('Opportunity: deterministic id from sourceEntityId', result[0].id === 'guidance:suggestion-1');
  check('Opportunity: primary action is Plan', result[0].primaryAction?.kind === 'PLAN_OPPORTUNITY');
}

// ============================================================
// 6. Same title, different activity -- never deduped by title
// ============================================================
{
  const yogaMorning = agendaItem({ id: 'plan:plan-a', title: 'Yoga', startAt: IST['08:00'], endAt: IST['08:30'], target: { type: 'PLAN', id: 'plan-a' } });
  const yogaEvening = agendaItem({ id: 'plan:plan-b', title: 'Yoga', startAt: IST['18:00'], endAt: IST['18:30'], target: { type: 'PLAN', id: 'plan-b' } });
  const agenda = dailyAgenda([yogaMorning, yogaEvening]);

  const result = buildHomeTimeline({ agenda, currentMinuteOfDay: MIN['08:20'], timezone: TZ });

  check('Same title, different activity: two distinct rows', result.length === 2);
  check('Same title, different activity: distinct ids preserved', result[0].id === 'plan:plan-a' && result[1].id === 'plan:plan-b');
}

// ============================================================
// 7. Same activityId, different Plans/times -- never collapsed
// ============================================================
{
  const early = agendaItem({ id: 'plan:plan-x', title: 'Deep Work', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'plan-x' } });
  const late = agendaItem({ id: 'plan:plan-y', title: 'Deep Work (evening)', startAt: IST['15:00'], endAt: IST['16:00'], target: { type: 'PLAN', id: 'plan-y' } });
  const agenda = dailyAgenda([early, late]);
  const guidance = guidanceContext([
    recommendation({ rank: 1, activityFamily: 'WORK', timing: { start: IST['09:00'], end: IST['10:00'], score: 7, label: 'GOOD', windowRank: 1 } }),
    recommendation({ rank: 2, activityFamily: 'SELF', timing: { start: IST['15:00'], end: IST['16:00'], score: 6.5, label: 'GOOD', windowRank: 1 } }),
  ]);
  const selectedActivities = {
    WORK: selectedActivity({ activityId: 'deep-work', sourceEntityId: 'plan-x' }),
    SELF: selectedActivity({ activityId: 'deep-work', title: 'Deep Work (evening)', sourceEntityId: 'plan-y' }),
  };

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Same activityId, different Plans: two rows, not collapsed', result.length === 2);
  check('Same activityId, different Plans: both carry activityId independently', result[0].metadata?.activityId === 'deep-work' && result[1].metadata?.activityId === 'deep-work');
  check('Same activityId, different Plans: each annotated by its own recommendation', result[0].rank === 1 && result[1].rank === 2);
}

// ============================================================
// 8. Guidance rank never controls chronological sort
// ============================================================
{
  const morningPlan = agendaItem({ id: 'plan:plan-early', title: 'Deep Work', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'plan-early' } });
  const agenda = dailyAgenda([morningPlan]);
  const guidance = guidanceContext([
    recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['15:00'], end: IST['16:00'], score: 8, label: 'EXCELLENT', windowRank: 1 } }),
  ]);
  const selectedActivities = { SELF: selectedActivity({ activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'suggestion-2' }) };

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Rank vs chronology: 9 AM item appears before the rank-1 3 PM opportunity', result.length === 2 && result[0].title === 'Deep Work' && result[1].kind === 'OPPORTUNITY');
}

// ============================================================
// 9. Status mapping, exhaustive
// ============================================================
{
  check('Status mapping: EXCELLENT -> Best', mapTimingLabelToHomeStatus('EXCELLENT') === 'Best');
  check('Status mapping: VERY_GOOD -> Best', mapTimingLabelToHomeStatus('VERY_GOOD') === 'Best');
  check('Status mapping: GOOD -> Good', mapTimingLabelToHomeStatus('GOOD') === 'Good');
  check('Status mapping: USABLE -> Workable', mapTimingLabelToHomeStatus('USABLE') === 'Workable');
  check('Status mapping: CAUTION -> Caution', mapTimingLabelToHomeStatus('CAUTION') === 'Caution');
  check('Status mapping: unrecognized label -> undefined', mapTimingLabelToHomeStatus('SOMETHING_NEW') === undefined);
  check('Status mapping: never exposes personal-relevance/behavioral vocabulary', mapTimingLabelToHomeStatus('HIGHLY_RELEVANT') === undefined && mapTimingLabelToHomeStatus('STRONG') === undefined);
}

// ============================================================
// 10 & 11. Guidance null / guidance empty -- agenda unaffected
// ============================================================
{
  const plan = agendaItem({ id: 'plan:p10', target: { type: 'PLAN', id: 'p10' } });
  const agenda = dailyAgenda([plan]);

  const withNull = buildHomeTimeline({ agenda, guidance: null, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  check('Guidance null: agenda renders unchanged', withNull.length === 1 && withNull[0].id === 'plan:p10' && withNull[0].rank === undefined);

  const withEmpty = buildHomeTimeline({ agenda, guidance: guidanceContext([]), currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  check('Guidance empty: agenda renders unchanged, no opportunities', withEmpty.length === 1 && withEmpty[0].id === 'plan:p10');
}

// ============================================================
// 12. Agenda null -- unscheduled opportunities still render
// ============================================================
{
  const guidance = guidanceContext([recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['16:00'], end: IST['17:00'], score: 7, label: 'GOOD', windowRank: 1 } })]);
  const selectedActivities = { SELF: selectedActivity({ source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'suggestion-3' }) };

  const result = buildHomeTimeline({ agenda: null, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Agenda null: opportunity still renders', result.length === 1 && result[0].kind === 'OPPORTUNITY');

  // A PLAN-sourced recommendation with agenda=null has nothing to
  // annotate -- it must be silently dropped, NEVER converted into an
  // opportunity row just because a Day-Builder-sourced sibling recommendation
  // is currently the only path that produces one.
  const planSourced = guidanceContext([recommendation({ rank: 1, activityFamily: 'WORK', timing: { start: IST['09:00'], end: IST['10:00'], score: 8, label: 'EXCELLENT', windowRank: 1 } })]);
  const planSourcedActivities = { WORK: selectedActivity({ source: 'PLAN', sourceEntityId: 'plan-with-no-agenda' }) };
  const planSourcedResult = buildHomeTimeline({ agenda: null, guidance: planSourced, selectedActivities: planSourcedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  check('Agenda null: a PLAN-sourced recommendation is dropped, never converted into an opportunity', planSourcedResult.length === 0);
}

// ============================================================
// 13. All inputs empty/null -- []
// ============================================================
{
  const result = buildHomeTimeline({ agenda: null, guidance: null, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  check('All empty: returns []', Array.isArray(result) && result.length === 0);
}

// ============================================================
// 14. Partial degradation -- agenda + context, guidance null
// ============================================================
{
  const plan = agendaItem({ id: 'plan:p14', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'p14' } });
  const agenda = dailyAgenda([plan]);
  const windows = [contextWindow({ startMinute: MIN['12:00'], endMinute: MIN['13:00'] })];

  let threw = false;
  let result: ReturnType<typeof buildHomeTimeline> = [];
  try {
    result = buildHomeTimeline({ agenda, guidance: null, timelineWindows: windows, currentMinuteOfDay: MIN['12:30'], timezone: TZ });
  } catch {
    threw = true;
  }

  check('Partial degradation: no exception', !threw);
  check('Partial degradation: agenda + context both render', result.length === 2 && result.some((i) => i.kind === 'PLAN') && result.some((i) => i.kind === 'CONTEXT_WINDOW'));
}

// ============================================================
// 15. Context: active + nearest future only
// ============================================================
{
  const neutral = contextWindow({ label: 'Neutral Flow', startMinute: MIN['11:00'], endMinute: MIN['13:00'], type: 'neutral' });
  const activeFriction = contextWindow({ label: 'Rahu Kalam', startMinute: MIN['10:00'], endMinute: MIN['11:00'], type: 'friction' });
  const futureAuspicious = contextWindow({ label: 'Abhijit', startMinute: MIN['13:00'], endMinute: MIN['14:00'], type: 'auspicious' });
  const laterFriction = contextWindow({ label: 'Yama Gandam', startMinute: MIN['18:00'], endMinute: MIN['19:00'], type: 'friction' });

  const result = buildHomeTimeline({
    agenda: null,
    localDate: LOCAL_DATE,
    timelineWindows: [neutral, activeFriction, futureAuspicious, laterFriction],
    currentMinuteOfDay: MIN['10:30'],
    timezone: TZ,
  });

  check('Context active: exactly 2 context items', result.length === 2 && result.every((i) => i.kind === 'CONTEXT_WINDOW'));
  check('Context active: active friction included', result.some((i) => i.title === 'Rahu Kalam'));
  check('Context active: nearest future auspicious included', result.some((i) => i.title === 'Abhijit'));
  check('Context active: neutral excluded', !result.some((i) => i.title === 'Neutral Flow'));
  check('Context active: later friction excluded (not nearest)', !result.some((i) => i.title === 'Yama Gandam'));
}

// ============================================================
// 16. Context: future only (no active window)
// ============================================================
{
  const futureAuspicious = contextWindow({ label: 'Abhijit', startMinute: MIN['13:00'], endMinute: MIN['14:00'], type: 'auspicious' });
  const laterFriction = contextWindow({ label: 'Yama Gandam', startMinute: MIN['18:00'], endMinute: MIN['19:00'], type: 'friction' });

  const result = buildHomeTimeline({
    agenda: null,
    localDate: LOCAL_DATE,
    timelineWindows: [futureAuspicious, laterFriction],
    currentMinuteOfDay: MIN['08:20'],
    timezone: TZ,
  });

  check('Context future-only: exactly 1 context item (nearest future)', result.length === 1 && result[0].title === 'Abhijit');
}

// ============================================================
// 17. Context: past windows omitted
// ============================================================
{
  const pastFriction = contextWindow({ label: 'Brahma Muhurta', startMinute: MIN['06:00'], endMinute: MIN['07:00'], type: 'friction' });

  const result = buildHomeTimeline({
    agenda: null,
    localDate: LOCAL_DATE,
    timelineWindows: [pastFriction],
    currentMinuteOfDay: MIN['15:00'],
    timezone: TZ,
  });

  check('Context past: past window omitted entirely', result.length === 0);
}

// ============================================================
// 18. Same-start tie-break: Plan > Moment > Opportunity > Context
// ============================================================
{
  const plan = agendaItem({ id: 'plan:tie', type: 'PLAN', startAt: IST['12:00'], endAt: IST['12:30'], target: { type: 'PLAN', id: 'tie-plan' } });
  const moment = agendaItem({ id: 'moment:tie', type: 'MOMENT', startAt: IST['12:00'], endAt: IST['12:30'], target: { type: 'MOMENT', id: 'tie-moment' } });
  const agenda = dailyAgenda([plan, moment]);
  const guidance = guidanceContext([recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['12:00'], end: IST['12:30'], score: 6, label: 'GOOD', windowRank: 1 } })]);
  const selectedActivities = { SELF: selectedActivity({ source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'tie-opportunity' }) };
  const windows = [contextWindow({ label: 'Tie Context', startMinute: MIN['12:00'], endMinute: MIN['12:30'], type: 'friction' })];

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, timelineWindows: windows, localDate: LOCAL_DATE, currentMinuteOfDay: MIN['11:40'], timezone: TZ });

  check('Same start: 4 items produced', result.length === 4);
  check('Same start: deterministic order Plan, Moment, Opportunity, Context', result.map((i) => i.kind).join(',') === 'PLAN,MOMENT,OPPORTUNITY,CONTEXT_WINDOW');
}

// ============================================================
// 19. Input immutability
// ============================================================
{
  // Every individual object is frozen too (not just the outer arrays) --
  // proves no nested-field mutation either (e.g. the composer must never
  // write `agendaItem.status = ...`/similar in place).
  const late = Object.freeze(agendaItem({ id: 'plan:late', startAt: IST['15:00'], endAt: IST['16:00'], target: { type: 'PLAN', id: 'late' } }));
  const early = Object.freeze(agendaItem({ id: 'plan:early', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'early' } }));
  // Deliberately out of chronological order, then frozen -- if the composer
  // ever called .sort()/.reverse() on the caller's own array in place, this
  // throws (a frozen array's elements cannot be reassigned).
  const items = Object.freeze([late, early]) as unknown as DailyAgendaItem[];
  const agenda: DailyAgenda = Object.freeze({ localDate: LOCAL_DATE, timezone: TZ, items, completedCount: 0, plannedCount: 2 }) as DailyAgenda;
  const recommendations = Object.freeze([
    Object.freeze(recommendation({ rank: 1 })),
    Object.freeze(recommendation({ rank: 2, activityFamily: 'SELF' })),
  ]) as unknown as DailyGuidanceRecommendation[];
  const guidance: DailyGuidanceContext = Object.freeze({ ...guidanceContext(recommendations as DailyGuidanceRecommendation[]) }) as DailyGuidanceContext;
  const windows = Object.freeze([
    Object.freeze(contextWindow()),
    Object.freeze(contextWindow({ startMinute: MIN['18:00'], endMinute: MIN['19:00'] })),
  ]) as unknown as HomeTimelineContextWindow[];

  let threw = false;
  try {
    buildHomeTimeline({ agenda, guidance, selectedActivities: { WORK: selectedActivity({ sourceEntityId: 'early' }), SELF: selectedActivity({ sourceEntityId: 'late' }) }, timelineWindows: windows, localDate: LOCAL_DATE, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  } catch {
    threw = true;
  }

  check('Immutability: frozen inputs (arrays and every individual object) never mutated (no exception)', !threw);
  check('Immutability: frozen agenda.items order unchanged after call', agenda.items[0].id === 'plan:late' && agenda.items[1].id === 'plan:early');
  check('Immutability: frozen agenda item fields unchanged after call', early.status === 'UPCOMING' && late.status === 'UPCOMING');
}

// ============================================================
// 20. Opportunity limit -- top 3 by rank
// ============================================================
{
  const guidance = guidanceContext([
    recommendation({ rank: 3, activityFamily: 'A', timing: { start: IST['09:00'], end: IST['10:00'], score: 6, label: 'GOOD', windowRank: 1 } }),
    recommendation({ rank: 1, activityFamily: 'B', timing: { start: IST['10:00'], end: IST['10:30'], score: 8, label: 'EXCELLENT', windowRank: 1 } }),
    recommendation({ rank: 4, activityFamily: 'C', timing: { start: IST['12:00'], end: IST['12:30'], score: 5, label: 'GOOD', windowRank: 1 } }),
    recommendation({ rank: 2, activityFamily: 'D', timing: { start: IST['13:00'], end: IST['14:00'], score: 7, label: 'GOOD', windowRank: 1 } }),
  ]);
  const selectedActivities = {
    A: selectedActivity({ title: 'A', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'sug-a' }),
    B: selectedActivity({ title: 'B', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'sug-b' }),
    C: selectedActivity({ title: 'C', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'sug-c' }),
    D: selectedActivity({ title: 'D', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'sug-d' }),
  };

  const result = buildHomeTimeline({ guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Opportunity limit: only 3 of 4 rendered', result.length === 3);
  check('Opportunity limit: ranks 1, 2, 3 kept; rank 4 dropped', !result.some((i) => i.title === 'C') && result.some((i) => i.title === 'A') && result.some((i) => i.title === 'B') && result.some((i) => i.title === 'D'));
  // Proves rank-selection-then-chronology, not chronology-then-truncation:
  // A (rank 3, 9 AM), B (rank 1, 10 AM), D (rank 2, 1 PM) survive the cap in
  // RANK order, but the final timeline is still chronological (A, B, D).
  check('Opportunity limit: survivors are still composed chronologically after the rank cap', result.map((i) => i.title).join(',') === 'A,B,D');
}

// ============================================================
// 21. Context limit -- at most 2 total even with many relevant windows
// ============================================================
{
  const active = contextWindow({ label: 'Active', startMinute: MIN['10:00'], endMinute: MIN['11:00'], type: 'friction' });
  const future1 = contextWindow({ label: 'Nearest Future', startMinute: MIN['13:00'], endMinute: MIN['14:00'], type: 'auspicious' });
  const future2 = contextWindow({ label: 'Farther Future A', startMinute: MIN['15:30'], endMinute: MIN['18:00'], type: 'friction' });
  const future3 = contextWindow({ label: 'Farther Future B', startMinute: MIN['18:00'], endMinute: MIN['19:00'], type: 'auspicious' });

  const result = buildHomeTimeline({ agenda: null, localDate: LOCAL_DATE, timelineWindows: [active, future1, future2, future3], currentMinuteOfDay: MIN['10:30'], timezone: TZ });

  check('Context limit: at most 2 context items regardless of input count', result.length === 2);
  check('Context limit: only the nearest future window among several is kept', result.some((i) => i.title === 'Nearest Future') && !result.some((i) => i.title === 'Farther Future A') && !result.some((i) => i.title === 'Farther Future B'));
}

// ============================================================
// 22. Current / past / future classification
// ============================================================
{
  const currentItem = agendaItem({ id: 'plan:current', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'current' } });
  const pastItem = agendaItem({ id: 'plan:past', startAt: IST['06:00'], endAt: IST['07:00'], target: { type: 'PLAN', id: 'past' } });
  const futureItem = agendaItem({ id: 'plan:future', startAt: IST['15:00'], endAt: IST['16:00'], target: { type: 'PLAN', id: 'future' } });
  const agenda = dailyAgenda([currentItem, pastItem, futureItem]);

  const result = buildHomeTimeline({ agenda, currentMinuteOfDay: MIN['09:00'], timezone: TZ });
  const current = result.find((i) => i.id === 'plan:current');
  const past = result.find((i) => i.id === 'plan:past');
  const future = result.find((i) => i.id === 'plan:future');

  check('Classification: item spanning current minute -> isCurrent', current?.metadata?.isCurrent === true && current?.metadata?.isPast === false);
  check('Classification: past item -> isPast', past?.metadata?.isPast === true && past?.metadata?.isCurrent === false);
  check('Classification: future item -> neither', future?.metadata?.isCurrent === false && future?.metadata?.isPast === false);
}

// ============================================================
// 23. Defensive: multiple recommendations resolve to the same Plan
// ============================================================
{
  const plan = agendaItem({ id: 'plan:shared', target: { type: 'PLAN', id: 'shared' } });
  const agenda = dailyAgenda([plan]);
  const guidance = guidanceContext([
    recommendation({ rank: 2, activityFamily: 'WORK', timing: { start: IST['09:00'], end: IST['10:00'], score: 6, label: 'GOOD', windowRank: 1 } }),
    recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['09:00'], end: IST['10:00'], score: 9, label: 'EXCELLENT', windowRank: 1 } }),
  ]);
  const selectedActivities = {
    WORK: selectedActivity({ sourceEntityId: 'shared' }),
    SELF: selectedActivity({ sourceEntityId: 'shared' }),
  };

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Defensive multi-match: exactly one row', result.length === 1);
  check('Defensive multi-match: lowest rank wins', result[0].rank === 1 && result[0].status === 'Best');

  // Same fixture, array order reversed (rank 1 now first) -- proves the
  // outcome is order-independent, not an artifact of iteration order.
  const guidanceReversed = guidanceContext([
    recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['09:00'], end: IST['10:00'], score: 9, label: 'EXCELLENT', windowRank: 1 } }),
    recommendation({ rank: 2, activityFamily: 'WORK', timing: { start: IST['09:00'], end: IST['10:00'], score: 6, label: 'GOOD', windowRank: 1 } }),
  ]);
  const resultReversed = buildHomeTimeline({ agenda, guidance: guidanceReversed, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  check('Defensive multi-match: lowest rank wins regardless of input array order', resultReversed.length === 1 && resultReversed[0].rank === 1 && resultReversed[0].status === 'Best');
}

// ============================================================
// 24. No raw score/evidence leakage -- input genuinely carries both
// ============================================================
{
  const realEvidence: PersonalEvidenceRef[] = [{ source: 'DAILY_GUIDANCE', ruleId: 'primary-floor-met', ruleVersion: 'v1', summary: 'Selected via primary floor.' }];
  const guidance = guidanceContext([
    recommendation({
      rank: 1,
      activityFamily: 'SELF',
      timing: { start: IST['16:00'], end: IST['17:00'], score: 9.9, label: 'EXCELLENT', windowRank: 1 },
      evidence: realEvidence,
    }),
  ]);
  const selectedActivities = { SELF: selectedActivity({ source: 'DAY_BUILDER_INTENTION', sourceEntityId: 'sug-safe' }) };
  const plan = agendaItem({ id: 'plan:safe', target: { type: 'PLAN', id: 'safe' } });
  const agenda = dailyAgenda([plan]);
  const guidancePlanJoin = guidanceContext([recommendation({ rank: 1, activityFamily: 'WORK', timing: { start: IST['09:00'], end: IST['10:00'], score: 9.9, label: 'EXCELLENT', windowRank: 1 }, evidence: realEvidence })]);
  const selectedActivitiesPlan = { WORK: selectedActivity({ sourceEntityId: 'safe' }) };

  const opportunityResult = buildHomeTimeline({ guidance, selectedActivities, currentMinuteOfDay: MIN['08:00'], timezone: TZ });
  const planResult = buildHomeTimeline({ agenda, guidance: guidancePlanJoin, selectedActivities: selectedActivitiesPlan, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  const leaks = (items: typeof opportunityResult) => items.some((item) => 'score' in item || 'evidence' in item || (item.metadata ? 'score' in item.metadata || 'evidence' in item.metadata : false));
  check('No raw score/evidence leakage: opportunity row (input genuinely carried both)', !leaks(opportunityResult));
  check('No raw score/evidence leakage: Plan-annotated row (input genuinely carried both)', !leaks(planResult));
  check('No raw score/evidence leakage: timingLabel IS carried (product-safe, Why Aura already consumes it)', opportunityResult[0]?.metadata?.timingLabel === 'EXCELLENT');
}

// ============================================================
// 25. Fail-closed: selectedActivities missing the recommended family
// ============================================================
{
  // Day Builder-sourced recommendation, but no selectedActivities entry at
  // all for its family -- source/identity cannot be determined.
  const guidance = guidanceContext([recommendation({ rank: 1, activityFamily: 'SELF', timing: { start: IST['16:00'], end: IST['17:00'], score: 7, label: 'GOOD', windowRank: 1 } })]);
  const plan = agendaItem({ id: 'plan:fc', target: { type: 'PLAN', id: 'fc' } });
  const agenda = dailyAgenda([plan]);

  const result = buildHomeTimeline({ agenda, guidance, selectedActivities: {}, currentMinuteOfDay: MIN['08:00'], timezone: TZ });

  check('Fail-closed: missing selectedActivities entry -- no exception', result.length === 1);
  check('Fail-closed: the unrelated agenda Plan renders unannotated (no fabricated opportunity, no false Plan join)', result[0].id === 'plan:fc' && result[0].rank === undefined);
}

// ============================================================
// 26. Lifecycle completion overrides temporal current/past classification
// ============================================================
{
  // A Plan logged (COMPLETED) at 09:20, while its own nominal 09:00-10:00
  // window still temporally contains "now" (09:45) -- must never read as
  // currently active.
  const completedEarly = agendaItem({ id: 'plan:completed-early', status: 'COMPLETED', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'completed-early' } });
  // A MISSED Plan (elapsed, unlogged) -- must read as past, not current.
  const missed = agendaItem({ id: 'plan:missed', status: 'MISSED', startAt: IST['09:00'], endAt: IST['10:00'], target: { type: 'PLAN', id: 'missed' } });
  const agenda = dailyAgenda([completedEarly, missed]);

  const result = buildHomeTimeline({ agenda, currentMinuteOfDay: 585 /* 09:45 IST, inside both items' nominal window */, timezone: TZ });
  const completedItem = result.find((i) => i.id === 'plan:completed-early');
  const missedItem = result.find((i) => i.id === 'plan:missed');

  check('Lifecycle override: COMPLETED item never reads isCurrent despite temporal overlap', completedItem?.metadata?.isCurrent === false && completedItem?.metadata?.isPast === true);
  check('Lifecycle override: MISSED item never reads isCurrent despite temporal overlap', missedItem?.metadata?.isCurrent === false && missedItem?.metadata?.isPast === true);
  check('Lifecycle override: agendaStatus itself is preserved verbatim, not overwritten', completedItem?.metadata?.agendaStatus === 'COMPLETED' && missedItem?.metadata?.agendaStatus === 'MISSED');
}

// ============================================================
// 27. Context status: friction -> Caution, auspicious -> undefined (not "Best"/"Good")
// ============================================================
{
  const activeFriction = contextWindow({ label: 'Rahu Kalam', startMinute: MIN['10:00'], endMinute: MIN['11:00'], type: 'friction' });
  const futureAuspicious = contextWindow({ label: 'Abhijit', startMinute: MIN['13:00'], endMinute: MIN['14:00'], type: 'auspicious' });

  const result = buildHomeTimeline({ agenda: null, localDate: LOCAL_DATE, timelineWindows: [activeFriction, futureAuspicious], currentMinuteOfDay: MIN['10:30'], timezone: TZ });
  const friction = result.find((i) => i.title === 'Rahu Kalam');
  const auspicious = result.find((i) => i.title === 'Abhijit');

  check('Context status: friction -> Caution', friction?.status === 'Caution');
  check('Context status: auspicious carries no status (never Good/Best -- context is not a recommendation)', auspicious?.status === undefined);
}

// ============================================================
// 28. Context boundary: now == start is active (inclusive); now == end is not (exclusive)
// ============================================================
{
  const window = contextWindow({ label: 'Boundary Window', startMinute: MIN['10:00'], endMinute: MIN['11:00'], type: 'friction' });

  const atStart = buildHomeTimeline({ agenda: null, localDate: LOCAL_DATE, timelineWindows: [window], currentMinuteOfDay: MIN['10:00'], timezone: TZ });
  const atEnd = buildHomeTimeline({ agenda: null, localDate: LOCAL_DATE, timelineWindows: [window], currentMinuteOfDay: MIN['11:00'], timezone: TZ });

  check('Context boundary: now == start is active (inclusive)', atStart.length === 1 && atStart[0].title === 'Boundary Window');
  check('Context boundary: now == end is no longer active (exclusive) and has no later window to be "future" either', atEnd.length === 0);
}

// ============================================================
// 29. Timezone delegation: America/New_York, across a real DST transition
// ============================================================
{
  const NY = 'America/New_York';
  // US DST began 2026-03-08 at 2:00 AM local. EST (UTC-5) the day before,
  // EDT (UTC-4) the day after -- 9:00 AM local is a DIFFERENT UTC instant
  // on each side, but must classify to the identical local minute-of-day.
  const beforeDst = agendaItem({ id: 'plan:pre-dst', startAt: '2026-03-07T14:00:00.000Z' /* 9:00 AM EST */, endAt: '2026-03-07T15:00:00.000Z', target: { type: 'PLAN', id: 'pre-dst' } });
  const afterDst = agendaItem({ id: 'plan:post-dst', startAt: '2026-03-09T13:00:00.000Z' /* 9:00 AM EDT */, endAt: '2026-03-09T14:00:00.000Z', target: { type: 'PLAN', id: 'post-dst' } });

  const beforeResult = buildHomeTimeline({ agenda: dailyAgenda([beforeDst]), currentMinuteOfDay: 540 /* 9:00 AM local */, timezone: NY });
  const afterResult = buildHomeTimeline({ agenda: dailyAgenda([afterDst]), currentMinuteOfDay: 540, timezone: NY });

  check('Timezone/DST: pre-transition 9 AM EST classifies as current at local minute 540', beforeResult[0]?.metadata?.isCurrent === true);
  check('Timezone/DST: post-transition 9 AM EDT classifies as current at local minute 540 too', afterResult[0]?.metadata?.isCurrent === true);

  // Context-window round trip (localDateTimeToUTC) on the transition day
  // itself, well clear of the skipped 2-3 AM hour.
  const nyWindow = contextWindow({ label: 'NY Context', startMinute: MIN['10:00'], endMinute: MIN['11:00'], type: 'friction' });
  const nyContextResult = buildHomeTimeline({ agenda: null, localDate: '2026-03-08', timelineWindows: [nyWindow], currentMinuteOfDay: MIN['10:30'], timezone: NY });
  check('Timezone/DST: context window round-trips through localDateTimeToUTC correctly on the transition day', nyContextResult.length === 1 && nyContextResult[0].title === 'NY Context');
  // 10:00 AM EDT on 2026-03-08 is UTC 14:00 -- confirms no manual/incorrect offset math snuck in.
  check('Timezone/DST: emitted ISO start is the correct EDT-adjusted UTC instant', nyContextResult[0].start === '2026-03-08T14:00:00.000Z');
}

if (!allPassed) {
  console.error('\nSome Home Timeline Composer checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL HOME TIMELINE COMPOSER CHECKS PASSED');
}
