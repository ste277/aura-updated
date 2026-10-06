/**
 * Constructor Decision Intelligence -- O5 P4c3 (P4c2): the PURE ACTIVE RESULT MATERIALIZER (inert).
 *
 * Given the baseline Constructor result, the same-run construction basis and ONE typed accepted counterfactual (already selected by the P4c1 selector), it builds
 * the authoritative Constructor READY result that the counterfactual describes -- WITHOUT a second construction. Nothing here calls the Constructor, the
 * orchestrator, a timing search, P4b2 or P4b3; there is no database, clock, randomness, logging or mutation. No production caller uses its output yet.
 *
 * FIELD AUTHORITY (every field is copied exactly, derived exactly from immutable same-run authority, or recomputed with an existing pure function -- never guessed):
 *   targetDate, timezone, constructionWindow, resolvedIntents, warnings, constructedDay.date, requestedCapacity   COPIED (detached) from the baseline result
 *   unchanged Proposed items                                                                                      COPIED (detached, every field incl. candidateOrder)
 *   promoted P / relocated owner items   intentId / activityId / title: the construction basis; start / end / timingFit: the accepted counterfactual;
 *                                        placementSource: SELECTED_CANDIDATE (a flexible chosen placement); requiresConfirmation: true;
 *                                        candidateOrder: OMITTED -- it is a list-relative index not uniquely recoverable (replenishment re-indexes lists, the basis
 *                                        keeps only the initial and final lists, duplicates exist) and no consumer reads it; it is never synthesized
 *   Proposed order                                                                                                the existing `sortByOverloadPrecedence` over the basis intents
 *   proposedCapacity                                                                                              the existing `computeCapacitySnapshot` over the baseline result's own
 *                                                                                                                 window (it carries `source`; the basis window does not), the basis
 *                                                                                                                 blockers and the final placed minutes
 *   deferredItems / conflicts                                                                                     EMPTY: the materializability gate (P4c2a) admits only a baseline whose sole Deferred
 *                                                                                                                 item and sole conflict are the promoted candidate's own, which leave with it
 *
 * FAIL CLOSED. Anything missing, ambiguous or inconsistent is a typed UNAVAILABLE and the baseline stays authoritative: an authority that was not minted, a basis
 * from another run, an unready run, a failed materializability gate, a counterfactual that adds, drops or moves anything it should not (defense in depth over P4b3), a duration
 * mismatch, an overlap, a blocker or window violation, or a broken conservation property. It never throws. The output is detached (no shared Date or object) and deeply frozen;
 * the baseline result, the basis and the accepted authority are never mutated.
 */

import { isAcceptedCounterfactual, type AcceptedCounterfactual, type AcceptedPlacement } from './acceptedCounterfactual';
import { evaluateMaterializability } from './activeMaterializability';
import { sortByOverloadPrecedence, type ConstructionWindow, type DayIntent } from './dayIntent';
import { computeCapacitySnapshot, type BlockedInterval } from './dayCapacity';
import type { ConstructionBasisOutcome } from './constructionBasis';
import type { ConstructDayPreview, OrchestrateConstructDayResult } from './dayConstructorOrchestrator';
import type { ProposedItem } from './dayConstructor';

export type MaterializerUnavailableReason = 'RUN_NOT_READY' | 'INCONSISTENT_AUTHORITY' | 'DEFERRED_DIAGNOSTIC_UNRESOLVED' | 'MATERIALIZATION_FAILED';

export interface ActiveMaterializationInput {
  readonly baselineResult: OrchestrateConstructDayResult;
  readonly constructionBasis: ConstructionBasisOutcome;
  readonly accepted: AcceptedCounterfactual;
}

export type ActiveMaterialization =
  | { readonly status: 'READY'; readonly result: Extract<OrchestrateConstructDayResult, { status: 'READY' }> }
  | { readonly status: 'UNAVAILABLE'; readonly reason: MaterializerUnavailableReason };

class AuthorityMismatch extends Error {}

function unavailable(reason: MaterializerUnavailableReason): ActiveMaterialization {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

function mismatch(condition: boolean): void {
  if (condition) throw new AuthorityMismatch('inconsistent authority');
}

/** A detached structural copy: new Dates, new arrays, new plain objects; anything else is not representable here. */
function detach<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') throw new Error('not representable');
    return value;
  }
  if (value instanceof Date) return new Date(value.getTime()) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => detach(entry)) as unknown as T;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error('not a plain object');
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = detach((value as Record<string, unknown>)[key]);
  return out as T;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/** Half-open interval overlap: the Constructor's exact formula. */
