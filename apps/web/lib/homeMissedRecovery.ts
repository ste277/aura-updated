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
 * HPG4-2 -- every plan id a "Skip all missed" action on Home may target,
 * computed fresh from the given timeline/clock/confirmed-outcomes -- the
 * caller must pass a freshly-read `now` at the moment of the user's click,
 * never a value captured earlier and held across renders. No new
 * eligibility rule: this is exactly the same per-item check
 * missedRecoveryPlanId already performs (derived-MISSED, unresolved), just
 * collected and deduplicated in the timeline's own existing chronological
 * order. A plan already LOGGED, SKIPPED or MOVED, or one that is not yet
 * MISSED, is never included -- not by a second check here, but because
 * missedRecoveryPlanId itself already excludes it.
 */
export function missedSkipEligiblePlanIds(timeline: readonly HomeTimelineItem[], now: Date, confirmedOutcomes: { has(planId: string): boolean }): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of timeline) {
    const planId = missedRecoveryPlanId(item, now, confirmedOutcomes);
    if (planId !== null && !seen.has(planId)) {
      seen.add(planId);
      ids.push(planId);
    }
  }
  return ids;
}

/**
 * HPG4-2 CI/functional hardening (follow-up) -- the ONLY place "Skip all
 * missed"'s per-item COLLECTION loop is implemented, extracted out of both
 * Home's and the Plan tab's handleSkipAllMissed loop bodies so the exact
 * production sequencing (synchronous isBusy check -> else await the real
 * skip operation, in order, one item at a time) is itself directly callable
 * by a test with a mocked `skipOne`, instead of only being provable by
 * reading source text. `items` may be plan ids (Home) or plan rows (Plan
 * tab) -- this function only ever passes each item through to the two
 * callbacks the caller supplies, so it carries no knowledge of what an item
 * actually is, of React state, or of the real skip transport. `skipOne` is
 * responsible for any per-item busy-state bookkeeping and for performing the
 * real, existing single-item skip call; this function's only job is the
 * sequential iteration and outcome collection, unchanged from what each
 * handler's own loop already did.
 */
export async function collectSkipAllOutcomes<T>(
  items: readonly T[],
  isBusy: (item: T) => boolean,
  skipOne: (item: T) => Promise<string>,
): Promise<string[]> {
  const outcomes: string[] = [];
  for (const item of items) {
    if (isBusy(item)) {
      outcomes.push('BUSY');
      continue;
    }
    outcomes.push(await skipOne(item));
  }
  return outcomes;
}

/**
 * HPG4-2 CI/functional hardening -- the ONLY place "Skip all missed"'s
 * succeeded/failed tally is computed, extracted out of handleSkipAllMissed's
 * loop body so it has a single, directly-testable implementation instead of
 * inline `+= 1` arithmetic a test could only ever confirm by matching source
 * text. Each outcome is the per-item executor result ('SKIPPED' on success;
 * anything else -- 'FAILED', 'BUSY', or an already-busy item the loop never
 * even attempted -- counts as failed). Pure: no side effects, no knowledge
 * of the timeline/executor itself.
 */
export function summarizeSkipAllOutcome(outcomes: readonly string[]): { succeeded: number; failed: number } {
  let succeeded = 0;
  let failed = 0;
  for (const outcome of outcomes) {
    if (outcome === 'SKIPPED') succeeded += 1;
    else failed += 1;
  }
  return { succeeded, failed };
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
