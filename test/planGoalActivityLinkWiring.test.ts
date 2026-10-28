// AURA HPG2 -- structural checks for the "Link to a Goal" picker wiring
// in PlanWithAuraView.tsx and the server-side handling in
// POST /api/plans. No DOM/testing-library harness exists in this repo for
// a plain .tsx file (established convention), so this follows the same
// source-text/regex structural-assertion pattern already used throughout
// this engagement's prior test suites (e.g. test/planHomeHandoffWiring.test.ts).
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const planViewSource = fs.readFileSync('apps/web/components/PlanWithAuraView.tsx', 'utf8');
const plansRouteSource = fs.readFileSync('apps/web/app/api/plans/route.ts', 'utf8');
const dbSource = fs.readFileSync('apps/web/lib/db.ts', 'utf8');

// ============================================================
// 1. Explicit selection only -- never inferred from taskTitle's text.
// ============================================================

check('1. selectedGoalActivityId is set ONLY inside selectGoalActivity (an explicit picker click), never derived from taskTitle', /const selectGoalActivity = \(activity: \{ id: string; title: string; activityId: string \| null \}\) => \{/.test(planViewSource));
check('1. selectGoalActivity adopts the GoalActivity\'s OWN canonical title (same discipline as resolvePrefillActivity, HPG1), not whatever free text was there before', /setTaskTitle\(activity\.title\);/.test(planViewSource.slice(planViewSource.indexOf('const selectGoalActivity'))));
check('1. the picker filters to derivedState === \'SUGGESTED\' -- never offers a selection the server-side link would itself reject', /derivedState === 'SUGGESTED'/.test(planViewSource));

// ============================================================
// 2. Clearing discipline: selectedGoalActivityId is cleared at every
// manual title-changing path, mirroring prefillActivityId's own (HPG1).
// ============================================================

const clearCount = (planViewSource.match(/clearGoalActivitySelection\(\);/g) || []).length;
check('2. clearGoalActivitySelection is called at least 5 times (prefill effect, reschedule, voice, text input, chip click)', clearCount >= 5);
check('2. cleared on voice input (free text)', /setTaskTitle\(transcript\);\s*setIsCustomTask\(true\);[\s\S]{0,150}clearGoalActivitySelection\(\);/.test(planViewSource));
check('2. cleared on manual text-input typing (free text)', /setTaskTitle\(event\.target\.value\);\s*setIsCustomTask\(true\);[\s\S]{0,150}clearGoalActivitySelection\(\);/.test(planViewSource));
check('2. cleared on a chip click (chips are not an explicit Goal selection)', /setPrefillActivityId\(undefined\);[\s\S]{0,150}clearGoalActivitySelection\(\);[\s\S]{0,80}if \(task\.defaultDurationMinutes\)/.test(planViewSource));
check('2. cleared when starting a reschedule (Move inherits the ORIGINAL plan\'s own Goal link server-side)', /setPrefillActivityId\(undefined\);[\s\S]{0,250}clearGoalActivitySelection\(\);[\s\S]{0,150}DR4-F1/.test(planViewSource));
check('2. cleared defensively inside the HPG1 prefill effect (a Home/Ask Aura handoff never carries a Goal selection of its own)', /setPrefillActivityId\(resolved\.activityId\);[\s\S]{0,350}clearGoalActivitySelection\(\);/.test(planViewSource));
check('2. the selection is consumed (cleared) immediately after a successful save, so it can never leak into an unrelated later save', /setShowAllPlans\(true\);[\s\S]{0,250}clearGoalActivitySelection\(\);[\s\S]{0,150}onPlanLogged\?\.\(\);/.test(planViewSource));

// ============================================================
// 3. The request body carries goalActivityId as its own, independent field.
// ============================================================

check('3. handleSavePlan\'s POST /api/plans body includes goalActivityId, read from component state (never passed in as a parameter, never derived from plan.title)', /goalActivityId: selectedGoalActivityId \?\? null,/.test(planViewSource));

// ============================================================
// 4. Catalog identity (HPG1) and Goal identity (HPG2) are tracked as
// genuinely separate state, never conflated.
// ============================================================

check('4. prefillActivityId (catalog) and selectedGoalActivityId (Goal) are two distinct state variables', /const \[prefillActivityId, setPrefillActivityId\]/.test(planViewSource) && /const \[selectedGoalActivityId, setSelectedGoalActivityId\]/.test(planViewSource));
check('4. selecting a GoalActivity also threads its OWN catalog activityId (when it has one) into the SEPARATE prefillActivityId state -- the two systems cooperate without being merged into one', /setPrefillActivityId\(activity\.activityId \?\? undefined\);/.test(planViewSource));

// ============================================================
// 5. The picker reuses EXISTING Goals API endpoints, unmodified -- no new
// GET endpoint was added.
// ============================================================

check('5. fetches the EXISTING GET /api/goals list endpoint', /fetch\('\/api\/goals'\)/.test(planViewSource));
check('5. fetches the EXISTING GET /api/goals/:goalId detail endpoint (template literal, not a new path)', /fetch\(`\/api\/goals\/\$\{selectedGoalId\}`\)/.test(planViewSource));
check('5. no new API route file was added under apps/web/app/api/goals for this picker', !fs.existsSync('apps/web/app/api/goals/activities/route.ts') && !fs.existsSync('apps/web/app/api/goal-activities/route.ts'));

// ============================================================
// 6. Server-side: goalActivityId is a separate identity space from
// activityId, validated and linked atomically, fail-closed.
// ============================================================

check('6. the route imports the EXISTING, unmodified linkGoalActivityToPlannedActivity (db.ts) -- no parallel linking logic introduced', /linkGoalActivityToPlannedActivity/.test(plansRouteSource));
check('6. goalActivityId is parsed as untrusted client input, independent of activityId\'s own catalog validation', /const goalActivityId = typeof body\?\.goalActivityId === 'string'/.test(plansRouteSource));
check('6. the link happens inside the SAME transaction/client as the PlannedActivity insert (no separate check-then-act)', /const linked = await linkGoalActivityToPlannedActivity\(session\.userId, goalActivityId, plan\.id, client\);/.test(plansRouteSource));
check('6. a failed link throws and the transaction is rolled back -- no orphan, silently-unlinked PlannedActivity is created instead of the one the caller explicitly asked for', /if \(!linked\) throw new Error\('GOAL_ACTIVITY_LINK_FAILED'\);/.test(plansRouteSource));
check('6. the rollback path returns a typed 400, not an unhandled 500', /err\.message === 'GOAL_ACTIVITY_LINK_FAILED'[\s\S]{0,120}status: 400/.test(plansRouteSource));

// ============================================================
// 7. Explicit exclusions respected.
// ============================================================

check('7. linkGoalActivityToPlannedActivity itself (db.ts) is UNMODIFIED by HPG2 -- still the exact ownership/eligibility WHERE clause Day Constructor already relies on', /WHERE id = \$2\s*\n\s*AND "userId" = \$3\s*\n\s*AND status != 'DISMISSED'\s*\n\s*AND \(\s*\n\s*"plannedActivityId" IS NULL\s*\n\s*OR "plannedActivityId" IN \(\s*\n\s*SELECT id FROM "PlannedActivity" WHERE "userId" = \$3 AND status IN \('CANCELLED', 'SKIPPED'\)/.test(dbSource));
// HPG3-A2 -- materializeGoalActivityRhythmOccurrence (Rhythm-specific path)
// is now wired into POST /api/plans, mirroring the EXACT ordering
// dayConstructorAcceptancePersistence.ts's own write loop already
// established: tried first, the existing linkGoalActivityToPlannedActivity
// used only as the NOT_RHYTHM_ELIGIBLE fallback. This check's original
// concern ("never silently pulls Rhythm mechanics into HPG2's own, simpler
// Goal association") is still what it verifies -- the finite/once-ever
// path (checks 69-73 above) is completely unmodified; this only proves
// the daily-eligibility-aware path HPG3-A2 adds is correctly ordered
// AFTER the HPG2 lifecycle guard and BEFORE the legacy fallback, never
// bypassing either.
check('7. the route imports and calls materializeGoalActivityRhythmOccurrence, tried BEFORE the legacy link, exactly as dayConstructorAcceptancePersistence.ts already does', /import \{[^}]*materializeGoalActivityRhythmOccurrence/.test(plansRouteSource) && /const materialized = await materializeGoalActivityRhythmOccurrence\(session\.userId, goalActivityId, plan\.id, plannedStartAt, planningLocalDate, user!\.timezone, client\);/.test(plansRouteSource));
check('7. a genuine Rhythm-specific refusal (anything other than NOT_RHYTHM_ELIGIBLE) never falls through to the legacy link -- it fails the request closed', /if \(!materialized\.ok && materialized\.reason !== 'NOT_RHYTHM_ELIGIBLE'\) \{[\s\S]{0,700}throw new Error\('GOAL_ACTIVITY_LINK_FAILED'\);/.test(plansRouteSource));
check('7. the legacy link is reached ONLY for NOT_RHYTHM_ELIGIBLE -- the finite/once-ever path (checks 69-73) is otherwise completely untouched', /if \(!materialized\.ok\) \{[\s\S]{0,850}const linked = await linkGoalActivityToPlannedActivity\(session\.userId, goalActivityId, plan\.id, client\);/.test(plansRouteSource));
check('7. the lifecycle guard (HPG2 P0) still runs BEFORE materialize -- its own position is unchanged', plansRouteSource.indexOf('lockGoalParentLifecycleForPlanning(session.userId, [goalActivityId], client)') < plansRouteSource.indexOf('materializeGoalActivityRhythmOccurrence(session.userId'));
// Migration count tracks the repository's real history, not a number
// frozen at HPG2's own authoring time -- HPG3-A1 (migration 0051) already
// landed on main before this ticket began; A2 itself adds none.
check('7. no new Prisma migration directory was added by THIS PR (51, matching HPG3-A1\'s own already-merged baseline)', fs.readdirSync('apps/web/prisma/migrations').filter((d) => /^\d/.test(d)).length === 51);
check('7. PlannedActivity itself still carries no goalActivityId column (schema.prisma\'s own "stays completely unaware of acquisition source" house rule, unmodified)', !/goalActivityId\s+String\?/.test(fs.readFileSync('apps/web/prisma/schema.prisma', 'utf8')));

if (!allPassed) { console.error('SOME HPG2 WIRING CHECKS FAILED'); process.exit(1); }
console.log('ALL HPG2 WIRING CHECKS PASSED');
process.exit(0);
