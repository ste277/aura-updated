/**
 * Plan Log -> My Day Refresh Consistency V1: regression suite for the
 * shared handlePlanLogged callback (apps/web/app/page.tsx). Audited
 * separately (not re-derived here): POST /api/plans/[planId]/log
 * (logPlannedActivity) is a single DB transaction, so a 2xx response is
 * unconditional proof both the HabitLog insert and the PlannedActivity
 * status update committed together -- the only thing missing before this
 * fix was a fresh GET /api/my-day after that confirmation.
 *
 * No component-test harness exists in this repo for page.tsx handlers, so
 * this follows the established source-text/regex structural-assertion
 * pattern (see test/habitLogActivityIdentity.test.ts) rather than
 * introducing one: it proves (a) handlePlanLogged combines
 * loadUserDataAndLogs() with loadMyDay() (and, since New Aura Home V1,
 * loadGuidance() alongside them -- a logged Plan can change today's
 * eligible-intent set), and (b) every Plan-logging surface -- all four,
 * including handleLogPlanFromHome, discovered during implementation and
 * not named in the prior audit's "three wiring sites" framing -- is wired
 * through it, with no surface left on the old loadUserDataAndLogs-only
 * pattern.
 */
import * as fs from 'fs';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const pageSource = fs.readFileSync('apps/web/app/page.tsx', 'utf8');
const planViewSource = fs.readFileSync('apps/web/components/PlanWithAuraView.tsx', 'utf8');

// ============================================================
// handlePlanLogged exists and combines both refreshes.
// ============================================================

