import { computeWindowNotificationSpecs, DEFAULT_NOTIFICATION_PREFS } from '../apps/web/lib/windowNotificationPlanner';
import type { WindowSpan } from '../packages/panchang/src/windows';

// Representative Chennai-like day: minutes are local clock (0-1439).
const windows: WindowSpan[] = [
  { type: 'BRAHMA', label: 'Brahma Muhurtham', startMinutes: 260, endMinutes: 308 },
  { type: 'ABHIJIT', label: 'Abhijit Muhurtham', startMinutes: 708, endMinutes: 756 },
  { type: 'RAHU_KALAM', label: 'Rahu Kalam', startMinutes: 108, endMinutes: 202 },
  { type: 'GULIKA', label: 'Gulika Kalam', startMinutes: 822, endMinutes: 916 },
  { type: 'YAMA', label: 'Yama Gandam', startMinutes: 540, endMinutes: 634 },
];

let allPassed = true;
function check(label: string, cond: boolean) {
  if (!cond) allPassed = false;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`);
}

// 06:00 (360): Rahu (108) and Brahma (260) already past; defaults enable
// ABHIJIT + RAHU_KALAM only → just Abhijit at 708-10-360 = 338 min out.
const morning = computeWindowNotificationSpecs(windows, 360, DEFAULT_NOTIFICATION_PREFS);
check('defaults at 06:00 → exactly 1 spec (Abhijit)', morning.length === 1);
check('Abhijit fires 10 min before start', morning[0]?.minutesFromNow === 338);
check('Abhijit title mentions the window', morning[0]?.title.includes('Abhijit') === true);

// 00:30 (30) with everything enabled → all 5 upcoming, sorted soonest-first.
const allOn = { ...DEFAULT_NOTIFICATION_PREFS, BRAHMA: true, GULIKA: true, YAMA: true };
const midnight = computeWindowNotificationSpecs(windows, 30, allOn);
check('all-on at 00:30 → 5 specs', midnight.length === 5);
check('sorted soonest first (Rahu first)', midnight[0]?.title.includes('Rahu') === true);
check('caution window says avoid', midnight[0]?.body.toLowerCase().includes('avoid') === true);
check('favorable window says favorable', midnight[4]?.body.toLowerCase().includes('favorable') === true);

// 13:00 (780): Abhijit started (708) — must NOT alert mid-window; Gulika
// (822, enabled) still ahead → fires at 822-10-780 = 32.
const afternoon = computeWindowNotificationSpecs(windows, 780, allOn);
check('no alert for already-started window', afternoon.every((s) => !s.title.includes('Abhijit')));
check('Gulika alert 32 min out', afternoon[0]?.minutesFromNow === 32);

// 23:00 (1380): nothing left today.
const night = computeWindowNotificationSpecs(windows, 1380, allOn);
check('no alerts left at 23:00', night.length === 0);

console.log(allPassed ? '\nALL NOTIFICATION CHECKS PASSED' : '\nSOME NOTIFICATION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
