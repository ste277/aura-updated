/**
 * Personal Themes Engine V1 -- scoring.
 *
 * REINFORCEMENT-ONLY scoring model. Every real Bhrigu chart contains the
 * exact same 9 planets (packages/bhrigu/src/graph.ts always builds all 9
 * nodes, unconditionally) -- so a planet's mere EXISTENCE, and the fact
 * that its karakas map to a given theme, is true for every chart and
 * carries zero personalizing information on its own. A chart containing
 * Mercury must not automatically produce a positive FINANCE or SOCIAL
 * strength merely because Mercury exists.
 *
 * The mapping table (mappings.ts) therefore establishes ELIGIBILITY --
 * which planets CAN support each theme, plus the evidence trail for why
 * -- but contributes NO numeric score. Only chart-specific STRUCTURE
 * between eligible planets (a real sign relationship, or a real
 * connected chain) is genuinely personalizing, so only that structure
 * produces a numeric score:
 *
 *   personalizedRawScore(theme) = relationshipReinforcement(theme)
 *                                + chainReinforcement(theme)
 *
 * Every function here is a small, pure, named step -- no single opaque
 * formula. See README.md's "Scoring" section for the full worked
 * derivation of every constant below.
 */
import { getMappingRulesForPlanetKaraka, distinctSupportingPlanetCount } from './mappings';
import {
  buildThemeMappingEvidence,
  buildBhriguKarakaBridgeEvidence,
  buildRelationshipSharedThemeEvidence,
  buildBhriguRelationshipBridgeEvidence,
  buildChainThemeEvidence,
  buildBhriguChainBridgeEvidence,
} from './evidence';
import { PLANET_KARAKAS } from '../../bhrigu/src/karakas';
import { CHAIN_CONNECTED_COMPONENT_RULE_ID } from '../../bhrigu/src/provenance';
import { PERSONAL_THEMES } from '../../personal-intelligence/src/themes';
import type { BhriguNatalEdge, BhriguNatalNode, BhriguNatalResult, BhriguPlanetaryChain, PlanetId } from '../../bhrigu/src/types';
import type { PersonalTheme } from '../../personal-intelligence/src/types';
import type { ThemeEligibility, ThemeReinforcementContribution, PersonalThemeEngineConfig } from './types';

/**
 * V1 default scoring configuration.
 *
 * relationshipAmplificationFactor = 0.5 -- see README.md; a SAME_SIGN
 *   (strength 1.0) shared-theme edge contributes +0.5, TRINE (0.75)
 *   contributes +0.375, OPPOSITION (0.5) contributes +0.25, THREE_ELEVEN
 *   (0.25) contributes +0.125, TWO_TWELVE (0.15) contributes +0.075 --
 *   exactly the brief's own recommended table.
 * chainAmplificationPerAdditionalPlanet = 0.15 -- the brief's own
 *   recommended value; see computeChainReinforcement below for the exact
 *   formula (additionalSupportingPlanets * this * chain.score).
 * supportiveThreshold = 0.35 -- the brief's own recommended value.
 *
 * There is no ceiling field: deriveThemeReinforcementCeiling below
 * derives it entirely from these two amplification factors plus
 * distinctSupportingPlanetCount(theme) (mappings.ts).
 */
export const DEFAULT_PERSONAL_THEME_ENGINE_CONFIG: PersonalThemeEngineConfig = {
  relationshipAmplificationFactor: 0.5,
  chainAmplificationPerAdditionalPlanet: 0.15,
  supportiveThreshold: 0.35,
};

/**
 * Rejects a config with any non-finite value, a negative amplification
 * factor, or a supportiveThreshold outside [0, 1] -- the exact
 * validation the brief calls out explicitly. Does not second-guess a
 * caller's otherwise-valid tuning.
 */
export function validatePersonalThemeEngineConfig(config: PersonalThemeEngineConfig): void {
  const requireFinite = (value: number, label: string) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`PersonalThemeEngineConfig.${label} must be a finite number, got: ${value}`);
    }
  };
  requireFinite(config.relationshipAmplificationFactor, 'relationshipAmplificationFactor');
  requireFinite(config.chainAmplificationPerAdditionalPlanet, 'chainAmplificationPerAdditionalPlanet');
  requireFinite(config.supportiveThreshold, 'supportiveThreshold');

  if (config.relationshipAmplificationFactor < 0) {
    throw new Error(`PersonalThemeEngineConfig.relationshipAmplificationFactor must be non-negative, got: ${config.relationshipAmplificationFactor}`);
  }
  if (config.chainAmplificationPerAdditionalPlanet < 0) {
    throw new Error(`PersonalThemeEngineConfig.chainAmplificationPerAdditionalPlanet must be non-negative, got: ${config.chainAmplificationPerAdditionalPlanet}`);
  }
  if (config.supportiveThreshold < 0 || config.supportiveThreshold > 1) {
    throw new Error(`PersonalThemeEngineConfig.supportiveThreshold must be in [0, 1], got: ${config.supportiveThreshold}`);
  }
}

