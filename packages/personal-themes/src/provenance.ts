/**
 * Personal Themes Engine V1 -- provenance/versioning.
 *
 * Three distinct version concepts now exist across the two packages this
 * engine bridges, all kept explicit and never conflated:
 *
 * PERSONAL_THEMES_ENGINE_VERSION = 'PERSONAL_THEMES_V1'   (this engine's own version)
 * source Bhrigu engineVersion    = 'BHRIGU_NATAL_V1'      (packages/bhrigu -- consumed, not owned)
 * contract version               = 'PERSONAL_INTELLIGENCE_CONTRACT_V1' (packages/personal-intelligence -- consumed, not owned)
 */
import type { PersonalTheme } from '../../personal-intelligence/src/types';

export const PERSONAL_THEMES_ENGINE_VERSION = 'PERSONAL_THEMES_V1' as const;

/** V1 requires exactly this Bhrigu engine version -- see engine.ts's own validation. */
export const REQUIRED_BHRIGU_ENGINE_VERSION = 'BHRIGU_NATAL_V1';

/** Shared rule-version string for every mapping/relationship/chain rule this engine defines. */
export const PERSONAL_THEMES_RULE_VERSION = '1.0.0';

/**
 * Stable rule id for one base karaka->theme mapping. Always includes the
 * karaka (never just planet+theme): a single planet can map more than one
 * of its own karakas to the SAME theme (e.g. Saturn's "discipline" and
 * "delay" both map to FOCUS), and each is a genuinely distinct rule that
 * needs its own id.
 */
export function mappingRuleId(planet: string, karaka: string, theme: PersonalTheme): string {
  return `PERSONAL_THEME_MAP_${planet.toUpperCase()}_${karaka.toUpperCase()}_${theme}_V1`;
}

/** Stable rule id for shared-theme relationship amplification of one theme. */
export function relationshipSharedRuleId(theme: PersonalTheme): string {
  return `PERSONAL_THEME_REL_SHARED_${theme}_V1`;
}

/** Stable rule id for chain amplification of one theme. */
export function chainRuleId(theme: PersonalTheme): string {
  return `PERSONAL_THEME_CHAIN_${theme}_V1`;
}

/**
 * Provenance reference for this engine's normalization step itself.
 * Deliberately NOT attached as its own evidence entry anywhere (see
 * evidence.ts's own doc comment): normalization is a derived computation
 * over already-explained contributions, not itself a fact needing
 * separate evidence -- this constant exists for documentation/provenance
 * completeness (README.md, tests), not for use as a live PersonalEvidenceRef.ruleId.
 */
export const NORMALIZE_RULE_ID = 'PERSONAL_THEME_NORMALIZE_V1';
