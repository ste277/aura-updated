import { NextRequest, NextResponse } from 'next/server';
import { listDailyReflections, listHabitLogs } from '../../../../lib/db';
import { getSessionFromRequest } from '../../../../lib/session';

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });

  const [logs, reflections] = await Promise.all([
    listHabitLogs(session.userId),
    listDailyReflections(session.userId, 60),
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

  let alignedPeak = 0;
  let alignedTotal = 0;
  let unalignedPeak = 0;
  let unalignedTotal = 0;

  reflections.forEach((reflection) => {
    const dateKey = new Date(reflection.reflectionDate).toISOString().slice(0, 10);
    const dayLogs = logsByDay.get(dateKey);
    const followedByLogs = Boolean(dayLogs && dayLogs.aligned > dayLogs.friction);
    const followed = reflection.followedGuidance || followedByLogs;
    const isPeak = reflection.outputLevel === 'PEAK_FLOW';

    if (followed) {
      alignedTotal += 1;
      if (isPeak) alignedPeak += 1;
    } else {
      unalignedTotal += 1;
      if (isPeak) unalignedPeak += 1;
    }
  });

  const alignedRate = alignedTotal > 0 ? alignedPeak / alignedTotal : 0;
  const unalignedRate = unalignedTotal > 0 ? unalignedPeak / unalignedTotal : 0;
  const liftPercent = unalignedRate > 0
    ? Math.round(((alignedRate - unalignedRate) / unalignedRate) * 100)
    : alignedTotal > 0
      ? Math.round(alignedRate * 100)
      : 0;

  return NextResponse.json({
    reflectionCount: reflections.length,
    alignedDays: alignedTotal,
    unalignedDays: unalignedTotal,
    peakFlowLiftPercent: liftPercent,
    insightText: reflections.length >= 3
      ? `You reported ${Math.max(0, liftPercent)}% higher peak-flow days when you followed favorable windows.`
      : 'Log a few evening check-ins to unlock your personal before-and-after trend.',
  });
}
