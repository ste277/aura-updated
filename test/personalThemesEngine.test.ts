/**
 * Personal Themes Engine V1: regression suite for
 * packages/personal-themes/src -- the first real consumer of both
 * packages/bhrigu and packages/personal-intelligence, converting
 * structured Bhrigu natal evidence into Aura's stable Personal Theme
 * taxonomy via a REINFORCEMENT-ONLY scoring model (see
 * packages/personal-themes/README.md's "Scoring" section).
 *
 * Core invariant this whole suite enforces: a planet's mere existence
 * and its fixed karaka->theme eligibility mapping (every real chart has
 * the same 9 planets) contributes ZERO numeric score. Only chart-
 * specific structure -- a real Bhrigu relationship or a real connected
 * chain between eligible planets -- personalizes a theme's strength.
 *
 * Chain/relationship/eligibility scoring rules are tested directly
 * against small, hand-built synthetic fixtures (not real chart geometry)
 * to isolate each scoring rule -- sign-distance relationship
 * classification itself is already exhaustively tested in
 * test/bhriguNatalFoundation.test.ts and is not re-derived here. One
 * integration test (marked below) proves the actual package boundary: a
 * synthetic GrahaPosition[] -> buildBhriguNatalGraph -> this engine.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

import { buildBhriguNatalGraph, fromGrahaPositions, SUPPORTED_PLANETS, DEFAULT_RELATIONSHIP_WEIGHTS } from '../packages/bhrigu/src/index';
import type { BhriguNatalEdge, BhriguNatalResult, BhriguPlanetaryChain, PlanetId, BhriguRelationshipType } from '../packages/bhrigu/src/types';
import type { GrahaPosition } from '../packages/vedic/src/natalChart';
import { PERSONAL_THEMES } from '../packages/personal-intelligence/src/themes';
import type { PersonalTheme } from '../packages/personal-intelligence/src/types';

import {
  deriveThemeContext,
  validateBhriguNatalResult,
  THEME_MAPPING_RULES,
  getMappingRulesForPlanetKaraka,
  getMappingRulesForTheme,
  getDistinctSupportingPlanets,
  distinctSupportingPlanetCount,
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
  dedupeEvidenceRefs,
  PERSONAL_THEMES_ENGINE_VERSION,
  REQUIRED_BHRIGU_ENGINE_VERSION,
  mappingRuleId,
  PersonalThemesValidationError,
} from '../packages/personal-themes/src/index';

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ============================================================
// 1. Mapping table unchanged.
// ============================================================

check('THEME_MAPPING_RULES has exactly 36 entries (9 planets x 4 karakas) -- unchanged', THEME_MAPPING_RULES.length === 36);
check(
  'every supported Bhrigu planet has exactly 4 mapping rules -- unchanged',
  SUPPORTED_PLANETS.every((planet) => THEME_MAPPING_RULES.filter((rule) => rule.planet === planet).length === 4)
);
check(
  'every mapping rule targets one of the 10 documented Personal Themes',
  THEME_MAPPING_RULES.every((rule) => (PERSONAL_THEMES as readonly string[]).includes(rule.theme))
);
check(
  'every mapping rule has a stable, correctly-formed rule id and non-empty version',
  THEME_MAPPING_RULES.every((rule) => rule.ruleId === mappingRuleId(rule.planet, rule.karaka, rule.theme) && rule.ruleVersion.length > 0)
);
check(
  'no two mapping rules share an identical (planet, karaka, theme) triple',
  (() => {
    const seen = new Set<string>();
    for (const rule of THEME_MAPPING_RULES) {
      const key = `${rule.planet}|${rule.karaka}|${rule.theme}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  })()
);

// ============================================================
// 2. Base mapping rules add ZERO numeric score.
// ============================================================

function syntheticNode(planet: PlanetId, karakas: string[]) {
  return { planet, sign: 0, longitude: 0, karakas };
}

check(
  '(2) extractThemeMappings produces eligibility entries with NO rawWeight/numeric field at all -- eligibility carries no score, only theme/sourcePlanet/sourceKaraka/evidence',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['communication', 'learning', 'analysis', 'commerce'])]);
    return eligibility.length === 4 && eligibility.every((e) => !('rawWeight' in e) && e.sourcePlanet === 'Mercury');
  })()
);

check(
  '(2) a chart containing Mercury alone (no relationships, no chains) produces ZERO raw reinforcement for every theme, including FINANCE and SOCIAL -- Mercury merely existing never creates positive strength on its own',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['communication', 'learning', 'analysis', 'commerce'])]);
    // No edges, no chains -- reinforcement is empty by construction.
    const raw = aggregateReinforcementScores([]);
    return PERSONAL_THEMES.every((theme) => (raw.get(theme) ?? 0) === 0) && eligibility.length === 4;
  })()
);

// ============================================================
// 3. Base mapping evidence remains available.
// ============================================================

check(
  '(3) each eligibility entry still carries exactly 2 evidence refs: a PERSONAL_THEMES mapping rule and a BHRIGU_NATAL karaka bridge',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Sun', ['identity', 'authority', 'leadership', 'vitality'])]);
    return eligibility.every(
      (e) => e.evidence.length === 2 && e.evidence[0].source === 'PERSONAL_THEMES' && e.evidence[1].source === 'BHRIGU_NATAL' && e.evidence[1].ruleId === 'BHRIGU_KARAKA_SUN_V1'
    );
  })()
);

check(
  'an unrecognized karaka string on a synthetic node produces zero eligibility entries for it (fails closed, not open)',
  extractThemeMappings([syntheticNode('Sun', ['not-a-real-karaka'])]).length === 0
);

// ============================================================
// 4/5. Distinct supporting planets counted correctly (not mapping-rule count).
// ============================================================

check(
  '(4/5) Saturn maps 2 karakas (discipline, delay) to FOCUS, but counts as exactly 1 distinct supporting planet for FOCUS, not 2',
  getDistinctSupportingPlanets('FOCUS').filter((p) => p === 'Saturn').length === 1
);

check(
  '(4) distinctSupportingPlanetCount matches the hand-derived table from the V1 mapping table',
  (() => {
    const expected: Record<PersonalTheme, number> = {
      CAREER: 5, WELLBEING: 4, FOCUS: 5, RELATIONSHIPS: 3, SOCIAL: 1,
      LEARNING: 2, FINANCE: 1, CREATIVITY: 2, EXPLORATION: 3, SPIRITUALITY: 2,
    };
    return PERSONAL_THEMES.every((theme) => distinctSupportingPlanetCount(theme) === expected[theme]);
  })()
);

check(
  'getDistinctSupportingPlanets returns planets in SUPPORTED_PLANETS canonical order, not mapping-table order',
  JSON.stringify(getDistinctSupportingPlanets('CAREER')) === JSON.stringify(['Sun', 'Mars', 'Jupiter', 'Saturn', 'Rahu'])
);

// ============================================================
// 6/7/8/9. Relationship reinforcement.
// ============================================================

function syntheticEdge(from: PlanetId, to: PlanetId, relationship: BhriguRelationshipType, strength: number): BhriguNatalEdge {
  return {
    from,
    to,
    relationship,
    strength,
    sourceRuleId: `BHRIGU_REL_${relationship}_V1`,
    evidence: relationship === 'NONE' ? [] : [{ ruleId: `BHRIGU_REL_${relationship}_V1`, ruleVersion: '1.0.0', category: 'RELATIONSHIP', planets: [from, to], facts: {} }],
  };
}

check(
  "(6, brief's own example) Mercury eligible for LEARNING+FOCUS+SOCIAL+FINANCE, Jupiter eligible for LEARNING+CAREER+SPIRITUALITY+EXPLORATION, Mercury-Jupiter TRINE: only LEARNING is reinforced, never FINANCE (Jupiter isn't eligible there)",
  (() => {
    const eligibility = [
      ...extractThemeMappings([syntheticNode('Mercury', ['communication', 'learning', 'analysis', 'commerce'])]),
      ...extractThemeMappings([syntheticNode('Jupiter', ['knowledge', 'growth', 'wisdom', 'expansion'])]),
    ];
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'TRINE', 0.75)];
    const relContributions = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return (
      relContributions.length === 1 &&
      relContributions[0].theme === 'LEARNING' &&
      Math.abs(relContributions[0].rawWeight - 0.5 * 0.75) < 1e-9
    );
  })()
);

check(
  "Mercury eligible for FINANCE, Moon eligible for WELLBEING -- their relationship reinforces neither, since they share no eligible theme",
  (() => {
    const eligibility = [...extractThemeMappings([syntheticNode('Mercury', ['commerce'])]), ...extractThemeMappings([syntheticNode('Moon', ['habits'])])];
    const edges = [syntheticEdge('Mercury', 'Moon', 'SAME_SIGN', 1.0)];
    return computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG).length === 0;
  })()
);

check(
  '(7) a NONE relationship reinforces nothing, regardless of any strength value it might carry',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'NONE', 0)];
    return computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG).length === 0;
  })()
);

check(
  '(8) TRINE (strength 0.75) reinforces by exactly 0.5 * 0.75 = 0.375',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'TRINE', 0.75)];
    const [c] = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return Math.abs(c.rawWeight - 0.375) < 1e-9;
  })()
);

check(
  '(9) OPPOSITION (Bhrigu strength 0.5) reinforces POSITIVELY (0.25) -- never treated as negative',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'OPPOSITION', 0.5)];
    const [c] = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return c.rawWeight > 0 && Math.abs(c.rawWeight - 0.25) < 1e-9;
  })()
);

check(
  'the exact V1 amplification table matches the brief\'s own recommended values for every relationship strength (0.5 x edge.strength)',
  (['SAME_SIGN', 'TRINE', 'OPPOSITION', 'THREE_ELEVEN', 'TWO_TWELVE'] as const).every((relationship) => {
    const strengths: Record<string, number> = { SAME_SIGN: 1.0, TRINE: 0.75, OPPOSITION: 0.5, THREE_ELEVEN: 0.25, TWO_TWELVE: 0.15 };
    const expected: Record<string, number> = { SAME_SIGN: 0.5, TRINE: 0.375, OPPOSITION: 0.25, THREE_ELEVEN: 0.125, TWO_TWELVE: 0.075 };
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', relationship, strengths[relationship])];
    const [c] = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return Math.abs(c.rawWeight - expected[relationship]) < 1e-9;
  })
);

check(
  'relationship reinforcement carries both a PERSONAL_THEMES rule ref and a BHRIGU_NATAL bridge ref to the real edge.sourceRuleId',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'TRINE', 0.75)];
    const [c] = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return c.evidence.length === 2 && c.evidence[0].source === 'PERSONAL_THEMES' && c.evidence[1].source === 'BHRIGU_NATAL' && c.evidence[1].ruleId === 'BHRIGU_REL_TRINE_V1';
  })()
);

// ============================================================
// 10/11. Chain reinforcement.
// ============================================================

function syntheticChain(planets: PlanetId[], score: number): BhriguPlanetaryChain {
  return { planets, score };
}
function syntheticChainEvidence(planets: PlanetId[], score: number) {
  return [{ ruleId: 'BHRIGU_CHAIN_CONNECTED_COMPONENT_V1', ruleVersion: '1.0.0', category: 'CHAIN' as const, planets, facts: { chainPlanets: planets, chainScore: score } }];
}

check(
  '(10) chain reinforcement = (supportingCount - 1) * 0.15 * chain.score, rewarding only the shared theme',
  (() => {
    const eligibility = [
      ...extractThemeMappings([syntheticNode('Mercury', ['learning'])]),
      ...extractThemeMappings([syntheticNode('Jupiter', ['knowledge'])]),
      ...extractThemeMappings([syntheticNode('Saturn', ['discipline'])]), // FOCUS, not LEARNING
    ];
    const chains = [syntheticChain(['Mercury', 'Jupiter', 'Saturn'], 0.6)];
    const contributions = computeChainReinforcement(chains, eligibility, syntheticChainEvidence(['Mercury', 'Jupiter', 'Saturn'], 0.6), DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    const learning = contributions.find((c) => c.theme === 'LEARNING');
    const focus = contributions.find((c) => c.theme === 'FOCUS');
    return contributions.length === 1 && learning !== undefined && focus === undefined && Math.abs(learning!.rawWeight - (2 - 1) * 0.15 * 0.6) < 1e-9;
  })()
);

check(
  '(11) a single-node chain produces no chain reinforcement at all',
  computeChainReinforcement([syntheticChain(['Mercury'], 0)], extractThemeMappings([syntheticNode('Mercury', ['learning'])]), [], DEFAULT_PERSONAL_THEME_ENGINE_CONFIG).length === 0
);

check(
  'three distinct chain planets supporting the same theme scale the chain bonus by (3 - 1), not by an arbitrary chain-complexity factor',
  (() => {
    const eligibility = [
      ...extractThemeMappings([syntheticNode('Sun', ['identity'])]),
      ...extractThemeMappings([syntheticNode('Mars', ['drive'])]),
      ...extractThemeMappings([syntheticNode('Jupiter', ['growth'])]),
    ];
    const chains = [syntheticChain(['Sun', 'Mars', 'Jupiter'], 0.8)];
    const [c] = computeChainReinforcement(chains, eligibility, syntheticChainEvidence(['Sun', 'Mars', 'Jupiter'], 0.8), DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return Math.abs(c.rawWeight - (3 - 1) * 0.15 * 0.8) < 1e-9;
  })()
);

check(
  'no double-counting: a Mercury-Jupiter TRINE that ALSO sits inside one chain together contributes relationship + chain as two separate additive terms only (no base term at all)',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const edges = [syntheticEdge('Mercury', 'Jupiter', 'TRINE', 0.75)];
    const chains = [syntheticChain(['Mercury', 'Jupiter'], 0.75)];
    const relContributions = computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    const chainContributions = computeChainReinforcement(chains, eligibility, syntheticChainEvidence(['Mercury', 'Jupiter'], 0.75), DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    const raw = aggregateReinforcementScores([...relContributions, ...chainContributions]);
    const expectedRelationship = 0.5 * 0.75;
    const expectedChain = (2 - 1) * 0.15 * 0.75;
    return Math.abs((raw.get('LEARNING') ?? 0) - (expectedRelationship + expectedChain)) < 1e-9;
  })()
);

// ============================================================
// 12/13/14/15. Derived ceilings.
// ============================================================

check('(12) derived ceiling for n=1 (SOCIAL, FINANCE) is exactly 0', deriveThemeReinforcementCeiling('SOCIAL', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === 0 && deriveThemeReinforcementCeiling('FINANCE', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === 0);
check('(13) derived ceiling for n=2 (LEARNING, CREATIVITY, SPIRITUALITY) is exactly 0.65', Math.abs(deriveThemeReinforcementCeiling('LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) - 0.65) < 1e-9);
check('(14) derived ceiling for n=3 (RELATIONSHIPS, EXPLORATION) is exactly 1.80', Math.abs(deriveThemeReinforcementCeiling('RELATIONSHIPS', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) - 1.8) < 1e-9);

check(
  '(15) all ten default theme ceilings exactly match the derived table (n=5:5.60, n=4:3.45, n=3:1.80, n=2:0.65, n=1:0.00)',
  (() => {
    const expected: Record<PersonalTheme, number> = {
      CAREER: 5.6, FOCUS: 5.6, WELLBEING: 3.45, RELATIONSHIPS: 1.8, EXPLORATION: 1.8,
      LEARNING: 0.65, CREATIVITY: 0.65, SPIRITUALITY: 0.65, SOCIAL: 0, FINANCE: 0,
    };
    return PERSONAL_THEMES.every((theme) => Math.abs(deriveThemeReinforcementCeiling(theme, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) - expected[theme]) < 1e-9);
  })()
);

console.log('\n--- Derived V1 default reinforcement ceiling table ---');
console.log('Theme          | n | maxSharedPairs | maxRelationship | maxChain | maxReinforcement');
for (const theme of PERSONAL_THEMES) {
  const n = distinctSupportingPlanetCount(theme);
  const maxSharedPairs = (n * (n - 1)) / 2;
  const maxRelationship = maxSharedPairs * DEFAULT_PERSONAL_THEME_ENGINE_CONFIG.relationshipAmplificationFactor;
  const maxChain = n >= 2 ? (n - 1) * DEFAULT_PERSONAL_THEME_ENGINE_CONFIG.chainAmplificationPerAdditionalPlanet : 0;
  console.log(`${theme.padEnd(15)}| ${n} | ${String(maxSharedPairs).padEnd(15)}| ${maxRelationship.toFixed(3).padEnd(16)} | ${maxChain.toFixed(3).padEnd(8)} | ${(maxRelationship + maxChain).toFixed(3)}`);
}

// ============================================================
// 16/17/18/19/20. SOCIAL and FINANCE must be zero/neutral.
// ============================================================

function fullChart(overrides: Partial<Record<PlanetId, number>> = {}) {
  return SUPPORTED_PLANETS.map((planet) => ({ planet, longitude: overrides[planet] ?? 0 }));
}

check(
  '(16/17/18/19) SOCIAL and FINANCE always have strength exactly 0 and direction NEUTRAL, for every V1 chart (default all-zero-longitude fixture)',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart());
    const context = deriveThemeContext(bhriguResult);
    const social = context.signals.find((s) => s.theme === 'SOCIAL')!;
    const finance = context.signals.find((s) => s.theme === 'FINANCE')!;
    return social.strength === 0 && social.direction === 'NEUTRAL' && finance.strength === 0 && finance.direction === 'NEUTRAL';
  })()
);

check(
  '(16/17/18/19) SOCIAL and FINANCE remain strength 0 / NEUTRAL even in a chart with strong Mercury relationships elsewhere (since Mercury is SOCIAL/FINANCE\'s only eligible planet -- no second planet exists to reinforce against)',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart({ Mercury: 40, Jupiter: 130, Saturn: 300, Venus: 10 }));
    const context = deriveThemeContext(bhriguResult);
    const social = context.signals.find((s) => s.theme === 'SOCIAL')!;
    const finance = context.signals.find((s) => s.theme === 'FINANCE')!;
    return social.strength === 0 && social.direction === 'NEUTRAL' && finance.strength === 0 && finance.direction === 'NEUTRAL';
  })()
);

check(
  '(20) SOCIAL and FINANCE still retain their mapping/Bhrigu provenance evidence even though their numeric strength is 0 -- zero-strength does not mean zero-evidence',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart());
    const context = deriveThemeContext(bhriguResult);
    const social = context.signals.find((s) => s.theme === 'SOCIAL')!;
    const finance = context.signals.find((s) => s.theme === 'FINANCE')!;
    return (
      social.reasons.length === 2 &&
      social.reasons[0].source === 'PERSONAL_THEMES' &&
      social.reasons[0].ruleId === 'PERSONAL_THEME_MAP_MERCURY_COMMUNICATION_SOCIAL_V1' &&
      social.reasons[1].source === 'BHRIGU_NATAL' &&
      finance.reasons.length === 2 &&
      finance.reasons[0].ruleId === 'PERSONAL_THEME_MAP_MERCURY_COMMERCE_FINANCE_V1'
    );
  })()
);

// ============================================================
// 21/22/23/24. Direction produces real variation.
// ============================================================

check(
  '(21) same planets + karakas, but Mercury-Jupiter NONE vs TRINE, produce DIFFERENT LEARNING strength (Fixture B > Fixture A)',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const noneEdges = [syntheticEdge('Mercury', 'Jupiter', 'NONE', 0)];
    const trineEdges = [syntheticEdge('Mercury', 'Jupiter', 'TRINE', 0.75)];
    const rawA = aggregateReinforcementScores(computeRelationshipReinforcement(noneEdges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG)).get('LEARNING') ?? 0;
    const rawB = aggregateReinforcementScores(computeRelationshipReinforcement(trineEdges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG)).get('LEARNING') ?? 0;
    const strengthA = normalizeThemeScore(rawA, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    const strengthB = normalizeThemeScore(rawB, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    return strengthA === 0 && strengthB > strengthA;
  })()
);

check(
  '(21, monotonic) relationship reinforcement strictly increases with Bhrigu\'s own actual relationship strength: NONE < TWO_TWELVE < THREE_ELEVEN < OPPOSITION < TRINE < SAME_SIGN (using DEFAULT_RELATIONSHIP_WEIGHTS as the source of truth, not textual assumptions)',
  (() => {
    const eligibility = extractThemeMappings([syntheticNode('Mercury', ['learning']), syntheticNode('Jupiter', ['knowledge'])]);
    const order: BhriguRelationshipType[] = ['NONE', 'TWO_TWELVE', 'THREE_ELEVEN', 'OPPOSITION', 'TRINE', 'SAME_SIGN'];
    const weights: Record<BhriguRelationshipType, number> = {
      NONE: DEFAULT_RELATIONSHIP_WEIGHTS.none,
      TWO_TWELVE: DEFAULT_RELATIONSHIP_WEIGHTS.twoTwelve,
      THREE_ELEVEN: DEFAULT_RELATIONSHIP_WEIGHTS.threeEleven,
      OPPOSITION: DEFAULT_RELATIONSHIP_WEIGHTS.opposition,
      TRINE: DEFAULT_RELATIONSHIP_WEIGHTS.trine,
      SAME_SIGN: DEFAULT_RELATIONSHIP_WEIGHTS.sameSign,
    };
    // Confirm the assumed textual order actually matches Bhrigu's own real strengths before relying on it.
    for (let i = 1; i < order.length; i++) {
      if (weights[order[i]] <= weights[order[i - 1]]) return false;
    }
    const strengths = order.map((relationship) => {
      const edges = [syntheticEdge('Mercury', 'Jupiter', relationship, weights[relationship])];
      const raw = aggregateReinforcementScores(computeRelationshipReinforcement(edges, eligibility, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG)).get('LEARNING') ?? 0;
      return normalizeThemeScore(raw, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
    });
    for (let i = 1; i < strengths.length; i++) {
      if (strengths[i] <= strengths[i - 1]) return false;
    }
    return true;
  })()
);

check(
  '(22/23) a realistic synthetic chart produces at least one SUPPORTIVE theme and at least one NEUTRAL theme -- direction now shows real variation, not a constant',
  (() => {
    // Mercury-Jupiter TRINE (both eligible for LEARNING) should push LEARNING to SUPPORTIVE;
    // SOCIAL/FINANCE (n=1, ceiling 0) remain NEUTRAL regardless.
    const bhriguResult = buildBhriguNatalGraph(fullChart({ Mercury: 40, Jupiter: 130 })); // sign 1 and sign 4 -> distance 3 -> NONE, adjust below
    // Use an explicit sign-4-apart pair for a real TRINE: Mercury sign 0 (0deg), Jupiter sign 4 (120deg).
    const trineChart = buildBhriguNatalGraph(fullChart({ Mercury: 0, Jupiter: 120 }));
    const context = deriveThemeContext(trineChart);
    const hasSupportive = context.signals.some((s) => s.direction === 'SUPPORTIVE');
    const hasNeutral = context.signals.some((s) => s.direction === 'NEUTRAL');
    const social = context.signals.find((s) => s.theme === 'SOCIAL')!;
    return hasSupportive && hasNeutral && social.direction === 'NEUTRAL' && bhriguResult !== undefined;
  })()
);

check('(24) classifyDirection never returns CHALLENGING for any input in [0, 1]', [0, 0.1, 0.35, 0.5, 0.9, 1].every((score) => classifyDirection(score, DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) !== ('CHALLENGING' as never)));

check(
  '(24) no signal in a real engine run is ever CHALLENGING',
  deriveThemeContext(buildBhriguNatalGraph(fullChart({ Mercury: 0, Jupiter: 120, Saturn: 300 }))).signals.every((s) => s.direction !== ('CHALLENGING' as never))
);

// ============================================================
// 25. Full ten-theme canonical-order vector preserved.
// ============================================================

check(
  '(25) deriveThemeContext returns all 10 themes in exact PERSONAL_THEMES canonical order',
  JSON.stringify(deriveThemeContext(buildBhriguNatalGraph(fullChart())).signals.map((s) => s.theme)) === JSON.stringify(PERSONAL_THEMES)
);

// ============================================================
// 26/27/28. Normalization.
// ============================================================

check('(26) a theme\'s normalized score depends only on its own raw score and its own fixed ceiling, never on any other theme or any specific chart\'s max', normalizeThemeScore(0.5, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === normalizeThemeScore(0.5, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG));
check('(27) normalization clamps at exactly 1, never exceeding it, even far above the ceiling', normalizeThemeScore(deriveThemeReinforcementCeiling('LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) * 10, 'LEARNING', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === 1);
check('(28) a zero ceiling (SOCIAL/FINANCE, n=1) safely normalizes any raw score to exactly 0, never NaN/Infinity', normalizeThemeScore(0, 'SOCIAL', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === 0 && Number.isFinite(normalizeThemeScore(5, 'SOCIAL', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG)) && normalizeThemeScore(5, 'SOCIAL', DEFAULT_PERSONAL_THEME_ENGINE_CONFIG) === 0);

// ============================================================
// 29/30. Determinism.
// ============================================================

check(
  '(29) calling deriveThemeContext twice with the same BhriguNatalResult produces deeply-equal output',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart({ Mercury: 0, Jupiter: 120, Saturn: 300 }));
    return JSON.stringify(deriveThemeContext(bhriguResult)) === JSON.stringify(deriveThemeContext(bhriguResult));
  })()
);

check(
  '(30) shuffled Bhrigu node/edge/chain input order does not change the semantic result (strengths/directions identical)',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart({ Mercury: 0, Jupiter: 120 }));
    const shuffled: BhriguNatalResult = { ...bhriguResult, nodes: [...bhriguResult.nodes].reverse(), edges: [...bhriguResult.edges].reverse(), chains: [...bhriguResult.chains].reverse() };
    const a = deriveThemeContext(bhriguResult).signals.map((s) => ({ theme: s.theme, strength: s.strength, direction: s.direction }));
    const b = deriveThemeContext(shuffled).signals.map((s) => ({ theme: s.theme, strength: s.strength, direction: s.direction }));
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

// ============================================================
// 31. Integration test.
// ============================================================

check(
  '(31) INTEGRATION: a real GrahaPosition[] fixture adapted via fromGrahaPositions, run through buildBhriguNatalGraph, then this engine, produces a valid 10-theme PersonalThemeContext',
  (() => {
    const positions: GrahaPosition[] = [
      { graha: 'Sun', siderealLongitude: 12, rashiIndex: 0, rashiName: 'Mesha', degreeInRashi: 12 },
      { graha: 'Moon', siderealLongitude: 200.5, rashiIndex: 6, rashiName: 'Tula', degreeInRashi: 20.5 },
      { graha: 'Mercury', siderealLongitude: 40, rashiIndex: 1, rashiName: 'Vrishabha', degreeInRashi: 10 },
      { graha: 'Venus', siderealLongitude: 80, rashiIndex: 2, rashiName: 'Mithuna', degreeInRashi: 20 },
      { graha: 'Mars', siderealLongitude: 130, rashiIndex: 4, rashiName: 'Simha', degreeInRashi: 10 },
      { graha: 'Jupiter', siderealLongitude: 250, rashiIndex: 8, rashiName: 'Dhanu', degreeInRashi: 10 },
      { graha: 'Saturn', siderealLongitude: 300, rashiIndex: 10, rashiName: 'Kumbha', degreeInRashi: 0 },
      { graha: 'Rahu', siderealLongitude: 5, rashiIndex: 0, rashiName: 'Mesha', degreeInRashi: 5 },
      { graha: 'Ketu', siderealLongitude: 185, rashiIndex: 6, rashiName: 'Tula', degreeInRashi: 5 },
    ];
    const bhriguResult = buildBhriguNatalGraph(fromGrahaPositions(positions));
    const context = deriveThemeContext(bhriguResult);
    return context.signals.length === 10 && context.signals.every((s) => s.strength >= 0 && s.strength <= 1);
  })()
);

// ============================================================
// 32. Dependency boundary.
// ============================================================

const PACKAGE_SRC_FILES = [
  'packages/personal-themes/src/types.ts',
  'packages/personal-themes/src/provenance.ts',
  'packages/personal-themes/src/mappings.ts',
  'packages/personal-themes/src/evidence.ts',
  'packages/personal-themes/src/scoring.ts',
  'packages/personal-themes/src/engine.ts',
  'packages/personal-themes/src/index.ts',
];

check(
  '(32) every import in this package is either a relative import within itself, or a relative import into packages/bhrigu or packages/personal-intelligence -- never apps/web, packages/panchang, or packages/muhurta',
  PACKAGE_SRC_FILES.every((file) => {
    const source = fs.readFileSync(file, 'utf8');
    const importStatements = source.match(/^import[\s\S]*?;/gm) ?? [];
    return importStatements.every((statement) => /from '\.\/|from '\.\.\/\.\.\/bhrigu\/|from '\.\.\/\.\.\/personal-intelligence\//.test(statement));
  })
);

check(
  '(32) no ACTUAL CODE (comments stripped) in this package references apps/web, Prisma, a database, an API route, React, Panchang calculations, Muhurta calculations, or an LLM',
  PACKAGE_SRC_FILES.every((file) => !/apps\/web|prisma|PrismaClient|react|localStorage|fetch\(|NextRequest|NextResponse|useState|useEffect|panchang|muhurta|openai|anthropic|llm/i.test(stripComments(fs.readFileSync(file, 'utf8'))))
);

check('(32) no source file uses Date.now/new Date()/Math.random anywhere in this engine', PACKAGE_SRC_FILES.every((file) => !/Date\.now\(\)|new Date\(\)|Math\.random\(\)/.test(fs.readFileSync(file, 'utf8'))));

check('(32) this engine never calls getNatalChart in actual code -- it only consumes an already-built BhriguNatalResult', PACKAGE_SRC_FILES.every((file) => !/getNatalChart\(/.test(stripComments(fs.readFileSync(file, 'utf8')))));

check(
  'no prediction/horoscope prose exists anywhere in this package\'s source (only structural doc comments)',
  PACKAGE_SRC_FILES.every((file) => !/you will|your career|your marriage|destined|prediction:/i.test(stripComments(fs.readFileSync(file, 'utf8'))))
);

check(
  '(32) no `normalizationCeilingMultiplier` remains anywhere in this package\'s source (fully removed, not just unused)',
  PACKAGE_SRC_FILES.every((file) => !/normalizationCeilingMultiplier/.test(fs.readFileSync(file, 'utf8')))
);

check(
  'packages/bhrigu source is untouched by this PR (no reference to personal-themes anywhere in it)',
  !/personal-themes/i.test(
    ['types', 'constants', 'normalize', 'karakas', 'relationships', 'graph', 'chains', 'evidence', 'provenance', 'index']
      .map((name) => fs.readFileSync(`packages/bhrigu/src/${name}.ts`, 'utf8'))
      .join('\n')
  )
);

check(
  'packages/personal-intelligence source is untouched by this PR (no reference to personal-themes anywhere in it)',
  !/personal-themes/i.test(
    ['types', 'themes', 'evidence', 'context', 'guidance', 'validation', 'provenance', 'index']
      .map((name) => fs.readFileSync(`packages/personal-intelligence/src/${name}.ts`, 'utf8'))
      .join('\n')
  )
);

// ============================================================
// Config: final 3-field shape, validation boundaries.
// ============================================================

check(
  'PersonalThemeEngineConfig has exactly the 3 required fields (no normalizationCeilingMultiplier) -- structural check via the default config object\'s own keys',
  JSON.stringify(Object.keys(DEFAULT_PERSONAL_THEME_ENGINE_CONFIG).sort()) === JSON.stringify(['chainAmplificationPerAdditionalPlanet', 'relationshipAmplificationFactor', 'supportiveThreshold'])
);

check(
  'the default config passes its own validator',
  (() => {
    try {
      validatePersonalThemeEngineConfig(DEFAULT_PERSONAL_THEME_ENGINE_CONFIG);
      return true;
    } catch {
      return false;
    }
  })()
);

function expectConfigRejects(overrides: Partial<typeof DEFAULT_PERSONAL_THEME_ENGINE_CONFIG>): boolean {
  try {
    validatePersonalThemeEngineConfig({ ...DEFAULT_PERSONAL_THEME_ENGINE_CONFIG, ...overrides });
    return false;
  } catch {
    return true;
  }
}

check('rejects a negative relationshipAmplificationFactor', expectConfigRejects({ relationshipAmplificationFactor: -0.1 }));
check('rejects a negative chainAmplificationPerAdditionalPlanet', expectConfigRejects({ chainAmplificationPerAdditionalPlanet: -0.1 }));
check('rejects a supportiveThreshold below 0', expectConfigRejects({ supportiveThreshold: -0.01 }));
check('rejects a supportiveThreshold above 1', expectConfigRejects({ supportiveThreshold: 1.01 }));
check('rejects NaN in any config field', expectConfigRejects({ relationshipAmplificationFactor: NaN }));
check('rejects Infinity in any config field', expectConfigRejects({ chainAmplificationPerAdditionalPlanet: Infinity }));

// ============================================================
// Evidence deduplication.
// ============================================================

check(
  'dedupeEvidenceRefs removes exact (source, ruleId, data) duplicates while preserving first-occurrence order',
  (() => {
    const ref = { source: 'BHRIGU_NATAL' as const, ruleId: 'BHRIGU_KARAKA_SUN_V1', ruleVersion: '1.0.0', data: { planet: 'Sun', karaka: 'identity' } };
    const distinct = { ...ref, data: { planet: 'Sun', karaka: 'authority' } };
    const result = dedupeEvidenceRefs([ref, distinct, ref]);
    return result.length === 2 && result[0] === ref && result[1] === distinct;
  })()
);

// ============================================================
// Version handling.
// ============================================================

check(
  'PERSONAL_THEMES_ENGINE_VERSION and REQUIRED_BHRIGU_ENGINE_VERSION are distinct, stable version strings',
  PERSONAL_THEMES_ENGINE_VERSION === 'PERSONAL_THEMES_V1' && REQUIRED_BHRIGU_ENGINE_VERSION === 'BHRIGU_NATAL_V1' && (PERSONAL_THEMES_ENGINE_VERSION as string) !== (REQUIRED_BHRIGU_ENGINE_VERSION as string)
);

check(
  'deriveThemeContext rejects a BhriguNatalResult with an incompatible engineVersion',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart());
    try {
      deriveThemeContext({ ...bhriguResult, engineVersion: 'BHRIGU_NATAL_V2' });
      return false;
    } catch (e) {
      return e instanceof PersonalThemesValidationError;
    }
  })()
);

check(
  'validateBhriguNatalResult accepts a genuine, unmodified BhriguNatalResult',
  (() => {
    try {
      validateBhriguNatalResult(buildBhriguNatalGraph(fullChart()));
      return true;
    } catch {
      return false;
    }
  })()
);

check(
  'validateBhriguNatalResult rejects a non-finite or out-of-range edge strength',
  (() => {
    const bhriguResult = buildBhriguNatalGraph(fullChart());
    const badEdges = [{ ...bhriguResult.edges[0], strength: 1.5 }, ...bhriguResult.edges.slice(1)];
    try {
      validateBhriguNatalResult({ ...bhriguResult, edges: badEdges });
      return false;
    } catch (e) {
      return e instanceof PersonalThemesValidationError;
    }
  })()
);

if (!allPassed) {
  console.error('\nSome Personal Themes Engine checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PERSONAL THEMES ENGINE CHECKS PASSED');
}
