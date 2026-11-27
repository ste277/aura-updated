/**
 * AURA-MR3 -- pure + structural checks for the My Rhythm preferences UI.
 *   1. lib/rhythmPreferencesDraft.ts (imported directly): draft building,
 *      validation that mirrors the server, the minimal PATCH body, summary
 *      copy, deep links.
 *   2. Source checks: the weekday selector lives only in the post-setup
 *      editor; setup surfaces stay "how often" only (re-baselined guard 59);
 *      paused rhythms offer no planning action; one rhythm write site.
 * Rendered behaviour (clicks, failed saves, duplicate submissions) is in
 * myRhythmPreferencesEditorJsdom.test.ts; the API seam in
 * myRhythmPreferencesUiDb.test.ts.
 */
import fs from 'fs';
import path from 'path';
import {
  RHYTHM_WEEKDAY_CHIPS,
  buildRhythmSettingsPatch,
  draftFromSaved,
  formatRhythmPreferencesSummary,
  goalActivityRhythmHref,
  parseDraftDuration,
  savedRhythmSettingsFromActivity,
  toggleRhythmWeekday,
  validateRhythmSettingsDraft,
  type SavedRhythmSettings,
} from '../apps/web/lib/rhythmPreferencesDraft';
import { NO_RHYTHM_PREFERENCES, RHYTHM_TIMES_OF_DAY } from '../apps/web/lib/goalActivityRhythmPreferences';
import { createIntentRowFromGoalHandoffItem, describeRhythmTimeDeferrals, formatIntentRowSummary } from '../apps/web/lib/planDayEntry';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel: string) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const weekly3: SavedRhythmSettings = { frequency: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferences: { ...NO_RHYTHM_PREFERENCES, preferredWeekdays: [] }, oncePerDay: true };
const configured: SavedRhythmSettings = { frequency: { kind: 'N_PER_WEEK', targetPerWeek: 3 }, preferences: { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }, oncePerDay: true };

