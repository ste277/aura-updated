/**
 * Bhrigu Natal Foundation V1: regression suite for packages/bhrigu/src --
 * a deterministic, Bhrigu/Nadi-inspired natal interpretation foundation
 * (normalization, karakas, sign-distance relationship detection,
 * configurable strength, graph, connected chains, structured evidence,
 * provenance). See packages/bhrigu/README.md for the product boundary
 * this package deliberately stays inside of (evidence, never
 * predictions/recommendations) -- this suite does not test anything
 * beyond that boundary.
 */
import {
  buildBhriguNatalGraph,
  normalizeNatalChart,
  fromGrahaPositions,
  classifyRelationship,
  getRelationshipStrength,
  relationshipSourceRuleId,
  signDistance,
  deriveChains,
  getKarakaThemes,
  PLANET_KARAKAS,
  ENGINE_VERSION,
  SUPPORTED_PLANETS,
  DEFAULT_RELATIONSHIP_WEIGHTS,
  validateRelationshipWeights,
  BhriguValidationError,
  BhriguChartPlanetInput,
  BhriguRelationshipType,
  BhriguRelationshipWeights,
  BhriguNatalEdge,
  BhriguNatalNode,
  PlanetId,
} from '../packages/bhrigu/src/index';
import type { GrahaPosition } from '../packages/vedic/src/natalChart';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

/** All 9 planets at 0 degrees Aries (sign 0) by default -- override specific planets per test. */
function chart(overrides: Partial<Record<PlanetId, number>> = {}): BhriguChartPlanetInput[] {
  return SUPPORTED_PLANETS.map((planet) => ({
    planet,
    longitude: (overrides[planet] ?? 0) as number,
  }));
}

function longitudeForSign(sign: number, degreeInSign = 0): number {
  return sign * 30 + degreeInSign;
}

// ============================================================
// Normalization.
// ============================================================

check(
  '0deg normalizes to sign 0, degree 0',
  (() => {
    const [sun] = normalizeNatalChart(chart({ Sun: 0 })).filter((p) => p.planet === 'Sun');
    return sun.sign === 0 && sun.degreeInSign === 0 && sun.longitude === 0;
  })()
);

check(
  '29.999deg stays in sign 0',
  normalizeNatalChart(chart({ Sun: 29.999 })).find((p) => p.planet === 'Sun')!.sign === 0
);

check(
  '30deg rolls into sign 1 at degree 0',
  (() => {
    const sun = normalizeNatalChart(chart({ Sun: 30 })).find((p) => p.planet === 'Sun')!;
    return sun.sign === 1 && sun.degreeInSign === 0;
  })()
);

check(
  '359.999deg stays in sign 11 (Pisces/Meena)',
  normalizeNatalChart(chart({ Sun: 359.999 })).find((p) => p.planet === 'Sun')!.sign === 11
);

check(
  '360deg normalizes to sign 0, degree 0 (full-circle wrap)',
  (() => {
    const sun = normalizeNatalChart(chart({ Sun: 360 })).find((p) => p.planet === 'Sun')!;
    return sun.sign === 0 && sun.degreeInSign === 0 && sun.longitude === 0;
  })()
);

check(
  'negative longitude normalizes correctly (-30deg -> 330deg, sign 11)',
  (() => {
    const sun = normalizeNatalChart(chart({ Sun: -30 })).find((p) => p.planet === 'Sun')!;
    return sun.longitude === 330 && sun.sign === 11 && sun.degreeInSign === 0;
  })()
);

check(
  'negative longitude that wraps more than once (-390deg == -30deg mod 360)',
  normalizeNatalChart(chart({ Sun: -390 })).find((p) => p.planet === 'Sun')!.longitude === 330
);

check(
  'a very large longitude normalizes correctly (725deg == 5deg mod 360)',
  normalizeNatalChart(chart({ Sun: 725 })).find((p) => p.planet === 'Sun')!.longitude === 5
);

check(
  'NaN longitude is rejected',
  (() => {
    try {
      normalizeNatalChart(chart({ Sun: NaN }));
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError;
    }
  })()
);

check(
  'Infinity longitude is rejected',
  (() => {
    try {
      normalizeNatalChart(chart({ Sun: Infinity }));
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError;
    }
  })()
);

check(
  '-Infinity longitude is rejected',
  (() => {
    try {
      normalizeNatalChart(chart({ Sun: -Infinity }));
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError;
    }
  })()
);

