import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { parseJsonObject } from '../../../../lib/request';
import { createRealDayConstructorOrchestratorDeps } from '../../../../lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../../../../lib/dayConstructorPreviewRequest';

/**
 * Day Constructor V1 PR F1 -- the sole read boundary exposing
 * `orchestrateConstructDay` (dayConstructorOrchestrator.ts) over HTTP.
 *
 * Pre-commit hardening: every security/context decision (session lookup,
 * user lookup, the authoritative clock, orchestrator-deps construction,
 * and the resulting try/catch) now lives in
 * `handleDayConstructorPreviewRequest` (dayConstructorPreviewRequest.ts),
 * a plain, framework-independent function -- this file is reduced to
 * exactly the residue that genuinely requires `next/server`: adapting a
 * real `NextRequest` into that function's five closures, and converting
 * its framework-neutral `{ httpStatus, body }` result into a
 * `NextResponse`. It makes no decision of its own.
 *
 * PREVIEW ONLY (this ticket's own section 2): never calls
 * `createPlannedActivity`, `saveUpcomingPlanFromCandidate`,
 * `POST /api/plans`, or the Day Constructor accept endpoint. No
 * user-facing entry point calls this route yet (PR F2's own, separate
 * scope).
 */
export async function POST(req: NextRequest) {
  const result = await handleDayConstructorPreviewRequest({
    getSession: () => getSessionFromRequest(req),
    getUser: (userId) => getUserById(userId),
    getBody: () => parseJsonObject(req),
    now: () => new Date(),
    createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
  });
  return NextResponse.json(result.body, { status: result.httpStatus });
}
