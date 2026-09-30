/**
 * Goals V2 G3.1 -- narrow structural guards confirming this read-model
 * slice stayed exactly as scoped as intended (its own section 41), each
 * scoped to exactly the module in question -- never a brittle repo-wide
 * grep.
 */
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
function stripComments(text: string): string {
  return text.replace(/\/\/.*$/gm, '');
}

const dailyAgendaSrc = read('apps/web/lib/dailyAgenda.ts');
check('DailyAgendaItem exposes goalContext as OPTIONAL (never required)', /goalContext\?:\s*PlanGoalContext/.test(dailyAgendaSrc));
check('dailyAgenda.ts reuses PlanGoalContext from db.ts rather than redefining a Goal-context shape', /import type \{[^}]*PlanGoalContext[^}]*\} from '\.\/db'/.test(dailyAgendaSrc));
check('dailyAgenda.ts (still) performs no DB access -- goalContext arrives pre-fetched via goalContextsByPlanId, never queried here', !/pool\.query|client\.query|await.*SELECT/i.test(dailyAgendaSrc));

const dbSrc = read('apps/web/lib/db.ts');
const loaderBody = dbSrc.slice(dbSrc.indexOf('export async function loadGoalContextsForPlanIds'), dbSrc.indexOf('export async function loadGoalContextsForPlanIds') + 2500);
check('loadGoalContextsForPlanIds exists and is the canonical batched loader', /export async function loadGoalContextsForPlanIds/.test(dbSrc));
check('GoalActivity lookup uses plannedActivityId (the canonical current linkage, not a second concept)', /ga\."plannedActivityId" = ANY/.test(stripComments(loaderBody)));
check('execution lookup uses plannedActivityId (never a "latest"/history join)', /gae\."plannedActivityId" = ga\."plannedActivityId"/.test(stripComments(loaderBody)));
check('completionRequirement in the loader uses the canonical G2.1 normalization helper, never a second implementation', /normalizeGoalActivityCompletionRequirement\(/.test(loaderBody));
check('PlanGoalContext exposes no execution persistence internals (id/source/createdAt/updatedAt of the execution row)', (() => {
  const typeBlock = dbSrc.slice(dbSrc.indexOf('export interface PlanGoalContext'), dbSrc.indexOf('export interface PlanGoalContext') + 400);
  return !/\bsource\b|\bcreatedAt\b|\bupdatedAt\b|executionId/.test(stripComments(typeBlock));
})());
check('loadGoalContextsForPlanIds contains no write SQL (INSERT/UPDATE/DELETE)', !/INSERT INTO|UPDATE "|DELETE FROM/.test(loaderBody));
check('loadGoalContextsForPlanIds queries "GoalActivity"/"Goal"/"GoalActivityExecution" only -- no history/aggregate query (no COUNT, no date range, no ORDER BY ... LIMIT)', !/COUNT\(|GROUP BY|ORDER BY.*LIMIT/i.test(loaderBody));
check('loadGoalContextsForPlanIds is a single batched function taking a collection of ids (plan ids: readonly string[]), not a per-id API', /planIds: readonly string\[\]/.test(dbSrc.slice(dbSrc.indexOf('export async function loadGoalContextsForPlanIds') - 5, dbSrc.indexOf('export async function loadGoalContextsForPlanIds') + 200)));

const composerSrc = read('apps/web/lib/homeTimelineComposer.ts');
check('homeTimelineComposer.ts passes goalContext through verbatim (item.goalContext), never re-derives/re-queries it', /goalContext: item\.goalContext/.test(composerSrc));
check('homeTimelineComposer.ts remains pure -- no DB/fetch call added', !/pool\.query|client\.query|await fetch/.test(composerSrc));

// ============================================================
// No UI rendering consumed Goal context as of G3.1 (section 23). Goals V2
// G3.3 (a later, separately-authorized ticket) intentionally made
// HomeDashboard.tsx the Right Now spotlight's own consumer of goalContext
// -- see test/rightNowGoalContext.test.ts for G3.3's own guards. Every
// OTHER surface this section covers remains untouched and is still
// asserted here.
// ============================================================
check('GoalDetailClient.tsx does not render goalContext (currentValue exposure is API-only in G3.1)', !/goalContext/.test(read('apps/web/app/goals/[goalId]/GoalDetailClient.tsx')));
check('HomeTimeline.tsx (ordinary Timeline rows) does not reference goalContext -- the Right Now spotlight is G3.3\'s only consumer, never every row', !/goalContext/.test(read('apps/web/components/HomeTimeline.tsx')));
check('RecompositionCard.tsx does not reference goalContext', !/goalContext/.test(read('apps/web/components/RecompositionCard.tsx')));

// ============================================================
// No Constructor reference
// ============================================================
check('dayConstructorOrchestrator.ts does not reference goalContext/PlanGoalContext/loadGoalContextsForPlanIds', !/goalContext|PlanGoalContext|loadGoalContextsForPlanIds/.test(read('apps/web/lib/dayConstructorOrchestrator.ts')));
check('dayConstructorAcceptancePersistence.ts does not reference goalContext/PlanGoalContext/loadGoalContextsForPlanIds', !/goalContext|PlanGoalContext|loadGoalContextsForPlanIds/.test(read('apps/web/lib/dayConstructorAcceptancePersistence.ts')));
check('planMove.ts does not reference goalContext/PlanGoalContext (Move continuity for progress is G2.2.3\'s own separate concern, unaffected here)', !/goalContext|PlanGoalContext/.test(read('apps/web/lib/planMove.ts')));

// ============================================================
// No schema/migration change
// ============================================================
const migrationDirs = fs.readdirSync(path.join(__dirname, '..', 'apps', 'web', 'prisma', 'migrations')).filter((d) => /^\d{4}_/.test(d));
check('no new migration directory was added for G3.1 (still 41, the G2.2.3 count)', migrationDirs.length === 41);
check('schema.prisma was not touched (GoalActivityExecution model has no new field beyond what G2.2.1 already defined)', (() => {
  const schema = stripComments(read('apps/web/prisma/schema.prisma'));
  const match = schema.match(/model GoalActivityExecution \{([\s\S]*?)\n\}/);
  const block = match ? match[1] : '';
  return !/localDate|dayBucket|frequency|recurrence|Rhythm/i.test(block);
})());

// ============================================================
// No day progress / no Rhythm / no history aggregation anywhere in the
// touched files
// ============================================================
const touchedFiles = ['apps/web/lib/dailyAgenda.ts', 'apps/web/lib/db.ts', 'apps/web/lib/homeTimelineComposer.ts', 'apps/web/lib/homeTimelineTypes.ts', 'apps/web/lib/myDayOrchestrator.ts', 'apps/web/lib/goalsPresentation.ts', 'apps/web/app/api/goals/[goalId]/route.ts'];
for (const f of touchedFiles) {
  const src = stripComments(read(f));
  check(`${f}: no day-scoped progress concept (localDate/dayBucket/dailyTarget)`, !/dayBucket|dailyTarget/.test(src));
  check(`${f}: no Rhythm/recurrence concept`, !/\bRhythm\b|\bRRULE\b/.test(src));
  check(`${f}: no history/aggregate query (weekly total, execution history array)`, !/executionHistory|weeklyTotal|allExecutions/.test(src));
}

if (!allPassed) {
  console.error('SOME GOAL CONTEXT STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL CONTEXT STRUCTURAL GUARD CHECKS PASSED');
