import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveTzOffsetMinutes } from '../../../../lib/timezone';
import { findOptimalTaskTimes, recommendTaskSlot, PlanningHorizon, TimePreference } from '../../../../../../packages/recommendation/src/dailyAssistant';

/** Longest CUSTOM planning window. Comfortably beyond any real use (the UI
 *  offers today/week/month) while keeping the synchronous per-day search
 *  bounded — see the span check below. */
const MAX_CUSTOM_RANGE_DAYS = 90;
const MAX_TASK_TITLE_LENGTH = 200;

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
  const timePreference = String(body?.timePreference || 'ANYTIME') as TimePreference;
  const requestedStartMinute = body?.requestedStartMinute === undefined ? undefined : Number(body.requestedStartMinute);

  if (!taskTitle || taskTitle.length > MAX_TASK_TITLE_LENGTH) {
    return NextResponse.json({ error: 'A task title of up to 200 characters is required.' }, { status: 400 });
  }
  if (horizon === 'CUSTOM' && (!customStartDate || !customEndDate || customEndDate < customStartDate)) {
    return NextResponse.json({ error: 'A valid custom start and end date are required.' }, { status: 400 });
  }
  // Cap the span. findOptimalTaskTimes runs a full ephemeris computation plus
  // ~96 slot scorings per day, synchronously — an unbounded range (the date
  // strings alone allow year 0001 to 9999) blocks the single-threaded event
  // loop for hours and takes the whole site down from one request.
  if (horizon === 'CUSTOM') {
    const spanDays = (Date.parse(customEndDate!) - Date.parse(customStartDate!)) / 86_400_000;
    if (!Number.isFinite(spanDays) || spanDays < 0 || spanDays > MAX_CUSTOM_RANGE_DAYS) {
      return NextResponse.json(
        { error: `Custom range must be ${MAX_CUSTOM_RANGE_DAYS} days or fewer.` },
        { status: 400 }
      );
    }
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
    : findOptimalTaskTimes(taskTitle, assistantContext, durationMinutes, horizon, customStartDate, customEndDate, timePreference);

  return NextResponse.json(recommendation);
}
