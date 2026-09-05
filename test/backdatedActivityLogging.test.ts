/**
 * Insights Correctness + Historical Integrity V1, finding #1: regression
 * suite for resolveHistoricalActiveWindow() (apps/web/lib/historicalActivityWindow.ts)
 * and the POST /api/habit-logs route's server-side-authoritative use of it.
 *
 * No new Panchang/solar math is tested here -- these checks confirm the new
 * function correctly COMPOSES the existing canonical primitives
 * (computeSolarEphemeris, computePanchangWindows, getActiveWindow), reusing
 * the exact same real fixture test/panchangDay.test.ts and
 * test/windowOverlap.test.ts already established (2026-07-28, Chennai:
 * BRAHMA 04:16-05:04, YAMA 09:04-10:40, ABHIJIT 11:50-12:42,
 * GULIKA 12:16-13:51 IST -- Abhijit/Gulika genuinely overlap 12:16-12:42),
 * rather than re-deriving window boundaries independently.
 *
 * A live database is unavailable in this environment (DATABASE_URL unset),
 * so the POST route's own end-to-end persistence is verified by direct
 * source inspection (recorded below), matching this repo's established
 * pattern (see test/eventLocationAuraMomentPersistence.test.ts).
 */
import * as fs from 'fs';
import { resolveHistoricalActiveWindow } from '../apps/web/lib/historicalActivityWindow';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennai = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };
const newYork = { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };

// ============================================================
// Known-window storage: each canonical window type is correctly identified
// for a genuinely-past instant on the fixture date (2026-07-28, Chennai).
// ============================================================

