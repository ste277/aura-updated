/**
 * Live-database test for ReminderDelivery persistence and the
 * ensureDueReminderDeliveries() future-worker boundary (Notification
 * Delivery Readiness V1) -- requires a real, reachable DATABASE_URL. Run
 * locally with a real DATABASE_URL set, e.g.:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/reminderDeliveryDb.test.ts
 *
 * Creates one throwaway test user and one throwaway PlannedActivity,
 * cancels + deletes the plan in the finally block (deletePlannedActivity
 * only allows CANCELLED/LOGGED rows, matching existing convention) --
 * ReminderDelivery rows themselves are left in place (no product reason to
 * delete delivery history).
 *
 * Product Journey / E2E Hardening V1 (brief section 29) -- the
 * scheduledItemId values below are randomly suffixed per run. They used to
 * be plain hardcoded strings ('delivery-fixture-plan' /
 * '-concurrent') on the reasoning that ensureReminderDelivery's own
 * idempotency made re-running safe -- but this test ALSO calls
 * markReminderDeliveryStatus(first.id, 'SENT') on that same row further
 * down, so a full prior run left the fixture's delivery row already SENT.
 * The next run's very first assertion ("creates a PENDING row for a new
 * occurrence") then failed against that already-advanced row -- reproduced
 * live via `DATABASE_URL=... npx ts-node test/reminderDeliveryDb.test.ts`
 * against the shared dev database. A fresh, unique scheduledItemId per run
 * sidesteps this at the root (never touches a previous run's row) rather
 * than trying to reset status back to PENDING at the top of the file.
 */
