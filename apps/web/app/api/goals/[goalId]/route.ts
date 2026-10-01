import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getGoalForUser, listGoalActivitiesWithLinkedPlanStatus, deleteGoal, getUserById, loadGoalActivityRhythmFacts } from '../../../../lib/db';
import { deriveGoalActivityState, computeGoalProgress } from '../../../../lib/goals';
import { normalizeGoalActivityCompletionRequirement } from '../../../../lib/goalCompletion';
import { normalizeGoalActivityRhythm, computeGoalActivityRhythmEligibility } from '../../../../lib/goalActivityRhythm';
import { getDatePartsInTimezone } from '../../../../lib/timezone';

export async function GET(req: NextRequest, { params }: { params: { goalId: string } }) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const goal = await getGoalForUser(session.userId, params.goalId);
  // 404 regardless of "doesn't exist" vs "exists but isn't yours" -- never
  // reveal another user's Goal's existence through a different status.
  if (!goal) return NextResponse.json({ error: 'Goal not found.' }, { status: 404 });

  const rows = await listGoalActivitiesWithLinkedPlanStatus(session.userId, params.goalId);
  // Goals V2 Rhythm R3 -- "today" in the user's own timezone, the smallest
  // deterministic date Goal Detail (a presentation surface with no
  // specific planning date of its own) can use to inform SELECTABILITY
  // only. The real, authoritative re-check happens later, server-side,
  // against the ACTUAL planning date, inside the Plan with Aura handoff
  // (resolveGoalActivityHandoff) and again at acceptance time
  // (materializeGoalActivityRhythmOccurrence) -- this value is never
  // trusted for any write.
  const user = await getUserById(session.userId);
  const todayLocalDate = user ? getDatePartsInTimezone(user.timezone, new Date()).dateStr : null;

  const activities = await Promise.all(
    rows.map(async (row) => {
      const rhythm = normalizeGoalActivityRhythm(row);
      let rhythmEligibleForAnotherOccurrence = false;
      if (rhythm.kind === 'N_PER_WEEK' && user && todayLocalDate) {
        const facts = await loadGoalActivityRhythmFacts(session.userId, row.id, user.timezone);
        rhythmEligibleForAnotherOccurrence = computeGoalActivityRhythmEligibility({ rhythm, planningLocalDate: todayLocalDate, occurrences: facts }).eligible;
      }
      return {
        // Goals V2 G3.1 -- `row` already carries `currentValue` (the CURRENT
        // execution's measured fact, resolved server-side via the same
        // plannedActivityId this row's own linkage uses -- see
        // listGoalActivitiesWithLinkedPlanStatus's own doc comment), so this
        // spread exposes it automatically. No execution id/source/snapshot
        // columns/timestamps are ever selected into `row` in the first place.
        ...row,
        derivedState: deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus }),
        // Goals V2 G2.1 -- additive: the canonical requirement (null persisted
        // fields, from any legacy row or an activity created without one,
        // normalizes to DONE). Not consumed by any UI yet.
        completionRequirement: normalizeGoalActivityCompletionRequirement(row),
        // Goals V2 Rhythm R3 -- additive, presentation-only. `false` for
        // every finite (NONE) activity, regardless of derivedState.
        rhythmEligibleForAnotherOccurrence,
      };
    })
  );
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
