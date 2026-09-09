/**
 * Bhrigu Natal Foundation V1 -- constants and versioning.
 */
import type { BhriguRelationshipWeights, PlanetId } from './types';

/** Engine-level version, carried on every BhriguNatalResult (see graph.ts). */
export const ENGINE_VERSION = 'BHRIGU_NATAL_V1';

/** Shared rule-version string for V1 evidence/karaka entries -- a single constant so every rule's version bumps together if this package's interpretive model itself is ever revised as a whole; an individual rule can still gain its own distinct sourceRuleId (e.g. _V2) without waiting for that. */
export const RULE_VERSION_V1 = '1.0.0';

/**
 * Fixed canonical planet order -- the SAME order packages/vedic/src/
 * natalChart.ts's own getNatalChart() already returns (its 7 classical
 * bodies array, then Rahu, then Ketu). Every ordering guarantee this
 * package makes (node order, edge order, chain-member order) is derived
 * by iterating THIS array, never by sorting caller input or relying on
 * object-key/Map iteration order -- that is the entire determinism
 * strategy (see graph.ts/chains.ts's own doc comments).
 */
export const SUPPORTED_PLANETS: readonly PlanetId[] = [
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Rahu', 'Ketu',
];

/**
 * V1 default relationship-strength weights. Product-model configuration,
 * not scientific or scriptural truth -- see README.md's "Default strength
 * configuration" section. Callers may override via
 * BhriguNatalOptions.weights (validated by validateRelationshipWeights
 * below before use).
 */
export const DEFAULT_RELATIONSHIP_WEIGHTS: BhriguRelationshipWeights = {
  sameSign: 1.0,
  trine: 0.75,
  opposition: 0.5,
  threeEleven: 0.25,
  twoTwelve: 0.15,
  none: 0.0,
};

/**
 * Rejects a weights config containing any non-finite (NaN/Infinity) value
 * -- the one hard validation rule the brief calls out explicitly. Does
 * NOT clamp to [0, 1] or otherwise second-guess the caller's chosen
 * product-model numbers; a caller intentionally experimenting with
 * out-of-range weights is not this function's concern, only genuinely
 * unusable numbers are.
 */
export function validateRelationshipWeights(weights: BhriguRelationshipWeights): void {
  const entries = Object.entries(weights) as [keyof BhriguRelationshipWeights, number][];
  for (const [key, value] of entries) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`BhriguRelationshipWeights.${key} must be a finite number, got: ${value}`);
    }
  }
}
