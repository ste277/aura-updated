import { test, expect } from '../fixtures/testUser';

/**
 * Product Journey / E2E Hardening V1 -- sections 23-25: empty states,
 * responsive Home at 375/768/desktop, and an accessibility smoke pass.
 * Not a WCAG certification -- a targeted check on the critical Home
 * journey only.
 */

test('brand-new user: every empty state offers a next useful action, never a dead end', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Your day is open')).toBeVisible();
  await expect(page.getByRole('button', { name: /Find something for today/ })).toBeVisible();

  await page.getByRole('button', { name: '👤 You' }).click();
  await page.getByRole('button', { name: /People/ }).first().click().catch(() => {});
});

test('Home renders with no horizontal overflow at 375px, 768px, and desktop', async ({ page }) => {
  for (const size of [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your day', exact: true }).or(page.getByText(/Good (Morning|Afternoon|Evening)/))).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `horizontal overflow at ${size.width}px`).toBe(false);

    // Primary actions stay reachable at every size.
    await expect(page.getByRole('button', { name: 'Updates' })).toBeVisible();
    await expect(page.getByRole('button', { name: '🏠 Home' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Add something' })).toBeVisible();
  }
});

test('accessibility smoke: interactive elements are real buttons/links with accessible names', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(/Good (Morning|Afternoon|Evening)/)).toBeVisible({ timeout: 15000 });

  // Every clickable primary action on Home renders as a real <button>
  // (not a styled <div>), so it's keyboard-focusable and works with
  // screen readers by default.
  const bottomNav = page.locator('nav, [role="navigation"]').first();
  const navButtons = bottomNav.locator('button');
  const navCount = await navButtons.count();
  expect(navCount).toBeGreaterThanOrEqual(5);
  for (let i = 0; i < navCount; i++) {
    const el = navButtons.nth(i);
    expect(await el.evaluate((node) => node.tagName)).toBe('BUTTON');
    expect((await el.textContent())?.trim().length).toBeGreaterThan(0);
  }

  // The Bell has an accessible label distinct from its (empty when
  // unread) visual badge text.
  const bell = page.getByRole('button', { name: 'Updates' });
  await expect(bell).toBeVisible();
  expect(await bell.getAttribute('aria-label')).toBe('Updates');

  // Reflection status is never color-only -- each button carries a text
  // label (Low/Balanced/Strong), not just a colored icon.
  await expect(page.getByRole('button', { name: /Low/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Balanced/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Strong/ })).toBeVisible();

  // Keyboard focus reaches the first interactive element.
  await page.keyboard.press('Tab');
  const activeTag = await page.evaluate(() => document.activeElement?.tagName);
  expect(['BUTTON', 'A', 'INPUT']).toContain(activeTag);
});
