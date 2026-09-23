import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getGoalForUser, listGoalActivitiesWithLinkedPlanStatus, deleteGoal } from '../../../../lib/db';
import { deriveGoalActivityState, computeGoalProgress } from '../../../../lib/goals';

export async function GET(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const goal = await getGoalForUser(session.userId, params.goalId);
  // 404 regardless of "doesn't exist" vs "exists but isn't yours" -- never
  // reveal another user's Goal's existence through a different status.
  if (!goal) return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });

  const rows = await listGoalActivitiesWithLinkedPlanStatus(session.userId, params.goalId);
  const activities = rows.map((row) => ({
    ...row,
    derivedState: deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus }),
  }));
  const progress = computeGoalProgress(activities.map((activity) => activity.derivedState));

  return NextResponse.json({ goal, activities, progress });
}

export async function DELETE(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const result = await deleteGoal(session.userId, params.goalId);
  if (result === 'NOT_FOUND') return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });
  if (result === 'HAS_HISTORY') {
    // Deliberately "existing PlannedActivity linkage," not "ever
    // scheduled" -- this check clears itself (goalHasRetainedPlanLinkage)
    // once the linked PlannedActivity is hard-deleted, since Aura keeps no
    // separate durable tombstone for it. The user can retry delete later,
    // or archive now.
    return NextResponse.json({ error: 'This goal has an existing PlannedActivity linkage and cannot be deleted right now. Archive it instead.' }, { status: 409 });
  }
  return NextResponse.json({ deleted: true });
}
