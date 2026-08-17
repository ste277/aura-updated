import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

// Expected values verified independently with the OS date/zoneinfo tools
// (macOS `date -j`), not with JS Intl itself:
//   2026-08-15 = Saturday, 2026-08-14 = Friday, 2025-12-31 = Wednesday.
interface Case {
  label: string;
  instantUTC: Date;
  timezone: string;
  expected: { dateStr: string; weekday: number; year: number; month: number; day: number };
}

const cases: Case[] = [
  {
    // The `toISOString()` bug: late evening UTC is already the NEXT day in
    // India. UTC date here is 08-14 (Friday); IST must report 08-15 Saturday.
    label: 'Chennai user at 02:00 IST — date must be ahead of the UTC date',
    instantUTC: new Date(Date.UTC(2026, 7, 14, 20, 30)),
    timezone: 'Asia/Kolkata',
    expected: { dateStr: '2026-08-15', weekday: 6, year: 2026, month: 8, day: 15 },
  },
  {
    // Same instant seen from a New York browser: still Friday the 14th.
    // A NY-browser user with a Chennai profile must get Chennai's Saturday
    // windows, not New York's Friday — this case pins each side.
    label: 'Same instant in New York — still Friday 08-14',
    instantUTC: new Date(Date.UTC(2026, 7, 14, 20, 30)),
    timezone: 'America/New_York',
    expected: { dateStr: '2026-08-14', weekday: 5, year: 2026, month: 8, day: 14 },
  },
  {
    // Year boundary crossing westward.
    label: 'NY at 22:00 EST on New Year\'s Eve — previous year vs UTC',
    instantUTC: new Date(Date.UTC(2026, 0, 1, 3, 0)),
    timezone: 'America/New_York',
    expected: { dateStr: '2025-12-31', weekday: 3, year: 2025, month: 12, day: 31 },
  },
  {
    label: 'Same instant in Kolkata — already Thursday 2026-01-01',
    instantUTC: new Date(Date.UTC(2026, 0, 1, 3, 0)),
    timezone: 'Asia/Kolkata',
    expected: { dateStr: '2026-01-01', weekday: 4, year: 2026, month: 1, day: 1 },
  },
];

let allPassed = true;

for (const c of cases) {
  const got = getDatePartsInTimezone(c.timezone, c.instantUTC);
  const pass =
    got.dateStr === c.expected.dateStr &&
    got.weekday === c.expected.weekday &&
    got.year === c.expected.year &&
    got.month === c.expected.month &&
    got.day === c.expected.day;
  if (!pass) allPassed = false;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${c.label}`);
  if (!pass) {
    console.log(`     expected ${JSON.stringify(c.expected)}`);
    console.log(`     got      ${JSON.stringify(got)}`);
  }
}

console.log(allPassed ? '\nALL TIMEZONE CHECKS PASSED' : '\nSOME TIMEZONE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
