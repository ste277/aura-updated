/**
 * Goals V2 Candidate A2 -- the PURE planning-source adapter between A1's
 * factual eligible Goal demand (goalDemandCandidates.ts) and the existing
 * generic Day Constructor request contract.
 *
 * NOT wired into /plan-day, Home, Right Now, or Recomposition (this
 * ticket's own section 17) -- production library code exercised only by
 * tests until a later, separately-authorized integration ticket (A3)
 * decides how/whether to call it from a real request path.
 *
 * AUTONOMY BOUNDARY (this ticket's own section 0): this module prepares
 * candidates for CONSIDERATION. It builds intents that COULD be proposed
 * to the Constructor -- it never calls the Constructor, never calls
 * persistAcceptedConstructedDay, never creates a Plan/occurrence, and
 * never decides that a candidate WILL be planned. Acceptance (a human
 * action, today unchanged) remains the only thing that commits anything.
 *
 * GENERIC CONTRACT CHOICE (this ticket's own section 2) -- re-read fresh
 * from dayConstructorPreviewClient.ts/dayConstructorOrchestrator.ts
 * rather than assumed:
 *
 *   RequestedDayIntent (dayConstructorOrchestrator.ts) requires
 *   `originalOrder: number`, an orchestrator-internal field assigned from
 *   array position within ONE already-assembled combined request -- A2
 *   has no such combined array of its own (that assembly is exactly A3's
 *   job), so producing RequestedDayIntent here would mean inventing an
 *   order A2 has no authority over.
 *
 *   PlanDayIntentRow (planDayEntry.ts) is a CLIENT/UI row model (mutable
 *   form state: timeMode/fixedTime/deadlineChoice) -- never used
 *   server-side, never produced by a pure function.
 *
 *   PreviewRequestIntentBody (dayConstructorPreviewClient.ts) is the
 *   correct target: the exact wire-level generic intent shape the
 *   existing manual "Plan with Aura" handoff already produces
 *   (buildRequestedIntentsForSubmission, planDayEntry.ts), carries no
 *   Goal/Rhythm field, and needs no `originalOrder` -- F1's own request
 *   parser derives that itself from array position (confirmed by direct
 *   re-read, dayConstructorPreviewRequest.ts's own doc comment:
 *   "originalOrder never sent -- array position IS the order").
 *
 * No Goal/Rhythm field (goalActivityId, goalId, goalTitle,
 * remainingThisWeek, rhythmKind, rhythmTargetPerWeek) is ever added to
 * PreviewRequestIntentBody or any Constructor-facing type -- Goal
 * provenance is carried entirely OUTSIDE it, in `goalActivityLinks`, the
 * exact same sibling-envelope pattern the manual handoff's own
 * `GoalActivityLink[]` (acceptConstructedDay.ts) already established.
 */

import type { PreviewRequestIntentBody } from './dayConstructorPreviewClient';
import { MAX_INTENTS_PER_REQUEST } from './dayConstructorPreviewRequest';
import { excludeGoalDemandByActivityIds, type GoalDemandCandidate } from './goalDemandCandidates';

// ============================================================
// Intent identity (this ticket's own section 5) -- a deterministic,
// namespaced encoding of the one stable factual identity a planning
// request actually has for automatic Goal demand: WHICH GoalActivity,
// for WHICH planning date. Never title (mutable, carries no identity),
// never a random UUID (identity must be reproducible across repeated
// preview requests for the same inputs -- this ticket's own section 16
// purity requirement), never persisted merely to mint an id.
//
// Namespaced with a prefix distinct from the manual handoff's own
// client-generated `plan-day-goal-<id>` row ids (planDayEntry.ts) --
// deliberately a DIFFERENT scheme, so an automatic candidate's intentId
// can never collide with a manually-seeded row's intentId even before
// goalActivityId-based deduplication (section 6) is applied, and so a
// reader can tell at a glance which origin produced a given intentId.
//
// Bounded length: a real GoalActivity.id is a 36-character UUID
// (randomUUID(), db.ts) and planningLocalDate is a 10-character
// YYYY-MM-DD string -- "goal-demand:" + date + ":" + id is well under
// MAX_INTENT_ID_LENGTH (200, dayConstructorAcceptancePersistence.ts).
// Colons are confirmed safe: the real id parser
// (dayConstructorPreviewRequest.ts) validates only
// non-empty-after-trim + length, no charset restriction, and the
// existing idempotency-key encoding (deriveAcceptanceIdempotencyKey)
// is itself already length-prefixed specifically to tolerate colons
// inside an intentId.
// ============================================================

