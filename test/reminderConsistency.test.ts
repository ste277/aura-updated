/**
 * Daily Experience V1 PR B (reminder consistency) -- a confirmed-completed plan
 * must vanish from the starting-soon reminder projection immediately, survive
 * refresh failure and STALE refresh responses, and never be hidden for a
 * failed completion. Behavioral: real completer, real refresh, real
 * agenda/Composer/selector, real deriveNextMeaningfulThing.
 */
import fs from 'fs';
import path from 'path';
import { selectVisibleStartingSoonReminder } from '../apps/web/lib/reminderConsistency';
import { createPlanCompleter, completablePlanId, overlayLoggedPlans } from '../apps/web/lib/homeCompletion';
import { refreshAfterHomeCompletion, type HomeRefreshDeps } from '../apps/web/lib/homeRefresh';
import { deriveNextMeaningfulThing } from '../apps/web/lib/nextMeaningfulThing';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import type { AuraReminder } from '../apps/web/lib/auraReminders';
import type { PlannedActivity } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

const reminder = (planId: string, title: string, minutesUntilStart: number): AuraReminder => ({
  id: `PLAN:${planId}`, type: 'PLAN_STARTING_SOON', scheduledItemType: 'PLAN', scheduledItemId: planId, activityTitle: title, activityIcon: null,
  startAt: '2026-08-24T10:00:00.000Z', endAt: '2026-08-24T11:00:00.000Z', timezone: 'Asia/Kolkata', reminderAt: '2026-08-24T09:45:00.000Z', minutesUntilStart, target: { type: 'PLAN', planId },
}) as unknown as AuraReminder;
const momentReminder = (token: string): AuraReminder => ({ ...reminder('m', 'Moment', 5), type: 'MOMENT_APPROACHING', scheduledItemType: 'MOMENT', target: { type: 'MOMENT', momentToken: token } }) as unknown as AuraReminder;
const A = reminder('A', 'Soon plan', 10), B = reminder('B', 'Second plan', 25), C = reminder('C', 'Third plan', 28);
const set = (...ids: string[]) => new Set(ids);
const idOf = (r: AuraReminder | null) => (r && r.target.type === 'PLAN' ? r.target.planId : null);

// ---- the filter ----
check('nothing confirmed: the first reminder is shown exactly as before (no behavior change)', selectVisibleStartingSoonReminder([A, B], set()) === A);
check('13. imminent A ("Starts in 10 min") confirmed completed -> not shown', selectVisibleStartingSoonReminder([A], set('A')) === null);
check('14. active A ("Started 20 min ago") confirmed completed -> not shown', selectVisibleStartingSoonReminder([reminder('A', 'Soon plan', -20)], set('A')) === null);
check('15/7. upcoming [A, B]: complete A -> B becomes the reminder (filter FIRST, then select)', selectVisibleStartingSoonReminder([A, B], set('A')) === B);
check('16. only A: complete A -> null (no empty shell to render)', selectVisibleStartingSoonReminder([A], set('A')) === null && selectVisibleStartingSoonReminder([], set('A')) === null && selectVisibleStartingSoonReminder(undefined, set('A')) === null);
check('8/32. upcoming [A, B, C] with a STALE list: A then B confirmed -> C', selectVisibleStartingSoonReminder([A, B, C], set('A', 'B')) === C);
check('a not-yet-confirmed plan is never hidden (20/36: a failed completion adds nothing, so its reminder stays)', selectVisibleStartingSoonReminder([A, B], set('Z')) === A);
check('identity is the durable plan id only: a different plan with the SAME title/time is not filtered', selectVisibleStartingSoonReminder([reminder('A2', 'Soon plan', 10)], set('A')) !== null && idOf(selectVisibleStartingSoonReminder([reminder('A2', 'Soon plan', 10)], set('A'))) === 'A2');
const arr = [A, B];
selectVisibleStartingSoonReminder(arr, set('A'));
check('6. the authoritative list is never mutated', arr.length === 2 && arr[0] === A);
const mo = momentReminder('tok');
check('Moment reminders are never filtered by a plan id (Moments are out of scope)', selectVisibleStartingSoonReminder([mo, A], set('A', 'tok')) === mo);

