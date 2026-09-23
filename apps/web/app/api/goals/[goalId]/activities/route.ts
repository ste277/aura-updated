import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { addGoalActivity } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { getActivityProfileById } from '../../../../../../../packages/recommendation/src/personalizedTasks';

const MAX_TITLE_LENGTH = 200;

export async function POST(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `An activity title of up to ${MAX_TITLE_LENGTH} characters is required.` }, { status: 400 });
  }

  // Same discipline as POST /api/plans -- present -> must resolve to a
  // real, current catalog entry via an exact-id lookup (never alias/
  // fuzzy matching); an unknown id is rejected outright, never silently
  // dropped to null or persisted unvalidated. Never required.
  let activityId: string | null = null;
  if (body.activityId !== undefined && body.activityId !== null) {
    if (typeof body.activityId !== 'string' || !body.activityId.trim()) {
      return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });
    }
    const activity = getActivityProfileById(body.activityId.trim());
    if (!activity) return NextResponse.json({ error: 'Unknown activity.' }, { status: 400 });
    activityId = activity.id;
  }

  const activity = await addGoalActivity(session.userId, params.goalId, { title, activityId });
  if (!activity) return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });
  return NextResponse.json(activity);
}
