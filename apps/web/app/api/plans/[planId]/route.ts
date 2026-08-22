import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { cancelPlannedActivity, deletePlannedActivity } from '../../../../lib/db';

/**
 * "Remove this plan" from the UI's point of view -- the actual DB effect
 * depends on the plan's current status: an UPCOMING plan is cancelled
 * (cancelPlannedActivity, unchanged, soft state transition), while a
 * LOGGED/CANCELLED plan is permanently removed (deletePlannedActivity) so
 * "Recently Completed" doesn't only ever grow. Tries cancel first (the
 * common case) and falls back to delete rather than looking the plan up
 * twice.
 */
export async function DELETE(req: NextRequest, { params }: { params: { planId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  try {
    const plan = await cancelPlannedActivity(session.userId, params.planId);
    return NextResponse.json(plan);
  } catch {
    try {
      await deletePlannedActivity(session.userId, params.planId);
      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Could not remove plan.' }, { status: 400 });
    }
  }
}
