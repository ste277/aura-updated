/**
 * Constructor Decision Intelligence -- O5 P4b1: the IMMUTABLE CONSTRUCTION BASIS (pure, inert, detached).
 *
 * WHAT IT IS. The neutral scheduling AUTHORITY the baseline Day Constructor run actually used, captured at deterministic
 * points of that SAME orchestration run and handed out, detached and deeply frozen, so a future bounded counterfactual (P4b2)
 * can re-place a small scope against EXACTLY the baseline authority -- with no second database read, no second timing search,
 * no second clock read and no alias of any mutable baseline object. It is not a Constructor result, a counterfactual, a policy
 * result, DecisionEvidence, a PromotionInput or a persistence model, and nothing reads it for any decision today.
 *
 * THE MINIMUM CONTRACT, derived from `ConstructDayInput` (the Constructor's own input) and nothing else:
 *   planningDate              the Constructor's `today` (the request's civil target date) -- the same value baseline used
 *   window                    the construction window the baseline candidates were checked against (date, timezone, start, end;
 *                             its `source` kind is not read by the Constructor and is left to the public preview that carries it)
 *   intents                   the normalized scheduling intents in REQUEST order: id, title, activityId, importance, deadline,
 *                             estimatedDurationMinutes, flexibility, originalOrder. Facts, family and DayIntent source are NOT
 *                             carried (the Constructor reads none of them), and nothing is re-resolved or renumbered
 *   blockedIntervals          the baseline external blockers (plan blockers and availability-gap blockers, already filtered by the
 *                             baseline clock) -- availability itself is never re-read or recomputed, only its resolved effect
 *   initialCandidates         each FLEXIBLE intent's candidate list as the original timing search left it, captured at T1 --
 *                             BEFORE replenishment could replace it (the replenishment overwrites a conflicted loser's list, and the
 *                             overwritten list is the only place the slot it lost still exists)
 *   finalCandidates           the candidate lists actually present when the baseline finished, captured at T3
 *   fixedConstraints          the FIXED placement authority baseline used
 *
 * CANDIDATE ENTRY SEMANTICS (preserved, never collapsed): an intent has an ENTRY in a candidate list collection only if the
 * orchestrator created one -- a FLEXIBLE intent that reached the timing search. An entry with an EMPTY `candidates` array means
 * "searched, nothing usable"; NO entry means "never searched" (FIXED, or an unresolved duration). Collection order is request order.
 * `candidateOrder`, `timingFit`, start and end are copied exactly; the future union order is not assigned here.
 *
 * LIFECYCLE: T0 request normalized -> T1 initial timing searches complete (initial candidates captured) -> T2 baseline Constructor
 * and replenishment rounds -> T3 terminal candidate lists known -> T4 this module assembles the basis and the orchestrator hands
 * it out. Every copy happens synchronously at one of those boundaries; no asynchronous search can touch a captured basis after.
 *
 * OWNERSHIP AND IMMUTABILITY. Every Date is a NEWLY ALLOCATED `new Date(source.getTime())` (an invalid source Date stays invalid:
 * baseline semantics are preserved, nothing is silently normalized; a non-Date value cannot be copied and makes the basis
 * UNAVAILABLE). Every array and nested object is new. Every object, array and Date is `Object.freeze`d -- BUT freezing does NOT
 * stop a Date setter from changing a Date's internal time value. Date safety therefore rests on two things together: this module
 * OWNS every Date it holds (no alias with any baseline object), and the #208 architecture guard proves the audited scheduling path
 * contains no Date mutator. Neither claim substitutes for the other.
 *
 * INERT AND OPTIONAL. All-or-nothing: `READY` with a complete basis, or `UNAVAILABLE` with an infrastructural reason (the run was
 * not READY, assembly failed, or duplicate intent ids made the neutral authority ambiguous) -- never a partial basis. Assembly can
 * never throw out of this module, and the orchestrator guards the call again, so the baseline result never depends on it.
 *
 * NEUTRAL AND SOURCE-FREE: no pressure, promotion input, owner, shadow result, decision facts, evidence, feature flag, Goal,
 * manual / automatic provenance or recurrence / opportunity field. No I/O, no database, no timing search, no Constructor call, no
 * clock, no environment, no logging, no JSON / structuredClone copying. Not serialized, not persisted, not logged, not public.
 *
 * P4b1 does NOT prove a future consumer's own working copies are safe; P4b2 must copy again if it mutates anything.
 */

