/**
 * AURA-MR1 -- My Rhythm foundation: the canonical, PURE domain for a weekly
 * Goal Rhythm's pause state and scheduling preferences (migration 0053).
 *
 * Deliberately separate from, and orthogonal to, goalActivityRhythm.ts:
 *  - goalActivityRhythm.ts answers "HOW MANY sessions are owed this week"
 *    (NONE | N_PER_WEEK and the weekly eligibility formula). Nothing here
 *    changes that answer or that formula.
 *  - This module answers "WHERE/WHEN should sessions be proposed" (preferred
 *    weekdays, time of day, duration) and "may Aura propose or create new
 *    sessions at all right now" (paused).
 *
 * No DB access, no clock reads -- callers pass every input explicitly (same
 * convention as goalActivityRhythm.ts / goalCompletion.ts). Persistence lives
 * in db.ts's updateGoalActivityRhythmSettings.
 *
 * MR1 stores and validates preferences only. Applying them to recommended
 * times (the shared timing engine, Panchang ranking, Daily Rhythm) is MR2.
 */
import type { TimingTimePreference } from '../../../packages/recommendation/src/timingSearch';
import { NONE_GOAL_ACTIVITY_RHYTHM, localCalendarWeekBounds, localCalendarWeekStart, type GoalActivityRhythm } from './goalActivityRhythm';
import { isGoalActivityDailyFrequencyEnforceable, type GoalActivityDailyFrequency } from './goalActivityDailyFrequency';
import { getWeekdayForDateStr } from './availabilityContext';
import { addDaysToDateStr } from './timezone';

/** The timing engine's own existing time-of-day vocabulary (timingSearch.ts),
 * minus its 'ANY' sentinel -- "any time" is represented by `null` here, never
 * by a second spelling. Reusing the engine's type keeps MR2's mapping a
 * direct pass-through rather than a translation table. */
export type RhythmTimeOfDay = Exclude<TimingTimePreference, 'ANY'>;
export const RHYTHM_TIMES_OF_DAY: readonly RhythmTimeOfDay[] = ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT'];

/** The timing engine clamps every searched duration to 15..360 minutes
 * (timingSearch.ts runFind). A stored preference outside that range would be
 * silently altered at search time, so it is rejected here instead. */
export const MIN_RHYTHM_DURATION_MINUTES = 15;
export const MAX_RHYTHM_DURATION_MINUTES = 360;

export interface GoalActivityRhythmPreferences {
  /** Distinct civil weekdays, 0 = Sunday .. 6 = Saturday, ascending. Empty = any day. */
  preferredWeekdays: number[];
  /** null = any time of day. */
  preferredTimeOfDay: RhythmTimeOfDay | null;
  /** null = the activity's existing default duration. */
  preferredDurationMinutes: number | null;
}

export const NO_RHYTHM_PREFERENCES: GoalActivityRhythmPreferences = Object.freeze({ preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }) as GoalActivityRhythmPreferences;

/** The exact persisted shape (migration 0053). */
export interface PersistedGoalActivityRhythmPreferences {
  rhythmPreferredWeekdays: number[] | null;
  rhythmPreferredTimeOfDay: string | null;
  rhythmPreferredDurationMinutes: number | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value);
}

/** Rejects non-arrays, non-integers, values outside 0..6 and duplicates --
 * never clamps or silently de-duplicates. Returns a new ascending array. */
export function validateRhythmPreferredWeekdays(value: unknown): Result<number[]> {
  if (!Array.isArray(value)) return { ok: false, error: 'preferredWeekdays must be an array of weekday numbers (0 = Sunday .. 6 = Saturday).' };
  if (!value.every((d) => isInteger(d) && d >= 0 && d <= 6)) return { ok: false, error: 'preferredWeekdays must contain only whole numbers from 0 (Sunday) to 6 (Saturday).' };
  if (new Set(value).size !== value.length) return { ok: false, error: 'preferredWeekdays must not repeat a weekday.' };
  return { ok: true, value: [...(value as number[])].sort((a, b) => a - b) };
}

export function validateRhythmPreferredTimeOfDay(value: unknown): Result<RhythmTimeOfDay> {
  if (typeof value === 'string' && (RHYTHM_TIMES_OF_DAY as readonly string[]).includes(value)) return { ok: true, value: value as RhythmTimeOfDay };
  return { ok: false, error: `preferredTimeOfDay must be one of ${RHYTHM_TIMES_OF_DAY.join(', ')}, or null for any time.` };
}

