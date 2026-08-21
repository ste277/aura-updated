import { findWindowOverlaps } from '../packages/panchang/src/windowOverlap';
import { getPanchangForDate } from '../packages/panchang/src/panchangDay';
import type { PanchangWindowSpan } from '../packages/panchang/src/panchangDay';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function window(type: string, start: string, end: string): PanchangWindowSpan {
  return { type: type as PanchangWindowSpan['type'], label: type, start, end };
}

// ============================================================
// ABHIJIT + RAHU: overlap
// ============================================================

const abhijit = window('ABHIJIT', '2026-07-28T06:20:00.000Z', '2026-07-28T07:12:00.000Z');
const rahuOverlapping = window('RAHU_KALAM', '2026-07-28T06:45:00.000Z', '2026-07-28T08:00:00.000Z'); // starts inside Abhijit
const resultOverlap = findWindowOverlaps([abhijit, rahuOverlapping]);
check('Abhijit + overlapping Rahu Kalam: Abhijit reports Rahu as an overlap', resultOverlap.find((r) => r.window.type === 'ABHIJIT')?.overlaps.some((o) => o.type === 'RAHU_KALAM') === true);
check('Abhijit + overlapping Rahu Kalam: Rahu Kalam reports Abhijit as an overlap (symmetric)', resultOverlap.find((r) => r.window.type === 'RAHU_KALAM')?.overlaps.some((o) => o.type === 'ABHIJIT') === true);

// ============================================================
// No overlap
// ============================================================

const brahma = window('BRAHMA', '2026-07-27T22:46:00.000Z', '2026-07-27T23:34:00.000Z');
const abhijitSeparate = window('ABHIJIT', '2026-07-28T06:20:00.000Z', '2026-07-28T07:12:00.000Z');
const resultNoOverlap = findWindowOverlaps([brahma, abhijitSeparate]);
check('Non-overlapping windows report empty overlaps for both', resultNoOverlap.every((r) => r.overlaps.length === 0));
check('findWindowOverlaps returns one entry per input window even with no overlaps', resultNoOverlap.length === 2);

// Windows that merely touch at a shared boundary instant do not count as overlapping.
const touchingA = window('BRAHMA', '2026-07-28T00:00:00.000Z', '2026-07-28T01:00:00.000Z');
const touchingB = window('ABHIJIT', '2026-07-28T01:00:00.000Z', '2026-07-28T02:00:00.000Z');
check('Windows that only touch at a shared boundary instant are not reported as overlapping', findWindowOverlaps([touchingA, touchingB]).every((r) => r.overlaps.length === 0));

// ============================================================
// Partial overlap
// ============================================================

const partialA = window('GULIKA', '2026-07-28T12:16:00.000Z', '2026-07-28T13:51:00.000Z');
const partialB = window('ABHIJIT', '2026-07-28T11:50:00.000Z', '2026-07-28T12:42:00.000Z'); // ends inside Gulika's span
const resultPartial = findWindowOverlaps([partialA, partialB]);
check('Partial overlap (B ends inside A) is detected both directions', resultPartial.find((r) => r.window.type === 'GULIKA')!.overlaps.length === 1 && resultPartial.find((r) => r.window.type === 'ABHIJIT')!.overlaps.length === 1);

// ============================================================
// Containment (one window fully inside another)
// ============================================================

const outer = window('YAMA', '2026-07-28T09:00:00.000Z', '2026-07-28T11:00:00.000Z');
const inner = window('ABHIJIT', '2026-07-28T09:30:00.000Z', '2026-07-28T10:00:00.000Z'); // fully inside outer
const resultContainment = findWindowOverlaps([outer, inner]);
check('Fully-contained window is detected as an overlap of the container', resultContainment.find((r) => r.window.type === 'YAMA')!.overlaps.some((o) => o.type === 'ABHIJIT'));
check('Container is detected as an overlap of the fully-contained window', resultContainment.find((r) => r.window.type === 'ABHIJIT')!.overlaps.some((o) => o.type === 'YAMA'));

// ============================================================
// A window never reports itself as an overlap, and 3+ windows are handled.
// ============================================================

const three = findWindowOverlaps([abhijit, rahuOverlapping, brahma]);
check('A window is never listed as its own overlap', three.every((r) => !r.overlaps.some((o) => o.type === r.window.type)));
check('With 3 windows, the two that overlap still find each other and the third stays isolated', three.find((r) => r.window.type === 'BRAHMA')!.overlaps.length === 0
  && three.find((r) => r.window.type === 'ABHIJIT')!.overlaps.length === 1
  && three.find((r) => r.window.type === 'RAHU_KALAM')!.overlaps.length === 1);

// ============================================================
// Real fixture: 2026-07-28 Chennai genuinely has Abhijit/Gulika overlapping.
// ============================================================

const realDay = getPanchangForDate({ localDate: '2026-07-28', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
const realOverlaps = findWindowOverlaps(realDay.windows);
const realAbhijit = realOverlaps.find((r) => r.window.type === 'ABHIJIT')!;
check('Real fixture: Abhijit genuinely overlaps Gulika on 2026-07-28 (matches panchangDay.test.ts\'s fixture)', realAbhijit.overlaps.some((o) => o.type === 'GULIKA'));
check('Real fixture: every window entry is present exactly once', realOverlaps.length === realDay.windows.length);
check('findWindowOverlaps does not mutate or reorder the input array', realDay.windows.map((w) => w.type).join(',') === realOverlaps.map((r) => r.window.type).join(','));

console.log(allPassed ? '\nALL WINDOW OVERLAP CHECKS PASSED' : '\nSOME WINDOW OVERLAP CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
