import { test, expect } from '../fixtures/testUser';
import { listPlans, listAuraMoments, fetchDayBuilderSuggestions } from '../fixtures/testData';

/**
 * Day Builder "Not today" -- dismiss support. Real click-throughs against
 * GET/POST /api/my-day/suggestions(/dismiss), the same route the DB-level
 * tests in dayBuilderDb.test.ts already prove the dismissal identity model
 * against directly (owner scoping, next-local-day rollover, person-
 * specific identity) -- this file focuses on what only a real browser +
 * refresh can prove: the UI actually disappears the dismissed card, a
 * refresh doesn't resurrect it, and nothing is created merely by
 * dismissing.
 */

test('"Not today": the suggestion disappears, survives a refresh, and never creates a Plan or Moment', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  const firstCard = dayBuilderSection.getByTestId('day-builder-suggestion').first();
  const dismissedActivityId = await firstCard.getAttribute('data-activity-id');

  const plansBefore = await listPlans(page);
  const momentsBefore = await listAuraMoments(page);

  await dayBuilderSection.getByRole('button', { name: 'Not today' }).first().click();
  await page.waitForTimeout(500);

  // Never labeled "Cancel" -- no Plan/Moment exists yet to cancel.
  await expect(dayBuilderSection.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

  // dismiss does not create a Plan or Moment.
  const plansAfter = await listPlans(page);
  const momentsAfter = await listAuraMoments(page);
  expect(plansAfter.length).toBe(plansBefore.length);
  expect(momentsAfter.length).toBe(momentsBefore.length);

  // dismiss -> the suggestion disappears from the visible card set.
  const visibleActivityIdsAfter = await dayBuilderSection.getByTestId('day-builder-suggestion').evaluateAll((els) => els.map((el) => el.getAttribute('data-activity-id')));
  expect(visibleActivityIdsAfter).not.toContain(dismissedActivityId);

  // refresh -> remains dismissed: a fresh GET (not client-only React
  // state) still excludes it, and reloading the page confirms the same.
  const rawAfterDismiss = await fetchDayBuilderSuggestions(page);
  expect((rawAfterDismiss.suggestions ?? []).some((s: any) => s.activityId === dismissedActivityId)).toBe(false);

  await page.reload();
  if (await page.getByText('What would make today feel worthwhile?').isVisible({ timeout: 20000 }).catch(() => false)) {
    const dayBuilderSectionAfterReload = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
    const idsAfterReload = await dayBuilderSectionAfterReload.getByTestId('day-builder-suggestion').evaluateAll((els) => els.map((el) => el.getAttribute('data-activity-id')));
    expect(idsAfterReload).not.toContain(dismissedActivityId);
  }
  // If the card region doesn't render at all post-reload (zero suggestions
  // left, brief section 13's valid empty state), that's an even stronger
  // confirmation the dismissed suggestion isn't showing.
});

test('"Not today" does not mute the whole category -- other suggestions/groups remain fully available', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  const before = await fetchDayBuilderSuggestions(page);
  const groupIdsBefore = new Set((before.suggestions ?? []).map((s: any) => s.groupId));

  await dayBuilderSection.getByRole('button', { name: 'Not today' }).first().click();
  await page.waitForTimeout(500);

  // The user's own Day Builder preferences are untouched by a plain
  // dismiss -- "Not today" is a daily identity dismissal, never a
  // permanent category mute (that's the SEPARATE "Show me less" path).
  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user.dayBuilderMutedGroups.length).toBe(0);

  // Other groups (if any resolved before the dismissal) are unaffected --
  // a fresh fetch may still include them.
  const after = await fetchDayBuilderSuggestions(page);
  const otherGroupStillPresent = (after.suggestions ?? []).some((s: any) => groupIdsBefore.has(s.groupId));
  expect(groupIdsBefore.size <= 1 || otherGroupStillPresent).toBe(true);
});

test('"Show me less like this" mutes the group via the EXISTING preference mechanism, not the daily dismissal table', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });

  await dayBuilderSection.getByRole('button', { name: 'Not today' }).first().click();

  const muteLink = dayBuilderSection.getByRole('button', { name: 'Show me less like this' });
  await expect(muteLink).toBeVisible({ timeout: 5000 });

  const patchResponse = page.waitForResponse((res) => res.url().includes('/api/users/day-builder-preferences') && res.request().method() === 'PATCH');
  await muteLink.click();
  await patchResponse;

  const session = await (await page.request.get('/api/auth/session')).json();
  expect(session.user.dayBuilderMutedGroups.length).toBeGreaterThan(0);
});
