import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { searchPlaces, isGeocodingConfigured } from '../../../../lib/geocoding';
import { isRateLimited } from '../../../../lib/inMemoryRateLimit';

// Onboarding V1 PR 3 -- Smart Location Selection, "Search for a place".
// Authenticated (never a public/unauthenticated surface -- the ticket's own
// privacy section asks for caching/rate-limiting discipline, and this is
// the cheapest way to keep the free-tier provider quota from being spent
// by anyone who can reach the URL). Read-only: this route NEVER writes
// anything -- a selected candidate is only persisted through the existing,
// unchanged PATCH /api/users/location (Location Trust Foundation's own
// sole write/confirmation path), preserving "no automatic confirmation
// from a search result."
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  if (isRateLimited(`location-search:${session.userId}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many location searches. Please wait a moment and try again.' }, { status: 429 });
  }

  if (!isGeocodingConfigured()) {
    // Graceful degradation, never a crash: the client falls back to the
    // curated list + manual entry, which still fully work without this
    // provider (see LocationPicker.tsx).
    return NextResponse.json({ error: 'Location search is not available right now.', configured: false }, { status: 503 });
  }

  const query = req.nextUrl.searchParams.get('q');
  if (!query || !query.trim()) {
    return NextResponse.json({ error: 'A search query is required.' }, { status: 400 });
  }
  if (query.length > 200) {
    return NextResponse.json({ error: 'Search query is too long.' }, { status: 400 });
  }

  try {
    const results = await searchPlaces(query);
    return NextResponse.json({ results });
  } catch (err) {
    console.error('[location/search] provider error', err);
    return NextResponse.json({ error: 'Location search is temporarily unavailable. Please try again or enter your location manually.' }, { status: 502 });
  }
}
