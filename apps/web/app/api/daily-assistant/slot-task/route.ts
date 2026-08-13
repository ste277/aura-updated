import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { findOptimalTaskTimes, recommendTaskSlot, PlanningHorizon } from '../../../../../../packages/recommendation/src/dailyAssistant';

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await req.json();
  const taskTitle = String(body?.taskTitle || '').trim();
  const durationMinutes = Number(body?.durationMinutes ?? 30);
  const horizon = String(body?.horizon || 'TODAY') as PlanningHorizon;
  const customStartDate = body?.customStartDate ? String(body.customStartDate) : undefined;
  const customEndDate = body?.customEndDate ? String(body.customEndDate) : undefined;
  const requestedStartMinute = body?.requestedStartMinute === undefined ? undefined : Number(body.requestedStartMinute);

  if (!taskTitle) {
    return NextResponse.json({ error: 'Task title is required.' }, { status: 400 });
  }
  if (horizon === 'CUSTOM' && (!customStartDate || !customEndDate || customEndDate < customStartDate)) {
    return NextResponse.json({ error: 'A valid custom start and end date are required.' }, { status: 400 });
  }

  const now = new Date();
  const assistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
  };
  const recommendation = horizon === 'NOW' || horizon === 'TODAY'
    ? recommendTaskSlot(taskTitle, assistantContext, durationMinutes, requestedStartMinute)
    : findOptimalTaskTimes(taskTitle, assistantContext, durationMinutes, horizon, customStartDate, customEndDate);

  return NextResponse.json(recommendation);
}
