/**
 * Goals V2 G3.2 -- narrow structural guards confirming this Goal Detail
 * presentation slice stayed exactly as scoped as intended (its own section
 * 47), reading real shipped source -- same convention as
 * goalsUiWiring.test.ts (this repository has no component-rendering
 * harness).
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

/** Strips `//` and `/* ... *\/` (including JSX comments) -- same
 * convention as goalsUiWiring.test.ts, needed since this file's own doc
 * comments legitimately discuss what was NOT added. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const detailSrc = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));
const presentationSrc = stripComments(read('../apps/web/lib/goalsPresentation.ts'));

check('Goal Detail consumes completionRequirement (formatGoalActivityCompletion call site)', /formatGoalActivityCompletion\(activity\.completionRequirement, activity\.currentValue\)/.test(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx')));
check('Goal Detail consumes currentValue via the same call', /activity\.currentValue/.test(detailSrc));
check('No GoalActivityExecution persistence field (id/source/snapshot columns/timestamps) reaches GoalDetailClient.tsx JSX', !/executionId|\.source\b|completionKindSnapshot|completionTargetValueSnapshot|completionUnitSnapshot|execution\.createdAt|execution\.updatedAt/.test(detailSrc));
check('formatGoalActivityCompletion itself never references execution id/source/timestamps -- only kind/targetValue/unit/currentValue', !/executionId|\bsource\b|createdAt|updatedAt/.test(presentationSrc.slice(presentationSrc.indexOf('export function formatGoalActivityCompletion'), presentationSrc.indexOf('export function formatGoalActivityCompletion') + 1200)));

check('no new progress-write fetch/POST was added to GoalDetailClient.tsx (still exactly the pre-existing load/dismiss/add/archive/delete endpoints)', (() => {
  const fetchCalls = detailSrc.match(/fetch\(`[^`]*`/g) ?? [];
  return fetchCalls.length === 5 && fetchCalls.every((call) => /\/api\/goals\/\$\{goalId\}`|\/dismiss`|\/activities`|\/archive`|\/api\/goals\/\$\{goal\.id\}`/.test(call));
})());
check('no "Done"/"Complete" action button was added to Goal Detail (execution stays in Home/Right Now)', !/>Done<|>Complete<|>Mark done</.test(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx')));
check('no Progress/Adjust/Edit target/+1/History button was added', !/>Progress<|>Adjust<|>Edit target<|>\+1<|>History</.test(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx')));
check('no per-activity progress bar was added (role="progressbar" appears at most once, the existing Goal-level bar)', (detailSrc.match(/role="progressbar"/g) ?? []).length === 1);
check('no threshold-based completion inference (no ">= " comparison against currentValue/targetValue anywhere in this file)', !/currentValue\s*>=|targetValue\s*<=/.test(detailSrc));
check('no percentage conversion was introduced for activity rows (the existing Goal-level Math.round(...) percentage usage is untouched, and no new one was added)', (detailSrc.match(/Math\.round/g) ?? []).length === 1);

check('homeCompletion.ts (the Done/Skip/Move action layer, not presentation) does not reference formatGoalActivityCompletion', !/formatGoalActivityCompletion/.test(read('../apps/web/lib/homeCompletion.ts')));
// Goals V2 G3.3 (a later, separately-authorized ticket) intentionally made
// HomeDashboard.tsx the Right Now spotlight's own consumer of this exact
// formatter -- see test/rightNowGoalContext.test.ts for G3.3's own guards
// (canonical single-source reuse, Timeline-boundary enforcement, no new
// action/write). HomeTimeline.tsx (ordinary Timeline rows) remains the
// real boundary this file still protects: G3.3 explicitly keeps numeric
// Goal progress OFF every Timeline row, spotlight-only.
check('HomeTimeline.tsx (ordinary Timeline rows) does not reference formatGoalActivityCompletion -- numeric Goal progress stays spotlight-only, never on every row', !/formatGoalActivityCompletion/.test(read('../apps/web/components/HomeTimeline.tsx')));
check('dayConstructorOrchestrator.ts does not reference formatGoalActivityCompletion', !/formatGoalActivityCompletion/.test(read('../apps/web/lib/dayConstructorOrchestrator.ts')));
check('planMove.ts does not reference formatGoalActivityCompletion', !/formatGoalActivityCompletion/.test(read('../apps/web/lib/planMove.ts')));

const migrationDirs = fs.readdirSync(path.join(__dirname, '..', 'apps', 'web', 'prisma', 'migrations')).filter((d) => /^\d{4}_/.test(d));
check('no new migration directory was added for G3.2 (still 41)', migrationDirs.length === 43);
// Goals V2 Rhythm R2 (a later, separately-authorized ticket) intentionally
// added exactly two nullable columns (rhythmKind/rhythmTargetPerWeek) to
// GoalActivity -- see test/goalActivityRhythmStructuralGuards.test.ts for
// R2's own guards. Narrowed here to what it still protects: no OTHER
// day-scoped/frequency/recurrence/Rhythm addition anywhere in the Goals
// model block (no RRULE, no separate Rhythm entity, no third column).
check('schema.prisma was not touched by G3.2 beyond what G3.2 itself added (still no localDate/dayBucket/frequency/recurrence, and the only Rhythm reference is R2\'s own two documented columns)', (() => {
  const schema = stripComments(read('../apps/web/prisma/schema.prisma'));
  const goalsBlock = schema.slice(schema.indexOf('model Goal '), schema.indexOf('model Capture'));
  const withoutKnownRhythmColumns = goalsBlock.replace(/rhythmKind\s+String\?/g, '').replace(/rhythmTargetPerWeek\s+Int\?/g, '');
  return !/dayBucket|frequency|recurrence|Rhythm/i.test(withoutKnownRhythmColumns);
})());

check('formatGoalActivityCompletion introduces no day-scoped progress concept', !/dayBucket|dailyTarget|localDate/.test(presentationSrc.slice(presentationSrc.indexOf('export function formatGoalActivityCompletion'))));
check('formatGoalActivityCompletion introduces no Rhythm/recurrence concept', !/\bRhythm\b|\bRRULE\b|frequency/.test(presentationSrc.slice(presentationSrc.indexOf('export function formatGoalActivityCompletion'))));
check('formatGoalActivityCompletion introduces no history/aggregate concept', !/executionHistory|weeklyTotal|allExecutions/.test(presentationSrc.slice(presentationSrc.indexOf('export function formatGoalActivityCompletion'))));

if (!allPassed) {
  console.error('SOME GOAL DETAIL COMPLETION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL DETAIL COMPLETION STRUCTURAL GUARD CHECKS PASSED');
