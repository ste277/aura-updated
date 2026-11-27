/**
 * AURA-AUTH-SESSION-01-I1 -- the "AuthSession" allowlist (migration 0055) and
 * its database-enforced bounds, against a DISPOSABLE Postgres only.
 *
 *   DATABASE_URL="postgresql://...@localhost/..." npx ts-node test/authSessionStoreDb.test.ts
 *
 * Refuses any non-loopback database. Creates synthetic users
 * (auth-session-i1-*@example.test) and removes them at the end. Touches only
 * "User" (its own synthetic rows) and "AuthSession".
 *
 * Part 1: lifecycle, expiry, revoke-all, cascade, cleanup, privacy, B3 ordering.
 * Part 2: bound tests T1-T8 -- each asserts the SERVER side through
 *         pg_stat_activity (application_name = 'aura-session'), not only the
 *         client-side error.
 */
import { randomUUID } from 'crypto';
import { performance } from 'perf_hooks';
import { Pool, type PoolClient } from 'pg';
import {
  boundedSessionQuery,
  createSessionPool,
  SESSION_POOL_APPLICATION_NAME,
} from '../apps/web/lib/authSessionDb';
import {
  cleanupAuthSessions,
  createAuthSession,
  createAuthSessionInTransaction,
  lookupAuthSession,
  lookupAuthSessionWithUser,
  recheckAuthSessionForShare,
  revokeAllSessionsForUser,
  revokeAuthSession,
} from '../apps/web/lib/authSessionStore';
import { hashSessionId } from '../apps/web/lib/authSessionToken';
import { SESSION_UNAVAILABLE_MESSAGE, SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';

const dbUrl = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL || '';
if (!dbUrl) {
  console.error('DATABASE_URL is required (a disposable local database).');
  process.exit(1);
}
const host = new URL(dbUrl).hostname;
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  console.error('Refusing to run against a non-loopback database.');
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let uncaught = 0;
process.on('uncaughtException', (err) => {
  uncaught++;
  console.error('uncaughtException', err instanceof Error ? err.name : err);
});
process.on('unhandledRejection', (err) => {
  uncaught++;
  console.error('unhandledRejection', err instanceof Error ? err.name : err);
});

const admin = new Pool({ connectionString: dbUrl, max: 4, application_name: 'auth-session-i1-admin' });
/**
 * The admin pool comes from the repository-root `pg`, while apps/web/lib
 * resolves `pg` types from apps/web/node_modules when that is installed (as in
 * CI). The two PoolClient types are structurally incompatible across @types/pg
 * versions, so a client handed to the library crosses this one explicit,
 * test-only boundary. Runtime objects are identical node-pg clients.
 */
type LibClient = Parameters<typeof revokeAllSessionsForUser>[0];
const asLibClient = (c: PoolClient): LibClient => c as unknown as LibClient;
const userIds: string[] = [];

async function newUser(): Promise<string> {
  const id = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [id, `auth-session-i1-${id}@example.test`]);
  userIds.push(id);
  return id;
}

async function expectUnavailable(p: Promise<unknown>): Promise<{ reason: string | null; ms: number; message: string }> {
  const t = performance.now();
  try {
    await p;
    return { reason: null, ms: performance.now() - t, message: '' };
  } catch (err) {
    const ms = performance.now() - t;
    if (err instanceof SessionVerificationUnavailableError) return { reason: err.reason, ms, message: err.message };
    return { reason: `unexpected:${err instanceof Error ? err.name : String(err)}`, ms, message: err instanceof Error ? err.message : '' };
  }
}

/** aura-session backends, by state. */
async function sessionBackends(): Promise<{ total: number; active: number; waiting: number; sleeping: number }> {
  const r = await admin.query(
    `SELECT state, wait_event_type, query FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()`,
    [SESSION_POOL_APPLICATION_NAME]
  );
  return {
    total: r.rows.length,
    active: r.rows.filter((x) => x.state === 'active').length,
    waiting: r.rows.filter((x) => x.wait_event_type === 'Lock').length,
    sleeping: r.rows.filter((x) => x.state === 'active' && /pg_sleep/.test(String(x.query))).length,
  };
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs: number): Promise<number | null> {
  const t = performance.now();
  while (performance.now() - t < timeoutMs) {
    if (await fn()) return performance.now() - t;
    await sleep(25);
  }
  return null;
}

