import { isValidIanaTimezone } from './timezone';

export interface CityOption {
  cityName: string;
  latitude: number;
  longitude: number;
  /** IANA timezone identifier (e.g. 'Asia/Kolkata') — used to compute the correct
   * UTC offset for any given date via lib/timezone.ts, so DST is handled correctly
   * rather than relying on a fixed offset that goes stale twice a year. */
  timezone: string;
}

// Curated rather than wired to a geocoding API — one less external dependency for
// v1. India-first (the panchang windows this app is built around are a Vedic/Indian
// timing system), then major cities with large Indian-diaspora populations, since
// that's the most likely audience wanting this outside India. For anywhere not on
// this list, the location picker also accepts a fully custom lat/lng/timezone —
// the math itself has no India-specific assumptions, it's pure solar geometry.
export const CITY_OPTIONS: CityOption[] = [
  // India (no DST, but stored as IANA timezone anyway for consistency)
  { cityName: 'Chennai', latitude: 13.0827, longitude: 80.2707, timezone: 'Asia/Kolkata' },
  { cityName: 'Mumbai', latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata' },
  { cityName: 'New Delhi', latitude: 28.6139, longitude: 77.209, timezone: 'Asia/Kolkata' },
  { cityName: 'Bengaluru', latitude: 12.9716, longitude: 77.5946, timezone: 'Asia/Kolkata' },
  { cityName: 'Hyderabad', latitude: 17.385, longitude: 78.4867, timezone: 'Asia/Kolkata' },
  { cityName: 'Kolkata', latitude: 22.5726, longitude: 88.3639, timezone: 'Asia/Kolkata' },
  { cityName: 'Pune', latitude: 18.5204, longitude: 73.8567, timezone: 'Asia/Kolkata' },
  { cityName: 'Kochi', latitude: 9.9312, longitude: 76.2673, timezone: 'Asia/Kolkata' },
  { cityName: 'Thiruvananthapuram', latitude: 8.5241, longitude: 76.9366, timezone: 'Asia/Kolkata' },
  { cityName: 'Coimbatore', latitude: 11.0168, longitude: 76.9558, timezone: 'Asia/Kolkata' },
  // International — major Indian-diaspora hubs. Offsets are resolved live per-date
  // via lib/timezone.ts, so DST transitions (New York, London, Sydney, Toronto) are
  // handled correctly rather than baked in as a fixed number.
  { cityName: 'Singapore', latitude: 1.3521, longitude: 103.8198, timezone: 'Asia/Singapore' },
  { cityName: 'Dubai, UAE', latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' },
  { cityName: 'London, UK', latitude: 51.5072, longitude: -0.1276, timezone: 'Europe/London' },
  { cityName: 'New York, USA', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { cityName: 'San Francisco, USA', latitude: 37.7749, longitude: -122.4194, timezone: 'America/Los_Angeles' },
  { cityName: 'Toronto, Canada', latitude: 43.6532, longitude: -79.3832, timezone: 'America/Toronto' },
  { cityName: 'Sydney, Australia', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' },
];

export function findCity(cityName: string): CityOption | undefined {
  return CITY_OPTIONS.find((c) => c.cityName === cityName);
}

// The actual safe latitude range for this app -- narrower than the
// geographic -90..90 range. Above/below the Arctic/Antarctic circles,
// sunrise/sunset (and therefore every Panchang solar window this app is
// built around) is undefined for parts of the year, which would make
// computeSolarEphemeris throw. Planning Custom Location UX Fix keeps this
// exact bound rather than loosening it to -90..90 -- that would let a value
// be saved successfully here only to fail later inside the Panchang engine,
// which is precisely what this fix is meant to prevent. The UI's inline
// validation message reflects this real bound, not a generic -90..90 one.
export const MIN_VALID_LATITUDE = -66.5;
export const MAX_VALID_LATITUDE = 66.5;
export const MIN_VALID_LONGITUDE = -180;
export const MAX_VALID_LONGITUDE = 180;

// Basic sanity bounds for a manually-entered custom location. Rejects values that
// would make computeSolarEphemeris throw (poles, where sunrise/sunset is undefined
// for parts of the year) or that are simply not valid coordinates.
export function isValidCustomLocation(input: { latitude: number; longitude: number; timezone: string }): boolean {
  const { latitude, longitude, timezone } = input;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false;
  if (latitude < MIN_VALID_LATITUDE || latitude > MAX_VALID_LATITUDE) return false;
  if (longitude < MIN_VALID_LONGITUDE || longitude > MAX_VALID_LONGITUDE) return false;
  return isValidIanaTimezone(timezone);
}

/**
 * Parses a user-typed coordinate into signed decimal degrees. Accepts plain
 * signed decimals ("8.8932", "-33.8688") and, per Planning Custom Location UX
 * Fix section 3/4, an optional trailing compass direction ("8.8932 N",
 * "33.8688 S", "76.6141 E", "74.0060 W") -- N/E are positive, S/W negate the
 * magnitude. A signed magnitude combined with a direction letter (e.g.
 * "-8.89 N") is rejected rather than guessing which one wins. This is format
 * parsing only, not range validation -- callers should still range-check the
 * result (isValidCustomLocation, or the MIN/MAX constants above) so a
 * format vs. range error can be reported distinctly.
 */
export function parseCoordinate(raw: string, axis: 'lat' | 'lng'): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWnsew])?$/);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude)) return null;
  const direction = match[2]?.toUpperCase();
  if (!direction) return magnitude;
  const validDirections = axis === 'lat' ? ['N', 'S'] : ['E', 'W'];
  if (!validDirections.includes(direction)) return null;
  if (magnitude < 0) return null; // ambiguous signed-magnitude-plus-direction input
  return direction === 'S' || direction === 'W' ? -magnitude : magnitude;
}

/**
 * Presentation-only friendly coordinate display (section 7) -- e.g. `8.8932`
 * -> `8.8932° N`, `-33.8688` -> `33.8688° S`. The stored/persisted value is
 * always the signed decimal; this is never parsed back in, only displayed.
 */
export function formatCoordinateDirectional(value: number, axis: 'lat' | 'lng'): string {
  const direction = axis === 'lat' ? (value < 0 ? 'S' : 'N') : value < 0 ? 'W' : 'E';
  return `${Math.abs(value)}° ${direction}`;
}
