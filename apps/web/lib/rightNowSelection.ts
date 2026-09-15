/**
 * AURA HOME IA V2 FOLLOW-UP FIXES -- Finding E (Right Now state contract).
 *
 * Pure presentation/selection boundary over the ALREADY-composed canonical
 * `HomeTimelineItem[]` (homeTimelineComposer.ts) -- this module reads that
 * output, it never re-derives, re-ranks, or re-joins anything the Composer
 * already owns (Plan+Guidance join, chronology, lifecycle override,
 * fail-closed source resolution, context semantics/ids, duration
 * personalization all stay exactly as the Composer produced them).
 *
 * PLANNED != RECOMMENDED OPTION (the ticket's own critical semantic rule):
 * an existing Plan answers "what have I committed to?"; an Opportunity
 * answers "what would be good to do?". Only the single rank-1 item is ever
 * considered here -- the same item the pre-existing spotlight already
 * looked at -- so this never widens which item can appear in Right Now,
 * it only reinterprets that ONE item's own already-available metadata
 * (source, agendaStatus, isCurrent) into the correct one of four states:
 *
 *   ACTIVE_PLAN   -- rank-1 is a Plan AND genuinely happening now
 *                    (metadata.agendaStatus === 'CURRENT', the exact
 *                    field dailyAgenda.ts's own timeBasedStatus() already
 *                    computes for this question -- not re-derived here).
 *   IMMINENT_PLAN -- rank-1 is a Plan AND about to start
 *                    (metadata.agendaStatus === 'STARTING_SOON', reusing
 *                    dailyAgenda.ts's own pre-existing 30-minute "about to
 *                    start" heuristic -- STARTING_SOON_WINDOW_MS -- rather
 *                    than inventing a new threshold, per the ticket's own
 *                    explicit instruction).
 *   OPPORTUNITY   -- rank-1 is an unscheduled Day Builder suggestion AND
 *                    its own window currently contains "now"
 *                    (metadata.isCurrent, the Composer's generic temporal
 *                    classifier -- Opportunities carry no agendaStatus at
 *                    all, since they were never a commitment).
 *   CONTEXT_OPEN  -- everything else: no rank-1 item at all, a rank-1 Plan
 *                    that is neither current nor imminent (a "future
 *                    non-imminent Plan must not win Best Option Right Now
 *                    merely because its rank/fit is high" -- the ticket's
 *                    own explicit rule), or a rank-1 Opportunity whose
 *                    window isn't current yet. A COMPLETED/MISSED Plan can
 *                    never reach ACTIVE_PLAN/IMMINENT_PLAN here: the
 *                    Composer's own lifecycle override already forces
 *                    `agendaStatus` to 'COMPLETED'/'MISSED' for those (see
 *                    homeTimelineComposer.ts's projectAgendaItem), neither
 *                    of which is 'CURRENT' or 'STARTING_SOON'.
 */
import type { HomeTimelineItem } from './homeTimelineTypes';

export type RightNowState =
  | { kind: 'ACTIVE_PLAN'; item: HomeTimelineItem }
  | { kind: 'IMMINENT_PLAN'; item: HomeTimelineItem }
  | { kind: 'OPPORTUNITY'; item: HomeTimelineItem }
  | { kind: 'CONTEXT_OPEN' };

export function selectRightNowState(homeTimeline: HomeTimelineItem[]): RightNowState {
  const rank1Item = homeTimeline.find((item) => item.rank === 1);
  if (!rank1Item) return { kind: 'CONTEXT_OPEN' };

  if (rank1Item.source === 'PLAN') {
    if (rank1Item.metadata?.agendaStatus === 'CURRENT') return { kind: 'ACTIVE_PLAN', item: rank1Item };
    if (rank1Item.metadata?.agendaStatus === 'STARTING_SOON') return { kind: 'IMMINENT_PLAN', item: rank1Item };
    return { kind: 'CONTEXT_OPEN' };
  }

  if (rank1Item.kind === 'OPPORTUNITY' && rank1Item.metadata?.isCurrent === true) {
    return { kind: 'OPPORTUNITY', item: rank1Item };
  }

  return { kind: 'CONTEXT_OPEN' };
}
