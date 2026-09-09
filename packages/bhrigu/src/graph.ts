/**
 * Bhrigu Natal Foundation V1 -- deterministic planetary relationship graph.
 *
 * This is the package's main public entry point. It composes
 * normalize.ts (input validation), karakas.ts (significations),
 * relationships.ts (sign-distance classification/strength), evidence.ts
 * (structured provenance), and chains.ts (connected components) into one
 * BhriguNatalResult -- it performs no astronomy, no date/timezone
 * handling, no I/O of any kind.
 */
import { DEFAULT_RELATIONSHIP_WEIGHTS, ENGINE_VERSION, SUPPORTED_PLANETS, validateRelationshipWeights } from './constants';
import { deriveChains } from './chains';
import { buildKarakaEvidence, buildRelationshipEvidence } from './evidence';
import { getKarakaDefinition, getKarakaThemes } from './karakas';
import { normalizeNatalChart, BhriguChartPlanetInput } from './normalize';
import { classifyRelationship, getRelationshipStrength, relationshipSourceRuleId, signDistance } from './relationships';
import {
  BhriguNatalEdge,
  BhriguNatalNode,
  BhriguNatalOptions,
  BhriguNatalResult,
  NatalPlanet,
} from './types';

/**
 * Builds the deterministic Bhrigu natal graph for a chart.
 *
 * Determinism: nodes, edges, and evidence are all produced by iterating
 * the fixed SUPPORTED_PLANETS canonical order (constants.ts) -- never the
 * caller's own input array order, a Map/object's own iteration order, or
 * anything locale-dependent. Two calls with structurally identical
 * `chart`/`options` always produce a deeply-equal BhriguNatalResult (see
 * test/bhriguNatalFoundation.test.ts's own determinism checks). No
 * randomness, no current time, no network/DB access.
 */
export function buildBhriguNatalGraph(
  chart: BhriguChartPlanetInput[],
  options: BhriguNatalOptions = {}
): BhriguNatalResult {
  const weights = options.weights ?? DEFAULT_RELATIONSHIP_WEIGHTS;
  validateRelationshipWeights(weights);

  const planets = normalizeNatalChart(chart);
  const byPlanet = new Map<string, NatalPlanet>(planets.map((planet) => [planet.planet, planet]));

  const nodes: BhriguNatalNode[] = SUPPORTED_PLANETS.map((planetId) => {
    const planet = byPlanet.get(planetId)!;
    return {
      planet: planet.planet,
      sign: planet.sign,
      longitude: planet.longitude,
      karakas: getKarakaThemes(planet.planet),
    };
  });

  const edges: BhriguNatalEdge[] = [];

  // Every unordered pair among the 9 supported planets exactly once (36
  // total), iterating SUPPORTED_PLANETS' own fixed order for both indices
  // -- from/to on each edge are therefore always in canonical order too,
  // regardless of chart input order.
  for (let i = 0; i < SUPPORTED_PLANETS.length; i++) {
    for (let j = i + 1; j < SUPPORTED_PLANETS.length; j++) {
      const planetA = byPlanet.get(SUPPORTED_PLANETS[i])!;
      const planetB = byPlanet.get(SUPPORTED_PLANETS[j])!;

      const relationship = classifyRelationship(planetA.sign, planetB.sign);
      const strength = getRelationshipStrength(relationship, weights);
      const ruleId = relationshipSourceRuleId(relationship);

      const evidence =
        relationship === 'NONE'
          ? []
          : [
              buildRelationshipEvidence({
                planetA: planetA.planet,
                planetB: planetB.planet,
                signA: planetA.sign,
                signB: planetB.sign,
                signDistanceAtoB: signDistance(planetA.sign, planetB.sign),
                signDistanceBtoA: signDistance(planetB.sign, planetA.sign),
                relationship,
                strength,
                ruleId,
              }),
            ];

      edges.push({
        from: planetA.planet,
        to: planetB.planet,
        relationship,
        strength,
        evidence,
        sourceRuleId: ruleId,
      });
    }
  }

  const chains = deriveChains(nodes, edges);

  const evidence = [
    ...SUPPORTED_PLANETS.map((planetId) => buildKarakaEvidence(getKarakaDefinition(planetId))),
    ...edges.flatMap((edge) => edge.evidence),
    ...chains.filter((chain) => chain.planets.length > 1).flatMap((chain) => chain.evidence),
  ];

  return {
    engineVersion: ENGINE_VERSION,
    nodes,
    edges,
    chains: chains.map(({ evidence: _chainEvidence, ...chain }) => chain),
    evidence,
  };
}
