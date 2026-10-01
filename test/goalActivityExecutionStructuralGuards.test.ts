/**
 * Goals V2 G2.2.1/G2.2.2/G2.2.3 -- narrow structural guards confirming
 * these slices stayed exactly as scoped as intended, each scoped to
 * exactly the model/module in question -- never a brittle repo-wide grep.
 * G2.2.1's guards (schema shape, taxonomy reuse) are unchanged. G2.2.2
 * added guards for its own section 41: GoalActivityExecution is
 * legitimately referenced by the completion path (db.ts's
 * logPlannedActivity). G2.2.3 adds guards for its own section 34:
 * GoalActivityExecution is now ALSO legitimately referenced by
 * planMove.ts's applyMoveWrites (a pure pointer repoint, alongside the
 * existing Capture/GoalActivity continuity lines) -- but that repoint must
 * never reference completion-definition fields, currentValue, or source,
 * and must remain absent from Constructor, Home presentation, and
 * DailyAgenda.
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
const planMoveSrc = read('apps/web/lib/planMove.ts');
const applyMoveWritesBodyRaw = planMoveSrc.slice(planMoveSrc.indexOf('export async function applyMoveWrites'));
// Field-declaration/statement checks below must ignore this function's own
// doc-comment prose (which legitimately discusses currentValue/source in
// explaining why they're untouched) -- only real code should trip them.
const applyMoveWritesBody = stripComments(applyMoveWritesBodyRaw);
check('G2.2.3: applyMoveWrites DOES reference GoalActivityExecution -- the intended continuity repoint', /GoalActivityExecution/.test(applyMoveWritesBody));
check('G2.2.3: the GoalActivityExecution statement in applyMoveWrites is a pure pointer UPDATE (plannedActivityId only) -- it never references completionKind/completionTargetValue/completionUnit (would mean re-snapshotting from a live GoalActivity)', /UPDATE "GoalActivityExecution" SET "plannedActivityId"/.test(applyMoveWritesBody) && !/completionKind|completionTargetValue|completionUnit/.test(applyMoveWritesBody));
check('G2.2.3: applyMoveWrites never references currentValue -- Move must not reset/default/clamp/recalculate it', !/currentValue/.test(applyMoveWritesBody));
check('G2.2.3: applyMoveWrites never references source -- moving a plan is not a progress observation', !/"source"/.test(applyMoveWritesBody));
check('G2.2.3: applyMoveWrites contains no INSERT INTO "GoalActivityExecution" -- Move never creates an execution row', !/INSERT INTO "GoalActivityExecution"/.test(applyMoveWritesBody));
check('G2.2.3: applyMoveWrites contains no DELETE FROM "GoalActivityExecution" -- Move never deletes an execution row', !/DELETE FROM "GoalActivityExecution"/.test(applyMoveWritesBody));
check('G2.2.3: movePlannedActivity\'s public input shape (MovePlanInput) still carries only newStartAt -- no new client-supplied executionId/goalActivityId/currentValue/completionRequirement field', /export interface MovePlanInput \{\s*newStartAt: Date;\s*\}/.test(planMoveSrc));
check('homeCompletion.ts (Home/Right Now) does not reference GoalActivityExecution -- no UX change in G2.2.2/G2.2.3', !/GoalActivityExecution/.test(read('apps/web/lib/homeCompletion.ts')));
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
