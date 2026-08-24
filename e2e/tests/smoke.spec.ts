import { test, expect } from '../fixtures/testUser';

test('a fresh test user can sign in and see Home', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Good (Morning|Afternoon|Evening)/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
});
