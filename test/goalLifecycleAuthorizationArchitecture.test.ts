/**
 * Goal lifecycle authorization -- architecture proof (pure, no DB) for the
 * archived-Goal acceptance guard.
 *
 * Proves STRUCTURALLY that:
 *   - ONE common boundary authorizes the parent Goal's lifecycle before ANY
 *     Goal provenance is written, for every entry path at once (automatic
 *     canonical, manual canonical, forged canonical, legacy handoff)
 *   - the check is batched, current-state, transaction-scoped and takes a
 *     share lock (so a concurrent archive cannot slip between check and write)
 *   - there is no path-specific bypass and no client-asserted Goal status
 *   - the new Goal-provenance creators are exactly the two existing ones,
 *     reached only from the persistence write loop
 *   - archiving touches only the Goal row (existing plans/history untouched)
 *     and nothing reactivates a Goal
 *
 * Structural checks are partly spelling-based by nature; the live-database
 * suite (goalLifecycleArchivedAcceptanceDb.test.ts) proves the same
 * properties by execution, including a real concurrent-archive race.
 */
import fs from 'fs';
import path from 'path';

let allPassed = true;
function check(label: string, condition: boolean) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}`);
  if (!condition) allPassed = false;
}
const root = path.join(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  const braceStart = source.indexOf('{', source.indexOf(')', start));
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unterminated ${name}`);
}
const lib = path.join(root, 'apps/web/lib');
const app = path.join(root, 'apps/web/app');
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}
const all = [...listTs(lib), ...listTs(app)];
const filesMatching = (needle: RegExp, ...excluding: string[]) => all.filter((f) => !excluding.some((x) => f.endsWith(x)) && needle.test(stripComments(fs.readFileSync(f, 'utf8')))).map((f) => path.basename(f)).sort();

const persistence = read('apps/web/lib/dayConstructorAcceptancePersistence.ts');
const persistCode = stripComments(persistence);
const persistFn = functionBody(persistCode, 'persistAcceptedConstructedDay');
const db = read('apps/web/lib/db.ts');
const dbCode = stripComments(db);
// Top-level function slice (the signature's return type contains braces, so the generic brace walker would start too early).
const topLevel = (source: string, name: string) => {
  const start = source.indexOf(`function ${name}`);
  if (start < 0) throw new Error(`missing function ${name}`);
  return source.slice(start, source.indexOf('\n}\n', start) + 3);
};
const lifecycleFn = topLevel(dbCode, 'lockGoalParentLifecycleForPlanning');
const CALL = /lockGoalParentLifecycleForPlanning\(userId, linkedGoalActivityIds, client\)/;

