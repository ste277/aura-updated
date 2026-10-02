/**
 * Goals V2 Candidate A3.4 -- verified automatic Goal provenance.
 *
 * Closes the one remaining client-trust gap A3's own architecture audit
 * identified: for an automatic Goal suggestion (an intentId in the
 * reserved `goal-demand:<planningLocalDate>:<goalActivityId>` namespace),
 * ownership validation alone only answers "does this GoalActivity belong
 * to this user" -- never "is this the GoalActivity the server actually
 * associated with this specific accepted item." This file makes the
 * ALREADY-VERIFIED intentId (not the browser's own unsigned
 * `goalActivityLinks` sibling map) the sole authority for automatic
 * provenance.
 *
 * TRUST ORDER (this ticket's own section 3, non-negotiable):
 *
 *   raw acceptance request
 *     -> verifyAcceptanceItems (the existing preview-signature-verification module, UNMODIFIED)
 *     -> verified AcceptedProposedItem[] + the SAME verified constructionWindow.date
 *     -> authorizeGoalActivityLinks (THIS FILE, called only AFTER the line above)
 *     -> authorized goalActivityLinks
 *     -> persistAcceptedConstructedDay (dayConstructorAcceptancePersistence.ts, UNMODIFIED)
 *
 * A syntactically valid `goal-demand:...` string carries ZERO authority
 * on its own -- `classifyGoalDemandIntentId` (goalDemandIntentId.ts) is
 * only ever called here, on items the caller (accept/route.ts) has
 * ALREADY run through `verifyAcceptanceItems` with zero diagnostics.
 * Re-read, confirmed by direct source inspection rather than assumed:
 * `canonicalPreviewItemFields` (the same existing signing module) signs
 * BOTH `item.intentId` (index 6) and `window.date` (index 1) for every
 * proposed item, using the SAME `request.constructionWindow` for all of
 * them -- so by the time an item reaches this function, its own
 * `intentId` AND the request's own `constructionWindow.date` are both
 * already cryptographically bound to exactly what the server signed at
 * preview time, for this user, in this window. No new signed field, no
 * signing-code change, was needed to obtain this guarantee (this
 * ticket's own section 16/6).
 *
 * SCOPE: Goal provenance only. Capture's own sibling `captureLinks`
 * envelope is untouched -- Captures never had an automatic/signed
 * intentId scheme to begin with.
 */

import { classifyGoalDemandIntentId } from './goalDemandIntentId';
import type { AcceptanceDiagnostic, AcceptanceRejectionReason, AcceptedProposedItem } from './dayConstructorAcceptance';

export type AuthorizeGoalActivityLinksResult =
  | { status: 'OK'; goalActivityLinks: ReadonlyMap<string, string> }
  | { status: 'REJECTED'; reason: AcceptanceRejectionReason; diagnostics: AcceptanceDiagnostic[] };

/**
 * `verifiedItems` MUST be exactly the `AcceptConstructedDayRequest.proposedItems`
 * array the caller already ran through `verifyAcceptanceItems` with zero
 * diagnostics -- this function does not re-verify anything and trusts
 * `item.intentId` completely, which is only safe under that precondition
 * (this ticket's own section 3). `verifiedPlanningLocalDate` must be the
 * SAME `request.constructionWindow.date` value that was part of what was
 * verified (never `new Date()`/server-local "today"/the raw unsigned
 * request body re-read independently -- this ticket's own section 6).
 *
 * `rawGoalActivityLinks` is the browser's own unsigned sibling map,
 * exactly as `parseGoalActivityLinks` (accept/route.ts) already produces
 * it today -- still consulted, but no longer the sole authority for an
 * automatic item.
 *
 * Returns a FRESH map, built only from `verifiedItems`' own intentIds
 * (this ticket's own section 10): a `rawGoalActivityLinks` entry whose
 * intentId is not among `verifiedItems` is never even visited, so it can
 * never reach the authorized result or persistence, regardless of what a
 * client submitted.
 *
 * For a NOT_GOAL_DEMAND item (typed/Quick Pick/Quick Capture/manual Goal
 * `plan-day-goal-<id>`): behavior is completely unchanged -- whatever
 * `rawGoalActivityLinks` already said for that intentId passes through
 * verbatim (this ticket's own section 12/13: the manual path's existing
 * client-link + transactional ownership/eligibility validation is not
 * touched by this file at all).
 *
 * For a VALID_GOAL_DEMAND item: the decoded `goalActivityId` is
 * authoritative. A missing `rawGoalActivityLinks` entry is treated as a
 * transport-only omission and the link is derived from the verified
 * intentId (this ticket's own section 9 -- confirmed by direct read of
 * `persistAcceptedConstructedDay`'s own write loop that "no link entry"
 * carries no OTHER meaning today beyond "nothing to link," so deriving it
 * server-side changes no existing semantics). A PRESENT entry that
 * DIFFERS from the decoded id is a provenance conflict and fails the
 * whole acceptance closed (this ticket's own section 8) -- never a
 * silent substitution of either value.
 *
 * For an INVALID_GOAL_DEMAND item (a malformed string that still claims
 * the reserved namespace): fails the whole acceptance closed (this
 * ticket's own section 11) -- never silently reinterpreted as an
 * ordinary, unlinked intent.
 *
 * Whole-request, atomic (this ticket's own section 20, matching
 * `evaluateAcceptance`'s own established "whole-proposal, never partial"
 * convention): any single item's diagnostic rejects the ENTIRE batch,
 * before the caller ever reaches persistence -- never a partial
 * authorized map.
 */
export function authorizeGoalActivityLinks(verifiedItems: readonly Pick<AcceptedProposedItem, 'intentId'>[], verifiedPlanningLocalDate: string, rawGoalActivityLinks: ReadonlyMap<string, string>): AuthorizeGoalActivityLinksResult {
  const diagnostics: AcceptanceDiagnostic[] = [];
  const authorized = new Map<string, string>();

  for (const item of verifiedItems) {
    const classification = classifyGoalDemandIntentId(item.intentId);

    if (classification.kind === 'NOT_GOAL_DEMAND') {
      const rawLink = rawGoalActivityLinks.get(item.intentId);
      if (rawLink !== undefined) authorized.set(item.intentId, rawLink);
      continue;
    }

    if (classification.kind === 'INVALID_GOAL_DEMAND') {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'MALFORMED_AUTOMATIC_GOAL_INTENT_ID' });
      continue;
    }

    // VALID_GOAL_DEMAND.
    if (classification.planningLocalDate !== verifiedPlanningLocalDate) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'AUTOMATIC_GOAL_PLANNING_DATE_MISMATCH' });
      continue;
    }

    const rawLink = rawGoalActivityLinks.get(item.intentId);
    if (rawLink !== undefined && rawLink !== classification.goalActivityId) {
      diagnostics.push({ intentId: item.intentId, reason: 'INVALID_REQUEST', detail: 'AUTOMATIC_GOAL_PROVENANCE_MISMATCH' });
      continue;
    }

    // Authoritative: the verified intentId's own decoded goalActivityId --
    // never `rawLink` itself, even when present and matching (this
    // ticket's own section 7: never derive from the client map).
    authorized.set(item.intentId, classification.goalActivityId);
  }

  if (diagnostics.length > 0) return { status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics };
  return { status: 'OK', goalActivityLinks: authorized };
}
