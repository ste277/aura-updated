/**
 * AURA-DISC-01 -- guest activity discovery data (pure, no DOM).
 *
 *   npx ts-node test/disc01GuestActivityDiscovery.test.ts
 *
 * Every Popular / category id must be an existing EVERYDAY catalog activity
 * that the UNCHANGED guest timing-search validator accepts; labels must be the
 * catalog's own titles; search keeps its existing matching and de-duplicates.
 */
import {
  POPULAR_ACTIVITY_IDS,
  ACTIVITY_DISCOVERY_CATEGORIES,
  GUEST_ACTIVITY_SEARCH_PLACEHOLDER,
  getGuestPlannableActivities,
  resolveDiscoveryActivities,
  searchGuestActivities,
} from '../apps/web/lib/guestActivityDiscovery';
import { buildGuestTimingSearchRequest } from '../apps/web/lib/guestTimingSearchRequest';
import { FULL_ACTIVITY_CATALOG } from '../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../packages/recommendation/src/activityDefinitions';
import { DailyAssistantContext } from '../packages/recommendation/src/dailyAssistant';
import { ONBOARDING_GOAL_CATEGORIES } from '../apps/web/lib/onboardingGoalStep';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean) {
  count++;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const context: DailyAssistantContext = {
  now: new Date('2026-08-23T10:00:00.000Z'),
  latitude: 13.0827,
  longitude: 80.2707,
  timezone: 'Asia/Kolkata',
  tzOffsetMinutes: 330,
};

// ---------------- Popular ----------------
const popular = resolveDiscoveryActivities(POPULAR_ACTIVITY_IDS);
check('P1. exactly six Popular activities', POPULAR_ACTIVITY_IDS.length === 6 && popular.length === 6);
check('P2. Popular has no duplicates', new Set(POPULAR_ACTIVITY_IDS).size === 6);
check('P3. Popular is the expected balanced set', JSON.stringify(popular.map((a) => a.title)) === JSON.stringify(['Workout', 'Deep Work', 'Date Night', 'Learning', 'Coffee / Tea', 'Meditation']));
const categoryOf = (id: string) => ACTIVITY_DISCOVERY_CATEGORIES.filter((c) => c.activityIds.includes(id)).map((c) => c.id);
const popularCategories = new Set(POPULAR_ACTIVITY_IDS.flatMap(categoryOf));
check('P4. Popular spans all four categories (personal, work, health, growth)', popularCategories.size === 4);
check('P5. every Popular activity also lives in a category', POPULAR_ACTIVITY_IDS.every((id) => categoryOf(id).length > 0));

// ---------------- Categories ----------------
check('C1. exactly four categories', ACTIVITY_DISCOVERY_CATEGORIES.length === 4);
check(
  'C2. category labels and order',
  JSON.stringify(ACTIVITY_DISCOVERY_CATEGORIES.map((c) => c.label)) === JSON.stringify(['Personal & Social', 'Work & Professional', 'Health & Fitness', 'Growth & Everyday Life'])
);
check('C3. category ids are unique', new Set(ACTIVITY_DISCOVERY_CATEGORIES.map((c) => c.id)).size === 4);
check(
  'C4. Personal & Social keeps the original six',
  JSON.stringify(ACTIVITY_DISCOVERY_CATEGORIES[0].activityIds) === JSON.stringify(['date-night', 'dinner-date', 'coffee-tea', 'movie-night', 'road-trip', 'party'])
);
for (const c of ACTIVITY_DISCOVERY_CATEGORIES) {
  check(`C5. ${c.label}: non-empty, no duplicates, every id resolves`, c.activityIds.length > 0 && new Set(c.activityIds).size === c.activityIds.length && resolveDiscoveryActivities(c.activityIds).length === c.activityIds.length);
}
const allIds = [...new Set([...POPULAR_ACTIVITY_IDS, ...ACTIVITY_DISCOVERY_CATEGORIES.flatMap((c) => c.activityIds)])];
check('C6. no activity appears in two categories', ACTIVITY_DISCOVERY_CATEGORIES.flatMap((c) => c.activityIds).length === new Set(ACTIVITY_DISCOVERY_CATEGORIES.flatMap((c) => c.activityIds)).size);

// ---------------- Catalog-backed, guest-plannable, accurate labels ----------------
for (const id of allIds) {
  const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
  check(`K1. ${id} exists in FULL_ACTIVITY_CATALOG`, !!activity);
  check(`K2. ${id} is EVERYDAY planning mode`, !!activity && getActivityDefinition(activity)?.experience.planningMode === 'EVERYDAY');
  const r = buildGuestTimingSearchRequest({ activityId: id, horizon: 'TODAY', durationMinutes: 60 }, context);
  check(`K3. ${id} is accepted by the unchanged guest timing-search validator`, r.ok);
}
check(
  'K4. resolved chips carry the catalog title and icon verbatim (label = planned activity)',
  resolveDiscoveryActivities(allIds).every((a) => {
    const c = FULL_ACTIVITY_CATALOG.find((x) => x.id === a.id)!;
    return a.title === c.title && a.icon === c.icon;
  })
);
check('K5. unknown and non-EVERYDAY ids are dropped, duplicates collapse', JSON.stringify(resolveDiscoveryActivities(['nope', 'marriage', 'financial-decision', 'workout', 'workout']).map((a) => a.id)) === JSON.stringify(['workout']));
const UNSUPPORTED = ['Important Meeting', 'Presentation', 'Networking', 'Brainstorming', 'Health Checkup', 'Financial Planning', 'Home Tasks', 'Creative Time'];
const shownTitles = new Set(resolveDiscoveryActivities(allIds).map((a) => a.title));
check('K6. none of the eight not-yet-catalogued activities is shown under an invented label', UNSUPPORTED.every((t) => !shownTitles.has(t)));

// ---------------- Search ----------------
check('S1. placeholder', GUEST_ACTIVITY_SEARCH_PLACEHOLDER === 'e.g. Dinner, Workout, Focus...');
check('S2. under two characters returns nothing (existing behaviour)', searchGuestActivities('d').length === 0 && searchGuestActivities('  ').length === 0);
for (const a of resolveDiscoveryActivities(allIds)) {
  check(`S3. "${a.title}" is found by searching its title`, searchGuestActivities(a.title).some((x) => x.id === a.id));
}
check('S4. placeholder examples all return results', ['Dinner', 'Workout', 'Focus'].every((q) => searchGuestActivities(q).length > 0));
check('S5. "focus" finds Deep Work via its alias', searchGuestActivities('focus').some((a) => a.id === 'deep-work'));
check('S6. "run" finds Workout via its alias', searchGuestActivities('run').some((a) => a.id === 'workout'));
check('S7. search never offers non-guest-plannable activities', searchGuestActivities('marriage').length === 0 && !searchGuestActivities('financial').some((a) => a.id === 'financial-decision'));
{
  const pool = [...getGuestPlannableActivities(), ...getGuestPlannableActivities()];
  const r = searchGuestActivities('date', pool);
  check('S8. duplicate pool entries are returned once', r.length === new Set(r.map((a) => a.id)).size && r.length > 0);
}
check('S9. results are capped at 8 (existing behaviour)', searchGuestActivities('an').length <= 8);
check('S10. matching is case-insensitive and trimmed', searchGuestActivities('  WORKOUT ').some((a) => a.id === 'workout'));
{
  // Same matching as the pre-DISC-01 inline filter.
  const legacy = (q: string) => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    return FULL_ACTIVITY_CATALOG.filter((a) => getActivityDefinition(a)?.experience.planningMode === 'EVERYDAY')
      .filter((a) => a.title.toLowerCase().includes(t) || a.aliases.some((alias) => alias.includes(t)))
      .slice(0, 8)
      .map((a) => a.id);
  };
  const queries = ['dinner', 'workout', 'study', 'tea', 'walk', 'family', 'party', 'date', 'movie', 'meditat', 'de', 'xyz'];
  check('S11. search results are identical to the pre-DISC-01 filter', queries.every((q) => JSON.stringify(searchGuestActivities(q).map((a) => a.id)) === JSON.stringify(legacy(q))));
}

// ---------------- Onboarding is a separate picker and is unchanged ----------------
check(
  'O1. onboarding keeps its own goal categories (separate flow, not the activity catalog)',
  JSON.stringify(ONBOARDING_GOAL_CATEGORIES.map((c) => c.id)) === JSON.stringify(['health', 'learning', 'work', 'habits'])
);

console.log(`\n${count} checks`);
if (!allPassed) {
  console.log('SOME CHECKS FAILED');
  process.exit(1);
}
console.log('All AURA-DISC-01 discovery checks passed.');
