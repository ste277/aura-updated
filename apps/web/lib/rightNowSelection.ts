/**
 * Right Now selection -- COMMITTED DAY FIRST, guidance second.
 *
 * Pure selection boundary over the ALREADY-composed canonical
 * `HomeTimelineItem[]` (homeTimelineComposer.ts). It never re-derives,
 * re-ranks or re-joins anything the Composer owns.
 *
 * PLANNED != RECOMMENDED OPTION. An existing PlannedActivity answers "what
 * have I committed to?"; an Opportunity answers "what would be good to do?".
 * Guidance `rank` therefore has NO authority over committed plans: a plan
 * happening now is Right Now whether or not the guidance engine annotated
 * it, and however it was created (Goal, Capture, Opportunity, Day Builder,
 * typed Plan My Day, ...). `rank` is used ONLY to order competing
 * Opportunities.
 *
 * Contract, in strict order:
 *   1. ACTIVE_PLAN    a PLAN item happening now.
 *   2. IMMINENT_PLAN  else, the next PLAN item starting within the existing
 *                     STARTING_SOON window (30 minutes, dailyAgenda.ts).
 *   3. OPPORTUNITY    else, a current Opportunity (lowest guidance rank).
 *   4. CONTEXT_OPEN   else.
 *
 * TIME SOURCES. "Now" comes from the Composer's own ticking
 * `currentMinuteOfDay` (`metadata.isCurrent` / `isPast` / `startsInMinutes`),
 * not from `agendaStatus`, which is fixed at agenda-fetch time and can go
 * stale while the Home tab stays open. `agendaStatus` is consumed only for
 * lifecycle facts: COMPLETED (logged) and MISSED (elapsed, unlogged) plans
 * are never eligible. If a hand-built item carries no temporal metadata,
 * `agendaStatus` CURRENT / STARTING_SOON is used as the fallback.
 *
 * OVERLAP. If several plans are active (or imminent) at once, the winner is
 * the earliest start, then the earliest end, then the lowest id -- an explicit
 * total order, so the result never depends on input/database row order (the
 * Composer's own same-start tie-break is only stable/first-seen). No scoring
 * is invented here.
 *
 * Threshold boundary: a plan starting in exactly 30 minutes IS imminent
 * (inclusive, matching dailyAgenda.ts's `<=`); 31 is not. A plan whose end
 * minute equals now is still active (the Composer's inclusive bounds); the
 * agenda marks it MISSED only once now is strictly past its end.
 *
 * Only PLAN-sourced items are commitments here. Shared Moments are not
 * considered by this selector.
 */
import type { HomeTimelineItem } from './homeTimelineTypes';
import { STARTING_SOON_WINDOW_MS } from './dailyAgenda';

export type RightNowState =
  | { kind: 'ACTIVE_PLAN'; item: HomeTimelineItem }
  | { kind: 'IMMINENT_PLAN'; item: HomeTimelineItem }
  | { kind: 'OPPORTUNITY'; item: HomeTimelineItem }
  | { kind: 'CONTEXT_OPEN' };

const IMMINENT_WINDOW_MINUTES = STARTING_SOON_WINDOW_MS / 60000;

function isResolved(item: HomeTimelineItem): boolean {
  const status = item.metadata?.agendaStatus;
  return status === 'COMPLETED' || status === 'MISSED' || item.metadata?.isCompleted === true;
}

function isActive(item: HomeTimelineItem): boolean {
  const md = item.metadata;
  return md?.isCurrent !== undefined ? md.isCurrent === true : md?.agendaStatus === 'CURRENT';
}

function byCommitmentOrder(a: HomeTimelineItem, b: HomeTimelineItem): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const aEnd = a.end ?? a.start;
  const bEnd = b.end ?? b.start;
  if (aEnd !== bEnd) return aEnd < bEnd ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function isImminent(item: HomeTimelineItem): boolean {
  const md = item.metadata;
  if (md?.isPast === true) return false;
  if (md?.startsInMinutes !== undefined) return md.startsInMinutes >= 0 && md.startsInMinutes <= IMMINENT_WINDOW_MINUTES;
  return md?.agendaStatus === 'STARTING_SOON';
}

export function selectRightNowState(homeTimeline: HomeTimelineItem[]): RightNowState {
  const eligiblePlans = homeTimeline.filter((item) => item.source === 'PLAN' && !isResolved(item));

  const active = eligiblePlans.filter(isActive).sort(byCommitmentOrder)[0];
  if (active) return { kind: 'ACTIVE_PLAN', item: active };

  const imminent = eligiblePlans.filter(isImminent).sort(byCommitmentOrder)[0];
  if (imminent) return { kind: 'IMMINENT_PLAN', item: imminent };

  const opportunity = homeTimeline
    .filter((item) => item.kind === 'OPPORTUNITY' && item.metadata?.isCurrent === true)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))[0];
  if (opportunity) return { kind: 'OPPORTUNITY', item: opportunity };

  return { kind: 'CONTEXT_OPEN' };
}
