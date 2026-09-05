/**
 * Planned Activity Canonical Identity Propagation V1 (C2b) -- live-database
 * round-trip test, requires a real, reachable DATABASE_URL. Run locally
 * with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/plannedActivityCanonicalIdentityDb.test.ts
 *
 * Proves createPlannedActivity's new `activityId` field actually persists
 * through a real INSERT + read-back, and that logPlannedActivity correctly
 * copies it onto the resulting HabitLog, matching this repo's established
 * live-DB test pattern (see test/habitLogActivityIdentityDb.test.ts,
 * test/planCompletionHistoricalIntegrityDb.test.ts). No DATABASE_URL
 * guard/skip: if the database is unreachable this fails naturally with a
 * connection error, which must be reported as a blocked run, never a pass.
 */
import { createPlannedActivity, getPlannedActivityForOwner, logPlannedActivity, upsertUserByEmail, updateUserLocation } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-planned-activity-canonical-identity-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  await updateUserLocation(owner.id, { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // ============================================================
  // A. Canonical Plan creation -- a valid catalog activityId round-trips
  // exactly, unchanged, and propagates to HabitLog on completion.
  // ============================================================
  const canonicalPlan = await createPlannedActivity({
    userId: owner.id,
    title: 'Finish Q4 board presentation', // deliberately NOT the catalog title ("Deep Work") -- title independence
    activityId: 'deep-work',
    plannedStartAt: new Date('2020-01-01T05:00:00+05:30'),
    plannedEndAt: new Date('2020-01-01T05:30:00+05:30'),
    durationMinutes: 30,
    windowType: 'BRAHMA',
  });
  check('createPlannedActivity persists a valid catalog activityId ("deep-work") exactly', canonicalPlan.activityId === 'deep-work');
  check('createPlannedActivity persists the custom title independently of the catalog title', canonicalPlan.title === 'Finish Q4 board presentation');

  const readBackCanonicalPlan = await getPlannedActivityForOwner(owner.id, canonicalPlan.id);
  check('The canonical activityId survives a real round trip through getPlannedActivityForOwner unchanged', readBackCanonicalPlan?.activityId === 'deep-work');
  check('C. Title independence: activityId and title both survive independently on read-back', readBackCanonicalPlan?.title === 'Finish Q4 board presentation' && readBackCanonicalPlan?.activityId === 'deep-work');

  const { plan: completedCanonicalPlan, habitLog: canonicalHabitLog } = await logPlannedActivity(owner.id, canonicalPlan.id);
  check('Plan completion copies plan.activityId to HabitLog.activityId exactly', canonicalHabitLog.activityId === 'deep-work');
  check('Completion does not mutate the Plan\'s own activityId', completedCanonicalPlan.activityId === 'deep-work');

  // ============================================================
  // E. PR #80 timing invariant -- completion still uses ACTUAL completion
  // timing, never the planned (2020) time.
  // ============================================================
  const now = Date.now();
  check('HabitLog.logTimestamp reflects the actual completion instant (close to now), not plannedStartAt (2020)', Math.abs(canonicalHabitLog.logTimestamp.getTime() - now) < 60000);
  check('HabitLog.logTimestamp is NOT the plannedStartAt value', canonicalHabitLog.logTimestamp.getTime() !== canonicalPlan.plannedStartAt.getTime());
  check('PlannedActivity.plannedStartAt is unchanged after completion', completedCanonicalPlan.plannedStartAt.getTime() === canonicalPlan.plannedStartAt.getTime());
  check('PlannedActivity.windowType is unchanged after completion', completedCanonicalPlan.windowType === 'BRAHMA');

  // ============================================================
  // D. Idempotent completion -- a second completion request returns the
  // SAME HabitLog with the SAME activityId, no duplicate.
  // ============================================================
  const { habitLog: secondCanonicalHabitLog } = await logPlannedActivity(owner.id, canonicalPlan.id);
  check('A second completion request returns the SAME HabitLog id (no duplicate created)', secondCanonicalHabitLog.id === canonicalHabitLog.id);
  check('A second completion request returns the SAME persisted activityId (the idempotent-branch SELECT includes activityId)', secondCanonicalHabitLog.activityId === 'deep-work');

  // ============================================================
  // B. NULL Plan -- omitted activityId persists as null and propagates as
  // null to HabitLog.
  // ============================================================
  const freeTextPlan = await createPlannedActivity({
    userId: owner.id,
    title: 'Organize my sock drawer',
    // activityId intentionally omitted -- free-text/manual Plan.
    plannedStartAt: new Date('2020-01-02T05:00:00+05:30'),
    plannedEndAt: new Date('2020-01-02T05:30:00+05:30'),
    durationMinutes: 30,
    windowType: 'NEUTRAL',
  });
  check('createPlannedActivity with no activityId argument persists activityId = null (not undefined, not a placeholder string)', freeTextPlan.activityId === null);

  const readBackFreeTextPlan = await getPlannedActivityForOwner(owner.id, freeTextPlan.id);
  check('F. Existing-row/nullable compatibility: a null-identity Plan reads back correctly, remains a fully valid Plan', readBackFreeTextPlan !== null && readBackFreeTextPlan?.activityId === null);

  const { habitLog: freeTextHabitLog } = await logPlannedActivity(owner.id, freeTextPlan.id);
  check('A NULL-identity Plan completes with HabitLog.activityId = null (no inference)', freeTextHabitLog.activityId === null || freeTextHabitLog.activityId === undefined);

  console.log(allPassed ? '\nALL PLANNED ACTIVITY CANONICAL IDENTITY DB CHECKS PASSED' : '\nSOME PLANNED ACTIVITY CANONICAL IDENTITY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