check(
  'a missing planet is rejected',
  (() => {
    try {
      normalizeNatalChart(chart().filter((p) => p.planet !== 'Ketu'));
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError && /Ketu/.test((e as Error).message);
    }
  })()
);

check(
  'a duplicate planet is rejected',
  (() => {
    try {
      normalizeNatalChart([...chart(), { planet: 'Sun', longitude: 10 }]);
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError && /Duplicate/.test((e as Error).message);
    }
  })()
);

check(
  'a supplied sign inconsistent with longitude is rejected',
  (() => {
    try {
      const input = chart({ Sun: 5 }); // sign 0
      const withBadSign = input.map((p) => (p.planet === 'Sun' ? { ...p, sign: 3 } : p));
      normalizeNatalChart(withBadSign);
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError && /inconsistent/.test((e as Error).message);
    }
  })()
);

check(
  'a supplied degreeInSign inconsistent with longitude is rejected',
  (() => {
    try {
      const input = chart({ Sun: 5 }); // degreeInSign should be 5
      const withBadDegree = input.map((p) => (p.planet === 'Sun' ? { ...p, degreeInSign: 20 } : p));
      normalizeNatalChart(withBadDegree);
      return false;
    } catch (e) {
      return e instanceof BhriguValidationError && /inconsistent/.test((e as Error).message);
    }
  })()
);

check(
  'a consistent supplied sign/degreeInSign is accepted (matches GrahaPosition-shaped input)',
  (() => {
    const input = chart({ Sun: 45 }); // sign 1, degree 15
    const withConsistent = input.map((p) => (p.planet === 'Sun' ? { ...p, sign: 1, degreeInSign: 15 } : p));
    const sun = normalizeNatalChart(withConsistent).find((p) => p.planet === 'Sun')!;
    return sun.sign === 1 && sun.degreeInSign === 15;
  })()
);

check(
  'fromGrahaPositions adapts the canonical GrahaPosition[] shape (packages/vedic) without recomputation',
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
    const normalized = normalizeNatalChart(fromGrahaPositions(positions));
    const sun = normalized.find((p) => p.planet === 'Sun')!;
    return sun.longitude === 12 && sun.sign === 0 && sun.degreeInSign === 12 && normalized.length === 9;
  })()
);

// ============================================================
// Relationship classification -- all V1 classes, symmetry, wraparound.
// ============================================================

check('same sign (distance 0) -> SAME_SIGN', classifyRelationship(0, 0) === 'SAME_SIGN');
check('distance 4 -> TRINE (5th)', classifyRelationship(0, 4) === 'TRINE');
check('distance 8 -> TRINE (9th)', classifyRelationship(0, 8) === 'TRINE');
check('distance 6 -> OPPOSITION (7th)', classifyRelationship(0, 6) === 'OPPOSITION');
check('distance 2 -> THREE_ELEVEN (3rd)', classifyRelationship(0, 2) === 'THREE_ELEVEN');
check('distance 10 -> THREE_ELEVEN (11th)', classifyRelationship(0, 10) === 'THREE_ELEVEN');
check('distance 1 -> TWO_TWELVE (2nd)', classifyRelationship(0, 1) === 'TWO_TWELVE');
check('distance 11 -> TWO_TWELVE (12th)', classifyRelationship(0, 11) === 'TWO_TWELVE');
check('distance 3 -> NONE', classifyRelationship(0, 3) === 'NONE');
check('distance 5 -> NONE', classifyRelationship(0, 5) === 'NONE');
check('distance 7 -> NONE', classifyRelationship(0, 7) === 'NONE');
check('distance 9 -> NONE', classifyRelationship(0, 9) === 'NONE');

check(
  'relationship classification is symmetric for every sign pair (0-11 x 0-11)',
  (() => {
    for (let a = 0; a < 12; a++) {
      for (let b = 0; b < 12; b++) {
        if (classifyRelationship(a, b) !== classifyRelationship(b, a)) return false;
      }
    }
    return true;
  })()
);

check(
  'zodiac wraparound near the Pisces/Aries boundary: sign 11 (Meena) and sign 0 (Mesha) are TWO_TWELVE, not NONE',
  classifyRelationship(11, 0) === 'TWO_TWELVE' && classifyRelationship(0, 11) === 'TWO_TWELVE'
);

