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

  // Moment View Navigation Fix -- "View invitation" is the separate,
  // explicit action that still opens the public /moment/[token] page in a
  // new tab; it does not navigate this tab away from Home, so the card
  // stays available for the "View details" step below.
  const whatsNextSection = page.locator('section', { hasText: "What's Next" });
  const [invitationPopup] = await Promise.all([
    context.waitForEvent('page'),
    whatsNextSection.getByRole('button', { name: 'View invitation', exact: true }).click(),
  ]);
  await expect(invitationPopup.getByText(/confirmed|in!|you're in/i).first()).toBeVisible({ timeout: 10000 });
  await invitationPopup.close();

  // The main "View details" CTA routes in-app to the owner's own Plan/
  // Moment details (the Plan tab) -- no new tab, exactly like a Planned
  // Activity reminder's "Open Plan" (see reminderJourney.spec.ts). This is
  // the actual fix: it must NEVER open the recipient-facing invitation
  // page as the default destination. Opening it still marks the update
  // seen -- Bell count decreases correctly, same as before this fix.
  await whatsNextSection.getByRole('button', { name: 'View details', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Plan with Aura' })).toBeVisible();

  await expect(async () => {
    const seenUpdates = await fetchAuraUpdates(page);
    expect(seenUpdates.unreadCount).toBeLessThan(afterUpdates.unreadCount);
  }).toPass({ timeout: 10000 });
});
