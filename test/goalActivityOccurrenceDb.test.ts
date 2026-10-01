/**
 * Goals V2 Rhythm R1 -- live-database persistence proof for the new,
 * behaviorally inert "GoalActivityOccurrence" table (migration 0042). No
 * production write path creates these rows yet (a later Rhythm slice), so
 * this test exercises the table directly via raw SQL through
 * beginTransaction() -- same established precedent as
 * goalActivityExecutionDb.test.ts (G2.2.1) and goalsDb.test.ts's own "M/N/O"
 * section, both of which proved a new table's schema capability before any
 * dedicated write function existed for it.
 *
 * Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityOccurrenceDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  deletePlannedActivity,
  deleteGoal,
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

async function sql(text: string, params: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try {
    const r = await c.query(text, params);
    await c.query('COMMIT');
    return r.rows;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

async function sqlExpectError(text: string, params: unknown[] = []): Promise<string | null> {
  const c = await beginTransaction();
  try {
    await c.query(text, params);
    await c.query('COMMIT');
    return null;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    return e instanceof Error ? e.message : String(e);
  } finally {
    c.release();
  }
}

const insertOccurrence = (userId: string, goalActivityId: string, plannedActivityId: string | null) =>
  sql(
    `INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id, "userId", "goalActivityId", "plannedActivityId", "createdAt"`,
    [userId, goalActivityId, plannedActivityId]
  );

async function main() {
  const userA = await upsertUserByEmail({ email: 'test-goal-activity-occurrence-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const userB = await upsertUserByEmail({ email: 'test-goal-activity-occurrence-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const createdPlanIds: string[] = [];
  const cleanup = async () => {
    for (const planId of createdPlanIds) {
      await cancelPlannedActivity(userA.id, planId).catch(() => {});
      await deletePlannedActivity(userA.id, planId).catch(() => {});
    }
    for (const goalId of createdGoalIds) {
      await deleteGoal(userA.id, goalId).catch(() => {});
    }
  };

  try {
    const { goal } = await createGoalWithActivities({ userId: userA.id, title: 'Meditate regularly (R1 fixture)', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);
    const goalActivity = await addGoalActivity(userA.id, goal.id, { title: 'Meditate 10 minutes', activityId: null });

    // ============================================================
    // 1. occurrence can reference GoalActivity
    // ============================================================
    const first = (await insertOccurrence(userA.id, goalActivity!.id, null))[0];
    check('1. occurrence row inserted, referencing GoalActivity, with the expected userId', first.goalActivityId === goalActivity!.id && first.userId === userA.id);

    // ============================================================
    // 2. one GoalActivity can have multiple occurrences
    // ============================================================
    const second = (await insertOccurrence(userA.id, goalActivity!.id, null))[0];
    const third = (await insertOccurrence(userA.id, goalActivity!.id, null))[0];
    const allForActivity = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1 ORDER BY "createdAt"`, [goalActivity!.id]);
    check('2. one GoalActivity has THREE simultaneous occurrence rows (the fundamental R1 capability)', allForActivity.length === 3 && new Set([first.id, second.id, third.id, ...allForActivity.map((r) => r.id)]).size === 3);

    // ============================================================
    // 3. occurrence may have null plannedActivityId
    // ============================================================
    check('3. occurrence rows persist with plannedActivityId = NULL (eligible-but-unscheduled is a valid future state)', first.plannedActivityId === null && second.plannedActivityId === null && third.plannedActivityId === null);

    // ============================================================
    // 4. plannedActivityId can be linked
    // ============================================================
    const plan1 = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: new Date('2026-09-21T05:00:00Z'), plannedEndAt: new Date('2026-09-21T05:10:00Z'), durationMinutes: 10, windowType: 'NEUTRAL' });
    createdPlanIds.push(plan1.id);
    const linked = (await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = $1 WHERE id = $2 RETURNING "plannedActivityId"`, [plan1.id, first.id]))[0];
    check('4. plannedActivityId can be linked after creation', linked.plannedActivityId === plan1.id);

    // ============================================================
    // 5. plannedActivityId is unique across occurrences when non-null
    // ============================================================
    const dupeError = await sqlExpectError(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = $1 WHERE id = $2`, [plan1.id, second.id]);
    check('5. a SECOND occurrence cannot claim the SAME plannedActivityId -- unique constraint rejects it', dupeError !== null && /unique|duplicate/i.test(dupeError));

    // ============================================================
    // 8. PlannedActivity deletion SET NULLs the occurrence's link, the row survives
    // ============================================================
    const plan2 = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: new Date('2026-09-22T05:00:00Z'), plannedEndAt: new Date('2026-09-22T05:10:00Z'), durationMinutes: 10, windowType: 'NEUTRAL' });
    await sql(`UPDATE "GoalActivityOccurrence" SET "plannedActivityId" = $1 WHERE id = $2`, [plan2.id, second.id]);
    await cancelPlannedActivity(userA.id, plan2.id); // UPCOMING -> CANCELLED (deletePlannedActivity requires LOGGED/CANCELLED)
    await deletePlannedActivity(userA.id, plan2.id);
    const afterPlanDelete = (await sql(`SELECT id, "plannedActivityId" FROM "GoalActivityOccurrence" WHERE id = $1`, [second.id]))[0];
    check('8. occurrence SURVIVES its linked PlannedActivity being hard-deleted, with plannedActivityId now NULL', !!afterPlanDelete && afterPlanDelete.plannedActivityId === null);

    // ============================================================
    // 9. cross-user isolation: a query scoped to userB finds nothing for userA's occurrences
    // ============================================================
    const crossUserLeak = await sql(`SELECT id FROM "GoalActivityOccurrence" WHERE "userId" = $1 AND "goalActivityId" = $2`, [userB.id, goalActivity!.id]);
    check('9. a userId-scoped lookup for a DIFFERENT user returns zero rows for userA\'s occurrences (no cross-user leak)', crossUserLeak.length === 0);
    const writeAsWrongUserError = await sqlExpectError(`INSERT INTO "GoalActivityOccurrence" (id, "userId", "goalActivityId", "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, NULL)`, [userB.id, 'nonexistent-goal-activity-id']);
    check('9. an occurrence cannot be inserted against a GoalActivity id that does not exist (FK enforced, never a silent orphan)', writeAsWrongUserError !== null);

    // ============================================================
    // 10. existing GoalActivity schema behavior remains unchanged alongside Occurrence rows
    // ============================================================
    const plan3 = await createPlannedActivity({ userId: userA.id, title: 'Meditate 10 minutes', plannedStartAt: new Date('2026-09-23T05:00:00Z'), plannedEndAt: new Date('2026-09-23T05:10:00Z'), durationMinutes: 10, windowType: 'NEUTRAL' });
    createdPlanIds.push(plan3.id);
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan3.id, goalActivity!.id]);
    const rows = await listGoalActivitiesWithLinkedPlanStatus(userA.id, goal.id);
    const row = rows.find((r) => r.id === goalActivity!.id)!;
    check('10. GoalActivity.plannedActivityId linkage behaves exactly as before (UPCOMING), unaffected by the THREE Occurrence rows that now also exist for it', row.plannedActivityId === plan3.id && row.linkedPlanStatus === 'UPCOMING');

    // ============================================================
    // 6. GoalActivity deletion cascades to its occurrences (direct delete)
    // ============================================================
    const { goal: goal2 } = await createGoalWithActivities({ userId: userA.id, title: 'R1 cascade fixture (direct GoalActivity delete)', targetDate: null, activities: [] });
    createdGoalIds.push(goal2.id);
    const ga2 = await addGoalActivity(userA.id, goal2.id, { title: 'Cascade-test activity', activityId: null });
    await insertOccurrence(userA.id, ga2!.id, null);
    await insertOccurrence(userA.id, ga2!.id, null);
    const beforeDirectDelete = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga2!.id]);
    await sql(`DELETE FROM "GoalActivity" WHERE id = $1`, [ga2!.id]);
    const afterDirectDelete = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga2!.id]);
    check('6. GoalActivity deletion cascades to its occurrences', beforeDirectDelete[0].n === 2 && afterDirectDelete[0].n === 0);

    // ============================================================
    // 7. Goal deletion cascades through GoalActivity to occurrences (via the real deleteGoal)
    // ============================================================
    const { goal: goal3, activities: acts3 } = await createGoalWithActivities({ userId: userA.id, title: 'R1 cascade fixture (Goal delete)', targetDate: null, activities: [{ title: 'Cascade via Goal', activityId: null }] });
    const ga3 = acts3[0];
    await insertOccurrence(userA.id, ga3.id, null);
    const beforeGoalDelete = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga3.id]);
    const deleteResult = await deleteGoal(userA.id, goal3.id);
    const afterGoalDelete = await sql(`SELECT count(*)::int n FROM "GoalActivityOccurrence" WHERE "goalActivityId" = $1`, [ga3.id]);
    check('7. Goal deletion (deleteGoal) cascades through GoalActivity to its occurrences -- deleteGoal itself is unaffected by Occurrence rows (its guard only ever checked GoalActivity.plannedActivityId, which is NULL here)', deleteResult === 'DELETED' && beforeGoalDelete[0].n === 1 && afterGoalDelete[0].n === 0);
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY OCCURRENCE DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY OCCURRENCE DB CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