// ---- end to end: Done, then reconcile ----
const TZ = 'Asia/Kolkata';
const at = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, 24, h, m) - 330 * 60000); };
const atNext = (hhmm: string) => new Date(at(hhmm).getTime() + 86400000);
const plan = (id: string, title: string, start: Date, end: Date): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status: 'UPCOMING', plannedStartAt: start, plannedEndAt: end, durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'N', matchLabel: 'G', score: 1, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
function home(plans: PlannedActivity[], now: Date, confirmed: ReadonlySet<string>, upcoming: readonly AuraReminder[]) {
  const agenda = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
  const minute = Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000);
  const timeline = overlayLoggedPlans(buildHomeTimeline({ agenda, guidance: null, selectedActivities: {}, currentMinuteOfDay: minute, timezone: TZ, localDate: '2026-08-24' }), confirmed);
  const rightNow = selectRightNowState(timeline, now);
  const visible = selectVisibleStartingSoonReminder(upcoming, confirmed);
  const next = deriveNextMeaningfulThing({ topMomentUpdate: null, startingSoonReminder: visible, agenda });
  return { timeline, rightNow, visible, next };
}
const okLog = (id: string) => (async () => new Response(JSON.stringify({ plan: { id, status: 'LOGGED', loggedAt: 'x' }, habitLog: { id: 'h' } }), { status: 200 })) as unknown as typeof fetch;
function deps(auraMode: 'ok' | 'reject' | 'stale', all = false, upcomingHolder: { list: readonly AuraReminder[] }): HomeRefreshDeps {
  const fail = async () => { throw new Error('down'); };
  const rej = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
  return {
    fetchImpl: all ? rej : ((async () => new Response('[]', { status: 200 })) as unknown as typeof fetch),
    applyLogs: () => {}, applyHabits: () => {}, applyPlans: () => {},
    refreshMyDay: all ? fail : async () => {}, refreshGuidance: all ? fail : async () => {},
    refreshAuraUpdates: auraMode === 'reject' ? fail : auraMode === 'stale' ? async () => { upcomingHolder.list = [A, B, C]; } : async () => { upcomingHolder.list = [B, C]; },
    reauthenticate: async () => {},
  };
}
async function doneThenReconcile(plans: PlannedActivity[], now: Date, upcoming: AuraReminder[], target: string, auraMode: 'ok' | 'reject' | 'stale', all = false) {
  const holder = { list: upcoming as readonly AuraReminder[] };
  const before = home(plans, now, new Set(), holder.list);
  const done = createPlanCompleter(okLog(target));
  const result = await done(target);
  const confirmed = new Set<string>(result === 'DONE' ? [target] : []);
  const immediately = home(plans, now, confirmed, holder.list); // BEFORE any refresh finishes
  await refreshAfterHomeCompletion(deps(auraMode, all, holder));
  const reconciled = home(plans, now, confirmed, holder.list);
  return { before, immediately, reconciled, result };
}
const soon = plan('A', 'Soon plan', at('10:10'), at('11:10'));
const bPlan = plan('B', 'Second plan', at('10:25'), at('11:25'));
const cPlan = plan('C', 'Third plan', at('10:28'), at('11:28'));