export function validateRhythmPreferredDurationMinutes(value: unknown): Result<number> {
  if (!isInteger(value) || value < MIN_RHYTHM_DURATION_MINUTES || value > MAX_RHYTHM_DURATION_MINUTES) {
    return { ok: false, error: `preferredDurationMinutes must be a whole number of minutes from ${MIN_RHYTHM_DURATION_MINUTES} to ${MAX_RHYTHM_DURATION_MINUTES}, or null for the default.` };
  }
  return { ok: true, value };
}

/** A partial preferences update. A key that is ABSENT leaves that preference
 * unchanged; a key set to null (or, for weekdays, []) clears it. */
export interface GoalActivityRhythmPreferencesPatch {
  preferredWeekdays?: number[];
  preferredTimeOfDay?: RhythmTimeOfDay | null;
  preferredDurationMinutes?: number | null;
}

const PATCH_KEYS = ['preferredWeekdays', 'preferredTimeOfDay', 'preferredDurationMinutes'] as const;

/** Parses an untrusted client `preferences` object. Unknown keys are rejected
 * (a typo must never be silently ignored as "unchanged"). */
export function parseGoalActivityRhythmPreferencesPatch(input: unknown): Result<GoalActivityRhythmPreferencesPatch> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'preferences must be an object.' };
  const record = input as Record<string, unknown>;
  const unknownKey = Object.keys(record).find((k) => !(PATCH_KEYS as readonly string[]).includes(k));
  if (unknownKey !== undefined) return { ok: false, error: `Unknown preference: ${unknownKey}.` };

  const patch: GoalActivityRhythmPreferencesPatch = {};
  if ('preferredWeekdays' in record) {
    if (record.preferredWeekdays === null) patch.preferredWeekdays = [];
    else {
      const r = validateRhythmPreferredWeekdays(record.preferredWeekdays);
      if (!r.ok) return r;
      patch.preferredWeekdays = r.value;
    }
  }
  if ('preferredTimeOfDay' in record) {
    if (record.preferredTimeOfDay === null) patch.preferredTimeOfDay = null;
    else {
      const r = validateRhythmPreferredTimeOfDay(record.preferredTimeOfDay);
      if (!r.ok) return r;
      patch.preferredTimeOfDay = r.value;
    }
  }
  if ('preferredDurationMinutes' in record) {
    if (record.preferredDurationMinutes === null) patch.preferredDurationMinutes = null;
    else {
      const r = validateRhythmPreferredDurationMinutes(record.preferredDurationMinutes);
      if (!r.ok) return r;
      patch.preferredDurationMinutes = r.value;
    }
  }
  return { ok: true, value: patch };
}

/** Persisted (possibly legacy/corrupt) -> canonical. Each field independently
 * falls back to "no preference" when invalid -- a corrupt value must never
 * become a constraint the user did not choose (same fail-safe convention as
 * normalizeGoalActivityRhythm). */
export function normalizeGoalActivityRhythmPreferences(persisted: PersistedGoalActivityRhythmPreferences): GoalActivityRhythmPreferences {
  const weekdays = persisted.rhythmPreferredWeekdays === null ? null : validateRhythmPreferredWeekdays(persisted.rhythmPreferredWeekdays);
  const timeOfDay = persisted.rhythmPreferredTimeOfDay === null ? null : validateRhythmPreferredTimeOfDay(persisted.rhythmPreferredTimeOfDay);
  const duration = persisted.rhythmPreferredDurationMinutes === null ? null : validateRhythmPreferredDurationMinutes(persisted.rhythmPreferredDurationMinutes);
  return {
    preferredWeekdays: weekdays && weekdays.ok ? weekdays.value : [],
    preferredTimeOfDay: timeOfDay && timeOfDay.ok ? timeOfDay.value : null,
    preferredDurationMinutes: duration && duration.ok ? duration.value : null,
  };
}

export function toPersistedGoalActivityRhythmPreferences(preferences: GoalActivityRhythmPreferences): PersistedGoalActivityRhythmPreferences {
  return {
    rhythmPreferredWeekdays: [...preferences.preferredWeekdays],
    rhythmPreferredTimeOfDay: preferences.preferredTimeOfDay,
    rhythmPreferredDurationMinutes: preferences.preferredDurationMinutes,
  };
}

