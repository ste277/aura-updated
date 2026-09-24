/**
 * Right Now selection -- COMMITTED DAY FIRST, guidance second.
 *
 * Pure selection boundary over the ALREADY-composed canonical
 * `HomeTimelineItem[]` (homeTimelineComposer.ts). It never re-derives,
 * re-ranks or re-joins anything the Composer owns.
 *
 * PLANNED != RECOMMENDED OPTION. An existing PlannedActivity answers "what
 * have I committed to?"; an Opportunity answers "what would be good to do?".
 * Guidance `rank` has NO authority over committed plans: a plan happening
 * now is Right Now whether or not the guidance engine annotated it, and
 * however it was created (Goal, Capture, Opportunity, Day Builder, typed
 * Plan My Day, ...). `rank` only orders competing Opportunities.
 *
 * Contract, in strict order:
 *   1. ACTIVE_PLAN    a PLAN item happening now.
 *   2. IMMINENT_PLAN  else, the next PLAN item starting within the existing
 *                     STARTING_SOON window (30 minutes, dailyAgenda.ts).
 *   3. OPPORTUNITY    else, a current Opportunity (lowest guidance rank).
 *   4. CONTEXT_OPEN   else.
 *
 * EXECUTION TIME TRUTH = ABSOLUTE INSTANTS. "Now" is an explicit `Date`
 * (Home's ticking instant); each item's `start`/`end` are ISO instants.
 * Activity, imminence and end are decided by comparing those instants -- never
 * by the Composer's minute-of-day projection (`isCurrent`/`isPast`), which is
 * a visual-position concept and is wrong for a plan crossing local midnight
 * (23:30-00:30 has end minute < start minute). Nor by `agendaStatus`, which is
 * fixed at agenda-fetch time and goes stale while Home stays mounted.
 * `agendaStatus` is consumed only for durable exclusion: COMPLETED (logged)
 * and MISSED (elapsed, unlogged) plans are never eligible; a MISSED plan can
 * never come back because its end instant only recedes.
 *
 * Interval convention (matches dailyAgenda.ts): start <= now <= end -- the end
 * instant is inclusive; the agenda marks a plan MISSED only once now is
 * strictly past it. Imminent: start > now and start - now <= 30 minutes
 * (inclusive at exactly 30). Date participates, so 10:10 tomorrow is never
 * "10 minutes" after 10:00 today.
 *
 * OVERLAP. If several plans are active (or imminent) at once, the winner is
 * the earliest start, then the earliest end, then the lowest id -- an explicit
 * total order, independent of input/database row order. It resolves an
 * already-overlapping committed state deterministically; it is not a
 * scheduling policy (plans carry no fixed/flexible information at this layer).
 *
 * Only PLAN-sourced items are commitments here; shared Moments are not
 * considered by this selector.
 */
import type { HomeTimelineItem } from './homeTimelineTypes';
import { STARTING_SOON_WINDOW_MS } from './dailyAgenda';

export type RightNowState =
  | { kind: 'ACTIVE_PLAN'; item: HomeTimelineItem }
  | { kind: 'IMMINENT_PLAN'; item: HomeTimelineItem }
  | { kind: 'OPPORTUNITY'; item: HomeTimelineItem }
  | { kind: 'CONTEXT_OPEN' };

function instants(item: HomeTimelineItem): { startMs: number; endMs: number } | null {
  const startMs = Date.parse(item.start);
  if (!Number.isFinite(startMs)) return null;
  const endMs = item.end ? Date.parse(item.end) : startMs;
  if (!Number.isFinite(endMs)) return null;
  return { startMs, endMs };
}

function isResolved(item: HomeTimelineItem): boolean {
  const status = item.metadata?.agendaStatus;
  return status === 'COMPLETED' || status === 'MISSED' || item.metadata?.isCompleted === true;
}

function isActiveAt(item: HomeTimelineItem, nowMs: number): boolean {
  const t = instants(item);
  return t !== null && t.startMs <= nowMs && nowMs <= t.endMs;
}

function isImminentAt(item: HomeTimelineItem, nowMs: number): boolean {
  const t = instants(item);
  return t !== null && t.startMs > nowMs && t.startMs - nowMs <= STARTING_SOON_WINDOW_MS;
}

function byCommitmentOrder(a: HomeTimelineItem, b: HomeTimelineItem): number {
  const ta = instants(a)!;
  const tb = instants(b)!;
  if (ta.startMs !== tb.startMs) return ta.startMs - tb.startMs;
  if (ta.endMs !== tb.endMs) return ta.endMs - tb.endMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function selectRightNowState(homeTimeline: HomeTimelineItem[], now: Date): RightNowState {
  const nowMs = now.getTime();
  const eligiblePlans = homeTimeline.filter((item) => item.source === 'PLAN' && !isResolved(item));

  const active = eligiblePlans.filter((item) => isActiveAt(item, nowMs)).sort(byCommitmentOrder)[0];
  if (active) return { kind: 'ACTIVE_PLAN', item: active };

  const imminent = eligiblePlans.filter((item) => isImminentAt(item, nowMs)).sort(byCommitmentOrder)[0];
  if (imminent) return { kind: 'IMMINENT_PLAN', item: imminent };

  const opportunity = homeTimeline
    .filter((item) => item.kind === 'OPPORTUNITY' && isActiveAt(item, nowMs))
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))[0];
  if (opportunity) return { kind: 'OPPORTUNITY', item: opportunity };

  return { kind: 'CONTEXT_OPEN' };
}
