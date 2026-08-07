import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { logHabitCompletion } from '../../../../../lib/db';

export async function POST(req: NextRequest, { params }: { params: { habitId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const { activeWindow, logMinuteOfDay } = await req.json();
  if (!activeWindow || logMinuteOfDay == null) {
    return NextResponse.json({ error: 'activeWindow and logMinuteOfDay are required.' }, { status: 400 });
  }

  try {
    const habit = await logHabitCompletion(session.userId, params.habitId, activeWindow, logMinuteOfDay);
    return NextResponse.json(habit);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not log habit.' }, { status: 400 });
  }
}
