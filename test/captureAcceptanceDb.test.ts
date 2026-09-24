/**
 * Live-database tests for Quick Capture V1 PR B -- atomic Capture <->
 * PlannedActivity linkage inside the real Day Constructor acceptance
 * transaction, and Capture.completedAt materialization inside
 * logPlannedActivity. Exercised directly against
 * `persistAcceptedConstructedDay` / `logPlannedActivity` (same convention as
 * goalPlanningHandoffDb.test.ts). Requires a reachable DATABASE_URL; NOT run
 * by CI:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/captureAcceptanceDb.test.ts
 */
import {
  upsertUserByEmail,
  updateBirthProfile,
  createCapture,
  completeCapture,
  removeCapture,
  getCaptureWithLinkedPlanStatus,
  createGoalWithActivities,
  addGoalActivity,
  deleteGoal,
  listGoalActivitiesWithLinkedPlanStatus,
  cancelPlannedActivity,
  deletePlannedActivity,
  logPlannedActivity,
  listPlannedActivitiesForDay,
  createPlannedActivity,
  beginTransaction,
} from '../apps/web/lib/db';
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
const iso = (s: string) => new Date(s);
const win = (day: string) => ({ date: day, start: iso(`${day}T09:00:00Z`), end: iso(`${day}T17:00:00Z`), timezone: TZ, source: 'EXPLICIT_RANGE' as const });
const item = (day: string, intentId: string, title: string, startH: number, mins = 30): AcceptedProposedItem => ({
  intentId,
  title,
  start: iso(`${day}T${String(startH).padStart(2, '0')}:00:00Z`),
  end: new Date(iso(`${day}T${String(startH).padStart(2, '0')}:00:00Z`).getTime() + mins * 60000),
  placementSource: 'SELECTED_CANDIDATE',
});
let counter = 0;
const req = (day: string, items: AcceptedProposedItem[], clientRequestId?: string): AcceptConstructedDayRequest => ({
  clientRequestId: clientRequestId ?? `capture-b-${Date.now()}-${counter++}`,
  constructionWindow: win(day),
  proposedItems: items,
});
const nowFor = (day: string) => iso(`${day}T08:00:00Z`);

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const client = await beginTransaction();
  try {
    const res = await client.query(text, params);
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-capture-accept-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-capture-accept-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  for (const u of [userA, userB]) await updateBirthProfile(u.id, { birthDate: '1990-06-15', birthTime: '08:30', birthCityName: 'Chennai', birthLatitude: 13.0827, birthLongitude: 80.2707, birthTimezone: TZ });

  const planIds: string[] = [];
  const goalIds: string[] = [];
  const habitLogIds: string[] = [];
  const stateOf = async (userId: string, id: string) => {
    const r = (await getCaptureWithLinkedPlanStatus(userId, id))!;
    return deriveCaptureState({ status: r.status, completedAt: r.completedAt, linkedPlanStatus: r.linkedPlanStatus });
  };
  const linkOf = async (userId: string, id: string) => (await getCaptureWithLinkedPlanStatus(userId, id))!.plannedActivityId;
  const save = async (userId: string, r: AcceptConstructedDayRequest, day: string, captureLinks: Map<string, string>, goalLinks = new Map<string, string>()) => {
    const d = await persistAcceptedConstructedDay(userId, r, nowFor(day), goalLinks, captureLinks);
    if (d.status === 'SAVED' || d.status === 'ALREADY_ACCEPTED') for (const p of d.plans) planIds.push(p.id);
    return d;
  };
  const planId = (d: any, title: string): string | undefined => (d.status === 'SAVED' || d.status === 'ALREADY_ACCEPTED' ? d.plans.find((p: any) => p.title === title)?.id : undefined);

  try {
    // W. one Capture -> one plan -> correct link
    let day = '2026-10-01';
    const w = await createCapture(userA.id, 'Call John');
    const dW = await save(userA.id, req(day, [item(day, 'w-1', 'Call John', 10)]), day, new Map([['w-1', w.id]]));
    check('W. accept with a Capture link SAVES', dW.status === 'SAVED');
    check('W. the Capture links to exactly the new PlannedActivity', (await linkOf(userA.id, w.id)) === planId(dW, 'Call John'));
    check('W. the Capture derives PLANNED', (await stateOf(userA.id, w.id)) === 'PLANNED');
    check('W. PlannedActivity row has no Capture-shaped column', !Object.keys((await sql(`SELECT * FROM "PlannedActivity" WHERE id = $1`, [planId(dW, 'Call John')]))[0]).some((k) => /capture/i.test(k)));

    // X/Y. two Captures, identical titles -> independent links
    day = '2026-10-02';
    const x1 = await createCapture(userA.id, 'Review progress');
    const x2 = await createCapture(userA.id, 'Review progress');
    const dX = await save(userA.id, req(day, [item(day, 'x-1', 'Review progress', 10), item(day, 'x-2', 'Review progress', 12)]), day, new Map([['x-1', x1.id], ['x-2', x2.id]]));
    const l1 = await linkOf(userA.id, x1.id);
    const l2 = await linkOf(userA.id, x2.id);
    check('X/Y. two identical-title Captures each link to a plan, and the links are distinct', dX.status === 'SAVED' && !!l1 && !!l2 && l1 !== l2);
    const plansX = await sql(`SELECT id, "plannedStartAt" FROM "PlannedActivity" WHERE id = ANY($1) ORDER BY "plannedStartAt"`, [[l1, l2]]);
    check('X/Y. intent x-1 (10:00) is linked to the 10:00 plan and x-2 (12:00) to the 12:00 plan (intent id, not title/position)', plansX[0].id === l1 && plansX[1].id === l2);

    // Z. edited title -> original Capture link, Capture title untouched
    day = '2026-10-03';
    const z = await createCapture(userA.id, 'Original wording');
    const dZ = await save(userA.id, req(day, [item(day, 'z-1', 'Edited in Plan My Day', 10)]), day, new Map([['z-1', z.id]]));
    check('Z. an edited planning title still links to the original Capture', dZ.status === 'SAVED' && (await linkOf(userA.id, z.id)) === planId(dZ, 'Edited in Plan My Day'));
    check('Z. the Capture title is unchanged', (await getCaptureWithLinkedPlanStatus(userA.id, z.id))!.title === 'Original wording');

    // AA. Capture + typed -> only Capture linked
    day = '2026-10-04';
    const aa = await createCapture(userA.id, 'Captured one');
    const dAA = await save(userA.id, req(day, [item(day, 'aa-cap', 'Captured one', 10), item(day, 'aa-typed', 'Typed one', 12)]), day, new Map([['aa-cap', aa.id]]));
    check('AA. Capture + typed accept SAVES both', dAA.status === 'SAVED' && !!planId(dAA, 'Typed one'));
    check('AA. only the Capture is linked (typed plan is unreferenced)', (await linkOf(userA.id, aa.id)) === planId(dAA, 'Captured one') && (await sql(`SELECT count(*)::int AS n FROM "Capture" WHERE "plannedActivityId" = $1`, [planId(dAA, 'Typed one')]))[0].n === 0);

    // AB. Capture + Goal in one accept
    day = '2026-10-05';
    const ab = await createCapture(userA.id, 'Mixed capture');
    const goal = await createGoalWithActivities({ userId: userA.id, title: 'Mixed goal', targetDate: null, activities: [] });
    goalIds.push(goal.goal.id);
    const ga = await addGoalActivity(userA.id, goal.goal.id, { title: 'Mixed goal activity', activityId: null });
    const dAB = await save(userA.id, req(day, [item(day, 'ab-cap', 'Mixed capture', 10), item(day, 'ab-goal', 'Mixed goal activity', 12)]), day, new Map([['ab-cap', ab.id]]), new Map([['ab-goal', ga!.id]]));
    const gaRow = (await listGoalActivitiesWithLinkedPlanStatus(userA.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('AB. Capture and GoalActivity in the same accept each link to their own plan', dAB.status === 'SAVED' && (await linkOf(userA.id, ab.id)) === planId(dAB, 'Mixed capture') && gaRow.plannedActivityId === planId(dAB, 'Mixed goal activity'));

    // AC. partial placement -> only the placed Capture links
    day = '2026-10-06';
    const ac1 = await createCapture(userA.id, 'Placed capture');
    const ac2 = await createCapture(userA.id, 'Deferred capture');
    const dAC = await save(userA.id, req(day, [item(day, 'ac-1', 'Placed capture', 10)]), day, new Map([['ac-1', ac1.id]]));
    check('AC. partial placement: the placed Capture is PLANNED', dAC.status === 'SAVED' && (await stateOf(userA.id, ac1.id)) === 'PLANNED');
    check('AC. partial placement: the deferred Capture remains OPEN and unlinked', (await stateOf(userA.id, ac2.id)) === 'OPEN' && (await linkOf(userA.id, ac2.id)) === null);

    // AD/AE/AF/AJ stale or ineligible -> whole transaction rolls back
    day = '2026-10-07';
    const staleDone = await createCapture(userA.id, 'Stale completed');
    await completeCapture(userA.id, staleDone.id);
    const dAD = await save(userA.id, req(day, [item(day, 'ad-1', 'Stale completed', 10), item(day, 'ad-2', 'Innocent bystander AD', 12)]), day, new Map([['ad-1', staleDone.id]]));
    check('AD. accepting a Capture completed after preview FAILS the whole acceptance', dAD.status === 'SAVE_FAILED');
    const orphansAD = await listPlannedActivitiesForDay(userA.id, iso(`${day}T00:00:00Z`), iso(`${day}T23:59:00Z`));
    check('AD. no orphan plan (including the innocent second item) exists after rollback', !orphansAD.some((p) => p.title === 'Stale completed' || p.title === 'Innocent bystander AD'));
    check('AD. the completed Capture is unchanged (no link)', (await linkOf(userA.id, staleDone.id)) === null);

    day = '2026-10-08';
    const staleDismissed = await createCapture(userA.id, 'Stale dismissed');
    await sql(`UPDATE "Capture" SET status = 'DISMISSED' WHERE id = $1`, [staleDismissed.id]);
    const dAE = await save(userA.id, req(day, [item(day, 'ae-1', 'Stale dismissed', 10)]), day, new Map([['ae-1', staleDismissed.id]]));
    check('AE. accepting a dismissed Capture FAILS and rolls back', dAE.status === 'SAVE_FAILED' && !(await listPlannedActivitiesForDay(userA.id, iso(`${day}T00:00:00Z`), iso(`${day}T23:59:00Z`))).some((p) => p.title === 'Stale dismissed'));

    day = '2026-10-09';
    const dAFa = await save(userA.id, req(day, [item(day, 'af-0', 'Already planned', 10)]), day, new Map([['af-0', (await createCapture(userA.id, 'Already planned')).id]]));
    const planned = (await sql(`SELECT id FROM "Capture" WHERE "plannedActivityId" = $1`, [planId(dAFa, 'Already planned')]))[0].id as string;
    const day2 = '2026-10-10';
    const dAF = await save(userA.id, req(day2, [item(day2, 'af-1', 'Second attempt', 10)]), day2, new Map([['af-1', planned]]));
    check('AF. re-linking a Capture that already holds a live UPCOMING plan FAILS and rolls back', dAF.status === 'SAVE_FAILED' && !(await listPlannedActivitiesForDay(userA.id, iso(`${day2}T00:00:00Z`), iso(`${day2}T23:59:00Z`))).some((p) => p.title === 'Second attempt'));
    check('AF. the original link is untouched', (await linkOf(userA.id, planned)) === planId(dAFa, 'Already planned'));

    day = '2026-10-11';
    const foreign = await createCapture(userB.id, 'Belongs to B');
    const dAJ = await save(userA.id, req(day, [item(day, 'aj-1', 'Belongs to B', 10)]), day, new Map([['aj-1', foreign.id]]));
    check("AJ. user A linking user B's Capture FAILS and rolls back", dAJ.status === 'SAVE_FAILED' && (await linkOf(userB.id, foreign.id)) === null && (await stateOf(userB.id, foreign.id)) === 'OPEN');
    const dNoCap = await save(userA.id, req(day, [item(day, 'aj-2', 'Ghost', 10)]), day, new Map([['aj-2', 'no-such-capture']]));
    check('AJ. a nonexistent Capture id FAILS and rolls back', dNoCap.status === 'SAVE_FAILED');
    const dBoth = await save(userA.id, req(day, [item(day, 'aj-3', 'Both sources', 10)]), day, new Map([['aj-3', (await createCapture(userA.id, 'both')).id]]), new Map([['aj-3', ga!.id]]));
    check('AJ. one intent claiming BOTH a Capture and a GoalActivity source FAILS and rolls back', dBoth.status === 'SAVE_FAILED');

    // AG/AH CANCELLED replan
    day = '2026-10-12';
    const rp = await createCapture(userA.id, 'Replan me');
    const dRP1 = await save(userA.id, req(day, [item(day, 'rp-1', 'Replan me', 10)]), day, new Map([['rp-1', rp.id]]));
    const oldPlan = planId(dRP1, 'Replan me')!;
    await cancelPlannedActivity(userA.id, oldPlan);
    check('AG. after cancelling the plan the Capture derives OPEN (retained link)', (await stateOf(userA.id, rp.id)) === 'OPEN' && (await linkOf(userA.id, rp.id)) === oldPlan);
    const day3 = '2026-10-13';
    const dRP2 = await save(userA.id, req(day3, [item(day3, 'rp-2', 'Replan me', 11)]), day3, new Map([['rp-2', rp.id]]));
    check('AG. replanning atomically relinks the Capture to the NEW plan', dRP2.status === 'SAVED' && (await linkOf(userA.id, rp.id)) === planId(dRP2, 'Replan me') && (await stateOf(userA.id, rp.id)) === 'PLANNED');
    check('AH. the old CANCELLED plan still exists as history', (await sql(`SELECT status FROM "PlannedActivity" WHERE id = $1`, [oldPlan]))[0]?.status === 'CANCELLED');

    // AI idempotent replay
    day = '2026-10-14';
    const idem = await createCapture(userA.id, 'Idempotent');
    const idemReq = req(day, [item(day, 'id-1', 'Idempotent', 10)], `capture-b-idem-${Date.now()}`);
    const first = await save(userA.id, idemReq, day, new Map([['id-1', idem.id]]));
    const other = await createCapture(userA.id, 'Different capture on replay');
    const replay = await save(userA.id, idemReq, day, new Map([['id-1', other.id]]));
    check('AI. an identical replay returns ALREADY_ACCEPTED (no duplicate plan)', first.status === 'SAVED' && replay.status === 'ALREADY_ACCEPTED' && (await sql(`SELECT count(*)::int AS n FROM "PlannedActivity" WHERE "userId" = $1 AND title = 'Idempotent'`, [userA.id]))[0].n === 1);
    check('AI. the replay cannot relink to a different Capture', (await linkOf(userA.id, idem.id)) === planId(first, 'Idempotent') && (await linkOf(userA.id, other.id)) === null);

    // ---------------- plan logging ----------------
    // AK/AL/AM: log a linked plan
    const logsBefore = (await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [userA.id]))[0].n;
    const logged = await logPlannedActivity(userA.id, planId(dW, 'Call John')!);
    habitLogIds.push(logged.habitLog.id);
    const wRow = (await getCaptureWithLinkedPlanStatus(userA.id, w.id))!;
    check('AK. logging the linked plan sets it LOGGED and materializes Capture.completedAt', logged.plan.status === 'LOGGED' && wRow.completedAt !== null);
    check('AL. Capture.completedAt equals PlannedActivity.loggedAt exactly (one factual instant)', wRow.completedAt!.getTime() === logged.plan.loggedAt!.getTime());
    check('AM. the Capture derives COMPLETED', (await stateOf(userA.id, w.id)) === 'COMPLETED');
    check('AR. logging created exactly one HabitLog (Habit path unchanged)', (await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [userA.id]))[0].n === logsBefore + 1);
    await logPlannedActivity(userA.id, planId(dW, 'Call John')!);
    check('AK. an idempotent re-log does not move completedAt', (await getCaptureWithLinkedPlanStatus(userA.id, w.id))!.completedAt!.getTime() === wRow.completedAt!.getTime());
    await deletePlannedActivity(userA.id, planId(dW, 'Call John')!);
    check('AN. hard-deleting the logged plan afterwards: the Capture remains COMPLETED', (await stateOf(userA.id, w.id)) === 'COMPLETED' && (await linkOf(userA.id, w.id)) === null);

    // AO. direct completion still works
    const direct = await createCapture(userA.id, 'Direct done');
    check('AO. direct completion still works (no plan created)', (await completeCapture(userA.id, direct.id)).result === 'COMPLETED' && (await stateOf(userA.id, direct.id)) === 'COMPLETED');

    // AP. logging an unrelated plan changes no Capture
    const untouched = await createCapture(userA.id, 'Untouched by unrelated log');
    const unrelated = await createPlannedActivity({ userId: userA.id, title: 'Unrelated plan', plannedStartAt: iso('2026-10-15T10:00:00Z'), plannedEndAt: iso('2026-10-15T10:30:00Z'), durationMinutes: 30, windowType: 'NEUTRAL' });
    planIds.push(unrelated.id);
    const capsBefore = JSON.stringify(await sql(`SELECT id, status, "completedAt", "plannedActivityId" FROM "Capture" WHERE "userId" = $1 ORDER BY id`, [userA.id]));
    const lu = await logPlannedActivity(userA.id, unrelated.id);
    habitLogIds.push(lu.habitLog.id);
    check('AP. logging an unrelated plan changes no Capture row', JSON.stringify(await sql(`SELECT id, status, "completedAt", "plannedActivityId" FROM "Capture" WHERE "userId" = $1 ORDER BY id`, [userA.id])) === capsBefore && (await stateOf(userA.id, untouched.id)) === 'OPEN');

    // AQ. Goal-linked plan logging unaffected
    const lg = await logPlannedActivity(userA.id, planId(dAB, 'Mixed goal activity')!);
    habitLogIds.push(lg.habitLog.id);
    const gaAfter = (await listGoalActivitiesWithLinkedPlanStatus(userA.id, goal.goal.id)).find((r) => r.id === ga!.id)!;
    check('AQ. logging a Goal-linked plan still derives the GoalActivity COMPLETED and touches no Capture', deriveGoalActivityState({ status: gaAfter.status, plannedActivityId: gaAfter.plannedActivityId, linkedPlanStatus: gaAfter.linkedPlanStatus }) === 'COMPLETED' && (await stateOf(userA.id, ab.id)) === 'PLANNED');

    // Cancellation semantics unchanged; completed capture is not reopened by a later cancel of nothing
    // AS. forced materialization failure rolls the plan logging back
    const failCap = await createCapture(userA.id, 'Log will fail');
    day = '2026-10-16';
    const dFail = await save(userA.id, req(day, [item(day, 'lf-1', 'Log will fail', 10)]), day, new Map([['lf-1', failCap.id]]));
    const failPlan = planId(dFail, 'Log will fail')!;
    const habitBeforeFail = (await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [userA.id]))[0].n;
    await sql(`CREATE OR REPLACE FUNCTION capture_test_block() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'forced capture failure'; END; $$ LANGUAGE plpgsql`);
    await sql(`CREATE TRIGGER capture_test_block_trg BEFORE UPDATE ON "Capture" FOR EACH ROW WHEN (NEW."completedAt" IS NOT NULL) EXECUTE FUNCTION capture_test_block()`);
    let threw = false;
    try {
      await logPlannedActivity(userA.id, failPlan);
    } catch {
      threw = true;
    } finally {
      await sql(`DROP TRIGGER IF EXISTS capture_test_block_trg ON "Capture"`);
      await sql(`DROP FUNCTION IF EXISTS capture_test_block()`);
    }
    const failPlanRow = (await sql(`SELECT status, "loggedAt", "habitLogId" FROM "PlannedActivity" WHERE id = $1`, [failPlan]))[0];
    check('AS. a failing Capture completion write makes logPlannedActivity throw', threw);
    check('AS. and the plan logging rolled back (plan still UPCOMING, no loggedAt, no HabitLog)', failPlanRow.status === 'UPCOMING' && failPlanRow.loggedAt === null && failPlanRow.habitLogId === null && (await sql(`SELECT count(*)::int AS n FROM "HabitLog" WHERE "userId" = $1`, [userA.id]))[0].n === habitBeforeFail);
    check('AS. the Capture is still PLANNED (never half-completed)', (await stateOf(userA.id, failCap.id)) === 'PLANNED');
    const retry = await logPlannedActivity(userA.id, failPlan);
    habitLogIds.push(retry.habitLog.id);
    check('AS. after the failure clears, logging succeeds and completes the Capture', (await stateOf(userA.id, failCap.id)) === 'COMPLETED');

    // Cancel/remove semantics from a UI perspective
    check('UPCOMING-linked Capture cannot be removed or completed directly (cancel the plan first)', (await removeCapture(userA.id, ac1.id)) === 'HAS_LIVE_PLAN' && (await completeCapture(userA.id, ac1.id)).result === 'HAS_LIVE_PLAN');
  } finally {
    for (const id of planIds) {
      await cancelPlannedActivity(userA.id, id).catch(() => {});
      await deletePlannedActivity(userA.id, id).catch(() => {});
    }
    await sql(`DROP TRIGGER IF EXISTS capture_test_block_trg ON "Capture"`).catch(() => {});
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[userA.id, userB.id]]).catch(() => {});
    for (const id of goalIds) await deleteGoal(userA.id, id).catch(() => {});
    if (habitLogIds.length) await sql(`DELETE FROM "HabitLog" WHERE id = ANY($1)`, [habitLogIds]).catch(() => {});
  }

  if (!allPassed) {
    console.error('SOME CAPTURE ACCEPTANCE DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CAPTURE ACCEPTANCE DB CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