// ============================================================
// ONE common boundary, before every write
// ============================================================
check('the lifecycle check is called exactly ONCE in the persistence function (one common boundary, not one per path or per item)', (persistFn.match(/lockGoalParentLifecycleForPlanning\(/g) ?? []).length === 1 && CALL.test(persistFn));
const callAt = persistFn.indexOf('lockGoalParentLifecycleForPlanning(');
const firstWriteAt = persistFn.indexOf('createPlannedActivityWithClient(');
const loopAt = persistFn.indexOf('for (const writeIntent of decision.writeIntents)');
check('it runs BEFORE the first PlannedActivity insert and before the write loop (authorization fails before any mutation, no insert-then-rollback as control flow)', callAt > 0 && firstWriteAt > callAt && loopAt > callAt);
check('it runs AFTER the advisory lock, the replay classification (a replay of a committed acceptance is not a new authorization event) and the acceptance decision', callAt > persistFn.indexOf('pg_advisory_xact_lock') && callAt > persistFn.indexOf("status: 'ALREADY_ACCEPTED'") && callAt > persistFn.indexOf('await evaluateAcceptance('));
check('it is called with the TRANSACTION client (never the pool), so it is inside the acceptance transaction', CALL.test(persistFn) && !/lockGoalParentLifecycleForPlanning\([^)]*pool/.test(persistFn));
check('it is batched: ONE call over the de-duplicated activity ids of all write intents, outside any loop (no per-item Goal lookup)', /const linkedGoalActivityIds = \[\.\.\.new Set\(decision\.writeIntents\.map\(/.test(persistFn) && !/for \([^)]*\) \{[^}]*lockGoalParentLifecycleForPlanning/.test(persistFn));
check('every Goal link reaches it through the SAME map the write loop reads (goalActivityLinks keyed by write intent): the check is path-agnostic by construction', /goalActivityLinks\.get\(writeIntent\.intentId\)/.test(persistFn.slice(persistFn.indexOf('linkedGoalActivityIds'), callAt + 400)) && (persistFn.match(/goalActivityLinks\.get\(writeIntent\.intentId\)/g) ?? []).length >= 3);
check('the check is gated ONLY by "there is at least one Goal link" and a rejection is gated ONLY by "some link is not active" -- no dead-code, flag or path condition can switch it off', /if \(linkedGoalActivityIds\.length > 0\) \{\s*const lifecycle = await lockGoalParentLifecycleForPlanning\(userId, linkedGoalActivityIds, client\);/.test(persistFn) && /if \(notActive\.length > 0\) \{\s*await client\.query\('ROLLBACK'\);/.test(persistFn) && /return !!goalActivityId && lifecycle\.owned\.has\(goalActivityId\) && !lifecycle\.active\.has\(goalActivityId\);/.test(persistFn));
check('a failure rolls back and returns a typed REJECTED/INVALID_REQUEST with the GOAL_NOT_ACTIVE detail, naming only the client\'s own intent ids', /await client\.query\('ROLLBACK'\);\s*return \{ status: 'REJECTED', reason: 'INVALID_REQUEST', diagnostics: notActive \};/.test(persistFn) && /detail: 'GOAL_NOT_ACTIVE'/.test(persistFn) && /intentId: writeIntent\.intentId/.test(persistFn));

// ============================================================
// No path-specific bypass; no client authority
// ============================================================
check('the persistence file never mentions an entry path: no plan-day-goal, goal-demand, classify/decode, canonical or manual vocabulary (no path-specific branch is possible)', !/plan-day-goal|goal-demand|classifyGoalDemandIntentId|canonical|manual/i.test(persistCode));
check('no client-asserted Goal state anywhere in the acceptance request, its parser, the accept route or the body builder', ['apps/web/lib/dayConstructorAcceptance.ts', 'apps/web/lib/acceptConstructedDay.ts', 'apps/web/app/api/day-constructor/accept/route.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts', 'apps/web/lib/dayConstructorPreviewClient.ts'].every((f) => !/goalStatus|goalActive|isArchived|archivedAt|allowArchivedGoal|goalArchived/i.test(read(f))));
check('the provenance authorization module stays pure and status-blind (lifecycle is decided at persistence from persisted state, never from ids or links)', !/status|ARCHIVED|archived/.test(stripComments(read('apps/web/lib/goalDemandProvenanceAuthorization.ts')).replace(/'status'|\bstatus: '|\.status\b|status === |status !== |: \{ status|status: /g, '')));

// ============================================================
// The DB boundary: current state, locking, batched, read-only
// ============================================================
check('the lifecycle query is ONE SQL statement over ANY($2::text[]) (batched) on the supplied transaction client', (lifecycleFn.match(/client\.query\(/g) ?? []).length === 1 && /ANY\(\$2::text\[\]\)/.test(lifecycleFn) && /client: PoolClient/.test(lifecycleFn) && !/pool\./.test(lifecycleFn));
check('it reads the PERSISTED Goal row (join on Goal) and takes a SHARE lock on it so a concurrent archive cannot interleave', /JOIN "Goal" g ON g\.id = ga\."goalId"/.test(lifecycleFn) && /FOR SHARE OF g/.test(lifecycleFn));
check('only status exactly ACTIVE on a Goal owned by the same user authorizes (anything else, including unknown values, is not active)', /row\.goalUserId === userId && row\.goalStatus === 'ACTIVE'/.test(lifecycleFn));
check('it is scoped to the authenticated user and writes nothing', /ga\."userId" = \$1/.test(lifecycleFn) && !/INSERT|UPDATE|DELETE/.test(lifecycleFn));
check('GoalActivities the user does not own, or that do not exist, are not reported as owned (their existing fail-closed rejection is unchanged, and nothing is ever treated as active by default)', /owned\.add\(row\.goalActivityId\)/.test(lifecycleFn) && /if \(row\.goalUserId === userId/.test(lifecycleFn));

// ============================================================
// Goal provenance has exactly the existing creators, behind the write loop
// ============================================================
check('the ONLY production callers of the two Goal provenance writers (occurrence materialization and GoalActivity link) are the persistence write loop', JSON.stringify(filesMatching(/materializeGoalActivityRhythmOccurrence\(|linkGoalActivityToPlannedActivity\(/, 'db.ts')) === JSON.stringify(['dayConstructorAcceptancePersistence.ts']));
check('GoalActivityOccurrence rows are inserted in exactly one production place (db.ts materialization)', JSON.stringify(filesMatching(/INSERT INTO "GoalActivityOccurrence"/)) === JSON.stringify(['db.ts']) && (dbCode.match(/INSERT INTO "GoalActivityOccurrence"/g) ?? []).length === 1);
check('the existing Rhythm/DISMISSED/ownership/live-commitment gates are still in the write loop, untouched (ACTIVE is necessary, not sufficient)', /materializeGoalActivityRhythmOccurrence\(userId, goalActivityId, plan\.id, request\.constructionWindow\.date, user\.timezone, client\)/.test(persistFn) && /linkGoalActivityToPlannedActivity\(userId, goalActivityId, plan\.id, client\)/.test(persistFn) && (persistFn.match(/GOAL_ACTIVITY_LINK_FAILED/g) ?? []).length === 2);
const move = stripComments(read('apps/web/lib/planMove.ts'));
check('Move only REPOINTS existing Goal records (UPDATE ... WHERE plannedActivityId = old) and never creates Goal provenance: it neither inserts an occurrence nor calls either writer', !/INSERT INTO "GoalActivityOccurrence"|materializeGoalActivityRhythmOccurrence|linkGoalActivityToPlannedActivity/.test(move));
check('Recomposition has no Goal provenance at all', !/GoalActivity|goalActivity/.test(stripComments(read('apps/web/lib/remainingDayRecomposition.ts'))) && !/GoalActivity|goalActivity/.test(stripComments(read('apps/web/lib/remainingDayRecompositionAcceptance.ts'))));

// ============================================================
// Archive stays narrow; nothing reactivates
// ============================================================
const archive = topLevel(dbCode, 'archiveGoal');
check('archiving updates only the Goal row (status + archivedAt): it cancels, skips, moves, unlinks and deletes nothing (existing plans, occurrences and history are untouched)', /UPDATE "Goal" SET status = 'ARCHIVED'/.test(archive) && !/PlannedActivity|GoalActivityOccurrence|GoalActivityExecution|DELETE|"GoalActivity"/.test(archive));
check('no production code reactivates a Goal (no UPDATE "Goal" SET status to ACTIVE)', !/UPDATE "Goal" SET status\s*=\s*'ACTIVE'|UPDATE "Goal" SET status\s*=\s*\$/.test(dbCode) && !all.some((f) => /UPDATE "Goal" SET status\s*=\s*'ACTIVE'/.test(stripComments(fs.readFileSync(f, 'utf8')))));
check('Goal discovery keeps its own ACTIVE filter (the legitimate preview is unchanged and not broadened)', /g\.status = 'ACTIVE'/.test(dbCode.slice(dbCode.indexOf('loadCandidateGoalActivitiesForRhythmDemand'))));

// ============================================================
// Inert to everything else
// ============================================================
const SCOPE = ['apps/web/lib/opportunityProjection.ts', 'apps/web/lib/opportunityRangeAdapter.ts', 'apps/web/lib/opportunityRangeRealDeps.ts', 'apps/web/lib/opportunityDecisionFacts.ts', 'apps/web/lib/decisionFacts.ts', 'apps/web/lib/goalDecisionFactsProvider.ts', 'apps/web/lib/dayConstructor.ts', 'apps/web/lib/dayIntent.ts', 'apps/web/lib/dayConstructorOrchestrator.ts', 'apps/web/lib/dayConstructorPreviewRequest.ts'];
check('no fact, provider, Constructor, orchestrator or preview module mentions the lifecycle boundary', SCOPE.every((f) => !/lockGoalParentLifecycleForPlanning|GOAL_NOT_ACTIVE/.test(read(f))));
check('the persistence file adds no policy vocabulary and no opportunity/decision-fact coupling', !/decisionPressure|DecisionPressure|LAST_KNOWN_OPPORTUNITY|opportunity|decisionFacts|startDateState|afterStart/i.test(persistCode));

if (!allPassed) {
  console.error('SOME GOAL LIFECYCLE AUTHORIZATION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL GOAL LIFECYCLE AUTHORIZATION ARCHITECTURE CHECKS PASSED');
