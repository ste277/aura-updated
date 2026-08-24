import { test, expect } from '@playwright/test';
import { listPlans } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1.1 -- the magic-link-CLICK restore
 * path specifically (as opposed to the same-tab code-entry path already
 * covered by recipientConversionJourney.spec.ts). This is the path that
 * actually exercises GUEST_RESULT_RESTORED: a guest picks a result, starts
 * signup, then opens the emailed link -- in this same tab (the real click
 * always lands wherever the recipient's mail client opens it, which
 * Playwright can't drive across apps, but the server-side behavior --
 * restoring guest state from `?restore=<token>` after the link
 * authenticates -- is identical regardless of which tab clicks it).
 */

test('magic-link click restores guest state, fires GUEST_RESULT_RESTORED, and saves exactly one Plan', async ({ page }) => {
  await page.goto('/find');
  await expect(page.getByText('What are you planning?')).toBeVisible();
  await page.getByRole('button', { name: /Date Night/i }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Find my moment' }).click();
  await expect(page.getByText('Your best moment')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Save this moment' }).click();

  const email = `e2e-rc-magiclink-${Date.now()}@e2e.aura.local`;
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await expect(page.getByText('We emailed you a sign-in link')).toBeVisible({ timeout: 10000 });

  const devLoginLink = page.locator('a[href*="/api/auth/verify"]');
  const href = await devLoginLink.getAttribute('href');
  expect(href).toBeTruthy();

  const trackedEvents: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/api/product-events')) {
      const eventName = (JSON.parse(req.postData() || '{}').eventName as string) ?? '';
      trackedEvents.push(eventName);
    }
  });

  // The magic-link click itself: verifies auth AND carries the guest
  // state token forward (see request-link/route.ts's &guest= embedding).
  await page.goto(href!);
  // request-link embeds `&guest=<token>` in the verify URL; the verify
  // route redirects to /find?restore=<token> for a guest-originated link.
  await expect(page).toHaveURL(/\/find\?restore=/);
  await expect(page.getByText('Your best moment')).toBeVisible({ timeout: 15000 });

  await expect(async () => {
    expect(trackedEvents).toContain('GUEST_RESULT_RESTORED');
  }).toPass({ timeout: 5000 });

  await page.getByRole('button', { name: 'Save this moment' }).click();
  await expect(page.getByText(/is saved$/)).toBeVisible({ timeout: 15000 });

  const plans = await listPlans(page);
  const dateNightPlans = plans.filter((p: any) => p.title.toLowerCase().includes('date night'));
  expect(dateNightPlans.length).toBe(1);
});
