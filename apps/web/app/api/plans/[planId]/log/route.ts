import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { logPlannedActivity } from '../../../../../lib/db';

export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const result = await logPlannedActivity(session.userId, params.planId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not log plan.' }, { status: 400 });
  }
}
