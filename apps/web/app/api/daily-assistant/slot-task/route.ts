import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { recommendTaskSlot } from '../../../../../../packages/recommendation/src/dailyAssistant';

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await req.json();
  const taskTitle = String(body?.taskTitle || '').trim();
  const durationMinutes = Number(body?.durationMinutes ?? 30);

  if (!taskTitle) {
    return NextResponse.json({ error: 'Task title is required.' }, { status: 400 });
  }

  const now = new Date();
  const recommendation = recommendTaskSlot(taskTitle, {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
  }, durationMinutes);

  return NextResponse.json(recommendation);
}
