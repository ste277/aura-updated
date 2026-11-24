/**
 * AURA-MR3 -- the pure client-side model behind the My Rhythm preferences
 * editor (components/RhythmSettingsEditor.tsx).
 *
 * The backend (MR1/MR2) already owns every rule: validation lives in
 * goalActivityRhythmPreferences.ts and is re-run server-side by
 * PATCH /api/goals/:goalId/activities/:goalActivityId/rhythm. This module
 * only:
 *   - turns the saved read model into an editable draft,
 *   - mirrors the server's validators so the user sees the reason BEFORE
 *     saving (the server stays authoritative), and
 *   - builds the smallest PATCH body that expresses the user's edit, so an
 *     untouched preference is never sent and can never be reset by
 *     accident.
 *
 * No React, no fetch, no clock -- directly unit-testable.
 */
import {
  MAX_RHYTHM_DURATION_MINUTES,
  MIN_RHYTHM_DURATION_MINUTES,
  NO_RHYTHM_PREFERENCES,
  validateRhythmPreferredDurationMinutes,
  type GoalActivityRhythmPreferences,
  type RhythmTimeOfDay,
} from './goalActivityRhythmPreferences';

export type RhythmFrequencyValue = { kind: 'NONE' } | { kind: 'N_PER_WEEK'; targetPerWeek: number };

/** Weekday chips in Monday-first display order. `value` keeps the stored
 * encoding (0 = Sunday .. 6 = Saturday) -- only the display order changes. */
export const RHYTHM_WEEKDAY_CHIPS: ReadonlyArray<{ value: number; short: string; long: string }> = [
  { value: 1, short: 'Mon', long: 'Monday' },
  { value: 2, short: 'Tue', long: 'Tuesday' },
  { value: 3, short: 'Wed', long: 'Wednesday' },
  { value: 4, short: 'Thu', long: 'Thursday' },
  { value: 5, short: 'Fri', long: 'Friday' },
  { value: 6, short: 'Sat', long: 'Saturday' },
  { value: 0, short: 'Sun', long: 'Sunday' },
];

/** User-facing labels for the timing engine's own time-of-day vocabulary.
 * Hour ranges match dailyAssistant.ts matchesTimePreference(). */
export const RHYTHM_TIME_OF_DAY_OPTIONS: ReadonlyArray<{ value: RhythmTimeOfDay; label: string; hint: string }> = [
  { value: 'MORNING', label: 'Morning', hint: '5 AM – 12 PM' },
  { value: 'AFTERNOON', label: 'Afternoon', hint: '12 – 5 PM' },
  { value: 'EVENING', label: 'Evening', hint: '5 – 9 PM' },
  { value: 'NIGHT', label: 'Night', hint: 'after 9 PM' },
];

export const RHYTHM_DURATION_PRESETS: readonly number[] = [15, 30, 45, 60, 90];

export interface RhythmSettingsDraft {
  /** null = the frequency picker currently holds an invalid custom value. */
  frequency: RhythmFrequencyValue | null;
  preferredWeekdays: number[];
  preferredTimeOfDay: RhythmTimeOfDay | null;
  /** Raw duration text (custom entry). '' = use the activity's default. */
  durationText: string;
}

export interface SavedRhythmSettings {
  frequency: RhythmFrequencyValue;
  preferences: GoalActivityRhythmPreferences;
  /** ONCE_PER_DAY (the default) means N sessions need N distinct days. */
  oncePerDay: boolean;
}

export function draftFromSaved(saved: SavedRhythmSettings): RhythmSettingsDraft {
  return {
    frequency: saved.frequency,
    preferredWeekdays: [...saved.preferences.preferredWeekdays],
    preferredTimeOfDay: saved.preferences.preferredTimeOfDay,
    durationText: saved.preferences.preferredDurationMinutes === null ? '' : String(saved.preferences.preferredDurationMinutes),
  };
}

/** Toggling keeps the stored ascending order, so a toggled-off-then-on day
 * produces an identical array (and therefore no spurious PATCH). */
