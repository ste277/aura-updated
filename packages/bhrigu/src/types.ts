/**
 * Bhrigu Natal Foundation V1 -- shared types.
 *
 * This package is a deterministic, Bhrigu/Nadi-INSPIRED interpretive
 * engine, not a verified historical manuscript lookup. It answers "what
 * stable natal themes and planetary relationships can Aura derive from a
 * birth chart?" -- never "what should the user do today?" (a later
 * product layer, not implemented here). See ../README.md.
 *
 * Planet identity deliberately reuses GrahaName (packages/vedic/src/
 * natalChart.ts) rather than inventing a second, incompatible planet
 * union -- that file is this repo's one existing natal-chart calculator
 * (getNatalChart), and its GrahaName ('Sun' | 'Moon' | ... | 'Rahu' |
 * 'Ketu') already represents Rahu/Ketu as two ordinary entries, exactly
 * the representation this package needs. PlanetId is a plain type alias,
 * not a re-declaration, so a GrahaName value is a PlanetId and vice versa
 * with zero conversion.
 */
import type { GrahaName } from '../../vedic/src/natalChart';

export type PlanetId = GrahaName;

/**
 * The 0-11 zodiac-sign index, matching packages/vedic/src/natalChart.ts's
 * own `rashiIndex` convention exactly (0 = Mesha/Aries, 11 = Meena/Pisces).
 * Deliberately a plain number, not a 12-member string-literal union or a
 * new Sanskrit/English name enum -- packages/vedic/src/natalChart.ts's own
 * RASHI_NAMES array is a private, unexported implementation detail of
 * that module, and this package has no need for a display name at the
 * engine level (a future consumer that already has the natal chart also
 * already has rashiName available from GrahaPosition directly).
 */
export type ZodiacSign = number;

/** A single planet's normalized position, validated at the boundary by normalize.ts. */
export interface NatalPlanet {
  planet: PlanetId;
  /** Sidereal ecliptic longitude, normalized into [0, 360). */
  longitude: number;
  sign: ZodiacSign;
  /** Degree within `sign`, in [0, 30). */
  degreeInSign: number;
}

/** Traditional planetary significations -- versioned interpretive metadata, not scientific fact. */
export interface PlanetKarakaDefinition {
  planet: PlanetId;
  themes: string[];
  sourceRuleId: string;
  version: string;
}

export type BhriguRelationshipType =
  | 'SAME_SIGN'
  | 'TRINE'
  | 'OPPOSITION'
  | 'THREE_ELEVEN'
  | 'TWO_TWELVE'
  | 'NONE';

/**
 * V1 configurable relationship-strength weights. These are product-model
 * configuration, not scientific or scriptural truth -- see
 * constants.ts's DEFAULT_RELATIONSHIP_WEIGHTS and README.md.
 */
export interface BhriguRelationshipWeights {
  sameSign: number;
  trine: number;
  opposition: number;
  threeEleven: number;
  twoTwelve: number;
  none: number;
}

export interface BhriguNatalOptions {
  /** Defaults to DEFAULT_RELATIONSHIP_WEIGHTS (constants.ts) when omitted. */
  weights?: BhriguRelationshipWeights;
}

export interface BhriguNatalNode {
  planet: PlanetId;
  sign: ZodiacSign;
  longitude: number;
  karakas: string[];
}

/**
 * One canonical undirected edge per unordered planet pair (36 for the 9
 * supported planets) -- `from`/`to` are ordered by this package's fixed
 * canonical planet order (constants.ts's SUPPORTED_PLANETS), never by
 * caller input order, so the same pair always produces byte-identical
 * `from`/`to` regardless of chart array ordering. `relationship`/
 * `strength` are the single symmetric classification (see
 * relationships.ts) -- directional sign-distance detail lives only in
 * this edge's own evidence facts, never in `from`/`to` order itself.
 */
export interface BhriguNatalEdge {
  from: PlanetId;
  to: PlanetId;
  relationship: BhriguRelationshipType;
  strength: number;
  evidence: BhriguEvidence[];
  sourceRuleId: string;
}

export interface BhriguEvidenceFacts {
  signA?: ZodiacSign;
  signB?: ZodiacSign;
  /** Directional sign-distance A -> B, in [0, 11] -- see relationships.ts's own doc comment for the exact normalization. */
  signDistanceAtoB?: number;
  /** Directional sign-distance B -> A, in [0, 11]. */
  signDistanceBtoA?: number;
  relationship?: BhriguRelationshipType;
  strength?: number;
  themes?: string[];
  chainPlanets?: PlanetId[];
  chainScore?: number;
}

/**
 * Structured, replayable evidence -- never prediction prose. Lets a
 * future consumer answer "why did Aura derive this theme?" by reading
 * `facts`, without rerunning any hidden interpretation logic.
 */
export interface BhriguEvidence {
  ruleId: string;
  ruleVersion: string;
  category: 'KARAKA' | 'RELATIONSHIP' | 'CHAIN';
  planets: PlanetId[];
  facts: BhriguEvidenceFacts;
}

/**
 * A connected component of the non-NONE relationship graph. Every
 * supported planet appears in exactly one chain -- an isolated planet
 * (no non-NONE edges to anything) forms its own single-node chain rather
 * than being omitted, so `chains` always partitions the full planet set
 * and a consumer never has to separately ask "what happened to planet X?"
 * See chains.ts's own doc comment for the exact algorithm and score
 * definition.
 */
export interface BhriguPlanetaryChain {
  planets: PlanetId[];
  /** Mean strength of the edges connecting this chain's own members; 0 for a single-node chain (no internal edges). See chains.ts. */
  score: number;
}

export interface BhriguNatalResult {
  engineVersion: string;
  nodes: BhriguNatalNode[];
  edges: BhriguNatalEdge[];
  chains: BhriguPlanetaryChain[];
  evidence: BhriguEvidence[];
}

/** Thrown by normalize.ts on any invalid/contradictory input -- see normalize.ts's own doc comment for exactly which conditions reject. */
export class BhriguValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BhriguValidationError';
  }
}
