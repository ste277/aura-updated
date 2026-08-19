import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { logHabitCompletion } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';

export async function POST(req: NextRequest, { params }: { params: { habitId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const activeWindow = typeof body.activeWindow === 'string' ? body.activeWindow.trim() : '';
  const logMinuteOfDay = Number(body.logMinuteOfDay);
  if (!activeWindow || !Number.isFinite(logMinuteOfDay) || logMinuteOfDay < 0 || logMinuteOfDay > 1439) {
    return NextResponse.json({ error: 'activeWindow and logMinuteOfDay are required.' }, { status: 400 });
  }

  try {
    const habit = await logHabitCompletion(session.userId, params.habitId, activeWindow, Math.round(logMinuteOfDay));
    return NextResponse.json(habit);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not log habit.' }, { status: 400 });
  }
}
