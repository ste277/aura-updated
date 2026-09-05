/**
 * Prospective Canonical Activity Identity V1 (PR C2) -- live-database
 * round-trip test, requires a real, reachable DATABASE_URL. Run locally
 * with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/habitLogActivityIdentityDb.test.ts
 *
 * Proves createHabitLog's new `activityId` field actually persists through
 * a real INSERT + read-back (a valid catalog id survives unchanged; an
 * omitted one reads back as null), matching this repo's established
 * live-DB test pattern (see test/habitLogDurationDb.test.ts). No delete
 * function exists for HabitLog anywhere in this codebase (confirmed by
 * the prior audit), so this does not attempt cleanup; repeated runs
 * accumulate a few extra rows for the test user rather than staying flat,
 * an accepted, low-cost tradeoff.
 */
import { createHabitLog, listHabitLogs, upsertUserByEmail } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-habit-log-activity-identity-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // ============================================================
  // A valid canonical activityId round-trips exactly, unchanged.
  // ============================================================
  const canonicalLog = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Distraction-free planning block', // deliberately NOT the catalog title ("Deep Work") -- title mismatch is expected/valid
    activityId: 'deep-work',
    activeWindow: 'BRAHMA',
    logMinuteOfDay: 300,
    durationMinutes: 30,
    logSource: 'AURA_DO_NOW',
    activitySignificance: 'HIGH',
  });
  check('createHabitLog persists a valid catalog activityId ("deep-work") exactly', canonicalLog.activityId === 'deep-work');
  check('activityTitle is preserved exactly as submitted, independent of the catalog\'s own title for "deep-work"', canonicalLog.activityTitle === 'Distraction-free planning block');

  const logsAfterCanonical = await listHabitLogs(owner.id);
  const persistedCanonical = logsAfterCanonical.find((l) => l.id === canonicalLog.id);
  check('The canonical activityId survives a real round trip through listHabitLogs unchanged', persistedCanonical?.activityId === 'deep-work');

  // ============================================================
  // Omitted activityId persists as null -- the manual/free-text case.
  // ============================================================
  const manualLog = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Family Time',
    // activityId intentionally omitted -- manual/free-text logging.
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 720,
    durationMinutes: 30,
    logSource: 'MANUAL',
    activitySignificance: 'MEDIUM',
  });
  check('createHabitLog with no activityId argument persists activityId = null (not undefined, not a placeholder string)', manualLog.activityId === null);

  const logsAfterManual = await listHabitLogs(owner.id);
  const persistedManual = logsAfterManual.find((l) => l.id === manualLog.id);
  check('The null activityId survives a real round trip through listHabitLogs unchanged', persistedManual?.activityId === null);

  console.log(allPassed ? '\nALL HABITLOG ACTIVITY IDENTITY DB CHECKS PASSED' : '\nSOME HABITLOG ACTIVITY IDENTITY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
