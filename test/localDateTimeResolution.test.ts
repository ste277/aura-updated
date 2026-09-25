/**
 * Canonical local-wall-time -> UTC conversion (packages/panchang localDate.ts,
 * re-exported by apps/web/lib/timezone.ts). The property test compares the
 * resolver against an INDEPENDENT ground truth: it scans candidate instants and
 * formats each with Intl in the target zone, so "exists once / never / twice" is
 * decided without using the code under test.
 */
import fs from 'fs';
import path from 'path';
import { resolveLocalDateTime, localDateTimeToUTC } from '../packages/panchang/src/localDate';
import { localDateTimeToUTC as webLocalDateTimeToUTC, resolveLocalDateTime as webResolve } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const MIN = 60000;

// ---- independent ground truth ----
const formatters = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => { let f = formatters.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); formatters.set(tz, f); } return f; };
const wall = (tz: string, ms: number) => { const p: Record<string, string> = {}; for (const x of fmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`; };
/** Every instant (15-minute grid; all real offsets and transitions are multiples of 15 minutes) within +-15h of the naive read whose wall time in tz equals the request. */
function truth(tz: string, date: string, time: string): number[] {
  const [y, m, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, h, mi);
  const target = `${date} ${time}`;
  const found: number[] = [];
  for (let t = naive - 15 * 3600000; t <= naive + 15 * 3600000; t += 15 * MIN) if (wall(tz, t) === target) found.push(t);
  return found;
}
const addDay = (date: string, n: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);
const times = (() => { const out: string[] = []; for (let m = 0; m < 1440; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`); return out; })();

const ZONES: Array<{ tz: string; transitions: string[]; note: string }> = [
  { tz: 'America/New_York', transitions: ['2026-03-08', '2026-11-01', '2027-03-14'], note: 'DST' },
  { tz: 'America/Los_Angeles', transitions: ['2026-03-08', '2026-11-01', '2027-03-14'], note: 'DST' },
  { tz: 'Europe/London', transitions: ['2026-03-29', '2026-10-25'], note: 'DST' },
  { tz: 'Australia/Sydney', transitions: ['2026-04-05', '2026-10-04'], note: 'DST (southern)' },
  { tz: 'Australia/Lord_Howe', transitions: ['2026-04-05', '2026-10-04'], note: '30-minute DST shift' },
  { tz: 'Asia/Kolkata', transitions: ['2026-03-08', '2026-11-01', '2026-09-25'], note: 'no DST (control)' },
];

let unique = 0; let nonexistent = 0; let ambiguous = 0; const unexpected: string[] = []; let checked = 0;
const perZone: Record<string, { unique: number; nonexistent: number; ambiguous: number }> = {};
for (const { tz, transitions } of ZONES) {
  perZone[tz] = { unique: 0, nonexistent: 0, ambiguous: 0 };
  for (const t0 of transitions) {
    for (const date of [addDay(t0, -1), t0, addDay(t0, 1)]) {
      for (const time of times) {
        checked++;
        const expected = truth(tz, date, time);
        const got = resolveLocalDateTime(date, time, tz);
        if (expected.length === 1) {
          unique++; perZone[tz].unique++;
          const ok = got.status === 'OK' && got.instant.getTime() === expected[0] && wall(tz, got.instant.getTime()) === `${date} ${time}` && got.instant.getTime() % MIN === 0;
          if (!ok) unexpected.push(`${tz} ${date} ${time}: expected ${new Date(expected[0]).toISOString()} got ${JSON.stringify(got)}`);
        } else if (expected.length === 0) {
          nonexistent++; perZone[tz].nonexistent++;
          if (got.status !== 'NONEXISTENT') unexpected.push(`${tz} ${date} ${time}: expected NONEXISTENT got ${JSON.stringify(got)}`);
        } else {
          ambiguous++; perZone[tz].ambiguous++;
          const ok = got.status === 'AMBIGUOUS' && got.earlier.getTime() === expected[0] && got.later.getTime() === expected[1] && expected.length === 2;
          if (!ok) unexpected.push(`${tz} ${date} ${time}: expected AMBIGUOUS ${expected.map((e) => new Date(e).toISOString())} got ${JSON.stringify(got)}`);
        }
      }
    }
  }
}
check(`11/28. property test over ${checked} wall times (5 zones + Lord Howe, day before / transition day / day after, every 15 min): 0 unexpected mismatches (${unexpected[0] ?? 'none'})`, unexpected.length === 0);
console.log(`     classified: ${unique} unique, ${nonexistent} nonexistent, ${ambiguous} ambiguous | ` + Object.entries(perZone).map(([z, c]) => `${z}: ${c.unique}u/${c.nonexistent}n/${c.ambiguous}a`).join(' | '));
check('11. the property test really exercised the transitions: every DST zone has nonexistent and ambiguous cases, the control has none', ZONES.filter((z) => z.note !== 'no DST (control)').every((z) => perZone[z.tz].nonexistent > 0 && perZone[z.tz].ambiguous > 0) && perZone['Asia/Kolkata'].nonexistent === 0 && perZone['Asia/Kolkata'].ambiguous === 0);

