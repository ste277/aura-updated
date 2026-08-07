import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getMonthlyActivity } from '../../../../lib/db';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const year = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10);
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? '', 10);

  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'year and month (1-12) query params are required.' }, { status: 400 });
  }

  const activity = await getMonthlyActivity(session.userId, year, month);
  return NextResponse.json(activity);
}
