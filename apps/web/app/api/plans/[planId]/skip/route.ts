import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { skipPlannedActivity, PlanSkipError } from '../../../../../lib/db';

/**
 * Skip is its own execution outcome ("I chose not to do this occurrence"):
 * never DELETE/cancel (removes the commitment) and never log (HabitLog is
 * execution evidence). Idempotent -- a repeat returns the original SKIPPED
 * row with its original skippedAt.
 */
export async function POST(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const plan = await skipPlannedActivity(session.userId, params.planId);
    return NextResponse.json({ plan });
  } catch (err) {
    if (err instanceof PlanSkipError) {
      return NextResponse.json({ error: err.message }, { status: err.code === 'NOT_FOUND' ? 404 : 409 });
    }
    return NextResponse.json({ error: 'Could not skip plan.' }, { status: 500 });
  }
}