// ---- the ORIGINAL final-review matrix (1,248 wall times: same zones and transition dates) ----
{
  const ORIGINAL: Array<[string, string[]]> = [
    ['America/New_York', ['2026-03-08', '2026-11-01', '2026-06-15', '2026-01-15']],
    ['America/Los_Angeles', ['2026-03-08', '2026-11-01']],
    ['Europe/London', ['2026-03-29', '2026-10-25']],
    ['Australia/Sydney', ['2026-04-05', '2026-10-04']],
    ['Asia/Kolkata', ['2026-03-08', '2026-11-01', '2026-09-25']],
  ];
  const oldOffset = (tz: string, at: Date) => { const m = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(at).find((p) => p.type === 'timeZoneName')!.value.match(/GMT([+-])(\d+)(?::(\d+))?/)!; return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)); };
  /** The pre-correction algorithm (one offset sample at the wall time read as UTC), kept only to prove this matrix catches the defect. */
  const preCorrection = (date: string, time: string, tz: string) => { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); const g = new Date(Date.UTC(y, mo - 1, d, h, mi)); return new Date(g.getTime() - oldOffset(tz, g) * MIN); };
  let total = 0; let u = 0; let n = 0; let a = 0; let bad = 0; let preBad = 0;
  for (const [tz, dates] of ORIGINAL) for (const date of dates) for (const time of times) {
    total++;
    const expected = truth(tz, date, time);
    const got = resolveLocalDateTime(date, time, tz);
    if (expected.length === 1) { u++; if (!(got.status === 'OK' && got.instant.getTime() === expected[0])) bad++; if (preCorrection(date, time, tz).getTime() !== expected[0]) preBad++; }
    else if (expected.length === 0) { n++; if (got.status !== 'NONEXISTENT') bad++; }
    else { a++; if (got.status !== 'AMBIGUOUS') bad++; }
  }
  console.log(`     original matrix: ${total} wall times = ${u} unique valid + ${n} nonexistent + ${a} ambiguous; unexpected mismatches ${bad}; the pre-correction algorithm mismatched ${preBad} of the unique cases`);
  check(`28. the original ${total}-case final-review matrix: 0 unexpected mismatches (unique ${u}, nonexistent ${n}, ambiguous ${a})`, total === 1248 && bad === 0);
  check(`2/28. the same matrix FAILS the pre-correction algorithm (${preBad} unique wall times mismatched), so it is a real regression test`, preBad > 0);
}