const GOAL_DEMAND_INTENT_ID_PREFIX = 'goal-demand';

export function encodeGoalDemandIntentId(planningLocalDate: string, goalActivityId: string): string {
  return `${GOAL_DEMAND_INTENT_ID_PREFIX}:${planningLocalDate}:${goalActivityId}`;
}

// ============================================================
// Input/output contracts (this ticket's own sections 3/4/14)
// ============================================================

export interface GoalPlanningSourceInput {
  /** A1's own output -- trusted verbatim for candidate discovery, never
   * reloaded/recomputed/re-queried here (this ticket's own section 3). */
  candidates: readonly GoalDemandCandidate[];
  /** The same server-established civil date every other layer in this
   * pipeline uses -- never Date.now(), never re-derived (this ticket's
   * own section 16). Also the second ingredient of intentId identity
   * (section 5/12). */
  planningLocalDate: string;
  /** GoalActivity ids already explicitly/manually seeded in this same
   * construction session (e.g. via the existing ?fromGoal=&activities=
   * handoff, or a typed row a user has already linked). Explicit/manual
   * demand always wins (this ticket's own section 6) -- any A1 candidate
   * sharing one of these ids is omitted from the output entirely. */
  manualGoalActivityIds: ReadonlySet<string> | readonly string[];
  /**
   * OPTIONAL. The total number of explicit/manual intents already present
   * in this same planning request (typed rows, Quick Picks, Captures,
   * manual Goal rows) -- NOT derivable from `manualGoalActivityIds` alone
   * (that set only names Goal-sourced manual rows, not the whole request
   * shape; this ticket's own section 14: never invent what cannot be
   * known at this boundary). Omit when the caller does not have this
   * figure -- every diagnostic that depends on it then reports as
   * `null`/unknown rather than a fabricated value.
   */
  explicitIntentCount?: number;
}

export interface GoalPlanningSourceDiagnostics {
  /** The number of automatic Goal intents this call actually emits --
   * after both duplicate-input collapsing (section 7) and explicit-demand
   * exclusion (section 6). Factual, never a selection signal. */
  candidateCount: number;
  /** From `input.explicitIntentCount`, or `null` when the caller did not
   * supply it (see that field's own doc comment). */
  explicitIntentCount: number | null;
  /** `candidateCount + explicitIntentCount`, or `null` when
   * `explicitIntentCount` is unknown. */
  combinedIntentCount: number | null;
  /** Whether `combinedIntentCount` would exceed the existing, real
   * MAX_INTENTS_PER_REQUEST transport ceiling (dayConstructorPreviewRequest.ts)
   * -- `null` when `combinedIntentCount` is unknown. This is a FACT for a
   * later, separately-authorized product decision to act on (this
   * ticket's own section 13/14) -- it never causes this function to drop,
   * truncate, rank, or select among candidates. */
  exceedsDownstreamIntentLimit: boolean | null;
  /** goalActivityIds that appeared more than once in `input.candidates`
   * and were collapsed to one emitted intent because every duplicate
   * record was byte-equivalent (section 7). Empty in the overwhelmingly
   * common case (A1 already returns unique GoalActivities). */
  duplicateGoalActivityIdsCollapsed: readonly string[];
}

export type GoalPlanningSourceResult =
  | { status: 'OK'; intents: readonly PreviewRequestIntentBody[]; goalActivityLinks: ReadonlyMap<string, string>; diagnostics: GoalPlanningSourceDiagnostics }
  | {
      /** This ticket's own section 7: conflicting duplicate A1 records
       * (same goalActivityId, DIFFERENT facts) are an invariant violation
       * A1 should never produce -- A2 never guesses which copy is
       * authoritative. Zero intents are emitted; the caller decides what
       * to do next (e.g. surface it, or drop the whole automatic-demand
       * batch for this request). */
      status: 'INVARIANT_VIOLATION';
      conflictingGoalActivityIds: readonly string[];
    };

// ============================================================
// Field mapping (this ticket's own sections 8/9/10) -- reuses the exact
// same unmodified-row defaults the manual handoff already uses for a
// freshly Goal-seeded row (createIntentRowFromGoalActivity /
// blankIntentRow, planDayEntry.ts): flexibility 'FLEXIBLE', every other
// optional field omitted. Nothing here is a new Goal-specific default --
// it is the SAME default an unedited manual Goal row already carries.
// `remainingThisWeek` is read only to populate the diagnostics count; it
// is NEVER written into any PreviewRequestIntentBody field (this
// ticket's own section 8: factual eligibility information is not
// Constructor scoring input).
// ============================================================

