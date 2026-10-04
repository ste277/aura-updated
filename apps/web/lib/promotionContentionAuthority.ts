/**
 * Constructor Decision Intelligence -- O5 P4b2a: the IMMUTABLE PROMOTION CONTENTION AUTHORITY (pure, inert, detached).
 *
 * WHY IT EXISTS. The blocked P4b2 proof showed that `ConstructionBasis.initialCandidates UNION finalCandidates` cannot reconstruct every
 * interval a pressured Deferred candidate P really attempted against its owners: the orchestrator OVERWRITES a conflicted loser's
 * candidate list on every replenishment round, and the real timing search truncates (`DEFAULT_FIND_LIMIT = 3`), so an intermediate
 * round's list -- the only place an attempted slot such as "P at 10:00 lost to B" lived -- can be in neither captured list. The
 * contention itself, however, WAS observed directly, with the exact attempted interval, by P3a. So this module prefers EVENT authority
 * over search-history reconstruction: it does not capture any candidate list or round; it projects the contention P3a already saw.
 *
 * WHAT IT IS. For ONE PromotionInput (a pressured, finally-Deferred candidate and its 1..N authorized FINAL owners), the exact intervals
 * the candidate attempted and lost to those owners -- one `{ ownerIntentId, start, end }` per DISTINCT (owner, attempted interval):
 *
 *   PromotionContentionAuthority { candidateIntentId, attempts: [ { ownerIntentId, start, end } ... ] }
 *
 * SOURCE MAPPING (P3a `ContentionEvent` -> attempt, field for field): loserIntentId = the PromotionInput candidate; winnerIntentId = a
 * member of that PromotionInput's owner ids (and ONLY such); attemptedStart / attemptedEnd -> start / end, parsed exactly from the
 * trace's ISO-8601 strings (never reconstructed from a duration). Nothing else is carried: not the round (a P3a round-label debt stays
 * irrelevant), not the winner's interval (BaselinePlacements owns final owner placement), not pressure, importance, deadline,
 * originalOrder, timing fit, candidate order, the raw event or any classification. Field necessity: a counterfactual that tests "P at an
 * attempted slot, displacing the owner(s) it overlaps" needs exactly which owner stopped which interval, nothing historical beyond that.
 *
 * NO OWNER EXPANSION. The PromotionInput is the sole owner authority: events whose winner is not an authorized owner are dropped, so the
 * trace can never enlarge the movable scope; and every authorized owner must itself be supported by at least one real event (an owner
 * with no recorded contention against the candidate is an inconsistent pairing, not a quiet widening).
 *
 * DEDUPLICATION. The same (owner, start, end) recorded in several rounds is ONE attempt: the round is not part of the contract, so the
 * repetition carries no information a generator can use. First occurrence wins; distinct owners over the same interval stay distinct
 * (P3a emits one event per overlapping owner). ORDER is the trace's own chronological order (round, evaluation order, interval, owner
 * placement order) among the surviving events -- no policy ordering.
 *
 * SAME-RUN PAIRING. The orchestration diagnostics of ONE baseline run own the trace, the ConstructionBasis and the BaselinePlacements; the
 * internal promotion boundary derives the PromotionInput(s) from that same run and calls this module right there, once per input. There
 * is no second orchestration and no run id. Validation here: both outcomes are READY; the candidate is a basis intent that holds NO
 * baseline placement (it was finally Deferred); every owner is a distinct basis intent that DOES hold a baseline placement (the P4a
 * promise that owners are final Proposed, re-checked, never assumed). Failure is infrastructural / integrity only: fail closed.
 *
 * OWNERSHIP AND IMMUTABILITY. Every Date is newly created from the trace's string (no alias exists to share); every array and object is
 * new; everything is `Object.freeze`d -- BUT freezing does NOT stop a Date setter changing a Date's time value. Date safety is OWNERSHIP
 * plus the #208 architecture guard that the audited scheduling path contains no Date mutator (this module is on that protected list).
 *
 * INERT. All-or-nothing (`READY` | `UNAVAILABLE` with a reason), never throws, never partial. No pressure interpretation (owner pressure
 * is never read), no policy, no scheduling, no database, snapshot, clock, timing search, Constructor or orchestrator call, no candidate
 * history, no logging, no serialization. Not public, not persisted, not signed. Future consumers receive THIS typed projection and never
 * the raw P3a trace; only the internal promotion-preparation boundary hands the trace to this module.
 */