// ---- the named cases from the correction ticket ----
const one = (tz: string, date: string, time: string) => { const r = resolveLocalDateTime(date, time, tz); return r.status === 'OK' ? r.instant.toISOString() : r.status; };
check('10. LA spring-forward 2026-03-08 09:00 -> 16:00Z (09:00 PDT); previously 17:00Z / 10:00', one('America/Los_Angeles', '2026-03-08', '09:00') === '2026-03-08T16:00:00.000Z');
check('11. NY spring-forward 05:00 -> 09:00Z (05:00 EDT) and 09:00 -> 13:00Z', one('America/New_York', '2026-03-08', '05:00') === '2026-03-08T09:00:00.000Z' && one('America/New_York', '2026-03-08', '09:00') === '2026-03-08T13:00:00.000Z');
check('12. LA fall-back 2026-11-01 09:00 -> 17:00Z (09:00 PST) and 05:00 -> 13:00Z (05:00 PST); previously 12:00Z / 04:00', one('America/Los_Angeles', '2026-11-01', '09:00') === '2026-11-01T17:00:00.000Z' && one('America/Los_Angeles', '2026-11-01', '05:00') === '2026-11-01T13:00:00.000Z');
check('13. NY fall-back 2026-11-01 05:00 -> 10:00Z (05:00 EST) and 09:00 -> 14:00Z; previously 09:00Z / 04:00', one('America/New_York', '2026-11-01', '05:00') === '2026-11-01T10:00:00.000Z' && one('America/New_York', '2026-11-01', '09:00') === '2026-11-01T14:00:00.000Z');
check('14. London spring 2026-03-29: 00:30 -> 00:30Z (GMT), 01:30 does not exist, 02:00 -> 01:00Z (BST); fall 2026-10-25: 01:30 is ambiguous', one('Europe/London', '2026-03-29', '00:30') === '2026-03-29T00:30:00.000Z' && one('Europe/London', '2026-03-29', '01:30') === 'NONEXISTENT' && one('Europe/London', '2026-03-29', '02:00') === '2026-03-29T01:00:00.000Z' && one('Europe/London', '2026-10-25', '01:30') === 'AMBIGUOUS');
check('15. Sydney spring 2026-10-04: 02:30 does not exist, 09:00 -> 2026-10-03T22:00Z (AEDT); fall 2026-04-05: 02:30 is ambiguous', one('Australia/Sydney', '2026-10-04', '02:30') === 'NONEXISTENT' && one('Australia/Sydney', '2026-10-04', '09:00') === '2026-10-03T22:00:00.000Z' && one('Australia/Sydney', '2026-04-05', '02:30') === 'AMBIGUOUS');
check('16/13. Kolkata control (no DST): morning, afternoon, late evening, and any day, are fixed +05:30', one('Asia/Kolkata', '2026-03-08', '09:00') === '2026-03-08T03:30:00.000Z' && one('Asia/Kolkata', '2026-09-25', '15:45') === '2026-09-25T10:15:00.000Z' && one('Asia/Kolkata', '2026-11-01', '23:45') === '2026-11-01T18:15:00.000Z');

// ---- nonexistent / ambiguous policy ----
check('7. NONEXISTENT: NY 2026-03-08 02:30 is refused (never silently 03:30); 02:00 and 02:45 too; 01:59-equivalent 01:45 and 03:00 exist', one('America/New_York', '2026-03-08', '02:30') === 'NONEXISTENT' && one('America/New_York', '2026-03-08', '02:00') === 'NONEXISTENT' && one('America/New_York', '2026-03-08', '02:45') === 'NONEXISTENT' && one('America/New_York', '2026-03-08', '01:45') === '2026-03-08T06:45:00.000Z' && one('America/New_York', '2026-03-08', '03:00') === '2026-03-08T07:00:00.000Z');
const amb = resolveLocalDateTime('2026-11-01', '01:30', 'America/New_York');
check('8. AMBIGUOUS: NY 2026-11-01 01:30 reports BOTH instants (05:30Z EDT first, 06:30Z EST second) and picks neither', amb.status === 'AMBIGUOUS' && amb.earlier.toISOString() === '2026-11-01T05:30:00.000Z' && amb.later.toISOString() === '2026-11-01T06:30:00.000Z');
check('8. no existing Aura policy for ambiguous wall times exists elsewhere; the strict resolver fails closed and the total function keeps a documented fallback (see below)', /AMBIGUOUS/.test(read('../packages/panchang/src/localDate.ts')));
check('30-minute Lord Howe gap: 02:00-02:29 do not exist on 2026-10-04, 02:30 does', one('Australia/Lord_Howe', '2026-10-04', '02:00') === 'NONEXISTENT' && one('Australia/Lord_Howe', '2026-10-04', '02:15') === 'NONEXISTENT' && one('Australia/Lord_Howe', '2026-10-04', '02:30') !== 'NONEXISTENT');

