/**
 * Daily Experience V1 PR B -- complete from Home: pure/pipeline + structural.
 * Real pipeline: PlannedActivity rows -> buildDailyAgenda -> buildHomeTimeline
 * -> selectRightNowState -> completablePlanId -> overlayLoggedPlans ->
 * selectRightNowState again ("Right Now advances naturally").
 */
import fs from 'fs';
import path from 'path';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { planIdFromTimelineItem, completablePlanId, overlayLoggedPlans, createPlanCompleter } from '../apps/web/lib/homeCompletion';
import type { PlannedActivity } from '../apps/web/lib/db';
import type { DailyGuidanceContext } from '../packages/personal-intelligence/src/context';
import type { SelectedActivityMetadata } from '../apps/web/lib/dailyGuidanceTypes';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const TZ = 'Asia/Kolkata';
const DATE = '2026-08-24';
const atDay = (d: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000);
};
const at = (hhmm: string) => atDay(24, hhmm);
const minuteOf = (hhmm: string) => Number(hhmm.split(':')[0]) * 60 + Number(hhmm.split(':')[1]);
function plan(id: string, title: string, start: Date, end: Date, overrides: Partial<PlannedActivity> = {}): PlannedActivity {
  return { id, userId: 'u1', title, activityType: 'x', icon: null, status: 'UPCOMING', plannedStartAt: start, plannedEndAt: end, durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'N', matchLabel: 'G', score: 1, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start, ...overrides } as PlannedActivity;
}
const oppGuidance = (): { g: DailyGuidanceContext; sel: Record<string, SelectedActivityMetadata> } => ({
  g: { engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: '', evidence: [], recommendations: [{ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', relevantThemes: [], timing: { start: at('10:00').toISOString(), end: at('13:00').toISOString(), score: 8, label: 'EXCELLENT', windowRank: 1 }, selectionReason: 'X', evidence: [] }] } as unknown as DailyGuidanceContext,
  sel: { SELF: { activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 's1' } as SelectedActivityMetadata },
});
function view(plans: PlannedActivity[], now: Date, withOpp = false, logged: ReadonlySet<string> = new Set()) {
  const agenda = buildDailyAgenda({ now, localDate: DATE, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const o = withOpp ? oppGuidance() : null;
  const tl0 = buildHomeTimeline({ agenda, guidance: o?.g ?? null, selectedActivities: o?.sel ?? {}, currentMinuteOfDay: Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000), timezone: TZ, localDate: DATE });
  const timeline = overlayLoggedPlans(tl0, logged);
  return { timeline, state: selectRightNowState(timeline, now) };
}
const title = (s: ReturnType<typeof selectRightNowState>) => (s.kind === 'CONTEXT_OPEN' ? null : s.item.title);

async function main() {
  // ---- eligibility of the Done action ----
  const active = view([plan('p1', 'Call John', at('10:30'), at('11:30'))], at('11:00'));
  check('4/32. an ACTIVE_PLAN exposes a completable plan id (the real PlannedActivity id, from the agenda item id)', active.state.kind === 'ACTIVE_PLAN' && completablePlanId(active.state) === 'p1');
  const imminent = view([plan('p1', 'Soon', at('11:10'), at('12:00'))], at('11:00'));
  check('5/38. an IMMINENT_PLAN is completable early (the existing log route accepts an UPCOMING plan)', imminent.state.kind === 'IMMINENT_PLAN' && completablePlanId(imminent.state) === 'p1');
  const far = view([plan('p1', 'Later', at('15:00'), at('16:00'))], at('11:00'));
  check('21. a far-future plan is not shown by Right Now, so no Done is offered', far.state.kind === 'CONTEXT_OPEN' && completablePlanId(far.state) === null);
  const opp = view([], at('11:00'), true);
  check('22/42. an Opportunity-only Right Now offers NO Done', opp.state.kind === 'OPPORTUNITY' && completablePlanId(opp.state) === null);
  check('23/43. the context state offers NO Done', completablePlanId({ kind: 'CONTEXT_OPEN' }) === null);
  check('planIdFromTimelineItem only accepts plan-sourced "plan:<id>" items', planIdFromTimelineItem({ id: 'guidance:s1', kind: 'OPPORTUNITY', source: 'DAY_BUILDER_INTENTION' } as any) === null && planIdFromTimelineItem({ id: 'moment:m1', kind: 'MOMENT', source: 'MOMENT' } as any) === null && planIdFromTimelineItem({ id: 'plan:', kind: 'PLAN', source: 'PLAN' } as any) === null);
  const momentOnlyState = { kind: 'ACTIVE_PLAN', item: { id: 'moment:m1', kind: 'MOMENT', source: 'MOMENT' } } as any;
  check('24. a shared Moment is never completable from Home', completablePlanId(momentOnlyState) === null);

  // ---- Right Now advances naturally after a CONFIRMED completion ----
  const ordinary = plan('p1', 'Call John', at('10:30'), at('11:30'));
  const after1 = view([ordinary], at('11:00'), false, new Set(['p1']));
  check('13/32. after a confirmed completion the plan stops being ACTIVE_PLAN and Right Now falls to context (not hard-coded)', after1.state.kind === 'CONTEXT_OPEN');
  check('14. the timeline still contains the plan, now shown as completed (history not deleted)', after1.timeline.some((i) => i.id === 'plan:p1' && i.metadata?.isCompleted === true && i.metadata?.agendaStatus === 'COMPLETED'));
  const authoritative = view([plan('p1', 'Call John', at('10:30'), at('11:30'), { status: 'LOGGED', loggedAt: at('11:00') })], at('11:00'));
  check('14. the overlay agrees with what the refreshed agenda reports for a LOGGED plan', authoritative.timeline[0].metadata?.agendaStatus === authoritative.timeline.find((i) => i.id === 'plan:p1')!.metadata?.agendaStatus && after1.timeline[0].metadata?.agendaStatus === 'COMPLETED' && authoritative.state.kind === 'CONTEXT_OPEN');

  // 36. active + Opportunity, then complete: existing hierarchy decides
  const both = view([ordinary], at('11:00'), true);
  check('36. active plan + current Opportunity: the plan owns Right Now', both.state.kind === 'ACTIVE_PLAN');
  const bothAfter = view([ordinary], at('11:00'), true, new Set(['p1']));
  check('36. after completing it, the existing selector (not Home) lets the current Opportunity become Right Now', bothAfter.state.kind === 'OPPORTUNITY');

  // 37. next active plan
  const two = [plan('a', 'Winner', at('10:00'), at('12:00')), plan('b', 'Runner-up', at('10:30'), at('12:00'))];
  const t1 = view(two, at('11:00'));
  check('37. two current plans: the earliest-start plan wins Right Now', title(t1.state) === 'Winner');
  const t2 = view(two, at('11:00'), false, new Set(['a']));
  check('37. completing the winner: the selector naturally chooses the next eligible active plan', title(t2.state) === 'Runner-up' && completablePlanId(t2.state) === 'b');

  // 35. midnight integration (PR A + PR B)
  const mid = plan('mid', 'Late event', at('23:30'), atDay(25, '00:30'));
  const m1 = view([mid], at('23:45'));
  check('35/27. midnight-spanning plan @23:45 -> ACTIVE_PLAN with a completable id', m1.state.kind === 'ACTIVE_PLAN' && completablePlanId(m1.state) === 'mid');
  const m2 = view([mid], at('23:45'), false, new Set(['mid']));
  check('35/27. after Done it no longer owns Right Now', m2.state.kind === 'CONTEXT_OPEN' && m2.timeline[0].metadata?.isCompleted === true);
  check('28. a plan already LOGGED in the agenda is not offered again', view([plan('l', 'Logged', at('10:30'), at('11:30'), { status: 'LOGGED', loggedAt: at('10:40') })], at('11:00')).state.kind === 'CONTEXT_OPEN');

  // overlay is scoped: other plans untouched
  const scoped = view([ordinary, plan('p2', 'Other', at('10:30'), at('11:30'))], at('11:00'), false, new Set(['p1']));
  check('the overlay only affects the confirmed plan (another current plan takes over)', title(scoped.state) === 'Other');
  const same = [{ id: 'plan:x', source: 'PLAN', kind: 'PLAN', metadata: {} }] as any;
  check('an empty overlay returns the same array (no needless recompute)', overlayLoggedPlans(same, new Set()) === same);

  // ---- completer: request shape, guard, failure, retry ----
  type Call = { url: string; method?: string };
  const fake = (responder: (c: Call) => Promise<Response> | Response) => {
    const calls: Call[] = [];
    const impl = (async (url: any, init: any) => { const c = { url: String(url), method: init?.method }; calls.push(c); return responder(c); }) as unknown as typeof fetch;
    return { impl, calls };
  };
  const okLogged = () => new Response(JSON.stringify({ plan: { status: 'LOGGED', loggedAt: 'x' }, habitLog: { id: 'h' } }), { status: 200 });
  const a = fake(okLogged);
  const c1 = createPlanCompleter(a.impl);
  check('7. Done calls the EXISTING endpoint: POST /api/plans/<id>/log (no new Home/Right-Now API)', (await c1('p1')) === 'DONE' && a.calls.length === 1 && a.calls[0].url === '/api/plans/p1/log' && a.calls[0].method === 'POST');

  let release: (r: Response) => void = () => {};
  const slow = fake(() => new Promise<Response>((res) => { release = res; }));
  const c2 = createPlanCompleter(slow.impl);
  const first = c2('p1');
  const burst = await Promise.all([c2('p1'), c2('p1'), c2('p1')]);
  release(okLogged());
  check('12/40. a same-task burst of Done submissions sends exactly ONE request (the other calls are BUSY)', burst.every((r) => r === 'BUSY') && slow.calls.length === 1 && (await first) === 'DONE');
  const otherPlan = fake(okLogged);
  const c3 = createPlanCompleter(otherPlan.impl);
  await Promise.all([c3('p1'), c3('p2')]);
  check('the guard is per plan: two different plans are not blocked by each other', otherPlan.calls.length === 2);

  const flaky = fake(() => (flaky.calls.length === 1 ? new Response('{}', { status: 500 }) : okLogged()));
  const c4 = createPlanCompleter(flaky.impl);
  const r1 = await c4('p1');
  const r2 = await c4('p1');
  check('17/41. a failed request is FAILED, the guard resets, and a deliberate retry succeeds: two requests total', r1 === 'FAILED' && r2 === 'DONE' && flaky.calls.length === 2);
  check('39. network errors and a 200 that is not a LOGGED plan are FAILED (never a false completion)', (await createPlanCompleter((async () => { throw new TypeError('x'); }) as unknown as typeof fetch)('p1')) === 'FAILED' && (await createPlanCompleter(fake(() => new Response(JSON.stringify({ plan: { status: 'UPCOMING' } }), { status: 200 })).impl)('p1')) === 'FAILED' && (await createPlanCompleter(fake(() => new Response('not json', { status: 200 })).impl)('p1')) === 'FAILED');

  // ---- structural ----
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const helper = strip(read('../apps/web/lib/homeCompletion.ts'));
  check('4/29. Done is a real button (SecondaryButton) with an accessible name and disabled-while-saving semantics, only when a committed plan is completable', /completablePlanIdNow && \(\s*<SecondaryButton/.test(dash) && /ariaLabel=\{`Mark "\$\{spotlightItem\.title\}" done`\}/.test(dash) && /disabled=\{completingPlanId === completablePlanIdNow\}/.test(dash));
  check('29. the whole Right Now card is NOT a completion control: the only call site is the Done button itself', (dash.match(/handleCompleteRightNow\(/g) ?? []).length === 1 && /<SecondaryButton\s+onClick=\{\(\) => void handleCompleteRightNow\(completablePlanIdNow\)\}/.test(dash));
  check('31. copy is "Done" / "Saving…"; no HabitLog/LOGGED/PlannedActivity terminology in Home UI text', />\s*\{completingPlanId === completablePlanIdNow \? 'Saving…' : 'Done'\}/.test(dash) && !/Couldn't mark[^"]*(HabitLog|LOGGED|PlannedActivity)/.test(dash));
  check('7. no parallel completion API: the only endpoint referenced is /api/plans/<id>/log; no new route files', /\/api\/plans\/\$\{encodeURIComponent\(planId\)\}\/log/.test(helper) && !fs.existsSync(path.join(__dirname, '../apps/web/app/api/home')) && !fs.existsSync(path.join(__dirname, '../apps/web/app/api/right-now')));
  check('8/9/10. Home never touches HabitLog, Capture, Goal, timestamps or plan status itself', !/habit|capture|goalActivity|loggedAt|completedAt|new Date|Date\.now/i.test(helper.replace(/loggedAt: 'x'/g, '')));
  check('11/15. after a CONFIRMED success Home refreshes the authoritative data via the Plan tab handler (page.tsx handlePlanLogged) and overlays only the confirmed plan', /setLoggedPlanIds\(\(current\) => new Set\(current\)\.add\(planId\)\)/.test(dash) && /await onPlanCompleted\?\.\(\)/.test(dash) && /onPlanCompleted=\{handlePlanLogged\}/.test(strip(read('../apps/web/app/page.tsx'))));
  check('18. a failed refresh is swallowed: the last valid Home stays (no generic load error)', /try \{\s*await onPlanCompleted\?\.\(\);\s*\} catch \{/.test(dash));
  check('17. a failed completion shows a compact alert, leaves the plan visible and does not add it to the logged set', /if \(result === 'FAILED'\) \{\s*setCompleteError\("Couldn't mark that done\. Try again\."\);\s*return;\s*\}/.test(dash) && /role="alert"/.test(dash));
  check('the existing selector, Composer, Constructor and Timing code are untouched by this feature', !/homeCompletion|overlayLoggedPlans/.test(strip(read('../apps/web/lib/rightNowSelection.ts')) + strip(read('../apps/web/lib/homeTimelineComposer.ts')) + strip(read('../apps/web/lib/dayConstructor.ts'))));
  check('26. the Plan tab completion path is unchanged (handleLogPlan still posts /api/plans/<id>/log)', /fetch\(`\/api\/plans\/\$\{plan\.id\}\/log`, \{ method: 'POST' \}\)/.test(read('../apps/web/components/PlanWithAuraView.tsx')));
  check('54. no migration added (36)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 36);

  if (!allPassed) {
    console.error('SOME HOME COMPLETION CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL HOME COMPLETION CHECKS PASSED');
}
main();
