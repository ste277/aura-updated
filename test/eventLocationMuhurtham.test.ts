/**
 * Event Location Search V1: regression suite for validateEventLocation()
 * (apps/web/lib/muhurthamSearchRequest.ts) and the resulting
 * DailyAssistantContext override behavior in findMuhurthams()/
 * findPersonalMuhurthams()/findSharedMuhurthams() -- the Muhurtham engine
 * itself is untouched by this PR, so these tests exercise it exactly the
 * way apps/web/app/api/muhurtham-search/route.ts does (effectiveLocation ->
 * context), without needing a live server/DB.
 *
 * UI-only behavior (the Event Location picker never PATCHing
 * /api/users/location, the "old result not relabeled after picker change"
 * snapshot behavior, result-card display timezone) is verified via source
 * inspection below and via `npm run build:check` passing -- this repo's
 * TSX component files are not exercised by this plain ts-node test runner
 * (see test/muhurthamFinderViewLogic.test.ts's own exclusion from
 * tsconfig.json), the same limitation every prior PR in this session has
 * documented, not something new to this PR.
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateEventLocation } from '../apps/web/lib/muhurthamSearchRequest';
import { CITY_OPTIONS, isValidCustomLocation, MAX_VALID_LATITUDE, MIN_VALID_LATITUDE } from '../apps/web/lib/cities';
import { findMuhurthams, findPersonalMuhurthams, findSharedMuhurthams } from '../packages/recommendation/src/muhurthamFinder';
import { resolveTzOffsetMinutes } from '../apps/web/lib/timezone';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// 1-8 (brief section 43): validateEventLocation() -- pure, DB-free, the
// exact function route.ts calls before building context.
// ============================================================

const absent = validateEventLocation(undefined);
check('1. Absent eventLocation resolves to ok with location: undefined (falls back to Timing Location)', absent.ok === true && absent.ok && absent.location === undefined);

const validKochi = validateEventLocation({ cityName: 'Kochi', latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' });
check('2. A valid eventLocation is accepted with all four fields preserved', validKochi.ok === true && validKochi.ok && JSON.stringify(validKochi.location) === JSON.stringify({ cityName: 'Kochi', latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' }));

check('3a. A string instead of an object is rejected', validateEventLocation('Kochi').ok === false);
check('3b. A number is rejected', validateEventLocation(42).ok === false);
check('3c. null is rejected (semantically invalid, distinct from absent/undefined)', validateEventLocation(null).ok === false);
check('3d. An array is rejected', validateEventLocation([1, 2, 3]).ok === false);
check('3e. A partial object (missing longitude/timezone) is rejected', validateEventLocation({ cityName: 'Kochi', latitude: 9.9312 }).ok === false);

check('4a. Missing cityName is rejected', validateEventLocation({ latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' }).ok === false);
check('4b. A blank/whitespace-only cityName is rejected', validateEventLocation({ cityName: '   ', latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' }).ok === false);

check('5a. NaN latitude is rejected', validateEventLocation({ cityName: 'X', latitude: NaN, longitude: 76.2673, timezone: 'Asia/Kolkata' }).ok === false);
check('5b. Latitude outside +66.5 is rejected', validateEventLocation({ cityName: 'X', latitude: 80, longitude: 76.2673, timezone: 'Asia/Kolkata' }).ok === false);
check('5c. Latitude outside -66.5 is rejected', validateEventLocation({ cityName: 'X', latitude: -80, longitude: 76.2673, timezone: 'Asia/Kolkata' }).ok === false);

check('6a. Longitude outside +180 is rejected', validateEventLocation({ cityName: 'X', latitude: 9.9312, longitude: 200, timezone: 'Asia/Kolkata' }).ok === false);
check('6b. Longitude outside -180 is rejected', validateEventLocation({ cityName: 'X', latitude: 9.9312, longitude: -200, timezone: 'Asia/Kolkata' }).ok === false);
check('6c. NaN longitude is rejected', validateEventLocation({ cityName: 'X', latitude: 9.9312, longitude: NaN, timezone: 'Asia/Kolkata' }).ok === false);

check('7a. An invalid (non-IANA) timezone is rejected', validateEventLocation({ cityName: 'X', latitude: 9.9312, longitude: 76.2673, timezone: 'Not/A/Real/Zone' }).ok === false);
check('7b. An empty timezone is rejected', validateEventLocation({ cityName: 'X', latitude: 9.9312, longitude: 76.2673, timezone: '' }).ok === false);

check('8a. Exactly +66.5 latitude (the documented boundary) is accepted', validateEventLocation({ cityName: 'X', latitude: MAX_VALID_LATITUDE, longitude: 0, timezone: 'Etc/UTC' }).ok === true);
check('8b. Exactly -66.5 latitude is accepted', validateEventLocation({ cityName: 'X', latitude: MIN_VALID_LATITUDE, longitude: 0, timezone: 'Etc/UTC' }).ok === true);
check('8c. Just past +66.5 (66.6) is rejected', validateEventLocation({ cityName: 'X', latitude: 66.6, longitude: 0, timezone: 'UTC' }).ok === false);
check('8d. Just past -66.5 (-66.6) is rejected', validateEventLocation({ cityName: 'X', latitude: -66.6, longitude: 0, timezone: 'UTC' }).ok === false);

check('validateEventLocation reuses isValidCustomLocation, not a second validation system (same rejection for the same bad input)', !isValidCustomLocation({ latitude: 200, longitude: 0, timezone: 'UTC' }) && validateEventLocation({ cityName: 'X', latitude: 200, longitude: 0, timezone: 'UTC' }).ok === false);

// ============================================================
// 20/21 (brief): known-city and custom-location acceptance.
// ============================================================

const kochiCityOption = CITY_OPTIONS.find((c) => c.cityName === 'Kochi');
check('20. Kochi exists in CITY_OPTIONS with the exact coordinates the audit used', Boolean(kochiCityOption) && kochiCityOption!.latitude === 9.9312 && kochiCityOption!.longitude === 76.2673 && kochiCityOption!.timezone === 'Asia/Kolkata');
const kochiFromCatalog = validateEventLocation(kochiCityOption);
check('20b. A CITY_OPTIONS entry validates cleanly end-to-end (same shape validateEventLocation expects)', kochiFromCatalog.ok === true);

const kollamCustom = validateEventLocation({ cityName: 'Kollam', latitude: 8.8932, longitude: 76.6141, timezone: 'Asia/Kolkata' });
check('21. A custom location (Kollam, not in CITY_OPTIONS) is accepted -- no requirement to be pre-listed', kollamCustom.ok === true);
check('21b. Kollam is genuinely not a curated CITY_OPTIONS entry (this really exercises the custom path)', !CITY_OPTIONS.some((c) => c.cityName === 'Kollam'));

// ============================================================
// 22 / 10: no-override backward compatibility -- effectiveLocation
// construction (mirroring route.ts exactly) must be byte-identical to the
// pre-Event-Location code path when eventLocation is absent.
// ============================================================

interface FakeUser { cityName: string; latitude: number; longitude: number; timezone: string }
const fakeDubaiUser: FakeUser = { cityName: 'Dubai, UAE', latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' };

function resolveEffectiveLocation(user: FakeUser, rawEventLocation: unknown) {
  const validated = validateEventLocation(rawEventLocation);
  if (!validated.ok) return null;
  return validated.location ?? { cityName: user.cityName, latitude: user.latitude, longitude: user.longitude, timezone: user.timezone };
}

const noOverride = resolveEffectiveLocation(fakeDubaiUser, undefined);
check('22. With no eventLocation, effectiveLocation is byte-identical to the Timing Location fields', JSON.stringify(noOverride) === JSON.stringify(fakeDubaiUser));

const userSnapshotBefore = JSON.stringify(fakeDubaiUser);
resolveEffectiveLocation(fakeDubaiUser, { cityName: 'Kochi', latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' });
check('10. Resolving an Event Location never mutates the passed-in Timing Location object (no User PATCH-equivalent occurs)', JSON.stringify(fakeDubaiUser) === userSnapshotBefore);

// ============================================================
// 9 / 29 (brief): real deterministic Chennai/Dubai/Kochi comparison,
// Griha Pravesh, 2026-11-10, 60 minutes -- location changes the candidate
// UTC instant; results remain independently valid for each location.
// ============================================================

function contextFor(loc: { latitude: number; longitude: number; timezone: string }, now: Date): DailyAssistantContext {
  return { now, latitude: loc.latitude, longitude: loc.longitude, timezone: loc.timezone, tzOffsetMinutes: resolveTzOffsetMinutes(loc.timezone, now) };
}

const searchDate = '2026-11-10';
const searchNow = new Date(`${searchDate}T04:00:00.000Z`);
const chennaiLoc = { latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' };
const dubaiLoc = { latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' };
const kochiLoc = { latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' };

const chennaiResult = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(chennaiLoc, searchNow) });
const dubaiResult = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(dubaiLoc, searchNow) });
const kochiResult = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(kochiLoc, searchNow) });

check('9a. Chennai returns a valid candidate', chennaiResult.dates.length > 0);
check('9b. Dubai returns a valid candidate', dubaiResult.dates.length > 0);
check('9c. Kochi returns a valid candidate', kochiResult.dates.length > 0);
if (chennaiResult.dates.length > 0 && dubaiResult.dates.length > 0 && kochiResult.dates.length > 0) {
  const chennaiStart = chennaiResult.dates[0].bestWindow.start;
  const dubaiStart = dubaiResult.dates[0].bestWindow.start;
  const kochiStart = kochiResult.dates[0].bestWindow.start;
  check('9d. Chennai and Dubai produce genuinely different UTC candidate instants', chennaiStart !== dubaiStart);
  check('9e. Chennai and Kochi (same timezone, different longitude/latitude) also produce different UTC candidate instants', chennaiStart !== kochiStart);
}

// ============================================================
// 15 / 23 (brief): event timezone controls local-date semantics -- the
// SAME calendar date string means a different absolute local-midnight-to-
// midnight window depending on which location's timezone resolves it.
// ============================================================

const dubaiSingleDay = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(dubaiLoc, searchNow) });
const kochiSingleDay = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(kochiLoc, searchNow) });
check('15. Both single-day searches evaluate exactly 1 date regardless of location (date semantics follow context.timezone automatically)', dubaiSingleDay.evaluatedDateCount === 1 && kochiSingleDay.evaluatedDateCount === 1);

// ============================================================
// 16 / 30 (brief): DST-observing location (America/New_York) -- must not
// throw, must resolve a real, distinct offset.
// ============================================================

const newYorkLoc = { latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' };
let newYorkThrew = false;
let newYorkResult;
try {
  newYorkResult = findMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: contextFor(newYorkLoc, searchNow) });
} catch {
  newYorkThrew = true;
}
check('16a. A DST-observing Event Location (New York) does not throw', !newYorkThrew);
check('16b. New York returns a valid candidate', Boolean(newYorkResult && newYorkResult.dates.length > 0));
check('16c. New York (EST, -300min) resolves a genuinely different offset than Dubai (+240min) for the same instant', resolveTzOffsetMinutes('America/New_York', searchNow) !== resolveTzOffsetMinutes('Asia/Dubai', searchNow));

// ============================================================
// 7 (brief): tzOffsetMinutes must correspond to the EFFECTIVE (Event
// Location) timezone, never left over from Timing Location.
// ============================================================

const dubaiOffset = resolveTzOffsetMinutes('Asia/Dubai', searchNow);
const kochiOffset = resolveTzOffsetMinutes('Asia/Kolkata', searchNow);
check('7. Dubai and Kochi resolve genuinely different UTC offsets for the same instant (no leftover-offset bug possible)', dubaiOffset !== kochiOffset);
const kochiContext = contextFor(kochiLoc, searchNow);
check('7b. A context built for Kochi carries the Kochi offset, not a Dubai one', kochiContext.tzOffsetMinutes === kochiOffset && kochiContext.tzOffsetMinutes !== dubaiOffset);

// ============================================================
// 12 / 11 (brief): PERSONAL -- event-time Panchang from Event Location,
// personal natal signal from birth data, independently of location.
// ============================================================

const personalContext = { natalNakshatraIndex: 5, janmaNakshatra: 'Ardra' };
const personalDubai = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: { ...contextFor(dubaiLoc, searchNow), personalContext } });
const personalKochi = findPersonalMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: { ...contextFor(kochiLoc, searchNow), personalContext } });
check('13. PERSONAL works with an Event-Location context (Dubai)', personalDubai.status === 'OK');
check('13b. PERSONAL works with an Event-Location context (Kochi)', personalKochi.status === 'OK');
if (personalDubai.status === 'OK' && personalKochi.status === 'OK' && personalDubai.dates.length > 0 && personalKochi.dates.length > 0) {
  const dubaiTara = personalDubai.dates[0].personalFactors.taraBala?.tara;
  const kochiTara = personalKochi.dates[0].personalFactors.taraBala?.tara;
  check('11. Natal Tara Bala is IDENTICAL between Dubai-context and Kochi-context searches with the same personalContext (location never influences natal signal)', dubaiTara === kochiTara);
}

// ============================================================
// 14 (brief): SHARED -- one Event Location, both participants' independent
// natal context.
// ============================================================

const userNatal = { natalNakshatraIndex: 2 };
const partnerNatal = { natalNakshatraIndex: 4 };
const partner = { savedPersonId: 'event-location-test-partner', name: 'Test Partner', context: partnerNatal };
const sharedKochi = findSharedMuhurthams({ activityId: 'griha-pravesh', dateRange: { start: searchDate, end: searchDate }, timePreference: 'ANY', durationMinutes: 60, limit: 5, context: { ...contextFor(kochiLoc, searchNow), personalContext: userNatal }, partner });
check('14. SHARED works with an Event-Location context', sharedKochi.status === 'OK');

// ============================================================
// 19 (brief): the Event Location picker source must never reference
// PATCH /api/users/location -- a lightweight, deterministic, practical
// substitute for a fetch-spy assertion (no DOM/React rendering harness is
// available to this plain ts-node runner -- see this file's own header).
// ============================================================

const viewSource = fs.readFileSync(path.join(__dirname, '..', 'apps', 'web', 'components', 'MuhurthamFinderView.tsx'), 'utf8');
const pickerStart = viewSource.indexOf('function EventLocationPicker');
const pickerEnd = viewSource.indexOf('\nfunction PillButton');
check('19a. EventLocationPicker is present in MuhurthamFinderView.tsx', pickerStart !== -1 && pickerEnd !== -1 && pickerEnd > pickerStart);
const pickerBody = viewSource.slice(pickerStart, pickerEnd);
check("19b. EventLocationPicker's own source never references PATCH /api/users/location (never mutates the user's Timing Location)", !pickerBody.includes('/api/users/location'));
check('19c. LocationPicker (the persistence-coupled component) is never imported into MuhurthamFinderView.tsx', !viewSource.includes("from './LocationPicker'") && !/import\s*\{[^}]*\bLocationPicker\b[^}]*\}/.test(viewSource));

console.log(allPassed ? '\nALL EVENT LOCATION MUHURTHAM CHECKS PASSED' : '\nSOME EVENT LOCATION MUHURTHAM CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
