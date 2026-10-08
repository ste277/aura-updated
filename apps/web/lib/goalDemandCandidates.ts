/**
 * Goals V2 Candidate A1 -- the Goal-demand READ MODEL.
 *
 * Answers exactly one question, for one user and one planning date:
 * "which recurring GoalActivities are currently eligible to be
 * CONSIDERED for planning?" This file never plans anything, never
 * writes anything.
 *
 * ELIGIBILITY REUSE: the ONLY authority for completed/committed/
 * remaining/eligible/week-boundary math is
 * evaluateNewOccurrenceEligibility (goalActivityOccurrenceCapacity.ts,
 * Multi-Occurrence Rhythm PR 1's own pure capacity API) -- a direct,
 * unmodified delegation to computeGoalActivityRhythmEligibility
 * (goalActivityRhythm.ts), the exact same formula Goal Detail and
 * materializeGoalActivityRhythmOccurrence (db.ts, the acceptance-time
 * write gate) already use. This file reproduces no formula of its own.
 *
 * STRUCTURAL GATE REUSE: the discovery query itself
 * (loadCandidateGoalActivitiesForRhythmDemand, db.ts) mirrors
 * materializeGoalActivityRhythmOccurrence's own non-capacity checks
 * (status != DISMISSED, rhythmKind = N_PER_WEEK) in SQL -- as of
 * Multi-Occurrence Rhythm PR 2, neither function excludes a GoalActivity
 * merely for having an already-UPCOMING occurrence; weekly capacity
 * (via this file's own batched facts query + the authoritative
 * eligibility function) is the only remaining gate on either side.
 */

import { normalizeGoalActivityRhythm, type GoalActivityRhythmOccurrenceFact } from './goalActivityRhythm';
import { evaluateNewOccurrenceEligibility } from './goalActivityOccurrenceCapacity';
import { loadCandidateGoalActivitiesForRhythmDemand, loadGoalActivityRhythmFactsForActivities, type CandidateGoalActivityForRhythmDemandRow } from './db';

// ============================================================
// Demand contract (this ticket's own section 5) -- the smallest shape
// evidenced by this ticket alone. CompletionRequirement and the Rhythm
// target itself are deliberately excluded: nothing in A1, or in the
// already-traced manual "Plan with Aura" handoff this read model
// mirrors, needs either to decide eligibility or to seed a planning row.
// ============================================================

/** The canonical Rhythm state computeGoalActivityRhythmEligibility already
 * produced for this candidate -- carried as-is, Goal-side. Translation to
 * the generic decision-facts shape happens upstream of the Constructor
 * stack, in goalDecisionFactsProvider.ts, never here. */
export interface GoalDemandRhythmFacts {
  targetPerWeek: number;
  completedThisWeek: number;
  committedThisWeek: number;
  remainingOccurrences: number;
}

export interface GoalDemandCandidate {
  goalActivityId: string;
  goalId: string;
  goalTitle: string;
  title: string;
  activityId: string | null;
  /** The exact remainingOccurrences computeGoalActivityRhythmEligibility
   * already computes -- never re-derived, never negative. */
  remainingThisWeek: number;
  /** Factual Rhythm state only (no priority/urgency/order) -- exactly the
   * values already computed for `remainingThisWeek` above, never
   * re-derived. Every candidate returned here is already Rhythm-eligible
   * (N_PER_WEEK, `eligible === true`), so this is always populated. */
  rhythm: GoalDemandRhythmFacts;
}

/**
 * SUCCESS-with-zero-candidates and LOAD_FAILED are deliberately distinct
 * (this ticket's own section 12) -- a plain `[]` would make "the read
 * failed" indistinguishable from "this user genuinely has no eligible
 * Goal demand right now," and a future caller must be able to tell the
 * two apart rather than silently treating a failure as "nothing to
 * consider." Mirrors this codebase's own established discriminated-
 * result convention (AcceptConstructedDayPersistenceResult,
 * ConstructDayPreviewClientResult) rather than a bare throw/array.
 */
export type GoalDemandResult = { status: 'OK'; candidates: readonly GoalDemandCandidate[] } | { status: 'LOAD_FAILED' };

export interface GoalDemandCandidatesDeps {
  loadCandidateGoalActivities: (userId: string) => Promise<readonly CandidateGoalActivityForRhythmDemandRow[]>;
  loadRhythmFacts: (userId: string, goalActivityIds: readonly string[], timezone: string) => Promise<ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]>>;
}

