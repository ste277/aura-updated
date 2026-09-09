/**
 * Transit Activation Engine V1 -- directed pair evaluation.
 *
 * For every (transitingPlanet, natalPlanet) ordered pair -- including
 * self-pairs, e.g. transiting Saturn -> natal Saturn, a real "Saturn
 * return"-type event -- classifies the sign relationship and looks up
 * its strength. `evaluateAllPairs` deliberately returns ALL N*N pairs
 * (including NONE), never pre-filtered; engine.ts's own public function
 * is the one place that filters to non-NONE activations (see
 * README.md's "Filtering" section) -- keeping this function's own
 * output complete makes it independently testable for exact pair count
 * (test/transitActivationEngine.test.ts's own "all pairs" suite).
 */
import { TRANSIT_ACTIVATION_PLANETS } from './constants';
import { classifyTransitRelationship, transitRelationshipStrength, transitRelationshipRuleId } from './relationships';
import { buildActivationEvidence } from './evidence';
import type { TransitActivationPlanet, TransitActivationPair, ZodiacSign } from './types';

/**
 * One directed pair's full evaluation. The relationship distance is
 * computed as "transit sign relative to natal sign" (natalSign is the
 * `from`, transitSign is the `to`) -- matching this PR's own locked
 * convention `distance = (transitSign - natalSign + 12) % 12` -- even
 * though the resulting relationship CATEGORY is symmetric either way
 * (see relationships.ts's own doc comment); this choice only affects
 * which direction is documented/shown, never the classification result.
 */
export function evaluatePair(transitingPlanet: TransitActivationPlanet, natalPlanet: TransitActivationPlanet, transitSign: ZodiacSign, natalSign: ZodiacSign): TransitActivationPair {
  const relationship = classifyTransitRelationship(natalSign, transitSign);
  const strength = transitRelationshipStrength(relationship);
  const ruleId = transitRelationshipRuleId(relationship);

  return {
    transitingPlanet,
    natalPlanet,
    transitSign,
    natalSign,
    relationship,
    strength,
    ruleId,
    evidence: [buildActivationEvidence({ transitingPlanet, natalPlanet, transitSign, natalSign, relationship, strength, ruleId })],
  };
}

/**
 * All TRANSIT_ACTIVATION_PLANET_COUNT^2 directed pairs (81 for the full
 * 9-planet set), in canonical TRANSIT_ACTIVATION_PLANETS x
 * TRANSIT_ACTIVATION_PLANETS order (outer loop = transiting planet,
 * inner loop = natal planet) -- never sorted, never Map/Set iteration
 * order. Includes NONE-relationship pairs; see this file's own module
 * doc comment for why filtering happens one level up.
 */
export function evaluateAllPairs(natalSigns: Record<TransitActivationPlanet, ZodiacSign>, transitSigns: Record<TransitActivationPlanet, ZodiacSign>): TransitActivationPair[] {
  const pairs: TransitActivationPair[] = [];

  for (const transitingPlanet of TRANSIT_ACTIVATION_PLANETS) {
    for (const natalPlanet of TRANSIT_ACTIVATION_PLANETS) {
      pairs.push(evaluatePair(transitingPlanet, natalPlanet, transitSigns[transitingPlanet], natalSigns[natalPlanet]));
    }
  }

  return pairs;
}