/**
 * Deterministic chain identity: BhriguPlanetaryChain itself carries no id
 * field, so this engine derives one from the chain's own already-
 * canonically-ordered planet list (chains.ts in packages/bhrigu sorts
 * chain members by the fixed SUPPORTED_PLANETS order) -- stable and
 * reproducible from the chain's own content, never a random/generated id.
 */
export function chainIdentity(chain: BhriguPlanetaryChain): string {
  return chain.planets.join('+');
}

/**
 * Step 1: theme ELIGIBILITY (never a numeric score -- see this file's own
 * module doc comment). Iterates `nodes` in the order Bhrigu itself already
 * provides (its own fixed SUPPORTED_PLANETS canonical order -- see
 * packages/bhrigu/src/graph.ts), then each node's own `karakas` array in
 * its own fixed order (also Bhrigu-canonical, copied verbatim from
 * PLANET_KARAKAS). One ThemeEligibility per matching mapping rule --
 * almost always exactly one match per (planet, karaka) pair in V1's own
 * table, but this loop tolerates zero or more without assuming exactly
 * one.
 */
export function extractThemeMappings(nodes: BhriguNatalNode[]): ThemeEligibility[] {
  const eligibility: ThemeEligibility[] = [];
  for (const node of nodes) {
    const karakaDefinition = PLANET_KARAKAS[node.planet];
    for (const karaka of node.karakas) {
      const rules = getMappingRulesForPlanetKaraka(node.planet, karaka);
      for (const mappingRule of rules) {
        eligibility.push({
          theme: mappingRule.theme,
          sourcePlanet: node.planet,
          sourceKaraka: karaka,
          evidence: [
            buildThemeMappingEvidence({ planet: node.planet, karaka, theme: mappingRule.theme, weight: mappingRule.weight }),
            buildBhriguKarakaBridgeEvidence({
              planet: node.planet,
              karaka,
              bhriguRuleId: karakaDefinition.sourceRuleId,
              bhriguRuleVersion: karakaDefinition.version,
            }),
          ],
        });
      }
    }
  }
  return eligibility;
}

function themesByPlanetFromEligibility(eligibility: ThemeEligibility[]): Map<PlanetId, Set<PersonalTheme>> {
  const themesByPlanet = new Map<PlanetId, Set<PersonalTheme>>();
  for (const entry of eligibility) {
    const themes = themesByPlanet.get(entry.sourcePlanet) ?? new Set<PersonalTheme>();
    themes.add(entry.theme);
    themesByPlanet.set(entry.sourcePlanet, themes);
  }
  return themesByPlanet;
}

/**
 * Step 2: shared-theme relationship REINFORCEMENT (V1 rule: a
 * relationship only strengthens a theme both connected planets are
 * actually ELIGIBLE for -- see README.md's "Scoring" section and the
 * brief's own Mercury/Jupiter-LEARNING vs Mercury/Moon-FINANCE/WELLBEING
 * example). This is the FIRST of the two components that actually
 * contribute to a theme's numeric score.
 *
 * For each non-NONE edge, intersects the set of themes `from` and `to`
 * are each ELIGIBLE for (from `eligibility`, never re-deriving
 * relationship classification -- reuses Bhrigu's own edge.relationship/
 * edge.strength as-is, per the brief's explicit "do not invent a second
 * relationship classification" instruction). For each shared theme, in
 * PERSONAL_THEMES canonical order (not Set iteration order, which is not
 * guaranteed stable across engines/runtimes), adds
 * `relationshipAmplificationFactor * edge.strength`.
 */
