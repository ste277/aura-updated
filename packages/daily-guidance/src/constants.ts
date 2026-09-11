/**
 * Daily Guidance Composer V1 -- structural constants.
 *
 * `MuhurtaActivityFamily` is imported directly from packages/muhurta and
 * `TimingCandidateLabel` directly from packages/recommendation -- this
 * package (like packages/daily-personal-fit and packages/window-ranking
 * before it) is allowed to depend on upstream domain packages; only
 * packages/personal-intelligence itself must stay at zero cross-package
 * imports (see that package's own README "Dependency direction" section).
 *
 * `CANONICAL_ACTIVITY_FAMILIES` is independently re-declared here (a
 * THIRD copy, alongside packages/daily-personal-fit's and
 * packages/window-ranking's own), matching those two packages' own
 * established precedent of not extracting a shared runtime array --
 * packages/muhurta itself exports only the TYPE, no runtime array, and
 * this package deliberately does not introduce a new shared-constants
 * dependency between three otherwise-independent packages for a single
 * literal list.
 */
import type { MuhurtaActivityFamily } from '../../muhurta/src/muhurtaEngine';
import type { TimingCandidateLabel } from '../../recommendation/src/timingSearch';
import type { BehavioralAffinityTier } from './types';

/** The complete, fixed canonical order used for final deterministic tie-breaking (see ordering.ts) -- never used to re-sort or exclude a family from the input itself. */
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

/**
 * ORDINAL ordering keys only (merge-critical distinction, see README.md's
 * "No numeric composite" section) -- these indices are compared against
 * EACH OTHER within one axis (relevance-to-relevance, or timing-label-to-
 * timing-label), NEVER added, multiplied, or otherwise combined across
 * axes into a single number. A lower index sorts first (= better).
 */
export const RELEVANCE_TIER_ORDER: Record<'HIGHLY_RELEVANT' | 'RELEVANT' | 'BASELINE', number> = {
  HIGHLY_RELEVANT: 0,
  RELEVANT: 1,
  BASELINE: 2,
};

/** See RELEVANCE_TIER_ORDER's own doc comment -- the identical ordinal-only discipline applies here. CAUTION is included only so the type is total; a CAUTION-labeled window is filtered out in eligibility.ts long before ordering.ts ever runs, and never actually reaches this comparison. */
export const TIMING_LABEL_TIER_ORDER: Record<TimingCandidateLabel, number> = {
  EXCELLENT: 0,
  VERY_GOOD: 1,
  GOOD: 2,
  USABLE: 3,
  CAUTION: 4,
};

/** Stage 1's timing floor (see eligibility.ts). */
export const PRIMARY_TIMING_LABELS: readonly TimingCandidateLabel[] = ['EXCELLENT', 'VERY_GOOD', 'GOOD'];
/** Stage 2's relaxed timing floor. */
export const RELAXED_TIMING_LABELS: readonly TimingCandidateLabel[] = ['USABLE'];

export const DEFAULT_LIMIT = 3;

/**
 * Behavioral Integration V1 -- see RELEVANCE_TIER_ORDER's own doc comment
 * above; the identical ordinal-only discipline applies here. A lower index
 * sorts first (= stronger, preferred). Consulted by ordering.ts ONLY after
 * personal relevance, timing label, AND timing score have all already
 * tied -- see ordering.ts's own doc comment for why affinity sits there
 * and not higher in the tuple.
 */
export const BEHAVIORAL_AFFINITY_TIER_ORDER: Record<BehavioralAffinityTier, number> = {
  STRONG: 0,
  MODERATE: 1,
  NEUTRAL: 2,
};
