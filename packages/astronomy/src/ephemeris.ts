/**
 * Pure solar ephemeris calculator.
 * Implements the NOAA Solar Calculator equations modified for Drik Panchang upper-limb conventions.
 *
 * Reference: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 */
import { SolarComputationError, SolarNoEventError } from './errors';
import { assertValidDateComponents, assertValidLatitude, assertValidLongitude } from './validation';

export { SolarInputValidationError, SolarNoEventError, SolarComputationError, isSolarError } from './errors';
export type { SolarCondition, SolarError } from './errors';

export interface SolarInput {
  year: number;
  month: number; // 1-12
  day: number;
  latitude: number; // degrees, +N
  longitude: number; // degrees, +E
  tzOffsetMinutes: number; // e.g. IST = 330
}

export interface SolarResult {
  /** Minutes from midnight (local civil time), 0-1439 */
  sunriseMinutes: number;
  /** Minutes from midnight (local civil time), 0-1439 */
  sunsetMinutes: number;
  /** Minutes from midnight (local civil time), 0-1439 */
  solarNoonMinutes: number;
  /** Length of daylight in minutes, for downstream 1/8th partitioning */
  daylightMinutes: number;
}

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Day of year (1-365/366), matching NOAA's convention. */
function dayOfYear(year: number, month: number, day: number): number {
  const start = Date.UTC(year, 0, 1);
  const target = Date.UTC(year, month - 1, day);
  return Math.round((target - start) / 86400000) + 1;
}

/** Julian day at local noon-ish, following NOAA's simplified fractional-year approach. */
function fractionalYearRadians(year: number, doy: number, hourUTC: number): number {
  const daysInYear = isLeapYear(year) ? 366 : 365;
  return ((2 * Math.PI) / daysInYear) * (doy - 1 + (hourUTC - 12) / 24);
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Equation of time in minutes (NOAA approximation). */
function equationOfTimeMinutes(gamma: number): number {
  return (
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma))
  );
}

/** Solar declination in radians (NOAA approximation). */
function solarDeclinationRadians(gamma: number): number {
  return (
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma)
  );
}

/**
 * Hour angle (degrees) for a given solar elevation angle.
 *
 * `cosH > 1` means even the sun's highest point of the day never reaches
 * the target zenith (continuous darkness = POLAR_NIGHT); `cosH < -1` means
 * even its lowest point (midnight) stays above it (continuous daylight =
 * POLAR_DAY). This is the opposite of what a naive reading of "larger hour
 * angle" suggests -- independently derived and empirically verified
 * (PA-3C-A2/A3), not assumed. A non-finite `cosH` (division by a
 * near-zero denominator) is distinguished from both no-event conditions:
 * it is a computation anomaly, not a legitimate polar result.
 */
type HourAngleResult =
  | { kind: 'VALID'; degrees: number }
  | { kind: 'NO_EVENT'; condition: 'POLAR_DAY' | 'POLAR_NIGHT' }
  | { kind: 'NON_FINITE' };

function hourAngleDegrees(
  latitudeRad: number,
  declinationRad: number,
  zenithDegrees: number
): HourAngleResult {
  const zenithRad = zenithDegrees * DEG2RAD;
  const cosH =
    (Math.cos(zenithRad) - Math.sin(latitudeRad) * Math.sin(declinationRad)) /
    (Math.cos(latitudeRad) * Math.cos(declinationRad));

  if (!Number.isFinite(cosH)) return { kind: 'NON_FINITE' };
  if (cosH > 1) return { kind: 'NO_EVENT', condition: 'POLAR_NIGHT' };
  if (cosH < -1) return { kind: 'NO_EVENT', condition: 'POLAR_DAY' };
  return { kind: 'VALID', degrees: Math.acos(cosH) * RAD2DEG };
}

// 91.10° accounts for upper-limb visibility matching Drik Panchang rules
const SUNRISE_SUNSET_ZENITH = 91.10;

/**
 * Computes sunrise, sunset, and solar noon for a given date and location.
 */
export function computeSolarEphemeris(input: SolarInput): SolarResult {
  const { year, month, day, latitude, longitude, tzOffsetMinutes } = input;

  // Eager input validation (PA-3C-C1A) -- rejects non-finite/out-of-range
  // input before any trigonometric computation, so it can never silently
  // escape as a NaN-valued "successful" SolarResult (confirmed defect,
  // PA-3C-A2/A3: NaN previously bypassed the only existing guard, since
  // `NaN > 1` and `NaN < -1` are both false).
  assertValidLatitude(latitude);
  assertValidLongitude(longitude);
  assertValidDateComponents(year, month, day, tzOffsetMinutes);

  const latRad = latitude * DEG2RAD;
  const doy = dayOfYear(year, month, day);

  let gamma = fractionalYearRadians(year, doy, 12);
  let eqTime = equationOfTimeMinutes(gamma);
  let decl = solarDeclinationRadians(gamma);

  const solarNoonUTCMinutes = 720 - 4 * longitude - eqTime;

  const refinedHourUTC = (solarNoonUTCMinutes / 60 + 24) % 24;
  gamma = fractionalYearRadians(year, doy, refinedHourUTC);
  eqTime = equationOfTimeMinutes(gamma);
  decl = solarDeclinationRadians(gamma);

  const solarNoonUTCMinutesFinal = 720 - 4 * longitude - eqTime;

  const haResult = hourAngleDegrees(latRad, decl, SUNRISE_SUNSET_ZENITH);

  if (haResult.kind === 'NON_FINITE') {
    throw new SolarComputationError(
      `Solar hour-angle computation produced a non-finite value at latitude ${latitude}, longitude ${longitude} on ${year}-${month}-${day}.`
    );
  }
  if (haResult.kind === 'NO_EVENT') {
    const conditionLabel = haResult.condition === 'POLAR_DAY' ? 'continuous daylight' : 'continuous darkness';
    throw new SolarNoEventError(
      haResult.condition,
      `No sunrise/sunset at latitude ${latitude} on ${year}-${month}-${day} (${conditionLabel}).`
    );
  }

  const haDeg = haResult.degrees;

  const sunriseUTCMinutes = solarNoonUTCMinutesFinal - haDeg * 4;
  const sunsetUTCMinutes = solarNoonUTCMinutesFinal + haDeg * 4;

  const toLocalMinutes = (utcMinutes: number) => {
    let local = utcMinutes + tzOffsetMinutes;
    local = ((local % 1440) + 1440) % 1440;
    return local;
  };

  const sunriseMinutes = toLocalMinutes(sunriseUTCMinutes);
  const sunsetMinutes = toLocalMinutes(sunsetUTCMinutes);
  const solarNoonMinutes = toLocalMinutes(solarNoonUTCMinutesFinal);

  // Compute daylight minutes directly from haDeg (haDeg * 4 = half day in minutes)
  const daylightMinutes = haDeg * 8;

  return {
    sunriseMinutes: Math.round(sunriseMinutes),
    sunsetMinutes: Math.round(sunsetMinutes),
    solarNoonMinutes: Math.round(solarNoonMinutes),
    daylightMinutes: Math.round(daylightMinutes),
  };
}

export function formatMinutes(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}