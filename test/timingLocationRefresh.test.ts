/**
 * My Day Timing Location Change Refresh V1: regression suite for the
 * extracted loadAssistantSignals callback and the extended
 * handleLocationChanged orchestrator (apps/web/app/page.tsx).
 *
 * Audited separately (not re-derived here): PATCH /api/users/location's
 * updateUserLocation() is a single UPDATE on the User row, and both
 * GET /api/my-day and GET /api/daily-assistant/briefing independently
 * re-read that row fresh (getUserById) on every request -- so the only
 * thing missing before this fix was a client-side trigger to actually
 * call them again after a confirmed Timing Location save. No component-
 * test harness exists in this repo for page.tsx handlers, so this
 * follows the established source-text/regex structural-assertion pattern
 * (see test/planLogMyDayRefresh.test.ts, test/habitLogActivityIdentity.test.ts).
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const locationPickerSource = fs.readFileSync('apps/web/components/LocationPicker.tsx', 'utf8');
const locationRouteSource = fs.readFileSync('apps/web/app/api/users/location/route.ts', 'utf8');
const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');
const myDayRouteSource = fs.readFileSync('apps/web/app/api/my-day/route.ts', 'utf8');
const briefingRouteSource = fs.readFileSync('apps/web/app/api/daily-assistant/briefing/route.ts', 'utf8');
const myDayOrchestratorSource = fs.readFileSync('apps/web/lib/myDayOrchestrator.ts', 'utf8');

// ============================================================
// 1/2/3. handleLocationChanged: updates local user state, then refreshes
// both My Day and the daily-assistant signals.
// ============================================================

const handleLocationChangedMatch = pageSource.match(
  /const handleLocationChanged = useCallback\(async \(city: \{[^}]*\}\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\);/
);
check('handleLocationChanged is defined as an async useCallback in page.tsx', handleLocationChangedMatch !== null);

const handleLocationChangedBody = handleLocationChangedMatch?.[1] ?? '';
const handleLocationChangedDeps = handleLocationChangedMatch?.[2] ?? '';

check('handleLocationChanged updates local user location state via setUser', /setUser\(/.test(handleLocationChangedBody));
check('handleLocationChanged calls loadMyDay()', /loadMyDay\(\)/.test(handleLocationChangedBody));
check('handleLocationChanged calls loadAssistantSignals()', /loadAssistantSignals\(\)/.test(handleLocationChangedBody));
check(
  'handleLocationChanged runs both refreshes concurrently via Promise.all',
  /Promise\.all\(\s*\[\s*loadMyDay\(\),\s*loadAssistantSignals\(\)\s*\]\s*\)/.test(handleLocationChangedBody)
);
check(
  'handleLocationChanged depends on both loadMyDay and loadAssistantSignals',
  /\bloadMyDay\b/.test(handleLocationChangedDeps) && /\bloadAssistantSignals\b/.test(handleLocationChangedDeps)
);
check('setUser runs before the refresh Promise.all (state update precedes the refetch call)', (() => {
  const setUserIndex = handleLocationChangedBody.indexOf('setUser(');
  const promiseAllIndex = handleLocationChangedBody.indexOf('Promise.all(');
  return setUserIndex !== -1 && promiseAllIndex !== -1 && setUserIndex < promiseAllIndex;
})());

// ============================================================
// 4. The refreshes only ever happen through the confirmed onChanged path.
// ============================================================

check('page.tsx wires YouView to handleLocationChanged via onLocationChanged', /onLocationChanged=\{handleLocationChanged\}/.test(pageSource));

// LocationPicker itself must still only call onChanged from inside a
// res.ok branch -- never on a failed save -- so a non-2xx PATCH can never
// reach handleLocationChanged (and therefore never trigger loadMyDay/
// loadAssistantSignals with an unsaved location). Checked per-handler: the
// function's "if (res.ok) { ... } else { ... }" split must have onChanged
// only on the success side, never the failure side.
const onChangedCalls = [...locationPickerSource.matchAll(/onChanged\((selectedCity|newCity)\);/g)];
check('LocationPicker calls onChanged exactly twice (curated select + custom submit)', onChangedCalls.length === 2);

function checkOnChangedGuardedByResOk(functionName: string, functionBody: string) {
  const ifElseMatch = functionBody.match(/if \(res\.ok\) \{([\s\S]*?)\n {4}\} else \{([\s\S]*?)\n {4}\}/);
  check(`${functionName} has an if (res.ok) {...} else {...} branch`, ifElseMatch !== null);
  const successBranch = ifElseMatch?.[1] ?? '';
  const failureBranch = ifElseMatch?.[2] ?? '';
  check(`${functionName}'s success (res.ok) branch calls onChanged`, /onChanged\(/.test(successBranch));
  check(`${functionName}'s failure (else) branch never calls onChanged`, !/onChanged\(/.test(failureBranch));
}

const handleSelectChangeMatch = locationPickerSource.match(/async function handleSelectChange\([\s\S]*?\n {2}\}/);
checkOnChangedGuardedByResOk('handleSelectChange', handleSelectChangeMatch?.[0] ?? '');

const handleCustomSubmitMatch = locationPickerSource.match(/async function handleCustomSubmit\([\s\S]*?\n {2}\}/);
checkOnChangedGuardedByResOk('handleCustomSubmit', handleCustomSubmitMatch?.[0] ?? '');

// ============================================================
// 5/6. loadAssistantSignals is a stable, standalone useCallback, and the
// existing user-id-gated mount effect still invokes it.
// ============================================================

check(
  'loadAssistantSignals is defined as its own useCallback (not inline inside the effect anymore)',
  /const loadAssistantSignals = useCallback\(async \(\) => \{/.test(pageSource)
);

const assistantEffectMatch = pageSource.match(
  /useEffect\(\(\) => \{\s*if \(!user\) return;\s*loadAssistantSignals\(\);\s*\}, \[([^\]]*)\]\);/
);
check('the user-id-gated effect still calls loadAssistantSignals() on mount/user change', assistantEffectMatch !== null);
check(
  "that effect's dependency array still includes user?.id",
  /user\?\.id/.test(assistantEffectMatch?.[1] ?? '')
);
check(
  "that effect's dependency array includes loadAssistantSignals itself (correct hook deps, no stale closure)",
  /\bloadAssistantSignals\b/.test(assistantEffectMatch?.[1] ?? '')
);

// The extracted callback must preserve the original three endpoints and
// state updates verbatim -- not a redesign of the daily-assistant fetch.
const loadAssistantSignalsMatch = pageSource.match(
  /const loadAssistantSignals = useCallback\(async \(\) => \{([\s\S]*?)\n {2}\}, \[\]\);/
);
const loadAssistantSignalsBody = loadAssistantSignalsMatch?.[1] ?? '';
check("loadAssistantSignals still fetches '/api/daily-assistant/briefing'", /fetch\('\/api\/daily-assistant\/briefing'\)/.test(loadAssistantSignalsBody));
check("loadAssistantSignals still fetches '/api/daily-assistant/insights'", /fetch\('\/api\/daily-assistant\/insights'\)/.test(loadAssistantSignalsBody));
check("loadAssistantSignals still fetches '/api/daily-assistant/reflection'", /fetch\('\/api\/daily-assistant\/reflection'\)/.test(loadAssistantSignalsBody));
check('loadAssistantSignals still calls setDailyBriefing/setPersonalContext/setAssistantInsight/setTodayReflection', (
  /setDailyBriefing\(/.test(loadAssistantSignalsBody) &&
  /setPersonalContext\(/.test(loadAssistantSignalsBody) &&
  /setAssistantInsight\(/.test(loadAssistantSignalsBody) &&
  /setTodayReflection\(/.test(loadAssistantSignalsBody)
));
check('loadAssistantSignals has no unguarded [] useCallback deps that would make it identity-unstable', /\}, \[\]\);/.test(pageSource.slice((loadAssistantSignalsMatch?.index ?? 0), (loadAssistantSignalsMatch?.index ?? 0) + (loadAssistantSignalsMatch?.[0]?.length ?? 0) + 20)));

// ============================================================
// 7/8/9. Server-side facts this fix depends on and must not have broken:
// buildMyDay's local-date derivation, and fresh getUserById reads on both
// GET /api/my-day and GET /api/daily-assistant/briefing.
// ============================================================

check(
  "buildMyDay derives localDate from getDatePartsInTimezone(user.timezone, now) -- Timing Location's timezone, never browser-local/UTC",
  /getDatePartsInTimezone\(user\.timezone, now\)\.dateStr/.test(myDayOrchestratorSource)
);
check('GET /api/my-day performs a fresh getUserById(session.userId) read', /getUserById\(session\.userId\)/.test(myDayRouteSource));
check('GET /api/daily-assistant/briefing performs a fresh getUserById(session.userId) read', /getUserById\(session\.userId\)/.test(briefingRouteSource));

// ============================================================
// 10/11/12. updateUserLocation touches ONLY Timing Location fields on the
// User row -- never Birth Location, never Event Location/Plan/AuraMoment
// snapshot fields.
// ============================================================

const updateUserLocationMatch = dbSource.match(/export async function updateUserLocation\([\s\S]*?\n\}/);
check('updateUserLocation was located in db.ts', updateUserLocationMatch !== null);
const updateUserLocationBody = updateUserLocationMatch?.[0] ?? '';

check('updateUserLocation issues exactly one UPDATE statement', (updateUserLocationBody.match(/UPDATE "User"/g) ?? []).length === 1);
check('updateUserLocation only touches "User" (no other table referenced)', !/UPDATE (?!"User")/.test(updateUserLocationBody) && !/INSERT INTO/.test(updateUserLocationBody));
check(
  'updateUserLocation sets exactly cityName/latitude/longitude/timezone',
  /"cityName" = \$2, latitude = \$3, longitude = \$4, timezone = \$5/.test(updateUserLocationBody)
);
check('updateUserLocation never references birthCityName/birthLatitude/birthLongitude/birthTimezone', !/birth(CityName|Latitude|Longitude|Timezone)/i.test(updateUserLocationBody));
check('updateUserLocation never references eventTimezone/eventLocationName', !/event(Timezone|LocationName)/i.test(updateUserLocationBody));
check('PATCH /api/users/location route never references birthCityName/birthLatitude/birthLongitude/birthTimezone', !/birth(CityName|Latitude|Longitude|Timezone)/i.test(locationRouteSource));
check('PATCH /api/users/location route never references eventTimezone/eventLocationName/AuraMoment', !/event(Timezone|LocationName)/i.test(locationRouteSource) && !/AuraMoment/.test(locationRouteSource));
check('page.tsx handleLocationChanged body never references birthCityName/birthLatitude/birthLongitude/birthTimezone', !/birth(CityName|Latitude|Longitude|Timezone)/i.test(handleLocationChangedBody));
check('page.tsx handleLocationChanged body never references eventTimezone/eventLocationName/AuraMoment', !/event(Timezone|LocationName)/i.test(handleLocationChangedBody) && !/AuraMoment/.test(handleLocationChangedBody));

// ============================================================
// 13. PR #87 (Plan Log -> My Day Refresh Consistency V1) wiring remains
// completely intact -- this fix must not have touched it.
// ============================================================

const handlePlanLoggedMatch = pageSource.match(
  /const handlePlanLogged = useCallback\(async \(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/
);
check('handlePlanLogged is still defined as a useCallback in page.tsx', handlePlanLoggedMatch !== null);
check('handlePlanLogged still combines loadUserDataAndLogs() and loadMyDay()', (() => {
  const body = handlePlanLoggedMatch?.[1] ?? '';
  return /loadUserDataAndLogs\(\)/.test(body) && /loadMyDay\(\)/.test(body);
})());

const onPlanLoggedWirings = pageSource.match(/onPlanLogged=\{[^}]*\}/g) ?? [];
check('page.tsx still wires onPlanLogged exactly 3 times, all to handlePlanLogged', onPlanLoggedWirings.length === 3 && onPlanLoggedWirings.every((w) => w === 'onPlanLogged={handlePlanLogged}'));
check('page.tsx still wires HomeDashboard onLogPlan to handleLogPlanFromHome', /onLogPlan=\{handleLogPlanFromHome\}/.test(pageSource));

// ============================================================
// 14. PR #86 (direct HabitLog CONFIRMED/PENDING/FAILED + idempotency)
// remains untouched -- this fix never references any of its identifiers.
// ============================================================

check('handleLocationChanged never references classifyHabitLogSyncOutcome (PR #86 direct-log classification)', !/classifyHabitLogSyncOutcome/.test(handleLocationChangedBody));
check('loadAssistantSignals never references clientRequestId (PR #86 idempotency key)', !/clientRequestId/.test(loadAssistantSignalsBody));
check('page.tsx still references clientRequestId elsewhere (PR #86 offline-queue/idempotency code untouched)', /clientRequestId/.test(pageSource));

if (!allPassed) {
  console.error('\nSome Timing Location refresh checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL TIMING LOCATION REFRESH CHECKS PASSED');
}
