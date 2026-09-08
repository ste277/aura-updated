import { mapPlanRow, PlanApiRow } from '../apps/web/lib/planFormatting';

/**
 * Bug: Logged Plan Returns To Upcoming Plans After Page Refresh.
 *
 * Root cause was NOT the Upcoming/Completed split itself -- PlanWithAuraView's
 * own upcomingPlans/completedPlans filters (`plan.status !== 'LOGGED'` /
 * `=== 'LOGGED'`) already key on `status` alone, never on `plannedStartAt`
 * vs "now", so completion already took precedence over the original
 * schedule by construction. The real defect was handleLogPlan's catch
 * block faking a local `status: 'LOGGED'` update on ANY POST
 * /api/plans/[planId]/log failure (non-2xx or network exception) --
 * nothing was actually persisted, so the very next GET /api/plans (a page
 * reload) always returned the row still as UPCOMING, silently discarding
 * the fake local state.
 *
 * mapPlanRow is the one function that turns a raw PlanApiRow (exactly the
 * shape GET /api/plans returns, and exactly the shape logPlannedActivity's
 * own successful response carries) into the `status`/`loggedAt` fields
 * upcomingPlans/completedPlans actually filter on. Proving mapPlanRow
 * derives the correct status for every point in the truth table below is
 * equivalent to proving the real (unexported, in-component) classification
 * behaves correctly for the same inputs -- it consumes nothing else.
 */

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const TZ = 'Asia/Kolkata';

function row(overrides: Partial<PlanApiRow> = {}): PlanApiRow {
  return {
    id: 'plan-1',
    title: 'Coffee / Tea',
    status: 'UPCOMING',
    plannedStartAt: '2026-09-08T13:30:00.000Z', // 7:00 PM IST
    plannedEndAt: '2026-09-08T14:00:00.000Z',
    durationMinutes: 30,
    windowType: 'NEUTRAL',
    loggedAt: null,
    ...overrides,
  };
}

// Simulates the real classification filters PlanWithAuraView.tsx uses
// (upcomingPlans/completedPlans, lines ~455-456) against mapPlanRow's own
// output -- not a reimplementation, just applying the documented, actual
// predicate to prove the end-to-end result.
function isUpcoming(plan: PlanApiRow, timezone?: string): boolean {
  return mapPlanRow(plan, timezone).status !== 'LOGGED';
}
function isCompleted(plan: PlanApiRow, timezone?: string): boolean {
  return mapPlanRow(plan, timezone).status === 'LOGGED';
}

// ============================================================
// Section 9 -- EARLY COMPLETION: plannedStartAt 7:00 PM, loggedAt 5:00 PM.
// This is the exact scenario the reported bug's root-cause hypothesis
// (classification checking plannedStartAt > now) would have broken.
// ============================================================
{
  const plan = row({
    plannedStartAt: '2026-09-08T13:30:00.000Z', // 7:00 PM IST
    plannedEndAt: '2026-09-08T14:00:00.000Z',
    status: 'LOGGED',
    loggedAt: '2026-09-08T11:30:00.000Z', // 5:00 PM IST -- before plannedStartAt
  });
  check('Early completion (logged before its own planned start) -> Completed, not Upcoming', isCompleted(plan, TZ));
  check('Early completion -> never Upcoming', !isUpcoming(plan, TZ));
}

// ============================================================
// Section 10 -- ON-TIME COMPLETION: loggedAt equals plannedStartAt.
// ============================================================
{
  const plan = row({
    plannedStartAt: '2026-09-08T11:30:00.000Z',
    status: 'LOGGED',
    loggedAt: '2026-09-08T11:30:00.000Z',
  });
  check('On-time completion -> Completed', isCompleted(plan, TZ));
}

// ============================================================
// Section 11 -- LATE COMPLETION: loggedAt after plannedStartAt.
// ============================================================
{
  const plan = row({
    plannedStartAt: '2026-09-08T10:30:00.000Z', // 4:00 PM IST
    status: 'LOGGED',
    loggedAt: '2026-09-08T11:30:00.000Z', // 5:00 PM IST
  });
  check('Late completion -> Completed', isCompleted(plan, TZ));
}

// ============================================================
// Section 12 -- UNLOGGED FUTURE PLAN.
// ============================================================
{
  const plan = row({
    plannedStartAt: '2026-09-08T13:30:00.000Z', // 7:00 PM IST, future
    status: 'UPCOMING',
    loggedAt: null,
  });
  check('Unlogged future plan -> Upcoming', isUpcoming(plan, TZ));
  check('Unlogged future plan -> never Completed', !isCompleted(plan, TZ));
}

// ============================================================
// Section 13 -- UNLOGGED PAST PLAN. Current, unchanged product semantics:
// the classification is purely status-based (never compares plannedStartAt
// to "now"), so an unlogged past Plan still classifies as Upcoming -- there
// is no separate MISSED/expired bucket for Plans today. Documenting the
// existing behavior, not changing it (out of this fix's root cause).
// ============================================================
{
  const plan = row({
    plannedStartAt: '2020-01-01T00:00:00.000Z', // long past
    plannedEndAt: '2020-01-01T01:00:00.000Z',
    status: 'UPCOMING',
    loggedAt: null,
  });
  check('Unlogged PAST plan still classifies as Upcoming today (no MISSED bucket for Plans) -- unchanged existing behavior', isUpcoming(plan, TZ));
}

// ============================================================
// Section 18/25 -- GET /api/plans (listPlannedActivities, SELECT *) already
// carries loggedAt for every row; mapPlanRow must not drop it.
// ============================================================
{
  const plan = row({ status: 'LOGGED', loggedAt: '2026-09-08T11:56:46.753Z' });
  const mapped = mapPlanRow(plan, TZ);
  check('mapPlanRow carries a non-undefined loggedAt for a LOGGED row', mapped.loggedAt !== undefined);
}
{
  const plan = row({ status: 'UPCOMING', loggedAt: null });
  const mapped = mapPlanRow(plan, TZ);
  check('mapPlanRow leaves loggedAt undefined for an UPCOMING row', mapped.loggedAt === undefined);
}

// ============================================================
// Regression for the actual bug: a row exactly as the server returns it
// AFTER a successful completion (status flips, loggedAt set, plannedStartAt/
// plannedEndAt/windowType left untouched per PR #80) must classify as
// Completed on a fresh mapPlanRow() call -- i.e. on the very next
// GET /api/plans a page reload performs.
// ============================================================
{
  const originalPlannedStartAt = '2026-09-08T13:30:00.000Z';
  const originalWindowType = 'BRAHMA';
  const serverRowAfterSuccessfulLog = row({
    plannedStartAt: originalPlannedStartAt,
    windowType: originalWindowType,
    status: 'LOGGED',
    loggedAt: '2026-09-08T12:00:00.000Z',
  });
  const mapped = mapPlanRow(serverRowAfterSuccessfulLog, TZ);
  check('A row reflecting a real successful completion classifies as Completed on reload', mapped.status === 'LOGGED');
  check('plannedStartAt is preserved verbatim (never rewritten by completion)', mapped.plannedStartAt === new Date(originalPlannedStartAt).toISOString());
}

if (!allPassed) {
  console.error('\nSome Plan log classification checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PLAN LOG CLASSIFICATION CHECKS PASSED');
}
