/**
 * Constructor Decision Intelligence -- O5 P4c3 (P4c2a): the PURE MATERIALIZABILITY GATE (inert).
 *
 * The baseline's Deferred and conflict entries describe the BASELINE'S OCCUPANCY (a `NO_CANDIDATES` item means a replenishment search found nothing while the
 * baseline's Proposed intervals were excluded; a conflict names a baseline owner). An accepted counterfactual changes that occupancy, so any such entry other
 * than the promoted candidate's own could become false in the active result -- and the Deferred reasons reach the user ("Aura couldn't find a suitable time."),
 * with `deferredItems` / `conflicts` being required typed fields that cannot be withheld or rewritten. Proving them again would need a timing-search replay (a second
 * Constructor); scheduling the newly freed item would be a chained second promotion. So V1 fails closed:
 *
 *   - the promoted candidate P must occur EXACTLY ONCE in the baseline `deferredItems`            else INCONSISTENT_AUTHORITY
 *   - Deferred intent ids are unique, conflict intent ids are unique, and every conflict belongs to a Deferred intent (the Constructor emits a conflict only
 *     together with its Deferred entry, so this is structural)                                    else INCONSISTENT_AUTHORITY
 *   - any Deferred item other than P                                                                else DEFERRED_DIAGNOSTIC_UNRESOLVED
 *   - any conflict whose intent is not P                                                            else DEFERRED_DIAGNOSTIC_UNRESOLVED
 *
 * When it passes, the promoted candidate's own Deferred entry and conflict entry are the only ones and they leave with it, so the active result has NO Deferred and
 * NO conflict explanation to be stale. This is representational safety, not DecisionPressure policy, not P4b3 safety and not P4c1 value; it reads result structure and
 * identity only (no provenance, no client fact), is independent of array order, and never searches, rewrites a reason or strips a diagnostic.
 *
 * Pure: no database, clock, search, Constructor, randomness, logging or mutation; O(Deferred + conflicts).
 */

export type MaterializabilityUnavailableReason = 'INCONSISTENT_AUTHORITY' | 'DEFERRED_DIAGNOSTIC_UNRESOLVED';

export type MaterializabilityDecision =
  | { readonly status: 'MATERIALIZABLE' }
  | { readonly status: 'UNAVAILABLE'; readonly reason: MaterializabilityUnavailableReason };

const MATERIALIZABLE: MaterializabilityDecision = Object.freeze({ status: 'MATERIALIZABLE' });
const INCONSISTENT: MaterializabilityDecision = Object.freeze({ status: 'UNAVAILABLE', reason: 'INCONSISTENT_AUTHORITY' });
const UNRESOLVED: MaterializabilityDecision = Object.freeze({ status: 'UNAVAILABLE', reason: 'DEFERRED_DIAGNOSTIC_UNRESOLVED' });

/** The structural parts of a baseline constructed day the gate reads (it never needs placements, capacity or provenance). */
export interface MaterializabilityDay {
  readonly deferredItems: readonly { readonly intentId: string }[];
  readonly conflicts: readonly { readonly intentId: string }[];
}

export function evaluateMaterializability(day: MaterializabilityDay, candidateIntentId: string): MaterializabilityDecision {
  try {
    const deferredIds = day.deferredItems.map((item) => item.intentId);
    if (deferredIds.filter((id) => id === candidateIntentId).length !== 1) return INCONSISTENT;
    if (new Set(deferredIds).size !== deferredIds.length) return INCONSISTENT;
    const conflictIds = day.conflicts.map((conflict) => conflict.intentId);
    if (new Set(conflictIds).size !== conflictIds.length) return INCONSISTENT;
    if (conflictIds.some((id) => !deferredIds.includes(id))) return INCONSISTENT;
    if (deferredIds.some((id) => id !== candidateIntentId)) return UNRESOLVED;
    if (conflictIds.some((id) => id !== candidateIntentId)) return UNRESOLVED;
    return MATERIALIZABLE;
  } catch {
    return INCONSISTENT;
  }
}
