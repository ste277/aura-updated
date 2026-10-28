/**
 * Constructor Decision Intelligence -- O5 P4b2b: the IMMUTABLE SCHEDULING ATTEMPT AUTHORITY (pure, inert, detached).
 *
 * PRINCIPLE. Candidate lists are search-state SNAPSHOTS: replenishment overwrites a conflicted loser's list every round, so an
 * intermediate list is gone by the time the run ends. A SCHEDULING ATTEMPT is historical semantic evidence: "this intent attempted this
 * concrete slot, with this timing fit, and lost it to these already-Proposed owners". P3a observes exactly that at the placement gate
 * (and, since P4b2b, carries the attempting candidate's own descriptive `timingFit`). This module projects that observed evidence into a
 * typed, normalized, immutable authority so that a future bounded counterfactual consumes SEMANTIC attempts -- for the promoted candidate
 * AND for the owners it may displace -- instead of reconstructing history from the T1 / Tfinal candidate lists, and without capturing any
 * per-round candidate list.
 *
 * THE MINIMUM CONTRACT (derived from real future need):
 *   SchedulingAttempt { intentId, start, end, timingFit?, conflictingOwnerIds[] }
 *     intentId           the intent that attempted the slot (the P3a loser)
 *     start / end        the exact attempted interval [start, end), copied from the trace string (never rebuilt from a duration)
 *     timingFit          the attempting candidate's own descriptive fit, exactly as P3a carried it (absent when it had none / FIXED target)
 *     conflictingOwnerIds the DISTINCT owners that held part of the slot when it was attempted, in order of first appearance. Historical
 *                         PROVENANCE only: it proves why the slot was lost then. Whether the slot is usable in a counterfactual is a
 *                         question to be recomputed mechanically against the counterfactual's own placements.
 * NORMALIZATION (audited, adopted): P3a emits one event per conflicting owner and one per round. The identity of a slot is
 * (intentId, start, end, timingFit); identical slots over several owners or several rounds are ONE attempt whose conflictingOwnerIds is
 * the union. Nothing is lost that a generator can use: the owner relationships stay as provenance, the round and the winner interval are
 * dropped (BaselinePlacements owns terminal placements; ranking never uses the round). Slots differing in timingFit stay distinct.
 * Attempts are in first-appearance (trace) order -- an ORDER OF DISCOVERY, never a ranking: a consumer ranks by the Constructor's own
 * `compareCandidatesForPlacement` over (timingFit, start), never by position.
 *
 * SUPPLEMENT, NOT REPLACEMENT. P3a records only slots rejected by contention with a Proposed owner. A candidate rejected for any other
 * reason (an external blocker, outside the window, too short, malformed) is never mechanically usable later either -- those gates do not
 * change in a counterfactual -- and a candidate that is feasible makes its intent placed, so its list is the intent's FINAL list. Hence
 * `initialCandidates UNION finalCandidates UNION attempts` contains every candidate of every historical list that could ever be usable
 * (proved structurally and checked against a full-history oracle in the behavior suite). The attempts supplement the ConstructionBasis;
 * they do not replace its initial / final lists. Candidate identity across both is (start, timingFit): the placed interval is always
 * [start, start + the intent's duration), and the origin of a candidate (initial / final / attempt) never affects ranking.
 *
 * `candidateOrder` is deliberately NOT carried: two candidates with equal timingFit and equal start place the SAME interval with the SAME
 * fit, so the choice between them cannot change a placement outcome; it only labels which duplicate was chosen.
 *
 * SOURCE AND SAME-RUN PAIRING. The only source is the P3a trace of the SAME orchestration run, handed here by the internal promotion
 * boundary together with that run's ConstructionBasis (every intent id is validated against it). No second orchestration, no timing
 * search, no Constructor call, no database, snapshot or clock. No pressure, precedence, policy, round or raw trace leaves this module.
 *
 * OWNERSHIP. Every Date is created from a trace string and every array / object is new and `Object.freeze`d -- BUT freezing does NOT stop a
 * Date setter changing a Date's time value; ownership plus the #208 no-Date-mutator guard (this module is on that list) protect it. All-or-
 * nothing: `READY` or `UNAVAILABLE` with an infrastructural reason; never throws out of `projectSchedulingAttempts`.
 */

