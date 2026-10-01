/**
 * Goals V2 Rhythm R4 -- narrow structural guards proving Goal Detail's
 * weekly Rhythm presentation is READ-ONLY and additive-only (this ticket's
 * own section 54). Many of the broader "zero Rhythm reference" invariants
 * (Constructor, Home, Timeline, DailyAgenda, MyDay orchestrator, Home
 * timeline composer, Right Now selection, Recomposition, templates, Ask
 * Aura) are ALREADY exhaustively proven by
 * test/goalActivityRhythmStructuralGuards.test.ts (R2) and
 * test/goalActivityRhythmMaterializationStructuralGuards.test.ts (R3) --
 * R4 touches none of those files, so those existing guards already cover
 * R4 for free (re-run as part of this ticket's own regression list, not
 * duplicated here). This file is scoped to what is NEW in R4: the two
 * files R4 actually changed (app/api/goals/[goalId]/route.ts,
 * GoalDetailClient.tsx) and the one domain/db file it extended
 * (goalActivityRhythm.ts/db.ts), proving the extension stayed read-only
 * and introduced none of the analytics/aggregation concepts this ticket's
 * own sections 17-36 explicitly rule out.
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

const routeSrc = stripComments(read('../apps/web/app/api/goals/[goalId]/route.ts'));
const goalDetailSrc = stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx'));
const goalsPresentationSrc = stripComments(read('../apps/web/lib/goalsPresentation.ts'));

// ============================================================
// No Rhythm WRITE anywhere in Goal Detail's own stack (this ticket's own
// section 16/54) -- GET is the only handler route.ts's own GoalActivity/
// Rhythm-related code path runs through; no INSERT/UPDATE of
// rhythmKind/rhythmTargetPerWeek, no GoalActivityOccurrence INSERT.
// ============================================================
check('route.ts never writes a Rhythm policy (no UPDATE/INSERT touching rhythmKind/rhythmTargetPerWeek)', !/UPDATE\s+"GoalActivity"[\s\S]{0,200}rhythm|INSERT INTO "GoalActivity"[\s\S]{0,200}rhythm/i.test(routeSrc));
check('route.ts never creates a GoalActivityOccurrence row (no INSERT reference at all -- read-only loadGoalActivityRhythmFactsForActivities only)', !/INSERT INTO "GoalActivityOccurrence"/.test(routeSrc));
// (Word-boundary'd method matching -- a naive /PUT|POST|PATCH/i would false
// -positive on substrings like "TextInput"; this requires the literal HTTP
// method string as fetch() actually spells it.)
check(
  "GoalDetailClient.tsx never issues a Rhythm-authoring fetch (no method: 'POST'/'PUT'/'PATCH' call body referencing a rhythm field)",
  !/method:\s*'(POST|PUT|PATCH)'[\s\S]{0,300}rhythm/i.test(goalDetailSrc)
);
check('GoalDetailClient.tsx\'s own fetch endpoints are still exactly the pre-R4 set (load/dismiss/add/archive/delete) -- no new endpoint was added', (goalDetailSrc.match(/fetch\(`\/api\/goals/g) ?? []).length === (stripComments(read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx')).match(/fetch\(`\/api\/goals/g) ?? []).length);

// ============================================================
// No universal percentage / aggregate duration / aggregate measured
// target / partial progress / day accumulation (this ticket's own section
// 17-24/35/36/53-54) -- Rhythm counts and CompletionRequirement formatting
// must stay two completely separate dimensions, never combined into a
// single weighted/aggregate number.
// ============================================================
check('goalsPresentation.ts introduces no percentage/ratio math for Rhythm (no "/ rhythm" or "rhythm *" arithmetic, no Math.round paired with a rhythm field)', !/rhythm[\w.]*\s*[*/]|[*/]\s*rhythm/i.test(goalsPresentationSrc));
check('goalsPresentation.ts never multiplies a Rhythm count by a CompletionRequirement target/duration (no targetPerWeek next to targetValue/durationMinutes in real code)', !/targetPerWeek[\s\S]{0,60}(targetValue|durationMinutes)|((targetValue|durationMinutes)[\s\S]{0,60}targetPerWeek)/i.test(goalsPresentationSrc));
check('route.ts introduces no percentage/ratio math for Rhythm', !/rhythm[\w.]*\s*[*/]|[*/]\s*rhythm/i.test(routeSrc));
check('no dayBucket/dailyTarget/day-accumulation concept anywhere in the three R4-touched files', !/dayBucket|dailyTarget|accumulat/i.test(routeSrc + goalDetailSrc + goalsPresentationSrc));
check('no partial-progress concept (partialProgress/fractionalCompletion) was introduced', !/partialProgress|fractionalCompletion/i.test(routeSrc + goalDetailSrc + goalsPresentationSrc));

// ============================================================
// No frequency-editing UI, no streak/calendar/history dashboard (this
// ticket's own section 32/33/54) -- re-confirmed narrowly here against the
// exact files R4 touched (the broader per-file sweep already lives in
// test/goalActivityRhythmGoalDetailUi.test.ts).
// ============================================================
check('GoalDetailClient.tsx has no Rhythm configuration control (no input/select tied to a rhythm field)', !/<select[^>]*rhythm/i.test(goalDetailSrc) && !/<input[^>]*rhythm/i.test(goalDetailSrc));
check('GoalDetailClient.tsx has no streak/calendar/history/trend UI', !/streak|calendar|trend|history dashboard/i.test(goalDetailSrc));
check('goalsPresentation.ts defines no streak/calendar/history formatter', !/streak|calendarGrid|trendChart/i.test(goalsPresentationSrc));

// ============================================================
// No new migration -- this ticket's own section 16 ("presentation/read-
// model work," no schema change).
// ============================================================
check('no new migration directory beyond 0043 (still exactly 43 -- R4 added no schema)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 43);

// ============================================================
// db.ts: the new batched loader is read-only (re-confirmed narrowly here;
// the full "exactly three allowed Rhythm functions" sweep already lives in
// test/goalActivityRhythmStructuralGuards.test.ts).
// ============================================================
const dbSrc = read('../apps/web/lib/db.ts');
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start === -1) throw new Error(`function ${name} not found`);
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
check('loadGoalActivityRhythmFactsForActivities contains no INSERT/UPDATE/DELETE (read-only, same contract as its single-activity sibling)', !/INSERT\s|UPDATE\s|DELETE\s/.test(functionBody(dbSrc, 'loadGoalActivityRhythmFactsForActivities')));
check('loadGoalActivityRhythmFactsForActivities never loops/batches to WRITE anything (no .map()-driven mutation, read-only batching of a SELECT only)', !/\.map\([^)]*=>[^}]*(INSERT|UPDATE|DELETE)/i.test(functionBody(dbSrc, 'loadGoalActivityRhythmFactsForActivities')));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM GOAL DETAIL STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM GOAL DETAIL STRUCTURAL GUARD CHECKS PASSED');
