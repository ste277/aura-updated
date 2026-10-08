import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getGoalForUser, listGoalActivitiesWithLinkedPlanStatus, deleteGoal, getUserById, loadGoalActivityRhythmFactsForActivities } from '../../../../lib/db';
import { deriveGoalActivityState, computeGoalProgress } from '../../../../lib/goals';
import { normalizeGoalActivityCompletionRequirement } from '../../../../lib/goalCompletion';
import { normalizeGoalActivityRhythm } from '../../../../lib/goalActivityRhythm';
import { evaluateNewOccurrenceEligibility } from '../../../../lib/goalActivityOccurrenceCapacity';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { goalHasOngoingRhythmActivity, type GoalActivityRhythmView } from '../../../../lib/goalsPresentation';

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
  // trusted for any write. Rhythm R4 reuses this EXACT same value for its
  // own "this week" presentation (this ticket's own section 7/8) -- no
  // second local-date source, no second week calculation.
  const user = await getUserById(session.userId);
  const todayLocalDate = user ? getDatePartsInTimezone(user.timezone, new Date()).dateStr : null;

  // Goals V2 Rhythm R4 -- ONE batched fact query for every N_PER_WEEK
  // activity on this Goal (this ticket's own section 40), never one query
  // per row (R3's own per-row loadGoalActivityRhythmFacts call, looped via
  // Promise.all, is exactly the N+1 pattern this replaces for Goal Detail;
  // that single-activity loader is untouched and still used elsewhere,
  // e.g. by materializeGoalActivityRhythmOccurrence's own transaction-scoped
  // re-check).
  const rhythmPolicyByActivityId = new Map(rows.map((row) => [row.id, normalizeGoalActivityRhythm(row)] as const));
  const nPerWeekActivityIds = rows.filter((row) => rhythmPolicyByActivityId.get(row.id)!.kind === 'N_PER_WEEK').map((row) => row.id);
  const factsByActivityId = user ? await loadGoalActivityRhythmFactsForActivities(session.userId, nPerWeekActivityIds, user.timezone) : new Map();

  const activities = rows.map((row) => {
    const rhythmPolicy = rhythmPolicyByActivityId.get(row.id)!;
    // Goals V2 Rhythm R4 -- the canonical presentation shape (this ticket's
    // own section 5). Every number comes from the ONE
    // computeGoalActivityRhythmEligibility call below -- never a second,
    // independent count (this ticket's own section 6 "Single Source of
    // Truth").
    let rhythm: GoalActivityRhythmView = { kind: 'NONE' };
    if (rhythmPolicy.kind === 'N_PER_WEEK' && todayLocalDate) {
      const facts = factsByActivityId.get(row.id) ?? [];
      const eligibility = evaluateNewOccurrenceEligibility({ rhythm: rhythmPolicy, planningLocalDate: todayLocalDate, occurrences: facts });
      rhythm = {
        kind: 'N_PER_WEEK',
        targetPerWeek: rhythmPolicy.targetPerWeek ?? 0,
        completedThisWeek: eligibility.completedThisWeek,
        committedThisWeek: eligibility.committedThisWeek,
        remainingThisWeek: eligibility.remainingOccurrences,
        eligibleForAnotherOccurrence: eligibility.eligible,
      };
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
      rhythm,
    };
  });
  // Goals V2 Rhythm R4 -- hasOngoingRhythmActivity (this ticket's own
  // section 17-19) is computed from this SAME activities list, never a
  // second Goal-level Rhythm query.
  const progress = { ...computeGoalProgress(activities.map((activity) => activity.derivedState)), hasOngoingRhythmActivity: goalHasOngoingRhythmActivity(activities) };

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
