import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, sessionUnavailableResponse, SESSION_UNAVAILABLE } from '../../../../lib/session';
import { getUserById, loadGoalContextsForPlanIds } from '../../../../lib/db';
import { createRealRecompositionDeps, handleRemainingDayRecompositionRequest } from '../../../../lib/remainingDayRecompositionServer';

/**
 * Remaining-Day Recomposition V1 PR F2 -- READ-ONLY proposal. A POST only because it represents a calculation;
 * it writes nothing and reads no request body (the server derives every candidate, protection and clock itself).
 * Acceptance/mutation is a separate, later, explicit write.
 *
 * Goals V2 G3.5 -- loadGoalContexts wires the real, G3.1-batched loader so the response carries Goal identity for
 * a Goal-linked decision (see remainingDayRecompositionServer.ts's own header). Purely additive presentation.
 */
export async function POST(req: NextRequest) {
  // AURA-AUTH-SESSION-01-I2 (E5): the session is verified once, here, against
  // the database; the injected seam only hands that result on (null = 401).
  const session = await getSessionFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  const result = await handleRemainingDayRecompositionRequest({
    getSession: () => session,
    getUser: (userId) => getUserById(userId),
    now: () => new Date(),
    createDeps: createRealRecompositionDeps,
    loadGoalContexts: (userId, planIds) => loadGoalContextsForPlanIds(userId, planIds),
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}
