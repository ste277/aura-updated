/**
 * Daily Experience V1 PR C2 -- live-DB proof that Home's Skip IS the C1 skip
 * lifecycle: the real Home executor is pointed at the real route handlers
 * (POST /api/plans/[planId]/skip and .../log). Requires DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/homeSkipDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, createPlannedActivity, listPlannedActivitiesForDay, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { createPlanExecutor, skippablePlanId, overlayExecutionFacts, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { POST as skipRoute } from '../apps/web/app/api/plans/[planId]/skip/route';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const iso = (s: string) => new Date(s);
const HOUR = 3600000;
const fakeReq = (cookie?: string): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => ({}) });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: iso(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: iso(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let n = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `home-skip-${Date.now()}-${n++}`, constructionWindow: { date: day, start: iso(`${day}T09:00:00Z`), end: iso(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const A = await upsertUserByEmail({ email: 'test-home-skip-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(A.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokA = createSessionToken(A.id, A.email);
  const planIds: string[] = []; const goalIds: string[] = [];
  const habitCount = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [A.id]))[0].n);
  const row = async (id: string) => (await sql(`SELECT status, "loggedAt", "skippedAt", "habitLogId" FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const routeCalls: string[] = [];
  /** The Home executor's fetch, wired to the real route handlers. */
  const homeFetch = (opts: { dropResponseOnce?: boolean } = {}) => {
    let dropped = false;
    return (async (url: any, init: any) => {
      const m = String(url).match(/^\/api\/plans\/([^/]+)\/(skip|log)$/)!;
      routeCalls.push(`${init?.method} ${m[2]}`);
      const handler = m[2] === 'skip' ? skipRoute : logRoute;
      const res = await handler(fakeReq(tokA), { params: { planId: decodeURIComponent(m[1]) } });
      const body = await res.text();
      if (opts.dropResponseOnce && !dropped) { dropped = true; throw new TypeError('Failed to fetch'); } // server committed; the client never saw it
      return new Response(body, { status: res.status });
    }) as unknown as typeof fetch;
  };
  const save = async (r: AcceptConstructedDayRequest, day: string, cap = new Map<string, string>(), goal = new Map<string, string>()) => {
    const d = await persistAcceptedConstructedDay(A.id, r, iso(`${day}T08:00:00Z`), goal, cap);
    if (d.status === 'SAVED') for (const p of d.plans) planIds.push(p.id);
    return d as any;
  };
  const mkActive = async (title: string) => {
    const p = await createPlannedActivity({ userId: A.id, title: `${title} ${Date.now()}-${n++}`, plannedStartAt: new Date(Date.now() - 10 * 60000), plannedEndAt: new Date(Date.now() + 50 * 60000), durationMinutes: 60, windowType: 'NEUTRAL' });
    planIds.push(p.id);
    return p;
  };
  const homeAfter = async (planId: string, facts: ReadonlyMap<string, ExecutionOutcome>, staleAuthoritative: boolean) => {
    const now = new Date();
    const plans = (await listPlannedActivitiesForDay(A.id, new Date(now.getTime() - 6 * HOUR), new Date(now.getTime() + 6 * HOUR))).filter((p) => p.id === planId).map((p) => (staleAuthoritative ? { ...p, status: 'UPCOMING' as const, skippedAt: null } : p));
    const agenda = buildDailyAgenda({ now, localDate: '2026-01-01', timezone: TZ, plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] });
    const timeline = overlayExecutionFacts(buildHomeTimeline({ agenda, guidance: null, timelineWindows: [], currentMinuteOfDay: 600, timezone: TZ, localDate: '2026-01-01' }), facts);
    return selectRightNowState(timeline, now);
  };

  try {
    // ---- 43/25/26 direct active plan: Home Skip through the real executor + routes ----
    const p1 = await mkActive('Home skip direct');
    const before = await homeAfter(p1.id, new Map(), false);
    const h0 = await habitCount();
    routeCalls.length = 0;
    const r1 = await createPlanExecutor(homeFetch()).skip(p1.id);
    const s1 = await row(p1.id);
    check('43. precondition: the active plan is ACTIVE_PLAN and skippable', before.kind === 'ACTIVE_PLAN' && skippablePlanId(before) === p1.id);
    check('43/25. Home Skip -> server SKIPPED with skippedAt, no loggedAt; only the skip route was called', r1 === 'SKIPPED' && s1.status === 'SKIPPED' && !!s1.skippedAt && s1.loggedAt === null && routeCalls.join() === 'POST skip');
    check('26. Home Skip creates ZERO HabitLogs and never calls the log route', (await habitCount()) === h0 && !routeCalls.includes('POST log'));
    check('25. a source-less plan stays as historical SKIPPED evidence (no source object needed)', s1.habitLogId === null);
    const afterAuth = await homeAfter(p1.id, new Map([[p1.id, 'SKIPPED']]), false);
    const afterStale = await homeAfter(p1.id, new Map([[p1.id, 'SKIPPED']]), true);
    check('11/12/46. after confirmation Right Now is no longer that plan, with fresh AND with stale (UPCOMING) authoritative data', afterAuth.kind === 'CONTEXT_OPEN' && afterStale.kind === 'CONTEXT_OPEN');

    // ---- 35/52 lost response, then retry ----
    const p2 = await mkActive('Home skip lost response');
    const lossy = createPlanExecutor(homeFetch({ dropResponseOnce: true }));
    const lost = await lossy.skip(p2.id);
    const committed = await row(p2.id);
    check('35/52. server COMMITTED SKIPPED but the client got no response: FAILED locally (no confirmation, stays actionable)', lost === 'FAILED' && committed.status === 'SKIPPED' && !!committed.skippedAt);
    const retried = await lossy.skip(p2.id);
    const after2 = await row(p2.id);
    const one = await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE id = $1`, [p2.id]);
    check('35/52. retry returns the idempotent SKIPPED: same skippedAt, one plan, zero HabitLogs, and Home can now confirm the overlay', retried === 'SKIPPED' && after2.skippedAt.getTime() === committed.skippedAt.getTime() && Number(one[0].n) === 1 && (await habitCount()) === h0);

    // ---- 36/37/53 bursts against the real routes ----
    const p3 = await mkActive('Home skip burst');
    routeCalls.length = 0;
    const ex3 = createPlanExecutor(homeFetch());
    const burst = await Promise.all([ex3.skip(p3.id), ex3.skip(p3.id), ex3.skip(p3.id)]);
    const s3 = await row(p3.id);
    check('36. Skip x3 in one task: exactly ONE POST, one durable SKIPPED outcome, zero HabitLogs', routeCalls.length === 1 && burst.filter((r) => r === 'SKIPPED').length === 1 && burst.filter((r) => r === 'BUSY').length === 2 && s3.status === 'SKIPPED' && (await habitCount()) === h0);
    const p4 = await mkActive('Home done then skip');
    routeCalls.length = 0;
    const ex4 = createPlanExecutor(homeFetch());
    const [d4, k4] = await Promise.all([ex4.complete(p4.id), ex4.skip(p4.id)]);
    const s4 = await row(p4.id);
    check('37. Done then Skip before the first response: only Done is issued; plan LOGGED with loggedAt and exactly one HabitLog, no skippedAt', d4 === 'DONE' && k4 === 'BUSY' && routeCalls.join() === 'POST log' && s4.status === 'LOGGED' && !!s4.loggedAt && s4.skippedAt === null && (await habitCount()) === h0 + 1);
    const p5 = await mkActive('Home skip then done');
    routeCalls.length = 0;
    const ex5 = createPlanExecutor(homeFetch());
    const h5 = await habitCount();
    const [k5, d5] = await Promise.all([ex5.skip(p5.id), ex5.complete(p5.id)]);
    const s5 = await row(p5.id);
    check('37. Skip then Done before the first response: only Skip is issued; plan SKIPPED, no HabitLog, no loggedAt', k5 === 'SKIPPED' && d5 === 'BUSY' && routeCalls.join() === 'POST skip' && s5.status === 'SKIPPED' && s5.loggedAt === null && (await habitCount()) === h5);

    // ---- 21/24 Done regression through the same executor ----
    const p6 = await mkActive('Home done regression');
    const h6 = await habitCount();
    const r6 = await createPlanExecutor(homeFetch()).complete(p6.id);
    const s6 = await row(p6.id);
    check('21. Done is unchanged: LOGGED, loggedAt, exactly one HabitLog', r6 === 'DONE' && s6.status === 'LOGGED' && !!s6.loggedAt && !!s6.habitLogId && (await habitCount()) === h6 + 1);

    // ---- 50/23 capture-linked ----
    const cap = await createCapture(A.id, 'Call John');
    const d7 = await save(request('2026-12-08', [item('2026-12-08', 'c1', 'Call John', 10)]), '2026-12-08', new Map([['c1', cap.id]]));
    const p7 = d7.plans[0].id as string;
    const h7 = await habitCount();
    const r7 = await createPlanExecutor(homeFetch()).skip(p7);
    const capRow = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('50/23. Capture-linked plan Home Skip: plan SKIPPED, Capture OPEN, completedAt null, link retained, zero HabitLogs', r7 === 'SKIPPED' && (await row(p7)).status === 'SKIPPED' && capRow.completedAt === null && capRow.plannedActivityId === p7 && deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'OPEN' && (await habitCount()) === h7);

    // ---- 51/24 goal-linked ----
    const goal = await createGoalWithActivities({ userId: A.id, title: 'Home skip goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(A.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const d8 = await save(request('2026-12-09', [item('2026-12-09', 'g1', 'Draft deck', 10)]), '2026-12-09', new Map(), new Map([['g1', ga!.id]]));
    const p8 = d8.plans[0].id as string;
    const h8 = await habitCount();
    const r8 = await createPlanExecutor(homeFetch()).skip(p8);
    const g = (await listGoalActivitiesWithLinkedPlanStatus(A.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('51/24. GoalActivity-linked plan Home Skip: plan SKIPPED, GoalActivity SUGGESTED (never COMPLETED), zero HabitLogs', r8 === 'SKIPPED' && deriveGoalActivityState({ status: g.status, plannedActivityId: g.plannedActivityId, linkedPlanStatus: g.linkedPlanStatus }) === 'SUGGESTED' && (await habitCount()) === h8);

    // ---- 34 failures: unknown / invalid states keep the plan actionable in Home ----
    const cancelledPlan = await mkActive('Home skip cancelled');
    await sql(`UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE id = $1`, [cancelledPlan.id]);
    const rc = await createPlanExecutor(homeFetch()).skip(cancelledPlan.id);
    check('6/44. Skip of a plan the server cannot skip (409) is FAILED: no confirmation is produced and the row is unchanged', rc === 'FAILED' && (await row(cancelledPlan.id)).status === 'CANCELLED');
  } finally {
    for (const id of planIds) {
      await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "plannedActivityId" = $1`, [id]).catch(() => {});
      await sql(`DELETE FROM "PlannedActivity" WHERE id = $1`, [id]).catch(() => {});
    }
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [A.id]).catch(() => {});
    for (const gId of goalIds) await deleteGoal(A.id, gId).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [A.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME HOME SKIP DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME SKIP DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
