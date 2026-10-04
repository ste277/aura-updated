/**
 * Constructor Decision Intelligence -- O5 P4a: the TYPED PROMOTION INPUT (pure, inert policy-input contract).
 *
 * A `PromotionInput` answers exactly one structural question about ONE finished Day Constructor run:
 *
 *   "Which finally-Deferred candidates, and which of their final contention owners, may ENTER a future promotion policy
 *    evaluation -- because temporal pressure exists for them, they really lost an interval to those owners, those owners
 *    still occupy the final schedule, and nothing that outranks pressure separates them?"
 *
 * It does NOT answer "should scheduling change". It is not a decision, a promotion, a replacement, a ranking or a score.
 * Nothing in P4a reads it: the Constructor, comparator, placement, replenishment, capacity, preview, signing, acceptance,
 * persistence and every user-facing surface are untouched. P4b (not implemented) is the first thing that may consume it.
 *
 * ELIGIBILITY (all must hold; one input per candidate that satisfies every gate, otherwise NO input -- fail closed):
 *   1. pressure     the candidate's derived pressure is exactly LAST_KNOWN_OPPORTUNITY (NONE or missing => nothing)
 *   2. final state  the candidate is finally Deferred (a candidate that contended and was later Proposed => nothing)
 *   3. contention   the P3a trace holds at least one event with the candidate as the loser (the trace, never the Deferred
 *                   reason, is the authority that contention happened)
 *   4. owners       at least one distinct historical owner of that contention is STILL Proposed in the final result
 *   5. precedence   against EVERY such final owner the candidate TIES on all dimensions that outrank pressure (deadline
 *                   today, importance, deadline). Any stronger owner, a loser-stronger anomaly, or missing precedence facts
 *                   for either side => nothing. The all-owner rule is mandatory: a single non-tying owner voids the input.
 *   6. identity     no intent id involved (loser or any historical owner) may appear more than once in the final result.
 *
 * `originalOrder` is intentionally NOT a blocking dimension: it is the dimension pressure is eventually meant to precede,
 * and the shared comparator neutralises it. Timing quality, capacity state, the Deferred reason, durations, coverage,
 * recurrence and opportunity values, contention counts, rounds and attempted intervals are never inputs to eligibility.
 *
 * WHAT THE CONTRACT CARRIES (the minimum a bounded counterfactual pass needs, and nothing else): the loser's stable
 * Constructor intent id and, for each of its 1..N FINAL contention owners (deduplicated, never collapsed into one winner, in
 * order of first appearance in the trace), the owner's stable intent id and its OWN categorical Decision Pressure (P4a2).
 * Owner pressure ENRICHES the contract and does not change existence: an input still exists when an owner is itself
 * pressured -- rejecting that is an ACTIVE-POLICY rule (P4b), not an admission rule, so the exhaustive P3b equivalence
 * is unchanged. The only new gate is completeness: if any final owner has no categorical pressure on record the input is
 * not emitted (fail closed; the production boundary derives pressure for every resolved intent, so this is a defensive
 * guard against an incomplete authority, never a policy). Existence of the input IS the encoding of "pressured, tied above
 * pressure, finally Deferred after real contention" -- no redundant pressure field, no copied importance / deadline. A later
 * policy re-reads original order, durations and windows from the baseline authority it already holds by intent id; it does
 * not rediscover eligibility from raw facts. Historical owners that no longer hold a final Proposed slot are not carried.
 * One final owner may appear in several losers' inputs when real contention supports each relationship.
 *
 * RELATIONSHIP TO P3b. The P3b shadow evaluator remains the DIAGNOSTIC semantic proof; this module does not read it, does
 * not branch on its classification enum and does not accept a `ShadowPressureEvaluation`. It assembles from the same
 * authoritative typed primitives (already-derived pressure, the P3a trace, the final result, the normalised above-pressure
 * facts) and reuses the one reviewed semantic primitive `compareAbovePressure` -- the Constructor's own comparator with
 * originalOrder neutralised -- so no importance / deadline logic exists twice. The behaviour suite proves, over an
 * exhaustive fixture matrix, that an input exists IF AND ONLY IF P3b classifies the candidate
 * PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS.
 *
 * SOURCE-NEUTRAL, PURE and IMMUTABLE: Constructor identity (intent ids) only -- no title, activity, Goal, manual /
 * automatic, provenance or user-facing field, no DecisionFacts, no DecisionEvidence, no scheduling context. No I/O, no
 * async, no clock, no environment, no logging, no callback. Inputs are never mutated; the output is a detached, deeply
 * frozen array of frozen records holding only strings (no Date, Map, Set or shared Constructor object).
 */

import type { ConstructedDay } from './dayConstructor';
import type { ContentionTrace } from './contentionTrace';
import type { DecisionPressure } from './decisionPressure';
import { compareAbovePressure, type AbovePressureFacts } from './abovePressurePrecedence';

