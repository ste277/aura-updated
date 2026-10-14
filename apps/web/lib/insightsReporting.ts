/**
 * Insights V1 PR4 -- Read-Only Goal and Planning Reporting. Pure,
 * DB-free domain logic (same convention as goals.ts/goalActivityRhythm.ts):
 * no DB access here -- see db.ts for the two new reads this PR adds
 * (listGoalActivitiesWithLinkedPlanStatusForGoals, listPlannedActivitiesForReporting)
 * and the API route (app/api/insights/reporting/route.ts) for orchestration.
 *
 * Reuses every existing business rule verbatim -- deriveGoalActivityState,
 * evaluateNewOccurrenceEligibility, computeGoalProgress,
 * normalizeGoalActivityRhythm, normalizeGoalActivityCompletionRequirement
 * -- the SAME functions apps/web/app/api/goals/[goalId]/route.ts already
 * uses for one Goal, applied here across every one of a user's Goals in
 * one batched pass. This module defines NO second completion/eligibility
 * rule anywhere.
 *
 * Fact model (per AURA_INSIGHTS_PR4_ARCHITECTURE_AUDIT.md section 3):
 * CONFIRMED COMPLETED / SCHEDULED / SKIPPED / CANCELLED / RESCHEDULED /
 * AWAITING CONFIRMATION. Never infers completion from elapsed time, a
 * scheduled commitment, a recommendation, or a Move. A MOVED row is
 * counted once, under RESCHEDULED, never also as a live commitment --
 * its successor (a separate, independent row) is classified on its own
 * merits, so a reschedule chain of any length contributes exactly one
 * RESCHEDULED fact per hop plus whatever its CURRENT terminal row's own
 * status contributes -- never a duplicate "commitment".
 *
 * Insights V1 PR7 -- a RESCHEDULED row is attributed to the range by its
 * actual Move timestamp (db.ts's listPlannedActivitiesForReporting now
 * reads "movedAt" for a MOVED row, falling back to "plannedStartAt" only
 * when movedAt was never recorded), not by its own stale original
 * schedule -- see that function's own doc comment for why. This module's
 * own classifyPlanningStatus is unaffected: it still just reads
 * plan.status, unaware of which timestamp selected the row.
 */

import type {
  GoalActivityWithLinkedPlanStatus,
  PlannedActivity,
} from './db';
import { deriveGoalActivityState, computeGoalProgress, type DerivedGoalActivityState } from './goals';
import { normalizeGoalActivityCompletionRequirement } from './goalCompletion';
import { normalizeGoalActivityRhythm, type GoalActivityRhythmOccurrenceFact } from './goalActivityRhythm';
import { evaluateNewOccurrenceEligibility } from './goalActivityOccurrenceCapacity';
import { goalHasOngoingRhythmActivity, type GoalActivityRhythmView } from './goalsPresentation';

// ============================================================
// Planning status -- one fact per PlannedActivity row, never inferred
// from anything beyond its own persisted status + elapsed time (the one
// explicitly-allowed derivation: an elapsed, still-UPCOMING plan has no
// confirmed outcome yet, which is a fact about EVIDENCE, not a judgment).
// ============================================================

export type PlanningStatusFact = 'CONFIRMED_COMPLETED' | 'SCHEDULED' | 'SKIPPED' | 'CANCELLED' | 'RESCHEDULED' | 'AWAITING_CONFIRMATION';

/**
 * Pure. `now` is always caller-supplied (never Date.now() read internally,
 * same discipline as computeGoalActivityRhythmEligibility) so this stays
 * deterministic and testable with a fixed clock. Never infers CONFIRMED
 * COMPLETED from a scheduled commitment, a recommendation, or elapsed
 * time -- only an explicit 'LOGGED' status does that. A MOVED row always
 * resolves to RESCHEDULED, regardless of how long ago it moved -- it is
 * never re-classified as "awaiting confirmation" just because it's old.
 */
export function classifyPlanningStatus(
  plan: Pick<PlannedActivity, 'status' | 'plannedEndAt'>,
  now: Date
): PlanningStatusFact {
  switch (plan.status) {
    case 'LOGGED':
      return 'CONFIRMED_COMPLETED';
    case 'SKIPPED':
      return 'SKIPPED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'MOVED':
      return 'RESCHEDULED';
    case 'UPCOMING':
    default:
      return new Date(plan.plannedEndAt).getTime() < now.getTime() ? 'AWAITING_CONFIRMATION' : 'SCHEDULED';
  }
}

export interface PlanningStatusSummary {
  confirmedCompleted: number;
  scheduled: number;
  skipped: number;
  cancelled: number;
  rescheduled: number;
  awaitingConfirmation: number;
  total: number;
}

/**
 * Pure aggregation over already-fetched rows (db.ts's
 * listPlannedActivitiesForReporting) -- no query here, no business rule
 * beyond classifyPlanningStatus above. Every row contributes to exactly
 * one bucket (the fact model's own precedence, section 3): a MOVED
 * source and its live successor are two DISTINCT rows this function
 * receives independently (the source classifies RESCHEDULED, the
 * successor classifies on ITS OWN current status) -- this is not
 * double-counting a single commitment, it is correctly counting two
 * different, real facts: "a reschedule happened" and "here is the
 * commitment's current state".
 */
