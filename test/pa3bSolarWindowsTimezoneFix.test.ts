/**
 * AURA PA-3B: regression coverage for the confirmed server-TZ-dependent
 * timestamp defect in packages/astronomy/src/solarWindows.ts's
 * localMinutesToDate() (previously `new Date(year, month-1, day, hours,
 * mins, 0)`, interpreted in the server process's own timezone rather than
 * the target location's IANA zone). Fixed by routing through the same
 * getDatePartsInTimezone()/localDateTimeToUTC() utilities the primary
 * Panchangam path (panchangDay.ts, ceremonialPeriods.ts) already uses.
 *
 * The 4 absolute-instant fixtures in section A are deterministic civil-time
 * conversions (not astronomical sunrise predictions), independently
 * verified via a standalone Intl-offset probe distinct from
 * localDateTimeToUTC itself before being hardcoded here (see the PA-3B
 * implementation report for that independent cross-check).
 */
import { localDateTimeToUTC, getDatePartsInTimezone } from '../packages/panchang/src/localDate';
import { getDailySolarWindows } from '../packages/astronomy/src/solarWindows';
import { formatLocalICSDate, computeUserLocalNoon } from '../apps/web/lib/calendarFeedIcs';
import { execFileSync } from 'child_process';
import * as path from 'path';

let passed = 0;
let failed = 0;
function check(label: string, condition: boolean) {
  if (condition) {
    passed++;
    console.log('OK  ', label);
  } else {
    failed++;
    console.log('FAIL', label);
  }
}

// ============================================================
// A. Absolute-instant conversion fixtures (independently verified)
// ============================================================
check(
  'India: 2026-06-21 06:00 Asia/Kolkata -> 2026-06-21T00:30:00.000Z',
  localDateTimeToUTC('2026-06-21', '06:00', 'Asia/Kolkata').toISOString() === '2026-06-21T00:30:00.000Z'
);
check(
  'Nepal: 2026-06-21 06:00 Asia/Kathmandu -> 2026-06-21T00:15:00.000Z',
  localDateTimeToUTC('2026-06-21', '06:00', 'Asia/Kathmandu').toISOString() === '2026-06-21T00:15:00.000Z'
);
check(
  'New York winter: 2026-01-15 06:00 America/New_York (EST, UTC-5) -> 2026-01-15T11:00:00.000Z',
  localDateTimeToUTC('2026-01-15', '06:00', 'America/New_York').toISOString() === '2026-01-15T11:00:00.000Z'
);
check(
  'New York summer: 2026-07-15 06:00 America/New_York (EDT, UTC-4) -> 2026-07-15T10:00:00.000Z',
  localDateTimeToUTC('2026-07-15', '06:00', 'America/New_York').toISOString() === '2026-07-15T10:00:00.000Z'
);

// ============================================================
// B. getDailySolarWindows() produces identical UTC instants for identical
//    inputs regardless of which IANA timezone is active -- confirms the
//    fixed function is no longer silently coupled to the SERVER's own TZ.
//    (Not literally varying process.env.TZ here; see section C for that,
//    which is the test that actually fails against the original defect.)
// ============================================================
{
  const windowsA = getDailySolarWindows(new Date('2026-06-15T00:00:00Z'), 28.6139, 77.209, 330, 'Asia/Kolkata');
  const windowsB = getDailySolarWindows(new Date('2026-06-15T00:00:00Z'), 28.6139, 77.209, 330, 'Asia/Kolkata');
  check('Deterministic: repeated calls with identical inputs produce identical sunrise instant', windowsA.sunrise.getTime() === windowsB.sunrise.getTime());
  check('New Delhi 2026-06-15 sunrise resolves to a valid, non-NaN instant', !Number.isNaN(windowsA.sunrise.getTime()));
}

// ============================================================
// C. Process-TZ invariance -- the test that actually fails against the
//    ORIGINAL (unfixed) `new Date(year, month-1, day, hours, mins, 0)`
//    implementation. Spawns real child processes with different TZ env
//    vars, since a single live process can cache ICU/ambient-TZ state.
// ============================================================
function sunriseUnder(tz: string): string {
  const script = `
    const { getDailySolarWindows } = require('${path.join(__dirname, '..', 'packages', 'astronomy', 'src', 'solarWindows')}');
    const w = getDailySolarWindows(new Date('2026-06-15T00:00:00Z'), 28.6139, 77.209, 330, 'Asia/Kolkata');
    console.log(w.sunrise.toISOString());
  `;
  const out = execFileSync('npx', ['ts-node', '-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, TZ: tz },
  });
  return out.trim();
}

