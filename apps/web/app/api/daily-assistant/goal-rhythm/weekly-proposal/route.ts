import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../lib/session';
import { getUserById } from '../../../../../lib/db';
import { parseJsonObject } from '../../../../../lib/request';
import { resolveRequestNow } from '../../../../../lib/testTimeOverride';
import { getDatePartsInTimezone, resolveTzOffsetMinutes } from '../../../../../lib/timezone';
import { buildPersonalMuhurtaContextForUser } from '../../../../../lib/natalContext';
import { runTimingSearchWithDailyRhythm } from '../../../../../lib/timingSearchDailyRhythm';
import { createRealGoalDemandCandidatesDeps } from '../../../../../lib/goalDemandCandidates';
import { generateWeeklyRhythmProposal, type WeeklyRhythmProposalDeps } from '../../../../../lib/goalRhythmWeeklyProposal';
import type { DailyRhythmPreferencesInput } from '../../../../../lib/dailyRhythmScheduling';
import { DailyAssistantContext } from '../../../../../../../packages/recommendation/src/dailyAssistant';

const MAX_GOAL_ACTIVITY_ID_LENGTH = 100;

/**
 * HGR3-A -- POST /api/daily-assistant/goal-rhythm/weekly-proposal.
 *
 * Nested under the existing goal-rhythm route family (matches HGR1's own
 * `/api/daily-assistant/goal-rhythm` GET convention). Pure wiring: every
 * real decision (eligibility, duration, week bounds, multi-day search,
 * distinct-day selection, the non-committable contract) lives in
 * goalRhythmWeeklyProposal.ts, reused verbatim. This route never writes
 * anything and never signs anything -- see that module's own doc comment
 * for why a signed, acceptance-compatible token cannot safely exist here
 * yet.
 *
 * `goalActivityId` identifies an existing GoalActivity; the client never
 * supplies its title/target/duration -- all are looked up server-side by
 * `generateWeeklyRhythmProposal`, scoped to `session.userId`, never trusted
 * from the request body.
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

  const now = resolveRequestNow(req);
  const planningLocalDate = getDatePartsInTimezone(user.timezone, now).dateStr;
  const context: DailyAssistantContext = {
    now,
    latitude: user.latitude,
    longitude: user.longitude,
    timezone: user.timezone,
    tzOffsetMinutes: resolveTzOffsetMinutes(user.timezone, now),
    personalContext: buildPersonalMuhurtaContextForUser(user),
  };
  const dailyRhythmPrefs: DailyRhythmPreferencesInput = {
    workStart: user.dailyRhythmWorkStart ?? null,
    workEnd: user.dailyRhythmWorkEnd ?? null,
    workDays: user.dailyRhythmWorkDays ?? [],
  };

  const deps: WeeklyRhythmProposalDeps = {
    ...createRealGoalDemandCandidatesDeps(),
    runFind: runTimingSearchWithDailyRhythm,
  };

  const result = await generateWeeklyRhythmProposal(deps, {
    userId: session.userId,
    goalActivityId,
    planningLocalDate,
    timezone: user.timezone,
    context,
    dailyRhythmPrefs,
  });

  if (result.status === 'SEARCH_FAILED') return NextResponse.json(result, { status: 500 });
  return NextResponse.json(result);
}
