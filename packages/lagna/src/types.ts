/**
 * Natal Ascendant / Lagna Foundation V1 -- shared types.
 *
 * This package deterministically calculates the tropical and Lahiri
 * sidereal Ascendant (Lagna) for a birth moment (UTC) + geographic
 * coordinates. It does not calculate any other planetary position (see
 * packages/vedic/src/natalChart.ts for that) and does not implement a
 * house system, Ashtakavarga, or any product interpretation -- see
 * README.md's "Non-goals" section.
 */
import type { NATAL_LAGNA_ENGINE_VERSION } from './provenance';

/**
 * A minimal, structural evidence reference. This package deliberately
 * does NOT import packages/personal-intelligence's own PersonalEvidenceRef
 * type (unlike packages/vimshottari, which is allowed to depend on that
 * package) -- Natal Ascendant is a pure math-core astronomy primitive with
 * no personalization-contract relationship, and importing that contract
 * here would create a dependency this package has no genuine need for.
 * The shape below is intentionally identical in spirit (stable source +
 * ruleId + ruleVersion + human summary + JSON-safe data), so a future
 * consumer that DOES need to adapt this into PersonalEvidenceRef can do
 * so with a trivial field-for-field mapping.
 */
export interface NatalLagnaEvidenceRef {
  source: 'NATAL_LAGNA';
  ruleId: string;
  ruleVersion: string;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * The minimal, structural input this engine needs -- plain mathematical
 * quantities only, never a raw birth-profile/database record (see
 * engine.ts's own doc comment, and README.md's "Required inputs"
 * section). `latitude`/`longitude` are geographic (WGS84-equivalent
 * precision is not required for this purpose), NOT ecliptic coordinates.
 */
export interface NatalAscendantInput {
  birthMomentUTC: Date;
  /** Degrees north of the equator, in (-90, 90) -- south is negative. */
  latitude: number;
  /** Degrees east of Greenwich, in [-180, 180] -- west is negative. See constants.ts's own MAX/MIN_VALID_LONGITUDE doc comment. */
  longitude: number;
}

/**
 * The complete V1 result. Structurally mirrors packages/vedic/src/
 * natalChart.ts's own `GrahaPosition` (`siderealLongitude`, `rashiIndex`,
 * `rashiName`, `degreeInRashi`) so a future consumer can handle Lagna
 * alongside a GrahaPosition[] with minimal special-casing -- but Lagna is
 * deliberately NOT typed as (and does not extend) GrahaPosition or
 * GrahaName: the Ascendant is a horizon/ecliptic intersection point, not
 * a planet ("graha"), and conflating the two would misrepresent what it
 * astronomically is (see README.md's "Non-goals" section: no house
 * system, no claim that Lagna is a ninth/tenth graha).
 */
export interface NatalAscendant {
  engineVersion: typeof NATAL_LAGNA_ENGINE_VERSION;

  /** Tropical (of-date) ecliptic longitude of the Ascendant, in [0, 360). */
  tropicalLongitude: number;
  /** Lahiri sidereal ecliptic longitude of the Ascendant, in [0, 360) -- tropicalLongitude minus ayanamsaDegrees, normalized. */
  siderealLongitude: number;

  /** 0-11, Mesha(Aries)=0 .. Meena(Pisces)=11 -- see constants.ts's own RASHI_NAMES doc comment for why this is a local re-declaration, not an import. */
  rashiIndex: number;
  rashiName: string;
  /** Degree within `rashiIndex`, in [0, 30). */
  degreeInRashi: number;

  /** The exact Lahiri ayanamsa (degrees) subtracted from tropicalLongitude to obtain siderealLongitude -- packages/vedic/src/panchangElements.ts's own lahiriAyanamsa(birthMomentUTC), reused verbatim, never re-derived. */
  ayanamsaDegrees: number;

  evidence: NatalLagnaEvidenceRef[];
}

/** Thrown by engine.ts on malformed input (invalid Date, non-finite/out-of-range latitude or longitude). */
export class NatalLagnaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NatalLagnaValidationError';
  }
}

/**
 * Thrown only for a genuine numerical/definitional singularity in the
 * Ascendant computation itself (see ascendant.ts's own doc comment) --
 * distinct from NatalLagnaValidationError, which rejects malformed INPUT
 * before any computation is attempted. In practice this should only ever
 * be reachable for latitude values excluded by MIN/MAX_VALID_LATITUDE
 * already being rejected as invalid input, so this class exists as a
 * documented, typed defensive backstop (per this PR's own brief: "return
 * a typed deterministic error rather than NaN... do not hide it with
 * arbitrary fallback values") rather than a condition expected to occur
 * during normal operation.
 */
export class NatalLagnaComputationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NatalLagnaComputationError';
  }
}
