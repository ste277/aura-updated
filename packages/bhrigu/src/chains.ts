/**
 * Bhrigu Natal Foundation V1 -- connected planetary chains.
 *
 * A chain is a connected component of the graph restricted to edges with
 * a real (non-NONE) relationship -- i.e. two planets are in the same
 * chain if you can walk from one to the other only crossing edges that
 * aren't NONE, even if they aren't directly related themselves (A-B-C
 * transitively connected, A-C not directly related, still one chain).
 *
 * Every supported planet appears in exactly one chain. A planet with no
 * non-NONE edge to any other planet forms its own single-node chain
 * (score 0, no internal edges) rather than being omitted -- this was a
 * deliberate choice (not forced by the brief) so `chains` always
 * partitions the full SUPPORTED_PLANETS set: a consumer can always find
 * every planet in exactly one chain without a separate "what about the
 * leftover planets?" lookup.
 *
 * Chain score is the mean strength of the chain's own INTERNAL, NON-NONE
 * edges only -- i.e. only the real (non-NONE) relationships among this
 * chain's members, never every possible pair within it. A transitively-
 * connected chain (A-B-C, A-C not directly related) has exactly TWO
 * internal edges here (A-B and B-C), not three: the NONE A-C pair is
 * excluded from both the sum and the count, not averaged in as a zero.
 * Concretely, for A-B strength 0.75 and B-C strength 0.15 with A-C NONE,
 * the score is (0.75 + 0.15) / 2 = 0.45, never (0.75 + 0.15 + 0.00) / 3.
 * This is an explicit, documented choice (mean of the REAL edges only,
 * not sum, and never diluted by NONE pairs) so a chain's score reads as
 * "how strongly connected the real relationships in this chain are, on
 * average" rather than being pulled toward zero by however many
 * non-relationships the chain's size incidentally implies. A single-node
 * chain has no internal edges at all, so its score is 0 by definition,
 * not NaN/undefined.
 */
import { buildChainEvidence } from './evidence';
import { SUPPORTED_PLANETS } from './constants';
import type { BhriguEvidence, BhriguNatalEdge, BhriguNatalNode, BhriguPlanetaryChain, PlanetId } from './types';

interface ChainWithEvidence extends BhriguPlanetaryChain {
  evidence: BhriguEvidence[];
}

/** Union-find (disjoint-set) over SUPPORTED_PLANETS, merged by every non-NONE edge. Deterministic: iterates `edges` in the caller's own (already canonical) order, and every subsequent traversal iterates SUPPORTED_PLANETS' own fixed order, never a Map/Set's incidental iteration order. */
export function deriveChains(nodes: BhriguNatalNode[], edges: BhriguNatalEdge[]): ChainWithEvidence[] {
  const parent = new Map<PlanetId, PlanetId>();
  for (const node of nodes) parent.set(node.planet, node.planet);

  function find(planet: PlanetId): PlanetId {
    let root = planet;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression, but this only affects lookup speed -- the final
    // grouping (which planets share a root) is unaffected, so it has no
    // bearing on determinism.
    parent.set(planet, root);
    return root;
  }

  function union(a: PlanetId, b: PlanetId): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  for (const edge of edges) {
    if (edge.relationship !== 'NONE') {
      union(edge.from, edge.to);
    }
  }

  const groups = new Map<PlanetId, PlanetId[]>();
  for (const planetId of SUPPORTED_PLANETS) {
    const root = find(planetId);
    const group = groups.get(root);
    if (group) {
      group.push(planetId);
    } else {
      groups.set(root, [planetId]);
    }
  }

  const edgesByPair = new Map<string, BhriguNatalEdge>();
  for (const edge of edges) {
    edgesByPair.set(`${edge.from}|${edge.to}`, edge);
  }

  const chains: ChainWithEvidence[] = [];
  for (const [, members] of groups) {
    // `members` was built by iterating SUPPORTED_PLANETS above, so it is
    // already in canonical planet order -- no re-sort needed.
    const internalEdges: BhriguNatalEdge[] = [];
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const edge = edgesByPair.get(`${members[i]}|${members[j]}`);
        if (edge && edge.relationship !== 'NONE') {
          internalEdges.push(edge);
        }
      }
    }

    const score =
      internalEdges.length === 0
        ? 0
        : internalEdges.reduce((sum, edge) => sum + edge.strength, 0) / internalEdges.length;

    chains.push({
      planets: members,
      score,
      evidence: members.length > 1 ? [buildChainEvidence(members, score)] : [],
    });
  }

  // Deterministic chain ordering: larger chains first, then by the
  // canonical index of the chain's first (lowest-index) member -- since
  // `groups` is a plain Map keyed by an arbitrary union-find root planet,
  // its own iteration order is an implementation detail this function
  // does not rely on; this explicit sort is what actually guarantees
  // stable output ordering across calls.
  const canonicalIndex = new Map(SUPPORTED_PLANETS.map((planet, index) => [planet, index]));
  chains.sort((a, b) => {
    if (b.planets.length !== a.planets.length) return b.planets.length - a.planets.length;
    return canonicalIndex.get(a.planets[0])! - canonicalIndex.get(b.planets[0])!;
  });

  return chains;
}