export function toggleRhythmWeekday(weekdays: readonly number[], weekday: number): number[] {
  const set = new Set(weekdays);
  if (set.has(weekday)) set.delete(weekday);
  else set.add(weekday);
  return Array.from(set).sort((a, b) => a - b);
}

type DurationParse = { ok: true; value: number | null } | { ok: false; error: string };

export function parseDraftDuration(text: string): DurationParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const n = Number(trimmed);
  const validated = validateRhythmPreferredDurationMinutes(n);
  if (!validated.ok) return { ok: false, error: `Enter a whole number of minutes from ${MIN_RHYTHM_DURATION_MINUTES} to ${MAX_RHYTHM_DURATION_MINUTES}.` };
  return { ok: true, value: validated.value };
}

export interface DraftValidation {
  /** Blocking problems -- Save stays disabled while any exist. */
  errors: string[];
  /** Non-blocking information shown next to the controls. */
  notes: string[];
}

/** Mirrors validateRhythmPreferencesAgainstRhythm + the field validators so
 * the explanation appears before saving. The server re-validates. */
export function validateRhythmSettingsDraft(draft: RhythmSettingsDraft, saved: SavedRhythmSettings): DraftValidation {
  const errors: string[] = [];
  const notes: string[] = [];
  if (draft.frequency === null) {
    errors.push('Choose how often, or enter a whole number of times a week.');
    return { errors, notes };
  }
  if (draft.frequency.kind === 'NONE') {
    if (hasPreferencesInDraft(draft) || hasAnySavedPreference(saved)) {
      notes.push('A one-off activity has no weekly days, time or duration, so these preferences will be cleared.');
    }
    return { errors, notes };
  }
  const target = draft.frequency.targetPerWeek;
  const days = draft.preferredWeekdays.length;
  if (saved.oncePerDay && days > 0 && days < target) {
    errors.push(`${target} times a week needs at least ${target} preferred days. You've chosen ${days}. Pick more days or lower the frequency.`);
  }
  const duration = parseDraftDuration(draft.durationText);
  if (!duration.ok) errors.push(duration.error);
  if (days === 0) notes.push('Any day: Aura picks the best days for you.');
  return { errors, notes };
}

function hasPreferencesInDraft(draft: RhythmSettingsDraft): boolean {
  return draft.preferredWeekdays.length > 0 || draft.preferredTimeOfDay !== null || draft.durationText.trim() !== '';
}

function hasAnySavedPreference(saved: SavedRhythmSettings): boolean {
  const p = saved.preferences;
  return p.preferredWeekdays.length > 0 || p.preferredTimeOfDay !== null || p.preferredDurationMinutes !== null;
}

function sameFrequency(a: RhythmFrequencyValue, b: RhythmFrequencyValue): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'NONE' || (b.kind === 'N_PER_WEEK' && a.targetPerWeek === b.targetPerWeek);
}

