import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { listGoalsForUser, createGoalWithActivities } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { isGoalTemplateCategory, isValidCivilDateString, resolveGoalTemplateActivities } from '../../../lib/goals';
import { validateGoalActivityRhythm, NONE_GOAL_ACTIVITY_RHYTHM, type GoalActivityRhythm } from '../../../lib/goalActivityRhythm';

const MAX_TITLE_LENGTH = 200;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get('status');
  const status = statusParam === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE';

  const goals = await listGoalsForUser(session.userId, status);
  return NextResponse.json(goals);
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > MAX_TITLE_LENGTH) {
    return NextResponse.json({ error: `A goal title of up to ${MAX_TITLE_LENGTH} characters is required.` }, { status: 400 });
  }

  let targetDate: string | null = null;
  if (body.targetDate !== undefined && body.targetDate !== null) {
    if (!isValidCivilDateString(body.targetDate)) {
      return NextResponse.json({ error: 'targetDate must be a valid "YYYY-MM-DD" calendar date.' }, { status: 400 });
    }
    // Passed straight through as a string -- see Goal.targetDate's own doc
    // comment in db.ts for why no Date object is ever constructed here.
    targetDate = body.targetDate;
  }

  // No deterministic template exists for arbitrary free text -- a Goal is
  // never decomposed by guessing from its title. templateCategory must be
  // an explicit, valid choice or omitted entirely (design section 17 / 29:
  // an unmatched/omitted category means the Goal persists with zero
  // auto-generated activities, never a forced/incorrect guess).
  let activities: ReturnType<typeof resolveGoalTemplateActivities> = [];
  if (body.templateCategory !== undefined && body.templateCategory !== null) {
    if (!isGoalTemplateCategory(body.templateCategory)) {
      return NextResponse.json({ error: 'templateCategory must be one of GET_FITTER, MEDITATE_REGULARLY, FINISH_PROJECT, STUDY_CONSISTENTLY.' }, { status: 400 });
    }
    activities = resolveGoalTemplateActivities(body.templateCategory);
  }

  // Goals V2 Rhythm R5 -- optional, additive, per-activity (this ticket's
  // own section 13 domain-truth decision: Rhythm belongs to GoalActivity,
  // never a single Goal-level frequency blindly copied across every
  // template activity). Omitted entirely means every activity persists
  // NONE -- identical to every Goal creation before this ticket (section
  // 42/50). When present, it must align 1:1 with the resolved template
  // activities (this ticket's own section 49 "no partial GoalActivity
  // write" -- a length mismatch or any single invalid entry rejects the
  // WHOLE request before anything is persisted, never a partial/best-
  // -effort application). Only meaningful alongside templateCategory --
  // "Start from scratch" creates zero activities, so there is nothing to
  // apply a rhythm to (this ticket's own section 17).
  let activityRhythms: GoalActivityRhythm[] | null = null;
  if (body.activityRhythms !== undefined && body.activityRhythms !== null) {
    if (!Array.isArray(body.activityRhythms) || body.activityRhythms.length !== activities.length) {
      return NextResponse.json({ error: `activityRhythms must be an array with exactly ${activities.length} entries, matching the template's own activities.` }, { status: 400 });
    }
    const validated: GoalActivityRhythm[] = [];
    for (const candidate of body.activityRhythms) {
      if (typeof candidate !== 'object' || candidate === null) {
        return NextResponse.json({ error: 'Each activityRhythms entry must be an object with a kind field.' }, { status: 400 });
      }
      const result = validateGoalActivityRhythm(candidate as { kind: unknown; targetPerWeek?: unknown });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      validated.push(result.rhythm);
    }
    activityRhythms = validated;
  }
  const activitiesWithRhythm = activities.map((activity, index) => ({ ...activity, rhythm: activityRhythms ? activityRhythms[index] : NONE_GOAL_ACTIVITY_RHYTHM }));

  const { goal, activities: created } = await createGoalWithActivities({ userId: session.userId, title, targetDate, activities: activitiesWithRhythm });
  return NextResponse.json({ goal, activities: created });
}
