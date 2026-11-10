import { executeFindBestTime, type FindBestTimeOutcome } from './findBestTime';
import { daySpan } from './findBestTimeSchema';

/**
 * Remote profile of `find_best_time` (AURA-MCP-02 D1 threat T9).
 *
 * Identical to the local executor except that an explicit `dateRange` may
 * span at most REMOTE_MAX_DATE_RANGE_DAYS: Timing Search cost grows about
 * linearly per day (~80 ms/day measured), so the local 90-day ceiling would
 * let one remote call burn several seconds of CPU. Every `horizon` value the
 * schema accepts (NOW, TODAY, TOMORROW, WEEKEND, SEVEN_DAYS) already falls
 * inside this cap. Everything else -- validation, pipeline, ranking, result
 * envelope -- is the shared executor, unchanged.
 */
export const REMOTE_MAX_DATE_RANGE_DAYS = 14;

export function executeFindBestTimeRemote(rawArgs: unknown, now: () => Date = () => new Date()): FindBestTimeOutcome {
  const range = (rawArgs as { dateRange?: { start?: unknown; end?: unknown } } | null | undefined)?.dateRange;
  if (range && typeof range.start === 'string' && typeof range.end === 'string') {
    const span = daySpan(range.start, range.end);
    if (Number.isFinite(span) && span > REMOTE_MAX_DATE_RANGE_DAYS) {
      return {
        ok: false,
        kind: 'INVALID_INPUT',
        message: `dateRange: must span ${REMOTE_MAX_DATE_RANGE_DAYS} days or fewer for remote requests`,
      };
    }
  }
  return executeFindBestTime(rawArgs, now);
}
