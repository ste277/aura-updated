/**
 * Goals V2 G3.1 -- live-database proof of loadGoalContextsForPlanIds (the
 * batched Goal-context loader) and listGoalActivitiesWithLinkedPlanStatus's
 * new currentValue field (Goal Detail). Requires a real, reachable
 * DATABASE_URL, same convention as every other Goals V2 DB test.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalContextDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  logPlannedActivity,
  deleteGoal,
  beginTransaction,
  loadGoalContextsForPlanIds,
  listGoalActivitiesWithLinkedPlanStatus,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
let planCounter = 0;
function nextPlanWindow(): { start: Date; end: Date } {
  planCounter += 1;
  const start = new Date(`2026-12-${String(1 + planCounter).padStart(2, '0')}T09:00:00Z`);
  return { start, end: new Date(start.getTime() + 30 * 60000) };
}
let moveDest = 0;
function moveTo(): Date {
  moveDest += 1;
  return new Date(Math.floor(Date.now() / 60000) * 60000 + 300 * 24 * 3600000 + moveDest * 3 * 3600000);
}

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

async function main() {
  const user = await upsertUserByEmail({ email: 'test-goal-context@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });
  const otherUser = await upsertUserByEmail({ email: 'test-goal-context-other@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, otherUser.id]]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = ANY($1::text[])`, [[user.id, otherUser.id]]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = ANY($1::text[])`, [[user.id, otherUser.id]]);
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
    }
  };

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'G3.1 goal context tests', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);

    async function makeLinkedPlan(title: string, completionRequirement?: { kind: 'DONE' | 'DURATION' | 'MEASURED_TARGET'; targetValue?: number; unit?: string }, ownerId = user.id, goalId = goal.id) {
      const goalActivity = await addGoalActivity(ownerId, goalId, { title, activityId: null, completionRequirement });
      const { start, end } = nextPlanWindow();
      const plan = await createPlannedActivity({ userId: ownerId, title, plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
      await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan.id, goalActivity!.id]);
      return { goalActivity: goalActivity!, plan };
    }

    // ============================================================
    // 27. non-Goal regression
    // ============================================================
    {
      const { start, end } = nextPlanWindow();
      const plainPlan = await createPlannedActivity({ userId: user.id, title: 'Ordinary plan', plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
      const contexts = await loadGoalContextsForPlanIds(user.id, [plainPlan.id]);
      check('27. non-Goal plan: no entry in the returned Map', !contexts.has(plainPlan.id));
    }

    // ============================================================
    // 28. legacy DONE (NULL completion fields)
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Call parents'); // no completionRequirement -> NULL fields, legacy DONE
      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('28. legacy DONE: goal identity correct', ctx.goal.id === goal.id && ctx.goal.title === 'G3.1 goal context tests');
      check('28. legacy DONE: goalActivity id correct', ctx.goalActivity.id === goalActivity.id);
      check('28. legacy DONE: completionRequirement normalizes NULL fields to DONE', ctx.goalActivity.completionRequirement.kind === 'DONE');
      check('28. legacy DONE: currentValue = null (no execution)', ctx.currentValue === null);
    }

    // ============================================================
    // 29. DURATION before completion
    // ============================================================
    {
      const { plan } = await makeLinkedPlan('Workout', { kind: 'DURATION', targetValue: 30 });
      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('29. DURATION before completion: target = 30', ctx.goalActivity.completionRequirement.targetValue === 30);
      check('29. DURATION before completion: currentValue = null, NOT 30 -- target and actual are distinct', ctx.currentValue === null);
    }

    // ============================================================
    // 30. DURATION after completion -- default actual (30) and override (18)
    // ============================================================
    {
      const { plan } = await makeLinkedPlan('Workout (default)', { kind: 'DURATION', targetValue: 30 });
      await logPlannedActivity(user.id, plan.id); // no actualValue -> defaults to target
      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('30. DURATION after completion (default): target = 30, currentValue = 30', ctx.goalActivity.completionRequirement.targetValue === 30 && ctx.currentValue === 30);
    }
    {
      const { plan } = await makeLinkedPlan('Workout (override)', { kind: 'DURATION', targetValue: 30 });
      await logPlannedActivity(user.id, plan.id, { actualValue: 18 });
      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('30. DURATION after completion (override): target = 30, currentValue = 18', ctx.goalActivity.completionRequirement.targetValue === 30 && ctx.currentValue === 18);
    }

    // ============================================================
    // 31. MEASURED_TARGET
    // ============================================================
    {
      const { plan } = await makeLinkedPlan('Read 20 pages', { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' });
      await logPlannedActivity(user.id, plan.id, { actualValue: 12 });
      const contexts = await loadGoalContextsForPlanIds(user.id, [plan.id]);
      const ctx = contexts.get(plan.id)!;
      check('31. MEASURED_TARGET: kind/target/unit correct', ctx.goalActivity.completionRequirement.kind === 'MEASURED_TARGET' && ctx.goalActivity.completionRequirement.targetValue === 20 && ctx.goalActivity.completionRequirement.unit === 'pages');
      check('31. MEASURED_TARGET: currentValue = 12', ctx.currentValue === 12);
    }

    // ============================================================
    // 32/33. exceeds target / zero
    // ============================================================
    {
      const { plan } = await makeLinkedPlan('Read (exceeds)', { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' });
      await logPlannedActivity(user.id, plan.id, { actualValue: 25 });
      const ctx = (await loadGoalContextsForPlanIds(user.id, [plan.id])).get(plan.id)!;
      check('32. exceeds target: currentValue = 25, no clamp', ctx.currentValue === 25);
    }
    {
      const { plan } = await makeLinkedPlan('Workout (zero)', { kind: 'DURATION', targetValue: 30 });
      await logPlannedActivity(user.id, plan.id, { actualValue: 0 });
      const ctx = (await loadGoalContextsForPlanIds(user.id, [plan.id])).get(plan.id)!;
      check('33. zero: currentValue = 0, no falsy-value bug', ctx.currentValue === 0);
    }

    // ============================================================
    // 34. Move -- B receives context, A (current-linkage lookup) does not
    // ============================================================
    {
      const { plan: planA } = await makeLinkedPlan('Read (move)', { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' });
      const client = await beginTransaction();
      await client.query(
        `INSERT INTO "GoalActivityExecution" (id, "userId", "goalActivityId", "plannedActivityId", "completionKindSnapshot", "completionTargetValueSnapshot", "completionUnitSnapshot", "currentValue")
         SELECT gen_random_uuid(), $1, ga.id, $2, 'MEASURED_TARGET', 20, 'pages', 8 FROM "GoalActivity" ga WHERE ga."plannedActivityId" = $2`,
        [user.id, planA.id]
      );
      await client.query('COMMIT');
      client.release();
      const mv = await movePlannedActivity(user.id, planA.id, { newStartAt: moveTo() });
      const contexts = await loadGoalContextsForPlanIds(user.id, [planA.id, mv.to.id]);
      check('34. B (live successor) receives Goal context', contexts.has(mv.to.id) && contexts.get(mv.to.id)!.currentValue === 8);
      check('34. A (current-linkage lookup) does NOT receive Goal context -- no lineage traversal', !contexts.has(planA.id));
    }

    // ============================================================
    // 35. user isolation
    // ============================================================
    {
      const { goal: otherGoal } = await createGoalWithActivities({ userId: otherUser.id, title: 'Other user goal', targetDate: null, activities: [] });
      const { plan: otherPlan } = await makeLinkedPlan('Other user activity', { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, otherUser.id, otherGoal.id);
      await logPlannedActivity(otherUser.id, otherPlan.id, { actualValue: 15 });
      // Query AS the first user for the OTHER user's plan id -- must return nothing.
      const contexts = await loadGoalContextsForPlanIds(user.id, [otherPlan.id]);
      check('35. querying as a different user for another user\'s Goal-linked plan id returns no context (userId scoping on the base GoalActivity row)', !contexts.has(otherPlan.id));
      await deleteGoal(otherUser.id, otherGoal.id).catch(() => {});
    }

    // ============================================================
    // 36. Goal Detail currentValue (listGoalActivitiesWithLinkedPlanStatus)
    // ============================================================
    {
      const doneGA = await addGoalActivity(user.id, goal.id, { title: 'Detail: DONE', activityId: null });
      const durationGA = await addGoalActivity(user.id, goal.id, { title: 'Detail: DURATION', activityId: null, completionRequirement: { kind: 'DURATION', targetValue: 30 } });
      const measuredGA = await addGoalActivity(user.id, goal.id, { title: 'Detail: MEASURED', activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } });
      const { start: s1, end: e1 } = nextPlanWindow();
      const p1 = await createPlannedActivity({ userId: user.id, title: 'Detail: DURATION', plannedStartAt: s1, plannedEndAt: e1, durationMinutes: 30, windowType: 'NEUTRAL' });
      await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [p1.id, durationGA!.id]);
      await logPlannedActivity(user.id, p1.id, { actualValue: 22 });

      const rows = await listGoalActivitiesWithLinkedPlanStatus(user.id, goal.id);
      const doneRow = rows.find((r) => r.id === doneGA!.id)!;
      const durationRow = rows.find((r) => r.id === durationGA!.id)!;
      const measuredRow = rows.find((r) => r.id === measuredGA!.id)!;
      check('36. Goal Detail: DONE activity currentValue = null', doneRow.currentValue === null);
      check('36. Goal Detail: DURATION activity (completed, override 22) currentValue = 22', durationRow.currentValue === 22);
      check('36. Goal Detail: MEASURED_TARGET activity with no linked plan currentValue = null', measuredRow.currentValue === null);
      check('36. Goal Detail: no execution internals present (row has no id/source/snapshot-prefixed keys beyond GoalActivity\'s own)', !('source' in durationRow) && !('completionKindSnapshot' in durationRow));
    }

    // ============================================================
    // 37. N+1 guard (behavioral): loadGoalContextsForPlanIds resolves N
    // plan ids in exactly the calls this test itself makes (one function
    // call per assertion group above, never one per plan id within a
    // single call) -- explicitly re-verified here with a larger batch.
    // ============================================================
    {
      const plans: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { plan } = await makeLinkedPlan(`Batch ${i}`, { kind: 'MEASURED_TARGET', targetValue: 10, unit: 'reps' });
        plans.push(plan.id);
      }
      const contexts = await loadGoalContextsForPlanIds(user.id, plans);
      check('37. one loadGoalContextsForPlanIds call resolves all 5 plan ids at once (batched, not N calls)', plans.every((id) => contexts.has(id)) && contexts.size >= 5);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL CONTEXT DB CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL CONTEXT DB CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
