import { buildMuhurthamSearchRequest } from '../apps/web/lib/muhurthamSearchRequest';
import type { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const chennaiContext: DailyAssistantContext = {
  now: new Date(Date.UTC(2026, 7, 21, 4, 0, 0)),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ============================================================
// VALID REQUESTS
// ============================================================

const validResult = buildMuhurthamSearchRequest({
  activityId: 'start-journey',
  dateRange: { start: '2026-09-01', end: '2026-09-30' },
  timePreference: 'MORNING',
  durationMinutes: 60,
  limit: 5,
}, chennaiContext);
check('Valid request is accepted', validResult.ok === true);
if (validResult.ok) {
  check('Request carries the activityId', validResult.request.activityId === 'start-journey');
  check('Request carries the dateRange', JSON.stringify(validResult.request.dateRange) === JSON.stringify({ start: '2026-09-01', end: '2026-09-30' }));
  check('Request carries the resolved context untouched', validResult.request.context === chennaiContext);
  check('Request carries the requested limit', validResult.request.limit === 5);
}

const defaultsResult = buildMuhurthamSearchRequest({
  activityId: 'financial-decision',
  dateRange: { start: '2026-09-01', end: '2026-09-05' },
}, chennaiContext);
check('Request without optional fields is accepted with defaults', defaultsResult.ok === true);
if (defaultsResult.ok) {
  check('Default timePreference is ANY', defaultsResult.request.timePreference === 'ANY');
  check('durationMinutes is left undefined for the domain layer to default', defaultsResult.request.durationMinutes === undefined);
}

// ============================================================
// AUTH IS THE ROUTE'S CONCERN, NOT THIS VALIDATOR'S
// ============================================================
// (buildMuhurthamSearchRequest takes an already-resolved context, mirroring
// buildTimingSearchRequest -- auth/session/user resolution happens in
// route.ts before this function is ever called, so there is nothing to test
// for auth here beyond confirming the context passes through unchanged,
// covered above.)

// ============================================================
// INVALID ACTIVITY
// ============================================================

check('Missing activityId is rejected', buildMuhurthamSearchRequest({ dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('Empty activityId is rejected', buildMuhurthamSearchRequest({ activityId: '', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('An unknown (not-in-catalog) activityId is rejected', buildMuhurthamSearchRequest({ activityId: 'marriage', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('A NOT_YET_SUPPORTED (but real catalog) activityId is rejected', buildMuhurthamSearchRequest({ activityId: 'tea-break', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('A PARTIALLY_SUPPORTED (AMBIGUOUS-status) activityId is rejected', buildMuhurthamSearchRequest({ activityId: 'task-1', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('A real catalog activity with PARTIAL rule-pack support (engagement) is rejected, not silently exposed', buildMuhurthamSearchRequest({ activityId: 'engagement', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === false);
check('The new business-start activity (SUPPORTED via reused rule-pack base) is accepted', buildMuhurthamSearchRequest({ activityId: 'business-start', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === true);
check('The new property-purchase activity (SUPPORTED via reused rule-pack base) is accepted', buildMuhurthamSearchRequest({ activityId: 'property-purchase', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === true);
// griha-pravesh reached SUPPORTED in the Muhurta Knowledge Pack V1 PR (genuine
// sourced Tithi/Nakshatra data -- see test/muhurtaRulePacks.test.ts) and is
// now accepted here too, with zero changes to this validation file's logic.
check('The now-SUPPORTED griha-pravesh activity (genuine sourced rule pack) is accepted', buildMuhurthamSearchRequest({ activityId: 'griha-pravesh', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext).ok === true);

const unsupportedResult = buildMuhurthamSearchRequest({ activityId: 'tea-break', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext);
check('Unsupported-activity rejection uses 400', unsupportedResult.ok === false && unsupportedResult.status === 400);

// ============================================================
// INVALID RANGE
// ============================================================

check('Missing dateRange is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey' }, chennaiContext).ok === false);
check('Malformed dateRange (not YYYY-MM-DD) is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '09/01/2026', end: '2026-09-05' } }, chennaiContext).ok === false);
check('dateRange with end before start is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-10', end: '2026-09-01' } }, chennaiContext).ok === false);

const overCapResult = buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-01-01', end: '2026-08-01' } }, chennaiContext);
check('dateRange spanning more than 180 days is rejected', overCapResult.ok === false);
check('Over-cap rejection uses 400 (brief section 9)', overCapResult.ok === false && overCapResult.status === 400);

check('dateRange exactly at the 180-day cap is accepted', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-01-01', end: '2026-06-30' } }, chennaiContext).ok === true);
check('dateRange of zero days (start === end) is accepted', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-01' } }, chennaiContext).ok === true);

// ============================================================
// OTHER FIELD VALIDATION
// ============================================================

check('Invalid time preference is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, timePreference: 'DAWN' }, chennaiContext).ok === false);
check('Duration below the minimum is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, durationMinutes: 5 }, chennaiContext).ok === false);
check('Duration above the maximum is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, durationMinutes: 1000 }, chennaiContext).ok === false);
check('Non-numeric duration is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, durationMinutes: 'a lot' }, chennaiContext).ok === false);
check('limit below the minimum is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, limit: 0 }, chennaiContext).ok === false);
check('limit above the maximum is rejected', buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, limit: 50 }, chennaiContext).ok === false);

// ============================================================
// SCOPE (Personal Muhurtham -- General | For Me)
// ============================================================

const noScopeResult = buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' } }, chennaiContext);
check('Omitting scope defaults to GENERAL', noScopeResult.ok === true && noScopeResult.ok && noScopeResult.scope === 'GENERAL');

const explicitGeneral = buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, scope: 'GENERAL' }, chennaiContext);
check('Explicit scope: GENERAL is accepted', explicitGeneral.ok === true && explicitGeneral.ok && explicitGeneral.scope === 'GENERAL');

const explicitPersonal = buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, scope: 'PERSONAL' }, chennaiContext);
check('Explicit scope: PERSONAL is accepted', explicitPersonal.ok === true && explicitPersonal.ok && explicitPersonal.scope === 'PERSONAL');

check('An invalid scope value is rejected with 400', (() => {
  const r = buildMuhurthamSearchRequest({ activityId: 'start-journey', dateRange: { start: '2026-09-01', end: '2026-09-05' }, scope: 'FOR_US' }, chennaiContext);
  return r.ok === false && r.status === 400;
})());

console.log(allPassed ? '\nALL MUHURTHAM SEARCH API CHECKS PASSED' : '\nSOME MUHURTHAM SEARCH API CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
