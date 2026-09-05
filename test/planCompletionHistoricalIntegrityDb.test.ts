/**
 * Plan Completion Historical Integrity V1 -- live-database round-trip
 * test, requires a real, reachable DATABASE_URL. Run locally with a real
 * DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/planCompletionHistoricalIntegrityDb.test.ts
 *
 * Proves logPlannedActivity's fixed write semantics through a real
 * transaction: a Plan created with a known plannedStartAt/windowType, then
 * completed, produces a HabitLog whose logTimestamp/activeWindow reflect
 * the ACTUAL completion instant (not the plan), while
 * PlannedActivity.plannedStartAt/plannedEndAt/windowType stay frozen and
 * PlannedActivity.loggedAt equals the exact same instant used for
 * HabitLog.logTimestamp. Matches this repo's established live-DB test
 * pattern (see test/habitLogActivityIdentityDb.test.ts,
 * test/habitLogDurationDb.test.ts) -- no DATABASE_URL guard/skip: if the
 * database is unreachable this fails naturally with a connection error,
 * which must be reported as a blocked run, never a pass.
 */
import { createPlannedActivity, logPlannedActivity, upsertUserByEmail, updateUserLocation } from '../apps/web/lib/db';
import { resolveHistoricalActiveWindow } from '../apps/web/lib/historicalActivityWindow';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-plan-completion-historical-integrity-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  // This owner may already exist from a prior run with a stale Timing
  // Location (e.g. left over from a different test) -- pin it explicitly
  // so this test's own assumptions about latitude/longitude/timezone hold
  // regardless of run history.
  await updateUserLocation(owner.id, { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // A Plan "planned" for a time/window deliberately different from when it
  // will actually be completed (immediately, by this test) -- plannedStartAt
  // is set in the past on a DIFFERENT real solar window than "now" so any
  // window-value collision would be a coincidence, not a false pass.
  const plannedStartAt = new Date('2020-01-01T05:00:00+05:30'); // BRAHMA-era, deliberately long past
  const plannedEndAt = new Date('2020-01-01T05:30:00+05:30');
  const plan = await createPlannedActivity({
    userId: owner.id,
    title: 'Deep Work Block',
    plannedStartAt,
    plannedEndAt,
    durationMinutes: 30,
    windowType: 'BRAHMA',
  });
  check('Plan created with the intended plannedStartAt/windowType', plan.plannedStartAt.getTime() === plannedStartAt.getTime() && plan.windowType === 'BRAHMA');

  const beforeCompletion = new Date();
  const { plan: completedPlan, habitLog } = await logPlannedActivity(owner.id, plan.id);
  const afterCompletion = new Date();

  // ============================================================
  // Actual completion instant, not the plan.
  // ============================================================
  check('HabitLog.logTimestamp is close to "now" (the actual completion instant), not plannedStartAt (2020)', habitLog.logTimestamp.getTime() >= beforeCompletion.getTime() - 1000 && habitLog.logTimestamp.getTime() <= afterCompletion.getTime() + 1000);
  check('HabitLog.logTimestamp is NOT the plannedStartAt value', habitLog.logTimestamp.getTime() !== plannedStartAt.getTime());

  // ============================================================
  // One shared completion instant.
  // ============================================================
  check('PlannedActivity.loggedAt and HabitLog.logTimestamp represent the exact same completion instant', completedPlan.loggedAt !== null && completedPlan.loggedAt.getTime() === habitLog.logTimestamp.getTime());

  // ============================================================
  // Actual window, not the plan's window.
  // ============================================================
  const expectedActualWindow = resolveHistoricalActiveWindow(habitLog.logTimestamp, 13.0827, 80.2707, 'Asia/Kolkata');
  check('HabitLog.activeWindow matches the REAL solar window at the actual completion instant/current Timing Location (via a direct resolveHistoricalActiveWindow call, not copied from plan.windowType)', habitLog.activeWindow === expectedActualWindow);

  // ============================================================
  // Planned fields frozen.
  // ============================================================
  check('plannedStartAt is unchanged after completion', completedPlan.plannedStartAt.getTime() === plannedStartAt.getTime());
  check('plannedEndAt is unchanged after completion', completedPlan.plannedEndAt.getTime() === plannedEndAt.getTime());
  check('windowType is unchanged after completion', completedPlan.windowType === 'BRAHMA');

  // ============================================================
  // activityId NULL.
  // ============================================================
  check('HabitLog.activityId is null (no C2b propagation)', (habitLog as any).activityId === null || (habitLog as any).activityId === undefined);

  // ============================================================
  // Duplicate completion -- idempotent.
  // ============================================================
  const { plan: secondPlan, habitLog: secondHabitLog } = await logPlannedActivity(owner.id, plan.id);
  check('A second completion request returns the SAME HabitLog id (no duplicate created)', secondHabitLog.id === habitLog.id);
  check('A second completion request returns the SAME PlannedActivity.loggedAt (not overwritten with a new instant)', secondPlan.loggedAt !== null && secondPlan.loggedAt.getTime() === completedPlan.loggedAt!.getTime());

  console.log(allPassed ? '\nALL PLAN COMPLETION HISTORICAL INTEGRITY DB CHECKS PASSED' : '\nSOME PLAN COMPLETION HISTORICAL INTEGRITY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
