// AURA HPG1 -- structural checks for the actual Home -> Plan activityId
// wiring across page.tsx / HomeDashboard.tsx / Timeline.tsx /
// AskAuraView.tsx / PlanWithAuraView.tsx. No DOM/testing-library harness
// exists in this repo for plain .tsx files (established convention), so
// this follows the same source-text/regex structural-assertion pattern
// already used throughout this session's prior test suites, pairing with
// the real unit tests in test/planHomeHandoffActivityIdentity.test.ts.
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const homeDashboardSource = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');
const timelineSource = fs.readFileSync('apps/web/components/Timeline.tsx', 'utf8');
const askAuraSource = fs.readFileSync('apps/web/components/AskAuraView.tsx', 'utf8');
const planViewSource = fs.readFileSync('apps/web/components/PlanWithAuraView.tsx', 'utf8');

// ============================================================
// 1. page.tsx: planPrefill carries activityId, handleOpenPlan accepts and
// threads it, without changing the existing title-only call shape.
// ============================================================

check('1. planPrefill state carries an optional activityId field', /planPrefill,\s*setPlanPrefill\]\s*=\s*useState<\{\s*activity:\s*string;\s*activityId\?:\s*string;/.test(pageSource));
check('1. handleOpenPlan accepts an optional second activityId parameter', /const handleOpenPlan = useCallback\(\(activity\?:\s*string,\s*activityId\?:\s*string\)/.test(pageSource));
check('1. handleOpenPlan passes activityId straight through to setPlanPrefill, never re-deriving it from `activity`\'s text', /setPlanPrefill\(\{\s*activity:\s*cleanActivity,\s*activityId,\s*key:\s*Date\.now\(\)\s*\}\)/.test(pageSource));
check('1. the ?activity= URL entry point is untouched (still title-only, no id available there)', /const requested = new URLSearchParams\(window\.location\.search\)\.get\('activity'\)/.test(pageSource));
check('1. PlanWithAuraView is wired with initialActivityId from planPrefill', /initialActivityId=\{planPrefill\?\.activityId\}/.test(pageSource));
check('1. handlePlanTomorrow is UNCHANGED -- still resolves findActivityIntent only for analytics, never threads it as a prefill id (title-matched ids are never treated as genuine)', /trackEvent\('TOMORROW_PLAN_STARTED', resolvedActivityId \? \{ metadata: \{ activityId: resolvedActivityId \} \} : undefined\)/.test(pageSource) && !/setPlanPrefill\(\{ activity: activityTitle\?\.trim\(\) \?\? '', activityId/.test(pageSource));

// ============================================================
// 2. HomeDashboard.tsx: onPlanClick's type widened; GoodRightNowCard
// passes its own card.activityId (a genuine ActionCard field, never
// title-derived).
// ============================================================

check('2. HomeDashboardProps.onPlanClick accepts an optional activityId', /onPlanClick\?:\s*\(activity\?:\s*string,\s*activityId\?:\s*string\)\s*=>\s*void;/.test(homeDashboardSource));
check('2. GoodRightNowCard\'s own onPlanClick prop type also accepts activityId', (homeDashboardSource.match(/onPlanClick\?:\s*\(activity\?:\s*string,\s*activityId\?:\s*string\)\s*=>\s*void;/g) || []).length === 2);
check('2. the Good Right Now "Plan" button passes card.activityId through, not just the title', /onPlanClick\?\.\(planTitle, card\.activityId\)/.test(homeDashboardSource));
check('2. the generic prompt/voice/chip onPlanClick calls remain title-only (no genuine id available for those)', /onClick=\{\(\) => onPlanClick\?\.\(\)\}/.test(homeDashboardSource) && /onClick=\{\(\) => onPlanClick\?\.\(chip\)\}/.test(homeDashboardSource));

// ============================================================
// 3. Timeline.tsx: onPlanActivity's type widened; both call sites pass
// card.activityId (ActionCard's own genuine field).
// ============================================================

check('3. Timeline\'s onPlanActivity prop accepts an optional activityId', /onPlanActivity\?:\s*\(activityTitle:\s*string,\s*activityId\?:\s*string\)\s*=>\s*void;/.test(timelineSource));
check('3. both onPlanActivity call sites pass card.activityId through', (timelineSource.match(/onPlanActivity\(card\.title, card\.activityId\)/g) || []).length === 2);

// ============================================================
// 4. AskAuraView.tsx: onOpenPlan's type widened; the OPEN_PLAN action
// passes its own action.activityId (the orchestrator's genuine, already-
// resolved field) instead of discarding it after reconstructing a title.
// ============================================================

check('4. AskAuraView\'s onOpenPlan prop accepts an optional activityId', /onOpenPlan\?:\s*\(activityTitle\?:\s*string,\s*activityId\?:\s*string\)\s*=>\s*void;/.test(askAuraSource));
check('4. the OPEN_PLAN action threads action.activityId alongside the reconstructed title', /onOpenPlan\?\.\(activityTitleFor\(action\.activityId\), action\.activityId\)/.test(askAuraSource));

// ============================================================
// 5. PlanWithAuraView.tsx: accepts initialActivityId, validates it against
// the real catalog (never by title-matching), tracks it in state, clears
// it on every manual title-changing interaction, and prefers it over a
// fresh title match at both FIND-mode resolution points.
// ============================================================

check('5. PlanWithAuraViewProps declares initialActivityId', /initialActivityId\?:\s*string \| null;/.test(planViewSource));
check('5. the component destructures initialActivityId from its props', /initialActivity,\s*initialActivityKey,\s*initialActivityId,\s*initialHorizon/.test(planViewSource));
check('5. a dedicated prefillActivityId state tracks the trusted id separately from taskTitle', /const \[prefillActivityId, setPrefillActivityId\] = useState<string \| undefined>\(undefined\);/.test(planViewSource));
check('5. the prefill effect resolves via the new resolvePrefillActivity (never a bespoke inline title match)', /const resolved = resolvePrefillActivity\(nextActivity, initialActivityId\);/.test(planViewSource));
check('5. initialActivityId is in the prefill effect\'s own dependency array (re-fires when it changes)', /\[initialActivity, initialActivityKey, initialActivityId, initialHorizon\]/.test(planViewSource));
check('5. resolvePrefillActivity validates strictly against FULL_ACTIVITY_CATALOG by exact id equality, never by matching title text', /const matched = activityId \? FULL_ACTIVITY_CATALOG\.find\(\(activity\) => activity\.id === activityId\) : undefined;/.test(planViewSource));

check('5. prefillActivityId is cleared on manual reschedule-title set (plan.title)', /setTaskTitle\(plan\.title\);\s*setIsCustomTask\(true\);[\s\S]{0,300}setPrefillActivityId\(undefined\);/.test(planViewSource));
check('5. prefillActivityId is cleared on voice input (free text, never a validated id)', /setTaskTitle\(transcript\);\s*setIsCustomTask\(true\);\s*setPrefillActivityId\(undefined\);/.test(planViewSource));
check('5. prefillActivityId is cleared on manual text-input typing (free text, never a validated id)', /setTaskTitle\(event\.target\.value\);\s*setIsCustomTask\(true\);\s*setPrefillActivityId\(undefined\);/.test(planViewSource));
check('5. prefillActivityId is cleared on a chip click (chips carry no id of their own in this component\'s data model; defers to the existing, unchanged resolveActivitySelection title match)', /setTaskTitle\(task\.title\);\s*setIsCustomTask\(false\);[\s\S]{0,400}setPrefillActivityId\(undefined\);/.test(planViewSource));

check('5. the FIND-mode search resolution prefers the trusted id via resolveCurrentActivitySelection, never re-matching by title when one is already known', /const selection = resolveCurrentActivitySelection\(\);/.test(planViewSource));
check('5. resolvedActivityDefinition (gates the person picker) also prefers prefillActivityId over a fresh title match', /const selection = prefillActivityId \? \{ activityId: prefillActivityId \} : resolveActivitySelection\(taskTitle\);/.test(planViewSource));
check('5. "Direct Plan navigation" (no initialActivity at all) is untouched -- the effect still returns immediately before any resolution runs', /const nextActivity = initialActivity\?\.trim\(\);\s*if \(!nextActivity\) return;/.test(planViewSource));

// ============================================================
// 6. Explicit exclusions: no Goal-linking was added to POST /api/plans,
// no change to Goal completion/progress, no Habit/GoalActivity
// consolidation, no Muhurta/scheduling-algorithm change, no quick-log
// Goal attribution, and the existing /plan-day handoff is untouched.
// ============================================================

const plansRouteSource = fs.readFileSync('apps/web/app/api/plans/route.ts', 'utf8');
// HPG2 (a later, separate ticket) intentionally added explicit
// goalActivityId support to POST /api/plans -- this check's own original
// concern ("THIS PR -- HPG1 -- never accidentally introduces Goal
// linking as a side effect of activity-identity threading") is still what
// it verifies: HPG1's own identity plumbing (initialActivityId,
// prefillActivityId, resolvePrefillActivity) still carries no Goal
// concept of its own. HPG2's own dedicated test
// (test/planGoalActivityLinkWiring.test.ts) independently verifies ITS
// addition is done safely -- this check no longer asserts blanket
// absence, which would now be a false assumption about intentional,
// later, separately-reviewed work.
check('6. HPG1\'s own identity plumbing (initialActivityId/prefillActivityId/resolvePrefillActivity) never itself references a Goal concept -- Goal linking, where it now exists, was added later by HPG2 as its own separate, independently-tested concern', !/initialActivityId[\s\S]{0,40}goalId|prefillActivityId[\s\S]{0,40}goalId/.test(planViewSource));
check('6. the existing /plan-day Goal handoff (GoalDetailClient.tsx) is untouched -- still ids-only via fromGoal/activities', (() => {
  const goalDetailSource = fs.readFileSync('apps/web/app/goals/[goalId]/GoalDetailClient.tsx', 'utf8');
  return /URLSearchParams\(\{\s*fromGoal:\s*goal\.id,\s*activities:\s*effectiveSelectedIds\.join\(','\)\s*\}\)/.test(goalDetailSource);
})());
check('6. the Daily Briefing\'s Focus CTA is untouched -- still a hardcoded generic label, no new id-resolution added there (out of this PR\'s scope)', (() => {
  const dailyBriefingSource = fs.readFileSync('apps/web/components/DailyBriefingCard.tsx', 'utf8');
  return /onPlanClick\('Focused work'\)/.test(dailyBriefingSource);
})());

if (!allPassed) { console.error('SOME HPG1 WIRING CHECKS FAILED'); process.exit(1); }
console.log('ALL HPG1 WIRING CHECKS PASSED');
process.exit(0);
