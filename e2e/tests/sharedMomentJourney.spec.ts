import { test, expect } from '../fixtures/testUser';
import { createSavedPerson, createSharedMoment, fetchMyDay, fetchAuraUpdates } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required test B: shared Moment
 * journey. Owner creates a shared Moment; a SEPARATE, unauthenticated
 * browser context (the recipient, via the real public /moment/[token]
 * page) accepts it; back in the owner's session, verifies the Aura
 * Update appears, the Bell unread count increases, Your Day reflects
 * CONFIRMED, and opening the update marks it seen (Bell count decreases).
 */

test('shared Moment: recipient accepts -> owner sees the update, Bell count, and CONFIRMED agenda', async ({ page, context, browser }) => {
  const person = await createSavedPerson(page, { name: 'Anu', relationshipType: 'PARTNER' });
  const start = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const moment = await createSharedMoment(page, { savedPersonId: person.id, activityId: 'date-night', startIso: start.toISOString(), endIso: end.toISOString() });

  // Owner's own agenda shows it exactly once, WAITING, before any response.
  const beforeMyDay = await fetchMyDay(page);
  const beforeItems = beforeMyDay.agenda.items.filter((i: any) => i.type === 'MOMENT');
  expect(beforeItems.length).toBe(1);
  expect(beforeItems[0].status).toBe('WAITING');

  const beforeUpdates = await fetchAuraUpdates(page);
  const unreadBefore = beforeUpdates.unreadCount;

  // ---- Recipient: a genuinely separate, unauthenticated browser context
  // (no shared cookies with the owner) opens the real public Moment page
  // and accepts. ----
  const recipientContext = await browser.newContext();
  const recipientPage = await recipientContext.newPage();
  await recipientPage.goto(moment.shareUrl);
  await recipientPage.getByRole('button', { name: /I'm in/ }).click();
  await expect(recipientPage.getByText(/confirmed|in!|you're in/i).first()).toBeVisible({ timeout: 10000 });
  await recipientContext.close();

  // ---- Owner: Aura Update appears, Bell unread count increased ----
  const afterUpdates = await fetchAuraUpdates(page);
  expect(afterUpdates.unreadCount).toBeGreaterThan(unreadBefore);
  expect(afterUpdates.updates.some((u: any) => u.type === 'MOMENT_ACCEPTED' && u.momentToken === moment.shareUrl.split('/').pop())).toBe(true);

  // Your Day reflects CONFIRMED, still exactly one row for this Moment.
  const afterMyDay = await fetchMyDay(page);
  const afterItems = afterMyDay.agenda.items.filter((i: any) => i.type === 'MOMENT');
  expect(afterItems.length).toBe(1);
  expect(afterItems[0].status).toBe('CONFIRMED');

  await page.goto('/');
  await expect(page.getByText(/is in/i)).toBeVisible({ timeout: 10000 });

  // Opening the update marks it seen -- Bell count decreases correctly.
  const whatsNextSection = page.locator('section', { hasText: "What's Next" });
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    whatsNextSection.getByRole('button', { name: 'View' }).first().click(),
  ]);
  await popup.close();

  await expect(async () => {
    const seenUpdates = await fetchAuraUpdates(page);
    expect(seenUpdates.unreadCount).toBeLessThan(afterUpdates.unreadCount);
  }).toPass({ timeout: 10000 });
});
