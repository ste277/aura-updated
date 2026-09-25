/**
 * Remaining-Day Recomposition V1 PR F1 -- persisted scheduling mode, against a
 * real DB and the real acceptance / direct-plan / Move code paths. Requires
 * DATABASE_URL (a fresh database with the full 39-migration chain).
 */
import {
  upsertUserByEmail, updateBirthProfile, createPlannedActivity, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, listPlannedActivities, listPlannedActivitiesForDay, getPlannedActivityForOwner, beginTransaction, cancelPlannedActivity,
} from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { hasFlexibleScheduling, parseSchedulingMode } from '../apps/web/lib/plannedActivitySchedulingMode';
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { POST as acceptRoute } from '../apps/web/app/api/day-constructor/accept/route';
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
const item = (day: string, id: string, title: string, h: number, source: AcceptedProposedItem['placementSource']): AcceptedProposedItem => ({ intentId: id, title, start: new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: source });
let reqN = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `sched-mode-${Date.now()}-${reqN++}`, constructionWindow: { date: day, start: new Date(`${day}T09:00:00Z`), end: new Date(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const U = await upsertUserByEmail({ email: 'test-scheduling-mode@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const tok = createSessionToken(U.id, U.email);
  const goalIds: string[] = [];
  let n = 0; let day = 0;
  const nextDay = () => new Date(Date.UTC(2027, 4, 1 + day++)).toISOString().slice(0, 10);
  const row = async (id: string) => (await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [id]))[0];
  const dest = () => new Date(minute(Date.now()) + 90 * DAY + n++ * 3 * HOUR);
  const accept = async (items: (d: string) => AcceptedProposedItem[], links: { cap?: [string, string]; goal?: [string, string] } = {}) => {
    const d = nextDay();
    return (await persistAcceptedConstructedDay(U.id, request(d, items(d)), new Date(`${d}T08:00:00Z`), new Map(links.goal ? [[links.goal[0], links.goal[1]]] : []), new Map(links.cap ? [[links.cap[0], links.cap[1]]] : []))) as any;
  };

  try {
    // ---- migration / schema ----
    const cols = await sql(`SELECT is_nullable, column_default, udt_name FROM information_schema.columns WHERE table_name = 'PlannedActivity' AND column_name = 'schedulingMode'`);
    check('5/40. the column exists, is NULLABLE, has NO default, and is the PlannedActivitySchedulingMode enum', cols.length === 1 && cols[0].is_nullable === 'YES' && cols[0].column_default === null && cols[0].udt_name === 'PlannedActivitySchedulingMode');
    const labels = (await sql(`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'PlannedActivitySchedulingMode' ORDER BY enumsortorder`)).map((r) => r.enumlabel);
    check('3/48. the DB enum has exactly FIXED and FLEXIBLE (same vocabulary as DayIntent, its own DB type)', labels.join() === 'FIXED,FLEXIBLE');
    let rejected = false;
    try { await sql(`INSERT INTO "PlannedActivity" (id, "userId", title, "plannedStartAt", "plannedEndAt", "durationMinutes", "windowType", "schedulingMode") VALUES ($1, $2, 'bad', now(), now() + interval '1 hour', 60, 'NEUTRAL', 'MOVABLE')`, [`bad-${Date.now()}`, U.id]); } catch { rejected = true; }
    check('49. the database itself rejects an unknown scheduling mode value', rejected);

    // ---- legacy / historical rows: NULL, protected, no crash ----
    const legacyId = `legacy-${Date.now()}`;
    await sql(`INSERT INTO "PlannedActivity" (id, "userId", title, "plannedStartAt", "plannedEndAt", "durationMinutes", "windowType") VALUES ($1, $2, 'Legacy row', $3, $4, 60, 'NEUTRAL')`, [legacyId, U.id, new Date(Date.now() + 200 * DAY), new Date(Date.now() + 200 * DAY + HOUR)]);
    const legacy = await getPlannedActivityForOwner(U.id, legacyId);
    const listed = (await listPlannedActivities(U.id)).find((p) => p.id === legacyId);
    const forDay = (await listPlannedActivitiesForDay(U.id, new Date(Date.now() + 199 * DAY), new Date(Date.now() + 201 * DAY))).find((p) => p.id === legacyId);
    check('4/39. a row created without a scheduling mode reads back as NULL through every read path (no crash, no mapper default, never FLEXIBLE)', legacy?.schedulingMode === null && listed?.schedulingMode === null && forDay?.schedulingMode === null && !hasFlexibleScheduling(legacy) && !hasFlexibleScheduling(listed) && !hasFlexibleScheduling(forDay));
    check('20/49. NULL / undefined / unknown values are never flexible', !hasFlexibleScheduling({ schedulingMode: null }) && !hasFlexibleScheduling({}) && !hasFlexibleScheduling(null) && !hasFlexibleScheduling({ schedulingMode: 'flexible' }) && parseSchedulingMode('FLEXIBLE ') === null && parseSchedulingMode(1) === null);

    // ---- Day Constructor acceptance: the intent's constraint is persisted (7/12/13) ----
    const acc = await accept((d) => [item(d, 'fx', 'Fixed call', 10, 'FIXED_CONSTRAINT'), item(d, 'fl', 'Flexible focus', 12, 'SELECTED_CANDIDATE')]);
    const byTitle = (plans: any[], t: string) => plans.find((p) => p.title === t);
    check('7/13. an accepted FIXED intent persists FIXED', acc.status === 'SAVED' && byTitle(acc.plans, 'Fixed call').schedulingMode === 'FIXED' && (await row(byTitle(acc.plans, 'Fixed call').id)).schedulingMode === 'FIXED');
    check('7/12. an accepted FLEXIBLE intent persists FLEXIBLE -- accepting Aura\'s proposed time does NOT make it FIXED', byTitle(acc.plans, 'Flexible focus').schedulingMode === 'FLEXIBLE' && (await row(byTitle(acc.plans, 'Flexible focus').id)).schedulingMode === 'FLEXIBLE');
    check('12. exactly one plan per intent, none NULL: the constraint is always known for a Constructor-created plan', acc.plans.length === 2 && acc.plans.every((p: any) => p.schedulingMode === 'FIXED' || p.schedulingMode === 'FLEXIBLE'));

    // ---- source types (8): Capture / GoalActivity go through the same acceptance and persist the same value ----
    const cap = await createCapture(U.id, 'Renew passport');
    const capAcc = await accept((d) => [item(d, 'c1', 'Renew passport', 10, 'SELECTED_CANDIDATE')], { cap: ['c1', cap.id] });
    check('8. a Capture planned through Plan My Day (flexible intent) persists FLEXIBLE and stays linked', capAcc.status === 'SAVED' && capAcc.plans[0].schedulingMode === 'FLEXIBLE' && (await getCaptureWithLinkedPlanStatus(U.id, cap.id))!.plannedActivityId === capAcc.plans[0].id);
    const cap2 = await createCapture(U.id, 'Dentist at 3');
    const cap2Acc = await accept((d) => [item(d, 'c2', 'Dentist at 3', 10, 'FIXED_CONSTRAINT')], { cap: ['c2', cap2.id] });
    check('8. a Capture planned with an exact time (fixed intent) persists FIXED', cap2Acc.plans[0].schedulingMode === 'FIXED');
    const goal = await createGoalWithActivities({ userId: U.id, title: 'Sched mode goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Draft the deck', activityId: null });
    const gaAcc = await accept((d) => [item(d, 'g1', 'Draft the deck', 10, 'SELECTED_CANDIDATE')], { goal: ['g1', ga!.id] });
    check('8. a GoalActivity planned through Plan My Day (flexible intent) persists FLEXIBLE', gaAcc.status === 'SAVED' && gaAcc.plans[0].schedulingMode === 'FLEXIBLE');
    const ga2 = await addGoalActivity(U.id, goal.goal.id, { title: 'Board review', activityId: null });
    const ga2Acc = await accept((d) => [item(d, 'g2', 'Board review', 10, 'FIXED_CONSTRAINT')], { goal: ['g2', ga2!.id] });
    check('8. a GoalActivity planned with an exact time (fixed intent) persists FIXED', ga2Acc.plans[0].schedulingMode === 'FIXED');

    // ---- direct pipeline (9/10/11): server-derived FIXED, never client-controlled (18/38) ----
    const direct = await plansRoute(fakeReq(tok, { title: 'Direct timing plan', activityType: 'Direct timing plan', plannedStartAt: new Date(Date.now() + 3 * HOUR).toISOString(), plannedEndAt: new Date(Date.now() + 3.5 * HOUR).toISOString(), durationMinutes: 30, windowType: 'NEUTRAL', matchLabel: 'Good Match', score: 70 }));
    const directPlan = await direct.json();
    check('9/10/11. POST /api/plans (every direct caller) persists FIXED -- an explicit exact-time choice outside the Constructor flow', direct.status === 200 && directPlan.schedulingMode === 'FIXED' && (await row(directPlan.id)).schedulingMode === 'FIXED');
    const sneaky = await plansRoute(fakeReq(tok, { schedulingMode: 'FLEXIBLE', title: 'Sneaky plan', activityType: 'Sneaky plan', plannedStartAt: new Date(Date.now() + 4 * HOUR).toISOString(), plannedEndAt: new Date(Date.now() + 4.5 * HOUR).toISOString(), durationMinutes: 30, windowType: 'NEUTRAL' }));
    const sneakyPlan = await sneaky.json();
    check('18/38. a client submitting schedulingMode: FLEXIBLE to POST /api/plans cannot grant it -- the row is FIXED', sneaky.status === 200 && sneakyPlan.schedulingMode === 'FIXED' && (await row(sneakyPlan.id)).schedulingMode === 'FIXED');
    const helperPlan = await createPlannedActivity({ userId: U.id, title: `Helper default ${Date.now()}`, plannedStartAt: new Date(Date.now() + 210 * DAY), plannedEndAt: new Date(Date.now() + 210 * DAY + HOUR), durationMinutes: 60, windowType: 'NEUTRAL' });
    check('4/49. createPlannedActivity with no mode stated persists NULL (the DB helper never grants FLEXIBLE by default)', helperPlan.schedulingMode === null);
    const garbage = await createPlannedActivity({ userId: U.id, title: `Helper garbage ${Date.now()}`, plannedStartAt: new Date(Date.now() + 211 * DAY), plannedEndAt: new Date(Date.now() + 211 * DAY + HOUR), durationMinutes: 60, windowType: 'NEUTRAL', schedulingMode: 'MOVABLE' as any });
    check('49. an unrecognised mode handed to the DB helper degrades to NULL (protected), never to FLEXIBLE and never a crash', garbage.schedulingMode === null);
    const wrongKind = await acceptRoute(fakeReq(tok, { clientRequestId: `trust-${Date.now()}`, constructionWindow: { date: '2027-06-20', start: '2027-06-20T09:00:00Z', end: '2027-06-20T17:00:00Z', timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: [{ intentId: 'x1', title: 'Trust check', start: '2027-06-20T10:00:00Z', end: '2027-06-20T10:30:00Z', placementSource: 'FIXED_CONSTRAINT', schedulingMode: 'FLEXIBLE' }] }));
    const wrongKindBody = await wrongKind.json();
    check('18/38. the accept route ignores a client schedulingMode field: a FIXED_CONSTRAINT item stays FIXED even when the body says FLEXIBLE', wrongKindBody.status === 'SAVED' && wrongKindBody.plans[0].schedulingMode === 'FIXED');

    // ---- Move inheritance (14/15/23) ----
    const mkPlan = async (mode: 'FIXED' | 'FLEXIBLE' | null, title: string, startMs: number) => createPlannedActivity({ userId: U.id, title: `${title} ${Date.now()}-${n++}`, plannedStartAt: new Date(startMs), plannedEndAt: new Date(startMs + HOUR), durationMinutes: 60, windowType: 'NEUTRAL', schedulingMode: mode });
    for (const mode of ['FIXED', 'FLEXIBLE', null] as const) {
      const a = await mkPlan(mode, `Move ${mode ?? 'unknown'}`, minute(Date.now()) + 220 * DAY + n * 5 * HOUR);
      const moved = await movePlannedActivity(U.id, a.id, { newStartAt: dest() });
      check(`14. Move ${mode ?? 'NULL'} -> the successor inherits it exactly (${mode ?? 'NULL'}); the original keeps its own`, moved.to.schedulingMode === mode && (await row(moved.to.id)).schedulingMode === mode && (await row(a.id)).schedulingMode === mode);
    }
    const mkChain = async (mode: 'FIXED' | 'FLEXIBLE' | null) => {
      const a = await mkPlan(mode, `Chain ${mode ?? 'unknown'}`, minute(Date.now()) + 240 * DAY + n * 5 * HOUR);
      const ab = await movePlannedActivity(U.id, a.id, { newStartAt: dest() });
      const bc = await movePlannedActivity(U.id, ab.to.id, { newStartAt: dest() });
      const [ra, rb, rc] = [await row(a.id), await row(ab.to.id), await row(bc.to.id)];
      return ra.status === 'MOVED' && rb.status === 'MOVED' && rc.status === 'UPCOMING' && rb.rescheduledFromPlanId === a.id && rc.rescheduledFromPlanId === ab.to.id && ra.schedulingMode === mode && rb.schedulingMode === mode && rc.schedulingMode === mode;
    };
    check('15. A -> B -> C (user Moves): A == B == C for FIXED, FLEXIBLE and NULL, with the lineage intact', (await mkChain('FIXED')) && (await mkChain('FLEXIBLE')) && (await mkChain(null)));

    // ---- manual Move stays allowed for FIXED (23); AuraMoment restriction unchanged (24) ----
    const fixedPlan = await mkPlan('FIXED', 'Fixed but movable by the user', minute(Date.now()) + 260 * DAY);
    const dFixed = dest();
    const fixedMove = await moveRoute(fakeReq(tok, { newStartAt: dFixed.toISOString() }), { params: { planId: fixedPlan.id } });
    const fixedMoveBody = await fixedMove.json();
    check('23. an explicit user Move of a FIXED plan is still allowed (scheduling mode does not gate Move); the successor stays FIXED', fixedMove.status === 200 && fixedMoveBody.plan.status === 'UPCOMING' && fixedMoveBody.plan.schedulingMode === 'FIXED' && (await row(fixedPlan.id)).status === 'MOVED');
    const shared = await mkPlan('FLEXIBLE', 'Shared flexible', minute(Date.now()) + 261 * DAY);
    await sql(`INSERT INTO "AuraMoment" (id, "ownerUserId", "publicToken", scope, source, "activityId", "activityTitle", "startAt", "endAt", timezone, "plannedActivityId") VALUES ($1, $2, $3, 'SHARED', 'PLAN', 'date-night', 'x', $4, $5, $6, $7)`, [`sm-${Date.now()}`, U.id, `sm-t-${Date.now()}`, new Date(shared.plannedStartAt), new Date(shared.plannedEndAt), TZ, shared.id]);
    let momentCode = '';
    try { await movePlannedActivity(U.id, shared.id, { newStartAt: dest() }); } catch (e: any) { momentCode = e.code; }
    check('24. a FLEXIBLE plan with an active linked AuraMoment is still refused (HAS_LINKED_MOMENT): scheduling mode is independent of that restriction', momentCode === 'HAS_LINKED_MOMENT' && (await row(shared.id)).status === 'UPCOMING');

    // ---- Done / Skip / Cancel never mutate it (16) ----
    for (const mode of ['FIXED', 'FLEXIBLE', null] as const) {
      const d = await mkPlan(mode, `Done ${mode}`, minute(Date.now()) + 270 * DAY + n * 4 * HOUR);
      await logRoute(fakeReq(tok, {}), { params: { planId: d.id } });
      const s = await mkPlan(mode, `Skip ${mode}`, minute(Date.now()) + 271 * DAY + n * 4 * HOUR);
      await skipRoute(fakeReq(tok, {}), { params: { planId: s.id } });
      const c = await mkPlan(mode, `Cancel ${mode}`, minute(Date.now()) + 272 * DAY + n * 4 * HOUR);
      await cancelPlannedActivity(U.id, c.id);
      const [rd, rs, rc] = [await row(d.id), await row(s.id), await row(c.id)];
      check(`16. Done / Skip / Cancel leave a ${mode ?? 'NULL'} scheduling mode untouched (statuses ${rd.status}/${rs.status}/${rc.status})`, rd.status === 'LOGGED' && rs.status === 'SKIPPED' && rc.status === 'CANCELLED' && rd.schedulingMode === mode && rs.schedulingMode === mode && rc.schedulingMode === mode);
    }

    // ---- source continuity regression (33): inheritance changes nothing about Capture / Goal state ----
    const capMove = await createCapture(U.id, 'Continuity capture');
    const capMoveAcc = await accept((d) => [item(d, 'cm', 'Continuity capture', 10, 'SELECTED_CANDIDATE')], { cap: ['cm', capMove.id] });
    const capMoved = await movePlannedActivity(U.id, capMoveAcc.plans[0].id, { newStartAt: dest() });
    const capRow = (await getCaptureWithLinkedPlanStatus(U.id, capMove.id))!;
    check('33. Move of a Capture-linked FLEXIBLE plan: successor FLEXIBLE, the Capture is repointed to B and still PLANNED (completedAt null)', capMoved.to.schedulingMode === 'FLEXIBLE' && capRow.plannedActivityId === capMoved.to.id && deriveCaptureState({ status: capRow.status, completedAt: capRow.completedAt, linkedPlanStatus: capRow.linkedPlanStatus }) === 'PLANNED' && capRow.completedAt === null);
    const gaMove = await addGoalActivity(U.id, goal.goal.id, { title: 'Continuity goal step', activityId: null });
    const gaMoveAcc = await accept((d) => [item(d, 'gm', 'Continuity goal step', 10, 'FIXED_CONSTRAINT')], { goal: ['gm', gaMove!.id] });
    const gaMoved = await movePlannedActivity(U.id, gaMoveAcc.plans[0].id, { newStartAt: dest() });
    const gaRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((r) => r.id === gaMove!.id)!;
    check('33. Move of a GoalActivity-linked FIXED plan: successor FIXED, the GoalActivity is repointed to B and still PLANNED', gaMoved.to.schedulingMode === 'FIXED' && gaRow.plannedActivityId === gaMoved.to.id && deriveGoalActivityState({ status: gaRow.status, plannedActivityId: gaRow.plannedActivityId, linkedPlanStatus: gaRow.linkedPlanStatus }) === 'PLANNED');

    // ---- idempotent acceptance replay never rewrites the mode (34) ----
    const replayReq = request(nextDay(), [item('2027-07-01', 'rp', 'Replay item', 10, 'SELECTED_CANDIDATE')]);
    replayReq.constructionWindow = { ...replayReq.constructionWindow, date: '2027-07-01', start: new Date('2027-07-01T09:00:00Z'), end: new Date('2027-07-01T17:00:00Z') };
    const first = (await persistAcceptedConstructedDay(U.id, replayReq, new Date('2027-07-01T08:00:00Z'))) as any;
    const second = (await persistAcceptedConstructedDay(U.id, { ...replayReq, proposedItems: [{ ...replayReq.proposedItems[0], placementSource: 'FIXED_CONSTRAINT' }] }, new Date('2027-07-01T08:00:00Z'))) as any;
    check('34. replaying an acceptance (even claiming a different placementSource) returns the original plan and never rewrites its scheduling mode', first.status === 'SAVED' && second.status === 'ALREADY_ACCEPTED' && second.plans[0].id === first.plans[0].id && (await row(first.plans[0].id)).schedulingMode === 'FLEXIBLE');
  } finally {
    await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "AuraMoment" WHERE "ownerUserId" = $1`, [U.id]).catch(() => {});
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
    await sql(`DELETE FROM "PlanCreationIdempotency" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME SCHEDULING MODE DB CHECKS FAILED'); process.exit(1); }
  console.log('ALL SCHEDULING MODE DB CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
