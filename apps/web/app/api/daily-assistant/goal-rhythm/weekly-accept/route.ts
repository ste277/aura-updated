import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getUserById, listUserAvailabilityPeriods } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { resolveRequestNow } from '../../../../../lib/testTimeOverride';
import { getDatePartsInTimezone } from '../../../../../lib/timezone';
import { createRealDayConstructorOrchestratorDeps } from '../../../../../lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../../../../../lib/dayConstructorPreviewRequest';
import { persistAcceptedConstructedDay } from '../../../../../lib/dayConstructorAcceptancePersistence';
import { getPlanCreationClaim, getPlannedActivityForOwner } from '../../../../../lib/db';
import { createRealGoalDemandCandidatesDeps } from '../../../../../lib/goalDemandCandidates';
import type { AvailabilityConfiguration } from '../../../../../lib/availabilityContext';
import { isValidCalendarDateString } from '../../../../../../../packages/panchang/src/localDate';
import {
  acceptWeeklyRhythmSessions,
  MAX_WEEKLY_ACCEPTANCE_SESSIONS,
  type WeeklyAcceptanceDeps,
  type WeeklyAcceptanceSelection,
} from '../../../../../lib/goalRhythmWeeklyAcceptance';

const MAX_GOAL_ACTIVITY_ID_LENGTH = 100;
const MAX_ISO_INSTANT_LENGTH = 40;

/**
 * HGR3-B / HGR3-BH -- POST /api/daily-assistant/goal-rhythm/weekly-accept.
 *
 * The explicit "Accept all" action: the ONLY write boundary this feature
 * introduces. Nested under the existing goal-rhythm route family (matches
 * HGR1/HGR3-A's own convention). Pure wiring -- every real decision
 * (input validation, retry reconciliation, Availability Context
 * enforcement, fresh eligibility revalidation, EXPLICIT_RANGE
 * construction pinned to the approved exact time, the verify -> authorize
 * -> persist acceptance sequence, partial-success reporting) lives in
 * goalRhythmWeeklyAcceptance.ts, reused verbatim.
 *
 * HGR3-BH -- `sessions` now carries each session's own approved `start`/
 * `end` (the exact instant HGR3-A proposed and the user reviewed), not
 * merely a bare date: see goalRhythmWeeklyAcceptance.ts's own "EXACT-TIME
 * PRESERVATION" header section for why a specific time is committed
 * exactly or the session fails closed, never silently re-placed.
 * `goalActivityId`/`sessions` identify EXISTING GoalActivity sessions the
 * user is confirming; nothing about eligibility, remaining count, or
 * ranking is ever read from the request body -- all of it is
 * recomputed/re-derived server-side, scoped to `session.userId`, exactly
 * like HGR3-A's own route. The approved time itself IS read from the
 * request (it must be -- that is the whole point of this hardening), but
 * is never trusted as already schedulable: it is re-validated, re-signed
 * and re-verified through the real pipeline before anything is persisted.
 *
 * No write occurs anywhere in this codebase merely from generating or
 * displaying a weekly proposal (goalRhythmWeeklyProposal.ts stays
 * strictly read-only, unmodified by this PR) -- this endpoint, reached
 * only by an explicit user confirmation, is the sole place a session from
 * that proposal becomes a real commitment.
 */
export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = await getUserById(session.userId);
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  const body = await parseJsonObject(req);
  if (!body) return NextResponse.json({ error: 'A valid JSON request body is required.' }, { status: 400 });

  const goalActivityId = body.goalActivityId;
  if (typeof goalActivityId !== 'string' || !goalActivityId || goalActivityId.length > MAX_GOAL_ACTIVITY_ID_LENGTH) {
    return NextResponse.json({ error: 'A valid goalActivityId is required.' }, { status: 400 });
  }

  if (!Array.isArray(body.sessions) || body.sessions.length === 0 || body.sessions.length > MAX_WEEKLY_ACCEPTANCE_SESSIONS) {
    return NextResponse.json({ error: `sessions must be a non-empty array of at most ${MAX_WEEKLY_ACCEPTANCE_SESSIONS} entries.` }, { status: 400 });
  }
  const selections: WeeklyAcceptanceSelection[] = [];
  for (const raw of body.sessions) {
    if (!raw || typeof raw !== 'object') {
      return NextResponse.json({ error: 'Every entry in sessions must be an object with localDate, start and end.' }, { status: 400 });
    }
    const { localDate, start, end } = raw as Record<string, unknown>;
    if (typeof localDate !== 'string' || !isValidCalendarDateString(localDate)) {
      return NextResponse.json({ error: 'Every session.localDate must be a valid YYYY-MM-DD calendar date.' }, { status: 400 });
    }
    if (typeof start !== 'string' || !start || start.length > MAX_ISO_INSTANT_LENGTH || typeof end !== 'string' || !end || end.length > MAX_ISO_INSTANT_LENGTH) {
      return NextResponse.json({ error: 'Every session.start/end must be a real ISO 8601 date-time string.' }, { status: 400 });
    }
    selections.push({ goalActivityId, localDate, start, end });
  }
  if (new Set(selections.map((s) => `${s.localDate}|${s.start}|${s.end}`)).size !== selections.length) {
    return NextResponse.json({ error: 'sessions must not contain duplicate (localDate, start, end) entries.' }, { status: 400 });
  }

  const now = resolveRequestNow(req);
  const planningLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;

  const deps: WeeklyAcceptanceDeps = {
    ...createRealGoalDemandCandidatesDeps(),
    user,
    now: () => now,
    runPreview: handleDayConstructorPreviewRequest,
    persist: persistAcceptedConstructedDay,
    getPlanCreationClaim,
    getPlannedActivityForOwner,
    loadAvailabilityConfiguration: async () => {
      const periods = await listUserAvailabilityPeriods(user.id);
      return {
        configured: user.availabilityConfigured === true,
        periods: periods.map((row) => ({ weekday: row.weekday as AvailabilityConfiguration['periods'][number]['weekday'], startTime: row.startTime, endTime: row.endTime })),
      };
    },
    createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    // Deliberately no shadowPolicy, loadSchedulingContext or
    // loadDecisionFactsFromContext: all three are optional, presentation-
    // only enrichments the real multi-intent preview route adds for its
    // own review screen, never something placement/capacity/duration
    // correctness depends on -- see goalRhythmWeeklyAcceptance.ts's own
    // comment on WeeklyAcceptanceDeps for why this adapter has no real
    // use for any of them, and why extending either guard's allowlist
    // would be the wrong fix.
  };

  const summary = await acceptWeeklyRhythmSessions(deps, session.userId, planningLocalDate, selections);
  return NextResponse.json({
    requestedCount: summary.requestedCount,
    acceptedCount: summary.acceptedCount,
    alreadyAcceptedCount: summary.alreadyAcceptedCount,
    failedCount: summary.failedCount,
    sessions: summary.sessions,
    remainingThisWeek: summary.remainingThisWeekByGoalActivityId.get(goalActivityId) ?? null,
  });
}
