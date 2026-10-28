/**
 * O5 SHADOW ROLLOUT R3 -- `buildShadowReviewPayload` (pure suite).
 *
 *   Part 1  the directed shape: one PROMOTED item, one MOVED owner, exact display fields, no internal/raw data
 *   Part 2  multiple displaced owners, in `displacedOwnerIds` order
 *   Part 3  fail-closed: non-READY baseline/materialized, missing title, unmatched relocated owner, missing baseline
 *           Deferred/Proposed entry -- every inconsistency yields `undefined`, never a partial or guessed payload
 *   Part 4  no new scheduling interpretation: the delta is read straight from `accepted.promoted`/`relocated`/
 *           `displacedOwnerIds`, never recomputed from the two days independently
 */
import { buildShadowReviewPayload } from '../apps/web/lib/shadowReviewDelta';
import type { OrchestrateConstructDayResult } from '../apps/web/lib/dayConstructorOrchestrator';
import type { AcceptedCounterfactual } from '../apps/web/lib/acceptedCounterfactual';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const iso = (h: string) => `2026-10-09T${h}:00.000Z`;
const at = (h: string) => new Date(iso(h));

function proposed(intentId: string, title: string, start: string, end: string, placementSource: 'FIXED_CONSTRAINT' | 'SELECTED_CANDIDATE' = 'SELECTED_CANDIDATE') {
  return { intentId, title, start: at(start), end: at(end), placementSource };
}
function deferred(intentId: string) {
  return { intentId, primaryReason: 'NO_CANDIDATES', diagnostics: [] };
}
function ready(proposedItems: ReturnType<typeof proposed>[], deferredItems: ReturnType<typeof deferred>[] = []): OrchestrateConstructDayResult {
  return { status: 'READY', preview: { targetDate: '2026-10-09', timezone: 'UTC', constructionWindow: {} as never, resolvedIntents: [], constructedDay: { date: '2026-10-09', proposedItems, deferredItems, conflicts: [], requestedCapacity: {} as never }, warnings: [] } } as unknown as OrchestrateConstructDayResult;
}
function placement(intentId: string, start: string, end: string, timingFit?: 'BEST' | 'GOOD' | 'WORKABLE' | 'CAUTION') {
  return { intentId, startMs: at(start).getTime(), endMs: at(end).getTime(), placementSource: 'PROMOTED_CONTENTION_ATTEMPT', timingFit };
}
function accepted(over: Partial<AcceptedCounterfactual>): AcceptedCounterfactual {
  return { candidateIntentId: 'P', promoted: placement('P', '17:00', '18:00'), displacedOwnerIds: ['O'], relocated: [placement('O', '19:00', '20:00', 'GOOD')], placements: [], constructionBasis: {} as never, baselinePlacements: {} as never, ...over } as unknown as AcceptedCounterfactual;
}

