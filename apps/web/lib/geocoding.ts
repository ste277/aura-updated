// Onboarding V1 PR 3 -- Smart Location Selection. The ONE place this app
// talks to an external geocoding provider (OpenCage, chosen per this PR's
// own provider decision memo: one API returns geocode + reverse-geocode +
// IANA timezone together, free tier with no card required). Server-side
// only -- the API key never reaches the client (see the two route handlers
// that call this module). Plain fetch, no SDK -- the same convention
// lib/email.ts already established for this app's other external HTTP
// providers (mail-o-mail/Resend): a single env var gates availability,
// `isXConfigured()` lets the route degrade gracefully instead of crashing
// when no key has been provisioned yet.
//
// This module never invents a timezone or coordinates: any provider result
// missing a usable IANA timezone annotation is dropped rather than guessed
// at (Location Trust Foundation's own standing rule, unchanged by this PR).

const OPENCAGE_URL = 'https://api.opencagedata.com/geocode/v1/json';

export interface GeocodeResult {
  /** The provider's own full formatted string, e.g. "Kollam, Kerala, India" -- display only. */
  displayName: string;
  /** Best short place name (city/town/village component), never empty. */
  cityName: string;
  /** State/province, when the provider supplies one. */
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
  /** IANA timezone identifier -- always present and valid on a returned
   * result; a provider result without one is filtered out before it ever
   * reaches a caller. */
  timezone: string;
  /** OpenCage's own 1-10 confidence score, where provided -- surfaced so
   * the UI can disclose low-confidence/approximate results rather than
   * presenting them as exact. */
  confidence?: number;
}

/** True once an API key has been provisioned -- the two route handlers use
 * this to degrade gracefully (curated list + manual entry still work)
 * instead of the feature silently failing with a 500. */
export function isGeocodingConfigured(): boolean {
  return Boolean(process.env.OPENCAGE_API_KEY);
}

interface OpenCageComponents {
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state?: string;
  country?: string;
}

interface OpenCageResult {
  formatted: string;
  geometry: { lat: number; lng: number };
  components: OpenCageComponents;
  annotations?: { timezone?: { name?: string } };
  confidence?: number;
}

function normalize(raw: OpenCageResult): GeocodeResult | null {
  const timezone = raw.annotations?.timezone?.name;
  // Never invent a timezone -- a result the provider itself couldn't
  // resolve a zone for is unusable to this app (every downstream Panchang/
  // timing calculation requires one), so it is dropped, not guessed at.
  if (!timezone) return null;
  if (!Number.isFinite(raw.geometry?.lat) || !Number.isFinite(raw.geometry?.lng)) return null;

  const cityName = raw.components.city ?? raw.components.town ?? raw.components.village ?? raw.components.county ?? raw.formatted.split(',')[0]?.trim();
  if (!cityName) return null; // nonempty place name required

  return {
    displayName: raw.formatted,
    cityName,
    region: raw.components.state,
    country: raw.components.country,
    latitude: raw.geometry.lat,
    longitude: raw.geometry.lng,
    timezone,
    confidence: raw.confidence,
  };
}

async function callOpenCage(params: Record<string, string>): Promise<OpenCageResult[]> {
  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) throw new Error('Geocoding is not configured (OPENCAGE_API_KEY is not set).');

  const url = new URL(OPENCAGE_URL);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('no_annotations', '0'); // we need the timezone annotation
  url.searchParams.set('limit', '5');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let res: Response;
  try {
    res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
  } catch {
    // Onboarding V1 PR 3 Final Integration Validation -- deliberately never
    // forwards the underlying fetch/network error's own message here (some
    // fetch implementations can embed the request URL -- which carries the
    // API key as a query param -- inside that message or its stack). This
    // thrown error (and the route handlers' own `console.error(..., err)`
    // of it) can only ever contain this fixed string, never anything
    // derived from the request itself.
    throw new Error('Geocoding provider unreachable.');
  }

  if (!res.ok) {
    // OpenCage returns 402 on quota exhaustion, 429 on rate limit, 400 on a
    // malformed query -- all surfaced as a single "provider unavailable"
    // class of error; the route layer decides the user-facing message.
    const body = await res.json().catch(() => ({}));
    throw new Error(`Geocoding provider error (${res.status}): ${body?.status?.message ?? 'unknown'}`);
  }

  const data = await res.json().catch(() => null);
  if (!data || !Array.isArray(data.results)) throw new Error('Geocoding provider returned an unexpected response.');
  return data.results as OpenCageResult[];
}

/**
 * Forward geocoding -- "Search for a place". Returns normalized, ranked
 * candidates for disambiguation (never a single auto-picked result); an
 * empty array means genuinely no results, not an error.
 */
export async function searchPlaces(query: string): Promise<GeocodeResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const raw = await callOpenCage({ q: trimmed });
  return raw.map(normalize).filter((r): r is GeocodeResult => r !== null);
}

/**
 * Reverse geocoding -- "Use my current location". Returns the single best
 * match for the given coordinates, or null when the provider has nothing
 * usable (never a fabricated fallback).
 */
export async function reverseGeocode(latitude: number, longitude: number): Promise<GeocodeResult | null> {
  const raw = await callOpenCage({ q: `${latitude}+${longitude}` });
  for (const candidate of raw) {
    const normalized = normalize(candidate);
    if (normalized) return normalized;
  }
  return null;
}
