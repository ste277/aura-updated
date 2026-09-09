/**
 * Transit Activation Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (deterministically detects
 * sign-level transit-to-natal activation geometry from already-known
 * sidereal Rashi placements plus an explicit evaluation instant), what
 * it does not do (no Life Weather, no Daily Personal Fit, no Ashtakavarga
 * transit support, no Dasha synthesis, no Bhrigu graph traversal, no
 * interpretation/polarity/recommendations), and the exact convention
 * (Bhrigu's own sign-relationship classification and weights, reused
 * verbatim; 9 canonical planets including Rahu/Ketu; directional
 * transiting->natal pair identity).
 */
export { calculateTransitActivation } from './engine';
export { calculateTransitActivationFromPositions, toTransitActivationContext } from './adapter';
export { evaluatePair, evaluateAllPairs } from './activation';
export { classifyTransitRelationship, transitRelationshipStrength, transitRelationshipRuleId } from './relationships';
export { dedupeEvidenceRefs } from './evidence';

export {
  TRANSIT_ACTIVATION_ENGINE_VERSION,
  TRANSIT_RELATIONSHIP_RULESET_VERSION,
  TRANSIT_ACTIVATION_RULE_VERSION,
  TRANSIT_ACTIVATION_SAME_SIGN_V1,
  TRANSIT_ACTIVATION_TRINE_V1,
  TRANSIT_ACTIVATION_OPPOSITION_V1,
  TRANSIT_ACTIVATION_THREE_ELEVEN_V1,
  TRANSIT_ACTIVATION_TWO_TWELVE_V1,
  TRANSIT_ACTIVATION_NONE_V1,
  TRANSIT_ACTIVATION_SUMMARY_V1,
} from './provenance';

export { TRANSIT_ACTIVATION_PLANETS, TRANSIT_ACTIVATION_PLANET_COUNT, TRANSIT_ACTIVATION_PAIR_COUNT } from './constants';

export type {
  ZodiacSign,
  TransitActivationPlanet,
  TransitRelationship,
  TransitActivationEvidenceRef,
  TransitActivationPair,
  TransitActivationInput,
  TransitActivationResult,
} from './types';
export { TransitActivationValidationError } from './types';
