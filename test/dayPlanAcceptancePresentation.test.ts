/**
 * Day Constructor V1 -- PR E3 presentation/state-machine regression
 * suite. Exercises `dayPlanAcceptancePresentation.ts`'s pure functions
 * directly: rejection-reason copy, UI-state classification, the
 * double-submit guard, the zero-proposal guard, and the client-request-id
 * lifecycle decision. No DOM, no React renderer -- same convention as
 * every other presentation-adapter suite in this repository.
 */
import {
  presentAcceptanceRejectionReason,
  classifyAcceptanceUiState,
  shouldSubmitAcceptance,
  hasSubmittableProposal,
  resolveClientRequestId,
  computePreviewIdentityKey,
} from '../apps/web/lib/dayPlanAcceptancePresentation';
import type { AcceptanceRejectionReason } from '../apps/web/lib/dayConstructorAcceptance';
import type { AcceptConstructedDayClientResult } from '../apps/web/lib/acceptConstructedDay';
import type { ConstructDayPreview, ResolvedIntentSummary, ConstructDayWarning } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ConstructedDay, ProposedItem } from '../apps/web/lib/dayConstructor';
import type { CapacitySnapshot, CapacityState } from '../apps/web/lib/dayCapacity';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function iso(s: string): Date {
  return new Date(s);
}

function snapshot(capacityState: CapacityState = 'OPEN'): CapacitySnapshot {
  return { constructionWindowMinutes: 480, blockedMinutes: 0, usableMinutes: 480, requestedMinutes: 0, remainingMinutes: 480, utilization: 0, capacityState };
}

function proposedItem(overrides: Partial<ProposedItem> & { intentId: string; start: Date; end: Date }): ProposedItem {
  return { title: 'Untitled', placementSource: 'FIXED_CONSTRAINT', requiresConfirmation: true, ...overrides };
}

/** Full `ConstructDayPreview` fixture -- deliberately built via a plain
 * object literal (never reused by reference) each call, so two calls
 * with equivalent arguments naturally produce deep-equal-but-different
 * objects, exactly the "deep-cloned equivalent proposal" scenario this
 * ticket's own section 6 asks for. */
