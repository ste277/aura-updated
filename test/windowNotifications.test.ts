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

// PANCH-FOLLOWUP-335: GULIKA is midnight[4] (minutesFromNow=782, the
// largest of the 5 at this clock/fixture) -- it must NOT be presented as
// favorable/suitable for starting something important, and must NOT share
// Rahu Kalam/Yama's exact wording (it is a distinct, third classification).
// This corrects the previous version of this assertion, which asserted
// (incorrectly) that Gulika's body contained "favorable".
const gulikaSpec = midnight[4];
check('Gulika retains its "in N minutes" title format', gulikaSpec?.title === 'Gulika Kalam in 10 minutes');
check(
  'Gulika body uses the approved replacement copy',
  gulikaSpec?.body === 'Gulika Kalam 13:42–15:16. Avoid starting important activities; consider continuing existing work.'
);
check('Gulika body does not contain "Favorable window"', gulikaSpec?.body.includes('Favorable window') === false);
check('Gulika body does not suggest starting something important', gulikaSpec?.body.toLowerCase().includes('line up your key task') === false);
check("Gulika body is distinct from Rahu Kalam/Yama's exact caution wording", gulikaSpec?.body.includes('avoid new beginnings') === false);

// B: Brahma and Abhijit (the two genuinely favorable windows) retain their
// existing wording exactly, unaffected by the Gulika correction.
const brahmaSpec = midnight.find((s) => s.title.includes('Brahma'));
const abhijitSpec = midnight.find((s) => s.title.includes('Abhijit'));
check('Brahma title unchanged ("in N minutes" format)', brahmaSpec?.title === 'Brahma Muhurtham in 10 minutes');
check('Brahma body unchanged (favorable wording)', brahmaSpec?.body === 'Favorable window 04:20–05:08. Line up your key task.');
check('Abhijit title unchanged ("in N minutes" format)', abhijitSpec?.title === 'Abhijit Muhurtham in 10 minutes');
check('Abhijit body unchanged (favorable wording)', abhijitSpec?.body === 'Favorable window 11:48–12:36. Line up your key task.');

// C: Rahu Kalam and Yama (the other two caution windows) retain their
// existing wording exactly, unaffected by the Gulika correction.
const rahuSpec = midnight.find((s) => s.title.includes('Rahu'));
const yamaSpec = midnight.find((s) => s.title.includes('Yama'));
check('Rahu Kalam title unchanged ("ahead" format)', rahuSpec?.title === 'Rahu Kalam ahead');
check('Rahu Kalam body unchanged (caution wording)', rahuSpec?.body === '01:48–03:22. Wrap up before it starts; avoid new beginnings.');
check('Yama title unchanged ("ahead" format)', yamaSpec?.title === 'Yama Gandam ahead');
check('Yama body unchanged (caution wording)', yamaSpec?.body === '09:00–10:34. Wrap up before it starts; avoid new beginnings.');

// D: scheduling invariants -- notification eligibility/count/sort-order are
// governed by prefs[w.type] and minutesFromNow only, neither touched by
// this change. The counts/order/timing assertions above and below (5 specs
// at 00:30, 1 spec with defaults, Gulika firing 32 min out at 13:00, sorted
// soonest-first, no alert for an already-started window) already cover
// this and are unchanged from before the Gulika copy correction.

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