async function main() {
  const blocker = await doneThenReconcile([soon], at('10:00'), [A], 'A', 'ok');
  check('29. BLOCKER: imminent A with a "Starts in 10 min" reminder -> before Done the reminder is A and Right Now is Coming up', idOf(blocker.before.visible) === 'A' && blocker.before.rightNow.kind === 'IMMINENT_PLAN' && blocker.before.next?.kind === 'STARTING_SOON');
  check('29/13. IMMEDIATELY after LOGGED confirmation (before any refresh): the reminder no longer shows A, Right Now advanced, the Timeline shows A completed', blocker.result === 'DONE' && blocker.immediately.visible === null && blocker.immediately.next?.kind !== 'STARTING_SOON' && blocker.immediately.rightNow.kind === 'CONTEXT_OPEN' && blocker.immediately.timeline.some((i) => i.id === 'plan:A' && i.metadata?.isCompleted === true));
  check('11. after an Aura Updates refresh that no longer contains A, the projection reconciles naturally (the authoritative [B, C] list; A gone, B is next; no permanent contradiction)', idOf(blocker.reconciled.visible) !== 'A' && idOf(blocker.reconciled.visible) === 'B');

  const active = await doneThenReconcile([plan('A', 'Soon plan', at('09:40'), at('10:40'))], at('10:00'), [reminder('A', 'Soon plan', -20)], 'A', 'ok');
  check('30/14. ACTIVE A ("Started 20 min ago") -> Done -> reminder gone immediately, Right Now advanced', active.before.rightNow.kind === 'ACTIVE_PLAN' && active.immediately.visible === null && active.immediately.rightNow.kind === 'CONTEXT_OPEN');

  const next = await doneThenReconcile([soon, bPlan], at('10:00'), [A, B], 'A', 'reject');
  check('31/15. upcoming [A, B]: Done A -> B is the visible reminder and Right Now moves to B', idOf(next.immediately.visible) === 'B' && next.immediately.rightNow.kind === 'IMMINENT_PLAN' && completablePlanId(next.immediately.rightNow) === 'B');

  const twoDone = (() => {
    const upcoming = [A, B, C];
    const c1 = new Set(['A']);
    const c2 = new Set(['A', 'B']);
    return { afterA: selectVisibleStartingSoonReminder(upcoming, c1), afterAB: selectVisibleStartingSoonReminder(upcoming, c2) };
  })();
  check('32. stale Aura Updates [A, B, C]: complete A then B -> both stay filtered and C surfaces', idOf(twoDone.afterA) === 'B' && idOf(twoDone.afterAB) === 'C');

  const auraFail = await doneThenReconcile([soon], at('10:00'), [A], 'A', 'reject');
  check('10/33. the Aura Updates refresh REJECTS: A stays filtered, Home model intact, no completion error state', auraFail.reconciled.visible === null && auraFail.reconciled.rightNow.kind === 'CONTEXT_OPEN' && auraFail.reconciled.timeline.some((i) => i.id === 'plan:A' && i.metadata?.isCompleted === true) && auraFail.result === 'DONE');

  const stale = await doneThenReconcile([soon, bPlan, cPlan], at('10:00'), [A, B, C], 'A', 'stale');
  check('12/34. the Aura Updates refresh returns HTTP 200 with STALE data still containing A: the confirmed filter still excludes A (a successful response cannot resurrect it)', stale.reconciled.visible !== null && idOf(stale.reconciled.visible) === 'B');

  const everything = await doneThenReconcile([soon], at('10:00'), [A], 'A', 'reject', true);
  check('23/35. EVERY reconciliation source fails (plans, habits, habit-logs, my-day, guidance, Aura Updates): A absent from the reminder and from actionable Right Now, completion remains confirmed', everything.result === 'DONE' && everything.reconciled.visible === null && completablePlanId(everything.reconciled.rightNow) === null);

  const failed = await (async () => {
    const holder = { list: [A] as readonly AuraReminder[] };
    const res = await createPlanCompleter((async () => new Response('{}', { status: 500 })) as unknown as typeof fetch)('A');
    const confirmed = new Set<string>(res === 'DONE' ? ['A'] : []);
    return { res, view: home([soon], at('10:00'), confirmed, holder.list) };
  })();
  check('20/36. Done fails BEFORE confirmation: A never enters the confirmed set, its reminder stays and A stays actionable', failed.res === 'FAILED' && idOf(failed.view.visible) === 'A' && completablePlanId(failed.view.rightNow) === 'A');
  const lost = await (async () => {
    const drop = (async () => { throw new TypeError('response lost'); }) as unknown as typeof fetch;
    const first = await createPlanCompleter(drop)('A');
    const confirmedAfterLost = new Set<string>(first === 'DONE' ? ['A'] : []);
    const beforeRetry = home([soon], at('10:00'), confirmedAfterLost, [A]);
    const retry = await createPlanCompleter(okLog('A'))('A');
    const afterRetry = home([soon], at('10:00'), new Set(retry === 'DONE' ? ['A'] : []), [A]);
    return { first, beforeRetry, retry, afterRetry };
  })();
  check('21. LOST response: no local completion is invented (reminder stays); after the idempotent retry confirms LOGGED, the reminder is filtered', lost.first === 'FAILED' && idOf(lost.beforeRetry.visible) === 'A' && lost.retry === 'DONE' && lost.afterRetry.visible === null);

  const oppContext = await doneThenReconcile([soon, bPlan], at('10:00'), [A, B], 'A', 'ok');
  check('17/37. reminder selection is independent of Right Now: after A completes Right Now follows its own hierarchy while the reminder keeps showing the next eligible plan', idOf(oppContext.immediately.visible) === 'B' && oppContext.immediately.rightNow.kind === 'IMMINENT_PLAN');
  const noRightNowButReminder = home([], at('10:00'), new Set(['A']), [B]);
  check('37. absence of a Right Now plan does not force the reminder empty', noRightNowButReminder.rightNow.kind === 'CONTEXT_OPEN' && idOf(noRightNowButReminder.visible) === 'B');

  const mid = plan('mid', 'Late event', at('23:30'), new Date(at('23:30').getTime() + 3600000));
  const midR = await doneThenReconcile([mid], at('23:45'), [reminder('mid', 'Late event', -15)], 'mid', 'reject', true);
  check('40. a midnight-spanning plan with a reminder: Done -> reminder filtered, Right Now excludes it, every refresh failing', midR.before.rightNow.kind === 'ACTIVE_PLAN' && midR.reconciled.visible === null && midR.reconciled.rightNow.kind === 'CONTEXT_OPEN');
  void atNext;

  // ---- wiring ----
  const dash = read('../apps/web/components/HomeDashboard.tsx');
  const page = read('../apps/web/app/page.tsx');
  check('26. auraUpdates state stays in page.tsx (no second copy in Home): Home receives the authoritative list and filters it with its own confirmed ids', /startingSoonReminders=\{auraUpdates\?\.upcoming\}/.test(page) && /const startingSoonReminder = selectVisibleStartingSoonReminder\(startingSoonReminders, executionFacts\)/.test(dash) && !/useState<[^>]*AuraUpdates/.test(dash));
  check('9/26. Aura Updates is refreshed by the existing loader (loadAuraUpdates) as one independent, failure-tolerant reconciliation step', /refreshAuraUpdates: loadAuraUpdates/.test(page) && /safely\(deps\.refreshAuraUpdates\)/.test(read('../apps/web/lib/homeRefresh.ts')));
  check('27. Home-tab entry still refreshes Aura Updates (unchanged)', /if \(activeTab === 'home' \|\| activeTab === 'updates'\) loadAuraUpdates\(\)/.test(page));
  check('24/25. the filter depends only on the confirmed set (not on errors or in-flight state)', !/completingPlanIds|completeError/.test(dash.slice(dash.indexOf('selectVisibleStartingSoonReminder(startingSoonReminders'), dash.indexOf('selectVisibleStartingSoonReminder(startingSoonReminders') + 200)));
  check('17/18. Right Now selection and the Timeline Composer are untouched by this correction', !/reminder|auraUpdates/i.test(read('../apps/web/lib/rightNowSelection.ts') + read('../apps/web/lib/homeTimelineComposer.ts')));
  check('3. completion is unchanged: the reminder module contains no completion, HabitLog, Capture or Goal logic', !/fetch|habit|capture|goal|logPlanned/i.test(read('../apps/web/lib/reminderConsistency.ts').replace(/\/\*[\s\S]*?\*\//g, '')));
  check('no migration by this PR (37 + 0038 from Move D2 + 0039 F1)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 39);

  if (!allPassed) {
    console.error('SOME REMINDER CONSISTENCY CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL REMINDER CONSISTENCY CHECKS PASSED');
}
main();
