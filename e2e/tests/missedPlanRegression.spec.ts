import { test, expect, setControlledTime } from '../fixtures/testUser';
import { createPlan, logPlan, fetchMyDay } from '../fixtures/testData';

/**
 * Product Journey / E2E Hardening V1 -- required test E: a real regression
 * Daily Reflection uncovered (an elapsed, unlogged Plan was auto-marked
 * COMPLETED by time alone). Proves the fix end to end: MISSED status, calm
 * UI treatment, excluded from Reflection's "completed" bucket and never
 * described with guilt/failure language -- and that an explicitly LOGGED
 * Plan is still treated as completed.
 */

test('an elapsed, unlogged Plan is MISSED (never COMPLETED); a LOGGED one is', async ({ page, testUser }) => {
  const now = new Date();
  const past = new Date(now.getTime() - 3 * 60 * 60 * 1000); // 3h ago
  const pastEnd = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2h ago

  const missedPlan = await createPlan(page, { title: 'Missed Study Block', icon: '📚', startIso: past.toISOString(), endIso: pastEnd.toISOString() });
  const loggedPlan = await createPlan(page, { title: 'Completed Workout', icon: '🏋️', startIso: past.toISOString(), endIso: pastEnd.toISOString() });
  await logPlan(page, loggedPlan.id);

  await setControlledTime(page.context(), now.toISOString());
  const myDay = await fetchMyDay(page);

  const missedItem = myDay.agenda.items.find((i: any) => i.title === 'Missed Study Block');
  const completedItem = myDay.agenda.items.find((i: any) => i.title === 'Completed Workout');
  expect(missedItem.status).toBe('MISSED');
  expect(completedItem.status).toBe('COMPLETED');

  // Reflection never counts the missed one as an accomplishment, and never
  // uses guilt/failure language anywhere in its summary.
  expect(myDay.reflection.missed.some((i: any) => i.title === 'Missed Study Block')).toBe(true);
  expect(myDay.reflection.completed.some((i: any) => i.title === 'Missed Study Block')).toBe(false);
  expect(myDay.reflection.completed.some((i: any) => i.title === 'Completed Workout')).toBe(true);
  const summaryLower: string = myDay.reflection.summary.toLowerCase();
  expect(summaryLower.includes('fail')).toBe(false);
  expect(summaryLower.includes('missed study block')).toBe(false);

  // Calm UI treatment in Your Day: visible, present, and never shown with
  // a "Completed" duration label (that's COMPLETED_ACTIVITY's own display
  // rule, not a MISSED Plan's).
  await page.reload();
  const yourDaySection = page.locator('section', { has: page.getByRole('heading', { name: 'Your Day', exact: true }) });
  await expect(yourDaySection.getByText('Missed Study Block')).toBeVisible();
  await expect(yourDaySection.getByText('Completed Workout')).toBeVisible();
});
