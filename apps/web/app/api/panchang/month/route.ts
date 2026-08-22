import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { getMonthOfPanchangSummaries } from '../../../../../../packages/panchang/src/panchangDay';

/**
 * GET /api/panchang/month?year=2026&month=8
 *
 * Returns a lightweight PanchangDaySummary for every local calendar date in
 * the requested month -- one request instead of the client issuing 28-31
 * separate ones. Delegates entirely to getMonthOfPanchangSummaries() (which
 * itself delegates to getPanchangForDate() per date); no calculation logic
 * lives in this route.
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const year = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10);
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? '', 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12 || year < 1 || year > 9999) {
    return NextResponse.json({ error: 'year and month (1-12) query params are required.' }, { status: 400 });
  }

  if (user.latitude === null || user.latitude === undefined || user.longitude === null || user.longitude === undefined || !user.timezone) {
    return NextResponse.json({ error: 'Set a location for your profile before requesting Panchang data.' }, { status: 400 });
  }

  try {
    const days = getMonthOfPanchangSummaries({
      year,
      month,
      latitude: user.latitude,
      longitude: user.longitude,
      timezone: user.timezone,
    });
    return NextResponse.json({ year, month, days });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unable to compute Panchang for that month.' }, { status: 400 });
  }
}