function overlapsMs(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function materializeActiveResult(input: ActiveMaterializationInput): ActiveMaterialization {
  try {
    const accepted = input.accepted;
    if (!isAcceptedCounterfactual(accepted)) return unavailable('INCONSISTENT_AUTHORITY');
    if (input.constructionBasis !== accepted.constructionBasis) return unavailable('INCONSISTENT_AUTHORITY');
    const baseline = input.baselineResult;
    if (baseline.status !== 'READY' || input.constructionBasis.status !== 'READY') return unavailable('RUN_NOT_READY');
    const basis = input.constructionBasis.basis;
    const preview = baseline.preview;
    const day = preview.constructedDay;
    const candidateId = accepted.candidateIntentId;

    const gate = evaluateMaterializability(day, candidateId);
    if (gate.status === 'UNAVAILABLE') return unavailable(gate.reason);

    // ---- authority cross-checks (defense in depth over P4b3; any mismatch is INCONSISTENT_AUTHORITY)
    const intentIds = basis.intents.map((intent) => intent.id);
    mismatch(new Set(intentIds).size !== intentIds.length);
    const intentOf = new Map(basis.intents.map((intent) => [intent.id, intent]));
    const baselineIds = day.proposedItems.map((item) => item.intentId);
    mismatch(new Set(baselineIds).size !== baselineIds.length || baselineIds.some((id) => !intentOf.has(id)) || baselineIds.includes(candidateId));
    const candidate = intentOf.get(candidateId);
    mismatch(!candidate || candidate.flexibility !== 'FLEXIBLE' || candidate.estimatedDurationMinutes === undefined);
    mismatch(accepted.promoted.intentId !== candidateId || accepted.promoted.placementSource !== 'PROMOTED_CONTENTION_ATTEMPT');
    const relocatedIds = accepted.relocated.map((placement) => placement.intentId);
    const displaced = accepted.displacedOwnerIds;
    mismatch(displaced.length === 0 || new Set(displaced).size !== displaced.length || new Set(relocatedIds).size !== relocatedIds.length);
    mismatch(displaced.length !== relocatedIds.length || displaced.some((id) => !relocatedIds.includes(id)));
    const baselineOf = new Map(day.proposedItems.map((item) => [item.intentId, item]));
    for (const placement of accepted.relocated) {
      const base = baselineOf.get(placement.intentId);
      mismatch(!base || base.placementSource !== 'SELECTED_CANDIDATE' || intentOf.get(placement.intentId)?.flexibility !== 'FLEXIBLE' || placement.placementSource !== 'RELOCATED_CAPTURED_CANDIDATE');
    }
    const rows = accepted.placements;
    const rowIds = rows.map((row) => row.intentId);
    mismatch(new Set(rowIds).size !== rowIds.length || rowIds.length !== baselineIds.length + 1 || !rowIds.includes(candidateId) || baselineIds.some((id) => !rowIds.includes(id)));
    for (const row of rows) {
      if (row.placementSource === 'BASELINE_UNCHANGED') {
        const base = baselineOf.get(row.intentId);
        mismatch(!base || displaced.includes(row.intentId) || base.start.getTime() !== row.startMs || base.end.getTime() !== row.endMs || base.timingFit !== row.timingFit);
      } else {
        mismatch(row.intentId !== candidateId && !displaced.includes(row.intentId));
      }
    }
    for (const base of day.proposedItems) mismatch(base.placementSource === 'FIXED_CONSTRAINT' && displaced.includes(base.intentId));
    const sameRow = (a: AcceptedPlacement, b: AcceptedPlacement | undefined) => b !== undefined && a.startMs === b.startMs && a.endMs === b.endMs && a.timingFit === b.timingFit && a.placementSource === b.placementSource;
    mismatch(!sameRow(accepted.promoted, rows.find((row) => row.intentId === candidateId)));
    for (const placement of accepted.relocated) mismatch(!sameRow(placement, rows.find((row) => row.intentId === placement.intentId)));

    // ---- changed intervals: duration, window, blockers, pairwise overlap (exact Constructor interval semantics)
    const window = preview.constructionWindow;
    const windowStart = window.start.getTime();
    const windowEnd = window.end.getTime();
    const blockers = basis.blockedIntervals.map((blocker) => ({ start: blocker.start.getTime(), end: blocker.end.getTime() })).filter((blocker) => blocker.start < blocker.end);
    for (const placement of [accepted.promoted, ...accepted.relocated]) {
      const minutes = intentOf.get(placement.intentId)?.estimatedDurationMinutes;
      mismatch(minutes === undefined || placement.endMs - placement.startMs !== minutes * 60000 || placement.startMs < windowStart || placement.endMs > windowEnd);
    }
    for (const row of rows) mismatch(blockers.some((blocker) => overlapsMs(row.startMs, row.endMs, blocker.start, blocker.end)));
    for (let i = 0; i < rows.length; i += 1) for (let j = i + 1; j < rows.length; j += 1) mismatch(overlapsMs(rows[i].startMs, rows[i].endMs, rows[j].startMs, rows[j].endMs));

    // ---- build the Proposed set: unchanged items are detached copies; P and relocated owners from the proven field authorities (no candidateOrder)
    const changed = new Map<string, AcceptedPlacement>([[candidateId, accepted.promoted], ...accepted.relocated.map((placement) => [placement.intentId, placement] as const)]);
    const items: ProposedItem[] = rows.map((row) => {
      const changedPlacement = changed.get(row.intentId);
      if (!changedPlacement) return detach(baselineOf.get(row.intentId)!);
      const intent = intentOf.get(row.intentId)!;
      const item: ProposedItem = {
        intentId: intent.id,
        activityId: intent.activityId,
        title: intent.title,
        start: new Date(changedPlacement.startMs),
        end: new Date(changedPlacement.endMs),
        placementSource: 'SELECTED_CANDIDATE',
        ...(changedPlacement.timingFit === undefined ? {} : { timingFit: changedPlacement.timingFit }),
        requiresConfirmation: true,
      };
      return item;
    });

    // ---- the existing precedence order over the authoritative basis intents
    const precedence = sortByOverloadPrecedence(basis.intents as unknown as readonly DayIntent[], basis.planningDate).map((intent) => intent.id);
    const ordered = items.slice().sort((a, b) => precedence.indexOf(a.intentId) - precedence.indexOf(b.intentId));

    // ---- capacity: the existing pure function over the baseline result's own window, the basis blockers and the final placed minutes
    const placedMinutes = ordered.reduce((total, item) => total + (item.end.getTime() - item.start.getTime()) / 60000, 0);
    const blockedIntervals: BlockedInterval[] = basis.blockedIntervals.map((blocker) => ({ start: new Date(blocker.start.getTime()), end: new Date(blocker.end.getTime()), source: blocker.source }));
    const capacity = computeCapacitySnapshot(detach(window) as ConstructionWindow, blockedIntervals, placedMinutes);
    if (capacity.status !== 'READY') return unavailable('MATERIALIZATION_FAILED');

    const materialized: ConstructDayPreview = {
      targetDate: preview.targetDate,
      timezone: preview.timezone,
      constructionWindow: detach(preview.constructionWindow),
      resolvedIntents: detach(preview.resolvedIntents),
      constructedDay: {
        date: day.date,
        proposedItems: ordered,
        deferredItems: [],
        conflicts: [],
        requestedCapacity: detach(day.requestedCapacity),
        proposedCapacity: capacity.snapshot,
      },
      warnings: detach(preview.warnings),
    };

    // ---- conservation: P + baseline Proposed, nothing lost, nothing duplicated, nothing Deferred
    const finalIds = materialized.constructedDay.proposedItems.map((item) => item.intentId);
    mismatch(finalIds.length !== baselineIds.length + 1 || new Set(finalIds).size !== finalIds.length || !finalIds.includes(candidateId) || finalIds.length !== intentIds.length || finalIds.some((id) => !intentOf.has(id)));
    mismatch(materialized.constructedDay.deferredItems.length !== 0 || materialized.constructedDay.conflicts.length !== 0);
    return Object.freeze({ status: 'READY', result: deepFreeze({ status: 'READY' as const, preview: materialized }) });
  } catch (error) {
    return unavailable(error instanceof AuthorityMismatch ? 'INCONSISTENT_AUTHORITY' : 'MATERIALIZATION_FAILED');
  }
}
