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

// Basic sanity bounds for a manually-entered custom location. Rejects values that
// would make computeSolarEphemeris throw (poles, where sunrise/sunset is undefined
// for parts of the year) or that are simply not valid coordinates.
export function isValidCustomLocation(input: { latitude: number; longitude: number; timezone: string }): boolean {
  const { latitude, longitude, timezone } = input;
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return false;
  if (latitude < -66.5 || latitude > 66.5) return false; // outside the Arctic/Antarctic circles
  if (longitude < -180 || longitude > 180) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }); // throws on invalid IANA name
  } catch {
    return false;
  }
  return true;
}
