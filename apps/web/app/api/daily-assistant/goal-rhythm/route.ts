import { NextRequest, NextResponse } from 'next/server';
import { SESSION_UNAVAILABLE, sessionUnavailableResponse, getSessionWithUserFromRequest } from '../../../../lib/session';
import { listPausedGoalRhythms, listNextGoalRhythmOccurrences } from '../../../../lib/db';
import { resolveRequestNow } from '../../../../lib/testTimeOverride';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { loadEligibleGoalDemand, createRealGoalDemandCandidatesDeps } from '../../../../lib/goalDemandCandidates';
import { resolveRhythmPlanningWeek } from '../../../../lib/goalActivityRhythmPreferences';
import type { GoalRhythmHomeResponse, GoalRhythmNextOccurrence } from '../../../../lib/homeGoalRhythmSuggestions';

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
  const session = await getSessionWithUserFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = session.user;
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const now = resolveRequestNow(req);
  const planningLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;
  const deps = createRealGoalDemandCandidatesDeps();
  const result = await loadEligibleGoalDemand(deps, user.id, planningLocalDate, user.timezone);
  if (result.status !== 'OK') return NextResponse.json(result);

  // AURA-MR2 -- additive Home context. `candidates` above keeps its exact
  // pre-MR2 meaning. Each extra is best-effort: a failure degrades to "not
  // shown", never to an error for the whole card.
  const nextWeek = resolveRhythmPlanningWeek(planningLocalDate, 'NEXT');
  const nextWeekResult = await loadEligibleGoalDemand(deps, user.id, nextWeek.planningLocalDate, user.timezone);
  const nextWeekCandidates = nextWeekResult.status === 'OK' ? nextWeekResult.candidates : [];
  const pausedRows = await listPausedGoalRhythms(user.id).catch(() => []);
  const ids = [...new Set([...result.candidates, ...nextWeekCandidates].map((c) => c.goalActivityId).concat(pausedRows.map((r) => r.goalActivityId)))];
  const occurrenceRows = await listNextGoalRhythmOccurrences(user.id, ids, now).catch(() => []);
  const nextOccurrenceByGoalActivityId: Record<string, GoalRhythmNextOccurrence> = {};
  for (const row of occurrenceRows) {
    nextOccurrenceByGoalActivityId[row.goalActivityId] = { plannedActivityId: row.plannedActivityId, start: new Date(row.plannedStartAt).toISOString(), end: new Date(row.plannedEndAt).toISOString() };
  }

  const body: GoalRhythmHomeResponse = {
    ...result,
    planningLocalDate,
    nextWeekCandidates,
    nextOccurrenceByGoalActivityId,
    pausedRhythms: pausedRows.map((row) => ({
      goalActivityId: row.goalActivityId,
      goalId: row.goalId,
      title: row.title,
      targetPerWeek: row.rhythmTargetPerWeek,
      ...(nextOccurrenceByGoalActivityId[row.goalActivityId] ? { nextOccurrence: nextOccurrenceByGoalActivityId[row.goalActivityId] } : {}),
    })),
  };
  return NextResponse.json(body);
}
