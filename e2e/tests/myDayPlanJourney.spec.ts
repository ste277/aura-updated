import { test, expect } from '../fixtures/testUser';
import { fetchMyDay, listPlans } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required test A: My Day -> Add
 * Plan -> Home agenda. The actual product loop: open Home, use the
 * "What would make today feel well spent?" intention flow (Work -> Deep
 * work), run the real timing search, save the returned candidate, and
 * confirm the resulting Plan shows up in Your Day exactly once with no
 * duplicate.
 */

test('My Day -> Add a Plan (Deep Work) -> it appears once in Your Day', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();

  const before = await listPlans(page);
  expect(before.length).toBe(0);

  await page.getByText('What would make today feel well spent?').click();
  await page.getByRole('button', { name: 'Get something important done' }).click();
  // Scoped to the intention-flow section -- "Deep work" is also one of
  // Home's separate "Popular" prompt chips elsewhere on the page.
  const activityStep = page.locator('section').filter({ hasText: 'What sounds good?' });
  await activityStep.getByRole('button', { name: /Deep work/ }).click();

  // The inline search runs against the real /api/timing-search endpoint --
  // wait for a result (or the honest no-result/error state) rather than a
  // fixed sleep.
  await expect(page.getByText('Best time today')).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Add to my day' }).click();
  await expect(page.getByText('Added to your day')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Done' }).click();

  const after = await listPlans(page);
  expect(after.length).toBe(1);
  expect(after[0].title.toLowerCase()).toContain('deep work');

  // The agenda (canonical source for Your Day) shows the Plan exactly
  // once, in chronological order (trivially true with one item, but
  // asserts the shape rather than assuming it).
  const myDay = await fetchMyDay(page);
  const matching = myDay.agenda.items.filter((item: any) => item.type === 'PLAN' && item.title.toLowerCase().includes('deep work'));
  expect(matching.length).toBe(1);

  // The same Plan is visible in the actual Your Day UI, not just the API.
  await page.reload();
  const yourDaySection = page.locator('section', { has: page.getByRole('heading', { name: 'Your Day', exact: true }) });
  await expect(yourDaySection.getByText(/Deep Work/i)).toBeVisible();
});
