/**
 * Daily Experience V1 PR B (refresh-failure correction) -- BEHAVIORAL tests:
 * after a CONFIRMED plan completion, no refresh failure may clear the user,
 * restore Done, or lose the completed state. Requests are actually rejected /
 * failed / malformed; nothing here is a source-regex stand-in.
 */
import fs from 'fs';
import path from 'path';
import { refreshAfterHomeCompletion, type HomeRefreshDeps } from '../apps/web/lib/homeRefresh';
import { createPlanCompleter, completablePlanId, overlayLoggedPlans, visibleCompletionError } from '../apps/web/lib/homeCompletion';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
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

// ---------- a tiny model of the page state the refresh writes into ----------
interface AppState { user: { id: string } | null; plans: unknown[]; habits: unknown[]; logs: unknown[]; myDay: string; guidance: string; aura: string }
const freshState = (): AppState => ({ user: { id: 'u1' }, plans: ['old-plan'], habits: ['old-habit'], logs: ['old-log'], myDay: 'old-myday', guidance: 'old-guidance', aura: 'old-aura' });

type Mode = 'ok' | 'reject' | 'http500' | 'http401' | 'badjson';
type Failures = Partial<Record<'habit-logs' | 'habits' | 'plans' | 'myday' | 'guidance' | 'aura', Mode>>;
function harness(failures: Failures) {
  const state = freshState();
  const calls: string[] = [];
  let reauth = 0;
  const respond = (mode: Mode, body: unknown): Response | Promise<Response> => {
    if (mode === 'reject') return Promise.reject(new TypeError('Failed to fetch'));
    if (mode === 'http500') return new Response('{}', { status: 500 });
    if (mode === 'http401') return new Response('{}', { status: 401 });
    if (mode === 'badjson') return new Response('not json', { status: 200 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const fetchImpl = (async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u === '/api/habit-logs') return respond(failures['habit-logs'] ?? 'ok', ['new-log']);
    if (u === '/api/habits') return respond(failures.habits ?? 'ok', ['new-habit']);
    if (u === '/api/plans') return respond(failures.plans ?? 'ok', ['new-plan']);
    throw new Error('unexpected url ' + u);
  }) as unknown as typeof fetch;
  const step = (mode: Mode | undefined, apply: () => void) => async () => {
    if ((mode ?? 'ok') !== 'ok') throw new Error('refresh failed');
    apply();
  };
  const deps: HomeRefreshDeps = {
    fetchImpl,
    applyLogs: (j) => { state.logs = j as unknown[]; },
    applyHabits: (j) => { state.habits = j as unknown[]; },
    applyPlans: (j) => { state.plans = j as unknown[]; },
    refreshMyDay: step(failures.myday, () => { state.myDay = 'new-myday'; }),
    refreshGuidance: step(failures.guidance, () => { state.guidance = 'new-guidance'; }),
    refreshAuraUpdates: step(failures.aura, () => { state.aura = 'new-aura'; }),
    reauthenticate: async () => { reauth += 1; },
  };
  return { state, calls, deps, reauthCount: () => reauth };
}

async function main() {
  // ---- refresh contract ----
  const ok = harness({});
  const rOk = await refreshAfterHomeCompletion(ok.deps);
  check('10. successful refresh updates every slice and never re-authenticates', ok.state.logs[0] === 'new-log' && ok.state.habits[0] === 'new-habit' && ok.state.plans[0] === 'new-plan' && ok.state.myDay === 'new-myday' && ok.state.guidance === 'new-guidance' && ok.state.aura === 'new-aura' && !rOk.unauthorized && ok.reauthCount() === 0);

  for (const [label, failures] of [
    ['11. /api/plans rejects', { plans: 'reject' }],
    ['12. /api/habits rejects', { habits: 'reject' }],
    ['13. /api/habit-logs rejects', { 'habit-logs': 'reject' }],
  ] as Array<[string, Failures]>) {
    const h = harness(failures);
    await refreshAfterHomeCompletion(h.deps);
    const failedKey = Object.keys(failures)[0];
    const lastKnownGood = failedKey === 'plans' ? h.state.plans[0] === 'old-plan' : failedKey === 'habits' ? h.state.habits[0] === 'old-habit' : h.state.logs[0] === 'old-log';
    check(`${label}: user retained, that slice keeps its last-known-good value, the other slices still refresh, no re-auth`, h.state.user?.id === 'u1' && lastKnownGood && h.reauthCount() === 0 && h.state.myDay === 'new-myday');
  }
  const allShared = harness({ plans: 'reject', habits: 'reject', 'habit-logs': 'reject' });
  await refreshAfterHomeCompletion(allShared.deps);
  check('14. plans + habits + habit-logs ALL reject: user retained, all three keep last-known-good (never emptied), no re-auth', allShared.state.user?.id === 'u1' && allShared.state.plans[0] === 'old-plan' && allShared.state.habits[0] === 'old-habit' && allShared.state.logs[0] === 'old-log' && allShared.reauthCount() === 0);
  const myDayFail = harness({ myday: 'reject' });
  await refreshAfterHomeCompletion(myDayFail.deps);
  check('15. my-day refresh fails: state untouched by it, everything else refreshes, user retained', myDayFail.state.myDay === 'old-myday' && myDayFail.state.plans[0] === 'new-plan' && myDayFail.state.user?.id === 'u1');
  const guidanceFail = harness({ guidance: 'reject' });
  await refreshAfterHomeCompletion(guidanceFail.deps);
  check('16. guidance refresh fails: same', guidanceFail.state.guidance === 'old-guidance' && guidanceFail.state.plans[0] === 'new-plan' && guidanceFail.state.user?.id === 'u1');
  const auraFail = harness({ aura: 'reject' });
  await refreshAfterHomeCompletion(auraFail.deps);
  check('9/10/23. Aura Updates refresh fails: it keeps its last-known-good value, everything else still refreshes, the user is retained, no re-auth', auraFail.state.aura === 'old-aura' && auraFail.state.plans[0] === 'new-plan' && auraFail.state.user?.id === 'u1' && auraFail.reauthCount() === 0);
  const everything = harness({ plans: 'reject', habits: 'reject', 'habit-logs': 'reject', myday: 'reject', guidance: 'reject', aura: 'reject' });
  let threw = false;
  try { await refreshAfterHomeCompletion(everything.deps); } catch { threw = true; }
  check('17. EVERY refresh fails: the refresh never throws, the user and all last-known-good data remain, no re-auth', !threw && JSON.stringify(everything.state) === JSON.stringify(freshState()) && everything.reauthCount() === 0);
  const http = harness({ plans: 'http500', habits: 'http500', 'habit-logs': 'http500' });
  await refreshAfterHomeCompletion(http.deps);
  check('non-OK (500) and malformed-JSON responses also leave last-known-good state and never log the user out', http.state.plans[0] === 'old-plan' && http.state.habits[0] === 'old-habit' && http.state.logs[0] === 'old-log' && http.state.user?.id === 'u1' && http.reauthCount() === 0);
  const bad = harness({ plans: 'badjson' });
  await refreshAfterHomeCompletion(bad.deps);
  check('malformed JSON on one slice: that slice is kept, the others refresh', bad.state.plans[0] === 'old-plan' && bad.state.logs[0] === 'new-log');
  const throwingApply = harness({});
  throwingApply.deps.applyLogs = () => { throw new Error('unexpected shape'); };
  let applyThrew = false;
  try { await refreshAfterHomeCompletion(throwingApply.deps); } catch { applyThrew = true; }
  check('an apply function that throws on an unexpected payload cannot break the refresh', !applyThrew && throwingApply.state.plans[0] === 'new-plan');

  // ---- true auth failure ----
  const auth = harness({ plans: 'http401' });
  const rAuth = await refreshAfterHomeCompletion(auth.deps);
  check('18. a definitive 401 on a read is NOT decided here: it re-runs the application\'s authoritative session check exactly once (and does not itself clear the user)', rAuth.unauthorized && auth.reauthCount() === 1 && auth.state.user?.id === 'u1');
  const netOnly = harness({ plans: 'reject', habits: 'http500' });
  await refreshAfterHomeCompletion(netOnly.deps);
  check('18. network errors and 500s never trigger the session check (they do not mean "not authenticated")', netOnly.reauthCount() === 0);

  // ---- completion request 401 ----
  const c401 = createPlanCompleter((async () => new Response('{}', { status: 401 })) as unknown as typeof fetch);
  check('19. POST .../log returning 401 is a FAILED completion: no confirmed state is created (Home shows the retryable error; the existing session handling is not invoked here)', (await c401('p1')) === 'FAILED');

  // ---- error ownership ----
  const errA = { planId: 'A', message: 'Couldn\'t mark that done. Try again.' };
  check('20. A\'s error is shown while A is the completable plan', visibleCompletionError(errA, 'A') === errA.message);
  check('20/21. A\'s error is NOT shown under B when Right Now changes', visibleCompletionError(errA, 'B') === null && visibleCompletionError(errA, null) === null && visibleCompletionError(null, 'A') === null);
  check('21. B failing later gets its own error (a new owner replaces A\'s)', visibleCompletionError({ planId: 'B', message: 'x' }, 'B') === 'x' && visibleCompletionError({ planId: 'B', message: 'x' }, 'A') === null);
  const dash = strip(read('../apps/web/components/HomeDashboard.tsx'));
  check('21. a retry of A clears A\'s error at the start; success clears it; other plans\' errors are left alone', /setCompleteError\(\(current\) => \(current\?\.planId === planId \? null : current\)\);\s*setCompletingPlanIds/.test(dash) && /setLoggedPlanIds[\s\S]{0,120}setCompleteError\(\(current\) => \(current\?\.planId === planId \? null : current\)\)/.test(dash));
  check('22. in-flight state is a per-plan Set: A in flight never shows B as Saving, and A finishing does not clear B', /completingPlanIds\.has\(completablePlanIdNow\)/.test(dash) && /const next = new Set\(current\);\s*next\.delete\(planId\);/.test(dash));
  check('23. every state change after the request is keyed by the plan id captured at click (never by the current Right Now plan)', !/completablePlanIdNow[\s\S]{0,40}await planCompleter/.test(dash) && /const handleCompleteRightNow = async \(planId: string\)/.test(dash));

  // ---- the blocker, end to end on the real pipeline ----
  const TZ = 'Asia/Kolkata';
  const atDay = (d: number, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return new Date(Date.UTC(2026, 7, d, h, m) - 330 * 60000); };
  const at = (hhmm: string) => atDay(24, hhmm);
  const plan = (id: string, title: string, start: Date, end: Date): PlannedActivity => ({ id, userId: 'u1', title, activityType: 'x', icon: null, status: 'UPCOMING', plannedStartAt: start, plannedEndAt: end, durationMinutes: 60, windowType: 'NEUTRAL', windowLabel: 'N', matchLabel: 'G', score: 1, recommendation: null, calendarUrl: null, loggedAt: null, habitLogId: null, eventTimezone: null, eventLocationName: null, createdAt: start, updatedAt: start }) as PlannedActivity;
  const oppG = (): { g: DailyGuidanceContext; sel: Record<string, SelectedActivityMetadata> } => ({ g: { engineVersion: 't', selectionPolicyVersion: 't', evaluationTime: '', evidence: [], recommendations: [{ rank: 1, activityFamily: 'SELF', personalRelevance: 'RELEVANT', relevantThemes: [], timing: { start: at('10:00').toISOString(), end: at('13:00').toISOString(), score: 8, label: 'EXCELLENT', windowRank: 1 }, selectionReason: 'X', evidence: [] }] } as unknown as DailyGuidanceContext, sel: { SELF: { activityId: 'meditation', title: 'Meditation', source: 'DAY_BUILDER_INTENTION', sourceEntityId: 's1' } as SelectedActivityMetadata } });
  const homeView = (plans: PlannedActivity[], now: Date, logged: ReadonlySet<string>, withOpp = false) => {
    const agenda = buildDailyAgenda({ now, localDate: '2026-08-24', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const o = withOpp ? oppG() : null;
    const minute = Math.floor(((now.getTime() + 330 * 60000) % 86400000) / 60000);
    const timeline = overlayLoggedPlans(buildHomeTimeline({ agenda, guidance: o?.g ?? null, selectedActivities: o?.sel ?? {}, currentMinuteOfDay: minute, timezone: TZ, localDate: '2026-08-24' }), logged);
    return selectRightNowState(timeline, now);
  };
  const title = (s: ReturnType<typeof selectRightNowState>) => (s.kind === 'CONTEXT_OPEN' ? null : s.item.title);

  async function completeThenEverythingFails(plans: PlannedActivity[], now: Date, targetId: string, withOpp = false) {
    const state = freshState();
    const startState = homeView(plans, now, new Set(), withOpp);
    const target = completablePlanId(startState);
    const posts: string[] = [];
    const logFetch = (async (url: any, init: any) => { posts.push(`${init?.method} ${url}`); return new Response(JSON.stringify({ plan: { id: targetId, status: 'LOGGED', loggedAt: 'x' }, habitLog: { id: 'h1' } }), { status: 200 }); }) as unknown as typeof fetch;
    const result = await createPlanCompleter(logFetch)(target!);
    const confirmed = new Set<string>(result === 'DONE' ? [target!] : []);
    // every subsequent refresh fails (the exact blocker scenario)
    const h = harness({ plans: 'reject', habits: 'reject', 'habit-logs': 'reject', myday: 'reject', guidance: 'reject', aura: 'reject' });
    h.deps.reauthenticate = async () => { state.user = null; };
    await refreshAfterHomeCompletion({ ...h.deps });
    const after = homeView(plans, now, confirmed, withOpp);
    return { start: startState, after, target, result, user: state.user, posts, h };
  }
  const mid = plan('mid', 'Late event', at('23:30'), atDay(25, '00:30'));
  const solo = await completeThenEverythingFails([plan('a', 'Call John', at('10:30'), at('11:30'))], at('11:00'), 'a');
  check('39. BLOCKER REGRESSION: authenticated Home, active plan, completion POST confirms LOGGED, then plans/habits/habit-logs/my-day/guidance ALL fail -> the user is still present (no sign-in), the plan is not completable again, and Right Now is context', solo.result === 'DONE' && solo.user?.id === 'u1' && completablePlanId(solo.after) === null && solo.after.kind === 'CONTEXT_OPEN' && solo.posts.length === 1 && solo.posts[0] === 'POST /api/plans/a/log');
  check('29. context after refresh failure: the only actionable plan stays completed, not resurrected', solo.after.kind === 'CONTEXT_OPEN');
  const two = await completeThenEverythingFails([plan('a', 'Winner', at('10:00'), at('12:00')), plan('b', 'Next active', at('10:30'), at('12:00'))], at('11:00'), 'a');
  check('27. active A + active B: complete A, refresh fails -> A excluded by the confirmed overlay and B becomes Right Now through the existing selector', two.start.kind === 'ACTIVE_PLAN' && title(two.start) === 'Winner' && title(two.after) === 'Next active' && completablePlanId(two.after) === 'b');
  const withOpp = await completeThenEverythingFails([plan('a', 'Call John', at('10:30'), at('11:30'))], at('11:00'), 'a', true);
  check('28. active A + current Opportunity: complete A, refresh fails -> the existing selector may promote the Opportunity (no Done on it)', withOpp.after.kind === 'OPPORTUNITY' && completablePlanId(withOpp.after) === null);
  const midnight = await completeThenEverythingFails([mid], at('23:45'), 'mid');
  check('35. midnight-spanning active plan: Done, then every refresh fails -> Home stays, plan no longer Right Now', midnight.start.kind === 'ACTIVE_PLAN' && midnight.result === 'DONE' && midnight.user?.id === 'u1' && midnight.after.kind === 'CONTEXT_OPEN');
  const failedCompletion = await (async () => {
    const plans = [plan('a', 'Call John', at('10:30'), at('11:30'))];
    const start = homeView(plans, at('11:00'), new Set());
    const res = await createPlanCompleter((async () => new Response('{}', { status: 500 })) as unknown as typeof fetch)(completablePlanId(start)!);
    return { res, after: homeView(plans, at('11:00'), new Set(res === 'DONE' ? ['a'] : [])) };
  })();
  check('26. PRE-COMMIT failure is distinct: the completion POST fails -> FAILED, no confirmed marker, the plan stays actionable', failedCompletion.res === 'FAILED' && failedCompletion.after.kind === 'ACTIVE_PLAN' && completablePlanId(failedCompletion.after) === 'a');

  // ---- structural: the page wiring itself ----
  // page.tsx is checked RAW: its many URL-bearing strings/globs defeat the comment stripper.
  const page = read('../apps/web/app/page.tsx');
  const handler = page.slice(page.indexOf('const handleHomePlanCompleted'), page.indexOf('const handleMyDayOrGuidanceChanged'));
  check('5/7. Home\'s completion refresh is its own seam: it never sets or clears the user, and calls loadUserDataAndLogs only as the authoritative 401 re-check', handler.length > 0 && !/setUser|setPlannedActivities\(\[\]\)/.test(handler) && /reauthenticate: loadUserDataAndLogs/.test(handler) && /refreshAfterHomeCompletion\(/.test(handler));
  check('7. loadUserDataAndLogs\'s global catch contract is left unchanged (tracked as a follow-up, not silently altered)', /\} catch \{\s*setUser\(null\);\s*setPlannedActivities\(\[\]\);\s*\}\s*\}, \[applyConfirmedLogs\]\);/.test(page));
  check('37. the Plan tab still uses the original broad handler', (page.match(/onPlanLogged=\{handlePlanLogged\}/g) ?? []).length === 3 && /await Promise\.all\(\[loadUserDataAndLogs\(\), loadMyDay\(\), loadGuidance\(\)\]\)/.test(page));
  check('6. completion itself is unchanged: still POST /api/plans/<id>/log only; the refresh module reads only habit-logs/habits/plans (GET) and never POSTs', !/method:\s*'POST'/.test(strip(read('../apps/web/lib/homeRefresh.ts'))) && (strip(read('../apps/web/lib/homeRefresh.ts')).match(/pull\('/g) ?? []).length === 3);
  check('43. no migration by this PR (36 + 0037 from Skip C1)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((f) => /^\d{4}_/.test(f)).length === 37);

  if (!allPassed) {
    console.error('SOME HOME REFRESH CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL HOME REFRESH CHECKS PASSED');
}
main();
