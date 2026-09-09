/**
 * Ashtakavarga Engine V1 -- shared types.
 *
 * This package deterministically calculates the seven classical Bhinna
 * Ashtakavarga (BAV) tables and the aggregate raw Sarvashtakavarga (SAV)
 * from already-known sidereal Rashi (zodiac sign) placements -- it never
 * calculates planetary/Lagna astronomy itself (see engine.ts's own doc
 * comment). Deliberately does NOT import packages/personal-intelligence's
 * own PersonalEvidenceRef type (matching packages/lagna's own precedent
 * for the identical reason): this is a pure math-core traditional
 * calculation primitive, and this PR's own brief explicitly defers any
 * PersonalSupportContext adapter to a later composition PR (see
 * README.md's "Personal Intelligence contract" section) -- there is no
 * genuine dependency this package needs on that contract today.
 */
import type { ASHTAKAVARGA_ENGINE_VERSION, ASHTAKAVARGA_RULESET_VERSION } from './provenance';

/**
 * A minimal, structural evidence reference -- shape-compatible in spirit
 * with packages/personal-intelligence's own PersonalEvidenceRef (stable
 * source + ruleId + ruleVersion + human summary + JSON-safe data), so a
 * future consumer that DOES need to adapt this into that contract can do
 * so with a trivial field-for-field mapping.
 */
export interface AshtakavargaEvidenceRef {
  source: 'ASHTAKAVARGA';
  ruleId: string;
  ruleVersion: string;
  summary: string;
  data?: Record<string, unknown>;
}

/**
 * 0-11 zodiac-sign index, matching packages/vedic/src/natalChart.ts's own
 * `rashiIndex` convention exactly (0 = Mesha/Aries .. 11 = Meena/Pisces)
 * and packages/lagna's own `NatalAscendant.rashiIndex`. A plain number
 * alias, not a re-declared enum -- mirroring packages/bhrigu's own
 * `ZodiacSign` precedent for the identical reason (no engine-level need
 * for a display name; a caller that already has the natal chart/Lagna
 * also already has the display name available from those results
 * directly).
 */
export type ZodiacSign = number;

/** The 7 classical planets whose own Bhinna Ashtakavarga this engine calculates. */
export type AshtakavargaTargetPlanet = 'Sun' | 'Moon' | 'Mars' | 'Mercury' | 'Jupiter' | 'Venus' | 'Saturn';

/**
 * The 8 classical reference points every target planet's BAV is scored
 * against -- the 7 target planets themselves, plus Lagna. Deliberately
 * does NOT include 'Rahu'/'Ketu' -- see README.md's "Contributors"
 * section: the standard Parashara BAV tables (this engine's own locked
 * ruleset) use exactly these 8 references, never the lunar nodes.
 */
export type AshtakavargaContributor = AshtakavargaTargetPlanet | 'Lagna';

/**
 * The inclusive classical house-counting distance, always in 1..12 (NOT
 * 0-11) -- see relativeHouse.ts's own doc comment. `same sign = 1`,
 * `next sign = 2`, ..., `previous sign = 12`.
 */
export type RelativeHouse = number;

/**
 * A single contributor's point for one candidate sign -- deliberately
 * neutral terminology (`point`/`contribution`), not `bindu`/`rekha` at
 * the type level, to keep historical Bindu/Rekha naming ambiguity (some
 * sources reverse which term means "positive") out of the mathematics --
 * see README.md's "Terminology" section. 1 = the contributor gives a
 * point to this sign; 0 = it does not.
 */
export type AshtakavargaPoint = 0 | 1;

/**
 * One locked, declarative contribution rule -- see rules.ts's own module
 * doc comment for the full 56-rule table and its source/recension audit.
 * `houses` is fixed, versioned, traditional data: the relative houses
 * (counted from the contributor's own natal sign) where that contributor
 * gives `target` a point. This is NEVER computed at runtime and NEVER
 * varies per chart -- only WHERE each house lands in the actual zodiac
 * varies per chart (see prastara.ts).
 */
