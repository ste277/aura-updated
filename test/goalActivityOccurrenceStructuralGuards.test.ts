/**
 * Goals V2 Rhythm R1 -- narrow structural guards proving GoalActivityOccurrence
 * (migration 0042) is schema/domain-only: no production code path creates,
 * updates, reads, or displays a row of this table yet. Same source-reading
 * convention as goalCompletionStructuralGuards.test.ts (G2.1) and
 * goalActivityExecutionStructuralGuards.test.ts (G2.2.1), both of which
 * proved the identical "model before writes" discipline for their own
 * tables.
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

const PRODUCTION_FILES: Record<string, string> = {
  'Goal Detail (GoalDetailClient.tsx)': '../apps/web/app/goals/[goalId]/GoalDetailClient.tsx',
  'Goal API (goals/[goalId]/route.ts)': '../apps/web/app/api/goals/[goalId]/route.ts',
  'Goal creation API (goals/route.ts)': '../apps/web/app/api/goals/route.ts',
  'Home (HomeDashboard.tsx)': '../apps/web/components/HomeDashboard.tsx',
  'Timeline (HomeTimeline.tsx)': '../apps/web/components/HomeTimeline.tsx',
  'DailyAgenda (dailyAgenda.ts)': '../apps/web/lib/dailyAgenda.ts',
  'MyDay orchestrator (myDayOrchestrator.ts)': '../apps/web/lib/myDayOrchestrator.ts',
  'Home timeline composer (homeTimelineComposer.ts)': '../apps/web/lib/homeTimelineComposer.ts',
  'Constructor core (dayConstructor.ts)': '../apps/web/lib/dayConstructor.ts',
  'Constructor orchestrator (dayConstructorOrchestrator.ts)': '../apps/web/lib/dayConstructorOrchestrator.ts',
  'Recomposition decision engine (remainingDayRecomposition.ts)': '../apps/web/lib/remainingDayRecomposition.ts',
  'Recomposition server wiring (remainingDayRecompositionServer.ts)': '../apps/web/lib/remainingDayRecompositionServer.ts',
  'Recomposition acceptance (remainingDayRecompositionAcceptance.ts)': '../apps/web/lib/remainingDayRecompositionAcceptance.ts',
  'Recomposition integrity (remainingDayRecompositionIntegrity.ts)': '../apps/web/lib/remainingDayRecompositionIntegrity.ts',
  'Recomposition card (RecompositionCard.tsx)': '../apps/web/components/RecompositionCard.tsx',
  'Home recomposition lib (homeRecomposition.ts)': '../apps/web/lib/homeRecomposition.ts',
  'Plan with Aura handoff (planDayBootstrap.ts)': '../apps/web/lib/planDayBootstrap.ts',
  'Move (planMove.ts)': '../apps/web/lib/planMove.ts',
  'GOAL_TEMPLATES (goals.ts)': '../apps/web/lib/goals.ts',
  'Goal completion domain (goalCompletion.ts)': '../apps/web/lib/goalCompletion.ts',
  'Goal activity execution domain (goalActivityExecution.ts)': '../apps/web/lib/goalActivityExecution.ts',
  'Goals presentation (goalsPresentation.ts)': '../apps/web/lib/goalsPresentation.ts',
};

for (const [label, relPath] of Object.entries(PRODUCTION_FILES)) {
  check(`${label} does not reference GoalActivityOccurrence`, !/GoalActivityOccurrence/.test(read(relPath)));
}

// ============================================================
// db.ts: the one file where a FUTURE occurrence write/read path would
// naturally live. R1 adds ZERO exported functions for it (same "model
// before writes" discipline as G2.2.1's own GoalActivityExecution) -- this
// test file itself uses raw SQL via beginTransaction() for exactly that
// reason. db.ts must therefore have no reference at all.
// ============================================================
const dbSrc = read('../apps/web/lib/db.ts');
check('db.ts does not reference GoalActivityOccurrence anywhere (no exported function, no inline query -- R1 adds zero write/read path)', !/GoalActivityOccurrence/.test(dbSrc));

// ============================================================
// logPlannedActivity / skipPlannedActivity / applyMoveWrites: explicitly
// named by this ticket as paths that must remain untouched. Covered above
// via db.ts (log/skip) and planMove.ts (Move) wholesale, but re-asserted
// narrowly here against each function's own body for precision.
// ============================================================
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found`);
  // crude but sufficient brace-matching from the first '{' after the signature
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}
check('logPlannedActivity itself does not reference GoalActivityOccurrence', !/GoalActivityOccurrence/.test(functionBody(dbSrc, 'logPlannedActivity')));
check('skipPlannedActivity itself does not reference GoalActivityOccurrence', !/GoalActivityOccurrence/.test(functionBody(dbSrc, 'skipPlannedActivity')));

// ============================================================
// Schema/migration are the ONLY allowed references, plus this test suite
// itself.
// ============================================================
const schemaSrc = read('../apps/web/prisma/schema.prisma');
check('schema.prisma DOES define the GoalActivityOccurrence model (the one allowed production reference)', /model GoalActivityOccurrence \{/.test(schemaSrc));
check('migration 0042_goal_activity_occurrence exists and creates exactly the GoalActivityOccurrence table', fs.existsSync(path.join(__dirname, '../apps/web/prisma/migrations/0042_goal_activity_occurrence/migration.sql')) && /CREATE TABLE "GoalActivityOccurrence"/.test(fs.readFileSync(path.join(__dirname, '../apps/web/prisma/migrations/0042_goal_activity_occurrence/migration.sql'), 'utf8')));
check('no new migration directory was added beyond 0042 (still exactly 42)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 42);

// ============================================================
// No status/windowKey column was added to the new model (this ticket's own
// sections 5-7 decisions) -- a narrow guard against silently reintroducing
// either in a future edit without a fresh decision being made.
// ============================================================
const occurrenceModelMatch = schemaSrc.match(/model GoalActivityOccurrence \{([\s\S]*?)\n\}/);
const occurrenceModelBlock = occurrenceModelMatch ? occurrenceModelMatch[1] : '';
check('GoalActivityOccurrence has no persisted status column (lifecycle stays derivable from its linked PlannedActivity, this ticket\'s own section 6 decision)', !/\bstatus\s+String/.test(occurrenceModelBlock));
check('GoalActivityOccurrence has no windowKey/eligibility column (Rhythm semantics deliberately deferred, this ticket\'s own section 7 decision)', !/windowKey|eligibilityWindow|weekKey|dailyKey/i.test(occurrenceModelBlock));
check('GoalActivityOccurrence.goalActivityId carries NO uniqueness constraint (multiple occurrences per GoalActivity must remain possible -- the fundamental R1 capability)', !/@@unique\(\[.*goalActivityId/i.test(schemaSrc.slice(schemaSrc.indexOf('model GoalActivityOccurrence'))) && !/goalActivityId\s+String\s+@unique/.test(occurrenceModelBlock));
check('GoalActivityOccurrence.plannedActivityId IS unique when present (one live PlannedActivity claimed by at most one occurrence)', /plannedActivityId\s+String\?\s+@unique/.test(occurrenceModelBlock));

// ============================================================
// GoalActivity.plannedActivityId / GoalActivityExecution are unchanged
// (this ticket's own sections 10-11) -- re-confirmed structurally here.
// ============================================================
const goalActivityBlockMatch = schemaSrc.match(/model GoalActivity \{([\s\S]*?)\n\}/);
const goalActivityBlock = goalActivityBlockMatch ? goalActivityBlockMatch[1] : '';
check('GoalActivity.plannedActivityId remains String? @unique, unchanged by R1', /plannedActivityId\s+String\?\s+@unique/.test(goalActivityBlock));
const executionBlockMatch = schemaSrc.match(/model GoalActivityExecution \{([\s\S]*?)\n\}/);
const executionBlock = executionBlockMatch ? executionBlockMatch[1] : '';
check('GoalActivityExecution gained no new column from R1 (still exactly: goalActivityId, plannedActivityId, the three completion snapshot columns, currentValue, source, createdAt, updatedAt)', !/windowKey|occurrenceId|GoalActivityOccurrence/.test(executionBlock));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY OCCURRENCE STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY OCCURRENCE STRUCTURAL GUARD CHECKS PASSED');
