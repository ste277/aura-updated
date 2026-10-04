/**
 * Schedule write consistency -- S4: Recomposition PROPOSAL authoritative overlap read (architecture guard, pure).
 *
 * Pins that the Remaining-Day Recomposition proposal loads its plans (which are also the Constructor's blockers) with
 * the canonical half-open overlap loader over the target civil day, once per run, instead of the start-scoped
 * `listPlannedActivitiesForDay`; and that S4 stayed proposal/read correctness only: no lock, no transaction, no write,
 * no new SQL, no change to acceptance, Move, manual creation or the Constructor, no schema change.
 *
 * It deliberately does NOT claim a coherent multi-query snapshot: the proposal's reads are separate autocommit
 * statements (P2d owns snapshot authority) and acceptance revalidates independently at write time.
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
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;

const serverSrc = read('apps/web/lib/remainingDayRecompositionServer.ts');
const server = stripComments(serverSrc);
const coreSrc = read('apps/web/lib/remainingDayRecomposition.ts');
const core = stripComments(coreSrc);
const routeSrc = read('apps/web/app/api/day/recompose/route.ts');
const route = stripComments(routeSrc);
const dbSrc = stripComments(read('apps/web/lib/db.ts'));
const proposalFiles = [{ f: 'remainingDayRecompositionServer.ts', src: server }, { f: 'remainingDayRecomposition.ts', src: core }, { f: 'api/day/recompose/route.ts', src: route }];

// ---- the loader ----
check('LOADER: the proposal wiring imports the canonical overlap loader `listPlannedActivitiesOverlappingRange` from db', /import \{[^}]*\blistPlannedActivitiesOverlappingRange\b[^}]*\} from '\.\/db'/.test(server));
check('NO START-SCOPED LOADER: no proposal module references `listPlannedActivitiesForDay` (the `plannedStartAt BETWEEN` loader)', proposalFiles.every((p) => !/listPlannedActivitiesForDay/.test(p.src)));
check('the real `loadPlansForDay` dependency is exactly the overlap loader called with the user id and the supplied range bounds', /loadPlansForDay: \(bounds\) => listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\),/.test(server));
check('the loader is user-scoped by the authenticated user object the deps were created for (never a request value)', !/body|req\./.test(server.slice(server.indexOf('createRealRecompositionDeps'), server.indexOf('export interface RecompositionHttpResult'))));

// ---- no duplicate or start-only SQL in the proposal path ----
check('NO NEW SQL: no proposal module contains any SQL against PlannedActivity (no table reference, SELECT, INSERT, UPDATE, DELETE or BETWEEN)', proposalFiles.every((p) => !/"PlannedActivity"|\bSELECT\b|\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bBETWEEN\b/.test(p.src)));
check('NO START-ONLY MEMBERSHIP: the proposal never filters plans by `plannedStartAt` range membership at load (it only reads fields of rows already loaded)', !/plannedStartAt\s*(>=|<=)\s*(dayBounds|bounds)|BETWEEN/.test(core) && !/BETWEEN/.test(server));
check('the canonical overlap predicate is defined exactly once in db.ts and is half-open: `plannedStartAt < $3 AND plannedEndAt > $2`', count(/"plannedStartAt" < \$3 AND "plannedEndAt" > \$2/g, dbSrc) === 1 && /status <> 'CANCELLED' AND "plannedStartAt" < \$3 AND "plannedEndAt" > \$2/.test(dbSrc) && /WHERE "userId" = \$1 AND status <> 'CANCELLED' AND "plannedStartAt" < \$3/.test(dbSrc));
// O5 P2d narrowed the executor TYPE to the read-only interface (a pool or transaction client still satisfies it); arity, default and semantics are unchanged.
check('the overlap loader is unchanged in shape: still `(userId, from, to, executor = pool)`, user-scoped, ordered by start', /export async function listPlannedActivitiesOverlappingRange\(userId: string, from: Date, to: Date, executor: (?:Read)?QueryExecutor = pool\)/.test(dbSrc) && /ORDER BY "plannedStartAt" ASC/.test(dbSrc.slice(dbSrc.indexOf('listPlannedActivitiesOverlappingRange'), dbSrc.indexOf('listPlannedActivitiesOverlappingRange') + 600)));
check('the start-scoped `listPlannedActivitiesForDay` still exists unchanged for its other (non-blocker) callers', /export async function listPlannedActivitiesForDay\(userId: string, from: Date, to: Date, executor: QueryExecutor = pool\)/.test(dbSrc) && /status <> 'CANCELLED' AND "plannedStartAt" BETWEEN \$2 AND \$3/.test(dbSrc));

// ---- the range ----
check('RANGE: the service asks the loader for exactly the target civil day, derived with the existing helper (`localDayBoundsUTC(targetDate, timezone)`), not millisecond arithmetic', /const dayBounds = localDayBoundsUTC\(targetDate, timezone\);/.test(core) && /deps\.loadPlansForDay\(dayBounds\)/.test(core));
check('the service performs exactly ONE plan load per run (`loadPlansForDay` is called once)', count(/loadPlansForDay\(/g, core.replace(/loadPlansForDay: \(bounds[^;]*;/, '')) === 1);
check('the Constructor\'s blockers are the SAME preloaded rows (no second blocker query): `loadBlockingPlans` filters `rows`, never loads', /loadBlockingPlans: async \(\) => rows\.filter\(\(row\) => !excluded\.has\(row\.id\)\)\.map\(toBlockerCandidate\)/.test(core));
check('SELF-BLOCKING: the reconsidered plans are released at the loading boundary by an explicit id set only; `isActivePlanBlocker` is not touched or reimplemented', /!excluded\.has\(row\.id\)/.test(core) && !/isActivePlanBlocker/.test(core));
check('LIFECYCLE / REFERENCE INSTANT: the proposal reuses the request `now` as the single reference instant (`baseRequest.now`); no second clock is read', /const baseRequest = \{ targetDate, timezone, constructionWindowSource: 'REMAINING_TODAY' as const, now \};/.test(core) && !/new Date\(\)|Date\.now\(\)/.test(core));

// ---- no serialization, no transaction, no writes in the proposal path ----
check('NO SERIALIZATION: no proposal module takes any advisory lock, row lock or transaction', proposalFiles.every((p) => !/pg_advisory|beginTransaction|FOR UPDATE|FOR SHARE|\bCOMMIT\b|\bROLLBACK\b|pool\.connect/.test(p.src)));
check('READ-ONLY: no proposal module imports or calls a plan writer (createPlannedActivity, applyMoveWrites, movePlannedActivity, cancel/skip/log/delete)', proposalFiles.every((p) => !/createPlannedActivity|applyMoveWrites|movePlannedActivity|cancelPlannedActivity|skipPlannedActivity|logPlannedActivity|deletePlannedActivity/.test(p.src)));
check('the proposal route is still a read-only calculation (no body read, no write)', !/req\.json\(|parseJsonObject/.test(route));
check('no lock helper or new lock key was introduced anywhere in production code by this slice', !/withUserScheduleLock|scheduleWriteLock|acquireScheduleLock|schedule-write:/.test(read('apps/web/lib/remainingDayRecompositionAcceptance.ts') + read('apps/web/lib/planMove.ts') + server + core));

// ---- acceptance / Move / manual create / Constructor are structurally unchanged ----
const acceptance = stripComments(read('apps/web/lib/remainingDayRecompositionAcceptance.ts'));
const move = stripComments(read('apps/web/lib/planMove.ts'));
const plansRoute = stripComments(read('apps/web/app/api/plans/route.ts'));
const orchestrator = stripComments(read('apps/web/lib/dayConstructorOrchestrator.ts'));
const persistence = stripComments(read('apps/web/lib/dayConstructorAcceptancePersistence.ts'));
check('ACCEPTANCE UNCHANGED (structure): still takes the shared lock, locks rows in id order, revalidates with `findBlockingPlanForRange` on its own transaction client, writes through `applyMoveWrites`', /pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`day-constructor-accept:\$\{userId\}`\]/.test(acceptance) && /ORDER BY id FOR UPDATE/.test(acceptance) && /findBlockingPlanForRange\(client, userId, sourceIds, move\.to\.start, move\.to\.end, now\)/.test(acceptance) && /applyMoveWrites\(client, userId/.test(acceptance));
check('ACCEPTANCE INDEPENDENCE: acceptance does not import the proposal loader or trust proposal blocker data (it never reads `loadPlansForDay` or `protectedPlans`)', !/loadPlansForDay|protectedPlans|listPlannedActivitiesOverlappingRange|remainingDayRecompositionServer/.test(acceptance));
check('MOVE UNCHANGED (structure): `applyMoveWrites` and `findBlockingPlanForRange` are still defined in planMove with the shared lock in `movePlannedActivity`', /export async function applyMoveWrites/.test(move) && /export async function findBlockingPlanForRange/.test(move) && /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(move));
check('MANUAL CREATE UNCHANGED (structure): POST /api/plans still takes the lock and inserts on the same transaction client (S2)', /await client\.query\('SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`day-constructor-accept:\$\{session\.userId\}`\]\);/.test(plansRoute) && /schedulingMode: DIRECT_PLAN_SCHEDULING_MODE,\s*\}, client\);/.test(plansRoute));
check('CONSTRUCTOR UNCHANGED (structure): the orchestrator still loads blockers with the canonical overlap loader and `resolveBlockerLoadBounds`; acceptance persistence still has the lock', /listPlannedActivitiesOverlappingRange\(user\.id, bounds\.from, bounds\.to\)/.test(orchestrator) && /export function resolveBlockerLoadBounds/.test(orchestrator) && /pg_advisory_xact_lock/.test(persistence));
check('the shared advisory lock is still taken at exactly the same four production sites, byte-identical (S3 invariant: no new blocker-adding writer)', (() => {
  const files = ['apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts', 'apps/web/app/api/plans/route.ts'];
  return files.every((f) => count(/pg_advisory_xact_lock\(hashtext\(\$1\)\)/g, stripComments(read(f))) === 1);
})());

// ---- schema ----
const migrationDirs = fs.readdirSync(path.join(root, 'apps/web/prisma/migrations'), { withFileTypes: true }).filter((e) => e.isDirectory());
check('NO SCHEMA CHANGE: 43 migration directories, no exclusion constraint, no new index declared for the proposal read', migrationDirs.length === 43 && !/EXCLUDE USING|btree_gist/i.test(read('apps/web/prisma/schema.prisma')));

// ---- this slice's tests make no false claim ----
const dbTest = read('test/remainingDayRecompositionProposalOverlapDb.test.ts');
const FALSE_CLAIM = /snapshot[- ]consistent|race[- ]free|serializ(ed|able) proposal|P2d (is )?(done|fixed)|coherent snapshot/i;
check('the DB test makes no snapshot-coherence, race-freedom or serialization claim about the proposal in any assertion label', !(dbTest.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the DB test drives the real proposal handler with the real deps and an explicit fixed clock (no wall clock) and covers: overnight, same-day early start, lifecycle, cross-user, boundaries, multiple blockers, row volume, DST, acceptance revalidation', /handleRemainingDayRecompositionRequest/.test(dbTest) && /createDeps: createRealRecompositionDeps/.test(dbTest) && !/new Date\(\)|Date\.now\(\)/.test(stripComments(dbTest)) && /PRIMARY DEFECT/.test(dbTest) && /SAME-DAY EARLY START/.test(dbTest) && /LIFECYCLE/.test(dbTest) && /CROSS-USER/.test(dbTest) && /CIVIL-DAY BOUNDARIES/.test(dbTest) && /MULTIPLE BLOCKERS/.test(dbTest) && /ROW VOLUME/.test(dbTest) && /LA_SPRING/.test(dbTest) && /LA_FALL/.test(dbTest) && /ACCEPTANCE STILL REVALIDATES/.test(dbTest));

if (!allPassed) {
  console.error('SOME RECOMPOSITION PROPOSAL OVERLAP ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL RECOMPOSITION PROPOSAL OVERLAP ARCHITECTURE CHECKS PASSED');
