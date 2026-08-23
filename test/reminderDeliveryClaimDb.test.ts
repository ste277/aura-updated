/**
 * Live-database test for Web Push V1's concurrency-safety and reschedule/
 * successor-race protections (brief sections 22, 24, 25, 36, 39, 40, 41).
 * Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/reminderDeliveryClaimDb.test.ts
 *
 * This is the test that would catch the brief's own worked "BAD" scenario:
 * a PENDING delivery row created for one occurrence, the underlying
 * Plan/Moment changing before send time, and a naive worker sending the
 * push anyway for an occurrence that no longer exists as such.
 */
import {
  cancelPlannedActivity,
  claimReminderDeliveryForSending,
  createAuraMoment,
  createPlannedActivity,
  deletePlannedActivity,
  disablePushSubscriptionForOwner,
  ensureReminderDelivery,
  revokeAuraMoment,
  upsertPushSubscription,
  upsertUserByEmail,
  updateUserReminderPrefs,
} from '../apps/web/lib/db';
import { ensureDueReminderDeliveries, sendReminderDelivery } from '../apps/web/lib/reminderDelivery';
import { generatePublicMomentToken } from '../apps/web/lib/auraMoments';
import { randomUUID } from 'crypto';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const FIXED_NOW = new Date('2026-08-23T10:00:00.000Z');

