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
// PR #181 reconciliation -- this check originally scanned the WHOLE
// GoalActivity model block, which HPG3-A1 (migration 0051) legitimately,
// separately-reviewed, added dailyFrequencyKind/dailyFrequencyLimit to
// (apps/web/lib/goalActivityDailyFrequency.ts), tripping the
// frequency/recurrence regex on an intentional, unrelated later change.
// Narrowed to the completion-requirement span (completionKind through
// completionUnit) this check actually cares about -- still catches a real
// unintended change to THAT span, no longer trips on HPG3-A1's or Rhythm
// R2's own, separately-guarded fields elsewhere in the same model.
const completionRequirementSpan = (() => {
  const match = goalActivityBlock.match(/completionKind\s*String\?[\s\S]*?completionUnit\s*String\?/);
  if (!match) throw new Error('completion-requirement span (completionKind..completionUnit) not found in GoalActivity model');
  return match[0];
})();
check('GoalActivity model\'s completion-requirement span (completionKind..completionUnit) has no recurrence/frequency field (deferred, not part of G2.1; HPG3-A1\'s dailyFrequencyKind/dailyFrequencyLimit and Rhythm R2\'s rhythmKind/rhythmTargetPerWeek are separate, later, separately-reviewed additions elsewhere in the model)', !/frequency|recurrence|recurring/i.test(completionRequirementSpan));

const goalCompletionPath = path.join(__dirname, '..', 'apps', 'web', 'lib', 'goalCompletion.ts');
const goalCompletionSrc = fs.readFileSync(goalCompletionPath, 'utf8');
check('goalCompletion.ts never defines a CHECKLIST kind', !/'CHECKLIST'/.test(goalCompletionSrc));
check('goalCompletion.ts never defines separate COUNT/QUANTITY kinds (collapsed into MEASURED_TARGET per G1 decision 5)', !/'COUNT'|'QUANTITY'/.test(goalCompletionSrc));

// ============================================================
// Existing templates remained unclassified as of G2.1 (still DONE by
// omission). Goals V2 G3.4 (a later, separately-authorized ticket)
// intentionally enriched GOAL_TEMPLATES with a canonical
// CompletionRequirement per activity, reusing this exact module's own
// CompletionRequirement type -- see test/goals.test.ts and
// test/goalCompletionStructuralGuards.test.ts's own G3.4-era checks below
// for what stayed narrow (no CHECKLIST, no Rhythm, no scheduling-duration
// conflation, no backfill).
// ============================================================
const goalsSrcPath = path.join(__dirname, '..', 'apps', 'web', 'lib', 'goals.ts');
const goalsSrc = fs.readFileSync(goalsSrcPath, 'utf8');
check('lib/goals.ts imports ONLY the CompletionRequirement type from goalCompletion.ts, type-only -- never the validator/normalizer/persister (template resolution stays a pure pass-through, never its own competing validation or persistence path)', /import type \{ CompletionRequirement \} from '\.\/goalCompletion'/.test(goalsSrc) && !/validateCompletionRequirement|normalizeGoalActivityCompletionRequirement|toPersistedCompletionRequirement/.test(goalsSrc));
check('lib/goals.ts (GOAL_TEMPLATES) assigns DURATION in EXACTLY the one deterministic, audited case (MEDITATE_REGULARLY\'s "Meditate 10 minutes") -- exactly one \'DURATION\' string literal anywhere in the file', (goalsSrc.match(/'DURATION'/g) ?? []).length === 1);
check('lib/goals.ts (GOAL_TEMPLATES) assigns NO MEASURED_TARGET requirement -- G3.4\'s own audit found no template activity with a deterministic, explicit measured unit+quantity', !/'MEASURED_TARGET'/.test(goalsSrc));

if (!allPassed) {
  console.error('SOME GOAL COMPLETION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL COMPLETION STRUCTURAL GUARD CHECKS PASSED');