// ---------------------------------------------------------------
// Draft <-> saved
// ---------------------------------------------------------------
check('P1. draftFromSaved mirrors saved settings (duration as text)', same(draftFromSaved(configured), { frequency: configured.frequency, preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', durationText: '45' }));
check('P2. an untouched draft builds no PATCH (no spurious write)', buildRhythmSettingsPatch(draftFromSaved(configured), configured) === null);
check('P3. weekday chips are Monday-first but keep the stored 0=Sunday encoding', same(RHYTHM_WEEKDAY_CHIPS.map((c) => c.value), [1, 2, 3, 4, 5, 6, 0]) && RHYTHM_WEEKDAY_CHIPS[6].short === 'Sun');
check('P4. toggling a day keeps ascending order; toggling twice is a no-op', same(toggleRhythmWeekday([1, 5], 3), [1, 3, 5]) && same(toggleRhythmWeekday(toggleRhythmWeekday([1, 3, 5], 0), 0), [1, 3, 5]));

// ---------------------------------------------------------------
// Minimal PATCH bodies -- each preference independently
// ---------------------------------------------------------------
check('P5. days only', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), preferredWeekdays: [1, 2, 3, 5] }, configured), { preferences: { preferredWeekdays: [1, 2, 3, 5] } }));
check('P6. time only', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), preferredTimeOfDay: 'EVENING' }, configured), { preferences: { preferredTimeOfDay: 'EVENING' } }));
check('P7. duration only', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), durationText: '60' }, configured), { preferences: { preferredDurationMinutes: 60 } }));
check('P8. frequency only', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), frequency: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }, configured), { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }));
check('P9. clearing all three sends [] / null / null', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), preferredWeekdays: [], preferredTimeOfDay: null, durationText: '' }, configured), { preferences: { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null } }));
check('P10. scenario 1 from scratch: one body with rhythm and all three preferences', same(buildRhythmSettingsPatch({ ...draftFromSaved(weekly3), preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', durationText: '45' }, weekly3), { preferences: { preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 } }));
check('P11. switching to Once sends ONLY { rhythm: NONE } (server clears preferences; never sends a preference for a non-weekly activity)', same(buildRhythmSettingsPatch({ ...draftFromSaved(configured), frequency: { kind: 'NONE' } }, configured), { rhythm: { kind: 'NONE' } }));
check('P12. Once -> weekly with preferences sends both together', same(buildRhythmSettingsPatch({ frequency: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, preferredWeekdays: [2, 4], preferredTimeOfDay: null, durationText: '' }, { frequency: { kind: 'NONE' }, preferences: NO_RHYTHM_PREFERENCES, oncePerDay: true }), { rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, preferences: { preferredWeekdays: [2, 4] } }));

// ---------------------------------------------------------------
// Validation mirrors the server
// ---------------------------------------------------------------
const tooFew = validateRhythmSettingsDraft({ ...draftFromSaved(configured), preferredWeekdays: [1, 3] }, configured);
check('V1. 3x/week on 2 days is blocked with an explanation (no silent scheduling elsewhere)', tooFew.errors.length === 1 && /needs at least 3 preferred days/.test(tooFew.errors[0]) && buildRhythmSettingsPatch({ ...draftFromSaved(configured), preferredWeekdays: [1, 3] }, configured) === null);
check('V2. raising frequency above the chosen days is blocked too', validateRhythmSettingsDraft({ ...draftFromSaved(configured), frequency: { kind: 'N_PER_WEEK', targetPerWeek: 4 } }, configured).errors.length === 1);
check('V3. MULTIPLE_PER_DAY activities are not held to one-day-per-session', validateRhythmSettingsDraft({ ...draftFromSaved(configured), preferredWeekdays: [1] }, { ...configured, oncePerDay: false }).errors.length === 0);
check('V4. no days = any day (allowed, with a note)', validateRhythmSettingsDraft({ ...draftFromSaved(configured), preferredWeekdays: [] }, configured).errors.length === 0 && validateRhythmSettingsDraft({ ...draftFromSaved(configured), preferredWeekdays: [] }, configured).notes.some((n) => /Any day/.test(n)));
for (const bad of ['5', '14', '361', '45.5', 'abc', '-30']) {
  check(`V5. invalid duration "${bad}" is blocked`, !parseDraftDuration(bad).ok && buildRhythmSettingsPatch({ ...draftFromSaved(configured), durationText: bad }, configured) === null);
}
check('V6. duration bounds 15 and 360 are accepted; blank = default', same(parseDraftDuration('15'), { ok: true, value: 15 }) && same(parseDraftDuration('360'), { ok: true, value: 360 }) && same(parseDraftDuration(' '), { ok: true, value: null }));
check('V7. an invalid custom frequency (null) blocks saving', validateRhythmSettingsDraft({ ...draftFromSaved(configured), frequency: null }, configured).errors.length === 1 && buildRhythmSettingsPatch({ ...draftFromSaved(configured), frequency: null }, configured) === null);
check('V8. switching to Once with saved preferences explains they will be cleared', validateRhythmSettingsDraft({ ...draftFromSaved(configured), frequency: { kind: 'NONE' } }, configured).notes.some((n) => /cleared/.test(n)));

// ---------------------------------------------------------------
// Read-model adapter, summary, deep link
// ---------------------------------------------------------------
check('A1. legacy activity without MR1 fields = weekly, no preferences, once-per-day', same(savedRhythmSettingsFromActivity({ rhythm: { kind: 'N_PER_WEEK', targetPerWeek: 2 } }), { frequency: { kind: 'N_PER_WEEK', targetPerWeek: 2 }, preferences: { preferredWeekdays: [], preferredTimeOfDay: null, preferredDurationMinutes: null }, oncePerDay: true }));
check('A2. daily frequency mapping matches the server rule (only enforceable ONCE_PER_DAY needs distinct days)', savedRhythmSettingsFromActivity({ rhythm: { kind: 'NONE' }, dailyFrequencyKind: null }).oncePerDay && savedRhythmSettingsFromActivity({ rhythm: { kind: 'NONE' }, dailyFrequencyKind: 'ONCE_PER_DAY' }).oncePerDay && !savedRhythmSettingsFromActivity({ rhythm: { kind: 'NONE' }, dailyFrequencyKind: 'MULTIPLE_PER_DAY' }).oncePerDay && !savedRhythmSettingsFromActivity({ rhythm: { kind: 'NONE' }, dailyFrequencyKind: 'CUSTOM' }).oncePerDay);
check('S1. summary "Mon, Wed, Fri · Morning · 45 min" (Monday-first, regardless of stored order)', formatRhythmPreferencesSummary({ preferredWeekdays: [1, 3, 5], preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 }) === 'Mon, Wed, Fri · Morning · 45 min' && formatRhythmPreferencesSummary({ preferredWeekdays: [0, 6], preferredTimeOfDay: null, preferredDurationMinutes: null }) === 'Sat, Sun');
check('S2. no preferences -> no summary line', formatRhythmPreferencesSummary(NO_RHYTHM_PREFERENCES) === null && formatRhythmPreferencesSummary(undefined) === null);
check('S3. every engine time-of-day has a user-facing label', RHYTHM_TIMES_OF_DAY.every((t) => formatRhythmPreferencesSummary({ preferredWeekdays: [], preferredTimeOfDay: t, preferredDurationMinutes: null }) !== null && !/_/.test(formatRhythmPreferencesSummary({ preferredWeekdays: [], preferredTimeOfDay: t, preferredDurationMinutes: null })!)));
check('L1. Home deep link targets the activity anchor on Goal Detail', goalActivityRhythmHref('g 1', 'a/2') === '/goals/g%201#activity-a%2F2');

// ---------------------------------------------------------------
// Plan My Day ("Just today") shows the carried-forward preferences
// ---------------------------------------------------------------
{
  const withPrefs = createIntentRowFromGoalHandoffItem({ id: 'ga1', title: 'Strength training', activityId: 'workout', preferences: { preferredTimeOfDay: 'MORNING', preferredDurationMinutes: 45 } }, null);
  const noPrefs = createIntentRowFromGoalHandoffItem({ id: 'ga2', title: 'Stretch', activityId: null }, null);
  check('PD1. a rhythm handoff row shows its preferred time and length instead of "Automatic"', formatIntentRowSummary(withPrefs, 'TODAY') === 'Flexible · Morning · 45 min');
  check('PD2. a row without rhythm preferences is unchanged ("Flexible · Automatic")', formatIntentRowSummary(noPrefs, 'TODAY') === 'Flexible · Automatic');
  check('PD3. an explicit row duration still wins over the rhythm default', formatIntentRowSummary({ ...withPrefs, durationMinutes: 60 }, 'TODAY') === 'Flexible · Morning · 60 min');
  check('PD4. a fixed-time row does not show the rhythm time-of-day', formatIntentRowSummary({ ...withPrefs, timeMode: 'FIXED', fixedTime: '07:00' }, 'TODAY') === 'Specific time 7:00 AM · 45 min');
  const deferred = [{ intentId: withPrefs.id, primaryReason: 'NO_CANDIDATES' }, { intentId: noPrefs.id, primaryReason: 'NO_CANDIDATES' }];
  const notes = describeRhythmTimeDeferrals([withPrefs, noPrefs], deferred);
  check('PD5. a rhythm deferred by its preferred time gets a specific explanation and a next step', notes.length === 1 && /Strength training is set to mornings, and no suitable morning time is left/.test(notes[0]) && /another day/.test(notes[0]));
  check('PD6. no note for rows without a time preference, for fixed-time rows, or for other reasons', describeRhythmTimeDeferrals([{ ...withPrefs, timeMode: 'FIXED', fixedTime: '07:00' }], deferred).length === 0 && describeRhythmTimeDeferrals([withPrefs], [{ intentId: withPrefs.id, primaryReason: 'BLOCKED_BY_COMMITMENT' }]).length === 0);
}

// ---------------------------------------------------------------
// Structural
// ---------------------------------------------------------------
const editorSrc = stripComments(read('../apps/web/components/RhythmSettingsEditor.tsx'));
const goalDetailSrc = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));
const setupSrc = stripComments(read('../apps/web/components/RhythmPicker.tsx')) + goalDetailSrc + stripComments(read('../apps/web/app/goals/GoalsListClient.tsx'));
const cardSrc = stripComments(read('../apps/web/components/GoalRhythmSuggestionsCard.tsx'));
const pausedNoteSrc = stripComments(read('../apps/web/components/PausedRhythmsNote.tsx'));
check('G1. the weekday selector exists in the editor (RHYTHM_WEEKDAY_CHIPS, aria-pressed toggles)', /RHYTHM_WEEKDAY_CHIPS\.map/.test(editorSrc) && /aria-pressed=\{selected\}/.test(editorSrc));
check('G2. setup surfaces (RhythmPicker, Goal Detail, Create Goal) still have no weekday picker (guard 59 intent kept)', !/\bMon\b.*\bTue\b.*\bWed\b|weekday.*picker|pickDays|selectedDays|RHYTHM_WEEKDAY_CHIPS/i.test(setupSrc));
check('G3. progressive disclosure: preferences hidden behind "Add days, time or length" unless already set', /showPreferences && \(/.test(editorSrc) && /Add days, time or length/.test(editorSrc));
check('G4. the editor has exactly one fetch and it is the PATCH .../rhythm endpoint', (editorSrc.match(/fetch\(/g) ?? []).length === 1 && /fetch\(endpoint, \{ method: 'PATCH'/.test(editorSrc));
check('G5. duplicate-submission guard: a synchronous in-flight ref, checked before every write', /const inFlight = useRef\(false\)/.test(editorSrc) && (editorSrc.match(/if \(inFlight\.current/g) ?? []).length === 2);
check('G6. Cancel restores the saved draft and is disabled while saving', /const cancel = \(\) => \{\s*if \(saving\) return;\s*setDraft\(draftFromSaved\(saved\)\)/.test(editorSrc));
check('G7. a failed save keeps the draft and shows the reason (no reset)', /if \(failure\) \{\s*\/?\/?[^\n]*\n?\s*setError\(failure\);\s*return;/.test(editorSrc) || /if \(failure\) \{[\s\S]{0,120}setError\(failure\);\s*return;/.test(editorSrc));
check('G8. Pause/Resume send only { paused } -- never preferences', /send\(\{ paused: !paused \}\)/.test(editorSrc));
check('G9. Goal Detail: a paused rhythm is never selectable for planning and shows a Paused badge', /a\.rhythmPaused !== true && \(/.test(goalDetailSrc) && /label="Paused"/.test(goalDetailSrc));
check('G10. Home card links to the rhythm settings without adding a second .map()', /goalActivityRhythmHref\(suggestion\.goalId, suggestion\.goalActivityId\)/.test(cardSrc) && (cardSrc.match(/\.map\(/g) ?? []).length === 1);
check('G11. Home paused note offers "Resume or edit" via the same deep link', /goalActivityRhythmHref\(paused\.goalId, paused\.goalActivityId\)/.test(pausedNoteSrc) && /Resume or edit/.test(pausedNoteSrc));
check('G12. no new migration was added by MR3 (re-baselined by AURA-REM-01: only its own additive 0054 heartbeat migration is allowed; re-baselined by AURA-MP-1 for its additive 0056)', !fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).some((d) => !['0054_reminder_dispatch_heartbeat', '0056_my_people_foundation'].includes(d) && /^005[4-9]_|^00[6-9]\d_/.test(d)));
check('G13. mobile layout: weekdays are one 7-column row of 44px-high targets; no control below 44px high', /gridTemplateColumns: 'repeat\(7, minmax\(0, 1fr\)\)'/.test(editorSrc) && /minHeight: 44,/.test(editorSrc) && !/minHeight: (3\d|[12]\d)\b/.test(editorSrc));
check('G14. time of day uses wrapping chips (no nowrap segmented control that overflows 320px)', !/SegmentedControl/.test(editorSrc) && /aria-label="Preferred time"/.test(editorSrc));

console.log(allPassed ? '\nALL MR3 UI CHECKS PASSED' : '\nSOME MR3 UI CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
