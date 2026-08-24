import { test as base, expect } from '@playwright/test';
import { test as authedTest, expect as authedExpect } from '../fixtures/testUser';
import { createSavedPerson, createSharedMoment } from '../fixtures/testData';
import { signInNewUser } from '../fixtures/testUser';

/**
 * Product Journey / E2E Hardening V1.1 -- sections 21-22: a responsive
 * smoke pass at 375px and an accessibility smoke pass for the two new
 * journeys. Not a broad screenshot suite or a WCAG audit -- targeted
 * checks on the critical controls the brief names.
 */

base('Recipient Conversion at 375px: no overflow, guest wizard and auth handoff controls reachable', async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signInNewUser(ownerPage, { emailLabel: 'rc-smoke-owner' });
  const person = await createSavedPerson(ownerPage, { name: 'Reena', relationshipType: 'PARTNER' });
  const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const moment = await createSharedMoment(ownerPage, { savedPersonId: person.id, activityId: 'date-night', startIso: start.toISOString(), endIso: new Date(start.getTime() + 90 * 60000).toISOString() });
  await ownerContext.close();

  await page.goto(moment.shareUrl);
  await expect(page.getByRole('button', { name: /I'm in/ })).toBeVisible();
  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, 'horizontal overflow on the public Moment page').toBe(false);

  await page.getByRole('button', { name: /I'm in/ }).click();
  await expect(page.getByRole('link', { name: /Find your own moment/ }).first()).toBeVisible({ timeout: 10000 });
  await page.getByRole('link', { name: /Find your own moment/ }).first().click();

  await expect(page.getByText('What are you planning?')).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, 'horizontal overflow on the guest activity picker').toBe(false);

  await page.getByRole('button', { name: /Coffee \/ Tea/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Find my moment' }).click();
  await expect(page.getByText('Your best moment')).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Save this moment' })).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, 'horizontal overflow on the guest result screen').toBe(false);

  await page.getByRole('button', { name: 'Save this moment' }).click();
  await expect(page.getByRole('button', { name: 'Continue with email' })).toBeVisible();
  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow, 'horizontal overflow on the auth handoff screen').toBe(false);
});

authedTest('Ask Aura -> Plan at 375px: no overflow, input and result actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/?tab=ask');
  await authedExpect(page.getByPlaceholder('Ask Aura anything...')).toBeVisible();

  let overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  authedExpect(overflow, 'horizontal overflow on the Ask Aura empty state').toBe(false);

  await page.getByPlaceholder('Ask Aura anything...').fill('When should I work out tomorrow?');
  await page.getByRole('button', { name: 'Send message' }).click();
  await authedExpect(page.getByText(/I'd choose/)).toBeVisible({ timeout: 15000 });
  await authedExpect(page.getByRole('button', { name: 'Plan this' }).first()).toBeVisible();

  overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  authedExpect(overflow, 'horizontal overflow on an Ask Aura result').toBe(false);
});

authedTest('accessibility smoke: critical Recipient Conversion + Ask Aura controls have accessible names', async ({ page, browser }) => {
  // Ask Aura controls (authenticated session already provided by the fixture).
  await page.goto('/?tab=ask');
  await authedExpect(page.getByPlaceholder('Ask Aura anything...')).toBeVisible();
  const sendButton = page.getByRole('button', { name: 'Send message' });
  authedExpect(await sendButton.getAttribute('aria-label')).toBe('Send message');
  await authedExpect(sendButton).toBeVisible();

  await page.getByPlaceholder('Ask Aura anything...').fill('When should I work out tomorrow?');
  await sendButton.click();
  await authedExpect(page.getByText(/I'd choose/)).toBeVisible({ timeout: 15000 });
  const planThis = page.getByRole('button', { name: 'Plan this' }).first();
  authedExpect(await planThis.evaluate((el) => el.tagName)).toBe('BUTTON');

  // Keyboard focus reaches the Ask input.
  await page.getByPlaceholder('Ask Aura anything...').focus();
  authedExpect(await page.evaluate(() => document.activeElement?.getAttribute('placeholder'))).toBe('Ask Aura anything...');

  // Recipient Conversion controls: a fresh logged-out context.
  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  const person = await createSavedPerson(page, { name: 'Anu', relationshipType: 'PARTNER' });
  const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const moment = await createSharedMoment(page, { savedPersonId: person.id, activityId: 'date-night', startIso: start.toISOString(), endIso: new Date(start.getTime() + 90 * 60000).toISOString() });

  await guestPage.goto(moment.shareUrl);
  const imIn = guestPage.getByRole('button', { name: /I'm in/ });
  authedExpect(await imIn.evaluate((el) => el.tagName)).toBe('BUTTON');
  await imIn.click();

  const findYourOwn = guestPage.getByRole('link', { name: /Find your own moment/ }).first();
  authedExpect(await findYourOwn.evaluate((el) => el.tagName)).toBe('A');
  await findYourOwn.click();

  await guestPage.getByRole('button', { name: /Coffee \/ Tea/ }).click();
  await guestPage.getByRole('button', { name: 'Continue' }).click();
  await guestPage.getByRole('button', { name: 'Find my moment' }).click();
  await authedExpect(guestPage.getByText('Your best moment')).toBeVisible({ timeout: 15000 });
  const saveThisMoment = guestPage.getByRole('button', { name: 'Save this moment' });
  authedExpect(await saveThisMoment.evaluate((el) => el.tagName)).toBe('BUTTON');

  await saveThisMoment.click();
  await authedExpect(guestPage.getByRole('button', { name: 'Continue with email' })).toBeVisible();

  await guestContext.close();
});
