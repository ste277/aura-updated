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
const planningHorizonSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/planningHorizon.ts'), 'utf8');
const dayConstructorPreviewClientSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/dayConstructorPreviewClient.ts'), 'utf8');
const planDayQuickPicksSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/lib/planDayQuickPicks.ts'), 'utf8');

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
  check(
    '16. onSaved still navigates back to Home for the TODAY case (a real cross-route navigation, matching this app\'s own established convention)',
    /function handleSaved\([^)]*\)\s*\{[\s\S]*?window\.location\.href = '\/';/.test(planDayClientSource)
  );
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
  check(
    '30. page.tsx is a real async Server Component doing the session/user read itself (matches the established app/moment/[token]/page.tsx precedent)',
    /export default async function PlanDayPage\(\{ searchParams \}/.test(planDayPageSource)
  );
  check('31. page.tsx reads the authoritative clock exactly once, passed by reference into resolvePlanDayServerProps', occurrences(planDayPageSource, 'new Date()') === 1 && planDayPageSource.includes('now: () => new Date()'));
  // Intent Fidelity V1 PR G3/G4 added `resolveThisWeekDeadline`'s own
  // `new Date(Date.UTC(year, month - 1, day))` to planDayEntry.ts -- the
  // SAME pure, explicit-Y/M/D calendar-arithmetic idiom `timezone.ts`'s
  // own `addDaysToDateStr` already uses, never an ambient clock read.
  // This check is refined (matching planDayEntry.test.ts's own check 25)
  // to forbid an actual clock read -- a zero-argument `new Date()` or
  // `Date.now()` -- rather than the bare `new Date(` substring, which
  // would also incorrectly reject this exact non-clock-reading idiom.
  check(
    '32. the clock closure is provided TO resolvePlanDayServerProps, never read by PlanDayClient or planDayEntry.ts (Date.UTC(explicit y/m/d) calendar arithmetic is not a clock read)',
    !/new Date\(\s*\)/.test(planDayEntrySource) && !planDayEntrySource.includes('Date.now(') && occurrences(planDayClientSource, 'new Date(') === 0
  );
  check('33. page.tsx delegates the actual session/user/date decision to resolvePlanDayServerProps -- it makes no decision of its own beyond wiring closures', planDayPageSource.includes('resolvePlanDayServerProps({'));
  check('34. planDayBootstrap.ts imports no next/server or next/headers of its own -- fully framework-independent, directly testable (mirrors F1s own handleDayConstructorPreviewRequest pattern)', !/next\/server|next\/headers/.test(planDayBootstrapSource));
  check('35. resolvePlanDayBootstrap reuses the canonical getDatePartsInTimezone helper -- no second civil-date derivation', planDayBootstrapSource.includes("from './timezone'"));
  check(
    '36. PlanDayClient accepts timezone/planningDate/horizon/availabilityConfigured as props (server-supplied), not internal state derived from a fetch',
    /export function PlanDayClient\(\{ timezone, planningDate, horizon, availabilityConfigured \}: PlanDayClientProps\)/.test(planDayClientSource)
  );
  check('37. buildRequestedIntentsForSubmission and previewConstructedDay are both called with the SAME planningDate value at the submit call site', /buildRequestedIntentsForSubmission\(rows, timezone, planningDate\)/.test(planDayClientSource) && /previewConstructedDay\(intents, planningDate\)/.test(planDayClientSource));
  check(
    '38. page.tsx reads searchParams ONLY for horizon selection -- planningDate/timezone are NEVER read from a query string, header, or other client-suppliable input; both still come exclusively from resolvePlanDayServerProps\'s own return value',
    /searchParams\.horizon/.test(planDayPageSource) &&
      !/searchParams\.(timezone|planningDate)/.test(planDayPageSource) &&
      !/req\.query|req\.headers/.test(planDayPageSource) &&
      planDayPageSource.includes('timezone={bootstrap?.timezone ?? null}') &&
      planDayPageSource.includes('planningDate={bootstrap?.planningDate ?? null}')
  );

  // ============================================================
  // Intent Fidelity V1 PR G3/G4 -- Important/Due-by wiring (39-41)
  // ============================================================
  check('39. the Submit gate now also requires planningDate, matching canSubmitPlanDay\'s own extended (rows, planningDate) signature', /canSubmitPlanDay\(rows, planningDate\)/.test(planDayClientSource));
  check('40. the row card never sends an explicit MEDIUM/LOW UI label -- HIGH/MEDIUM/LOW are not used as UI vocabulary anywhere in this file', !/label="HIGH"|label="MEDIUM"|label="LOW"|label='HIGH'|label='MEDIUM'|label='LOW'/.test(planDayClientSource));
  check(
    '41. the Important control and the FIXED-time control remain visually/lexically distinct -- deadline is labeled "Deadline" (renamed from "Due by" by Plan My Day UX V2 PR U1, this ticket\'s own section 28/60), never "Due at"',
    /\+ Deadline|<FieldLabel>Deadline<\/FieldLabel>/.test(planDayClientSource) && !planDayClientSource.includes('Due at')
  );

  // ============================================================
  // Planning Horizon V1 PR P2 -- horizon selector, navigation, gating,
  // stale-availability handling, Tomorrow confirmation (42-59).
  // ============================================================

  // 42. Horizon parser exists, is pure, and lives with the domain helper (this ticket's own section 4).
  check('42. planningHorizon.ts exports a pure parseHorizonSearchParam helper', planningHorizonSource.includes('export function parseHorizonSearchParam('));
  check('42b. page.tsx uses that SAME parser rather than a second, ad-hoc one of its own', planDayPageSource.includes('parseHorizonSearchParam(searchParams.horizon)'));

  // 43. Selector navigation targets the canonical URLs, never mutates planningDate locally.
  check('43. selecting Today navigates to /plan-day?horizon=today', planDayClientSource.includes("'/plan-day?horizon=today'"));
  check('44. selecting Tomorrow navigates to /plan-day?horizon=tomorrow', planDayClientSource.includes("'/plan-day?horizon=tomorrow'"));
  check('44b. horizon selection uses next/navigation\'s router, never a full window.location reload', planDayClientSource.includes("from 'next/navigation'") && planDayClientSource.includes('router.push('));
  check('44c. selectHorizon never itself computes a date (no addDaysToDateStr/getDatePartsInTimezone call in PlanDayClient.tsx)', !/addDaysToDateStr|getDatePartsInTimezone/.test(planDayClientSource));

  // 45. No This Week control anywhere in the horizon selector.
  check(
    '45. the horizon selector offers exactly Today/Tomorrow -- no This Week/date-picker/multi-day control',
    /options=\{\[\s*\{ value: 'TODAY', label: 'Today' \},\s*\{ value: 'TOMORROW', label: 'Tomorrow' \},\s*\]\}/.test(planDayClientSource)
  );

  // 46. Default Home entry unaffected -- page.tsx's own onPlanDay wiring (check 27 above) still carries no horizon param.
  check('46. Home\'s own Plan my day link still carries no horizon param (default entry stays Today)', pageSource.includes("onPlanDay={() => { window.location.href = '/plan-day'; }}") && !pageSource.includes('/plan-day?horizon'));

  // 47/48. Tomorrow-unconfigured prerequisite gating -- known at bootstrap.
  check(
    '47. TOMORROW + availabilityConfigured=== false renders the Availability prerequisite as the PRIMARY state (not the ordinary intent form)',
    /const showAvailabilityPrerequisite = \(horizon === 'TOMORROW' && availabilityConfigured === false\)/.test(planDayClientSource)
  );
  check('48. the Availability prerequisite links to the existing You tab (/?tab=you), never a new Settings route', planDayClientSource.includes("'/?tab=you'"));

  // 49. Backend guard (P1) is never removed/bypassed -- FUTURE_AVAILABILITY_REQUIRED remains a real, distinct client status.
  check('49. FUTURE_AVAILABILITY_REQUIRED is a real member of ConstructDayPreviewClientResult, never folded into UNKNOWN_RESPONSE', dayConstructorPreviewClientSource.includes("{ status: 'FUTURE_AVAILABILITY_REQUIRED' }"));
  check(
    "49b. the preview response parser has an explicit case for it (never falls through to the 'default: UNKNOWN_RESPONSE' branch)",
    /case 'FUTURE_AVAILABILITY_REQUIRED':\s*\n\s*return \{ status: 'FUTURE_AVAILABILITY_REQUIRED' \};/.test(dayConstructorPreviewClientSource)
  );

  // 50. Stale-availability race -- PlanDayClient routes a runtime FUTURE_AVAILABILITY_REQUIRED to the SAME prerequisite UI, not a generic error.
  check(
    "50. a runtime FUTURE_AVAILABILITY_REQUIRED result sets availabilityRequiredStale rather than a generic entryError",
    /result\.status === 'FUTURE_AVAILABILITY_REQUIRED'\) \{[\s\S]*?setAvailabilityRequiredStale\(true\)/.test(planDayClientSource)
  );
  check(
    '50b. availabilityRequiredStale feeds the SAME showAvailabilityPrerequisite flag the bootstrap-known case uses -- one prerequisite UI, not two',
    /showAvailabilityPrerequisite = \(horizon === 'TOMORROW' && availabilityConfigured === false\) \|\| availabilityRequiredStale/.test(planDayClientSource)
  );
  check(
    '50c. the stale-availability flag is reset whenever horizon itself changes, so switching back to Today never leaves a stale Tomorrow-only block in place',
    /useEffect\(\(\) => \{[\s\S]*?setAvailabilityRequiredStale\(false\);[\s\S]*?\}, \[horizon\]\);/.test(planDayClientSource)
  );

  // 51. CONFIGURED_EMPTY must never trigger the unconfigured prerequisite -- it's a distinct, allowed-to-preview state.
  check(
    "51. the Availability prerequisite condition checks availabilityConfigured === false specifically -- a CONFIGURED_EMPTY day (availabilityConfigured === true) can never trigger it",
    planDayClientSource.includes("availabilityConfigured === false")
  );

  // 52. Horizon-aware NO_USABLE_CAPACITY copy is call-site-wired with the real horizon, not a hardcoded 'TODAY'.
  check('52. submitPreview passes the real horizon into presentPlanDayPreviewFailure (not a hardcoded default)', /presentPlanDayPreviewFailure\(result, horizon\)/.test(planDayClientSource));

  // 53. FIXED conversion still uses only planningDate + timezone -- no per-row date field, no THIS_WEEK ambiguity introduced.
  check('53. resolveFixedStart\'s own call site (via buildRequestedIntentsForSubmission) is unaffected -- still exactly planningDate/timezone, no new date parameter', planDayEntrySource.includes('resolveFixedStart(row, planningDate, timezone)'));

  // 54. Acceptance path -- zero diff proof (structural, mirrors check 6-9 above but reconfirmed post-P2).
  check('54. DayPlanPreviewController is still the ONLY acceptance-owning import -- P2 added no second accept path', occurrences(planDayClientSource, "from '../../components/DayPlanPreviewController'") === 1);

  // 55/56. Tomorrow success -- no immediate Home redirect, explicit confirmation with a real action.
  check(
    "55. TOMORROW success does NOT immediately redirect to Home -- it sets phase to 'SAVED' instead",
    /if \(horizon === 'TOMORROW'\) \{\s*setPhase\('SAVED'\);\s*return;\s*\}/.test(planDayClientSource)
  );
  check('56. the SAVED phase renders an explicit confirmation message', planDayClientSource.includes('Tomorrow is planned.'));
  check('56b. the SAVED phase offers a real Back to Home action (not a dead end)', /phase === 'SAVED'[\s\S]*?Back to Home/.test(planDayClientSource));

  // 57. TODAY success is unaffected -- reconfirms check 16 from the opposite direction (the conditional branch, not just the fallback line).
  check(
    "57. TODAY (horizon !== 'TOMORROW') still falls through to the pre-P2 immediate Home redirect, unconditionally",
    /if \(horizon === 'TOMORROW'\) \{\s*setPhase\('SAVED'\);\s*return;\s*\}\s*\n\s*window\.location\.href = '\/';/.test(planDayClientSource)
  );

  // 58. Due-by label -- presentation only, domain kind:'TODAY' unchanged.
  check('58. the first Due-by chip\'s label is horizon-aware (Same day under Tomorrow) while its own kind stays TODAY', /const firstChipLabel = horizon === 'TOMORROW' \? 'Same day' : 'Today';/.test(planDayClientSource) && planDayClientSource.includes("kind: 'TODAY'"));
  check('58b. resolveDeadline/PlanDayDeadlineChoice\'s own TODAY variant is never renamed -- planDayEntry.ts is untouched at the type level', planDayEntrySource.includes("{ kind: 'TODAY' }"));

  // 59. Intent-row preservation -- PlanDayClient is never remounted/keyed by horizon (this ticket's own section 13/46): no `key={horizon}` anywhere, and `rows` state is declared once, outside any horizon-conditional branch.
  check('59. PlanDayClient carries no key={horizon} (or similar) that would force a remount/state-reset on horizon switch', !/key=\{horizon\}/.test(planDayClientSource));
  check('59b. the rows state itself is declared exactly once, unconditionally (never re-initialized inside a horizon branch)', occurrences(planDayClientSource, 'useState<PlanDayIntentRow[]>') === 1);

  // ============================================================
  // Plan My Day UX V2 PR U1 -- Quick Picks, simplified task cards
  // (60-90).
  // ============================================================

  // 60. Quick Pick semantics -- ACTION buttons, never aria-pressed/toggle
  // semantics (this ticket's own section 12).
  check('60. QuickPickButton never sets aria-pressed (it is an action button, not a toggle/selection)', !/function QuickPickButton[\s\S]*?aria-pressed/.test(planDayClientSource));
  check('60b. QuickPickButton has a real, specific accessible name ("Add <label>")', /aria-label=\{`Add \$\{pick\.label\}`\}/.test(planDayClientSource));
  check('60c. Quick Picks render from the single shared PLAN_DAY_QUICK_PICKS list, never a second inline copy', planDayClientSource.includes('PLAN_DAY_QUICK_PICKS.map('));

  // 61. Duplicates allowed -- handleQuickPick never checks for an
  // existing same-label/activityId row before appending (this ticket's
  // own section 13).
  {
    const m = planDayClientSource.match(/function handleQuickPick\(pick: PlanDayQuickPick\) \{([\s\S]*?)\n  \}/);
    const body = m?.[0] ?? '';
    check('61. handleQuickPick never deduplicates by label/activityId/title (no .find/.some/.includes guard against an existing row)', body.length > 0 && !/\.find\(|\.some\(|\.includes\(/.test(body));
  }

  // 62. Max-intent cap respected -- Quick Picks and Something Else both
  // gate through the SAME existing canAddAnotherRow, never a second
  // limit (this ticket's own section 14).
  check('62. handleQuickPick respects the existing canAddAnotherRow cap before appending', /function handleQuickPick[\s\S]*?canAddAnotherRow\(current\)/.test(planDayClientSource));
  check('62b. handleSomethingElse respects the SAME existing cap', /function handleSomethingElse[\s\S]*?canAddAnotherRow\(current\)/.test(planDayClientSource));
  check('62c. no second/new MAX constant is introduced in this file (only the existing MAX_PLAN_DAY_INTENTS, imported, is ever consulted)', !/const\s+\w*MAX\w*\s*=\s*\d+/.test(planDayClientSource));

  // 63. Initial-blank-row reuse -- both Quick Pick and Something Else
  // check isRowUntouched (planDayEntry.ts) before appending, never title
  // alone (this ticket's own section 15).
  check('63. handleQuickPick reuses the single untouched blank row via isRowUntouched, never a bare title check', /function handleQuickPick[\s\S]*?isRowUntouched\(current\[0\]\)/.test(planDayClientSource));
  check('63b. handleSomethingElse reuses the SAME single untouched blank row via isRowUntouched', /function handleSomethingElse[\s\S]*?isRowUntouched\(current\[0\]\)/.test(planDayClientSource));
  check('63c. isRowUntouched itself is imported from planDayEntry.ts, never reimplemented locally in the component', planDayClientSource.includes('isRowUntouched,') && !/function isRowUntouched/.test(planDayClientSource));

  // 64. Something Else focuses the blank/new row (this ticket's own
  // section 16) via the existing deterministic title-input element id,
  // never a new ref-plumbing mechanism.
  check('64. handleSomethingElse sets a pending-focus row id rather than leaving the new/reused row unfocused', /function handleSomethingElse[\s\S]*?setPendingFocusRowId\(/.test(planDayClientSource));
  check('64b. the focus effect targets the SAME deterministic `plan-day-title-${id}` element id the title input itself already uses', /document\.getElementById\(`plan-day-title-\$\{pendingFocusRowId\}`\)/.test(planDayClientSource) && planDayClientSource.includes('const titleId = `plan-day-title-${row.id}`;'));
  {
    const m = planDayClientSource.match(/function handleQuickPick\(pick: PlanDayQuickPick\) \{([\s\S]*?)\n  \}/);
    check('64c. handleQuickPick never sets pending focus (the pick already supplies the title, this ticket\'s own section 15: "Never focuses the title input")', !!m && !m[0].includes('setPendingFocusRowId'));
  }

  // 65. Edited-title identity clearing (this ticket's own section 6/21) --
  // the ONLY call site that clears activityId is the title input's own
  // onChange, unconditionally, never a generic patch merge inside
  // updateRow itself (which would incorrectly also clear it on unrelated
  // field edits).
  check(
    '65. the title input\'s own onChange always clears activityId alongside the new title, in the SAME patch object',
    /onChange=\{\(e\) => onChange\(\{ title: e\.target\.value, activityId: undefined \}\)\}/.test(planDayClientSource)
  );
  check(
    '65b. updateRow itself performs a plain merge with no special-cased activityId-clearing logic of its own (identity-clearing is a CALL-SITE decision, not baked into the generic patch reducer)',
    /function updateRow\(id: string, patch: Partial<PlanDayIntentRow>\) \{\s*setRows\(\(current\) => current\.map\(\(row\) => \(row\.id === id \? \{ \.\.\.row, \.\.\.patch \} : row\)\)\);\s*\}/.test(planDayClientSource)
  );

  // 66. Collapsed default state -- a new row (whichever way it was
  // created) never starts expanded (this ticket's own section 39: "No
  // additional interaction required before Preview").
  check('66. expandedRowIds starts as an empty Set -- every row begins collapsed', /useState<ReadonlySet<string>>\(new Set\(\)\)/.test(planDayClientSource));

  // 67/68. Collapsed card never exposes the full control set; Edit
  // reveals it; Done collapses without discarding values (this ticket's
  // own section 18/20/21/22) -- proven structurally: the six controls
  // only ever appear inside the `expanded &&`-equivalent branch, and
  // "Done" never resets any row field.
  {
    const cardMatch = planDayClientSource.match(/function IntentRowCard\([\s\S]*?\n\}\n/);
    const cardBody = cardMatch?.[0] ?? '';
    check('67. the collapsed branch (!expanded) renders only the summary text and an Edit button -- no Duration/Time/Important/Deadline controls', /\{!expanded \? \(\s*<div[\s\S]*?formatIntentRowSummary\(row, horizon\)[\s\S]*?Edit<\/SecondaryButton>\s*<\/div>\s*\) : \(/.test(cardBody));
    check(
      '68. the expanded branch exposes Duration, Time, Important, and Deadline controls, and a Done button',
      /<FieldLabel>Duration<\/FieldLabel>/.test(cardBody) && /Flexible[\s\S]*At a specific time/.test(cardBody) && cardBody.includes('Important') && cardBody.includes('DeadlineControl') && cardBody.includes('Done</SecondaryButton>')
    );
    check('68b. Edit/Done both call the SAME onToggleExpanded -- toggling never clears/resets any row field', occurrences(cardBody, 'onClick={onToggleExpanded}') === 2);
  }

  // 69. Title remains editable regardless of collapsed/expanded state
  // (this ticket's own section 23) -- the title TextInput is rendered
  // OUTSIDE the `!expanded ? ... : ...` branch entirely.
  check(
    '69. the title input is rendered unconditionally, before the collapsed/expanded branch -- never gated on `expanded`',
    /<TextInput\s*\n\s*id=\{titleId\}[\s\S]*?\{!expanded \? \(/.test(planDayClientSource)
  );

  // 70. Automatic/Flexible collapsed summary uses formatIntentRowSummary
  // (planDayEntry.ts), never a second inline formatter (this ticket's
  // own section 59: "Prefer pure summary formatting helper").
  check('70. the collapsed summary is rendered via the shared, pure formatIntentRowSummary helper', planDayClientSource.includes('formatIntentRowSummary(row, horizon)'));
  check('70b. formatIntentRowSummary is imported from planDayEntry.ts, never reimplemented in the component', planDayClientSource.includes('formatIntentRowSummary,') && !/function formatIntentRowSummary/.test(planDayClientSource));

  // 71. Deadline rename -- the expanded control is DeadlineControl
  // (renamed from DueByControl), and its own heading/disclosure text
  // read "Deadline", never "Due by" (this ticket's own section 28/60).
  check('71. the renamed DeadlineControl component exists (DueByControl no longer does)', planDayClientSource.includes('function DeadlineControl(') && !planDayClientSource.includes('function DueByControl('));
  check('71b. the collapsed disclosure button reads "+ Deadline"', planDayClientSource.includes('+ Deadline'));
  check('71c. the expanded heading reads "Deadline"', planDayClientSource.includes('<FieldLabel>Deadline</FieldLabel>'));

  // 72. Deadline Clear vs row Remove stay distinct actions/labels (this
  // ticket's own section 27/29/30) -- Clear still only resets the
  // deadline choice (never calls onRemove), Remove still only removes
  // the row (via the existing IconButton, unchanged).
  check('72. DeadlineControl\'s own "Clear" button still only calls onChange(NO_DEADLINE) -- never onRemove', /Clear\s*<\/TextButton>/.test(planDayClientSource) && (() => { const m = planDayClientSource.match(/function DeadlineControl[\s\S]*?\n\}\n/); return !!m && !m[0].includes('onRemove'); })());
  check('72b. the row-level Remove control is unchanged -- still the IconButton with an explicit "Remove ..." accessible name', /ariaLabel=\{`Remove \$\{row\.title\.trim\(\) \|\| `task \$\{index \+ 1\}`\}`\}/.test(planDayClientSource));

  // 73. Plan My Day UX V2 PR U2 supersedes U1's "'+ Add another' is
  // gone" decision (this ticket's own section 5/15/18): "+ Add another"
  // is reintroduced as a compact picker-reveal affordance once a plan
  // already exists, wired to reveal the SAME shared picker block --
  // never a second/duplicate "+ Something else" implementation.
  check('73. "+ Add another" is reintroduced as a compact picker-reveal control', planDayClientSource.includes('+ Add another'));
  check('73a. "+ Add another" is wired to reveal the picker (setAddPickerExpanded(true)), never a second row-adding implementation of its own', /onClick=\{\(\) => setAddPickerExpanded\(true\)\}[\s\S]{0,150}\+ Add another/.test(planDayClientSource));
  check('73b. the "+ Something else" TextButton is implemented exactly ONCE in source (<TextButton onClick={onSomethingElse}...>) -- the one shared QuickPicksAndSomethingElse implementation, rendered from multiple call sites, never duplicated (doc-comment prose mentioning the label elsewhere is fine)', occurrences(planDayClientSource, '<TextButton onClick={onSomethingElse}') === 1);
  check('73c. both QuickPicksAndSomethingElse call sites wire the SAME handleSomethingElse via the extracted onSomethingElse prop -- never a second handler', occurrences(planDayClientSource, 'onSomethingElse={handleSomethingElse}') === 2);

  // 74. Plan My Day UX V2 PR U2 supersedes U1's "always visible" Quick
  // Picks decision (this ticket's own section 5/8): the picker is now
  // gated by planRevealed/addPickerExpanded (real user actions), never
  // directly by rows.length or row content.
  check(
    '74. the Quick Picks grid is never gated directly by rows.length or "has a real title" row content -- only by the planRevealed/addPickerExpanded UI-action flags',
    !/rows\.length[\s\S]{0,120}PLAN_DAY_QUICK_PICKS\.map/.test(planDayClientSource) && !/rows\.some\([\s\S]{0,150}QuickPicksAndSomethingElse/.test(planDayClientSource)
  );

  // 75. Plan My Day UX V2 PR U2 -- the "Your plan" heading (and the rest
  // of the revealed-state UI) is now gated on `planRevealed`, a real
  // user ACTION flag, never derived from row content alone (this
  // ticket's own section 5/8) -- fixes the U1 issue where a still-blank
  // internal row rendered a visible card before any action was taken.
  check('75. the "Your plan" heading is gated on planRevealed, never on row content', /\{planRevealed && \([\s\S]{0,200}Your plan/.test(planDayClientSource));

  // 76. Task numbering preserved for U1 (this ticket's own section 17:
  // "If removing numbering requires broad structural churn, preserve it
  // for U1 and report that decision") -- explicitly verified still
  // present, matching the implementation report's own stated decision.
  check('76. row numbering ("Task N") is preserved (explicit U1 scope decision, not an oversight)', planDayClientSource.includes('`Task ${index + 1}`'));

  // 77. Plan My Day UX V2 PR U2 -- horizon/picker hierarchy: the horizon
  // selector still precedes both plan-entry states in source order; the
  // fresh (!planRevealed) state -- heading + shared picker -- is written
  // before the revealed (planRevealed) state -- Your plan + rows + Add
  // another -- even though only one of the two ever renders at once
  // (this ticket's own section 5).
  {
    const horizonIdx = planDayClientSource.indexOf('When are you planning for?');
    const freshStateIdx = planDayClientSource.indexOf('{!planRevealed && (');
    const accomplishIdx = planDayClientSource.indexOf('What do you want to accomplish?');
    const revealedStateIdx = planDayClientSource.indexOf('{planRevealed && (');
    const yourPlanIdx = planDayClientSource.indexOf('Your plan');
    check(
      '77. source order is horizon selector -> fresh-state (!planRevealed) heading+picker -> revealed-state (planRevealed) Your plan',
      horizonIdx > 0 && horizonIdx < freshStateIdx && freshStateIdx < accomplishIdx && accomplishIdx < revealedStateIdx && revealedStateIdx < yourPlanIdx
    );
  }

  // 78. Tomorrow-unconfigured prerequisite still suppresses the ENTIRE
  // picker/form (this ticket's own section 33) -- the shared picker's
  // call sites sit inside the SAME showAvailabilityPrerequisite ? (...)
  // : (...) conditional's else-branch the intent-row list already used
  // before U1/U2.
  check(
    '78. the QuickPicksAndSomethingElse call site(s) render inside the showAvailabilityPrerequisite else-branch -- never visible alongside the prerequisite card',
    /showAvailabilityPrerequisite \? \([\s\S]*?Set availability[\s\S]*?\) : \([\s\S]*?<QuickPicksAndSomethingElse/.test(planDayClientSource)
  );

  // 79. Errands has no canonical id anywhere in the picker source (this
  // ticket's own section 38/41) -- and the activity catalog itself is
  // never edited by this PR.
  check('79. planDayQuickPicks.ts never fabricates an "errands"/"admin"/"personal" catalog id', !/activityId:\s*'errands'|activityId:\s*'admin'|activityId:\s*'personal'/.test(planDayQuickPicksSource));

  // 80. Icons are optional and sourced from the existing catalog only
  // (this ticket's own section 43) -- never a new icon dependency.
  check('80. quickPickIcon reads ActivityProfile.icon from the existing catalog, never a second icon literal', planDayQuickPicksSource.includes('getActivityProfileById(pick.activityId)?.icon'));
  check('80b. no new icon package is imported anywhere in the picker file', !/from ['"]react-icons|from ['"]@heroicons|from ['"]lucide/.test(planDayQuickPicksSource));

  // ============================================================
  // Plan My Day UX V2 PR U2 -- entry-state + picker-density polish
  // (81-90). Fixes: (a) a still-blank internal row rendering a visible
  // card/CTA before any user action, (b) the full picker permanently
  // consuming space once a plan grows.
  // ============================================================

  // 81/82. Both new flags are real UI-action state, defaulting to
  // false, never derived from row content.
  check('81. planRevealed starts false -- the fresh page shows no blank card/CTA before any user action', /const \[planRevealed, setPlanRevealed\] = useState\(false\);/.test(planDayClientSource));
  check('82. addPickerExpanded starts false -- "+ Add another" begins collapsed once a plan exists', /const \[addPickerExpanded, setAddPickerExpanded\] = useState\(false\);/.test(planDayClientSource));

  // 83/84. A Quick Pick or "+ Something else" both reveal the plan and
  // collapse Add-another BEFORE touching rows -- the reveal is driven by
  // the action itself, never by inspecting the resulting row content.
  check('83. handleQuickPick reveals the plan (setPlanRevealed(true)) before mutating rows', /function handleQuickPick\(pick: PlanDayQuickPick\) \{\s*setPlanRevealed\(true\);[\s\S]*?setRows\(/.test(planDayClientSource));
  check('83b. handleQuickPick also collapses Add-another (setAddPickerExpanded(false)) before mutating rows', /function handleQuickPick[\s\S]*?setAddPickerExpanded\(false\);[\s\S]*?setRows\(/.test(planDayClientSource));
  check('84. handleSomethingElse reveals the plan before mutating rows', /function handleSomethingElse\(\) \{[\s\S]*?setPlanRevealed\(true\);[\s\S]*?setRows\(/.test(planDayClientSource));
  check('84b. handleSomethingElse also collapses Add-another before mutating rows', /function handleSomethingElse[\s\S]*?setAddPickerExpanded\(false\);[\s\S]*?setRows\(/.test(planDayClientSource));

  // 85. Your plan heading, row list, Add-another/picker, error card, and
  // CTA all sit downstream of the SAME planRevealed gate, in that order
  // -- none of them is independently gated, so none can render while
  // planRevealed is false.
  {
    const revealedIdx = planDayClientSource.indexOf('{planRevealed && (');
    const yourPlanIdx = planDayClientSource.indexOf('Your plan');
    const addAnotherIdx = planDayClientSource.indexOf('setAddPickerExpanded(true)}');
    const errorCardIdx = planDayClientSource.indexOf("phase === 'PREVIEW_ERROR' && entryError");
    const ctaIdx = planDayClientSource.lastIndexOf('Plan my day');
    check(
      '85. Your plan / row list / Add-another / error card / CTA are all nested downstream of the single planRevealed gate, in that order',
      revealedIdx > 0 && revealedIdx < yourPlanIdx && yourPlanIdx < addAnotherIdx && addAnotherIdx < errorCardIdx && errorCardIdx < ctaIdx
    );
  }

  // 86. The fresh (!planRevealed) block and the revealed (planRevealed)
  // block are mutually exclusive siblings -- both direct children of the
  // same else-branch fragment, never one nested inside the other (which
  // would make the fresh heading/picker linger after reveal).
  check(
    '86. the !planRevealed and planRevealed blocks are sibling conditionals, not nested one inside the other',
    (() => {
      const freshIdx = planDayClientSource.indexOf('{!planRevealed && (');
      const revealedIdx = planDayClientSource.indexOf('{planRevealed && (');
      if (freshIdx < 0 || revealedIdx < 0) return false;
      const between = planDayClientSource.slice(freshIdx, revealedIdx);
      const freshOpens = occurrences(between, '{!planRevealed && (');
      return freshOpens === 1 && between.includes(')}');
    })()
  );

  // 87. QuickPicksAndSomethingElse is the ONE picker implementation,
  // rendered from exactly two call sites -- the fresh entry state and
  // the expanded Add-another affordance -- never a third, a modal, or a
  // new route (this ticket's own section 16/18).
  check('87. QuickPicksAndSomethingElse is rendered from exactly two call sites', occurrences(planDayClientSource, '<QuickPicksAndSomethingElse') === 2);
  check('87b. both call sites pass the identical onQuickPick={handleQuickPick} prop -- the SAME handler, never a second quick-pick handler', occurrences(planDayClientSource, 'onQuickPick={handleQuickPick}') === 2);
  check('87c. no modal/drawer/new route is introduced for the Add-another affordance', !/Modal|Drawer|Dialog/.test(planDayClientSource) && !planDayPageSource.includes('add-another'));

  // 88. "+ Add another" is disabled at the SAME existing intent cap as
  // the Quick Picks themselves -- never a second/looser limit.
  check('88. the "+ Add another" control is disabled at atIntentCap, the same cap Quick Picks/Something-else already respect', /\+ Add another[\s\S]{0,60}<\/SecondaryButton>/.test(planDayClientSource) && /onClick=\{\(\) => setAddPickerExpanded\(true\)\} disabled=\{phase === 'SUBMITTING' \|\| atIntentCap\}/.test(planDayClientSource));

  // 89. A completed pick/something-else always returns Add-another to
  // its collapsed state (this ticket's own section 19) -- never leaves
  // it stuck open after a successful add. A third site (the section-12
  // remove-to-empty collapse effect, checked separately below) also
  // resets it as part of collapsing all the way back to fresh.
  check('89. setAddPickerExpanded(false) is called from handleQuickPick and handleSomethingElse (at least)', /function handleQuickPick[\s\S]*?setAddPickerExpanded\(false\);/.test(planDayClientSource) && /function handleSomethingElse[\s\S]*?setAddPickerExpanded\(false\);/.test(planDayClientSource));
  check('89b. setAddPickerExpanded(false) appears exactly THREE times total -- the two handlers plus the one remove-to-empty collapse effect, never a fourth/duplicate site', occurrences(planDayClientSource, 'setAddPickerExpanded(false);') === 3);

  // 90. planDayEntry.ts itself is completely untouched by U2 -- all new
  // state is presentation-only, living in PlanDayClient.tsx (this
  // ticket's own explicit design constraint).
  check('90. planDayEntry.ts defines no planRevealed/addPickerExpanded of its own', !planDayEntrySource.includes('planRevealed') && !planDayEntrySource.includes('addPickerExpanded'));

  // ============================================================
  // Plan My Day UX V2 PR U2 Release Gate (section 12) -- editing/
  // removing intents back down to "no meaningful content at all" must
  // collapse back to the fresh entry state, never leave Your plan/Add
  // another/CTA showing over a blank row.
  // ============================================================

  // 91. setPlanRevealed is called from exactly THREE sites: true from
  // handleQuickPick, true from handleSomethingElse, and false from the
  // new remove-to-empty collapse effect -- never a fourth/duplicate path.
  check('91. setPlanRevealed(true) is called from exactly two sites (handleQuickPick, handleSomethingElse)', occurrences(planDayClientSource, 'setPlanRevealed(true);') === 2);
  check('91b. setPlanRevealed(false) is called from exactly one site (the remove-to-empty collapse effect)', occurrences(planDayClientSource, 'setPlanRevealed(false);') === 1);

  // 92. The collapse effect is keyed ONLY on `rows` -- it only ever
  // reconsiders when row CONTENT changes, never merely because
  // planRevealed/pendingFocusRowId themselves changed on their own.
  check(
    '92. the collapse-to-fresh effect depends only on [rows]',
    /useEffect\(\(\) => \{\s*if \(planRevealed && pendingFocusRowId === null && rows\.every\(isRowUntouched\)\) \{\s*setPlanRevealed\(false\);\s*setAddPickerExpanded\(false\);\s*\}\s*\}, \[rows\]\);/.test(planDayClientSource)
  );

  // 93. The collapse effect checks pendingFocusRowId === null -- it must
  // never fire in the same render pass `handleSomethingElse` reveals a
  // still-untouched row for the user to type into (pendingFocusRowId is
  // set in that exact same batch, this ticket's own section 8/20).
  check('93. the collapse effect guards on pendingFocusRowId === null', /pendingFocusRowId === null && rows\.every\(isRowUntouched\)/.test(planDayClientSource));

  // 94. The collapse decision uses the SAME isRowUntouched helper every
  // other blank-row check already uses (planDayEntry.ts) -- never a
  // second/looser "is this row empty" definition invented locally.
  check('94. the collapse effect reuses the shared isRowUntouched helper, never a new inline emptiness check', /rows\.every\(isRowUntouched\)/.test(planDayClientSource));

  // 95. updateRow/removeRow themselves stay plain generic reducers with
  // no baked-in awareness of planRevealed/collapse logic (a call-site/
  // effect decision, matching this file's own established pattern for
  // activityId-clearing -- check 65b).
  check(
    '95. updateRow remains a plain merge with no planRevealed-aware logic of its own',
    /function updateRow\(id: string, patch: Partial<PlanDayIntentRow>\) \{\s*setRows\(\(current\) => current\.map\(\(row\) => \(row\.id === id \? \{ \.\.\.row, \.\.\.patch \} : row\)\)\);\s*\}/.test(planDayClientSource)
  );
  check(
    '95b. removeRow remains a plain filter with no planRevealed-aware logic of its own',
    /function removeRow\(id: string\) \{\s*setRows\(\(current\) => \(current\.length > 1 \? current\.filter\(\(row\) => row\.id !== id\) : current\)\);\s*\}/.test(planDayClientSource)
  );

  if (!allPassed) {
    console.error('\nSome Plan Day Wiring checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL PLAN DAY WIRING CHECKS PASSED');
  }
}

main();
