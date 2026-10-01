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

// Goals -> Planning Integration V1 PR C -- five files were REMOVED from
// this "must stay Goal-unaware forever" list: acceptConstructedDay.ts,
// dayConstructorAcceptancePersistence.ts, planDayEntry.ts,
// planDayBootstrap.ts, and app/plan-day/PlanDayClient.tsx. PR A's own
// boundary (this file's own module doc comment above) was correct AT PR
// A's OWN MERGE -- PR C is the ticket explicitly authorized to add the
// Goal <-> Plan My Day handoff through exactly these five files (its own
// section 3/6/9/10/20/26), so their presence in this list is now
// superseded, not a regression. Every OTHER file below (Day Constructor
// core/orchestrator, DayIntent, Timing Search, both preview files, E1
// acceptance evaluation, availability, Home timeline composer, Day
// Builder) remains correctly Goal-unaware -- PR C's own explicit
// boundary (its own section 16/17/18/19) -- and PR C's own dedicated
// suite (goalPlanningHandoffWiring.test.ts) re-proves that, plus proves
// the five files above only gained the narrow, sibling-envelope
// additions PR C's own design calls for, never anything deeper.
const UNTOUCHED_FILES: Record<string, string> = {
  'Day Constructor core': '../apps/web/lib/dayConstructor.ts',
  'Day Constructor orchestrator': '../apps/web/lib/dayConstructorOrchestrator.ts',
  'DayIntent domain contract': '../apps/web/lib/dayIntent.ts',
  'Timing search': '../packages/recommendation/src/timingSearch.ts',
  'Preview request parsing (wire contract)': '../apps/web/lib/dayConstructorPreviewRequest.ts',
  'Preview client (wire contract)': '../apps/web/lib/dayConstructorPreviewClient.ts',
  'Acceptance evaluation (E1)': '../apps/web/lib/dayConstructorAcceptance.ts',
  'Availability context': '../apps/web/lib/availabilityContext.ts',
  'Home timeline composer': '../apps/web/lib/homeTimelineComposer.ts',
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
  // Goals V2 G2.2.1 added a second, equally back-relation-only navigation
  // field (goalActivityExecution GoalActivityExecution?) for the same
  // reason as goalActivity above -- broadened to accept either, still
  // rejecting any line that carries a real `fields:` FK attribute. Rhythm
  // R1 (migration 0042) added a THIRD, identically-shaped navigation field
  // (goalActivityOccurrence GoalActivityOccurrence?) for the identical
  // reason -- broadened again, same rejection of any `fields:` attribute.
  check(
    '17. every non-comment line in the PlannedActivity model block mentioning Goal is a back-relation-only field (no @relation(fields:...) attribute, i.e. no real column/FK)',
    goalMentionLines.length > 0 && goalMentionLines.every((line) => (/goalActivity\s+GoalActivity\?/.test(line) || /goalActivityExecution\s+GoalActivityExecution\?/.test(line) || /goalActivityOccurrence\s+GoalActivityOccurrence\?/.test(line)) && !line.includes('fields:'))
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
  // Constructor/acceptance/Plan-My-Day stack -- its external dependencies
  // are the static activity catalog (findActivityIntent, for template
  // resolution) and, as of Goals V2 G3.4 (a later, separately-authorized
  // ticket), a TYPE-ONLY import of the canonical CompletionRequirement
  // from its own sibling Goals-domain module (goalCompletion.ts) -- never
  // a value import, and never anything from the Constructor/acceptance/
  // Plan-My-Day stack this check actually protects against. See
  // test/goalTemplateCompletion.test.ts's own section-39 guards for the
  // narrower, G3.4-specific proof (type-only import, no validator/
  // normalizer/persister imported).
  // ============================================================
  const goalsLibSource = read('../apps/web/lib/goals.ts');
  const importLines = goalsLibSource.split('\n').filter((line) => line.trim().startsWith('import'));
  check(
    '20. lib/goals.ts imports only the activity catalog (value import) and, since G3.4, a type-only CompletionRequirement import from its own sibling goalCompletion.ts -- nothing from the Day Constructor/acceptance/Plan-My-Day stack',
    importLines.length === 2 && importLines[0].includes('personalizedTasks') && importLines[1].startsWith('import type') && importLines[1].includes('./goalCompletion')
  );

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
  // 22. No /goals UI existed at PR A's own merge (this PR's own explicit
  // boundary at the time). PR B (Goals -> Planning Integration V1 PR B)
  // has since legitimately added apps/web/app/goals/** -- that directory
  // existing in the live tree is expected from PR B onward, not a
  // regression of PR A's own boundary, so the "directory absent" form of
  // this check is retired (it did its job: PR A's own merged diff,
  // reviewed at the time, added no UI). PR B owns verifying ITS OWN
  // boundary now (test/goalsUiWiring.test.ts) -- what remains load-
  // bearing here is that no GoalCard/GoalReviewCard component was ever
  // added directly under components/ (PR B instead used dedicated
  // app/goals/** client components, following this repo's own routed-
  // page convention -- see goalsUiWiring.test.ts for that verification).
  // ============================================================
  check('22. no GoalCard/GoalReviewCard component exists directly under components/', !fs.existsSync(path.join(__dirname, '../apps/web/components/GoalCard.tsx')) && !fs.existsSync(path.join(__dirname, '../apps/web/components/GoalReviewCard.tsx')));

  if (!allPassed) {
    console.error('SOME GOALS WIRING CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOALS WIRING CHECKS PASSED');
}

main();
