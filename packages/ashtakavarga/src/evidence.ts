/**
 * Ashtakavarga Engine V1 -- structured evidence builders.
 *
 * Every contribution and every aggregate this engine derives gets its
 * own AshtakavargaEvidenceRef, source: 'ASHTAKAVARGA'. Stable rule ids
 * only (rules.ts's own per-rule ruleId, or the aggregate rule IDs in
 * provenance.ts) -- never generated at runtime, never timestamped.
 */
import { ASHTAKAVARGA_RULE_VERSION, ASHTAKAVARGA_BAV_SIGN_SUM_V1, ASHTAKAVARGA_BAV_TOTAL_V1, ASHTAKAVARGA_SAV_SIGN_SUM_V1, ASHTAKAVARGA_SAV_TOTAL_V1 } from './provenance';
import type { AshtakavargaEvidenceRef, AshtakavargaTargetPlanet, AshtakavargaContributor, ZodiacSign, RelativeHouse, AshtakavargaPoint } from './types';

export function buildContributionEvidence(params: {
  target: AshtakavargaTargetPlanet;
  contributor: AshtakavargaContributor;
  contributorSign: ZodiacSign;
  destinationSign: ZodiacSign;
  relativeHouse: RelativeHouse;
  point: AshtakavargaPoint;
  ruleId: string;
}): AshtakavargaEvidenceRef {
  return {
    source: 'ASHTAKAVARGA',
    ruleId: params.ruleId,
    ruleVersion: ASHTAKAVARGA_RULE_VERSION,
    summary: `${params.target} <- ${params.contributor} (natal sign ${params.contributorSign}): sign ${params.destinationSign} is relative house ${params.relativeHouse} from ${params.contributor}, which is ${params.point === 1 ? '' : 'NOT '}an allowed house for ${params.target} -- point ${params.point}.`,
    data: {
      target: params.target,
      contributor: params.contributor,
      contributorSign: params.contributorSign,
      destinationSign: params.destinationSign,
      relativeHouse: params.relativeHouse,
      point: params.point,
    },
  };
}

export function buildBavSignSumEvidence(params: { target: AshtakavargaTargetPlanet; sign: ZodiacSign; total: number }): AshtakavargaEvidenceRef {
  return {
    source: 'ASHTAKAVARGA',
    ruleId: ASHTAKAVARGA_BAV_SIGN_SUM_V1,
    ruleVersion: ASHTAKAVARGA_RULE_VERSION,
    summary: `${params.target} Bhinnashtakavarga sign ${params.sign} total = ${params.total} (sum of its 8 contributor points).`,
    data: { target: params.target, sign: params.sign, total: params.total },
  };
}

export function buildBavTotalEvidence(params: { target: AshtakavargaTargetPlanet; total: number }): AshtakavargaEvidenceRef {
  return {
    source: 'ASHTAKAVARGA',
    ruleId: ASHTAKAVARGA_BAV_TOTAL_V1,
    ruleVersion: ASHTAKAVARGA_RULE_VERSION,
    summary: `${params.target} Bhinnashtakavarga grand total = ${params.total} (the fixed classical value for this target, sum across all 12 signs).`,
    data: { target: params.target, total: params.total },
  };
}

export function buildSavSignSumEvidence(params: { sign: ZodiacSign; total: number }): AshtakavargaEvidenceRef {
  return {
    source: 'ASHTAKAVARGA',
    ruleId: ASHTAKAVARGA_SAV_SIGN_SUM_V1,
    ruleVersion: ASHTAKAVARGA_RULE_VERSION,
    summary: `Sarvashtakavarga sign ${params.sign} total = ${params.total} (sum of the seven BAV values for this sign).`,
    data: { sign: params.sign, total: params.total },
  };
}

export function buildSavTotalEvidence(params: { total: number }): AshtakavargaEvidenceRef {
  return {
    source: 'ASHTAKAVARGA',
    ruleId: ASHTAKAVARGA_SAV_TOTAL_V1,
    ruleVersion: ASHTAKAVARGA_RULE_VERSION,
    summary: `Sarvashtakavarga grand total = ${params.total} (the fixed classical value, sum across all 12 signs).`,
    data: { total: params.total },
  };
}

/** Deduplicates a list of AshtakavargaEvidenceRef by stable identity (source + ruleId + JSON-serialized data), matching the exact same pattern already established in packages/bhrigu, packages/personal-themes, packages/vimshottari, and packages/lagna. Preserves first-occurrence order. */
export function dedupeEvidenceRefs(refs: readonly AshtakavargaEvidenceRef[]): AshtakavargaEvidenceRef[] {
  const seen = new Set<string>();
  const result: AshtakavargaEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source}|${ref.ruleId}|${JSON.stringify(ref.data ?? null)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
