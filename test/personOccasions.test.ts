/**
 * AURA-MP-1 -- pure special-day date logic (lib/personOccasions.ts).
 * Unknown year, 29 February in leap and non-leap years, the Dec -> Jan
 * rollover, the user's local midnight in a non-UTC timezone, surfacing
 * windows, and upcoming-list ordering. No database, no clock: every "today"
 * is passed in explicitly.
 */
import { isOccasionSurfaced, listUpcomingOccasions, nextOccurrence, isValidMonthDay } from '../apps/web/lib/personOccasions';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const G = (month: number, day: number, year: number | null = null) => ({ calendar: 'GREGORIAN' as const, month, day, year });

// Unknown year
{
  const n = nextOccurrence(G(12, 5), '2026-11-27');
  check('unknown year: next occurrence found, 8 days away, no age', n?.date === '2026-12-05' && n.daysUntil === 8 && n.turning === null);
}
// Known year
{
  const n = nextOccurrence(G(12, 5, 1986), '2026-11-27');
  check('known year: turning = occurrence year - year (40)', n?.turning === 40);
  const anniv = nextOccurrence(G(1, 10, 2016), '2026-11-27');
  check('known year in the next calendar year: 11th anniversary on 2027-01-10', anniv?.date === '2027-01-10' && anniv.turning === 11);
}
// Today and passed
{
  check('today: daysUntil 0', nextOccurrence(G(11, 27), '2026-11-27')?.daysUntil === 0);
  const passed = nextOccurrence(G(11, 26), '2026-11-27');
  check('yesterday: rolls to next year (364 days)', passed?.date === '2027-11-26' && passed.daysUntil === 364);
}
// Dec -> Jan rollover
{
  const n = nextOccurrence(G(1, 3), '2026-12-30');
  check('Dec 30 -> Jan 3 next year: 4 days', n?.date === '2027-01-03' && n.daysUntil === 4);
}
// 29 February
{
  const nonLeap = nextOccurrence(G(2, 29), '2027-02-01');
  check('29 Feb in a non-leap year is observed on 28 Feb (D4) and flagged', nonLeap?.date === '2027-02-28' && nonLeap.daysUntil === 27 && nonLeap.observedFromLeapDay === true);
  const leap = nextOccurrence(G(2, 29), '2028-02-01');
  check('29 Feb in a leap year is 29 Feb, not flagged', leap?.date === '2028-02-29' && leap.observedFromLeapDay === false);
  const after28 = nextOccurrence(G(2, 29), '2027-03-01');
  check('after the observed 28 Feb, the next is the real 29 Feb 2028', after28?.date === '2028-02-29');
  const age = nextOccurrence(G(2, 29, 2000), '2027-02-01');
  check('29 Feb 2000 birthday: turning 27 on 28 Feb 2027', age?.turning === 27);
  check('isValidMonthDay: 29 Feb valid, 30 Feb / 31 Apr / 0 Jan invalid', isValidMonthDay(2, 29) && !isValidMonthDay(2, 30) && !isValidMonthDay(4, 31) && !isValidMonthDay(1, 0));
}
// Invalid / future calendar types resolve to null (never a crash)
{
  check('incomplete fields -> null', nextOccurrence({ calendar: 'GREGORIAN', month: null, day: 5, year: null }, '2026-11-27') === null);
  check('an unknown calendar type -> null (a future type needs its own branch)', nextOccurrence({ calendar: 'TITHI' as never, month: 1, day: 1, year: null }, '2026-11-27') === null);
}
// User's local midnight in a non-UTC timezone
{
  // 2026-11-26T19:00Z is already 27 Nov 00:30 in Asia/Kolkata but still 26 Nov 11:00 in America/Los_Angeles.
  const instant = new Date('2026-11-26T19:00:00.000Z');
  const kolkata = getDatePartsInTimezone('Asia/Kolkata', instant).dateStr;
  const la = getDatePartsInTimezone('America/Los_Angeles', instant).dateStr;
  check('the same instant is 27 Nov in Kolkata and 26 Nov in Los Angeles', kolkata === '2026-11-27' && la === '2026-11-26');
  check('a 27 Nov birthday is TODAY for the Kolkata user and 1 day away for the LA user', nextOccurrence(G(11, 27), kolkata)?.daysUntil === 0 && nextOccurrence(G(11, 27), la)?.daysUntil === 1);
  // DST: Los Angeles springs forward 2027-03-14; civil-day maths is unaffected.
  check('across a DST change the day count is exact (8 Mar -> 15 Mar = 7)', nextOccurrence(G(3, 15), '2027-03-08')?.daysUntil === 7);
}
// Surfacing
{
  check('surfaced within the lead window (7 days: 0..7)', isOccasionSurfaced(0, 7) && isOccasionSurfaced(7, 7) && !isOccasionSurfaced(8, 7));
  check('remindDaysBefore 0 = on the day only; null = never surfaced ahead', isOccasionSurfaced(0, 0) && !isOccasionSurfaced(1, 0) && !isOccasionSurfaced(0, null));
}
// Upcoming list
{
  const people = new Map([['p1', { name: 'Ravi' }], ['p2', { name: 'Amma' }]]);
  const occasions = [
    { id: 'o1', savedPersonId: 'p1', kind: 'BIRTHDAY' as const, label: null, remindDaysBefore: 7, ...G(12, 5) },
    { id: 'o2', savedPersonId: 'p2', kind: 'ANNIVERSARY' as const, label: null, remindDaysBefore: 7, ...G(12, 21, 1990) },
    { id: 'o3', savedPersonId: 'p2', kind: 'OTHER' as const, label: 'Puja', remindDaysBefore: null, ...G(12, 5) },
    { id: 'o4', savedPersonId: 'gone', kind: 'BIRTHDAY' as const, label: null, remindDaysBefore: 7, ...G(11, 28) },
    { id: 'o5', savedPersonId: 'p1', kind: 'OTHER' as const, label: 'Far', remindDaysBefore: 7, ...G(6, 1) },
  ];
  const list = listUpcomingOccasions(occasions, people, '2026-11-27', 30);
  check('upcoming: within 30 days only (o5 excluded), unknown person skipped (o4)', list.map((x) => x.occasionId).join(',') === 'o3,o1,o2');
  check('upcoming: ties on the same day are ordered by person name (Amma before Ravi)', list[0].personName === 'Amma' && list[1].personName === 'Ravi');
  check('upcoming: surfaced flags follow each special day\'s own lead time', list.find((x) => x.occasionId === 'o1')?.surfaced === false && list.find((x) => x.occasionId === 'o3')?.surfaced === false);
  const soon = listUpcomingOccasions(occasions, people, '2026-11-30', 30);
  check('upcoming: 5 Dec is surfaced from 28 Nov onward (5 days away on 30 Nov)', soon.find((x) => x.occasionId === 'o1')?.surfaced === true && soon.find((x) => x.occasionId === 'o1')?.daysUntil === 5);
  check('upcoming: anniversary turning number carried through (36th on 2026-12-21)', list.find((x) => x.occasionId === 'o2')?.turning === 36);
}

if (!allPassed) {
  console.error('\nSOME PERSON OCCASION CHECKS FAILED');
  process.exit(1);
}
console.log('\nALL PERSON OCCASION CHECKS PASSED');
