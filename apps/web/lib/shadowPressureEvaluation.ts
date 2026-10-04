/**
 * Constructor Decision Intelligence -- O5 P3b: the SHADOW PRESSURE EVALUATOR (pure, inert).
 *
 * It combines three already-existing, already-immutable observations of ONE finished Day Constructor run:
 *
 *   - the derived DecisionPressure of each candidate ('NONE' | 'LAST_KNOWN_OPPORTUNITY' -- P2b, never raw facts)
 *   - the ContentionTrace (P3a -- the sole authority on whether candidate-vs-candidate contention actually occurred)
 *   - the final Constructor result (the authority on who was finally Proposed or Deferred)
 *
 * and, for each candidate that lost a concrete interval to a Proposed owner, records whether temporal pressure COULD have
 * been considered at all, given the dimensions that already outrank it. It answers
 *
 *   "which pressured candidates were finally Deferred after real contention, and how does each compare with each
 *    historical owner on the dimensions stronger than pressure?"
 *
 * It does NOT answer who should have won. There is no counterfactual construction, no re-ordering, no second placement
 * pass, no promotion and no replacement; nothing here is read by the Constructor, the comparator, placement,
 * replenishment, capacity, acceptance, persistence or any user-facing surface. `PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS`
 * means only "this candidate satisfies the current prerequisites for a LATER policy evaluation" -- never "promote it".
 * A shadow observation says nothing about wrongness: a Constructor outcome is never labelled incorrect or missed.
 *
 * GATES (all must hold; the first that fails decides the classification):
 *   pressure     the candidate's derived pressure is LAST_KNOWN_OPPORTUNITY (NONE, or no pressure on record, is NOT_PRESSURED)
 *   final state  the candidate is finally Deferred (a candidate that contended and was later Proposed is NOT_FINAL_DEFERRED)
 *   contention   the trace holds at least one event for it as the loser (else NO_CONTENTION)
 *   owners       at least one of its historical owners is STILL Proposed in the final result (else NO_FINAL_CONTENTION_OWNER)
 *   precedence   against EVERY such final owner the candidate ties on all dimensions stronger than pressure
 *
 * OWNERS: 0..N per loser, never collapsed. One historical owner is compared once however many attempted intervals,
 * events or rounds it blocked (the event count is kept as metadata only and is never a strength). Historical owners that
 * are no longer Proposed keep their comparison as evidence but do not decide the aggregate: the candidate is judged
 * against the owners that still occupy the final schedule.
 *
 * STRONGER DIMENSIONS are compared by `compareAbovePressure` (abovePressurePrecedence.ts) -- the Constructor's own
 * comparator with the weaker final tie-break neutralised. This module never names a value signal, timing quality or
 * original order itself, and never reads raw recurrence / opportunity facts, DecisionEvidence or DecisionFacts.
 *
 * FAIL CLOSED: duplicate intent ids, a loser absent from the final result, or missing precedence facts yield
 * INCOMPLETE_INPUT with an explicit reason -- never an eligible classification. Round numbers are deliberately not read.
 *
 * SOURCE-NEUTRAL, PURE and IMMUTABLE: Constructor identity (intent ids) and enums only -- no title, activity or source
 * field, no user identity, no copy. No I/O, no async, no clock, no environment, no logging. Inputs are never mutated;
 * the returned observations are detached and deeply frozen.
 */

import type { ConstructedDay } from './dayConstructor';
import type { ContentionEvent, ContentionTrace } from './contentionTrace';
import type { DecisionPressure } from './decisionPressure';
import { compareAbovePressure, type AbovePressureFacts } from './abovePressurePrecedence';

export interface ShadowPressureInput {
  /** The finished Constructor result: only which intents are Proposed or Deferred is read. */
  readonly finalDay: Pick<ConstructedDay, 'proposedItems' | 'deferredItems'>;
  /** P3a's trace: the sole authority on whether candidate-vs-candidate contention occurred. */
  readonly contentionTrace: ContentionTrace;
  /** ALREADY-DERIVED pressure per intent id. Raw facts and evidence are not accepted. */
  readonly pressureByIntentId: ReadonlyMap<string, DecisionPressure>;
  /** The normalised stronger-than-pressure facts per intent id (the facts the Constructor's own precedence reads). */
  readonly precedenceFactsByIntentId: ReadonlyMap<string, AbovePressureFacts>;
  /** The local civil date being planned (the comparator's own "today"). */
  readonly planningDate: string;
}

