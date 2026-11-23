/**
 * AURA-DISC-01 -- guest activity discovery ("What are you planning?").
 *
 * Pure, display-only grouping over the EXISTING FULL_ACTIVITY_CATALOG. It
 * never adds activities, never changes catalog metadata (windows, muhurta
 * family, evaluation depth) and never touches scheduling: every id below is
 * an existing EVERYDAY-planning catalog activity, the same set the guest
 * timing-search endpoint (guestTimingSearchRequest.ts) already accepts.
 * Chips always show the catalog's own title and icon, so the label a guest
 * taps is exactly the activity that is planned and saved.
 *
 * Not yet in the catalog (recorded as a future catalog enhancement, NOT
 * implemented here): Important Meeting, Presentation, Networking,
 * Brainstorming, Health Checkup, Financial Planning, Home Tasks, Creative
 * Time.
 */
import { FULL_ACTIVITY_CATALOG, type ActivityProfile } from '../../../packages/recommendation/src/personalizedTasks';
import { getActivityDefinition } from '../../../packages/recommendation/src/activityDefinitions';

/** Six balanced suggestions: health, work, personal, growth, personal, health. */
export const POPULAR_ACTIVITY_IDS: readonly string[] = ['workout', 'deep-work', 'date-night', 'learning', 'coffee-tea', 'meditation'];

export interface ActivityDiscoveryCategory {
  id: string;
  label: string;
  icon: string;
  activityIds: readonly string[];
}

export const ACTIVITY_DISCOVERY_CATEGORIES: readonly ActivityDiscoveryCategory[] = [
  { id: 'personal-social', label: 'Personal & Social', icon: '❤️', activityIds: ['date-night', 'dinner-date', 'coffee-tea', 'movie-night', 'road-trip', 'party'] },
  { id: 'work-professional', label: 'Work & Professional', icon: '💼', activityIds: ['deep-work'] },
  { id: 'health-fitness', label: 'Health & Fitness', icon: '🏃', activityIds: ['workout', 'meditation', 'walk-together'] },
  { id: 'growth-everyday', label: 'Growth & Everyday Life', icon: '🌱', activityIds: ['learning', 'family-outing'] },
];

export const GUEST_ACTIVITY_SEARCH_PLACEHOLDER = 'e.g. Dinner, Workout, Focus...';
export const GUEST_ACTIVITY_SEARCH_MAX_RESULTS = 8;

/** True when the guest flow (and the guest timing-search endpoint) can plan this activity. */
export function isGuestPlannableActivity(activity: ActivityProfile): boolean {
  return getActivityDefinition(activity)?.experience.planningMode === 'EVERYDAY';
}

/** The guest-plannable catalog activities, in catalog order (search pool -- unchanged from before DISC-01). */
export function getGuestPlannableActivities(): ActivityProfile[] {
  return FULL_ACTIVITY_CATALOG.filter(isGuestPlannableActivity);
}

/** Resolves ids to guest-plannable catalog activities, preserving order, dropping unknown/non-EVERYDAY ids and duplicates. */
export function resolveDiscoveryActivities(ids: readonly string[]): ActivityProfile[] {
  const seen = new Set<string>();
  const out: ActivityProfile[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const activity = FULL_ACTIVITY_CATALOG.find((a) => a.id === id);
    if (!activity || !isGuestPlannableActivity(activity)) continue;
    seen.add(id);
    out.push(activity);
  }
  return out;
}

/**
 * The existing guest search (title substring or alias substring, 2+ chars,
 * capped) with one addition: results are de-duplicated by activity id, so an
 * activity shown in both Popular and a category is still listed once.
 */
export function searchGuestActivities(query: string, pool: readonly ActivityProfile[] = getGuestPlannableActivities()): ActivityProfile[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const seen = new Set<string>();
  const out: ActivityProfile[] = [];
  for (const a of pool) {
    if (seen.has(a.id)) continue;
    if (a.title.toLowerCase().includes(q) || a.aliases.some((alias) => alias.includes(q))) {
      seen.add(a.id);
      out.push(a);
      if (out.length >= GUEST_ACTIVITY_SEARCH_MAX_RESULTS) break;
    }
  }
  return out;
}
