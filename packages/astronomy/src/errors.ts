/**
 * PA-3C-C1A -- typed solar-calculation errors.
 *
 * Mirrors the existing packages/lagna/src/types.ts convention
 * (NatalLagnaValidationError / NatalLagnaComputationError: malformed INPUT
 * rejected before any computation vs. a genuine numerical/definitional
 * singularity in the computation itself) and extends it with a third class
 * for this package's own genuine no-event condition (a polar day/night --
 * not a malformed input, not a computation bug, just a real astronomical
 * fact for that location/date), plus a stable `code` on every class so
 * callers can discriminate without matching on `.message` text.
 */

/** `cosH > 1` -> the sun's highest point of the day never reaches the
 * sunrise/sunset zenith (continuous darkness). `cosH < -1` -> the sun's
 * lowest point of the day never drops below it (continuous daylight).
 * Verified against the real equation (PA-3C-A2/A3): this mapping is the
 * opposite of what a naive reading of "larger hour angle" might suggest. */
export type SolarCondition = 'POLAR_DAY' | 'POLAR_NIGHT';

/**
 * Thrown when caller-supplied coordinates, date components, or other
 * required inputs are malformed (non-finite, out of physical range, or an
 * invalid Date) -- rejected before any trigonometric computation is
 * attempted. Never thrown for a genuine astronomical no-event condition.
 */
export class SolarInputValidationError extends Error {
  readonly code = 'SOLAR_INVALID_INPUT' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SolarInputValidationError';
  }
}

/**
 * Thrown only when valid, in-range inputs produce a genuine polar
 * day/night: no sunrise or sunset occurs for that location on that date.
 * This is an expected, legitimate astronomical outcome, not a bug --
 * callers should treat it as "no event today," never retry, never surface
 * it as if the input were malformed.
 */
export class SolarNoEventError extends Error {
  readonly code = 'SOLAR_NO_EVENT' as const;
  readonly condition: SolarCondition;
  constructor(condition: SolarCondition, message: string) {
    super(message);
    this.name = 'SolarNoEventError';
    this.condition = condition;
  }
}

/**
 * Thrown when already-validated, in-range inputs unexpectedly produce a
 * non-finite intermediate value (e.g. a division-by-near-zero at an
 * extreme but in-range latitude). Per the lagna-package precedent this
 * exists as a documented, typed defensive backstop -- in normal operation
 * it should not be reachable once SolarInputValidationError's guards are
 * in place, but if a non-finite value ever appears it must fail loudly as
 * this, never silently as a NaN-valued "successful" result.
 */
export class SolarComputationError extends Error {
  readonly code = 'SOLAR_COMPUTATION_ERROR' as const;
  constructor(message: string) {
    super(message);
    this.name = 'SolarComputationError';
  }
}

export type SolarError = SolarInputValidationError | SolarNoEventError | SolarComputationError;

export function isSolarError(error: unknown): error is SolarError {
  return (
    error instanceof SolarInputValidationError ||
    error instanceof SolarNoEventError ||
    error instanceof SolarComputationError
  );
}