async function withLockedTable<T>(fn: () => Promise<T>): Promise<T> {
  const locker: PoolClient = await admin.connect();
  try {
    await locker.query('BEGIN');
    await locker.query('LOCK TABLE "AuthSession" IN ACCESS EXCLUSIVE MODE');
    return await fn();
  } finally {
    await locker.query('ROLLBACK').catch(() => {});
    locker.release();
  }
}

async function main() {
  const pool = createSessionPool(dbUrl);

  // ---------------------------------------------------------------- Part 1
  const u1 = await newUser();
  const u2 = await newUser();

  const s1 = await createAuthSession(pool, u1);
  check('create: returns a 43-char sid, its hash and a DB-set expiresAt', /^[A-Za-z0-9_-]{43}$/.test(s1.sid) && s1.idHash === hashSessionId(s1.sid) && s1.expiresAt instanceof Date);
  const dbRow = (await admin.query(`SELECT "createdAt", "expiresAt", now() AS now FROM "AuthSession" WHERE "idHash" = $1`, [s1.idHash])).rows[0];
  const ttlDays = (dbRow.expiresAt.getTime() - dbRow.createdAt.getTime()) / 86_400_000;
  check('create: expiresAt = createdAt + exactly 30 days (database clock)', ttlDays === 30, ttlDays);
  check('create: the returned expiresAt is the stored value', dbRow.expiresAt.getTime() === s1.expiresAt.getTime());

  const live = await lookupAuthSession(pool, s1.idHash, u1);
  check('lookup: a live session is found', live?.userId === u1 && live.expiresAt.getTime() === s1.expiresAt.getTime());
  const joined = await lookupAuthSessionWithUser(pool, s1.idHash, u1);
  check('lookup with user: one row, user fields present, alias stripped', joined?.userId === u1 && joined.user.id === u1 && joined.user.email === `auth-session-i1-${u1}@example.test` && !('authSessionExpiresAt' in joined.user));
  check('lookup: right idHash, wrong userId -> null', (await lookupAuthSession(pool, s1.idHash, u2)) === null);
  check('lookup: unknown idHash -> null', (await lookupAuthSession(pool, hashSessionId(s1.sid.replace(/^./, s1.sid[0] === 'A' ? 'B' : 'A')), u1)) === null);
  check('lookup: malformed inputs -> null without a query', (await lookupAuthSession(pool, "x' OR '1'='1", u1)) === null && (await lookupAuthSession(pool, s1.idHash, 'nope')) === null);

  check('revoke: first call -> revoked', (await revokeAuthSession(pool, s1.idHash, 'logout')) === 'revoked');
  check('revoke: the session is no longer valid', (await lookupAuthSession(pool, s1.idHash, u1)) === null);
  check('revoke: second call -> already_inactive (idempotent)', (await revokeAuthSession(pool, s1.idHash, 'logout')) === 'already_inactive');
  check('revoke: unknown or malformed id -> already_inactive', (await revokeAuthSession(pool, hashSessionId(randomUUID().replace(/-/g, '').slice(0, 32) + 'abcdefghijk'), 'logout')) === 'already_inactive' && (await revokeAuthSession(pool, 'bad', 'logout')) === 'already_inactive');
  const rev = (await admin.query(`SELECT "revokedAt", "revokeReason" FROM "AuthSession" WHERE "idHash" = $1`, [s1.idHash])).rows[0];
  check('revoke: revokedAt and reason recorded once', rev.revokedAt instanceof Date && rev.revokeReason === 'logout');

  // Server-side expiry, independent of any token or cookie.
  const s2 = await createAuthSession(pool, u1);
  await admin.query(`UPDATE "AuthSession" SET "createdAt" = now() - interval '31 days', "expiresAt" = now() - interval '1 second' WHERE "idHash" = $1`, [s2.idHash]);
  check('expiry: a row past expiresAt is rejected by the database clock', (await lookupAuthSession(pool, s2.idHash, u1)) === null);

  // Revoke-all scope.
  const a1 = await createAuthSession(pool, u1);
  const a2 = await createAuthSession(pool, u1);
  const b1 = await createAuthSession(pool, u2);
  const c = await admin.connect();
  let revokedCount = -1;
  try {
    await c.query('BEGIN');
    revokedCount = await revokeAllSessionsForUser(asLibClient(c), u1, 'logout_all');
    await c.query('COMMIT');
  } finally {
    c.release();
  }
  check('revoke-all: revokes every not-yet-revoked row of that user (a1, a2 and expired s2 = 3), skips the already revoked s1', revokedCount === 3, revokedCount);
  check('revoke-all: that user has no live session left', (await lookupAuthSession(pool, a1.idHash, u1)) === null && (await lookupAuthSession(pool, a2.idHash, u1)) === null);
  check("revoke-all: another user's session is untouched", (await lookupAuthSession(pool, b1.idHash, u2))?.userId === u2);

  // Create in a caller transaction: rolled back -> no row.
  const tx = await admin.connect();
  let txSession;
  try {
    await tx.query('BEGIN');
    txSession = await createAuthSessionInTransaction(asLibClient(tx), u2);
    await tx.query('ROLLBACK');
  } finally {
    tx.release();
  }
  check('create in transaction: rolled back with the caller -> no row', (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [txSession!.idHash])).rows.length === 0);

  // Constraint failures are fail-closed and distinguishable.
  const ghost = await expectUnavailable(createAuthSession(pool, randomUUID()));
  check('create for a non-existent user -> unavailable (constraint)', ghost.reason === 'constraint', ghost.reason);

  // Cascade.
  const u3 = await newUser();
  const s3 = await createAuthSession(pool, u3);
  await admin.query(`DELETE FROM "User" WHERE id = $1`, [u3]);
  check('cascade: deleting the user removes its sessions', (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [s3.idHash])).rows.length === 0);

  // Cleanup: only past the grace period, never live, limit respected.
  const u4 = await newUser();
  const oldRevoked = await createAuthSession(pool, u4);
  const oldExpired = await createAuthSession(pool, u4);
  const recentRevoked = await createAuthSession(pool, u4);
  const liveKeep = await createAuthSession(pool, u4);
  await admin.query(`UPDATE "AuthSession" SET "revokedAt" = now() - interval '10 days', "revokeReason" = 'logout' WHERE "idHash" = $1`, [oldRevoked.idHash]);
  await admin.query(`UPDATE "AuthSession" SET "createdAt" = now() - interval '40 days', "expiresAt" = now() - interval '10 days' WHERE "idHash" = $1`, [oldExpired.idHash]);
  await admin.query(`UPDATE "AuthSession" SET "revokedAt" = now() - interval '1 day', "revokeReason" = 'logout' WHERE "idHash" = $1`, [recentRevoked.idHash]);
  // s2 (expired 1 s ago) and s1 (revoked just now) are inside the grace period too.
  const limited = await cleanupAuthSessions(pool, { limit: 1, graceDays: 7 });
  const rest = await cleanupAuthSessions(pool, { limit: 5000, graceDays: 7 });
  const remaining = (await admin.query(`SELECT "idHash" FROM "AuthSession" WHERE "userId" = $1`, [u4])).rows.map((r) => r.idHash);
  check('cleanup: the limit is respected (1, then the rest)', limited === 1 && rest >= 1, { limited, rest });
  check('cleanup: removed only rows revoked/expired > 7 days ago', !remaining.includes(oldRevoked.idHash) && !remaining.includes(oldExpired.idHash));
  check('cleanup: kept the recently revoked row and the live row', remaining.includes(recentRevoked.idHash) && remaining.includes(liveKeep.idHash));
  check('cleanup: the live session still validates', (await lookupAuthSession(pool, liveKeep.idHash, u4))?.userId === u4);

  // Privacy: the raw session id is never stored anywhere in the row.
  const rawHits = (await admin.query(`SELECT count(*)::int AS n FROM "AuthSession" s WHERE s::text LIKE '%' || $1 || '%'`, [liveKeep.sid])).rows[0].n;
  check('privacy: no row contains a raw session id', rawHits === 0, rawHits);

  // Database constraints back the application checks.
  const badHash = await admin.query(`INSERT INTO "AuthSession" ("idHash","userId","expiresAt") VALUES ('short', $1, now() + interval '1 day')`, [u4]).then(() => 'inserted', (e) => e.code);
  const badReason = await admin.query(`UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = 'other' WHERE "idHash" = $1`, [liveKeep.idHash]).then(() => 'updated', (e) => e.code);
  const halfRevoked = await admin.query(`UPDATE "AuthSession" SET "revokedAt" = now() WHERE "idHash" = $1`, [liveKeep.idHash]).then(() => 'updated', (e) => e.code);
  check('constraints: malformed idHash, unknown reason and revokedAt without reason are refused', badHash === '23514' && badReason === '23514' && halfRevoked === '23514', { badHash, badReason, halfRevoked });

  // B3: FOR SHARE re-check strictly orders a concurrent revoke.
  const u5 = await newUser();
  const b3 = await createAuthSession(pool, u5);
  const holder = await admin.connect();
  try {
    await holder.query('BEGIN');
    const ok = await recheckAuthSessionForShare(asLibClient(holder), b3.idHash, u5);
    const t = performance.now();
    const revoking = revokeAuthSession(pool, b3.idHash, 'logout');
    await sleep(300);
    await holder.query('COMMIT');
    const outcome = await revoking;
    const waited = performance.now() - t;
    check('B3: re-check holds the row; revoke waits until the holder commits, then revokes', ok && outcome === 'revoked' && waited >= 280, { ok, outcome, waited: Math.round(waited) });
  } finally {
    holder.release();
  }
  const after = await admin.connect();
  try {
    await after.query('BEGIN');
    const ok = await recheckAuthSessionForShare(asLibClient(after), b3.idHash, u5);
    await after.query('ROLLBACK');
    check('B3: after the revoke commits, the re-check fails', ok === false);
  } finally {
    after.release();
  }

  // ---------------------------------------------------------------- Part 2
  const u6 = await newUser();
  const s6 = await createAuthSession(pool, u6);
  for (let i = 0; i < 5; i++) await lookupAuthSession(pool, s6.idHash, u6); // warm the pool

  // T1 -- lock bound.
  await withLockedTable(async () => {
    const r = await expectUnavailable(lookupAuthSession(pool, s6.idHash, u6));
    check('T1 lock: fails closed with lock_timeout, well inside the 2 s budget', r.reason === 'lock_timeout' && r.ms < 1500, { reason: r.reason, ms: Math.round(r.ms) });
    const gone = await waitUntil(async () => (await sessionBackends()).waiting === 0, 1000);
    check('T1 lock: no aura-session backend is left waiting on the lock (server side)', gone !== null, gone === null ? 'still waiting' : `${Math.round(gone)} ms`);
  });

  // T2 -- statement bound enforced by PostgreSQL.
  {
    const r = await expectUnavailable(boundedSessionQuery(pool, 'SELECT pg_sleep(5)', { statementTimeoutMs: 1000, lockTimeoutMs: 250, deadlineMs: 3000 }));
    check('T2 statement: PostgreSQL cancels at statement_timeout (~1 s), not the client', r.reason === 'statement_timeout' && r.ms >= 800 && r.ms < 2500, { reason: r.reason, ms: Math.round(r.ms) });
    const b = await sessionBackends();
    check('T2 statement: the backend is not still sleeping afterwards', b.sleeping === 0, b);
  }

  // T3 -- client deadline shorter than the server bound: connection discarded,
  // server work still ends within statement_timeout.
  {
    const start = performance.now();
    const r = await expectUnavailable(boundedSessionQuery(pool, 'SELECT pg_sleep(5)', { statementTimeoutMs: 1000, lockTimeoutMs: 250, deadlineMs: 200 }));
    check('T3 deadline: the caller gets deadline at ~200 ms', r.reason === 'deadline' && r.ms < 900, { reason: r.reason, ms: Math.round(r.ms) });
    const next = performance.now();
    const nextOk = (await lookupAuthSession(pool, s6.idHash, u6))?.userId === u6;
    const nextMs = performance.now() - next;
    check('T3 deadline: the very next lookup is fast (the busy connection was not handed out again)', nextOk && nextMs < 300, Math.round(nextMs));
    await sleep(50);
    check('T3 deadline: no client is left checked out after the deadline', pool.totalCount === pool.idleCount && pool.waitingCount === 0, { total: pool.totalCount, idle: pool.idleCount });
    const ended = await waitUntil(async () => (await sessionBackends()).sleeping === 0, 3000);
    const endedAt = ended === null ? null : performance.now() - start;
    check('T3 deadline: the server statement ended within its own bound (< 2.5 s from start)', endedAt !== null && endedAt < 2500, endedAt === null ? 'still running' : `${Math.round(endedAt)} ms`);
    await sleep(200);
    const orphan = (await sessionBackends()).total - pool.totalCount;
    check('T3 deadline: the discarded connection was closed on the server too (no orphan backend)', orphan === 0, { backends: (await sessionBackends()).total, poolTotal: pool.totalCount });
  }

  // T4 -- acquisition bound.
  {
    const held: Array<{ release(): void }> = []; // clients of the library's own pool
    for (let i = 0; i < 5; i++) held.push(await pool.connect());
    const r = await expectUnavailable(lookupAuthSession(pool, s6.idHash, u6));
    check('T4 acquire: pool exhausted -> acquire within ~500 ms', r.reason === 'acquire' && r.ms < 1500, { reason: r.reason, ms: Math.round(r.ms) });
    check('T4 acquire: nothing left queued', pool.waitingCount === 0, pool.waitingCount);
    held.forEach((h) => h.release());
    check('T4 acquire: works again once connections are free', (await lookupAuthSession(pool, s6.idHash, u6))?.userId === u6);
  }

  // T5 -- recovery after every backend is terminated.
  {
    for (let i = 0; i < 3; i++) await lookupAuthSession(pool, s6.idHash, u6);
    const killed = (await admin.query(`SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND datname = current_database()) t`, [SESSION_POOL_APPLICATION_NAME])).rows[0].n;
    await sleep(100);
    const outcomes: string[] = [];
    let wrong = false;
    for (let i = 0; i < 4; i++) {
      try {
        const res = await lookupAuthSession(pool, s6.idHash, u6);
        outcomes.push(res?.userId === u6 ? 'ok' : 'null');
        if (res && res.userId !== u6) wrong = true;
      } catch (err) {
        outcomes.push(err instanceof SessionVerificationUnavailableError ? `unavailable:${err.reason}` : 'unexpected');
      }
    }
    check('T5 recovery: never authenticated wrongly; recovers without a restart', !wrong && outcomes[outcomes.length - 1] === 'ok' && !outcomes.includes('null') && !outcomes.includes('unexpected'), { killed, outcomes });
    check('T5 recovery: no uncaught error events so far', uncaught === 0, uncaught);
  }

  // T6 -- driver error on an ended pool; fixed message.
  {
    const dead = createSessionPool(dbUrl);
    await dead.end();
    const r = await expectUnavailable(lookupAuthSession(dead, s6.idHash, u6));
    check('T6 driver: ended pool -> unavailable (driver), fixed message, no id/token', r.reason === 'driver' && r.message === SESSION_UNAVAILABLE_MESSAGE && !r.message.includes(u6) && !r.message.includes(s6.idHash), r.reason);
  }

  // T7 -- resource budget under a burst while the table is locked.
  await withLockedTable(async () => {
    let maxBackends = 0;
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        maxBackends = Math.max(maxBackends, (await sessionBackends()).total);
        await sleep(20);
      }
    })();
    const t = performance.now();
    const results = await Promise.all(Array.from({ length: 50 }, () => expectUnavailable(lookupAuthSession(pool, s6.idHash, u6))));
    const wall = performance.now() - t;
    sampling = false;
    await sampler;
    const reasons = [...new Set(results.map((r) => r.reason))].sort();
    check('T7 burst: all 50 fail closed (no success, no unexpected error)', results.every((r) => r.reason === 'lock_timeout' || r.reason === 'acquire' || r.reason === 'deadline'), reasons);
    check('T7 burst: each within its 2 s deadline (+ scheduling slack)', results.every((r) => r.ms < 2600), Math.round(Math.max(...results.map((r) => r.ms))));
    check('T7 burst: never more than 5 aura-session backends', maxBackends <= 5, maxBackends);
    check('T7 burst: total wall time bounded', wall < 5000, Math.round(wall));
  });
  const idle = await waitUntil(async () => (await sessionBackends()).active === 0, 1000);
  check('T7 burst: no aura-session backend active after the lock is released', idle !== null);

  // T8 -- normal path, for comparison with the design's evidence.
  {
    for (let i = 0; i < 50; i++) await lookupAuthSession(pool, s6.idHash, u6);
    const t: number[] = [];
    for (let i = 0; i < 1000; i++) {
      const a = performance.now();
      await lookupAuthSession(pool, s6.idHash, u6);
      t.push(performance.now() - a);
    }
    t.sort((x, y) => x - y);
    const p50 = t[500];
    const p95 = t[950];
    console.log(`INFO  T8 bounded lookup (1 simple-query message): p50 ${p50.toFixed(3)} ms, p95 ${p95.toFixed(3)} ms, p99 ${t[990].toFixed(3)} ms`);
    check('T8 normal path: 1 000 bounded lookups succeed', t.length === 1000);
  }

  check('no uncaught exceptions or unhandled rejections in the whole run', uncaught === 0, uncaught);
  await pool.end();
}

main()
  .catch((err) => {
    failures++;
    console.error('FAIL  unexpected error', err);
  })
  .finally(async () => {
    try {
      if (userIds.length) await admin.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [userIds]);
    } catch {
      /* best effort */
    }
    await admin.end().catch(() => {});
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });

