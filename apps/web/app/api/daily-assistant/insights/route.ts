import { NextRequest, NextResponse } from 'next/server';
import { listDailyReflections, listHabitLogsForInsights, INSIGHTS_HISTORY_DAYS } from '../../../../lib/db';
import { SESSION_UNAVAILABLE, sessionUnavailableResponse, getSessionWithUserFromRequest } from '../../../../lib/session';
import { getDatePartsInTimezone } from '../../../../lib/timezone';
import { classifyInsightsWindow } from '../../../../lib/insightsWindowAlignment';
import { toInsightsObservation, isInCalendarMonth } from '../../../../lib/insightsTimezone';
import { summarizeAuraFit } from '../../../../lib/insightsAuraFit';
import { computeAlignmentComparison } from '../../../../lib/insightsAlignment';

const REFLECTION_HISTORY_DAYS = 60;

export async function GET(req: NextRequest) {
  const session = await getSessionWithUserFromRequest(req);
  if (session === SESSION_UNAVAILABLE) return sessionUnavailableResponse();
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const user = session.user;
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

  // Insights Correctness + Historical Integrity V1 -- switched from the
  // row-count-capped listHabitLogs() (LIMIT 50) to the date-range
  // listHabitLogsForInsights(), so this route's own logsByDay aggregation
  // has real coverage across the full REFLECTION_HISTORY_DAYS window below
  // (a moderately active logger could easily exceed 50 total rows well
  // before 60 real days of history, silently starving the correlation of
  // data for its oldest reflection days).
  const sinceDate = new Date(Date.now() - INSIGHTS_HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const [logs, reflections] = await Promise.all([
    listHabitLogsForInsights(session.userId, sinceDate),
    listDailyReflections(session.userId, REFLECTION_HISTORY_DAYS),
  ]);

  // Insights Timezone Consistency V1 -- the log side of this join now
  // buckets each log by its Timing-Location calendar date
  // (getDatePartsInTimezone(user.timezone, ...), the owner's CURRENT
  // Timing Location -- Option A of the approved temporal model), never a
  // UTC-slice of the instant. Previously both sides of this join used
  // `.toISOString().slice(0,10)` (UTC calendar date) -- internally
  // consistent with each other, but wrong relative to the user's actual
  // local "day" for anyone not near UTC+0, especially in the evening.
  // Insights Window-Alignment Semantic Correction V1 -- classification now
  // goes through the shared classifyInsightsWindow() taxonomy, the same
  // one InsightsView.tsx uses, replacing this route's own previously
  // independent ABHIJIT/BRAHMA/GULIKA-vs-RAHU/YAMA string match. GULIKA
  // now falls into NEUTRAL, counting toward NEITHER `aligned` nor
  // `friction` -- a day with only Gulika/Neutral logs is not evidence for
  // either side of the comparison, rather than being silently counted as
  // "aligned" the way it previously was.
  const logsByDay = new Map<string, { aligned: number; friction: number; total: number }>();
  logs.forEach((log) => {
    const dateKey = getDatePartsInTimezone(user.timezone, new Date(log.logTimestamp)).dateStr;
    const existing = logsByDay.get(dateKey) ?? { aligned: 0, friction: 0, total: 0 };
    const band = classifyInsightsWindow(log.activeWindow);
    existing.total += 1;
    if (band === 'SUPPORTIVE') existing.aligned += 1;
    if (band === 'FRICTION') existing.friction += 1;
    logsByDay.set(dateKey, existing);
  });

  // Canonical Aura Fit Insights V1 -- a SEPARATE, activity-aware metric
  // from the window-only Timing Pattern/Alignment calculations above and
  // in InsightsView.tsx (C1); never blended with them. CURRENT_MONTH
  // scope, using the exact same Timing-Location calendar-month semantics
  // as InsightsView.tsx's own "This Month" card (PR #76's
  // getDatePartsInTimezone/isInCalendarMonth), so `auraFit.totalCount`
  // means "current-month HabitLogs," not the full up-to-
  // INSIGHTS_HISTORY_DAYS retrieval set already fetched above. Evaluation
  // itself uses each log's own absolute logTimestamp
  // (apps/web/lib/insightsAuraFit.ts); only the SCOPING (which logs count
  // as "this month") uses the owner's current Timing Location -- two
  // separate concerns, matching the C3 architecture's own explicit
  // evaluation/grouping split.
  const now = new Date();
  const { year: currentYear, month: currentMonth } = getDatePartsInTimezone(user.timezone, now);
  const currentMonthLogs = logs.filter((log) => isInCalendarMonth(toInsightsObservation(new Date(log.logTimestamp), user.timezone).dateKey, currentYear, currentMonth));
  const auraFit = summarizeAuraFit(currentMonthLogs);

  // AURA-INS-01 -- the comparison itself (unchanged scoring and "followed"
  // definition, new display thresholds and neutral wording) lives in
  // lib/insightsAlignment.ts. reflectionDate (@db.Date) is a semantic
  // "YYYY-MM-DD" stored as UTC midnight, so `.toISOString().slice(0, 10)`
  // decodes it unchanged (see reflection/route.ts getReflectionDate()).
  const alignment = computeAlignmentComparison(
    reflections.map((reflection) => ({
      dateKey: new Date(reflection.reflectionDate).toISOString().slice(0, 10),
      outputLevel: reflection.outputLevel,
      followedGuidance: reflection.followedGuidance,
    })),
    logsByDay,
    REFLECTION_HISTORY_DAYS,
  );

  return NextResponse.json({
    reflectionCount: reflections.length,
    // Kept for compatibility; now counted from qualifying (valid-mood,
    // one-per-day) check-ins only.
    alignedDays: alignment.followedDays,
    unalignedDays: alignment.otherDays,
    // Rounded percentage-point difference (nearest 5), or null until the
    // INS-01 display thresholds are met (30 days overall, 10 per group).
    alignmentDeltaPoints: alignment.differencePoints,
    insightText: alignment.summaryText,
    alignment,
    // Canonical Aura Fit Insights V1 -- additive field, always computable
    // from data already fetched above (no extra DB query). See
    // apps/web/lib/insightsAuraFit.ts for the full eligibility/aggregation
    // contract this reflects.
    auraFit,
  });
}