export function computeRelationshipReinforcement(
  edges: BhriguNatalEdge[],
  eligibility: ThemeEligibility[],
  config: PersonalThemeEngineConfig
): ThemeReinforcementContribution[] {
  const themesByPlanet = themesByPlanetFromEligibility(eligibility);

  const contributions: ThemeReinforcementContribution[] = [];
  for (const edge of edges) {
    if (edge.relationship === 'NONE') continue;

    const fromThemes = themesByPlanet.get(edge.from) ?? new Set<PersonalTheme>();
    const toThemes = themesByPlanet.get(edge.to) ?? new Set<PersonalTheme>();
    // The Bhrigu edge itself always carries exactly one evidence entry
    // for a non-NONE relationship (packages/bhrigu/src/graph.ts) -- used
    // here only to bridge ruleId/ruleVersion back to that source fact.
    const bhriguEdgeEvidence = edge.evidence[0];

    for (const theme of PERSONAL_THEMES) {
      if (!fromThemes.has(theme) || !toThemes.has(theme)) continue;

      const contributionAmount = config.relationshipAmplificationFactor * edge.strength;
      const evidence = [
        buildRelationshipSharedThemeEvidence({
          from: edge.from,
          to: edge.to,
          theme,
          relationship: edge.relationship,
          edgeStrength: edge.strength,
          contribution: contributionAmount,
        }),
      ];
      if (bhriguEdgeEvidence) {
        evidence.push(
          buildBhriguRelationshipBridgeEvidence({
            from: edge.from,
            to: edge.to,
            bhriguRuleId: edge.sourceRuleId,
            bhriguRuleVersion: bhriguEdgeEvidence.ruleVersion,
          })
        );
      }

      contributions.push({
        theme,
        rawWeight: contributionAmount,
        sourcePlanet: edge.from,
        relatedPlanet: edge.to,
        sourceRelationship: edge.relationship,
        evidence,
      });
    }
  }
  return contributions;
}

/**
 * Step 3: chain REINFORCEMENT (V1 rule: reward a theme only when at
 * least 2 DISTINCT planets inside one connected chain are each
 * independently ELIGIBLE for it -- see README.md's "Scoring" section for
 * the exact formula and the brief's own worked example). This is the
 * SECOND of the two components that actually contribute to a theme's
 * numeric score. Deliberately separate from, and smaller than, the
 * per-edge relationship bonus above -- this is additional signal about
 * the chain's own overall shape, not a second copy of the same
 * edge-by-edge relationship structure (no double-counting: this step
 * never re-adds `relationshipAmplificationFactor * edge.strength` for
 * any pair -- see this file's own "no double-counting" test coverage in
 * test/personalThemesEngine.test.ts).
 *
 * Single-node chains (chain.planets.length === 1, an isolated planet with
 * no non-NONE edge to anything -- see packages/bhrigu/src/chains.ts) are
 * skipped entirely: there is nothing to amplify.
 */
export function computeChainReinforcement(
  chains: BhriguPlanetaryChain[],
  eligibility: ThemeEligibility[],
  bhriguEvidence: BhriguNatalResult['evidence'],
  config: PersonalThemeEngineConfig
): ThemeReinforcementContribution[] {
  const themesByPlanet = themesByPlanetFromEligibility(eligibility);

  const contributions: ThemeReinforcementContribution[] = [];
  for (const chain of chains) {
    if (chain.planets.length < 2) continue;

    const chainId = chainIdentity(chain);
    // Every multi-planet chain has exactly one matching CHAIN-category
    // evidence entry in bhriguResult.evidence (packages/bhrigu/src/graph.ts)
    // -- looked up here rather than duplicated, so this engine's own
    // BHRIGU_NATAL bridge evidence always carries the real ruleVersion
    // Bhrigu itself stamped, not a guessed constant.
    const bhriguChainEvidence = bhriguEvidence.find(
      (entry) => entry.category === 'CHAIN' && entry.planets.length === chain.planets.length && entry.planets.every((p, i) => p === chain.planets[i])
    );

    for (const theme of PERSONAL_THEMES) {
      const supportingPlanets = chain.planets.filter((planet) => themesByPlanet.get(planet)?.has(theme));
      if (supportingPlanets.length < 2) continue;

      const additionalSupportingPlanets = supportingPlanets.length - 1;
      const contributionAmount = additionalSupportingPlanets * config.chainAmplificationPerAdditionalPlanet * chain.score;

      const evidence = [
        buildChainThemeEvidence({
          chainId,
          chainPlanets: chain.planets,
          theme,
          supportingPlanetCount: supportingPlanets.length,
          chainScore: chain.score,
          contribution: contributionAmount,
        }),
      ];
      if (bhriguChainEvidence) {
        evidence.push(
          buildBhriguChainBridgeEvidence({
            chainPlanets: chain.planets,
            bhriguRuleId: bhriguChainEvidence.ruleId,
            bhriguRuleVersion: bhriguChainEvidence.ruleVersion,
          })
        );
      } else {
        // Defensive fallback for a chain evidence entry Bhrigu's own
        // graph.ts didn't emit (should not happen for a real
        // BhriguNatalResult) -- still bridges via the known stable
        // CHAIN_CONNECTED_COMPONENT_RULE_ID rather than silently omitting
        // Bhrigu provenance entirely.
        evidence.push(
          buildBhriguChainBridgeEvidence({
            chainPlanets: chain.planets,
            bhriguRuleId: CHAIN_CONNECTED_COMPONENT_RULE_ID,
            bhriguRuleVersion: PLANET_KARAKAS[chain.planets[0]].version,
          })
        );
      }

      contributions.push({
        theme,
        rawWeight: contributionAmount,
        sourceChainId: chainId,
        evidence,
      });
    }
  }
  return contributions;
}

