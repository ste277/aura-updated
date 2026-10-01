/**
 * Goals V2 G2.2.3 -- live-database proof that Move preserves
 * GoalActivityExecution continuity: A's execution row (if any) is
 * REPOINTED to B, never recreated/cloned/reset/deleted. Requires a real,
 * reachable DATABASE_URL, same convention as goalsDb.test.ts /
 * goalActivityExecutionCompletionDb.test.ts.
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/goalActivityExecutionMoveContinuityDb.test.ts
 */
import {
  upsertUserByEmail,
  createGoalWithActivities,
  addGoalActivity,
  createPlannedActivity,
  deleteGoal,
  beginTransaction,
} from '../apps/web/lib/db';
import { movePlannedActivity } from '../apps/web/lib/planMove';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';
const MIN = 60000;
let planCounter = 0;
function nextPlanWindow(): { start: Date; end: Date } {
  planCounter += 1;
  const start = new Date(`2026-11-${String(1 + planCounter).padStart(2, '0')}T09:00:00Z`);
  return { start, end: new Date(start.getTime() + 30 * MIN) };
}
let moveDest = 0;
function moveTo(): Date {
  moveDest += 1;
  return new Date(Math.floor(Date.now() / MIN) * MIN + 200 * 24 * 3600000 + moveDest * 3 * 3600000);
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
  const user = await upsertUserByEmail({ email: 'test-goal-execution-move@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: TZ });

  const createdGoalIds: string[] = [];
  const createdPlanIds: string[] = [];
  const track = (planId: string) => { createdPlanIds.push(planId); return planId; };
  // Heavy Move usage produces MOVED-status PlannedActivity rows, which
  // neither cancelPlannedActivity (UPCOMING only) nor deletePlannedActivity
  // (LOGGED/CANCELLED only) can remove -- same reasoning as
  // moveSourceContinuityDb.test.ts's own clean(), a raw hard delete
  // regardless of status is the correct cleanup here.
  const cleanup = async () => {
    await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`UPDATE "PlannedActivity" SET "rescheduledFromPlanId" = NULL WHERE "userId" = $1`, [user.id]);
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]);
    for (const goalId of createdGoalIds) {
      await deleteGoal(user.id, goalId).catch(() => {});
    }
  };

  try {
    const { goal } = await createGoalWithActivities({ userId: user.id, title: 'G2.2.3 move continuity tests', targetDate: null, activities: [] });
    createdGoalIds.push(goal.id);

    async function makeLinkedPlan(title: string) {
      const goalActivity = await addGoalActivity(user.id, goal.id, { title, activityId: null, completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } });
      const { start, end } = nextPlanWindow();
      const plan = await createPlannedActivity({ userId: user.id, title, plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
      track(plan.id);
      await sql(`UPDATE "GoalActivity" SET "plannedActivityId" = $1 WHERE id = $2`, [plan.id, goalActivity!.id]);
      return { goalActivity: goalActivity!, plan };
    }

    async function makeExecution(goalActivityId: string, plannedActivityId: string, fields: { completionKindSnapshot: string; completionTargetValueSnapshot: number | null; completionUnitSnapshot: string | null; currentValue: number | null; source?: string | null }) {
      const rows = await sql(
        `INSERT INTO "GoalActivityExecution"
           (id, "userId", "goalActivityId", "plannedActivityId", "completionKindSnapshot", "completionTargetValueSnapshot", "completionUnitSnapshot", "currentValue", "source")
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [user.id, goalActivityId, plannedActivityId, fields.completionKindSnapshot, fields.completionTargetValueSnapshot, fields.completionUnitSnapshot, fields.currentValue, fields.source ?? null]
      );
      return rows[0];
    }

    async function readExecution(id: string) {
      const rows = await sql(`SELECT * FROM "GoalActivityExecution" WHERE id = $1`, [id]);
      return rows[0] ?? null;
    }

    async function readExecutionByPlan(planId: string) {
      const rows = await sql(`SELECT * FROM "GoalActivityExecution" WHERE "plannedActivityId" = $1`, [planId]);
      return rows[0] ?? null;
    }

    // ============================================================
    // 15. Move without Goal -- unchanged
    // ============================================================
    {
      const { start, end } = nextPlanWindow();
      const plan = await createPlannedActivity({ userId: user.id, title: 'Ordinary plan (no Goal)', plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
      track(plan.id);
      const mv = await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      check('15. non-Goal Move: A MOVED, B UPCOMING, exactly as before', mv.from.status === 'MOVED' && mv.to.status === 'UPCOMING');
      check('15. non-Goal Move: no GoalActivityExecution created for either A or B', (await readExecutionByPlan(mv.from.id)) === null && (await readExecutionByPlan(mv.to.id)) === null);
    }

    // ============================================================
    // 16. Move Goal plan WITHOUT an execution
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Goal-linked, no execution yet');
      const mv = await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const rows = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [goalActivity.id]);
      check('16. Move succeeds, GoalActivity repoints to B', rows[0].plannedActivityId === mv.to.id);
      check('16. zero execution records exist for either A or B -- nothing fabricated by Move', (await readExecutionByPlan(mv.from.id)) === null && (await readExecutionByPlan(mv.to.id)) === null);
    }

    // ============================================================
    // 17. Move WITH an execution
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Read 20 pages (with execution)');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 12, source: 'AURA_PLANNED' });
      const mv = await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const after = await readExecution(exec.id);
      check('17. A remains MOVED, B is the live successor', mv.from.status === 'MOVED' && mv.to.status === 'UPCOMING');
      const goalRows = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [goalActivity.id]);
      check('17. GoalActivity.plannedActivityId = B', goalRows[0].plannedActivityId === mv.to.id);
      check('17. execution.id unchanged (same row, not recreated)', after.id === exec.id);
      check('17. execution.goalActivityId unchanged', after.goalActivityId === goalActivity.id);
      check('17. execution.plannedActivityId = B', after.plannedActivityId === mv.to.id);
      check('17. execution.currentValue unchanged (12)', after.currentValue === 12);
      check('17. execution snapshot unchanged (20/pages)', after.completionTargetValueSnapshot === 20 && after.completionUnitSnapshot === 'pages');
    }

    // ============================================================
    // 18. Snapshot immutability across a LIVE target change + Move
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Read 20 pages (snapshot immutability)');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 12 });
      await sql(`UPDATE "GoalActivity" SET "completionTargetValue" = 30 WHERE id = $1`, [goalActivity.id]);
      const mv = await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const liveGoal = await sql(`SELECT "completionTargetValue" FROM "GoalActivity" WHERE id = $1`, [goalActivity.id]);
      const after = await readExecution(exec.id);
      check('18. live GoalActivity target really did change to 30', liveGoal[0].completionTargetValue === 30);
      check('18. execution snapshot remains 20 -- Move never re-snapshots from the live GoalActivity', after.completionTargetValueSnapshot === 20);
      check('18. execution currentValue remains 12', after.currentValue === 12);
      check('18. execution plannedActivityId = B', after.plannedActivityId === mv.to.id);
    }

    // ============================================================
    // 19. zero currentValue preserved
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Zero-value execution');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'DURATION', completionTargetValueSnapshot: 30, completionUnitSnapshot: null, currentValue: 0 });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const after = await readExecution(exec.id);
      check('19. currentValue = 0 is preserved exactly (no falsy-value bug coercing it to null/target)', after.currentValue === 0);
    }

    // ============================================================
    // 20. above-target currentValue preserved
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Exceeds-target execution');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 25 });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const after = await readExecution(exec.id);
      check('20. currentValue = 25 (above target 20) preserved exactly, no clamp', after.currentValue === 25);
    }

    // ============================================================
    // 21. null currentValue preserved (a valid persisted state -- an
    // execution that exists but has not yet recorded a measured value; not
    // reachable via any G2.2.2 production write today, but a legitimate
    // persisted shape this table's own schema allows and G2.2.1 explicitly
    // designed the read/normalize helpers around)
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Null-value execution');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'DURATION', completionTargetValueSnapshot: 30, completionUnitSnapshot: null, currentValue: null });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const after = await readExecution(exec.id);
      check('21. currentValue = null is preserved as null -- Move never interprets null as "initialize progress"', after.currentValue === null);
    }

    // ============================================================
    // 22. DONE snapshot test. NOT reachable via production: a DONE-kind
    // execution is only ever created inside logPlannedActivity (G2.2.2),
    // in the SAME transaction that sets PlannedActivity.status = 'LOGGED'
    // -- but Move only accepts an UPCOMING plan (movePlannedActivity ->
    // applyMoveWrites's own conditional UPDATE ... WHERE status =
    // 'UPCOMING'). A DONE-kind execution can therefore never coexist with
    // a movable (UPCOMING) plan under current production semantics --
    // documenting this rather than fabricating an impossible production
    // state. Constructed directly here via raw SQL purely to prove the
    // underlying continuity UPDATE is kind-agnostic (it never references
    // completionKindSnapshot at all), as defense in depth.
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('DONE-kind execution (constructed directly, not a reachable production state)');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'DONE', completionTargetValueSnapshot: null, completionUnitSnapshot: null, currentValue: null });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const after = await readExecution(exec.id);
      check('22. DONE-kind snapshot (kind/null/null) preserved exactly across Move', after.completionKindSnapshot === 'DONE' && after.completionTargetValueSnapshot === null && after.completionUnitSnapshot === null && after.currentValue === null);
    }

    // ============================================================
    // 23. source preservation
    // ============================================================
    {
      const { goalActivity, plan } = await makeLinkedPlan('Source preservation (AURA_PLANNED)');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 20, source: 'AURA_PLANNED' });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      check('23. source (AURA_PLANNED) unchanged after Move', (await readExecution(exec.id)).source === 'AURA_PLANNED');
    }
    {
      // A non-default value from the same conceptual vocabulary
      // (apps/web/lib/goalActivityExecution.ts's own doc comment), not yet
      // written by any production path -- proves Move's UPDATE doesn't
      // touch this column regardless of its value.
      const { goalActivity, plan } = await makeLinkedPlan('Source preservation (MANUAL)');
      const exec = await makeExecution(goalActivity.id, plan.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 20, source: 'MANUAL' });
      await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      check('23. a non-default source (MANUAL) is also left untouched by Move', (await readExecution(exec.id)).source === 'MANUAL');
    }

    // ============================================================
    // 24. multiple Moves -- A -> B -> C, execution follows both times,
    // never a second/third execution row created
    // ============================================================
    {
      const { goalActivity, plan: planA } = await makeLinkedPlan('Multi-move execution');
      const exec = await makeExecution(goalActivity.id, planA.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 8 });
      const mv1 = await movePlannedActivity(user.id, planA.id, { newStartAt: moveTo() });
      const planBId = mv1.to.id;
      const afterFirst = await readExecution(exec.id);
      check('24. after A->B: execution follows to B, same id/goalActivityId/snapshot/currentValue', afterFirst.id === exec.id && afterFirst.goalActivityId === goalActivity.id && afterFirst.plannedActivityId === planBId && afterFirst.completionTargetValueSnapshot === 20 && afterFirst.currentValue === 8);
      const mv2 = await movePlannedActivity(user.id, planBId, { newStartAt: moveTo() });
      const planCId = mv2.to.id;
      const afterSecond = await readExecution(exec.id);
      check('24. after B->C: execution follows to C, still the SAME row', afterSecond.id === exec.id && afterSecond.goalActivityId === goalActivity.id && afterSecond.plannedActivityId === planCId && afterSecond.completionTargetValueSnapshot === 20 && afterSecond.currentValue === 8);
      const statusRows = await sql(`SELECT id, status FROM "PlannedActivity" WHERE id = ANY($1::text[])`, [[planA.id, planBId, planCId]]);
      const statusOf = (id: string) => statusRows.find((r) => r.id === id)!.status;
      check('24. A = MOVED, B = MOVED (superseded by the second Move), C = live UPCOMING successor', statusOf(planA.id) === 'MOVED' && statusOf(planBId) === 'MOVED' && statusOf(planCId) === 'UPCOMING');
      const execCount = await sql(`SELECT count(*)::int AS n FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [goalActivity.id]);
      check('24. exactly ONE execution row exists for this GoalActivity -- no E2/E3 created across two Moves', execCount[0].n === 1);
      track(planBId);
      track(planCId);
    }

    // ============================================================
    // 25. conflict: B already claimed by a DIFFERENT execution row
    // ============================================================
    {
      const { goalActivity: gaA, plan: planA } = await makeLinkedPlan('Conflict source (A)');
      const execA = await makeExecution(gaA.id, planA.id, { completionKindSnapshot: 'MEASURED_TARGET', completionTargetValueSnapshot: 20, completionUnitSnapshot: 'pages', currentValue: 10 });

      // Pre-create B directly (bypassing Move) and give it its OWN, unrelated execution row --
      // the "should be structurally impossible under correct Move semantics" scenario.
      const { start: bStart, end: bEnd } = nextPlanWindow();
      const conflictingPlanB = await createPlannedActivity({ userId: user.id, title: 'Pre-existing plan with its own execution', plannedStartAt: bStart, plannedEndAt: bEnd, durationMinutes: 30, windowType: 'NEUTRAL' });
      track(conflictingPlanB.id);
      const { goalActivity: gaOther } = await makeLinkedPlan('Unrelated GoalActivity for the conflicting execution');
      const execB = await makeExecution(gaOther.id, conflictingPlanB.id, { completionKindSnapshot: 'DONE', completionTargetValueSnapshot: null, completionUnitSnapshot: null, currentValue: null });

      // Force Move to land A exactly on conflictingPlanB's id by directly
      // driving applyMoveWrites-equivalent conflict: since movePlannedActivity
      // always creates a FRESH randomUUID() successor, we cannot make the
      // ORM produce the exact collision through the public API -- so we
      // prove the invariant at the layer that actually matters: the raw
      // continuity UPDATE itself, run exactly as applyMoveWrites runs it,
      // against this real conflicting row.
      let threw = false;
      let errCode: string | undefined;
      const client = await beginTransaction();
      try {
        await client.query(`UPDATE "GoalActivityExecution" SET "plannedActivityId" = $1, "updatedAt" = now() WHERE "plannedActivityId" = $2 AND "userId" = $3`, [conflictingPlanB.id, planA.id, user.id]);
        await client.query('COMMIT');
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        threw = true;
        errCode = err?.code;
      } finally {
        client.release();
      }
      check('25. repointing execution A onto an ALREADY-CLAIMED plannedActivityId fails (unique_violation), never silently overwrites/merges', threw && errCode === '23505');
      const execAAfter = await readExecution(execA.id);
      const execBAfter = await readExecution(execB.id);
      check('25. execution A is untouched (still points at planA, not corrupted by the failed attempt)', execAAfter.plannedActivityId === planA.id && execAAfter.currentValue === 10);
      check('25. execution B (the pre-existing conflicting claim) is untouched', execBAfter.plannedActivityId === conflictingPlanB.id);
    }

    // ============================================================
    // 26. Capture continuity spot-check (full regression lives in
    // moveSourceContinuityDb.test.ts -- this just confirms G2.2.3 didn't
    // disturb the sibling continuity statement it sits directly beside)
    // ============================================================
    {
      const { start, end } = nextPlanWindow();
      const plan = await createPlannedActivity({ userId: user.id, title: 'Capture continuity spot-check', plannedStartAt: start, plannedEndAt: end, durationMinutes: 30, windowType: 'NEUTRAL' });
      track(plan.id);
      const capRows = await sql(`INSERT INTO "Capture" (id, "userId", title, "plannedActivityId") VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id`, [user.id, 'Spot-check capture', plan.id]);
      const mv = await movePlannedActivity(user.id, plan.id, { newStartAt: moveTo() });
      const capAfter = await sql(`SELECT "plannedActivityId" FROM "Capture" WHERE id = $1`, [capRows[0].id]);
      check('26. Capture continuity unaffected by the G2.2.3 addition: Capture still follows A -> B', capAfter[0].plannedActivityId === mv.to.id);
    }
  } finally {
    await cleanup();
  }

  if (!allPassed) {
    console.error('SOME GOAL ACTIVITY EXECUTION MOVE CONTINUITY CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL ACTIVITY EXECUTION MOVE CONTINUITY CHECKS PASSED');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
