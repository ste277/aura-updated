import { test, expect, setControlledTime } from '../fixtures/testUser';
import { createPlan, logHabitInstant } from '../fixtures/testData';
import { findNeutralInstant, findInstantBeforeRahuKalam, findInstantDuringRahuKalam } from '../fixtures/panchangWindows';

/**
 * Home Recommendation Hierarchy V1 -- permanent regression coverage for the
 * bug this PR fixes: Good Right Now and Aura Suggests could recommend the
 * exact same canonical activity (e.g. "Process Optimization & Docs" in
 * both), because Aura Suggests' caution-window tier used to pick an
 * activity with no dedup check at all. The fix is architectural (only one
 * Aura Suggests tier, ACTIVITY_FALLBACK, ever recommends a catalog
 * activity; every other tier is agenda/context guidance derived from
 * DailyAgenda) -- these tests protect that architecture, not just the one
 * originally-reported id collision.
 */

test('overlap regression: Aura Suggests never repeats the exact canonical activity already shown in Good Right Now', async ({ page, testUser }) => {
  const neutralInstant = findNeutralInstant(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: neutralInstant });
  await page.clock.resume();
  await page.goto('/');

  await expect(page.getByText('GOOD RIGHT NOW')).toBeVisible();
  const goodRightNowSection = page.locator('div', { has: page.getByText('GOOD RIGHT NOW') });
  const goodRightNowTitles = await goodRightNowSection.locator('span').allInnerTexts();

  const auraSuggestsHeading = page.getByText('✨ Aura Suggests');
  if (await auraSuggestsHeading.count() === 0) {
    // Hidden entirely -- an explicitly acceptable outcome (brief section 13:
    // "preferable to duplication"). Nothing further to assert.
    return;
  }
  const auraSuggestsSection = page.locator('div', { has: auraSuggestsHeading });
  const auraSuggestsTitle = await auraSuggestsSection.getByRole('heading').first().innerText();

  expect(goodRightNowTitles.some((t) => t.trim() === auraSuggestsTitle.trim())).toBe(false);
});

test('caution-window regression: a next Plan during a caution window produces day-context guidance, not a picked activity', async ({ page, context, testUser }) => {
  const rahuInstant = findInstantDuringRahuKalam(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);

  // Both clocks -- Good Right Now's activeWindowName is computed CLIENT-side
  // from the real browser clock; DailyAgenda's nextItem is computed SERVER-
  // side from the `x-e2e-now` header. Both must agree on "now" for this
  // fixture to be coherent (see panchangWindows.ts's own doc comment).
  await setControlledTime(context, rahuInstant.toISOString());
  await page.clock.install({ time: rahuInstant });
  await page.clock.resume();

  await createPlan(page, {
    title: 'Learning',
    icon: '📚',
    startIso: new Date(rahuInstant.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    endIso: new Date(rahuInstant.getTime() + 4 * 60 * 60 * 1000).toISOString(),
  });

  await page.goto('/');
  await expect(page.getByText(/Rahu Kalam/).first()).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('GOOD RIGHT NOW')).toBeVisible({ timeout: 15000 });
  const goodRightNowSection = page.locator('div', { has: page.getByText('GOOD RIGHT NOW') });
  const goodRightNowTitles = await goodRightNowSection.locator('span').allInnerTexts();

  // This is the exact scenario the original bug reproduced in: a caution
  // window with a later Plan on the agenda. Aura Suggests must now show
  // day/window context, never a picked activity that could collide with
  // Good Right Now. Wrapped in toPass -- DailyAgenda's nextItem comes from a
  // client-side fetch to /api/my-day that can re-render more than once
  // shortly after navigation (React 18 strict-mode's dev-only double-invoke
  // of effects), so checking the whole group atomically avoids catching the
  // page mid-transition the way separate sequential expect() calls can.
  // `div` + `has:` matches EVERY ancestor div containing the text, not just
  // the SurfaceCard itself -- fine for read-only text extraction (below),
  // but not for a `toHaveCount` assertion, which needs the actual card
  // boundary. getByText resolves to the eyebrow div itself (the smallest
  // element containing exactly that text); ITS direct parent is the
  // SurfaceCard's own outer div (see HomeDashboard.tsx's Aura Suggests JSX
  // -- the eyebrow div is the SurfaceCard's first child, no wrapper between
  // them). Going up two levels instead overshoots into the shared grid
  // wrapper that also holds the adjacent Next Best Moment card.
  const auraSuggestsSection = page.getByText('✨ Aura Suggests').locator('xpath=..');
  await expect(async () => {
    await expect(page.getByText('✨ Aura Suggests')).toBeVisible();
    await expect(page.getByText('Keep this window light')).toBeVisible();
    await expect(page.getByText(/Your first plan is Learning/)).toBeVisible();
    // No "View full day timeline" secondary action would exist without a
    // primary action -- CAUTION_CONTEXT carries neither (brief section 7).
    await expect(auraSuggestsSection.getByRole('button')).toHaveCount(0);
  }).toPass({ timeout: 15000 });

  const auraSuggestsTitle = await auraSuggestsSection.getByRole('heading').first().innerText();
  expect(goodRightNowTitles.some((t) => t.trim() === auraSuggestsTitle.trim())).toBe(false);
});

test('agenda-aware: logging something with nothing else queued produces open-gap guidance, never another activity pick', async ({ page, testUser }) => {
  const neutralInstant = findNeutralInstant(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: neutralInstant });
  await page.clock.resume();

  await logHabitInstant(page, { activityTitle: 'Deep Work', activeWindow: 'NEUTRAL', logMinuteOfDay: 600 });

  // toPass, not sequential expect() calls -- see the caution-window test's
  // own comment above for why (a benign extra re-render shortly after
  // navigation can otherwise be caught mid-transition). Scoped to the Aura
  // Suggests card specifically: "Add something" also appears as Your Day's
  // OWN empty-state button ("+ Add something"), a DIFFERENT control this
  // test isn't about.
  await page.goto('/');
  const auraSuggestsSection = page.locator('div', { has: page.getByText('✨ Aura Suggests') });
  await expect(async () => {
    await expect(page.getByText('✨ Aura Suggests')).toBeVisible();
    await expect(page.getByText('Open time ahead')).toBeVisible();
    await expect(auraSuggestsSection.getByRole('button', { name: 'Add something', exact: true })).toBeVisible();
  }).toPass({ timeout: 15000 });
});

test('a caution/low-quality candidate is never labeled "Next Best Moment"', async ({ page, testUser }) => {
  const beforeRahu = findInstantBeforeRahuKalam(new Date(), testUser.latitude, testUser.longitude, testUser.timezone);
  await page.clock.install({ time: beforeRahu });
  await page.clock.resume();
  await page.goto('/');

  // Sanity check: the upcoming window really is Rahu Kalam (caution).
  await expect(page.getByText(/Rahu Kalam/)).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('⭐ Next Best Moment')).toHaveCount(0);
  await expect(page.getByText('🕐 Coming Up')).toBeVisible();
});
