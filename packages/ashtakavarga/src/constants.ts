/**
 * Ashtakavarga Engine V1 -- constants.
 *
 * Repository audit (see ../README.md's "Repository audit" section and
 * this PR's own implementation report for the full trace): no
 * Ashtakavarga calculation exists anywhere in this repository prior to
 * this package -- every existing hit is a forward-looking placeholder
 * (packages/personal-intelligence's own `PersonalSupportContext.system:
 * 'ASHTAKAVARGA'` string literal) or an explicit NOT_IMPLEMENTED note.
 * This package is the first real Ashtakavarga producer.
 */
import type { AshtakavargaTargetPlanet, AshtakavargaContributor } from './types';

/** Canonical target-planet order -- used for deterministic result/evidence ordering. Not a Vimshottari-style dasha sequence; simple, stable Sun-first classical listing order. */
export const ASHTAKAVARGA_TARGETS: readonly AshtakavargaTargetPlanet[] = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

/** Canonical contributor order -- the 7 targets, then Lagna last. Used for deterministic per-sign contribution ordering (prastara.ts). */
export const ASHTAKAVARGA_CONTRIBUTORS: readonly AshtakavargaContributor[] = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Lagna'];

export const ASHTAKAVARGA_TARGET_COUNT = ASHTAKAVARGA_TARGETS.length; // 7
export const ASHTAKAVARGA_CONTRIBUTOR_COUNT = ASHTAKAVARGA_CONTRIBUTORS.length; // 8

export const ZODIAC_SIGN_COUNT = 12;

/**
 * Each target planet's fixed classical Bhinnashtakavarga grand total --
 * the sum of that target's own 8 contributor rules' house-list lengths.
 * Independent of any chart: a valid chart's calculated BAV total must
 * ALWAYS equal this value (see README.md's "Why fixed totals must
 * hold" section) -- verified independently in rules.ts's own doc
 * comment and in test/ashtakavargaEngine.test.ts's own rule-table
 * integrity suite, using values hard-coded independently of this
 * constant (never `EXPECTED = productionValue`).
 */
export const ASHTAKAVARGA_FIXED_TOTALS: Readonly<Record<AshtakavargaTargetPlanet, number>> = {
  Sun: 48,
  Moon: 49,
  Mars: 39,
  Mercury: 54,
  Jupiter: 56,
  Venus: 52,
  Saturn: 39,
};

/** The fixed classical Sarvashtakavarga grand total -- the sum of all 7 targets' own fixed totals (48+49+39+54+56+52+39). Always 337 for a valid chart. */
export const ASHTAKAVARGA_SAV_FIXED_TOTAL = 337;
