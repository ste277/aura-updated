/**
 * Goals V2 Rhythm R2 -- narrow structural guards proving the Rhythm
 * policy/eligibility domain (schema columns + apps/web/lib/goalActivityRhythm.ts
 * + the read-only loadGoalActivityRhythmFacts loader) is schema/domain-only:
 * no production code path reads/writes a Rhythm policy, computes
 * eligibility, or schedules anything yet. Same source-reading convention as
 * goalActivityOccurrenceStructuralGuards.test.ts (R1).
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

/** Strips `//` and `/* ... *\/` -- same convention as every other
 * structural guard file in this suite, needed since this module's own doc
 * comments legitimately discuss (in prose) several concepts these guards
 * check for the ABSENCE of in real code (e.g. "never reads Date.now()" --
 * discussing the restriction is not violating it). */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

const RHYTHM_PATTERN = /Rhythm|rhythmKind|rhythmTargetPerWeek|computeGoalActivityRhythmEligibility|loadGoalActivityRhythmFacts/;

const PRODUCTION_FILES: Record<string, string> = {
  'Constructor core (dayConstructor.ts)': '../apps/web/lib/dayConstructor.ts',
  'Constructor orchestrator (dayConstructorOrchestrator.ts)': '../apps/web/lib/dayConstructorOrchestrator.ts',
  'Home (HomeDashboard.tsx)': '../apps/web/components/HomeDashboard.tsx',
  'Timeline (HomeTimeline.tsx)': '../apps/web/components/HomeTimeline.tsx',
  'DailyAgenda (dailyAgenda.ts)': '../apps/web/lib/dailyAgenda.ts',
  'MyDay orchestrator (myDayOrchestrator.ts)': '../apps/web/lib/myDayOrchestrator.ts',
  'Home timeline composer (homeTimelineComposer.ts)': '../apps/web/lib/homeTimelineComposer.ts',
  'Right Now selection (rightNowSelection.ts)': '../apps/web/lib/rightNowSelection.ts',
  'Recomposition decision engine (remainingDayRecomposition.ts)': '../apps/web/lib/remainingDayRecomposition.ts',
  'Recomposition server wiring (remainingDayRecompositionServer.ts)': '../apps/web/lib/remainingDayRecompositionServer.ts',
  'Recomposition acceptance (remainingDayRecompositionAcceptance.ts)': '../apps/web/lib/remainingDayRecompositionAcceptance.ts',
  'GOAL_TEMPLATES (goals.ts)': '../apps/web/lib/goals.ts',
  'Goal completion domain (goalCompletion.ts)': '../apps/web/lib/goalCompletion.ts',
  'Goal activity execution domain (goalActivityExecution.ts)': '../apps/web/lib/goalActivityExecution.ts',
};

for (const [label, relPath] of Object.entries(PRODUCTION_FILES)) {
  check(`${label} does not reference Rhythm`, !RHYTHM_PATTERN.test(read(relPath)));
}

// ============================================================
// planMove.ts / GoalDetailClient.tsx / goalsPresentation.ts /
// planDayBootstrap.ts -- this R2 ticket originally asserted a blanket zero
// -Rhythm-reference guard on these four files. Rhythm R3 (a later,
// separately-authorized ticket: occurrence materialization + planning
// handoff) legitimately and intentionally gave each of them a narrow,
// specific Rhythm touchpoint. Per this session's own established
// discipline, the blanket check is narrowed -- never deleted -- to
// whatever real invariant it still protects: each file may reference
// Rhythm ONLY via its one documented R3 touchpoint, never anything wider
// (no new policy mutation, no second eligibility computation path, no
// client-authored Rhythm data).
// ============================================================
const planMoveSrc = read('../apps/web/lib/planMove.ts');
check(
  'planMove.ts references Rhythm ONLY via its one documented GoalActivityOccurrence repoint UPDATE (R3) -- no eligibility computation, no policy mutation',
  /UPDATE "GoalActivityOccurrence"/.test(planMoveSrc) && !/computeGoalActivityRhythmEligibility|rhythmKind|rhythmTargetPerWeek/.test(planMoveSrc)
);

