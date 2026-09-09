/**
 * Bhrigu Natal Foundation V1 -- structured evidence builders.
 *
 * Every builder here returns data only: a rule id, its version, which
 * planets are involved, and the concrete facts that led to the
 * conclusion. None of these ever contain prediction prose ("you will...",
 * "this means...") -- that is a deliberate product boundary (see
 * README.md), not an oversight.
 */
import { RULE_VERSION_V1 } from './constants';
import { CHAIN_CONNECTED_COMPONENT_RULE_ID } from './provenance';
import type {
  BhriguEvidence,
  BhriguRelationshipType,
  PlanetId,
  PlanetKarakaDefinition,
  ZodiacSign,
} from './types';

export function buildKarakaEvidence(definition: PlanetKarakaDefinition): BhriguEvidence {
  return {
    ruleId: definition.sourceRuleId,
    ruleVersion: definition.version,
    category: 'KARAKA',
    planets: [definition.planet],
    facts: { themes: definition.themes },
  };
}

export function buildRelationshipEvidence(params: {
  planetA: PlanetId;
  planetB: PlanetId;
  signA: ZodiacSign;
  signB: ZodiacSign;
  signDistanceAtoB: number;
  signDistanceBtoA: number;
  relationship: BhriguRelationshipType;
  strength: number;
  ruleId: string;
}): BhriguEvidence {
  return {
    ruleId: params.ruleId,
    ruleVersion: RULE_VERSION_V1,
    category: 'RELATIONSHIP',
    planets: [params.planetA, params.planetB],
    facts: {
      signA: params.signA,
      signB: params.signB,
      signDistanceAtoB: params.signDistanceAtoB,
      signDistanceBtoA: params.signDistanceBtoA,
      relationship: params.relationship,
      strength: params.strength,
    },
  };
}

export function buildChainEvidence(planets: PlanetId[], score: number): BhriguEvidence {
  return {
    ruleId: CHAIN_CONNECTED_COMPONENT_RULE_ID,
    ruleVersion: RULE_VERSION_V1,
    category: 'CHAIN',
    planets,
    facts: { chainPlanets: planets, chainScore: score },
  };
}
