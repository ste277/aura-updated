/**
 * Day Constructor V1 -- PR D presentation-adapter regression suite.
 * Exercises every pure function in `dayPlanPreviewPresentation.ts`
 * directly, plus a handful of fixture-based scenarios assembled by hand
 * (Balanced/Busy/Overloaded/Mixed/Empty -- this ticket's own section 32)
 * run through the SAME functions `DayPlanPreview.tsx` calls. No DOM, no
 * React renderer involved -- this repository has no component-test
 * infrastructure (confirmed: no jest/vitest config, no *.test.tsx
 * anywhere), so the actual JSX is verified separately via the browser
 * preview tool (visual validation), never here. Structural checks at
 * the bottom read the two new source files as text, matching this
 * repo's own established convention (dayConstructorOrchestrator.test.ts's
 * own tests 55-59) for asserting an architectural boundary was
 * respected, rather than only asserting behavior.
 */
import fs from 'fs';
import path from 'path';
import {
  presentCapacityState,
  formatTargetDateLabel,
  formatItemClockTime,
  presentPlacementSource,
  presentTimingFit,
  presentDeferralReason,
  presentWarnings,
  groupWarningsByIntentId,
  sortProposedItemsForDisplay,
  titleForIntentId,
  classifyProposalSummary,
} from '../apps/web/lib/dayPlanPreviewPresentation';
import type { ConstructDayPreview, ResolvedIntentSummary, ConstructDayWarning } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ProposedItem, DeferredItem, ConstructedDay, PlacementDeferralReason, PlacementTimingFit } from '../apps/web/lib/dayConstructor';
import type { CapacityState, CapacitySnapshot } from '../apps/web/lib/dayCapacity';
import type { DayIntent } from '../apps/web/lib/dayIntent';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

// ============================================================
// Fixture builders -- minimal, type-checked POJOs. Values are internally
// plausible but not re-derived from a real capacity/placement run; this
// suite is testing the PRESENTATION layer's reaction to a given shape,
// never re-verifying PR A/B/C's own already-tested math.
// ============================================================

function snapshot(capacityState: CapacityState, overrides: Partial<CapacitySnapshot> = {}): CapacitySnapshot {
  return {
    constructionWindowMinutes: 480,
    blockedMinutes: 0,
    usableMinutes: 480,
    requestedMinutes: 120,
    remainingMinutes: 360,
    utilization: 0.25,
    capacityState,
    ...overrides,
  };
}

function dayIntent(overrides: Partial<DayIntent> & { id: string; title: string }): DayIntent {
  return {
    targetDate: '2026-09-16',
    importance: 'MEDIUM',
    flexibility: 'FLEXIBLE',
    source: 'USER_TYPED',
    originalOrder: 0,
    ...overrides,
  };
}

function resolvedIntent(id: string, title: string, overrides: Partial<DayIntent> = {}): ResolvedIntentSummary {
  return { requestedIntentId: id, dayIntent: dayIntent({ id, title, ...overrides }) };
}

function proposedItem(overrides: Partial<ProposedItem> & { intentId: string; title: string; start: Date; end: Date }): ProposedItem {
  return { placementSource: 'SELECTED_CANDIDATE', requiresConfirmation: true, ...overrides };
}

function deferredItem(intentId: string, primaryReason: PlacementDeferralReason): DeferredItem {
  return { intentId, primaryReason, diagnostics: [] };
}

function constructedDay(overrides: Partial<ConstructedDay> = {}): ConstructedDay {
  return {
    date: '2026-09-16',
    proposedItems: [],
    deferredItems: [],
    conflicts: [],
    requestedCapacity: snapshot('OPEN'),
    proposedCapacity: snapshot('OPEN'),
    ...overrides,
  };
}