/**
 * Step 4: aggregates every REINFORCEMENT contribution's rawWeight into
 * one personalized raw score per theme -- a plain sum, order-independent
 * (addition is commutative), so this needs no particular contribution
 * ordering to be correct (ordering matters only for evidence/output
 * determinism, handled at the engine.ts boundary). ThemeEligibility is
 * NOT an input here -- eligibility never contributes a number, only
 * ThemeReinforcementContribution (relationship + chain) does.
 */
export function aggregateReinforcementScores(contributions: ThemeReinforcementContribution[]): Map<PersonalTheme, number> {
  const raw = new Map<PersonalTheme, number>();
  for (const theme of PERSONAL_THEMES) raw.set(theme, 0);
  for (const contribution of contributions) {
    raw.set(contribution.theme, (raw.get(contribution.theme) ?? 0) + contribution.rawWeight);
  }
  return raw;
}

/**
 * The per-theme reinforcement ceiling -- the maximum personalized raw
 * score a theme could theoretically reach, derived ENTIRELY from
 * `n = distinctSupportingPlanetCount(theme)` (mappings.ts, a fixed,
 * chart-INDEPENDENT constant from the static mapping table) and the two
 * amplification factors:
 *
 *   maxSharedPairs             = n * (n - 1) / 2
 *   maxRelationshipReinforcement = maxSharedPairs * relationshipAmplificationFactor
 *   maxChainReinforcement        = n >= 2 ? (n - 1) * chainAmplificationPerAdditionalPlanet : 0
 *   maxReinforcement             = maxRelationshipReinforcement + maxChainReinforcement
 *
 * `maxSharedPairs` is literally "every possible pair among the n eligible
 * planets" (the theoretical case where every one of them is SAME_SIGN --
 * strength 1.0 -- related to every other); `maxChainReinforcement`
 * mirrors the chain formula's own (supportingPlanetCount - 1) term at its
 * own maximum (all n eligible planets in one chain, chain.score = 1.0).
 *
 * This never varies with any specific chart -- "same raw theme score ->
 * same normalized score across different users" holds by construction,
 * and there is no per-chart min-max normalization anywhere in this
 * engine.
 */
export function deriveThemeReinforcementCeiling(theme: PersonalTheme, config: PersonalThemeEngineConfig): number {
  const n = distinctSupportingPlanetCount(theme);
  const maxSharedPairs = (n * (n - 1)) / 2;
  const maxRelationshipReinforcement = maxSharedPairs * config.relationshipAmplificationFactor;
  const maxChainReinforcement = n >= 2 ? (n - 1) * config.chainAmplificationPerAdditionalPlanet : 0;
  return maxRelationshipReinforcement + maxChainReinforcement;
}

/**
 * Step 5: normalizes one theme's personalized raw score into [0, 1] --
 * `min(1, rawScore / ceiling)`. A theme with fewer than 2 distinct
 * eligible planets (n <= 1, e.g. SOCIAL/FINANCE in the current V1
 * mapping table -- see README.md) has a ceiling of exactly 0 and always
 * normalizes to exactly 0, by definition, never NaN/Infinity (0/0 is
 * guarded explicitly, not left to produce NaN). Never negative (V1 has no
 * negative contributions) and never derived from any OTHER theme's score
 * (no per-chart min-max normalization -- the brief's own hard
 * requirement).
 */
export function normalizeThemeScore(rawScore: number, theme: PersonalTheme, config: PersonalThemeEngineConfig): number {
  const ceiling = deriveThemeReinforcementCeiling(theme, config);
  if (ceiling === 0) return 0;
  return Math.min(1, rawScore / ceiling);
}

/**
 * Step 6: direction classification. V1 has no negative/absent-support
 * model (see README.md's "Non-goals"), so this NEVER returns
 * 'CHALLENGING' -- only 'SUPPORTIVE' (score >= supportiveThreshold) or
 * 'NEUTRAL'. That dynamic distinction becomes meaningful once Dasha,
 * transits, personal support, Panchang, and Muhurta contribute
 * chart-independent-vs-current-timing nuance in a later PR, not this one.
 */
export function classifyDirection(normalizedScore: number, config: PersonalThemeEngineConfig): 'SUPPORTIVE' | 'NEUTRAL' {
  return normalizedScore >= config.supportiveThreshold ? 'SUPPORTIVE' : 'NEUTRAL';
}
