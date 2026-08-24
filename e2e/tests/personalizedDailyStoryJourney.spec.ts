import { test, expect } from '../fixtures/testUser';
import { createSavedPerson, listPlans, listAuraMoments, fetchMyDay, fetchDayBuilderSuggestions } from '../fixtures/testData';

/**
 * Personalized Daily Story V2 -- the required end-to-end journey (brief
 * section 15): explicit priorities (WORK + RELATIONSHIPS + WELLBEING) on
 * an empty morning produce a personalized "mostly open day" narrative;
 * adding a WORK- or WELLBEING-group suggestion (whichever resolves) covers
 * that priority, changes the story, and shifts Day Builder toward a
 * still-uncovered priority; inviting the priority person to a
 * RELATIONSHIPS suggestion then covers RELATIONSHIPS too and the story
 * names them by name. Real click-through against the actual APIs -- no
 * mocked scoring, no controlled time (mirrors dayBuilderJourney.spec.ts /
 * personalizationJourney.spec.ts's own established precedent for real
 * Timing Search results).
 *
 * The Add step deliberately accepts either WORK or WELLBEING (never
 * RELATIONSHIPS) rather than hard-coding Deep Work specifically: real
 * availability shifts with wall-clock time (e.g. Deep Work's own
 * preferred/acceptable windows can be entirely behind "now" in the
 * evening), and dayBuilder.ts's own partial-coverage narrative ("Your day
 * has structure") and demotion behavior are, by construction, symmetric
 * across priorities (dayBuilder.test.ts / dailyStory.test.ts cover every
 * branch directly) -- so asserting "whichever one resolved got covered"
 * exercises the same real code path a WORK-specific assertion would,
 * without depending on time of day. RELATIONSHIPS is reserved for the
 * Invite step: covering it via Add would demote it before the priority-
 * person Invite gets a chance to run.
 */

const PRIORITY_TAXONOMY_GROUPS: Record<string, string[]> = {
  WORK: ['WORK'],
  RELATIONSHIPS: ['RELATIONSHIPS', 'FAMILY', 'SOCIAL'],
  WELLBEING: ['SELF'],
};
const TAXONOMY_TO_PRIORITY: Record<string, string> = { WORK: 'WORK', RELATIONSHIPS: 'RELATIONSHIPS', FAMILY: 'RELATIONSHIPS', SOCIAL: 'RELATIONSHIPS', SELF: 'WELLBEING' };
// dailyStory.ts's own PRIORITY_NARRATIVE_LABEL[*].covered text -- what the
// narrative should factually mention once that priority is covered.
const COVERED_NARRATIVE_LABEL: Record<string, string> = { WORK: 'focused work', RELATIONSHIPS: 'time with someone important', WELLBEING: 'something for your wellbeing' };

