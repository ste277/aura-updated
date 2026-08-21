// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/panchangCalendarLogic.test.ts
// (see .github/workflows/ci.yml). This file imports a .tsx component, so it
// needs `jsx` set and apps/web's node_modules (react) on the resolution
// path -- deliberately excluded from `tsc -p tsconfig.json`'s batch check
// (root tsconfig.json's `exclude`), same as test/planWithAuraViewLogic.test.ts.
// ts-node itself still fully type-checks it whenever it actually runs.
import { leadingOffsetForMonth, toDateStr } from '../apps/web/components/PanchangCalendarView';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// CALENDAR LOGIC
// ============================================================

check('toDateStr formats a single-digit month/day with zero padding', toDateStr(2026, 8, 5) === '2026-08-05');
check('toDateStr formats a double-digit month/day unchanged', toDateStr(2026, 12, 25) === '2026-12-25');

// Correct first-day grid offset (Monday-first: Mon=0..Sun=6).
// 2026-08-01 is a Saturday.
check('August 2026 (starts on a Saturday) has a leading offset of 5 (Mon,Tue,Wed,Thu,Fri padding before Sat)', leadingOffsetForMonth(2026, 8) === 5);
// 2026-06-01 is a Monday -- no padding needed.
check('June 2026 (starts on a Monday) has a leading offset of 0', leadingOffsetForMonth(2026, 6) === 0);
// 2026-11-01 is a Sunday -- 6 padding cells (Mon..Sat) before it in a Monday-first grid.
check('November 2026 (starts on a Sunday) has a leading offset of 6 in a Monday-first grid', leadingOffsetForMonth(2026, 11) === 6);
check('Every leadingOffsetForMonth() result is within the valid 0-6 range across a full year', Array.from({ length: 12 }, (_, i) => leadingOffsetForMonth(2026, i + 1)).every((o) => o >= 0 && o <= 6));

// Today detection in user timezone -- getDatePartsInTimezone (the function
// the component uses to seed its initial displayYear/displayMonth/selectedDate)
// must reflect the given timezone's calendar date, not the process's own.
const chennaiNow = getDatePartsInTimezone('Asia/Kolkata', new Date('2026-08-21T19:00:00.000Z')); // 00:30 IST Aug 22
const utcNow = getDatePartsInTimezone('UTC', new Date('2026-08-21T19:00:00.000Z'));
check('Today detection is timezone-sensitive: IST is already Aug 22 while UTC is still Aug 21 for the same instant', chennaiNow.dateStr === '2026-08-22' && utcNow.dateStr === '2026-08-21');
check('getDatePartsInTimezone dateStr round-trips through toDateStr for the same components', toDateStr(chennaiNow.year, chennaiNow.month, chennaiNow.day) === chennaiNow.dateStr);

// Previous/next month navigation arithmetic (year rollover at both ends).
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}
check('Previous month from January rolls back to December of the prior year', JSON.stringify(prevMonth(2026, 1)) === JSON.stringify({ year: 2025, month: 12 }));
check('Next month from December rolls forward to January of the next year', JSON.stringify(nextMonth(2026, 12)) === JSON.stringify({ year: 2027, month: 1 }));
check('Previous/next month are inverses for an ordinary mid-year month', JSON.stringify(nextMonth(...Object.values(prevMonth(2026, 8)) as [number, number])) === JSON.stringify({ year: 2026, month: 8 }));

console.log(allPassed ? '\nALL PANCHANG CALENDAR LOGIC CHECKS PASSED' : '\nSOME PANCHANG CALENDAR LOGIC CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
