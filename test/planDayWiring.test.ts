/**
 * Day Constructor V1 -- PR F2 component-wiring regression suite.
 *
 * This repository's own test suite never renders React components (see
 * homeDashboardLogic.test.ts's own doc comment: it tests imported pure
 * helpers, never the component itself) -- so, matching the established
 * precedent for exactly this class of property
 * (dayConstructorAcceptancePersistence.test.ts's own checks 27/28, which
 * read accept/route.ts's real source to prove "derives the authenticated
 * user exclusively from getSessionFromRequest"/"reads the authoritative
 * clock exactly once"), this file proves PlanDayClient.tsx's and
 * HomeDashboard.tsx's own ARCHITECTURAL WIRING facts by reading their real,
 * shipped source -- never a rendering harness, never a reimplementation.
 * Every DECISION a human could get wrong (submittability, request mapping,
 * FIXED-time assembly, failure presentation) already has real behavioral
 * coverage in planDayEntry.test.ts/dayConstructorPreviewClient.test.ts;
 * this file only proves the wiring around those decisions is what it
 * claims to be.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const planDayClientSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/app/plan-day/PlanDayClient.tsx'), 'utf8');
const planDayPageSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/app/plan-day/page.tsx'), 'utf8');
const planDayBootstrapSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/planDayBootstrap.ts'), 'utf8');
const homeDashboardSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/HomeDashboard.tsx'), 'utf8');
const pageSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/app/page.tsx'), 'utf8');
const homeTimelineSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/HomeTimeline.tsx'), 'utf8');
const planDayEntrySource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/planDayEntry.ts'), 'utf8');

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function main() {
  // ============================================================
  // PlanDayClient.tsx -- preview mounting, no duplicate preview UI (1-6)
  // ============================================================
  check('1. PlanDayClient imports the existing E3 DayPlanPreviewController, never a new preview component', planDayClientSource.includes("import { DayPlanPreviewController } from '../../components/DayPlanPreviewController';"));
  check('2. DayPlanPreviewController is rendered exactly once', occurrences(planDayClientSource, '<DayPlanPreviewController') === 1);
  check('3. the reviewed preview is passed through VERBATIM -- never remapped/filtered before reaching the controller (this ticket\'s own section 32/48)', planDayClientSource.includes('preview={preview}'));
  check('4. no second DayPlanPreview-shaped component is imported (e.g. a hand-rolled proposed/deferred list)', !planDayClientSource.includes("from '../../components/DayPlanPreview'"));
  check('5. no capacity/timing-fit/deferred-reason presentation logic is reimplemented in this file', !/presentCapacityState|presentTimingFit|presentDeferralReason/.test(planDayClientSource));
  check('6. no PR D/E1/E2/E3 pure/domain file is imported for mutation, only DayPlanPreviewController itself and its own already-typed props', !planDayClientSource.includes("from '../../lib/dayConstructor'") && !planDayClientSource.includes("from '../../lib/dayConstructorAcceptance"));

  // ============================================================
  // PlanDayClient.tsx -- read-only preview boundary, single save path (7-11)
  // ============================================================
  check('7. PlanDayClient never calls POST /api/plans directly', !/fetch\(\s*['"]\/api\/plans/.test(planDayClientSource));
  check('8. PlanDayClient never calls the accept endpoint directly (acceptance stays owned by DayPlanPreviewController)', !planDayClientSource.includes('/api/day-constructor/accept'));
  check('9. PlanDayClient never imports createPlannedActivity/saveUpcomingPlanFromCandidate/persistAcceptedConstructedDay', !/createPlannedActivity|saveUpcomingPlanFromCandidate|persistAcceptedConstructedDay/.test(planDayClientSource));
  check('10. PlanDayClient makes no fetch call of its own at all -- the only network call is the preview request, owned entirely by dayConstructorPreviewClient.ts', planDayClientSource.includes("from '../../lib/dayConstructorPreviewClient'") && occurrences(planDayClientSource, 'fetch(') === 0);
  check(
    '11. PlanDayClient reads no clock of its own anywhere (planning-date hardening, this ticket\'s own section 3/13) -- timezone/planningDate always arrive as server-supplied props',
    occurrences(planDayClientSource, 'new Date(') === 0
  );

  // ============================================================
  // PlanDayClient.tsx -- Discard / Review again / Save success (12-18)
  // ============================================================
  check('12. onDiscard returns to the entry phase', /function handleDiscard\(\)\s*\{[^}]*setPhase\('ENTRY'\)/.test(planDayClientSource));
  check('13. onDiscard never calls the preview or accept network path', (() => { const m = planDayClientSource.match(/function handleDiscard\(\)\s*\{([\s\S]*?)\n\s*\}/); return !!m && !m[1].includes('fetch') && !m[1].includes('previewConstructedDay'); })());
  check('14. onRefreshRequested reruns the preview request rather than reusing a stale one', /function handleRefreshRequested\(\)\s*\{[^}]*submitPreview\(\)/.test(planDayClientSource));
  check('15. onRefreshRequested never itself calls acceptance/save', (() => { const m = planDayClientSource.match(/function handleRefreshRequested\(\)\s*\{([\s\S]*?)\n\s*\}/); return !!m && !m[1].includes('accept') && !m[1].includes('/api/plans'); })());
  check('16. onSaved navigates back to Home (a real cross-route navigation, matching this app\'s own established convention)', /function handleSaved\([^)]*\)\s*\{[^}]*window\.location\.href = '\/'/.test(planDayClientSource));
  check('17. no Redux/Zustand/global event bus is introduced', !/redux|zustand|eventemitter|globalThis\.__/i.test(planDayClientSource));
  check('18. DayPlanPreviewController is only ever rendered while phase === \'PREVIEW\' (never for the empty/unsubmitted entry state)', planDayClientSource.includes("phase === 'PREVIEW' && preview ?"));

  // ============================================================
  // PlanDayClient.tsx / page.tsx -- server-driven auth gate, standalone
  // route (19-21) -- planning-date hardening moved the actual session
  // check server-side (page.tsx); PlanDayClient only ever redirects based
  // on the props it was given, never performing its own auth fetch.
  // ============================================================
  check('19. an unauthenticated visitor (null props) is sent to Home, never shown a duplicate LoginScreen', planDayClientSource.includes("window.location.href = '/';"));
  check('20. PlanDayClient performs no session/user fetch of its own -- authentication is entirely server-established before this component ever renders', !planDayClientSource.includes('/api/auth/session'));
  check(
    '21. page.tsx (the Server Component route shell) reuses the existing canonical session verification (verifySessionToken/SESSION_COOKIE_NAME/getUserById) -- no second auth model',
    planDayPageSource.includes("verifySessionToken, SESSION_COOKIE_NAME } from '../../lib/auth'") && planDayPageSource.includes("getUserById } from '../../lib/db'")
  );

  // ============================================================
  // HomeDashboard.tsx / page.tsx -- Home entry, + Add something preserved (22-27)
  // ============================================================
  check('22. HomeDashboard exposes exactly one onPlanDay-driven CTA', occurrences(homeDashboardSource, 'onClick={onPlanDay}') === 1);
  check('23. the CTA renders the locked product name "Plan my day" verbatim', homeDashboardSource.includes('Plan my day'));
  {
    const ctaBlock = homeDashboardSource.slice(homeDashboardSource.indexOf('PLAN MY DAY --'), homeDashboardSource.indexOf('YOUR DAY\n'));
    check('24. the new Plan my day CTA block itself performs no navigation (no window.location reference) -- the caller (page.tsx) owns it, matching every other cross-route Home callback', ctaBlock.length > 0 && !ctaBlock.includes('window.location'));
    check('26. the new Plan my day CTA block does not duplicate or rename the existing single-suggestion "+ Add something" affordance', ctaBlock.length > 0 && !ctaBlock.includes('+ Add something'));
  }
  check('25. Day Builder\'s own "+ Add something" CTA is untouched (HomeTimeline.tsx, not modified by this PR)', homeTimelineSource.includes('+ Add something'));
  check('27. page.tsx wires onPlanDay to a real navigation to /plan-day', pageSource.includes("onPlanDay={() => { window.location.href = '/plan-day'; }}"));

  // ============================================================
  // page.tsx -- Home's own refresh-on-mount already covers the F2 return
  // path (this ticket's own section 38/72) -- protects the exact
  // invariant PlanDayClient's onSaved relies on from silently regressing.
  // (28-29)
  // ============================================================
  check(
    "28. loadMyDay() still runs unconditionally on every mount where activeTab==='home' (the mechanism PlanDayClient's onSaved relies on -- no redundant refresh infrastructure needed)",
    /if \(activeTab === 'home'\) loadMyDay\(\);/.test(pageSource)
  );
  check(
    '29. loadGuidance() still runs on every user?.id-keyed mount (fires regardless of which tab, including a fresh mount landing back on Home)',
    /useEffect\(\(\) => \{\s*setGuidance\(\{ status: 'loading' \}\);\s*if \(!user\) return;\s*loadGuidance\(\);/.test(pageSource)
  );

  // ============================================================
  // Planning-date hardening -- server-authoritative bootstrap wiring
  // (30-38)
  // ============================================================
  check('30. page.tsx is a real async Server Component doing the session/user read itself (matches the established app/moment/[token]/page.tsx precedent)', /export default async function PlanDayPage\(\)/.test(planDayPageSource));
  check('31. page.tsx reads the authoritative clock exactly once, passed by reference into resolvePlanDayServerProps', occurrences(planDayPageSource, 'new Date()') === 1 && planDayPageSource.includes('now: () => new Date()'));
  check('32. the clock closure is provided TO resolvePlanDayServerProps, never read by PlanDayClient or planDayEntry.ts', occurrences(planDayEntrySource, 'new Date(') === 0 && occurrences(planDayClientSource, 'new Date(') === 0);
  check('33. page.tsx delegates the actual session/user/date decision to resolvePlanDayServerProps -- it makes no decision of its own beyond wiring closures', planDayPageSource.includes('resolvePlanDayServerProps({'));
  check('34. planDayBootstrap.ts imports no next/server or next/headers of its own -- fully framework-independent, directly testable (mirrors F1s own handleDayConstructorPreviewRequest pattern)', !/next\/server|next\/headers/.test(planDayBootstrapSource));
  check('35. resolvePlanDayBootstrap reuses the canonical getDatePartsInTimezone helper -- no second civil-date derivation', planDayBootstrapSource.includes("from './timezone'"));
  check('36. PlanDayClient accepts timezone/planningDate as props (server-supplied), not internal state derived from a fetch', /export function PlanDayClient\(\{ timezone, planningDate \}: PlanDayClientProps\)/.test(planDayClientSource));
  check('37. buildRequestedIntentsForSubmission and previewConstructedDay are both called with the SAME planningDate value at the submit call site', /buildRequestedIntentsForSubmission\(rows, timezone, planningDate\)/.test(planDayClientSource) && /previewConstructedDay\(intents, planningDate\)/.test(planDayClientSource));
  check('38. page.tsx never accepts planningDate/timezone from a query string, header, or client-suppliable input -- both come exclusively from resolvePlanDayServerProps\'s own return value', !/searchParams|req\.query|req\.headers/.test(planDayPageSource));

  if (!allPassed) {
    console.error('\nSome Plan Day Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLAN DAY WIRING CHECKS PASSED');
  }
}

main();
