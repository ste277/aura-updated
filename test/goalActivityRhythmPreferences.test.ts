/**
 * AURA-MR1 -- pure tests for apps/web/lib/goalActivityRhythmPreferences.ts
 * (My Rhythm foundation: pause state + scheduling preferences). No DB, no
 * clock. The DB/API behavior is proved in test/myRhythmFoundationDb.test.ts.
 */
import {
  validateRhythmPreferredWeekdays,
  validateRhythmPreferredTimeOfDay,
  validateRhythmPreferredDurationMinutes,
  parseGoalActivityRhythmPreferencesPatch,
  normalizeGoalActivityRhythmPreferences,
  toPersistedGoalActivityRhythmPreferences,
  validateRhythmPreferencesAgainstRhythm,
  resolveGoalActivityRhythmSettingsUpdate,
  isGoalActivityRhythmPaused,
  hasAnyRhythmPreference,
  NO_RHYTHM_PREFERENCES,
  RHYTHM_TIMES_OF_DAY,
  type CurrentGoalActivityRhythmSettings,
} from '../apps/web/lib/goalActivityRhythmPreferences';
import { ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY } from '../apps/web/lib/goalActivityDailyFrequency';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---- Weekdays ----
check('W1. empty weekday list is valid (no preference)', same(validateRhythmPreferredWeekdays([]), { ok: true, value: [] }));
check('W2. weekdays are returned sorted ascending', same(validateRhythmPreferredWeekdays([5, 1, 3]), { ok: true, value: [1, 3, 5] }));
check('W3. Sunday (0) and Saturday (6) are both valid', validateRhythmPreferredWeekdays([0, 6]).ok);
for (const bad of [[7], [-1], [1.5], ['1'], [null], [NaN], [Infinity]]) {
  check(`W4. rejects weekday value ${JSON.stringify(bad)}`, !validateRhythmPreferredWeekdays(bad).ok);
}
check('W5. rejects a duplicate weekday (never silently de-duplicated)', !validateRhythmPreferredWeekdays([1, 1]).ok);
check('W6. rejects a non-array', !validateRhythmPreferredWeekdays('0,1').ok && !validateRhythmPreferredWeekdays(3).ok && !validateRhythmPreferredWeekdays({}).ok);
check('W7. does not mutate the input array', (() => { const input = [3, 1]; validateRhythmPreferredWeekdays(input); return same(input, [3, 1]); })());

// ---- Time of day ----
check('T1. vocabulary is exactly the timing engine time preferences minus ANY', same(RHYTHM_TIMES_OF_DAY, ['MORNING', 'AFTERNOON', 'EVENING', 'NIGHT']));
for (const ok of RHYTHM_TIMES_OF_DAY) check(`T2. accepts ${ok}`, validateRhythmPreferredTimeOfDay(ok).ok);
for (const bad of ['ANY', 'morning', 'DAWN', '', 1, null, undefined]) check(`T3. rejects time of day ${JSON.stringify(bad)}`, !validateRhythmPreferredTimeOfDay(bad).ok);

// ---- Duration ----
for (const ok of [15, 30, 45, 360]) check(`D1. accepts duration ${ok}`, validateRhythmPreferredDurationMinutes(ok).ok);
for (const bad of [0, -5, 14, 361, 30.5, NaN, Infinity, '30', null]) check(`D2. rejects duration ${JSON.stringify(bad)}`, !validateRhythmPreferredDurationMinutes(bad).ok);