const goalDetailClientSrc = read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx');
check(
  'GoalDetailClient.tsx references Rhythm ONLY via its one documented rhythmEligibleForAnotherOccurrence read (R3) -- never authors rhythmKind/rhythmTargetPerWeek',
  /rhythmEligibleForAnotherOccurrence/.test(goalDetailClientSrc) && !/rhythmKind|rhythmTargetPerWeek/.test(goalDetailClientSrc)
);

const goalsPresentationSrc = read('../apps/web/lib/goalsPresentation.ts');
check(
  'goalsPresentation.ts references Rhythm ONLY via its one documented rhythmEligibleForAnotherOccurrence field (R3) -- no rhythmKind/targetPerWeek/eligibility-engine import',
  /rhythmEligibleForAnotherOccurrence/.test(goalsPresentationSrc) && !/rhythmKind|rhythmTargetPerWeek|computeGoalActivityRhythmEligibility/.test(goalsPresentationSrc)
);

const planDayBootstrapSrc = read('../apps/web/lib/planDayBootstrap.ts');
check(
  'planDayBootstrap.ts\'s resolveGoalActivityHandoff re-derives eligibility server-side from persisted facts (R3) -- never trusts a client-supplied Rhythm/eligibility flag',
  /computeGoalActivityRhythmEligibility\(/.test(planDayBootstrapSrc) && !/activitiesParam.*rhythm|rhythm.*activitiesParam/i.test(stripComments(planDayBootstrapSrc))
);

// ============================================================
// Ask Aura -- explicitly named by this ticket's own section 38.
// ============================================================
const askAuraFiles = fs.readdirSync(path.join(__dirname, '../apps/web/lib')).filter((f) => /askAura/i.test(f));
check('at least one Ask Aura orchestrator file exists to check', askAuraFiles.length > 0);
for (const f of askAuraFiles) {
  check(`Ask Aura (lib/${f}) does not reference Rhythm`, !RHYTHM_PATTERN.test(read(`../apps/web/lib/${f}`)));
}

// ============================================================
// logPlannedActivity / skipPlannedActivity: untouched, precision check
// against each function's own body (db.ts as a whole DOES now reference
// Rhythm -- it owns the one allowed read-only fact loader -- so the
// whole-file check above does not apply to db.ts; this narrows to exactly
// the two functions this ticket names).
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
check('logPlannedActivity itself does not reference Rhythm', !RHYTHM_PATTERN.test(functionBody(dbSrc, 'logPlannedActivity')));
check('skipPlannedActivity itself does not reference Rhythm', !RHYTHM_PATTERN.test(functionBody(dbSrc, 'skipPlannedActivity')));
check('createGoalWithActivities itself does not reference Rhythm (no production writer)', !RHYTHM_PATTERN.test(functionBody(dbSrc, 'createGoalWithActivities')));
check('addGoalActivity itself does not reference Rhythm (no production writer)', !RHYTHM_PATTERN.test(functionBody(dbSrc, 'addGoalActivity')));
// This R2 ticket originally asserted db.ts defines ONLY the one allowed
// read-only loader. Rhythm R3 (a later, separately-authorized ticket) added
// exactly one intentionally-reviewed second function,
// materializeGoalActivityRhythmOccurrence -- NOT read-only, by design (it is
// the sole production writer of GoalActivityOccurrence rows, proved exactly
// once and exhaustively in goalActivityRhythmMaterializationStructuralGuards
// .test.ts). The real invariant that still must hold is narrower than "only
// one": db.ts's Rhythm-named functions are limited to exactly these two
// named, intentionally-reviewed functions -- never a third, undocumented one.
check(
  'db.ts defines ONLY the two allowed, intentionally-reviewed Rhythm functions (loadGoalActivityRhythmFacts [read-only] and materializeGoalActivityRhythmOccurrence [R3\'s sole occurrence writer]) -- no other function references Rhythm',
  [...new Set((dbSrc.match(/function \w*[Rr]hythm\w*/g) ?? []))].sort().join(',') ===
    ['function loadGoalActivityRhythmFacts', 'function materializeGoalActivityRhythmOccurrence'].sort().join(',')
);
check('loadGoalActivityRhythmFacts itself contains no INSERT/UPDATE/DELETE (read-only, this ticket\'s own section 23)', !/INSERT\s|UPDATE\s|DELETE\s/.test(functionBody(dbSrc, 'loadGoalActivityRhythmFacts')));

// ============================================================
// Canonical domain module itself -- the ONE allowed production module.
// ============================================================
const rhythmModuleSrc = read('../apps/web/lib/goalActivityRhythm.ts');
const rhythmModuleSrcNoComments = stripComments(rhythmModuleSrc);
check('goalActivityRhythm.ts imports no Prisma/pg client (pure domain, no DB access -- this ticket\'s own section 11)', !/from '@prisma|from 'pg'|pool\.query|beginTransaction/.test(rhythmModuleSrc));
check('goalActivityRhythm.ts never reads Date.now() or constructs `new Date()` with no argument inside real CODE (this ticket\'s own section 20; doc-comment prose explaining the restriction is excluded)', !/Date\.now\(\)|new Date\(\)/.test(rhythmModuleSrcNoComments));
check('goalActivityRhythm.ts does not define DAILY/WEEKDAYS/SPECIFIC_WEEKDAYS/AURA_DECIDES (R2\'s own minimal vocabulary -- this ticket\'s own section 3)', !/'DAILY'|'WEEKDAYS'|'SPECIFIC_WEEKDAYS'|'AURA_DECIDES'/.test(rhythmModuleSrc));
check('goalActivityRhythm.ts does not reference RRULE/cron/monthly/custom interval concepts in real CODE (doc-comment prose listing what is OUT of scope is excluded)', !/RRULE|\bcron\b|monthly|customInterval/i.test(rhythmModuleSrcNoComments));
check('goalActivityRhythm.ts introduces no occurrence ordinal/windowKey/occurrenceKey concept (this ticket\'s own section 22 -- R2 computes capacity only)', !/ordinal|windowKey|occurrenceKey/i.test(rhythmModuleSrc));
check('goalActivityRhythm.ts never creates a GoalActivityOccurrence row (no INSERT/CREATE reference at all -- pure domain module)', !/GoalActivityOccurrence/.test(rhythmModuleSrc) || !/INSERT|CREATE/.test(rhythmModuleSrc));

// ============================================================
// Schema/migration -- the only other allowed production reference.
// ============================================================
const schemaSrc = read('../apps/web/prisma/schema.prisma');
check('schema.prisma defines rhythmKind/rhythmTargetPerWeek on GoalActivity (the one allowed schema reference)', /rhythmKind\s+String\?/.test(schemaSrc) && /rhythmTargetPerWeek\s+Int\?/.test(schemaSrc));
check('migration 0043_goal_activity_rhythm exists and adds exactly the two Rhythm columns, nothing else', fs.existsSync(path.join(__dirname, '../apps/web/prisma/migrations/0043_goal_activity_rhythm/migration.sql')) && (() => { const m = fs.readFileSync(path.join(__dirname, '../apps/web/prisma/migrations/0043_goal_activity_rhythm/migration.sql'), 'utf8'); const alters = (m.match(/^ALTER TABLE/gm) ?? []).length; return alters === 2 && /ADD COLUMN "rhythmKind" TEXT/.test(m) && /ADD COLUMN "rhythmTargetPerWeek" INTEGER/.test(m) && !/CREATE TABLE/.test(m); })());
check('no new migration directory was added beyond 0043 (still exactly 43)', fs.readdirSync(path.join(__dirname, '../apps/web/prisma/migrations')).filter((d) => /^\d{4}_/.test(d)).length === 43);
check('GoalActivityOccurrence model (R1) was not modified by R2 -- still no status/windowKey column', (() => { const m = schemaSrc.match(/model GoalActivityOccurrence \{([\s\S]*?)\n\}/); const block = m ? m[1] : ''; return !/\bstatus\s+String/.test(block) && !/windowKey/i.test(block); })());
check('GoalActivityExecution model gained no new column from R2', (() => { const m = schemaSrc.match(/model GoalActivityExecution \{([\s\S]*?)\n\}/); const block = m ? m[1] : ''; return !/rhythm/i.test(block); })());

// ============================================================
// No separate GoalActivityRhythm entity was created (this ticket's own
// section 5 decision -- two nullable columns on GoalActivity instead).
// ============================================================
check('no separate "model GoalActivityRhythm" entity exists in schema.prisma (this ticket\'s own YAGNI decision, section 5)', !/model GoalActivityRhythm \{/.test(schemaSrc));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM STRUCTURAL GUARD CHECKS PASSED');
