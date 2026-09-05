/**
 * Insights Timezone Consistency V1: regression suite for (1) the reflection
 * date write-path default (apps/web/app/api/daily-assistant/reflection/route.ts's
 * getReflectionDate()) and (2) the reflection <-> HabitLog day join
 * (apps/web/app/api/daily-assistant/insights/route.ts). Both are private,
 * inline route functions (not exported), so -- matching this repo's
 * established pattern for testing inline route logic without a live server
 * (see test/insightsAlignmentComparison.test.ts, test/eventLocationAuraMomentPersistence.test.ts)
 * -- their exact logic is replicated here and cross-checked against the
 * live route source at the bottom.
 */
import * as fs from 'fs';
import { getDatePartsInTimezone } from '../apps/web/lib/timezone';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// Exact replica of reflection/route.ts's getReflectionDate().
function getReflectionDate(rawDate: string | null | undefined, timezone: string, now: Date): Date {
  const dateKey = rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : getDatePartsInTimezone(timezone, now).dateStr;
  return new Date(`${dateKey}T00:00:00.000Z`);
}

// ============================================================
// A/B. Asia/Kolkata UTC-crossover -- a reflection submitted at 00:30 IST
// (2026-09-04T19:00:00Z, the PREVIOUS UTC calendar day) must be dated
// 2026-09-05 (the real IST "today"), not 2026-09-04 (the old server-UTC
// fallback's answer).
// ============================================================

const kolkataNow = new Date('2026-09-04T19:00:00.000Z'); // 00:30 IST on 2026-09-05
const kolkataReflection = getReflectionDate(null, 'Asia/Kolkata', kolkataNow);
check('Asia/Kolkata: a reflection submitted at 00:30 IST gets dated 2026-09-05 (Timing-Location today), not 2026-09-04 (server-UTC today)', kolkataReflection.toISOString().slice(0, 10) === '2026-09-05');

const oldServerUtcFallback = new Date(`${kolkataNow.toISOString().slice(0, 10)}T00:00:00.000Z`);
check('Sanity check: the OLD server-UTC fallback would have produced the wrong date (2026-09-04), confirming this is a genuine fix, not a no-op', oldServerUtcFallback.toISOString().slice(0, 10) === '2026-09-04');

// ============================================================
// C. America/Los_Angeles -- the OPPOSITE-side crossover: a reflection
// submitted in the evening Pacific time is still the SAME UTC calendar
// date, but must resolve to the correct Pacific "today", not silently
// drift a day ahead the way a naive UTC-based fallback would for anyone
// checking near UTC midnight.
// ============================================================

const laEveningNow = new Date('2026-09-05T04:30:00.000Z'); // 21:30 PDT on 2026-09-04 (UTC date is already 09-05)
const laReflection = getReflectionDate(null, 'America/Los_Angeles', laEveningNow);
check('America/Los_Angeles: a reflection submitted at 21:30 PDT (UTC date already 2026-09-05) gets dated 2026-09-04 (the real Pacific today), not 2026-09-05 (server-UTC today)', laReflection.toISOString().slice(0, 10) === '2026-09-04');

// ============================================================
// D. Explicit valid body.date remains authoritative -- unchanged contract.
// ============================================================

const explicitDate = getReflectionDate('2026-01-15', 'Asia/Kolkata', new Date('2026-09-05T12:00:00.000Z'));
check('Explicit valid body.date ("2026-01-15") remains authoritative regardless of `now` or timezone', explicitDate.toISOString().slice(0, 10) === '2026-01-15');

// ============================================================
// E. Invalid body.date falls back safely to Timing-Location today (not a
// crash, not a garbage date).
// ============================================================

const invalidDateFallback = getReflectionDate('not-a-date', 'Asia/Kolkata', new Date('2026-09-05T12:00:00.000Z'));
check('Invalid body.date ("not-a-date") falls back to Timing-Location today (2026-09-05), fail-safe rather than crashing or storing garbage', invalidDateFallback.toISOString().slice(0, 10) === '2026-09-05');

const malformedShapeFallback = getReflectionDate('2026/09/05', 'Asia/Kolkata', new Date('2026-09-05T12:00:00.000Z'));
check('A wrongly-shaped date ("2026/09/05", not YYYY-MM-DD) also falls back to Timing-Location today, not a mis-parsed date', malformedShapeFallback.toISOString().slice(0, 10) === '2026-09-05');

