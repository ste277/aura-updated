import { NextRequest, NextResponse } from 'next/server';
import { listDailyReflections, listHabitLogsForInsights, INSIGHTS_HISTORY_DAYS } from '../../../../lib/db';
import { getSessionFromRequest } from '../../../../lib/session';

const REFLECTION_HISTORY_DAYS = 60;

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

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

  const logsByDay = new Map<string, { aligned: number; friction: number; total: number }>();
  logs.forEach((log) => {
    const dateKey = new Date(log.logTimestamp).toISOString().slice(0, 10);
    const existing = logsByDay.get(dateKey) ?? { aligned: 0, friction: 0, total: 0 };
    const windowName = String(log.activeWindow || '').toUpperCase();
    existing.total += 1;
    if (windowName.includes('ABHIJIT') || windowName.includes('BRAHMA') || windowName.includes('GULIKA')) {
      existing.aligned += 1;
    }
    if (windowName.includes('RAHU') || windowName.includes('YAMA')) {
      existing.friction += 1;
    }
    logsByDay.set(dateKey, existing);
  });

  let alignedScoreTotal = 0;
  let alignedTotal = 0;
  let unalignedScoreTotal = 0;
  let unalignedTotal = 0;

  reflections.forEach((reflection) => {
    const dateKey = new Date(reflection.reflectionDate).toISOString().slice(0, 10);
    const dayLogs = logsByDay.get(dateKey);
    const followedByLogs = Boolean(dayLogs && dayLogs.aligned > dayLogs.friction);
    const followed = reflection.followedGuidance || followedByLogs;
    const reflectionScore = reflection.outputLevel === 'PEAK_FLOW'
      ? 1
      : reflection.outputLevel === 'MODERATE'
      ? 0.5
      : 0;

    if (followed) {
      alignedTotal += 1;
      alignedScoreTotal += reflectionScore;
    } else {
      unalignedTotal += 1;
      unalignedScoreTotal += reflectionScore;
    }
  });

  // Insights Correctness + Historical Integrity V1 -- ONE consistent
  // comparison, never a formula that silently changes shape by
  // denominator. Previously: a RELATIVE percentage lift when
  // unalignedRate > 0, but an unrelated ABSOLUTE percentage
  // (alignedRate * 100, not a "lift" at all) when it wasn't -- both
  // rendered under the identical "% higher" wording, and a genuinely
  // negative lift was clamped to display "0% higher", misrepresenting the
  // direction of the evidence. Now: a plain PERCENTAGE-POINT difference
  // between the two groups' average outcome score (each already a 0-1
  // scale) -- well-defined and continuous through positive, zero, and
  // negative, with no denominator-dependent branching.
  //
  // Requires BOTH comparison groups to actually exist (brief section 10):
  // a comparison is never manufactured from only one side. alignedRate/
  // unalignedRate are `null`, not a silent 0, when their own group is
  // empty -- 0 would be indistinguishable from "this group scored the
  // worst possible outcome", which is a different claim entirely.
  const alignedRate = alignedTotal > 0 ? alignedScoreTotal / alignedTotal : null;
  const unalignedRate = unalignedTotal > 0 ? unalignedScoreTotal / unalignedTotal : null;
  const hasValidComparison = alignedRate !== null && unalignedRate !== null;
  const alignmentDeltaPoints = hasValidComparison ? Math.round((alignedRate! - unalignedRate!) * 100) : null;

  let insightText: string;
  if (reflections.length < 3) {
    insightText = 'Log a few evening check-ins to unlock your personal before-and-after trend.';
  } else if (!hasValidComparison) {
    // Enough total check-ins, but they don't yet span both "followed" and
    // "not followed" days -- there is nothing to compare yet, never a
    // fabricated one-sided percentage.
    insightText = 'Keep logging check-ins on both favorable and caution days to unlock your personal before-and-after trend.';
  } else if (alignmentDeltaPoints! > 0) {
    insightText = `Your check-ins score ${alignmentDeltaPoints} points higher on days when you followed favorable windows.`;
  } else if (alignmentDeltaPoints! < 0) {
    insightText = `Your check-ins score ${Math.abs(alignmentDeltaPoints!)} points lower on days when you followed favorable windows.`;
  } else {
    insightText = 'Your check-ins score about the same whether or not you followed favorable windows.';
  }

  return NextResponse.json({
    reflectionCount: reflections.length,
    alignedDays: alignedTotal,
    unalignedDays: unalignedTotal,
    // Percentage-POINT delta on the 0-1 outcome scale (never a relative
    // percent), or null when there isn't yet a valid two-sided comparison
    // -- see hasValidComparison above. Renamed from the old
    // peakFlowLiftPercent to make the shape/meaning change explicit at
    // every call site (apps/web/components/InsightsView.tsx).
    alignmentDeltaPoints,
    insightText,
  });
}