// ---- Patch parsing ----
check('P1. empty object is a valid no-op patch', same(parseGoalActivityRhythmPreferencesPatch({}), { ok: true, value: {} }));
check('P2. null clears each field (weekdays clear to [])', same(parseGoalActivityRhythmPreferencesPatch({ preferredWeekdays: null, preferredTimeOfDay: null, preferredDurationMinutes: null }), { ok: true, value: { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null } }));
check('P3. sets each field', same(parseGoalActivityRhythmPreferencesPatch({ preferredWeekdays: [3, 1], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 45 }), { ok: true, value: { preferredWeekdays: [1, 3], preferredTimeOfDay: 'EVENING', preferredDurationMinutes: 45 } }));
check('P4. an absent key is absent from the patch (unchanged, not cleared)', (() => { const r = parseGoalActivityRhythmPreferencesPatch({ preferredTimeOfDay: 'MORNING' }); return r.ok && !('preferredWeekdays' in r.value) && !('preferredDurationMinutes' in r.value); })());
check('P5. rejects an unknown key (a typo is never ignored)', !parseGoalActivityRhythmPreferencesPatch({ preferredWeekday: [1] }).ok);
check('P6. rejects a non-object / array / null', !parseGoalActivityRhythmPreferencesPatch(null).ok && !parseGoalActivityRhythmPreferencesPatch([]).ok && !parseGoalActivityRhythmPreferencesPatch('x').ok);
check('P7. rejects invalid nested values', !parseGoalActivityRhythmPreferencesPatch({ preferredWeekdays: [9] }).ok && !parseGoalActivityRhythmPreferencesPatch({ preferredTimeOfDay: 'ANY' }).ok && !parseGoalActivityRhythmPreferencesPatch({ preferredDurationMinutes: 0 }).ok);

// ---- Normalize / persist ----
check('N1. a legacy/default row (weekdays {} / nulls) normalizes to no preferences', same(normalizeGoalActivityRhythmPreferences({ rhythmPreferredWeekdays: [], rhythmPreferredTimeOfDay: null, rhythmPreferredDurationMinutes: null }), NO_RHYTHM_PREFERENCES));
check('N2. a NULL weekday array also normalizes to no preference', same(normalizeGoalActivityRhythmPreferences({ rhythmPreferredWeekdays: null, rhythmPreferredTimeOfDay: null, rhythmPreferredDurationMinutes: null }), NO_RHYTHM_PREFERENCES));
check('N3. corrupt persisted values fall back to "no preference" per field, never become a constraint', same(normalizeGoalActivityRhythmPreferences({ rhythmPreferredWeekdays: [9], rhythmPreferredTimeOfDay: 'DAWN', rhythmPreferredDurationMinutes: 0 }), NO_RHYTHM_PREFERENCES));
check('N4. one corrupt field does not discard the valid ones', same(normalizeGoalActivityRhythmPreferences({ rhythmPreferredWeekdays: [0], rhythmPreferredTimeOfDay: 'DAWN', rhythmPreferredDurationMinutes: 30 }), { preferredWeekdays: [0], preferredTimeOfDay: null, preferredDurationMinutes: 30 }));
check('N5. persist -> normalize round-trips', (() => { const p = { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING' as const, preferredDurationMinutes: 40 }; return same(normalizeGoalActivityRhythmPreferences(toPersistedGoalActivityRhythmPreferences(p)), p); })());
check('N6. hasAnyRhythmPreference is false only for no preferences', !hasAnyRhythmPreference(NO_RHYTHM_PREFERENCES) && hasAnyRhythmPreference({ ...NO_RHYTHM_PREFERENCES, preferredDurationMinutes: 20 }));
check('N7. isGoalActivityRhythmPaused: NULL = active, any timestamp = paused', !isGoalActivityRhythmPaused({ rhythmPausedAt: null }) && isGoalActivityRhythmPaused({ rhythmPausedAt: new Date(0) }));

// ---- Consistency with the existing recurrence rules ----
const once = ONCE_PER_DAY_GOAL_ACTIVITY_DAILY_FREQUENCY;
check('C1. 1x a week on Sundays only is consistent ("every Sunday")', validateRhythmPreferencesAgainstRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 1 }, { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [0] }, once).ok);
check('C2. 3x a week on Mon/Wed/Fri is consistent', validateRhythmPreferencesAgainstRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 3 }, { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [1, 3, 5] }, once).ok);
check('C3. 3x a week on Sundays only is REJECTED under once-per-day (cannot be satisfied)', !validateRhythmPreferencesAgainstRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 3 }, { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [0] }, once).ok);
check('C4. no weekday preference never conflicts with any target', validateRhythmPreferencesAgainstRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 7 }, NO_RHYTHM_PREFERENCES, once).ok);
check('C5. MULTIPLE_PER_DAY lifts the distinct-day requirement', validateRhythmPreferencesAgainstRhythm({ kind: 'N_PER_WEEK', targetPerWeek: 3 }, { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [0] }, { kind: 'MULTIPLE_PER_DAY' }).ok);
check('C6. any preference on a NONE rhythm is rejected', !validateRhythmPreferencesAgainstRhythm({ kind: 'NONE' }, { ...NO_RHYTHM_PREFERENCES, preferredTimeOfDay: 'MORNING' }, once).ok);

