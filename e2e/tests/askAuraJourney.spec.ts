import { test, expect } from '../fixtures/testUser';
import { createSavedPerson } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1.1 -- required Journey B: Ask Aura
 * cross-feature handoffs. One authenticated session, one Ask Aura
 * conversation, exercising CHECK / FIND+Plan / SHARED+Moment / Panchang /
 * Muhurtham / casual-vs-Muhurtham routing / follow-up / Why / Unknown --
 * through real browser interaction against the real /api/ask-aura route.
 */

async function askAura(page: import('@playwright/test').Page, prompt: string) {
  await page.getByPlaceholder('Ask Aura anything...').fill(prompt);
  await page.getByRole('button', { name: 'Send message' }).click();
}

test('Ask Aura: CHECK, FIND -> Plan, SHARED -> Moment, Panchang, Muhurtham, casual routing, follow-up, Why, Unknown', async ({ page }) => {
  await createSavedPerson(page, { name: 'Anna', relationshipType: 'FRIEND' });

  const planRequests: string[] = [];
  const momentRequests: string[] = [];
  const slotTaskRequests: string[] = [];
  page.on('request', (req) => {
    if (req.method() !== 'POST') return;
    if (req.url().includes('/api/plans')) planRequests.push(req.url());
    if (req.url().includes('/api/aura-moments')) momentRequests.push(req.url());
    if (req.url().includes('/api/daily-assistant/slot-task')) slotTaskRequests.push(req.url());
  });

  await page.goto('/?tab=ask');
  await expect(page.getByPlaceholder('Ask Aura anything...')).toBeVisible();

  // ---- CHECK ----
  await askAura(page, 'Can I work out now?');
  const auraBubbles = page.locator('div').filter({ hasText: /You can\.|I'd hold off for now\./ });
  await expect(auraBubbles.first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Plan this' }).first()).toBeVisible();

  // ---- FIND -> Plan ----
  await askAura(page, 'When should I work out tomorrow?');
  await expect(page.getByText(/I'd choose/)).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: 'Plan this' }).last().click();
  await expect(page.getByRole('button', { name: 'Done ✓' }).first()).toBeVisible({ timeout: 10000 });

  // ---- SHARED -> Moment ----
  await askAura(page, 'Find a time for a dinner date with Anna');
  await expect(page.getByText(/Best for you both|couldn't find a strong shared time/)).toBeVisible({ timeout: 15000 });
  const makeAMoment = page.getByRole('button', { name: 'Make this a Moment' });
  if (await makeAMoment.count() > 0) {
    await makeAMoment.first().click();
    await expect(page.getByRole('button', { name: 'Done ✓' }).last()).toBeVisible({ timeout: 10000 });
  }

  // ---- Panchang ----
  await askAura(page, 'When is Rahu Kalam tomorrow?');
  await expect(page.getByText(/Rahu Kalam:/)).toBeVisible({ timeout: 15000 });
  // Only the relevant window, not a full Tithi/Nakshatra/Yoga/Karana dump.
  await expect(page.getByText(/Nakshatra:/)).toHaveCount(0);

  // ---- Muhurtham ----
  await askAura(page, 'Good dates for Griha Pravesh next month');
  await expect(page.getByText(/Best dates for Griha Pravesh|couldn't find a strong Muhurtham/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Open Muhurtham Finder' }).first()).toBeVisible();

  // ---- Casual-vs-Muhurtham regression ----
  await askAura(page, 'Best time for coffee tomorrow');
  await expect(page.getByText(/I'd choose/)).toBeVisible({ timeout: 15000 });
  // The Timing Search path was used, NOT Muhurtham Finder -- no
  // MUHURTHAM_RESULTS-style "Open Muhurtham Finder" button on THIS turn.
  const lastBubble = page.locator('div').filter({ hasText: "I'd choose" }).last();
  await expect(lastBubble.locator('..').getByRole('button', { name: 'Open Muhurtham Finder' })).toHaveCount(0);

  // ---- Follow-up context ----
  await askAura(page, 'When should I work out tomorrow?');
  await expect(page.getByText(/I'd choose/).last()).toBeVisible({ timeout: 15000 });
  await askAura(page, 'What about morning?');
  await expect(page.getByText(/I'd choose/).last()).toBeVisible({ timeout: 15000 });

  // ---- Why ----
  await askAura(page, 'Why?');
  await expect(page.getByText(/reasons on the last result/)).toBeVisible({ timeout: 15000 });

  // ---- Unknown ----
  await askAura(page, 'asdkjqwoe blorp zzzz');
  await expect(page.getByText(/not sure what you'd like to time/)).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Find a time' })).toBeVisible();

  // ---- Network route assertions ----
  expect(planRequests.length).toBeGreaterThan(0);
  expect(slotTaskRequests.length).toBe(0);
});
