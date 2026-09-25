/**
 * Daily Experience V1 PR E -- Missed Recovery: the real Home executor pointed
 * at the real log / skip / move routes for an ELAPSED, still-UPCOMING plan (the
 * persisted shape of a derived-MISSED occurrence). Proves the existing domains
 * already permit MISSED -> Done / Skip / Move, that source continuity and
 * HabitLog rules are unchanged, that the persisted status is never MISSED, and
 * that concurrent recovery actions produce exactly one terminal outcome.
 * Requires DATABASE_URL.
 */
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, listPlannedActivitiesForDay, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { createPlanExecutor, overlayExecutionFacts, type ExecutionOutcome } from '../apps/web/lib/homeCompletion';
import { applyConfirmedSuccessors, hideMovedTimelineItems } from '../apps/web/lib/homeMove';
import { missedRecoveryPlanId, overlayElapsedMissed } from '../apps/web/lib/homeMissedRecovery';
import { buildDailyAgenda } from '../apps/web/lib/dailyAgenda';
import { buildHomeTimeline } from '../apps/web/lib/homeTimelineComposer';
import { POST as moveRoute } from '../apps/web/app/api/plans/[planId]/move/route';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';
import { POST as skipRoute } from '../apps/web/app/api/plans/[planId]/skip/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const HOUR = 3600000; const DAY = 86400000;
const minute = (ms: number) => Math.floor(ms / MIN) * MIN;
const fakeReq = (cookie: string | undefined, body: unknown): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => body, headers: new Headers() });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let reqN = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `missed-recovery-${Date.now()}-${reqN++}`, constructionWindow: { date: day, start: new Date(`${day}T09:00:00Z`), end: new Date(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const U = await upsertUserByEmail({ email: 'test-missed-recovery@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email);
  const goalIds: string[] = [];
  let n = 0; let day = 0;
  const routeCalls: string[] = [];
  /** The Home executor's fetch, wired to the real route handlers. */
  const homeFetch = () => (async (url: any, init: any) => {
    const m = String(url).match(/^\/api\/plans\/([^/]+)\/(move|log|skip)$/)!;
    routeCalls.push(`${init?.method} ${m[2]}`);
    const handler = m[2] === 'move' ? moveRoute : m[2] === 'log' ? logRoute : skipRoute;
    const res = await handler(fakeReq(tok, init?.body ? JSON.parse(init.body) : {}), { params: { planId: decodeURIComponent(m[1]) } });
    return new Response(await res.text(), { status: res.status });
  }) as unknown as typeof fetch;
  /** An ELAPSED, still-UPCOMING plan: what a derived-MISSED occurrence is in the database. */
  const missed = async (title: string) => {
    const end = minute(Date.now()) - (2 + (n % 5)) * HOUR - n * MIN; n++;
    return createPlannedActivity({ userId: U.id, title: `${title} ${Date.now()}-${n}`, plannedStartAt: new Date(end - 60 * MIN), plannedEndAt: new Date(end), durationMinutes: 60, windowType: 'NEUTRAL' });
  };
  const dest = () => new Date(minute(Date.now()) + 60 * DAY + n++ * 3 * HOUR);
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const habits = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [U.id]))[0].n);
  const successorCount = async (id: string) => Number((await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "rescheduledFromPlanId" = $1`, [id]))[0].n);
  const nextDay = () => new Date(Date.UTC(2027, 1, 1 + day++)).toISOString().slice(0, 10);
  /** A source-linked plan (via the real acceptance path), then pushed into the past so it is elapsed + UPCOMING. */
  const acceptElapsed = async (map: { cap?: string; goal?: string }, title: string) => {
    const d = nextDay();
    const res = (await persistAcceptedConstructedDay(U.id, request(d, [item(d, 'i1', title, 10)]), new Date(`${d}T08:00:00Z`), new Map(map.goal ? [['i1', map.goal]] : []), new Map(map.cap ? [['i1', map.cap]] : []))) as any;
    const id = res.plans[0].id as string;
    const end = minute(Date.now()) - 3 * HOUR;
    await sql(`UPDATE "PlannedActivity" SET "plannedStartAt" = $2, "plannedEndAt" = $3 WHERE id = $1`, [id, new Date(end - 30 * MIN), new Date(end)]);
    return id;
  };
  const homeView = async (f: ReadonlyMap<string, ExecutionOutcome>, successors: ReadonlyMap<string, any>, plansOverride?: any[]) => {
    const now = new Date();
    const plans = plansOverride ?? (await listPlannedActivitiesForDay(U.id, new Date(now.getTime() - 12 * HOUR), new Date(now.getTime() + 60 * HOUR)));
    const agenda = applyConfirmedSuccessors(buildDailyAgenda({ now, localDate: now.toISOString().slice(0, 10), timezone: 'UTC', plans, moments: [], momentIdsWithSuccessor: new Set(), habitLogs: [] }), successors, now);
    const tl = hideMovedTimelineItems(overlayExecutionFacts(overlayElapsedMissed(buildHomeTimeline({ agenda, guidance: null, timelineWindows: [], currentMinuteOfDay: 600, timezone: 'UTC', localDate: agenda.localDate }), now), f));
    return { tl, recoverable: tl.map((i) => missedRecoveryPlanId(i, now, f)).filter((x): x is string => x !== null) };
  };

  try {
    // ---- the persisted shape of MISSED: elapsed + UPCOMING (never a MISSED status) ----
    const p0 = await missed('Persisted shape');
    const shape = await row(p0.id);
    const view0 = await homeView(new Map(), new Map());
    check('3/4/63. an elapsed plan is persisted as plain UPCOMING (MISSED is derived only) and Home derives it as recoverable', shape.status === 'UPCOMING' && view0.tl.find((i) => i.id === `plan:${p0.id}`)?.metadata?.agendaStatus === 'MISSED' && view0.recoverable.includes(p0.id));

    // ---- MISSED -> Done (existing log route) ----
    const h0 = await habits();
    const d1 = await missed('Done recovery');
    routeCalls.length = 0;
    const t0 = Date.now();
    const done = await createPlanExecutor(homeFetch()).complete(d1.id);
    const D1 = await row(d1.id);
    check('63/8. MISSED -> Done through Home -> POST log: the elapsed UPCOMING plan is LOGGED (no clock-time rejection); only the log route was called', done === 'DONE' && D1.status === 'LOGGED' && routeCalls.join() === 'POST log');
    check('9. completion timestamp semantics preserved: loggedAt is the server execution time (now), NOT a reconstructed planned end/start', !!D1.loggedAt && Math.abs(new Date(D1.loggedAt).getTime() - t0) < 30000 && new Date(D1.loggedAt).getTime() !== new Date(D1.plannedEndAt).getTime() && new Date(D1.loggedAt).getTime() > new Date(D1.plannedEndAt).getTime() + HOUR);
    check('51/66. Done follows the existing HabitLog semantics: exactly one HabitLog, linked to the plan', (await habits()) === h0 + 1 && !!D1.habitLogId);
    const doneView = await homeView(new Map([[d1.id, 'COMPLETED' as ExecutionOutcome]]), new Map());
    check('24. Done projection: Completed, not Missed, no recovery controls', doneView.tl.find((i) => i.id === `plan:${d1.id}`)?.metadata?.agendaStatus === 'COMPLETED' && !doneView.recoverable.includes(d1.id));

    // ---- MISSED -> Skip (existing skip route) ----
    const h1 = await habits();
    const s1 = await missed('Skip recovery');
    routeCalls.length = 0;
    const skipped = await createPlanExecutor(homeFetch()).skip(s1.id);
    const S1 = await row(s1.id);
    check('63/11. MISSED -> Skip through Home -> POST skip: the elapsed UPCOMING plan is SKIPPED with skippedAt set; only the skip route was called', skipped === 'SKIPPED' && S1.status === 'SKIPPED' && !!S1.skippedAt && routeCalls.join() === 'POST skip');
    check('11/66. Skip creates zero HabitLogs and no completion', (await habits()) === h1 && S1.habitLogId === null && S1.loggedAt === null);
    const skipView = await homeView(new Map([[s1.id, 'SKIPPED' as ExecutionOutcome]]), new Map());
    check('25. Skip projection: Skipped, no recovery controls', skipView.tl.find((i) => i.id === `plan:${s1.id}`)?.metadata?.agendaStatus === 'SKIPPED' && !skipView.recoverable.includes(s1.id));

    // ---- MISSED -> Move (existing move route) ----
    const h2 = await habits();
    const m1 = await missed('Move recovery');
    routeCalls.length = 0;
    const dM = dest();
    const moved = await createPlanExecutor(homeFetch()).move(m1.id, dM.toISOString());
    const M1 = await row(m1.id);
    const succ = moved.status === 'MOVED' ? (moved as any).successor : null;
    check('63/13. MISSED -> Move through Home -> POST move: A MOVED, a NEW UPCOMING successor B at exactly the requested instant with the original duration, linked back to A; only the move route was called', moved.status === 'MOVED' && M1.status === 'MOVED' && succ.status === 'UPCOMING' && new Date(succ.plannedStartAt).getTime() === dM.getTime() && succ.durationMinutes === 60 && succ.rescheduledFromPlanId === m1.id && routeCalls.join() === 'POST move');
    check('13/66. Move creates zero HabitLogs', (await habits()) === h2 && M1.habitLogId === null);
    const moveView = await homeView(new Map([[m1.id, 'MOVED' as ExecutionOutcome]]), new Map([[m1.id, succ]]));
    check('26. Move projection: A no longer appears as recoverable MISSED (hidden); B (future) is not missed', !moveView.tl.some((i) => i.id === `plan:${m1.id}`) && !moveView.recoverable.includes(m1.id) && !moveView.recoverable.includes(succ.id));
    const staleMove = await homeView(new Map([[m1.id, 'MOVED' as ExecutionOutcome]]), new Map([[m1.id, succ]]), [{ ...M1, status: 'UPCOMING', plannedStartAt: new Date(M1.plannedStartAt), plannedEndAt: new Date(M1.plannedEndAt) }]);
    check('29/62. STALE authoritative data (A still elapsed UPCOMING) + the confirmed Move: A is still not recoverable', staleMove.recoverable.length === 0);

    // ---- persisted status never becomes MISSED ----
    const statuses = (await sql(`SELECT DISTINCT status FROM "PlannedActivity" WHERE "userId" = $1`, [U.id])).map((r) => r.status);
    check('3/63. no persisted MISSED status exists after every recovery path ran', !statuses.includes('MISSED') && statuses.every((s: string) => ['UPCOMING', 'LOGGED', 'SKIPPED', 'MOVED', 'CANCELLED'].includes(s)));

    // ---- Capture source semantics (owned by the existing domains; Home knows none of it) ----
    const capDone = await createCapture(U.id, 'Missed capture done');
    const capDonePlan = await acceptElapsed({ cap: capDone.id }, 'Missed capture done');
    check('64. Capture MISSED -> Done: the plan is LOGGED and the Capture derives COMPLETED (existing log semantics)', (await createPlanExecutor(homeFetch()).complete(capDonePlan)) === 'DONE' && (await (async () => { const c = (await getCaptureWithLinkedPlanStatus(U.id, capDone.id))!; return deriveCaptureState({ status: c.status, completedAt: c.completedAt, linkedPlanStatus: c.linkedPlanStatus }) === 'COMPLETED'; })()));
    const capSkip = await createCapture(U.id, 'Missed capture skip');
    const capSkipPlan = await acceptElapsed({ cap: capSkip.id }, 'Missed capture skip');
    const hCap = await habits();
    check('64. Capture MISSED -> Skip: the plan is SKIPPED and the Capture derives OPEN again (existing Skip derivation); no completion, no HabitLog', (await createPlanExecutor(homeFetch()).skip(capSkipPlan)) === 'SKIPPED' && (await (async () => { const c = (await getCaptureWithLinkedPlanStatus(U.id, capSkip.id))!; return deriveCaptureState({ status: c.status, completedAt: c.completedAt, linkedPlanStatus: c.linkedPlanStatus }) === 'OPEN' && c.completedAt === null; })()) && (await habits()) === hCap);
    const capMove = await createCapture(U.id, 'Missed capture move');
    const capMovePlan = await acceptElapsed({ cap: capMove.id }, 'Missed capture move');
    const rcm = await createPlanExecutor(homeFetch()).move(capMovePlan, dest().toISOString());
    const capMoveRow = (await getCaptureWithLinkedPlanStatus(U.id, capMove.id))!;
    check('64. Capture MISSED -> Move: A MOVED, B UPCOMING, the Capture points at B and stays PLANNED (not completed)', rcm.status === 'MOVED' && (await row(capMovePlan)).status === 'MOVED' && capMoveRow.plannedActivityId === (rcm as any).successor.id && deriveCaptureState({ status: capMoveRow.status, completedAt: capMoveRow.completedAt, linkedPlanStatus: capMoveRow.linkedPlanStatus }) === 'PLANNED' && capMoveRow.completedAt === null);

    // ---- GoalActivity source semantics ----
    const goal = await createGoalWithActivities({ userId: U.id, title: 'Missed recovery goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const gaState = async (id: string) => { const r = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((x) => x.id === id)!; return { r, state: deriveGoalActivityState({ status: r.status, plannedActivityId: r.plannedActivityId, linkedPlanStatus: r.linkedPlanStatus }) }; };
    const gaDone = await addGoalActivity(U.id, goal.goal.id, { title: 'Goal done', activityId: null });
    const gaDonePlan = await acceptElapsed({ goal: gaDone!.id }, 'Goal done');
    check('65. GoalActivity MISSED -> Done: the plan is LOGGED and the GoalActivity derives COMPLETED', (await createPlanExecutor(homeFetch()).complete(gaDonePlan)) === 'DONE' && (await gaState(gaDone!.id)).state === 'COMPLETED');
    const gaSkip = await addGoalActivity(U.id, goal.goal.id, { title: 'Goal skip', activityId: null });
    const gaSkipPlan = await acceptElapsed({ goal: gaSkip!.id }, 'Goal skip');
    check('65. GoalActivity MISSED -> Skip: the plan is SKIPPED and the GoalActivity returns to SUGGESTED (existing Skip derivation)', (await createPlanExecutor(homeFetch()).skip(gaSkipPlan)) === 'SKIPPED' && (await gaState(gaSkip!.id)).state === 'SUGGESTED');
    const gaMove = await addGoalActivity(U.id, goal.goal.id, { title: 'Goal move', activityId: null });
    const gaMovePlan = await acceptElapsed({ goal: gaMove!.id }, 'Goal move');
    const rgm = await createPlanExecutor(homeFetch()).move(gaMovePlan, dest().toISOString());
    const gm = await gaState(gaMove!.id);
    check('65. GoalActivity MISSED -> Move: A MOVED, B UPCOMING, the GoalActivity points at B and stays PLANNED', rgm.status === 'MOVED' && gm.r.plannedActivityId === (rgm as any).successor.id && gm.state === 'PLANNED');

    // ---- cross-midnight elapsed plan is recoverable end to end ----
    const startOfUtcToday = Math.floor(Date.now() / DAY) * DAY;
    const xEnd = Math.min(startOfUtcToday + 30 * MIN, Date.now() - HOUR);
    const xPlan = await createPlannedActivity({ userId: U.id, title: `Cross midnight ${Date.now()}`, plannedStartAt: new Date(xEnd - 3 * HOUR), plannedEndAt: new Date(xEnd), durationMinutes: 180, windowType: 'NEUTRAL' });
    check('42. an elapsed plan that crossed midnight (starts the previous UTC day) can be logged (absolute instants, no minute-of-day rule)', (await createPlanExecutor(homeFetch()).complete(xPlan.id)) === 'DONE' && (await row(xPlan.id)).status === 'LOGGED');

    // ---- 67. races on an elapsed plan: exactly one terminal outcome, never a hybrid ----
    const race = async (label: string, a: (e: ReturnType<typeof createPlanExecutor>, id: string) => Promise<any>, b: (e: ReturnType<typeof createPlanExecutor>, id: string) => Promise<any>) => {
      let clean = true; let outcomes = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const p = await missed(`Race ${label}`);
        const hb = await habits();
        await Promise.all([a(createPlanExecutor(homeFetch()), p.id), b(createPlanExecutor(homeFetch()), p.id)]); // two independent Home sessions: only the server can arbitrate
        const f = await row(p.id);
        const succN = await successorCount(p.id);
        const hd = (await habits()) - hb;
        outcomes.add(f.status);
        const consistent = (f.status === 'LOGGED' && hd === 1 && succN === 0 && !!f.habitLogId) || (f.status === 'SKIPPED' && hd === 0 && succN === 0 && f.habitLogId === null) || (f.status === 'MOVED' && hd === 0 && succN === 1 && f.habitLogId === null);
        if (!consistent) clean = false;
      }
      check(`67. ${label} on an elapsed plan (4 rounds, two Home sessions): each round ends in exactly ONE terminal state with matching HabitLog/successor evidence (outcomes seen: ${[...outcomes].join('/')})`, clean);
    };
    await race('Done vs Skip', (e, id) => e.complete(id), (e, id) => e.skip(id));
    await race('Done vs Move', (e, id) => e.complete(id), (e, id) => e.move(id, dest().toISOString()));
    await race('Skip vs Move', (e, id) => e.skip(id), (e, id) => e.move(id, dest().toISOString()));
    await race('Move vs Move', (e, id) => e.move(id, dest().toISOString()), (e, id) => e.move(id, dest().toISOString()));

    // ---- one Home session: a same-plan burst issues one request ----
    const burstPlan = await missed('Burst');
    routeCalls.length = 0;
    const ex = createPlanExecutor(homeFetch());
    const [r1, r2, r3] = await Promise.all([ex.complete(burstPlan.id), ex.skip(burstPlan.id), ex.move(burstPlan.id, dest().toISOString())]);
    check('20/61. Done + Skip + Move from one Home session for the same elapsed plan: one lifecycle request, the others BUSY, one terminal state', routeCalls.length === 1 && [r1, r2, (r3 as any).status].filter((x) => x === 'BUSY').length === 2 && ['LOGGED', 'SKIPPED', 'MOVED'].includes((await row(burstPlan.id)).status));
  } finally {
    await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME MISSED RECOVERY DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL MISSED RECOVERY DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
