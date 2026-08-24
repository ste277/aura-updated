import { test, expect } from '../fixtures/testUser';
import { listPlans } from '../fixtures/testData';

/**
 * Intentional Day Builder V1 hardening pass -- PlanCreationIdempotency is
 * now general infrastructure (any caller of POST /api/plans can pass a
 * clientRequestId, not just Day Builder), so it gets the exact same
 * rigor recipientConversionEdgeCases.spec.ts already established for
 * guestConversionToken: repeat, true concurrency, and (new here) an
 * orphaned/unfilled claim's later retry. API/browser-level rather than a
 * full Day Builder click-through -- the happy path is already covered by
 * dayBuilderJourney.spec.ts; this isolates the idempotency boundary itself.
 */

function validPlanPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Coffee / Tea',
    activityType: 'Coffee / Tea',
    icon: '☕',
    plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    plannedEndAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
    durationMinutes: 30,
    windowType: 'NEUTRAL',
    windowLabel: 'Neutral Flow',
    matchLabel: 'Good Match',
    score: 70,
    ...overrides,
  };
}

// ============================================================
// Rapid duplicate -- a repeated save POST with the SAME clientRequestId
// (a double-tap, a duplicate render) resolves to the SAME Plan, never a
// second one.
// ============================================================
test('idempotency: repeating POST /api/plans with the same clientRequestId saves exactly one Plan', async ({ page }) => {
  const clientRequestId = `e2e-idempotency-${Date.now()}`;

  const res1 = await page.request.post('/api/plans', { data: validPlanPayload({ clientRequestId }) });
  expect(res1.ok()).toBe(true);
  const plan1 = await res1.json();

  for (let i = 0; i < 2; i++) {
    const res = await page.request.post('/api/plans', { data: validPlanPayload({ clientRequestId }) });
    expect(res.ok()).toBe(true);
    const plan = await res.json();
    expect(plan.id).toBe(plan1.id);
  }

  const plans = (await listPlans(page)).filter((p: any) => p.id === plan1.id);
  expect(plans.length).toBe(1);
});

// ============================================================
// True concurrent duplicate -- multiple simultaneous requests with the
// SAME fresh clientRequestId must resolve to exactly one Plan (same
// claim/fill race the guest-conversion table already closes).
// ============================================================
test('true concurrent redemption: N simultaneous saves with the same clientRequestId produce exactly one Plan', async ({ page }) => {
  const clientRequestId = `e2e-idempotency-concurrent-${Date.now()}`;
  const payload = validPlanPayload({ clientRequestId });

  const CONCURRENCY = 5;
  const responses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => page.request.post('/api/plans', { data: payload }))
  );
  expect(responses.every((r) => r.ok())).toBe(true);
  const plans = await Promise.all(responses.map((r) => r.json()));
  const uniqueIds = new Set(plans.map((p) => p.id));
  expect(uniqueIds.size).toBe(1);

  const allSavedPlans = await listPlans(page);
  const matching = allSavedPlans.filter((p: any) => uniqueIds.has(p.id));
  expect(matching.length).toBe(1);
});

// ============================================================
// An orphaned claim (the request that first claimed a clientRequestId
// failed BEFORE ever calling fillPlanCreationClaim -- e.g. it failed
// validation) must not permanently poison that key. A later retry with
// the same clientRequestId still succeeds and creates a real Plan.
// ============================================================
test('a failed first attempt does not permanently poison the idempotency key -- a later retry with the same clientRequestId still creates a Plan', async ({ page }) => {
  const clientRequestId = `e2e-idempotency-orphan-${Date.now()}`;

  // Claims the key (claimPlanCreation runs before body validation in the
  // route), then fails validation (no title) before ever reaching
  // fillPlanCreationClaim -- an orphaned, unfilled claim row.
  const failedRes = await page.request.post('/api/plans', {
    data: validPlanPayload({ title: '', clientRequestId }),
  });
  expect(failedRes.ok()).toBe(false);
  expect(failedRes.status()).toBe(400);

  // Retry with the SAME clientRequestId, now with a valid payload. Should
  // still succeed -- the route's bounded poll finds nothing to await (the
  // failed attempt never fills it) and falls through to create fresh,
  // then fills the same claim row.
  const retryRes = await page.request.post('/api/plans', { data: validPlanPayload({ clientRequestId }) });
  expect(retryRes.ok()).toBe(true);
  const plan = await retryRes.json();
  expect(plan.title).toBe('Coffee / Tea');

  const plans = (await listPlans(page)).filter((p: any) => p.id === plan.id);
  expect(plans.length).toBe(1);
});

// ============================================================
// A different clientRequestId is a completely independent key -- two
// distinct suggestions/saves never collide with each other.
// ============================================================
test('two different clientRequestIds create two separate Plans normally', async ({ page }) => {
  const res1 = await page.request.post('/api/plans', {
    data: validPlanPayload({ title: 'Deep Work', activityType: 'Deep Work', clientRequestId: `e2e-idempotency-a-${Date.now()}` }),
  });
  const res2 = await page.request.post('/api/plans', {
    data: validPlanPayload({
      title: 'Learning',
      activityType: 'Learning',
      plannedStartAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      plannedEndAt: new Date(Date.now() + 4.5 * 60 * 60 * 1000).toISOString(),
      clientRequestId: `e2e-idempotency-b-${Date.now()}`,
    }),
  });
  expect(res1.ok()).toBe(true);
  expect(res2.ok()).toBe(true);
  const plan1 = await res1.json();
  const plan2 = await res2.json();
  expect(plan1.id).not.toBe(plan2.id);

  const plans = await listPlans(page);
  expect(plans.some((p: any) => p.id === plan1.id)).toBe(true);
  expect(plans.some((p: any) => p.id === plan2.id)).toBe(true);
});