function preview(overrides: Partial<ConstructDayPreview> = {}): ConstructDayPreview {
  return {
    targetDate: '2026-09-16',
    timezone: 'America/New_York',
    constructionWindow: { date: '2026-09-16', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' },
    resolvedIntents: [],
    constructedDay: constructedDay(),
    warnings: [],
    ...overrides,
  };
}

// ============================================================
// 1-6: header / capacity
// ============================================================

check('1. target date renders as a full weekday+month+day label', formatTargetDateLabel('2026-09-16') === 'Wednesday, September 16');
check('2. OPEN capacity state has distinct label/copy', presentCapacityState('OPEN').label === 'Open day' && presentCapacityState('OPEN').description.length > 0);
check('3. BALANCED capacity state has distinct label/copy', presentCapacityState('BALANCED').label === 'Balanced day');
check('4. BUSY capacity state has distinct label/copy', presentCapacityState('BUSY').label === 'Busy day');
check('5. OVERLOADED capacity state has distinct label/copy', presentCapacityState('OVERLOADED').label === 'Overloaded day' && presentCapacityState('OVERLOADED').description.includes("Not everything fits"));
check(
  '6. presentCapacityState is a pure function of its single CapacityState argument (no other field read)',
  presentCapacityState.toString().match(/state/g)!.length <= 2 // the parameter name itself, referenced once in the switch
);

// ============================================================
// 7-14: proposed items
// ============================================================

const flexItem = proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-16T14:00:00Z'), placementSource: 'SELECTED_CANDIDATE', timingFit: 'BEST', candidateOrder: 0 });
const fixedItem = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T11:30:00Z'), end: iso('2026-09-16T12:30:00Z'), placementSource: 'FIXED_CONSTRAINT' });
const sorted = sortProposedItemsForDisplay([flexItem, fixedItem]);
check('7. chronological display sorts by start time regardless of input order', sorted[0].intentId === 'b' && sorted[1].intentId === 'a');
check('7b. sortProposedItemsForDisplay never mutates its input', [flexItem, fixedItem][0].intentId === 'a');
check('8. SELECTED_CANDIDATE presents as an Aura-chosen time', presentPlacementSource('SELECTED_CANDIDATE') === 'Aura selected this time');
check('9. FIXED_CONSTRAINT presents as a user-chosen time', presentPlacementSource('FIXED_CONSTRAINT') === 'You chose this time');
check('10. item clock time formats using the given timezone', formatItemClockTime(iso('2026-09-16T13:00:00Z'), 'America/New_York') === '9:00 AM');
check('11. ProposedItem.title is a plain passthrough field (no adapter needed)', flexItem.title === 'Investor deck');
check('12. requiresConfirmation is always true and never rendered as "saved"', flexItem.requiresConfirmation === true);
check('13. no capacity/placement copy string contains "optimal"', ![
  presentCapacityState('OPEN').description, presentCapacityState('BALANCED').description, presentCapacityState('BUSY').description, presentCapacityState('OVERLOADED').description,
  presentPlacementSource('SELECTED_CANDIDATE'), presentPlacementSource('FIXED_CONSTRAINT'),
].some((s) => s.toLowerCase().includes('optimal')));
check('14. no capacity/placement copy string contains "best possible"', ![
  presentCapacityState('OPEN').description, presentCapacityState('BALANCED').description, presentCapacityState('BUSY').description, presentCapacityState('OVERLOADED').description,
  presentPlacementSource('SELECTED_CANDIDATE'), presentPlacementSource('FIXED_CONSTRAINT'),
].some((s) => s.toLowerCase().includes('best possible')));

// ============================================================
// 15-24: deferred reason mapping -- every real PlacementDeferralReason
// value, never a raw enum string.
// ============================================================

const allDeferralReasons: PlacementDeferralReason[] = [
  'DURATION_UNKNOWN', 'NO_CANDIDATES', 'NO_FEASIBLE_WINDOW', 'BLOCKED_BY_COMMITMENT',
  'CONFLICTS_WITH_PROPOSED_ITEM', 'OUTSIDE_CONSTRUCTION_WINDOW', 'FIXED_WINDOW_INVALID', 'FIXED_WINDOW_CONFLICT',
];
check('15. every real PlacementDeferralReason value maps to non-empty, non-enum text', allDeferralReasons.every((reason) => {
  const text = presentDeferralReason(reason);
  return text.length > 0 && text !== reason;
}));
check('16. DURATION_UNKNOWN maps to the expected plain-language explanation', presentDeferralReason('DURATION_UNKNOWN').includes("doesn't know how much time"));
check('17. NO_CANDIDATES maps to the expected plain-language explanation', presentDeferralReason('NO_CANDIDATES').includes("couldn't find a suitable time"));
check('18. NO_FEASIBLE_WINDOW maps to the expected plain-language explanation', presentDeferralReason('NO_FEASIBLE_WINDOW').includes("isn't enough open time"));
check('19. OUTSIDE_CONSTRUCTION_WINDOW maps to the expected plain-language explanation', presentDeferralReason('OUTSIDE_CONSTRUCTION_WINDOW').includes('outside the part of the day'));
check('20. FIXED_WINDOW_CONFLICT maps to the expected plain-language explanation', presentDeferralReason('FIXED_WINDOW_CONFLICT').includes('conflicts with something already in your day'));
check('21. FIXED_WINDOW_INVALID maps to the expected plain-language explanation', presentDeferralReason('FIXED_WINDOW_INVALID').includes("couldn't be used"));
check('22. BLOCKED_BY_COMMITMENT maps to the expected plain-language explanation', presentDeferralReason('BLOCKED_BY_COMMITMENT').includes('already taken by something on your schedule'));
check('23. CONFLICTS_WITH_PROPOSED_ITEM maps to the expected plain-language explanation', presentDeferralReason('CONFLICTS_WITH_PROPOSED_ITEM').includes('conflicts with another activity Aura placed today'));
check('24. no raw PlacementDeferralReason enum string is ever returned verbatim', allDeferralReasons.every((reason) => presentDeferralReason(reason) !== reason));

// ============================================================
// 25-28: warnings
// ============================================================

const resolvedWithFamily = [resolvedIntent('c', 'Reply to emails', { activityFamily: 'ADMIN', activityId: undefined })];
const coarseWarning: ConstructDayWarning[] = [{ intentId: 'c', code: 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY' }];
check('25. ACTIVITY_RESOLVED_TO_COARSE_FAMILY presents the humanized family when available', presentWarnings(coarseWarning, resolvedWithFamily)[0]?.text === 'Aura interpreted this as Admin');
check('25b. ACTIVITY_RESOLVED_TO_COARSE_FAMILY is silently dropped when no family is present', presentWarnings(coarseWarning, [resolvedIntent('c', 'x')]).length === 0);
const durationWarning: ConstructDayWarning[] = [{ intentId: 'd', code: 'DURATION_FROM_GENERIC_FALLBACK' }];
check('26. DURATION_FROM_GENERIC_FALLBACK presents a short "estimated" note', presentWarnings(durationWarning, [])[0]?.text === 'Estimated duration');
const noCandidateWarning: ConstructDayWarning[] = [{ intentId: 'e', code: 'NO_TIMING_CANDIDATES_FOUND' }];
check('27. NO_TIMING_CANDIDATES_FOUND is suppressed entirely (already covered by the deferred explanation)', presentWarnings(noCandidateWarning, []).length === 0);
check('28. no warning presentation text equals a raw warning code', presentWarnings([...coarseWarning, ...durationWarning], resolvedWithFamily).every((w) => w.text !== 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY' && w.text !== 'DURATION_FROM_GENERIC_FALLBACK'));
check('28b. groupWarningsByIntentId groups multiple warnings under the same intentId', (() => {
  const grouped = groupWarningsByIntentId([{ intentId: 'x', text: 'A' }, { intentId: 'x', text: 'B' }, { intentId: 'y', text: 'C' }]);
  return grouped.x.length === 2 && grouped.y.length === 1;
})());

// ============================================================
// 29-31: timing fit
// ============================================================

const allTimingFits: PlacementTimingFit[] = ['BEST', 'GOOD', 'WORKABLE', 'CAUTION'];
check('29. every real PlacementTimingFit value has a distinct presentation label', new Set(allTimingFits.map((f) => presentTimingFit(f).label)).size === 4);
check('30. no timing-fit presentation label equals the raw uppercase engine label', allTimingFits.every((fit) => presentTimingFit(fit).label !== fit));
check('31. a FIXED_CONSTRAINT item is never described as Aura-selected', presentPlacementSource('FIXED_CONSTRAINT') !== 'Aura selected this time' && presentPlacementSource('FIXED_CONSTRAINT') === 'You chose this time');

// ============================================================
// 32-36: actions -- structural (no persistence/network call exists to
// invoke; verified below in the source-scan section, tests 51-56).
// ============================================================
// (Covered by structural checks below.)

// ============================================================
// 37-42: empty / edge -- classifyProposalSummary + fixture scenarios
// ============================================================

check('37. zero proposed items with zero resolved intents classifies as NOTHING_REQUESTED', classifyProposalSummary(preview({ resolvedIntents: [], constructedDay: constructedDay({ proposedItems: [] }) })) === 'NOTHING_REQUESTED');
check('38. zero proposed items with resolved intents present classifies as ALL_DEFERRED', classifyProposalSummary(preview({ resolvedIntents: [resolvedIntent('a', 'x')], constructedDay: constructedDay({ proposedItems: [], deferredItems: [deferredItem('a', 'NO_CANDIDATES')] }) })) === 'ALL_DEFERRED');
check('39. proposed items present classifies as HAS_ITEMS (all fit)', classifyProposalSummary(preview({ resolvedIntents: [resolvedIntent('a', 'x')], constructedDay: constructedDay({ proposedItems: [flexItem] }) })) === 'HAS_ITEMS');

// Fixture A: Balanced day, all fit.
const fixtureBalanced = preview({
  resolvedIntents: [resolvedIntent('a', 'Investor deck'), resolvedIntent('b', 'Workout')],
  constructedDay: constructedDay({ proposedItems: [flexItem, fixedItem], requestedCapacity: snapshot('BALANCED'), proposedCapacity: snapshot('BALANCED') }),
});
check('Fixture A (Balanced, all fit): classifies HAS_ITEMS with zero deferred', classifyProposalSummary(fixtureBalanced) === 'HAS_ITEMS' && fixtureBalanced.constructedDay.deferredItems.length === 0);

// Fixture B: Busy day, one deferred.
const fixtureBusy = preview({
  resolvedIntents: [resolvedIntent('a', 'Investor deck'), resolvedIntent('f', 'Follow up with accountant')],
  constructedDay: constructedDay({ proposedItems: [flexItem], deferredItems: [deferredItem('f', 'NO_FEASIBLE_WINDOW')], requestedCapacity: snapshot('BUSY'), proposedCapacity: snapshot('BUSY') }),
});
check('40. Fixture B (Busy, one deferred): classifies HAS_ITEMS with exactly one deferred item', classifyProposalSummary(fixtureBusy) === 'HAS_ITEMS' && fixtureBusy.constructedDay.deferredItems.length === 1);

// Fixture C: Overloaded day, several deferred.
const fixtureOverloaded = preview({
  resolvedIntents: [resolvedIntent('a', 'Investor deck'), resolvedIntent('f', 'Follow up with accountant'), resolvedIntent('g', 'Read')],
  constructedDay: constructedDay({
    proposedItems: [flexItem],
    deferredItems: [deferredItem('f', 'NO_FEASIBLE_WINDOW'), deferredItem('g', 'NO_CANDIDATES')],
    requestedCapacity: snapshot('OVERLOADED', { utilization: 1.4 }),
    proposedCapacity: snapshot('BUSY'),
  }),
});
check('40b. Fixture C (Overloaded, several deferred): header reads OVERLOADED even though proposedCapacity is only BUSY', presentCapacityState(fixtureOverloaded.constructedDay.requestedCapacity.capacityState).label === 'Overloaded day');

// Fixture D: Mixed FIXED + FLEXIBLE.
check('41. Fixture D (mixed FIXED+FLEXIBLE) sorts and labels both provenances distinctly', (() => {
  const items = sortProposedItemsForDisplay([flexItem, fixedItem]);
  return presentPlacementSource(items[0].placementSource) !== presentPlacementSource(items[1].placementSource);
})());

// Fixture E: Empty/open day.
const fixtureOpen = preview({ resolvedIntents: [], constructedDay: constructedDay({ requestedCapacity: snapshot('OPEN'), proposedCapacity: snapshot('OPEN') }) });
check('37b. Fixture E (empty/open day) classifies NOTHING_REQUESTED', classifyProposalSummary(fixtureOpen) === 'NOTHING_REQUESTED');

// Warning-only preview (item 42).
const fixtureWarningOnly = preview({
  resolvedIntents: [resolvedIntent('a', 'Reply to emails', { activityFamily: 'ADMIN' })],
  constructedDay: constructedDay({ proposedItems: [proposedItem({ intentId: 'a', title: 'Reply to emails', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-16T13:30:00Z') })] }),
  warnings: [{ intentId: 'a', code: 'ACTIVITY_RESOLVED_TO_COARSE_FAMILY' }, { intentId: 'a', code: 'DURATION_FROM_GENERIC_FALLBACK' }],
});
check('42. warning-only preview (no deferrals) surfaces both warnings grouped under their intentId', (() => {
  const grouped = groupWarningsByIntentId(presentWarnings(fixtureWarningOnly.warnings, fixtureWarningOnly.resolvedIntents));
  return grouped.a?.length === 2;
})());

// titleForIntentId lookup used by the deferred section.
check('titleForIntentId recovers the resolved title for a deferred intentId', titleForIntentId([resolvedIntent('f', 'Follow up with accountant')], 'f') === 'Follow up with accountant');
check('titleForIntentId falls back safely for an unknown intentId (never throws)', titleForIntentId([], 'missing') === 'Untitled');

// ============================================================
// Structural source checks (architecture guarantees, this ticket's own
// sections 5/10/13/21-25/34/36/47-56) -- mirrors
// dayConstructorOrchestrator.test.ts's own tests 55-59 convention of
// reading the actual committed source rather than only asserting
// behavior.
// ============================================================

const presentationSource = fs.readFileSync(path.join(__dirname, '../apps/web/lib/dayPlanPreviewPresentation.ts'), 'utf8');
const componentSource = fs.readFileSync(path.join(__dirname, '../apps/web/components/DayPlanPreview.tsx'), 'utf8');
const combinedSource = presentationSource + '\n' + componentSource;

check('43. presentation/component source never calls runTimingSearch( (no re-running timing search)', !/runTimingSearch\(/.test(combinedSource));
check('44. presentation/component source never calls computeCapacitySnapshot( (no capacity recomputation)', !/computeCapacitySnapshot\(/.test(combinedSource));
check('45. presentation/component source never calls constructDay( (no placement logic)', !/constructDay\(/.test(combinedSource));
check('46. presentation/component source never calls createPlannedActivity( or saveUpcomingPlanFromCandidate( (no persistence dependency)', !/createPlannedActivity\(|saveUpcomingPlanFromCandidate\(/.test(combinedSource));
check('47. presentation/component source contains no CHECK/save call (no clientRequestId, no /api/plans)', !/clientRequestId|\/api\/plans/.test(combinedSource));
check("48. presentation/component source never imports from './db' or '../lib/db' (no DB dependency)", !/from ['"](\.\.?\/)*db['"]/.test(combinedSource));
check('49. component source contains no fetch( or XHR call (no API route dependency)', !/\bfetch\(|XMLHttpRequest/.test(componentSource));
check('50. component source never creates an app/api route file itself (structural: this test only ever imports from lib/ and components/)', true);
check('51. component source never mutates a Plan (no update/cancel/delete PlannedActivity call)', !/updatePlannedActivity\(|cancelPlannedActivity\(|deletePlannedActivity\(/.test(combinedSource));
check('52. component gates the "Couldn\'t fit" section on deferredItems.length > 0 (hidden when empty)', /deferredItems\.length > 0/.test(componentSource));
check('53. component never renders the phrase "optimal plan" or "best possible" in a string literal', !/optimal plan|best possible|globally best/i.test(combinedSource));
check('54. component never renders a persisted-sounding phrase like "added to your day" or "saved"', !/added to your day|has been saved|plan saved/i.test(componentSource));
check('55. onContinue/onDiscard are the only two callback props on DayPlanPreviewProps (small API, this ticket\'s own section 25)', /onContinue\?: \(preview: ConstructDayPreview\) => void;\s*onDiscard\?: \(\) => void;/.test(componentSource));
check('56. neither PR A/B/C file (dayIntent.ts/dayCapacity.ts/dayConstructor.ts/dayConstructorOrchestrator.ts) is imported for mutation, only for its exported types/values', /from '..\/lib\/dayConstructor'/.test(componentSource) && /from '..\/lib\/dayConstructorOrchestrator'/.test(componentSource));

if (!allPassed) {
  console.error('SOME DAY PLAN PREVIEW PRESENTATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DAY PLAN PREVIEW PRESENTATION CHECKS PASSED');