const underUTC = sunriseUnder('UTC');
const underKolkata = sunriseUnder('Asia/Kolkata');
const underNewYork = sunriseUnder('America/New_York');
check(`Process-TZ invariance: TZ=UTC sunrise (${underUTC}) matches TZ=Asia/Kolkata (${underKolkata})`, underUTC === underKolkata);
check(`Process-TZ invariance: TZ=America/New_York sunrise (${underNewYork}) matches TZ=Asia/Kolkata (${underKolkata})`, underNewYork === underKolkata);
check('Corrected New Delhi sunrise under every process TZ is the independently-expected instant (2026-06-14T23:51:00.000Z)', underUTC === '2026-06-14T23:51:00.000Z');

// ============================================================
// D. DST boundary -- America/New_York spring-forward 2026-03-08 (02:00 -> 03:00)
//    and fall-back 2026-11-01 (02:00 -> 01:00). Ordinary conversions on
//    these dates (at non-ambiguous, non-nonexistent times) must still be
//    correct and must not be perturbed by the transition happening
//    elsewhere in the same civil day.
// ============================================================
check(
  // Independently confirmed via wall-clock lookup at candidate UTC instants
  // (not the function under test): 2026-03-08T10:00:00Z reads back as
  // "2026-03-08 06:00" in America/New_York -- i.e. 06:00 local on the
  // spring-forward day is ALREADY past the 02:00->03:00 jump, so it is
  // EDT (UTC-4), not EST.
  'America/New_York spring-forward day (2026-03-08) 06:00 is already EDT (past the 02:00->03:00 jump)',
  localDateTimeToUTC('2026-03-08', '06:00', 'America/New_York').toISOString() === '2026-03-08T10:00:00.000Z'
);
check(
  // Independently confirmed the same way: 2026-11-01T11:00:00Z reads back
  // as "2026-11-01 06:00" -- i.e. 06:00 local on the fall-back day is
  // already past the 02:00->01:00 repeat, so it is EST (UTC-5) again.
  'America/New_York fall-back day (2026-11-01) 06:00 is already EST (past the 02:00->01:00 repeat)',
  localDateTimeToUTC('2026-11-01', '06:00', 'America/New_York').toISOString() === '2026-11-01T11:00:00.000Z'
);
// Nonexistent local time: 2026-03-08 02:30 America/New_York does not exist (clocks jump 02:00->03:00).
// localDateTimeToUTC's documented contract (resolveLocalDateTime) falls back to the legacy
// single-sample behavior for this case rather than throwing -- confirming that EXISTING,
// already-reviewed contract is preserved unchanged by PA-3B (not re-deciding it here).
{
  const nonexistent = localDateTimeToUTC('2026-03-08', '02:30', 'America/New_York');
  check('Nonexistent local time (spring-forward gap) resolves deterministically without throwing', !Number.isNaN(nonexistent.getTime()));
}

// ============================================================
// E. Solar-window non-regression -- the LOCAL clock time of sunrise/sunset/
//    Rahu Kalam/etc. must be unchanged by this fix; only the instant's
//    correct absolute UTC anchoring changed. Confirmed by reading the
//    corrected Date's wall-clock fields back out in the SAME target
//    timezone and checking they match the pre-fix (server-TZ-correct-case)
//    local time for New Delhi under TZ=Asia/Kolkata.
// ============================================================
{
  const windows = getDailySolarWindows(new Date('2026-06-15T00:00:00Z'), 28.6139, 77.209, 330, 'Asia/Kolkata');
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const parts = dtf.formatToParts(windows.sunrise);
  const hh = parts.find((p) => p.type === 'hour')?.value;
  const mm = parts.find((p) => p.type === 'minute')?.value;
  check(`Sunrise local clock time in Asia/Kolkata is still 05:21 (unchanged astronomical formula) -- got ${hh}:${mm}`, Number(hh) === 5 && Number(mm) === 21);
}

// ============================================================
// F. Calendar-feed caller compatibility -- exercises the REAL production
//    formatLocalICSDate() (imported from apps/web/lib/calendarFeedIcs.ts,
//    the same module route.ts's GET handler itself calls -- not reimplemented here)
//    against a Date anchored via localDateTimeToUTC. This is a genuine
//    behavioral assertion, not a tautology: it fails if formatLocalICSDate
//    ever regresses to reading server-local getters (.getDate()/.getHours())
//    instead of the target-timezone-aware Intl path, because the fixture
//    below uses a target timezone (Asia/Kathmandu, +05:45) that disagrees
//    with every plausible CI/server TZ at this specific instant.
// ============================================================
{
  // 2026-06-21 06:00 Asia/Kathmandu -> 2026-06-21T00:15:00.000Z (section A's
  // own independently-verified fixture, reused here as the anchor instant).
  const anchor = localDateTimeToUTC('2026-06-21', '06:00', 'Asia/Kathmandu');
  const formatted = formatLocalICSDate(anchor, 'Asia/Kathmandu');
  check(
    `(F) formatLocalICSDate reads back the correct target-TZ wall-clock time (expected 20260621T060000, got ${formatted})`,
    formatted === '20260621T060000'
  );
}

