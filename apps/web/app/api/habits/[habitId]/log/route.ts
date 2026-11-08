import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { logHabitCompletion } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { isSolarWindowType } from '../../../../../../../packages/panchang/src/windows';

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
  // PA-3C-C1B-01 (D9): this endpoint previously accepted ANY non-empty
  // string as activeWindow with no enum check. Confirmed (A3 audit) that
  // this route has zero current repository callers -- the live habit-
  // completion path is /api/plans/{id}/log -- but an external/mobile
  // client is not ruled out, so strict validation is added rather than
  // relying on that absence. 'UNAVAILABLE' is explicitly accepted (a
  // legitimate solar no-event classification); anything else unrecognized
  // is rejected, never silently persisted as-is.
  if (!isSolarWindowType(activeWindow)) {
    return NextResponse.json({ error: 'activeWindow must be a recognized solar-window classification.' }, { status: 400 });
  }

  try {
    const habit = await logHabitCompletion(session.userId, params.habitId, activeWindow, Math.round(logMinuteOfDay));
    return NextResponse.json(habit);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not log habit.' }, { status: 400 });
  }
}