function sameWeekdays(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

export interface RhythmSettingsPatchBody {
  rhythm?: RhythmFrequencyValue;
  preferences?: { preferredWeekdays?: number[]; preferredTimeOfDay?: RhythmTimeOfDay | null; preferredDurationMinutes?: number | null };
}

/**
 * The smallest PATCH body for this edit, or null when nothing changed (or
 * the draft is invalid). Only CHANGED fields are sent: the server treats an
 * absent key as "unchanged", so an untouched preference can never be reset.
 *
 * Switching to a one-off ("Once") sends `{ rhythm: NONE }` alone -- the
 * server clears preferences and pause itself, and would REJECT a request
 * that also tried to set a preference on a non-weekly activity.
 */
export function buildRhythmSettingsPatch(draft: RhythmSettingsDraft, saved: SavedRhythmSettings): RhythmSettingsPatchBody | null {
  if (validateRhythmSettingsDraft(draft, saved).errors.length > 0 || draft.frequency === null) return null;
  const body: RhythmSettingsPatchBody = {};
  if (!sameFrequency(draft.frequency, saved.frequency)) body.rhythm = draft.frequency;
  if (draft.frequency.kind === 'NONE') return body.rhythm ? body : null;

  const preferences: NonNullable<RhythmSettingsPatchBody['preferences']> = {};
  if (!sameWeekdays(draft.preferredWeekdays, saved.preferences.preferredWeekdays)) preferences.preferredWeekdays = [...draft.preferredWeekdays];
  if (draft.preferredTimeOfDay !== saved.preferences.preferredTimeOfDay) preferences.preferredTimeOfDay = draft.preferredTimeOfDay;
  const duration = parseDraftDuration(draft.durationText);
  if (duration.ok && duration.value !== saved.preferences.preferredDurationMinutes) preferences.preferredDurationMinutes = duration.value;
  if (Object.keys(preferences).length > 0) body.preferences = preferences;
  return Object.keys(body).length > 0 ? body : null;
}

/** "Mon, Wed, Fri · Morning · 45 min", or null when no preference is set. */
export function formatRhythmPreferencesSummary(preferences: GoalActivityRhythmPreferences | null | undefined): string | null {
  const p = preferences ?? NO_RHYTHM_PREFERENCES;
  const parts: string[] = [];
  if (p.preferredWeekdays.length > 0) {
    parts.push(RHYTHM_WEEKDAY_CHIPS.filter((c) => p.preferredWeekdays.includes(c.value)).map((c) => c.short).join(', '));
  }
  if (p.preferredTimeOfDay !== null) {
    const option = RHYTHM_TIME_OF_DAY_OPTIONS.find((o) => o.value === p.preferredTimeOfDay);
    if (option) parts.push(option.label);
  }
  if (p.preferredDurationMinutes !== null) parts.push(`${p.preferredDurationMinutes} min`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Deep link from Home to one goal activity's rhythm settings on Goal Detail. */
export function goalActivityRhythmHref(goalId: string, goalActivityId: string): string {
  return `/goals/${encodeURIComponent(goalId)}#activity-${encodeURIComponent(goalActivityId)}`;
}

/** The subset of Goal Detail's GoalActivityView the editor needs (kept
 * structural so this module does not depend on goalsPresentation.ts). */
export interface SavedRhythmSource {
  rhythm: { kind: 'NONE' } | { kind: 'N_PER_WEEK'; targetPerWeek: number };
  rhythmPreferences?: GoalActivityRhythmPreferences;
  dailyFrequencyKind?: string | null;
}

/**
 * AURA-MR3 -- adapts a Goal Detail activity to the editor's saved-settings
 * shape. Missing MR1 fields fall back to "no preferences"; a null/unknown
 * daily frequency is ONCE_PER_DAY, exactly as
 * normalizeGoalActivityDailyFrequency treats it server-side.
 */
export function savedRhythmSettingsFromActivity(activity: SavedRhythmSource): SavedRhythmSettings {
  const frequency: RhythmFrequencyValue = activity.rhythm.kind === 'N_PER_WEEK' ? { kind: 'N_PER_WEEK', targetPerWeek: activity.rhythm.targetPerWeek } : { kind: 'NONE' };
  const preferences = activity.rhythmPreferences ?? NO_RHYTHM_PREFERENCES;
  // Mirrors validateRhythmPreferencesAgainstRhythm: only an enforceable
  // ONCE_PER_DAY policy requires one distinct day per session. CUSTOM is not
  // enforceable and MULTIPLE_PER_DAY allows same-day sessions.
  const oncePerDay = activity.dailyFrequencyKind !== 'MULTIPLE_PER_DAY' && activity.dailyFrequencyKind !== 'CUSTOM';
  return { frequency, preferences: { preferredWeekdays: [...preferences.preferredWeekdays], preferredTimeOfDay: preferences.preferredTimeOfDay, preferredDurationMinutes: preferences.preferredDurationMinutes }, oncePerDay };
}