check(
  'zodiac wraparound: sign 10 (Kumbha) and sign 0 (Mesha) are THREE_ELEVEN',
  classifyRelationship(10, 0) === 'THREE_ELEVEN'
);

check(
  'signDistance is directional and not itself symmetric (0->4 is 4, but 4->0 is 8)',
  signDistance(0, 4) === 4 && signDistance(4, 0) === 8
);

check(
  'signDistance directional pair (d, 12-d) always classifies identically',
  (() => {
    for (let d = 0; d < 12; d++) {
      const complement = (12 - d) % 12;
      // classifyRelationship only takes signs, not distances directly --
      // reconstruct via a fixed signA = 0.
      const viaD = classifyRelationship(0, d);
      const viaComplement = classifyRelationship(0, complement);
      if (viaD !== viaComplement) return false;
    }
    return true;
  })()
);

// ============================================================
// Strength -- exact default weights, custom overrides.
// ============================================================

check(
  'default weights match the documented V1 values exactly',
  DEFAULT_RELATIONSHIP_WEIGHTS.sameSign === 1.0 &&
    DEFAULT_RELATIONSHIP_WEIGHTS.trine === 0.75 &&
    DEFAULT_RELATIONSHIP_WEIGHTS.opposition === 0.5 &&
    DEFAULT_RELATIONSHIP_WEIGHTS.threeEleven === 0.25 &&
    DEFAULT_RELATIONSHIP_WEIGHTS.twoTwelve === 0.15 &&
    DEFAULT_RELATIONSHIP_WEIGHTS.none === 0.0
);

check(
  'getRelationshipStrength looks up each relationship type against the default weights correctly',
  (['SAME_SIGN', 'TRINE', 'OPPOSITION', 'THREE_ELEVEN', 'TWO_TWELVE', 'NONE'] as BhriguRelationshipType[]).every(
    (rel) => {
      const expected: Record<BhriguRelationshipType, number> = {
        SAME_SIGN: 1.0,
        TRINE: 0.75,
        OPPOSITION: 0.5,
        THREE_ELEVEN: 0.25,
        TWO_TWELVE: 0.15,
        NONE: 0.0,
      };
      return getRelationshipStrength(rel, DEFAULT_RELATIONSHIP_WEIGHTS) === expected[rel];
    }
  )
);

check(
  'a custom weights config overrides the defaults in buildBhriguNatalGraph',
  (() => {
    const customWeights: BhriguRelationshipWeights = {
      sameSign: 0.9,
      trine: 0.6,
      opposition: 0.4,
      threeEleven: 0.2,
      twoTwelve: 0.1,
      none: 0.0,
    };
    // Sun and Moon in the same sign under a custom config.
    const result = buildBhriguNatalGraph(chart({ Sun: 0, Moon: 0 }), { weights: customWeights });
    const edge = result.edges.find((e) => e.from === 'Sun' && e.to === 'Moon')!;
    return edge.relationship === 'SAME_SIGN' && edge.strength === 0.9;
  })()
);

check(
  'validateRelationshipWeights rejects a non-finite weight',
  (() => {
    try {
      validateRelationshipWeights({ ...DEFAULT_RELATIONSHIP_WEIGHTS, trine: NaN });
      return false;
    } catch {
      return true;
    }
  })()
);

check(
  'buildBhriguNatalGraph itself rejects a non-finite weight via the same validation',
  (() => {
    try {
      buildBhriguNatalGraph(chart(), { weights: { ...DEFAULT_RELATIONSHIP_WEIGHTS, opposition: Infinity } });
      return false;
    } catch {
      return true;
    }
  })()
);

// ============================================================
// Graph structure -- 9 nodes, 36 unique unordered pairs, deterministic order.
// ============================================================

const baseline = buildBhriguNatalGraph(chart());

check('graph has exactly 9 nodes for the 9 supported planets', baseline.nodes.length === 9);
check('graph has exactly 36 unique unordered edges (9 choose 2)', baseline.edges.length === 36);

