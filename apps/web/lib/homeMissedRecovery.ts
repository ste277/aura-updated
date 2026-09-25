/**
 * Daily Experience V1 PR E -- Missed Recovery on Home.
 *
 * MISSED is a DERIVED presentation state, never persisted: a committed plan
 * whose persisted status is still UPCOMING and whose scheduled end has elapsed
 * (dailyAgenda.ts `timeBasedStatus`, `end < now`). This module adds no second
 * definition of it -- it calls that same function -- and no lifecycle logic:
 * recovery is offered as the EXISTING Done / Skip / Move actions (log, skip and
 * move routes; the shared per-plan execution guard) and nothing here writes
 * state. Pure so it is testable without a component harness.
 */
import type { HomeTimelineItem } from './homeTimelineTypes';
import { planIdFromTimelineItem } from './homeCompletion';
import { timeBasedStatus } from './dailyAgenda';

/** The three recovery actions, in display order. Deliberately no Cancel: the occurrence already passed. */
export const MISSED_RECOVERY_ACTIONS = ['DONE', 'SKIP', 'MOVE'] as const;
export type MissedRecoveryAction = (typeof MISSED_RECOVERY_ACTIONS)[number];

/** Agenda statuses of a still-unresolved plan (persisted UPCOMING) whose derived status depends on the clock. */
const CLOCK_DERIVED = new Set(['UPCOMING', 'STARTING_SOON', 'CURRENT']);

/**
 * Is this timeline item an unresolved committed plan whose scheduled end has
 * elapsed at `now`? Uses the agenda's own contract exactly (`end < now`, so a
 * plan is NOT missed at now === end) on absolute instants -- never minute-of-day.
 * Terminal agenda statuses (COMPLETED / SKIPPED / MOVED) are never missed.
 */
export function isMissedPlanItem(item: HomeTimelineItem, now: Date): boolean {
  if (planIdFromTimelineItem(item) === null) return false;
  const status = item.metadata?.agendaStatus;
  if (status === 'MISSED') return true;
  if (!status || !CLOCK_DERIVED.has(status) || !item.end) return false;
  return timeBasedStatus(new Date(item.start), new Date(item.end), now) === 'MISSED';
}

/**
 * The plan id a recovery surface may act on, or null. Eligible only while the item is
 * derived-MISSED AND the client holds no server-confirmed outcome for it (a confirmed
 * fact always wins over a stale agenda that still says MISSED).
 */
export function missedRecoveryPlanId(item: HomeTimelineItem, now: Date, confirmedOutcomes: { has(planId: string): boolean }): string | null {
  const planId = planIdFromTimelineItem(item);
  if (planId === null || confirmedOutcomes.has(planId)) return null;
  return isMissedPlanItem(item, now) ? planId : null;
}

/**
 * Brings the composed timeline's presentation in line with the live clock: a plan whose end
 * elapsed while Home stayed mounted (the agenda was built earlier) reads as MISSED, exactly as a
 * fresh agenda would say. Only re-labels; never changes ordering and never persists anything.
 */
export function overlayElapsedMissed(timeline: HomeTimelineItem[], now: Date): HomeTimelineItem[] {
  let changed = false;
  const next = timeline.map((item) => {
    if (item.metadata?.agendaStatus === 'MISSED' || !isMissedPlanItem(item, now)) return item;
    changed = true;
    return { ...item, metadata: { ...item.metadata, agendaStatus: 'MISSED' as const, isCurrent: false, isPast: true } };
  });
  return changed ? next : timeline;
}
