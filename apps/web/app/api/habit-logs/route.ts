import { NextRequest, NextResponse } from 'next/server';
import { createHabitLog, listHabitLogs } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();
  const { activityTitle, activeWindow, logMinuteOfDay } = body;

  if (!activityTitle || !activeWindow || logMinuteOfDay == null) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }

  const entry = await createHabitLog({ userId: session.userId, activityTitle, activeWindow, logMinuteOfDay });

  return NextResponse.json(entry);
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const entries = await listHabitLogs(session.userId);

  return NextResponse.json(entries);
}