import type { DayIntent, DayIntentFlexibility, DayIntentImportance, ConstructionWindow } from './dayIntent';
import type { FixedPlacementConstraint, PlacementCandidate, PlacementTimingFit } from './dayConstructor';
import type { BlockedInterval, BlockedIntervalSource } from './dayCapacity';

export interface ConstructionBasisIntent {
  readonly id: string;
  readonly title: string;
  readonly activityId?: string;
  readonly importance: DayIntentImportance;
  /** A civil date string (YYYY-MM-DD), not a Date. */
  readonly deadline?: string;
  readonly estimatedDurationMinutes?: number;
  readonly flexibility: DayIntentFlexibility;
  readonly originalOrder: number;
}

export interface ConstructionBasisWindow {
  readonly date: string;
  readonly timezone: string;
  readonly start: Date;
  readonly end: Date;
}

export interface ConstructionBasisBlocker {
  readonly start: Date;
  readonly end: Date;
  readonly source: BlockedIntervalSource;
}

export interface ConstructionBasisCandidate {
  readonly intentId: string;
  readonly start: Date;
  readonly end: Date;
  readonly timingFit?: PlacementTimingFit;
  readonly candidateOrder: number;
}

/** One candidate-list ENTRY. Its existence means the intent was searched; an empty `candidates` array means nothing usable was found. */
export interface ConstructionBasisCandidateList {
  readonly intentId: string;
  readonly candidates: readonly ConstructionBasisCandidate[];
}

export interface ConstructionBasisFixedConstraint {
  readonly intentId: string;
  readonly start: Date;
  readonly end: Date;
}

/** One FIXED-constraint ENTRY, array-shaped exactly like the Constructor input (zero or several constraints stay representable). */
export interface ConstructionBasisFixedEntry {
  readonly intentId: string;
  readonly constraints: readonly ConstructionBasisFixedConstraint[];
}

export interface ConstructionBasis {
  readonly planningDate: string;
  readonly window: ConstructionBasisWindow;
  readonly intents: readonly ConstructionBasisIntent[];
  readonly blockedIntervals: readonly ConstructionBasisBlocker[];
  readonly initialCandidates: readonly ConstructionBasisCandidateList[];
  readonly finalCandidates: readonly ConstructionBasisCandidateList[];
  readonly fixedConstraints: readonly ConstructionBasisFixedEntry[];
}

export type ConstructionBasisUnavailableReason = 'RUN_NOT_READY' | 'ASSEMBLY_FAILED' | 'DUPLICATE_INTENT_ID';
export type ConstructionBasisOutcome =
  | { readonly status: 'READY'; readonly basis: ConstructionBasis }
  | { readonly status: 'UNAVAILABLE'; readonly reason: ConstructionBasisUnavailableReason };

/** What the orchestrator hands over at T4: its OWN working objects, copied here and never retained. */
export interface ConstructionBasisSource {
  readonly planningDate: string;
  readonly window: ConstructionWindow;
  readonly intents: readonly DayIntent[];
  readonly blockedIntervals: readonly BlockedInterval[];
  /** The T1 capture (or undefined if it could not be taken). */
  readonly initialCandidates: readonly ConstructionBasisCandidateList[] | undefined;
  /** The orchestrator's candidate map as it stands at T3. */
  readonly finalCandidatesByIntentId: Readonly<Record<string, readonly PlacementCandidate[]>>;
  readonly fixedConstraintsByIntentId: Readonly<Record<string, readonly FixedPlacementConstraint[]>>;
}

/** A newly allocated, frozen Date with the same timestamp (an invalid Date stays invalid). Throws for a non-Date: the caller treats that as UNAVAILABLE. */
function ownDate(source: Date): Date {
  return Object.freeze(new Date(source.getTime()));
}

