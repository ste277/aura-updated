// AURA HPG2 -- Phase 3: completion/progress integrity for a plan linked
// to a GoalActivity via the NEW main-Plan-tab entry point (POST
// /api/plans's goalActivityId handling). Verifies the established,
// UNMODIFIED completion (logPlannedActivity) and Move (movePlannedActivity)
// pathways behave correctly for this new entry point, exactly as they
// already do for the existing /plan-day entry point.
// Run with: npx ts-node test/planGoalActivityCompletionIntegrityDb.test.ts
import { POST as plansRoute } from '../apps/web/app/api/plans/route';
import { upsertUserByEmail, createGoalWithActivities, logPlannedActivity, beginTransaction } from '../apps/web/lib/db';
import { createSessionToken } from '../apps/web/lib/auth';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { deriveGoalActivityState, computeGoalProgress } from '../apps/web/lib/goals';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function req(tok: string, body: Record<string, unknown>): any {
  return {
    cookies: { get: (n: string) => (n === 'as_session' ? { value: tok } : undefined) },
    headers: new Headers(),
    nextUrl: new URL('http://localhost/api/plans'),
    json: async () => body,
  };
}

async function sql(t: string, p: unknown[] = []): Promise<any[]> {
  const c = await beginTransaction();
  try { const r = await c.query(t, p); await c.query('COMMIT'); return r.rows; } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
}

function futurePlan(title: string, hoursFromNow = 24) {
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  const end = new Date(start.getTime() + 30 * 60_000);
  return { title, plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), durationMinutes: 30, windowType: 'NEUTRAL' };
}

async function main() {
  const email = 'hpg2-review-completion@example.com';
  await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "GoalActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "PlannedActivity" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "Goal" WHERE "userId" IN (SELECT id FROM "User" WHERE email = $1)`, [email]).catch(() => {});
  await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});

  const user = await upsertUserByEmail({ email, cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const tok = createSessionToken(user.id, user.email);

  const { goal, activities } = await createGoalWithActivities({ userId: user.id, title: 'Fitness', targetDate: null, activities: [{ title: 'Morning Run', activityId: 'workout' }] });
  const morningRun = activities[0];

  try {
    // ---- Create a Goal-linked plan via the NEW main-Plan-tab entry point ----
    const createRes = await plansRoute(req(tok, { ...futurePlan('Morning Run'), activityId: 'workout', goalActivityId: morningRun.id }));
    const createdPlan = await createRes.json();
    check('setup: Goal-linked plan created via POST /api/plans', createRes.status === 200 && createdPlan.id);

    const progressBefore = computeGoalProgress([
      deriveGoalActivityState({ status: morningRun.status, plannedActivityId: createdPlan.id, linkedPlanStatus: 'UPCOMING', everCompleted: false }),
    ]);
    check('1. before completion: progress is 0/1 (scheduled, not yet completed)', progressBefore.completed === 0 && progressBefore.total === 1);

    // ---- Move/reschedule the plan BEFORE completing it ----
    const newStart = new Date(Date.now() + 48 * 3600_000);
    newStart.setSeconds(0, 0);
    const moveResult = await movePlannedActivity(user.id, createdPlan.id, { newStartAt: newStart });
    check('2. Move succeeds for a Goal-linked plan created via the new entry point', moveResult.to.id !== createdPlan.id && moveResult.from.status === 'MOVED');

    const linkAfterMove = await sql(`SELECT "plannedActivityId" FROM "GoalActivity" WHERE id = $1`, [morningRun.id]);
    check('2. GoalActivity now points at the Move SUCCESSOR plan, not the original (MOVED) one', linkAfterMove[0]?.plannedActivityId === moveResult.to.id);
    check('2. the association survived the Move -- repointed, not lost and not duplicated', linkAfterMove[0]?.plannedActivityId !== createdPlan.id);

    // ---- Complete the SUCCESSOR plan ----
    const { plan: completedPlan } = await logPlannedActivity(user.id, moveResult.to.id);
    check('3. completion succeeds for the (moved) Goal-linked plan', completedPlan.status === 'LOGGED');

    const executionRows = await sql(`SELECT * FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [morningRun.id]);
    check('3. exactly ONE GoalActivityExecution row exists for this GoalActivity (no double-count)', executionRows.length === 1);
    check('3. the execution row is attributed to the SUCCESSOR plan (the one actually completed), not the original', executionRows[0]?.plannedActivityId === moveResult.to.id);

    const progressAfter = computeGoalProgress([
      deriveGoalActivityState({ status: morningRun.status, plannedActivityId: moveResult.to.id, linkedPlanStatus: 'LOGGED', everCompleted: true }),
    ]);
    check('4. after completion: progress correctly shows 1/1', progressAfter.completed === 1 && progressAfter.total === 1);

    // ---- Double-completion attempt: logPlannedActivity's own existing idempotency must hold ----
    const { plan: secondAttempt } = await logPlannedActivity(user.id, moveResult.to.id);
    check('5. re-logging an already-LOGGED plan is a structural no-op (existing idempotency, unmodified)', secondAttempt.status === 'LOGGED');
    const executionRowsAfterRetry = await sql(`SELECT * FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [morningRun.id]);
    check('5. still exactly ONE execution row after a repeated completion attempt -- no double-count', executionRowsAfterRetry.length === 1);

    // ---- Unlinked activity (no goalActivityId) never affects Goal progress ----
    const unlinkedRes = await plansRoute(req(tok, futurePlan('Unrelated plan, same title style')));
    const unlinkedPlan = await unlinkedRes.json();
    await logPlannedActivity(user.id, unlinkedPlan.id);
    const executionRowsAfterUnrelated = await sql(`SELECT * FROM "GoalActivityExecution" WHERE "goalActivityId" = $1`, [morningRun.id]);
    check('6. completing an UNLINKED plan never creates/affects this GoalActivity\'s execution record', executionRowsAfterUnrelated.length === 1);
  } finally {
    await sql(`DELETE FROM "GoalActivityExecution" WHERE "userId" = $1`, [user.id]).catch(() => {});
    await sql(`DELETE FROM "GoalActivity" WHERE "userId" = $1`, [user.id]).catch(() => {});
    await sql(`DELETE FROM "PlannedActivity" WHERE "userId" = $1`, [user.id]).catch(() => {});
    await sql(`DELETE FROM "Goal" WHERE "userId" = $1`, [user.id]).catch(() => {});
    await sql(`DELETE FROM "User" WHERE email = $1`, [email]).catch(() => {});
  }

  if (!allPassed) { console.error('SOME HPG2 COMPLETION/PROGRESS INTEGRITY CHECKS FAILED'); process.exit(1); }
  console.log('ALL HPG2 COMPLETION/PROGRESS INTEGRITY CHECKS PASSED');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
