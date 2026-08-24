import { test as authedTest, expect as authedExpect } from '../fixtures/testUser';
import { test as base, expect } from '@playwright/test';
import { listPlans } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1.1 -- Recipient Conversion edge cases:
 * idempotency, true concurrent redemption, stale candidate recovery,
 * invalid/tampered guest state, and the existing-user /find regression.
 *
 * These are deliberately API/browser-level rather than full click-throughs
 * of the whole wizard (already covered end to end by
 * recipientConversionJourney.spec.ts) -- each test isolates ONE specific
 * boundary the brief calls out.
 */

const CITY = 'Chennai';

async function mintGuestState(request: import('@playwright/test').APIRequestContext, overrides: Partial<{ activityId: string; horizon: string; timePreference: string; durationMinutes: number; cityName: string; candidateStart: string; candidateEnd: string; source: string }> = {}) {
  const start = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const res = await request.post('/api/guest/state', {
    data: {
      activityId: 'coffee-tea',
      horizon: 'TODAY',
      timePreference: 'ANY',
      durationMinutes: 30,
      cityName: CITY,
      candidateStart: start.toISOString(),
      candidateEnd: end.toISOString(),
      source: 'DIRECT',
      ...overrides,
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return body.token as string;
}

// ============================================================
// Idempotency -- a repeated save POST with the SAME guestConversionToken
// (a refresh, a duplicate verification) resolves to the SAME Plan, never
// a second one.
// ============================================================
authedTest('idempotency: repeating POST /api/plans with the same guestConversionToken saves exactly one Plan', async ({ page }) => {
  const token = await mintGuestState(page.request);

  const res1 = await page.request.post('/api/plans', {
    data: {
      title: 'Coffee / Tea', activityType: 'Coffee / Tea', icon: '☕',
      plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      plannedEndAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
      durationMinutes: 30, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
      guestConversionToken: token,
    },
  });
  authedExpect(res1.ok()).toBe(true);
  const plan1 = await res1.json();

  // Repeat: refresh-equivalent (same token, same payload) run twice more.
  for (let i = 0; i < 2; i++) {
    const res = await page.request.post('/api/plans', {
      data: {
        title: 'Coffee / Tea', activityType: 'Coffee / Tea', icon: '☕',
        plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        plannedEndAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
        durationMinutes: 30, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
        guestConversionToken: token,
      },
    });
    authedExpect(res.ok()).toBe(true);
    const plan = await res.json();
    authedExpect(plan.id).toBe(plan1.id);
  }

  const plans = (await listPlans(page)).filter((p: any) => p.id === plan1.id);
  authedExpect(plans.length).toBe(1);
});

// ============================================================
// True concurrent redemption -- multiple simultaneous requests with the
// SAME fresh guestConversionToken must resolve to exactly one Plan.
// ============================================================
authedTest('true concurrent redemption: N simultaneous saves with the same guestConversionToken produce exactly one Plan', async ({ page }) => {
  const token = await mintGuestState(page.request, { activityId: 'coffee-tea' });
  const payload = {
    title: 'Coffee / Tea', activityType: 'Coffee / Tea', icon: '☕',
    plannedStartAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    plannedEndAt: new Date(Date.now() + 2.5 * 60 * 60 * 1000).toISOString(),
    durationMinutes: 30, windowType: 'NEUTRAL', windowLabel: 'Neutral Flow', matchLabel: 'Good Match', score: 70,
    guestConversionToken: token,
  };

  const CONCURRENCY = 5;
  const responses = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => page.request.post('/api/plans', { data: payload }))
  );
  authedExpect(responses.every((r) => r.ok())).toBe(true);
  const plans = await Promise.all(responses.map((r) => r.json()));
  const uniqueIds = new Set(plans.map((p) => p.id));

  // This is the brief's own required assertion. If the current claim/fill
  // implementation allows a duplicate under real concurrency, this FAILS
  // here first (as a regression test), documented in the completion
  // report -- and the smallest safe fix (a short retry-with-backoff for a
  // lost claim, in apps/web/app/api/plans/route.ts) closes it.
  authedExpect(uniqueIds.size).toBe(1);

  const allSavedPlans = await listPlans(page);
  const matching = allSavedPlans.filter((p: any) => uniqueIds.has(p.id));
  authedExpect(matching.length).toBe(1);
});

// ============================================================
// Stale candidate recovery -- the original chosen instant is no longer
// among fresh search results (simulated with an unreachable candidateStart
// far outside any real result set). The UI must warn explicitly, never
// silently substitute, and never save until the user acts.
// ============================================================
base('stale candidate recovery: restoring a guest state whose original candidate is gone shows an explicit notice, never a silent substitution', async ({ page }) => {
  const farFuture = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000); // 40 days out -- outside any guest horizon's real result set
  const res = await page.request.post('/api/guest/state', {
    data: {
      activityId: 'coffee-tea', horizon: 'TODAY', timePreference: 'ANY', durationMinutes: 30, cityName: CITY,
      candidateStart: farFuture.toISOString(), candidateEnd: new Date(farFuture.getTime() + 30 * 60000).toISOString(),
      source: 'DIRECT',
    },
  });
  expect(res.ok()).toBe(true);
  const { token } = await res.json();

  await page.goto(`/find?restore=${encodeURIComponent(token)}`);
  // Either an explicit "expired, but we found another" notice on a real
  // result, or (if TODAY genuinely has no result at all) the honest
  // no-result/expired state -- either way, never a silent swap.
  const staleNotice = page.getByText(/expired, but we found another/i);
  const noResult = page.getByText(/no strong times found|previous search expired/i);
  await expect(staleNotice.or(noResult)).toBeVisible({ timeout: 15000 });

  if (await staleNotice.isVisible()) {
    // A real replacement candidate is shown, but nothing is saved until
    // the user deliberately clicks Save.
    await expect(page.getByRole('button', { name: 'Save this moment' })).toBeVisible();
  }
});

