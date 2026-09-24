/**
 * Live-database tests for Quick Capture V1 PR A. Requires a real, reachable
 * DATABASE_URL (same convention as goalsDb.test.ts):
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/capturesDb.test.ts
 *
 * Uses throwaway users (idempotent via email upsert) and removes every row
 * it creates in a finally block.
 */
import {
  upsertUserByEmail,
  createCapture,
  listCapturesWithLinkedPlanStatus,
  getCaptureWithLinkedPlanStatus,
  completeCapture,
  removeCapture,
  createPlannedActivity,
  cancelPlannedActivity,
  deletePlannedActivity,
  logPlannedActivity,
  beginTransaction,
} from '../apps/web/lib/db';
import { deriveCaptureState, MAX_CAPTURE_TITLE_LENGTH } from '../apps/web/lib/captures';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

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

async function derived(userId: string, captureId: string) {
  const row = (await getCaptureWithLinkedPlanStatus(userId, captureId))!;
  return deriveCaptureState({ status: row.status, completedAt: row.completedAt, linkedPlanStatus: row.linkedPlanStatus });
}

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-capture-domain-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-capture-domain-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const planIds: Array<{ userId: string; planId: string }> = [];
  const habitLogIds: string[] = [];

  const newPlan = async (title: string, hour: number) => {
    const plan = await createPlannedActivity({
      userId: userA.id,
      title,
      plannedStartAt: new Date(`2026-09-24T${String(hour).padStart(2, '0')}:00:00Z`),
      plannedEndAt: new Date(`2026-09-24T${String(hour).padStart(2, '0')}:30:00Z`),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    planIds.push({ userId: userA.id, planId: plan.id });
    return plan;
  };
  const link = (captureId: string, planId: string) => sql(`UPDATE "Capture" SET "plannedActivityId" = $1 WHERE id = $2`, [planId, captureId]);
  const countRows = async (table: string, userId: string) => Number((await sql(`SELECT count(*)::int AS n FROM "${table}" WHERE "userId" = $1`, [userId]))[0].n);

  try {
    // A/B/C/G create, trim, duplicates, initial state
    const a = await createCapture(userA.id, '  Call John  ');
    check('A. create Capture persists an OPEN row', a.status === 'OPEN' && a.completedAt === null && a.plannedActivityId === null);
    check('B. title is trimmed', a.title === 'Call John');
    const dup = await createCapture(userA.id, 'Call John');
    check('C. duplicate titles are separate Captures', dup.id !== a.id && dup.title === a.title);
    check('G. initial derived state is OPEN', (await derived(userA.id, a.id)) === 'OPEN');
    const natural = await createCapture(userA.id, 'Book dentist appointment tomorrow');
    check('title is stored verbatim (no natural-language parsing)', natural.title === 'Book dentist appointment tomorrow');
    const cols = Object.keys(natural).sort().join(',');
    check('no task/activity/duration/importance/deadline/goal columns exist', cols === 'completedAt,createdAt,id,plannedActivityId,status,title,updatedAt,userId');

    // D/E validation at the helper boundary
    let emptyRejected = false;
    try { await createCapture(userA.id, '   '); } catch { emptyRejected = true; }
    check('D. empty title rejected', emptyRejected);
    let capRejected = false;
    try { await createCapture(userA.id, 'x'.repeat(MAX_CAPTURE_TITLE_LENGTH + 1)); } catch { capRejected = true; }
    check('E. title over the cap rejected', capRejected);
    const atCap = await createCapture(userA.id, 'x'.repeat(MAX_CAPTURE_TITLE_LENGTH));
    check('E. title exactly at the cap accepted', atCap.title.length === MAX_CAPTURE_TITLE_LENGTH);

    // F user isolation (list/get)
    const bOnly = await createCapture(userB.id, 'B private');
    const listA = await listCapturesWithLinkedPlanStatus(userA.id);
    check('F. user A list contains only A rows', listA.every((r) => r.userId === userA.id) && !listA.some((r) => r.id === bOnly.id));
    check('F. user A cannot read B capture by id', (await getCaptureWithLinkedPlanStatus(userA.id, bOnly.id)) === null);

    // H/I/J/K/L direct completion
    const plansBefore = await countRows('PlannedActivity', userA.id);
    const logsBefore = await countRows('HabitLog', userA.id);
    const c1 = await completeCapture(userA.id, a.id);
    check('H. direct completion sets completedAt', c1.result === 'COMPLETED' && !!(await getCaptureWithLinkedPlanStatus(userA.id, a.id))!.completedAt);
    check('I. direct completion derives COMPLETED', (await derived(userA.id, a.id)) === 'COMPLETED');
    const firstStamp = (await getCaptureWithLinkedPlanStatus(userA.id, a.id))!.completedAt!.getTime();
    await new Promise((r) => setTimeout(r, 25));
    const c2 = await completeCapture(userA.id, a.id);
    check('J. repeated completion is idempotent success (ALREADY_COMPLETED)', c2.result === 'ALREADY_COMPLETED');
    check('J. repeated completion preserves the first timestamp', (await getCaptureWithLinkedPlanStatus(userA.id, a.id))!.completedAt!.getTime() === firstStamp);
    check('K. direct completion created no PlannedActivity', (await countRows('PlannedActivity', userA.id)) === plansBefore);
    check('L. direct completion created no HabitLog', (await countRows('HabitLog', userA.id)) === logsBefore);

    // M/N CANCELLED link
    const cCancel = await createCapture(userA.id, 'Cancelled-link capture');
    const planCancel = await newPlan('Plan to cancel', 9);
    await link(cCancel.id, planCancel.id);
    check('O. UPCOMING link derives PLANNED', (await derived(userA.id, cCancel.id)) === 'PLANNED');
    const rejected = await completeCapture(userA.id, cCancel.id);
    check('P. direct completion with a live UPCOMING plan is rejected', rejected.result === 'HAS_LIVE_PLAN');
    check('P. the rejected completion left completedAt null', (await getCaptureWithLinkedPlanStatus(userA.id, cCancel.id))!.completedAt === null);
    const rmLive = await removeCapture(userA.id, cCancel.id);
    check('U. remove with a live UPCOMING plan is rejected', rmLive === 'HAS_LIVE_PLAN' && (await getCaptureWithLinkedPlanStatus(userA.id, cCancel.id)) !== null);
    await cancelPlannedActivity(userA.id, planCancel.id);
    check('M. CANCELLED link derives OPEN', (await derived(userA.id, cCancel.id)) === 'OPEN');
    const cDone = await completeCapture(userA.id, cCancel.id);
    check('N. CANCELLED-link capture can be completed directly', cDone.result === 'COMPLETED' && (await derived(userA.id, cCancel.id)) === 'COMPLETED');
    check('N. the retained CANCELLED link stays as historical provenance', (await getCaptureWithLinkedPlanStatus(userA.id, cCancel.id))!.plannedActivityId === planCancel.id);

    // W/X plan hard delete SET NULL, completedAt survives
    await deletePlannedActivity(userA.id, planCancel.id);
    const afterDelete = (await getCaptureWithLinkedPlanStatus(userA.id, cCancel.id))!;
    check('W. hard-deleting the plan clears plannedActivityId (SET NULL)', afterDelete.plannedActivityId === null);
    check('X. completedAt survives plan deletion -> still COMPLETED', afterDelete.completedAt !== null && (await derived(userA.id, cCancel.id)) === 'COMPLETED');

    // W: not-completed capture whose cancelled plan is hard-deleted derives OPEN again
    const cOpenAgain = await createCapture(userA.id, 'Reopens after plan deletion');
    const planGone = await newPlan('Plan to cancel then delete', 10);
    await link(cOpenAgain.id, planGone.id);
    await cancelPlannedActivity(userA.id, planGone.id);
    await deletePlannedActivity(userA.id, planGone.id);
    check('W. an uncompleted capture whose plan was hard-deleted derives OPEN', (await derived(userA.id, cOpenAgain.id)) === 'OPEN');

    // Q LOGGED transitional
    const cLogged = await createCapture(userA.id, 'Logged-link capture');
    const planLogged = await newPlan('Plan to log', 11);
    await link(cLogged.id, planLogged.id);
    const logged = await logPlannedActivity(userA.id, planLogged.id);
    habitLogIds.push(logged.habitLog.id);
    check('Q. LOGGED link with null completedAt derives COMPLETED (transitional compatibility)', (await derived(userA.id, cLogged.id)) === 'COMPLETED');
    const logsMid = await countRows('HabitLog', userA.id);
    const materialize = await completeCapture(userA.id, cLogged.id);
    const loggedRow = (await getCaptureWithLinkedPlanStatus(userA.id, cLogged.id))!;
    check('Q. completeCapture materializes completedAt idempotently for a LOGGED link', materialize.result === 'COMPLETED' && loggedRow.completedAt !== null);
    check("Q. the materialized completedAt is the plan's real loggedAt", loggedRow.completedAt!.getTime() === (await sql(`SELECT "loggedAt" FROM "PlannedActivity" WHERE id = $1`, [planLogged.id]))[0].loggedAt.getTime());
    check('Q. materializing created no additional HabitLog', (await countRows('HabitLog', userA.id)) === logsMid);
    await deletePlannedActivity(userA.id, planLogged.id);
    check('X. materialized completion survives deletion of the LOGGED plan', (await derived(userA.id, cLogged.id)) === 'COMPLETED');

    // R never-used remove -> hard delete
    const never = await createCapture(userA.id, 'Never used');
    check('R. removing a never-used OPEN capture hard-deletes it', (await removeCapture(userA.id, never.id)) === 'DELETED' && (await getCaptureWithLinkedPlanStatus(userA.id, never.id)) === null);

    // S CANCELLED-history remove -> DISMISSED
    const cHist = await createCapture(userA.id, 'History capture');
    const planHist = await newPlan('History plan', 12);
    await link(cHist.id, planHist.id);
    await cancelPlannedActivity(userA.id, planHist.id);
    check('S. removing a capture with a retained CANCELLED link DISMISSES it', (await removeCapture(userA.id, cHist.id)) === 'DISMISSED');
    const histRow = (await getCaptureWithLinkedPlanStatus(userA.id, cHist.id))!;
    check('S. the row and its historical link are retained', histRow.status === 'DISMISSED' && histRow.plannedActivityId === planHist.id);

    // T/V completed remove -> DISMISSED with precedence
    check('T. removing a completed capture DISMISSES it (never hard-deletes history)', (await removeCapture(userA.id, a.id)) === 'DISMISSED');
    const doneRow = (await getCaptureWithLinkedPlanStatus(userA.id, a.id))!;
    check('T. completedAt is kept after removal', doneRow.completedAt !== null && doneRow.completedAt.getTime() === firstStamp);
    check('V. DISMISSED takes precedence over completedAt', (await derived(userA.id, a.id)) === 'DISMISSED');
    check('remove is idempotent on an already-DISMISSED capture', (await removeCapture(userA.id, a.id)) === 'DISMISSED');
    check('completing a DISMISSED capture is rejected', (await completeCapture(userA.id, a.id)).result === 'DISMISSED');
    check('DISMISSED/COMPLETED rows remain retrievable via the reusable list helper', (await listCapturesWithLinkedPlanStatus(userA.id)).some((r) => r.id === a.id));

    // Y/Z cross-user
    const yz = await createCapture(userA.id, 'Owned by A');
    check('Y. user B cannot complete user A capture', (await completeCapture(userB.id, yz.id)).result === 'NOT_FOUND' && (await getCaptureWithLinkedPlanStatus(userA.id, yz.id))!.completedAt === null);
    check('Z. user B cannot remove user A capture', (await removeCapture(userB.id, yz.id)) === 'NOT_FOUND' && (await getCaptureWithLinkedPlanStatus(userA.id, yz.id)) !== null);
    check('unknown id -> NOT_FOUND for complete and remove', (await completeCapture(userA.id, 'no-such-id')).result === 'NOT_FOUND' && (await removeCapture(userA.id, 'no-such-id')) === 'NOT_FOUND');

    // Concurrency: two completes -> exactly one COMPLETED, one ALREADY_COMPLETED; complete vs remove never both win
    const race = await createCapture(userA.id, 'Race target');
    const [r1, r2] = await Promise.all([completeCapture(userA.id, race.id), completeCapture(userA.id, race.id)]);
    const kinds = [r1.result, r2.result].sort().join(',');
    check('concurrent completes: exactly one wins, the other is idempotent', kinds === 'ALREADY_COMPLETED,COMPLETED');
    const race2 = await createCapture(userA.id, 'Complete vs remove');
    const [cRes, rRes] = await Promise.all([completeCapture(userA.id, race2.id), removeCapture(userA.id, race2.id)]);
    const final = await getCaptureWithLinkedPlanStatus(userA.id, race2.id);
    check(
      'complete-vs-remove ends in one consistent state (removed first: deleted + NOT_FOUND; completed first: DISMISSED with completedAt retained)',
      (rRes === 'DELETED' && final === null && cRes.result === 'NOT_FOUND') || (rRes === 'DISMISSED' && !!final && final.status === 'DISMISSED' && final.completedAt !== null && cRes.result === 'COMPLETED')
    );
    check('plannedActivityId is never set by these operations (internal lifecycle only)', (await sql(`SELECT count(*)::int AS n FROM "Capture" WHERE "userId" = $1 AND "plannedActivityId" IS NOT NULL AND id = ANY($2)`, [userA.id, [a.id, yz.id, race.id]]))[0].n === 0);
  } finally {
    for (const { userId, planId } of planIds) {
      await cancelPlannedActivity(userId, planId).catch(() => {});
      await deletePlannedActivity(userId, planId).catch(() => {});
    }
    await sql(`DELETE FROM "Capture" WHERE "userId" = ANY($1)`, [[userA.id, userB.id]]).catch(() => {});
    if (habitLogIds.length) await sql(`DELETE FROM "HabitLog" WHERE id = ANY($1)`, [habitLogIds]).catch(() => {});
  }

  if (!allPassed) {
    console.error('SOME CAPTURE DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL CAPTURE DB CHECKS PASSED');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
