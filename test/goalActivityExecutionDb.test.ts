/**
 * Goals V2 G2.2.1 -- live-database persistence proof for the new,
 * behaviorally inert "GoalActivityExecution" table (migration 0041). No
 * production write path creates these rows yet (G2.2.2+), so this test
 * exercises the table directly via raw SQL through beginTransaction() --
 * same established precedent as goalsDb.test.ts's own "M/N/O" section,
 * which does the identical thing for GoalActivity.plannedActivityId before
 * its own dedicated linking function existed ("since PR D itself is a
 * later ticket").
 *
 * Requires a real, reachable DATABASE_URL, same convention as
 * goalsDb.test.ts:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityExecutionDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  deleteGoal,
  deletePlannedActivity,
  cancelPlannedActivity,
  beginTransaction,
  listGoalActivitiesWithLinkedPlanStatus,
} from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-activity-execution@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const createdPlanIds: string[] = [];
  const cleanup = async () => {
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(user.id, planId).catch(() => {});
      await deletePlannedActivity(user.id, planId).catch(() => {});
    }
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
    }
  };

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'Read more', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const goalActivity = await addGoalActivity(user.id, goal.id, { title: 'Read 20 pages', activityId: null });
    const plan = await createPlannedActivity({
      userId: user.id,
      title: 'Evening reading',
      plannedStartAt: new Date('2026-09-20T14:30:00Z'),
      plannedEndAt: new Date('2026-09-20T15:00:00Z'),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    createdPlanIds.push(plan.id);

    // ============================================================
    // 1. execution row can reference GoalActivity + PlannedActivity
    // ============================================================
    const client = await beginTransaction();
    let executionId: string;
    try {
      const insertRes = await client.query(
        `INSERT INTO "GoalActivityExecution"
           (id, "userId", "goalActivityId", "plannedActivityId", "completionKindSnapshot", "completionTargetValueSnapshot", "completionUnitSnapshot", "currentValue")
         VALUES (gen_random_uuid(), $1, $2, $3, 'MEASURED_TARGET', 20, 'pages', 12.5)
         RETURNING id, "goalActivityId", "plannedActivityId", "completionTargetValueSnapshot", "currentValue"`,
        [user.id, goalActivity!.id, plan.id]
      );
      await client.query('COMMIT');
      const row = insertRes.rows[0];
      executionId = row.id;
      check('1. execution row inserted, referencing both GoalActivity and PlannedActivity', row.goalActivityId === goalActivity!.id && row.plannedActivityId === plan.id);
      // ============================================================
      // 2. fractional target/current values survive round-trip
      // ============================================================
      check('2. fractional target (20 pages, integral here) and fractional currentValue (12.5) survive round-trip exactly', row.completionTargetValueSnapshot === 20 && row.currentValue === 12.5);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    // ============================================================
    // 3. currentValue may exceed target (no DB-level clamp)
    // ============================================================
    const client2 = await beginTransaction();
    try {
      const exceedRes = await client2.query(
        `UPDATE "GoalActivityExecution" SET "currentValue" = 25, "updatedAt" = now() WHERE id = $1 RETURNING "currentValue", "completionTargetValueSnapshot"`,
        [executionId]
      );
      await client2.query('COMMIT');
      const row = exceedRes.rows[0];
      check('3. currentValue (25) may exceed completionTargetValueSnapshot (20) -- no DB-level clamp/check constraint blocks it', row.currentValue === 25 && row.completionTargetValueSnapshot === 20);
    } finally {
      client2.release();
    }

    // ============================================================
    // 4. snapshot fields remain unchanged when GoalActivity's live
    //    completion definition changes
    // ============================================================
    const client3 = await beginTransaction();
    try {
      await client3.query(
        `UPDATE "GoalActivity" SET "completionKind" = 'MEASURED_TARGET', "completionTargetValue" = 30, "completionUnit" = 'pages', "updatedAt" = now() WHERE id = $1`,
        [goalActivity!.id]
      );
      await client3.query('COMMIT');
    } finally {
      client3.release();
    }
    const rehydrated = await beginTransaction();
    try {
      const res = await rehydrated.query(`SELECT "completionTargetValueSnapshot", "completionUnitSnapshot" FROM "GoalActivityExecution" WHERE id = $1`, [executionId]);
      await rehydrated.query('COMMIT');
      const row = res.rows[0];
      check('4. after the live GoalActivity target changed (20 -> 30 pages), the ALREADY-WRITTEN execution snapshot still reads 20 -- history was not silently rewritten', row.completionTargetValueSnapshot === 20 && row.completionUnitSnapshot === 'pages');
    } finally {
      rehydrated.release();
    }

    // ============================================================
    // 5. unique/cardinality constraint behaves as designed
    // ============================================================
    const secondGoalActivity = await addGoalActivity(user.id, goal.id, { title: 'A second suggested activity', activityId: null });
    const client4 = await beginTransaction();
    let uniqueViolationCaught = false;
    try {
      await client4.query(
        `INSERT INTO "GoalActivityExecution"
           (id, "userId", "goalActivityId", "plannedActivityId", "completionKindSnapshot")
         VALUES (gen_random_uuid(), $1, $2, $3, 'DONE')`,
        [user.id, secondGoalActivity!.id, plan.id] // SAME plan.id, already claimed above
      );
      await client4.query('COMMIT');
    } catch (err: any) {
      await client4.query('ROLLBACK').catch(() => {});
      uniqueViolationCaught = err?.code === '23505'; // Postgres unique_violation
    } finally {
      client4.release();
    }
    check('5. a second execution row cannot claim the SAME live plannedActivityId (unique constraint enforced at the DB level)', uniqueViolationCaught);

    // ============================================================
    // 6. legacy GoalActivity without execution row remains queryable
    // ============================================================
    const rows = await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id);
    check('6. a GoalActivity with zero GoalActivityExecution rows (the ordinary, pre-G2.2.1 case) remains fully queryable, no crash, no special-casing needed', rows.some((r) => r.id === secondGoalActivity!.id));

    // ============================================================
    // FK behavior: goalActivityId CASCADEs; deleting the Goal removes the
    // execution row too (confirmed via the SAME cascade the schema declares
    // for Goal -> GoalActivity).
    // ============================================================
    await deleteGoal(user.id, goal.id);
    createdGoalIds.pop(); // already deleted
    const postDeleteCheck = await beginTransaction();
    try {
      const res = await postDeleteCheck.query(`SELECT 1 FROM "GoalActivityExecution" WHERE id = $1`, [executionId]);
      await postDeleteCheck.query('COMMIT');
      check('FK: deleting the parent Goal (cascading to GoalActivity) also removes its GoalActivityExecution row (CASCADE, matches Goal->GoalActivity precedent)', res.rows.length === 0);
    } finally {
      postDeleteCheck.release();
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY EXECUTION DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY EXECUTION DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
