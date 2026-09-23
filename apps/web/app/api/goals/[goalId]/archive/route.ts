import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { archiveGoal } from '../../../../../lib/db';

export async function POST(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const goal = await archiveGoal(session.userId, params.goalId);
  if (!goal) return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });
  return NextResponse.json(goal);
}
