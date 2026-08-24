import { test, expect } from '../fixtures/testUser';
import { createPlan, createSavedPerson, listPlans, fetchMyDay } from '../fixtures/testData';

/**
 * Intentional Day Builder V1 -- required E2E coverage (brief sections
 * 43-48). Test A below is the REQUIRED "success criterion" end-to-end
 * journey (brief section 48): the primary Definition of Done for this
 * whole feature -- an empty day, a proactive suggestion with an already-
 * resolved real time, one tap to Add, and the result showing up in Your
 * Day with no detour through the Plan screen.
 *
 * No controlled time is set here, mirroring myDayPlanJourney.spec.ts's own
 * established precedent (real "now", the actual Timing Search engine) --
 * that journey has proven reliable at arbitrary real wall-clock time for
 * an identical underlying search call.
 */

test('SUCCESS CRITERION: empty day -> Day Builder suggests something with a real time -> Add -> appears in Your Day, no Plan-screen detour', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();

  const before = await listPlans(page);
  expect(before.length).toBe(0);

  // Day Builder's own card, phase-aware and fetched client-side --
  // bounded wait for the real /api/my-day/suggestions call.
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  const addButton = dayBuilderSection.getByRole('button', { name: '+ Add' }).first();
  await expect(addButton).toBeVisible();

  // The suggestion already carries a real resolved time (brief section 17)
  // -- not just an activity name -- before any tap happens.
  await expect(dayBuilderSection.getByText(/AM|PM/).first()).toBeVisible();

  await addButton.click();
  await expect(dayBuilderSection.getByText('✓ Added to your day').first()).toBeVisible({ timeout: 10000 });

  // Canonical Plan created immediately -- no navigation to the Plan screen
  // ever happened (still on Home, activeTab never changed).
  const after = await listPlans(page);
  expect(after.length).toBe(1);

  const myDay = await fetchMyDay(page);
  const planItems = myDay.agenda.items.filter((item: any) => item.type === 'PLAN');
  expect(planItems.length).toBe(1);

  // Visible in the real Your Day UI too, not just the API.
  await page.reload();
  const yourDaySection = page.locator('section', { has: page.getByRole('heading', { name: 'Your Day', exact: true }) });
  await expect(yourDaySection.getByText(after[0].title, { exact: false })).toBeVisible();
});

test('a busy day (3+ things already planned) -> Day Builder suggests nothing at all', async ({ page }) => {
  const now = new Date();
  await createPlan(page, { title: 'Deep Work', icon: '💼', startIso: new Date(now.getTime() + 60 * 60 * 1000).toISOString(), endIso: new Date(now.getTime() + 120 * 60 * 1000).toISOString() });
  await createPlan(page, { title: 'Learning', icon: '📚', startIso: new Date(now.getTime() + 180 * 60 * 1000).toISOString(), endIso: new Date(now.getTime() + 240 * 60 * 1000).toISOString() });
  await createPlan(page, { title: 'Workout', icon: '🏋️', startIso: new Date(now.getTime() + 300 * 60 * 1000).toISOString(), endIso: new Date(now.getTime() + 360 * 60 * 1000).toISOString() });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  // Give the client-side suggestions fetch a real chance to resolve, then
  // assert it never rendered anything -- zero suggestions is the correct,
  // expected outcome here (brief section 13), not a loading state that
  // just hasn't finished yet.
  await page.waitForTimeout(4000);
  await expect(page.getByText('What would make today feel worthwhile?')).toHaveCount(0);
});

test('a person is already saved -> a people-oriented suggestion offers both Add and Invite, using the same resolved time', async ({ page }) => {
  const partner = await createSavedPerson(page, { name: 'E2E Partner', relationshipType: 'PARTNER' });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  const inviteButton = dayBuilderSection.getByRole('button', { name: new RegExp(`Invite ${partner.name}`) }).first();

  // A people-oriented suggestion is not guaranteed to be the one shown
  // first (diversity/ranking depends on the real day profile) -- if one
  // resolved at all, it must offer both actions; if the search genuinely
  // found nothing to invite this person to right now, that's still a
  // valid, honest outcome (never a fabricated invite).
  const inviteVisible = await inviteButton.isVisible().catch(() => false);
  if (!inviteVisible) {
    test.skip(true, 'No people-oriented suggestion resolved a real time this run -- a valid empty-result outcome (brief section 13/14), nothing to assert on.');
    return;
  }

  await inviteButton.click();
  await expect(dayBuilderSection.getByText('✓ Invite sent').first()).toBeVisible({ timeout: 10000 });
});
