/**
 * Constructor Decision Intelligence -- O5 SHADOW EVIDENCE: the PURE MATERIALIZATION INVARIANT CHECK (inert, diagnostic only).
 *
 * In SHADOW the real P4c3 materializer may build the active result the policy WOULD have applied; that result is discarded and the baseline is what the user gets.
 * Before it is discarded, this module independently VERIFIES the properties an ACTIVE application must never violate, by comparing the baseline result with the
 * materialized one against the typed accepted authority. It is a verifier, not a policy: it decides nothing about whether a promotion is good, it only reports whether
 * the materialized day broke one of the safety invariants -- which the materializer and P4b3 are supposed to make impossible. The expected production count of any
 * FAIL is therefore ZERO, and a non-zero count is distinguishable from an ordinary policy REJECT / UNAVAILABLE.
 *
 * INVARIANTS (reported by the first violated one, in this order, as a bounded typed category):
 *   BASELINE_PROVENANCE_INVALID   the baseline is not the exact baseline bound to the authority (the P4c4a same-run guarantee)
 *   PROPOSED_COUNT_REDUCED        fewer Proposed items than the baseline
 *   OWNER_MISSING                    a baseline Proposed intent is missing from the materialized day
 *   FIXED_ITEM_MOVED       a baseline FIXED placement differs
 *   UNRELATED_ITEM_MOVED             a baseline item that is neither the promoted candidate nor an authorized displaced owner differs
 *   UNAUTHORIZED_DISPLACEMENT     an item that is neither a baseline item nor the promoted candidate, an unexpected item count, or the promoted candidate missing
 *   CHECK_FAILED                  the check itself could not run (never a pass)
 *
 * Pure: no database, clock, randomness, search, Constructor, P4b2 / P4b3 call, logging or environment. Inputs are never mutated; the result is a frozen string.
 */

import { isBaselineOfAcceptedCounterfactual, type AcceptedCounterfactual } from './acceptedCounterfactual';
import type { OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import type { ProposedItem } from './dayConstructor';

export type MaterializationInvariantFailure =
  | 'BASELINE_PROVENANCE_INVALID'
  | 'PROPOSED_COUNT_REDUCED'
  | 'OWNER_MISSING'
  | 'FIXED_ITEM_MOVED'
  | 'UNRELATED_ITEM_MOVED'
  | 'UNAUTHORIZED_DISPLACEMENT'
  | 'CHECK_FAILED';

export type MaterializationInvariantOutcome = 'PASS' | MaterializationInvariantFailure;

/** A detached, exact fingerprint of one Proposed item (every field, Dates as instants): two items are the same placement iff their fingerprints are equal. */
function fingerprint(item: ProposedItem): string {
  return JSON.stringify(item);
}

export function checkMaterializationInvariants(baselineResult: OrchestrateConstructDayResult, materializedResult: OrchestrateConstructDayResult, accepted: AcceptedCounterfactual): MaterializationInvariantOutcome {
  try {
    if (!isBaselineOfAcceptedCounterfactual(accepted, baselineResult)) return 'BASELINE_PROVENANCE_INVALID';
    if (baselineResult.status !== 'READY' || materializedResult.status !== 'READY') return 'CHECK_FAILED';
    const baseline = baselineResult.preview.constructedDay.proposedItems;
    const active = materializedResult.preview.constructedDay.proposedItems;
    const candidateId = accepted.candidateIntentId;
    const displaced = new Set(accepted.displacedOwnerIds);
    if (active.length < baseline.length) return 'PROPOSED_COUNT_REDUCED';
    const activeById = new Map(active.map((item) => [item.intentId, item]));
    if (baseline.some((item) => !activeById.has(item.intentId))) return 'OWNER_MISSING';
    for (const item of baseline) {
      if (item.placementSource === 'FIXED_CONSTRAINT' && fingerprint(activeById.get(item.intentId)!) !== fingerprint(item)) return 'FIXED_ITEM_MOVED';
    }
    for (const item of baseline) {
      if (!displaced.has(item.intentId) && fingerprint(activeById.get(item.intentId)!) !== fingerprint(item)) return 'UNRELATED_ITEM_MOVED';
    }
    const baselineIds = new Set(baseline.map((item) => item.intentId));
    // exactly the baseline items plus the promoted candidate: the promoted candidate present, nothing else added (any other extra item breaks the count or the candidate's presence), no duplicates
    if (!activeById.has(candidateId) || baselineIds.has(candidateId) || active.length !== baseline.length + 1 || new Set(active.map((item) => item.intentId)).size !== active.length) return 'UNAUTHORIZED_DISPLACEMENT';
    for (const id of displaced) if (!baselineIds.has(id)) return 'UNAUTHORIZED_DISPLACEMENT';
    return 'PASS';
  } catch {
    return 'CHECK_FAILED';
  }
}
