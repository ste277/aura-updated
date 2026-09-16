/**
 * Day Constructor V1 -- PR E3 presentation/state-machine adapters.
 *
 * Pure, DI-testable helpers for the acceptance UI wiring: turning an E2
 * `AcceptanceRejectionReason` into plain language, classifying a client
 * acceptance result into one of a small set of UI states, deciding
 * whether a submission should be allowed to proceed (double-submit
 * guard), and deciding whether a cached client-generated request id
 * should be kept or regenerated for a new preview. Kept separate from
 * any component, matching this repository's own established convention
 * (`dayPlanPreviewPresentation.ts`, `dayConstructorAcceptancePersistence.ts`)
 * of keeping every mapping/decision a plain function.
 */

import type { AcceptanceRejectionReason } from './dayConstructorAcceptance';
import type { AcceptConstructedDayClientResult } from './acceptConstructedDay';
import type { ConstructDayPreview } from './dayConstructorOrchestrator';

// ============================================================
// Rejection-reason copy (this ticket's own section 14) -- never a raw
// enum string, never more precision than the reason itself carries.
// ============================================================

export function presentAcceptanceRejectionReason(reason: AcceptanceRejectionReason): string {
  switch (reason) {
    case 'STALE_PREVIEW':
      return 'Your day changed since this plan was created.';
    case 'CONFLICT':
      return 'Something on your schedule changed since this plan was created.';
    case 'INVALID_ACTIVITY':
      return 'One of these activities is no longer available.';
    case 'TIMING_CHECK_FAILED':
      return "Aura couldn't confirm the timing for this plan.";
    case 'INVALID_REQUEST':
      return 'Your day changed since this plan was created.';
  }
}

// ============================================================
// UI state classification (this ticket's own section 10-17). Every real
// `AcceptConstructedDayClientResult` status maps to exactly one of five
// UI states -- STALE covers both REJECTED and IDEMPOTENCY_CONFLICT (this
// ticket's own section 15: "not an ordinary scheduling conflict... fail
// closed" -- same user-facing meaning as a stale preview: review again,
// never silently retried under a new id); FAILED covers every genuinely
// retryable failure (SAVE_FAILED, a network error, and a malformed/
// unrecognized response -- this ticket's own section 10's "Unknown/
// malformed response -> generic failure").
// ============================================================

export type DayPlanAcceptanceUiState =
  | { kind: 'IDLE' }
  | { kind: 'SAVING' }
  | { kind: 'SAVED' }
  | { kind: 'STALE'; message: string }
  | { kind: 'FAILED'; message: string };

export function classifyAcceptanceUiState(result: AcceptConstructedDayClientResult): DayPlanAcceptanceUiState {
  switch (result.status) {
    case 'SAVED':
    case 'ALREADY_ACCEPTED':
      // This ticket's own section 12: ALREADY_ACCEPTED is a successful
      // completion, identical UI treatment to SAVED -- never a duplicate
      // warning, never a second save under a new id.
      return { kind: 'SAVED' };
    case 'REJECTED':
      return { kind: 'STALE', message: presentAcceptanceRejectionReason(result.reason) };
    case 'IDEMPOTENCY_CONFLICT':
      return { kind: 'STALE', message: "We couldn't confirm this saved plan safely. Please refresh the plan and review it again." };
    case 'SAVE_FAILED':
      return { kind: 'FAILED', message: "We couldn't save your plan. Try again." };
    case 'NETWORK_ERROR':
      return { kind: 'FAILED', message: "We couldn't reach Aura. Check your connection and try again." };
    case 'UNKNOWN_RESPONSE':
      return { kind: 'FAILED', message: 'Something went wrong. Try again.' };
  }
}

// ============================================================
// Double-submission guard (this ticket's own section 9) -- the pure
// decision a controller consults before firing a new acceptance POST.
// Never allows a second submission while one is in flight, and never
// allows a resubmission once the proposal is already SAVED (this
// ticket's own section 19: "avoid leaving an active Continue button on
// an already-saved proposal").
// ============================================================

export function shouldSubmitAcceptance(actionState: DayPlanAcceptanceUiState): boolean {
  return actionState.kind !== 'SAVING' && actionState.kind !== 'SAVED';
}

/** This ticket's own section 23: a preview with zero proposed items must
 * never produce an acceptance POST, deferred items included or not --
 * only `constructedDay.proposedItems` (never `deferredItems`) counts. */
export function hasSubmittableProposal(preview: Pick<ConstructDayPreview, 'constructedDay'>): boolean {
  return preview.constructedDay.proposedItems.length > 0;
}

