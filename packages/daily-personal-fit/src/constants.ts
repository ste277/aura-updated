/**
 * Daily Personal Fit Engine V1 -- structural constants.
 *
 * `MuhurtaActivityFamily` is imported directly from packages/muhurta --
 * this package (unlike packages/personal-intelligence) is allowed to
 * depend on upstream domain packages, matching the exact precedent
 * packages/personal-themes (depends on packages/bhrigu) and
 * packages/life-weather (depends on packages/personal-themes) already
 * established. This is the CANONICAL, scoring-keyed activity-family
 * vocabulary (what packages/muhurta/src/muhurtaEngine.ts's own RULES
 * table is actually keyed on today) -- deliberately NOT the newer,
 * coarser MuhurtaFamily (activityOntology.ts) or ActivityCategory
 * (packages/recommendation), so a future #103 has a direct bridge to
 * real Muhurta/Aura Fit scoring without an extra translation step.
 */
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';

/** The complete, fixed canonical order every DailyPersonalFitContext.activities vector is returned in -- never re-sorted by relevance (ranking is explicitly out of scope, see #103). */
export const CANONICAL_ACTIVITY_FAMILIES: readonly MuhurtaActivityFamily[] = [
  'DEEP_WORK',
  'WORKOUT',
  'LEARNING',
  'MEDITATION',
  'RELATIONSHIP',
  'JOURNEY_START',
  'SOCIAL',
  'MEAL',
  'FINANCE',
  'NEW_BEGINNING',
  'ADMIN',
  'WELLBEING',
  'FOCUSED_WORK',
];

export const CANONICAL_ACTIVITY_FAMILY_COUNT = CANONICAL_ACTIVITY_FAMILIES.length;
