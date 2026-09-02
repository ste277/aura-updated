import { test, expect } from '../fixtures/testUser';
import { listPlans, fetchDayBuilderSuggestions } from '../fixtures/testData';

/**
 * Personalization Foundation V1 -- the required end-to-end journey (brief
 * section 10): set explicit priorities -> Day Builder favors eligible
 * activities from those groups -> suggestions still carry real resolved
 * times -> Add still creates a normal canonical Plan. Real click-through
 * against the actual PATCH /api/users/day-builder-preferences route and
 * the real GET /api/my-day/suggestions -> POST /api/plans path -- no
 * mocked scoring, no controlled time (mirrors dayBuilderJourney.spec.ts's
 * own established precedent).
 */

const PEOPLE_ORIENTED_TAXONOMY_GROUPS = new Set(['RELATIONSHIPS', 'FAMILY', 'SOCIAL']);
const WELLBEING_TAXONOMY_GROUPS = new Set(['SELF']);

test('Relationships + Wellbeing priorities -> Day Builder favors eligible activities from those groups, with real resolved times -> Add creates a normal Plan', async ({ page }) => {
  const patchRes = await page.request.patch('/api/users/day-builder-preferences', {
    data: { dayBuilderPriorities: ['RELATIONSHIPS', 'WELLBEING'] },
  });
  expect(patchRes.ok()).toBe(true);
  const patched = await patchRes.json();
  expect(patched.dayBuilderPriorities.sort()).toEqual(['RELATIONSHIPS', 'WELLBEING'].sort());

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });

  const raw = await fetchDayBuilderSuggestions(page);
  const suggestions = raw.suggestions ?? [];
  expect(suggestions.length).toBeGreaterThan(0);

  // Day Builder favors eligible activities from the prioritized groups --
  // the FIRST resolved suggestion belongs to a taxonomy group the
  // RELATIONSHIPS/WELLBEING priorities map onto (dayBuilder.ts's own
  // PRIORITY_GROUP_TO_INTENTION_GROUPS), not an unprioritized one like
  // WORK/ENJOYMENT/ROUTINE.
  const firstGroupId = suggestions[0].groupId;
  const isPrioritized = PEOPLE_ORIENTED_TAXONOMY_GROUPS.has(firstGroupId) || WELLBEING_TAXONOMY_GROUPS.has(firstGroupId);
  expect(isPrioritized, `Expected the first suggestion's group (${firstGroupId}) to be RELATIONSHIPS/FAMILY/SOCIAL/SELF`).toBe(true);

  // Suggestions still contain real resolved times -- never a bare name.
  // Home Compactness + Flexible Day Story V1 -- each suggestion now
  // carries 1-3 ranked candidates (`candidates`) instead of exactly one.
  for (const s of suggestions) {
    expect(Array.isArray(s.candidate.candidates)).toBe(true);
    expect(s.candidate.candidates.length).toBeGreaterThan(0);
    for (const c of s.candidate.candidates) {
      const candidateTime = s.candidate.kind === 'SOLO' ? c : c.generalCandidate;
      expect(typeof candidateTime.start).toBe('string');
      expect(typeof candidateTime.end).toBe('string');
      expect(new Date(candidateTime.start).getTime()).toBeGreaterThan(0);
    }
  }

  // Add creates a normal canonical Plan -- same path as every other Day
  // Builder suggestion, personalization changed nothing about creation.
  const before = await listPlans(page);
  expect(before.length).toBe(0);

  const dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  await dayBuilderSection.getByRole('button', { name: '+ Add' }).first().click();
  await expect(dayBuilderSection.getByText('✓ Added to your day').first()).toBeVisible({ timeout: 10000 });

  const after = await listPlans(page);
  expect(after.length).toBe(1);
});
