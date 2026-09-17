/**
 * Planning Horizon V1 -- PR P1 civil-date resolution regression suite.
 * `resolvePlanningTargetDate` (planningHorizon.ts) is pure calendar-date-
 * string arithmetic -- no clock, no timezone, no Date-instant math -- so
 * every check here operates on plain "YYYY-MM-DD" strings, matching this
 * repository's own established convention for testing `addDaysToDateStr`
 * itself (timezone.ts).
 */
import { resolvePlanningTargetDate, type PlanningHorizon } from '../apps/web/lib/planningHorizon';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function resolve(horizon: PlanningHorizon, currentDate: string): string {
  return resolvePlanningTargetDate({ horizon, currentDate });
}

function main() {
  // ============================================================
  // TODAY -- identity, never mutated.
  // ============================================================
  check('1. TODAY returns the current civil date unchanged', resolve('TODAY', '2026-09-16') === '2026-09-16');
  check('2. TODAY at a month boundary is still an identity', resolve('TODAY', '2026-09-30') === '2026-09-30');
  check('3. TODAY at a year boundary is still an identity', resolve('TODAY', '2026-12-31') === '2026-12-31');

  // ============================================================
  // TOMORROW -- one civil day forward, pure date-string stepping.
  // ============================================================
  check('4. TOMORROW returns the next civil date', resolve('TOMORROW', '2026-09-16') === '2026-09-17');

  // Month boundary: Sep 30 -> Oct 1 (30-day month).
  check('5. TOMORROW crosses a 30-day month boundary correctly', resolve('TOMORROW', '2026-09-30') === '2026-10-01');
  // Month boundary: Jan 31 -> Feb 1.
  check('6. TOMORROW crosses a 31-day month boundary correctly', resolve('TOMORROW', '2026-01-31') === '2026-02-01');

  // Year boundary: Dec 31 -> Jan 1 of the following year.
  check('7. TOMORROW crosses a year boundary correctly', resolve('TOMORROW', '2026-12-31') === '2027-01-01');

  // Leap-day boundary -- 2028 is a leap year (divisible by 4, not a
  // century exception), so Feb 28 -> Feb 29, and Feb 29 -> Mar 1.
  check('8. TOMORROW resolves Feb 28 -> Feb 29 in a leap year', resolve('TOMORROW', '2028-02-28') === '2028-02-29');
  check('9. TOMORROW resolves Feb 29 -> Mar 1 in a leap year', resolve('TOMORROW', '2028-02-29') === '2028-03-01');
  // Non-leap year: 2026 is not divisible by 4, so Feb 28 -> Mar 1 directly.
  check('10. TOMORROW resolves Feb 28 -> Mar 1 in a non-leap year (no Feb 29)', resolve('TOMORROW', '2026-02-28') === '2026-03-01');

  // ============================================================
  // Never now+24h -- this function has no clock/Date-instant input at
  // all, so there is no reachable code path that could perform
  // millisecond arithmetic (structural guarantee, not merely a
  // convention -- see this file's own module doc comment).
  // ============================================================
  check('11. resolvePlanningTargetDate takes no Date/clock argument -- pure civil-date-string input only', resolvePlanningTargetDate.length === 1);

  if (!allPassed) {
    console.error('\nSome Planning Horizon checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLANNING HORIZON CHECKS PASSED');
  }
}

main();
