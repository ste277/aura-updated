import type { AuraReminder, AuraReminderScheduledItemType } from './auraReminders';
import type { ReminderAttention } from './db';

/**
 * Notification Delivery Readiness V1 -- splits reminder RELEVANCE (is the
 * event approaching? computed live by deriveAuraReminders(), completely
 * unchanged) from reminder SEEN state (has the owner acknowledged THIS
 * specific occurrence in Aura?). These were previously conflated: every
 * active reminder counted toward the Bell badge for its entire relevance
 * window, so opening a reminder never reduced the badge until the event
 * itself passed.
 *
 * A reminder OCCURRENCE is identified by (scheduledItemType,
 * scheduledItemId, reminderAt) -- deliberately not a bare
 * `reminderSeen: true` flag on the source row, because a Plan/Moment can
 * move to a new time. When that happens, reminderAt changes, so the OLD
 * occurrence's seen row simply stops matching anything (it's still there,
 * a harmless historical record) and the NEW occurrence has no seen row of
 * its own yet -- unread again, with no extra write or migration needed.
 */

export function reminderOccurrenceKey(
  scheduledItemType: AuraReminderScheduledItemType,
  scheduledItemId: string,
  reminderAtIso: string
): string {
  return `${scheduledItemType}:${scheduledItemId}:${reminderAtIso}`;
}

export type ReminderWithAttention = AuraReminder & {
  /** Derived by comparing this occurrence's key against the owner's
   * ReminderAttention rows -- never a stored boolean on the reminder
   * itself (there is nothing to store one on; AuraReminder is derived,
   * not persisted). */
  unread: boolean;
};

/**
 * Pure function: given the reminders deriveAuraReminders() produced for
 * this request and the owner's ReminderAttention rows (any bounded query
 * shape works -- only scheduledItemType/scheduledItemId/reminderAt are
 * read), attaches `unread` to each. Never mutates seen state itself --
 * that only happens via markReminderSeen() (lib/db.ts), called from POST
 * /api/reminders/seen.
 */
export function attachReminderSeenState(
  reminders: AuraReminder[],
  seenOccurrences: Pick<ReminderAttention, 'scheduledItemType' | 'scheduledItemId' | 'reminderAt'>[]
): ReminderWithAttention[] {
  const seenKeys = new Set(
    seenOccurrences.map((row) => reminderOccurrenceKey(row.scheduledItemType, row.scheduledItemId, row.reminderAt.toISOString()))
  );
  return reminders.map((reminder) => ({
    ...reminder,
    unread: !seenKeys.has(reminderOccurrenceKey(reminder.scheduledItemType, reminder.scheduledItemId, reminder.reminderAt)),
  }));
}
