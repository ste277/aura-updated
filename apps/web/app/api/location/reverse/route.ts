import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, SESSION_UNAVAILABLE, sessionUnavailableResponse } from '../../../../lib/session';
import { reverseGeocode, isGeocodingConfigured } from '../../../../lib/geocoding';
import { isRateLimited } from '../../../../lib/inMemoryRateLimit';
import { MIN_VALID_LATITUDE, MAX_VALID_LATITUDE, MIN_VALID_LONGITUDE, MAX_VALID_LONGITUDE } from '../../../../lib/cities';

// Onboarding V1 PR 3 -- Smart Location Selection, "Use my current
// location". Takes coordinates the CLIENT already obtained via
// navigator.geolocation (this route never touches the browser Geolocation
// API itself -- that only exists client-side) and resolves them to a place
// name + IANA timezone. Same read-only, authenticated, rate-limited,
// gracefully-degrading contract as /api/location/search -- see that
// route's own doc comment for the shared reasoning. Never writes anything;
// the resolved result still requires the user's explicit confirmation
// through the existing PATCH /api/users/location before anything is saved.
//
// AURA-MOBILE-01-IOS-02 -- POST with a JSON body ({ latitude, longitude })
// instead of GET ?lat=&lng=, so device coordinates never appear in a URL
// (request logs, proxy/edge access logs, browser history). The body is never
// logged, coordinates are never echoed in an error, and every response is
// marked no-store. The only caller is components/LocationPicker.tsx; the
// web app and the native shells load the same deployment, so caller and
// route ship together.
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
/** {"latitude":-90.123456789012345,"longitude":-180.123456789012345} is ~70 bytes. */
const MAX_BODY_BYTES = 1024;

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

/** Reads at most MAX_BODY_BYTES; null when the body is too large or unreadable. */
async function readBoundedBody(req: NextRequest): Promise<string | null> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  try {
    const text = await req.text();
    return new TextEncoder().encode(text).length > MAX_BODY_BYTES ? null : text;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) {
    return json({ error: 'Not authenticated.' }, 401);
  }

  if (isRateLimited(`location-reverse:${session.userId}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS)) {
    return json({ error: 'Too many requests. Please wait a moment and try again.' }, 429);
  }

  if (!isGeocodingConfigured()) {
    return json({ error: 'Location lookup is not available right now.', configured: false }, 503);
  }

  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'Expected a JSON request body.' }, 415);
  }
  const raw = await readBoundedBody(req);
  if (raw === null) {
    return json({ error: 'Request body is too large.' }, 413);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const body = (parsed && typeof parsed === 'object' ? parsed : {}) as { latitude?: unknown; longitude?: unknown };
  // Numbers only -- a numeric string is rejected rather than coerced.
  const latitude = typeof body.latitude === 'number' ? body.latitude : NaN;
  const longitude = typeof body.longitude === 'number' ? body.longitude : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < MIN_VALID_LATITUDE || latitude > MAX_VALID_LATITUDE || longitude < MIN_VALID_LONGITUDE || longitude > MAX_VALID_LONGITUDE) {
    return json({ error: 'Valid lat/lng coordinates are required.' }, 400);
  }

  try {
    const result = await reverseGeocode(latitude, longitude);
    if (!result) {
      return json({ error: "Couldn't identify a place at this location. Try searching instead." }, 404);
    }
    return json({ result });
  } catch (err) {
    // geocoding.ts only throws fixed strings (plus the provider's HTTP
    // status/message) -- never the request URL or coordinates.
    console.error('[location/reverse] provider error', err);
    return json({ error: 'Location lookup is temporarily unavailable. Please try again or enter your location manually.' }, 502);
  }
}
