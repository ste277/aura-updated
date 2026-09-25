import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { createRealRecompositionDeps, handleRemainingDayRecompositionRequest } from '../../../../lib/remainingDayRecompositionServer';

/**
 * Remaining-Day Recomposition V1 PR F2 -- READ-ONLY proposal. A POST only because it represents a calculation;
 * it writes nothing and reads no request body (the server derives every candidate, protection and clock itself).
 * Acceptance/mutation is a separate, later, explicit write.
 */
export async function POST(req: NextRequest) {
  const result = await handleRemainingDayRecompositionRequest({
    getSession: () => getSessionFromRequest(req),
    getUser: (userId) => getUserById(userId),
    now: () => new Date(),
    createDeps: createRealRecompositionDeps,
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}
