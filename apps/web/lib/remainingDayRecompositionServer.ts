/**
 * Remaining-Day Recomposition V1 PR F2 -- the server wiring around the pure service (remainingDayRecomposition.ts):
 * real read-only dependencies and the framework-independent request handler behind POST /api/day/recompose.
 *
 * READ-ONLY end to end: it only reads (`listPlannedActivitiesOverlappingRange`, `listPlanIdsWithActiveMoment`, the same
 * duration / availability / timing reads the Day Constructor already uses) and never writes. The client supplies
 * NOTHING that matters -- no plan list, no protection flags, no scheduling mode, no clock, no timezone: the server
 * derives all of it from the authenticated session, the stored user and PlannedActivity, and reads its own clock
 * once. (Despite being a POST, the request represents a calculation, not a change.)
 *
 * Goals V2 G3.5 -- this is the module's OWN presentation/read-enrichment boundary (this ticket's own preferred
 * architecture: decision, then enrichment, then card). recomposeRemainingDay (remainingDayRecomposition.ts) stays
 * entirely Goal-unaware; AFTER it has already decided everything, this module OPTIONALLY attaches Goal identity
 * (goal id/title only -- never execution internals) to the JSON response, reusing G3.1's exact batched loader
 * (loadGoalContextsForPlanIds) keyed on each decision's OWN planId -- the currently-persisted, canonically
 * Goal-linked source plan (a MOVE's hypothetical successor does not exist as a row yet, so there is nothing else
 * to key from; see this ticket's own section 5 audit). Enrichment is applied to the RESPONSE body only, never to
 * what signRecompositionProposal signs (below) -- Goal data can therefore never affect stale-proposal/acceptance
 * validation, which reads only the signed token's own explicit fields.
 */