import type { PlacementTimingFit } from './dayConstructor';
import type { ContentionTrace } from './contentionTrace';
import type { ConstructionBasisOutcome } from './constructionBasis';

export interface SchedulingAttempt {
  readonly intentId: string;
  readonly start: Date;
  readonly end: Date;
  readonly timingFit?: PlacementTimingFit;
  readonly conflictingOwnerIds: readonly string[];
}

export interface SchedulingAttemptAuthority {
  readonly attempts: readonly SchedulingAttempt[];
}

export type SchedulingAttemptUnavailableReason = 'RUN_NOT_READY' | 'INCONSISTENT_INPUT' | 'CAPTURE_FAILED';
export type SchedulingAttemptOutcome =
  | { readonly status: 'READY'; readonly authority: SchedulingAttemptAuthority }
  | { readonly status: 'UNAVAILABLE'; readonly reason: SchedulingAttemptUnavailableReason };

function unavailable(reason: SchedulingAttemptUnavailableReason): SchedulingAttemptOutcome {
  return Object.freeze({ status: 'UNAVAILABLE', reason });
}

/**
 * The ONE normalization of the raw trace into scheduling attempts (the single semantic source also used by the promotion contention view).
 * Throws on a malformed payload (invalid / reversed instants, a timing fit that is not one of the four existing values): every caller
 * wraps it and fails closed. Pure.
 */
export function normalizeSchedulingAttempts(trace: ContentionTrace): readonly SchedulingAttempt[] {
  const fits: readonly string[] = ['BEST', 'GOOD', 'WORKABLE', 'CAUTION'];
  const slots: Array<{ intentId: string; start: Date; end: Date; timingFit: PlacementTimingFit | undefined; owners: string[] }> = [];
  const positions = new Map<string, number>();
  for (const event of trace.events) {
    const start = new Date(event.attemptedStart);
    const end = new Date(event.attemptedEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start.getTime() >= end.getTime()) throw new Error('malformed attempted interval');
    if (event.timingFit !== undefined && !fits.includes(event.timingFit)) throw new Error('malformed timing fit');
    const key = `${event.loserIntentId}|${start.getTime()}|${end.getTime()}|${event.timingFit ?? ''}`;
    const position = positions.get(key);
    if (position === undefined) {
      positions.set(key, slots.length);
      slots.push({ intentId: event.loserIntentId, start, end, timingFit: event.timingFit, owners: [event.winnerIntentId] });
    } else if (!slots[position].owners.includes(event.winnerIntentId)) {
      slots[position].owners.push(event.winnerIntentId);
    }
  }
  return Object.freeze(
    slots.map((slot) =>
      Object.freeze({
        intentId: slot.intentId,
        start: Object.freeze(slot.start),
        end: Object.freeze(slot.end),
        ...(slot.timingFit === undefined ? {} : { timingFit: slot.timingFit }),
        conflictingOwnerIds: Object.freeze([...slot.owners]),
      })
    )
  );
}

/**
 * Projects the run-level scheduling attempts of the SAME run's trace, validated against that run's ConstructionBasis (every attempting
 * intent and every conflicting owner must be a basis intent). Never throws.
 */
export function projectSchedulingAttempts(trace: ContentionTrace, basisOutcome: ConstructionBasisOutcome): SchedulingAttemptOutcome {
  try {
    if (basisOutcome.status !== 'READY') return unavailable('RUN_NOT_READY');
    const intentIds = basisOutcome.basis.intents.map((intent) => intent.id);
    const attempts = normalizeSchedulingAttempts(trace);
    if (attempts.some((attempt) => !intentIds.includes(attempt.intentId) || attempt.conflictingOwnerIds.some((id) => !intentIds.includes(id)))) return unavailable('INCONSISTENT_INPUT');
    return Object.freeze({ status: 'READY', authority: Object.freeze({ attempts }) });
  } catch {
    return unavailable('CAPTURE_FAILED');
  }
}
