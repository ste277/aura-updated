import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { listUserActivityPreferences } from '../../../lib/activityPreferences';

/**
 * Explicit Duration Preferences API V1 -- LIST. Every call is scoped to the
 * authenticated session's userId; listUserActivityPreferences() never
 * accepts or exposes another user's rows. Returns the raw app-contract
 * array only ({activityId, preferredDurationMinutes}) -- no DB metadata
 * (id/userId/createdAt/updatedAt), no catalog titles (see
 * apps/web/lib/activityPreferences.ts's own doc comment for why this
 * contract stays deliberately minimal).
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const preferences = await listUserActivityPreferences(session.userId);
  return NextResponse.json(preferences);
}
