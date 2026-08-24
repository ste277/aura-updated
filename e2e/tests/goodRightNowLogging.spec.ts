import { test, expect } from '../fixtures/testUser';
import { findNeutralInstant } from '../fixtures/panchangWindows';
import { listHabitLogs } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required test D: Good Right Now
 * INSTANT/FIXED/USER_SELECTED logging, plus the rapid/double-click
 * regression. Frozen to today's real NEUTRAL Panchang gap (via
 * page.clock, see fixtures/panchangWindows.ts) so all three durationMode
 * cards are simultaneously present (packages/recommendation/src/
 * actionCards.ts's NEUTRAL set: Hydration check=INSTANT, Short walk or
 * stretch=FIXED, Regular work block=USER_SELECTED).
 */

test.beforeEach(async ({ page, testUser }) => {
  const neutralInstant = findNeutralInstant(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: neutralInstant });
  await page.clock.resume();
});

test('INSTANT (Hydration check): one click creates exactly one HabitLog with duration 0, UI says Completed not "0 min"', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('div', { has: page.getByText('Hydration check', { exact: true }) }).first();
  await card.getByRole('button', { name: /Log now/ }).click();
  await expect(page.getByText(/Logged at/)).toBeVisible({ timeout: 10000 });

  // "Completed", never a literal "0 min" -- formatActivityDuration's own
  // rule for an INSTANT log.
  await expect(page.getByText('0 min')).toHaveCount(0);

  const logs = await listHabitLogs(page);
  const matching = logs.filter((l: any) => l.activityTitle === 'Active Rest & Hydration Check');
  expect(matching.length).toBe(1);
  expect(matching[0].durationMinutes).toBe(0);
});

test('FIXED (Short walk or stretch): one click creates exactly one HabitLog with the catalog duration preserved', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('div', { has: page.getByText('Short walk or stretch', { exact: true }) }).first();
  await card.getByRole('button', { name: /Do now/ }).click();
  await expect(page.getByText(/Logged at/)).toBeVisible({ timeout: 10000 });

  const logs = await listHabitLogs(page);
  const matching = logs.filter((l: any) => l.activityTitle === 'Light Stretch & Mobility');
  expect(matching.length).toBe(1);
  expect(matching[0].durationMinutes).toBe(10); // task-7's catalog defaultDurationMinutes
});

test('USER_SELECTED (Regular work block): duration picker -> 60 minutes creates exactly one 60-minute HabitLog', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('div', { has: page.getByText('Regular work block', { exact: true }) }).first();
  await card.getByRole('button', { name: /Start now/ }).click();
  await card.getByRole('button', { name: 'Start now for 60 minutes' }).click();
  await expect(page.getByText(/Logged at/)).toBeVisible({ timeout: 10000 });

  const logs = await listHabitLogs(page);
  const matching = logs.filter((l: any) => l.activityTitle === 'Deep Work');
  expect(matching.length).toBe(1);
  expect(matching[0].durationMinutes).toBe(60);
});

test('USER_SELECTED (Regular work block): cancel creates nothing', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('div', { has: page.getByText('Regular work block', { exact: true }) }).first();
  await card.getByRole('button', { name: /Start now/ }).click();
  await card.getByRole('button', { name: 'Cancel' }).click();

  const logs = await listHabitLogs(page);
  expect(logs.filter((l: any) => l.activityTitle === 'Deep Work').length).toBe(0);
});

test('rapid double-click on INSTANT logging still creates exactly one HabitLog', async ({ page }) => {
  await page.goto('/');
  const card = page.locator('div', { has: page.getByText('Hydration check', { exact: true }) }).first();
  const button = card.getByRole('button', { name: /Log now/ });
  // Two click EVENTS dispatched back to back in the same tick, bypassing
  // Playwright's own actionability wait/retry (which would otherwise race
  // against the button's own disabled-state transition and flake) -- this
  // is the exact regression scenario the loggingRef guard exists for: two
  // synchronous handlers both reading the same stale pre-flush state.
  await button.dispatchEvent('click');
  await button.dispatchEvent('click').catch(() => {});
  await expect(page.getByText(/Logged at/)).toBeVisible({ timeout: 10000 });

  const logs = await listHabitLogs(page);
  const matching = logs.filter((l: any) => l.activityTitle === 'Active Rest & Hydration Check');
  expect(matching.length).toBe(1);
});
