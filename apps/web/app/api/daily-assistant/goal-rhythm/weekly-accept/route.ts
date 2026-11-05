import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getUserById, listUserAvailabilityPeriods } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { resolveRequestNow } from '../../../../../lib/testTimeOverride';
import { getDatePartsInTimezone } from '../../../../../lib/timezone';
import { createRealDayConstructorOrchestratorDeps } from '../../../../../lib/dayConstructorOrchestrator';
import { handleDayConstructorPreviewRequest } from '../../../../../lib/dayConstructorPreviewRequest';
import { persistAcceptedConstructedDay } from '../../../../../lib/dayConstructorAcceptancePersistence';
import { getPlanCreationClaim, getPlannedActivityForOwner, findPlanCreationClaimsByPrefix, claimPlanCreation } from '../../../../../lib/db';
import { createRealGoalDemandCandidatesDeps } from '../../../../../lib/goalDemandCandidates';
import type { AvailabilityConfiguration } from '../../../../../lib/availabilityContext';
import { isValidCalendarDateString } from '../../../../../../../packages/panchang/src/localDate';
import {
  acceptWeeklyRhythmSessions,
  MAX_WEEKLY_ACCEPTANCE_SESSIONS,
  MAX_ACCEPTANCE_ID_LENGTH,
  type WeeklyAcceptanceDeps,
  type WeeklyAcceptanceSelection,
} from '../../../../../lib/goalRhythmWeeklyAcceptance';

const MAX_GOAL_ACTIVITY_ID_LENGTH = 100;
const MAX_ISO_INSTANT_LENGTH = 40;

/**
 * HGR3-B / HGR3-BH / HGR3-C1 -- POST /api/daily-assistant/goal-rhythm/weekly-accept.
 *
 * The explicit "Accept all" action: the ONLY write boundary this feature
 * introduces. Nested under the existing goal-rhythm route family (matches
 * HGR1/HGR3-A's own convention). Pure wiring -- every real decision
 * (input validation, retry reconciliation, Availability Context
 * enforcement, fresh eligibility revalidation, EXPLICIT_RANGE
 * construction pinned to the approved exact time, the verify -> authorize
 * -> persist acceptance sequence, partial-success reporting,
 * payload-binding conflict detection) lives in
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
 * HGR3-C1 -- `acceptanceId` is a new, REQUIRED, client-generated string
 * (no existing caller to stay compatible with: this endpoint has zero
 * production callers today, per the HGR3-C0 audit's own finding, so a
 * required field is the smallest honest contract rather than an
 * optional one silently falling back to the old, content-only identity).
 * The caller mints ONE value per explicit "Accept all" press, reusing it
 * for retries/double-clicks/timeouts of that SAME press, minting a FRESH
 * one for a later, separate confirmation -- including a deliberate
 * re-booking of a slot the user previously cancelled. See
 * goalRhythmWeeklyAcceptance.ts's own "HGR3-C1 -- FRESH ACCEPTANCE
 * IDENTITY" header section for the full design and why a client-
 * generated id weakens nothing (ownership/capacity/availability/signing
 * are all independently re-verified downstream regardless of what
 * identity string reaches them).
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

  // HGR3-C1 -- a REQUIRED, client-generated identity for this one explicit
  // confirmation. See this route's own header comment and
  // goalRhythmWeeklyAcceptance.ts's "HGR3-C1" section for why this is
  // required (no existing caller to preserve compatibility with) and why
  // a client-supplied string needs no signature verification here --
  // ownership is scoped by session.userId, never by this string.
  const acceptanceId = body.acceptanceId;
  if (typeof acceptanceId !== 'string' || !acceptanceId.trim() || acceptanceId.length > MAX_ACCEPTANCE_ID_LENGTH) {
    return NextResponse.json({ error: `A valid acceptanceId (1-${MAX_ACCEPTANCE_ID_LENGTH} characters) is required.` }, { status: 400 });
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
    findPlanCreationClaimsByPrefix,
    claimPlanCreation,
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

  const summary = await acceptWeeklyRhythmSessions(deps, session.userId, acceptanceId.trim(), planningLocalDate, selections);
  return NextResponse.json({
    requestedCount: summary.requestedCount,
    acceptedCount: summary.acceptedCount,
    alreadyAcceptedCount: summary.alreadyAcceptedCount,
    failedCount: summary.failedCount,
    sessions: summary.sessions,
    remainingThisWeek: summary.remainingThisWeekByGoalActivityId.get(goalActivityId) ?? null,
  });
}