async function main() {
  const owner = await upsertUserByEmail({ email: 'test-reminder-claim-owner@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  await updateUserReminderPrefs(owner.id, { remindersEnabled: true, reminderLeadMinutes: 15 });

  const cleanupPlanIds: string[] = [];
  const cleanupMomentTokens: string[] = [];
  const subscriptionEndpoint = 'https://fcm.googleapis.com/fcm/send/reminder-claim-fixture';

  try {
    // ============================================================
    // Claim concurrency (brief section 22/36) -- the actual race this PR
    // exists to close. Two idempotent creations of the SAME row is a
    // DIFFERENT race (already proven in reminderDeliveryDb.test.ts); this
    // proves that once a row exists, only ONE of many simultaneous SEND
    // attempts against it can ever win.
    // ============================================================
    // A fresh scheduledItemId per run -- ensureReminderDelivery is
    // idempotent by design (brief section 11), so reusing a fixed id across
    // repeated test runs would return the SAME (already-claimed-from-a-
    // previous-run) row instead of a clean PENDING one.
    const claimFixture = await ensureReminderDelivery(owner.id, 'PLANNED_ACTIVITY', `claim-race-fixture-${randomUUID()}`, new Date('2026-08-23T09:50:00.000Z'), 'WEB_PUSH');
    check('Fixture delivery starts PENDING', claimFixture.status === 'PENDING');

    const CONCURRENT_CLAIMANTS = 8;
    const claimResults = await Promise.all(
      Array.from({ length: CONCURRENT_CLAIMANTS }, () => claimReminderDeliveryForSending(claimFixture.id))
    );
    const winners = claimResults.filter((r) => r !== null);
    check(`Exactly ONE of ${CONCURRENT_CLAIMANTS} concurrent claim attempts on the same PENDING row wins (atomic UPDATE ... WHERE status = 'PENDING')`, winners.length === 1);
    check('The winning claim transitions the row to PROCESSING', winners[0]?.status === 'PROCESSING');
    check('The winning claim increments attemptCount', (winners[0]?.attemptCount ?? 0) === 1);

    const claimAfterWin = await claimReminderDeliveryForSending(claimFixture.id);
    check('A further claim attempt after the row is already PROCESSING also fails (not PENDING anymore)', claimAfterWin === null);

    // ============================================================
    // sendReminderDelivery -- no active push subscription (brief section
    // 27: reminders enabled but device notifications never turned on).
    // ============================================================
    const planA = await createPlannedActivity({
      userId: owner.id,
      title: 'No Subscription Fixture Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: new Date('2026-08-23T10:10:00.000Z'),
      plannedEndAt: new Date('2026-08-23T11:10:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    cleanupPlanIds.push(planA.id);

    const dueA = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const deliveryA = dueA.find((d) => d.scheduledItemId === planA.id);
    check('A delivery was created for the eligible plan', deliveryA?.status === 'PENDING');

    const outcomeA = await sendReminderDelivery(deliveryA!, FIXED_NOW);
    check('sendReminderDelivery SKIPs (never throws/sends) when the owner has no active push subscription', outcomeA === 'SKIPPED');
    const reclaimA = await claimReminderDeliveryForSending(deliveryA!.id);
    check('The SKIPPED delivery is no longer claimable as PENDING', reclaimA === null);

    // ============================================================
    // sendReminderDelivery -- reminders disabled AFTER the PENDING row was
    // created (brief section 26: re-checked at send time, not just creation
    // time).
    // ============================================================
    await upsertPushSubscription({ userId: owner.id, endpoint: subscriptionEndpoint, p256dh: 'p256dh-claim-fixture', auth: 'auth-claim-fixture' });

    const planB = await createPlannedActivity({
      userId: owner.id,
      title: 'Reminders Disabled Fixture Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: new Date('2026-08-23T10:12:00.000Z'),
      plannedEndAt: new Date('2026-08-23T11:12:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    cleanupPlanIds.push(planB.id);

    const dueB = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const deliveryB = dueB.find((d) => d.scheduledItemId === planB.id);
    check('A delivery was created for the second eligible plan', deliveryB?.status === 'PENDING');

    await updateUserReminderPrefs(owner.id, { remindersEnabled: false, reminderLeadMinutes: 15 });
    const outcomeB = await sendReminderDelivery(deliveryB!, FIXED_NOW);
    check('sendReminderDelivery SKIPs when reminders were disabled after the PENDING row was created', outcomeB === 'SKIPPED');
    await updateUserReminderPrefs(owner.id, { remindersEnabled: true, reminderLeadMinutes: 15 });

    // ============================================================
    // Reschedule race (brief section 24) -- the brief's own worked "BAD"
    // scenario: a PENDING delivery exists for occurrence X; X's underlying
    // Plan moves before the worker gets to send. Modeled here the way a
    // reschedule actually changes eligibility for a PlannedActivity
    // (cancelling the old occurrence and a new one appearing at a different
    // time) -- deriveAuraReminders() has no notion of "the same Plan
    // renamed", only "is this exact occurrence still eligible right now".
    // ============================================================
    const planC = await createPlannedActivity({
      userId: owner.id,
      title: 'Reschedule Race Fixture Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: new Date('2026-08-23T10:14:00.000Z'),
      plannedEndAt: new Date('2026-08-23T11:14:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    cleanupPlanIds.push(planC.id);

    const dueC1 = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const deliveryC = dueC1.find((d) => d.scheduledItemId === planC.id);
    check('A PENDING delivery exists for the plan\'s original occurrence', deliveryC?.status === 'PENDING');

    // The "reschedule" -- the old occurrence is no longer UPCOMING (moved
    // away), and the plan reappears at a materially later time.
    await cancelPlannedActivity(owner.id, planC.id);
    const planCRescheduled = await createPlannedActivity({
      userId: owner.id,
      title: 'Reschedule Race Fixture Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: new Date('2026-08-23T14:00:00.000Z'), // hours later -- well outside the original delivery's window
      plannedEndAt: new Date('2026-08-23T15:00:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    cleanupPlanIds.push(planCRescheduled.id);

    const outcomeC = await sendReminderDelivery(deliveryC!, FIXED_NOW);
    check('sendReminderDelivery SKIPs the stale PENDING delivery instead of sending a push for a moved occurrence (prevents the brief\'s "BAD" scenario)', outcomeC === 'SKIPPED');

    const dueNearNewTime = await ensureDueReminderDeliveries(owner.id, new Date('2026-08-23T13:50:00.000Z'));
    const deliveryForNewOccurrence = dueNearNewTime.find((d) => d.scheduledItemId === planCRescheduled.id);
    check('The rescheduled occurrence gets its OWN independent PENDING delivery once it becomes due, unaffected by the old one being skipped', deliveryForNewOccurrence?.status === 'PENDING' && deliveryForNewOccurrence?.id !== deliveryC?.id);

    // ============================================================
    // Successor-Moment safety (brief section 25) -- an old Moment stays
    // status ACTIVE (never revoked) but gets a successor via "Suggest a
    // different time"; deriveAuraReminders() must exclude it from current
    // eligibility, and a PENDING delivery created before the successor
    // existed must be skipped, never sent, at send time.
    // ============================================================
    const oldTokenD = generatePublicMomentToken();
    cleanupMomentTokens.push(oldTokenD);
    const oldMoment = await createAuraMoment({
      ownerUserId: owner.id,
      publicToken: oldTokenD,
      scope: 'SHARED',
      source: 'MUHURTHAM',
      activityId: 'date-night',
      activityTitle: 'Date Night',
      activityIcon: '❤️',
      startAt: new Date('2026-08-23T10:10:00.000Z'),
      endAt: new Date('2026-08-23T11:10:00.000Z'),
      timezone: 'Asia/Kolkata',
      savedPersonId: null,
      sharedPersonDisplayName: 'Anu',
      senderDisplayName: 'Stephen',
      ratingLabel: 'STRONG_SHARED_FIT',
      explanationSnapshot: 'Aura found this timing to work well for both of you.',
      expiresAt: null,
    });

    const dueD1 = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const deliveryD = dueD1.find((d) => d.scheduledItemId === oldMoment.id);
    check('A PENDING delivery exists for the original (soon-to-be-superseded) Moment occurrence', deliveryD?.status === 'PENDING');

    const successorTokenD = generatePublicMomentToken();
    cleanupMomentTokens.push(successorTokenD);
    const successorMoment = await createAuraMoment({
      ownerUserId: owner.id,
      publicToken: successorTokenD,
      scope: 'SHARED',
      source: 'MUHURTHAM',
      activityId: 'date-night',
      activityTitle: 'Date Night',
      activityIcon: '❤️',
      startAt: new Date('2026-08-23T16:00:00.000Z'),
      endAt: new Date('2026-08-23T17:00:00.000Z'),
      timezone: 'Asia/Kolkata',
      savedPersonId: null,
      sharedPersonDisplayName: 'Anu',
      senderDisplayName: 'Stephen',
      ratingLabel: 'STRONG_SHARED_FIT',
      explanationSnapshot: 'Aura found this timing to work well for both of you.',
      expiresAt: null,
      previousMomentId: oldMoment.id,
    });

    const outcomeD = await sendReminderDelivery(deliveryD!, FIXED_NOW);
    check('sendReminderDelivery SKIPs the old Moment\'s PENDING delivery once it has a successor, even though the old row itself is still status ACTIVE', outcomeD === 'SKIPPED');

    const dueNearSuccessorTime = await ensureDueReminderDeliveries(owner.id, new Date('2026-08-23T15:50:00.000Z'));
    const deliveryForSuccessor = dueNearSuccessorTime.find((d) => d.scheduledItemId === successorMoment.id);
    check('The successor Moment gets its OWN independent delivery, unaffected by the original being suppressed', deliveryForSuccessor?.status === 'PENDING');

    await revokeAuraMoment(owner.id, oldTokenD);
    await revokeAuraMoment(owner.id, successorTokenD);

    // ============================================================
    // Graceful send attempt (brief section 16/23) -- with a real active
    // subscription in place, sendReminderDelivery must resolve to a clean
    // terminal outcome (never throw, never leave the row stuck in
    // PROCESSING) regardless of whether this environment has real VAPID
    // keys configured.
    // ============================================================
    const planE = await createPlannedActivity({
      userId: owner.id,
      title: 'Graceful Send Fixture Plan',
      activityType: 'Deep Work',
      icon: '🧠',
      plannedStartAt: new Date('2026-08-23T10:09:00.000Z'),
      plannedEndAt: new Date('2026-08-23T11:09:00.000Z'),
      durationMinutes: 60,
      windowType: 'NEUTRAL',
    });
    cleanupPlanIds.push(planE.id);

    const dueE = await ensureDueReminderDeliveries(owner.id, FIXED_NOW);
    const deliveryE = dueE.find((d) => d.scheduledItemId === planE.id);
    const outcomeE = await sendReminderDelivery(deliveryE!, FIXED_NOW);
    check('sendReminderDelivery resolves to a clean terminal outcome (SENT or FAILED) with a real subscription present, never throws', outcomeE === 'SENT' || outcomeE === 'FAILED');
    const reclaimE = await claimReminderDeliveryForSending(deliveryE!.id);
    check('After sending, the delivery is never left claimable as PENDING again', reclaimE === null);
  } finally {
    for (const planId of cleanupPlanIds) {
      await cancelPlannedActivity(owner.id, planId).catch(() => {});
      await deletePlannedActivity(owner.id, planId).catch(() => {});
    }
    for (const token of cleanupMomentTokens) {
      await revokeAuraMoment(owner.id, token).catch(() => {});
    }
    await disablePushSubscriptionForOwner(owner.id, subscriptionEndpoint).catch(() => {});
  }

  console.log(allPassed ? '\nALL REMINDER DELIVERY CLAIM/RACE CHECKS PASSED' : '\nSOME REMINDER DELIVERY CLAIM/RACE CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