// ============================================================
// G. AURA PA-3B-R2: mandatory wrong-day regression -- Pacific/Kiritimati
//    (UTC+14, the earliest-dated inhabited timezone on Earth). Confirmed
//    defect: with the calendar-feed route's PRE-R2 server-local
//    `new Date(year, month-1, day, 12, 0, 0)` noon anchor, a user at
//    Kiritimati with `now = 2026-06-15T20:00:00Z` (intended local date
//    2026-06-16) got re-extracted as 2026-06-17 under server TZ=UTC -- a
//    full calendar day wrong, feeding the WRONG day's solar-window
//    calculation into getDailySolarWindows. Fixed by anchoring via
//    localDateTimeToUTC(dateStr, '12:00', timezone) instead -- the same
//    pattern this file's own section A already establishes as correct.
//    Spawned across 3 process TZs (not a single live process) for the
//    same ICU-caching reason section C spawns child processes.
// ============================================================
function kiritimatiNoonUnder(tz: string): { localDate: string; noonIso: string; reExtractedDate: string } {
  // Calls the REAL production computeUserLocalNoon() (exported from
  // apps/web/lib/calendarFeedIcs.ts, imported unchanged by route.ts's GET
  // handler) rather than reimplementing its pattern, so this regression
  // actually exercises the production code PA-3B-R2 changed.
  const script = `
    const { getDatePartsInTimezone } = require('${path.join(__dirname, '..', 'packages', 'panchang', 'src', 'localDate')}');
    const { computeUserLocalNoon } = require('${path.join(__dirname, '..', 'apps', 'web', 'lib', 'calendarFeedIcs')}');
    const timezone = 'Pacific/Kiritimati';
    const now = new Date('2026-06-15T20:00:00Z');
    const localDate = getDatePartsInTimezone(timezone, now);
    const userLocalNoon = computeUserLocalNoon(localDate, timezone);
    const reExtracted = getDatePartsInTimezone(timezone, userLocalNoon);
    console.log(JSON.stringify({ localDate: localDate.dateStr, noonIso: userLocalNoon.toISOString(), reExtractedDate: reExtracted.dateStr }));
  `;
  const out = execFileSync('npx', ['ts-node', '-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, TZ: tz },
  });
  return JSON.parse(out.trim());
}

for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
  const result = kiritimatiNoonUnder(tz);
  check(
    `(G) Kiritimati day preservation under TZ=${tz}: intended date ${result.localDate} stays ${result.localDate} (got noon=${result.noonIso}, re-extracted=${result.reExtractedDate})`,
    result.localDate === '2026-06-16' && result.reExtractedDate === '2026-06-16'
  );
  check(
    `(G) Kiritimati noon anchor under TZ=${tz} is the independently-expected UTC instant (2026-06-15T22:00:00.000Z)`,
    result.noonIso === '2026-06-15T22:00:00.000Z'
  );
}

// ============================================================
// H. Additional date-boundary fixtures -- independently verified via a
//    standalone Intl `timeZoneName: 'longOffset'` extraction (a conversion
//    path with zero code in common with localDateTimeToUTC itself) before
//    being hardcoded here, exactly like section A's own fixtures.
// ============================================================
check(
  'Pacific/Pago_Pago (UTC-11, no DST): 2026-06-21 06:00 -> 2026-06-21T17:00:00.000Z',
  localDateTimeToUTC('2026-06-21', '06:00', 'Pacific/Pago_Pago').toISOString() === '2026-06-21T17:00:00.000Z'
);
check(
  'Australia/Adelaide summer/ACDT (UTC+10:30): 2026-01-15 06:00 -> 2026-01-14T19:30:00.000Z',
  localDateTimeToUTC('2026-01-15', '06:00', 'Australia/Adelaide').toISOString() === '2026-01-14T19:30:00.000Z'
);
check(
  'Australia/Adelaide winter/ACST (UTC+9:30): 2026-07-15 06:00 -> 2026-07-14T20:30:00.000Z',
  localDateTimeToUTC('2026-07-15', '06:00', 'Australia/Adelaide').toISOString() === '2026-07-14T20:30:00.000Z'
);

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log('SOME PA-3B SOLAR WINDOWS TIMEZONE FIX CHECKS FAILED');
  process.exit(1);
} else {
  console.log('ALL PA-3B SOLAR WINDOWS TIMEZONE FIX CHECKS PASSED');
}