/** Real production wiring -- both functions are reused verbatim from
 * db.ts, never a new query shape beyond loadCandidateGoalActivitiesForRhythmDemand
 * (added by this same ticket) and the already-existing, already-batched
 * R4 facts loader. */
export function createRealGoalDemandCandidatesDeps(): GoalDemandCandidatesDeps {
  return {
    loadCandidateGoalActivities: loadCandidateGoalActivitiesForRhythmDemand,
    loadRhythmFacts: loadGoalActivityRhythmFactsForActivities,
  };
}

/**
 * NO CAP. NO PRIORITIZATION (this ticket's own section 10, verbatim
 * constraint). Returns the COMPLETE factual set of eligible Goal demand
 * for this user and this planning date -- bounding/ranking is explicitly
 * deferred to a later, separately-authorized planning-integration
 * ticket, where it can be evaluated against manual intents and the
 * 12-intent transport limit together. The only ordering applied here is
 * a stable, non-semantic sort (by goalActivityId) purely for
 * deterministic test/output comparison -- it carries no priority
 * meaning and must never be read as one.
 *
 * `planningLocalDate`/`timezone` are always caller-supplied (never
 * Date.now(), never re-derived) -- the exact same two-parameter
 * discipline resolveGoalActivityHandoff (planDayBootstrap.ts) already
 * established for the manual handoff this read model mirrors.
 */
export async function loadEligibleGoalDemand(deps: GoalDemandCandidatesDeps, userId: string, planningLocalDate: string, timezone: string): Promise<GoalDemandResult> {
  let rows: readonly CandidateGoalActivityForRhythmDemandRow[];
  try {
    rows = await deps.loadCandidateGoalActivities(userId);
  } catch {
    return { status: 'LOAD_FAILED' };
  }
  if (rows.length === 0) return { status: 'OK', candidates: [] };

  let factsByActivity: ReadonlyMap<string, readonly GoalActivityRhythmOccurrenceFact[]>;
  try {
    factsByActivity = await deps.loadRhythmFacts(
      userId,
      rows.map((row) => row.goalActivityId),
      timezone
    );
  } catch {
    return { status: 'LOAD_FAILED' };
  }

  const candidates: GoalDemandCandidate[] = [];
  for (const row of rows) {
    // Defense-in-depth re-check of the discovery query's own SQL filter
    // -- never a second, independently-maintained formula: normalize +
    // compare, exactly like every other consumer of a raw persisted
    // rhythmKind in this codebase.
    const rhythm = normalizeGoalActivityRhythm({ rhythmKind: row.rhythmKind, rhythmTargetPerWeek: row.rhythmTargetPerWeek });
    if (rhythm.kind !== 'N_PER_WEEK') continue;

    const facts = factsByActivity.get(row.goalActivityId) ?? [];
    const eligibility = evaluateNewOccurrenceEligibility({ rhythm, planningLocalDate, occurrences: facts });
    if (!eligibility.eligible) continue;

    candidates.push({
      goalActivityId: row.goalActivityId,
      goalId: row.goalId,
      goalTitle: row.goalTitle,
      title: row.title,
      activityId: row.activityId,
      remainingThisWeek: eligibility.remainingOccurrences,
      rhythm: {
        targetPerWeek: rhythm.targetPerWeek ?? 0,
        completedThisWeek: eligibility.completedThisWeek,
        committedThisWeek: eligibility.committedThisWeek,
        remainingOccurrences: eligibility.remainingOccurrences,
      },
    });
  }

  candidates.sort((a, b) => a.goalActivityId.localeCompare(b.goalActivityId));
  return { status: 'OK', candidates };
}

// ============================================================
// Duplicate identity (this ticket's own section 11) -- a pure set-
// difference helper for a LATER planning-integration ticket to exclude
// Goal demand already seeded manually in the same Plan Day request.
// Performs no persistence, no request-context lookup of its own: A1 has
// no Plan Day request context to deduplicate against, so this is
// provided only as a reusable primitive, not called from anywhere in
// this ticket.
// ============================================================

export function excludeGoalDemandByActivityIds(candidates: readonly GoalDemandCandidate[], excludeGoalActivityIds: ReadonlySet<string> | readonly string[]): GoalDemandCandidate[] {
  const exclude = excludeGoalActivityIds instanceof Set ? excludeGoalActivityIds : new Set(excludeGoalActivityIds);
  return candidates.filter((candidate) => !exclude.has(candidate.goalActivityId));
}