export function summarizePlanningStatus(plans: readonly Pick<PlannedActivity, 'status' | 'plannedEndAt'>[], now: Date): PlanningStatusSummary {
  const summary: PlanningStatusSummary = { confirmedCompleted: 0, scheduled: 0, skipped: 0, cancelled: 0, rescheduled: 0, awaitingConfirmation: 0, total: plans.length };
  for (const plan of plans) {
    switch (classifyPlanningStatus(plan, now)) {
      case 'CONFIRMED_COMPLETED': summary.confirmedCompleted++; break;
      case 'SCHEDULED': summary.scheduled++; break;
      case 'SKIPPED': summary.skipped++; break;
      case 'CANCELLED': summary.cancelled++; break;
      case 'RESCHEDULED': summary.rescheduled++; break;
      case 'AWAITING_CONFIRMATION': summary.awaitingConfirmation++; break;
    }
  }
  return summary;
}

// ============================================================
// Goal summaries -- ACROSS every one of a user's Goals in one pass,
// reusing exactly the per-Goal construction apps/web/app/api/goals/[goalId]/route.ts
// already uses (never a second eligibility/progress rule).
// ============================================================

export type GoalKindLabel = 'RHYTHM' | 'FINITE' | 'MIXED' | 'EMPTY';

/** Pure, presentation-only classification -- Goal itself has no "type"
 * column (confirmed, schema.prisma); this derives a label from its own
 * activities' rhythmKind, exactly the same way goalHasOngoingRhythmActivity
 * already derives a boolean from the same rows, never a schema change. */
export function classifyGoalKind(activities: readonly { rhythmKind: string | null; rhythmTargetPerWeek: number | null }[]): GoalKindLabel {
  if (activities.length === 0) return 'EMPTY';
  let hasRhythm = false;
  let hasFinite = false;
  for (const activity of activities) {
    if (normalizeGoalActivityRhythm(activity).kind === 'N_PER_WEEK') hasRhythm = true;
    else hasFinite = true;
  }
  if (hasRhythm && hasFinite) return 'MIXED';
  return hasRhythm ? 'RHYTHM' : 'FINITE';
}

/** One GoalActivity's reporting-relevant facts -- the exact fields
 * section E of the ticket asks for, per activity (a Goal may have more
 * than one Rhythm activity, each with its own weekly target, so these
 * cannot be collapsed to Goal-level scalars without losing information
 * the ticket explicitly asks to preserve). */
export interface GoalActivitySummaryView {
  id: string;
  title: string;
  derivedState: DerivedGoalActivityState;
  /** Existing finite progress value (GoalActivityExecution.currentValue,
   * reachable even after plan deletion -- see listGoalActivitiesWithLinkedPlanStatus's
   * own doc comment in db.ts). Always null for a Rhythm activity (no
   * single "current value" concept applies there; see `rhythm` instead). */
  currentValue: number | null;
  /** NONE for a finite activity; N_PER_WEEK carries targetPerWeek,
   * completedThisWeek, committedThisWeek, remainingThisWeek,
   * eligibleForAnotherOccurrence -- the SAME GoalActivityRhythmView shape
   * Goal Detail already renders, reused verbatim. */
  rhythm: GoalActivityRhythmView;
}

export interface GoalSummaryView {
  id: string;
  title: string;
  kind: GoalKindLabel;
  activities: GoalActivitySummaryView[];
  progress: { total: number; completed: number; hasOngoingRhythmActivity: boolean };
}

/**
 * Pure. `rows` and `factsByActivityId` are already-fetched (db.ts's
 * listGoalActivitiesWithLinkedPlanStatusForGoals and
 * loadGoalActivityRhythmFactsForActivities, called ONCE each by the
 * caller across every Goal -- never per-Goal, never per-activity). This
 * function's own per-row construction is byte-for-byte the SAME as
 * apps/web/app/api/goals/[goalId]/route.ts's GET handler, just iterated
 * once per Goal instead of hardcoded to one.
 */
export function buildGoalSummary(
  goal: { id: string; title: string },
  rows: readonly GoalActivityWithLinkedPlanStatus[],
  factsByActivityId: ReadonlyMap<string, GoalActivityRhythmOccurrenceFact[]>,
  todayLocalDate: string
): GoalSummaryView {
  const activities: GoalActivitySummaryView[] = rows.map((row) => {
    const rhythmPolicy = normalizeGoalActivityRhythm(row);
    let rhythm: GoalActivityRhythmView = { kind: 'NONE' };
    if (rhythmPolicy.kind === 'N_PER_WEEK') {
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
      id: row.id,
      title: row.title,
      derivedState: deriveGoalActivityState({ status: row.status, plannedActivityId: row.plannedActivityId, linkedPlanStatus: row.linkedPlanStatus, everCompleted: row.everCompleted }),
      currentValue: row.currentValue,
      rhythm,
    };
  });
  const progress = { ...computeGoalProgress(activities.map((a) => a.derivedState)), hasOngoingRhythmActivity: goalHasOngoingRhythmActivity(activities) };
  return {
    id: goal.id,
    title: goal.title,
    kind: classifyGoalKind(rows),
    activities,
    progress,
  };
}
