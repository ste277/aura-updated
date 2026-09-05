/**
 * Insights Correctness + Historical Integrity V1, finding #2: regression
 * suite for listHabitLogsForInsights()/INSIGHTS_HISTORY_DAYS
 * (apps/web/lib/db.ts) and the two routes wired to use it.
 *
 * Live-database checks (need a real, reachable DATABASE_URL). Run locally
 * with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/insightsHistoryCompletenessDb.test.ts
 *
 * Proves: (a) more than 50 logs are all retrievable via
 * listHabitLogsForInsights (the exact truncation this finding fixes), (b)
 * listHabitLogs()'s pre-existing "last 50 overall" contract is completely
 * unchanged for its other caller (myDayOrchestrator.ts), and (c) the new
 * query is user-scoped, never leaking one user's logs into another's
 * result. Matches this repo's established live-DB test pattern (see
 * test/habitLogDurationDb.test.ts) -- no delete function exists for
 * HabitLog anywhere in this codebase, so this does not attempt cleanup;
 * repeated runs accumulate a few extra rows for the test users rather than
 * staying flat, an accepted low-cost tradeoff.
 */
import { createHabitLog, listHabitLogs, listHabitLogsForInsights, INSIGHTS_HISTORY_DAYS, upsertUserByEmail } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-insights-history-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const ownerB = await upsertUserByEmail({ email: 'test-insights-history-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  // ============================================================
  // >50 logs all available via listHabitLogsForInsights -- the exact
  // truncation this finding fixes. 55 real rows, all within the
  // INSIGHTS_HISTORY_DAYS date range.
  // ============================================================

  const ROW_COUNT = 55;
  for (let i = 0; i < ROW_COUNT; i++) {
    await createHabitLog({
      userId: ownerA.id,
      activityTitle: `Insights History Fixture ${i}`,
      activeWindow: 'NEUTRAL',
      logMinuteOfDay: 600,
      logTimestamp: new Date(Date.now() - i * 60 * 60 * 1000), // spread over the last ~55 hours, well within range
      durationMinutes: 15,
      logSource: 'MANUAL',
      activitySignificance: 'LOW',
    });
  }

  const sinceDate = new Date(Date.now() - INSIGHTS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const insightsLogs = await listHabitLogsForInsights(ownerA.id, sinceDate);
  const fixtureLogsReturned = insightsLogs.filter((l) => l.activityTitle.startsWith('Insights History Fixture'));
  check(`listHabitLogsForInsights returns all ${ROW_COUNT} rows within the date range, not truncated at 50`, fixtureLogsReturned.length === ROW_COUNT);

  // ============================================================
  // listHabitLogs()'s existing 50-row "last 50 overall" contract is
  // completely unchanged -- it must still cap at 50 for its one remaining
  // caller (myDayOrchestrator.ts), which explicitly relies on that exact
  // contract for a different, single-day purpose.
  // ============================================================

  const generalLogs = await listHabitLogs(ownerA.id);
  check('listHabitLogs() still caps at exactly 50 rows (its pre-existing contract, unmodified by this PR)', generalLogs.length === 50);

  // ============================================================
  // User-scoped: ownerB's own query never returns any of ownerA's fixture
  // rows.
  // ============================================================

  const ownerBLogs = await listHabitLogsForInsights(ownerB.id, sinceDate);
  const leakedRows = ownerBLogs.filter((l) => l.activityTitle.startsWith('Insights History Fixture'));
  check('listHabitLogsForInsights is user-scoped -- a different user\'s query returns none of ownerA\'s rows', leakedRows.length === 0);

  console.log(allPassed ? '\nALL INSIGHTS HISTORY COMPLETENESS DB CHECKS PASSED' : '\nSOME INSIGHTS HISTORY COMPLETENESS DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
