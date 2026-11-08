import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById } from '../../../lib/db';
import { getPanchangForDate } from '../../../../../packages/panchang/src/panchangDay';
import { isValidCalendarDateString } from '../../../../../packages/panchang/src/localDate';
import { solarErrorResponse } from '../../../lib/solarErrorResponse';

/**
 * GET /api/panchang?date=YYYY-MM-DD
 *
 * The reusable arbitrary-date Panchang endpoint -- a thin wrapper around
 * getPanchangForDate(), no calculation logic of its own. Location/timezone
 * default to the authenticated user's profile, same as /api/panchang/today.
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const date = req.nextUrl.searchParams.get('date');
  if (!date || !isValidCalendarDateString(date)) {
    return NextResponse.json({ error: 'A valid date query parameter (YYYY-MM-DD) is required.' }, { status: 400 });
  }

  if (user.latitude === null || user.latitude === undefined || user.longitude === null || user.longitude === undefined || !user.timezone) {
    return NextResponse.json({ error: 'Set a location for your profile before requesting Panchang data.' }, { status: 400 });
  }

  try {
    const panchangDay = getPanchangForDate({
      localDate: date,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
    });
    return NextResponse.json(panchangDay);
  } catch (err) {
    // PA-3C-C1A: no longer leaks the raw internal Error.message to the
    // client (confirmed pre-existing leak) -- a legitimate no-event
    // condition now gets its own structured code/status, distinct from
    // malformed input, instead of both being reported identically as a
    // generic 400 with whatever string the thrown error happened to carry.
    const solarResponse = solarErrorResponse(err);
    if (solarResponse) return solarResponse;
    return NextResponse.json({ error: 'Unable to compute Panchang for that date.' }, { status: 500 });
  }
}
