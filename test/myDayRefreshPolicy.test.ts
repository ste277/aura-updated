import { shouldRefreshMyDayForDateChange } from '../apps/web/lib/myDayRefreshPolicy';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// My Day Day-Boundary Refresh V1 -- the day-change case (the Sep 6 -> Sep
// 7 regression this increment closes).
// ============================================================
check(
  'Day changed (2026-09-06 -> 2026-09-07) -> refresh',
  shouldRefreshMyDayForDateChange('2026-09-06', '2026-09-07') === true
);

// ============================================================
// Same-day focus/visibility event -- must NOT refresh (this is what keeps
// the fix from becoming pseudo-polling).
// ============================================================
check(
  'Same day (2026-09-07 -> 2026-09-07) -> no refresh',
  shouldRefreshMyDayForDateChange('2026-09-07', '2026-09-07') === false
);

// ============================================================
// Never loaded yet -- the mount/tab-switch-to-Home path owns first load,
// this helper must never force one of its own.
// ============================================================
check(
  'Never successfully loaded (null) -> no refresh forced by this path',
  shouldRefreshMyDayForDateChange(null, '2026-09-07') === false
);

// ============================================================
// Multi-day gap (app left open/backgrounded across more than one
// midnight) -- still a simple key mismatch, still refreshes.
// ============================================================
check(
  'Multi-day gap (2026-09-04 -> 2026-09-07) -> refresh',
  shouldRefreshMyDayForDateChange('2026-09-04', '2026-09-07') === true
);

// ============================================================
// Timezone-boundary case -- the date KEY is what matters, never a raw UTC
// vs local distinction. A date key one day ahead of another in the SAME
// Timing Location zone is exactly what a real day rollover looks like,
// regardless of what UTC's own calendar date happens to be at that
// instant.
// ============================================================
check(
  'Date-key comparison is timezone-agnostic by construction -- any key mismatch is a boundary',
  shouldRefreshMyDayForDateChange('2026-12-31', '2027-01-01') === true
);

if (!allPassed) {
  console.error('\nSome My Day refresh policy checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL MY DAY REFRESH POLICY CHECKS PASSED');
}
