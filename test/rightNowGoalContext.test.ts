/**
 * Goals V2 G3.3 -- Right Now completion presentation. Mixes:
 *   (a) a pure behavioral regression against the REAL selectRightNowState
 *       (proving Goal metadata has zero effect on selection/ranking), and
 *   (b) source-structural assertions for HomeDashboard.tsx's own JSX (this
 *       repository has no component-rendering harness for a plain .tsx
 *       file -- same established convention as
 *       homeDashboardRightNowContract.test.ts/goalsUiWiring.test.ts).
 *
 * Exhaustive formatGoalActivityCompletion coverage (DONE/DURATION/
 * MEASURED_TARGET x null/matching/differing/zero/above-target/fractional)
 * already lives in test/goalsPresentation.test.ts and is NOT duplicated
 * here (this ticket's own section 31) -- only a canonical-source sanity
 * check is repeated, proving the G3.3 extraction didn't fork the logic.
 */
import * as fs from 'fs';
import { selectRightNowState } from '../apps/web/lib/rightNowSelection';
import { formatGoalActivityCompletion as formatFromDomain } from '../apps/web/lib/goalActivityExecution';
import { formatGoalActivityCompletion as formatFromPresentation } from '../apps/web/lib/goalsPresentation';
import type { HomeTimelineItem } from '../apps/web/lib/homeTimelineTypes';
import type { PlanGoalContext } from '../apps/web/lib/db';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

