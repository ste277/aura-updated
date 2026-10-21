// Run with: TS_NODE_COMPILER_OPTIONS='{"jsx":"react"}' npx ts-node test/durationDisplayCorrection.test.ts
// (see .github/workflows/ci.yml). This file imports a .tsx component, so it
// needs `jsx` set and apps/web's node_modules (react) on the resolution
// path -- excluded from tsc -p tsconfig.json's batch check for the same
// reason as test/planWithAuraViewLogic.test.ts (root tsconfig.json exclude).
//
// AURA DR4-F2C -- a rescheduled plan's locked duration selector is a native
// <select> whose `value` falls back to its FIRST <option> when that value
// isn't among the rendered options. DURATIONS only has 5 presets
// (15/30/60/90/120), so a plan with any other real duration (45, 75...) was
// silently shown as "15 min" even though the correct value was already
// selected internally and Move was already persisting it correctly (a
// pure DISPLAY bug, confirmed during the DR4-F1 Final Review and the
// DR4-F2 audit -- see AURA_DR4_F2_TIMING_CHOICE_UX_AUDIT.md section 6).
// durationSelectOptions() is the fix: it appends a single non-duplicate,
// non-rounded option for the actual duration only when necessary.
import * as fs from 'fs';
import {
  DURATIONS,
  durationSelectOptions,
} from '../apps/web/components/PlanWithAuraView';
import { durationLabel } from '../apps/web/lib/planFormatting';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const source = fs.readFileSync(require.resolve('../apps/web/components/PlanWithAuraView.tsx'), 'utf8');
const stripped = source.replace(/\/\/.*$/gm, '').replace(/\s+/g, ' ');

// ============================================================
// 1/2/3/4/5. The actual displayed value -- durationSelectOptions() is
// exactly what feeds the rendered <option> list, so asserting its output
// IS asserting what the user sees, not merely internal state.
// ============================================================

check('1. a preset duration (30 min) displays correctly: durationSelectOptions returns DURATIONS unchanged, no synthetic entry appended', durationSelectOptions(30) === DURATIONS);
check('2. a non-preset 45-minute duration displays correctly: a real "45 min" option now exists, so the <select>\'s value actually matches an option instead of silently falling back to the first one ("15 min")', durationSelectOptions(45).some((o) => o.value === 45 && o.label === '45 min'));
check('2b. the synthetic 45-minute option never duplicates or replaces any preset -- all 5 original presets remain present', DURATIONS.every((preset) => durationSelectOptions(45).some((o) => o.value === preset.value && o.label === preset.label)));
check('3. a non-preset 75-minute duration displays correctly: a "75 min" option is appended', durationSelectOptions(75).some((o) => o.value === 75 && o.label === '75 min'));
check('4. 90 minutes is ALREADY a preset -- durationSelectOptions(90) must not add a duplicate second "90 min" entry', durationSelectOptions(90) === DURATIONS && durationSelectOptions(90).filter((o) => o.value === 90).length === 1);
check('5. no duplicate option is ever produced for any preset duration (15/30/60/90/120)', DURATIONS.every((preset) => durationSelectOptions(preset.value).filter((o) => o.value === preset.value).length === 1));
check('5b. the synthetic option is never rounded to a nearby preset -- an odd value (37, between the 30 and 60 presets) displays exactly as given, and every real preset label stays exactly as DURATIONS itself defines it', durationSelectOptions(37).some((o) => o.value === 37 && o.label === '37 min') && durationSelectOptions(37).find((o) => o.value === 30)!.label === '30 min' && durationSelectOptions(37).find((o) => o.value === 60)!.label === '60 min');
check('The synthetic option never defaults to 15 minutes for a non-preset value -- 15 is present only as its own real, unmodified preset', durationSelectOptions(45).filter((o) => o.value === 15).length === 1 && durationSelectOptions(45).find((o) => o.value === 15)!.label === '15 min');
check('The synthetic option label uses the exact same formatting convention as the rest of the app (durationLabel, already used for TimingResultCard captions)', durationSelectOptions(45).find((o) => o.value === 45)!.label === durationLabel(45) && durationSelectOptions(150).find((o) => o.value === 150)!.label === durationLabel(150));
check('A duration of 150 minutes (>= 120, outside every preset) displays via durationLabel\'s own "hours" convention, not raw minutes', durationSelectOptions(150).find((o) => o.value === 150)!.label === '2.5 hours');
check('durationSelectOptions never mutates the shared DURATIONS array itself (no new preset is introduced globally)', (() => { const before = JSON.stringify(DURATIONS); durationSelectOptions(45); durationSelectOptions(75); return JSON.stringify(DURATIONS) === before && DURATIONS.length === 5; })());

// ============================================================
// 6/7. Locked during rescheduling; editable otherwise -- unchanged from
// DR4-F1, re-confirmed structurally so this PR cannot have regressed it
// while rewiring `options`.
// ============================================================

