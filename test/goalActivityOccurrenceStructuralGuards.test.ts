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

// Strips `//` and `/* ... */` comments -- same convention as the Rhythm
// structural guard files (test/goalActivityRhythmStructuralGuards.test.ts
// etc.), needed here now that Rhythm R3's own doc comments legitimately
// discuss GoalActivityOccurrence in prose outside the one allowed writer's
// body (e.g. db.ts's doc comment directly above
// materializeGoalActivityRhythmOccurrence).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
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
  'GOAL_TEMPLATES (goals.ts)': '../apps/web/lib/goals.ts',
  'Goal completion domain (goalCompletion.ts)': '../apps/web/lib/goalCompletion.ts',
  'Goal activity execution domain (goalActivityExecution.ts)': '../apps/web/lib/goalActivityExecution.ts',
  'Goals presentation (goalsPresentation.ts)': '../apps/web/lib/goalsPresentation.ts',
};

for (const [label, relPath] of Object.entries(PRODUCTION_FILES)) {
  check(`${label} does not reference GoalActivityOccurrence`, !/GoalActivityOccurrence/.test(read(relPath)));
}

// ============================================================
// Move (planMove.ts): this R1 ticket originally asserted a blanket zero
// -reference guard here too. Rhythm R3 (a later, separately-authorized
// ticket: occurrence materialization + planning handoff) legitimately added
// exactly one repoint UPDATE so a Move keeps an existing occurrence's
// plannedActivityId current -- see
// test/goalActivityRhythmMaterializationStructuralGuards.test.ts for R3's
// own exhaustive proof that this is the only write, never an INSERT.
// Narrowed to that exact invariant rather than deleted.
// ============================================================
const planMoveSrc = read('../apps/web/lib/planMove.ts');
const planMoveSrcNoComments = stripComments(planMoveSrc);
// Multi-Occurrence Rhythm, Final Capacity Safety Gate -- planMove.ts now
// ALSO reads GoalActivityOccurrence twice more, both inside
// enforceDestinationWeekCapacity: one SELECT to find whether the plan
// being moved is linked to an occurrence at all, and one more (joined
// against PlannedActivity) to load every OTHER occurrence fact for that
// GoalActivity when computing destination-week capacity -- still never
// a write beyond the one documented repoint UPDATE.
check(
  'Move (planMove.ts) references GoalActivityOccurrence ONLY via its documented repoint UPDATE (R3) and the two capacity-check SELECTs (Final Capacity Safety Gate) -- never INSERT/DELETE, never a fourth/undocumented reference',
  (planMoveSrcNoComments.match(/GoalActivityOccurrence/g) ?? []).length === 3 &&
    /UPDATE "GoalActivityOccurrence"/.test(planMoveSrcNoComments) &&
    /SELECT id, "goalActivityId" FROM "GoalActivityOccurrence"/.test(planMoveSrcNoComments) &&
    /FROM "GoalActivityOccurrence" gao JOIN "PlannedActivity"/.test(planMoveSrcNoComments) &&
    !/INSERT INTO "GoalActivityOccurrence"|DELETE FROM "GoalActivityOccurrence"/.test(planMoveSrcNoComments)
);

