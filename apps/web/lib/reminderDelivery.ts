import {
  claimReminderDeliveryForSending,
  disablePushSubscriptionByEndpoint,
  ensureReminderDelivery,
  hasActivePushSubscription,
  getUserById,
  listActivePushSubscriptionsForOwner,
  listAuraMomentsForReminders,
  listMomentIdsWithSuccessorForOwner,
  listPlannedActivitiesForReminders,
  listUserIdsWithPotentialReminders,
  markPushSubscriptionSuccessful,
  markReminderDeliveryStatus,
  recordReminderDispatchHeartbeat,
  releaseReminderDeliveryForRetry,
  ReminderDelivery,
  ReminderDeliveryChannel,
} from './db';
import { deriveAuraReminders, MAX_REMINDER_LEAD_MINUTES, REMINDER_GRACE_PERIOD_MINUTES } from './auraReminders';
import { buildMomentPushPayload, buildPlanPushPayload } from './pushPayload';
import { isWebPushConfigured, sendWebPushNotification, WebPushSendResult } from './webPushServer';
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

/** AURA-REM-01 -- at most this many send attempts per reminder occurrence
 * (first try plus two retries on later scheduler runs). */
export const MAX_REMINDER_DELIVERY_ATTEMPTS = 3;

/** AURA-REM-01 -- a delivery left in PROCESSING longer than this (a worker
 * that crashed or timed out mid-send) may be reclaimed by a later run. Well
 * above a dispatch run's expected duration, so a slow-but-alive worker is
 * not raced; the service worker's per-item notification tag also collapses
 * any duplicate on the device. */
export const STALE_PROCESSING_MINUTES = 5;

/** AURA-REM-01 -- a device notification that says "starts in 15 min" is only
 * useful BEFORE the activity starts. The in-app reminder stays visible for a
 * grace period after start (REMINDER_GRACE_PERIOD_MINUTES, unchanged), but a
 * push that a late scheduler run would deliver after the start time is
 * skipped instead of sent. */
export function isTooLateForPush(startAtIso: string, now: Date): boolean {
  return now.getTime() >= new Date(startAtIso).getTime();
}

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

/** AURA-REM-01 -- the physical send step, injectable so retry, gone-endpoint
 * and concurrency behaviour can be tested against a real database without a
 * real push provider. Production always uses sendWebPushNotification. */
export interface ReminderDeliveryDeps {
  send: (subscription: { endpoint: string; p256dh: string; auth: string }, payload: unknown) => Promise<WebPushSendResult>;
}

const DEFAULT_DEPS: ReminderDeliveryDeps = { send: sendWebPushNotification };

export type SendReminderDeliveryOutcome = 'SENT' | 'FAILED' | 'SKIPPED' | 'ALREADY_CLAIMED' | 'RETRY_SCHEDULED';

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
export async function sendReminderDelivery(
  delivery: ReminderDelivery,
  now: Date = new Date(),
  deps: ReminderDeliveryDeps = DEFAULT_DEPS
): Promise<SendReminderDeliveryOutcome> {
  const claimed = await claimReminderDeliveryForSending(delivery.id, {
    maxAttempts: MAX_REMINDER_DELIVERY_ATTEMPTS,
    staleProcessingMinutes: STALE_PROCESSING_MINUTES,
  });
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

  if (isTooLateForPush(match.startAt, now)) {
    await markReminderDeliveryStatus(claimed.id, 'SKIPPED', 'too_late_activity_started');
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
  let transientFailureCount = 0;
  let lastErrorCode = 'send_error';
  for (const subscription of subscriptions) {
    const result = await deps.send(
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
    } else {
      lastErrorCode = result.errorCode ?? 'send_error';
      // Missing VAPID keys won't fix themselves between runs -- not retried.
      if (lastErrorCode !== 'not_configured') transientFailureCount += 1;
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

  const failureReason = `0/${subscriptions.length} subscriptions succeeded (${lastErrorCode})`;
  // AURA-REM-01: a temporary failure (network error, provider 5xx/429) is
  // retried on a later scheduler run while attempts remain and the activity
  // hasn't started. Gone endpoints (404/410) were already disabled above and
  // are never retried; if every subscription was gone, the row is FAILED.
  if (transientFailureCount > 0 && claimed.attemptCount < MAX_REMINDER_DELIVERY_ATTEMPTS) {
    await releaseReminderDeliveryForRetry(claimed.id, failureReason);
    return 'RETRY_SCHEDULED';
  }
  await markReminderDeliveryStatus(claimed.id, 'FAILED', failureReason);
  return 'FAILED';
}

export interface DispatchDueReminderPushesResult {
  /** AURA-REM-01: false when the VAPID keys are missing -- nothing is
   * claimed or attempted, so no delivery row is burned on a misconfigured
   * deployment. */
  configured: boolean;
  usersInspected: number;
  /** Users skipped before any delivery row was created because they have no
   * active device subscription (in-app reminders are unaffected). */
  usersWithoutSubscription: number;
  deliveriesPending: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadyClaimed: number;
  retryScheduled: number;
}

/**
 * Web Push V1 (brief section 19/21) -- the scheduler's actual entry point.
 * Bounded due-user discovery (never loads every User row), then
 * ensureDueReminderDeliveries() per discovered user (idempotent claim
 * creation), then sendReminderDelivery() for every currently-PENDING row.
 * Reports the counts brief section 48 asks for.
 */
export async function dispatchDueReminderPushes(
  now: Date = new Date(),
  deps: ReminderDeliveryDeps = DEFAULT_DEPS
): Promise<DispatchDueReminderPushesResult> {
  const from = new Date(now.getTime() - REMINDER_GRACE_PERIOD_MINUTES * 60_000);
  const to = new Date(now.getTime() + MAX_REMINDER_LEAD_MINUTES * 60_000);
  const result: DispatchDueReminderPushesResult = {
    configured: isWebPushConfigured(),
    usersInspected: 0,
    usersWithoutSubscription: 0,
    deliveriesPending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    alreadyClaimed: 0,
    retryScheduled: 0,
  };
  // Heartbeat first, on every authorized run: this is how the app knows the
  // scheduler is really running (see lib/reminderDeliveryStatus.ts).
  await recordReminderDispatchHeartbeat(WEB_PUSH, result.configured);
  if (!result.configured) return result;

  const userIds = await listUserIdsWithPotentialReminders(from, to);
  result.usersInspected = userIds.length;

  for (const userId of userIds) {
    // AURA-REM-01: no device subscription -> no delivery row at all. Before,
    // a SKIPPED row was written, which also meant a user who turned on
    // notifications a few minutes later never got that reminder.
    if (!(await hasActivePushSubscription(userId))) {
      result.usersWithoutSubscription += 1;
      continue;
    }
    const deliveries = await ensureDueReminderDeliveries(userId, now);
    for (const delivery of deliveries) {
      // PENDING (new or released for retry) and PROCESSING (possibly stale;
      // the claim itself decides) are both offered to the sender.
      if (delivery.status !== 'PENDING' && delivery.status !== 'PROCESSING') continue;
      result.deliveriesPending += 1;
      const outcome = await sendReminderDelivery(delivery, now, deps);
      if (outcome === 'SENT') result.sent += 1;
      else if (outcome === 'FAILED') result.failed += 1;
      else if (outcome === 'SKIPPED') result.skipped += 1;
      else if (outcome === 'RETRY_SCHEDULED') result.retryScheduled += 1;
      else result.alreadyClaimed += 1;
    }
  }

  return result;
}
