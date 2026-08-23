import {
  claimReminderDeliveryForSending,
  disablePushSubscriptionByEndpoint,
  ensureReminderDelivery,
  getUserById,
  listActivePushSubscriptionsForOwner,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listPlannedActivitiesForReminders,
  listUserIdsWithPotentialReminders,
  markPushSubscriptionSuccessful,
  markReminderDeliveryStatus,
  ReminderDelivery,
  ReminderDeliveryChannel,
} from './db';
import { deriveAuraReminders, MAX_REMINDER_LEAD_MINUTES, REMINDER_GRACE_PERIOD_MINUTES } from './auraReminders';
import { buildMomentPushPayload, buildPlanPushPayload } from './pushPayload';
import { sendWebPushNotification } from './webPushServer';
import { recordProductEvent } from './productEvents';

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

export type SendReminderDeliveryOutcome = 'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY_CLAIMED';

/**
 * Web Push V1 (brief section 16) -- attempts to actually send ONE
 * ReminderDelivery. Never recalculates reminder eligibility from scratch;
 * it re-derives it via the SAME deriveAuraReminders() call every other
 * surface uses, immediately before sending (brief section 24/25: "Before
 * sending PENDING delivery, verify occurrence still matches current
 * eligible reminder").
 *
 * Concurrency (brief section 22): the very first step is
 * claimReminderDeliveryForSending(), an atomic PENDING -> PROCESSING
 * transition. If that returns null, someone else already claimed (or sent,
 * or skipped) this row -- return immediately, never send.
 */
export async function sendReminderDelivery(delivery: ReminderDelivery, now: Date = new Date()): Promise<SendReminderDeliveryOutcome> {
  const claimed = await claimReminderDeliveryForSending(delivery.id);
  if (!claimed) return 'ALREADY_CLAIMED';

  const user = await getUserById(claimed.userId);
  if (!user || !user.remindersEnabled) {
    // Brief section 26: "For push: do not send due deliveries" when
    // reminders are disabled -- re-checked here (not just at creation
    // time) because the user may have disabled reminders AFTER this
    // PENDING row was created.
    await markReminderDeliveryStatus(claimed.id, 'SKIPPED', 'reminders_disabled');
    return 'SKIPPED';
  }

  const from = new Date(now.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const to = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);
  const [plans, moments, momentIdsWithSuccessor] = await Promise.all([
    listPlannedActivitiesForReminders(claimed.userId, from, to),
    listAuraMomentsForReminders(claimed.userId, from, to),
    listMomentIdsWithSuccessorForOwner(claimed.userId),
  ]);
  const currentReminders = deriveAuraReminders({
    now,
    leadMinutes: user.reminderLeadMinutes,
    ownerTimezone: user.timezone,
    plans,
    moments,
    momentIdsWithSuccessor,
  });
  const claimedReminderAtIso = claimed.reminderAt.toISOString();
  const match = currentReminders.find(
    (r) => r.scheduledItemType === claimed.scheduledItemType && r.scheduledItemId === claimed.scheduledItemId && r.reminderAt === claimedReminderAtIso
  );
  if (!match) {
    // Rescheduled, revoked, cancelled, or superseded since this delivery
    // was created (brief section 24/25) -- this exact occurrence is gone,
    // and it is never re-sent as itself; a genuinely rescheduled item gets
    // an entirely new occurrence (new reminderAt) the next
    // ensureDueReminderDeliveries() call creates independently.
    await markReminderDeliveryStatus(claimed.id, 'SKIPPED', 'occurrence_no_longer_eligible');
    return 'SKIPPED';
  }

  const subscriptions = await listActivePushSubscriptionsForOwner(claimed.userId);
  if (subscriptions.length === 0) {
    await markReminderDeliveryStatus(claimed.id, 'SKIPPED', 'no_active_push_subscription');
    return 'SKIPPED';
  }

  const payload = match.scheduledItemType === 'AURA_MOMENT'
    ? (() => {
        const moment = moments.find((m) => m.id === match.scheduledItemId);
        return moment ? buildMomentPushPayload(match, moment) : null;
      })()
    : buildPlanPushPayload(match);

  if (!payload) {
    // Defensive only -- match.scheduledItemId came from the SAME `moments`
    // array this searches, so this should be unreachable in practice.
    await markReminderDeliveryStatus(claimed.id, 'SKIPPED', 'scheduled_item_not_found');
    return 'SKIPPED';
  }

  // Multi-device (brief section 17): one logical ReminderDelivery, sent to
  // every active subscription. SENT if at least one succeeds; FAILED only
  // if ALL fail -- a minimal aggregated-status model (not per-subscription
  // child rows) chosen because V1 has no UI that needs per-device delivery
  // detail, only "did the owner get notified at all".
  let successCount = 0;
  for (const subscription of subscriptions) {
    const result = await sendWebPushNotification(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      payload
    );
    if (result.ok) {
      successCount += 1;
      await markPushSubscriptionSuccessful(subscription.endpoint);
    } else if (result.isGone) {
      // Brief section 18: provider says the endpoint is gone -- disable it,
      // never retry it. Transient failures (anything else) are recorded via
      // the delivery's own failureReason below, not retried in V1.
      await disablePushSubscriptionByEndpoint(subscription.endpoint, result.errorCode ?? 'gone');
    }
  }

  if (successCount > 0) {
    await markReminderDeliveryStatus(claimed.id, 'SENT');
    // Server-authoritative (brief section 30/31) -- fired once per
    // successfully-sent delivery, at the moment of send success.
    void recordProductEvent({
      eventName: 'REMINDER_PUSH_SENT',
      userId: claimed.userId,
      metadata: { scheduledItemType: claimed.scheduledItemType, leadTimeMinutes: user.reminderLeadMinutes },
    });
    return 'SENT';
  }

  await markReminderDeliveryStatus(claimed.id, 'FAILED', `0/${subscriptions.length} subscriptions succeeded`);
  return 'FAILED';
}

export interface DispatchDueReminderPushesResult {
  usersInspected: number;
  deliveriesPending: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadyClaimed: number;
}

/**
 * Web Push V1 (brief section 19/21) -- the scheduler's actual entry point.
 * Bounded due-user discovery (never loads every User row), then
 * ensureDueReminderDeliveries() per discovered user (idempotent claim
 * creation), then sendReminderDelivery() for every currently-PENDING row.
 * Reports the counts brief section 48 asks for.
 */
export async function dispatchDueReminderPushes(now: Date = new Date()): Promise<DispatchDueReminderPushesResult> {
  const from = new Date(now.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const to = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);
  const userIds = await listUserIdsWithPotentialReminders(from, to);

  const result: DispatchDueReminderPushesResult = {
    usersInspected: userIds.length,
    deliveriesPending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadyClaimed: 0,
  };

  for (const userId of userIds) {
    const deliveries = await ensureDueReminderDeliveries(userId, now);
    for (const delivery of deliveries) {
      if (delivery.status !== 'PENDING') continue;
      result.deliveriesPending += 1;
      const outcome = await sendReminderDelivery(delivery, now);
      if (outcome === 'SENT') result.sent += 1;
      else if (outcome === 'FAILED') result.failed += 1;
      else if (outcome === 'SKIPPED') result.skipped += 1;
      else result.alreadyClaimed += 1;
    }
  }

  return result;
}
