/**
 * Recipient Conversion V1 Hardening -- live-database tests for the
 * idempotent guest-conversion save path (brief section 2/10/19). Requires a
 * real, reachable DATABASE_URL:
 *
 *   DATABASE_URL="postgresql://..." npx ts-node test/guestConversionIdempotencyDb.test.ts
 */
import {
  upsertUserByEmail,
  createPlannedActivity,
  getPlannedActivityForOwner,
  claimGuestConversionToken,
  getGuestConversionRedemption,
  fillGuestConversionRedemption,
  PlannedActivity,
} from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function randomHash(): string {
  return `test-hash-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

async function makePlan(userId: string, title = 'Date Night'): Promise<PlannedActivity> {
  return createPlannedActivity({
    userId,
    title,
    activityType: title,
    icon: '❤️',
    plannedStartAt: new Date('2026-08-29T14:00:00.000Z'),
    plannedEndAt: new Date('2026-08-29T16:00:00.000Z'),
    durationMinutes: 120,
    windowType: 'NEUTRAL',
    windowLabel: 'Neutral Flow',
    matchLabel: 'Good Match',
    score: 70,
    recommendation: 'A comfortable window.',
    calendarUrl: null,
  });
}

async function main() {
  const owner = await upsertUserByEmail({
    email: 'test-guest-conversion-idempotency@example.com',
    cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata',
  });

  // ============================================================
  // Section 10 -- claim / fill / replay
  // ============================================================
  {
    const hash = randomHash();
    const claimed = await claimGuestConversionToken(hash, owner.id);
    check('First claim on a fresh token hash succeeds', claimed === true);

    const second = await claimGuestConversionToken(hash, owner.id);
    check('A second claim attempt on the SAME hash fails (already claimed)', second === false);

    const beforeFill = await getGuestConversionRedemption(hash);
    check('Before fill, the redemption row exists with plannedActivityId null (orphaned-claim-recoverable state)', beforeFill !== null && beforeFill.plannedActivityId === null);

    const plan = await makePlan(owner.id);
    await fillGuestConversionRedemption(hash, plan.id);

    const afterFill = await getGuestConversionRedemption(hash);
    check('After fill, the redemption row carries the real plannedActivityId', afterFill?.plannedActivityId === plan.id);
  }

  // ============================================================
  // Section 2/19 -- the created Plan is canonical: no acquisition-specific
  // fields, no "isGuestPlan"/"convertedPlan" marker anywhere on the row.
  // ============================================================
  {
    const hash = randomHash();
    await claimGuestConversionToken(hash, owner.id);
    const plan = await makePlan(owner.id, 'Coffee / Tea');
    await fillGuestConversionRedemption(hash, plan.id);

    const fetched = await getPlannedActivityForOwner(owner.id, plan.id);
    const keys = fetched ? Object.keys(fetched) : [];
    const forbiddenKeys = ['isGuestPlan', 'convertedPlan', 'recipientPlan', 'acquisitionSource', 'guestConversionToken', 'source'];
    check('The canonical PlannedActivity row carries none of the forbidden acquisition-source fields', forbiddenKeys.every((k) => !keys.includes(k)));
    check('The canonical PlannedActivity row has status UPCOMING like any other new Plan', fetched?.status === 'UPCOMING');
    check('The canonical PlannedActivity row title/activityType match exactly what was requested, nothing injected', fetched?.title === 'Coffee / Tea' && fetched?.activityType === 'Coffee / Tea');
  }

  // ============================================================
  // Idempotent replay simulation: two "requests" for the SAME hash after a
  // fill must resolve to the SAME Plan id, never create a second Plan --
  // this is exactly what POST /api/plans's own guestConversionToken branch
  // does; here we verify the underlying DB primitives it's built from.
  // ============================================================
  {
    const hash = randomHash();
    await claimGuestConversionToken(hash, owner.id);
    const plan = await makePlan(owner.id, 'Movie Night');
    await fillGuestConversionRedemption(hash, plan.id);

    // Simulates a refresh/duplicate-verification retry: the route looks up
    // the existing redemption FIRST, before ever calling createPlannedActivity.
    const replay1 = await getGuestConversionRedemption(hash);
    const replay2 = await getGuestConversionRedemption(hash);
    check('Two separate "retry" lookups both resolve to the same Plan id', replay1?.plannedActivityId === plan.id && replay2?.plannedActivityId === plan.id);
  }

  console.log(allPassed ? '\nALL GUEST CONVERSION IDEMPOTENCY DB CHECKS PASSED' : '\nSOME GUEST CONVERSION IDEMPOTENCY DB CHECKS FAILED');
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed with an unexpected error:', err);
  process.exit(1);
});
