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
check('19. PATCH .../rhythm validates through the canonical R2 validator and requires it (never optional on this endpoint)', /validateGoalActivityRhythm\(/.test(rhythmEditRouteSrc) && /rhythm is required/.test(rhythmEditRouteSrc));
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
const setRhythmBody = functionBody(dbSrc, 'setGoalActivityRhythm');
check('21/22/23. setGoalActivityRhythm never references plannedActivityId/status/GoalActivityOccurrence (a pure policy UPDATE, this ticket\'s own section 21)', !/plannedActivityId|"status"|GoalActivityOccurrence/.test(setRhythmBody));
check('21/22/23. setGoalActivityRhythm issues exactly one UPDATE targeting only rhythmKind/rhythmTargetPerWeek/updatedAt', /UPDATE "GoalActivity" SET "rhythmKind" = \$1, "rhythmTargetPerWeek" = \$2, "updatedAt" = now\(\)/.test(setRhythmBody));

// ============================================================
// 24/25/26. CompletionRequirement / scheduling duration / Constructor
// stay completely independent of Rhythm input in the setup UI.
// ============================================================
check('24. the manual Add activity form has no CompletionRequirement control (no kind/targetValue/unit selector added alongside the frequency picker)', !/completionKind|completionTargetValue|completionUnit/.test(goalDetailSrc));
check('25. no duration x frequency aggregate math anywhere in the setup UI (no targetPerWeek multiplied/added with a duration value)', !/targetPerWeek\s*\*|dDurationMinutes\s*\*\s*targetPerWeek/.test(allSetupUiSrc));
check('26. dayConstructor*.ts has zero reference to activityRhythms/RhythmPicker/setGoalActivityRhythm (R5 never reaches the Constructor)', !/activityRhythms|RhythmPicker|setGoalActivityRhythm/.test(stripComments(read('../apps/web/lib/dayConstructor.ts'))) && !/activityRhythms|RhythmPicker|setGoalActivityRhythm/.test(stripComments(read('../apps/web/lib/dayConstructorOrchestrator.ts'))));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM SETUP STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM SETUP STRUCTURAL GUARD CHECKS PASSED');