import type { ContentionTrace } from './contentionTrace';
import type { PromotionInput } from './promotionInput';
import type { ConstructionBasisOutcome } from './constructionBasis';
import type { BaselinePlacementsOutcome } from './baselinePlacements';

export interface PromotionContentionAttempt {
  readonly ownerIntentId: string;
  /** The exact interval [start, end) the candidate attempted and lost to this owner, copied from P3a. */
  readonly start: Date;
  readonly end: Date;
}

export interface PromotionContentionAuthority {
  readonly candidateIntentId: string;
  /** 1..N distinct attempts, in the trace's own order. Never empty. */
  readonly attempts: readonly PromotionContentionAttempt[];
}

export type PromotionContentionUnavailableReason = 'RUN_NOT_READY' | 'INCONSISTENT_INPUT' | 'NO_MATCHING_CONTENTION' | 'CAPTURE_FAILED';
export type PromotionContentionOutcome =
  | { readonly status: 'READY'; readonly authority: PromotionContentionAuthority }
  | { readonly status: 'UNAVAILABLE'; readonly reason: PromotionContentionUnavailableReason };

function unavailable(reason: PromotionContentionUnavailableReason): PromotionContentionOutcome {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

/**
 * Projects the contention authority of ONE PromotionInput from the SAME run's trace, validated against that run's basis and baseline
 * placements. Never throws.
 */
export function projectContentionAuthority(trace: ContentionTrace, input: PromotionInput, basisOutcome: ConstructionBasisOutcome, placementsOutcome: BaselinePlacementsOutcome): PromotionContentionOutcome {
  try {
    if (basisOutcome.status !== 'READY' || placementsOutcome.status !== 'READY') return unavailable('RUN_NOT_READY');
    const intentIds = basisOutcome.basis.intents.map((intent) => intent.id);
    const placedIds = placementsOutcome.placements.placements.map((placement) => placement.intentId);
    const candidateId = input.candidateIntentId;
    const ownerIds = input.owners.map((owner) => owner.intentId);
    if (!intentIds.includes(candidateId) || placedIds.includes(candidateId)) return unavailable('INCONSISTENT_INPUT');
    if (ownerIds.length === 0 || new Set(ownerIds).size !== ownerIds.length) return unavailable('INCONSISTENT_INPUT');
    if (ownerIds.some((id) => id === candidateId || !intentIds.includes(id) || !placedIds.includes(id))) return unavailable('INCONSISTENT_INPUT');

    const seen = new Set<string>();
    const attempts: PromotionContentionAttempt[] = [];
    for (const event of trace.events) {
      if (event.loserIntentId !== candidateId || !ownerIds.includes(event.winnerIntentId)) continue;
      const start = new Date(event.attemptedStart);
      const end = new Date(event.attemptedEnd);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() >= end.getTime()) return unavailable('CAPTURE_FAILED');
      const key = `${event.winnerIntentId}|${start.getTime()}|${end.getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      attempts.push(Object.freeze({ ownerIntentId: event.winnerIntentId, start: Object.freeze(start), end: Object.freeze(end) }));
    }
    if (attempts.length === 0) return unavailable('NO_MATCHING_CONTENTION');
    if (ownerIds.some((id) => !attempts.some((attempt) => attempt.ownerIntentId === id))) return unavailable('INCONSISTENT_INPUT');
    return Object.freeze({ status: 'READY', authority: Object.freeze({ candidateIntentId: candidateId, attempts: Object.freeze(attempts) }) });
  } catch {
    return unavailable('CAPTURE_FAILED');
  }
}
