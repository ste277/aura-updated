import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../lib/session';
import { getUserById } from '../../../../lib/db';
import { resolveRequestNow } from '../../../../lib/testTimeOverride';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../../../../lib/goalDemandCandidates';

/**
 * HGR1 -- GET /api/daily-assistant/goal-rhythm.
 *
 * Nested under the existing daily-assistant route family, matching
 * `/api/daily-assistant/guidance`'s own established convention. Pure
 * wiring only: no business logic lives here. `loadEligibleGoalDemand`
 * (goalDemandCandidates.ts) is called VERBATIM -- the exact same read
 * model `/plan-day`'s server-side bootstrap (`resolveAutomaticGoalDemand`,
 * planDayBootstrap.ts) already calls, so Home and Plan My Day can never
 * disagree about eligibility: there is only one call site of the
 * eligibility formula, reached two different ways.
 *
 * Read-only: `loadEligibleGoalDemand`'s own two dependencies
 * (`loadCandidateGoalActivities`, `loadRhythmFacts`) are both read
 * queries; this route performs no write of any kind merely by being
 * requested, matching the identical "loading Home never writes" guarantee
 * every other Home data fetch in this app already holds.
 */
export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = resolveRequestNow(req);
  const planningLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;
  const result = await loadEligibleGoalDemand(createRealGoalDemandCandidatesDeps(), user.id, planningLocalDate, user.timezone);

  return NextResponse.json(result);
}
