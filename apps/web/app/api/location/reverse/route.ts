import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
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
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (isRateLimited(`location-reverse:${session.userId}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 });
  }

  if (!isGeocodingConfigured()) {
    return NextResponse.json({ error: 'Location lookup is not available right now.', configured: false }, { status: 503 });
  }

  const latRaw = req.nextUrl.searchParams.get('lat');
  const lngRaw = req.nextUrl.searchParams.get('lng');
  const latitude = latRaw ? Number(latRaw) : NaN;
  const longitude = lngRaw ? Number(lngRaw) : NaN;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < MIN_VALID_LATITUDE || latitude > MAX_VALID_LATITUDE || longitude < MIN_VALID_LONGITUDE || longitude > MAX_VALID_LONGITUDE) {
    return NextResponse.json({ error: 'Valid lat/lng coordinates are required.' }, { status: 400 });
  }

  try {
    const result = await reverseGeocode(latitude, longitude);
    if (!result) {
      return NextResponse.json({ error: "Couldn't identify a place at this location. Try searching instead." }, { status: 404 });
    }
    return NextResponse.json({ result });
  } catch (err) {
    console.error('[location/reverse] provider error', err);
    return NextResponse.json({ error: 'Location lookup is temporarily unavailable. Please try again or enter your location manually.' }, { status: 502 });
  }
}