import { randomUUID } from 'crypto';
import {
  cancelPlannedActivity,
  createPlannedActivity,
  deletePlannedActivity,
  ensureReminderDelivery,
  markReminderDeliveryStatus,
  updateUserReminderPrefs,
  upsertUserByEmail,
} from '../apps/web/lib/db';
import { ensureDueReminderDeliveries } from '../apps/web/lib/reminderDelivery';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const FIXED_NOW = new Date('2026-08-23T10:00:00.000Z');
const RUN_ID = randomUUID();

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-reminder-delivery-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  await updateUserReminderPrefs(owner.id, { remindersEnabled: true, reminderLeadMinutes: 15 });

  // ============================================================
  // ensureReminderDelivery -- direct idempotency/uniqueness (brief section
  // 11/15): the SAME occurrence never produces two rows.
  // ============================================================
  const occurrenceReminderAt = new Date('2026-08-23T09:55:00.000Z');
  const first = await ensureReminderDelivery(owner.id, 'PLANNED_ACTIVITY', `delivery-fixture-plan-${RUN_ID}`, occurrenceReminderAt, 'WEB_PUSH');
  check('ensureReminderDelivery creates a PENDING row for a new occurrence', first.status === 'PENDING' && first.channel === 'WEB_PUSH');

  const second = await ensureReminderDelivery(owner.id, 'PLANNED_ACTIVITY', `delivery-fixture-plan-${RUN_ID}`, occurrenceReminderAt, 'WEB_PUSH');
  check('Calling ensureReminderDelivery again for the SAME occurrence returns the SAME row (idempotent claim, not a new one)', second.id === first.id);

  // Simulate two "concurrent workers" both calling it in the same tick.
  const [concurrentA, concurrentB] = await Promise.all([
    ensureReminderDelivery(owner.id, 'PLANNED_ACTIVITY', `delivery-fixture-concurrent-${RUN_ID}`, occurrenceReminderAt, 'WEB_PUSH'),
    ensureReminderDelivery(owner.id, 'PLANNED_ACTIVITY', `delivery-fixture-concurrent-${RUN_ID}`, occurrenceReminderAt, 'WEB_PUSH'),
  ]);
  check('Two concurrent calls for the SAME occurrence resolve to the SAME delivery id (DB constraint, not an in-memory check)', concurrentA.id === concurrentB.id);

  // ============================================================
  // markReminderDeliveryStatus -- SENT and FAILED, never conflated with
  // seen state (brief section 12).
  // ============================================================
  const sent = await markReminderDeliveryStatus(first.id, 'SENT');
  check('markReminderDeliveryStatus(SENT) sets status and sentAt', sent?.status === 'SENT' && sent?.sentAt !== null);
  check('markReminderDeliveryStatus(SENT) never touches failedAt/failureReason', sent?.failedAt === null && sent?.failureReason === null);

  const failed = await markReminderDeliveryStatus(concurrentA.id, 'FAILED', 'push_subscription_expired');
  check('markReminderDeliveryStatus(FAILED) sets status, failedAt, and a short reason', failed?.status === 'FAILED' && failed?.failedAt !== null && failed?.failureReason === 'push_subscription_expired');

  const longReason = 'x'.repeat(2000);
  const failedLongReason = await markReminderDeliveryStatus(concurrentA.id, 'FAILED', longReason);
  check('An overlong failureReason is truncated, never stored as a huge provider payload', (failedLongReason?.failureReason?.length ?? 0) <= 500);

  // ============================================================
  // ensureDueReminderDeliveries -- reuses deriveAuraReminders() eligibility
  // end to end, via a real PlannedActivity (brief section 13).
  // ============================================================
  const planStartAt = new Date('2026-08-23T10:10:00.000Z'); // 10 min after FIXED_NOW
  const planEndAt = new Date('2026-08-23T11:10:00.000Z');
  const plan = await createPlannedActivity({
    userId: owner.id,
    title: 'Delivery Readiness Fixture Plan',
    activityType: 'Deep Work',
    icon: '🧠',
    plannedStartAt: planStartAt,
    plannedEndAt: planEndAt,
    durationMinutes: 60,
    windowType: 'NEUTRAL',
  });

  try {
    const dueFirst = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const forThisPlan = dueFirst.filter((d) => d.scheduledItemId === plan.id);
    check('ensureDueReminderDeliveries creates exactly one delivery for the eligible plan', forThisPlan.length === 1);
    check('The delivery reminderAt matches deriveAuraReminders\' own math (start - 15min)', forThisPlan[0]?.reminderAt.getTime() === planStartAt.getTime() - 15 * 60_000);

    // ============================================================
    // IDEMPOTENCY -- calling the due-delivery preparation TWICE produces
    // exactly one WEB_PUSH delivery record for the same occurrence (brief
    // section 28).
    // ============================================================
    const dueSecond = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const forThisPlanAgain = dueSecond.filter((d) => d.scheduledItemId === plan.id);
    check('Calling ensureDueReminderDeliveries a second time returns the SAME delivery id, not a new one', forThisPlanAgain[0]?.id === forThisPlan[0]?.id);

    // ============================================================
    // CANCELLED plan -- brief section 18: no longer returned as due, but
    // the existing delivery record for its earlier occurrence is not deleted.
    // ============================================================
    await cancelPlannedActivity(owner.id, plan.id);
    const dueAfterCancel = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    check('A CANCELLED plan is no longer returned as a due reminder delivery', !dueAfterCancel.some((d) => d.scheduledItemId === plan.id));

    // ============================================================
    // PRIVACY -- ReminderDelivery rows carry only internal references and
    // safe delivery metadata (brief section 20/29).
    // ============================================================
    const serialized = JSON.stringify([first, sent, failed, ...dueFirst]);
    const forbidden = ['birthDate', 'birthTime', 'janmaRashi', 'nakshatra', 'sharedPersonDisplayName', 'senderDisplayName', 'publicToken', 'email', 'MuhurtaReasons'];
    check('ReminderDelivery rows never contain any birth/natal/person/token field name', forbidden.every((needle) => !serialized.includes(needle)));
  } finally {
    await deletePlannedActivity(owner.id, plan.id).catch(() => {});
  }

  console.log(allPassed ? '\nALL REMINDER DELIVERY DB CHECKS PASSED' : '\nSOME REMINDER DELIVERY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