function hasEntry(map: Readonly<Record<string, unknown>>, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(map, id);
}

function copyCandidates(intentId: string, candidates: readonly PlacementCandidate[]): ConstructionBasisCandidateList {
  return Object.freeze({
    intentId,
    candidates: Object.freeze(
      candidates.map((candidate) =>
        Object.freeze({
          intentId: candidate.intentId,
          start: ownDate(candidate.start),
          end: ownDate(candidate.end),
          ...(candidate.timingFit === undefined ? {} : { timingFit: candidate.timingFit }),
          candidateOrder: candidate.candidateOrder,
        })
      )
    ),
  });
}

function copyCandidateLists(intentIds: readonly string[], candidatesByIntentId: Readonly<Record<string, readonly PlacementCandidate[]>>): readonly ConstructionBasisCandidateList[] {
  const lists: ConstructionBasisCandidateList[] = [];
  for (const intentId of intentIds) if (hasEntry(candidatesByIntentId, intentId)) lists.push(copyCandidates(intentId, candidatesByIntentId[intentId]));
  return Object.freeze(lists);
}

/**
 * T1: an owned, frozen copy of every candidate-list ENTRY that exists now (request order). Never throws; `undefined` means the
 * capture could not be taken, which makes the eventual basis UNAVAILABLE (never partial).
 */
export function captureCandidateLists(intentIds: readonly string[], candidatesByIntentId: Readonly<Record<string, readonly PlacementCandidate[]>>): readonly ConstructionBasisCandidateList[] | undefined {
  try {
    return copyCandidateLists(intentIds, candidatesByIntentId);
  } catch {
    return undefined;
  }
}

/** T4: assembles the complete, owned, frozen basis, or reports why it is unavailable. Never throws. */
export function assembleConstructionBasis(source: ConstructionBasisSource): ConstructionBasisOutcome {
  try {
    const intentIds = source.intents.map((intent) => intent.id);
    if (new Set(intentIds).size !== intentIds.length) return Object.freeze({ status: 'UNAVAILABLE', reason: 'DUPLICATE_INTENT_ID' });
    if (source.initialCandidates === undefined) return Object.freeze({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' });
    const initialCandidates = Object.freeze(
      source.initialCandidates.map((list) => copyCandidates(list.intentId, list.candidates as readonly PlacementCandidate[]))
    );
    const basis: ConstructionBasis = Object.freeze({
      planningDate: source.planningDate,
      window: Object.freeze({ date: source.window.date, timezone: source.window.timezone, start: ownDate(source.window.start), end: ownDate(source.window.end) }),
      intents: Object.freeze(
        source.intents.map((intent) =>
          Object.freeze({
            id: intent.id,
            title: intent.title,
            ...(intent.activityId === undefined ? {} : { activityId: intent.activityId }),
            importance: intent.importance,
            ...(intent.deadline === undefined ? {} : { deadline: intent.deadline }),
            ...(intent.estimatedDurationMinutes === undefined ? {} : { estimatedDurationMinutes: intent.estimatedDurationMinutes }),
            flexibility: intent.flexibility,
            originalOrder: intent.originalOrder,
          })
        )
      ),
      blockedIntervals: Object.freeze(source.blockedIntervals.map((blocker) => Object.freeze({ start: ownDate(blocker.start), end: ownDate(blocker.end), source: blocker.source }))),
      initialCandidates,
      finalCandidates: copyCandidateLists(intentIds, source.finalCandidatesByIntentId),
      fixedConstraints: Object.freeze(
        intentIds
          .filter((intentId) => hasEntry(source.fixedConstraintsByIntentId, intentId))
          .map((intentId) =>
            Object.freeze({
              intentId,
              constraints: Object.freeze(source.fixedConstraintsByIntentId[intentId].map((constraint) => Object.freeze({ intentId: constraint.intentId, start: ownDate(constraint.start), end: ownDate(constraint.end) }))),
            })
          )
      ),
    });
    return Object.freeze({ status: 'READY', basis });
  } catch {
    return Object.freeze({ status: 'UNAVAILABLE', reason: 'ASSEMBLY_FAILED' });
  }
}
