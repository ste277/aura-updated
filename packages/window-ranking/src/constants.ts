/**
 * Window Ranking Engine V1 -- structural constants.
 *
 * `MuhurtaActivityFamily` itself has no exported runtime array anywhere in
 * packages/muhurta (only the TS type union) -- every consumer that needs
 * the concrete 13-value list at runtime (validation here; an analogous,
 * independently-defined list already exists in packages/daily-personal-fit/
 * src/constants.ts) must define its own literal copy. This package does
 * NOT import that list from packages/daily-personal-fit -- see this
 * package's own README.md "Personal relevance absent" section: #103 has
 * zero reference to that package, so this list is repeated here rather
 * than shared.
 */
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';

/** The 13 canonical, scoring-keyed activity families -- used here only for input validation (rejecting a non-canonical value), never for ranking/sorting logic. */
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