export interface AshtakavargaContributionRule {
  target: AshtakavargaTargetPlanet;
  contributor: AshtakavargaContributor;
  houses: readonly RelativeHouse[];
  ruleId: string;
  ruleVersion: string;
}

/**
 * One contributor's fully-explained point for one target/sign
 * combination -- the "why" behind each `point`, not just the number.
 * See prastara.ts.
 */
export interface AshtakavargaContribution {
  contributor: AshtakavargaContributor;
  contributorSign: ZodiacSign;
  destinationSign: ZodiacSign;
  relativeHouse: RelativeHouse;
  point: AshtakavargaPoint;
  ruleId: string;
}

/** One target planet's full point breakdown for one zodiac sign -- always exactly 8 contributions (one per contributor), `total = sum(point)`, `0 <= total <= 8`. */
export interface AshtakavargaSignResult {
  sign: ZodiacSign;
  contributions: readonly AshtakavargaContribution[];
  total: number;
}

/** One target planet's complete Bhinna Ashtakavarga -- always exactly 12 signs, in canonical 0->11 order, `total` = the fixed classical grand total for this planet (see README.md's "Fixed totals" section). */
export interface BhinnaAshtakavarga {
  planet: AshtakavargaTargetPlanet;
  signs: readonly AshtakavargaSignResult[];
  total: number;
  evidence: readonly AshtakavargaEvidenceRef[];
}

/** One sign's raw Sarvashtakavarga value -- the sum of that sign's own value across all 7 BAV tables, in [0, 56]. */
export interface SarvashtakavargaSignResult {
  sign: ZodiacSign;
  total: number;
}

/** The raw (unreduced -- see README.md's "Raw vs reduced" section) Sarvashtakavarga: 12 signs, in canonical 0->11 order, grand `total` always 337 for a valid chart. */
export interface Sarvashtakavarga {
  signs: readonly SarvashtakavargaSignResult[];
  total: number;
  evidence: readonly AshtakavargaEvidenceRef[];
}

/**
 * The minimal, structural, already-normalized input this engine's core
 * function needs -- plain sidereal Rashi indices only, never a raw
 * birth date/location/natal-chart object (see engine.ts's own doc
 * comment for the public adapter that bridges from real Aura natal/Lagna
 * results to this shape).
 */
export interface AshtakavargaNatalInput {
  planetarySigns: {
    Sun: ZodiacSign;
    Moon: ZodiacSign;
    Mars: ZodiacSign;
    Mercury: ZodiacSign;
    Jupiter: ZodiacSign;
    Venus: ZodiacSign;
    Saturn: ZodiacSign;
  };
  lagnaSign: ZodiacSign;
}

/** The complete V1 result. Output is JSON-safe -- no Date objects anywhere (this engine never accepts or produces a birth instant; all inputs are already-reduced zodiac signs). */
export interface AshtakavargaResult {
  engineVersion: typeof ASHTAKAVARGA_ENGINE_VERSION;
  ruleSetVersion: typeof ASHTAKAVARGA_RULESET_VERSION;

  input: AshtakavargaNatalInput;

  bhinna: {
    Sun: BhinnaAshtakavarga;
    Moon: BhinnaAshtakavarga;
    Mars: BhinnaAshtakavarga;
    Mercury: BhinnaAshtakavarga;
    Jupiter: BhinnaAshtakavarga;
    Venus: BhinnaAshtakavarga;
    Saturn: BhinnaAshtakavarga;
  };

  sarva: Sarvashtakavarga;

  evidence: readonly AshtakavargaEvidenceRef[];
}

/** Thrown by engine.ts on malformed normalized input (invalid/missing/duplicate sign, missing or invalid Lagna). */
export class AshtakavargaValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AshtakavargaValidationError';
  }
}