export type ShadowPressureValue = DecisionPressure | 'UNAVAILABLE';
export type ShadowLoserFinalState = 'FINAL_DEFERRED' | 'FINAL_PROPOSED' | 'ABSENT_FROM_FINAL_RESULT' | 'AMBIGUOUS_ID';
export type ShadowOwnerFinalState = 'FINAL_PROPOSED' | 'NOT_FINAL_PROPOSED';
export type ShadowOwnerComparisonKind = 'TIES_ABOVE_PRESSURE' | 'OWNER_STRONGER_ABOVE_PRESSURE' | 'LOSER_STRONGER_ABOVE_PRESSURE' | 'UNKNOWN_PRECEDENCE';
export type ShadowPressureClassification =
  | 'NOT_PRESSURED'
  | 'NO_CONTENTION'
  | 'NOT_FINAL_DEFERRED'
  | 'NO_FINAL_CONTENTION_OWNER'
  | 'BLOCKED_BY_STRONGER_OWNER'
  | 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS'
  | 'PRECEDENCE_ANOMALY'
  | 'INCOMPLETE_INPUT';
export type ShadowIncompleteReason = 'DUPLICATE_INTENT_ID' | 'LOSER_NOT_IN_FINAL_RESULT' | 'MISSING_PRECEDENCE_FACTS';

export interface ShadowOwnerComparison {
  readonly ownerIntentId: string;
  readonly finalState: ShadowOwnerFinalState;
  readonly comparison: ShadowOwnerComparisonKind;
  /** How many contention events this owner caused for this loser (all attempted intervals, all rounds). Metadata, never strength. */
  readonly contentionEventCount: number;
}

export interface ShadowPressureObservation {
  readonly loserIntentId: string;
  readonly finalState: ShadowLoserFinalState;
  readonly pressure: ShadowPressureValue;
  readonly classification: ShadowPressureClassification;
  /** Present only for INCOMPLETE_INPUT. */
  readonly incompleteReason?: ShadowIncompleteReason;
  /** All contention events recorded for this loser. Metadata, never strength. */
  readonly contentionEventCount: number;
  /** Every distinct historical owner (0..N), in order of first appearance in the trace, each compared once. */
  readonly owners: readonly ShadowOwnerComparison[];
}

export interface ShadowPressureEvaluation {
  /** One observation per final Deferred candidate (in final-result order), then one per other candidate that appears as a loser in the trace. */
  readonly observations: readonly ShadowPressureObservation[];
}

