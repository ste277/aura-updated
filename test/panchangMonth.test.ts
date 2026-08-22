import { getMonthOfPanchangSummaries } from '../packages/panchang/src/panchangDay';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennai = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };
const newYork = { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };

// ============================================================
// MONTH API (domain layer: getMonthOfPanchangSummaries, exactly what the
// route delegates to)
// ============================================================

check('31-day month (August) returns 31 summaries', getMonthOfPanchangSummaries({ year: 2026, month: 8, ...chennai }).length === 31);
check('30-day month (September) returns 30 summaries', getMonthOfPanchangSummaries({ year: 2026, month: 9, ...chennai }).length === 30);
check('28-day February (non-leap, 2026) returns 28 summaries', getMonthOfPanchangSummaries({ year: 2026, month: 2, ...chennai }).length === 28);
check('29-day February (leap year, 2028) returns 29 summaries', getMonthOfPanchangSummaries({ year: 2028, month: 2, ...chennai }).length === 29);
check('2028 is actually a leap year (test premise check)', new Date(2028, 1, 29).getMonth() === 1);
check('2026 is actually not a leap year (test premise check)', new Date(2026, 1, 29).getMonth() === 2);

const augustSummaries = getMonthOfPanchangSummaries({ year: 2026, month: 8, ...chennai });
check('No duplicate dates in a month\'s summaries', new Set(augustSummaries.map((d) => d.date)).size === augustSummaries.length);
check('Every date 2026-08-01 .. 2026-08-31 is present exactly once, in order', augustSummaries.every((d, i) => d.date === `2026-08-${String(i + 1).padStart(2, '0')}`));
check('First summary is the 1st of the month', augustSummaries[0].date === '2026-08-01');
check('Last summary is the last day of the month', augustSummaries[augustSummaries.length - 1].date === '2026-08-31');

// Local timezone month boundaries: a UTC- timezone (New York) should still
// produce exactly the calendar dates of the requested month, not shifted by
// the offset (e.g. Aug 1 local should not appear as Jul 31 or Aug 2).
const newYorkAugust = getMonthOfPanchangSummaries({ year: 2026, month: 8, ...newYork });
check('New York (UTC-4/-5) August still has exactly 31 dates, Aug 01..31, no boundary shift', newYorkAugust.length === 31 && newYorkAugust[0].date === '2026-08-01' && newYorkAugust[30].date === '2026-08-31');

// User location resolution: two different locations produce independently
// correct summaries for the same month (different Vara ordering start point
// is identical since Vara is location-independent, but confirms both resolve).
check('User location resolution: Chennai and New York summaries are both well-formed for the same month', augustSummaries.every((d) => d.vara.length > 0) && newYorkAugust.every((d) => d.vara.length > 0));

// Invalid month/year
check('Month 0 throws', (() => { try { getMonthOfPanchangSummaries({ year: 2026, month: 0, ...chennai }); return false; } catch { return true; } })());
check('Month 13 throws', (() => { try { getMonthOfPanchangSummaries({ year: 2026, month: 13, ...chennai }); return false; } catch { return true; } })());
check('Non-integer month throws', (() => { try { getMonthOfPanchangSummaries({ year: 2026, month: 8.5, ...chennai }); return false; } catch { return true; } })());

// Each summary carries the lightweight fields, not a full PanchangDay.
const sample = augustSummaries[14];
check('Summary carries date/vara/tithi.name/nakshatra.name', typeof sample.date === 'string' && typeof sample.vara === 'string' && typeof sample.tithi.name === 'string' && typeof sample.nakshatra.name === 'string');
check('Summary carries notableWindows with hasAbhijit/hasBrahma/cautionCount', typeof sample.notableWindows.hasAbhijit === 'boolean' && typeof sample.notableWindows.hasBrahma === 'boolean' && typeof sample.notableWindows.cautionCount === 'number');
check('Summary does NOT carry the full windows array or solar times (lightweight, not a full PanchangDay)', !('windows' in sample) && !('solar' in sample) && !('location' in sample));

// moonPhaseMarker: over a full month, Purnima and Amavasya should each occur
// close to once (lunar month ~29.5 days vs calendar month ~30-31 days).
const fullMoons = augustSummaries.filter((d) => d.moonPhaseMarker === 'FULL_MOON');
const newMoons = augustSummaries.filter((d) => d.moonPhaseMarker === 'NEW_MOON');
check('At most one FULL_MOON marker in a calendar month', fullMoons.length <= 1);
check('At most one NEW_MOON marker in a calendar month', newMoons.length <= 1);
check('moonPhaseMarker is undefined on ordinary days (not every day is marked)', augustSummaries.filter((d) => d.moonPhaseMarker === undefined).length >= 27);

console.log(allPassed ? '\nALL PANCHANG MONTH CHECKS PASSED' : '\nSOME PANCHANG MONTH CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
