/**
 * Plan My Day -- single-item time editing PREVIEW-STATE regression
 * suite. Exercises `applyUpdatedProposedItem`/`presentPreviewItemUpdateFailure`/
 * `readAcceptanceToken` (dayPlanPreviewItemEditing.ts) entirely through
 * plain JS values -- no DOM, no React renderer, same convention as
 * `dayPlanAcceptancePresentation.test.ts`.
 */
import { applyUpdatedProposedItem, presentPreviewItemUpdateFailure, readAcceptanceToken } from '../apps/web/lib/dayPlanPreviewItemEditing';
import type { UpdatedPreviewItem, UpdatePreviewItemTimeClientResult } from '../apps/web/lib/dayConstructorPreviewItemClient';
import type { ConstructDayPreview, ResolvedIntentSummary } from '../apps/web/lib/dayConstructorOrchestrator';
import type { ProposedItem } from '../apps/web/lib/dayConstructor';
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

function preview(items: ProposedItem[]): ConstructDayPreview {
  const resolvedIntents: ResolvedIntentSummary[] = items.map((item) => ({
    requestedIntentId: item.intentId,
    dayIntent: { id: item.intentId, title: item.title, targetDate: '2026-09-16', importance: 'MEDIUM', flexibility: 'FLEXIBLE', source: 'USER_TYPED', originalOrder: 0 },
  }));
  return {
    targetDate: '2026-09-16',
    timezone: 'America/New_York',
    constructionWindow: { date: '2026-09-16', start: iso('2026-09-16T13:00:00Z'), end: iso('2026-09-17T04:00:00Z'), timezone: 'America/New_York', source: 'EXPLICIT_RANGE' },
    resolvedIntents,
    constructedDay: {
      date: '2026-09-16',
      proposedItems: items,
      deferredItems: [],
      conflicts: [],
      requestedCapacity: snapshot(),
      proposedCapacity: snapshot(),
    },
    warnings: [],
  };
}

function updatedItem(overrides: Partial<UpdatedPreviewItem> & { intentId: string }): UpdatedPreviewItem {
  return {
    title: 'Untitled',
    placementSource: 'SELECTED_CANDIDATE',
    requiresConfirmation: true,
    start: iso('2026-09-16T16:00:00Z'),
    end: iso('2026-09-16T17:00:00Z'),
    acceptanceToken: 'new-token',
    ...overrides,
  };
}

