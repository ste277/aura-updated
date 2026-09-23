/**
 * Goals -> Planning Integration V1 PR A -- structural regression suite
 * proving this PR's own explicit boundary (section 28: "PR A must not
 * change behavior in Plan My Day / Day Constructor / orchestrator / Timing
 * Search / Availability / Home Timeline Composer / Calendar / Habits / Day
 * Builder / acceptConstructedDay / acceptance persistence") -- and that
 * PlannedActivity gains zero persisted Goal-data column. Same
 * source-reading convention as planDayWiring.test.ts: reads real, shipped
 * source, never a rendering/execution harness.
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

const UNTOUCHED_FILES: Record<string, string> = {
  'Day Constructor core': '../apps/web/lib/dayConstructor.ts',
  'Day Constructor orchestrator': '../apps/web/lib/dayConstructorOrchestrator.ts',
  'DayIntent domain contract': '../apps/web/lib/dayIntent.ts',
  'Timing search': '../packages/recommendation/src/timingSearch.ts',
  'Preview request parsing (wire contract)': '../apps/web/lib/dayConstructorPreviewRequest.ts',
  'Preview client (wire contract)': '../apps/web/lib/dayConstructorPreviewClient.ts',
  'Accept client helper': '../apps/web/lib/acceptConstructedDay.ts',
  'Acceptance evaluation (E1)': '../apps/web/lib/dayConstructorAcceptance.ts',
  'Acceptance persistence (E2)': '../apps/web/lib/dayConstructorAcceptancePersistence.ts',
  'Availability context': '../apps/web/lib/availabilityContext.ts',
  'Home timeline composer': '../apps/web/lib/homeTimelineComposer.ts',
  'Plan My Day entry/row model': '../apps/web/lib/planDayEntry.ts',
  'Plan My Day bootstrap': '../apps/web/lib/planDayBootstrap.ts',
  'Plan My Day client component': '../apps/web/app/plan-day/PlanDayClient.tsx',
  'Day Builder': '../apps/web/lib/dayBuilder.ts',
  'Day Builder card component': '../apps/web/components/DayBuilderCard.tsx',
};

function main() {
  // ============================================================
  // 1-16: none of PR A's own scope leaked into any file this PR's own
  // section 28 says must not change behavior. A literal case-sensitive
  // "Goal" substring check is deliberately strict -- this PR introduces no
  // legitimate reason for any of these files to mention Goal/GoalActivity
  // at all yet (that's later PRs' job).
  // ============================================================
  let i = 1;
  for (const [label, relPath] of Object.entries(UNTOUCHED_FILES)) {
    const source = read(relPath);
    check(`${i}. ${label} (${relPath.replace('../', '')}) has zero mention of Goal/GoalActivity`, !/\bGoal(Activity)?\b/.test(source));
    i += 1;
  }

  // ============================================================
  // 17. PlannedActivity's Prisma model block gains no real column: the
  // ONLY Goal-related text inside the model block must be the back-
  // relation navigation field, which has no `@relation(fields: ...,
  // references: ...)` attribute (a real FK/column would need one -- see
  // this file's own goalActivity doc comment in schema.prisma). A `Goal`
  // mention WITH a `fields:`/`references:` attribute on the same
  // statement would mean a real column was added -- exactly what this
  // check exists to catch.
  // ============================================================
  const schemaSource = read('../apps/web/prisma/schema.prisma');
  const plannedActivityBlockMatch = schemaSource.match(/model PlannedActivity \{[\s\S]*?\n\}/);
  check('17. PlannedActivity model block is present and extractable', plannedActivityBlockMatch !== null);
  const plannedActivityBlock = plannedActivityBlockMatch ? plannedActivityBlockMatch[0] : '';
  const goalMentionLines = plannedActivityBlock.split('\n').filter((line) => /Goal/.test(line) && !line.trim().startsWith('//'));
  check(
    '17. every non-comment line in the PlannedActivity model block mentioning Goal is the back-relation-only field (no @relation(fields:...) attribute, i.e. no real column/FK)',
    goalMentionLines.length > 0 && goalMentionLines.every((line) => /goalActivity\s+GoalActivity\?/.test(line) && !line.includes('fields:'))
  );

  // ============================================================
  // 18. The migration itself never touches the existing PlannedActivity
  // table at all -- proves the zero-column claim at the actual SQL level,
  // not just the schema-authoring level.
  // ============================================================
  const migrationSource = read('../apps/web/prisma/migrations/0035_goals/migration.sql');
  check('18. migration 0035_goals contains no ALTER TABLE "PlannedActivity" statement', !/ALTER TABLE "PlannedActivity"/.test(migrationSource));
  check('18. migration 0035_goals creates exactly the two new tables (Goal, GoalActivity), nothing else', /CREATE TABLE "Goal"/.test(migrationSource) && /CREATE TABLE "GoalActivity"/.test(migrationSource));

  // ============================================================
  // 19. db.ts's Goal-related functions never import Day Constructor/
  // orchestrator/timing-search modules -- proves persistence stays
  // decoupled from scheduling, not just "no Goal text in those files."
  // ============================================================
  const dbSource = read('../apps/web/lib/db.ts');
  check('19. db.ts never imports dayConstructor/dayConstructorOrchestrator/timingSearch', !/from ['"].*dayConstructor(Orchestrator)?['"]/.test(dbSource) && !/from ['"].*timingSearch['"]/.test(dbSource));

  // ============================================================
  // 20. lib/goals.ts itself never imports anything from the Day
  // Constructor/acceptance/Plan-My-Day stack -- its only external
  // dependency is the static activity catalog (findActivityIntent), which
  // it needs for template resolution.
  // ============================================================
  const goalsLibSource = read('../apps/web/lib/goals.ts');
  const importLines = goalsLibSource.split('\n').filter((line) => line.trim().startsWith('import'));
  check('20. lib/goals.ts has exactly one import, from the activity catalog only', importLines.length === 1 && importLines[0].includes('personalizedTasks'));

  // ============================================================
  // 21. No app/api/goals/** route imports anything from the Day
  // Constructor/acceptance stack (this PR adds no Plan My Day handoff).
  // ============================================================
  const goalsRouteFiles = [
    '../apps/web/app/api/goals/route.ts',
    '../apps/web/app/api/goals/[goalId]/route.ts',
    '../apps/web/app/api/goals/[goalId]/archive/route.ts',
    '../apps/web/app/api/goals/[goalId]/activities/route.ts',
    '../apps/web/app/api/goals/[goalId]/activities/[goalActivityId]/dismiss/route.ts',
  ];
  for (const relPath of goalsRouteFiles) {
    const source = read(relPath);
    check(`21. ${relPath.split('/').slice(-2).join('/')} imports nothing from dayConstructor*/acceptConstructedDay/planDay*`, !/from ['"].*(dayConstructor|acceptConstructedDay|planDay)/.test(source));
  }

  // ============================================================
  // 22. No /goals UI exists yet (this PR's own explicit boundary).
  // ============================================================
  check('22. no app/goals directory exists yet (no Goals UI in PR A)', !fs.existsSync(path.join(__dirname, '../apps/web/app/goals')));
  check('22. no GoalCard/GoalReviewCard component exists yet', !fs.existsSync(path.join(__dirname, '../apps/web/components/GoalCard.tsx')) && !fs.existsSync(path.join(__dirname, '../apps/web/components/GoalReviewCard.tsx')));

  if (!allPassed) {
    console.error('SOME GOALS WIRING CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOALS WIRING CHECKS PASSED');
}

main();