/**
 * One FINAL contention owner of a promotion candidate: its stable Constructor intent id and its OWN already-derived Decision
 * Pressure (categorical: NONE | LAST_KNOWN_OPPORTUNITY), taken from the same pressure authority as the candidate's. Nothing
 * else: no evidence, no facts, no summary of the owners' pressure. (O5 P4a2: a future promotion policy needs to know whether an
 * owner is itself pressured -- two equally pressured candidates that tie above pressure still resolve by `originalOrder`.)
 */
export interface PromotionOwner {
  readonly intentId: string;
  readonly pressure: DecisionPressure;
}

/**
 * Permission for ONE finally-Deferred, pressured candidate to enter a future promotion policy evaluation against its 1..N
 * final contention owners. It is not a promotion and does not say the candidate should be scheduled.
 */
export interface PromotionInput {
  readonly candidateIntentId: string;
  /** 1..N distinct final-Proposed owners, in order of first appearance in the contention trace. Never empty. */
  readonly owners: readonly PromotionOwner[];
}

/** The reviewed authorities an assembly reads -- the same typed primitives the P3b shadow stage reads, and nothing else. */
export interface PromotionInputAuthority {
  /** The finished baseline Constructor result: only which intents are Proposed or Deferred is read. */
  readonly finalDay: Pick<ConstructedDay, 'proposedItems' | 'deferredItems'>;
  /** P3a's trace: the sole authority on whether candidate-vs-candidate contention occurred. */
  readonly contentionTrace: ContentionTrace;
  /** ALREADY-DERIVED pressure per intent id -- the candidate's AND every final owner's, from the same evaluation. Raw facts and evidence are not accepted. */
  readonly pressureByIntentId: ReadonlyMap<string, DecisionPressure>;
  /** The normalised stronger-than-pressure facts per intent id. */
  readonly precedenceFactsByIntentId: ReadonlyMap<string, AbovePressureFacts>;
  /** The local civil date being planned (the comparator's own "today"). */
  readonly planningDate: string;
}

/**
 * Assembles the promotion inputs of one finished run: 0..N, one per eligible final-Deferred candidate, in final-result
 * order. Pure and total over well-typed input; any gate that cannot be established positively yields no input for that
 * candidate (never a guess), and one candidate's outcome never affects another's.
 */
export function assemblePromotionInputs(authority: PromotionInputAuthority): readonly PromotionInput[] {
  const proposedIds = authority.finalDay.proposedItems.map((item) => item.intentId);
  const deferredIds = authority.finalDay.deferredItems.map((item) => item.intentId);
  const occurrences = new Map<string, number>();
  for (const id of [...proposedIds, ...deferredIds]) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
  const isAmbiguous = (id: string) => (occurrences.get(id) ?? 0) > 1;
  const proposedSet = new Set(proposedIds);

  // Distinct historical owners per loser, in order of first appearance in the trace.
  const ownersByLoser = new Map<string, string[]>();
  for (const event of authority.contentionTrace.events) {
    const owners = ownersByLoser.get(event.loserIntentId);
    if (!owners) ownersByLoser.set(event.loserIntentId, [event.winnerIntentId]);
    else if (!owners.includes(event.winnerIntentId)) owners.push(event.winnerIntentId);
  }

  const inputs: PromotionInput[] = [];
  const considered = new Set<string>();
  for (const candidateId of deferredIds) {
    if (considered.has(candidateId)) continue;
    considered.add(candidateId);
    if (isAmbiguous(candidateId)) continue;
    if (authority.pressureByIntentId.get(candidateId) !== 'LAST_KNOWN_OPPORTUNITY') continue;
    const historicalOwners = ownersByLoser.get(candidateId);
    if (!historicalOwners || historicalOwners.length === 0) continue;
    if (historicalOwners.some(isAmbiguous)) continue;
    const finalOwnerIds = historicalOwners.filter((ownerId) => proposedSet.has(ownerId));
    if (finalOwnerIds.length === 0) continue;
    const candidateFacts = authority.precedenceFactsByIntentId.get(candidateId);
    if (!candidateFacts) continue;
    const tiesEveryFinalOwner = finalOwnerIds.every((ownerId) => {
      const ownerFacts = authority.precedenceFactsByIntentId.get(ownerId);
      return ownerFacts !== undefined && compareAbovePressure(candidateFacts, ownerFacts, authority.planningDate) === 'TIE';
    });
    if (!tiesEveryFinalOwner) continue;
    // O5 P4a2 -- each owner's own pressure, from the same authority. A missing / non-categorical value is incomplete authority: no input (never a partially authoritative owner).
    const ownerPressures = finalOwnerIds.map((ownerId) => authority.pressureByIntentId.get(ownerId));
    if (ownerPressures.some((pressure) => pressure !== 'NONE' && pressure !== 'LAST_KNOWN_OPPORTUNITY')) continue;
    inputs.push(Object.freeze({ candidateIntentId: candidateId, owners: Object.freeze(finalOwnerIds.map((ownerId, index) => Object.freeze({ intentId: ownerId, pressure: ownerPressures[index] as DecisionPressure }))) }));
  }
  return Object.freeze(inputs);
}
