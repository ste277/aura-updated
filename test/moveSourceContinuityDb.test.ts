/**
 * Daily Experience V1 PR D2 (blocker correction) -- source continuity.
 *
 * Invariant: for a valid lineage  A MOVED -> B UPCOMING  the Capture /
 * GoalActivity belongs to B, and NO generic planning path (Plan My Day
 * acceptance -> the generic link helpers) may detach it from B or create a
 * parallel current commitment. A MOVED link is NOT a replaceable predecessor:
 * a source still linked to a MOVED plan makes generic acceptance fail closed
 * and roll back. (The read-side display fallback for such a malformed link is
 * separate: it changes nothing.) Requires DATABASE_URL.
 */
import {
  upsertUserByEmail, updateBirthProfile, createCapture, getCaptureWithLinkedPlanStatus, createGoalWithActivities, addGoalActivity, deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus, cancelPlannedActivity, skipPlannedActivity, beginTransaction,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { persistAcceptedConstructedDay } from '../apps/web/lib/dayConstructorAcceptancePersistence';
import type { AcceptConstructedDayRequest, AcceptedProposedItem } from '../apps/web/lib/dayConstructorAcceptance';
import { deriveCaptureState } from '../apps/web/lib/captures';
import { deriveGoalActivityState } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const TZ = 'Asia/Kolkata';
const MIN = 60000; const DAY = 86400000;
async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}
const item = (day: string, id: string, title: string, h: number): AcceptedProposedItem => ({ intentId: id, title, start: new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`), end: new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`), placementSource: 'SELECTED_CANDIDATE' });
let reqN = 0;
const request = (day: string, items: AcceptedProposedItem[]): AcceptConstructedDayRequest => ({ clientRequestId: `continuity-${Date.now()}-${reqN++}`, constructionWindow: { date: day, start: new Date(`${day}T09:00:00Z`), end: new Date(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' }, proposedItems: items });

async function main() {
  const U = await upsertUserByEmail({ email: 'test-move-continuity@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  await updateBirthProfile(U.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });
  const goalIds: string[] = [];
  let dest = 0; let day = 0;
  const nextDay = () => { const d = new Date(Date.UTC(2027, 0, 5 + day++)); return d.toISOString().slice(0, 10); };
  const moveTo = () => new Date(Math.floor(Date.now() / MIN) * MIN + 100 * DAY + dest++ * 3 * 3600000);
  const acceptCapture = async (captureId: string, title: string, d = nextDay()) => (await persistAcceptedConstructedDay(U.id, request(d, [item(d, 'i1', title, 10)]), new Date(`${d}T08:00:00Z`), new Map(), new Map([['i1', captureId]]))) as any;
  const acceptGoal = async (gaId: string, title: string, d = nextDay()) => (await persistAcceptedConstructedDay(U.id, request(d, [item(d, 'i1', title, 10)]), new Date(`${d}T08:00:00Z`), new Map([['i1', gaId]]), new Map())) as any;
  const plans = async () => sql(`SELECT id, status, "rescheduledFromPlanId" FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]);
  const clean = async () => {
    await sql(`UPDATE "Capture" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [U.id]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [U.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [U.id]);
  };
  const capDerived = async (id: string) => { const c = (await getCaptureWithLinkedPlanStatus(U.id, id))!; return { c, state: deriveCaptureState({ status: c.status, completedAt: c.completedAt, linkedPlanStatus: c.linkedPlanStatus }) }; };
  const goalDerived = async (goalId: string, gaId: string) => { const g = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goalId)).find((r) => r.id === gaId)!; return { g, state: deriveGoalActivityState({ status: g.status, plannedActivityId: g.plannedActivityId, linkedPlanStatus: g.linkedPlanStatus }) }; };

  try {
    // ================= CAPTURE =================
    const cap = await createCapture(U.id, 'Call the bank');
    const dA = nextDay();
    const a = (await acceptCapture(cap.id, 'Call the bank', dA)).plans[0].id as string;
    const mv = await movePlannedActivity(U.id, a, { newStartAt: moveTo() });
    const b = mv.to.id;
    const okC = await capDerived(cap.id);
    check('9. normal Capture Move: A MOVED, B UPCOMING, Capture -> B, derives PLANNED (completedAt null)', mv.from.status === 'MOVED' && mv.to.status === 'UPCOMING' && okC.c.plannedActivityId === b && okC.state === 'PLANNED' && okC.c.completedAt === null);

    // corrupt on purpose: the source points back at the MOVED original
    await sql(`UPDATE "Capture" SET "plannedActivityId" = $1 WHERE id = $2`, [a, cap.id]);
    const stale = await capDerived(cap.id);
    check('5. read-side fallback is unchanged: a stale MOVED link DISPLAYS as OPEN (not PLANNED/COMPLETED)', stale.state === 'OPEN' && stale.c.linkedPlanStatus === 'MOVED');
    const before = await plans();
    const attempt = await acceptCapture(cap.id, 'Call the bank');
    const after = await plans();
    const capAfter = (await getCaptureWithLinkedPlanStatus(U.id, cap.id))!;
    check('6/7. Capture linked to MOVED A: generic Plan My Day acceptance FAILS CLOSED (SAVE_FAILED), it does not detach the source', attempt.status === 'SAVE_FAILED');
    check('7. nothing survives the failed acceptance: no committed C, exactly A MOVED + B UPCOMING remain, the (deliberately corrupted) link still points at A', after.length === before.length && after.length === 2 && after.filter((p) => p.status === 'UPCOMING').length === 1 && after.find((p) => p.id === b)!.status === 'UPCOMING' && after.find((p) => p.id === a)!.status === 'MOVED' && capAfter.plannedActivityId === a);
    check('7. never both B UPCOMING and a new C UPCOMING for the one source', after.filter((p) => p.status === 'UPCOMING').length === 1);
    await clean();

    // ================= GOAL =================
    const goal = await createGoalWithActivities({ userId: U.id, title: 'Continuity goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(U.id, goal.goal.id, { title: 'Draft deck', activityId: null });
    const gA = (await acceptGoal(ga!.id, 'Draft deck')).plans[0].id as string;
    const gmv = await movePlannedActivity(U.id, gA, { newStartAt: moveTo() });
    const gB = gmv.to.id;
    const okG = await goalDerived(goal.goal.id, ga!.id);
    check('10. normal Goal Move: A MOVED, B UPCOMING, GoalActivity -> B, derives PLANNED', gmv.from.status === 'MOVED' && okG.g.plannedActivityId === gB && okG.state === 'PLANNED');
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [gA, ga!.id]);
    const gStale = await goalDerived(goal.goal.id, ga!.id);
    check('5. read-side fallback is unchanged: a stale MOVED link DISPLAYS as SUGGESTED (never PLANNED/COMPLETED)', gStale.state === 'SUGGESTED' && gStale.g.linkedPlanStatus === 'MOVED');
    const gBefore = await plans();
    const gAttempt = await acceptGoal(ga!.id, 'Draft deck');
    const gAfter = await plans();
    const gRow = (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('6/8. GoalActivity linked to MOVED A: generic acceptance FAILS CLOSED (SAVE_FAILED)', gAttempt.status === 'SAVE_FAILED');
    check('8. B remains the only live successor commitment, no C survives, the corrupted link is untouched', gAfter.length === gBefore.length && gAfter.length === 2 && gAfter.filter((p) => p.status === 'UPCOMING').length === 1 && gAfter.find((p) => p.id === gB)!.status === 'UPCOMING' && gRow.plannedActivityId === gA);
    await clean();

    // ================= legitimate replans still work (behavior unchanged from main) =================
    const capX = await createCapture(U.id, 'Replan me');
    const x1 = (await acceptCapture(capX.id, 'Replan me')).plans[0].id as string;
    await cancelPlannedActivity(U.id, x1);
    const xCancelled = await acceptCapture(capX.id, 'Replan me');
    check('11. Capture linked to a CANCELLED plan: generic replan still works and the source moves to the new plan', xCancelled.status === 'SAVED' && (await getCaptureWithLinkedPlanStatus(U.id, capX.id))!.plannedActivityId === xCancelled.plans[0].id);
    const capY = await createCapture(U.id, 'Skip then replan');
    const y1 = (await acceptCapture(capY.id, 'Skip then replan')).plans[0].id as string;
    await skipPlannedActivity(U.id, y1);
    const ySkipped = await acceptCapture(capY.id, 'Skip then replan');
    check('12. Capture linked to a SKIPPED plan: generic replan still works', ySkipped.status === 'SAVED' && (await getCaptureWithLinkedPlanStatus(U.id, capY.id))!.plannedActivityId === ySkipped.plans[0].id);
    const gaX = await addGoalActivity(U.id, goal.goal.id, { title: 'Cancelled goal step', activityId: null });
    const gx1 = (await acceptGoal(gaX!.id, 'Cancelled goal step')).plans[0].id as string;
    await cancelPlannedActivity(U.id, gx1);
    const gxRe = await acceptGoal(gaX!.id, 'Cancelled goal step');
    check('11. GoalActivity linked to a CANCELLED plan: generic replan still works', gxRe.status === 'SAVED' && (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((r) => r.id === gaX!.id)!.plannedActivityId === gxRe.plans[0].id);
    const gaY = await addGoalActivity(U.id, goal.goal.id, { title: 'Skipped goal step', activityId: null });
    const gy1 = (await acceptGoal(gaY!.id, 'Skipped goal step')).plans[0].id as string;
    await skipPlannedActivity(U.id, gy1);
    const gyRe = await acceptGoal(gaY!.id, 'Skipped goal step');
    check('12. GoalActivity linked to a SKIPPED plan: generic replan still works', gyRe.status === 'SAVED' && (await listGoalActivitiesWithLinkedPlanStatus(U.id, goal.goal.id)).find((r) => r.id === gaY!.id)!.plannedActivityId === gyRe.plans[0].id);
    await clean();

    // ================= chain through Move's own purpose-built repoint =================
    const capC = await createCapture(U.id, 'Chain');
    const c1 = (await acceptCapture(capC.id, 'Chain')).plans[0].id as string;
    const c2 = await movePlannedActivity(U.id, c1, { newStartAt: moveTo() });
    const c3 = await movePlannedActivity(U.id, c2.to.id, { newStartAt: moveTo() });
    const chain = await plans(); const chainCap = await capDerived(capC.id);
    check('13. A -> B -> C: A MOVED, B MOVED, C UPCOMING; the Capture -> C only and derives PLANNED (generic helpers rejecting MOVED does not affect Move)', chain.find((p) => p.id === c1)!.status === 'MOVED' && chain.find((p) => p.id === c2.to.id)!.status === 'MOVED' && chain.find((p) => p.id === c3.to.id)!.status === 'UPCOMING' && chainCap.c.plannedActivityId === c3.to.id && chainCap.state === 'PLANNED');
    const again = await movePlannedActivity(U.id, c1, { newStartAt: new Date(c2.to.plannedStartAt) });
    check('14. idempotent Move (same A, same destination) still returns the same B with no generic helper involved', again.to.id === c2.to.id && (await plans()).length === 3);
    await clean();

    // ================= 19 lifecycle invariant, stated as data =================
    const capV = await createCapture(U.id, 'Invariant');
    const v1 = (await acceptCapture(capV.id, 'Invariant')).plans[0].id as string;
    const v2 = await movePlannedActivity(U.id, v1, { newStartAt: moveTo() });
    const lineage = await sql(`SELECT count(*)::int AS n FROM "Capture" c JOIN "PlannedActivity" p ON p.id = c."plannedActivityId" WHERE c.id = $1 AND p."rescheduledFromPlanId" = $2 AND p.status = 'UPCOMING'`, [capV.id, v1]);
    check('19. valid lineage A MOVED -> B UPCOMING: the source points at B (the live successor), reached only through Move', Number(lineage[0].n) === 1 && v2.to.status === 'UPCOMING');
  } finally {
    await clean().catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = $1`, [U.id]).catch(() => {});
    for (const g of goalIds) await deleteGoal(U.id, g).catch(() => {});
    await sql(`DELETE FROM "HabitLog" WHERE "userId" = $1`, [U.id]).catch(() => {});
  }
  if (!allPassed) { console.error('SOME MOVE SOURCE CONTINUITY CHECKS FAILED'); process.exit(1); }
  console.log('ALL MOVE SOURCE CONTINUITY CHECKS PASSED');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