function main() {
  // ============================================================
  // applyUpdatedProposedItem (1-9)
  // ============================================================
  {
    const itemA = proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') });
    const itemB = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T17:00:00Z'), end: iso('2026-09-16T17:30:00Z') });
    const original = preview([itemA, itemB]);
    const replacement = updatedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T18:00:00Z'), end: iso('2026-09-16T19:00:00Z'), acceptanceToken: 'fresh-token' });
    const next = applyUpdatedProposedItem(original, replacement);

    check('1. returns a NEW ConstructDayPreview object, never the same reference', next !== original);
    check('2. returns a NEW constructedDay object', next.constructedDay !== original.constructedDay);
    check('3. returns a NEW proposedItems array', next.constructedDay.proposedItems !== original.constructedDay.proposedItems);
    check('4. the matching item (by intentId) is replaced with the server-returned item', next.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T18:00:00Z').getTime());
    check('5. the replaced item carries its NEW acceptanceToken', (next.constructedDay.proposedItems[0] as { acceptanceToken?: string }).acceptanceToken === 'fresh-token');
    check('6. the non-matching item is passed through by REFERENCE, completely untouched', next.constructedDay.proposedItems[1] === itemB);
    check('7. array order is preserved (edited item stays at its original index)', next.constructedDay.proposedItems[0].intentId === 'a' && next.constructedDay.proposedItems[1].intentId === 'b');
    check('8. the ORIGINAL preview object is never mutated', original.constructedDay.proposedItems[0].start.getTime() === iso('2026-09-16T14:00:00Z').getTime());
    check('9. constructionWindow/resolvedIntents/warnings/timezone pass through unchanged', next.constructionWindow === original.constructionWindow && next.timezone === original.timezone && next.resolvedIntents === original.resolvedIntents);
  }

  // ============================================================
  // applyUpdatedProposedItem -- no matching intentId (10-11)
  // ============================================================
  {
    const original = preview([proposedItem({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })]);
    const result = applyUpdatedProposedItem(original, updatedItem({ intentId: 'does-not-exist' }));
    check('10. an updated item with no matching intentId returns the ORIGINAL preview unchanged', result === original);
    check('11. the original single item is still present and untouched', result.constructedDay.proposedItems.length === 1 && result.constructedDay.proposedItems[0].intentId === 'a');
  }

  // ============================================================
  // applyUpdatedProposedItem -- sibling ISOLATION, strengthened for the
  // PR #281 P0 fix (section 5). Check 6 above already proves reference
  // equality for the untouched sibling; that alone would NOT catch a bug
  // that mutated the sibling's own fields in place while happening to
  // keep the same object reference. These checks inspect the sibling's
  // actual field VALUES after the call, which would catch either failure
  // mode. (22-23)
  // ============================================================
  {
    const itemA = proposedItem({ intentId: 'a', title: 'Investor deck', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') });
    const itemB = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T17:00:00Z'), end: iso('2026-09-16T17:30:00Z') });
    const itemBSnapshot = { title: itemB.title, start: itemB.start.getTime(), end: itemB.end.getTime(), placementSource: itemB.placementSource };
    const original = preview([itemA, itemB]);
    applyUpdatedProposedItem(original, updatedItem({ intentId: 'a', title: 'Investor deck -- retitled', start: iso('2026-09-16T18:00:00Z'), end: iso('2026-09-16T19:00:00Z') }));
    check(
      '22. an unrelated sibling\'s own fields are byte-identical after the call (catches an IN-PLACE mutation even if reference equality coincidentally held)',
      itemB.title === itemBSnapshot.title && itemB.start.getTime() === itemBSnapshot.start && itemB.end.getTime() === itemBSnapshot.end && itemB.placementSource === itemBSnapshot.placementSource
    );
  }
  {
    // Replacing a sibling with a wholesale NEW object that merely LOOKS the
    // same (different reference, identical-looking content) must also be
    // caught -- this is the counterpart check 6 already covers via `===`,
    // restated explicitly here as the positive half of the pairing this
    // ticket's section 5 asks for.
    const itemA = proposedItem({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') });
    const itemB = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T17:00:00Z'), end: iso('2026-09-16T17:30:00Z') });
    const original = preview([itemA, itemB]);
    const next = applyUpdatedProposedItem(original, updatedItem({ intentId: 'a' }));
    const rebuiltLookalike = proposedItem({ intentId: 'b', title: 'Workout', start: iso('2026-09-16T17:00:00Z'), end: iso('2026-09-16T17:30:00Z') });
    check(
      '23. an unrelated sibling is the exact SAME object, not merely a same-looking replacement (a wholesale rebuild, even value-identical, would fail this)',
      next.constructedDay.proposedItems[1] === itemB && next.constructedDay.proposedItems[1] !== rebuiltLookalike
    );
  }

  // ============================================================
  // presentPreviewItemUpdateFailure (12-19)
  // ============================================================
  check('12. UPDATED has no failure copy', presentPreviewItemUpdateFailure({ status: 'UPDATED', item: updatedItem({ intentId: 'a' }) }) === null);
  check('13. STALE_PREVIEW gets window-specific copy', presentPreviewItemUpdateFailure({ status: 'REJECTED', reason: 'STALE_PREVIEW' }) === 'That time is outside the planned window.');
  check('14. UNAVAILABLE gets conflict-specific copy', presentPreviewItemUpdateFailure({ status: 'REJECTED', reason: 'UNAVAILABLE' }) === 'That time conflicts with something else on your schedule.');
  check('15. TIMING_CHECK_FAILED gets a retry-oriented message', presentPreviewItemUpdateFailure({ status: 'REJECTED', reason: 'TIMING_CHECK_FAILED' }) === "Aura couldn't confirm that timing. Try again.");
  check('16. INVALID_REQUEST gets the same "day changed" copy the acceptance flow already uses', presentPreviewItemUpdateFailure({ status: 'REJECTED', reason: 'INVALID_REQUEST' }) === 'Your day changed since this plan was created. Try reviewing again.');
  check('17. HTTP_ERROR gets a generic retry message', presentPreviewItemUpdateFailure({ status: 'HTTP_ERROR', httpStatus: 500 } as UpdatePreviewItemTimeClientResult) === 'Something went wrong. Try again.');
  check('18. NETWORK_ERROR gets a connection-specific message', presentPreviewItemUpdateFailure({ status: 'NETWORK_ERROR' }) === "We couldn't reach Aura. Check your connection and try again.");
  check('19. UNKNOWN_RESPONSE gets a generic retry message', presentPreviewItemUpdateFailure({ status: 'UNKNOWN_RESPONSE' }) === 'Something went wrong. Try again.');

  // ============================================================
  // readAcceptanceToken (20-21)
  // ============================================================
  check('20. reads an acceptanceToken attached to an otherwise-plain ProposedItem', readAcceptanceToken({ ...proposedItem({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') }), acceptanceToken: 'tok-123' } as ProposedItem) === 'tok-123');
  check('21. returns undefined when no token is present (never throws, never fabricates one)', readAcceptanceToken(proposedItem({ intentId: 'a', start: iso('2026-09-16T14:00:00Z'), end: iso('2026-09-16T15:00:00Z') })) === undefined);

  if (!allPassed) {
    console.error('\nSome Day Plan Preview Item Editing checks FAILED.');
    process.exit(1);
  } else {
    console.log('\nALL DAY PLAN PREVIEW ITEM EDITING CHECKS PASSED');
  }
}

main();
