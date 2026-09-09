/**
 * Personal Themes Engine V1 -- shared internal types.
 *
 * This engine converts packages/bhrigu's structured natal evidence into
 * packages/personal-intelligence's PersonalThemeContext. Unlike
 * packages/personal-intelligence itself, this package IS allowed to
 * depend on packages/bhrigu and packages/personal-intelligence (see
 * README.md's "Dependency direction") -- it is their first real
 * consumer, not another zero-dependency contract layer.
 */
import type { PlanetId, BhriguRelationshipType } from '../../bhrigu/src/types';
import type { PersonalTheme } from '../../personal-intelligence/src/types';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';

/**
 * One hand-authored, versioned entry in the V1 Bhrigu-karaka -> Personal
 * Theme mapping table (mappings.ts). Never derived from string similarity
 * at runtime -- the full table is inspectable, hand-authored data.
 */
export interface ThemeMappingRule {
  planet: PlanetId;
  karaka: string;
  theme: PersonalTheme;
  weight: number;
  ruleId: string;
  ruleVersion: string;
}

/**
 * One planet's eligibility to support one theme, established purely by
 * the static mapping table (mappings.ts) -- this is explainability/
 * provenance data, NEVER a numeric score contribution. Every real
 * Bhrigu chart has the same 9 planets present, so "Mercury exists and is
 * eligible to support FINANCE" is true for every chart and carries zero
 * personalizing information on its own -- see scoring.ts's own module
 * doc comment. `evidence` still carries the real mapping-rule and
 * Bhrigu-karaka-bridge refs so a consumer can see WHY a planet is
 * eligible, even for a theme whose final strength is 0.
 */
export interface ThemeEligibility {
  theme: PersonalTheme;
  sourcePlanet: PlanetId;
  sourceKaraka: string;
  evidence: PersonalEvidenceRef[];
}

/**
 * One internal, not-directly-exposed unit of chart-specific numeric
 * REINFORCEMENT -- the only thing that ever contributes to a theme's raw
 * score (scoring.ts's own aggregateReinforcementScores). Produced only by
 * shared-theme relationship amplification or chain amplification, never
 * by base eligibility alone (see ThemeEligibility above). Exactly one of
 * sourceRelationship/sourceChainId is set, identifying which of the two
 * reinforcement kinds produced this contribution.
 */
export interface ThemeReinforcementContribution {
  theme: PersonalTheme;
  rawWeight: number;
  /** Relationship reinforcement: the edge's `from` planet. Chain reinforcement: omitted -- the full member list lives in evidence data instead, since a chain contribution is never about one specific planet. */
  sourcePlanet?: PlanetId;
  /** Relationship reinforcement only: the edge's `to` planet -- a relationship inherently involves two planets. */
  relatedPlanet?: PlanetId;
  sourceRelationship?: BhriguRelationshipType;
  /** A deterministic chain identity (its own canonically-ordered planet list joined by '+') -- BhriguPlanetaryChain itself carries no id field. */
  sourceChainId?: string;
  evidence: PersonalEvidenceRef[];
}

/**
 * Versioned scoring configuration -- see README.md's "Scoring" section
 * for the exact formula and the reasoning behind each default value.
 * Deliberately compact (3 knobs): every other constant in this engine
 * (mapping weight, always 1.0 and never numerically scored; the required
 * Bhrigu engine version) is NOT configurable, to keep V1 understandable
 * rather than exposing dozens of knobs.
 *
 * There is deliberately NO normalization-ceiling field here: the ceiling
 * is fully derived from `distinctSupportingPlanetCount(theme)` (mappings.ts
 * -- itself a fixed, chart-independent constant from the static, versioned
 * mapping table) together with the two amplification factors below -- see
 * scoring.ts's own deriveThemeReinforcementCeiling. There is nothing left
 * to independently configure.
 */
export interface PersonalThemeEngineConfig {
  /** Weight added per shared-theme relationship edge, multiplied by that edge's own Bhrigu strength (see scoring.ts). Default 0.5. Must be finite and >= 0. */
  relationshipAmplificationFactor: number;
  /** Weight added per additional chain-supporting planet beyond the first, multiplied by the chain's own Bhrigu score (see scoring.ts). Default 0.15. Must be finite and >= 0. */
  chainAmplificationPerAdditionalPlanet: number;
  /** Normalized-score threshold at/above which a theme's direction is 'SUPPORTIVE' rather than 'NEUTRAL'. V1 never emits 'CHALLENGING' -- see engine.ts's own doc comment. Default 0.35. Must be finite and in [0, 1]. */
  supportiveThreshold: number;
}

export interface PersonalThemeEngineOptions {
  config?: PersonalThemeEngineConfig;
}

/** Thrown by engine.ts on incompatible/malformed BhriguNatalResult input, or invalid config -- see engine.ts's own doc comment for exactly which conditions reject. */
export class PersonalThemesValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersonalThemesValidationError';
  }
}
