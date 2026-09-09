/**
 * Natal Ascendant / Lagna Foundation V1 -- input validation.
 */
import { MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } from './constants';
import { NatalLagnaValidationError } from './types';

export function assertValidBirthMoment(date: Date): void {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new NatalLagnaValidationError(`birthMomentUTC must be a valid, finite Date, got: ${String(date)}`);
  }
}

export function assertValidLatitude(latitude: number): void {
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)) {
    throw new NatalLagnaValidationError(`latitude must be a finite number, got: ${latitude}`);
  }
  if (latitude <= MIN_VALID_LATITUDE || latitude >= MAX_VALID_LATITUDE) {
    throw new NatalLagnaValidationError(
      `latitude must be strictly between ${MIN_VALID_LATITUDE} and ${MAX_VALID_LATITUDE} (exclusive -- the poles themselves produce a singular horizontal frame, see constants.ts's own MIN/MAX_VALID_LATITUDE doc comment), got: ${latitude}`
    );
  }
}

export function assertValidLongitude(longitude: number): void {
  if (typeof longitude !== 'number' || !Number.isFinite(longitude)) {
    throw new NatalLagnaValidationError(`longitude must be a finite number, got: ${longitude}`);
  }
  if (longitude < MIN_VALID_LONGITUDE || longitude > MAX_VALID_LONGITUDE) {
    throw new NatalLagnaValidationError(
      `longitude must be within [${MIN_VALID_LONGITUDE}, ${MAX_VALID_LONGITUDE}] (east-positive; this package does not normalize an out-of-range longitude -- see README.md's own "Longitude convention" section), got: ${longitude}`
    );
  }
}
