/**
 * Vimshottari Dasha Engine V1 -- shared types.
 *
 * This package deterministically calculates Vimshottari Mahadasha and
 * Antardasha periods from an already-known sidereal natal Moon longitude
 * -- it never calculates birth astronomy itself. Unlike
 * packages/personal-intelligence (deliberately zero-dependency), this
 * package IS allowed to depend on packages/vedic (the one existing
 * sidereal/Lahiri ephemeris and Nakshatra-name source) and
 * packages/personal-intelligence (the LifePeriodContext/LifePeriodSegment
 * contract this engine adapts into) -- see README.md's "Dependency
 * direction" section. It does not depend on packages/bhrigu or
 * packages/personal-themes; the Dasha branch is architecturally
 * independent of the Bhrigu-natal-themes branch (see README.md's own
 * "Architecture" diagram).
 */
import type { GrahaName } from '../../vedic/src/natalChart';
import type { PersonalEvidenceRef } from '../../personal-intelligence/src/evidence';
import type { VIMSHOTTARI_ENGINE_VERSION } from './provenance';

/** Vimshottari uses exactly the 9 GrahaName planets -- no separate/incompatible planet union. */
export type VimshottariLord = GrahaName;

/**
 * One calculated Dasha period -- a Mahadasha, or one of its 9 child
 * Antardashas. `start`/`end` are ISO-8601 UTC instant strings (matching
 * this repo's own established boundary convention -- see
 * packages/personal-intelligence/src/context.ts's own LifePeriodSegment),
 * never raw `Date` objects. Interval semantics are [start, end): `start`
 * inclusive, `end` exclusive -- see README.md's "Boundary semantics"
 * section and engine.ts's own findMahadashaAt/findAntardashaAt.
 */
export interface VimshottariPeriod {
  level: 'MAHADASHA' | 'ANTARDASHA';
  lord: VimshottariLord;
  /** Set only for an ANTARDASHA -- the parent Mahadasha's own lord. */
  parentLord?: VimshottariLord;
  start: string;
  end: string;
  evidence: PersonalEvidenceRef[];
}

/** A Mahadasha, with its own 9 child Antardashas already generated (see antardasha.ts) -- always exactly 9, always partitioning [start, end) exactly, see mahadasha.ts's own doc comment. */
export interface VimshottariMahadashaPeriod extends VimshottariPeriod {
  level: 'MAHADASHA';
  antardashas: VimshottariPeriod[];
}

/** The Nakshatra/starting-lord/birth-balance facts the whole calculation is anchored to -- see nakshatra.ts and mahadasha.ts. */
export interface VimshottariBirthNakshatra {
  /** 0-26 -- see nakshatra.ts's own module doc comment for why this package uses 0-indexing here, distinct from packages/vedic's own separate 1-27 natalNakshatraIndex convention used elsewhere in this repo. */
  index: number;
  name: string;
  lord: VimshottariLord;
  moonLongitude: number;
  fractionElapsed: number;
  fractionRemaining: number;
}

/**
 * The complete V1 result: complete Mahadashas starting from the birth
 * Mahadasha's own true start (never truncated to birth) and continuing
 * for at least 120 Vimshottari years AFTER birth (see constants.ts's own
 * VIMSHOTTARI_MIN_COVERAGE_MS and mahadasha.ts's own
 * generateMahadashaCycle) -- NOT always exactly 9 Mahadashas: the
 * Vimshottari sequence is cyclic, so `mahadashas` typically wraps past
 * the starting lord and contains more than 9 entries. Guarantee:
 * `mahadashas[0].start <= birthMomentMs` and
 * `mahadashas.at(-1).end >= birthMomentMs + 120 * VIMSHOTTARI_YEAR_MS`.
 */
export interface VimshottariDashaResult {
  engineVersion: typeof VIMSHOTTARI_ENGINE_VERSION;
  birthNakshatra: VimshottariBirthNakshatra;
  mahadashas: VimshottariMahadashaPeriod[];
  evidence: PersonalEvidenceRef[];
}

/** The minimal, structural input this engine's core function needs -- never a raw birth date/location, never a call into an ephemeris (see engine.ts's own doc comment). */
export interface VimshottariDashaInput {
  birthMomentUTC: Date;
  /** Sidereal (Lahiri ayanamsa) Moon longitude, already normalized/normalizable into [0, 360) -- e.g. GrahaPosition.siderealLongitude for graha === 'Moon' (packages/vedic/src/natalChart.ts). */
  moonLongitude: number;
}

/** Thrown by engine.ts on malformed input (a non-finite birth moment/longitude/query instant, or a GrahaPosition[] without exactly one Moon entry) -- see engine.ts's own doc comment for exactly which conditions reject. */
export class VimshottariValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VimshottariValidationError';
  }
}
