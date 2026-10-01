/**
 * Goals V2 Rhythm R5 -- UI regression suite for the minimum Rhythm setup
 * UX (this ticket's own section 57/58). Source-reading convention (this
 * repository has no component-rendering harness), same style as
 * goalPlanningHandoffUi.test.ts / goalActivityRhythmGoalDetailUi.test.ts.
 * Live save/persistence/R4-display-after-save is proven in
 * test/goalActivityRhythmSetupDb.test.ts (sections 47/48) -- this file
 * covers what only source-reading can prove: default state, exact-N
 * entry, client-side validation wiring, and the ongoing/finite template
 * distinction.
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

// ============================================================
// 57. UI TEST -- Manual Add.
// ============================================================
check('57. AddActivityControl defaults rhythm state to Once (NONE)', /const \[rhythm, setRhythm\] = useState<RhythmPickerValue \| null>\(\{ kind: 'NONE' \}\)/.test(goalDetailSrc));
check('57. AddActivityControl wires RhythmPicker into its own form', /<RhythmPicker\s/.test(goalDetailSrc));
check('57. AddActivityControl disables submission when rhythm is null (an unresolved Custom entry) -- this ticket\'s own section 44', /disabled=\{!trimmed \|\| rhythm === null\}/.test(goalDetailSrc));
check('57. the Add activity request body includes the chosen rhythm', /body: JSON\.stringify\(\{ title: trimmed, rhythm \}\)/.test(goalDetailSrc));
check('57. RhythmPicker itself defaults to the ONCE preset for a NONE value', /presetForRhythmValue\(value: RhythmPickerValue\): RhythmPreset \{\s*if \(value\.kind === 'NONE'\) return 'ONCE';/.test(rhythmPickerSrc));
check('57. the 3 fixed weekly presets are exactly 2/3/5 (never a hidden extra option)', /value: '2'.*value: '3'.*value: '5'/s.test(rhythmPickerSrc));
check('57. Custom accepts an arbitrary positive integer (no UI-imposed maximum -- no "max=" prop on the custom input)', /type="number"/.test(rhythmPickerSrc) && !/max=\{?\d/.test(rhythmPickerSrc));
check('57. Custom rejects empty/fractional/zero/negative input (never silently falls back to NONE)', /!Number\.isInteger\(n\) \|\| n <= 0/.test(rhythmPickerSrc) && /return null/.test(rhythmPickerSrc));

// ============================================================
// Goals V2 Rhythm R5 -- the edit affordance (section 20) -- present on
// every row, available regardless of derivedState.
// ============================================================
check('20. RhythmEditor is rendered unconditionally for every primary-list row (not gated on derivedState)', /<RhythmEditor activity=\{activity\} onSaved=\{onChanged\} \/>/.test(goalDetailSrc));
check('20. the edit affordance PATCHes the one allowed Rhythm edit endpoint', /\/api\/goals\/\$\{activity\.goalId\}\/activities\/\$\{activity\.id\}\/rhythm/.test(goalDetailSrc) && /method: 'PATCH'/.test(goalDetailSrc));
check('6. "Once" is never a persisted Rhythm kind in client code -- RhythmEditor/RhythmPicker only ever construct { kind: \'NONE\' } or { kind: \'N_PER_WEEK\', ... }, never { kind: \'ONCE\' }', !/kind:\s*'ONCE'/.test(goalDetailSrc) && !/kind:\s*'ONCE'/.test(rhythmPickerSrc));

// ============================================================
// 5/46. User-facing language -- never implementation vocabulary.
// ============================================================
const copySurfaces = goalDetailSrc + goalsListSrc + rhythmPickerSrc;
check('5/46. no "N_PER_WEEK" literal ever appears as rendered copy (only as a TypeScript kind tag compared in code, never inside a JSX text node)', !/>\s*\{?\s*N_PER_WEEK\s*\}?\s*</.test(copySurfaces));
check('46. no "Rhythm policy"/"recurrence rule"/"Configure recurrence"/"Habit schedule"/"Repeat rule" copy anywhere', !/Rhythm policy|recurrence rule|Configure recurrence|Habit schedule|Repeat rule/i.test(copySurfaces));
check('46. the picker\'s own question uses the approved light phrasing', /How often would help\?/.test(rhythmPickerSrc));

// ============================================================
// 58. UI TEST -- Template.
// ============================================================
check('58. CreateGoalModal only shows the frequency section when isOngoingTemplate is true', /\{isOngoingTemplate && \(/.test(goalsListSrc));
check('11/58. isOngoingTemplate is derived from GOAL_TEMPLATE_LIKELY_ONGOING, never computed from title text or any other inference', /GOAL_TEMPLATE_LIKELY_ONGOING\[activeCategory\]/.test(goalsListSrc));
check('15/58. every per-activity rhythm in Create Goal defaults to Once (NONE) -- no exact N preselected', /GOAL_TEMPLATES\[nextCategory\]\.map\(\(\) => \(\{ kind: 'NONE' \}\)\)/.test(goalsListSrc));
check('58. the user can submit with every activity left at Once (rhythmsValid does not require any non-NONE choice)', /activityRhythms\.every\(\(v\) => v !== null\)/.test(goalsListSrc) && !/activityRhythms\.every\(\(v\) => v !== null && v\.kind === 'N_PER_WEEK'\)/.test(goalsListSrc));
check('13. Rhythm belongs to GoalActivity, never a single Goal-level frequency copied across activities -- one picker PER activity, not one shared picker', /templateActivities\.map\(\(templateActivity, index\)/.test(goalsListSrc));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM SETUP UI CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM SETUP UI CHECKS PASSED');
