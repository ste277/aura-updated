import {
  ensureReminderDelivery,
  getUserById,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listPlannedActivitiesForReminders,
  ReminderDelivery,
  ReminderDeliveryChannel,
} from './db';
import { deriveAuraReminders, MAX_REMINDER_LEAD_MINUTES, REMINDER_GRACE_PERIOD_MINUTES } from './auraReminders';

/**
 * Notification Delivery Readiness V1 -- the future Web Push worker's entry
 * point (brief section 13/14), NOT called from any live request path in
 * this PR. The eventual flow this makes possible, without rewriting
 * anything in the reminder domain:
 *
 *   scheduler (future, out of scope here)
 *     -> for each user, ensureDueReminderDeliveries(userId, now)
 *     -> for each newly-PENDING ReminderDelivery, send Web Push
 *     -> markReminderDeliveryStatus(delivery.id, 'SENT' | 'FAILED', ...)
 *
 * Deliberately reuses deriveAuraReminders() for eligibility -- revoked
 * rules, successor rules, ANOTHER_TIME rules, lead-time math, and the
 * Plan/Moment dedup rule are NOT reimplemented here. A reminder this
 * function claims a delivery for is exactly one deriveAuraReminders()
 * already decided is currently active for this owner; nothing here can
 * disagree with what Bell/Home/Updates show.
 */

const WEB_PUSH: ReminderDeliveryChannel = 'WEB_PUSH';

/**
 * For one owner: find every currently-active reminder occurrence and
 * idempotently claim a PENDING ReminderDelivery row for it (channel
 * WEB_PUSH). Safe to call repeatedly -- ensureReminderDelivery()'s
 * underlying DB unique constraint guarantees the SAME occurrence never
 * produces two delivery rows, even if this function is called concurrently
 * for the same user (brief section 15).
 *
 * Returns the delivery rows (created-or-already-existing) for every
 * currently-active reminder -- a future worker would filter this to
 * status === 'PENDING' before actually sending.
 */
export async function ensureDueReminderDeliveries(userId: string, now: Date): Promise<ReminderDelivery[]> {
  const user = await getUserById(userId);
  if (!user || !user.remindersEnabled) return [];

  const from = new Date(now.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const to = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);

  const [plans, moments, momentIdsWithSuccessor] = await Promise.all([
    listPlannedActivitiesForReminders(userId, from, to),
    listAuraMomentsForReminders(userId, from, to),
    listMomentIdsWithSuccessorForOwner(userId),
  ]);

  const reminders = deriveAuraReminders({
    now,
    leadMinutes: user.reminderLeadMinutes,
    ownerTimezone: user.timezone,
    plans,
    moments,
    momentIdsWithSuccessor,
  });

  const deliveries: ReminderDelivery[] = [];
  for (const reminder of reminders) {
    deliveries.push(
      await ensureReminderDelivery(userId, reminder.scheduledItemType, reminder.scheduledItemId, new Date(reminder.reminderAt), WEB_PUSH)
    );
  }
  return deliveries;
}
