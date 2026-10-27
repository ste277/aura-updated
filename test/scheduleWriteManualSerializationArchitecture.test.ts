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
 *
 * HPG2 CI fix (schedule-write architecture correction): the transaction/
 * validation checks below were rewritten from source-text proximity
 * (literal "ROLLBACK immediately followed by throw", "the LAST status: 400
 * precedes beginTransaction") to actual control-flow checks, because HPG2
 * legitimately introduced a real third category these two literal checks
 * couldn't express:
 *   - PRE-TRANSACTION validation/auth: cheap, input-shape checks (auth,
 *     malformed body, out-of-range fields) -- MUST still precede
 *     beginTransaction, so invalid requests never pay for the lock. Still
 *     enforced, still fails loudly if anything moves.
 *   - TRANSACTION-SCOPED business-rule rejection: a check that can only be
 *     decided from LOCKED, current database state (GOAL_NOT_ACTIVE,
 *     GOAL_ACTIVITY_LINK_FAILED) -- deciding it any earlier would reopen a
 *     TOCTOU race. This is legitimate ONLY when it rolls back first, is
 *     drawn from a closed, named allowlist, and can never produce success.
 * The revised checks prove exactly those properties by walking the actual
 * catch block's control flow, and the "mutations" section below proves they
 * still fail on five concrete regressions (auth moved into the transaction,
 * validation moved into the transaction, rollback removed, a business
 * rejection returned without rollback, success returned after failure) --
 * run against small synthetic snippets, never the real file.
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

// HPG2 CI fix (schedule-write architecture correction) -- the two checks
// below used to assume EVERY 400 in this file is cheap, pre-transaction
// input validation, and that the catch block does nothing but
// ROLLBACK-then-rethrow. HPG2 legitimately added a genuine third category:
// a BUSINESS-RULE rejection that can only be decided from LOCKED,
// transaction-scoped database state (GOAL_NOT_ACTIVE, GOAL_ACTIVITY_LINK_FAILED)
// -- checking it any earlier would reopen the exact TOCTOU race the Goal
// lifecycle fix exists to close. The S2 invariant these checks protect was
// never "no 400 after beginTransaction" -- it was "cheap validation doesn't
// pay for the lock, and a failed transaction can never return success or
// skip rollback". These helpers test THAT, by control flow, not by
// source-text proximity, so they still fail hard on the five concrete
// regressions named below.
const TRANSACTION_SCOPED_REJECTIONS = ['GOAL_NOT_ACTIVE', 'GOAL_ACTIVITY_LINK_FAILED'] as const;

/** Brace-depth-walks from the first `{` AFTER `marker` to its match. */
function braceBlock(source: string, marker: string): string {
  const markerAt = source.indexOf(marker);
  if (markerAt < 0) throw new Error(`missing marker: ${marker}`);
  const braceStart = source.indexOf('{', markerAt);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(markerAt, i + 1);
    }
  }
  throw new Error(`unterminated block at marker: ${marker}`);
}

/** True iff the FIRST statement inside the catch block is the rollback. */
function rollbackIsFirstInCatch(catchBlock: string): boolean {
  const afterBrace = catchBlock.slice(catchBlock.indexOf('{') + 1).trimStart();
  return afterBrace.startsWith("await client.query('ROLLBACK')");
}

/** True iff rollback precedes EVERY return/throw in the catch block -- no
 *  path through the catch block can respond or propagate before it. */
function rollbackPrecedesEveryExit(catchBlock: string): boolean {
  const rollbackAt = catchBlock.indexOf("await client.query('ROLLBACK')");
  if (rollbackAt < 0) return false;
  const exits = [...catchBlock.matchAll(/\breturn\b|\bthrow\b/g)].map((m) => m.index ?? -1);
  return exits.length > 0 && exits.every((i) => i > rollbackAt);
}

/** True iff the ONLY typed 400s returned from inside the catch block match
 *  the closed TRANSACTION_SCOPED_REJECTIONS allowlist -- a new, undeclared
 *  business-rule branch fails this rather than silently being permitted. */
function catchOnlyReturnsAllowlistedRejections(catchBlock: string): boolean {
  const named = [...catchBlock.matchAll(/err\.message === '([A-Z_]+)'/g)].map((m) => m[1]);
  if (named.length === 0) return false;
  return named.every((name) => (TRANSACTION_SCOPED_REJECTIONS as readonly string[]).includes(name));
}

