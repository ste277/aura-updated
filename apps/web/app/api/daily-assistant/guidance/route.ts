import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveRequestNow } from '../../../../lib/testTimeOverride';
import { buildPersonalDailyGuidance } from '../../../../lib/dailyGuidanceOrchestrator';

/**
 * Personal Guidance Orchestration V1 -- GET /api/daily-assistant/guidance.
 *
 * Nested under the existing daily-assistant route family (matching this
 * repo's own established convention -- every comparable feature nests
 * under a flat top-level family; a bare new top-level /api/daily-guidance
 * would be an outlier), as a dedicated sub-route rather than extending
 * /api/daily-assistant/briefing -- Daily Guidance is a separate domain
 * contract from that already-stable, unrelated one.
 *
 * Auth follows the identical pattern used across this route family:
 * getSessionFromRequest (never a client-supplied user id) + getUserById.
 * `now` is captured once via resolveRequestNow(req) and threaded down
 * explicitly -- no nested Date.now()/new Date() anywhere in the
 * orchestrator this calls.
 *
 * Expected outcomes (all HTTP 200, mirroring the existing
 * MuhurthamProfileIncomplete convention -- an incomplete profile or an
 * empty intent set are valid, expected outcomes, never an error status):
 * status: 'READY' | 'BIRTH_PROFILE_REQUIRED' | 'NO_ACTIVITY_INTENT'.
 * A genuine unexpected failure remains a real error response, never
 * disguised as one of those three expected states.
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = resolveRequestNow(req);
  const result = await buildPersonalDailyGuidance(user, now);

  return NextResponse.json(result);
}
