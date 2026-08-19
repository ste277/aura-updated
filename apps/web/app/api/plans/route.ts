import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createPlannedActivity, listPlannedActivities } from '../../../lib/db';

const VALID_STATUSES = new Set(['UPCOMING', 'LOGGED', 'CANCELLED']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const plans = await listPlannedActivities(session.userId);
  return NextResponse.json(plans);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await req.json();
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const plannedStartAt = parseDate(body?.plannedStartAt);
  const plannedEndAt = parseDate(body?.plannedEndAt);
  const durationMinutes = Number(body?.durationMinutes);
  const status = typeof body?.status === 'string' ? body.status : 'UPCOMING';

  if (!title || title.length > 200) return NextResponse.json({ error: 'A title of up to 200 characters is required.' }, { status: 400 });
  if (!plannedStartAt || !plannedEndAt || plannedEndAt <= plannedStartAt) {
    return NextResponse.json({ error: 'Valid plannedStartAt and plannedEndAt values are required.' }, { status: 400 });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 720) {
    return NextResponse.json({ error: 'durationMinutes must be between 5 and 720.' }, { status: 400 });
  }
  if (!VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: 'Invalid plan status.' }, { status: 400 });
  }

  const plan = await createPlannedActivity({
    userId: session.userId,
    title,
    activityType: typeof body?.activityType === 'string' ? body.activityType : title,
    icon: typeof body?.icon === 'string' ? body.icon : null,
    plannedStartAt,
    plannedEndAt,
    durationMinutes,
    windowType: typeof body?.windowType === 'string' && body.windowType ? body.windowType : 'NEUTRAL',
    windowLabel: typeof body?.windowLabel === 'string' ? body.windowLabel : null,
    matchLabel: typeof body?.matchLabel === 'string' ? body.matchLabel : null,
    score: body?.score == null ? null : Math.round(Number(body.score)),
    recommendation: typeof body?.recommendation === 'string' ? body.recommendation : null,
    calendarUrl: typeof body?.calendarUrl === 'string' ? body.calendarUrl : null,
  });

  return NextResponse.json(plan);
}