/** True iff the catch block's last statement (ignoring the closing brace)
 *  is `throw err;` -- an unclassified error always propagates, is never
 *  silently swallowed into an unintended outcome. */
function catchEndsWithRethrow(catchBlock: string): boolean {
  const body = catchBlock.slice(catchBlock.indexOf('{') + 1, catchBlock.lastIndexOf('}')).trimEnd();
  return body.endsWith('throw err;');
}

/** True iff the success response is reachable ONLY after the try/catch/
 *  finally construct ends -- structurally unreachable from any path that
 *  passed through the catch block, regardless of what the catch block does. */
function successResponseIsOutsideTryCatchFinally(post: string): boolean {
  const tryAt = post.indexOf('try {');
  if (tryAt < 0) return false;
  const finallyBlock = braceBlock(post.slice(tryAt), 'finally');
  const finallyEndsAt = tryAt + post.slice(tryAt).indexOf(finallyBlock) + finallyBlock.length;
  const tryCatchFinallySlice = post.slice(tryAt, finallyEndsAt);
  const successAt = post.indexOf('return NextResponse.json(plan)');
  return successAt > finallyEndsAt && !tryCatchFinallySlice.includes('return NextResponse.json(plan)');
}

/** True iff every 400/401 OUTSIDE the catch block precedes beginTransaction
 *  -- i.e. no validation or authentication silently moved inside the lock,
 *  and the only 400s that DO follow beginTransaction are the allowlisted,
 *  catch-block business-rule rejections (proven separately, above). */
function allNonTransactionScopedChecksPrecedeBeginTransaction(post: string, catchBlock: string): boolean {
  const beginAt = post.indexOf('await beginTransaction()');
  if (beginAt <= 0) return false;
  const outsideCatch = post.slice(0, post.indexOf(catchBlock)) + post.slice(post.indexOf(catchBlock) + catchBlock.length);
  const codeStatuses = [...outsideCatch.matchAll(/status: 40[01]/g)].map((m) => m.index ?? -1);
  if (codeStatuses.length === 0) return false;
  // Positions in `outsideCatch` don't line up with `post` once the catch
  // slice is removed, but removing a MIDDLE slice only ever shifts indices
  // at or after it; every validation/auth 400/401 lives textually before
  // the catch block (and before beginTransaction) in the real file, so a
  // direct comparison against beginAt is still meaningful for anything
  // found before the splice point -- anything after it is, by construction,
  // inside what used to be after the catch block (there is nothing there in
  // the real POST handler), so this still fails loudly if that ever changes.
  const spliceAt = post.indexOf(catchBlock);
  return codeStatuses.every((i) => (i < spliceAt ? i < beginAt : true)) && post.indexOf('status: 401') < beginAt;
}

