/**
 * Goals V2 G2.1 -- narrow structural guards against a small set of specific
 * regressions this ticket explicitly calls out (its own section 21), each
 * scoped to exactly the model/module in question -- never a brittle
 * repo-wide grep. Reads real source files directly; asserts on their text.
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

function extractModelBlock(modelName: string): string {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`model ${modelName} not found in schema.prisma`);
  return match[1];
}

const goalBlock = extractModelBlock('Goal');
const goalActivityBlock = extractModelBlock('GoalActivity');
const plannedActivityBlock = extractModelBlock('PlannedActivity');

// ============================================================
// Ownership: completion requirement lives ONLY on GoalActivity
// ============================================================
check('Goal model carries none of the three completion-requirement columns', !/completionKind|completionTargetValue|completionUnit/.test(goalBlock));
check('Goal model has no stored progress/percentage field (progress stays derived, lib/goals.ts computeGoalProgress)', !/\bprogress\b/i.test(goalBlock));
check('PlannedActivity model carries none of the three completion-requirement columns (ownership stays on GoalActivity, not the occurrence layer)', !/completionKind|completionTargetValue|completionUnit/.test(plannedActivityBlock));
check('PlannedActivity model gained no occurrence-progress fields in G2.1 (currentValue/targetValue/progressValue/completionSource/actualDuration -- deferred to a later slice)', !/currentValue|progressValue|completionSource|actualDuration/.test(plannedActivityBlock));
check('GoalActivity model DOES carry all three completion-requirement columns', /completionKind/.test(goalActivityBlock) && /completionTargetValue/.test(goalActivityBlock) && /completionUnit/.test(goalActivityBlock));

// ============================================================
// Taxonomy: CHECKLIST/recurrence never entered G2.1
// ============================================================
check('schema.prisma contains no CHECKLIST reference anywhere (deferred, not part of G2.1)', !/CHECKLIST/.test(schema));
check('GoalActivity model has no recurrence/frequency field (deferred, not part of G2.1)', !/frequency|recurrence|recurring/i.test(goalActivityBlock));

const goalCompletionPath = path.join(__dirname, '..', 'apps', 'web', 'lib', 'goalCompletion.ts');
const goalCompletionSrc = fs.readFileSync(goalCompletionPath, 'utf8');
check('goalCompletion.ts never defines a CHECKLIST kind', !/'CHECKLIST'/.test(goalCompletionSrc));
check('goalCompletion.ts never defines separate COUNT/QUANTITY kinds (collapsed into MEASURED_TARGET per G1 decision 5)', !/'COUNT'|'QUANTITY'/.test(goalCompletionSrc));

// ============================================================
// Existing templates remain unclassified (still DONE by omission)
// ============================================================
const goalsSrcPath = path.join(__dirname, '..', 'apps', 'web', 'lib', 'goals.ts');
const goalsSrc = fs.readFileSync(goalsSrcPath, 'utf8');
check('lib/goals.ts (GOAL_TEMPLATES) was not reclassified with a completion kind -- no DURATION/MEASURED_TARGET reference anywhere in the template table', !/GOAL_TEMPLATES[\s\S]*?(DURATION|MEASURED_TARGET)/.test(goalsSrc));
check('lib/goals.ts does not import from goalCompletion.ts -- template resolution stays completion-kind-unaware in G2.1', !/from ['"]\.\/goalCompletion['"]/.test(goalsSrc));

if (!allPassed) {
  console.error('SOME GOAL COMPLETION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL COMPLETION STRUCTURAL GUARD CHECKS PASSED');
