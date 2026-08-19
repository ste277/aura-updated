import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { cancelPlannedActivity } from '../../../../lib/db';

export async function DELETE(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const plan = await cancelPlannedActivity(session.userId, params.planId);
    return NextResponse.json(plan);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not cancel plan.' }, { status: 400 });
  }
}
