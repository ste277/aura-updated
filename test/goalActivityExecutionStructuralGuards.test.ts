/**
 * Goals V2 G2.2.1/G2.2.2 -- narrow structural guards confirming these
 * slices stayed exactly as scoped as intended, each scoped to exactly the
 * model/module in question -- never a brittle repo-wide grep. G2.2.1's own
 * guards (schema shape, taxonomy reuse) are unchanged; G2.2.2 adds guards
 * for its own section 41: GoalActivityExecution is now legitimately
 * referenced by the completion path (db.ts's logPlannedActivity) but must
 * remain absent from Constructor, the Move path, Home presentation,
 * DailyAgenda, and Goal progress computation.
 */
import * as fs from 'fs';
import * as path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

const schemaPath = path.join(__dirname, '..', 'apps', 'web', 'prisma', 'schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf8');

function stripComments(text: string): string {
  return text.replace(/\/\/.*$/gm, '');
}

function extractModelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${modelName} not found in schema.prisma`);
  // Field-declaration checks below must ignore doc-comment prose (which
  // legitimately discusses what was deliberately NOT added, e.g. "no
  // APPLE_HEALTH" or "no status field") -- only real column declarations
  // should trip these guards.
  return stripComments(match[1]);
}

check('GoalActivityExecution model exists in schema.prisma', /model GoalActivityExecution \{/.test(schema));

const executionBlock = extractModelBlock('GoalActivityExecution');
check('GoalActivityExecution references GoalActivity via goalActivityId', /goalActivityId\s+String/.test(executionBlock) && /goalActivity\s+GoalActivity\s+@relation/.test(executionBlock));
check('GoalActivityExecution does not introduce a day-bucket field (localDate/executionDate/dayBucket/dailyTarget)', !/localDate|executionDate|dayBucket|dailyTarget/i.test(executionBlock));
check('GoalActivityExecution does not introduce a recurrence/frequency field', !/frequency|recurrence|recurring/i.test(executionBlock));
check('GoalActivityExecution does not introduce a competing completion-status field (status/completed/isComplete/completedAt)', !/\bstatus\b|\bcompleted\b|isComplete|completedAt/i.test(executionBlock));
check('GoalActivityExecution does not introduce a progress-event/child table field', !/ProgressEvent|ProgressSample|ProgressIncrement/.test(executionBlock));
check('GoalActivityExecution does not introduce connector-specific source values (Apple Health / Health Connect / external observation)', !/APPLE_HEALTH|HEALTH_CONNECT|EXTERNAL_OBSERVATION|observedValue|externalObservationId/i.test(executionBlock));
check('GoalActivityExecution has exactly createdAt/updatedAt as its only timestamps (no startedAt/observedAt/syncedAt)', /createdAt\s+DateTime/.test(executionBlock) && /updatedAt\s+DateTime/.test(executionBlock) && !/startedAt|observedAt|syncedAt/i.test(executionBlock));
check('GoalActivityExecution.plannedActivityId is unique (one live plan cannot be claimed by two execution records)', /plannedActivityId\s+String\?\s+@unique/.test(executionBlock));

const goalBlock = extractModelBlock('Goal');
const goalActivityBlock = extractModelBlock('GoalActivity');
const plannedActivityBlock = extractModelBlock('PlannedActivity');
check('PlannedActivity receives no progress columns (currentValue/completionKindSnapshot/etc.)', !/currentValue|completionKindSnapshot|completionTargetValueSnapshot|completionUnitSnapshot/.test(plannedActivityBlock));
check('Goal receives no progress columns', !/currentValue|completionKindSnapshot|completionTargetValueSnapshot|completionUnitSnapshot/.test(goalBlock));
check('GoalActivity itself (the G2.1 definition layer) receives no new progress columns from G2.2.1', !/currentValue|completionKindSnapshot|completionTargetValueSnapshot|completionUnitSnapshot/.test(goalActivityBlock));

const domainSrc = fs.readFileSync(path.join(__dirname, '..', 'apps', 'web', 'lib', 'goalActivityExecution.ts'), 'utf8');
check('goalActivityExecution.ts imports CompletionRequirement/validateCompletionRequirement from goalCompletion.ts rather than redefining the taxonomy', /from ['"]\.\/goalCompletion['"]/.test(domainSrc) && /validateCompletionRequirement/.test(domainSrc));
check('goalActivityExecution.ts never defines a second, competing CompletionKind union', !/type CompletionKind/.test(domainSrc));

// ============================================================
// Production-inertness: no existing write/read path was touched
// ============================================================
function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}
const dbSrc = read('apps/web/lib/db.ts');
const logPlannedActivityBody = dbSrc.slice(dbSrc.indexOf('export async function logPlannedActivity'), dbSrc.indexOf('export async function upsertUserByEmail'));
check('G2.2.2: db.ts logPlannedActivity DOES reference GoalActivityExecution -- the intended completion-time write', /GoalActivityExecution/.test(logPlannedActivityBody));
check('G2.2.2: logPlannedActivity resolves GoalActivity linkage server-side (queries WHERE "plannedActivityId" = ...), never trusts a client-supplied goalActivityId', /SELECT \* FROM "GoalActivity" WHERE "plannedActivityId"/.test(logPlannedActivityBody));
check('G2.2.2: logPlannedActivity never re-snapshots from a live GoalActivity when an execution already exists (uses fromPersistedGoalActivityExecutionSnapshot on the existing row, not normalizeGoalActivityCompletionRequirement, in that branch)', /existingExecution\s*\n\s*\?\s*fromPersistedGoalActivityExecutionSnapshot/.test(logPlannedActivityBody));
check('planMove.ts (movePlannedActivity/applyMoveWrites) does not reference GoalActivityExecution -- Move continuity is a later slice (G2.2.3)', !/GoalActivityExecution/.test(read('apps/web/lib/planMove.ts')));
check('homeCompletion.ts (Home/Right Now) does not reference GoalActivityExecution -- no UX change in G2.2.2', !/GoalActivityExecution/.test(read('apps/web/lib/homeCompletion.ts')));
check('dailyAgenda.ts does not reference GoalActivityExecution', !/GoalActivityExecution/.test(read('apps/web/lib/dailyAgenda.ts')));
check('goals.ts (computeGoalProgress) does not reference GoalActivityExecution -- Goal progress stays activity-count-derived, unaffected by currentValue', !/GoalActivityExecution/.test(read('apps/web/lib/goals.ts')));
check('goalsPresentation.ts does not reference GoalActivityExecution (no read-model exposure yet)', !/GoalActivityExecution/.test(read('apps/web/lib/goalsPresentation.ts')));
check('app/api/goals/[goalId]/route.ts does not reference GoalActivityExecution', !/GoalActivityExecution/.test(read('apps/web/app/api/goals/[goalId]/route.ts')));
check('dayConstructorOrchestrator.ts does not reference GoalActivityExecution', !/GoalActivityExecution/.test(read('apps/web/lib/dayConstructorOrchestrator.ts')));
check('dayConstructorAcceptancePersistence.ts does not reference GoalActivityExecution', !/GoalActivityExecution/.test(read('apps/web/lib/dayConstructorAcceptancePersistence.ts')));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY EXECUTION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY EXECUTION STRUCTURAL GUARD CHECKS PASSED');
