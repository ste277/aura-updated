/**
 * Daily Experience V1 PR A -- Right Now follows the committed day.
 * End-to-end over the REAL pipeline: PlannedActivity rows -> buildDailyAgenda
 * -> buildHomeTimeline (with/without guidance) -> selectRightNowState.
 * No component harness, no database.
 */
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { DailyGuidanceContext, DailyGuidanceRecommendation } from '../packages/personal-intelligence/src/context';
import type { SelectedActivityMetadata } from '../apps/web/lib/dailyGuidanceTypes';
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const DATE = '2026-08-24';
// IST clock -> UTC instant on DATE (IST = UTC+5:30)
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 7, 24, h, m) - 330 * 60000);
};
const minuteOf = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function plan(id: string, title: string, start: string, end: string, overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return {
    id,
    userId: 'u1',
    title,
    activityType: 'x',
    icon: null,
    status: 'UPCOMING',
    plannedStartAt: at(start),
    plannedEndAt: at(end),
    durationMinutes: 60,
    windowType: 'NEUTRAL',
    windowLabel: 'Neutral',
    matchLabel: 'Good Match',
    score: 70,
    recommendation: null,
    calendarUrl: null,
    loggedAt: null,
    habitLogId: null,
    eventTimezone: null,
    eventLocationName: null,
    createdAt: at('00:00'),
    updatedAt: at('00:00'),
    ...overrides,
  } as PlannedActivity;
}

function rec(rank: number, family: string, start: string, end: string): DailyGuidanceRecommendation {
  return {
    rank,
    activityFamily: family,
    personalRelevance: 'RELEVANT',
    relevantThemes: [],
    timing: { start: at(start).toISOString(), end: at(end).toISOString(), score: 8, label: 'EXCELLENT', windowRank: 1 },
    selectionReason: 'PRIMARY_FLOOR_MET',
    evidence: [],
  } as unknown as DailyGuidanceRecommendation;
}
const guidance = (recs: DailyGuidanceRecommendation[]): DailyGuidanceContext => ({ engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: at('09:00').toISOString(), recommendations: recs, evidence: [] } as unknown as DailyGuidanceContext);
const opp = (family: string, id: string): SelectedActivityMetadata => ({ activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: id } as SelectedActivityMetadata);

