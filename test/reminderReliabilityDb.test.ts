/**
 * AURA-REM-01 -- live-database reliability test for the background reminder
 * dispatcher (lib/reminderDelivery.ts dispatchDueReminderPushes). Requires a
 * real, migrated DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/reminderReliabilityDb.test.ts
 *
 * The physical push send is injected (ReminderDeliveryDeps), so every
 * scenario runs against the real tables, claims and eligibility rules
 * without contacting a push provider. Times are relative to the real clock
 * because movePlannedActivity validates against the database clock.
 *
 * Each run uses fresh users and endpoints. The dispatcher scans every user
 * with a due reminder, so send calls are counted per endpoint, never in
 * total.
 */
import { randomUUID } from 'crypto';

// Dummy VAPID values: the dispatcher only checks they are present; the
// injected sender never uses them.
process.env.WEB_PUSH_VAPID_PUBLIC_KEY = 'test-public-key';
process.env.WEB_PUSH_VAPID_PRIVATE_KEY = 'test-private-key';
process.env.WEB_PUSH_VAPID_SUBJECT = 'mailto:reminders-test@example.invalid';

import {
  beginTransaction,
  cancelPlannedActivity,
  claimReminderDeliveryForSending,
  createPlannedActivity,
  ensureReminderDelivery,
  getReminderDispatchHeartbeat,
  logPlannedActivity,
  upsertPushSubscription,
  upsertUserByEmail,
  updateUserReminderPrefs,
} from '../apps/web/lib/db';
import {
  dispatchDueReminderPushes,
  ensureDueReminderDeliveries,
  MAX_REMINDER_DELIVERY_ATTEMPTS,
  ReminderDeliveryDeps,
} from '../apps/web/lib/reminderDelivery';
import { movePlannedActivity } from '../apps/web/lib/planMove';
import { classifyBackgroundDelivery } from '../apps/web/lib/reminderDeliveryStatus';
import type { WebPushSendResult } from '../apps/web/lib/webPushServer';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const MIN = 60_000;
const RUN = randomUUID().slice(0, 8);
const N = new Date(Math.floor(Date.now() / MIN) * MIN);
const at = (minutes: number) => new Date(N.getTime() + minutes * MIN);

type Call = { endpoint: string; title: string };
const calls: Call[] = [];
let respond: (endpoint: string) => WebPushSendResult = () => ({ ok: true, isGone: false });
const deps: ReminderDeliveryDeps = {
  send: async (subscription, payload) => {
    calls.push({ endpoint: subscription.endpoint, title: String((payload as { title?: string }).title ?? '') });
    return respond(subscription.endpoint);
  },
};
const sentTo = (endpoint: string) => calls.filter((c) => c.endpoint === endpoint);

async function sql(text: string, params: unknown[] = []) {
  const client = await beginTransaction();
  try {
    const result = await client.query(text, params);
    await client.query('COMMIT');
    return result.rows;
  } finally {
    client.release();
  }
}

async function deliveryRows(userId: string, planId: string) {
  return sql(`SELECT * FROM "ReminderDelivery" WHERE "userId" = $1 AND "scheduledItemId" = $2 ORDER BY "reminderAt"`, [userId, planId]);
}

async function makeUser(label: string, opts: { subscribe?: boolean; timezone?: string } = {}) {
  const user = await upsertUserByEmail({
    email: `rem01-${label}-${RUN}@e2e.aura.local`,
    cityName: 'Chennai',
    latitude: 13.0827,
    longitude: 80.2707,
    timezone: opts.timezone ?? 'Asia/Kolkata',
  });
  await updateUserReminderPrefs(user.id, { remindersEnabled: true, reminderLeadMinutes: 15 });
  const endpoint = `https://push.example.invalid/${label}-${RUN}`;
  if (opts.subscribe !== false) {
    await upsertPushSubscription({ userId: user.id, endpoint, p256dh: 'test-p256dh', auth: 'test-auth' });
  }
  return { user, endpoint };
}

async function makePlan(userId: string, startInMinutes: number, title = 'Deep Work') {
  return createPlannedActivity({
    userId,
    title,
    activityType: 'Deep Work',
    icon: '🧠',
    plannedStartAt: at(startInMinutes),
    plannedEndAt: at(startInMinutes + 30),
    durationMinutes: 30,
    windowType: 'NEUTRAL',
  });
}

