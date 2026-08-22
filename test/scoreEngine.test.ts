import { computeDailyEnergyInsight } from '../apps/web/lib/scoreEngine';
import type { WindowSpan } from '../packages/panchang/src/windows';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// A day with a RAHU_KALAM window currently active (9:20 AM - 10:53 AM, i.e.
// minutes 560-653) and an ABHIJIT window coming up next (12:01 PM - 12:51 PM,
// minutes 721-771) -- mirrors the exact scenario from the reported bug
// screenshot: "Next Best Moment" showing Abhijit's name/time but Rahu
// Kalam's score (3.5) and caution description.
const windows: WindowSpan[] = [
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 560, endMinutes: 653 },
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', startMinutes: 721, endMinutes: 771 },
] as WindowSpan[];

const currentMinuteOfDay = 590; // inside RAHU_KALAM
const insight = computeDailyEnergyInsight(windows, 'RAHU_KALAM', currentMinuteOfDay);

check('The top-level score/themeText describe the CURRENT window (Rahu Kalam), unchanged from before this fix', insight.score === 3.5 && insight.themeText.includes('High friction'));
check('nextShift identifies the upcoming window by name (Abhijit)', insight.nextShift.windowName.toLowerCase().includes('abhijit'));
check('nextShift.score is the UPCOMING window\'s own score (Abhijit = 9.5), not the current window\'s (Rahu Kalam = 3.5)', insight.nextShift.score === 9.5);
check('nextShift.themeText is the UPCOMING window\'s own description, not the current caution text', insight.nextShift.themeText.includes('Peak solar clarity') && !insight.nextShift.themeText.includes('friction'));
check('nextShift.score is never equal to the current window\'s score when the two window types actually differ (the exact bug this regresses)', insight.nextShift.score !== insight.score);

// Symmetric case: currently IN a favorable Abhijit window, next window is a
// Rahu Kalam caution period -- nextShift must show Rahu Kalam's own low
// score/caution text, not Abhijit's high score bleeding through.
const windows2: WindowSpan[] = [
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', startMinutes: 560, endMinutes: 610 },
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 700, endMinutes: 790 },
] as WindowSpan[];
const insight2 = computeDailyEnergyInsight(windows2, 'ABHIJIT', 570);
check('Symmetric case: nextShift correctly identifies the upcoming Rahu Kalam window', insight2.nextShift.windowName.toLowerCase().includes('rahu'));
check('Symmetric case: nextShift.score reflects Rahu Kalam\'s own low score (3.5), not the current Abhijit score (9.5)', insight2.nextShift.score === 3.5);
check('Symmetric case: nextShift.themeText reflects the caution description, not Abhijit\'s', insight2.nextShift.themeText.includes('friction'));

// No windows at all -- the safe fallback nextShift must still carry a
// score/themeText field (not undefined), since HomeDashboard always reads
// nextShift.score/nextShift.themeText unconditionally.
const emptyInsight = computeDailyEnergyInsight([], 'NEUTRAL', 600);
check('With no windows, the fallback nextShift still carries a numeric score', typeof emptyInsight.nextShift.score === 'number');
check('With no windows, the fallback nextShift still carries a non-empty themeText', emptyInsight.nextShift.themeText.length > 0);

console.log(allPassed ? '\nALL SCORE ENGINE CHECKS PASSED' : '\nSOME SCORE ENGINE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
