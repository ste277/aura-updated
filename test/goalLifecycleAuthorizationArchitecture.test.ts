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
 *   - EVERY production caller of the two Goal-provenance writers -- not
 *     just one pinned file -- carries its own lockGoalParentLifecycleForPlanning
 *     call before it writes, so a future unguarded caller still fails this
 *     file even though the caller SET is no longer a single-file pin
 *   - archiving touches only the Goal row (existing plans/history untouched)
 *     and nothing reactivates a Goal
 *
 * HPG2 P0 fix (archived-Goal bypass via direct Plan-tab Goal linking):
 * apps/web/app/api/plans/route.ts is now a SECOND, legitimate production
 * caller of linkGoalActivityToPlannedActivity, alongside the persistence
 * write loop. It is legitimate specifically BECAUSE it now also calls
 * lockGoalParentLifecycleForPlanning on the same transaction client before
 * its own link write (proven below) -- the invariant this file protects was
 * never "exactly one caller", it was "no caller writes Goal provenance
 * without the lifecycle guard"; a second caller is fine exactly as long as
 * it upholds that, and fails loudly here the moment it doesn't.
 *
 * Structural checks are partly spelling-based by nature; the live-database
 * suite (goalLifecycleArchivedAcceptanceDb.test.ts) proves the same
 * properties by execution, including a real concurrent-archive race. The
 * route's own direct-plan-creation path has its own parallel live-DB proof
 * in planGoalActivityArchivedLifecycleDb.test.ts.
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
check('it is batched: ONE call over the de-duplicated activity ids of all write intents, outside any loop (no per-item Goal lookup)', /const rawGoalActivityIds = decision\.writeIntents\.map\(/.test(persistFn) && /const linkedGoalActivityIds = \[\.\.\.new Set\(rawGoalActivityIds\)\]/.test(persistFn) && !/for \([^)]*\) \{[^}]*lockGoalParentLifecycleForPlanning/.test(persistFn));
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
// Goal provenance has exactly the existing creators, every one of them
// protected by the SAME lifecycle guard (HPG2 P0 fix -- this is no longer
// "exactly one file", because the direct-plan-creation route legitimately
// gained its own protected call site; what the architecture guarantees now
// is "every caller carries the guard", which a bare file-count can't prove
// and a NEW unguarded caller still can't slip past).
// ============================================================
const provenanceWriterCallerPaths = all.filter(
  (f) => !f.endsWith('db.ts') && /materializeGoalActivityRhythmOccurrence\(|linkGoalActivityToPlannedActivity\(/.test(stripComments(fs.readFileSync(f, 'utf8')))
);
const provenanceWriterCallerNames = provenanceWriterCallerPaths.map((f) => path.basename(f)).sort();
check(
  'the production callers of the two Goal provenance writers are exactly the persistence write loop and the HPG2 direct-plan-creation route -- a third, unlisted caller fails this check even if it is individually well-guarded',
  JSON.stringify(provenanceWriterCallerNames) === JSON.stringify(['dayConstructorAcceptancePersistence.ts', 'route.ts'])
);
for (const filePath of provenanceWriterCallerPaths) {
  const relPath = path.relative(root, filePath);
  const source = stripComments(fs.readFileSync(filePath, 'utf8'));
  const lockAt = source.indexOf('lockGoalParentLifecycleForPlanning(');
  const writerIndices = ['materializeGoalActivityRhythmOccurrence(', 'linkGoalActivityToPlannedActivity('].map((needle) => source.indexOf(needle)).filter((idx) => idx >= 0);
  const firstWriterAt = Math.min(...writerIndices);
  check(`${relPath}: calls lockGoalParentLifecycleForPlanning(...) BEFORE writing any Goal provenance -- a future caller that skips or reorders the lifecycle guard fails this check`, lockAt >= 0 && lockAt < firstWriterAt);
}
// HPG2's own call site, pinned exactly (same discipline as the persistence
// write loop's own pin below): same transaction client, checked before the
// link write, gated only by "a goalActivityId was supplied" -- no flag or
// path condition can switch it off, and an unowned GoalActivity (absent
// from `owned`) is untouched by this guard, falling through to the
// existing fail-closed ownership rejection at the link call exactly as
// before this fix.
const plansRouteSource = stripComments(fs.readFileSync(path.join(app, 'api/plans/route.ts'), 'utf8'));
check(
  // HPG3-A3a -- the flat 'GOAL_NOT_ACTIVE' Error is now the typed
  // goalNotActiveError() (apps/web/lib/schedulingEligibilityError.ts),
  // same code value, same call site, same gating condition.
  "apps/web/app/api/plans/route.ts: the lifecycle guard runs on the SAME transaction client as the link write, gated only by goalActivityId being present, and rejects with GOAL_NOT_ACTIVE exactly when the GoalActivity is owned but its parent Goal isn't active",
  /if \(goalActivityId\) \{\s*const lifecycle = await lockGoalParentLifecycleForPlanning\(session\.userId, \[goalActivityId\], client\);\s*if \(lifecycle\.owned\.has\(goalActivityId\) && !lifecycle\.active\.has\(goalActivityId\)\) \{\s*throw goalNotActiveError\(\);\s*\}/.test(plansRouteSource)
);
check(
  // HPG3-A3a -- the message-string comparison + hardcoded 400 is now a
  // typed SchedulingEligibilityError branch with a per-code status
  // lookup; GOAL_NOT_ACTIVE itself still resolves to 400, unchanged.
  "apps/web/app/api/plans/route.ts: a GOAL_NOT_ACTIVE rejection maps to a typed 400, not an unhandled 500",
  /if \(err instanceof SchedulingEligibilityError\) \{[\s\S]{0,200}status: SCHEDULING_ELIGIBILITY_STATUS_BY_CODE\[err\.code\][\s\S]{0,50}\}/.test(plansRouteSource) && /GOAL_NOT_ACTIVE: 400/.test(fs.readFileSync(path.join(lib, 'schedulingEligibilityError.ts'), 'utf8'))
);
check('GoalActivityOccurrence rows are inserted in exactly one production place (db.ts materialization)', JSON.stringify(filesMatching(/INSERT INTO "GoalActivityOccurrence"/)) === JSON.stringify(['db.ts']) && (dbCode.match(/INSERT INTO "GoalActivityOccurrence"/g) ?? []).length === 1);
// Insights V1 PR2 (Stable Scheduled-Week Attribution) deliberately
// re-baselined this pin's own call-site text: the call now also passes
// `plan.plannedStartAt` (a 4th positional argument, between `plan.id` and
// `request.constructionWindow.date`) so the scheduled-week snapshot is
// computed from this specific plan's own real scheduled instant. Still a
// full, exact call-site text match -- never loosened to a bare
// function-name match.
// HPG3-A3a -- the two flat 'GOAL_ACTIVITY_LINK_FAILED' throws are now
// typed SchedulingEligibilityError throws, same two call sites.
check('the existing Rhythm/DISMISSED/ownership/live-commitment gates are still in the write loop, untouched (ACTIVE is necessary, not sufficient)', /materializeGoalActivityRhythmOccurrence\(userId, goalActivityId, plan\.id, plan\.plannedStartAt, request\.constructionWindow\.date, user\.timezone, client\)/.test(persistFn) && /linkGoalActivityToPlannedActivity\(userId, goalActivityId, plan\.id, client\)/.test(persistFn) && /throw materializeFailureToSchedulingEligibilityError\(materialized\.reason\);/.test(persistFn) && /throw goalActivityNotAvailableError\(\);/.test(persistFn));
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
