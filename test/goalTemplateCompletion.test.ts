/**
 * Goals V2 G3.4 -- template completion requirement inference. Pure-domain
 * and structural coverage (no DB access here -- see
 * test/goalTemplateCompletionDb.test.ts for the live-database proof of
 * persistence, prospective-only behavior, and Goal Detail/Right Now
 * integration). Same source-reading convention as goalsWiring.test.ts/
 * goalsUiWiring.test.ts: reads real, shipped source, never a rendering
 * harness.
 */
import fs from 'fs';
import path from 'path';
import { GOAL_TEMPLATE_CATEGORIES, resolveGoalTemplateActivities } from '../apps/web/lib/goals';
import { validateCompletionRequirement, DONE_COMPLETION_REQUIREMENT, type CompletionRequirement } from '../apps/web/lib/goalCompletion';
import { formatGoalActivityCompletion } from '../apps/web/lib/goalActivityExecution';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(__dirname, relPath), 'utf8');
}

/** Strips `//` and `/* ... *\/` (including doc comments) -- same
 * convention as goalsUiWiring.test.ts/goalDetailCompletionStructuralGuards.test.ts,
 * needed since this file's own explanatory doc comments legitimately
 * discuss (in prose) several of the exact concepts these guards check for
 * the ABSENCE of in real code (e.g. "defaultDurationMinutes is scheduling
 * metadata, not a completion target" -- discussing the field is not using
 * it). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// ============================================================
// 25. TEST — TEMPLATE INVENTORY. Every current GOAL_TEMPLATES activity,
// across every category, must resolve to a valid canonical
// CompletionRequirement (either an explicit one that validates, or the
// implicit DONE default). This is the guard that protects against a
// FUTURE template addition silently carrying an invalid requirement.
// ============================================================
{
  let totalActivities = 0;
  let nonDoneCount = 0;
  let allValid = true;
  for (const category of GOAL_TEMPLATE_CATEGORIES) {
    const resolved = resolveGoalTemplateActivities(category);
    for (const activity of resolved) {
      totalActivities += 1;
      const requirement = activity.completionRequirement ?? DONE_COMPLETION_REQUIREMENT;
      if (requirement.kind !== 'DONE') nonDoneCount += 1;
      const result = validateCompletionRequirement(requirement);
      if (!result.ok) allValid = false;
    }
  }
  check('25. every GOAL_TEMPLATES activity across all 4 categories resolves to a valid CompletionRequirement (DONE or explicit)', allValid);
  check('25. exactly 8 template activities exist across all 4 categories (3 GET_FITTER + 1 MEDITATE_REGULARLY + 3 FINISH_PROJECT + 1 STUDY_CONSISTENTLY)', totalActivities === 8);
  check('25. exactly ONE template activity carries a non-DONE requirement (G3.4\'s own audit found exactly one deterministic, explicit case)', nonDoneCount === 1);
}

// ============================================================
// 26. TEST — DONE. At least one template activity remains DONE, and
// persists via the exact canonical G2.1 storage convention (all three
// columns null) -- reusing toPersistedCompletionRequirement, never a
// template-only reimplementation.
// ============================================================
{
  const getFitter = resolveGoalTemplateActivities('GET_FITTER');
  check('26. GET_FITTER "Go for a run" has no completionRequirement (DONE by omission)', getFitter[0].title === 'Go for a run' && getFitter[0].completionRequirement === undefined);
  const finishProject = resolveGoalTemplateActivities('FINISH_PROJECT');
  check('26. FINISH_PROJECT activities all remain DONE (no explicit quantity in any of their titles)', finishProject.every((a) => a.completionRequirement === undefined));
  const studyConsistently = resolveGoalTemplateActivities('STUDY_CONSISTENTLY');
  check('26. STUDY_CONSISTENTLY "Study session" remains DONE -- no invented 30-minute target', studyConsistently[0].completionRequirement === undefined);
}

// ============================================================
// 27. TEST — DURATION. Repository evidence supports exactly one DURATION
// mapping: MEDITATE_REGULARLY's own "Meditate 10 minutes" (the static
// template title itself explicitly states the quantity). Assert the
// resolved requirement, then assert the EXISTING G3.2/G3.3 canonical
// formatter (unchanged by this ticket) produces "10 min" given it -- no
// Goal Detail/Right Now production code is touched to prove this.
// ============================================================
{
  const meditate = resolveGoalTemplateActivities('MEDITATE_REGULARLY');
  check('27. MEDITATE_REGULARLY "Meditate 10 minutes" resolves to DURATION targetValue=10', meditate[0].completionRequirement?.kind === 'DURATION' && meditate[0].completionRequirement?.targetValue === 10);
  check('27. DURATION requirement carries no persisted unit (implicit minutes)', meditate[0].completionRequirement?.unit === undefined);
  const requirement = meditate[0].completionRequirement as CompletionRequirement;
  check('27. formatGoalActivityCompletion(requirement, null) -> "10 min" (no execution yet)', formatGoalActivityCompletion(requirement, null) === '10 min');
  check('27. formatGoalActivityCompletion(requirement, 10) -> "10 min" (actual matches target, compact form)', formatGoalActivityCompletion(requirement, 10) === '10 min');
  check('27. formatGoalActivityCompletion(requirement, 5) -> "5 / 10 min" (actual differs, shown factually)', formatGoalActivityCompletion(requirement, 5) === '5 / 10 min');
}

// ============================================================
// 28. TEST — MEASURED_TARGET. Only if repository evidence supports one
// (this ticket's own section 28: "Only if repository evidence supports a
// ... mapping"). G3.4's own audit (ticket section 7) found NO template
// activity with an explicit, deterministic unit+quantity ("Read 20 pages"
// has no analogue in the current 4 categories) -- so this assertion
// proves that finding stays true, rather than fabricating a target to
// exercise the code path.
// ============================================================
{
  let anyMeasuredTarget = false;
  for (const category of GOAL_TEMPLATE_CATEGORIES) {
    for (const activity of resolveGoalTemplateActivities(category)) {
      if (activity.completionRequirement?.kind === 'MEASURED_TARGET') anyMeasuredTarget = true;
    }
  }
  check('28. no MEASURED_TARGET mapping exists in any current template -- G3.4\'s audit found insufficient deterministic evidence for one, so none was manufactured', !anyMeasuredTarget);
}

// ============================================================
// 31. TEST — EXPLICIT TEMPLATE SELECTION ONLY. A Goal title alone
// ("Get fitter") must never trigger template decomposition -- only an
// explicit, valid templateCategory does. Structural proof against the
// real route source (same convention as goalsUiWiring.test.ts).
// ============================================================
{
  const routeSrc = read('../apps/web/app/api/goals/route.ts');
  check('31. POST /api/goals only calls resolveGoalTemplateActivities when body.templateCategory is present and valid -- never derived from body.title', /if \(body\.templateCategory !== undefined && body\.templateCategory !== null\)/.test(routeSrc) && /resolveGoalTemplateActivities\(body\.templateCategory\)/.test(routeSrc));
  check('31. route.ts never passes body.title into resolveGoalTemplateActivities/isGoalTemplateCategory', !/resolveGoalTemplateActivities\(.*title|isGoalTemplateCategory\(.*title/.test(routeSrc));
  check('31. an omitted/absent templateCategory leaves activities as the empty array (never a guessed template)', /let activities: ReturnType<typeof resolveGoalTemplateActivities> = \[\]/.test(routeSrc));
}

// ============================================================
// 32. TEST — TITLE KEYWORDS DO NOTHING. Representative titles matching
// template concepts, without a templateCategory, must never trigger
// keyword-based decomposition. Structural: the route/goals.ts source
// contains no keyword-matching construct against body.title/Goal title at
// all (findActivityIntent's own alias-substring matching is a SEPARATE,
// already-existing mechanism for resolving an INDIVIDUAL activity TITLE
// against the catalog -- never against the Goal's own title, and never
// used to choose a templateCategory).
// ============================================================
{
  const routeSrc = read('../apps/web/app/api/goals/route.ts');
  const goalsSrc = read('../apps/web/lib/goals.ts');
  const goalsSrcNoComments = stripComments(goalsSrc);
  const routeSrcNoComments = stripComments(routeSrc);
  check('32. route.ts contains no keyword/regex match against body.title for template selection (no .includes(/.match(/RegExp against title)', !/body\.title\.(includes|match)|RegExp.*title/.test(routeSrc));
  check('32. goals.ts contains no LLM/embedding/fuzzy-matching CODE reference anywhere (doc-comment prose discussing what was NOT added is excluded)', !/openai|anthropic|\bllm\b|embedding|fuzzy/i.test(goalsSrcNoComments));
  check('32. route.ts contains no LLM/embedding/fuzzy-matching CODE reference anywhere', !/openai|anthropic|\bllm\b|embedding|fuzzy/i.test(routeSrcNoComments));
}

// ============================================================
// 33. TEST — INVALID REQUIREMENT. Reuses the canonical G2.1 validator
// (never a weaker template-only one) to prove a hypothetical invalid
// requirement (DURATION target <= 0, MEASURED_TARGET missing unit) is
// rejected -- and that no second, competing validator was created
// anywhere in this codebase for templates specifically.
// ============================================================
{
  check('33. validateCompletionRequirement rejects DURATION with targetValue <= 0', validateCompletionRequirement({ kind: 'DURATION', targetValue: 0 }).ok === false);
  check('33. validateCompletionRequirement rejects MEASURED_TARGET missing unit', validateCompletionRequirement({ kind: 'MEASURED_TARGET', targetValue: 20 }).ok === false);
  const goalsSrc = read('../apps/web/lib/goals.ts');
  check('33. goals.ts defines no second/weaker completion validator of its own (no "validateGoalTemplate"/"validateTemplateCompletion" function)', !/function validate(GoalTemplate|TemplateCompletion)/.test(goalsSrc));
}

// ============================================================
// 39. STRUCTURAL GUARDS
// ============================================================
{
  const goalsSrc = read('../apps/web/lib/goals.ts');
  const goalsSrcNoComments = stripComments(goalsSrc);
  const routeSrc = read('../apps/web/app/api/goals/route.ts');
  const dbSrc = read('../apps/web/lib/db.ts');
  const schemaSrc = read('../apps/web/prisma/schema.prisma');

  check('39. GOAL_TEMPLATES itself owns completionRequirement (an inline field on each template activity definition, not a second disconnected lookup table)', /interface GoalTemplateActivityDefinition/.test(goalsSrc) && /completionRequirement\?: CompletionRequirement/.test(goalsSrc));
  check('39. goals.ts reuses the canonical CompletionRequirement type via a type-only import (never redefines DONE/DURATION/MEASURED_TARGET as its own union)', /import type \{ CompletionRequirement \} from '\.\/goalCompletion'/.test(goalsSrc) && !/type CompletionRequirement =|type CompletionKind =/.test(goalsSrc));
  check('39. completionRequirement is never derived from findActivityIntent/catalog metadata (no defaultDurationMinutes CODE reference in goals.ts -- doc-comment prose explaining why it must never be used is excluded)', !/defaultDurationMinutes/.test(goalsSrcNoComments));
  check('39. resolveGoalTemplateActivities passes completionRequirement straight from the static table, never computed from the resolved activityId/catalog entry', /completionRequirement: entry\.completionRequirement/.test(goalsSrc));
  // Goals V2 Rhythm R5 (a later, separately-authorized ticket) legitimately
  // extended this same INSERT with two more trailing columns
  // (rhythmKind/rhythmTargetPerWeek) for its own, entirely independent
  // per-activity Rhythm input -- see test/goalActivityRhythmSetupDb.test.ts
  // for R5's own guards. The real invariant this check still protects is
  // narrower than "unchanged": the completion columns themselves remain
  // exactly where G3.4 put them, in the same order, with no new write path
  // for THEM specifically.
  check(
    '39. createGoalWithActivities\'s own INSERT still targets the completion columns exactly as G3.4 left them (completionRequirement was already accepted/persisted since G2.1 -- zero new write path added by G3.4; Rhythm R5 only appended its own trailing columns, never touching these)',
    /INSERT INTO "GoalActivity" \(id, "userId", "goalId", title, "activityId", "completionKind", "completionTargetValue", "completionUnit"/.test(dbSrc)
  );
  check('39. db.ts gained no new SQL UPDATE targeting existing GoalActivity completion columns (no backfill of historical rows)', !/UPDATE "GoalActivity" SET "completionKind"|UPDATE "GoalActivity" SET "completionTargetValue"/.test(dbSrc));
  // No bare migration-directory-count guard here (removed -- it broke on
  // every unrelated future migration by construction). The model-block
  // check just below already proves the real, count-independent
  // invariant directly, and a Prisma migration can only exist because
  // schema.prisma changed first (enforced separately by the repo's own
  // "Database migration validation" CI job).
  const goalActivityBlockMatch = schemaSrc.match(/model GoalActivity \{([\s\S]*?)\n\}/);
  const goalActivityBlock = goalActivityBlockMatch ? goalActivityBlockMatch[1] : '';
  check('39. GoalActivity model carries the three pre-existing completion columns and no new fourth one (completionSource/completionHistory/etc.)', /completionKind/.test(goalActivityBlock) && /completionTargetValue/.test(goalActivityBlock) && /completionUnit/.test(goalActivityBlock) && !/completionSource|completionHistory|completionScore/.test(goalActivityBlock));
  check('39. route.ts gained no new public API field for completion (server-owned template resolution, never client-supplied)', !/body\.completionRequirement|body\.targetValue|body\.completionUnit/.test(routeSrc));
  // Goals V2 Candidate B3 (a later, separately-authorized ticket)
  // legitimately introduces a REAL `rhythm` field elsewhere in goals.ts --
  // on ReviewedGoalActivityInput, the explicit reviewed-Goal-create wire
  // type, entirely independent of the static template taxonomy this check
  // actually protects. So this check is scoped to exactly the two
  // template-shape declarations it was always about (GoalTemplateActivityDefinition
  // and GOAL_TEMPLATES itself), not the whole file -- narrower, not
  // weaker: it still fails if either template declaration ever grows a
  // Rhythm/RRULE/frequency field of its own.
  const templateActivityDefinitionBlock = (goalsSrcNoComments.match(/interface GoalTemplateActivityDefinition \{[\s\S]*?\n\}/) ?? [''])[0];
  const goalTemplatesConstBlock = (goalsSrcNoComments.match(/const GOAL_TEMPLATES[\s\S]*?\n\};/) ?? [''])[0];
  check(
    '39. GOAL_TEMPLATES itself carries no Rhythm/RRULE/day-frequency field (scoped to GoalTemplateActivityDefinition + GOAL_TEMPLATES\' own declarations -- Candidate B3\'s unrelated ReviewedGoalActivityInput.rhythm field elsewhere in the file is excluded)',
    templateActivityDefinitionBlock.length > 0 && goalTemplatesConstBlock.length > 0 && !/\bRhythm\b|\bRRULE\b|\bfrequency\b/i.test(templateActivityDefinitionBlock) && !/\bRhythm\b|\bRRULE\b|\bfrequency\b/i.test(goalTemplatesConstBlock)
  );
  check('39. GOAL_TEMPLATES contains no day-accumulation concept (dayBucket/dailyTarget/accumulat)', !/dayBucket|dailyTarget|accumulat/i.test(goalsSrcNoComments));
  check('39. GOAL_TEMPLATES contains no CHECKLIST kind', !/CHECKLIST/.test(goalsSrcNoComments));
  check('39. goals.ts contains no progress-write/history concept (executionHistory/weeklyTotal/allExecutions)', !/executionHistory|weeklyTotal|allExecutions/.test(goalsSrcNoComments));
  check('39. goals.ts contains no streak/score/gamification CODE concept (its own pre-existing, unrelated GoalProgress doc-comment prose -- "never a score, never persisted" -- is excluded)', !/\bstreak\b|\bscore\b|gamif/i.test(goalsSrcNoComments));

  const goalsListClientSrc = read('../apps/web/app/goals/GoalsListClient.tsx');
  check('39. CreateGoalModal (GoalsListClient.tsx) gained no completion-type selector/target field/unit field/duration field', !/completionKind|completionTargetValue|completionUnit|targetValue|durationMinutes/.test(goalsListClientSrc));

  const homeDashboardSrc = read('../apps/web/components/HomeDashboard.tsx');
  const homeTimelineSrc = read('../apps/web/components/HomeTimeline.tsx');
  check('39. HomeDashboard.tsx unchanged by G3.4 (no GOAL_TEMPLATES/resolveGoalTemplateActivities reference)', !/GOAL_TEMPLATES|resolveGoalTemplateActivities/.test(homeDashboardSrc));
  check('39. HomeTimeline.tsx unchanged by G3.4 (no GOAL_TEMPLATES/resolveGoalTemplateActivities reference)', !/GOAL_TEMPLATES|resolveGoalTemplateActivities/.test(homeTimelineSrc));

  const goalDetailSrc = read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx');
  check('39. GoalDetailClient.tsx unchanged by G3.4 (no GOAL_TEMPLATES/resolveGoalTemplateActivities reference -- no special template knowledge)', !/GOAL_TEMPLATES|resolveGoalTemplateActivities/.test(goalDetailSrc));

  const constructorSrc = read('../apps/web/lib/dayConstructorOrchestrator.ts');
  const planMoveSrc = read('../apps/web/lib/planMove.ts');
  check('39. dayConstructorOrchestrator.ts unchanged by G3.4 (no GOAL_TEMPLATES/resolveGoalTemplateActivities reference)', !/GOAL_TEMPLATES|resolveGoalTemplateActivities/.test(constructorSrc));
  check('39. planMove.ts unchanged by G3.4 (no GOAL_TEMPLATES/resolveGoalTemplateActivities reference)', !/GOAL_TEMPLATES|resolveGoalTemplateActivities/.test(planMoveSrc));
  check('39. route.ts calls no Constructor/orchestrator function during Goal creation (goal creation stays planning-free)', !/dayConstructorOrchestrator|buildDailyAgenda|runOrchestrator/.test(routeSrc));
}

if (!allPassed) {
  console.error('SOME GOAL TEMPLATE COMPLETION CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL TEMPLATE COMPLETION CHECKS PASSED');
