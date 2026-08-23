import { formatActivityDuration, computeAverageTimedSessionMinutes } from '../apps/web/lib/activityDuration';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// formatActivityDuration -- Good Right Now Duration Display Polish's
// primary goal: never present an INSTANT completion as "0 min".
// ============================================================

check('0 -> "Completed", never "0 min"', formatActivityDuration({ durationMinutes: 0 }) === 'Completed');
check('durationMode INSTANT -> "Completed" even if durationMinutes were somehow nonzero (defensive)', formatActivityDuration({ durationMinutes: 5, durationMode: 'INSTANT' }) === 'Completed');
check('10 -> "10 min"', formatActivityDuration({ durationMinutes: 10 }) === '10 min');
check('59 -> "59 min"', formatActivityDuration({ durationMinutes: 59 }) === '59 min');
check('60 -> "1 hr" (no trailing "0 min")', formatActivityDuration({ durationMinutes: 60 }) === '1 hr');
check('90 -> "1 hr 30 min"', formatActivityDuration({ durationMinutes: 90 }) === '1 hr 30 min');
check('120 -> "2 hr" (no trailing "0 min")', formatActivityDuration({ durationMinutes: 120 }) === '2 hr');
check('150 -> "2 hr 30 min"', formatActivityDuration({ durationMinutes: 150 }) === '2 hr 30 min');
check('FIXED/USER_SELECTED durationMode does not change a real duration\'s formatting', formatActivityDuration({ durationMinutes: 30, durationMode: 'FIXED' }) === '30 min' && formatActivityDuration({ durationMinutes: 45, durationMode: 'USER_SELECTED' }) === '45 min');

// ============================================================
// computeAverageTimedSessionMinutes -- the section-4 audit finding: an
// INSTANT completion (0 min) must not participate in "average session
// length" -- neither in the sum nor the divisor.
// ============================================================

check(
  'Hydration(0) + Tea Break(10) + Deep Work(60) averages ONLY the two timed ones: (10+60)/2 = 35, not (0+10+60)/3 = 23',
  computeAverageTimedSessionMinutes([0, 10, 60]) === 35
);
check('All-instant log history (only 0-duration entries) returns null, not 0 or NaN', computeAverageTimedSessionMinutes([0, 0, 0]) === null);
check('Empty history returns null', computeAverageTimedSessionMinutes([]) === null);
check('All-timed history averages normally, unaffected by this change', computeAverageTimedSessionMinutes([30, 60, 90]) === 60);
check('A single timed entry averages to itself', computeAverageTimedSessionMinutes([45]) === 45);
check('Negative/zero-guard: only strictly positive minutes count as timed', computeAverageTimedSessionMinutes([0, 20]) === 20);

if (!allPassed) {
  console.error('\nSome activity duration display checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL ACTIVITY DURATION DISPLAY CHECKS PASSED');
}
