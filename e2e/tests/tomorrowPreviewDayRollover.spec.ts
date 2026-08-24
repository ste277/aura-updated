import { test, expect, setControlledTime } from '../fixtures/testUser';
import { localTimeToday } from '../fixtures/time';
import { createSavedPerson, fetchMyDay, listPlans } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required tests F and G:
 *   F. Night Reflection + Tomorrow Preview reflect actual day state
 *   G. Tomorrow Preview -> Plan tomorrow -> day rollover -> appears
 *      naturally in My Day (the "critical" test proving Tomorrow Preview
 *      -> Plan -> My Day is a genuine loop, not disconnected features)
 */

test('Night Reflection + Tomorrow Preview -> Plan tomorrow -> day rollover into My Day', async ({ page, testUser }) => {
  const night = localTimeToday(22, 0, testUser.timezone);
  await setControlledTime(page.context(), night.toISOString());

  // ---- F: Night Reflection + Tomorrow Preview reflect actual day state ----
  const nightMyDay = await fetchMyDay(page);
  expect(nightMyDay.story.phase).toBe('NIGHT');
  expect(nightMyDay.reflection).toBeTruthy();
  // A brand-new user's day is quiet -- no fabricated accomplishments.
  expect(nightMyDay.reflection.completed.length).toBe(0);
  expect(nightMyDay.reflection.summary.toLowerCase()).not.toContain('fail');
  expect(nightMyDay.tomorrowPreview).toBeTruthy();
  // No raw Panchang internals leaked into the user-facing narrative.
  expect(/tithi|nakshatra|yoga|karana|rahu/i.test(nightMyDay.tomorrowPreview.narrative)).toBe(false);

  await page.goto('/');
  // My Day's own data (story/reflection/tomorrowPreview) loads via an
  // async fetch after first paint -- under heavier system load this can
  // take a few seconds, so this first assertion gets a longer timeout
  // than the defaults used once the page is already warm.
  await expect(page.getByRole('heading', { name: 'Your day', exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('LOOKING AHEAD TO TOMORROW')).toBeVisible();

  // ---- G: "Plan tomorrow" via a specific suggestion, never creates a Plan ----
  const person = await createSavedPerson(page, { name: 'Reena', relationshipType: 'PARTNER' });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByText('What would make tomorrow feel well spent?').click();
  await page.getByRole('button', { name: 'Spend time with someone' }).click();
  await page.getByRole('button', { name: 'Partner / spouse' }).click();
  const activityStep = page.locator('section').filter({ hasText: 'What sounds good?' });
  await activityStep.getByRole('button', { name: /Date night/ }).click();

  // Landed in Plan with Date Night preselected and TOMORROW horizon --
  // and, crucially, no Plan has been created by the click itself.
  await expect(page.getByRole('heading', { name: 'Plan with Aura' })).toBeVisible();
  await expect(page.locator('input[type="text"], input:not([type])').first()).toHaveValue(/Date Night/i);
  const whenSelect = page.locator('section', { hasText: 'WHEN?' }).locator('select').first();
  await expect(whenSelect).toHaveValue('TOMORROW');
  expect((await listPlans(page)).length).toBe(0);

  await page.getByRole('button', { name: '✦ Find My Best Time' }).click();
  await expect(page.getByText('Use this time').first()).toBeVisible({ timeout: 20000 });
  // Self-healing click: under heavy system load a single click can land
  // between renders and silently not register (observed intermittently in
  // full-suite runs, not in isolation) -- verify the actual server effect
  // (a saved Plan) rather than trusting a single click + a UI text check.
  await expect(async () => {
    const existing = await listPlans(page);
    if (existing.length > 0) return;
    await page.getByRole('button', { name: 'Use this time' }).first().click();
    const after = await listPlans(page);
    expect(after.length).toBeGreaterThan(0);
  }).toPass({ timeout: 20000 });

  const plansAfterSave = await listPlans(page);
  expect(plansAfterSave.length).toBe(1);
  const tomorrowPlan = plansAfterSave[0];
  expect(tomorrowPlan.title.toLowerCase()).toContain('date night');

  // ---- G continued: day rollover ----
  const tomorrowMorning = localTimeToday(9, 0, testUser.timezone, 1);
  await setControlledTime(page.context(), tomorrowMorning.toISOString());
  await page.reload();

  const rolledMyDay = await fetchMyDay(page);
  const rolledItem = rolledMyDay.agenda.items.find((i: any) => i.title.toLowerCase().includes('date night'));
  expect(rolledItem).toBeTruthy();
  // Plain PlannedActivity fields only -- no acquisition-source marker of
  // any kind (this Plan came from Tomorrow Preview, not from a special
  // "tomorrow plan" concept the model doesn't have).
  const rawPlan = plansAfterSave[0];
  const forbiddenKeys = ['isTomorrowPlan', 'source', 'acquisitionSource', 'fromPreview'];
  expect(forbiddenKeys.every((k) => !(k in rawPlan))).toBe(true);

  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  const yourDaySection = page.locator('section', { has: page.getByRole('heading', { name: 'Your Day', exact: true }) });
  await expect(yourDaySection.getByText(/Date Night/i)).toBeVisible();
});