// ---- date boundaries ----
const bounds = ['00:00', '00:15', '23:45'];
const boundaryOk = ZONES.every(({ tz, transitions }) => transitions.every((t0) => [addDay(t0, -1), t0, addDay(t0, 1)].every((date) => bounds.every((time) => { const r = resolveLocalDateTime(date, time, tz); return r.status !== 'OK' || wall(tz, r.instant.getTime()) === `${date} ${time}`; }))));
check('14. 00:00 / 00:15 / 23:45 never shift the local calendar date, in every zone on every transition day and both neighbours', boundaryOk);

// ---- the total function (existing callers) ----
check('24. one implementation: apps/web/lib/timezone.ts re-exports the package functions (no second, divergent copy)', webLocalDateTimeToUTC === localDateTimeToUTC && webResolve === resolveLocalDateTime && !/const guessUTC/.test(read('../apps/web/lib/timezone.ts')));
check('24. localDateTimeToUTC is exact for every unique wall time (LA 09:00 spring, NY 05:00 fall) and unchanged for ordinary days', localDateTimeToUTC('2026-03-08', '09:00', 'America/Los_Angeles').toISOString() === '2026-03-08T16:00:00.000Z' && localDateTimeToUTC('2026-11-01', '05:00', 'America/New_York').toISOString() === '2026-11-01T10:00:00.000Z' && localDateTimeToUTC('2026-06-15', '14:30', 'America/New_York').toISOString() === '2026-06-15T18:30:00.000Z' && localDateTimeToUTC('1990-03-15', '14:30', 'Asia/Kolkata').toISOString() === '1990-03-15T09:00:00.000Z');
check('24. localDateTimeToUTC stays TOTAL with a fixed documented fallback: a gap time moves forward by the gap (NY 02:30 -> 03:30 EDT = 07:30Z), an overlap time is its first occurrence (NY 01:30 -> 05:30Z)', localDateTimeToUTC('2026-03-08', '02:30', 'America/New_York').toISOString() === '2026-03-08T07:30:00.000Z' && localDateTimeToUTC('2026-11-01', '01:30', 'America/New_York').toISOString() === '2026-11-01T05:30:00.000Z');
const legacy = (date: string, time: string, tz: string) => { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = time.split(':').map(Number); const g = new Date(Date.UTC(y, mo - 1, d, h, mi)); const off = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(g).find((p) => p.type === 'timeZoneName')!.value.match(/GMT([+-])(\d+)(?::(\d+))?/)!; return new Date(g.getTime() - (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3] ?? 0)) * MIN); };
check('24. invalid text keeps the historical behavior exactly (hour past 23 rolls forward as before; "5:30" still parses)', localDateTimeToUTC('2026-08-24', '25:00', 'Asia/Kolkata').getTime() === legacy('2026-08-24', '25:00', 'Asia/Kolkata').getTime() && localDateTimeToUTC('2026-08-24', '5:30', 'Asia/Kolkata').toISOString() === '2026-08-24T00:00:00.000Z');
check('24. invalid text is INVALID for the strict resolver', resolveLocalDateTime('2026-02-30', '09:00', 'Asia/Kolkata').status === 'INVALID' && resolveLocalDateTime('2026-08-24', '24:00', 'Asia/Kolkata').status === 'INVALID' && resolveLocalDateTime('nope', '09:00', 'Asia/Kolkata').status === 'INVALID');
check('24. across the whole matrix the total function agrees with the strict resolver wherever there is exactly one answer (no behavior change for any unique time except the previously wrong ones)', ZONES.every(({ tz, transitions }) => transitions.every((t0) => times.every((time) => { const r = resolveLocalDateTime(t0, time, tz); return r.status !== 'OK' || localDateTimeToUTC(t0, time, tz).getTime() === r.instant.getTime(); }))));
check('37. no new timezone dependency: the resolver uses only Intl (resolveTzOffsetMinutes) and package.json is untouched by this correction', !/require\(|from 'luxon'|from 'date-fns-tz'|from 'moment-timezone'/.test(read('../packages/panchang/src/localDate.ts')));

if (!allPassed) { console.error('SOME LOCAL DATE TIME RESOLUTION CHECKS FAILED'); process.exit(1); }
console.log('ALL LOCAL DATE TIME RESOLUTION CHECKS PASSED');
