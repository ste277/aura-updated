/**
 * Daily Experience V1 PR B (reminder consistency) -- once the server has
 * CONFIRMED a plan LOGGED from Home, the "starting soon" reminder must stop
 * presenting it as pending ("Starts in 10 min" / "Started 20 min ago").
 *
 * Filter FIRST, then select: an authoritative `auraUpdates.upcoming` is never
 * mutated; reminders whose durable plan id (`target.planId`) is in the
 * confirmed-completion set are skipped, and the first remaining reminder wins.
 * Identity is the plan id only -- never title, time or array position. Because
 * the filter is applied to whatever list is currently held, a refresh that
 * returns stale data still containing a confirmed plan cannot bring it back.
 */
import type { AuraReminder } from './auraReminders';

export function selectVisibleStartingSoonReminder<T extends AuraReminder>(
  upcoming: readonly T[] | null | undefined,
  confirmedCompletedPlanIds: ReadonlySet<string>
): T | null {
  if (!upcoming) return null;
  for (const reminder of upcoming) {
    if (reminder.target.type === 'PLAN' && confirmedCompletedPlanIds.has(reminder.target.planId)) continue;
    return reminder;
  }
  return null;
}