// ============================================================
// F/G/H. Reflection <-> HabitLog join -- exact replica of
// insights/route.ts's logsByDay/dateKey logic.
// ============================================================

function logDateKey(logTimestamp: Date, timezone: string): string {
  return getDatePartsInTimezone(timezone, logTimestamp).dateStr;
}
function reflectionDateKey(reflectionDate: Date): string {
  return reflectionDate.toISOString().slice(0, 10);
}

// F/G. A log at 00:30 IST (previous UTC day) and a reflection stored for
// the SAME IST calendar day must join correctly.
const lateNightLog = new Date('2026-09-04T19:00:00.000Z'); // 00:30 IST, 2026-09-05
const sameDayReflection = new Date('2026-09-05T00:00:00.000Z'); // encodes calendar date 2026-09-05
check('F/G. Adjacent UTC day but same Timing-Location day: a 00:30 IST log and a 2026-09-05 reflection join correctly', logDateKey(lateNightLog, 'Asia/Kolkata') === reflectionDateKey(sameDayReflection));

// H. A log and a reflection that share the same UTC calendar date but
// resolve to DIFFERENT Timing-Location days (the log is right after IST
// midnight, so it belongs to the NEXT calendar day, not the reflection's)
// must NOT be joined.
const logSharingUtcDayOnly = new Date('2026-09-05T01:00:00.000Z'); // 06:30 IST, 2026-09-05 -- same IST day as above, still 09-05
// Construct a genuine same-UTC-day/different-IST-day pair: a log just
// before IST midnight (still 2026-09-04 IST) vs. a reflection dated
// 2026-09-05, both instants falling on UTC date 2026-09-04.
const justBeforeIstMidnight = new Date('2026-09-04T18:00:00.000Z'); // 23:30 IST, still 2026-09-04
const nextDayReflection = new Date('2026-09-05T00:00:00.000Z'); // 2026-09-05
check(
  'H. Same UTC calendar date (2026-09-04) but different Timing-Location days: a 23:30 IST log (still 2026-09-04 IST) does NOT join to a 2026-09-05 reflection',
  logDateKey(justBeforeIstMidnight, 'Asia/Kolkata') !== reflectionDateKey(nextDayReflection)
);
check('H (control): that same log DOES correctly join its own actual day (2026-09-04)', logDateKey(justBeforeIstMidnight, 'Asia/Kolkata') === '2026-09-04');

// ============================================================
// Source-scan cross-check against the live routes.
// ============================================================

const reflectionRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/reflection/route.ts', 'utf8');
check('reflection/route.ts fetches the owner user (getUserById) for their Timing Location', /getUserById\(session\.userId\)/.test(reflectionRouteSource));
check('reflection/route.ts\'s getReflectionDate fallback uses getDatePartsInTimezone(timezone, now), not new Date().toISOString()', /getDatePartsInTimezone\(timezone, now\)\.dateStr/.test(reflectionRouteSource));
// Strip block comments first -- the route's own doc comment legitimately
// mentions the OLD `new Date().toISOString().slice(0,10)` fallback in
// prose to explain what was fixed; that must not read as surviving code.
const reflectionRouteSourceNoComments = reflectionRouteSource.replace(/\/\*[\s\S]*?\*\//g, '');
check('reflection/route.ts no longer has the old server-UTC fallback (new Date().toISOString().slice(0,10)) as live code', !/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(reflectionRouteSourceNoComments));
check('reflection/route.ts still validates an explicit rawDate against the YYYY-MM-DD shape before trusting it', /\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//.test(reflectionRouteSource));

const insightsRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/insights/route.ts', 'utf8');
check('insights/route.ts fetches the owner user (getUserById) for their Timing Location', /getUserById\(session\.userId\)/.test(insightsRouteSource));
check('insights/route.ts buckets the log side of the join via getDatePartsInTimezone(user.timezone, ...), not a UTC slice', /getDatePartsInTimezone\(user\.timezone,\s*new Date\(log\.logTimestamp\)\)\.dateStr/.test(insightsRouteSource));
check('insights/route.ts still decodes the reflection side via reflectionDate.toISOString().slice(0,10) (a semantic-value decode, not a UTC reinterpretation -- see the route\'s own doc comment)', /new Date\(reflection\.reflectionDate\)\.toISOString\(\)\.slice\(0,\s*10\)/.test(insightsRouteSource));

console.log(allPassed ? '\nALL REFLECTION TIMEZONE CHECKS PASSED' : '\nSOME REFLECTION TIMEZONE CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
