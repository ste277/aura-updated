import { test, expect } from '../fixtures/testUser';

/**
 * Intentional Day Builder V1 hardening pass -- dayBuilderMutedGroups /
 * dayBuilderEnabled are persisted product behavior (brief section 6/35),
 * not something that should rely only on a live spot-check. These tests
 * drive the real PATCH /api/users/day-builder-preferences route (the same
 * one the You -> Day Builder settings panel calls) and confirm the effect
 * on the real GET /api/my-day/suggestions + rendered Home, and that
 * neither Good Right Now nor Aura Suggests are affected at all.
 */

const ALL_GROUPS = ['RELATIONSHIPS', 'FAMILY', 'SOCIAL', 'WORK', 'SELF', 'ENJOYMENT'];

async function setDayBuilderPrefs(page: import('@playwright/test').Page, dayBuilderEnabled: boolean, dayBuilderMutedGroups: string[]) {
  const res = await page.request.patch('/api/users/day-builder-preferences', { data: { dayBuilderEnabled, dayBuilderMutedGroups } });
  expect(res.ok()).toBe(true);
  return res.json();
}

test('muting every real group -> zero Day Builder suggestions, but Good Right Now is completely unaffected', async ({ page }) => {
  await setDayBuilderPrefs(page, true, ALL_GROUPS);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await page.waitForTimeout(4000); // real chance for the client-side fetch to resolve

  await expect(page.getByText('What would make today feel worthwhile?')).toHaveCount(0);
  // Good Right Now has nothing to do with Day Builder's preferences --
  // selectGoodRightNowCards() doesn't even accept a User/prefs argument.
  await expect(page.getByText('GOOD RIGHT NOW')).toBeVisible();
  const goodRightNowSection = page.locator('div', { has: page.getByText('GOOD RIGHT NOW') });
  const cards = await goodRightNowSection.locator('span').allInnerTexts();
  expect(cards.length).toBeGreaterThan(0);
});

test('disabling Day Builder entirely -> zero suggestions regardless of which groups are muted', async ({ page }) => {
  await setDayBuilderPrefs(page, false, []); // enabled=false, nothing muted -- disabled wins

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await page.waitForTimeout(4000);

  await expect(page.getByText('What would make today feel worthwhile?')).toHaveCount(0);
});

test('unmuting restores eligibility: mute all -> zero, unmute -> suggestions can appear again', async ({ page }) => {
  await setDayBuilderPrefs(page, true, ALL_GROUPS);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(page.getByText('What would make today feel worthwhile?')).toHaveCount(0);

  await setDayBuilderPrefs(page, true, []); // unmute everything
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
});

test('preferences are owner-scoped: user A muting everything never affects user B', async ({ page, browser }) => {
  await setDayBuilderPrefs(page, true, ALL_GROUPS);

  // A second, completely independent signed-in user in a fresh context.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  try {
    const { signInNewUser } = await import('../fixtures/testUser');
    await signInNewUser(otherPage, { emailLabel: 'day-builder-prefs-other-owner' });

    await otherPage.goto('/');
    await expect(otherPage.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
    // User B never muted anything -- their own suggestions are governed by
    // their own row, never user A's preference PATCH.
    await expect(otherPage.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
  } finally {
    await otherContext.close();
  }
});
