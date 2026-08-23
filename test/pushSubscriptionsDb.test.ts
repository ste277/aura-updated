/**
 * Live-database test for PushSubscription persistence (Web Push V1, brief
 * section 34). Requires a real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/pushSubscriptionsDb.test.ts
 *
 * Creates two throwaway test users, disables every subscription it created
 * in the finally block (disable, not delete -- matches this table's own
 * "don't delete state that's cheap to keep" convention).
 */
import {
  disablePushSubscriptionByEndpoint,
  disablePushSubscriptionForOwner,
  hasActivePushSubscription,
  listActivePushSubscriptionsForOwner,
  markPushSubscriptionSuccessful,
  upsertPushSubscription,
  upsertUserByEmail,
} from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const ENDPOINT_A = 'https://fcm.googleapis.com/fcm/send/push-subscription-fixture-a';
const ENDPOINT_B = 'https://fcm.googleapis.com/fcm/send/push-subscription-fixture-b';

async function main() {
  const ownerA = await upsertUserByEmail({ email: 'test-push-subscription-owner-a@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });
  const ownerB = await upsertUserByEmail({ email: 'test-push-subscription-owner-b@example.com', cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' });

  try {
    // ============================================================
    // Registration + endpoint uniqueness (brief section 4).
    // ============================================================
    const created = await upsertPushSubscription({ userId: ownerA.id, endpoint: ENDPOINT_A, p256dh: 'p256dh-key-a', auth: 'auth-key-a', userAgent: 'test-agent' });
    check('Registering a new subscription creates a live (non-disabled) row', created.disabledAt === null && created.userId === ownerA.id);

    const reRegistered = await upsertPushSubscription({ userId: ownerA.id, endpoint: ENDPOINT_A, p256dh: 'p256dh-key-a-v2', auth: 'auth-key-a-v2', userAgent: 'test-agent-v2' });
    check('Re-registering the SAME endpoint updates the existing row in place, not a duplicate', reRegistered.id === created.id);
    check('Re-registration updates the stored keys', reRegistered.p256dh === 'p256dh-key-a-v2' && reRegistered.auth === 'auth-key-a-v2');

    // ============================================================
    // Cross-user isolation (brief section 3).
    // ============================================================
    const ownerAActive1 = await listActivePushSubscriptionsForOwner(ownerA.id);
    const ownerBActive1 = await listActivePushSubscriptionsForOwner(ownerB.id);
    check('Owner A sees their own subscription', ownerAActive1.some((s) => s.endpoint === ENDPOINT_A));
    check("Owner B does NOT see owner A's subscription", !ownerBActive1.some((s) => s.endpoint === ENDPOINT_A));

    await upsertPushSubscription({ userId: ownerB.id, endpoint: ENDPOINT_B, p256dh: 'p256dh-key-b', auth: 'auth-key-b' });
    const ownerAHas = await hasActivePushSubscription(ownerA.id);
    const ownerBHas = await hasActivePushSubscription(ownerB.id);
    check('hasActivePushSubscription is true for both independently-registered owners', ownerAHas && ownerBHas);

    // ============================================================
    // Owner-scoped disable (brief section 28 "Turn off") -- never affects
    // another owner's subscription, and disable, not delete.
    // ============================================================
    await disablePushSubscriptionForOwner(ownerB.id, ENDPOINT_A); // wrong owner -- must no-op
    const ownerAStillActive = await listActivePushSubscriptionsForOwner(ownerA.id);
    check("Disabling by the WRONG owner's id does not affect owner A's real subscription", ownerAStillActive.some((s) => s.endpoint === ENDPOINT_A));

    await disablePushSubscriptionForOwner(ownerA.id, ENDPOINT_A);
    const ownerAAfterDisable = await listActivePushSubscriptionsForOwner(ownerA.id);
    check("Disabling by the CORRECT owner removes it from the active list", !ownerAAfterDisable.some((s) => s.endpoint === ENDPOINT_A));
    check('A disabled subscription no longer counts as an active subscription for the owner', !(await hasActivePushSubscription(ownerA.id)));

    // ============================================================
    // Re-subscribing after disable re-enables in place (brief section 4:
    // "a stale/expired subscription re-subscribing is, by definition, live
    // again").
    // ============================================================
    const reEnabled = await upsertPushSubscription({ userId: ownerA.id, endpoint: ENDPOINT_A, p256dh: 'p256dh-key-a-v3', auth: 'auth-key-a-v3' });
    check('Re-registering a disabled endpoint clears disabledAt (re-enables it)', reEnabled.id === created.id && reEnabled.disabledAt === null);
    check('The re-enabled subscription is active again', await hasActivePushSubscription(ownerA.id));

    // ============================================================
    // Stale-subscription cleanup (brief section 18) -- provider-reported
    // gone, no ownership check needed (the delivery service already resolved
    // the subscription via the owner's own list).
    // ============================================================
    await disablePushSubscriptionByEndpoint(ENDPOINT_A, 'gone');
    check('disablePushSubscriptionByEndpoint disables regardless of owner id being passed', !(await hasActivePushSubscription(ownerA.id)));

    // ============================================================
    // markPushSubscriptionSuccessful -- last-success bookkeeping only, never
    // flips disabledAt.
    // ============================================================
    await upsertPushSubscription({ userId: ownerA.id, endpoint: ENDPOINT_A, p256dh: 'p256dh-key-a-v4', auth: 'auth-key-a-v4' });
    await markPushSubscriptionSuccessful(ENDPOINT_A);
    const afterSuccess = await listActivePushSubscriptionsForOwner(ownerA.id);
    const successRow = afterSuccess.find((s) => s.endpoint === ENDPOINT_A);
    check('markPushSubscriptionSuccessful sets lastSuccessfulAt', successRow?.lastSuccessfulAt !== null && successRow?.lastSuccessfulAt !== undefined);

    // ============================================================
    // Privacy -- rows never leak into serialized output with any birth/natal
    // field name (defensive; these rows never had such fields, but this
    // guards against future column additions accidentally carrying them).
    // ============================================================
    const serialized = JSON.stringify([created, reRegistered, reEnabled, successRow]);
    const forbidden = ['birthDate', 'birthTime', 'janmaRashi', 'nakshatra', 'email'];
    check('PushSubscription rows never contain any birth/natal/email field name', forbidden.every((needle) => !serialized.includes(needle)));
  } finally {
    await disablePushSubscriptionForOwner(ownerA.id, ENDPOINT_A).catch(() => {});
    await disablePushSubscriptionForOwner(ownerB.id, ENDPOINT_B).catch(() => {});
  }

  console.log(allPassed ? '\nALL PUSH SUBSCRIPTION DB CHECKS PASSED' : '\nSOME PUSH SUBSCRIPTION DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
