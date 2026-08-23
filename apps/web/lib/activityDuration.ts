/**
 * Good Right Now Duration Display Polish -- the one place any surface
 * turns a HabitLog's persisted durationMinutes into user-facing text.
 * durationMinutes = 0 is the canonical, intentional value for an INSTANT
 * completion (see packages/recommendation/src/activityDefinitions.ts's
 * ActivityDurationMode) -- it is never displayed as "0 min", only as
 * "Completed". Nothing here changes what gets persisted or summed; this is
 * presentation only.
 */

export interface FormatActivityDurationInput {
  durationMinutes: number;
  /** Optional -- durationMinutes === 0 is already an unambiguous signal on
   * its own (every other durationMode persists a positive value), but a
   * caller that already has the mode on hand can pass it for clarity. */
  durationMode?: 'INSTANT' | 'FIXED' | 'USER_SELECTED' | 'SESSION';
}

export function formatActivityDuration({ durationMinutes, durationMode }: FormatActivityDurationInput): string {
  if (durationMode === 'INSTANT' || durationMinutes === 0) return 'Completed';
  if (durationMinutes < 60) return `${durationMinutes} min`;
  const hours = Math.floor(durationMinutes / 60);
  const rest = durationMinutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/**
 * "Average session length" must describe actual timed sessions, not
 * completed-instantly activities -- durationMinutes = 0 entries are
 * excluded from both the sum and the divisor. Returns null (not 0 or NaN)
 * when there are no timed entries to average, so a caller can hide the
 * stat entirely rather than claim "sessions average 0 minutes" when there
 * were no sessions at all, only instant completions. Takes already-resolved
 * minute values (callers apply their own fallback for legacy logs with no
 * recorded duration, e.g. `?? 30`, before calling this) rather than raw
 * possibly-undefined log rows, so it stays a plain, easily-tested function.
 */
export function computeAverageTimedSessionMinutes(durationsMinutes: number[]): number | null {
  const timed = durationsMinutes.filter((minutes) => minutes > 0);
  if (timed.length === 0) return null;
  return Math.round(timed.reduce((sum, minutes) => sum + minutes, 0) / timed.length);
}