/** agendaNow = when the agenda was FETCHED; tickNow = the ticking Home clock. */
function run(plans: PlannedActivity[], tickNow: string, opts: { agendaNow?: string; guidance?: DailyGuidanceContext; selected?: Record<string, SelectedActivityMetadata> } = {}) {
  const agenda = buildDailyAgenda({ now: at(opts.agendaNow ?? tickNow), localDate: DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const timeline = buildHomeTimeline({ agenda, guidance: opts.guidance ?? null, selectedActivities: opts.selected ?? {}, currentMinuteOfDay: minuteOf(tickNow), timezone: TZ, localDate: DATE });
  return { timeline, state: selectRightNowState(timeline) };
}
const title = (s: ReturnType<typeof selectRightNowState>) => (s.kind === 'CONTEXT_OPEN' ? null : s.item.title);

// A. active committed plan + no guidance at all
{
  const { state } = run([plan('p1', 'Call John', '10:30', '11:30')], '11:00');
  check('A. an active plan with NO guidance -> ACTIVE_PLAN', state.kind === 'ACTIVE_PLAN' && title(state) === 'Call John');
}
// B/C. provenance is irrelevant: a Capture- or GoalActivity-originated plan is just a PlannedActivity
{
  const capturePlan = plan('cap-plan', 'Call John', '14:00', '15:00');
  const goalPlan = plan('goal-plan', 'Draft investor deck', '16:00', '17:00');
  check('B. an active Capture-originated plan with no guidance annotation -> ACTIVE_PLAN', run([capturePlan], '14:20').state.kind === 'ACTIVE_PLAN');
  check('C. an active GoalActivity-originated plan with no guidance annotation -> ACTIVE_PLAN', run([goalPlan], '16:10').state.kind === 'ACTIVE_PLAN');
  const md = run([capturePlan], '14:20').timeline[0].metadata!;
  check('B/C. the row carries no rank/guidance annotation yet is still selected (rank is not the authority)', run([capturePlan], '14:20').timeline[0].rank === undefined && md.isCurrent === true);
}
// D. active plan + rank-1 Opportunity (current)
{
  const g = guidance([rec(1, 'SELF', '10:45', '11:45')]);
  const { timeline, state } = run([plan('p1', 'Call John', '10:30', '11:30')], '11:00', { guidance: g, selected: { SELF: opp('SELF', 'sug-1') } });
  check('D. sanity: the rank-1 Opportunity is present and itself current', timeline.some((i) => i.kind === 'OPPORTUNITY' && i.rank === 1 && i.metadata?.isCurrent === true));
  check('D. active plan + current rank-1 Opportunity -> ACTIVE_PLAN (committed day wins)', state.kind === 'ACTIVE_PLAN' && title(state) === 'Call John');
}
// E. active plan + another (rank-1 annotated) plan that is NOT active
{
  const plans = [plan('p1', 'Active one', '10:30', '11:30'), plan('p2', 'Later ranked-1 plan', '15:00', '16:00')];
  const g = guidance([rec(1, 'WORK', '15:00', '16:00')]);
  const { timeline, state } = run(plans, '11:00', { guidance: g, selected: { WORK: { activityId: 'deep-work', title: 'Later ranked-1 plan', source: 'PLAN', sourceEntityId: 'p2' } as SelectedActivityMetadata } });
  check('E. sanity: the later plan carries rank 1', timeline.find((i) => i.title === 'Later ranked-1 plan')?.rank === 1);
  check('E. active plan + a rank-1 annotated other plan -> the ACTIVE plan is selected', state.kind === 'ACTIVE_PLAN' && title(state) === 'Active one');
}
// F/G. imminent + threshold boundary
{
  const p = [plan('p1', 'Soon', '11:10', '12:00')];
  check('F. no active plan, one starting in 10 minutes -> IMMINENT_PLAN', run(p, '11:00').state.kind === 'IMMINENT_PLAN');
  check('G. starting in exactly 30 minutes -> IMMINENT_PLAN (inclusive, matching dailyAgenda STARTING_SOON)', run([plan('p1', 'Soon', '11:30', '12:30')], '11:00').state.kind === 'IMMINENT_PLAN');
  check('G. starting in 31 minutes -> NOT imminent (CONTEXT_OPEN)', run([plan('p1', 'Soon', '11:31', '12:30')], '11:00').state.kind === 'CONTEXT_OPEN');
}
// H/I. far-future plan
{
  const far = [plan('p1', 'Evening plan', '14:00', '15:00')];
  const g = guidance([rec(1, 'SELF', '10:45', '11:45')]);
  const withOpp = run(far, '11:00', { guidance: g, selected: { SELF: opp('SELF', 'sug-1') } });
  check('H. next plan 3 hours away + a current Opportunity -> OPPORTUNITY (the far plan does not hijack Right Now)', withOpp.state.kind === 'OPPORTUNITY');
  check('I. next plan 3 hours away, no Opportunity -> CONTEXT_OPEN', run(far, '11:00').state.kind === 'CONTEXT_OPEN');
  const farRanked = guidance([rec(1, 'WORK', '14:00', '15:00'), rec(2, 'SELF', '10:45', '11:45')]);
  const sel = { WORK: { activityId: 'deep-work', title: 'Evening plan', source: 'PLAN', sourceEntityId: 'p1' } as SelectedActivityMetadata, SELF: opp('SELF', 'sug-1') };
  check('H. even when the far plan is guidance rank 1, a lower-ranked current Opportunity is offered (the old rank-1-only rule would have shown nothing)', run(far, '11:00', { guidance: farRanked, selected: sel }).state.kind === 'OPPORTUNITY');
}
// J/K/L lifecycle exclusions
{
  const missed = run([plan('p1', 'Missed', '09:00', '10:00')], '11:00');
  check('J. an elapsed unlogged plan (MISSED) is never active/imminent', missed.state.kind === 'CONTEXT_OPEN' && missed.timeline[0].metadata?.agendaStatus === 'MISSED');
  const logged = run([plan('p1', 'Logged early', '10:30', '11:30', { status: 'LOGGED', loggedAt: at('10:40') })], '11:00');
  check('K. a logged plan whose window still contains now is never active', logged.state.kind === 'CONTEXT_OPEN');
  const cancelled = run([plan('p1', 'Cancelled', '10:30', '11:30', { status: 'CANCELLED' })], '11:00');
  check('L. a cancelled plan never appears at all, so it cannot be Right Now', cancelled.timeline.length === 0 && cancelled.state.kind === 'CONTEXT_OPEN');
  const loggedThenNext = run([plan('p1', 'Logged early', '10:30', '11:30', { status: 'LOGGED', loggedAt: at('10:40') }), plan('p2', 'Next up', '11:20', '12:00')], '11:00');
  check('K. after logging early, the next imminent plan takes over', loggedThenNext.state.kind === 'IMMINENT_PLAN' && title(loggedThenNext.state) === 'Next up');
}
// M/N
{
  const g = guidance([rec(1, 'SELF', '10:45', '11:45')]);
  check('M. a current Opportunity only -> OPPORTUNITY', run([], '11:00', { guidance: g, selected: { SELF: opp('SELF', 'sug-1') } }).state.kind === 'OPPORTUNITY');
  check('N. nothing actionable -> CONTEXT_OPEN', run([], '11:00').state.kind === 'CONTEXT_OPEN');
  const notYet = guidance([rec(1, 'SELF', '15:00', '16:00')]);
  check('N. an Opportunity whose window is not current -> CONTEXT_OPEN', run([], '11:00', { guidance: notYet, selected: { SELF: opp('SELF', 'sug-1') } }).state.kind === 'CONTEXT_OPEN');
}
// O. overlapping committed plans
{
  const plans = [plan('b', 'Started later', '10:45', '12:00'), plan('a', 'Started first', '10:30', '11:30')];
  const r1 = run(plans, '11:00');
  const r2 = run([...plans].reverse(), '11:00');
  check('O. overlapping active plans: the earliest-starting plan wins, independent of input order', title(r1.state) === 'Started first' && title(r2.state) === 'Started first');
  const same = [plan('z', 'Zed', '10:30', '11:30'), plan('a', 'Alpha', '10:30', '11:30')];
  check('O. identical-start overlaps resolve deterministically (same winner for either input order)', title(run(same, '11:00').state) === title(run([...same].reverse(), '11:00').state));
  const imm = [plan('b', 'Second soon', '11:20', '12:00'), plan('a', 'First soon', '11:10', '12:00')];
  check('O. two imminent plans: the earlier start wins', title(run(imm, '11:00').state) === 'First soon');
}
// Time correctness: a stale fetch-time agendaStatus must not decide Right Now
{
  const p = [plan('p1', 'Call John', '10:30', '11:30')];
  const staleFetched = run(p, '10:45', { agendaNow: '10:00' }); // agenda fetched at 10:00 (UPCOMING), Home clock now 10:45
  check('stale agenda: fetched before the plan started, Home ticks into the window -> ACTIVE_PLAN (ticking clock, not fetch-time status)', staleFetched.timeline[0].metadata?.agendaStatus !== 'CURRENT' && staleFetched.state.kind === 'ACTIVE_PLAN');
  const staleCurrent = run(p, '11:45', { agendaNow: '11:00' }); // fetched while CURRENT, clock now past the end
  check('stale agenda: fetched while CURRENT, Home ticks past the end -> not active (CONTEXT_OPEN)', staleCurrent.timeline[0].metadata?.agendaStatus === 'CURRENT' && staleCurrent.state.kind === 'CONTEXT_OPEN');
  const staleImminent = run([plan('p1', 'Soon', '11:20', '12:00')], '11:00', { agendaNow: '09:00' });
  check('stale agenda: fetched 2h earlier as UPCOMING, clock now 20 minutes before start -> IMMINENT_PLAN', staleImminent.state.kind === 'IMMINENT_PLAN');
}
// Boundary: Composer not taught scheduling; Constructor/DayIntent/Timing untouched
{
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const sel = read('../apps/web/lib/rightNowSelection.ts');
  check('the selector never reads guidance rank for plans (rank only orders Opportunities)', !/\.rank/.test(sel.replace(/a\.rank[^;]*b\.rank[^;]*/, '')));
  check('the selector is pure (no Date/clock, DB, fetch, React)', !/new Date|Date\.now|fetch\(|from 'react'|from '\.\/db'/.test(sel));
  check('the Composer only gained a presentation classification (startsInMinutes); it did not import scheduling code', /startsInMinutes/.test(read('../apps/web/lib/homeTimelineComposer.ts')) && !/dayConstructor|timingSearch|dayCapacity/.test(read('../apps/web/lib/homeTimelineComposer.ts')));
  check('Day Constructor / DayIntent / Timing Search / availability are untouched by this change', ['dayConstructor.ts', 'dayIntent.ts', 'dayConstructorOrchestrator.ts', 'dayCapacity.ts', 'availabilityContext.ts'].every((f) => !/rightNow|startsInMinutes/i.test(read(`../apps/web/lib/${f}`))));
}

if (!allPassed) {
  console.error('SOME DAY-DRIVEN RIGHT NOW CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DAY-DRIVEN RIGHT NOW CHECKS PASSED');
