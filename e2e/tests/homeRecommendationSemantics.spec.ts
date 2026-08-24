import { test, expect } from '../fixtures/testUser';
import { findNeutralInstant, findInstantBeforeRahuKalam } from '../fixtures/panchangWindows';

/**
 * Product Journey / E2E Hardening V1 -- required tests J and K:
 *   J. Good Right Now activity != duplicate Aura Suggests activity
 *   K. A caution/low-quality candidate is never presented as "Next Best Moment"
 */

test('J: Aura Suggests never repeats the exact canonical activity already shown in Good Right Now', async ({ page, testUser }) => {
  const neutralInstant = findNeutralInstant(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: neutralInstant });
  await page.clock.resume();
  await page.goto('/');

  await expect(page.getByText('GOOD RIGHT NOW')).toBeVisible();
  const goodRightNowSection = page.locator('div', { has: page.getByText('GOOD RIGHT NOW') });
  const goodRightNowTitles = await goodRightNowSection.locator('span').allInnerTexts();

  const auraSuggestsHeading = page.getByText('✨ Aura Suggests');
  if (await auraSuggestsHeading.count() === 0) {
    // Hidden entirely -- an explicitly acceptable outcome (brief section 16:
    // "preferable to duplication"). Nothing further to assert.
    return;
  }
  const auraSuggestsSection = page.locator('div', { has: auraSuggestsHeading });
  const auraSuggestsTitle = await auraSuggestsSection.getByRole('heading').first().innerText();

  expect(goodRightNowTitles.some((t) => t.trim() === auraSuggestsTitle.trim())).toBe(false);
});

test('K: a caution-quality upcoming window is never labeled "Next Best Moment"', async ({ page, testUser }) => {
  const beforeRahu = findInstantBeforeRahuKalam(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: beforeRahu });
  await page.clock.resume();
  await page.goto('/');

  // Sanity check: the upcoming window really is Rahu Kalam (caution).
  await expect(page.getByText(/Rahu Kalam/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('⭐ Next Best Moment')).toHaveCount(0);
  await expect(page.getByText('🕐 Coming Up')).toBeVisible();
});