import { listPlannedActivitiesOverlappingRange, listPlanIdsWithActiveMoment, type User, type PlanGoalContext } from './db';
import { createRealDayConstructorOrchestratorDeps } from './dayConstructorOrchestrator';
import { resolveTzOffsetMinutes } from './timezone';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { runTimingSearch, type TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import { signRecompositionProposal } from './remainingDayRecompositionIntegrity';
import { recomposeRemainingDay, type RecompositionDecision, type RecompositionDeps, type RemainingDayRecompositionResult } from './remainingDayRecomposition';

export function createRealRecompositionDeps(user: User, now: Date): RecompositionDeps {
  const base = createRealDayConstructorOrchestratorDeps(user, now);
  return {
    loadDurationContext: base.loadDurationContext,
    searchTiming: base.searchTiming,
    loadAvailabilityConfiguration: base.loadAvailabilityConfiguration,
    // Schedule write consistency S4 -- the proposal's plans AND blockers are every non-cancelled plan whose interval OVERLAPS
    // the target civil day [from, to), whichever day it started on (canonical half-open loader, one query per run). The old
    // start-scoped `listPlannedActivitiesForDay` never reached a plan that began before the day and was still running into it.
    loadPlansForDay: (bounds) => listPlannedActivitiesOverlappingRange(user.id, bounds.from, bounds.to),
    loadPlanIdsWithActiveMoment: (planIds, at) => listPlanIdsWithActiveMoment(planIds, at),
    // The same CHECK the acceptance path uses (activityId when known, else the title).
    checkTiming: (request) => {
      const context: TimingSearchRequest['context'] = {
        now,
        latitude: user.latitude,
        longitude: user.longitude,
        timezone: user.timezone,
        tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
        personalContext: buildPersonalMuhurtaContextForUser(user),
      };
      const searchRequest: TimingSearchRequest = request.activityId
        ? { mode: 'CHECK', activityId: request.activityId, durationMinutes: request.durationMinutes, candidateStart: request.candidateStart.toISOString(), context }
        : { mode: 'CHECK', taskTitle: request.taskTitle, durationMinutes: request.durationMinutes, candidateStart: request.candidateStart.toISOString(), context };
      const response = runTimingSearch(searchRequest);
      if (!response.requestedCandidate) throw new Error('CHECK did not return a requestedCandidate.');
      return response.requestedCandidate;
    },
  };
}

export interface RecompositionHttpResult {
  httpStatus: number;
  body: Record<string, unknown>;
}

export interface RecompositionBoundaryDeps {
  getSession: () => { userId: string } | null;
  getUser: (userId: string) => Promise<User | null>;
  now: () => Date;
  createDeps: (user: User, now: Date) => RecompositionDeps;
  /** Test seam: defaults to the real service. */
  recompose?: typeof recomposeRemainingDay;
  /**
   * Goals V2 G3.5 -- OPTIONAL presentation-only enrichment (this module's own header). Reuses G3.1's exact batched
   * loader shape (userId, planIds) -- never a second Goal-lookup implementation, never one query per decision.
   * Omitted (as every pre-G3.5 caller/test still does) means NO enrichment: the response is byte-identical to
   * G3.4's, never a broken/partial Goal line. The real production route (below) always supplies the real loader.
   */
  loadGoalContexts?: (userId: string, planIds: readonly string[]) => Promise<Map<string, PlanGoalContext>>;
}

/**
 * Goals V2 G3.5 -- attaches `goalContext: { goal: { id, title } }` to a decision whose OWN planId is
 * Goal-linked, on a plain COPY of the decisions array (never mutates the original, which
 * signRecompositionProposal below still reads). Never carries execution id/source/snapshot/currentValue -- see
 * PlanGoalContext's own doc comment (db.ts) for why the loader itself already excludes them.
 */
async function enrichDecisionsWithGoalContext(
  loadGoalContexts: NonNullable<RecompositionBoundaryDeps['loadGoalContexts']>,
  userId: string,
  decisions: readonly RecompositionDecision[]
): Promise<Array<RecompositionDecision & { goalContext?: { goal: { id: string; title: string } } }>> {
  const planIds = decisions.map((d) => d.planId);
  const contexts = await loadGoalContexts(userId, planIds);
  return decisions.map((d) => {
    const ctx = contexts.get(d.planId);
    return ctx ? { ...d, goalContext: { goal: { id: ctx.goal.id, title: ctx.goal.title } } } : d;
  });
}

/** auth -> user -> clock (once) -> service. The request body is intentionally never read. */
export async function handleRemainingDayRecompositionRequest(deps: RecompositionBoundaryDeps): Promise<RecompositionHttpResult> {
  const session = deps.getSession();
  if (!session) return { httpStatus: 401, body: { error: 'Not authenticated.' } };
  const user = await deps.getUser(session.userId);
  if (!user) return { httpStatus: 404, body: { error: 'User not found.' } };
  const now = deps.now();
  try {
    const result: RemainingDayRecompositionResult = await (deps.recompose ?? recomposeRemainingDay)({ timezone: user.timezone, now }, deps.createDeps(user, now));
    // F3: only a CHANGES_PROPOSED proposal carries a signed acceptance token (nothing else is ever committable). Signing
    // reads the final, UNENRICHED `result.proposal` only -- no persistence, and this is otherwise byte-identical to
    // G3.4's own response. Goal-context enrichment (G3.5) is computed separately, below, and only ever reaches the
    // JSON response body -- never the signed payload.
    const proposalToken = result.status === 'READY' ? signRecompositionProposal(user.id, result.proposal) : null;
    const body: Record<string, unknown> = { ...(result as unknown as Record<string, unknown>) };
    if (result.status === 'READY' && deps.loadGoalContexts) {
      body.proposal = { ...result.proposal, decisions: await enrichDecisionsWithGoalContext(deps.loadGoalContexts, user.id, result.proposal.decisions) };
    }
    if (proposalToken) body.proposalToken = proposalToken;
    return { httpStatus: 200, body };
  } catch (err) {
    console.error('day/recompose: unexpected failure', err);
    return { httpStatus: 500, body: { error: 'Something went wrong reviewing your day.' } };
  }
}
