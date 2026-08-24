import { test, expect } from '../fixtures/testUser';
import { createPlan, fetchAuraUpdates } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required test C: a reminder
 * becomes active -> Bell reflects it -> opening it marks it seen. Uses the
 * existing 15-minute default lead window (never recalculated here) by
 * creating a Plan starting 10 minutes out.
 */

test('a Starting Soon reminder surfaces on Home and in the Bell, and opening it marks it seen', async ({ page }) => {
  const start = new Date(Date.now() + 10 * 60 * 1000);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  await createPlan(page, { title: 'Deep Work', icon: '💼', startIso: start.toISOString(), endIso: end.toISOString() });

  const before = await fetchAuraUpdates(page);
  expect(before.upcoming.length).toBe(1);
  expect(before.upcoming[0].unread).toBe(true);
  const unreadBefore = before.unreadCount;

  await page.goto('/');
  await expect(page.getByText('Starts in')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Deep Work')).toBeVisible();

  // A PLANNED_ACTIVITY reminder routes in-app to the Plan tab (no new
  // tab) -- only a MOMENT reminder opens a popup.
  await page.getByRole('button', { name: 'Open Plan' }).click();
  await expect(page.getByRole('heading', { name: 'Plan with Aura' })).toBeVisible();

  await expect(async () => {
    const after = await fetchAuraUpdates(page);
    expect(after.unreadCount).toBeLessThan(unreadBefore);
    expect(after.upcoming[0].unread).toBe(false);
    // Still contextually visible (seen != no longer relevant) -- the
    // reminder itself remains in `upcoming` until its own grace period.
    expect(after.upcoming.length).toBe(1);
  }).toPass({ timeout: 10000 });
});
