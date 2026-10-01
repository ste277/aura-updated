/**
 * Goals V2 Rhythm R3 -- narrow structural guards proving occurrence
 * materialization is confined to exactly the two call sites this ticket
 * authorizes (db.ts's own materializeGoalActivityRhythmOccurrence, called
 * from dayConstructorAcceptancePersistence.ts's write loop; planMove.ts's
 * own Move continuity line), and that no Rhythm decision/generation logic
 * reaches the Constructor, Recomposition decision engine, Home, Daily
 * Agenda, templates, or Ask Aura. Same source-reading convention as every
 * other structural guard file in this suite.
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

const RHYTHM_PATTERN = /Rhythm|rhythmKind|rhythmTargetPerWeek|computeGoalActivityRhythmEligibility|loadGoalActivityRhythmFacts|materializeGoalActivityRhythmOccurrence/;

// ============================================================
// Zero Rhythm reference in the Constructor, Recomposition decision
// engine, Home, DailyAgenda, templates, Ask Aura.
// ============================================================
const PRODUCTION_FILES: Record<string, string> = {
  'Constructor core (dayConstructor.ts)': '../apps/web/lib/dayConstructor.ts',
  'Constructor orchestrator (dayConstructorOrchestrator.ts)': '../apps/web/lib/dayConstructorOrchestrator.ts',
  'Day Constructor acceptance evaluation (dayConstructorAcceptance.ts)': '../apps/web/lib/dayConstructorAcceptance.ts',
  'Recomposition decision engine (remainingDayRecomposition.ts)': '../apps/web/lib/remainingDayRecomposition.ts',
  'Recomposition server wiring (remainingDayRecompositionServer.ts)': '../apps/web/lib/remainingDayRecompositionServer.ts',
  'Recomposition integrity (remainingDayRecompositionIntegrity.ts)': '../apps/web/lib/remainingDayRecompositionIntegrity.ts',
  'Home (HomeDashboard.tsx)': '../apps/web/components/HomeDashboard.tsx',
  'Timeline (HomeTimeline.tsx)': '../apps/web/components/HomeTimeline.tsx',
  'DailyAgenda (dailyAgenda.ts)': '../apps/web/lib/dailyAgenda.ts',
  'MyDay orchestrator (myDayOrchestrator.ts)': '../apps/web/lib/myDayOrchestrator.ts',
  'Home timeline composer (homeTimelineComposer.ts)': '../apps/web/lib/homeTimelineComposer.ts',
  'Right Now selection (rightNowSelection.ts)': '../apps/web/lib/rightNowSelection.ts',
  'Home completion (homeCompletion.ts)': '../apps/web/lib/homeCompletion.ts',
  'GOAL_TEMPLATES (goals.ts)': '../apps/web/lib/goals.ts',
  'Goal completion domain (goalCompletion.ts)': '../apps/web/lib/goalCompletion.ts',
  'Goal activity execution domain (goalActivityExecution.ts)': '../apps/web/lib/goalActivityExecution.ts',
};
for (const [label, relPath] of Object.entries(PRODUCTION_FILES)) {
  check(`${label} does not reference Rhythm`, !RHYTHM_PATTERN.test(read(relPath)));
}

// goalsPresentation.ts IS one of R3's own two intentionally-touched
// presentation files (the other being GoalDetailClient.tsx, checked
// below) -- narrowed to confirm it carries ONLY the one documented,
// read-only boolean field, never a Rhythm-authoring one.
const goalsPresentationSrc = stripComments(read('../apps/web/lib/goalsPresentation.ts'));
check('goalsPresentation.ts references Rhythm ONLY via its own documented rhythmEligibleForAnotherOccurrence field -- no rhythmKind/targetPerWeek/eligibility-engine import', /rhythmEligibleForAnotherOccurrence/.test(goalsPresentationSrc) && !/rhythmKind|rhythmTargetPerWeek|computeGoalActivityRhythmEligibility/.test(goalsPresentationSrc));

const askAuraFiles = fs.readdirSync(path.join(__dirname, '../apps/web/lib')).filter((f) => /askAura/i.test(f));
check('at least one Ask Aura orchestrator file exists to check', askAuraFiles.length > 0);
for (const f of askAuraFiles) {
  check(`Ask Aura (lib/${f}) does not reference Rhythm`, !RHYTHM_PATTERN.test(read(`../apps/web/lib/${f}`)));
}

// ============================================================
// No background job / Home-load / DailyAgenda-load materialization.
// ============================================================
check('myDayOrchestrator.ts (Home/DailyAgenda\'s own build path) never calls materializeGoalActivityRhythmOccurrence', !/materializeGoalActivityRhythmOccurrence/.test(read('../apps/web/lib/myDayOrchestrator.ts')));
check('no cron/scheduled-task file anywhere in apps/web/app/api/internal references Rhythm', !fs.readdirSync(path.join(__dirname, '../apps/web/app/api/internal'), { recursive: true } as any).some((f: any) => typeof f === 'string' && f.endsWith('.ts') && RHYTHM_PATTERN.test(read(`../apps/web/app/api/internal/${f}`))));

// ============================================================
// db.ts: materializeGoalActivityRhythmOccurrence contains no Rhythm
// GENERATION logic of its own (no ordinal/windowKey/bulk-fill), delegates
// eligibility entirely to the pure engine, and is never called from
// logPlannedActivity/skipPlannedActivity/createGoalWithActivities/
// addGoalActivity.
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
const materializeBody = functionBody(dbSrc, 'materializeGoalActivityRhythmOccurrence');
check('materializeGoalActivityRhythmOccurrence introduces no ordinal/windowKey/occurrenceKey concept of its own', !/ordinal|windowKey|occurrenceKey/i.test(stripComments(materializeBody)));
check('materializeGoalActivityRhythmOccurrence creates at most ONE occurrence per call (exactly one INSERT INTO GoalActivityOccurrence)', (materializeBody.match(/INSERT INTO "GoalActivityOccurrence"/g) ?? []).length === 1);
check('materializeGoalActivityRhythmOccurrence delegates eligibility entirely to the pure R2 engine (calls computeGoalActivityRhythmEligibility, never reimplements the formula)', /computeGoalActivityRhythmEligibility\(/.test(materializeBody) && !/\.targetPerWeek\s*-\s*/.test(materializeBody));
check('materializeGoalActivityRhythmOccurrence sets no occurrence status and no Rhythm/CompletionRequirement snapshot on the occurrence row (this ticket\'s own section 15)', !/"status"|completionKindSnapshot|rhythmKindSnapshot/.test(materializeBody));
check('logPlannedActivity itself does not call materializeGoalActivityRhythmOccurrence', !/materializeGoalActivityRhythmOccurrence/.test(functionBody(dbSrc, 'logPlannedActivity')));
check('skipPlannedActivity itself does not call materializeGoalActivityRhythmOccurrence', !/materializeGoalActivityRhythmOccurrence/.test(functionBody(dbSrc, 'skipPlannedActivity')));
check('createGoalWithActivities itself does not call materializeGoalActivityRhythmOccurrence (template/manual creation stays occurrence-free)', !/materializeGoalActivityRhythmOccurrence/.test(functionBody(dbSrc, 'createGoalWithActivities')));
check('addGoalActivity itself does not call materializeGoalActivityRhythmOccurrence', !/materializeGoalActivityRhythmOccurrence/.test(functionBody(dbSrc, 'addGoalActivity')));