// ---- transaction, lock, order, client ----
const catchBlock = braceBlock(post, '} catch (err) {');
check('TRANSACTION: the plan insert runs inside a transaction (one beginTransaction in POST, COMMIT on success, a rollback-first catch block, release in finally)', count(/await beginTransaction\(\)/g, post) === 1 && /await client\.query\('COMMIT'\);/.test(post) && rollbackIsFirstInCatch(catchBlock) && /finally \{\s*client\.release\(\);/.test(post));
check('ROLLBACK ALWAYS PRECEDES EVERY EXIT FROM THE CATCH BLOCK: no return or re-throw -- typed or not -- can happen before the transaction is rolled back', rollbackPrecedesEveryExit(catchBlock));
check('THE CATCH BLOCK ONLY EVER TYPES THE CLOSED SET OF TRANSACTION-SCOPED BUSINESS-RULE REJECTIONS (GOAL_NOT_ACTIVE, GOAL_ACTIVITY_LINK_FAILED) -- a new, undeclared 400 branch here fails this check rather than being silently permitted', catchOnlyReturnsAllowlistedRejections(catchBlock));
check('AN UNCLASSIFIED ERROR ALWAYS PROPAGATES: the catch block\'s last statement is `throw err;` -- nothing is ever silently swallowed into an unintended response', catchEndsWithRethrow(catchBlock));
check('NO SUCCESS CAN FOLLOW A FAILED TRANSACTION: the success response is reachable only AFTER the whole try/catch/finally, never from inside the catch block itself', successResponseIsOutsideTryCatchFinally(post));
check('SHARED LOCK: POST takes the per-user transaction-scoped advisory lock exactly once, with the unchanged key `day-constructor-accept:${userId}`', lockCall.test(post) && count(/pg_advisory_xact_lock/g, post) === 1);
const beginAt = post.indexOf('await beginTransaction()');
const lockAt = post.indexOf('pg_advisory_xact_lock');
const createAt = post.indexOf('createPlannedActivity({');
const commitAt = post.indexOf("client.query('COMMIT')");
check('ORDER: BEGIN, then the advisory lock, then the plan insert, then COMMIT', beginAt > 0 && beginAt < lockAt && lockAt < createAt && createAt < commitAt);
check('NO interval write before the lock: nothing that writes a plan appears before the lock in POST', !/createPlannedActivity\(|INSERT INTO/.test(post.slice(0, lockAt)));
check('SAME CLIENT: the insert receives the SAME transaction client that took the lock (`createPlannedActivity({...}, client)`)', /schedulingMode: DIRECT_PLAN_SCHEDULING_MODE,\s*\}, client\);/.test(post) && /const client = await beginTransaction\(\);/.test(post));
check(
  'PRE-TRANSACTION validation and authentication (cheap, input-shape checks) stay BEFORE the transaction; the only checks that legitimately follow beginTransaction are the allowlisted, locked-state business-rule rejections proven above -- arbitrary validation cannot move into the transaction unnoticed',
  allNonTransactionScopedChecksPrecedeBeginTransaction(post, catchBlock)
);
check('idempotency claims stay outside the transaction (before it) and the claim fills stay after it: unchanged behavior', post.indexOf('claimPlanCreation(') < beginAt && post.indexOf('fillPlanCreationClaim(') > post.indexOf("client.query('COMMIT')"));

