import { stripCountdownWrapper } from '../apps/web/lib/formatTimeLeft';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Regression: HomeDashboard's primary-suggestion sentence embeds this value
// as "You have about ${timeLeft} before...". Before the fix, the
// nextShift.startsIn source ("In 3h 9m") only had a trailing " left"
// stripped, never the leading "In ", producing "You have about In 3h 9m
// before...".
check('Strips a leading "In " (nextShift.startsIn format, scoreEngine.ts)', stripCountdownWrapper('In 3h 9m') === '3h 9m');
check('Strips a trailing " left" (currentWindow.timeRemaining format, HomeDashboard.tsx)', stripCountdownWrapper('3h 9m left') === '3h 9m');
check('Leaves a bare duration with neither wrapper unchanged', stripCountdownWrapper('45m') === '45m');
check('"In " strip is case-insensitive', stripCountdownWrapper('in 45m') === '45m');
check('Never leaves a leading "In " in the output for any known input shape', !stripCountdownWrapper('In 3h 9m').toLowerCase().startsWith('in '));

console.log(allPassed ? '\nALL FORMAT TIME LEFT CHECKS PASSED' : '\nSOME FORMAT TIME LEFT CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
