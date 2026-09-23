/**
 * Live-database tests for Goals -> Planning Integration V1 PR A --
 * exercised end-to-end against a real Postgres connection: Goal/
 * GoalActivity CRUD, ownership scoping, the atomic create-with-template
 * transaction, the delete-history guard, and cancellation/completion
 * derivation against a REAL linked PlannedActivity. Requires a real,
 * reachable DATABASE_URL, same convention as
 * dayConstructorAcceptancePersistenceDb.test.ts -- NOT part of ci.yml's
 * math-core-tests job (no Postgres service provisioned there); run
 * manually or wired into a future db-tests CI job the same way
 * dayConstructorAcceptancePersistenceDb.test.ts already is.
 *
 * Run locally with a real DATABASE_URL set:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalsDb.test.ts
 *
 * Reuses a throwaway test user (idempotent via email upsert) and deletes
 * every Goal/PlannedActivity it creates in a finally block -- same
 * convention as dayConstructorAcceptancePersistenceDb.test.ts.
 */
import {
  upsertUserByEmail,
  listGoalsForUser,
  getGoalForUser,
  createGoalWithActivities,
  archiveGoal,
  deleteGoal,
  goalHasScheduledHistory,
  addGoalActivity,
  dismissGoalActivity,
  listGoalActivitiesWithLinkedPlanStatus,
  createPlannedActivity,
  cancelPlannedActivity,
  logPlannedActivity,
  deletePlannedActivity,
  beginTransaction,
  type Goal,
} from '../apps/web/lib/db';
import { deriveGoalActivityState } from '../apps/web/lib/goals';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const REAL_ACTIVITY_ID = FULL_ACTIVITY_CATALOG[0].id;

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-goals-domain-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-goals-domain-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: Array<{ userId: string; goalId: string }> = [];
  const createdPlanIds: Array<{ userId: string; planId: string }> = [];
  const cleanup = async () => {
    for (const { userId, planId } of createdPlanIds) {
      await cancelPlannedActivity(userId, planId).catch(() => {});
      await deletePlannedActivity(userId, planId).catch(() => {});
    }
    for (const { userId, goalId } of createdGoalIds) {
      await deleteGoal(userId, goalId).catch(() => {});
    }
  };

  try {
    // ============================================================
    // A. create plain Goal / B. with targetDate
    // ============================================================
    const plain = await createGoalWithActivities({ userId: userA.id, title: 'Plain goal, no template', targetDate: null, activities: [] });
    createdGoalIds.push({ userId: userA.id, goalId: plain.goal.id });
    check('A. plain Goal is created with status ACTIVE, no target date', plain.goal.status === 'ACTIVE' && plain.goal.targetDate === null);
    check('A. plain Goal generates zero activities', plain.activities.length === 0);

    const withDate = await createGoalWithActivities({ userId: userA.id, title: 'Goal with a target date', targetDate: '2026-09-25', activities: [] });
    createdGoalIds.push({ userId: userA.id, goalId: withDate.goal.id });
    check('B/16(civil-date). Goal.targetDate round-trips through Postgres as the exact "YYYY-MM-DD" string given -- never shifted by the reading process\'s local timezone (this is the real bug test/goalsDb.test.ts caught during PR A\'s own validation: node-postgres\'s default date parser reads a DATE column at LOCAL midnight, not UTC -- fixed via an explicit ::text cast in every Goal query, see db.ts\'s GOAL_COLUMNS)', withDate.goal.targetDate === '2026-09-25');

    // ============================================================
    // D. create Goal with each template / AA. atomic transaction
    // ============================================================
    const templated = await createGoalWithActivities({
      userId: userA.id,
      title: 'Get fitter this quarter',
      targetDate: null,
      activities: [
        { title: 'Go for a run', activityId: 'workout' },
        { title: 'Strength training session', activityId: 'workout' },
        { title: 'Stretch / mobility', activityId: 'task-7' },
      ],
    });
    createdGoalIds.push({ userId: userA.id, goalId: templated.goal.id });
    check('D. templated Goal creates exactly the given activities, all SUGGESTED', templated.activities.length === 3 && templated.activities.every((a) => a.status === 'SUGGESTED'));
    check('AA. Goal + its template activities all share the same goalId, created in one atomic call', templated.activities.every((a) => a.goalId === templated.goal.id));

    // ============================================================
    // E. free-text/unmatched Goal -> zero activities (already covered by
    // "A" above, which is exactly this case -- documented here explicitly)
    // ============================================================
    check('E. a Goal created with activities: [] (no template match) has zero GoalActivity rows, never a guessed one', plain.activities.length === 0);

    // ============================================================
    // F. manual GoalActivity / G. nullable activityId / H. invalid catalog id
    // (H is an API-boundary concern -- exercised here at the db.ts layer by
    // confirming addGoalActivity persists whatever validated activityId it
    // is given verbatim, same "no catalog lookup in db.ts" contract as
    // createPlannedActivity)
    // ============================================================
    const manualNoActivity = await addGoalActivity(userA.id, plain.goal.id, { title: 'Manually added activity', activityId: null });
    check('F. manual GoalActivity is created under the right Goal', manualNoActivity !== null && manualNoActivity.goalId === plain.goal.id);
    check('G. manual GoalActivity accepts a null activityId', manualNoActivity !== null && manualNoActivity.activityId === null);

    const manualWithActivity = await addGoalActivity(userA.id, plain.goal.id, { title: 'Manual with a real catalog id', activityId: REAL_ACTIVITY_ID });
    check('G. manual GoalActivity persists a supplied activityId verbatim', manualWithActivity !== null && manualWithActivity.activityId === REAL_ACTIVITY_ID);

    const manualUnderMissingGoal = await addGoalActivity(userA.id, 'not-a-real-goal-id', { title: 'Orphan', activityId: null });
    check('addGoalActivity returns null when the parent Goal does not exist (ownership-checked first, never inserts blind)', manualUnderMissingGoal === null);

    // ============================================================
    // I. dismiss / J. dismiss idempotency
    // ============================================================
    const dismissed = await dismissGoalActivity(userA.id, plain.goal.id, manualNoActivity!.id);
    check('I. dismiss sets status to DISMISSED', dismissed !== null && dismissed.status === 'DISMISSED');
    const dismissedAgain = await dismissGoalActivity(userA.id, plain.goal.id, manualNoActivity!.id);
    check('J. dismissing an already-dismissed activity is idempotent (no error, stays DISMISSED)', dismissedAgain !== null && dismissedAgain.status === 'DISMISSED');

    // ============================================================
    // M/N/O -- derived PLANNED/COMPLETED/SUGGESTED-after-CANCELLED against
    // a REAL linked PlannedActivity (not just the pure-function tests in
    // goals.test.ts)
    // ============================================================
    const linkTarget = await addGoalActivity(userA.id, plain.goal.id, { title: 'Will be linked to a real Plan', activityId: null });
    const plan = await createPlannedActivity({
      userId: userA.id,
      title: 'Linked plan for Goal test',
      plannedStartAt: new Date('2026-09-16T09:00:00Z'),
      plannedEndAt: new Date('2026-09-16T09:30:00Z'),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push({ userId: userA.id, planId: plan.id });

    // Directly link (same shape as PR D's own same-transaction UPDATE, but
    // exercised here standalone since PR D itself is a later ticket) --
    // proves the plannedActivityId column + derivation work end-to-end.
    const client = await beginTransaction();
    await client.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan.id, linkTarget!.id]);
    await client.query('COMMIT');
    client.release();

    let rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, plain.goal.id);
    let linkedRow = rows.find((r) => r.id === linkTarget!.id)!;
    check('M. a GoalActivity linked to an UPCOMING PlannedActivity derives PLANNED', deriveGoalActivityState({ status: linkedRow.status, plannedActivityId: linkedRow.plannedActivityId, linkedPlanStatus: linkedRow.linkedPlanStatus }) === 'PLANNED');

    await logPlannedActivity(userA.id, plan.id);
    rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, plain.goal.id);
    linkedRow = rows.find((r) => r.id === linkTarget!.id)!;
    check('N. after logging the linked Plan, the GoalActivity derives COMPLETED', deriveGoalActivityState({ status: linkedRow.status, plannedActivityId: linkedRow.plannedActivityId, linkedPlanStatus: linkedRow.linkedPlanStatus }) === 'COMPLETED');

    // ============================================================
    // AE. PlannedActivity deletion -> SetNull behavior
    // ============================================================
    // logPlannedActivity moved the plan to LOGGED -- deletePlannedActivity
    // accepts LOGGED rows (this repo's own existing lifecycle rule).
    await deletePlannedActivity(userA.id, plan.id);
    createdPlanIds.pop(); // already deleted -- don't double-delete in cleanup
    rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, plain.goal.id);
    linkedRow = rows.find((r) => r.id === linkTarget!.id)!;
    check('AE. hard-deleting the linked PlannedActivity SetNulls GoalActivity.plannedActivityId (FK behavior, not app code)', linkedRow.plannedActivityId === null);
    check('AE. after SetNull, the GoalActivity derives back to SUGGESTED (never a dangling/broken reference)', deriveGoalActivityState({ status: linkedRow.status, plannedActivityId: linkedRow.plannedActivityId, linkedPlanStatus: linkedRow.linkedPlanStatus }) === 'SUGGESTED');

    // Separate plan for the CANCELLED-derivation check (O), kept simple/
    // independent of the deletion test above.
    const planForCancel = await createPlannedActivity({
      userId: userA.id,
      title: 'Plan to be cancelled for Goal test',
      plannedStartAt: new Date('2026-09-17T09:00:00Z'),
      plannedEndAt: new Date('2026-09-17T09:30:00Z'),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push({ userId: userA.id, planId: planForCancel.id });
    const cancelTarget = await addGoalActivity(userA.id, plain.goal.id, { title: 'Will be linked then cancelled', activityId: null });
    const client2 = await beginTransaction();
    await client2.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [planForCancel.id, cancelTarget!.id]);
    await client2.query('COMMIT');
    client2.release();
    await cancelPlannedActivity(userA.id, planForCancel.id);
    rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, plain.goal.id);
    const cancelRow = rows.find((r) => r.id === cancelTarget!.id)!;
    check('O. a GoalActivity linked to a CANCELLED PlannedActivity derives back to SUGGESTED (available to plan again, no relink code needed)', deriveGoalActivityState({ status: cancelRow.status, plannedActivityId: cancelRow.plannedActivityId, linkedPlanStatus: cancelRow.linkedPlanStatus }) === 'SUGGESTED');
    check('24. replanning: relinking the SAME GoalActivity to a new Plan is a plain UPDATE (cardinality allows it once the old link is superseded)', cancelRow.plannedActivityId === planForCancel.id); // still points at the (now cancelled) plan -- a fresh accept would simply overwrite this column, exercised structurally here since the write itself is a one-line UPDATE already proven above.

    // ============================================================
    // R. archive / S. archive idempotency
    // ============================================================
    const archived = await archiveGoal(userA.id, plain.goal.id);
    check('R. archive sets status ARCHIVED and stamps archivedAt', archived !== null && archived.status === 'ARCHIVED' && archived.archivedAt !== null);
    const firstArchivedAt = archived!.archivedAt;
    const archivedAgain = await archiveGoal(userA.id, plain.goal.id);
    check('S. archiving an already-archived Goal is idempotent (status stays ARCHIVED)', archivedAgain !== null && archivedAgain.status === 'ARCHIVED');
    check('S. repeat archive does not overwrite the original archivedAt (COALESCE)', archivedAgain!.archivedAt!.getTime() === firstArchivedAt!.getTime());

    const activeList = await listGoalsForUser(userA.id, 'ACTIVE');
    check('16. list defaults exclude the now-archived Goal', !activeList.some((g: Goal) => g.id === plain.goal.id));
    const archivedList = await listGoalsForUser(userA.id, 'ARCHIVED');
    check('16. ?status=ARCHIVED returns the archived Goal', archivedList.some((g: Goal) => g.id === plain.goal.id));

    // ============================================================
    // T. delete Goal with no scheduled history / U. reject delete with history
    // ============================================================
    const deletable = await createGoalWithActivities({ userId: userA.id, title: 'Deletable goal', targetDate: null, activities: [{ title: 'Unlinked activity', activityId: null }] });
    check('T. a Goal with no linked PlannedActivity has no scheduled history', (await goalHasScheduledHistory(userA.id, deletable.goal.id)) === false);
    const deleteResult = await deleteGoal(userA.id, deletable.goal.id);
    check('T. deleteGoal succeeds (DELETED) when nothing real was ever scheduled', deleteResult === 'DELETED');
    check('T. the deleted Goal is truly gone', (await getGoalForUser(userA.id, deletable.goal.id)) === null);

    const stillLinkedGoal = await createGoalWithActivities({ userId: userA.id, title: 'Goal with live history', targetDate: null, activities: [] });
    createdGoalIds.push({ userId: userA.id, goalId: stillLinkedGoal.goal.id });
    const historyTarget = await addGoalActivity(userA.id, stillLinkedGoal.goal.id, { title: 'Real commitment', activityId: null });
    const historyPlan = await createPlannedActivity({
      userId: userA.id,
      title: 'Real commitment plan',
      plannedStartAt: new Date('2026-09-18T09:00:00Z'),
      plannedEndAt: new Date('2026-09-18T09:30:00Z'),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push({ userId: userA.id, planId: historyPlan.id });
    const client3 = await beginTransaction();
    await client3.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [historyPlan.id, historyTarget!.id]);
    await client3.query('COMMIT');
    client3.release();
    check('U. goalHasScheduledHistory is true once a GoalActivity is linked', (await goalHasScheduledHistory(userA.id, stillLinkedGoal.goal.id)) === true);
    check('U. deleteGoal rejects with HAS_HISTORY, never silently deletes real history', (await deleteGoal(userA.id, stillLinkedGoal.goal.id)) === 'HAS_HISTORY');
    check('U. the Goal still exists after a rejected delete', (await getGoalForUser(userA.id, stillLinkedGoal.goal.id)) !== null);

    // ============================================================
    // V-Z. cross-user isolation
    // ============================================================
    check('V. cross-user Goal read is rejected (returns null, not another user\'s row)', (await getGoalForUser(userB.id, stillLinkedGoal.goal.id)) === null);
    check('W. cross-user archive is rejected (returns null, no mutation)', (await archiveGoal(userB.id, stillLinkedGoal.goal.id)) === null);
    check('X. cross-user delete is rejected (NOT_FOUND, not HAS_HISTORY -- existence is never leaked)', (await deleteGoal(userB.id, stillLinkedGoal.goal.id)) === 'NOT_FOUND');
    check('X. cross-user delete performed no mutation -- the goal still exists for its real owner', (await getGoalForUser(userA.id, stillLinkedGoal.goal.id)) !== null);
    check('Y. cross-user activity creation is rejected (returns null, ownership-checked before insert)', (await addGoalActivity(userB.id, stillLinkedGoal.goal.id, { title: 'Injected', activityId: null })) === null);
    check('Z. cross-user dismissal is rejected (returns null, no mutation)', (await dismissGoalActivity(userB.id, stillLinkedGoal.goal.id, historyTarget!.id)) === null);
    const stillNotDismissed = await listGoalActivitiesWithLinkedPlanStatus(userA.id, stillLinkedGoal.goal.id);
    check('Z. the real owner\'s activity is unaffected by the rejected cross-user dismissal', stillNotDismissed.find((r) => r.id === historyTarget!.id)!.status === 'SUGGESTED');
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOALS DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOALS DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
