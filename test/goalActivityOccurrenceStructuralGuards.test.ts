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
// Insights V1 PR3 -- re-baselined, not weakened: the third reference's
// own SQL text changed from a plain JOIN to a LEFT JOIN on
// PlannedActivity (a sibling occurrence's plan may now be hard-deleted,
// Insights V1 PR3's own fix), PLUS one new LEFT JOIN on
// GoalActivityExecution (via goalActivityOccurrenceId -- the durable
// completion-evidence link that survives that same deletion). The real
// invariant this check protects -- still exactly these three references,
// still never an INSERT/DELETE on GoalActivityOccurrence itself -- is
// unchanged; only the third reference's own exact text is updated to
// match, and the new GoalActivityExecution join is explicitly verified
// too rather than merely tolerated.
check(
  'Move (planMove.ts) references GoalActivityOccurrence ONLY via its documented repoint UPDATE (R3) and the two capacity-check SELECTs (Final Capacity Safety Gate) -- never INSERT/DELETE, never a fourth/undocumented reference',
  (planMoveSrcNoComments.match(/GoalActivityOccurrence/g) ?? []).length === 3 &&
    /UPDATE "GoalActivityOccurrence"/.test(planMoveSrcNoComments) &&
    /SELECT id, "goalActivityId" FROM "GoalActivityOccurrence"/.test(planMoveSrcNoComments) &&
    /FROM "GoalActivityOccurrence" gao\s+LEFT JOIN "PlannedActivity" pa ON pa\.id = gao\."plannedActivityId"\s+LEFT JOIN "GoalActivityExecution" gae ON gae\."goalActivityOccurrenceId" = gao\.id/.test(planMoveSrcNoComments) &&
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
  stripComments(functionBody(dbSrc, 'loadGoalContextsForPlanIds')) +
  // Insights V1 PR3 -- one more intentionally-reviewed, READ-ONLY reference:
  // logPlannedActivity now resolves Goal linkage via the occurrence's OWN
  // plannedActivityId (unique per plan, never repointed by a sibling's
  // materialization the way GoalActivity.plannedActivityId already is) --
  // the fix for the write-gating defect where an older Rhythm occurrence
  // completed after a newer sibling was materialized silently produced no
  // GoalActivityExecution row at all. A single SELECT, never a write.
  stripComments(functionBody(dbSrc, 'logPlannedActivity')) +
  // HPG3-A2 -- checkDailyOccurrenceEligibility, the shared daily-capacity
  // read materializeGoalActivityRhythmOccurrence (already allowed above)
  // and planMove.ts's own daily check both call. Two SELECTs, no write.
  stripComments(functionBody(dbSrc, 'checkDailyOccurrenceEligibility'));
check(
  'db.ts references GoalActivityOccurrence ONLY inside the allowed, intentionally-reviewed functions (loadGoalActivityRhythmFacts [read-only], loadGoalActivityRhythmFactsForActivities [R4\'s batched read-only sibling], listGoalActivityOccurrenceRowsForActivities [O5 P2d: that sibling\'s raw read-only SELECT, moved unchanged so it can run on the snapshot executor], materializeGoalActivityRhythmOccurrence [R3\'s sole writer], logPlannedActivity [Insights V1 PR3\'s corrected, occurrence-keyed completion lookup], and checkDailyOccurrenceEligibility [HPG3-A2\'s shared daily-capacity read]) -- no additional, undocumented function in real code, no UPDATE/DELETE anywhere',
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
  // Insights V1 PR3 -- fixed a pre-existing bug: the naive "first '{'
  // after the signature" search breaks for any function whose signature
  // contains an inline object TYPE literal in its return type (e.g.
  // logPlannedActivity's own `): Promise<{ plan: ...; habitLog: ... }>`)
  // -- it would match that type literal's brace instead of the body's,
  // and (since that inner object closes almost immediately) silently
  // return a near-empty, truncated "body". An earlier attempt at this
  // fix ("take the last '{' on the signature's own line") broke the
  // OPPOSITE case instead -- any multi-line parameter list (e.g.
  // materializeGoalActivityRhythmOccurrence's own one-parameter-per-line
  // signature) has no '{' on its first line at all. The robust fix:
  // find the parameter list's own matching ')' by paren-depth counting
  // (works across any number of lines), then skip past any generic
  // return-type annotation by angle-bracket depth (so an inline object
  // type's own braces, nested inside `Promise<{ ... }>`, are never
  // mistaken for the body) -- the body's real opening brace is the
  // first '{' found once BOTH depths have returned to zero.
  const parenOpen = source.indexOf('(', start);
  let parenDepth = 0;
  let i = parenOpen;
  for (; i < source.length; i++) {
    if (source[i] === '(') parenDepth++;
    else if (source[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) { i++; break; }
    }
  }
  let angleDepth = 0;
  let braceStart = -1;
  for (; i < source.length; i++) {
    if (source[i] === '<') angleDepth++;
    else if (source[i] === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (source[i] === '{' && angleDepth === 0) { braceStart = i; break; }
  }
  if (braceStart === -1) throw new Error(`body not found for function ${name}`);
  let depth = 0;
  for (let j = braceStart; j < source.length; j++) {
    if (source[j] === '{') depth++;
    else if (source[j] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, j + 1);
    }
  }
  throw new Error(`unterminated function ${name}`);
}
// Insights V1 PR3 -- flipped from forbidding to requiring, with exact
// text, not loosened to a bare function-name match: logPlannedActivity
// now DOES reference GoalActivityOccurrence, deliberately and correctly
// (the occurrence-keyed completion lookup fixing the write-gating
// defect, see the allowed-functions list above). This re-baseline also
// fixes a pre-existing bug in functionBody itself (see its own updated
// doc comment) that was silently returning a truncated, near-empty
// "body" for this exact function -- masking this check's real answer
// entirely until now.
const logPlannedActivityBodyNoComments = stripComments(functionBody(dbSrc, 'logPlannedActivity'));
check(
  'logPlannedActivity references GoalActivityOccurrence ONLY via its new, correct occurrence-keyed completion lookup -- a single read-only SELECT, never a write',
  /SELECT id, "goalActivityId" FROM "GoalActivityOccurrence" WHERE "plannedActivityId" = \$1 AND "userId" = \$2/.test(logPlannedActivityBodyNoComments) &&
    (logPlannedActivityBodyNoComments.match(/GoalActivityOccurrence/g) ?? []).length === 1 &&
    !/INSERT INTO "GoalActivityOccurrence"|UPDATE "GoalActivityOccurrence"|DELETE FROM "GoalActivityOccurrence"/.test(logPlannedActivityBodyNoComments)
);
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
//
// Insights V1 PR2 (Stable Scheduled-Week Attribution) added migration
// 0047_goal_activity_occurrence_scheduled_week -- the first migration to
// ALTER (not merely reference in prose) the GoalActivityOccurrence table
// itself, adding the two nullable scheduledWeekStart/scheduledWeekTimezone
// snapshot columns. This is a deliberate, intentional, reviewed schema
// evolution of this exact table -- the real invariant this check protects
// (0042 itself remains exactly what R1 created) is untouched; only the
// EXCLUSION LIST is widened by one entry, the same pattern already
// established above for 0043.
//
// Insights V1 PR3 added migration 0048_goal_activity_execution_occurrence_link
// -- a new column on GoalActivityExecution whose FK REFERENCES
// GoalActivityOccurrence(id) (plus prose explaining why), the second
// migration (after 0047) to legitimately reference this table without
// being the one that created it. Same pattern, widened by one more entry.
//
// HPG3-A1 added migration 0051_goal_activity_daily_frequency_foundation --
// its own doc comment explains it ALTERs GoalActivityOccurrence a second
// time (adding the scheduledLocalDate/scheduledLocalTimezone snapshot
// columns, the same frozen-snapshot discipline as 0047's scheduledWeekStart/
// scheduledWeekTimezone), alongside adding dailyFrequencyKind/
// dailyFrequencyLimit to GoalActivity. A deliberate, intentional, reviewed
// schema evolution of this exact table -- same pattern, widened by one
// more entry (PR #181 reconciliation).
check('R1 introduced GoalActivityOccurrence exactly once: no OTHER migration directory\'s own contents also reference it (count-independent -- holds regardless of how many unrelated migrations exist)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d) && d !== '0042_goal_activity_occurrence' && d !== '0047_goal_activity_occurrence_scheduled_week' && d !== '0048_goal_activity_execution_occurrence_link' && d !== '0051_goal_activity_daily_frequency_foundation').every((d) => !/GoalActivityOccurrence/.test(fs.readFileSync(path.join(__dirname, '../apps/web/prisma/migrations', d, 'migration.sql'), 'utf8'))));

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
// Insights V1 PR3 added exactly one new column, goalActivityOccurrenceId
// (nullable, unique, FK to GoalActivityOccurrence SET NULL) -- the
// durable per-occurrence evidence link this whole PR exists to add,
// deliberately NOT a windowKey/eligibility field (which R1 itself
// already rejected, see the checks below) and NOT a second,
// independently-nullable occurrenceId divorced from the FK's own
// semantics. Re-baselined, not weakened: still fails if windowKey ever
// appears, or if GoalActivityOccurrence is referenced any way OTHER than
// through this one exact, expected column declaration.
// Field-declaration checks, not the doc comment's own prose (which
// legitimately discusses GoalActivityOccurrence several times explaining
// why the link is durable/SetNull) -- same stripComments discipline
// extractModelBlock already applies elsewhere in this file.
const executionBlockNoComments = stripComments(executionBlock);
check(
  'GoalActivityExecution gained exactly one new column from Insights V1 PR3 (goalActivityOccurrenceId, nullable+unique+SET NULL) -- no windowKey, no other GoalActivityOccurrence reference',
  !/windowKey/.test(executionBlockNoComments) &&
    /goalActivityOccurrenceId\s+String\?\s+@unique/.test(executionBlockNoComments) &&
    (executionBlockNoComments.match(/GoalActivityOccurrence/g) ?? []).length === 1
);

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY OCCURRENCE STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY OCCURRENCE STRUCTURAL GUARD CHECKS PASSED');