check(
  'no duplicate/self edges exist',
  (() => {
    const seen = new Set<string>();
    for (const edge of baseline.edges) {
      if (edge.from === edge.to) return false;
      const key = [edge.from, edge.to].sort().join('|');
      if (seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  })()
);

check(
  'nodes are ordered in the fixed SUPPORTED_PLANETS canonical order',
  baseline.nodes.map((n) => n.planet).join(',') === SUPPORTED_PLANETS.join(',')
);

check(
  'edges are ordered deterministically: from always precedes to in canonical order, and pairs are listed in a stable (i, j) sweep',
  (() => {
    const indexOf = new Map(SUPPORTED_PLANETS.map((p, i) => [p, i]));
    for (const edge of baseline.edges) {
      if (indexOf.get(edge.from)! >= indexOf.get(edge.to)!) return false;
    }
    // Re-run and structurally compare edge order (see full determinism check further below too).
    const again = buildBhriguNatalGraph(chart());
    return JSON.stringify(baseline.edges.map((e) => [e.from, e.to])) === JSON.stringify(again.edges.map((e) => [e.from, e.to]));
  })()
);

check(
  'each node carries its planet\'s karaka themes',
  baseline.nodes.every((node) => JSON.stringify(node.karakas) === JSON.stringify(getKarakaThemes(node.planet)))
);

check('every result carries the engine version', baseline.engineVersion === ENGINE_VERSION && ENGINE_VERSION === 'BHRIGU_NATAL_V1');

// ============================================================
// Chains -- tested directly against deriveChains with hand-built
// synthetic edges, decoupled from real sign geometry (already covered
// exhaustively by the Relationship classification section above). This
// isolates chains.ts's own connected-component/scoring algorithm from
// whether a particular chart longitude happens to produce a given
// relationship -- constructing 9 real planet longitudes that pairwise
// classify to an EXACT intended relationship set by hand is fragile and
// duplicates coverage the relationship-classification tests already own.
// ============================================================

const dummyNodes: BhriguNatalNode[] = SUPPORTED_PLANETS.map((planet) => ({ planet, sign: 0, longitude: 0, karakas: [] }));

function makeSyntheticEdges(
  overrides: Partial<Record<string, { relationship: BhriguRelationshipType; strength: number }>>
): BhriguNatalEdge[] {
  const edges: BhriguNatalEdge[] = [];
  for (let i = 0; i < SUPPORTED_PLANETS.length; i++) {
    for (let j = i + 1; j < SUPPORTED_PLANETS.length; j++) {
      const from = SUPPORTED_PLANETS[i];
      const to = SUPPORTED_PLANETS[j];
      const override = overrides[`${from}|${to}`];
      const relationship: BhriguRelationshipType = override?.relationship ?? 'NONE';
      const strength = override?.strength ?? 0;
      edges.push({ from, to, relationship, strength, evidence: [], sourceRuleId: relationshipSourceRuleId(relationship) });
    }
  }
  return edges;
}

check(
  'all-zero relations: every edge NONE produces 9 single-node chains, each score 0, partitioning all 9 planets',
  (() => {
    const chains = deriveChains(dummyNodes, makeSyntheticEdges({}));
    return (
      chains.length === 9 &&
      chains.every((c) => c.planets.length === 1 && c.score === 0) &&
      chains.reduce((sum, c) => sum + c.planets.length, 0) === 9
    );
  })()
);

check(
  'one connected cluster: Sun-Moon-Mercury pairwise SAME_SIGN forms exactly one 3-planet chain, the other 6 planets remain single-node',
  (() => {
    const chains = deriveChains(
      dummyNodes,
      makeSyntheticEdges({
        'Sun|Moon': { relationship: 'SAME_SIGN', strength: 1.0 },
        'Sun|Mercury': { relationship: 'SAME_SIGN', strength: 1.0 },
        'Moon|Mercury': { relationship: 'SAME_SIGN', strength: 1.0 },
      })
    );
    const bigChain = chains.find((c) => c.planets.length === 3);
    const singleNodeChains = chains.filter((c) => c.planets.length === 1);
    return (
      chains.length === 7 &&
      bigChain !== undefined &&
      JSON.stringify(bigChain.planets) === JSON.stringify(['Sun', 'Moon', 'Mercury']) &&
      singleNodeChains.length === 6
    );
  })()
);

check(
  'transitive connection: A-B and B-C directly related, A-C NOT directly related, still forms one connected 3-planet chain',
  (() => {
    const chains = deriveChains(
      dummyNodes,
      makeSyntheticEdges({
        'Sun|Moon': { relationship: 'TRINE', strength: 0.75 },
        'Moon|Mercury': { relationship: 'TWO_TWELVE', strength: 0.15 },
        // Sun|Mercury deliberately left NONE (absent from overrides).
      })
    );
    const chain = chains.find((c) => c.planets.includes('Sun'))!;
    return (
      JSON.stringify(chain.planets) === JSON.stringify(['Sun', 'Moon', 'Mercury']) &&
      chains.filter((c) => c.planets.length === 1).length === 6
    );
  })()
);

check(
  'chain score excludes the zero-strength NONE pair within a transitively-connected chain from the mean -- A-B (0.75) - B-C (0.15), A-C NONE: score is (0.75+0.15)/2 = 0.45, never (0.75+0.15+0.00)/3',
  (() => {
    const chains = deriveChains(
      dummyNodes,
      makeSyntheticEdges({
        'Sun|Moon': { relationship: 'TRINE', strength: 0.75 },
        'Moon|Mercury': { relationship: 'TWO_TWELVE', strength: 0.15 },
        // Sun|Mercury deliberately left NONE -- this pair belongs to the
        // same connected component (transitively, via Moon) but must NOT
        // contribute a zero to the score's denominator.
      })
    );
    const chain = chains.find((c) => c.planets.includes('Sun'))!;
    const wrongScoreIfNoneCounted = (0.75 + 0.15 + 0.0) / 3; // 0.3, the bug this test guards against
    return Math.abs(chain.score - 0.45) < 1e-9 && Math.abs(chain.score - wrongScoreIfNoneCounted) > 1e-9;
  })()
);

check(
  'multiple disconnected clusters: two separate SAME_SIGN pairs plus five isolated planets produce exactly 7 chains (2 pairs + 5 singles), partitioning all 9 planets exactly once each',
  (() => {
    const chains = deriveChains(
      dummyNodes,
      makeSyntheticEdges({
        'Sun|Moon': { relationship: 'SAME_SIGN', strength: 1.0 },
        'Venus|Mars': { relationship: 'OPPOSITION', strength: 0.5 },
      })
    );
    const pairChains = chains.filter((c) => c.planets.length === 2);
    const singleChains = chains.filter((c) => c.planets.length === 1);
    const allPlanetsCoveredExactlyOnce = SUPPORTED_PLANETS.every(
      (p) => chains.filter((c) => c.planets.includes(p)).length === 1
    );
    return chains.length === 7 && pairChains.length === 2 && singleChains.length === 5 && allPlanetsCoveredExactlyOnce;
  })()
);

check(
  'chain score is the mean strength of internal edges only (documented rule, verified exactly, including a mixed-strength case)',
  (() => {
    const chains = deriveChains(
      dummyNodes,
      makeSyntheticEdges({
        'Sun|Moon': { relationship: 'SAME_SIGN', strength: 1.0 },
        'Sun|Mercury': { relationship: 'TRINE', strength: 0.75 },
        'Moon|Mercury': { relationship: 'TWO_TWELVE', strength: 0.15 },
      })
    );
    const chain = chains.find((c) => c.planets.length === 3)!;
    // mean(1.0, 0.75, 0.15) = 0.6333...
    return Math.abs(chain.score - (1.0 + 0.75 + 0.15) / 3) < 1e-9;
  })()
);

check(
  'a single-node chain always has score exactly 0 (no internal edges), never NaN',
  deriveChains(dummyNodes, makeSyntheticEdges({})).every((c) => c.planets.length !== 1 || c.score === 0)
);

check(
  'chains are ordered deterministically across repeated calls: larger chains first, ties broken by canonical first-member index',
  (() => {
    const edges = makeSyntheticEdges({
      'Sun|Moon': { relationship: 'SAME_SIGN', strength: 1.0 },
      'Mercury|Venus': { relationship: 'SAME_SIGN', strength: 1.0 },
    });
    const a = deriveChains(dummyNodes, edges);
    const b = deriveChains(dummyNodes, edges);
    const orderMatches = JSON.stringify(a) === JSON.stringify(b);
    const sizesDescending = a.every((c, i) => i === 0 || a[i - 1].planets.length >= c.planets.length);
    return orderMatches && sizesDescending;
  })()
);

check(
  'deriveChains is exported and directly usable, and buildBhriguNatalGraph\'s own end-to-end chains field agrees with a direct deriveChains call on the same nodes/edges it produced',
  (() => {
    const result = buildBhriguNatalGraph(chart({ Sun: 0, Moon: 0 }));
    const direct = deriveChains(result.nodes, result.edges);
    return JSON.stringify(direct.map((c) => ({ planets: c.planets, score: c.score }))) === JSON.stringify(result.chains);
  })()
);

check(
  'buildBhriguNatalGraph end-to-end: real chart geometry (Sun trine Moon, Moon two-twelve Mercury, Sun not directly related to Mercury) still produces one connected chain, matching the transitive case above',
  (() => {
    const result = buildBhriguNatalGraph(chart({ Sun: 0, Moon: longitudeForSign(4), Mercury: longitudeForSign(5) }));
    const sunMercury = result.edges.find((e) => e.from === 'Sun' && e.to === 'Mercury')!;
    const sameChain = result.chains.some(
      (c) => c.planets.includes('Sun') && c.planets.includes('Moon') && c.planets.includes('Mercury')
    );
    return sunMercury.relationship === 'NONE' && sameChain;
  })()
);

// ============================================================
// Evidence.
// ============================================================

// Deliberately NOT `baseline` here: every planet defaulting to longitude 0
// makes baseline's own 36 edges all SAME_SIGN, so a check filtered to
// "NONE edges" against baseline would be vacuously true (zero matching
// edges) rather than actually exercising that branch. This chart mixes
// Sun (sign 0), Moon (sign 3, distance 3 from Sun -> NONE), and Mercury
// (sign 4, distance 4 from Sun -> TRINE) against everything else still
// defaulted to sign 0 (SAME_SIGN with Sun) -- guaranteeing this single
// result contains a real mix of NONE and non-NONE edges.
const mixedResult = buildBhriguNatalGraph(chart({ Sun: 0, Moon: longitudeForSign(3), Mercury: longitudeForSign(4) }));

check(
  'the mixed-relationship fixture actually contains both NONE and non-NONE edges (guards the two checks below against being vacuously true)',
  mixedResult.edges.some((e) => e.relationship === 'NONE') && mixedResult.edges.some((e) => e.relationship !== 'NONE')
);

check(
  'every non-NONE edge has at least one evidence entry with a stable rule id matching its relationship type',
  mixedResult.edges
    .filter((e) => e.relationship !== 'NONE')
    .every((e) => e.evidence.length > 0 && e.evidence[0].ruleId === relationshipSourceRuleId(e.relationship))
);

check(
  'every NONE edge has zero evidence entries (nothing to explain)',
  mixedResult.edges.filter((e) => e.relationship === 'NONE').every((e) => e.evidence.length === 0)
);

check(
  'relationship evidence facts contain enough to reconstruct why it matched (signs, both directional distances, relationship, strength)',
  (() => {
    const result = buildBhriguNatalGraph(chart({ Sun: 0, Moon: longitudeForSign(4) }));
    const edge = result.edges.find((e) => e.from === 'Sun' && e.to === 'Moon')!;
    const fact = edge.evidence[0].facts;
    return (
      fact.signA === 0 &&
      fact.signB === 4 &&
      fact.signDistanceAtoB === 4 &&
      fact.signDistanceBtoA === 8 &&
      fact.relationship === 'TRINE' &&
      fact.strength === 0.75
    );
  })()
);

check(
  'top-level evidence includes one KARAKA entry per planet, with the correct rule id and themes',
  (() => {
    const karakaEvidence = baseline.evidence.filter((e) => e.category === 'KARAKA');
    return (
      karakaEvidence.length === 9 &&
      karakaEvidence.every((e) => {
        const planet = e.planets[0];
        return e.ruleId === PLANET_KARAKAS[planet].sourceRuleId && JSON.stringify(e.facts.themes) === JSON.stringify(getKarakaThemes(planet));
      })
    );
  })()
);

check(
  'top-level evidence includes a CHAIN entry only for multi-planet chains, never for single-node chains',
  (() => {
    const result = buildBhriguNatalGraph(
      chart({ Sun: 0, Moon: 0, Mercury: longitudeForSign(3), Venus: longitudeForSign(6), Mars: longitudeForSign(9) })
    );
    const chainEvidence = result.evidence.filter((e) => e.category === 'CHAIN');
    const multiPlanetChainCount = result.chains.filter((c) => c.planets.length > 1).length;
    return chainEvidence.length === multiPlanetChainCount;
  })()
);

check(
  'evidence never contains prediction prose -- facts are structured data only (no free-text "you will"/"prediction" strings anywhere in the engine output)',
  !/you will|prediction|your career|marriage/i.test(JSON.stringify(baseline))
);

// ============================================================
// Provenance / versioning.
// ============================================================

check(
  'every karaka definition has a stable BHRIGU_KARAKA_<PLANET>_V1 rule id',
  SUPPORTED_PLANETS.every((planet) => PLANET_KARAKAS[planet].sourceRuleId === `BHRIGU_KARAKA_${planet.toUpperCase()}_V1`)
);

check(
  'every relationship type has a stable BHRIGU_REL_<NAME>_V1 rule id',
  relationshipSourceRuleId('SAME_SIGN') === 'BHRIGU_REL_SAME_SIGN_V1' &&
    relationshipSourceRuleId('TRINE') === 'BHRIGU_REL_TRINE_V1' &&
    relationshipSourceRuleId('OPPOSITION') === 'BHRIGU_REL_OPPOSITION_V1' &&
    relationshipSourceRuleId('THREE_ELEVEN') === 'BHRIGU_REL_THREE_ELEVEN_V1' &&
    relationshipSourceRuleId('TWO_TWELVE') === 'BHRIGU_REL_TWO_TWELVE_V1' &&
    relationshipSourceRuleId('NONE') === 'BHRIGU_REL_NONE_V1'
);

check('engine version follows the BHRIGU_<NAME>_V1 pattern', ENGINE_VERSION === 'BHRIGU_NATAL_V1');

check(
  'engine output contains no timestamps or other non-deterministic fields (deep-equality-friendly by construction)',
  !/"(timestamp|createdAt|generatedAt|now)"/i.test(JSON.stringify(baseline))
);

// ============================================================
// Determinism.
// ============================================================

check(
  'calling buildBhriguNatalGraph twice with the same chart/options produces deeply-equal output',
  (() => {
    const chartInput = chart({ Sun: 10, Moon: longitudeForSign(4, 5), Mercury: longitudeForSign(8) });
    const a = buildBhriguNatalGraph(chartInput);
    const b = buildBhriguNatalGraph(chartInput);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

check(
  'calling buildBhriguNatalGraph 5 times in a row is stable (no incidental Map/Set ordering leakage)',
  (() => {
    const chartInput = chart({ Sun: 15, Moon: longitudeForSign(2), Venus: longitudeForSign(2), Mars: longitudeForSign(7) });
    const results = Array.from({ length: 5 }, () => JSON.stringify(buildBhriguNatalGraph(chartInput)));
    return results.every((r) => r === results[0]);
  })()
);

check(
  'chart input array order does not affect output (only planet identity matters, never input array position)',
  (() => {
    const forward = chart({ Sun: 0, Moon: longitudeForSign(4), Mercury: longitudeForSign(8) });
    const reversed = [...forward].reverse();
    const a = buildBhriguNatalGraph(forward);
    const b = buildBhriguNatalGraph(reversed);
    return JSON.stringify(a) === JSON.stringify(b);
  })()
);

// ============================================================
// Product boundary -- this package produces evidence, not conclusions,
// and does not touch Home/Timeline/Muhurta/Panchang/AuraFit/DB/API.
// ============================================================

check(
  'no Panchang/Muhurta/Home/Timeline/database/API coupling exists in the package source',
  (() => {
    const fs = require('fs');
    const srcFiles = [
      'packages/bhrigu/src/types.ts',
      'packages/bhrigu/src/constants.ts',
      'packages/bhrigu/src/normalize.ts',
      'packages/bhrigu/src/karakas.ts',
      'packages/bhrigu/src/relationships.ts',
      'packages/bhrigu/src/graph.ts',
      'packages/bhrigu/src/chains.ts',
      'packages/bhrigu/src/evidence.ts',
      'packages/bhrigu/src/provenance.ts',
      'packages/bhrigu/src/index.ts',
    ];
    return srcFiles.every((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return !/panchang|muhurta|auraFit|HomeDashboard|Timeline|prisma|fetch\(|localStorage|Dasha|Ashtakavarga|BhriguBindu/i.test(
        source
      );
    });
  })()
);

if (!allPassed) {
  console.error('\nSome Bhrigu Natal Foundation checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL BHRIGU NATAL FOUNDATION CHECKS PASSED');
}
