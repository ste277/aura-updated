/**
 * Personal Themes Engine V1 -- public engine.
 *
 * The one intended public entry point (see index.ts). Consumes an
 * already-built BhriguNatalResult (packages/bhrigu) and produces a
 * packages/personal-intelligence PersonalThemeContext -- this module
 * performs no astrology calculation of its own (no getNatalChart() call,
 * no date/timezone handling, no ephemeris). See ../README.md's
 * "Architecture" section for the full intended pipeline this is one
 * stage of, and its "Scoring" section for why eligibility (mapping) and
 * reinforcement (relationship/chain) are kept structurally separate here.
 */
import {
  extractThemeMappings,
  computeRelationshipReinforcement,
  computeChainReinforcement,
  aggregateReinforcementScores,
  normalizeThemeScore,
  classifyDirection,
  validatePersonalThemeEngineConfig,
  DEFAULT_PERSONAL_THEME_ENGINE_CONFIG,
} from './scoring';
import { dedupeEvidenceRefs } from './evidence';
import { REQUIRED_BHRIGU_ENGINE_VERSION } from './provenance';
import { SUPPORTED_PLANETS as BHRIGU_SUPPORTED_PLANETS } from '../../bhrigu/src/constants';
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import type { BhriguNatalResult } from '../../bhrigu/src/types';
import type { PersonalThemeContext } from '../../personal-intelligence/src/context';
import type { PersonalTheme, PersonalThemeSignal } from '../../personal-intelligence/src/types';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import { PersonalThemesValidationError } from './types';
import type { PersonalThemeEngineConfig, PersonalThemeEngineOptions, ThemeEligibility, ThemeReinforcementContribution } from './types';

/**
 * Validates a BhriguNatalResult at this package's own public boundary --
 * deliberately lightweight (does not re-derive sign/relationship math
 * Bhrigu's own normalize.ts/relationships.ts already guarantee correct;
 * see the brief's own "do not duplicate every Bhrigu internal validator"
 * guidance), but fails clearly on a genuinely incompatible object rather
 * than silently computing nonsense:
 * - engineVersion must be exactly REQUIRED_BHRIGU_ENGINE_VERSION
 *   ('BHRIGU_NATAL_V1') -- V1 of this engine is deliberately not
 *   version-compatible with any other Bhrigu engine version.
 * - nodes: exactly the 9 SUPPORTED_PLANETS, no duplicates, no unknown
 *   planet ids.
 * - edges: every strength is a finite number in [0, 1].
 * - chains: every member planet is one of the 9 supported planets, and
 *   the full chains array partitions the 9 planets with no duplicates
 *   (matches Bhrigu's own documented chains.ts invariant).
 */
export function validateBhriguNatalResult(result: BhriguNatalResult): void {
  if (result.engineVersion !== REQUIRED_BHRIGU_ENGINE_VERSION) {
    throw new PersonalThemesValidationError(
      `Unsupported Bhrigu engineVersion: expected ${REQUIRED_BHRIGU_ENGINE_VERSION}, got ${result.engineVersion}`
    );
  }

  const nodePlanets = result.nodes.map((node) => node.planet);
  if (nodePlanets.length !== BHRIGU_SUPPORTED_PLANETS.length || new Set(nodePlanets).size !== nodePlanets.length) {
    throw new PersonalThemesValidationError(
      `Expected exactly ${BHRIGU_SUPPORTED_PLANETS.length} unique natal nodes, got ${nodePlanets.length} (${new Set(nodePlanets).size} unique)`
    );
  }
  for (const planet of nodePlanets) {
    if (!BHRIGU_SUPPORTED_PLANETS.includes(planet)) {
      throw new PersonalThemesValidationError(`Unsupported planet in BhriguNatalResult.nodes: ${planet}`);
    }
  }

  for (const edge of result.edges) {
    if (typeof edge.strength !== 'number' || !Number.isFinite(edge.strength) || edge.strength < 0 || edge.strength > 1) {
      throw new PersonalThemesValidationError(
        `BhriguNatalEdge ${edge.from}-${edge.to} has an invalid strength (expected a finite number in [0, 1]): ${edge.strength}`
      );
    }
  }

  const chainPlanets = result.chains.flatMap((chain) => chain.planets);
  if (chainPlanets.length !== BHRIGU_SUPPORTED_PLANETS.length || new Set(chainPlanets).size !== chainPlanets.length) {
    throw new PersonalThemesValidationError(
      `BhriguNatalResult.chains must partition exactly the ${BHRIGU_SUPPORTED_PLANETS.length} supported planets with no duplicates -- got ${chainPlanets.length} planet entries across all chains`
    );
  }
  for (const planet of chainPlanets) {
    if (!BHRIGU_SUPPORTED_PLANETS.includes(planet)) {
      throw new PersonalThemesValidationError(`Unsupported planet in BhriguNatalResult.chains: ${planet}`);
    }
  }
}

