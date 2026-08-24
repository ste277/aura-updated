import { test, expect } from '@playwright/test';
import { signInNewUser } from '../fixtures/testUser';
import { createSavedPerson, createSharedMoment, listPlans, fetchMyDay } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1.1 -- required Journey A: Recipient
 * Conversion, the primary acquisition loop. Runs the RECIPIENT side in the
 * default (unauthenticated) `page`/context; a separate, temporary
 * authenticated context sets up the owner's SavedPerson + AuraMoment
 * fixture via the real APIs (never a forged session for the recipient
 * side -- the whole point is proving the logged-out path works).
 */

test('logged-out recipient: public Moment -> respond -> find your own moment -> guest search -> signup -> restore -> exactly one Plan -> handoff -> My Day', async ({ page, browser }) => {
  // ---- Owner-side fixture setup (separate, temporary authenticated context) ----
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInNewUser(ownerPage, { emailLabel: 'rc-owner' });
  const person = await createSavedPerson(ownerPage, { name: 'Reena', relationshipType: 'PARTNER' });
  const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const moment = await createSharedMoment(ownerPage, { savedPersonId: person.id, activityId: 'date-night', startIso: start.toISOString(), endIso: end.toISOString() });
  await ownerContext.close();

  // ---- Analytics/privacy boundary: capture every tracked event's real
  // wire payload (brief section 8/9) -- checking the server capture, not
  // internal React callbacks. ----
  const trackedEvents: Array<{ eventName: string; body: string }> = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/product-events')) {
      const body = req.postData() ?? '';
      const eventName = (JSON.parse(body || '{}').eventName as string) ?? '';
      trackedEvents.push({ eventName, body });
    }
  });

  // ---- Recipient: public Moment page, fully logged out ----
  await page.goto(moment.shareUrl);
  await expect(page.getByText('Does this work for you?')).toBeVisible();
  await page.getByRole('button', { name: /I'm in/ }).click();
  await expect(page.getByText(/will know you're in/)).toBeVisible({ timeout: 10000 });

  // ---- "Find your own moment" -> guest activity picker ----
  await page.getByRole('link', { name: /Find your own moment/ }).first().click();
  await expect(page).toHaveURL(/\/find\?src=moment/);
  await expect(page.getByText('What are you planning?')).toBeVisible();

  // An EVERYDAY activity -- Coffee / Tea.
  await page.getByRole('button', { name: /Coffee \/ Tea/ }).click();
  await expect(page.getByText('Coffee / Tea')).toBeVisible();

  // Horizon + continue (Coffee / Tea has no USER_SELECTED duration picker).
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();

  // Location -> run guest search.
  await expect(page.getByText('Where are you?')).toBeVisible();
  await page.getByRole('button', { name: 'Find my moment' }).click();

  // A real returned candidate.
  await expect(page.getByText('Your best moment')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('heading', { name: /Coffee \/ Tea/ })).toBeVisible();

  const beforePlans = await listPlans(page).catch(() => null); // unauthenticated -> expect this to fail/401; not asserted here, just a guard
  expect(beforePlans).toBeNull();

  await page.getByRole('button', { name: 'Save this moment' }).click();

  // ---- Signup begins ----
  await expect(page.getByText('Save this moment', { exact: true })).toBeVisible();
  const email = `e2e-rc-guest-${Date.now()}@e2e.aura.local`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();

  await expect(page.getByText('We emailed you a sign-in link')).toBeVisible({ timeout: 10000 });
  const devCode = await page.locator('text=/Code: \\d{6}/').textContent();
  const code = devCode?.match(/\d{6}/)?.[0];
  expect(code).toBeTruthy();
  await page.locator('input[inputmode="numeric"]').fill(code!);
  await page.getByRole('button', { name: 'Sign in and save' }).click();

  // ---- Guest state restores, candidate restores, exactly one Plan, handoff ----
  await expect(page.getByText(/is saved$/)).toBeVisible({ timeout: 15000 });
  const plans = await listPlans(page);
  expect(plans.length).toBe(1);
  expect(plans[0].title.toLowerCase()).toContain('coffee');
  // No guest-specific fields on the canonical Plan.
  const forbidden = ['isGuestPlan', 'convertedPlan', 'recipientPlan', 'acquisitionSource', 'guestConversionToken', 'source'];
  expect(forbidden.every((k) => !(k in plans[0]))).toBe(true);

  await page.getByRole('button', { name: /See my day/ }).click();

  // ---- Home/My Day: converted Plan appears exactly like any other Plan ----
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible({ timeout: 15000 });
  const myDay = await fetchMyDay(page);
  const matching = myDay.agenda.items.filter((i: any) => i.type === 'PLAN' && i.title.toLowerCase().includes('coffee'));
  expect(matching.length).toBe(1);

  // ---- Analytics boundary (brief section 8): real server-captured events,
  // not internal callbacks. FIRST_PLAN_SAVED reuses the existing
  // GUEST_RESULT_SAVED event (documented in an earlier hardening pass --
  // not a separate event). GUEST_RESULT_RESTORED is exercised separately
  // (see recipientConversionMagicLinkRestore.spec.ts) since this
  // particular flow used the same-tab code-entry path, not a magic-link
  // click in a different context. ----
  const eventNames = trackedEvents.map((e) => e.eventName);
  expect(eventNames).toContain('GUEST_RESULT_SAVED');
  expect(eventNames).toContain('ONBOARDING_HANDOFF_VIEWED');
  expect(eventNames).toContain('MY_DAY_OPENED_FROM_HANDOFF');

  // ---- Privacy (brief section 9): no raw email/person name/birth data/
  // coordinates in the Recipient Conversion funnel's OWN events. Scoped to
  // just those events -- AURA_MOMENT_FIND_YOUR_OWN_CLICKED (fired earlier
  // in this same flow) legitimately carries a raw momentToken client-side
  // by design (resolved to an internal id server-side before persistence,
  // see api/product-events/route.ts's own doc comment); that is a
  // different, pre-existing event with its own already-safe mechanism, not
  // part of what this brief asks to audit. ----
  const rcEventNames = new Set(['GUEST_RESULT_SAVED', 'ONBOARDING_HANDOFF_VIEWED', 'MY_DAY_OPENED_FROM_HANDOFF', 'GUEST_RESULT_RESTORED']);
  const rcEvents = trackedEvents.filter((e) => rcEventNames.has(e.eventName));
  expect(rcEvents.length).toBeGreaterThan(0);
  const forbiddenInAnalytics = ['email', email, person.name.toLowerCase(), 'birthdate', 'birthtime', 'latitude', 'longitude'];
  for (const { body } of rcEvents) {
    const lower = body.toLowerCase();
    for (const needle of forbiddenInAnalytics) {
      expect(lower.includes(needle.toLowerCase()), `RC analytics payload leaked "${needle}": ${body}`).toBe(false);
    }
  }
});
