import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getUserById, getSavedPersonForOwner, createDayBuilderDismissal } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { getDatePartsInTimezone } from '../../../../../lib/timezone';
import { resolveRequestNow } from '../../../../../lib/testTimeOverride';
import { FULL_ACTIVITY_CATALOG } from '../../../../../../../packages/recommendation/src/personalizedTasks';

/**
 * Day Builder "Not today" -- POST /api/my-day/suggestions/dismiss. Records
 * that this exact (activityId, personId) suggestion shouldn't be proposed
 * again TODAY (see migration 0026's own doc comment for the identity
 * model). Never touches PlannedActivity, AuraMoment, User preferences, or
 * any scoring/search code -- purely a write to the small
 * DayBuilderDismissal side table that GET /api/my-day/suggestions reads
 * back via dayBuilderOrchestrator.ts.
 *
 * localDate is resolved server-side from the user's own timezone (never
 * trusted from the client) -- the same discipline myDayOrchestrator.ts
 * already applies to "today".
 */

const MAX_ACTIVITY_ID_LENGTH = 100;

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const activityId = typeof body.activityId === 'string' ? body.activityId.trim() : '';
  if (!activityId || activityId.length > MAX_ACTIVITY_ID_LENGTH) {
    return NextResponse.json({ error: `activityId is required and must be ${MAX_ACTIVITY_ID_LENGTH} characters or fewer.` }, { status: 400 });
  }
  if (!FULL_ACTIVITY_CATALOG.some((a) => a.id === activityId)) {
    return NextResponse.json({ error: 'Unknown activityId.' }, { status: 400 });
  }

  let personId = '';
  if (body.personId !== undefined) {
    const rawPersonId = typeof body.personId === 'string' ? body.personId.trim() : '';
    if (!rawPersonId) return NextResponse.json({ error: 'personId, when provided, must be a non-empty string.' }, { status: 400 });
    // Ownership enforced here, at the route -- same discipline as every
    // other savedPersonId-accepting route (never trust a client-supplied
    // id where it can be resolved and checked).
    const person = await getSavedPersonForOwner(session.userId, rawPersonId);
    if (!person) return NextResponse.json({ error: 'Person not found.' }, { status: 404 });
    personId = person.id;
  }

  const now = resolveRequestNow(req);
  const localDate = getDatePartsInTimezone(user.timezone, now).dateStr;

  await createDayBuilderDismissal(session.userId, localDate, activityId, personId || null);

  return NextResponse.json({ ok: true, localDate });
}
