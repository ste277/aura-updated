import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getLogsForDay } from '../../../../../lib/db';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const year = parseInt(req.nextUrl.searchParams.get('year') ?? '', 10);
  const month = parseInt(req.nextUrl.searchParams.get('month') ?? '', 10);
  const day = parseInt(req.nextUrl.searchParams.get('day') ?? '', 10);

  if (!year || !month || !day) {
    return NextResponse.json({ error: 'year, month, and day query params are required.' }, { status: 400 });
  }

  const logs = await getLogsForDay(session.userId, year, month, day);
  return NextResponse.json(logs);
}
