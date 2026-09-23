import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../../lib/session';
import { dismissGoalActivity } from '../../../../../../../lib/db';

export async function POST(req: NextRequest, { params }: { params: { goalId: string; goalActivityId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const activity = await dismissGoalActivity(session.userId, params.goalId, params.goalActivityId);
  if (!activity) return NextResponse.json({ error: 'Goal activity not found.' }, { status: 404 });
  return NextResponse.json(activity);
}