// ============================================================
// materializeGoalActivityRhythmOccurrence is called from EXACTLY ONE
// production call site.
// ============================================================
const acceptancePersistenceSrc = read('../apps/web/lib/dayConstructorAcceptancePersistence.ts');
check('materializeGoalActivityRhythmOccurrence is called from dayConstructorAcceptancePersistence.ts', /materializeGoalActivityRhythmOccurrence\(/.test(acceptancePersistenceSrc));
const allProductionLibFiles = fs.readdirSync(path.join(__dirname, '../apps/web/lib')).filter((f) => f.endsWith('.ts'));
const callSites = allProductionLibFiles.filter((f) => /materializeGoalActivityRhythmOccurrence\(/.test(stripComments(read(`../apps/web/lib/${f}`))) && f !== 'db.ts');
check('materializeGoalActivityRhythmOccurrence has EXACTLY ONE production call site (dayConstructorAcceptancePersistence.ts)', callSites.length === 1 && callSites[0] === 'dayConstructorAcceptancePersistence.ts');

// ============================================================
// evaluateAcceptance (E1) itself is untouched -- Rhythm enters only in
// the write loop, AFTER the Constructor's own decision is already final.
// ============================================================
check('dayConstructorAcceptance.ts (E1, the Constructor\'s own acceptance evaluation) has zero Rhythm reference -- Rhythm enters only in the persistence write loop, after E1 has already decided', !RHYTHM_PATTERN.test(read('../apps/web/lib/dayConstructorAcceptance.ts')));

// ============================================================
// Move / Recomposition continuity -- exactly one new repoint line, no new
// occurrence creation inside Move.
// ============================================================
const planMoveSrc = read('../apps/web/lib/planMove.ts');
check('planMove.ts (applyMoveWrites) repoints GoalActivityOccurrence exactly once, via UPDATE only -- never INSERT (no new occurrence on Move, this ticket\'s own section 31)', (planMoveSrc.match(/UPDATE "GoalActivityOccurrence"/g) ?? []).length === 1 && !/INSERT INTO "GoalActivityOccurrence"/.test(planMoveSrc));
check('remainingDayRecompositionAcceptance.ts never references Rhythm/GoalActivityOccurrence directly -- continuity flows ONLY through its existing, unmodified call to applyMoveWrites', !RHYTHM_PATTERN.test(read('../apps/web/lib/remainingDayRecompositionAcceptance.ts')) && !/GoalActivityOccurrence/.test(read('../apps/web/lib/remainingDayRecompositionAcceptance.ts')));

// ============================================================
// No template Rhythm defaults, no title/activity frequency inference.
// ============================================================
const goalsSrc = stripComments(read('../apps/web/lib/goals.ts'));
check('GOAL_TEMPLATES gained no Rhythm defaults -- goals.ts still has zero Rhythm reference of its own', !RHYTHM_PATTERN.test(goalsSrc));
check('no Goal/GoalActivity title string anywhere in db.ts is used to choose a targetPerWeek/frequency (no title-keyed lookup table near materializeGoalActivityRhythmOccurrence)', !/title.*targetPerWeek|targetPerWeek.*title/i.test(stripComments(dbSrc)));

// ============================================================
// No AURA_DECIDES, no RRULE, no bulk weekly materialization, no future-
// week generation, no occurrence status, no partial progress, no day
// accumulation -- re-confirmed against the ACTUAL changed files for R3.
// ============================================================
const rhythmModuleSrc = stripComments(read('../apps/web/lib/goalActivityRhythm.ts'));
check('goalActivityRhythm.ts (unmodified by R3) still defines no AURA_DECIDES', !/AURA_DECIDES/.test(rhythmModuleSrc));
check('goalActivityRhythm.ts (unmodified by R3) still references no RRULE', !/RRULE/.test(rhythmModuleSrc));
check('materializeGoalActivityRhythmOccurrence never loops/batches to create more than one occurrence per call (no for/while/map around the INSERT)', !/for\s*\(|while\s*\(|\.map\(/.test(materializeBody));
check('materializeGoalActivityRhythmOccurrence never queries/creates a plan for a FUTURE week beyond planningLocalDate (no addDaysToDateStr/localCalendarWeekStart call of its own)', !/addDaysToDateStr|localCalendarWeekStart/.test(materializeBody));
check('the GoalActivityOccurrence schema still has no status column (R3 did not add one)', !/@@schema|status\s+String/.test((() => { const m = read('../apps/web/prisma/schema.prisma').match(/model GoalActivityOccurrence \{([\s\S]*?)\n\}/); return m ? m[1] : ''; })()));
check('db.ts was not given a new windowKey column reference in real CODE (R1/R2\'s own omission preserved; doc-comment prose explaining the omission is excluded)', !/windowKey/.test(stripComments(dbSrc)));
check('materializeGoalActivityRhythmOccurrence does not write GoalActivityExecution.currentValue or any partial-progress field', !/currentValue/.test(materializeBody));
check('materializeGoalActivityRhythmOccurrence does not reference day-accumulation concepts (dayBucket/dailyTarget)', !/dayBucket|dailyTarget/i.test(materializeBody));

// ============================================================
// GoalDetailClient.tsx / planDayBootstrap.ts: the two presentation/
// handoff files R3 DID intentionally touch -- confirm the change is
// exactly the documented, minimal selectability widening, never a
// Rhythm-authoring client input.
// ============================================================
const goalDetailSrc = read('../apps/web/app/goals/[goalId]/GoalDetailClient.tsx');
check('GoalDetailClient.tsx never sends rhythmKind/rhythmTargetPerWeek/remainingOccurrences back to the server (client never authors Rhythm, this ticket\'s own section 20)', !/rhythmKind|rhythmTargetPerWeek|remainingOccurrences/.test(goalDetailSrc));
check('GoalDetailClient.tsx gained no new completion-type selector/target field/unit field/frequency field (still no Rhythm configuration UI)', !/rhythmKind|targetPerWeek|N_PER_WEEK/.test(goalDetailSrc));
const planDayBootstrapSrc = read('../apps/web/lib/planDayBootstrap.ts');
check('planDayBootstrap.ts\'s resolveGoalActivityHandoff re-derives eligibility server-side from persisted facts -- never trusts a client-supplied Rhythm/eligibility flag', /computeGoalActivityRhythmEligibility\(/.test(planDayBootstrapSrc) && !/activitiesParam.*rhythm|rhythm.*activitiesParam/i.test(stripComments(planDayBootstrapSrc)));

if (!allPassed) {
  console.error('SOME GOAL ACTIVITY RHYTHM MATERIALIZATION STRUCTURAL GUARD CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL ACTIVITY RHYTHM MATERIALIZATION STRUCTURAL GUARD CHECKS PASSED');
