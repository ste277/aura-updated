/**
 * Bhrigu Natal Foundation V1 -- natal chart normalization.
 *
 * This module consumes an already-computed natal chart; it never
 * calculates birth astronomy itself (no astronomy-engine dependency, no
 * date/timezone handling of any kind). The one real ephemeris
 * implementation in this repo is packages/vedic/src/natalChart.ts's
 * getNatalChart() -- fromGrahaPositions() below is the deliberately thin
 * adapter that lets a caller who already has that canonical GrahaPosition[]
 * hand it straight to this package.
 */
import { SUPPORTED_PLANETS } from './constants';
import { BhriguValidationError, NatalPlanet, PlanetId, ZodiacSign } from './types';
import type { GrahaPosition } from '../../vedic/src/natalChart';

/**
 * The minimal input contract this package actually needs. `sign`/
 * `degreeInSign` are optional: when omitted, both are deterministically
 * derived from `longitude`; when supplied, they are cross-validated
 * against the value `longitude` itself implies, rather than trusted
 * blindly (a caller-supplied sign that contradicts its own longitude is a
 * contradictory chart, rejected explicitly -- see normalizeNatalChart's
 * own doc comment).
 */
export interface BhriguChartPlanetInput {
  planet: PlanetId;
  longitude: number;
  sign?: ZodiacSign;
  degreeInSign?: number;
}

function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function deriveSignPlacement(longitude: number): { sign: ZodiacSign; degreeInSign: number } {
  const sign = Math.floor(longitude / 30);
  // Guards the exact-360-boundary float edge case (longitude very close to
  // 360 can floor to sign 12 after floating-point normalization); clamps
  // back into the valid 0-11 range rather than ever emitting sign === 12.
  const clampedSign = sign >= 12 ? 0 : sign;
  const degreeInSign = longitude - clampedSign * 30;
  return { sign: clampedSign, degreeInSign };
}

/**
 * Validates and normalizes a raw chart input into this package's internal
 * NatalPlanet[] shape, in the fixed SUPPORTED_PLANETS canonical order
 * (never the caller's own array order -- see constants.ts).
 *
 * Rejects (throws BhriguValidationError) on:
 * - a non-finite longitude (NaN, +/-Infinity) for any planet
 * - a missing planet (not all 9 SUPPORTED_PLANETS present)
 * - a duplicate planet (the same PlanetId appearing more than once)
 * - an unsupported planet id
 * - a caller-supplied `sign` or `degreeInSign` that is inconsistent with
 *   what `longitude` itself derives (a contradictory chart)
 *
 * Normalizes (does not reject):
 * - any finite longitude outside [0, 360), including negative values and
 *   values >= 360 (e.g. 360, 725, -30), via `((deg % 360) + 360) % 360`
 * - `sign`/`degreeInSign` when omitted, derived from the normalized
 *   longitude via floor(longitude / 30) / (longitude - sign * 30)
 *
 * Never performs timezone or date math of any kind -- longitude in,
 * longitude out.
 */
export function normalizeNatalChart(planets: BhriguChartPlanetInput[]): NatalPlanet[] {
  const byPlanet = new Map<PlanetId, BhriguChartPlanetInput>();

  for (const entry of planets) {
    if (!SUPPORTED_PLANETS.includes(entry.planet)) {
      throw new BhriguValidationError(`Unsupported planet: ${String(entry.planet)}`);
    }
    if (byPlanet.has(entry.planet)) {
      throw new BhriguValidationError(`Duplicate planet in chart input: ${entry.planet}`);
    }
    if (typeof entry.longitude !== 'number' || !Number.isFinite(entry.longitude)) {
      throw new BhriguValidationError(`Non-finite longitude for ${entry.planet}: ${entry.longitude}`);
    }
    byPlanet.set(entry.planet, entry);
  }

  const missing = SUPPORTED_PLANETS.filter((planet) => !byPlanet.has(planet));
  if (missing.length > 0) {
    throw new BhriguValidationError(`Missing planet(s) in chart input: ${missing.join(', ')}`);
  }

  return SUPPORTED_PLANETS.map((planet) => {
    const entry = byPlanet.get(planet)!;
    const longitude = normalizeDegrees(entry.longitude);
    const { sign, degreeInSign } = deriveSignPlacement(longitude);

    if (entry.sign !== undefined && entry.sign !== sign) {
      throw new BhriguValidationError(
        `${planet}: supplied sign (${entry.sign}) is inconsistent with longitude ${entry.longitude} (derives sign ${sign})`
      );
    }
    // Floating-point tolerance: degreeInSign is derived from the same
    // longitude via simple subtraction, so an exact match is expected for
    // any caller deriving it the same way -- a small epsilon only absorbs
    // genuine floating-point representation noise, not a real
    // contradiction (which would differ by whole degrees, not fractions
    // of a millidegree).
    if (entry.degreeInSign !== undefined && Math.abs(entry.degreeInSign - degreeInSign) > 1e-6) {
      throw new BhriguValidationError(
        `${planet}: supplied degreeInSign (${entry.degreeInSign}) is inconsistent with longitude ${entry.longitude} (derives ${degreeInSign})`
      );
    }

    return { planet, longitude, sign, degreeInSign };
  });
}

/**
 * Adapter from packages/vedic/src/natalChart.ts's canonical GrahaPosition[]
 * (getNatalChart()'s own return type) into this package's own input
 * contract -- reuses that existing natal-chart representation rather than
 * requiring every caller to already know this package's own shape.
 * graha -> planet, siderealLongitude -> longitude, rashiIndex -> sign,
 * degreeInRashi -> degreeInSign: a field rename only, no recomputation --
 * GrahaPosition already guarantees these three are mutually consistent by
 * construction, so normalizeNatalChart's own cross-validation above is
 * expected to pass trivially for any real getNatalChart() output.
 */
export function fromGrahaPositions(positions: GrahaPosition[]): BhriguChartPlanetInput[] {
  return positions.map((position) => ({
    planet: position.graha,
    longitude: position.siderealLongitude,
    sign: position.rashiIndex,
    degreeInSign: position.degreeInRashi,
  }));
}