/**
 * Deterministic per-theme evidence assembly: ELIGIBILITY evidence first
 * (why these planets can support this theme at all -- present even when
 * the theme's final strength is 0, e.g. SOCIAL/FINANCE in the current V1
 * mapping table, see README.md), then REINFORCEMENT evidence (why the
 * numeric score is what it is, when it is non-zero). Both lists are
 * already in Bhrigu's own canonical node/edge/chain order by
 * construction; this only filters by theme, flattens, and dedupes.
 */
function reasonsForTheme(
  eligibility: ThemeEligibility[],
  reinforcement: ThemeReinforcementContribution[],
  theme: PersonalTheme
): PersonalEvidenceRef[] {
  const themeEligibility = eligibility.filter((entry) => entry.theme === theme);
  const themeReinforcement = reinforcement.filter((entry) => entry.theme === theme);
  return dedupeEvidenceRefs([...themeEligibility.flatMap((entry) => entry.evidence), ...themeReinforcement.flatMap((entry) => entry.evidence)]);
}

/**
 * The one public entry point. Given a validated BhriguNatalResult (and
 * optional scoring config, defaulting to DEFAULT_PERSONAL_THEME_ENGINE_CONFIG),
 * returns a full 10-theme PersonalThemeContext in PERSONAL_THEMES'
 * canonical order (see README.md's "Zero-theme/full-vector behavior" --
 * every theme is always present, so a consumer gets a stable profile
 * vector; a theme with fewer than 2 distinct eligible planets, e.g.
 * SOCIAL/FINANCE currently, always has strength exactly 0 -- see
 * scoring.ts's own deriveThemeReinforcementCeiling).
 *
 * Repeated calls with structurally identical input/config produce
 * deeply-equal output: every step (extractThemeMappings,
 * computeRelationshipReinforcement, computeChainReinforcement) iterates
 * Bhrigu's own already-canonical node/edge/chain order, and this
 * function's own theme loop iterates PERSONAL_THEMES' fixed order -- see
 * test/personalThemesEngine.test.ts's own determinism checks.
 */
export function deriveThemeContext(
  bhriguResult: BhriguNatalResult,
  options: PersonalThemeEngineOptions = {}
): PersonalThemeContext {
  const config: PersonalThemeEngineConfig = options.config ?? DEFAULT_PERSONAL_THEME_ENGINE_CONFIG;
  validatePersonalThemeEngineConfig(config);
  validateBhriguNatalResult(bhriguResult);

  const eligibility = extractThemeMappings(bhriguResult.nodes);
  const relationshipReinforcement = computeRelationshipReinforcement(bhriguResult.edges, eligibility, config);
  const chainReinforcement = computeChainReinforcement(bhriguResult.chains, eligibility, bhriguResult.evidence, config);
  const reinforcement = [...relationshipReinforcement, ...chainReinforcement];

  const rawScores = aggregateReinforcementScores(reinforcement);

  const signals: PersonalThemeSignal[] = PERSONAL_THEMES.map((theme) => {
    const rawScore = rawScores.get(theme) ?? 0;
    const strength = normalizeThemeScore(rawScore, theme, config);
    const direction = classifyDirection(strength, config);
    return {
      theme,
      strength,
      direction,
      reasons: reasonsForTheme(eligibility, reinforcement, theme),
    };
  });

  const evidence = dedupeEvidenceRefs(signals.flatMap((signal) => signal.reasons));

  return { signals, evidence };
}
