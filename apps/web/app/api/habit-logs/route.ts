import { NextRequest, NextResponse } from 'next/server';
import { createHabitLog, listHabitLogs } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await req.json();
  const { activityTitle, activeWindow, logMinuteOfDay, logTimestamp, notes, durationMinutes } = body;

  if (!activityTitle || !activeWindow || logMinuteOfDay == null) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }

  // Parse custom timestamp if provided, fallback to current time
  const customDate = logTimestamp ? new Date(logTimestamp) : new Date();

  const entry = await createHabitLog({
    userId: session.userId,
    activityTitle,
    activeWindow,
    logMinuteOfDay,
    logTimestamp: customDate, // Pass custom date to DB helper
    durationMinutes: Math.min(180, Math.max(5, Number(durationMinutes ?? 30))),
    notes: notes ? String(notes).trim() : undefined, // Forward notes to DB helper
  });

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