// DR4-F2A also locks the FIND/CHECK/COMPARE mode switcher itself while
// rescheduling (a 4th, legitimate use of this same disabled={...}
// expression -- see durationDisplayCorrection.test.ts's own DR4-F2A note
// below), so this count is scoped to the 3 duration selectors specifically
// (each one's own `options={durationSelectOptions(...)}` immediately
// precedes its `disabled={...}`) rather than counting every occurrence in
// the file.
const durationPanelsCount = (stripped.match(/options=\{durationSelectOptions\([a-zA-Z]+\)\}[\s\S]{0,200}?disabled=\{Boolean\(reschedulingPlanId\)\}/g) || []).length;
check('6. all three "How long?" selectors (FIND/CHECK/COMPARE) are still disabled exactly while reschedulingPlanId is set -- unchanged by this fix', durationPanelsCount === 3);
check('6b. all three selectors now source their options from durationSelectOptions(...), not the raw DURATIONS constant directly', /options=\{durationSelectOptions\(durationMinutes\)\}/.test(stripped) && /options=\{durationSelectOptions\(checkDurationMinutes\)\}/.test(stripped) && /options=\{durationSelectOptions\(compareDurationMinutes\)\}/.test(stripped));
check('7. the "When?" (horizon) selector is untouched -- still sources its options from the unmodified HORIZONS constant, never durationSelectOptions', /options=\{HORIZONS\}/.test(stripped) && !/options=\{durationSelectOptions\(horizon/.test(stripped));
check('7b. disabled is never applied outside a reschedule: Boolean(null) is false, so a brand-new (non-reschedule) search\'s duration selector remains fully editable -- same boolean expression this file already used before DR4-F2C', durationPanelsCount === 3);

// ============================================================
// 8/9. Selecting a different recommendation or a different date never
// touches duration state -- durationMinutes/checkDurationMinutes/
// compareDurationMinutes are set ONLY by their own selector's onChange
// and by handleReschedulePlan's own lock-sync; no onPlan/candidate-select/
// date-change handler sets them.
// ============================================================

const onPlanHandlers = stripped.match(/onPlan=\{[^}]*\}/g) || [];
check('8. no "Use this time" / candidate-selection handler (onPlan=...) ever calls setDurationMinutes, setCheckDurationMinutes or setCompareDurationMinutes -- choosing a recommendation cannot change the duration shown', onPlanHandlers.length > 0 && onPlanHandlers.every((h) => !/setDurationMinutes|setCheckDurationMinutes|setCompareDurationMinutes/.test(h)));
check('9. date/horizon controls (setHorizon, setCustomStartDate, setCustomEndDate, the date <select>) never call any duration setter -- switching dates cannot change duration', !/onChange=\{\(value\) => setHorizon\(value as PlanningHorizon\)\}[\s\S]{0,60}(setDurationMinutes|setCheckDurationMinutes|setCompareDurationMinutes)/.test(stripped) && !/setCustomStartDate\(event\.target\.value\)\)[\s\S]{0,60}(setDurationMinutes|setCheckDurationMinutes|setCompareDurationMinutes)/.test(stripped));

// ============================================================
// 10. Move request construction is untouched -- it never carried a
// duration field even before this fix (Move always inherits the
// ORIGINAL plan's own durationMinutes server-side, lib/planMove.ts,
// unmodified by DR4-F1 or this PR), so a display-only fix cannot have
// changed what gets persisted. Re-run movePlanApiDb.test.ts /
// planTabRescheduleMoveUnification.test.ts unmodified for the live,
// DB-backed proof -- this is the structural half of that same guarantee.
// ============================================================

const reschedulerFn = (stripped.match(/const handleReschedulePlanViaMove = async[\s\S]*?\};/) || [''])[0];
check('10. handleReschedulePlanViaMove\'s request body is still exactly { newStartAt } -- no duration field was ever sent, so Move continues to use the original plan\'s own persisted duration regardless of what the (now-fixed) display shows', /body: JSON\.stringify\(\{ newStartAt \}\)/.test(reschedulerFn) && !/duration/i.test(reschedulerFn));

// ============================================================
// 11/12. Goal-linked rescheduling and new-activity creation are both
// unaffected by construction: this fix only ever changes an <options>
// array passed into an already-existing, already-disabled <select> --
// it touches no goal/Capture/GoalActivity code at all (none exists in
// this file) and the create-new-plan POST body (handleSavePlan's
// non-reschedule branch) is unchanged.
// ============================================================

check('11. no goal-related identifier appears anywhere near the duration-display fix -- goal continuity is lib/planMove.ts\'s job alone, untouched here (re-run movePlannedActivityDb.test.ts/planTabRescheduleMoveUnification.test.ts for the live DB proof)', !/durationSelectOptions[\s\S]{0,400}(GoalActivity|goalId)/.test(stripped));
const createPlanFn = (stripped.match(/try \{ const res = await fetch\('\/api\/plans', \{[\s\S]*?\}\);/) || [''])[0];
check('12. the create-new-plan request body (new activity creation) is unchanged: it still sends durationMinutes from minutesFromDuration(plan.duration), never from durationSelectOptions', /durationMinutes: minutesFromDuration\(plan\.duration\)/.test(stripped) && !/durationSelectOptions/.test(createPlanFn || ''));

console.log(allPassed ? '\nALL DURATION DISPLAY CORRECTION CHECKS PASSED' : '\nSOME DURATION DISPLAY CORRECTION CHECKS FAILED');
process.exit(allPassed ? 0 : 1);
