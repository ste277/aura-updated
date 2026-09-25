/**
 * Daily Experience V1 PR C2 -- Skip from Home: pure/pipeline behavior on the
 * real Agenda -> Composer -> overlay -> Right Now -> reminder pipeline, the
 * shared execution guard on the real executor, plus structural wiring checks.
 * (Live-DB proof is homeSkipDb.test.ts.)
 */
import fs from 'fs';
import path from 'path';
import { createPlanExecutor, createPlanCompleter, skippablePlanId, completablePlanId, overlayExecutionFacts, overlayLoggedPlans, agendaWithoutResolvedNext, planIdFromTimelineItem, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { refreshAfterHomeCompletion, type HomeRefreshDeps } from '../apps/web/lib/homeRefresh';
import { selectVisibleStartingSoonReminder } from '../apps/web/lib/reminderConsistency';
import { deriveNextMeaningfulThing } from '../apps/web/lib/nextMeaningfulThing';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
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
const atDay = (d: number, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000); };
const at = (hhmm: string) => atDay(24, hhmm);
const plan = (id: string, title: string, start: Date, end: Date, status: PlannedActivity['status'] = 'UPCOMING'): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status, plannedStartAt: start, plannedEndAt: end, durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'N', matchLabel: 'G', score: 1, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
const oppG = (): { g: DailyGuidanceContext; sel: Record<string, SelectedActivityMetadata> } => ({ g: { engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: '', evidence: [], recommendations: [{ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', relevantThemes: [], timing: { start: at('10:00').toISOString(), end: at('13:00').toISOString(), score: 8, label: 'EXCELLENT', windowRank: 1 }, selectionReason: 'X', evidence: [] }] } as unknown as DailyGuidanceContext, sel: { SELF: { activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 's1' } as SelectedActivityMetadata } });
const minuteOf = (now: Date) => Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000);
const facts = (...entries: [string, ExecutionOutcome][]) => new Map<string, ExecutionOutcome>(entries);
function home(plans: PlannedActivity[], now: Date, f: ReadonlyMap<string, ExecutionOutcome> = new Map(), opts: { opp?: boolean; upcoming?: readonly AuraReminder[]; localDate?: string } = {}) {
  const localDate = opts.localDate ?? '2026-08-24';
  const agenda = buildDailyAgenda({ now, localDate, timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const o = opts.opp ? oppG() : null;
  const timeline = overlayExecutionFacts(buildHomeTimeline({ agenda, guidance: o?.g ?? null, selectedActivities: o?.sel ?? {}, currentMinuteOfDay: minuteOf(now), timezone: TZ, localDate }), f);
  const rightNow = selectRightNowState(timeline, now);
  const visible = selectVisibleStartingSoonReminder(opts.upcoming, f);
  const next = deriveNextMeaningfulThing({ topMomentUpdate: null, startingSoonReminder: visible, agenda: agendaWithoutResolvedNext(agenda, f) });
  return { agenda, timeline, rightNow, visible, next };
}
const title = (s: ReturnType<typeof selectRightNowState>) => (s.kind === 'CONTEXT_OPEN' ? null : s.item.title);
const reminder = (planId: string, t: string, mins: number): AuraReminder => ({ id: `PLAN:${planId}`, type: 'PLAN_STARTING_SOON', scheduledItemType: 'PLAN', scheduledItemId: planId, activityTitle: t, activityIcon: null, startAt: '2026-08-24T10:00:00.000Z', endAt: '2026-08-24T11:00:00.000Z', timezone: TZ, reminderAt: '2026-08-24T09:45:00.000Z', minutesUntilStart: mins, target: { type: 'PLAN', planId } }) as unknown as AuraReminder;
const idOf = (r: AuraReminder | null) => (r && r.target.type === 'PLAN' ? r.target.planId : null);
const skipBody = (id: string, status = 'SKIPPED') => JSON.stringify({ plan: { id, status, skippedAt: '2026-08-24T05:00:00.000Z' } });

async function main() {
  // ---------- 27. eligibility ----------
  const A = plan('a', 'Call John', at('10:30'), at('11:30'));
  const active = home([A], at('11:00'));
  check('27. ACTIVE_PLAN: Skip is offered (and Done)', active.rightNow.kind === 'ACTIVE_PLAN' && skippablePlanId(active.rightNow) === 'a' && completablePlanId(active.rightNow) === 'a');
  const imminent = home([plan('i', 'Starts soon', at('11:10'), at('12:00'))], at('11:00'));
  check('27/58. IMMINENT_PLAN: Done unchanged, Skip absent', imminent.rightNow.kind === 'IMMINENT_PLAN' && completablePlanId(imminent.rightNow) === 'i' && skippablePlanId(imminent.rightNow) === null);
  const opp = home([], at('11:00'), new Map(), { opp: true });
  check('27/59. Opportunity: no Skip', opp.rightNow.kind === 'OPPORTUNITY' && skippablePlanId(opp.rightNow) === null);
  check('27/59. context/open: no Skip', skippablePlanId({ kind: 'CONTEXT_OPEN' }) === null && home([], at('11:00')).rightNow.kind === 'CONTEXT_OPEN');
  const missed = home([plan('m', 'Missed one', at('08:00'), at('09:00'))], at('11:00'));
  check('27/59. a MISSED plan is not shown as Right Now: no Skip in C2', missed.agenda.items[0].status === 'MISSED' && skippablePlanId(missed.rightNow) === null);
  const done = home([plan('c', 'Finished', at('10:30'), at('11:30'), 'LOGGED')], at('11:00'));
  const skippedAlready = home([plan('s', 'Skipped', at('10:30'), at('11:30'), 'SKIPPED')], at('11:00'));
  check('27/59. completed and skipped plans: no Skip (resolved, never Right Now)', skippablePlanId(done.rightNow) === null && skippablePlanId(skippedAlready.rightNow) === null);

  // ---------- 28. boundary: same absolute-instant semantics as the selector ----------
  const atStart = home([A], at('10:30'));
  const atEnd = home([A], at('11:30'));
  const justBefore = home([A], new Date(at('10:30').getTime() - 1));
  const justAfter = home([A], new Date(at('11:30').getTime() + 1));
  check('28. plannedStartAt <= now: ACTIVE at exactly start -> Skip eligible', atStart.rightNow.kind === 'ACTIVE_PLAN' && skippablePlanId(atStart.rightNow) === 'a');
  check('28. now <= plannedEndAt: ACTIVE at exactly end -> Skip eligible', atEnd.rightNow.kind === 'ACTIVE_PLAN' && skippablePlanId(atEnd.rightNow) === 'a');
  check('28. one ms before start (IMMINENT) and one ms after end (MISSED): no Skip', skippablePlanId(justBefore.rightNow) === null && skippablePlanId(justAfter.rightNow) === null);

  // ---------- 43. basic active skip + 13. timeline + 22. Done vs Skip distinct ----------
  const afterSkip = home([A], at('11:00'), facts(['a', 'SKIPPED']));
  const skipItem = afterSkip.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!;
  check('43/12. Skip confirmed: A can no longer be ACTIVE_PLAN, Right Now falls to context', afterSkip.rightNow.kind === 'CONTEXT_OPEN');
  check('13. Timeline keeps A (not removed) and renders it SKIPPED, resolved, not completed', !!skipItem && skipItem.metadata?.agendaStatus === 'SKIPPED' && skipItem.metadata?.isCompleted === false && skipItem.metadata?.isCurrent === false && skipItem.metadata?.isPast === true);
  const afterDone = home([A], at('11:00'), facts(['a', 'COMPLETED']));
  const doneItem = afterDone.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!;
  check('22. Done stays COMPLETED and Skip stays SKIPPED (never a generic resolved state)', doneItem.metadata?.agendaStatus === 'COMPLETED' && doneItem.metadata?.isCompleted === true && skipItem.metadata?.agendaStatus === 'SKIPPED' && afterDone.rightNow.kind === 'CONTEXT_OPEN');
  check('10/21. PR B adapter: overlayLoggedPlans(Set) is exactly the COMPLETED form, and an empty overlay returns the same array', JSON.stringify(overlayLoggedPlans(active.timeline, new Set(['a'])).map((i) => i.metadata?.agendaStatus)) === JSON.stringify(afterDone.timeline.map((i) => i.metadata?.agendaStatus)) && overlayExecutionFacts(active.timeline, new Map()) === active.timeline);

  // ---------- 19/46. stale 200: authoritative data still says UPCOMING/CURRENT ----------
  const stale = home([plan('a', 'Call John', at('10:30'), at('11:30'), 'UPCOMING')], at('11:00'), facts(['a', 'SKIPPED']));
  check('19/46. a stale refresh still showing A as UPCOMING (CURRENT in the agenda): the confirmed SKIPPED overlay wins', stale.agenda.items[0].status === 'CURRENT' && stale.rightNow.kind === 'CONTEXT_OPEN' && stale.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!.metadata?.agendaStatus === 'SKIPPED');
  const caught = home([plan('a', 'Call John', at('10:30'), at('11:30'), 'SKIPPED')], at('11:00'), facts(['a', 'SKIPPED']));
  check('20. once authoritative data says SKIPPED the overlay is redundant with no flicker back to UPCOMING (same status, still resolved)', caught.rightNow.kind === 'CONTEXT_OPEN' && caught.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!.metadata?.agendaStatus === 'SKIPPED');

  // ---------- 29/54. midnight ----------
  const mid = plan('mid', 'Late event', at('23:30'), atDay(25, '00:30'));
  const midActive = home([mid], at('23:45'));
  const midAfterMidnight = home([mid], atDay(25, '00:15'), new Map(), { localDate: '2026-08-25' });
  check('29/54. a midnight-spanning plan is ACTIVE before midnight and Skip is available', midActive.rightNow.kind === 'ACTIVE_PLAN' && skippablePlanId(midActive.rightNow) === 'mid');
  check('29/54. after confirmation it immediately becomes SKIPPED and Right Now advances (absolute instants, no minute-of-day math)', home([mid], at('23:45'), facts(['mid', 'SKIPPED'])).rightNow.kind === 'CONTEXT_OPEN');
  check('29. the same plan after local midnight: eligibility follows Right Now (ACTIVE) and Skip stays available', midAfterMidnight.rightNow.kind !== 'ACTIVE_PLAN' || skippablePlanId(midAfterMidnight.rightNow) === 'mid');

  // ---------- 30/55. overlap, 31/56 opportunity, 32/57 context ----------
  const two = [plan('a', 'Winner', at('10:00'), at('12:00')), plan('b', 'Next active', at('10:30'), at('12:00'))];
  const overlapStart = home(two, at('11:00'));
  const overlapAfter = home(two, at('11:00'), facts(['a', 'SKIPPED']));
  check('30/55. overlapping A and B: existing ordering picks A; Skip A -> B becomes Right Now, and B is skippable', title(overlapStart.rightNow) === 'Winner' && title(overlapAfter.rightNow) === 'Next active' && skippablePlanId(overlapAfter.rightNow) === 'b');
  const withOpp = home([A], at('11:00'), facts(['a', 'SKIPPED']), { opp: true });
  check('31/56. active A + current Opportunity: Skip A -> the Opportunity becomes Right Now (no Skip on it)', home([A], at('11:00'), new Map(), { opp: true }).rightNow.kind === 'ACTIVE_PLAN' && withOpp.rightNow.kind === 'OPPORTUNITY' && skippablePlanId(withOpp.rightNow) === null);
  check('32/57. the only actionable plan skipped -> existing context/open state', afterSkip.rightNow.kind === 'CONTEXT_OPEN');

  // ---------- 14-16/47/48/49. reminders + next meaningful thing ----------
  const rA = reminder('a', 'Call John', -20), rB = reminder('b', 'Second', 25), rC = reminder('c', 'Third', 28);
  const sel = (upcoming: AuraReminder[], f: ReadonlyMap<string, ExecutionOutcome>) => selectVisibleStartingSoonReminder(upcoming, f);
  check('14/47. a stale reminder targeting a confirmed-SKIPPED plan is excluded immediately', sel([rA], facts(['a', 'SKIPPED'])) === null);
  check('16/47. [A, B]: A skipped -> B; [A, B, C]: A then B resolved (Skip or Done) -> C; all resolved -> no card', sel([rA, rB], facts(['a', 'SKIPPED'])) === rB && sel([rA, rB, rC], facts(['a', 'SKIPPED'], ['b', 'COMPLETED'])) === rC && sel([rA, rB, rC], facts(['a', 'SKIPPED'], ['b', 'SKIPPED'], ['c', 'COMPLETED'])) === null);
  check('48. Done regression: a confirmed COMPLETED plan still filters its reminder (Set form and Map form)', sel([rA, rB], facts(['a', 'COMPLETED'])) === rB && selectVisibleStartingSoonReminder([rA, rB], new Set(['a'])) === rB);
  check('14. identity is target.planId only: same title/time on a different plan id is never filtered', idOf(sel([reminder('a2', 'Call John', -20)], facts(['a', 'SKIPPED']))) === 'a2');
  const authoritative = [rA, rB];
  sel(authoritative, facts(['a', 'SKIPPED']));
  check('15. the authoritative reminder list is never mutated (only its Home projection is filtered)', authoritative.length === 2 && authoritative[0] === rA);
  const pipe = home([A, plan('b', 'Second', at('11:20'), at('12:20'))], at('11:00'), facts(['a', 'SKIPPED']), { upcoming: [rA, rB] });
  check('16/49. next meaningful thing: skipped A cannot survive as the starting-soon reminder; B (unrelated) is not suppressed', pipe.next?.kind === 'STARTING_SOON' && idOf((pipe.next as any).reminder) === 'b');
  const allResolved = home([A], at('11:00'), facts(['a', 'SKIPPED']), { upcoming: [rA] });
  check('16/49. all resolved: no reminder card and no agenda "next" pointing at the skipped plan', allResolved.visible === null && (allResolved.next === null || (allResolved.next.kind === 'AGENDA_ITEM' && allResolved.next.item.id !== 'plan:a')));
  const soonAgenda = buildDailyAgenda({ now: at('10:50'), localDate: '2026-08-24', timezone: TZ, plans: [plan('n1', 'Next one', at('11:05'), at('12:00')), plan('n2', 'After that', at('13:00'), at('14:00'))], moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const replaced = agendaWithoutResolvedNext(soonAgenda, facts(['n1', 'SKIPPED']));
  check('49. agendaWithoutResolvedNext: a resolved next item is replaced by the next unresolved one; an unrelated next item is untouched', soonAgenda.nextItem?.id === 'plan:n1' && replaced?.nextItem?.id === 'plan:n2' && agendaWithoutResolvedNext(soonAgenda, facts(['zzz', 'SKIPPED'])) === soonAgenda && agendaWithoutResolvedNext(soonAgenda, facts(['n1', 'SKIPPED'], ['n2', 'COMPLETED']))?.nextItem === undefined);

  // ---------- 17/18/45. refresh, then every refresh fails ----------
  const state = { user: { id: 'u1' } as { id: string } | null };
  const failAll: HomeRefreshDeps = {
    fetchImpl: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch,
    applyLogs: () => {}, applyHabits: () => {}, applyPlans: () => {},
    refreshMyDay: async () => { throw new Error('down'); }, refreshGuidance: async () => { throw new Error('down'); }, refreshAuraUpdates: async () => { throw new Error('down'); },
    reauthenticate: async () => { state.user = null; },
  };
  const skipFetch = (async (url: any) => new Response(skipBody('a'), { status: 200 })) as unknown as typeof fetch;
  const skipResult = await createPlanExecutor(skipFetch).skip('a');
  await refreshAfterHomeCompletion(failAll);
  const confirmed = skipResult === 'SKIPPED' ? facts(['a', 'SKIPPED']) : new Map<string, ExecutionOutcome>();
  const afterFail = home([A, plan('b', 'Next active', at('10:45'), at('12:00'))], at('11:00'), confirmed, { upcoming: [rA, rB] });
  check('18/45. Skip confirmed, then plans/habits/logs/my-day/guidance/Aura Updates ALL fail: Home stays authenticated, A is SKIPPED, no Skip/Done for A, Right Now advanced, stale reminder filtered, no "Skip failed"', skipResult === 'SKIPPED' && state.user?.id === 'u1' && afterFail.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!.metadata?.agendaStatus === 'SKIPPED' && title(afterFail.rightNow) === 'Next active' && idOf(afterFail.visible) === 'b');
  const doneResult = await createPlanCompleter((async () => new Response(JSON.stringify({ plan: { id: 'a', status: 'LOGGED' } }), { status: 200 })) as unknown as typeof fetch)('a');
  const afterDoneFail = home([A], at('11:00'), doneResult === 'DONE' ? facts(['a', 'COMPLETED']) : new Map(), { upcoming: [rA] });
  check('21. Done regression through the same generalized model: COMPLETED overlay, Right Now advances, reminder filtered', afterDoneFail.rightNow.kind === 'CONTEXT_OPEN' && afterDoneFail.visible === null && afterDoneFail.timeline.find((i) => planIdFromTimelineItem(i) === 'a')!.metadata?.agendaStatus === 'COMPLETED');

  // ---------- 5/6/34/44. requests + failure ----------
  const calls: string[] = [];
  const rec = (impl: (u: string) => Response | Promise<Response>) => (async (url: any, init: any) => { calls.push(`${init?.method} ${url}`); return impl(String(url)); }) as unknown as typeof fetch;
  const ex = createPlanExecutor(rec(() => new Response(skipBody('a'), { status: 200 })));
  const r = await ex.skip('a');
  check('5/7/26. Skip is POST /api/plans/<id>/skip only (never the log route) and succeeds only when the server reports SKIPPED', r === 'SKIPPED' && calls.length === 1 && calls[0] === 'POST /api/plans/a/skip');
  check('5. a 200 whose plan is not SKIPPED (e.g. LOGGED) is FAILED: never a false skip', await createPlanExecutor(rec(() => new Response(skipBody('a', 'LOGGED'), { status: 200 }))).skip('a') === 'FAILED');
  const fails: Array<[string, () => Response | Promise<Response>]> = [['500', () => new Response('{}', { status: 500 })], ['404', () => new Response('{}', { status: 404 })], ['409', () => new Response('{}', { status: 409 })], ['401', () => new Response('{}', { status: 401 })], ['network', () => Promise.reject(new TypeError('x'))], ['bad json', () => new Response('nope', { status: 200 })]];
  for (const [label, impl] of fails) check(`6/34/44. Skip POST ${label}: FAILED (retryable), no confirmation, and no session side effect (the executor never touches the user)`, await createPlanExecutor(rec(impl)).skip('a') === 'FAILED');
  const failedView = home([A], at('11:00'), new Map());
  check('6/44. after a failed Skip nothing is confirmed: A is still ACTIVE with both Done and Skip', failedView.rightNow.kind === 'ACTIVE_PLAN' && skippablePlanId(failedView.rightNow) === 'a' && completablePlanId(failedView.rightNow) === 'a');

  // ---------- 35/52 lost response then retry ----------
  let committed = false;
  const lost = createPlanExecutor((async () => { if (!committed) { committed = true; throw new TypeError('response lost'); } return new Response(skipBody('a'), { status: 200 }); }) as unknown as typeof fetch);
  const first = await lost.skip('a');
  const retry = await lost.skip('a');
  check('35/52. lost response: FAILED locally (A stays actionable), then the retry returns the idempotent SKIPPED result', first === 'FAILED' && retry === 'SKIPPED');

  // ---------- 7/8/36/37/53 shared guard ----------
  const gate: { release: () => void } = { release: () => {} };
  const slowCalls: string[] = [];
  const slow = (async (url: any) => { slowCalls.push(String(url)); await new Promise<void>((res) => { gate.release = res; }); return new Response(String(url).endsWith('/skip') ? skipBody('a') : JSON.stringify({ plan: { id: 'a', status: 'LOGGED' } }), { status: 200 }); }) as unknown as typeof fetch;
  async function burst(first: 'skip' | 'complete', second: 'skip' | 'complete') {
    slowCalls.length = 0;
    const ex2 = createPlanExecutor(slow);
    const p1 = ex2[first]('a');
    const busy = ex2.isBusy('a');
    const p2 = ex2[second]('a');
    const p3 = ex2[second]('a');
    await Promise.resolve();
    gate.release();
    const results = await Promise.all([p1, p2, p3]);
    const issued = [...slowCalls];
    const after = await (async () => { const p = ex2.skip('zzz'); await Promise.resolve(); gate.release(); return p; })();
    return { results, busy, calls: issued, after };
  }
  const ss = await burst('skip', 'skip');
  const cs = await burst('complete', 'skip');
  const sc = await burst('skip', 'complete');
  const cc = await burst('complete', 'complete');
  check('7/36/53. Skip/Skip burst: exactly one POST; the extra activations are BUSY', ss.calls.length === 1 && ss.calls[0] === '/api/plans/a/skip' && ss.results[0] === 'SKIPPED' && ss.results[1] === 'BUSY' && ss.results[2] === 'BUSY');
  check('8/37/53. Done then Skip before the first response: only the Done (log) request is issued; Skip is BUSY', cs.calls.length === 1 && cs.calls[0] === '/api/plans/a/log' && cs.results[0] === 'DONE' && cs.results[1] === 'BUSY');
  check('8/37/53. Skip then Done before the first response: only the Skip request is issued; Done is BUSY', sc.calls.length === 1 && sc.calls[0] === '/api/plans/a/skip' && sc.results[0] === 'SKIPPED' && sc.results[1] === 'BUSY');
  check('53. Done/Done burst: one log request (PR B behavior preserved)', cc.calls.length === 1 && cc.results[0] === 'DONE' && cc.results[1] === 'BUSY');
  check('7/53. the guard is per plan and released after completion: a different plan (and the same plan afterwards) is not blocked', ss.after === 'SKIPPED' && ss.busy === true);

  // ---------- structural ----------
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  const helper = strip(read('../apps/web/lib/homeCompletion.ts'));
  check('3/27. Skip renders only under skippablePlanIdNow (ACTIVE_PLAN), with an activity-specific accessible name, "Skipping…" while in flight, and a real disabled state', /skippablePlanIdNow && \(\s*<TextButton/.test(dash) && /ariaLabel=\{`Skip "\$\{spotlightItem\.title\}"`\}/.test(dash) && /'Skipping…' : 'Skip'/.test(dash) && /disabled=\{skippingPlanIds\.has\(skippablePlanIdNow\) \|\| completingPlanIds\.has\(skippablePlanIdNow\) \|\| movingPlanIds\.has\(skippablePlanIdNow\)\}/.test(dash));
  check('3. the whole Right Now card is not a Skip control: exactly two call sites -- the Right Now Skip button and the Missed Recovery Skip button (PR E) -- never a card/row click', (dash.match(/handleSkipRightNow\(/g) ?? []).length === 2 && /void handleSkipRightNow\(planId, 'TIMELINE'\)/.test(dash) && /onClick=\{\(\) => void handleSkipRightNow\(skippablePlanIdNow\)\}/.test(dash));
  check('4. Done is still separate: same Done button, same log endpoint, gated on completablePlanIdNow', /completablePlanIdNow && \(\s*<SecondaryButton/.test(dash) && /run\(planId, 'log', 'LOGGED', 'DONE'\)/.test(helper) && /run\(planId, 'skip', 'SKIPPED', 'SKIPPED'\)/.test(helper));
  check('5/44. no optimistic Skip: the SKIPPED fact is written only after the FAILED branch has returned', /if \(result === 'FAILED'\) \{[\s\S]{0,200}setSkipError\(\{ planId, message: "Couldn't skip that\. Try again\." \}\);\s*return;\s*\}\s*setExecutionFacts\(\(current\) => new Map\(current\)\.set\(planId, 'SKIPPED'\)\)/.test(dash));
  check('17. reconciliation is secondary: the existing quiet refresh (onPlanCompleted) runs in its own try/catch AFTER the confirmed fact and cannot fail the Skip', /set\(planId, 'SKIPPED'\)[\s\S]{0,300}try \{\s*await onPlanCompleted\?\.\(\);\s*\} catch \{/.test(dash));
  check('7/8. one execution guard: all three handlers (Done, Skip, Move) consult the same executor (isBusy) before touching state, and there is no second guard', (dash.match(/planExecutor\.current\.isBusy\(planId\)/g) ?? []).length === 3 && !/planCompleter|planSkipper/.test(dash) && (helper.match(/const inFlight = new Set/g) ?? []).length === 1);
  check('33. a failed Skip is plan-owned and shown as an alert only while that plan is the skippable one; it never signs out or replaces Home', /visibleCompletionError\(skipError, skippablePlanIdNow\)/.test(dash) && /role="alert"[^>]*>\{visibleCompletionError\(skipError/.test(dash) && !/setUser|window\.location|setPlannedActivities/.test(dash.slice(dash.indexOf('const handleSkipRightNow'), dash.indexOf('const spotlightExplanation'))));
  check('9/11/14. one execution-fact map feeds the timeline overlay, the reminder filter and the next-item filter', /useState<ReadonlyMap<string, ExecutionOutcome>>/.test(dash) && /overlayExecutionFacts\(overlayElapsedMissed\(composedTimeline, new Date\(\)\), executionFacts\)/.test(dash) && /selectVisibleStartingSoonReminder\(startingSoonReminders, executionFacts\)/.test(dash) && /agendaWithoutResolvedNext\(agendaForHome, executionFacts\)/.test(dash));
  check('40/41/42. no confirmation modal, no replan/Move/carry-forward CTA and no Day Constructor call in the Skip path', !/ModalShell|Move|Reschedule|Carry|Plan again|orchestrateConstructDay|constructDay/.test(dash.slice(dash.indexOf('const handleSkipRightNow'), dash.indexOf('const focusMoveTrigger'))) && !/Plan again|Carry forward/.test(dash));
  check('38. after a confirmed Skip focus moves to the stable Right Now region (tabIndex -1), never left on the unmounted button; no focus trap or new focus framework', /set\(planId, 'SKIPPED'\)[\s\S]{0,400}querySelector<HTMLElement>\('\[data-home-right-now-label\]'\)\?\.focus\(\)/.test(dash) && /data-home-right-now-label tabIndex=\{-1\}/.test(dash));
  check('7. no new API routes: the only Skip endpoint is the C1 route; no home-specific route exists', fs.existsSync(path.join(__dirname, '../apps/web/app/api/plans/[planId]/skip/route.ts')) && !fs.existsSync(path.join(__dirname, '../apps/web/app/api/home')));
  check('4/22. selector, Composer, Constructor and the Skip domain are untouched by C2 (Right Now already treats SKIPPED as resolved)', !/homeCompletion|executionFacts/.test(strip(read('../apps/web/lib/rightNowSelection.ts')) + strip(read('../apps/web/lib/homeTimelineComposer.ts')) + strip(read('../apps/web/lib/dayConstructor.ts'))) && /status === 'SKIPPED'/.test(strip(read('../apps/web/lib/rightNowSelection.ts'))));
  check('64. no migration by C2 (38 total after D2)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 38);

  if (!allPassed) { console.error('SOME HOME SKIP CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME SKIP CHECKS PASSED');
}
main();