const handlePlanLoggedMatch = pageSource.match(
  /const handlePlanLogged = useCallback\(async \(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/
);
check('handlePlanLogged is defined as a useCallback in page.tsx', handlePlanLoggedMatch !== null);

const handlePlanLoggedBody = handlePlanLoggedMatch?.[1] ?? '';
const handlePlanLoggedDeps = handlePlanLoggedMatch?.[2] ?? '';

check('handlePlanLogged calls loadUserDataAndLogs()', /loadUserDataAndLogs\(\)/.test(handlePlanLoggedBody));
check('handlePlanLogged calls loadMyDay()', /loadMyDay\(\)/.test(handlePlanLoggedBody));
// New Aura Home V1 -- loadGuidance() joined the same Promise.all as a
// third refresh (a logged Plan can change today's eligible-intent set
// for GET /api/daily-assistant/guidance); loadUserDataAndLogs()/loadMyDay()
// keep running concurrently exactly as before, unchanged.
check('handlePlanLogged calls loadGuidance()', /loadGuidance\(\)/.test(handlePlanLoggedBody));
check(
  'handlePlanLogged runs all three refreshes concurrently via Promise.all (not sequential awaits)',
  /Promise\.all\(\s*\[\s*loadUserDataAndLogs\(\),\s*loadMyDay\(\),\s*loadGuidance\(\)\s*\]\s*\)/.test(handlePlanLoggedBody)
);
check(
  'handlePlanLogged depends on loadUserDataAndLogs, loadMyDay, and loadGuidance',
  /\bloadUserDataAndLogs\b/.test(handlePlanLoggedDeps) && /\bloadMyDay\b/.test(handlePlanLoggedDeps) && /\bloadGuidance\b/.test(handlePlanLoggedDeps)
);

// ============================================================
// All four Plan-logging surfaces route through handlePlanLogged.
// Three are the PlanWithAuraView-shaped onPlanLogged prop (Ask Aura, the
// Plan tab itself, and the Muhurtham finder); the fourth is
// handleLogPlanFromHome, a separate direct fetch wired to HomeDashboard's
// onLogPlan prop, discovered during implementation.
// ============================================================

const onPlanLoggedWirings = pageSource.match(/onPlanLogged=\{[^}]*\}/g) ?? [];
check('page.tsx wires onPlanLogged exactly 3 times (Ask Aura, Plan, Muhurtham)', onPlanLoggedWirings.length === 3);
check(
  'every onPlanLogged wiring site uses handlePlanLogged (no site left on loadUserDataAndLogs alone)',
  onPlanLoggedWirings.every((wiring) => wiring === 'onPlanLogged={handlePlanLogged}')
);
check(
  'no stray onPlanLogged={loadUserDataAndLogs} wiring remains anywhere in page.tsx',
  !/onPlanLogged=\{loadUserDataAndLogs\}/.test(pageSource)
);

check('HomeDashboard is wired to handleLogPlanFromHome via onLogPlan', /onLogPlan=\{handleLogPlanFromHome\}/.test(pageSource));

const handleLogPlanFromHomeMatch = pageSource.match(
  /const handleLogPlanFromHome = useCallback\(async \(planId: string\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/
);
check('handleLogPlanFromHome is defined as a useCallback in page.tsx', handleLogPlanFromHomeMatch !== null);

const handleLogPlanFromHomeBody = handleLogPlanFromHomeMatch?.[1] ?? '';
const handleLogPlanFromHomeDeps = handleLogPlanFromHomeMatch?.[2] ?? '';

check('handleLogPlanFromHome calls handlePlanLogged() (not loadUserDataAndLogs directly)', /await handlePlanLogged\(\);/.test(handleLogPlanFromHomeBody));
check('handleLogPlanFromHome does not call loadUserDataAndLogs directly (no bypass of the shared callback)', !/loadUserDataAndLogs\(/.test(handleLogPlanFromHomeBody));
check('handleLogPlanFromHome depends on handlePlanLogged', /\bhandlePlanLogged\b/.test(handleLogPlanFromHomeDeps));

// Failure safety: the refresh must run strictly after the res.ok check, so
// a non-2xx response throws before handlePlanLogged (and therefore
// loadMyDay) is ever invoked -- matching PR #84/#86's confirmed-only
// refresh invariant.
const notOkIndex = handleLogPlanFromHomeBody.indexOf('if (!res.ok)');
const refreshCallIndex = handleLogPlanFromHomeBody.indexOf('await handlePlanLogged();');
check(
  'handleLogPlanFromHome checks res.ok and throws BEFORE calling handlePlanLogged (failure never triggers a refresh)',
  notOkIndex !== -1 && refreshCallIndex !== -1 && notOkIndex < refreshCallIndex
);

// ============================================================
// PlanWithAuraView.handleLogPlan (the other 3 surfaces' shared success
// path) -- confirm unchanged since PR #84: onPlanLogged?.() fires only in
// the success branch, never from the catch block, so wiring loadMyDay()
// through it inherits failure-safety with no new guard code.
// ============================================================

const handleLogPlanMatch = planViewSource.match(
  /const handleLogPlan = async \(plan: UpcomingPlan\) => \{([\s\S]*?)\n  \};/
);
check('PlanWithAuraView.handleLogPlan was located', handleLogPlanMatch !== null);

const handleLogPlanBody = handleLogPlanMatch?.[1] ?? '';
const tryMatch = handleLogPlanBody.match(/try \{([\s\S]*?)\} catch/);
const catchMatch = handleLogPlanBody.match(/\} catch[^{]*\{([\s\S]*?)\} finally/);

check('PlanWithAuraView.handleLogPlan calls onPlanLogged?.() in its try/success branch', tryMatch !== null && /onPlanLogged\?\.\(\);/.test(tryMatch[1]));
check('PlanWithAuraView.handleLogPlan does NOT call onPlanLogged?.() in its catch/failure branch', catchMatch !== null && !/onPlanLogged\?\.\(\)/.test(catchMatch[1]));

if (!allPassed) {
  console.error('\nSome Plan Log -> My Day refresh checks FAILED.');
  process.exit(1);
} else {
  console.log('\nALL PLAN LOG -> MY DAY REFRESH CHECKS PASSED');
}
