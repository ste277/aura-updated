/**
 * AURA-MOBILE-01-AND-COMPAT-05 -- resolveTzOffsetMinutes on environments with
 * and without Intl timeZoneName 'shortOffset' (older WebViews, e.g. Chromium 91,
 * throw "RangeError: Value shortOffset out of range for Intl.DateTimeFormat
 * options property timeZoneName" at formatter construction).
 *
 *   npx ts-node test/timezoneShortOffsetFallback.test.ts
 *
 * Every case runs twice: on the platform's native Intl (primary path) and under a
 * simulated older-WebView Intl that rejects 'shortOffset' exactly like Chromium 91
 * (fallback path). Expected offsets are independent, hard-coded values (minutes
 * EAST of UTC), using explicit UTC instants -- never the runner's local timezone.
 */
import * as webTz from '../apps/web/lib/timezone';
import * as panchangTz from '../packages/panchang/src/localDate';

// Both implementations are exercised (approved AND-COMPAT-05 amendment): the
// apps/web helper and its packages/panchang twin, which Home also reaches.
const IMPLS = [
  { name: 'apps/web/lib/timezone', fn: webTz.resolveTzOffsetMinutes, reset: webTz.__resetShortOffsetSupportForTests },
  { name: 'packages/panchang/src/localDate', fn: panchangTz.resolveTzOffsetMinutes, reset: panchangTz.__resetShortOffsetSupportForTests },
];
let resolveTzOffsetMinutes = IMPLS[0].fn;
let __resetShortOffsetSupportForTests = IMPLS[0].reset;
let IMPL_NAME = IMPLS[0].name;

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean, note = '') {
  ok ? passed++ : failed++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}${note ? ' -- ' + note : ''}`);
}

const NativeDTF = Intl.DateTimeFormat;
type Mode = 'native' | 'webview91' | 'typeerror';
function setIntl(mode: Mode) {
  const g = Intl as unknown as { DateTimeFormat: unknown };
  if (mode === 'native') {
    g.DateTimeFormat = NativeDTF;
  } else {
    const Fake = function (this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      if (options && (options as { timeZoneName?: string }).timeZoneName === 'shortOffset') {
        if (mode === 'typeerror') throw new TypeError('simulated unrelated failure');
        throw new RangeError('Value shortOffset out of range for Intl.DateTimeFormat options property timeZoneName');
      }
      return new NativeDTF(locales, options);
    } as unknown as typeof Intl.DateTimeFormat;
    g.DateTimeFormat = Fake;
  }
  IMPLS.forEach((i) => i.reset());
}

const at = (iso: string) => new Date(iso);
// [timezone, UTC instant, expected minutes east of UTC, label]
const CASES: Array<[string, string, number, string]> = [
  ['UTC', '2026-06-15T12:00:00Z', 0, 'UTC'],
  ['Asia/Kolkata', '2026-01-15T06:00:00Z', 330, 'Asia/Kolkata +05:30 (half-hour)'],
  ['Asia/Kathmandu', '2026-07-01T00:00:00Z', 345, 'Asia/Kathmandu +05:45 (quarter-hour)'],
  ['Pacific/Chatham', '2026-07-01T00:00:00Z', 765, 'Pacific/Chatham +12:45 standard (quarter-hour)'],
  ['Pacific/Chatham', '2026-01-15T00:00:00Z', 825, 'Pacific/Chatham +13:45 daylight (quarter-hour + DST)'],
  ['America/St_Johns', '2026-01-15T12:00:00Z', -210, 'America/St_Johns -03:30 (negative half-hour)'],
  ['America/St_Johns', '2026-07-15T12:00:00Z', -150, 'America/St_Johns -02:30 daylight'],
  ['America/New_York', '2026-01-15T12:00:00Z', -300, 'America/New_York winter EST -05:00'],
  ['America/New_York', '2026-07-15T12:00:00Z', -240, 'America/New_York summer EDT -04:00'],
  // US 2026: DST starts Sun 8 Mar 02:00 EST (= 07:00Z), ends Sun 1 Nov 02:00 EDT (= 06:00Z)
  ['America/New_York', '2026-03-08T06:59:59Z', -300, 'NY spring transition: 1 s before'],
  ['America/New_York', '2026-03-08T07:00:00Z', -240, 'NY spring transition: at the instant'],
  ['America/New_York', '2026-11-01T05:59:59Z', -240, 'NY autumn transition: 1 s before'],
  ['America/New_York', '2026-11-01T06:00:00Z', -300, 'NY autumn transition: at the instant'],
  // EU 2026: summer time 29 Mar 01:00Z .. 25 Oct 01:00Z
  ['Europe/London', '2026-03-29T00:59:59Z', 0, 'London spring: 1 s before'],
  ['Europe/London', '2026-03-29T01:00:00Z', 60, 'London spring: at the instant'],
  ['Europe/London', '2026-10-25T00:59:59Z', 60, 'London autumn: 1 s before'],
  ['Europe/London', '2026-10-25T01:00:00Z', 0, 'London autumn: at the instant'],
  ['Australia/Lord_Howe', '2026-01-15T00:00:00Z', 660, 'Lord Howe +11:00 summer (30-min DST)'],
  ['Australia/Lord_Howe', '2026-07-15T00:00:00Z', 630, 'Lord Howe +10:30 winter'],
  ['Pacific/Honolulu', '2026-01-01T05:00:00Z', -600, 'Honolulu -10:00 (local date is the previous day)'],
  ['Asia/Kolkata', '2026-12-31T20:00:00Z', 330, 'Kolkata across a year boundary (local 1 Jan 01:30)'],
  ['Pacific/Kiritimati', '2026-06-15T12:00:00Z', 840, 'Kiritimati +14:00 (largest positive)'],
  ['Pacific/Pago_Pago', '2026-06-15T12:00:00Z', -660, 'Pago Pago -11:00 (large negative)'],
  ['Asia/Kolkata', '2026-05-05T10:20:30.999Z', 330, 'sub-second instant'],
  ['America/Los_Angeles', '2026-03-08T09:59:59.500Z', -480, 'LA 0.5 s before spring transition (10:00Z)'],
  ['America/Los_Angeles', '2026-03-08T10:00:00Z', -420, 'LA at spring transition'],
];

for (const impl of IMPLS) {
  resolveTzOffsetMinutes = impl.fn; __resetShortOffsetSupportForTests = impl.reset; IMPL_NAME = impl.name;
for (const mode of ['native', 'webview91'] as const) {
  setIntl(mode);
  const pathName = mode === 'native' ? 'primary (shortOffset supported)' : 'fallback (simulated WebView 91)';
  // Sanity: the simulation really rejects shortOffset, the native one really supports it.
  let rejects = false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', timeZoneName: 'shortOffset' }); } catch (e) { rejects = e instanceof RangeError; }
  check(`[${IMPL_NAME}] [${pathName}] environment ${mode === 'native' ? 'supports' : 'rejects'} shortOffset as intended`, mode === 'native' ? !rejects : rejects);
  for (const [tz, iso, expected, label] of CASES) {
    let got: number | string;
    try { got = resolveTzOffsetMinutes(tz, at(iso)); } catch (e) { got = `threw ${(e as Error).name}`; }
    check(`[${IMPL_NAME}] [${pathName}] ${label}`, got === expected, `expected ${expected}, got ${got}`);
  }
  // Invalid IANA timezone: existing contract = RangeError from Intl, never a number.
  let invalid: string;
  try { invalid = `returned ${resolveTzOffsetMinutes('Mars/Olympus_Mons', at('2026-01-01T00:00:00Z'))}`; } catch (e) { invalid = (e as Error).name; }
  check(`[${IMPL_NAME}] [${pathName}] invalid IANA timezone still throws RangeError (not silently 0/UTC)`, invalid === 'RangeError', invalid);
  // Invalid Date: existing contract = RangeError from formatToParts.
  let invalidDate: string;
  try { invalidDate = `returned ${resolveTzOffsetMinutes('UTC', new Date(NaN))}`; } catch (e) { invalidDate = (e as Error).name; }
  check(`[${IMPL_NAME}] [${pathName}] invalid Date still throws RangeError`, invalidDate === 'RangeError', invalidDate);
}

// Fallback agrees with the primary path across a broad sweep (zones x instants).
{
  const ZONES = ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Asia/Tehran', 'Asia/Tokyo', 'Australia/Adelaide', 'Australia/Lord_Howe', 'Pacific/Chatham',
    'America/New_York', 'America/Los_Angeles', 'America/St_Johns', 'America/Sao_Paulo', 'America/Santiago', 'Europe/London', 'Europe/Berlin',
    'Africa/Casablanca', 'Pacific/Honolulu', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const instants: Date[] = [];
  for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 6 * 3600 * 1000 + 17 * 60 * 1000 + 13 * 1000) instants.push(new Date(t));
  setIntl('native');
  const primary = ZONES.map((z) => instants.map((d) => resolveTzOffsetMinutes(z, d)));
  setIntl('webview91');
  let mismatches = 0; let total = 0; const examples: string[] = [];
  ZONES.forEach((z, zi) => instants.forEach((d, di) => {
    total++;
    const f = resolveTzOffsetMinutes(z, d);
    if (f !== primary[zi][di]) { mismatches++; if (examples.length < 3) examples.push(`${z}@${d.toISOString()} primary=${primary[zi][di]} fallback=${f}`); }
  }));
  check(`[${IMPL_NAME}] fallback == primary for ${total} zone/instant pairs across 2026 (${ZONES.length} zones incl. DST, half/quarter-hour)`, mismatches === 0, mismatches ? examples.join('; ') : '');
}

// Unrelated formatter errors are not swallowed (detection rethrows non-RangeError).
{
  setIntl('typeerror');
  let r: string;
  try { r = `returned ${resolveTzOffsetMinutes('Asia/Kolkata', at('2026-01-01T00:00:00Z'))}`; } catch (e) { r = (e as Error).name; }
  check(`[${IMPL_NAME}] ` + 'unrelated formatter error (TypeError) propagates; fallback not activated', r === 'TypeError', r);
}

// Detection is cached: after the first call, no further shortOffset probes.
{
  let probes = 0;
  const g = Intl as unknown as { DateTimeFormat: unknown };
  g.DateTimeFormat = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    if (options && (options as { timeZoneName?: string }).timeZoneName === 'shortOffset') { probes++; throw new RangeError('Value shortOffset out of range'); }
    return new NativeDTF(locales, options);
  } as unknown as typeof Intl.DateTimeFormat;
  __resetShortOffsetSupportForTests();
  for (let i = 0; i < 50; i++) resolveTzOffsetMinutes('Asia/Kolkata', at('2026-01-01T00:00:00Z'));
  check(`[${IMPL_NAME}] ` + 'feature detection runs once and is cached (1 probe for 50 calls)', probes === 1, `probes=${probes}`);
}

}

// Both implementations return identical offsets, on both paths.
for (const mode of ['native', 'webview91'] as const) {
  setIntl(mode);
  let diff = 0; let n = 0;
  for (const z of ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Pacific/Chatham', 'America/New_York', 'America/St_Johns', 'Europe/London', 'Australia/Lord_Howe']) {
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 11 * 3600 * 1000 + 7 * 60 * 1000) {
      n++; if (webTz.resolveTzOffsetMinutes(z, new Date(t)) !== panchangTz.resolveTzOffsetMinutes(z, new Date(t))) diff++;
    }
  }
  check(`apps/web and packages/panchang implementations agree (${mode}, ${n} pairs)`, diff === 0, diff ? `${diff} mismatches` : '');
}

// Review fixes (P2-a / P3-a / P3-b), both implementations.
for (const impl of IMPLS) {
  // P2-a: historical offsets with a seconds component (LMT) -- fallback must truncate like the primary path.
  const HIST = ['Asia/Dhaka', 'Pacific/Niue', 'America/St_Johns', 'Europe/Amsterdam', 'Asia/Kolkata', 'Asia/Kathmandu', 'Africa/Monrovia', 'America/New_York'];
  setIntl('native');
  const prim = HIST.map((z) => { const r: number[] = []; for (let y = 1800; y <= 1960; y += 2) r.push(impl.fn(z, new Date(Date.UTC(y, 5, 15, 12)))); return r; });
  setIntl('webview91');
  let mm = 0; let n = 0; const ex: string[] = [];
  HIST.forEach((z, zi) => { let k = 0; for (let y = 1800; y <= 1960; y += 2) { n++; const f = impl.fn(z, new Date(Date.UTC(y, 5, 15, 12))); if (f !== prim[zi][k]) { mm++; if (ex.length < 2) ex.push(`${z} ${y}: ${prim[zi][k]} vs ${f}`); } k++; } });
  check(`[${impl.name}] historical offsets with seconds (1800-1960, ${n} pairs): fallback == primary (truncation)`, mm === 0, ex.join('; '));
  // P3-a: years 0-99 are not remapped to 1900-1999.
  const y50 = new Date(0); y50.setUTCFullYear(50, 5, 15); y50.setUTCHours(12, 0, 0, 0);
  check(`[${impl.name}] fallback: UTC in year 0050 -> 0 (no 1900-1999 remap)`, impl.fn('UTC', y50) === 0, String(impl.fn('UTC', y50)));
  // P3-b: if formatter parts are missing, throw RangeError -- never return NaN silently.
  const g = Intl as unknown as { DateTimeFormat: unknown };
  g.DateTimeFormat = function (locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    if (options && (options as { timeZoneName?: string }).timeZoneName === 'shortOffset') throw new RangeError('Value shortOffset out of range');
    const real = new NativeDTF(locales, options);
    return { formatToParts: (d: Date) => real.formatToParts(d).filter((p) => p.type !== 'year'), resolvedOptions: () => real.resolvedOptions() };
  } as unknown as typeof Intl.DateTimeFormat;
  impl.reset();
  let nanResult: string;
  try { nanResult = `returned ${impl.fn('Asia/Kolkata', new Date('2026-01-01T00:00:00Z'))}`; } catch (e) { nanResult = (e as Error).name; }
  check(`[${impl.name}] fallback: missing formatter part -> RangeError, not silent NaN`, nanResult === 'RangeError', nanResult);
}

// AURA-MOBILE-01-COMPAT-05-F1 -- the fallback rebuilds the zone's wall clock with an
// immutable Date.UTC (plus a 400-year Gregorian-cycle shift for years 0-99) instead of
// setUTCFullYear/setUTCHours. Expected values below are either independent hard-coded
// offsets or the platform's own primary (shortOffset) path, never the fallback itself.
{
  // ISO strings keep years 0-99 literal (Date.UTC would remap them to 1900-1999).
  const iso = (y: number, rest: string) => new Date(`${String(y).padStart(4, '0')}-${rest}`);
  // [timezone, UTC instant, expected minutes east of UTC, label]
  const F1_CASES: Array<[string, Date, number, string]> = [
    ['Asia/Kolkata', at('2026-01-31T19:00:00Z'), 330, 'month boundary: local 1 Feb 00:30 from 31 Jan UTC'],
    ['America/New_York', at('2026-05-01T02:00:00Z'), -240, 'month boundary: local 30 Apr 22:00 from 1 May UTC'],
    ['Pacific/Kiritimati', at('2026-12-31T10:30:00Z'), 840, 'year boundary: local 1 Jan 00:30 (+14:00)'],
    ['Pacific/Pago_Pago', at('2027-01-01T05:00:00Z'), -660, 'year boundary: local 31 Dec 18:00 (-11:00)'],
    ['Asia/Kolkata', at('2024-02-28T19:00:00Z'), 330, 'leap day: local 29 Feb 2024 00:30'],
    ['America/Los_Angeles', at('2024-03-01T07:59:59Z'), -480, 'leap day: local 29 Feb 2024 23:59:59'],
    ['Europe/London', at('2000-02-29T12:00:00Z'), 0, 'leap day 2000 (divisible by 400)'],
    ['Asia/Tokyo', at('2100-02-28T15:30:00Z'), 540, '2100 is not a leap year: local 1 Mar 00:30'],
    ['America/New_York', at('2024-02-29T07:00:00Z'), -300, 'leap day in winter time (EST)'],
    ['Australia/Lord_Howe', at('2028-02-29T00:00:00Z'), 660, 'leap day 2028 during 30-min DST'],
  ];
  setIntl('webview91');
  for (const impl of IMPLS) {
    for (const [tz, d, expected, label] of F1_CASES) {
      let got: number | string;
      try { got = impl.fn(tz, d); } catch (e) { got = `threw ${(e as Error).name}`; }
      check(`[${impl.name}] [F1 fallback] ${label}`, got === expected, `expected ${expected}, got ${got}`);
    }
    // Input immutability and repeat stability: the caller's Date is never changed.
    const input = at('2026-03-08T07:00:00Z'); const before = input.getTime();
    const runs = Array.from({ length: 20 }, () => impl.fn('America/New_York', input));
    check(`[${impl.name}] [F1 fallback] input Date unchanged and 20 repeated calls stable`, input.getTime() === before && runs.every((r) => r === -240), `runs=${[...new Set(runs)]}`);
  }

  // Years 0-99 and the 99/100 boundary: the fallback matches the primary path (which
  // reads the offset string directly and has no year arithmetic) for every implementation.
  // Supported domain is AD wall-clock times: the fallback reads the numeric year part and
  // (like the pre-F1 code) not the era, so 0001-01-01T00:00Z in a UTC-minus zone (local
  // wall clock in 1 BC) is outside it -- covered by the reference check below instead.
  const ANCIENT_ZONES = ['UTC', 'Asia/Kolkata', 'America/New_York', 'Europe/London', 'Pacific/Kiritimati', 'Asia/Kathmandu'];
  const ancient: Date[] = [];
  for (let y = 1; y <= 120; y++) ancient.push(iso(y, '06-15T12:00:00Z'), iso(y, '12-31T23:59:59Z'));
  for (let y = 2; y <= 120; y++) ancient.push(iso(y, '01-01T00:00:00Z'));
  ancient.push(iso(4, '02-29T12:00:00Z'), iso(96, '02-29T23:30:00Z'), iso(99, '12-31T20:00:00Z'), iso(100, '01-01T03:00:00Z'), iso(100, '03-01T00:00:00Z'));
  for (const impl of IMPLS) {
    setIntl('native');
    const prim = ANCIENT_ZONES.map((z) => ancient.map((d) => impl.fn(z, d)));
    setIntl('webview91');
    let mm = 0; let n = 0; const ex: string[] = [];
    ANCIENT_ZONES.forEach((z, zi) => ancient.forEach((d, di) => {
      n++; const f = impl.fn(z, d);
      if (f !== prim[zi][di]) { mm++; if (ex.length < 3) ex.push(`${z}@${d.toISOString()} primary=${prim[zi][di]} fallback=${f}`); }
    }));
    check(`[${impl.name}] [F1 fallback] years 0001-0120 incl. 0099/0100 boundary and leap days 0004/0096 (${n} pairs): fallback == primary`, mm === 0, ex.join('; '));
    check(`[${impl.name}] [F1 fallback] UTC at 0099-12-31T23:59:59Z -> 0 and 0100-01-01T00:00:00Z -> 0 (no 1900-1999 remap)`,
      impl.fn('UTC', iso(99, '12-31T23:59:59Z')) === 0 && impl.fn('UTC', iso(100, '01-01T00:00:00Z')) === 0);
  }

  // Behaviour preservation: the immutable fallback returns exactly what the pre-F1
  // mutating construction (setUTCFullYear/setUTCHours, reproduced here in TEST code,
  // which the architecture guard does not scan) returns for the same formatter parts,
  // including inputs outside the supported domain (1 BC wall clock, era ignored).
  {
    const preF1 = (tz: string, d: Date): number => {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d);
      const get = (t: Intl.DateTimeFormatPartTypes) => parseInt(parts.find((p) => p.type === t)?.value ?? 'NaN', 10);
      const wall = new Date(0);
      wall.setUTCFullYear(get('year'), get('month') - 1, get('day'));
      wall.setUTCHours(get('hour') % 24, get('minute'), get('second'), 0);
      return Math.trunc((wall.getTime() - Math.floor(d.getTime() / 1000) * 1000) / 60000);
    };
    const REF_ZONES = [...ANCIENT_ZONES, 'Pacific/Pago_Pago', 'Pacific/Chatham', 'America/St_Johns', 'Australia/Lord_Howe'];
    const refInstants = [...ancient, iso(1, '01-01T00:00:00Z'), iso(1, '01-01T05:00:00Z'), at('1969-12-31T23:59:59Z'), at('2026-03-08T07:00:00Z'), at('2100-02-28T23:30:00Z'), at('9999-12-31T23:59:59Z')];
    setIntl('webview91');
    for (const impl of IMPLS) {
      let mm = 0; let n = 0; const ex: string[] = [];
      for (const z of REF_ZONES) for (const d of refInstants) {
        n++; const f = impl.fn(z, d); const r = preF1(z, d);
        if (f !== r) { mm++; if (ex.length < 3) ex.push(`${z}@${d.toISOString()} preF1=${r} now=${f}`); }
      }
      check(`[${impl.name}] [F1 fallback] identical to the pre-F1 mutating construction (${n} zone/instant pairs, incl. 1 BC wall clock)`, mm === 0, ex.join('; '));
    }
  }

  // Broad modern sweep, both implementations: fallback == primary across 1970-2100 at
  // month ends, leap days and DST-heavy zones (complements the 2026 sweep above).
  const SWEEP_ZONES = ['America/New_York', 'Europe/Berlin', 'Australia/Lord_Howe', 'America/Santiago', 'Asia/Kolkata', 'Pacific/Chatham'];
  const sweep: Date[] = [];
  for (let y = 1970; y <= 2100; y += 3) for (const md of ['01-01T00:30:00Z', '02-28T23:30:00Z', '03-01T00:30:00Z', '06-30T23:59:59Z', '10-31T12:00:00Z', '12-31T23:30:00Z']) sweep.push(iso(y, md));
  for (let y = 1972; y <= 2096; y += 4) sweep.push(iso(y, '02-29T12:00:00Z'));
  for (const impl of IMPLS) {
    setIntl('native');
    const prim = SWEEP_ZONES.map((z) => sweep.map((d) => impl.fn(z, d)));
    setIntl('webview91');
    let mm = 0; let n = 0; const ex: string[] = [];
    SWEEP_ZONES.forEach((z, zi) => sweep.forEach((d, di) => {
      n++; const f = impl.fn(z, d);
      if (f !== prim[zi][di]) { mm++; if (ex.length < 3) ex.push(`${z}@${d.toISOString()} primary=${prim[zi][di]} fallback=${f}`); }
    }));
    check(`[${impl.name}] [F1 fallback] 1970-2100 month-end / leap-day / DST sweep (${n} pairs): fallback == primary`, mm === 0, ex.join('; '));
  }
}

setIntl('native');
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
