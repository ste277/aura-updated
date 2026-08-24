/**
 * My Day V1 -- the human intention layer (brief section 16/17). This is
 * NOT Muhurta ontology and NOT a second scoring taxonomy: every entry below
 * resolves to a real canonical activityId from FULL_ACTIVITY_CATALOG (or is
 * explicitly `activityId: null`, meaning "considered, no clean canonical
 * match" -- brief section 18's "report it, don't fake it" rule). Discovery/
 * navigation only; Timing Search itself never sees this file.
 *
 * Catalog coverage audit (brief section 18), findings baked into the data
 * below:
 *  - Meditation, Quiet time: no existing match -- two new EVERYDAY catalog
 *    activities were added (personalizedTasks.ts/activityDefinitions.ts),
 *    justified because they're common, low-risk, and explicitly needed by
 *    this taxonomy (see the completion report).
 *  - "Kids time" (as its own concept): no canonical match -- collapsed into
 *    the FAMILY group rather than inventing a distinct kids activity; the
 *    family-* activities already cover it well enough.
 *  - "Important task" (WORK): already effectively covered by Deep Work /
 *    Learning -- omitted rather than force-mapped onto an unrelated
 *    Home-only playbook card (task-1..7 aren't momentEligible/searchable).
 *  - "Hobby" (ENJOYMENT), "Calling parents" (FAMILY): no canonical match,
 *    intentionally NOT surfaced in V1 -- reported here, not faked.
 */

export type DailyIntentionGroupId = 'RELATIONSHIPS' | 'FAMILY' | 'SOCIAL' | 'WORK' | 'SELF' | 'ENJOYMENT' | 'LIFE';

export interface DailyIntentionActivity {
  label: string;
  icon: string;
  activityId: string | null;
}

export interface DailyIntentionGroup {
  id: DailyIntentionGroupId;
  /** The label used on the FIRST-level "spend time with someone" sub-choice
   * or WORK/SELF/ENJOYMENT broad choice (brief section 19/20). */
  broadLabel: string;
  icon: string;
  activities: DailyIntentionActivity[];
}

export const INTENTION_GROUPS: DailyIntentionGroup[] = [
  {
    id: 'RELATIONSHIPS',
    broadLabel: 'Partner / spouse',
    icon: '❤️',
    activities: [
      { label: 'Dinner together', icon: '🍽', activityId: 'dinner-date' },
      { label: 'Coffee / tea', icon: '☕', activityId: 'coffee-tea' },
      { label: 'Walk together', icon: '🚶', activityId: 'walk-together' },
      { label: 'Movie night', icon: '🎬', activityId: 'movie-night' },
      { label: 'Date night', icon: '❤️', activityId: 'date-night' },
      { label: 'Quiet time together', icon: '🏠', activityId: 'quiet-time' },
    ],
  },
  {
    id: 'FAMILY',
    broadLabel: 'Family',
    icon: '👨‍👩‍👧',
    activities: [
      { label: 'Family dinner', icon: '🍽', activityId: 'family-dinner' },
      { label: 'Movie together', icon: '🎬', activityId: 'family-movie-night' },
      { label: 'Family outing', icon: '🚗', activityId: 'family-outing' },
      { label: 'Visit family', icon: '👪', activityId: 'visit-family' },
      // No canonical match -- reported, not faked (brief section 18).
      { label: 'Call parents', icon: '📞', activityId: null },
    ],
  },
  {
    id: 'SOCIAL',
    broadLabel: 'Friend',
    icon: '👥',
    activities: [
      { label: 'Coffee', icon: '☕', activityId: 'coffee-tea' },
      { label: 'Dinner', icon: '🍽', activityId: 'dinner-with-friends' },
      { label: 'Walk', icon: '🚶', activityId: 'walk-together' },
      { label: 'Catch up', icon: '👥', activityId: 'catch-up' },
      { label: 'Party', icon: '🎉', activityId: 'party' },
      { label: 'Movie', icon: '🎬', activityId: 'movie-night' },
    ],
  },
  {
    id: 'WORK',
    broadLabel: 'Get something important done',
    icon: '💼',
    activities: [
      { label: 'Deep work', icon: '💼', activityId: 'deep-work' },
      { label: 'Learning', icon: '📚', activityId: 'learning' },
    ],
  },
  {
    id: 'SELF',
    broadLabel: 'Do something for myself',
    icon: '🌿',
    activities: [
      { label: 'Workout', icon: '🏋️', activityId: 'workout' },
      { label: 'Meditation', icon: '🧘', activityId: 'meditation' },
      { label: 'Reading', icon: '📖', activityId: 'learning' },
      { label: 'Quiet time', icon: '🏠', activityId: 'quiet-time' },
    ],
  },
  {
    id: 'ENJOYMENT',
    broadLabel: 'Enjoy something',
    icon: '🎉',
    activities: [
      { label: 'Movie', icon: '🎬', activityId: 'movie-night' },
      { label: 'Tea / coffee', icon: '☕', activityId: 'coffee-tea' },
      { label: 'Outing', icon: '🚗', activityId: 'picnic' },
      // No canonical match -- reported, not faked (brief section 18).
      { label: 'Hobby', icon: '🎨', activityId: null },
    ],
  },
  {
    id: 'LIFE',
    broadLabel: 'Errands & home',
    icon: '🧺',
    // Not surfaced as a first-level choice in V1 (the brief's own broad-
    // choice UI in section 19 only shows WORK/PEOPLE/SELF/ENJOYMENT) --
    // defined here for completeness/audit purposes only.
    activities: [
      { label: 'Shopping', icon: '🛍', activityId: 'shopping-trip' },
      { label: 'Errands', icon: '🧺', activityId: null },
      { label: 'Home task', icon: '🏠', activityId: null },
    ],
  },
];

export function getIntentionGroup(id: DailyIntentionGroupId): DailyIntentionGroup | undefined {
  return INTENTION_GROUPS.find((group) => group.id === id);
}

/** The "spend time with someone" sub-choices (brief section 20) -- Kids is
 * deliberately folded into Family (no distinct canonical activities exist
 * for kids specifically, see the file-level doc comment). */
export const PEOPLE_SUBGROUPS: Array<{ label: string; icon: string; groupId: DailyIntentionGroupId }> = [
  { label: 'Partner / spouse', icon: '❤️', groupId: 'RELATIONSHIPS' },
  { label: 'Family', icon: '👨‍👩‍👧', groupId: 'FAMILY' },
  { label: 'Friend', icon: '👥', groupId: 'SOCIAL' },
];

/** The four broad first-level choices (brief section 19) -- PEOPLE isn't
 * one of the seven taxonomy groups above, it's a virtual umbrella over
 * RELATIONSHIPS/FAMILY/SOCIAL resolved via PEOPLE_SUBGROUPS at level two. */
export type DailyIntentionBroadChoice = 'WORK' | 'PEOPLE' | 'SELF' | 'ENJOYMENT';

export const BROAD_CHOICES: Array<{ id: DailyIntentionBroadChoice; label: string; icon: string }> = [
  { id: 'WORK', label: 'Get something important done', icon: '💼' },
  { id: 'PEOPLE', label: 'Spend time with someone', icon: '❤️' },
  { id: 'SELF', label: 'Do something for myself', icon: '🌿' },
  { id: 'ENJOYMENT', label: 'Enjoy something', icon: '🎉' },
];