// ============================================================
// db.ts: the one file where a FUTURE occurrence write/read path would
// naturally live. R1 adds ZERO exported functions for it (same "model
// before writes" discipline as G2.2.1's own GoalActivityExecution) -- this
// test file itself uses raw SQL via beginTransaction() for exactly that
// reason. db.ts must therefore have no reference at all.
// ============================================================
const dbSrc = read('../apps/web/lib/db.ts');
// Goals V2 Rhythm R2 (a later, separately-authorized ticket) intentionally
// added the one allowed READ-ONLY fact loader (loadGoalActivityRhythmFacts)
// that reads FROM "GoalActivityOccurrence" -- see
// test/goalActivityRhythmStructuralGuards.test.ts for R2's own guards
// proving it is read-only (no INSERT/UPDATE/DELETE) and that it is the
// ONLY function referencing the table. Narrowed to that exact invariant
// here, rather than "zero reference at all" (which R1 itself could only
// ever assert because no later ticket existed yet).
//
// Rhythm R3 (a further, separately-authorized ticket) then added exactly
// one more intentionally-reviewed function, materializeGoalActivityRhythmOccurrence
// -- db.ts's sole production WRITER of this table (its one INSERT), proved
// exhaustively exactly-once in
// test/goalActivityRhythmMaterializationStructuralGuards.test.ts. The real
// invariant narrows further: db.ts references GoalActivityOccurrence ONLY
// inside these two named, intentionally-reviewed functions -- never a third,
// undocumented one -- and the one INSERT lives only inside the R3 writer.
//
// Rhythm R4 (a still-further, separately-authorized ticket: Goal Detail
// presentation) then added exactly one more intentionally-reviewed
// function, loadGoalActivityRhythmFactsForActivities -- a batched,
// read-only sibling of loadGoalActivityRhythmFacts (same read-only
// contract, just one query across several activities instead of one --
// this ticket's own section 40 N+1 fix). The real invariant narrows once
// more: db.ts references GoalActivityOccurrence ONLY inside these three
// named, intentionally-reviewed functions -- never a fourth, undocumented
// one -- and the one INSERT still lives only inside the R3 writer.
//
// Multi-Occurrence Rhythm PR 2's own corrective patch added exactly two
// more intentionally-reviewed, READ-ONLY references: goalHasRetainedPlanLinkage
// (an EXISTS subquery -- the authoritative occurrence ledger, not just
// GoalActivity's own singular pointer, now gates Goal deletion) and
// loadGoalContextsForPlanIds (a UNION branch resolving Goal context for
// every occurrence's own Plan, not just the one the singular pointer
// currently references). Neither adds a write; the one INSERT still
// lives only inside the R3 writer.
const dbSrcNoComments = stripComments(dbSrc);
const allowedOccurrenceFnBodiesNoComments =
  stripComments(functionBody(dbSrc, 'loadGoalActivityRhythmFacts')) +
  stripComments(functionBody(dbSrc, 'materializeGoalActivityRhythmOccurrence')) +
  stripComments(functionBody(dbSrc, 'loadGoalActivityRhythmFactsForActivities')) +
  // O5 P2d: the batched read's raw SELECT moved UNCHANGED into this read-only function so it can run on the snapshot executor.
  stripComments(functionBody(dbSrc, 'listGoalActivityOccurrenceRowsForActivities')) +
  // ... plus its row TYPE and the PURE row mapper (no query, no table reference besides the type name).
  stripComments((dbSrc.match(/export interface GoalActivityOccurrenceRow \{[\s\S]*?\n\}/) ?? [''])[0]) +
  stripComments(functionBody(dbSrc, 'buildGoalActivityRhythmFactsFromOccurrenceRows')) +
  // Multi-Occurrence Rhythm PR 2 corrective patch -- both read-only, no write added.
  stripComments(functionBody(dbSrc, 'goalHasRetainedPlanLinkage')) +
  stripComments(functionBody(dbSrc, 'loadGoalContextsForPlanIds'));
check(
  'db.ts references GoalActivityOccurrence ONLY inside the allowed, intentionally-reviewed functions (loadGoalActivityRhythmFacts [read-only], loadGoalActivityRhythmFactsForActivities [R4\'s batched read-only sibling], listGoalActivityOccurrenceRowsForActivities [O5 P2d: that sibling\'s raw read-only SELECT, moved unchanged so it can run on the snapshot executor], and materializeGoalActivityRhythmOccurrence [R3\'s sole writer]) -- no fourth function in real code, no UPDATE/DELETE anywhere',
  (dbSrcNoComments.match(/GoalActivityOccurrence/g) ?? []).length === (allowedOccurrenceFnBodiesNoComments.match(/GoalActivityOccurrence/g) ?? []).length &&
    (dbSrcNoComments.match(/INSERT INTO "GoalActivityOccurrence"/g) ?? []).length === 1 &&
    !/UPDATE "GoalActivityOccurrence"|DELETE FROM "GoalActivityOccurrence"/.test(dbSrcNoComments)
);

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
// Goals V2 Rhythm R2 (a later, separately-authorized ticket) added
// migration 0043_goal_activity_rhythm (two nullable columns on
// GoalActivity) -- unrelated to this file's own R1 scope. The real
// invariant this check still protects -- that 0042 itself remains exactly
// what R1 created -- is covered by the check above; this one is narrowed
// to the current total only.
check('R1 introduced GoalActivityOccurrence exactly once: no OTHER migration directory\'s own contents also reference it (count-independent -- holds regardless of how many unrelated migrations exist)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d) && d !== '0042_goal_activity_occurrence').every((d) => !/GoalActivityOccurrence/.test(fs.readFileSync(path.join(__dirname, '../apps/web/prisma/migrations', d, 'migration.sql'), 'utf8'))));

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
