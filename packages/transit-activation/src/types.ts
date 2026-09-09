/**
 * Transit Activation Engine V1 -- shared types.
 *
 * This package deterministically detects sign-level transit-to-natal
 * geometry ("is transiting Saturn currently activating natal Moon, and
 * how strongly?") from already-known sidereal Rashi placements -- it
 * never calculates planetary astronomy itself (see engine.ts's own doc
 * comment). It is an ACTIVATION-DETECTION engine, not a horoscope
 * composer: no interpretation, polarity, or product scoring (see
 * README.md's "Non-goals" section).
 */
import type { GrahaName } from '../../vedic/src/natalChart';
import type { BhriguRelationshipType } from '../../bhrigu/src/types';
import type { TRANSIT_ACTIVATION_ENGINE_VERSION, TRANSIT_RELATIONSHIP_RULESET_VERSION } from './provenance';

/**
 * 0-11 zodiac-sign index, matching packages/vedic/src/natalChart.ts's
 * own `rashiIndex` convention exactly (0 = Mesha/Aries .. 11 =
 * Meena/Pisces) -- a plain number alias, not a re-declared enum,
 * mirroring the identical precedent already established by
 * packages/bhrigu, packages/ashtakavarga, and packages/lagna.
 */
export type ZodiacSign = number;

/** The canonical 9 grahas this engine evaluates -- see constants.ts's own TRANSIT_ACTIVATION_PLANETS doc comment for why Rahu/Ketu ARE included here (unlike packages/ashtakavarga). */
export type TransitActivationPlanet = GrahaName;

/**
 * The sign-relationship category -- a direct type alias of
 * packages/bhrigu's own `BhriguRelationshipType`, NOT a redeclared
 * union. See relationships.ts's own module doc comment for why this
 * package reuses Bhrigu's classification/weight logic verbatim rather
 * than inventing a second, potentially-drifting sign-relationship model
 * for the identical geometric categories.
 */
export type TransitRelationship = BhriguRelationshipType;

/**
 * A minimal, structural evidence reference -- shape-compatible in spirit
 * with packages/personal-intelligence's own PersonalEvidenceRef (stable
 * source + ruleId + ruleVersion + human summary + JSON-safe data), so a
 * future adapter could translate it without a structural mismatch.
 * Deliberately a LOCAL type (not importing PersonalEvidenceRef directly)
 * -- this package has zero dependency on packages/personal-intelligence
 * anywhere, including adapter.ts. See README.md's "Personal Intelligence
 * adapter -- deferred" section for why no such adapter is built in V1.
 */
export interface TransitActivationEvidenceRef {
  source: 'TRANSIT_ACTIVATION';
  ruleId: string;
  ruleVersion: string;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * One directed transiting-planet -> natal-planet activation. Direction
 * matters: `transitingPlanet: Saturn, natalPlanet: Moon` is a distinct
 * activation identity from `transitingPlanet: Moon, natalPlanet: Saturn`,
 * even when both share the same relationship CATEGORY (relationship
 * classification is geometrically symmetric -- see relationships.ts --
 * but activation IDENTITY never is, since transitingPlanet/natalPlanet
 * are always kept as separate, explicitly-labeled fields).
 *
 * `relationship` may be `'NONE'` at this type level (the pure per-pair
 * evaluator computes all 81 pairs, see activation.ts), but the public
 * engine's own returned `activations` array (engine.ts) always excludes
 * NONE pairs -- see README.md's "Filtering" section.
 */
export interface TransitActivationPair {
  transitingPlanet: TransitActivationPlanet;
  natalPlanet: TransitActivationPlanet;
  transitSign: ZodiacSign;
  natalSign: ZodiacSign;
  relationship: TransitRelationship;
  /** [0, 1] -- how strongly this transit geometry activates the natal placement. NOT a favorable/unfavorable score -- see README.md's "Strength" section. */
  strength: number;
  ruleId: string;
  evidence: TransitActivationEvidenceRef[];
}

/**
 * The minimal, structural, already-normalized input this engine's core
 * function needs -- plain sidereal Rashi indices for all 9 planets,
 * plus an explicit evaluation instant (ISO-8601 UTC string) that is
 * NEVER inferred from ambient time -- see engine.ts's own doc comment
 * for the public adapter that bridges from real Aura natal/transit
 * GrahaPosition[] results to this shape.
 */
export interface TransitActivationInput {
  natalSigns: Record<TransitActivationPlanet, ZodiacSign>;
  transitSigns: Record<TransitActivationPlanet, ZodiacSign>;
  /** ISO-8601 UTC instant string, caller-supplied, echoed into the result/evidence -- never computed via Date.now(). */
  evaluationTime: string;
}

/** The complete V1 result. Output is JSON-safe -- `evaluationTime` is already a plain string (never a raw Date object). Compact by design -- see README.md's "Payload size discipline" section: no upstream chart/graph/Ashtakavarga payloads are embedded. */
export interface TransitActivationResult {
  engineVersion: typeof TRANSIT_ACTIVATION_ENGINE_VERSION;
  relationshipRulesetVersion: typeof TRANSIT_RELATIONSHIP_RULESET_VERSION;
  evaluationTime: string;
  /** The exact 9-planet set evaluated (both as transiting and as natal reference) -- see constants.ts's own TRANSIT_ACTIVATION_PLANETS. */
  evaluatedPlanets: readonly TransitActivationPlanet[];
  /** Only non-NONE activations (see README.md's "Filtering" section) -- never all 81 raw pairs. */
  activations: readonly TransitActivationPair[];
  evidence: readonly TransitActivationEvidenceRef[];
}

/** Thrown by engine.ts on malformed normalized input (missing/invalid/duplicate sign, invalid evaluationTime). */
export class TransitActivationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransitActivationValidationError';
  }
}
