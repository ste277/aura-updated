/**
 * Schedule write consistency -- S2: manual plan writer serialization
 * (architecture guard, pure).
 *
 * Pins that `POST /api/plans` takes the SAME per-user, transaction-scoped
 * advisory lock the automatic schedule writers take, on the SAME transaction
 * client that performs the insert, before the interval write, with the lock
 * identity taken from the authenticated session -- and that S2 stayed
 * serialization only: no overlap check, no new lock domain or key, no lock
 * helper, no timeout/NOWAIT, no DB constraint, no 409.
 *
 * It deliberately does NOT claim a global non-overlap invariant: the lock only
 * orders writers; manual overlap stays allowed.
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
const count = (re: RegExp, s: string) => (s.match(re) ?? []).length;
function listTs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : listTs(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

const routeSrc = read('apps/web/app/api/plans/route.ts');
const route = stripComments(routeSrc);
const post = functionBody(route, 'POST');
const get = functionBody(route, 'GET');
const db = stripComments(read('apps/web/lib/db.ts'));
const production = [...listTs(path.join(root, 'apps/web/lib')), ...listTs(path.join(root, 'apps/web/app'))].map((f) => ({ f: path.relative(root, f), src: stripComments(fs.readFileSync(f, 'utf8')) }));

const lockCall = /await client\.query\('SELECT pg_advisory_xact_lock\(hashtext\(\$1\)\)', \[`day-constructor-accept:\$\{session\.userId\}`\]\);/;

// ---- transaction, lock, order, client ----
check('TRANSACTION: the plan insert runs inside a transaction (one beginTransaction in POST, COMMIT on success, ROLLBACK on failure, release in finally)', count(/await beginTransaction\(\)/g, post) === 1 && /await client\.query\('COMMIT'\);/.test(post) && /await client\.query\('ROLLBACK'\)\.catch\(\(\) => \{\}\);\s*throw err;/.test(post) && /finally \{\s*client\.release\(\);/.test(post));
check('SHARED LOCK: POST takes the per-user transaction-scoped advisory lock exactly once, with the unchanged key `day-constructor-accept:${userId}`', lockCall.test(post) && count(/pg_advisory_xact_lock/g, post) === 1);
const beginAt = post.indexOf('await beginTransaction()');
const lockAt = post.indexOf('pg_advisory_xact_lock');
const createAt = post.indexOf('createPlannedActivity({');
const commitAt = post.indexOf("client.query('COMMIT')");
check('ORDER: BEGIN, then the advisory lock, then the plan insert, then COMMIT', beginAt > 0 && beginAt < lockAt && lockAt < createAt && createAt < commitAt);
check('NO interval write before the lock: nothing that writes a plan appears before the lock in POST', !/createPlannedActivity\(|INSERT INTO/.test(post.slice(0, lockAt)));
check('SAME CLIENT: the insert receives the SAME transaction client that took the lock (`createPlannedActivity({...}, client)`)', /schedulingMode: DIRECT_PLAN_SCHEDULING_MODE,\s*\}, client\);/.test(post) && /const client = await beginTransaction\(\);/.test(post));
const lastValidationAt = Math.max(...Array.from(post.matchAll(/status: 400/g)).map((m) => m.index ?? 0));
check('validation and authentication stay BEFORE the transaction: every 400/401 return precedes beginTransaction (no lock for invalid requests)', lastValidationAt > 0 && lastValidationAt < beginAt && post.indexOf('status: 401') < beginAt);
check('idempotency claims stay outside the transaction (before it) and the claim fills stay after it: unchanged behavior', post.indexOf('claimPlanCreation(') < beginAt && post.indexOf('fillPlanCreationClaim(') > post.indexOf("client.query('COMMIT')"));

// ---- authority and lock domain ----
check('SERVER AUTHORITY: the lock identity is the authenticated session user and nothing from the request body or query', /const session = getSessionFromRequest\(req\);/.test(post) && !/body/.test(post.slice(lockAt, lockAt + 160)) && !/searchParams|params\./.test(post.slice(lockAt, lockAt + 160)));
const keyLiterals = production.flatMap((x) => Array.from(x.src.matchAll(/`(day-constructor-accept:\$\{[^}]+\})`/g)).map((m) => ({ f: x.f, key: m[1].replace(/session\.userId/, 'userId') })));
check('NO NEW LOCK DOMAIN: every advisory-lock key in production code is the same `day-constructor-accept:${userId}` construction (acceptance, Move, Recomposition acceptance, and now the manual writer)', keyLiterals.length === 4 && new Set(keyLiterals.map((k) => k.key)).size === 1 && keyLiterals.map((k) => k.f).sort().join() === ['apps/web/app/api/plans/route.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts'].sort().join());
check('the lock SQL is byte-identical at all four sites (same primitive, no variant)', production.filter((x) => x.src.includes('pg_advisory_xact_lock(hashtext($1))')).length === 4);
check('TRANSACTION-SCOPED ONLY: no session-level advisory lock, try-lock or manual unlock exists anywhere in production code', !production.some((x) => /pg_advisory_lock\(|pg_try_advisory|pg_advisory_unlock|pg_advisory_lock_shared/.test(x.src)));
check('no NOWAIT, lock_timeout or statement_timeout was introduced (the lock waits under the existing timeout semantics)', !production.some((x) => /NOWAIT|lock_timeout|statement_timeout|SKIP LOCKED/i.test(x.src)));
check('NO LOCK HELPER / RENAME in this slice: no extracted lock helper, and the key is not renamed', !production.some((x) => /withUserScheduleLock|scheduleWriteLock|acquireScheduleLock|schedule-write:/.test(x.src)));
check('LOCK ORDER: the manual writer takes no other lock (no FOR UPDATE / FOR SHARE / other advisory lock in POST), so it cannot invert the automatic writers\' order', !/FOR UPDATE|FOR SHARE/.test(post) && count(/pg_advisory/g, post) === 1);

// ---- serialization only, not validation ----
check('NO OVERLAP VALIDATION: the manual path introduces no overlap/blocker query, no conflict logic and no 409', !/listPlannedActivitiesOverlappingRange|listPlannedActivitiesForDay|findBlockingPlanForRange|intervalsOverlap|isActivePlanBlocker|CONFLICT|status: 409|OVERLAPS/.test(route));
check('the transaction client is used ONLY for the lock, COMMIT and ROLLBACK: POST runs no other query of its own (so no overlap/blocker SQL can be added unnoticed), and the route holds no PlannedActivity SQL', count(/client\.query\(/g, post) === 3 && !/FROM "PlannedActivity"|"plannedStartAt"|"plannedEndAt"|SELECT /.test(route.replace("'SELECT pg_advisory_xact_lock(hashtext($1))'", '')));
check('no availability or lifecycle check was added to manual creation', !/availability|loadFreshBlockers|resolveAvailability/i.test(post));
check('the success response contract is unchanged: POST still returns the created plan as JSON (NextResponse.json(plan))', /return NextResponse\.json\(plan\);/.test(post));
check('GET /api/plans is untouched: still a plain read with no transaction or lock', !/beginTransaction|pg_advisory/.test(get));

// ---- the create helper ----
const helper = functionBody(db, 'createPlannedActivity');
check('createPlannedActivity gained only an optional executor (defaults to the pool), so every other caller is unchanged', /createPlannedActivity\(input: CreatePlannedActivityInput, executor: QueryExecutor = pool\)/.test(helper) && !/\bpool\.query/.test(helper) && count(/executor\.query\(/g, helper) === 2);
check('createPlannedActivity itself takes NO lock and adds no overlap logic (the lock belongs to the writer that owns the transaction)', !/pg_advisory|listPlanned|overlap/i.test(helper));
check('NO DUPLICATE INSERT SQL: the route contains no INSERT, and db.ts still has exactly the original two PlannedActivity INSERT statements', !/INSERT INTO/.test(route) && count(/INSERT INTO "PlannedActivity"/g, db) === 2);
check('the only production caller of createPlannedActivity is the plans route', production.filter((x) => /\bcreatePlannedActivity\(/.test(x.src) && !/^apps\/web\/lib\/db\.ts$/.test(x.f)).map((x) => x.f).join() === 'apps/web/app/api/plans/route.ts');
check('the automatic writers still take the lock themselves: acceptance, Move and Recomposition acceptance (unchanged)', ['apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts'].every((f) => /pg_advisory_xact_lock\(hashtext\(\$1\)\)/.test(production.find((x) => x.f === f)!.src)));

// ---- scope ----
check('no DB exclusion constraint or schema change for plans', !/EXCLUDE USING|btree_gist/i.test(read('apps/web/prisma/schema.prisma')));
check('no Decision Intelligence vocabulary was introduced (pressure, evidence, scarcity, promotion, shadow)', !/DecisionPressure|DecisionEvidence|scarcity|promotion|shadowEval|LAST_KNOWN_OPPORTUNITY/i.test(route) && !/DecisionPressure|DecisionEvidence|scarcity|promotion|shadowEval/i.test(helper));

// ---- tests of this slice make no false claim and cover the required interleavings ----
const dbTest = read('test/scheduleWriteManualSerializationDb.test.ts');
const FALSE_CLAIM = /race[- ]free|globally consistent|global non-overlap|no overlapping plans can ever|conflict-free database|manual overlap (is )?prohibited|overlaps are impossible/i;
check('the DB test makes no global-non-overlap / race-free / overlap-prohibition claim in any assertion label', !(dbTest.match(/check\(`?'?[^\n]*/g) ?? []).some((l) => FALSE_CLAIM.test(l)));
check('the DB test drives the REAL route handler (not a re-implementation) and covers: S1-race closure, manual-first, two manual writers, different users, Move, rollback, connection loss, manual-manual overlap, idempotency, API contract', /import \{ POST as plansRoute \} from '\.\.\/apps\/web\/app\/api\/plans\/route'/.test(dbTest) && ['S1 known race is CLOSED', 'manual first', 'two manual writers', 'different users never wait', 'Move for the same user', 'failure paths release the lock', 'CONNECTION loss', 'manual-manual overlap is still ALLOWED', 'IDEMPOTENCY is unchanged', 'API contract'].every((m) => dbTest.includes(m)));
check('the DB test asserts final database rows and the acceptance result, not only event order', /ACCEPTANCE-FIRST final state/.test(dbTest) && /MANUAL-FIRST final state/.test(dbTest) && /acc2Res\.reason === 'CONFLICT'/.test(dbTest));

if (!allPassed) {
  console.error('SOME MANUAL WRITER SERIALIZATION ARCHITECTURE CHECKS FAILED');
  process.exit(1);
}
console.log('ALL MANUAL WRITER SERIALIZATION ARCHITECTURE CHECKS PASSED');
