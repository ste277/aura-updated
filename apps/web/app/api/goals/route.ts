import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { listGoalsForUser, createGoalWithActivities } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { isGoalTemplateCategory, isValidCivilDateString, resolveGoalTemplateActivities } from '../../../lib/goals';

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

  const { goal, activities: created } = await createGoalWithActivities({ userId: session.userId, title, targetDate, activities });
  return NextResponse.json({ goal, activities: created });
}
