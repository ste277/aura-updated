/**
 * Daily Rhythm V1 PR DR1 -- Preferences Foundation: pure validation/
 * resolution for the two nullable `User.dailyRhythmWork{Start,End}`
 * fields + `dailyRhythmWorkDays` (see AURA_DAILY_RHYTHM_V1_ARCHITECTURE_
 * AUDIT.md section 4/8, Option A).
 *
 * Mirrors availabilityContext.ts's own shape deliberately: no DB import,
 * no fetch, no clock read -- a pure domain layer. Same "HH:mm" 24h civil
 * string convention, resolved against whichever `User.timezone` the
 * caller supplies; this file carries no timezone of its own.
 *
 * THIS FILE IS NOT READ BY ANY SCHEDULING CODE IN THIS PR. It exists
 * purely to validate and shape what the Settings API persists. Wiring it
 * into the day constructor, Find a Time, Home, or Goals is explicitly
 * out of scope for DR1 (see the ticket's own "Do not modify the day
 * constructor or Find a Time engines").
 */

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const VALID_TIME_STR = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Both null is the ONLY unconfigured state -- see User.dailyRhythmWorkStart's
 * own schema doc comment. One-set-one-null is treated as corrupt input by
 * validateDailyRhythmPreferencesInput below; callers never persist that
 * combination. */
export interface DailyRhythmPreferences {
  workStart: string | null;
  workEnd: string | null;
  workDays: readonly Weekday[];
}

export const UNCONFIGURED_DAILY_RHYTHM_PREFERENCES: DailyRhythmPreferences = {
  workStart: null,
  workEnd: null,
  workDays: [],
};

export interface DailyRhythmPreferencesInput {
  workStart: string;
  workEnd: string;
  workDays: readonly number[];
}

/** Throws a deterministic Error on any invalid field -- never silently
 * coerces, clamps, or drops. Returns a normalized value (workDays
 * deduplicated and sorted ascending; everything else unchanged) on
 * success. No cross-midnight window is accepted in V1 -- "22:00"-"06:00"
 * is rejected outright (same "no cross-midnight in V1" policy
 * availabilityContext.ts's own validateAvailabilityPeriodInput already
 * established, per the approved audit's explicit "overnight shifts are
 * future scope" line), never automatically split or wrapped. An EMPTY
 * workDays array is valid and deliberate ("no day is currently a work
 * day"), never rejected as an error. */
export function validateDailyRhythmPreferencesInput(input: DailyRhythmPreferencesInput): { workStart: string; workEnd: string; workDays: Weekday[] } {
  if (typeof input.workStart !== 'string' || !VALID_TIME_STR.test(input.workStart)) {
    throw new Error(`workStart must be a valid "HH:mm" 24h time, got: "${input.workStart}".`);
  }
  if (typeof input.workEnd !== 'string' || !VALID_TIME_STR.test(input.workEnd)) {
    throw new Error(`workEnd must be a valid "HH:mm" 24h time, got: "${input.workEnd}".`);
  }
  if (input.workStart >= input.workEnd) {
    throw new Error(`workStart must be before workEnd (no cross-midnight work window in V1 -- see the approved audit's "overnight shifts are future scope"), got: "${input.workStart}"-"${input.workEnd}".`);
  }
  if (!Array.isArray(input.workDays)) {
    throw new Error('workDays must be an array.');
  }
  const workDays = new Set<Weekday>();
  for (const day of input.workDays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error(`workDays must contain only integers 0-6 (Sunday=0), got: ${day}.`);
    }
    workDays.add(day as Weekday);
  }
  return { workStart: input.workStart, workEnd: input.workEnd, workDays: Array.from(workDays).sort((a, b) => a - b) };
}