async function main() {
  // ---------------------------------------------------------------
  // 1. Normal delivery, at the reminder time, exactly once.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('normal');
    const plan = await makePlan(user.id, 40); // reminder at +25
    await dispatchDueReminderPushes(at(20), deps);
    check('1a. No push before the reminder time (start +40, lead 15, now +20)', sentTo(endpoint).length === 0);
    await dispatchDueReminderPushes(at(25), deps);
    check('1b. Push sent once the reminder time is reached', sentTo(endpoint).length === 1);
    check('1c. Title states the real time left ("starts in 15 min")', sentTo(endpoint)[0]?.title.endsWith('starts in 15 min') === true);
    await dispatchDueReminderPushes(at(27), deps);
    await dispatchDueReminderPushes(at(30), deps);
    check('1d. Later scheduler runs never resend the same reminder', sentTo(endpoint).length === 1);
    const rows = await deliveryRows(user.id, plan.id);
    check('1e. One delivery row, SENT, one attempt', rows.length === 1 && rows[0].status === 'SENT' && rows[0].attemptCount === 1);
  }

  // ---------------------------------------------------------------
  // 2. A late scheduler run reports the actual minutes left.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('late');
    await makePlan(user.id, 40);
    await dispatchDueReminderPushes(at(34), deps); // 9 min late
    check('2. A run 9 minutes late says "starts in 6 min", not "15 min"', sentTo(endpoint)[0]?.title.endsWith('starts in 6 min') === true);
  }

  // ---------------------------------------------------------------
  // 3. Never pushed once the activity has started.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('toolate');
    const plan = await makePlan(user.id, 40);
    await dispatchDueReminderPushes(at(45), deps); // 5 min after start, inside the in-app grace period
    check('3a. No push after the activity started', sentTo(endpoint).length === 0);
    const rows = await deliveryRows(user.id, plan.id);
    check('3b. Delivery recorded as SKIPPED too_late_activity_started', rows[0]?.status === 'SKIPPED' && rows[0]?.failureReason === 'too_late_activity_started');
  }

  // ---------------------------------------------------------------
  // 4. Duplicate and concurrent scheduler runs.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('concurrent');
    const plan = await makePlan(user.id, 40);
    await Promise.all(Array.from({ length: 6 }, () => dispatchDueReminderPushes(at(26), deps)));
    check('4a. Six simultaneous scheduler runs send exactly one push', sentTo(endpoint).length === 1);
    const rows = await deliveryRows(user.id, plan.id);
    check('4b. Still exactly one delivery row, SENT', rows.length === 1 && rows[0].status === 'SENT');
  }

  // ---------------------------------------------------------------
  // 5. Rescheduled activity: reminder follows the new time only.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('moved');
    const plan = await makePlan(user.id, 40);
    // A pending row for the original time already exists (e.g. created by a
    // run that then timed out), then the user moves the plan.
    await ensureDueReminderDeliveries(user.id, at(26));
    const moved = await movePlannedActivity(user.id, plan.id, { newStartAt: at(180) });
    await dispatchDueReminderPushes(at(26), deps);
    check('5a. No push for the original time after the plan was moved', sentTo(endpoint).length === 0);
    const oldRows = await deliveryRows(user.id, plan.id);
    // The moved-away plan is no longer UPCOMING, so the dispatcher never
    // offers its old row again: it stays unsent (PENDING, inert) rather than
    // being rewritten. What matters is that it is never SENT.
    check('5b. The original occurrence is never sent (row left unsent)', oldRows.length === 1 && oldRows[0].status !== 'SENT' && oldRows[0].sentAt == null);
    await dispatchDueReminderPushes(at(166), deps);
    check('5c. Push sent at the new reminder time (new start -15 min)', sentTo(endpoint).length === 1);
    const newRows = await deliveryRows(user.id, moved.to.id);
    check('5d. The new time has its own SENT delivery', newRows.length === 1 && newRows[0].status === 'SENT');
  }

  // ---------------------------------------------------------------
  // 6. In-place time edit (any path that changes plannedStartAt).
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('edited');
    const plan = await makePlan(user.id, 40);
    await ensureDueReminderDeliveries(user.id, at(26));
    await sql(`UPDATE "PlannedActivity" SET "plannedStartAt" = $2, "plannedEndAt" = $3 WHERE id = $1`, [plan.id, at(100), at(130)]);
    await dispatchDueReminderPushes(at(26), deps);
    check('6a. Edited time: no push for the old reminder time', sentTo(endpoint).length === 0);
    await dispatchDueReminderPushes(at(86), deps);
    check('6b. Edited time: push at the new reminder time', sentTo(endpoint).length === 1);
  }

  // ---------------------------------------------------------------
  // 7. Cancelled and completed activities.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('cancelled');
    const cancelled = await makePlan(user.id, 40, 'Cancelled');
    await ensureDueReminderDeliveries(user.id, at(26));
    await cancelPlannedActivity(user.id, cancelled.id);
    await dispatchDueReminderPushes(at(26), deps);
    check('7a. Cancelled after a pending delivery existed: no push', sentTo(endpoint).length === 0);

    const done = await makeUser('completed');
    const completed = await makePlan(done.user.id, 40, 'Completed');
    await logPlannedActivity(done.user.id, completed.id);
    await dispatchDueReminderPushes(at(26), deps);
    check('7b. Completed (logged) early: no push', sentTo(done.endpoint).length === 0);
  }

  // ---------------------------------------------------------------
  // 8. Reminders turned off.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('disabled');
    await makePlan(user.id, 40);
    await updateUserReminderPrefs(user.id, { remindersEnabled: false, reminderLeadMinutes: 15 });
    await dispatchDueReminderPushes(at(26), deps);
    check('8. Reminders off: no push', sentTo(endpoint).length === 0);
  }

  // ---------------------------------------------------------------
  // 9. Temporary failure is retried; persistent failure stops.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('transient');
    const plan = await makePlan(user.id, 40);
    respond = (ep) => (ep === endpoint ? { ok: false, isGone: false, errorCode: 'http_503' } : { ok: true, isGone: false });
    const first = await dispatchDueReminderPushes(at(25), deps);
    let rows = await deliveryRows(user.id, plan.id);
    check('9a. Temporary provider failure: delivery back to PENDING for retry', rows[0]?.status === 'PENDING' && rows[0]?.attemptCount === 1);
    check('9b. Dispatch reports the retry', first.retryScheduled >= 1);
    respond = () => ({ ok: true, isGone: false });
    await dispatchDueReminderPushes(at(26), deps);
    rows = await deliveryRows(user.id, plan.id);
    check('9c. Next run retries and sends', rows[0]?.status === 'SENT' && rows[0]?.attemptCount === 2 && sentTo(endpoint).length === 2);

    const stuck = await makeUser('persistent');
    const stuckPlan = await makePlan(stuck.user.id, 40);
    respond = (ep) => (ep === stuck.endpoint ? { ok: false, isGone: false, errorCode: 'send_error' } : { ok: true, isGone: false });
    for (let i = 0; i < MAX_REMINDER_DELIVERY_ATTEMPTS + 2; i += 1) {
      await dispatchDueReminderPushes(at(25 + i), deps);
    }
    rows = await deliveryRows(stuck.user.id, stuckPlan.id);
    check(`9d. Persistent failure: exactly ${MAX_REMINDER_DELIVERY_ATTEMPTS} attempts, then FAILED`, sentTo(stuck.endpoint).length === MAX_REMINDER_DELIVERY_ATTEMPTS && rows[0]?.status === 'FAILED' && rows[0]?.attemptCount === MAX_REMINDER_DELIVERY_ATTEMPTS);
    respond = () => ({ ok: true, isGone: false });
  }

  // ---------------------------------------------------------------
  // 10. Expired subscription (provider 410).
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('gone');
    const plan = await makePlan(user.id, 40);
    respond = (ep) => (ep === endpoint ? { ok: false, isGone: true, errorCode: 'http_410' } : { ok: true, isGone: false });
    await dispatchDueReminderPushes(at(25), deps);
    respond = () => ({ ok: true, isGone: false });
    const subs = await sql(`SELECT "disabledAt" FROM "PushSubscription" WHERE endpoint = $1`, [endpoint]);
    check('10a. Expired endpoint is disabled', subs[0]?.disabledAt != null);
    const rows = await deliveryRows(user.id, plan.id);
    check('10b. Delivery FAILED, not retried, when every endpoint is gone', rows[0]?.status === 'FAILED' && rows[0]?.attemptCount === 1);
    const plan2 = await makePlan(user.id, 70);
    await dispatchDueReminderPushes(at(55), deps);
    check('10c. No further sends to a disabled endpoint', sentTo(endpoint).length === 1);
    check('10d. No delivery row is created while the user has no active subscription', (await deliveryRows(user.id, plan2.id)).length === 0);
  }

  // ---------------------------------------------------------------
  // 11. Turning notifications on shortly before a reminder still works.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('late-subscriber', { subscribe: false });
    const plan = await makePlan(user.id, 40);
    await dispatchDueReminderPushes(at(25), deps);
    check('11a. No subscription: no row written (was SKIPPED before REM-01)', (await deliveryRows(user.id, plan.id)).length === 0);
    await upsertPushSubscription({ userId: user.id, endpoint, p256dh: 'test-p256dh', auth: 'test-auth' });
    await dispatchDueReminderPushes(at(27), deps);
    check('11b. Subscribed two minutes later: that reminder is still delivered', sentTo(endpoint).length === 1);
  }

  // ---------------------------------------------------------------
  // 12. A worker that died mid-send: stale claim is reclaimed, fresh one is not.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('stale');
    const plan = await makePlan(user.id, 40);
    const [row] = await ensureDueReminderDeliveries(user.id, at(26));
    await claimReminderDeliveryForSending(row.id); // PROCESSING, lastAttemptAt = now
    await dispatchDueReminderPushes(at(26), deps);
    check('12a. A PROCESSING row claimed moments ago is not taken over', sentTo(endpoint).length === 0);
    await sql(`UPDATE "ReminderDelivery" SET "lastAttemptAt" = now() - interval '10 minutes' WHERE id = $1`, [row.id]);
    await dispatchDueReminderPushes(at(27), deps);
    const rows = await deliveryRows(user.id, plan.id);
    check('12b. A PROCESSING row abandoned for 10 minutes is reclaimed and sent once', sentTo(endpoint).length === 1 && rows[0]?.status === 'SENT' && rows[0]?.attemptCount === 2);
  }

  // ---------------------------------------------------------------
  // 13. Midnight boundary in the user's timezone.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('midnight', { timezone: 'Asia/Kolkata' });
    // Next 00:05 IST (18:35 UTC), at least an hour ahead.
    const nextMidnightIst = new Date(N);
    nextMidnightIst.setUTCHours(18, 35, 0, 0);
    while (nextMidnightIst.getTime() - N.getTime() < 60 * MIN) nextMidnightIst.setUTCDate(nextMidnightIst.getUTCDate() + 1);
    const plan = await createPlannedActivity({
      userId: user.id,
      title: 'Midnight Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: nextMidnightIst,
      plannedEndAt: new Date(nextMidnightIst.getTime() + 30 * MIN),
      durationMinutes: 30,
      windowType: 'NEUTRAL',
    });
    const beforeMidnight = new Date(nextMidnightIst.getTime() - 13 * MIN); // 23:52 IST the previous day
    await dispatchDueReminderPushes(beforeMidnight, deps);
    check('13a. 00:05 IST activity reminded at 23:52 IST the previous evening', sentTo(endpoint).length === 1 && sentTo(endpoint)[0].title.endsWith('starts in 13 min'));
    const rows = await deliveryRows(user.id, plan.id);
    check('13b. reminderAt is 23:50 IST (start - 15 min, absolute)', rows[0] && new Date(rows[0].reminderAt).getTime() === nextMidnightIst.getTime() - 15 * MIN);
  }

  // ---------------------------------------------------------------
  // 14. Missing configuration, and the scheduler heartbeat.
  // ---------------------------------------------------------------
  {
    const { user, endpoint } = await makeUser('unconfigured');
    const plan = await makePlan(user.id, 40);
    const savedKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    delete process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
    const result = await dispatchDueReminderPushes(at(26), deps);
    check('14a. Without VAPID keys: configured=false, nothing sent', result.configured === false && sentTo(endpoint).length === 0);
    check('14b. Without VAPID keys: no delivery row is consumed', (await deliveryRows(user.id, plan.id)).length === 0);
    let heartbeat = await getReminderDispatchHeartbeat('WEB_PUSH');
    check('14c. Heartbeat records an unconfigured run', heartbeat?.lastRunConfigured === false);
    check('14d. An unconfigured run never counts as background delivery AVAILABLE', classifyBackgroundDelivery({ pushConfigured: true, heartbeat, now: new Date() }) === 'SCHEDULER_INACTIVE');
    process.env.WEB_PUSH_VAPID_PRIVATE_KEY = savedKey;
    await dispatchDueReminderPushes(at(26), deps);
    check('14e. Once configured, the same reminder is delivered', sentTo(endpoint).length === 1);
    heartbeat = await getReminderDispatchHeartbeat('WEB_PUSH');
    check('14f. Configured run: heartbeat makes background delivery AVAILABLE', classifyBackgroundDelivery({ pushConfigured: true, heartbeat, now: new Date() }) === 'AVAILABLE');
  }

  // Leave nothing due for later suites: cancel this run's remaining plans.
  await sql(
    `UPDATE "PlannedActivity" SET status = 'CANCELLED' WHERE status = 'UPCOMING' AND "userId" IN (SELECT id FROM "User" WHERE email LIKE $1)`,
    [`rem01-%-${RUN}@e2e.aura.local`]
  );

  console.log(allPassed ? '\nALL REMINDER RELIABILITY DB CHECKS PASSED' : '\nSOME REMINDER RELIABILITY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