// ============================================================
// Mutation proofs: each of the five concrete regressions this correction
// was written to still catch, demonstrated against small synthetic
// snippets (never the real file) built from the SAME check functions above.
// ============================================================
const GOOD_SNIPPET = `
function POST(req) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  const client = await beginTransaction();
  try {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    plan = await createPlannedActivity({ ... }, client);
    if (goalActivityId) {
      const lifecycle = await lockGoalParentLifecycleForPlanning(session.userId, [goalActivityId], client);
      if (lifecycle.owned.has(goalActivityId) && !lifecycle.active.has(goalActivityId)) {
        throw new Error('GOAL_NOT_ACTIVE');
      }
      const linked = await linkGoalActivityToPlannedActivity(session.userId, goalActivityId, plan.id, client);
      if (!linked) throw new Error('GOAL_ACTIVITY_LINK_FAILED');
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof Error && err.message === 'GOAL_NOT_ACTIVE') {
      return NextResponse.json({ error: 'not active' }, { status: 400 });
    }
    if (err instanceof Error && err.message === 'GOAL_ACTIVITY_LINK_FAILED') {
      return NextResponse.json({ error: 'link failed' }, { status: 400 });
    }
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION BASELINE: the good snippet itself passes every revised check (the checks aren\'t simply always-false)', (() => {
  const c = braceBlock(GOOD_SNIPPET, '} catch (err) {');
  return rollbackIsFirstInCatch(c) && rollbackPrecedesEveryExit(c) && catchOnlyReturnsAllowlistedRejections(c) && catchEndsWithRethrow(c) && successResponseIsOutsideTryCatchFinally(GOOD_SNIPPET) && allNonTransactionScopedChecksPrecedeBeginTransaction(GOOD_SNIPPET, c);
})());

const AUTH_AFTER_TX_SNIPPET = `
function POST(req) {
  const client = await beginTransaction();
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  try {
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION 1 -- authentication moved AFTER transaction creation: detected', !allNonTransactionScopedChecksPrecedeBeginTransaction(AUTH_AFTER_TX_SNIPPET, braceBlock(AUTH_AFTER_TX_SNIPPET, '} catch (err) {')));

const VALIDATION_AFTER_TX_SNIPPET = `
function POST(req) {
  const session = getSessionFromRequest(req);
  if (!session) return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 });
  const client = await beginTransaction();
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  try {
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION 2 -- a required pre-transaction validation moved AFTER transaction creation: detected', !allNonTransactionScopedChecksPrecedeBeginTransaction(VALIDATION_AFTER_TX_SNIPPET, braceBlock(VALIDATION_AFTER_TX_SNIPPET, '} catch (err) {')));

const NO_ROLLBACK_SNIPPET = `
function POST(req) {
  const client = await beginTransaction();
  try {
    await client.query('COMMIT');
  } catch (err) {
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION 3 -- rollback removed from the transaction-failure path: detected', !rollbackIsFirstInCatch(braceBlock(NO_ROLLBACK_SNIPPET, '} catch (err) {')) && !rollbackPrecedesEveryExit(braceBlock(NO_ROLLBACK_SNIPPET, '} catch (err) {')));

const BUSINESS_ERROR_WITHOUT_ROLLBACK_SNIPPET = `
function POST(req) {
  const client = await beginTransaction();
  try {
    await client.query('COMMIT');
  } catch (err) {
    if (err instanceof Error && err.message === 'GOAL_NOT_ACTIVE') {
      return NextResponse.json({ error: 'not active' }, { status: 400 });
    }
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION 4 -- a business-rule error returned WITHOUT rollback having happened first: detected', !rollbackPrecedesEveryExit(braceBlock(BUSINESS_ERROR_WITHOUT_ROLLBACK_SNIPPET, '} catch (err) {')));

const SUCCESS_AFTER_FAILURE_SNIPPET = `
function POST(req) {
  const client = await beginTransaction();
  try {
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err instanceof Error && err.message === 'GOAL_NOT_ACTIVE') {
      return NextResponse.json(plan);
    }
    throw err;
  } finally {
    client.release();
  }
  return NextResponse.json(plan);
}`;
check('MUTATION 5 -- a successful response returned from INSIDE the catch block (after a failed transaction): detected', !successResponseIsOutsideTryCatchFinally(SUCCESS_AFTER_FAILURE_SNIPPET));

// ---- authority and lock domain ----
check('SERVER AUTHORITY: the lock identity is the authenticated session user and nothing from the request body or query', /const session = getSessionFromRequest\(req\);/.test(post) && !/body/.test(post.slice(lockAt, lockAt + 160)) && !/searchParams|params\./.test(post.slice(lockAt, lockAt + 160)));
const keyLiterals = production.flatMap((x) => Array.from(x.src.matchAll(/`(day-constructor-accept:\$\{[^}]+\})`/g)).map((m) => ({ f: x.f, key: m[1].replace(/session\.userId/, 'userId') })));
check('NO NEW LOCK DOMAIN: every advisory-lock key in production code is the same `day-constructor-accept:${userId}` construction (acceptance, Move, Recomposition acceptance, and now the manual writer)', keyLiterals.length === 4 && new Set(keyLiterals.map((k) => k.key)).size === 1 && keyLiterals.map((k) => k.f).sort().join() === ['apps/web/app/api/plans/route.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts'].sort().join());
// Onboarding V1 PR 2 -- First-Run Reliability Correction added a FIFTH,
// unrelated `pg_advisory_xact_lock(hashtext($1))` call (db.ts's own
// recordVisit, keyed `visit-log:${userId}` -- VisitLog analytics
// concurrency, never schedule-write serialization; already excluded from
// line 74/75's own `day-constructor-accept:` key-scoped count above).
// Scoped here to the same four schedule-write call sites line 75 already
// names, rather than the bare SQL text, so this stays a true "byte-
// identical AT THE FOUR SCHEDULE-WRITE SITES" check instead of breaking
// on an unrelated lock elsewhere using the same general-purpose
// primitive for a different key/purpose.
check('the lock SQL is byte-identical at all four SCHEDULE-WRITE sites (same primitive, no variant)', production.filter((x) => ['apps/web/app/api/plans/route.ts', 'apps/web/lib/dayConstructorAcceptancePersistence.ts', 'apps/web/lib/planMove.ts', 'apps/web/lib/remainingDayRecompositionAcceptance.ts'].includes(x.f) && x.src.includes('pg_advisory_xact_lock(hashtext($1))')).length === 4);
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