check(
  'BRAHMA: 2026-07-28 04:30 IST (2026-07-27T23:00:00Z) resolves to BRAHMA',
  resolveHistoricalActiveWindow(new Date('2026-07-27T23:00:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'BRAHMA'
);
check(
  'YAMA: 2026-07-28 09:30 IST (2026-07-28T04:00:00Z) resolves to YAMA',
  resolveHistoricalActiveWindow(new Date('2026-07-28T04:00:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'YAMA'
);
check(
  'ABHIJIT (before Gulika overlap begins): 2026-07-28 11:55 IST (2026-07-28T06:25:00Z) resolves to ABHIJIT',
  resolveHistoricalActiveWindow(new Date('2026-07-28T06:25:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'ABHIJIT'
);
check(
  'GULIKA (after Abhijit ends): 2026-07-28 13:00 IST (2026-07-28T07:30:00Z) resolves to GULIKA',
  resolveHistoricalActiveWindow(new Date('2026-07-28T07:30:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'GULIKA'
);
check(
  'RAHU_KALAM: 2026-07-28 16:00 IST (2026-07-28T10:30:00Z) resolves to RAHU_KALAM',
  resolveHistoricalActiveWindow(new Date('2026-07-28T10:30:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'RAHU_KALAM'
);

// ============================================================
// Genuinely-neutral instant still stores NEUTRAL -- proves this is not a
// blanket "never NEUTRAL" fix; a real gap between windows still resolves to
// NEUTRAL, matching getActiveWindow's own fallback.
// ============================================================

check(
  'Genuinely neutral instant (2026-07-28 07:00 IST, between Brahma and Yama) resolves to NEUTRAL',
  resolveHistoricalActiveWindow(new Date('2026-07-28T01:30:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'NEUTRAL'
);
check(
  'Genuinely neutral instant (2026-07-28 14:30 IST, between Gulika and Rahu Kalam) resolves to NEUTRAL',
  resolveHistoricalActiveWindow(new Date('2026-07-28T09:00:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'NEUTRAL'
);

// ============================================================
// Rahu/Yama/Abhijit/Gulika overlap precedence matches canonical --
// 2026-07-28 12:20 IST falls inside BOTH Abhijit (11:50-12:42) and Gulika
// (12:16-13:51), the same real overlap test/windowOverlap.test.ts and
// test/panchangDay.test.ts already confirm exists. getActiveWindow's own
// array-order precedence (brahma, abhijit, rahuKalam, gulikaKalam,
// yamaGandam -- unmodified by this PR) means Abhijit must win, never
// reimplemented or second-guessed here.
// ============================================================

check(
  'Overlap precedence: 2026-07-28 12:20 IST (inside both Abhijit and Gulika) resolves to ABHIJIT, matching getActiveWindow\'s existing array-order precedence, never GULIKA',
  resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone) === 'ABHIJIT'
);

// ============================================================
// Historical timestamp is used, not wall-clock -- calling with a fixed past
// logTimestamp produces the SAME deterministic result regardless of when
// this test process actually runs (today's real date is nowhere close to
// 2026-07-28). Structurally confirmed too: the source contains no bare
// `new Date()` / `Date.now()` call that would read the execution-time clock.
// ============================================================

const firstCall = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
const secondCallSameHistoricalInstant = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
check('Same historical logTimestamp always resolves identically, independent of when the code actually runs', firstCall === secondCallSameHistoricalInstant && firstCall === 'ABHIJIT');

const helperSource = fs.readFileSync('apps/web/lib/historicalActivityWindow.ts', 'utf8');
check('resolveHistoricalActiveWindow never reads the execution-time clock (no bare new Date()/Date.now())', !/(?<!logTimestamp[^;]*)\bDate\.now\(\)/.test(helperSource) && !/new Date\(\)/.test(helperSource));

// ============================================================
// Timing Location timezone is used -- the SAME UTC instant, evaluated
// against two different Timing Locations, produces different results
// (proves the computation is genuinely location/timezone-driven, not a
// single universal answer that happens to ignore its own parameters).
// ============================================================

const chennaiResult = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
const newYorkResult = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), newYork.latitude, newYork.longitude, newYork.timezone);
check('The same UTC instant resolves to different windows for different Timing Locations (Chennai vs New York) -- genuinely location-driven', chennaiResult !== newYorkResult);

// ============================================================
// Browser timezone is irrelevant -- the executing process's own TZ
// environment variable must not influence the result at all, since every
// primitive resolveHistoricalActiveWindow composes takes an explicit IANA
// timezone via Intl.DateTimeFormat({ timeZone }) rather than reading the
// ambient/local zone.
// ============================================================

const originalProcessTz = process.env.TZ;
try {
  process.env.TZ = 'America/Los_Angeles';
  const resultWithLaProcessTz = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
  process.env.TZ = 'Asia/Kolkata';
  const resultWithKolkataProcessTz = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
  process.env.TZ = 'Pacific/Auckland';
  const resultWithAucklandProcessTz = resolveHistoricalActiveWindow(new Date('2026-07-28T06:50:00.000Z'), chennai.latitude, chennai.longitude, chennai.timezone);
  check(
    'The process/browser TZ environment has zero effect on the result -- identical across America/Los_Angeles, Asia/Kolkata, and Pacific/Auckland process TZs',
    resultWithLaProcessTz === 'ABHIJIT' && resultWithKolkataProcessTz === 'ABHIJIT' && resultWithAucklandProcessTz === 'ABHIJIT'
  );
} finally {
  if (originalProcessTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalProcessTz;
}

// ============================================================
// Birth/Event Location are irrelevant -- resolveHistoricalActiveWindow's
// signature structurally accepts ONLY logTimestamp + one lat/long/timezone
// triple (the caller's Timing Location); there is no second location
// parameter it could even accidentally read a Birth or Event Location from.
// ============================================================

check('resolveHistoricalActiveWindow takes exactly 4 parameters (logTimestamp, latitude, longitude, timezone) -- structurally cannot accept a second (Birth/Event) location', resolveHistoricalActiveWindow.length === 4);
check('resolveHistoricalActiveWindow\'s source never references a birth-location or event-location identifier', !/birth[A-Z]|eventLocation/.test(helperSource));

// ============================================================
// Route wiring -- POST /api/habit-logs computes activeWindow server-side
// from the OWNER'S OWN Timing Location (user.latitude/longitude/timezone),
// never a client-supplied value, never Birth/Event Location fields.
// Verified by direct source inspection (no live DB in this environment).
// ============================================================

const habitLogsRouteSource = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
check(
  'POST /api/habit-logs computes activeWindow via resolveHistoricalActiveWindow(customDate, user.latitude, user.longitude, user.timezone) -- the owner\'s own Timing Location',
  /resolveHistoricalActiveWindow\(customDate,\s*user\.latitude,\s*user\.longitude,\s*user\.timezone\)/.test(habitLogsRouteSource)
);
check('POST /api/habit-logs never destructures or trusts a client-supplied activeWindow field from the request body', !/const \{[^}]*\bactiveWindow\b[^}]*\} = body/.test(habitLogsRouteSource));
check('POST /api/habit-logs fetches the owner user record (for their Timing Location) via getUserById, not a client-supplied location', /getUserById\(session\.userId\)/.test(habitLogsRouteSource));

const pastActivityModalSource = fs.readFileSync('apps/web/components/PastActivityModal.tsx', 'utf8');
check('PastActivityModal.tsx no longer sends any hardcoded activeWindow: \'NEUTRAL\' payload field', !/activeWindow:\s*'NEUTRAL'/.test(pastActivityModalSource));

console.log(allPassed ? '\nALL BACKDATED ACTIVITY LOGGING CHECKS PASSED' : '\nSOME BACKDATED ACTIVITY LOGGING CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
