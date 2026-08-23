import { NextRequest, NextResponse } from 'next/server';
import { createHabitLog, listHabitLogs } from '../../../lib/db';
import { getSessionFromRequest } from '../../../lib/session';
import { parseJsonObject } from '../../../lib/request';

function parseLogSource(value: unknown): 'AURA_PLANNED' | 'AURA_DO_NOW' | 'MANUAL' | 'OVERRIDE_CAUTION' {
  if (value === 'AURA_PLANNED' || value === 'AURA_DO_NOW' || value === 'MANUAL' || value === 'OVERRIDE_CAUTION') return value;
  return 'MANUAL';
}

function parseActivitySignificance(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') return value;
  return 'MEDIUM';
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  }

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const { activityTitle, activeWindow, logMinuteOfDay, logTimestamp, notes, durationMinutes, logSource, activitySignificance } = body;
  const cleanTitle = typeof activityTitle === 'string' ? activityTitle.trim() : '';
  const cleanWindow = typeof activeWindow === 'string' ? activeWindow.trim() : '';
  const minuteOfDay = Number(logMinuteOfDay);

  if (!cleanTitle || !cleanWindow || !Number.isFinite(minuteOfDay) || minuteOfDay < 0 || minuteOfDay > 1439) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 });
  }

  // Parse custom timestamp if provided, fallback to current time
  const customDate = typeof logTimestamp === 'string' ? new Date(logTimestamp) : new Date();
  if (Number.isNaN(customDate.getTime())) {
    return NextResponse.json({ error: 'logTimestamp must be a valid date.' }, { status: 400 });
  }

  const entry = await createHabitLog({
    userId: session.userId,
    activityTitle: cleanTitle,
    activeWindow: cleanWindow,
    logMinuteOfDay: Math.round(minuteOfDay),
    logTimestamp: customDate,
    // Good Right Now Action Semantics V1: the floor used to be 5, silently
    // bumping any near-zero submission up -- that made it impossible to
    // ever log a genuinely INSTANT activity (a hydration check) without
    // manufacturing a fake few minutes of "effort" (brief section 1/4).
    // 0 is now a legitimate, real value: instantaneous activities log
    // exactly 0, not a placeholder. Insights/streak calculations were
    // audited (brief section 1/13) and already treat durationMinutes as
    // real elapsed effort ONLY where a nullish-coalescing default (?? 30)
    // is applied -- 0 passes through those unchanged (nullish coalescing
    // only substitutes for null/undefined, never 0), so this is a
    // backward-compatible floor change, not a new code path.
    durationMinutes: Math.min(180, Math.max(0, Number(durationMinutes ?? 30))),
    notes: notes ? String(notes).trim() : undefined,
    logSource: parseLogSource(logSource),
    activitySignificance: parseActivitySignificance(activitySignificance),
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
