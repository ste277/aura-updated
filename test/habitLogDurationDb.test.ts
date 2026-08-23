/**
 * Live-database test for Good Right Now Action Semantics V1's duration
 * changes -- requires a real, reachable DATABASE_URL. Run locally with a
 * real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/habitLogDurationDb.test.ts
 *
 * Proves durationMinutes = 0 (an INSTANT activity, e.g. a hydration check)
 * actually persists as 0, not the old 5-minute-floor placeholder, and that
 * it survives a real round trip through listHabitLogs unchanged. Creates
 * one throwaway test user (idempotent via email upsert). No delete
 * function exists for HabitLog anywhere in this codebase (audited --
 * there never has been one), so this file does not attempt cleanup; unlike
 * PlannedActivity/AuraMoment fixtures elsewhere, repeated runs DO
 * accumulate a few extra rows for the test user rather than staying flat --
 * an accepted, low-cost tradeoff rather than adding a HabitLog delete
 * function solely for test hygiene.
 */
import { createHabitLog, listHabitLogs, upsertUserByEmail } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-habit-log-duration-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // ============================================================
  // INSTANT -- durationMinutes = 0 persists as 0, not bumped to any floor.
  // ============================================================
  const instantLog = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Active Rest & Hydration Check',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 600,
    durationMinutes: 0,
    logSource: 'AURA_DO_NOW',
    activitySignificance: 'LOW',
  });
  check('createHabitLog persists durationMinutes = 0 exactly, not defaulted to 30 or floored to 5', instantLog.durationMinutes === 0);

  const logs = await listHabitLogs(owner.id);
  const persistedInstant = logs.find((l) => l.id === instantLog.id);
  check('The 0-duration row survives a real round trip through listHabitLogs unchanged', persistedInstant?.durationMinutes === 0);

  // ============================================================
  // FIXED -- a real catalog duration (Tea Break, 10 min) persists exactly.
  // ============================================================
  const fixedLog = await createHabitLog({
    userId: owner.id,
    activityTitle: 'Tea Break',
    activeWindow: 'NEUTRAL',
    logMinuteOfDay: 605,
    durationMinutes: 10,
    logSource: 'AURA_DO_NOW',
    activitySignificance: 'LOW',
  });
  check('createHabitLog persists a FIXED catalog duration (10) exactly', fixedLog.durationMinutes === 10);

  // ============================================================
  // Insights' own reduce semantics (brief section 13), proven against a
  // REAL persisted-and-retrieved row rather than an assumption: nullish
  // coalescing (?? 30) only substitutes for null/undefined, so an explicit
  // 0 passes through as 0 -- an INSTANT activity contributes ZERO minutes
  // to "total minutes logged today", never a manufactured 30.
  // ============================================================
  const totalMinutes = [persistedInstant, fixedLog].reduce((sum, e) => sum + (e?.durationMinutes ?? 30), 0);
  check('The SAME reduce InsightsView/CalendarViewSection use (?? 30) correctly totals 0 + 10 = 10, never inflating the instant entry to 30', totalMinutes === 10);

  console.log(allPassed ? '\nALL HABIT LOG DURATION DB CHECKS PASSED' : '\nSOME HABIT LOG DURATION DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
