/**
 * Plan My Day -- single-item time editing, PREVIEW-STATE adapter.
 *
 * `DayPlanPreviewController.tsx` owns `preview: ConstructDayPreview` only
 * by holding the reference its PARENT (`PlanDayClient.tsx`) handed it --
 * it is not the state's owner. When a single proposed item's time is
 * successfully re-signed (`dayConstructorPreviewItemClient.ts`'s own
 * `UpdatedPreviewItem`), the WHOLE preview still has to be replaced by a
 * new object for React to re-render -- `applyUpdatedProposedItem` is that
 * one, pure, directly-testable transformation, kept separate from any
 * component exactly like this repository's other preview-state adapters
 * (`dayPlanAcceptancePresentation.ts`).
 *
 * Never mutates its input. Replaces ONLY the one proposed item whose
 * `intentId` matches -- every other proposed item, every deferred item,
 * every warning, and the construction window are passed through by
 * reference, unchanged (this is the same "only the acceptance-relevant
 * facts change identity" discipline `computePreviewIdentityKey`'s own doc
 * comment already establishes for the whole preview; here it is applied
 * to exactly one item).
 */

import type { ConstructDayPreview } from './dayConstructorOrchestrator';
import type { ProposedItem } from './dayConstructor';
import type { UpdatePreviewItemTimeClientResult, UpdatedPreviewItem } from './dayConstructorPreviewItemClient';

/**
 * Returns a NEW `ConstructDayPreview` with `updatedItem` substituted for
 * the proposed item that shares its `intentId`. If no proposed item has
 * that `intentId` (should never happen through the real UI -- the item
 * being edited always came from this same preview's own `proposedItems`
 * -- but defensively checked rather than assumed), the input preview is
 * returned completely unchanged rather than silently appending a new row.
 */
export function applyUpdatedProposedItem(preview: ConstructDayPreview, updatedItem: UpdatedPreviewItem): ConstructDayPreview {
  const items = preview.constructedDay.proposedItems;
  const index = items.findIndex((item) => item.intentId === updatedItem.intentId);
  if (index === -1) return preview;
  const nextItems = items.slice();
  nextItems[index] = updatedItem;
  return { ...preview, constructedDay: { ...preview.constructedDay, proposedItems: nextItems } };
}

/** Plain-language copy for a `REJECTED`/`HTTP_ERROR`/`NETWORK_ERROR`/
 * `UNKNOWN_RESPONSE` result -- never more precision than the result
 * itself carries, matching `dayPlanAcceptancePresentation.ts`'s own
 * `presentAcceptanceRejectionReason` convention. Returns `null` for
 * `UPDATED` (a caller never needs rejection copy for a success). */
export function presentPreviewItemUpdateFailure(result: UpdatePreviewItemTimeClientResult): string | null {
  switch (result.status) {
    case 'UPDATED':
      return null;
    case 'REJECTED':
      switch (result.reason) {
        case 'STALE_PREVIEW':
          return 'That time is outside the planned window.';
        case 'UNAVAILABLE':
          return 'That time conflicts with something else on your schedule.';
        case 'TIMING_CHECK_FAILED':
          return "Aura couldn't confirm that timing. Try again.";
        case 'INVALID_REQUEST':
          return 'Your day changed since this plan was created. Try reviewing again.';
      }
      break;
    case 'HTTP_ERROR':
      return 'Something went wrong. Try again.';
    case 'NETWORK_ERROR':
      return "We couldn't reach Aura. Check your connection and try again.";
    case 'UNKNOWN_RESPONSE':
      return 'Something went wrong. Try again.';
  }
}

/** The only extra field this module (or `EditProposedItemTimeModal.tsx`)
 * ever reads off an otherwise-plain `ProposedItem` -- the server-signed
 * token the preview response attaches to every proposed item (the
 * signing module's own `signPreviewResultBody`, untouched by this
 * ticket). Mirrors `acceptConstructedDay.ts`'s own identical inline cast
 * for the SAME field; not a second convention. */
export function readAcceptanceToken(item: ProposedItem): string | undefined {
  return (item as { acceptanceToken?: string }).acceptanceToken;
}
