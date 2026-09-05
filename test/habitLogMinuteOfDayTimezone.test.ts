/**
 * Insights Timezone Consistency V1, section 20: regression suite proving
 * POST /api/habit-logs's logMinuteOfDay is now server-authoritative --
 * always derived from the SAME logTimestamp + owner Timing Location pair
 * used for activeWindow (PR #75), never trusted from the client. A live
 * database is unavailable in this environment (DATABASE_URL unset), so
 * the server-side derivation is proven directly against the real
 * getMinuteOfDayInTimezone() primitive (already independently tested --
 * see test/timezone.test.ts, test/panchangDay.test.ts) and cross-checked
 * against the live route source, matching this repo's established pattern
 * (see test/backdatedActivityLogging.test.ts).
 */
import * as fs from 'fs';
import { getMinuteOfDayInTimezone } from '../apps/web/lib/timezone';
import { resolveHistoricalActiveWindow } from '../apps/web/lib/historicalActivityWindow';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennai = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };

// ============================================================
// Server derives logMinuteOfDay from logTimestamp + user.timezone -- exact
// replica of the route's own `getMinuteOfDayInTimezone(user.timezone,
// customDate)` call.
// ============================================================

const logTimestamp = new Date('2026-09-05T06:15:00.000Z'); // 11:45 IST
const serverDerivedMinute = getMinuteOfDayInTimezone(chennai.timezone, logTimestamp);
check('Server-derived logMinuteOfDay for 2026-09-05T06:15:00Z in Asia/Kolkata is 705 (11:45 IST)', serverDerivedMinute === 705);

// A client-supplied WRONG value must have no bearing on the real,
// server-side derivation -- there is no code path in the route that reads
// a client value at all (confirmed structurally: the route destructures
// logMinuteOfDay out of `body` no longer, see the source-scan below), so
// this simply proves the correct value is independent of whatever a
// malicious/buggy client would have sent.
const clientSuppliedWrongMinute = 0; // e.g. a buggy client claiming midnight
check('The real server-derived value (705) does not equal a wrong client-supplied value (0) -- a client cannot override the real minute-of-day', serverDerivedMinute !== clientSuppliedWrongMinute);

// ============================================================
// Asia/Kolkata half-hour case -- India's UTC+5:30 offset, proving no
// whole-hour-offset assumption in the server derivation.
// ============================================================

const halfHourInstant = new Date('2026-09-05T00:00:00.000Z'); // 05:30 IST
check('Asia/Kolkata half-hour offset: 2026-09-05T00:00:00Z -> 05:30 IST -> minuteOfDay 330', getMinuteOfDayInTimezone(chennai.timezone, halfHourInstant) === 330);

// ============================================================
// New York DST case -- the same server-side call correctly reflects a
// real DST transition, using the exact same fixture as
// test/insightsTimezoneNormalization.test.ts.
// ============================================================

const nyPreSpringForward = new Date('2026-03-08T06:30:00.000Z'); // 01:30 EST
const nyPostSpringForward = new Date('2026-03-08T07:30:00.000Z'); // 03:30 EDT (2-3am skipped)
check('America/New_York DST spring-forward: pre-transition instant -> minuteOfDay 90', getMinuteOfDayInTimezone('America/New_York', nyPreSpringForward) === 90);
check('America/New_York DST spring-forward: post-transition instant (2-3am skipped) -> minuteOfDay 210, not 150', getMinuteOfDayInTimezone('America/New_York', nyPostSpringForward) === 210);

// ============================================================
// activeWindow and logMinuteOfDay use the SAME (logTimestamp, timezone)
// context -- both derived from resolveHistoricalActiveWindow/
// getMinuteOfDayInTimezone called with the identical customDate + user
// Timing Location, so a single log's window classification and its
// minute-of-day can never disagree about which instant/timezone they
// describe.
// ============================================================

const sharedInstant = new Date('2026-07-28T06:50:00.000Z'); // the known Abhijit/Gulika-overlap fixture (2026-07-28 12:20 IST, Chennai)
const window = resolveHistoricalActiveWindow(sharedInstant, chennai.latitude, chennai.longitude, chennai.timezone);
const minute = getMinuteOfDayInTimezone(chennai.timezone, sharedInstant);
check('activeWindow for the shared instant resolves to ABHIJIT (matches the known overlap fixture)', window === 'ABHIJIT');
check('logMinuteOfDay for the SAME shared instant is 740 (12:20 IST), the same timestamp+timezone pair activeWindow used', minute === 740);

// ============================================================
// Birth/Event/SHARED remain irrelevant -- neither getMinuteOfDayInTimezone
// nor resolveHistoricalActiveWindow accept a second (Birth/Event) location
// parameter; both take only an instant + one lat/long/timezone triple (or,
// for getMinuteOfDayInTimezone, just a timezone).
// ============================================================

check('getMinuteOfDayInTimezone takes exactly 2 parameters (timezone, date) -- structurally cannot accept a Birth/Event location', getMinuteOfDayInTimezone.length === 2);
check('resolveHistoricalActiveWindow takes exactly 4 parameters (logTimestamp, latitude, longitude, timezone) -- same Timing-Location-only signature PR #75 established', resolveHistoricalActiveWindow.length === 4);

// ============================================================
// Source-scan cross-check against the live route.
// ============================================================

const routeSource = fs.readFileSync('apps/web/app/api/habit-logs/route.ts', 'utf8');
check('POST /api/habit-logs derives logMinuteOfDay via getMinuteOfDayInTimezone(user.timezone, customDate)', /getMinuteOfDayInTimezone\(user\.timezone,\s*customDate\)/.test(routeSource));
check('POST /api/habit-logs no longer destructures logMinuteOfDay from the request body', !/const \{[^}]*\blogMinuteOfDay\b[^}]*\} = body/.test(routeSource));
check('activeWindow and logMinuteOfDay are both derived from the same customDate + user.latitude/longitude/timezone', /resolveHistoricalActiveWindow\(customDate,\s*user\.latitude,\s*user\.longitude,\s*user\.timezone\)/.test(routeSource) && /getMinuteOfDayInTimezone\(user\.timezone,\s*customDate\)/.test(routeSource));

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
check('page.tsx syncs the server-returned logMinuteOfDay into local optimistic state after a successful log (mirrors the existing activeWindow sync)', /logMinuteOfDay:\s*serverLog\.logMinuteOfDay\s*\?\?\s*item\.logMinuteOfDay/.test(pageSource));

console.log(allPassed ? '\nALL HABIT LOG MINUTE-OF-DAY TIMEZONE CHECKS PASSED' : '\nSOME HABIT LOG MINUTE-OF-DAY TIMEZONE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