function countOccurrences(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

export function evaluateShadowPressure(input: ShadowPressureInput): ShadowPressureEvaluation {
  const proposedIds = input.finalDay.proposedItems.map((item) => item.intentId);
  const deferredIds = input.finalDay.deferredItems.map((item) => item.intentId);
  const occurrences = countOccurrences([...proposedIds, ...deferredIds]);
  const proposedSet = new Set(proposedIds);
  const deferredSet = new Set(deferredIds);
  const isAmbiguous = (id: string) => (occurrences.get(id) ?? 0) > 1;

  const eventsByLoser = new Map<string, ContentionEvent[]>();
  for (const event of input.contentionTrace.events) {
    const list = eventsByLoser.get(event.loserIntentId);
    if (list) list.push(event);
    else eventsByLoser.set(event.loserIntentId, [event]);
  }

  // One observation per final Deferred candidate (final-result order), then any other trace loser (trace order).
  const loserIds: string[] = [];
  const seen = new Set<string>();
  for (const id of [...deferredIds, ...eventsByLoser.keys()]) {
    if (seen.has(id)) continue;
    seen.add(id);
    loserIds.push(id);
  }

  const observations: ShadowPressureObservation[] = loserIds.map((loserId) => {
    const events = eventsByLoser.get(loserId) ?? [];
    const finalState: ShadowLoserFinalState = isAmbiguous(loserId) ? 'AMBIGUOUS_ID' : deferredSet.has(loserId) ? 'FINAL_DEFERRED' : proposedSet.has(loserId) ? 'FINAL_PROPOSED' : 'ABSENT_FROM_FINAL_RESULT';
    const pressure: ShadowPressureValue = input.pressureByIntentId.get(loserId) ?? 'UNAVAILABLE';
    const loserFacts = input.precedenceFactsByIntentId.get(loserId);

    // Distinct historical owners, in order of first appearance, each compared ONCE however many events it caused.
    const ownerEventCounts = new Map<string, number>();
    for (const event of events) ownerEventCounts.set(event.winnerIntentId, (ownerEventCounts.get(event.winnerIntentId) ?? 0) + 1);
    let ambiguousOwner = false;
    const owners: ShadowOwnerComparison[] = [...ownerEventCounts.entries()].map(([ownerId, count]) => {
      if (isAmbiguous(ownerId)) ambiguousOwner = true;
      const ownerFacts = input.precedenceFactsByIntentId.get(ownerId);
      const comparison: ShadowOwnerComparisonKind =
        !loserFacts || !ownerFacts
          ? 'UNKNOWN_PRECEDENCE'
          : ((): ShadowOwnerComparisonKind => {
              const result = compareAbovePressure(loserFacts, ownerFacts, input.planningDate);
              return result === 'TIE' ? 'TIES_ABOVE_PRESSURE' : result === 'A_STRONGER' ? 'LOSER_STRONGER_ABOVE_PRESSURE' : 'OWNER_STRONGER_ABOVE_PRESSURE';
            })();
      return Object.freeze({ ownerIntentId: ownerId, finalState: (proposedSet.has(ownerId) && !isAmbiguous(ownerId) ? 'FINAL_PROPOSED' : 'NOT_FINAL_PROPOSED') as ShadowOwnerFinalState, comparison, contentionEventCount: count });
    });

    let classification: ShadowPressureClassification;
    let incompleteReason: ShadowIncompleteReason | undefined;
    const finalOwners = owners.filter((owner) => owner.finalState === 'FINAL_PROPOSED');
    if (finalState === 'AMBIGUOUS_ID') {
      classification = 'INCOMPLETE_INPUT';
      incompleteReason = 'DUPLICATE_INTENT_ID';
    } else if (finalState === 'ABSENT_FROM_FINAL_RESULT') {
      classification = 'INCOMPLETE_INPUT';
      incompleteReason = 'LOSER_NOT_IN_FINAL_RESULT';
    } else if (pressure !== 'LAST_KNOWN_OPPORTUNITY') {
      classification = 'NOT_PRESSURED';
    } else if (finalState === 'FINAL_PROPOSED') {
      classification = 'NOT_FINAL_DEFERRED';
    } else if (events.length === 0) {
      classification = 'NO_CONTENTION';
    } else if (ambiguousOwner) {
      classification = 'INCOMPLETE_INPUT';
      incompleteReason = 'DUPLICATE_INTENT_ID';
    } else if (finalOwners.length === 0) {
      classification = 'NO_FINAL_CONTENTION_OWNER';
    } else if (finalOwners.some((owner) => owner.comparison === 'LOSER_STRONGER_ABOVE_PRESSURE')) {
      classification = 'PRECEDENCE_ANOMALY';
    } else if (finalOwners.some((owner) => owner.comparison === 'OWNER_STRONGER_ABOVE_PRESSURE')) {
      classification = 'BLOCKED_BY_STRONGER_OWNER';
    } else if (finalOwners.some((owner) => owner.comparison === 'UNKNOWN_PRECEDENCE')) {
      classification = 'INCOMPLETE_INPUT';
      incompleteReason = 'MISSING_PRECEDENCE_FACTS';
    } else {
      classification = 'PRESSURE_ELIGIBLE_AGAINST_ALL_FINAL_OWNERS';
    }

    return Object.freeze({
      loserIntentId: loserId,
      finalState,
      pressure,
      classification,
      ...(incompleteReason ? { incompleteReason } : {}),
      contentionEventCount: events.length,
      owners: Object.freeze(owners),
    });
  });

  return Object.freeze({ observations: Object.freeze(observations) });
}