function fullPreview(overrides: {
  windowStart?: string;
  windowEnd?: string;
  items?: ProposedItem[];
  capacityState?: CapacityState;
  warnings?: ConstructDayWarning[];
  deferredCount?: number;
} = {}): ConstructDayPreview {
  const items = overrides.items ?? [proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' })];
  const resolvedIntents: ResolvedIntentSummary[] = items.map((item) => ({
    requestedIntentId: item.intentId,
    dayIntent: { id: item.intentId, title: item.title, targetDate: '2026-09-16', importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0 },
  }));
  return {
    targetDate: '2026-09-16',
    timezone: 'America/New_York',
    constructionWindow: { date: '2026-09-16', start: iso(overrides.windowStart ?? '2026-09-16T13:00:00Z'), end: iso(overrides.windowEnd ?? '2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' },
    resolvedIntents,
    constructedDay: {
      date: '2026-09-16',
      proposedItems: items,
      deferredItems: Array.from({ length: overrides.deferredCount ?? 0 }, (_, i) => ({ intentId: `deferred-${i}`, primaryReason: 'NO_CANDIDATES' as const, diagnostics: [] })),
      conflicts: [],
      requestedCapacity: snapshot(overrides.capacityState ?? 'OPEN'),
      proposedCapacity: snapshot(overrides.capacityState ?? 'OPEN'),
    },
    warnings: overrides.warnings ?? [],
  };
}

function constructedDay(proposedItemsCount: number): { constructedDay: ConstructedDay } {
  return {
    constructedDay: {
      date: '2026-09-16',
      proposedItems: Array.from({ length: proposedItemsCount }, (_, i) => ({ intentId: `i${i}`, title: 't', start: new Date(), end: new Date(), placementSource: 'FIXED_CONSTRAINT' as const, requiresConfirmation: true as const })),
      deferredItems: [],
      conflicts: [],
      requestedCapacity: snapshot(),
      proposedCapacity: snapshot(),
    },
  };
}

// ============================================================
// Rejection-reason copy
// ============================================================

const allReasons: AcceptanceRejectionReason[] = ['INVALID_REQUEST', 'STALE_PREVIEW', 'INVALID_ACTIVITY', 'CONFLICT', 'TIMING_CHECK_FAILED'];
check('1. every real AcceptanceRejectionReason maps to non-empty, non-enum text', allReasons.every((r) => { const t = presentAcceptanceRejectionReason(r); return t.length > 0 && t !== r; }));
check('2. STALE_PREVIEW maps to the "day changed" copy', presentAcceptanceRejectionReason('STALE_PREVIEW').includes('changed since this plan was created'));
check('3. CONFLICT maps to a distinct schedule-changed message', presentAcceptanceRejectionReason('CONFLICT').toLowerCase().includes('schedule'));
check('4. INVALID_ACTIVITY maps to an activity-specific message', presentAcceptanceRejectionReason('INVALID_ACTIVITY').toLowerCase().includes('activit'));
check('5. TIMING_CHECK_FAILED maps to a timing-specific message', presentAcceptanceRejectionReason('TIMING_CHECK_FAILED').toLowerCase().includes('timing'));

// ============================================================
// UI-state classification (this ticket's own section 10-17/35)
// ============================================================

check('6. SAVED classifies as SAVED', classifyAcceptanceUiState({ status: 'SAVED', plans: [] }).kind === 'SAVED');
check('7. ALREADY_ACCEPTED classifies as SAVED (identical treatment, this ticket\'s own section 12)', classifyAcceptanceUiState({ status: 'ALREADY_ACCEPTED', plans: [] }).kind === 'SAVED');
check('8. REJECTED classifies as STALE, carrying human-readable copy', (() => {
  const s = classifyAcceptanceUiState({ status: 'REJECTED', reason: 'STALE_PREVIEW', diagnostics: [] });
  return s.kind === 'STALE' && s.message.length > 0;
})());
check('9. IDEMPOTENCY_CONFLICT classifies as STALE (fail closed, this ticket\'s own section 15), never as an ordinary conflict', classifyAcceptanceUiState({ status: 'IDEMPOTENCY_CONFLICT' }).kind === 'STALE');
check('10. SAVE_FAILED classifies as FAILED (retryable)', classifyAcceptanceUiState({ status: 'SAVE_FAILED' }).kind === 'FAILED');
check('11. NETWORK_ERROR classifies as FAILED (retryable)', classifyAcceptanceUiState({ status: 'NETWORK_ERROR' }).kind === 'FAILED');
check('12. UNKNOWN_RESPONSE classifies as FAILED (generic failure, this ticket\'s own section 10)', classifyAcceptanceUiState({ status: 'UNKNOWN_RESPONSE' }).kind === 'FAILED');
check('13. every real AcceptConstructedDayClientResult status is handled (no silent fallthrough)', (() => {
  const statuses: AcceptConstructedDayClientResult['status'][] = ['SAVED', 'ALREADY_ACCEPTED', 'REJECTED', 'IDEMPOTENCY_CONFLICT', 'SAVE_FAILED', 'NETWORK_ERROR', 'UNKNOWN_RESPONSE'];
  return statuses.every((status) => {
    const result = status === 'SAVED' || status === 'ALREADY_ACCEPTED' ? { status, plans: [] } : status === 'REJECTED' ? { status, reason: 'CONFLICT' as const, diagnostics: [] } : { status };
    return ['IDLE', 'SAVING', 'SAVED', 'STALE', 'FAILED'].includes(classifyAcceptanceUiState(result as AcceptConstructedDayClientResult).kind);
  });
})());

// ============================================================
// Double-submit guard (this ticket's own section 9/34)
// ============================================================

check('14. IDLE allows submission', shouldSubmitAcceptance({ kind: 'IDLE' }));
check('15. SAVING blocks a second submission (in-flight guard)', !shouldSubmitAcceptance({ kind: 'SAVING' }));
check('16. SAVED blocks resubmission (no accidental resave, this ticket\'s own section 19)', !shouldSubmitAcceptance({ kind: 'SAVED' }));
check('17. STALE allows a fresh submission after review-again produces a new preview', shouldSubmitAcceptance({ kind: 'STALE', message: 'x' }));
check('18. FAILED allows retry', shouldSubmitAcceptance({ kind: 'FAILED', message: 'x' }));

// ============================================================
// Zero-proposal guard (this ticket's own section 23/36)
// ============================================================

check('19. a preview with proposed items is submittable', hasSubmittableProposal(constructedDay(2)));
check('20. a preview with zero proposed items is NOT submittable', !hasSubmittableProposal(constructedDay(0)));

// ============================================================
// Client-request-id lifecycle -- IDENTITY-KEY based (pre-commit review
// hardening, this ticket's own section 1/2/6/7/8/34). `resolveClientRequestId`
// itself is now a generic string-keyed cache; `computePreviewIdentityKey`
// is what decides "same reviewed proposal or not," tested exhaustively
// below against every acceptance-relevant field, and against every
// explicitly-irrelevant one.
// ============================================================

check('21. no cached id yet: generates a fresh id for the current identity key', (() => {
  const cache = resolveClientRequestId(null, 'key-1', () => 'generated-1');
  return cache.clientRequestId === 'generated-1' && cache.identityKey === 'key-1';
})());
check('22. same identity key on a retry: reuses the SAME cached id, never regenerates', (() => {
  let calls = 0;
  const generate = () => `id-${++calls}`;
  const first = resolveClientRequestId(null, 'key-1', generate);
  const second = resolveClientRequestId(first, 'key-1', generate);
  return first.clientRequestId === second.clientRequestId && calls === 1;
})());
check('23. a different identity key: generates a NEW id', (() => {
  let calls = 0;
  const generate = () => `id-${++calls}`;
  const first = resolveClientRequestId(null, 'key-a', generate);
  const second = resolveClientRequestId(first, 'key-b', generate);
  return first.clientRequestId !== second.clientRequestId && calls === 2;
})());

// ---- computePreviewIdentityKey itself (this ticket's own section 6) ----

check('24. same object: identical identity key (trivially, by reference-independence)', computePreviewIdentityKey(fullPreview()) === computePreviewIdentityKey(fullPreview())); // two SEPARATE fullPreview() calls with identical arguments -- see next test for the explicit version of this.
check('25. deep-cloned equivalent proposal (different object, same acceptance-relevant content): SAME identity key', (() => {
  const a = fullPreview();
  const b = JSON.parse(JSON.stringify(a), (key, value) => (key === 'start' || key === 'end' ? new Date(value) : value)) as ConstructDayPreview;
  return computePreviewIdentityKey(a) === computePreviewIdentityKey(b);
})());
check('26. presentation-only warning change: SAME identity key', computePreviewIdentityKey(fullPreview()) === computePreviewIdentityKey(fullPreview({ warnings: [{ intentId: 'a', code: 'DURATION_FROM_GENERIC_FALLBACK' }] })));
check('27. capacity-state-only change: SAME identity key', computePreviewIdentityKey(fullPreview()) === computePreviewIdentityKey(fullPreview({ capacityState: 'OVERLOADED' })));
check('28. deferred-items-only change: SAME identity key', computePreviewIdentityKey(fullPreview()) === computePreviewIdentityKey(fullPreview({ deferredCount: 3 })));
check('29. constructionWindow change: NEW identity key', computePreviewIdentityKey(fullPreview()) !== computePreviewIdentityKey(fullPreview({ windowEnd: '2026-09-17T10:00:00Z' })));
check(
  '30. proposed start change: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(fullPreview({ items: [proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:15:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' })] }))
);
check(
  '31. proposed end/duration change: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(fullPreview({ items: [proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:30:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' })] }))
);
check(
  '32. title change: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(fullPreview({ items: [proposedItem({ intentId: 'a', title: 'Finish investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' })] }))
);
check(
  '33. activityId change: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(fullPreview({ items: [proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'other_activity' })] }))
);
check(
  '34. placementSource change: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(fullPreview({ items: [proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'FIXED_CONSTRAINT' })] }))
);
check(
  '35. proposed item added: NEW identity key',
  computePreviewIdentityKey(fullPreview()) !==
    computePreviewIdentityKey(
      fullPreview({
        items: [
          proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' }),
          proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T17:00:00Z'), placementSource: 'FIXED_CONSTRAINT' }),
        ],
      })
    )
);
check('36. proposed item removed: NEW identity key', computePreviewIdentityKey(fullPreview()) !== computePreviewIdentityKey(fullPreview({ items: [] })));
check('37. network failure + equivalent reconstructed preview: SAME identity key (retry resolves to the same cached clientRequestId)', (() => {
  const original = fullPreview();
  const reconstructedAfterNetworkFailure = fullPreview(); // a fresh orchestration re-run producing an equivalent proposal.
  const generate = () => 'stable-id';
  const beforeFailure = resolveClientRequestId(null, computePreviewIdentityKey(original), generate);
  const afterRetry = resolveClientRequestId(beforeFailure, computePreviewIdentityKey(reconstructedAfterNetworkFailure), generate);
  return beforeFailure.clientRequestId === afterRetry.clientRequestId;
})());
check('38. proposed items in a different array order (same set): SAME identity key (order-independent canonicalization, this ticket\'s own section 4)', (() => {
  const itemA = proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z'), placementSource: 'SELECTED_CANDIDATE', activityId: 'deep_work' });
  const itemB = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T16:00:00Z'), end: iso('2026-09-16T17:00:00Z'), placementSource: 'FIXED_CONSTRAINT' });
  return computePreviewIdentityKey(fullPreview({ items: [itemA, itemB] })) === computePreviewIdentityKey(fullPreview({ items: [itemB, itemA] }));
})());
check('39. activityId undefined vs. explicit null normalize to the SAME identity key', (() => {
  const withUndefined = proposedItem({ intentId: 'a', title: 'Reply to emails', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:30:00Z'), placementSource: 'FIXED_CONSTRAINT', activityId: undefined });
  const withNull = proposedItem({ intentId: 'a', title: 'Reply to emails', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T14:30:00Z'), placementSource: 'FIXED_CONSTRAINT', activityId: null as unknown as string });
  return computePreviewIdentityKey(fullPreview({ items: [withUndefined] })) === computePreviewIdentityKey(fullPreview({ items: [withNull] }));
})());

// ============================================================
// Structural checks on the owning controller (this ticket's own section
// 36) -- read the actual committed source, matching this repository's
// own established convention (dayConstructorOrchestrator.test.ts's own
// tests 55-59) for verifying a "never calls X" boundary that unit tests
// over the pure functions alone cannot observe.
// ============================================================

const fs = require('fs');
const path = require('path');
const controllerSource: string = fs.readFileSync(path.join(__dirname, '../apps/web/components/DayPlanPreviewController.tsx'), 'utf8');

check('40. the controller never references /api/plans anywhere (no fallback persistence path, this ticket\'s own section 36)', !/\/api\/plans/.test(controllerSource));
check('41. the controller never calls createPlannedActivity/saveUpcomingPlanFromCandidate directly', !/createPlannedActivity\(|saveUpcomingPlanFromCandidate\(/.test(controllerSource));
check(
  '42. onDiscard is passed straight through to DayPlanPreview without ever being wrapped in the submit/accept flow (Discard produces zero acceptance POSTs)',
  /onDiscard=\{onDiscard\}/.test(controllerSource) && !/onDiscard=\{submit\}/.test(controllerSource) && !/onDiscard=\{\(\) => submit/.test(controllerSource)
);
check('43. acceptConstructedDay is only ever invoked from within the submit function (single call site)', (controllerSource.match(/acceptConstructedDay\(/g) ?? []).length === 1);
check('44. constructDay/runTimingSearch/orchestrateConstructDay are never called from the controller (no reconstruction)', !/constructDay\(|runTimingSearch\(|orchestrateConstructDay\(/.test(controllerSource));

if (!allPassed) {
  console.error('SOME DAY PLAN ACCEPTANCE PRESENTATION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL DAY PLAN ACCEPTANCE PRESENTATION CHECKS PASSED');