export function hasAnyRhythmPreference(preferences: GoalActivityRhythmPreferences): boolean {
  return preferences.preferredWeekdays.length > 0 || preferences.preferredTimeOfDay !== null || preferences.preferredDurationMinutes !== null;
}

export function isGoalActivityRhythmPaused(persisted: { rhythmPausedAt: Date | string | null }): boolean {
  return persisted.rhythmPausedAt !== null && persisted.rhythmPausedAt !== undefined;
}

/**
 * The one consistency rule between preferences and the existing recurrence
 * policy: under the default once-per-day limit (HPG3-A2), N sessions a week
 * need at least N distinct days, so the preferred weekdays (when any are set)
 * must offer at least `targetPerWeek` days. "3x a week, Sundays only" can
 * never be satisfied and is rejected rather than stored.
 */
export function validateRhythmPreferencesAgainstRhythm(rhythm: GoalActivityRhythm, preferences: GoalActivityRhythmPreferences, dailyFrequency: GoalActivityDailyFrequency): Result<null> {
  if (rhythm.kind !== 'N_PER_WEEK') {
    return hasAnyRhythmPreference(preferences) ? { ok: false, error: 'Preferences apply only to a weekly rhythm.' } : { ok: true, value: null };
  }
  const targetPerWeek = rhythm.targetPerWeek ?? 0;
  const oncePerDay = isGoalActivityDailyFrequencyEnforceable(dailyFrequency.kind) && dailyFrequency.kind === 'ONCE_PER_DAY';
  if (oncePerDay && preferences.preferredWeekdays.length > 0 && preferences.preferredWeekdays.length < targetPerWeek) {
    const dayWord = preferences.preferredWeekdays.length === 1 ? 'day' : 'days';
    return { ok: false, error: `A rhythm of ${targetPerWeek} times a week needs at least ${targetPerWeek} preferred days; ${preferences.preferredWeekdays.length} ${dayWord} selected.` };
  }
  return { ok: true, value: null };
}

/** What the single persistence write should do with "rhythmPausedAt". KEEP
 * preserves an existing pause timestamp untouched; PAUSE sets it only if not
 * already paused (pausing twice keeps the ORIGINAL instant); CLEAR resumes. */
export type RhythmPauseAction = 'KEEP' | 'PAUSE' | 'CLEAR';

export interface GoalActivityRhythmSettingsUpdate {
  rhythm?: GoalActivityRhythm;
  preferences?: GoalActivityRhythmPreferencesPatch;
  paused?: boolean;
}

export interface CurrentGoalActivityRhythmSettings {
  rhythm: GoalActivityRhythm;
  preferences: GoalActivityRhythmPreferences;
  dailyFrequency: GoalActivityDailyFrequency;
}

export type ResolvedGoalActivityRhythmSettings = { rhythm: GoalActivityRhythm; preferences: GoalActivityRhythmPreferences; pauseAction: RhythmPauseAction };

function patchSetsAValue(patch: GoalActivityRhythmPreferencesPatch | undefined): boolean {
  if (!patch) return false;
  return (patch.preferredWeekdays !== undefined && patch.preferredWeekdays.length > 0) || (patch.preferredTimeOfDay !== undefined && patch.preferredTimeOfDay !== null) || (patch.preferredDurationMinutes !== undefined && patch.preferredDurationMinutes !== null);
}

/**
 * Pure merge + validation of one settings update against the CURRENT
 * persisted state (read under a row lock by the caller), so the result is
 * always validated as a whole rather than field by field.
 *
 *  - Resulting rhythm NONE ("Once"): preferences and pause are meaningless,
 *    so they are cleared -- this keeps the existing `{ rhythm: NONE }` edit
 *    working unchanged. Explicitly SETTING a preference or pausing in the
 *    same request (or on an activity that is not a weekly rhythm) is
 *    rejected as inconsistent.
 *  - Resulting rhythm N_PER_WEEK: absent fields are kept, provided fields are
 *    applied, and the merged preferences must satisfy
 *    validateRhythmPreferencesAgainstRhythm. Pause/resume never touches the
 *    weekly target or the preferences.
 */