function toGenericIntent(candidate: GoalDemandCandidate, intentId: string): PreviewRequestIntentBody {
  return {
    id: intentId,
    title: candidate.title,
    flexibility: 'FLEXIBLE',
    ...(candidate.activityId !== null ? { activityId: candidate.activityId } : {}),
  };
}

/**
 * Pure (this ticket's own section 16): no DB read, no DB write, no
 * Date.now(), no random UUID, no network, no session lookup. Repeated
 * calls with identical input produce byte-identical output.
 */
export function buildGoalPlanningSourceIntents(input: GoalPlanningSourceInput): GoalPlanningSourceResult {
  // ----------------------------------------------------------
  // 1. Defensive de-duplication of the A1 INPUT itself (section 7).
  //    A1 is already proven to return unique GoalActivities, but this
  //    function never assumes its own input is well-formed. Byte-
  //    equivalent duplicates collapse deterministically (first
  //    occurrence in input order wins -- which copy is chosen is
  //    irrelevant precisely because they are byte-equivalent).
  //    Conflicting duplicates (same id, different facts) are reported,
  //    never guessed.
  // ----------------------------------------------------------
  const byId = new Map<string, GoalDemandCandidate>();
  const conflicting = new Set<string>();
  const collapsed: string[] = [];
  for (const candidate of input.candidates) {
    const existing = byId.get(candidate.goalActivityId);
    if (!existing) {
      byId.set(candidate.goalActivityId, candidate);
      continue;
    }
    if (isByteEquivalentCandidate(existing, candidate)) {
      collapsed.push(candidate.goalActivityId);
      continue;
    }
    conflicting.add(candidate.goalActivityId);
  }
  if (conflicting.size > 0) {
    return { status: 'INVARIANT_VIOLATION', conflictingGoalActivityIds: [...conflicting].sort() };
  }

  // ----------------------------------------------------------
  // 2. Explicit/manual demand wins (section 6) -- reuses A1's own pure
  //    set-difference helper verbatim, never a second dedup formula.
  //    Dedup key is ALWAYS goalActivityId -- never title/activityId/goalId
  //    (sections 6/7 explicit requirement).
  // ----------------------------------------------------------
  const deduped = [...byId.values()];
  // Preserve the original relative order from `input.candidates` (A1's
  // own stable, non-semantic ordering, section 15) -- Map insertion order
  // already matches first-occurrence order in `input.candidates`, so no
  // re-sort is applied here.
  const afterManualExclusion = excludeGoalDemandByActivityIds(deduped, input.manualGoalActivityIds);

  // ----------------------------------------------------------
  // 3. Generic intent + provenance mapping (sections 4/8/9/10).
  // ----------------------------------------------------------
  const intents: PreviewRequestIntentBody[] = [];
  const goalActivityLinks = new Map<string, string>();
  for (const candidate of afterManualExclusion) {
    const intentId = encodeGoalDemandIntentId(input.planningLocalDate, candidate.goalActivityId);
    intents.push(toGenericIntent(candidate, intentId));
    goalActivityLinks.set(intentId, candidate.goalActivityId);
  }

  // ----------------------------------------------------------
  // 4. Downstream-capacity diagnostics ONLY (section 13/14) -- never
  //    selection. No candidate above is ever removed because of this.
  // ----------------------------------------------------------
  const candidateCount = intents.length;
  const explicitIntentCount = input.explicitIntentCount ?? null;
  const combinedIntentCount = explicitIntentCount === null ? null : candidateCount + explicitIntentCount;
  const exceedsDownstreamIntentLimit = combinedIntentCount === null ? null : combinedIntentCount > MAX_INTENTS_PER_REQUEST;

  return {
    status: 'OK',
    intents,
    goalActivityLinks,
    diagnostics: {
      candidateCount,
      explicitIntentCount,
      combinedIntentCount,
      exceedsDownstreamIntentLimit,
      duplicateGoalActivityIdsCollapsed: [...new Set(collapsed)].sort(),
    },
  };
}

function isByteEquivalentCandidate(a: GoalDemandCandidate, b: GoalDemandCandidate): boolean {
  return a.goalActivityId === b.goalActivityId && a.goalId === b.goalId && a.goalTitle === b.goalTitle && a.title === b.title && a.activityId === b.activityId && a.remainingThisWeek === b.remainingThisWeek;
}
