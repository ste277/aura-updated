import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { addGoalActivity } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { getActivityProfileById } from '../../../../../../../packages/recommendation/src/personalizedTasks';
import { validateGoalActivityRhythm, NONE_GOAL_ACTIVITY_RHYTHM, type GoalActivityRhythm } from '../../../../../lib/goalActivityRhythm';

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

  // Goals V2 Rhythm R5 -- optional, additive. Omitted entirely means NONE
  // (this ticket's own section 42 API compatibility), server-validated
  // through the canonical R2 validator -- never trusted raw from the
  // client, never coerced (0/negative/fractional/missing-target are
  // rejected outright, this ticket's own section 19).
  let rhythm: GoalActivityRhythm = NONE_GOAL_ACTIVITY_RHYTHM;
  if (body.rhythm !== undefined && body.rhythm !== null) {
    if (typeof body.rhythm !== 'object') {
      return NextResponse.json({ error: 'rhythm must be an object with a kind field.' }, { status: 400 });
    }
    const validated = validateGoalActivityRhythm(body.rhythm as { kind: unknown; targetPerWeek?: unknown });
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
    rhythm = validated.rhythm;
  }

  const activity = await addGoalActivity(session.userId, params.goalId, { title, activityId, rhythm });
  if (!activity) return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });
  return NextResponse.json(activity);
}