// ============================================================
// Invalid/tampered guest state -- observably identical to a genuinely
// expired token (both fail the same signature/exp check in
// verifyGuestStateToken -> GET /api/guest/state returns 404, and the app
// deliberately never distinguishes WHY a restore failed, matching its own
// existing "never reveal REVOKED vs EXPIRED vs NOT_FOUND" privacy
// convention for public Moment links). Covers both "expired" and
// "tampered" from the brief with one deterministic case -- a genuinely
// time-expired token would require either waiting the real 30-minute TTL
// or weakening apps/web/lib/auth.ts's shared verify() (used by session and
// magic-link tokens too), neither of which is the smallest safe test.
// ============================================================
base('invalid/tampered guest state: clean recovery, never a blank screen or a silent redirect', async ({ page }) => {
  const res = await page.request.post('/api/guest/state', {
    data: {
      activityId: 'coffee-tea', horizon: 'TODAY', timePreference: 'ANY', durationMinutes: 30, cityName: CITY,
      candidateStart: new Date(Date.now() + 60 * 60000).toISOString(), candidateEnd: new Date(Date.now() + 90 * 60000).toISOString(),
      source: 'DIRECT',
    },
  });
  const { token } = await res.json();
  const tampered = token.slice(0, -4) + 'xxxx';

  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  await page.goto(`/find?restore=${encodeURIComponent(tampered)}`);
  await expect(page.getByText('Your previous search expired.')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Find a new moment' })).toBeVisible();
  expect(page.url()).toContain('/find');
  expect(consoleErrors.length).toBe(0);
});

// ============================================================
// Existing-user /find flow -- regression guard against the older "blank
// Plan redirect" bug: an authenticated user choosing an activity on /find
// must never see the guest signup flow, and must land in Plan with the
// activity actually prefilled.
// ============================================================
authedTest('existing user on /find: no signup flow, Plan opens with the activity prefilled', async ({ page }) => {
  await page.goto('/find');
  await expect(page.getByText('What are you planning?')).toBeVisible();
  await page.getByRole('button', { name: /Coffee \/ Tea/ }).click();

  await authedExpect(page.getByRole('heading', { name: 'Plan with Aura' })).toBeVisible({ timeout: 15000 });
  await authedExpect(page.getByText('Save this moment')).toHaveCount(0);
  await authedExpect(page.locator('input[type="text"], input:not([type])').first()).toHaveValue(/Coffee/i);
});