// ============================================================
// Preview identity (pre-commit review hardening -- this ticket's own
// section 1/2/3/4). Object-reference comparison was too narrow: a
// deep-equal preview rebuilt as a NEW object (e.g. a retry after a lost
// network response that re-runs the same orchestration) would previously
// look like a genuinely different proposal and mint a needless new
// clientRequestId. `computePreviewIdentityKey` instead canonicalizes
// exactly the acceptance-RELEVANT facts -- the same facts
// `buildAcceptRequestBody` (acceptConstructedDay.ts) actually sends to
// E2 -- into one deterministic string; `resolveClientRequestId` below
// compares THAT string, never the preview object itself.
//
// previewIdentityKey is NOT authentication, authorization, server
// idempotency, or a persistence identifier (this ticket's own section
// 5) -- it is purely a client-local "is this still the same reviewed
// proposal" cache key. The random `clientRequestId` (crypto.randomUUID(),
// generated by the caller, never derived from this key) remains the
// ONLY identity E2's own idempotency mechanism ever sees.
//
// FIELD SELECTION (this ticket's own section 3): the full
// `constructionWindow` object (its own `date`/`start`/`end`/`timezone`/
// `source` -- exactly what `buildAcceptRequestBody` sends verbatim), and
// per proposed item: `intentId`/`activityId`/`title`/`start`/`end`/
// `placementSource`. Deliberately excludes `timingFit`/`candidateOrder`/
// `requiresConfirmation` (presentation/ranking artifacts -- E1's own
// `AcceptedProposedItem` contract already excludes them, see
// dayConstructorAcceptance.ts's own doc comment) and everything outside
// `constructedDay.proposedItems` entirely (`deferredItems`, `warnings`,
// `requestedCapacity`/`proposedCapacity`) -- none of those change which
// Plans would be created.
//
// ORDERING (this ticket's own section 4, audited fresh against the real
// E1/E2 source before choosing): proposed-item ARRAY ORDER is
// semantically irrelevant to both. E1's own `evaluateAcceptance`
// validates every item independently (structural/staleness/activity/
// blocker/timing checks never consult array position; the one pairwise
// check, internal-overlap, is symmetric over every {i,j} pair regardless
// of order) and its own `writeIntents` are re-sorted chronologically by
// `plannedStartAt` before being returned, discarding input order
// entirely. E2's own replay/collision classification
// (dayConstructorAcceptancePersistence.ts's `keySetsAreEqual`) compares
// the claim key SET via a `Set`, not an array -- also order-independent
// by construction. Since the ACCEPTED PLAN SET is therefore identical
// regardless of submission order, items are canonicalized by sorting on
// `intentId` (stable and unique within one proposal -- E1 itself rejects
// a duplicate intentId) rather than preserving submission order, so two
// semantically-identical proposals whose items happen to arrive in a
// different array order still resolve to the SAME identity key.
//
// NORMALIZATION: `start`/`end` -> `toISOString()` (unambiguous, timezone-
// stable); `activityId` -> `?? null` (undefined and null both normalize
// to the identical `null`, matching E1's own `?? null` convention
// elsewhere); the whole canonical structure is passed through
// `JSON.stringify` on a literal object whose own key order is fixed by
// this source file (never built from incidental property-insertion
// order on an external object).
// ============================================================

interface CanonicalProposedItem {
  intentId: string;
  activityId: string | null;
  title: string;
  start: string;
  end: string;
  placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE';
}

export function computePreviewIdentityKey(preview: Pick<ConstructDayPreview, 'constructionWindow' | 'constructedDay'>): string {
  const window = preview.constructionWindow;
  const items: CanonicalProposedItem[] = preview.constructedDay.proposedItems
    .map((item) => ({
      intentId: item.intentId,
      activityId: item.activityId ?? null,
      title: item.title,
      start: item.start.toISOString(),
      end: item.end.toISOString(),
      placementSource: item.placementSource,
    }))
    .sort((a, b) => (a.intentId < b.intentId ? -1 : a.intentId > b.intentId ? 1 : 0));
  return JSON.stringify({
    constructionWindow: { date: window.date, start: window.start.toISOString(), end: window.end.toISOString(), timezone: window.timezone, source: window.source },
    proposedItems: items,
  });
}

// ============================================================
// Client-request-id lifecycle cache (this ticket's own section 7/8) --
// keyed by `previewIdentityKey` (a plain string) rather than the preview
// object itself, so a genuinely new object representing the SAME
// reviewed proposal reuses the same id, while any acceptance-relevant
// change mints a new one. Kept as a pure function so the identity-change
// decision is directly testable without a React renderer; a component
// applies it via a plain mutable ref cache during render (React's own
// documented pattern for deriving state from a changed input without an
// extra Effect-driven render).
// ============================================================

export interface ClientRequestIdCache {
  identityKey: string;
  clientRequestId: string;
}

export function resolveClientRequestId(previous: ClientRequestIdCache | null, currentIdentityKey: string, generateId: () => string): ClientRequestIdCache {
  if (previous && previous.identityKey === currentIdentityKey) return previous;
  return { identityKey: currentIdentityKey, clientRequestId: generateId() };
}
