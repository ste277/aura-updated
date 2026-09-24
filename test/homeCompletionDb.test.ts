/**
 * Daily Experience V1 PR B -- live-DB proof that Home completion IS the
 * existing plan-log lifecycle: exercised through the real route handler
 * POST /api/plans/[planId]/log (what Home's Done calls). Requires DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/homeCompletionDb.test.ts
 */
import {
  upsertUserByEmail, updateBirthProfile, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, cancelPlannedActivity, deletePlannedActivity, createPlannedActivity, beginTransaction,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { POST as logRoute } from '../apps/web/app/api/plans/[planId]/log/route';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const iso = (s: string) => new Date(s);
const fakeReq = (cookie?: string): any => ({ cookies: { get: (n: string) => (cookie !== undefined && n === 'as_session' ? { value: cookie } : undefined) }, json: async () => ({}) });
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: iso(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: iso(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let n = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `home-complete-${Date.now()}-${n++}`, constructionWindow: { date: day, start: iso(`${day}T09:00:00Z`), end: iso(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const A = await upsertUserByEmail({ email: 'test-home-complete-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const B = await upsertUserByEmail({ email: 'test-home-complete-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [A, B]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tokA = createSessionToken(A.id, A.email);
  const tokB = createSessionToken(B.id, B.email);
  const planIds: string[] = []; const goalIds: string[] = [];
  const habitCount = async () => Number((await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [A.id]))[0].n);
  const home = async (planId: string, token = tokA) => { const res = await logRoute(fakeReq(token), { params: { planId } }); return { status: res.status, body: await res.json() }; };
  const save = async (r: AcceptConstructedDayRequest, day: string, cap = new Map<string, string>(), goal = new Map<string, string>()) => {
    const d = await persistAcceptedConstructedDay(A.id, r, iso(`${day}T08:00:00Z`), goal, cap);
    if (d.status === 'SAVED') for (const p of d.plans) planIds.push(p.id);
    return d as any;
  };
  const planStatus = async (id: string) => (await sql(`SELECT status, "loggedAt", "habitLogId" FROM "PlannedActivity" WHERE id = $1`, [id]))[0];

  try {
    // ordinary plan
    const d1 = await save(request('2026-11-02', [item('2026-11-02', 'o1', 'Ordinary plan', 10)]), '2026-11-02');
    const p1 = d1.plans[0].id as string;
    const h0 = await habitCount();
    const r1 = await home(p1);
    check('32. Home Done (the existing log route) returns 200 with the plan LOGGED', r1.status === 200 && r1.body.plan.status === 'LOGGED');
    const s1 = await planStatus(p1);
    check('32/10. persisted: plan LOGGED with loggedAt and exactly one HabitLog created', s1.status === 'LOGGED' && !!s1.loggedAt && !!s1.habitLogId && (await habitCount()) === h0 + 1);
    check('9. the response carries the SERVER completion timestamp (Home generates none)', new Date(r1.body.plan.loggedAt).getTime() === s1.loggedAt.getTime());

    // idempotency: retry + race
    const again = await home(p1);
    check('19. a retry after a lost response is idempotent: 200, same plan, no second HabitLog', again.status === 200 && again.body.habitLog.id === r1.body.habitLog.id && (await habitCount()) === h0 + 1);
    const d2 = await save(request('2026-11-03', [item('2026-11-03', 'o2', 'Race plan', 10)]), '2026-11-03');
    const p2 = d2.plans[0].id as string;
    const before = await habitCount();
    const [x, y] = await Promise.all([home(p2), home(p2)]);
    check('19. two racing completions both succeed but create exactly ONE HabitLog (row-locked, idempotent)', x.status === 200 && y.status === 200 && x.body.habitLog.id === y.body.habitLog.id && (await habitCount()) === before + 1);

    // capture
    const cap = await createCapture(A.id, 'Call John');
    const d3 = await save(request('2026-11-04', [item('2026-11-04', 'c1', 'Call John', 10)]), '2026-11-04', new Map([['c1', cap.id]]));
    const p3 = d3.plans[0].id as string;
    const r3 = await home(p3);
    const capRow = (await getCaptureWithLinkedPlanStatus(A.id, cap.id))!;
    check('15/33. Capture-linked plan: Home Done -> plan LOGGED and Capture.completedAt materialized', r3.status === 200 && capRow.completedAt !== null);
    check('15/33. Capture.completedAt equals the plan loggedAt exactly (existing transaction semantics)', capRow.completedAt!.getTime() === new Date(r3.body.plan.loggedAt).getTime());
    check('15/33. the Capture derives COMPLETED', deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'COMPLETED');

    // goal
    const goal = await createGoalWithActivities({ userId: A.id, title: 'Home completion goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(A.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const d4 = await save(request('2026-11-05', [item('2026-11-05', 'g1', 'Draft deck', 10)]), '2026-11-05', new Map(), new Map([['g1', ga!.id]]));
    const p4 = d4.plans[0].id as string;
    const r4 = await home(p4);
    const gaRow = (await listGoalActivitiesWithLinkedPlanStatus(A.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('16/34. GoalActivity-linked plan: Home Done -> plan LOGGED and the GoalActivity derives COMPLETED (no Goal-specific Home code)', r4.status === 200 && deriveGoalActivityState({ status: gaRow.status, plannedActivityId: gaRow.plannedActivityId, linkedPlanStatus: gaRow.linkedPlanStatus }) === 'COMPLETED');

    // imminent / early completion (UPCOMING in the future)
    const future = await createPlannedActivity({ userId: A.id, title: 'Starts later', plannedStartAt: new Date(Date.now() + 15 * 60000), plannedEndAt: new Date(Date.now() + 60 * 60000), durationMinutes: 45, windowType: 'NEUTRAL' });
    planIds.push(future.id);
    const rEarly = await home(future.id);
    check('5/38. completing an UPCOMING plan early is valid in the existing lifecycle (so Home may offer Done for IMMINENT_PLAN)', rEarly.status === 200 && (await planStatus(future.id)).status === 'LOGGED');

    // missed plan (UPCOMING, window elapsed)
    const past = await createPlannedActivity({ userId: A.id, title: 'Missed one', plannedStartAt: new Date(Date.now() - 3 * 3600000), plannedEndAt: new Date(Date.now() - 2 * 3600000), durationMinutes: 60, windowType: 'NEUTRAL' });
    planIds.push(past.id);
    check('20. a MISSED (elapsed, still UPCOMING) plan CAN be logged after the fact by the existing lifecycle (Home does not surface it in Right Now, so this PR adds no missed action)', (await home(past.id)).status === 200 && (await planStatus(past.id)).status === 'LOGGED');

    // failure paths
    const cancelled = await createPlannedActivity({ userId: A.id, title: 'Cancelled one', plannedStartAt: new Date(Date.now() + 3600000), plannedEndAt: new Date(Date.now() + 7200000), durationMinutes: 60, windowType: 'NEUTRAL' });
    planIds.push(cancelled.id);
    await cancelPlannedActivity(A.id, cancelled.id);
    const rc = await home(cancelled.id);
    check('39. logging a CANCELLED plan fails (400) and changes nothing', rc.status === 400 && (await planStatus(cancelled.id)).status === 'CANCELLED');
    const owned = await save(request('2026-11-06', [item('2026-11-06', 'x1', 'Not yours', 10)]), '2026-11-06');
    const rx = await home(owned.plans[0].id, tokB);
    check('39. another user cannot complete the plan (400) and it stays UPCOMING', rx.status === 400 && (await planStatus(owned.plans[0].id)).status === 'UPCOMING');
    check('39. unauthenticated -> 401; unknown id -> 400', (await logRoute(fakeReq(), { params: { planId: owned.plans[0].id } })).status === 401 && (await home('no-such-plan')).status === 400);
  } finally {
    for (const id of planIds) {
      await cancelPlannedActivity(A.id, id).catch(() => {});
      await deletePlannedActivity(A.id, id).catch(() => {});
    }
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[A.id, B.id]]).catch(() => {});
    for (const g of goalIds) await deleteGoal(A.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = ANY($1)`, [[A.id, B.id]]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME HOME COMPLETION DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL HOME COMPLETION DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
