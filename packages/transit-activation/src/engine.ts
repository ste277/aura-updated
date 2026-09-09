/**
 * Transit Activation Engine V1 -- pure core engine.
 *
 * Works entirely from already-normalized sidereal zodiac signs plus an
 * explicit, caller-supplied evaluation instant -- it never calculates
 * planetary longitude/transits itself and never reads ambient time (see
 * types.ts's own doc comment). See adapter.ts for the bridge from real
 * Aura natal/transit GrahaPosition[] results to this shape.
 */
import { TRANSIT_ACTIVATION_PLANETS, TRANSIT_ACTIVATION_PAIR_COUNT } from './constants';
import { evaluateAllPairs } from './activation';
import { dedupeEvidenceRefs, buildSummaryEvidence } from './evidence';
import { assertValidInput } from './validation';
import { TRANSIT_ACTIVATION_ENGINE_VERSION, TRANSIT_RELATIONSHIP_RULESET_VERSION } from './provenance';
import type { TransitActivationInput, TransitActivationResult, TransitActivationEvidenceRef } from './types';

/**
 * The core public entry point. Given already-normalized sidereal signs
 * for the 9 canonical planets (natal + transit) and an explicit
 * evaluation instant, deterministically evaluates all
 * TRANSIT_ACTIVATION_PAIR_COUNT (81) directed pairs and returns only the
 * non-NONE activations -- see README.md's "Filtering" section.
 *
 * Rejects: a missing/invalid/non-integer/out-of-range sign for any
 * required planet, or a malformed evaluationTime (see validation.ts).
 * Contains no ambient time/randomness of any kind -- `evaluationTime`
 * is never computed here, only validated for shape and echoed through.
 */
export function calculateTransitActivation(input: TransitActivationInput): TransitActivationResult {
  assertValidInput(input);

  const allPairs = evaluateAllPairs(input.natalSigns, input.transitSigns);
  const activations = allPairs.filter((pair) => pair.relationship !== 'NONE');

  const summaryEvidence = buildSummaryEvidence({
    evaluationTime: input.evaluationTime,
    evaluatedPlanetCount: TRANSIT_ACTIVATION_PLANETS.length,
    pairCount: TRANSIT_ACTIVATION_PAIR_COUNT,
    activationCount: activations.length,
  });

  const evidence: TransitActivationEvidenceRef[] = dedupeEvidenceRefs([summaryEvidence, ...activations.flatMap((pair) => pair.evidence)]);

  return {
    engineVersion: TRANSIT_ACTIVATION_ENGINE_VERSION,
    relationshipRulesetVersion: TRANSIT_RELATIONSHIP_RULESET_VERSION,
    evaluationTime: input.evaluationTime,
    evaluatedPlanets: TRANSIT_ACTIVATION_PLANETS,
    activations,
    evidence,
  };
}
