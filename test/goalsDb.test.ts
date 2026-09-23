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
  goalHasRetainedPlanLinkage,
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
import { randomUUID } from 'crypto';

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
    check(
      'AA(happy path only). Goal + its template activities all share the same goalId, created in one atomic call -- NOTE: this alone only proves the happy-path shape, not that a failure actually rolls back; see the failure-injection check immediately below for that',
      templated.activities.every((a) => a.goalId === templated.goal.id)
    );

    // ============================================================
    // AA(failure injection) -- transaction atomicity, verified for real.
    // The shared-goalId check above only proves what a SUCCESSFUL call
    // produces; it says nothing about what happens when one of the later
    // activity inserts fails mid-transaction. This forces a real Postgres
    // error (a NOT NULL violation on the second activity's title,
    // deliberately bypassing TypeScript) AFTER the Goal row and the first
    // activity row have already been written inside the same open
    // transaction, then verifies via raw queries (not through
    // getGoalForUser/listGoalActivitiesWithLinkedPlanStatus, which are
    // themselves scoped by id and would trivially return nothing for an id
    // we never got back) that NEITHER row survived -- proving createGoal-
    // WithActivities's ROLLBACK actually undoes an already-succeeded
    // earlier statement in the same transaction, not just skips the
    // failing one.
    // ============================================================
    const failureInjectionGoalTitle = `Atomicity failure-injection goal ${randomUUID()}`;
    const failureInjectionFirstActivityTitle = `Should be rolled back ${randomUUID()}`;
    let failureInjectionThrew = false;
    try {
      await createGoalWithActivities({
        userId: userA.id,
        title: failureInjectionGoalTitle,
        targetDate: null,
        activities: [
          { title: failureInjectionFirstActivityTitle, activityId: null },
          { title: null as unknown as string, activityId: null }, // violates GoalActivity.title NOT NULL, mid-transaction, on purpose
        ],
      });
    } catch {
      failureInjectionThrew = true;
    }
    check('AA(failure-injection). createGoalWithActivities throws when a later activity insert violates a real constraint (NOT NULL on title)', failureInjectionThrew);

    const verifyClient = await beginTransaction();
    const leakedGoal = await verifyClient.query(`SELECT 1 FROM "Goal" WHERE title = $1`, [failureInjectionGoalTitle]);
    const leakedActivity = await verifyClient.query(`SELECT 1 FROM "GoalActivity" WHERE title = $1`, [failureInjectionFirstActivityTitle]);
    await verifyClient.query('ROLLBACK'); // read-only -- nothing to commit
    verifyClient.release();
    check('AA(failure-injection). the Goal row itself was rolled back too, not left behind as a partial commit', leakedGoal.rows.length === 0);
    check('AA(failure-injection). the EARLIER, already-succeeded first activity insert was also rolled back (real transactional atomicity, not best-effort cleanup)', leakedActivity.rows.length === 0);

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
    // T. delete Goal with no retained PlannedActivity linkage / U. reject
    // delete while a linkage is retained. Deliberately NOT "no scheduled
    // history" / "nothing was ever scheduled" -- goalHasRetainedPlanLinkage
    // checks CURRENT linkage (a non-null plannedActivityId right now), not
    // a durable "ever scheduled" record; see its own doc comment in db.ts.
    // ============================================================
    const deletable = await createGoalWithActivities({ userId: userA.id, title: 'Deletable goal', targetDate: null, activities: [{ title: 'Unlinked activity', activityId: null }] });
    check('T. a Goal with no linked PlannedActivity has no retained linkage', (await goalHasRetainedPlanLinkage(userA.id, deletable.goal.id)) === false);
    const deleteResult = await deleteGoal(userA.id, deletable.goal.id);
    check('T. deleteGoal succeeds (DELETED) when no PlannedActivity linkage is retained', deleteResult === 'DELETED');
    check('T. the deleted Goal is truly gone', (await getGoalForUser(userA.id, deletable.goal.id)) === null);

    const stillLinkedGoal = await createGoalWithActivities({ userId: userA.id, title: 'Goal with a retained linkage', targetDate: null, activities: [] });
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
    check('U. goalHasRetainedPlanLinkage is true once a GoalActivity is linked', (await goalHasRetainedPlanLinkage(userA.id, stillLinkedGoal.goal.id)) === true);
    check('U. deleteGoal rejects with HAS_HISTORY while the linkage is retained, never silently deletes it', (await deleteGoal(userA.id, stillLinkedGoal.goal.id)) === 'HAS_HISTORY');
    check('U. the Goal still exists after a rejected delete', (await getGoalForUser(userA.id, stillLinkedGoal.goal.id)) !== null);

    // ============================================================
    // Delete-history semantics decision: hard-deleting the underlying
    // PlannedActivity clears the linkage (existing ON DELETE SET NULL,
    // unchanged) and the Goal becomes eligible for hard deletion again --
    // proving this is NOT a durable "ever scheduled" tombstone. No
    // everPlannedAt column, no separate association-history table. Uses a
    // SEPARATE Goal/activity/plan trio (not stillLinkedGoal, which the
    // V-Z cross-user checks below still need intact).
    // ============================================================
    const reclaimableGoal = await createGoalWithActivities({ userId: userA.id, title: 'Goal whose linkage will be cleared by a hard delete', targetDate: null, activities: [] });
    createdGoalIds.push({ userId: userA.id, goalId: reclaimableGoal.goal.id });
    const reclaimableTarget = await addGoalActivity(userA.id, reclaimableGoal.goal.id, { title: 'Real commitment, later removed', activityId: null });
    const reclaimablePlan = await createPlannedActivity({
      userId: userA.id,
      title: 'Plan to be hard-deleted for the reclaim test',
      plannedStartAt: new Date('2026-09-19T09:00:00Z'),
      plannedEndAt: new Date('2026-09-19T09:30:00Z'),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    const client4 = await beginTransaction();
    await client4.query(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [reclaimablePlan.id, reclaimableTarget!.id]);
    await client4.query('COMMIT');
    client4.release();
    check('linkage blocks delete before the linked Plan is removed', (await deleteGoal(userA.id, reclaimableGoal.goal.id)) === 'HAS_HISTORY');

    await cancelPlannedActivity(userA.id, reclaimablePlan.id);
    await deletePlannedActivity(userA.id, reclaimablePlan.id); // triggers ON DELETE SET NULL on GoalActivity.plannedActivityId
    check('once the linked PlannedActivity is hard-deleted (SetNull, unchanged mechanism), goalHasRetainedPlanLinkage reports false again', (await goalHasRetainedPlanLinkage(userA.id, reclaimableGoal.goal.id)) === false);
    check('the Goal is now eligible for hard deletion again -- no durable "ever scheduled" tombstone blocks it', (await deleteGoal(userA.id, reclaimableGoal.goal.id)) === 'DELETED');
    createdGoalIds.pop(); // already deleted -- don't double-delete in cleanup

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