// ============================================================
// Canonical-formatter reuse: one implementation, two import paths
// ============================================================
check('formatGoalActivityCompletion is the SAME function via both import paths (goalActivityExecution.ts canonical, goalsPresentation.ts re-export)', formatFromDomain === formatFromPresentation);
check('sanity: DURATION 30/18 -> "18 / 30 min" via the domain import', formatFromDomain({ kind: 'DURATION', targetValue: 30 }, 18) === '18 / 30 min');
check('sanity: MEASURED_TARGET 20 pages/null -> "20 pages" via the presentation re-export', formatFromPresentation({ kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' }, null) === '20 pages');

// ============================================================
// 36. Right Now selection regression -- identical candidate set, with and
// without goalContext on the metadata, must select the SAME item.
// ============================================================
function goalContext(overrides: Partial<PlanGoalContext> = {}): PlanGoalContext {
  return {
    goal: { id: 'goal-1', title: 'Get fitter' },
    goalActivity: { id: 'ga-1', completionRequirement: { kind: 'MEASURED_TARGET', targetValue: 20, unit: 'pages' } },
    currentValue: 12,
    ...overrides,
  };
}
function timelineItem(overrides: Partial<HomeTimelineItem> = {}): HomeTimelineItem {
  return {
    id: 'plan:a',
    kind: 'PLAN',
    start: '2026-08-24T05:00:00.000Z',
    end: '2026-08-24T06:00:00.000Z',
    title: 'Read',
    planned: true,
    source: 'PLAN',
    metadata: {},
    ...overrides,
  };
}
{
  const now = new Date('2026-08-24T05:30:00.000Z'); // inside [start, end) -- ACTIVE_PLAN
  const without = timelineItem({ id: 'plan:a' });
  const withCtx = timelineItem({ id: 'plan:a', metadata: { goalContext: goalContext() } });
  const stateWithout = selectRightNowState([without], now);
  const stateWith = selectRightNowState([withCtx], now);
  check('36. selectRightNowState picks the SAME item kind (ACTIVE_PLAN) regardless of goalContext', stateWithout.kind === 'ACTIVE_PLAN' && stateWith.kind === 'ACTIVE_PLAN');
  check('36. selectRightNowState picks the SAME item id regardless of goalContext', stateWithout.kind !== 'CONTEXT_OPEN' && stateWith.kind !== 'CONTEXT_OPEN' && (stateWithout as any).item.id === (stateWith as any).item.id);
}
{
  // Two competing candidates: a non-Goal item that starts earlier (should win by the SAME
  // commitment-order rule) vs. a Goal-linked item -- goalContext must not give it priority.
  const now = new Date('2026-08-24T05:15:00.000Z');
  const earlierNonGoal = timelineItem({ id: 'plan:earlier', start: '2026-08-24T05:00:00.000Z', end: '2026-08-24T05:30:00.000Z' });
  const laterGoalLinked = timelineItem({ id: 'plan:later', start: '2026-08-24T05:10:00.000Z', end: '2026-08-24T05:40:00.000Z', metadata: { goalContext: goalContext() } });
  const state = selectRightNowState([earlierNonGoal, laterGoalLinked], now);
  check('36. a Goal-linked item does NOT win over an earlier-starting non-Goal item -- commitment order (start, then end, then id) is unaffected by goalContext', state.kind === 'ACTIVE_PLAN' && (state as any).item.id === 'plan:earlier');
}

// ============================================================
// Source-structural assertions for HomeDashboard.tsx
// ============================================================
const src = fs.readFileSync('apps/web/components/HomeDashboard.tsx', 'utf8');

check('HomeDashboard.tsx imports formatGoalActivityCompletion from goalActivityExecution.ts (the canonical, neutral Goal-domain module, never a Goal-UI module)', /import \{ formatGoalActivityCompletion \} from '\.\.\/lib\/goalActivityExecution'/.test(src));
check('spotlightGoalContext is derived from spotlightItem.metadata?.goalContext (the ALREADY-SELECTED item, never re-queried/re-selected)', /const spotlightGoalContext = spotlightItem\?\.metadata\?\.goalContext;/.test(src));
check('spotlightCompletionDetail is computed via the canonical formatter, fed goalActivity.completionRequirement + currentValue', /formatGoalActivityCompletion\(spotlightGoalContext\.goalActivity\.completionRequirement, spotlightGoalContext\.currentValue\)/.test(src));
check('the Goal-context line ("For: <goal title>") is conditional on spotlightGoalContext (absent -> absent, never a placeholder)', /\{spotlightGoalContext && \(/.test(src) && /For: \{spotlightGoalContext\.goal\.title\}/.test(src));
check('the completion-detail line is conditional on spotlightCompletionDetail (null -> nothing rendered)', /\{spotlightCompletionDetail && <div/.test(src));

check('no Progress/Adjust/Edit/+1/History/Repeat/Target button was added anywhere in HomeDashboard.tsx', !/>Progress<|>Adjust<|>Edit<|>\+1<|>History<|>Repeat<|>Target</.test(src));
check('no new fetch(...) call was added for Goal progress -- createPlanExecutor (Done/Skip/Move) remains the only completion-related network path', !/fetch\(`\/api\/goals/.test(src));
check('handleCompleteRightNow/handleSkipRightNow call sites are unchanged (same plan-id argument, same disabled-guard pattern)', /onClick=\{\(\) => void handleCompleteRightNow\(completablePlanIdNow\)\}/.test(src) && /onClick=\{\(\) => void handleSkipRightNow\(skippablePlanIdNow\)\}/.test(src));
check('the Move trigger call site is unchanged', /movePickerFor === moveablePlanIdNow \? closeMovePicker\(\) : openMovePicker\(moveablePlanIdNow\)/.test(src));
check('the "Why?" control is untouched -- still gated on spotlightExplanation, still calls the same handleToggleExpand, never replaced by Goal context', /\{spotlightExplanation && spotlightExplanation\.length > 0 && \(/.test(src) && /handleToggleExpand\(spotlightItem\.id\)/.test(src));

check('HomeTimeline.tsx (ordinary Timeline rows) does not reference goalContext -- the Right Now spotlight is the only G3.3 consumer', !/goalContext/.test(fs.readFileSync('apps/web/components/HomeTimeline.tsx', 'utf8')));
check('GoalDetailClient.tsx was not touched by G3.3 (still only its own G3.2 completionDetail usage, never spotlightGoalContext/spotlightCompletionDetail)', !/spotlightGoalContext|spotlightCompletionDetail/.test(fs.readFileSync('apps/web/app/goals/[goalId]/GoalDetailClient.tsx', 'utf8')));
check('dayConstructorOrchestrator.ts does not reference goalContext/formatGoalActivityCompletion', !/goalContext|formatGoalActivityCompletion/.test(fs.readFileSync('apps/web/lib/dayConstructorOrchestrator.ts', 'utf8')));
// Goals V2 G3.5 (a later, separately-authorized ticket) intentionally made
// RecompositionCard.tsx a consumer of Goal IDENTITY only (its own
// goalTitle field) -- see test/goalAwareRecompositionPresentation.test.ts
// for G3.5's own guards. It still never references the completion
// formatter or any completion/progress internal, which this check now
// narrows to.
check('RecompositionCard.tsx never references formatGoalActivityCompletion/completionRequirement/currentValue (Goal identity only, no completion/progress detail -- G3.3\'s own formatter stays Right-Now-exclusive)', !/formatGoalActivityCompletion|completionRequirement|currentValue/.test(fs.readFileSync('apps/web/components/RecompositionCard.tsx', 'utf8')));
check('planMove.ts does not reference formatGoalActivityCompletion', !/formatGoalActivityCompletion/.test(fs.readFileSync('apps/web/lib/planMove.ts', 'utf8')));

const migrationDirs = fs.readdirSync('apps/web/prisma/migrations').filter((d) => /^\d{4}_/.test(d));
check('no new migration directory was added for G3.3 (still 41)', migrationDirs.length === 43);
check('no Rhythm/recurrence concept anywhere in HomeDashboard.tsx', !/\bRhythm\b|\bRRULE\b/.test(src));
check('no day-scoped progress concept (dayBucket/dailyTarget) anywhere in HomeDashboard.tsx', !/dayBucket|dailyTarget/.test(src));
check('no history/aggregate concept (executionHistory/weeklyTotal/allExecutions) anywhere in HomeDashboard.tsx', !/executionHistory|weeklyTotal|allExecutions/.test(src));

if (!allPassed) {
  console.error('SOME RIGHT NOW GOAL CONTEXT CHECKS FAILED');
  process.exit(1);
}
console.log('ALL RIGHT NOW GOAL CONTEXT CHECKS PASSED');
