import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getPanchangForDate } from '../../../../../../packages/panchang/src/panchangDay';
import { getDatePartsInTimezone } from '../../../../../../packages/panchang/src/localDate';
import { solarErrorResponse } from '../../../../lib/solarErrorResponse';

/**
 * Resolves the user's current LOCAL date and delegates to
 * getPanchangForDate() (see /api/panchang/route.ts and
 * packages/panchang/src/panchangDay.ts) -- this route no longer computes
 * Panchanga elements itself, so there is exactly one implementation shared
 * with the arbitrary-date endpoint.
 *
 * `referenceInstant: now` reproduces this route's pre-existing behavior
 * exactly: Tithi/Nakshatra/Yoga/Karana (and their `endsAt` transitions) are
 * evaluated as of the moment of the request, not at local noon (the default
 * getPanchangForDate() uses for arbitrary dates that have no "now").
 *
 * The response is adapted back to the exact legacy shape
 * ({tithi,nakshatra,yoga,karana} with paksha/name/endsAt only, no
 * date/location/solar/windows) rather than exposing the full PanchangDay at
 * this URL, since that's the contract this route has always had.
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = new Date();
  const timezone = user.timezone || 'Asia/Kolkata';
  const latitude = user.latitude ?? 13.0827;
  const longitude = user.longitude ?? 80.2707;
  const today = getDatePartsInTimezone(timezone, now);

  // PA-3C-C1A: a legitimate polar no-event condition (or invalid stored
  // location) must not crash this route -- confirmed (PA-3C-A3) it had
  // zero exception handling. Full non-solar-only partial payload support
  // (returning Tithi/Nakshatra/Yoga/Karana even when the solar windows
  // can't be computed) remains B2 scope -- getPanchangForDate computes the
  // solar data before those sidereal elements, so it throws before any of
  // them are available to return here.
  let panchangDay;
  try {
    panchangDay = getPanchangForDate({
      localDate: today.dateStr,
      latitude,
      longitude,
      timezone,
      referenceInstant: now,
    });
  } catch (err) {
    const solarResponse = solarErrorResponse(err);
    if (solarResponse) return solarResponse;
    return NextResponse.json({ error: "Unable to compute today's Panchang." }, { status: 500 });
  }

  const { tithi, nakshatra, yoga, karana } = panchangDay.panchanga;
  return NextResponse.json({
    tithi: { paksha: tithi.paksha, name: tithi.name, endsAt: tithi.endsAt },
    nakshatra: { name: nakshatra.name, endsAt: nakshatra.endsAt },
    yoga: { name: yoga.name, endsAt: yoga.endsAt },
    karana: { name: karana.name, endsAt: karana.endsAt },
  });
}
