/**
 * Insights Correctness + Historical Integrity V1, finding #2: pure
 * source-inspection companion to test/insightsHistoryCompletenessDb.test.ts
 * (which needs a live database, unavailable in this environment --
 * DATABASE_URL unset). Confirms the query wiring itself without a DB
 * round-trip: listHabitLogs()'s existing LIMIT 50 is byte-for-byte
 * untouched, listHabitLogsForInsights() is a genuine date-range query (no
 * row-count cap), and each of the two Insights-relevant routes was actually
 * switched over to it -- while every other existing caller of
 * listHabitLogs() (myDayOrchestrator.ts) is confirmed unaffected.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');

// ============================================================
// listHabitLogs() itself is completely unmodified -- still LIMIT 50, no
// date-range parameter added.
// ============================================================

const listHabitLogsSource = dbSource.slice(dbSource.indexOf('export async function listHabitLogs('), dbSource.indexOf('export async function listHabitLogs(') + 400);
check('listHabitLogs() still takes only a userId parameter (no sinceDate added)', /export async function listHabitLogs\(userId: string\)/.test(listHabitLogsSource));
check('listHabitLogs() still has LIMIT 50 in its query, unmodified', /LIMIT 50/.test(listHabitLogsSource));

// ============================================================
// listHabitLogsForInsights() is a genuine date-range query -- takes a
// sinceDate, filters by logTimestamp >= sinceDate, and has NO row-count
// LIMIT clause at all.
// ============================================================

const listHabitLogsForInsightsSource = dbSource.slice(dbSource.indexOf('export async function listHabitLogsForInsights('), dbSource.indexOf('export async function listHabitLogsForInsights(') + 500);
check('listHabitLogsForInsights() takes a sinceDate parameter', /export async function listHabitLogsForInsights\(userId: string, sinceDate: Date\)/.test(listHabitLogsForInsightsSource));
check('listHabitLogsForInsights() filters by "logTimestamp" >= sinceDate', /"logTimestamp"\s*>=\s*\$2/.test(listHabitLogsForInsightsSource));
check('listHabitLogsForInsights() has no row-count LIMIT clause', !/LIMIT \d/.test(listHabitLogsForInsightsSource));
check('INSIGHTS_HISTORY_DAYS is exported as a named constant (callers can reason about/test the exact horizon)', /export const INSIGHTS_HISTORY_DAYS = \d+;/.test(dbSource));

// ============================================================
// Both Insights-relevant routes were switched to the new query.
// ============================================================

// "No bare call" here means no *call site* (`listHabitLogs(` immediately
// followed by an argument list actually invoked, e.g. `await listHabitLogs(`
// or as a bare statement) -- not "the word never appears anywhere", since
// both routes' own doc comments legitimately reference the old function
// name by way of explaining what changed.
function hasBareListHabitLogsCall(source: string): boolean {
  const withoutInsightsCalls = source.replace(/listHabitLogsForInsights/g, '');
  return /\blistHabitLogs\(\s*(session\.userId|user\.id|owner)/.test(withoutInsightsCalls);
}

const habitLogsRouteSource = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
check('GET /api/habit-logs uses listHabitLogsForInsights, not the row-capped listHabitLogs', /listHabitLogsForInsights\(session\.userId,\s*sinceDate\)/.test(habitLogsRouteSource) && !hasBareListHabitLogsCall(habitLogsRouteSource));

const insightsRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
check('/api/daily-assistant/insights uses listHabitLogsForInsights, not the row-capped listHabitLogs', /listHabitLogsForInsights\(session\.userId,\s*sinceDate\)/.test(insightsRouteSource) && !hasBareListHabitLogsCall(insightsRouteSource));

// ============================================================
// The one remaining real caller of listHabitLogs() (myDayOrchestrator.ts)
// is untouched -- it explicitly relies on the exact "last 50 overall"
// contract for a different, single-day purpose, and must keep calling the
// original function, not the new one.
// ============================================================

const orchestratorSource = fs.readFileSync('apps/web/lib/myDayOrchestrator.ts', 'utf8');
check('myDayOrchestrator.ts still calls listHabitLogs (unaffected by this PR)', /\blistHabitLogs\(/.test(orchestratorSource));
check('myDayOrchestrator.ts does not call the new listHabitLogsForInsights (out of scope for its single-day purpose)', !/listHabitLogsForInsights/.test(orchestratorSource));

console.log(allPassed ? '\nALL INSIGHTS HISTORY WIRING CHECKS PASSED' : '\nSOME INSIGHTS HISTORY WIRING CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
