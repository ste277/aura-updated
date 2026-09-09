/**
 * Transit Activation Engine V1 -- structured evidence builders.
 *
 * Every activation gets its own TransitActivationEvidenceRef, source:
 * 'TRANSIT_ACTIVATION' (already part of packages/personal-intelligence's
 * own PersonalEvidenceSource union -- no contract change needed). Stable
 * rule ids only (provenance.ts / relationships.ts) -- never generated at
 * runtime, never timestamped. Deliberately compact: no upstream chart/
 * graph payloads embedded (see README.md's "Payload size discipline"
 * section).
 */
import { TRANSIT_ACTIVATION_RULE_VERSION, TRANSIT_ACTIVATION_SUMMARY_V1 } from './provenance';
import type { TransitActivationEvidenceRef, TransitActivationPlanet, TransitRelationship, ZodiacSign } from './types';

export function buildActivationEvidence(params: {
  transitingPlanet: TransitActivationPlanet;
  natalPlanet: TransitActivationPlanet;
  transitSign: ZodiacSign;
  natalSign: ZodiacSign;
  relationship: TransitRelationship;
  strength: number;
  ruleId: string;
}): TransitActivationEvidenceRef {
  return {
    source: 'TRANSIT_ACTIVATION',
    ruleId: params.ruleId,
    ruleVersion: TRANSIT_ACTIVATION_RULE_VERSION,
    summary: `Transiting ${params.transitingPlanet} (sign ${params.transitSign}) is ${params.relationship} relative to natal ${params.natalPlanet} (sign ${params.natalSign}) -- activation strength ${params.strength}.`,
    data: {
      transitingPlanet: params.transitingPlanet,
      natalPlanet: params.natalPlanet,
      transitSign: params.transitSign,
      natalSign: params.natalSign,
      relationship: params.relationship,
      strength: params.strength,
    },
  };
}

export function buildSummaryEvidence(params: { evaluationTime: string; evaluatedPlanetCount: number; pairCount: number; activationCount: number }): TransitActivationEvidenceRef {
  return {
    source: 'TRANSIT_ACTIVATION',
    ruleId: TRANSIT_ACTIVATION_SUMMARY_V1,
    ruleVersion: TRANSIT_ACTIVATION_RULE_VERSION,
    summary: `Evaluated ${params.evaluatedPlanetCount} planets (${params.pairCount} directed pairs) at ${params.evaluationTime}; ${params.activationCount} non-NONE activations found.`,
    data: {
      evaluationTime: params.evaluationTime,
      evaluatedPlanetCount: params.evaluatedPlanetCount,
      pairCount: params.pairCount,
      activationCount: params.activationCount,
    },
  };
}

/** Deduplicates a list of TransitActivationEvidenceRef by stable identity (source + ruleId + JSON-serialized data), matching the exact same pattern already established in packages/bhrigu, packages/personal-themes, packages/vimshottari, packages/lagna, and packages/ashtakavarga. Preserves first-occurrence order. */
export function dedupeEvidenceRefs(refs: readonly TransitActivationEvidenceRef[]): TransitActivationEvidenceRef[] {
  const seen = new Set<string>();
  const result: TransitActivationEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source}|${ref.ruleId}|${JSON.stringify(ref.data ?? null)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