export function resolveGoalActivityRhythmSettingsUpdate(current: CurrentGoalActivityRhythmSettings, update: GoalActivityRhythmSettingsUpdate): Result<ResolvedGoalActivityRhythmSettings> {
  const rhythm = update.rhythm ?? current.rhythm;
  if (rhythm.kind !== 'N_PER_WEEK') {
    if (patchSetsAValue(update.preferences)) return { ok: false, error: 'Preferences apply only to a weekly rhythm.' };
    if (update.paused !== undefined) return { ok: false, error: 'Only a weekly rhythm can be paused or resumed.' };
    return { ok: true, value: { rhythm: NONE_GOAL_ACTIVITY_RHYTHM, preferences: { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [] }, pauseAction: 'CLEAR' } };
  }
  const patch = update.preferences ?? {};
  const preferences: GoalActivityRhythmPreferences = {
    preferredWeekdays: patch.preferredWeekdays !== undefined ? [...patch.preferredWeekdays] : [...current.preferences.preferredWeekdays],
    preferredTimeOfDay: patch.preferredTimeOfDay !== undefined ? patch.preferredTimeOfDay : current.preferences.preferredTimeOfDay,
    preferredDurationMinutes: patch.preferredDurationMinutes !== undefined ? patch.preferredDurationMinutes : current.preferences.preferredDurationMinutes,
  };
  const consistency = validateRhythmPreferencesAgainstRhythm(rhythm, preferences, current.dailyFrequency);
  if (!consistency.ok) return consistency;
  const pauseAction: RhythmPauseAction = update.paused === true ? 'PAUSE' : update.paused === false ? 'CLEAR' : 'KEEP';
  return { ok: true, value: { rhythm, preferences, pauseAction } };
}

// ============================================================
// AURA-MR2 -- the ONE shared interpretation of stored preferences, used by
// the weekly proposal, Plan My Day and Home alike (so the three surfaces can
// never disagree about what a preference means).
// ============================================================

/** True when `localDate` ("YYYY-MM-DD", user-local) is one of the preferred
 * weekdays -- or when no weekday preference is set (every day qualifies).
 * Weekdays are a strict filter: a rhythm is never proposed or auto-suggested
 * on a day the user did not choose. */
export function isPreferredRhythmDate(preferences: GoalActivityRhythmPreferences, localDate: string): boolean {
  if (preferences.preferredWeekdays.length === 0) return true;
  return preferences.preferredWeekdays.includes(getWeekdayForDateStr(localDate));
}

/** Which calendar week a weekly plan is for. CURRENT = the rest of this
 * week (today .. Sunday); NEXT = the whole following Monday .. Sunday. */
export type RhythmPlanningWeek = 'CURRENT' | 'NEXT';
export const RHYTHM_PLANNING_WEEKS: readonly RhythmPlanningWeek[] = ['CURRENT', 'NEXT'];

export function isRhythmPlanningWeek(value: unknown): value is RhythmPlanningWeek {
  return typeof value === 'string' && (RHYTHM_PLANNING_WEEKS as readonly string[]).includes(value);
}

export interface ResolvedRhythmPlanningWeek {
  week: RhythmPlanningWeek;
  /** The date weekly capacity is evaluated for (its week is the planned week):
   * today for CURRENT, next Monday for NEXT. */
  planningLocalDate: string;
  /** Inclusive civil-date range sessions may be proposed/accepted in. */
  startDate: string;
  endDate: string;
}

/** Pure civil-date arithmetic in the user's own timezone (the caller derives
 * `todayLocalDate` via getDatePartsInTimezone): the same Monday-start week
 * goalActivityRhythm.ts buckets occurrences with, so DST and timezone offsets
 * can never shift which seven dates a week contains. */
export function resolveRhythmPlanningWeek(todayLocalDate: string, week: RhythmPlanningWeek): ResolvedRhythmPlanningWeek {
  if (week === 'CURRENT') {
    return { week, planningLocalDate: todayLocalDate, startDate: todayLocalDate, endDate: localCalendarWeekBounds(todayLocalDate).endDate };
  }
  const nextMonday = addDaysToDateStr(localCalendarWeekStart(todayLocalDate), 7);
  return { week, planningLocalDate: nextMonday, startDate: nextMonday, endDate: addDaysToDateStr(nextMonday, 6) };
}