(() => {
  // ======================================================================
  console.log('=== Part 1: the directed shape ===');
  const baseline = ready([proposed('O', 'Workout', '10:00', '11:00')], [deferred('P')]);
  const materialized = ready([proposed('O', 'Workout', '19:00', '20:00'), proposed('P', 'Reading', '17:00', '18:00')]);
  const a = accepted({});
  const payload = buildShadowReviewPayload(baseline, materialized, a);
  check('a payload is produced for a consistent same-run READY/READY pair', payload !== undefined);
  check('reason is a closed, non-pressure-vocabulary category', payload?.reason === 'WOULD_OTHERWISE_BE_DEFERRED');
  check('exactly two changed items: PROMOTED then MOVED, order preserved', payload?.changedItems.length === 2 && payload.changedItems[0].kind === 'PROMOTED' && payload.changedItems[1].kind === 'MOVED');
  const promotedItem = payload?.changedItems[0];
  check('PROMOTED: candidate id/title from the materialized day, baseline DEFERRED (no start/end), alternative from accepted.promoted', promotedItem?.intentId === 'P' && promotedItem.title === 'Reading' && JSON.stringify(promotedItem.baseline) === JSON.stringify({ status: 'DEFERRED' }) && promotedItem.alternative.status === 'SCHEDULED' && promotedItem.alternative.start === iso('17:00') && promotedItem.alternative.end === iso('18:00'));
  const movedItem = payload?.changedItems[1];
  check('MOVED: owner id/title, baseline from the baseline day\'s own placement, alternative from accepted.relocated (with its timingFit)', movedItem?.intentId === 'O' && movedItem.title === 'Workout' && movedItem.baseline.status === 'SCHEDULED' && movedItem.baseline.start === iso('10:00') && movedItem.baseline.end === iso('11:00') && movedItem.alternative.start === iso('19:00') && movedItem.alternative.timingFit === 'GOOD');
  check('the payload is frozen', Object.isFrozen(payload) && Object.isFrozen(payload?.changedItems));
  check('NO RAW/INTERNAL DATA: no ConstructionBasis/BaselinePlacements/fingerprint/authority-shape keys anywhere in the payload', !/constructionBasis|baselinePlacements|fingerprint|ACCEPTED_BRAND|candidateIntentId/i.test(JSON.stringify(payload)));
  check('NO HIGH-CARDINALITY INTERNAL FIELD beyond the already-authorized intentId/title/instant/timingFit', JSON.stringify(Object.keys(promotedItem!).sort()) === JSON.stringify(['alternative', 'baseline', 'intentId', 'kind', 'title']));

  // ======================================================================
  console.log('=== Part 2: multiple displaced owners, in order ===');
  {
    const b2 = ready([proposed('O1', 'Workout', '09:00', '10:00'), proposed('O2', 'Call', '11:00', '12:00')], [deferred('P')]);
    const m2 = ready([proposed('O1', 'Workout', '13:00', '14:00'), proposed('O2', 'Call', '15:00', '16:00'), proposed('P', 'Reading', '09:00', '10:00')]);
    const a2 = accepted({ displacedOwnerIds: ['O1', 'O2'], relocated: [placement('O1', '13:00', '14:00'), placement('O2', '15:00', '16:00')] } as Partial<AcceptedCounterfactual>);
    const p2 = buildShadowReviewPayload(b2, m2, a2);
    check('three changed items: PROMOTED, then MOVED in displacedOwnerIds order (O1 before O2)', p2?.changedItems.map((c) => `${c.kind}:${c.intentId}`).join() === 'PROMOTED:P,MOVED:O1,MOVED:O2');
  }

  // ======================================================================
  console.log('=== Part 3: fail closed -- never a partial or guessed payload ===');
  const notReadyBaseline: OrchestrateConstructDayResult = { status: 'TIMEZONE_MISSING' } as OrchestrateConstructDayResult;
  check('baseline not READY -> undefined', buildShadowReviewPayload(notReadyBaseline, materialized, a) === undefined);
  check('materialized not READY -> undefined', buildShadowReviewPayload(baseline, notReadyBaseline, a) === undefined);
  const materializedMissingCandidate = ready([proposed('O', 'Workout', '19:00', '20:00')]); // candidate P absent -- inconsistent
  check('candidate title missing in the materialized day -> undefined (never guessed)', buildShadowReviewPayload(baseline, materializedMissingCandidate, a) === undefined);
  const baselineNoDeferred = ready([proposed('O', 'Workout', '10:00', '11:00')], []); // candidate P was never Deferred in baseline
  check('candidate not found in baseline deferredItems -> undefined', buildShadowReviewPayload(baselineNoDeferred, materialized, a) === undefined);
  const aUnmatchedRelocated = accepted({ displacedOwnerIds: ['O'], relocated: [] } as Partial<AcceptedCounterfactual>);
  check('a displaced owner with no matching relocated placement -> undefined (never half the picture)', buildShadowReviewPayload(baseline, materialized, aUnmatchedRelocated) === undefined);
  const baselineMissingOwner = ready([], [deferred('P'), deferred('O')]); // owner O not Proposed in baseline (inconsistent for an ACCEPT)
  check('a displaced owner missing from the baseline Proposed set -> undefined', buildShadowReviewPayload(baselineMissingOwner, materialized, a) === undefined);
  check('a throwing/garbage accepted object never throws -- it yields undefined', buildShadowReviewPayload(baseline, materialized, { get candidateIntentId(): never { throw new Error('x'); } } as unknown as AcceptedCounterfactual) === undefined);
  check('garbage results never throw', buildShadowReviewPayload(null as unknown as OrchestrateConstructDayResult, null as unknown as OrchestrateConstructDayResult, null as unknown as AcceptedCounterfactual) === undefined);

  // ======================================================================
  console.log('=== Part 4: no new scheduling interpretation ===');
  {
    // the alternative's displayed instants come EXACTLY from accepted.promoted/relocated (startMs/endMs), not from scanning the materialized day's own proposedItems for a "changed" interval
    const weirdMaterialized = ready([proposed('O', 'Workout', '03:00', '04:00'), proposed('P', 'Reading', '03:00', '04:00')]); // deliberately NOT matching accepted.promoted/relocated
    const p4 = buildShadowReviewPayload(baseline, weirdMaterialized, a);
    check('the alternative instants are the authority\'s OWN promoted/relocated placements, never re-derived from the materialized day\'s proposedItems (which this fixture deliberately disagrees with)', p4?.changedItems[0].alternative.start === iso('17:00') && p4.changedItems[1].alternative.start === iso('19:00'));
  }

  if (!allPassed) { console.error('SOME SHADOW REVIEW DELTA CHECKS FAILED'); process.exit(1); }
  console.log('ALL SHADOW REVIEW DELTA CHECKS PASSED');
})();
