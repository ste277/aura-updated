import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { parseJsonObject } from '../../../../lib/request';
import { getUserById, getDailyWorkPreferences, setDailyWorkPreferences, clearDailyWorkPreferences } from '../../../../lib/db';
import { validateDailyRhythmPreferencesInput } from '../../../../lib/dailyRhythmPreferences';

/**
 * Daily Rhythm V1 PR DR1 -- Preferences Foundation API. Every operation
 * is scoped exclusively to `session.userId` (never accepted from the
 * request body), same convention as availability-preferences/route.ts.
 *
 * GET returns the current preference (both null = unconfigured) plus
 * `timezone` for display only -- this route never edits timezone.
 *
 * PUT is REPLACE semantics for all three fields together (workStart,
 * workEnd, workDays) -- never a partial update. An empty `workDays` array
 * is a valid, deliberate state, not an error and not a reset.
 *
 * DELETE is Clear -- the only operation that returns the user to the
 * unconfigured (both-null) state, deliberately a separate method/route
 * from PUT with empty-ish values, same "save vs reset are never confused
 * at the transport layer" precedent availability-preferences/route.ts
 * already established.
 *
 * NOTHING in this route (or anywhere reached from it) is read by the day
 * constructor, Find a Time, Home, or Goals -- this PR is preferences
 * persistence only.
 */

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const prefs = await getDailyWorkPreferences(session.userId);
  if (!prefs) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  return NextResponse.json({
    configured: prefs.workStart !== null && prefs.workEnd !== null,
    timezone: user.timezone,
    workStart: prefs.workStart,
    workEnd: prefs.workEnd,
    workDays: prefs.workDays,
  });
}

export async function PUT(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  if (typeof body.workStart !== 'string' || typeof body.workEnd !== 'string' || !Array.isArray(body.workDays)) {
    return NextResponse.json({ error: 'workStart and workEnd must be strings and workDays must be an array.' }, { status: 400 });
  }

  let validated;
  try {
    validated = validateDailyRhythmPreferencesInput({ workStart: body.workStart, workEnd: body.workEnd, workDays: body.workDays });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Invalid daily rhythm preferences.' }, { status: 400 });
  }

  await setDailyWorkPreferences(session.userId, validated);
  return NextResponse.json({ configured: true, workStart: validated.workStart, workEnd: validated.workEnd, workDays: validated.workDays });
}

export async function DELETE(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  await clearDailyWorkPreferences(session.userId);
  return NextResponse.json({ configured: false, workStart: null, workEnd: null, workDays: [] });
}