// ---- Resolve (merge + validate the whole update) ----
const weekly: CurrentGoalActivityRhythmSettings = { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, preferences: { preferredWeekdays: [2, 4], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 30 }, dailyFrequency: once };
const finite: CurrentGoalActivityRhythmSettings = { rhythm: { kind: 'NONE' }, preferences: NO_RHYTHM_PREFERENCES, dailyFrequency: once };

check('R1. pause keeps target and every preference; action PAUSE', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { paused: true }); return r.ok && r.value.pauseAction === 'PAUSE' && same(r.value.rhythm, weekly.rhythm) && same(r.value.preferences, weekly.preferences); })());
check('R2. resume is action CLEAR and keeps everything else', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { paused: false }); return r.ok && r.value.pauseAction === 'CLEAR' && same(r.value.preferences, weekly.preferences); })());
check('R3. a preferences-only update keeps the pause state (KEEP)', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { preferences: { preferredTimeOfDay: 'EVENING' } }); return r.ok && r.value.pauseAction === 'KEEP' && r.value.preferences.preferredTimeOfDay === 'EVENING' && same(r.value.preferences.preferredWeekdays, [2, 4]) && r.value.preferences.preferredDurationMinutes === 30; })());
check('R4. clearing one field leaves the others', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { preferences: { preferredDurationMinutes: null } }); return r.ok && r.value.preferences.preferredDurationMinutes === null && r.value.preferences.preferredTimeOfDay === 'MORNING'; })());
check('R5. raising the target above the preferred day count is rejected (merged state validated)', !resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 } }).ok);
check('R6. raising the target together with enough days is accepted', resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferences: { preferredWeekdays: [1, 2, 4] } }).ok);
check('R7. switching to NONE clears preferences and pause (the existing { rhythm: NONE } edit keeps working)', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'NONE' } }); return r.ok && r.value.rhythm.kind === 'NONE' && same(r.value.preferences, NO_RHYTHM_PREFERENCES) && r.value.pauseAction === 'CLEAR'; })());
check('R8. switching to NONE while SETTING a preference is rejected', !resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'NONE' }, preferences: { preferredTimeOfDay: 'MORNING' } }).ok);
check('R9. switching to NONE with explicit clears is accepted', resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'NONE' }, preferences: { preferredTimeOfDay: null, preferredWeekdays: [] } }).ok);
check('R10. pausing a NONE (finite) activity is rejected', !resolveGoalActivityRhythmSettingsUpdate(finite, { paused: true }).ok);
check('R11. resuming a NONE (finite) activity is rejected', !resolveGoalActivityRhythmSettingsUpdate(finite, { paused: false }).ok);
check('R12. setting preferences on a NONE activity is rejected', !resolveGoalActivityRhythmSettingsUpdate(finite, { preferences: { preferredWeekdays: [0] } }).ok);
check('R13. making a NONE activity weekly WITH preferences in one request is accepted', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(finite, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 }, preferences: { preferredWeekdays: [0], preferredTimeOfDay: 'MORNING' } }); return r.ok && same(r.value.preferences.preferredWeekdays, [0]) && r.value.pauseAction === 'KEEP'; })());
check('R14. a rhythm-only update (R5 behavior) keeps existing preferences', (() => { const r = resolveGoalActivityRhythmSettingsUpdate(weekly, { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 1 } }); return r.ok && same(r.value.preferences, weekly.preferences) && r.value.pauseAction === 'KEEP'; })());
check('R15. resolve never mutates the current settings object', (() => { const snapshot = JSON.stringify(weekly); resolveGoalActivityRhythmSettingsUpdate(weekly, { preferences: { preferredWeekdays: [0, 1, 2] }, paused: true }); return JSON.stringify(weekly) === snapshot; })());
check('R16. NO_RHYTHM_PREFERENCES is frozen (cannot be mutated by a caller)', Object.isFrozen(NO_RHYTHM_PREFERENCES));

if (!allPassed) {
  console.error('\nSome checks FAILED.');
  process.exit(1);
}
console.log('\nAll checks passed.');
