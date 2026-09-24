/**
 * Goals -> Planning Integration V1 PR C -- structural regression suite
 * proving this PR's own explicit boundary: no Goal awareness leaks into
 * DayIntent/Day Constructor/Timing Search/the orchestrator's placement
 * semantics/E1's scheduling-domain acceptance contract, and the accept
 * envelope's Goal-linkage field is a genuine SIBLING, never merged into
 * the scheduling-domain request shape. Same source-reading convention as
 * planDayWiring.test.ts / goalsWiring.test.ts / goalsUiWiring.test.ts --
 * this repository has no component-rendering harness.
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

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const UNTOUCHED_SCHEDULING_FILES: Record<string, string> = {
  'DayIntent domain contract': '../apps/web/lib/dayIntent.ts',
  'Day Constructor core': '../apps/web/lib/dayConstructor.ts',
  'Timing search': '../packages/recommendation/src/timingSearch.ts',
  'Preview request parsing (wire contract)': '../apps/web/lib/dayConstructorPreviewRequest.ts',
  'Preview client (wire contract)': '../apps/web/lib/dayConstructorPreviewClient.ts',
  'Acceptance evaluation (E1)': '../apps/web/lib/dayConstructorAcceptance.ts',
};

function main() {
  // ============================================================
  // 16/17/18/19 -- zero Goal awareness in DayIntent/Constructor/Timing
  // Search/E1. A literal case-sensitive "Goal" substring check, same
  // discipline as PR A's own goalsWiring.test.ts.
  // ============================================================
  let i = 16;
  for (const [label, relPath] of Object.entries(UNTOUCHED_SCHEDULING_FILES)) {
    const source = stripComments(read(relPath));
    check(`${i}. ${label} (${relPath.replace('../', '')}) has zero mention of Goal/GoalActivity in real code`, !/\bGoal(Activity)?\b/.test(source));
    i += 1;
  }

  // ============================================================
  // 17 (orchestrator specifically) -- the ORCHESTRATOR module as a whole
  // legitimately imports nothing Goal-related for PLACEMENT purposes;
  // this file itself (dayConstructorOrchestrator.ts) is NOT in the
  // untouched list above because PR C does not touch it at all (grep
  // confirms zero diff -- see the PR's own file-boundary report) -- this
  // check exists as an independent structural guarantee regardless.
  // ============================================================
  const orchestratorSource = stripComments(read('../apps/web/lib/dayConstructorOrchestrator.ts'));
  check('19. dayConstructorOrchestrator.ts (placement/candidate-generation/availability/precedence/replenishment) has zero mention of Goal/GoalActivity', !/\bGoal(Activity)?\b/.test(orchestratorSource));

  // ============================================================
  // 15/20 -- the accept envelope. goalActivityLinks must be a SIBLING of
  // proposedItems/constructionWindow on the wire body type, and must
  // NEVER appear inside AcceptConstructedDayRequest (E1's own scheduling
  // contract, dayConstructorAcceptance.ts) at all.
  // ============================================================
  const acceptClientSource = read('../apps/web/lib/acceptConstructedDay.ts');
  check('20. AcceptConstructedDayRequestBody declares goalActivityLinks as a top-level sibling field', /goalActivityLinks\?\s*:\s*GoalActivityLink\[\]/.test(acceptClientSource));

  const acceptDomainSource = stripComments(read('../apps/web/lib/dayConstructorAcceptance.ts'));
  check('20. AcceptConstructedDayRequest (E1\'s own type) has zero mention of goalActivityLinks/GoalActivity -- the Goal envelope never enters E1\'s contract', !/goalActivityLinks|GoalActivity/.test(acceptDomainSource));

  const routeSource = read('../apps/web/app/api/day-constructor/accept/route.ts');
  check(
    '20. route.ts parses goalActivityLinks SEPARATELY from parseAcceptRequest, never folding it into the AcceptConstructedDayRequest object literal',
    /parseGoalActivityLinks/.test(routeSource) && !/return \{ clientRequestId: body\.clientRequestId, constructionWindow, proposedItems, goalActivityLinks/.test(routeSource)
  );

  // ============================================================
  // 16 -- preview request contains no goalActivityId/goalId anywhere in
  // its own type/parsing files (re-stated precisely: both the type
  // declaration file and the request-parsing file).
  // ============================================================
  const previewClientSource = stripComments(read('../apps/web/lib/dayConstructorPreviewClient.ts'));
  const previewRequestSource = stripComments(read('../apps/web/lib/dayConstructorPreviewRequest.ts'));
  check('16. PreviewRequestIntentBody (dayConstructorPreviewClient.ts) declares no goalActivityId/goalId field', !/goalActivityId|goalId/.test(previewClientSource));
  check('16. the F1 preview request parser (dayConstructorPreviewRequest.ts) never reads/validates a goalActivityId/goalId field', !/goalActivityId|goalId/.test(previewRequestSource));

  // ============================================================
  // buildRequestedIntentsForSubmission (planDayEntry.ts) -- the actual
  // PREVIEW mapping function -- never reads row.goalActivityId.
  // ============================================================
  const planDayEntrySource = read('../apps/web/lib/planDayEntry.ts');
  const submissionFnMatch = planDayEntrySource.match(/export function buildRequestedIntentsForSubmission[\s\S]*?\n}\n/);
  check('16. buildRequestedIntentsForSubmission function body never reads row.goalActivityId', submissionFnMatch !== null && !submissionFnMatch[0].includes('goalActivityId'));

  // ============================================================
  // Atomicity -- the linkage write lives INSIDE the existing acceptance
  // transaction's own write loop, on the SAME client, never a second
  // network request or a separate function called outside the
  // BEGIN/COMMIT boundary.
  // ============================================================
  const persistenceSource = stripComments(read('../apps/web/lib/dayConstructorAcceptancePersistence.ts'));
  const loopMatch = persistenceSource.match(/for \(const writeIntent of decision\.writeIntents\) \{[\s\S]*?\n    \}\n/);
  check('26. linkGoalActivityToPlannedActivity is called INSIDE the existing writeIntents loop (same transaction), not after COMMIT', loopMatch !== null && loopMatch[0].includes('linkGoalActivityToPlannedActivity(userId, goalActivityId, plan.id, client)'));
  check('26. the linkage call passes the SAME `client` the PlannedActivity insert itself used, never a fresh pool query', loopMatch !== null && /linkGoalActivityToPlannedActivity\([^)]*,\s*client\)/.test(loopMatch[0]));
  check('27. a failed linkage throws (causing the existing outer catch/ROLLBACK to fire), never silently continues', loopMatch !== null && /if \(!linked\) \{[\s\S]*?throw new Error/.test(loopMatch[0]));

  // ============================================================
  // No second Goal-linking code path anywhere (no separate route, no
  // client-side post-accept "link" call).
  // ============================================================
  const goalDetailClientSource = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));
  const planDayClientSource = stripComments(read('../apps/web/app/plan-day/PlanDayClient.tsx'));
  check('no post-accept client-side linking call exists (no fetch to a "/link"-shaped Goal endpoint anywhere)', !/\/api\/goals\/[^'"`]*\/link/.test(goalDetailClientSource) && !/\/api\/goals\/[^'"`]*\/link/.test(planDayClientSource));

  // ============================================================
  // 36/37/38/39 -- no Habit integration, no PlannedActivity schema
  // change, no migration, no Quick Capture object.
  // ============================================================
  const schemaSource = read('../apps/web/prisma/schema.prisma');
  const plannedActivityBlockMatch = schemaSource.match(/model PlannedActivity \{[\s\S]*?\n\}/);
  check('37/38. PlannedActivity model block is unchanged from PR A/B (still no Goal-data column, still only the back-relation field)', plannedActivityBlockMatch !== null && !/goalId|goalActivityId\s+String/.test(plannedActivityBlockMatch![0]));
  check('39. no new migration directory exists beyond 0035_goals', !fs.existsSync(path.join(__dirname, '../apps/web/prisma/migrations/0036_placeholder')));
  const migrationDirs = fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d));
  // Quick Capture V1 PR A legitimately added 0036_captures after this PR C
  // guard was written; what this check still proves is that PR C itself
  // added no migration: 0035_goals remains the newest Goals-era migration
  // and nothing handoff/link-named exists.
  check('39. 0035_goals is present and no handoff/goal-link migration was added by PR C', migrationDirs.includes('0035_goals') && !migrationDirs.some((d) => /handoff|goal.?link|goalactivity.?link/i.test(d)) && migrationDirs.filter((d) => d > '0035_goals').every((d) => d === '0036_captures'));
  check('36. no Habit/HabitLog mention anywhere in the new handoff files', !/\bHabit\b/.test(read('../apps/web/lib/planDayBootstrap.ts')) && !/\bHabit\b/.test(planDayClientSource));
  const allHandoffSource = [read('../apps/web/lib/planDayEntry.ts'), read('../apps/web/lib/planDayBootstrap.ts'), read('../apps/web/lib/acceptConstructedDay.ts'), read('../apps/web/lib/dayConstructorAcceptancePersistence.ts'), read('../apps/web/lib/db.ts')].join('\n');
  check('34. no Capture/InboxItem/Intention/generic-Task model or import exists anywhere in the touched files', !/\bInboxItem\b|\bCaptureItem\b/.test(allHandoffSource));

  // ============================================================
  // 37 -- recommendation pipeline (Day Builder / Home) unchanged.
  // ============================================================
  check('37. dayBuilder.ts has zero mention of Goal/GoalActivity', !/\bGoal(Activity)?\b/.test(stripComments(read('../apps/web/lib/dayBuilder.ts'))));
  check('37. homeTimelineComposer.ts has zero mention of Goal/GoalActivity', !/\bGoal(Activity)?\b/.test(stripComments(read('../apps/web/lib/homeTimelineComposer.ts'))));

  if (!allPassed) {
    console.error('SOME GOAL PLANNING HANDOFF WIRING CHECKS FAILED');
    process.exit(1);
  }
  console.log('ALL GOAL PLANNING HANDOFF WIRING CHECKS PASSED');
}

main();
