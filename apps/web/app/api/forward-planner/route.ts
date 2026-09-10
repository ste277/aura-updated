import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../lib/session';
import { getUserById } from '../../../lib/db';
import { parseJsonObject } from '../../../lib/request';
import { resolveRequestNow } from '../../../lib/testTimeOverride';
import { buildForwardPlannerRequest, buildForwardPlannerResult } from '../../../lib/forwardPlannerOrchestrator';

/**
 * Forward Planner V1 -- POST /api/forward-planner.
 *
 * A dedicated top-level route (matching /api/timing-search and
 * /api/muhurtham-search's own precedent of a dedicated route per distinct
 * search domain, rather than nesting under /api/daily-assistant -- this is
 * a different domain contract from that family's existing routes).
 *
 * Auth follows the identical pattern used across every session-scoped
 * route in this app: getSessionFromRequest (never a client-supplied user
 * id) + getUserById. `now` is captured once via resolveRequestNow(req) and
 * threaded down explicitly -- it is used ONLY for range resolution
 * (tomorrow/weekend/past-date rejection), never as a future-date
 * personalization evaluation time (see forwardPlannerOrchestrator.ts's own
 * module doc comment).
 *
 * Expected outcomes (all HTTP 200, mirroring the existing
 * MuhurthamProfileIncomplete / PersonalDailyGuidanceResult convention):
 * status: 'READY' | 'NO_SUITABLE_WINDOW' | 'BIRTH_PROFILE_REQUIRED'.
 * A malformed request is a real 400, never disguised as one of those
 * three expected states; a genuine unexpected failure remains a real
 * error response, never silently converted into NO_SUITABLE_WINDOW.
 */
export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });

  const now = resolveRequestNow(req);
  const validation = buildForwardPlannerRequest(body, now, user.timezone);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: validation.status });

  const result = await buildForwardPlannerResult(user, now, validation.request);
  return NextResponse.json(result);
}
