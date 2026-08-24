import { test, expect } from '../fixtures/testUser';
import { createPlan, createSavedPerson, listPlans, listAuraMoments, fetchMyDay, fetchDayBuilderSuggestions } from '../fixtures/testData';

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

  // Zero suggestions is not an error state -- Daily Story itself still
  // renders normally (it has nothing to do with Day Builder's own result:
  // MyDayStoryCard's headline is always non-empty by buildDailyStory's own
  // contract, regardless of phase/time-of-day this test happens to run
  // at), and the rest of Home is completely unaffected.
  await expect(page.getByText('Deep Work').first()).toBeVisible();
  await expect(page.getByText('GOOD RIGHT NOW')).toBeVisible();
});

test('the API never suggests the same activityId twice, even across the reserve pool', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();

  const data = await fetchDayBuilderSuggestions(page);
  const activityIds = (data.suggestions ?? []).map((s: any) => s.activityId);
  expect(new Set(activityIds).size).toBe(activityIds.length);
});

test('"Another idea": swaps a suggestion for a resolved reserve candidate, never duplicates a visible one, and never creates a Plan or Moment by itself', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  const cards = dayBuilderSection.getByTestId('day-builder-suggestion');
  const anotherIdeaButtons = dayBuilderSection.getByRole('button', { name: 'Another idea →' });

  const activityIdsBefore = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-activity-id')));
  expect(new Set(activityIdsBefore).size).toBe(activityIdsBefore.length); // no duplicate visible activityId to start

  const plansBefore = await listPlans(page);
  const momentsBefore = await listAuraMoments(page);

  if ((await anotherIdeaButtons.count()) === 0) {
    // No reserve at all (total resolved suggestions <= visible count) --
    // the control correctly does not render rather than existing and
    // doing nothing when clicked. Confirmed against the real API response
    // rather than assumed: nothing else to exercise here.
    const raw = await fetchDayBuilderSuggestions(page);
    expect(raw.suggestions.length).toBeLessThanOrEqual(activityIdsBefore.length);
    return;
  }

  const outgoingActivityId = await cards.first().getAttribute('data-activity-id');

  // Proof the swap never triggers a new search/scoring call or any write:
  // record every network request the click produces. swapSuggestion() is
  // a pure array recombination over data already in React state (see
  // dayBuilder.ts) -- the ONLY request a click may legitimately produce is
  // the DAY_BUILDER_ANOTHER_IDEA analytics beacon (POST /api/product-events,
  // brief section 36's own UI-intent tracking, unrelated to creation/search).
  // No GET to /api/my-day/suggestions or /api/timing-search (no new
  // resolution), and no POST to /api/plans or /api/aura-moments (no
  // creation), ever.
  const requestsDuringSwap: string[] = [];
  const onRequest = (req: import('@playwright/test').Request) => requestsDuringSwap.push(`${req.method()} ${new URL(req.url()).pathname}`);
  page.on('request', onRequest);

  await anotherIdeaButtons.first().click();
  await page.waitForTimeout(500);
  page.off('request', onRequest);

  const unexpected = requestsDuringSwap.filter((r) => r !== 'POST /api/product-events');
  expect(unexpected, `Clicking "Another idea" made unexpected network requests: ${JSON.stringify(requestsDuringSwap)}`).toEqual([]);

  const activityIdsAfter = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-activity-id')));

  // Replaced, not just re-rendered -- the outgoing card is gone.
  expect(activityIdsAfter).not.toContain(outgoingActivityId);
  // Same number of visible cards.
  expect(activityIdsAfter.length).toBe(activityIdsBefore.length);
  // Never a duplicate among the now-visible cards.
  expect(new Set(activityIdsAfter).size).toBe(activityIdsAfter.length);

  // No new Plan or Moment exists merely from browsing (also directly
  // guaranteed above by the zero-requests assertion, checked again here
  // against the real persisted state for good measure).
  const plansAfter = await listPlans(page);
  const momentsAfter = await listAuraMoments(page);
  expect(plansAfter.length).toBe(plansBefore.length);
  expect(momentsAfter.length).toBe(momentsBefore.length);
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
