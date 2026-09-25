/**
 * Remaining-Day Recomposition V1 PR F2 -- the server wiring around the pure service (remainingDayRecomposition.ts):
 * real read-only dependencies and the framework-independent request handler behind POST /api/day/recompose.
 *
 * READ-ONLY end to end: it only reads (`listPlannedActivitiesForDay`, `listPlanIdsWithActiveMoment`, the same
 * duration / availability / timing reads the Day Constructor already uses) and never writes. The client supplies
 * NOTHING that matters -- no plan list, no protection flags, no scheduling mode, no clock, no timezone: the server
 * derives all of it from the authenticated session, the stored user and PlannedActivity, and reads its own clock
 * once. (Despite being a POST, the request represents a calculation, not a change.)
 */
import { listPlannedActivitiesForDay, listPlanIdsWithActiveMoment, type User } from './db';
import { createRealDayConstructorOrchestratorDeps } from './dayConstructorOrchestrator';
import { resolveTzOffsetMinutes } from './timezone';
import { buildPersonalMuhurtaContextForUser } from './natalContext';
import { runTimingSearch, type TimingSearchRequest } from '../../../packages/recommendation/src/timingSearch';
import { recomposeRemainingDay, type RecompositionDeps, type RemainingDayRecompositionResult } from './remainingDayRecomposition';

export function createRealRecompositionDeps(user: User, now: Date): RecompositionDeps {
  const base = createRealDayConstructorOrchestratorDeps(user, now);
  return {
    loadDurationContext: base.loadDurationContext,
    searchTiming: base.searchTiming,
    loadAvailabilityConfiguration: base.loadAvailabilityConfiguration,
    loadPlansForDay: (bounds) => listPlannedActivitiesForDay(user.id, bounds.from, bounds.to),
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
    return { httpStatus: 200, body: result as unknown as Record<string, unknown> };
  } catch (err) {
    console.error('day/recompose: unexpected failure', err);
    return { httpStatus: 500, body: { error: 'Something went wrong reviewing your day.' } };
  }
}
