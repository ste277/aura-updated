import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getUserById } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { resolveRequestNow } from '../../../../../lib/testTimeOverride';
import { getDatePartsInTimezone } from '../../../../../lib/timezone';
import { createRealDayConstructorOrchestratorDeps } from '../../../../../lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../../../../../lib/dayConstructorPreviewRequest';
import { loadGoalDecisionFacts, createGoalDemandDepsFromSchedulingContext } from '../../../../../lib/goalDecisionFactsProvider';
import { loadDecisionSchedulingContext } from '../../../../../lib/decisionSchedulingContextLoader';
import { createServerShadowPolicyExecution } from '../../../../../lib/shadowPolicyExecution';
import { persistAcceptedConstructedDay } from '../../../../../lib/dayConstructorAcceptancePersistence';
import { createRealGoalDemandCandidatesDeps } from '../../../../../lib/goalDemandCandidates';
import { isValidCalendarDateString } from '../../../../../../../packages/panchang/src/localDate';
import {
  acceptWeeklyRhythmSessions,
  MAX_WEEKLY_ACCEPTANCE_SESSIONS,
  type WeeklyAcceptanceDeps,
  type WeeklyAcceptanceSelection,
} from '../../../../../lib/goalRhythmWeeklyAcceptance';

const MAX_GOAL_ACTIVITY_ID_LENGTH = 100;

/**
 * HGR3-B -- POST /api/daily-assistant/goal-rhythm/weekly-accept.
 *
 * The explicit "Accept all" action: the ONLY write boundary this feature
 * introduces. Nested under the existing goal-rhythm route family (matches
 * HGR1/HGR3-A's own convention). Pure wiring -- every real decision
 * (fresh eligibility revalidation, EXPLICIT_RANGE construction, the
 * verify -> authorize -> persist acceptance sequence, partial-success
 * reporting) lives in goalRhythmWeeklyAcceptance.ts, reused verbatim.
 *
 * `goalActivityId`/`localDates` identify EXISTING GoalActivity sessions
 * the user is confirming; nothing about eligibility, remaining count,
 * ranking, or a specific clock time is ever read from the request body --
 * all of it is recomputed/re-derived server-side, scoped to
 * `session.userId`, exactly like HGR3-A's own route.
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

  if (!Array.isArray(body.localDates) || body.localDates.length === 0 || body.localDates.length > MAX_WEEKLY_ACCEPTANCE_SESSIONS) {
    return NextResponse.json({ error: `localDates must be a non-empty array of at most ${MAX_WEEKLY_ACCEPTANCE_SESSIONS} YYYY-MM-DD dates.` }, { status: 400 });
  }
  const localDates: string[] = [];
  for (const raw of body.localDates) {
    if (typeof raw !== 'string' || !isValidCalendarDateString(raw)) {
      return NextResponse.json({ error: 'Every entry in localDates must be a valid YYYY-MM-DD calendar date.' }, { status: 400 });
    }
    localDates.push(raw);
  }
  if (new Set(localDates).size !== localDates.length) {
    return NextResponse.json({ error: 'localDates must not contain duplicate dates.' }, { status: 400 });
  }

  const now = resolveRequestNow(req);
  const planningLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;

  const selections: WeeklyAcceptanceSelection[] = localDates.map((localDate) => ({ goalActivityId, localDate }));

  const deps: WeeklyAcceptanceDeps = {
    ...createRealGoalDemandCandidatesDeps(),
    user,
    now: () => now,
    runPreview: handleDayConstructorPreviewRequest,
    persist: persistAcceptedConstructedDay,
    createOrchestratorDeps: createRealDayConstructorOrchestratorDeps,
    // O5 P2d -- the SAME coherent, one-snapshot scheduling-context wiring
    // the real Day Constructor preview route uses (dayConstructorOrchestrator.ts's
    // own established production convention) -- never a second, independent
    // Goal-decision-facts provider.
    loadSchedulingContext: (u, request) => loadDecisionSchedulingContext({ userId: u.id, planningDate: request.targetDate, timezone: request.timezone }),
    loadDecisionFactsFromContext: (u, request, context) => loadGoalDecisionFacts(u, request, createGoalDemandDepsFromSchedulingContext(context)),
    shadowPolicy: createServerShadowPolicyExecution,
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
