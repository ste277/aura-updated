/**
 * Personal Themes Engine V1 -- structured evidence builders.
 *
 * Every eligibility/reinforcement fact this engine derives produces TWO
 * evidence refs where a source Bhrigu fact exists: this engine's OWN
 * interpretation rule (source: 'PERSONAL_THEMES') and the underlying
 * Bhrigu-native evidence it was derived from (source: 'BHRIGU_NATAL') --
 * both are preserved, never replacing one with the other (see README.md's
 * "Explainability" section). None of these ever contain prediction prose.
 * Mapping (eligibility) evidence and relationship/chain (reinforcement)
 * evidence are both built here -- only the latter carries a numeric
 * `contribution`/`edgeStrength`/`chainScore` in its own `data`, since only
 * reinforcement contributes to a theme's raw score (see types.ts).
 */
import { PERSONAL_THEMES_RULE_VERSION, mappingRuleId, relationshipSharedRuleId, chainRuleId } from './provenance';
import type { PlanetId, BhriguRelationshipType } from '../../bhrigu/src/types';
import type { PersonalTheme } from '../../personal-intelligence/src/types';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';

/**
 * Eligibility/provenance evidence for one mapping rule -- documents WHY a
 * planet is eligible to support a theme, never a numeric score
 * contribution (see types.ts's own ThemeEligibility doc comment). `weight`
 * is carried through only for provenance/inspection (it is always 1.0 in
 * V1's own mapping table); it is never summed into a theme's raw score.
 */
export function buildThemeMappingEvidence(params: {
  planet: PlanetId;
  karaka: string;
  theme: PersonalTheme;
  weight: number;
}): PersonalEvidenceRef {
  return {
    source: 'PERSONAL_THEMES',
    ruleId: mappingRuleId(params.planet, params.karaka, params.theme),
    ruleVersion: PERSONAL_THEMES_RULE_VERSION,
    summary: `${params.planet}'s ${params.karaka} karaka establishes eligibility to support ${params.theme}.`,
    data: { planet: params.planet, karaka: params.karaka, theme: params.theme, weight: params.weight },
  };
}

/** Bridges back to the underlying Bhrigu karaka rule (PLANET_KARAKAS[planet].sourceRuleId/version) that this eligibility's karaka came from. */
export function buildBhriguKarakaBridgeEvidence(params: {
  planet: PlanetId;
  karaka: string;
  bhriguRuleId: string;
  bhriguRuleVersion: string;
}): PersonalEvidenceRef {
  return {
    source: 'BHRIGU_NATAL',
    ruleId: params.bhriguRuleId,
    ruleVersion: params.bhriguRuleVersion,
    data: { planet: params.planet, karaka: params.karaka },
  };
}

export function buildRelationshipSharedThemeEvidence(params: {
  from: PlanetId;
  to: PlanetId;
  theme: PersonalTheme;
  relationship: BhriguRelationshipType;
  edgeStrength: number;
  contribution: number;
}): PersonalEvidenceRef {
  return {
    source: 'PERSONAL_THEMES',
    ruleId: relationshipSharedRuleId(params.theme),
    ruleVersion: PERSONAL_THEMES_RULE_VERSION,
    summary: `${params.from} and ${params.to} both support ${params.theme}, connected by a ${params.relationship} relationship.`,
    data: {
      from: params.from,
      to: params.to,
      theme: params.theme,
      relationship: params.relationship,
      edgeStrength: params.edgeStrength,
      contribution: params.contribution,
    },
  };
}

/** Bridges back to the underlying Bhrigu relationship-edge evidence (edge.sourceRuleId, and ruleVersion taken from that edge's own evidence entry). */
export function buildBhriguRelationshipBridgeEvidence(params: {
  from: PlanetId;
  to: PlanetId;
  bhriguRuleId: string;
  bhriguRuleVersion: string;
}): PersonalEvidenceRef {
  return {
    source: 'BHRIGU_NATAL',
    ruleId: params.bhriguRuleId,
    ruleVersion: params.bhriguRuleVersion,
    data: { from: params.from, to: params.to },
  };
}

export function buildChainThemeEvidence(params: {
  chainId: string;
  chainPlanets: PlanetId[];
  theme: PersonalTheme;
  supportingPlanetCount: number;
  chainScore: number;
  contribution: number;
}): PersonalEvidenceRef {
  return {
    source: 'PERSONAL_THEMES',
    ruleId: chainRuleId(params.theme),
    ruleVersion: PERSONAL_THEMES_RULE_VERSION,
    summary: `${params.supportingPlanetCount} planets in one connected chain support ${params.theme}.`,
    data: {
      chainId: params.chainId,
      chainPlanets: params.chainPlanets,
      theme: params.theme,
      supportingPlanetCount: params.supportingPlanetCount,
      chainScore: params.chainScore,
      contribution: params.contribution,
    },
  };
}

/** Bridges back to the underlying Bhrigu chain evidence (BHRIGU_CHAIN_CONNECTED_COMPONENT_V1), found in the source BhriguNatalResult's own evidence array rather than duplicated here. */
export function buildBhriguChainBridgeEvidence(params: {
  chainPlanets: PlanetId[];
  bhriguRuleId: string;
  bhriguRuleVersion: string;
}): PersonalEvidenceRef {
  return {
    source: 'BHRIGU_NATAL',
    ruleId: params.bhriguRuleId,
    ruleVersion: params.bhriguRuleVersion,
    data: { chainPlanets: params.chainPlanets },
  };
}

/**
 * Deduplicates a list of PersonalEvidenceRef by stable identity
 * (source + ruleId + JSON-serialized data), never by `summary` alone
 * (two refs can carry the same human-readable summary while describing
 * genuinely different facts, or vice versa) -- see this file's own
 * module doc comment and README.md's "Evidence deduplication" section.
 * Preserves first-occurrence order, so the result stays deterministic as
 * long as the input order is (which it always is here: callers always
 * build this from an already-canonically-ordered PERSONAL_THEMES sweep).
 */
export function dedupeEvidenceRefs(refs: PersonalEvidenceRef[]): PersonalEvidenceRef[] {
  const seen = new Set<string>();
  const result: PersonalEvidenceRef[] = [];
  for (const ref of refs) {
    const key = `${ref.source}|${ref.ruleId}|${JSON.stringify(ref.data ?? null)}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ref);
    }
  }
  return result;
}
