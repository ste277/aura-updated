/**
 * PA-3C-C1A -- eager input validation for the solar ephemeris layer.
 *
 * Mirrors packages/lagna/src/validation.ts's assertValidLatitude/
 * assertValidLongitude convention. Unlike that package (which excludes the
 * poles -- its horizontal/ecliptic frame is singular there), this layer
 * accepts the full inclusive physical range [-90, 90] / [-180, 180]: the
 * sunrise/sunset hour-angle division does not go singular at the poles in
 * floating point (cos(90 deg) is ~6.12e-17, not exactly zero), so a pole
 * resolves to an ordinary (if extreme) no-event classification rather than
 * a division-by-zero -- see SolarComputationError's own doc comment for
 * the genuine defensive-backstop case this does NOT cover.
 */
import { SolarInputValidationError } from './errors';

export const MIN_VALID_SOLAR_LATITUDE = -90;
export const MAX_VALID_SOLAR_LATITUDE = 90;
export const MIN_VALID_SOLAR_LONGITUDE = -180;
export const MAX_VALID_SOLAR_LONGITUDE = 180;

export function assertValidLatitude(latitude: number): void {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    throw new SolarInputValidationError(`latitude must be a finite number, got: ${latitude}`);
  }
  if (latitude < MIN_VALID_SOLAR_LATITUDE || latitude > MAX_VALID_SOLAR_LATITUDE) {
    throw new SolarInputValidationError(
      `latitude must be within [${MIN_VALID_SOLAR_LATITUDE}, ${MAX_VALID_SOLAR_LATITUDE}], got: ${latitude}`
    );
  }
}

export function assertValidLongitude(longitude: number): void {
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw new SolarInputValidationError(`longitude must be a finite number, got: ${longitude}`);
  }
  if (longitude < MIN_VALID_SOLAR_LONGITUDE || longitude > MAX_VALID_SOLAR_LONGITUDE) {
    throw new SolarInputValidationError(
      `longitude must be within [${MIN_VALID_SOLAR_LONGITUDE}, ${MAX_VALID_SOLAR_LONGITUDE}], got: ${longitude}`
    );
  }
}

/** Validates the plain numeric year/month/day/tzOffsetMinutes components
 * SolarInput takes (not a Date object -- see assertValidDateInput for the
 * getDailySolarWindows(date: Date, ...) boundary instead). */
export function assertValidDateComponents(year: number, month: number, day: number, tzOffsetMinutes: number): void {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new SolarInputValidationError(
      `year/month/day must be finite numbers, got year=${year}, month=${month}, day=${day}`
    );
  }
  if (!Number.isFinite(tzOffsetMinutes)) {
    throw new SolarInputValidationError(`tzOffsetMinutes must be a finite number, got: ${tzOffsetMinutes}`);
  }
}

/** Validates a Date object boundary (getDailySolarWindows's `date`
 * parameter) before it reaches any timezone-formatting code -- rejects an
 * Invalid Date (NaN time value) here rather than letting it silently
 * propagate into Intl.DateTimeFormat several calls downstream, where it
 * surfaces as an unrelated-looking RangeError (confirmed in PA-3C-A3). */
export function assertValidDateInput(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new SolarInputValidationError(`date must be a valid, finite Date, got: ${String(date)}`);
  }
}
