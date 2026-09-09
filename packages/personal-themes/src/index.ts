/**
 * Personal Themes Engine V1 -- public API.
 *
 * See ../README.md for what this engine does (converts packages/bhrigu's
 * structured natal evidence into packages/personal-intelligence's
 * PersonalThemeContext using a REINFORCEMENT-ONLY scoring model), what V1
 * does not do (no Dasha, transits, Ashtakavarga, daily personalization,
 * activity-fit scoring, or recommendation ranking), and the exact scoring
 * formula.
 */
export { deriveThemeContext, validateBhriguNatalResult } from './engine';

export { THEME_MAPPING_RULES, getMappingRulesForPlanetKaraka, getMappingRulesForTheme, getDistinctSupportingPlanets, distinctSupportingPlanetCount } from './mappings';

export {
  extractThemeMappings,
  computeRelationshipReinforcement,
  computeChainReinforcement,
  aggregateReinforcementScores,
  normalizeThemeScore,
  classifyDirection,
  deriveThemeReinforcementCeiling,
  chainIdentity,
  validatePersonalThemeEngineConfig,
  DEFAULT_PERSONAL_THEME_ENGINE_CONFIG,
} from './scoring';

export { dedupeEvidenceRefs } from './evidence';

export {
  PERSONAL_THEMES_ENGINE_VERSION,
  REQUIRED_BHRIGU_ENGINE_VERSION,
  PERSONAL_THEMES_RULE_VERSION,
  NORMALIZE_RULE_ID,
  mappingRuleId,
  relationshipSharedRuleId,
  chainRuleId,
} from './provenance';

export type { ThemeMappingRule, ThemeEligibility, ThemeReinforcementContribution, PersonalThemeEngineConfig, PersonalThemeEngineOptions } from './types';
export { PersonalThemesValidationError } from './types';
