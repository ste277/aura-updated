/**
 * O5 P4c3 -- the PROPERTY ORACLE for one materialized active result (test support only; no production consumer).
 *
 * Given the BASELINE Constructor result, the materialized ACTIVE result and the typed accepted authority it was built from, it independently checks every
 * conservation / preservation / FIXED / owner / timing / order / capacity / window / blocker / overlap property, plus deep freeze and detachment. It shares
 * NO code with the materializer except the existing pure capacity function (the authority the materializer itself must agree with).
 */
import type { OrchestrateConstructDayResult } from '../apps/web/lib/dayConstructorOrchestrator';
import type { AcceptedCounterfactual } from '../apps/web/lib/acceptedCounterfactual';
import { computeCapacitySnapshot } from '../apps/web/lib/dayCapacity';

export type ReadyResult = Extract<OrchestrateConstructDayResult, { status: 'READY' }>;

/** What the caller independently expects: the final Proposed order, and the title / duration of the promoted item. */
export interface OracleExpectations {
  readonly order: readonly string[];
  readonly titleOf: (intentId: string) => string | undefined;
  readonly durationMinutesOf: (intentId: string) => number | undefined;
}

export const snap = (v: unknown): string => JSON.stringify(v);

export const reachable = (v: unknown, seen = new Set<unknown>()): Set<unknown> => {
  if (v !== null && typeof v === 'object' && !seen.has(v)) { seen.add(v); Object.values(v as Record<string, unknown>).forEach((c) => reachable(c, seen)); }
  return seen;
};

export const deepFrozen = (v: unknown, seen = new Set<unknown>()): boolean => {
  if (v === null || typeof v !== 'object' || seen.has(v)) return true;
  seen.add(v);
  return Object.isFrozen(v) && Object.values(v as Record<string, unknown>).every((c) => deepFrozen(c, seen));
};

export function activeViolations(baselineResult: OrchestrateConstructDayResult, active: ReadyResult, accepted: AcceptedCounterfactual, expected: OracleExpectations): string[] {
  const v: string[] = [];
  if (baselineResult.status !== 'READY') return ['baseline not READY'];
  const b = baselineResult.preview; const a = active.preview;
  const bd = b.constructedDay; const ad = a.constructedDay;
  const P = accepted.candidateIntentId;
  const displaced = new Set(accepted.displacedOwnerIds);
  const baseIds = bd.proposedItems.map((i) => i.intentId); const actIds = ad.proposedItems.map((i) => i.intentId);
  if (actIds.length !== baseIds.length + 1) v.push('count');
  if (new Set(actIds).size !== actIds.length) v.push('duplicate');
  if (!actIds.includes(P) || baseIds.some((id) => !actIds.includes(id))) v.push('conservation');
  if (ad.deferredItems.length !== 0 || ad.conflicts.length !== 0) v.push('deferred/conflicts not empty');
  for (const k of ['targetDate', 'timezone'] as const) if (a[k] !== b[k]) v.push(`top:${k}`);
  if (snap(a.constructionWindow) !== snap(b.constructionWindow) || snap(a.resolvedIntents) !== snap(b.resolvedIntents) || snap(a.warnings) !== snap(b.warnings)) v.push('top-level fields');
  if (ad.date !== bd.date || snap(ad.requestedCapacity) !== snap(bd.requestedCapacity)) v.push('day fields / requestedCapacity');
  const baseOf = new Map(bd.proposedItems.map((i) => [i.intentId, i]));
  const relocated = new Map(accepted.relocated.map((r) => [r.intentId, r]));
  for (const it of ad.proposedItems) {
    if (it.intentId === P) {
      if (it.start.getTime() !== accepted.promoted.startMs || it.end.getTime() !== accepted.promoted.endMs || it.placementSource !== 'SELECTED_CANDIDATE' || it.requiresConfirmation !== true || 'candidateOrder' in it || it.timingFit !== accepted.promoted.timingFit || it.title !== expected.titleOf(P)) v.push('P item');
      if ((it.end.getTime() - it.start.getTime()) / 60000 !== (expected.durationMinutesOf(P) ?? -1)) v.push('P duration');
    } else if (displaced.has(it.intentId)) {
      const r = relocated.get(it.intentId); const base = baseOf.get(it.intentId);
      if (!r || !base || it.start.getTime() !== r.startMs || it.end.getTime() !== r.endMs || it.timingFit !== r.timingFit || it.placementSource !== 'SELECTED_CANDIDATE' || 'candidateOrder' in it || it.title !== base.title || it.activityId !== base.activityId || it.requiresConfirmation !== true) v.push(`owner ${it.intentId}`);
      if (base && it.end.getTime() - it.start.getTime() !== base.end.getTime() - base.start.getTime()) v.push('owner duration');
    } else if (snap(it) !== snap(baseOf.get(it.intentId))) v.push(`unchanged ${it.intentId} differs (incl. FIXED / non-owner / candidateOrder)`);
  }
  const order = expected.order.filter((id) => actIds.includes(id));
  if (JSON.stringify(actIds) !== JSON.stringify(order)) v.push(`order ${actIds} vs ${order}`);
  const win = a.constructionWindow;
  const blockers = accepted.constructionBasis.status === 'READY' ? accepted.constructionBasis.basis.blockedIntervals : [];
  for (const it of ad.proposedItems) {
    if (it.start.getTime() < win.start.getTime() || it.end.getTime() > win.end.getTime()) v.push(`window ${it.intentId}`);
    if (blockers.some((bl) => it.start.getTime() < bl.end.getTime() && bl.start.getTime() < it.end.getTime())) v.push(`blocker ${it.intentId}`);
  }
  for (let i = 0; i < ad.proposedItems.length; i += 1) for (let j = i + 1; j < ad.proposedItems.length; j += 1) {
    const x = ad.proposedItems[i]; const y = ad.proposedItems[j];
    if (x.start.getTime() < y.end.getTime() && y.start.getTime() < x.end.getTime()) v.push(`overlap ${x.intentId}/${y.intentId}`);
  }
  const placed = ad.proposedItems.reduce((t, i) => t + (i.end.getTime() - i.start.getTime()) / 60000, 0);
  const cap = computeCapacitySnapshot(win, blockers.map((bl) => ({ start: bl.start, end: bl.end, source: bl.source })), placed);
  if (cap.status !== 'READY' || snap(cap.snapshot) !== snap(ad.proposedCapacity)) v.push('proposedCapacity');
  if (!deepFrozen(active)) v.push('not frozen');
  const baseReach = reachable(baselineResult);
  if ([...reachable(active)].some((o) => typeof o === 'object' && o !== null && baseReach.has(o))) v.push('shares an object with the baseline');
  return v;
}
