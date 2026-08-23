import { NextRequest, NextResponse } from 'next/server';
import { parseJsonObject } from '../../../../lib/request';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { findCity, isValidCustomLocation } from '../../../../lib/cities';
import { buildGuestTimingSearchRequest } from '../../../../lib/guestTimingSearchRequest';
import { isRateLimited } from '../../../../lib/inMemoryRateLimit';
import { runTimingSearch } from '../../../../../../packages/recommendation/src/timingSearch';
import { DailyAssistantContext } from '../../../../../../packages/recommendation/src/dailyAssistant';

/**
 * Recipient Conversion V1 (brief section 7/20/21) -- the ONE new public,
 * unauthenticated timing-search surface, for the guest conversion flow at
 * /find. Deliberately narrow:
 *
 *   - calls runTimingSearch() -- the exact same canonical engine
 *     /api/timing-search (authenticated) calls -- never a second formula
 *   - context.personalContext is never set: GENERAL scope by construction,
 *     no natal/birth data touched or requested (brief section 7/31)
 *   - no session, no user-table access of any kind
 *   - validation (activityId/duration/horizon/limit bounds) lives in
 *     lib/guestTimingSearchRequest.ts, deliberately stricter than the
 *     authenticated endpoint's own lib/timingSearchRequest.ts
 *   - location is either a known CITY_OPTIONS name or a client-supplied
 *     custom lat/lng/timezone validated by the same isValidCustomLocation()
 *     bounds check the authenticated location picker already uses -- no
 *     browser geolocation is requested server-side (brief section 6)
 *   - per-IP in-memory rate limiting (brief section 20)
 */

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 10;

function requestIp(req: NextRequest): string {
  // Same trust boundary as api/auth/request-link/route.ts -- only a header
  // our own proxy sets, never a client-suppliable one.
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`guest-timing-search:${ip}`, RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: 'Too many requests. Please try again in a moment.' }, { status: 429 });
  }

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  let latitude: number;
  let longitude: number;
  let timezone: string;
  let cityName: string;

  if (typeof body.cityName === 'string' && body.cityName.trim()) {
    const city = findCity(body.cityName.trim());
    if (!city) return NextResponse.json({ error: 'Unknown city.' }, { status: 400 });
    ({ latitude, longitude, timezone, cityName } = city);
  } else if (body.customLocation && typeof body.customLocation === 'object') {
    const custom = body.customLocation as Record<string, unknown>;
    const candidate = {
      latitude: Number(custom.latitude),
      longitude: Number(custom.longitude),
      timezone: String(custom.timezone || ''),
    };
    if (!isValidCustomLocation(candidate)) {
      return NextResponse.json({ error: 'Invalid location.' }, { status: 400 });
    }
    latitude = candidate.latitude;
    longitude = candidate.longitude;
    timezone = candidate.timezone;
    cityName = typeof custom.cityName === 'string' && custom.cityName.trim() ? custom.cityName.trim().slice(0, 100) : 'Custom location';
  } else {
    return NextResponse.json({ error: 'A city or custom location is required.' }, { status: 400 });
  }

  const now = new Date();
  const context: DailyAssistantContext = {
    now,
    latitude,
    longitude,
    timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(timezone, now),
    // Deliberately omitted: GENERAL scope only, no personal/natal context
    // exists for an anonymous guest (brief section 7/31).
  };

  const validated = buildGuestTimingSearchRequest(body, context);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: validated.status });

  const result = runTimingSearch(validated.request);
  return NextResponse.json({ ...result, cityName });
}
