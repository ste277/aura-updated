/**
 * Goals V2 Rhythm R5 -- narrow structural guards proving the minimum
 * setup UX stayed minimum (this ticket's own section 59 anti-complexity
 * guard) and that no Rhythm write/authority leaked into any file this
 * ticket did not intentionally touch. The broader "zero Rhythm reference
 * in Constructor/Home/Timeline/DailyAgenda/Recomposition/templates/Ask
 * Aura" sweep already lives in test/goalActivityRhythmStructuralGuards
 * .test.ts (R2) and test/goalActivityRhythmMaterializationStructuralGuards
 * .test.ts (R3) -- R5 touches none of those files, so those existing
 * guards already cover R5 for free (re-run as part of this ticket's own
 * regression list, not duplicated here).
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const rhythmPickerSrc = stripComments(read('../apps/web/components/RhythmPicker.tsx'));
const goalDetailSrc = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));
const goalsListSrc = stripComments(read('../apps/web/app/goals/GoalsListClient.tsx'));
const allSetupUiSrc = rhythmPickerSrc + goalDetailSrc + goalsListSrc;

// ============================================================
// 59. Anti-complexity guard -- this ticket's own explicit DO-NOT list.
// AURA-MR3 deliberate re-baseline (as MR1's report required): a weekday
// selector now exists, but ONLY in the post-setup edit surface
// (components/RhythmSettingsEditor.tsx, behind progressive disclosure).
// The SETUP surfaces checked here -- RhythmPicker, Goal Detail and Create
// Goal -- must still contain none, so creating a rhythm stays "how often"
// only. test/myRhythmPreferencesUi.test.ts asserts the editor side.
// ============================================================
check('59. no weekday picker (no Mon/Tue/Wed.../Sun day-of-week selector)', !/\bMon\b.*\bTue\b.*\bWed\b|weekday.*picker|pickDays|selectedDays/i.test(allSetupUiSrc));
check('27/59. no "Which days?" question anywhere', !/which days/i.test(allSetupUiSrc));
check('59. no recurrence calendar / calendar grid UI', !/recurrenceCalendar|calendarGrid|<Calendar\b/i.test(allSetupUiSrc));
check('59. no streak UI introduced by the setup flow', !/streak/i.test(allSetupUiSrc));
check('59. no reminder setup introduced by the setup flow', !/reminder/i.test(allSetupUiSrc));
check('59. no start/end recurrence date fields (recurrenceStart/recurrenceEnd/untilDate)', !/recurrenceStart|recurrenceEnd|untilDate/i.test(allSetupUiSrc));
check('23/59. no RRULE concept anywhere', !/RRULE/i.test(allSetupUiSrc));
check('59. no monthly recurrence option', !/\bmonthly\b/i.test(allSetupUiSrc));
check('59. no interval/cron syntax (no "every N days", no cron expression fields)', !/\bcron\b|every \d+ days?/i.test(allSetupUiSrc));
// (Requires an actual arithmetic/date-math operator between the two
// identifiers -- plain proximity is not evidence of inference. A naive
// "targetDate...rhythm within N chars" check false-positived on an import
// list ordering and an unrelated `&&` in a form-validity expression,
// neither of which computes anything from targetDate.)
check(
  '28. no targetDate-based frequency inference (no "weeks until"/"days remaining" arithmetic, no date subtraction feeding a rhythm/targetPerWeek value)',
  !/weeksUntil|daysRemaining|daysUntil/i.test(allSetupUiSrc) && !/targetDate[^;]*[-+][^;]*targetPerWeek|targetPerWeek[^;]*[-+][^;]*targetDate/.test(allSetupUiSrc)
);

// ============================================================
// 12/9. No title inference anywhere in the setup UI (only explicit
// SegmentedControl/number-input selection is authoritative).
// ============================================================
check('12. CreateGoalModal never inspects the Goal title text to decide a rhythm value', !/title\.(includes|match|toLowerCase\(\)\.includes)\([^)]*rhythm/i.test(goalsListSrc));
check('12. AddActivityControl never inspects the activity title text to decide a rhythm value', !/title\.(includes|match|toLowerCase\(\)\.includes)\([^)]*rhythm/i.test(goalDetailSrc));
check('9. RhythmPicker itself contains no NLP/regex-based parsing of free text into a frequency', !/parseFrequencyFromText|parseInt\(title|inferFrequency/.test(rhythmPickerSrc));

// ============================================================
// 19/18. Server authority -- route-level re-validation, never trusting a
// client-computed value as authoritative.
// ============================================================
const createGoalRouteSrc = stripComments(read('../apps/web/app/api/goals/route.ts'));
const addActivityRouteSrc = stripComments(read('../apps/web/app/api/goals/[goalId]/activities/route.ts'));
const rhythmEditRouteSrc = stripComments(read('../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/rhythm/route.ts'));
check('19. POST /api/goals validates every activityRhythms entry through the canonical R2 validator (validateGoalActivityRhythm), never trusts the client object raw', /validateGoalActivityRhythm\(/.test(createGoalRouteSrc));
check('19. POST /api/goals/[goalId]/activities validates rhythm through the canonical R2 validator', /validateGoalActivityRhythm\(/.test(addActivityRouteSrc));
// AURA-MR1 -- `rhythm` is no longer the only field on this endpoint (MR1 adds
// `preferences` and `paused`), so it is optional when another field is
// given; the request must still carry at least one field, and every field is
// still server-validated through its canonical validator.
check('19. PATCH .../rhythm validates rhythm through the canonical R2 validator, preferences through the canonical MR1 parser, and requires at least one field', /validateGoalActivityRhythm\(/.test(rhythmEditRouteSrc) && /parseGoalActivityRhythmPreferencesPatch\(/.test(rhythmEditRouteSrc) && /At least one of rhythm, preferences or paused is required/.test(rhythmEditRouteSrc));
check('18. none of the three routes coerce an invalid value (no Math.round/Math.floor/Math.abs/|| applied to a client-supplied targetPerWeek)', !/Math\.(round|floor|abs)\(.*targetPerWeek|targetPerWeek\s*\|\|/.test(createGoalRouteSrc + addActivityRouteSrc + rhythmEditRouteSrc));

// ============================================================
// 21/22/23. The edit endpoint is a pure policy UPDATE -- never touches
// plannedActivityId, status, or GoalActivityOccurrence (re-confirmed
// narrowly here against db.ts's own setGoalActivityRhythm; the live DB
// proof of the resulting behavior is in
// test/goalActivityRhythmSetupDb.test.ts's own sections 55/56).
// ============================================================
const dbSrc = stripComments(read('../apps/web/lib/db.ts'));
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found`);
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}
// AURA-MR1 -- R5's setGoalActivityRhythm was generalized into
// updateGoalActivityRhythmSettings (policy + MR1 pause/preferences in one
// UPDATE). The same invariants are re-asserted against the new writer: still
// a pure policy write that never touches plans, status or occurrences.
const setRhythmBody = functionBody(dbSrc, 'updateGoalActivityRhythmSettings');
check('21/22/23. updateGoalActivityRhythmSettings never references plannedActivityId/status/GoalActivityOccurrence (a pure policy UPDATE, this ticket\'s own section 21)', !/plannedActivityId|"status"|GoalActivityOccurrence|PlannedActivity/.test(setRhythmBody));
check('21/22/23. updateGoalActivityRhythmSettings issues exactly one UPDATE, targeting only the Rhythm policy, MR1 pause/preference columns and updatedAt', (setRhythmBody.match(/UPDATE "GoalActivity" SET/g) ?? []).length === 1 && /"rhythmKind" = \$1,\s*"rhythmTargetPerWeek" = \$2,\s*"rhythmPreferredWeekdays" = \$3::integer\[\],\s*"rhythmPreferredTimeOfDay" = \$4,\s*"rhythmPreferredDurationMinutes" = \$5,\s*"rhythmPausedAt" = CASE \$6::text WHEN 'PAUSE' THEN COALESCE\("rhythmPausedAt", now\(\)\) WHEN 'CLEAR' THEN NULL ELSE "rhythmPausedAt" END,\s*"updatedAt" = now\(\)\s*WHERE/.test(setRhythmBody) && !/INSERT\s|DELETE\s/.test(setRhythmBody));
check('21/22/23. updateGoalActivityRhythmSettings reads the current row FOR UPDATE scoped by id + goalId + userId (ownership + serialized merge)', /WHERE id = \$1 AND "goalId" = \$2 AND "userId" = \$3 FOR UPDATE/.test(setRhythmBody) && /WHERE id = \$7 AND "goalId" = \$8 AND "userId" = \$9/.test(setRhythmBody));

// ============================================================
// 24/25/26. CompletionRequirement / scheduling duration / Constructor
// stay completely independent of Rhythm input in the setup UI.
// ============================================================
check('24. the manual Add activity form has no CompletionRequirement control (no kind/targetValue/unit selector added alongside the frequency picker)', !/completionKind|completionTargetValue|completionUnit/.test(goalDetailSrc));
check('25. no duration x frequency aggregate math anywhere in the setup UI (no targetPerWeek multiplied/added with a duration value)', !/targetPerWeek\s*\*|dDurationMinutes\s*\*\s*targetPerWeek/.test(allSetupUiSrc));
check('26. dayConstructor*.ts has zero reference to activityRhythms/RhythmPicker/setGoalActivityRhythm (R5 never reaches the Constructor)', !/activityRhythms|RhythmPicker|setGoalActivityRhythm|updateGoalActivityRhythmSettings|goalActivityRhythmPreferences/.test(stripComments(read('../apps/web/lib/dayConstructor.ts'))) && !/activityRhythms|RhythmPicker|setGoalActivityRhythm|updateGoalActivityRhythmSettings|goalActivityRhythmPreferences/.test(stripComments(read('../apps/web/lib/dayConstructorOrchestrator.ts'))));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM SETUP STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM SETUP STRUCTURAL GUARD CHECKS PASSED');
