import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { createPlannedActivity, listPlannedActivities } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';

const MIN_PLAN_DURATION_MINUTES = 15;
const MAX_PLAN_DURATION_MINUTES = 360;
const DURATION_TOLERANCE_MINUTES = 1;
const VALID_MATCH_LABELS = new Set(['Best Match', 'Good Match']);
const VALID_WINDOW_TYPES = new Set(['BRAHMA', 'ABHIJIT', 'RAHU_KALAM', 'GULIKA', 'YAMA', 'NEUTRAL']);

function parseDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseScore(value: unknown): number | null {
  if (value == null) return null;
  const score = Math.round(Number(value));
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return score;
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function parseMatchLabel(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return VALID_MATCH_LABELS.has(trimmed) ? trimmed : '';
}

function parseWindowType(value: unknown): string {
  if (value == null) return 'NEUTRAL';
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toUpperCase();
  return VALID_WINDOW_TYPES.has(trimmed) ? trimmed : '';
}

function parseCalendarUrl(value: unknown): string | null {
  const trimmed = cleanString(value, 2000);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && url.pathname === '/calendar/render'
      ? url.toString()
      : '';
  } catch {
    return '';
  }
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

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const plannedStartAt = parseDate(body?.plannedStartAt);
  const plannedEndAt = parseDate(body?.plannedEndAt);
  const durationMinutes = Number(body?.durationMinutes);
  const status = typeof body?.status === 'string' ? body.status : 'UPCOMING';
  const score = parseScore(body?.score);
  const activityType = cleanString(body?.activityType, 200) ?? title;
  const icon = cleanString(body?.icon, 40);
  const windowType = parseWindowType(body?.windowType);
  const windowLabel = cleanString(body?.windowLabel, 120);
  const matchLabel = parseMatchLabel(body?.matchLabel);
  const recommendation = cleanString(body?.recommendation, 2000);
  const calendarUrl = parseCalendarUrl(body?.calendarUrl);

  if (!title || title.length > 200) return NextResponse.json({ error: 'A title of up to 200 characters is required.' }, { status: 400 });
  if (!plannedStartAt || !plannedEndAt || plannedEndAt <= plannedStartAt) {
    return NextResponse.json({ error: 'Valid plannedStartAt and plannedEndAt values are required.' }, { status: 400 });
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes < MIN_PLAN_DURATION_MINUTES || durationMinutes > MAX_PLAN_DURATION_MINUTES) {
    return NextResponse.json({ error: `durationMinutes must be between ${MIN_PLAN_DURATION_MINUTES} and ${MAX_PLAN_DURATION_MINUTES}.` }, { status: 400 });
  }
  const timestampDurationMinutes = Math.round((plannedEndAt.getTime() - plannedStartAt.getTime()) / 60000);
  if (Math.abs(timestampDurationMinutes - durationMinutes) > DURATION_TOLERANCE_MINUTES) {
    return NextResponse.json({ error: 'durationMinutes must match the planned start and end times.' }, { status: 400 });
  }
  if (status !== 'UPCOMING') {
    return NextResponse.json({ error: 'New plans must be created as upcoming.' }, { status: 400 });
  }
  if (matchLabel === '') {
    return NextResponse.json({ error: 'matchLabel must be Best Match or Good Match.' }, { status: 400 });
  }
  if (!windowType) {
    return NextResponse.json({ error: 'windowType must be a known Panchang window type.' }, { status: 400 });
  }
  if (calendarUrl === '') {
    return NextResponse.json({ error: 'calendarUrl must be a Google Calendar render URL.' }, { status: 400 });
  }

  const plan = await createPlannedActivity({
    userId: session.userId,
    title,
    activityType,
    icon,
    plannedStartAt,
    plannedEndAt,
    durationMinutes,
    windowType,
    windowLabel,
    matchLabel,
    score,
    recommendation,
    calendarUrl,
  });

  return NextResponse.json(plan);
}