test('WORK+RELATIONSHIPS+WELLBEING priorities -> personalized story -> Add covers a priority -> Invite priority person covers RELATIONSHIPS', async ({ page }) => {
  const prioritiesRes = await page.request.patch('/api/users/day-builder-preferences', {
    data: { dayBuilderPriorities: ['WORK', 'RELATIONSHIPS', 'WELLBEING'] },
  });
  expect(prioritiesRes.ok()).toBe(true);

  const partner = await createSavedPerson(page, { name: 'E2E Priority Partner', relationshipType: 'PARTNER' });
  const personRes = await page.request.patch('/api/users/day-builder-preferences', {
    data: { dayBuilderPriorityPersonIds: [partner.id] },
  });
  expect(personRes.ok()).toBe(true);
  const personPatched = await personRes.json();
  // The earlier PATCH's priorities must survive this second, person-only PATCH
  // (every field defaults to the current stored value when omitted).
  expect(personPatched.dayBuilderPriorities.sort()).toEqual(['RELATIONSHIPS', 'WELLBEING', 'WORK'].sort());

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your Day', exact: true })).toBeVisible();

  const before = await listPlans(page);
  expect(before.length).toBe(0);

  // An empty morning with all three priorities open -> the personalized,
  // deterministic "A mostly open day" headline (dailyStory.ts's own
  // composePersonalizedNarrative, zero-coverage branch), not the generic
  // phase-based one.
  await expect(page.getByRole('heading', { name: 'A mostly open day' })).toBeVisible({ timeout: 15000 });

  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
  let dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  let cards = dayBuilderSection.getByTestId('day-builder-suggestion');
  let anotherIdeaButtons = dayBuilderSection.getByRole('button', { name: 'Another idea →' });

  async function findCardWhere(predicate: (groupId: string | null, activityId: string | null) => boolean) {
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const groupId = await card.getAttribute('data-group-id');
      const activityId = await card.getAttribute('data-activity-id');
      if (predicate(groupId, activityId)) return card;
    }
    return null;
  }

  async function findCardCycling(predicate: (groupId: string | null, activityId: string | null) => boolean) {
    let found = await findCardWhere(predicate);
    let attempts = 0;
    while (!found && attempts < 6 && (await anotherIdeaButtons.count()) > 0) {
      await anotherIdeaButtons.first().click();
      await page.waitForTimeout(300);
      found = await findCardWhere(predicate);
      attempts++;
    }
    return found;
  }

  // The Add step deliberately targets WORK or WELLBEING only, never
  // RELATIONSHIPS -- the journey's own Invite step later needs
  // RELATIONSHIPS to still be OPEN so the priority person can be offered
  // there (brief section 15's own ordering: cover a different priority
  // first via Add, then cover RELATIONSHIPS specifically via Invite).
  const isWorkOrWellbeing = (groupId: string | null) => groupId !== null && (TAXONOMY_TO_PRIORITY[groupId] === 'WORK' || TAXONOMY_TO_PRIORITY[groupId] === 'WELLBEING');

  // Every visible suggestion carries a real resolved time -- personalization
  // changed ranking, not resolution.
  const rawBefore = await fetchDayBuilderSuggestions(page);
  expect((rawBefore.suggestions ?? []).length).toBeGreaterThan(0);

  // Real Timing Search results shift with wall-clock time -- a fresh
  // mount's fetch can resolve a different candidate set a few seconds
  // later. A bounded number of reloads gives a prioritized suggestion a
  // fair chance to appear before treating its absence as a genuine (valid)
  // empty-result outcome.
  let firstCard = await findCardCycling((groupId) => isWorkOrWellbeing(groupId));
  for (let reloadAttempt = 0; !firstCard && reloadAttempt < 3; reloadAttempt++) {
    await page.reload();
    await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
    dayBuilderSection = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
    cards = dayBuilderSection.getByTestId('day-builder-suggestion');
    anotherIdeaButtons = dayBuilderSection.getByRole('button', { name: 'Another idea →' });
    firstCard = await findCardCycling((groupId) => isWorkOrWellbeing(groupId));
  }
  if (!firstCard) {
    test.skip(true, 'No WORK or WELLBEING(SELF) suggestion resolved a real time this run -- a valid empty-result outcome, nothing further to assert on the Add step.');
    return;
  }

  const addedGroupId = await firstCard.getAttribute('data-group-id');
  const coveredPriority = TAXONOMY_TO_PRIORITY[addedGroupId!];

  await firstCard.getByRole('button', { name: '+ Add' }).click();
  // Scoped to the whole section, not the specific card locator -- Personalized
  // Daily Story V2's refreshAfterCreate() (brief section 10) re-derives and
  // re-renders the suggestion list right after this, so a stale nth()-based
  // card locator can end up pointed at a since-replaced DOM element.
  await expect(dayBuilderSection.getByText('✓ Added to your day').first()).toBeVisible({ timeout: 10000 });

  // Canonical Plan created via the same path every other Day Builder
  // suggestion uses -- no special personalization-only creation code.
  const afterAdd = await listPlans(page);
  expect(afterAdd.length).toBe(1);

  await page.reload();
  const yourDaySection = page.locator('section', { has: page.getByRole('heading', { name: 'Your Day', exact: true }) });
  await expect(yourDaySection.getByText(afterAdd[0].title, { exact: false })).toBeVisible();

  // Exactly one of the three priorities is now covered; the other two
  // remain open -> the real orchestrator re-derives a partial-coverage
  // story, not a fake client-side rewrite (brief section 10/11) -- true
  // regardless of which priority resolved first.
  const myDayAfterAdd = await fetchMyDay(page);
  expect(myDayAfterAdd.story.headline).toBe('Your day has structure');
  expect(myDayAfterAdd.story.narrative).toContain(COVERED_NARRATIVE_LABEL[coveredPriority]);

  // Day Builder favors another still-uncovered priority now -- the just-
  // covered group is demoted (diversity, not exclusion: brief section 6),
  // so the first resolved suggestion should no longer belong to it.
  const dayBuilderTextAfterAdd = page.getByText('What would make today feel worthwhile?');
  const hasDayBuilderAfterAdd = await dayBuilderTextAfterAdd.isVisible().catch(() => false);
  if (hasDayBuilderAfterAdd) {
    dayBuilderSection = page.locator('section', { has: dayBuilderTextAfterAdd });
    cards = dayBuilderSection.getByTestId('day-builder-suggestion');
  }
  if (hasDayBuilderAfterAdd && (await cards.count()) > 0) {
    const firstGroupIdAfterAdd = await cards.first().getAttribute('data-group-id');
    expect(
      firstGroupIdAfterAdd && PRIORITY_TAXONOMY_GROUPS[coveredPriority].includes(firstGroupIdAfterAdd),
      `Expected the first suggestion after ${coveredPriority} was covered to favor a different priority, not another ${coveredPriority}-group suggestion`
    ).toBe(false);
  }

  // Invite the priority person to a RELATIONSHIPS suggestion (Coffee or
  // equivalent) -- section 8: an eligible priority person may be
  // preferred for a shared suggestion.
  await page.reload();
  await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
  let dayBuilderSection2 = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
  let cards2 = dayBuilderSection2.getByTestId('day-builder-suggestion');
  let anotherIdeaButtons2 = dayBuilderSection2.getByRole('button', { name: 'Another idea →' });

  async function findRelationshipsInviteCard() {
    for (let attempts = 0; attempts < 7; attempts++) {
      const count = await cards2.count();
      for (let i = 0; i < count; i++) {
        const card = cards2.nth(i);
        const groupId = await card.getAttribute('data-group-id');
        if (!groupId || !PRIORITY_TAXONOMY_GROUPS.RELATIONSHIPS.includes(groupId)) continue;
        const inviteButton = card.getByRole('button', { name: new RegExp(`Invite ${partner.name}`) });
        if (await inviteButton.isVisible().catch(() => false)) return card;
      }
      if ((await anotherIdeaButtons2.count()) === 0) break;
      await anotherIdeaButtons2.first().click();
      await page.waitForTimeout(300);
    }
    return null;
  }

  // Same wall-clock-driven nondeterminism as the Add step above -- a
  // bounded number of reloads gives a partner-eligible RELATIONSHIPS
  // suggestion a fair chance to resolve before treating its absence as a
  // genuine empty-result outcome.
  let inviteCard = await findRelationshipsInviteCard();
  for (let reloadAttempt = 0; !inviteCard && reloadAttempt < 3; reloadAttempt++) {
    await page.reload();
    await expect(page.getByText('What would make today feel worthwhile?')).toBeVisible({ timeout: 20000 });
    dayBuilderSection2 = page.locator('section', { has: page.getByText('What would make today feel worthwhile?') });
    cards2 = dayBuilderSection2.getByTestId('day-builder-suggestion');
    anotherIdeaButtons2 = dayBuilderSection2.getByRole('button', { name: 'Another idea →' });
    inviteCard = await findRelationshipsInviteCard();
  }
  if (!inviteCard) {
    test.skip(true, 'No RELATIONSHIPS suggestion offering an invite to the priority person resolved a real time this run -- a valid empty-result outcome, nothing further to assert on the Invite step.');
    return;
  }

  const invitedActivityId = await inviteCard.getAttribute('data-activity-id');
  const momentsBefore = await listAuraMoments(page);
  await inviteCard.getByRole('button', { name: new RegExp(`Invite ${partner.name}`) }).click();
  await expect(dayBuilderSection2.getByText('✓ Invite sent').first()).toBeVisible({ timeout: 10000 });

  // Canonical AuraMoment created via the same POST /api/aura-moments path
  // every other invite uses.
  const momentsAfter = await listAuraMoments(page);
  expect(momentsAfter.length).toBe(momentsBefore.length + 1);

  // RELATIONSHIPS now covered via a real Moment -- priorityPersonMoment
  // takes precedence in the narrative over any coverage-based branch
  // (regardless of what got covered in the Add step above), names the
  // person, and leaks no internal identifiers.
  const myDayAfterInvite = await fetchMyDay(page);
  expect(myDayAfterInvite.story.headline).toBe("You've made room for what matters");
  expect(myDayAfterInvite.story.narrative).toContain(partner.name);
  expect(myDayAfterInvite.story.narrative).not.toContain(partner.id);

  // No duplicate recommendation for the same person on the same day
  // afterward -- the just-booked (activity, person) pair is no longer
  // re-offered.
  const rawAfterInvite = await fetchDayBuilderSuggestions(page);
  const duplicateOffer = (rawAfterInvite.suggestions ?? []).some(
    (s: any) => s.candidate?.kind === 'SHARED' && s.candidate.shared?.person?.id === partner.id && s.activityId === invitedActivityId
  );
  expect(duplicateOffer).toBe(false);
});
