/**
 * AURA-AUTH-SESSION-01-I1 R3 (39237) -- transaction binding and single-use
 * release, against a DISPOSABLE loopback PostgreSQL only.
 *
 *   DATABASE_URL="postgresql://...@localhost/..." npx ts-node test/authSessionR3Db.test.ts
 *
 * Every case asserts the EXACT number of raw-session-id releases: at most one
 * for a valid authorization, zero for an invalid, substituted or ambiguous one.
 * Concurrency is driven by deterministic barriers (node-pg executes a client's
 * queries in send order; JavaScript runs synchronous code to completion), not
 * by timing or repeated stress runs. Connection faults use the existing
 * loopback proxy (test/authSessionFaultProxy.ts). Synthetic users only.
 */
import { randomUUID } from 'crypto';
import { Client, Pool } from 'pg';
import { createSessionPool } from '../apps/web/lib/authSessionDb';
import {
  classifyAmbiguousCommit,
  commitAuthSessionTransaction,
  createAuthSession,
  createAuthSessionInTransaction,
  releaseCommittedAuthSession,
} from '../apps/web/lib/authSessionStore';
import { hashSessionId } from '../apps/web/lib/authSessionToken';
import { SessionVerificationUnavailableError } from '../apps/web/lib/sessionErrors';
import { startFaultProxy } from './authSessionFaultProxy';

const dbUrl = process.env.AURA_DATABASE_URL || process.env.DATABASE_URL || '';
if (!dbUrl || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(dbUrl).hostname)) {
  console.error('DATABASE_URL must be a disposable loopback database.');
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== undefined ? ` -- ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}
let uncaught = 0;
process.on('uncaughtException', (e) => (uncaught++, console.error('uncaughtException', e instanceof Error ? e.name : e)));
process.on('unhandledRejection', (e) => (uncaught++, console.error('unhandledRejection', e instanceof Error ? e.name : e)));

type LibPool = Parameters<typeof releaseCommittedAuthSession>[0];
type LibClient = Parameters<typeof createAuthSessionInTransaction>[0];
type Provisional = Awaited<ReturnType<typeof createAuthSessionInTransaction>>;
type Decision = Awaited<ReturnType<typeof commitAuthSessionTransaction>>;
const lib = <T>(x: unknown) => x as T;
const admin = new Pool({ connectionString: dbUrl, max: 6, application_name: 'auth-session-r3-admin' });
const users: string[] = [];
const isSid = (x: unknown) => !!x && typeof x === 'object' && typeof (x as { sid?: unknown }).sid === 'string';
const settle = <T>(p: Promise<T>) => p.then((v) => v as unknown, (e) => e as unknown);
const reason = (d: unknown) => (d as { reason?: string })?.reason;
const asTypeError = (x: unknown) => x instanceof TypeError;

/** Narrows a decision to its authorization; a non-committed decision here is a test failure, never a cast. */
function authOf(d: Decision) {
  if (d.outcome !== 'committed') throw new Error(`expected a committed decision, got ${d.outcome}`);
  return d.authorization;
}

async function newUser(): Promise<string> {
  const id = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [id, `auth-session-r3-${id}@example.test`]);
  users.push(id);
  return id;
}

/** Releases (with `n` concurrent calls) and counts raw-id releases. */
async function releases(pool: LibPool, d: unknown, n = 1): Promise<{ count: number; results: unknown[] }> {
  const dd = d as Decision;
  if (!dd || dd.outcome !== 'committed') return { count: 0, results: [] };
  const results = await Promise.all(Array.from({ length: n }, () => settle(releaseCommittedAuthSession(pool, dd.authorization))));
  return { count: results.filter(isSid).length, results };
}

async function openWithProvisional(u: string) {
  const c = await admin.connect();
  await c.query('BEGIN');
  const p = await createAuthSessionInTransaction(lib<LibClient>(c), u);
  return { c, p };
}
const endTx = async (c: { query: (t: string) => Promise<unknown>; release: () => void }) => {
  await c.query('ROLLBACK').catch(() => {}); // the caller owns its transaction: end it whatever the outcome
  c.release();
};

async function main() {
  const pool = lib<LibPool>(createSessionPool(dbUrl));
  const u = await newUser();
  const other = await newUser();
  try {
    // 1. Correct originating transaction, acknowledged COMMIT -> exactly one release.
    {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      const r = await releases(pool, d);
      check('1 originating transaction + acknowledged COMMIT -> committed; exactly 1 release; sid hashes to the row', d.outcome === 'committed' && r.count === 1 && hashSessionId((r.results[0] as { sid: string }).sid) === p.idHash, { outcome: d.outcome, releases: r.count });
    }
    // 2. Transaction replacement before COMMIT: caller commits T1 itself, opens T2 (with a write), then calls the helper.
    {
      const { c, p } = await openWithProvisional(u);
      await c.query('COMMIT');
      await c.query('BEGIN');
      await c.query('SELECT txid_current()');
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      await endTx(c);
      const again = await settle(commitAuthSessionTransaction(lib<LibClient>(c), p));
      const r = await releases(pool, d);
      check('2 transaction replaced before COMMIT -> rolled_back (transaction_mismatch); 0 releases; permanently dead', d.outcome === 'rolled_back' && reason(d) === 'transaction_mismatch' && r.count === 0 && asTypeError(again), d);
    }
    // 3. Rollback followed by another transaction (with and without a mismatched re-insert of the same idHash).
    for (const reinsert of [false, true]) {
      const { c, p } = await openWithProvisional(u);
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      if (reinsert) await c.query(`INSERT INTO "AuthSession" ("idHash", "userId", "expiresAt") VALUES ($1, $2, now() + interval '1 hour')`, [p.idHash, u]);
      else await c.query('SELECT txid_current()');
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      await endTx(c);
      const r = await releases(pool, d);
      check(`3 rollback then another transaction${reinsert ? ' that re-inserts the same idHash (mismatched operation)' : ''} -> transaction_mismatch; 0 releases`, d.outcome === 'rolled_back' && reason(d) === 'transaction_mismatch' && r.count === 0, d);
    }
    // 4a. Transaction changes queued AFTER the helper: its single message commits T1 itself.
    {
      const { c, p } = await openWithProvisional(u);
      const notices: string[] = [];
      const onNotice = (n: { message?: string }) => notices.push(String(n.message));
      c.on('notice', onNotice);
      const helper = commitAuthSessionTransaction(lib<LibClient>(c), p);
      const q1 = c.query('COMMIT').catch(() => {});
      const q2 = c.query('BEGIN').catch(() => {});
      const d = await helper;
      await Promise.all([q1, q2]);
      c.off('notice', onNotice);
      await endTx(c);
      const r = await releases(pool, d);
      const t1ByHelper = notices.some((m) => /no transaction in progress/.test(m));
      check("4a caller COMMIT/BEGIN queued behind the helper -> the helper's one message committed T1 itself (the caller's COMMIT saw no transaction); exactly 1 release", d.outcome === 'committed' && t1ByHelper && r.count === 1, { outcome: d.outcome, t1ByHelper, releases: r.count });
    }
    // 4b. Transaction changes queued BEFORE the helper.
    {
      const { c, p } = await openWithProvisional(u);
      const q1 = c.query('COMMIT').catch(() => {});
      const q2 = c.query('BEGIN').catch(() => {});
      const q3 = c.query('SELECT txid_current()').catch(() => {});
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      await Promise.all([q1, q2, q3]);
      await endTx(c);
      const r = await releases(pool, d);
      check('4b caller COMMIT/BEGIN/write queued before the helper -> transaction_mismatch; 0 releases', d.outcome === 'rolled_back' && reason(d) === 'transaction_mismatch' && r.count === 0, d);
    }
    // 5. Mismatched provisional operation: P2 (created on client B) presented with client A's transaction.
    {
      const a = await openWithProvisional(u);
      const b = await openWithProvisional(u);
      const wrong = await commitAuthSessionTransaction(lib<LibClient>(a.c), b.p);
      const aborted = await a.c.query('SELECT 1').then(() => 'none', (e) => e.code);
      await a.c.query('ROLLBACK');
      const right = await commitAuthSessionTransaction(lib<LibClient>(b.c), b.p).then((x) => x as unknown, (e) => e as unknown);
      b.c.release();
      a.c.release();
      const r = await releases(pool, wrong);
      check("5 provisional P2 presented with another transaction -> transaction_mismatch (that transaction left aborted for its caller); 0 releases; P2 permanently dead", wrong.outcome === 'rolled_back' && reason(wrong) === 'transaction_mismatch' && aborted === '25P02' && r.count === 0 && asTypeError(right), { wrong, aborted });
      const fresh = await openWithProvisional(u);
      const ok = await commitAuthSessionTransaction(lib<LibClient>(fresh.c), fresh.p);
      fresh.c.release();
      check("5 a provisional with its OWN transaction still commits (exactly 1 release)", ok.outcome === 'committed' && (await releases(pool, ok)).count === 1);
    }
    // 6. Connection reuse: same physical connection, later transaction.
    {
      const single = new Pool({ connectionString: dbUrl, max: 1, application_name: 'auth-session-r3-reuse' });
      try {
        const c1 = await single.connect();
        const pid1 = (await c1.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await c1.query('BEGIN');
        const p = await createAuthSessionInTransaction(lib<LibClient>(c1), u);
        await c1.query('COMMIT');
        c1.release();
        const c2 = await single.connect();
        const pid2 = (await c2.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await c2.query('BEGIN');
        await c2.query('SELECT txid_current()');
        const d = await commitAuthSessionTransaction(lib<LibClient>(c2), p);
        await c2.query('ROLLBACK').catch(() => {});
        c2.release();
        const r = await releases(pool, d);
        check('6 connection reuse (same backend pid, later transaction) -> transaction_mismatch; 0 releases', pid1 === pid2 && d.outcome === 'rolled_back' && reason(d) === 'transaction_mismatch' && r.count === 0, { samePid: pid1 === pid2, d });
      } finally {
        await single.end();
      }
    }
    // 7. Forged or transferred authorization.
    {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      const auth = authOf(d);
      const fakes: unknown[] = [{ ...auth }, Object.create(auth), JSON.parse(JSON.stringify(auth)), structuredClone(auth), Object.freeze({ ...auth, userId: other })];
      const fakeResults = await Promise.all(fakes.map((f) => settle(releaseCommittedAuthSession(pool, f as never))));
      const real = await releases(pool, d);
      check('7 forged / copied / transferred authorizations (spread, prototype, JSON, structuredClone, re-pointed) -> all refused; the genuine one still releases exactly once', fakeResults.every(asTypeError) && real.count === 1, { refused: fakeResults.filter(asTypeError).length, genuine: real.count });
    }
    // 8. Sequential reuse.
    {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      const first = await settle(releaseCommittedAuthSession(pool, authOf(d)));
      const second = await settle(releaseCommittedAuthSession(pool, authOf(d)));
      check('8 sequential reuse -> exactly 1 release; the second call is refused', isSid(first) && asTypeError(second));
    }
    // 9 / 10. Overlapping releases (2 and 25 concurrent calls).
    for (const n of [2, 25]) {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      const r = await releases(pool, d, n);
      check(`${n === 2 ? '9' : '10'} ${n} overlapping release calls -> exactly 1 release, ${n - 1} refused`, r.count === 1 && r.results.filter(asTypeError).length === n - 1, { releases: r.count });
    }
    // 11. Live-row verification delayed while other calls overlap (deterministic barrier on the read-back connection).
    {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      let open!: () => void;
      const barrier = new Promise<void>((resolve) => (open = resolve));
      let lookupsStarted = 0;
      const gated = new Proxy(pool as unknown as Pool, {
        get(t, k, r) {
          if (k === 'connect') return async () => (lookupsStarted++, await barrier, t.connect());
          const v = Reflect.get(t, k, r);
          return typeof v === 'function' ? v.bind(t) : v;
        },
      });
      const auth = authOf(d);
      const first = settle(releaseCommittedAuthSession(lib<LibPool>(gated), auth));
      const overlapping = await Promise.all(Array.from({ length: 5 }, () => settle(releaseCommittedAuthSession(lib<LibPool>(gated), auth))));
      const startedBeforeOpen = lookupsStarted;
      open();
      const winner = await first;
      check('11 read-back held at a barrier: 5 overlapping calls are refused BEFORE it completes; only the reserving call releases (exactly 1)', overlapping.every(asTypeError) && startedBeforeOpen === 1 && isSid(winner), { refused: overlapping.filter(asTypeError).length, lookupsStarted: startedBeforeOpen });
    }
    // 12. Live-row verification failure (confirmed and uncertain) -> no release, authorization never restored.
    {
      const dead = createSessionPool(dbUrl);
      await dead.end();
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      const auth = authOf(d);
      const failed = await settle(releaseCommittedAuthSession(lib<LibPool>(dead), auth));
      const retry = await settle(releaseCommittedAuthSession(pool, auth));
      check('12a read-back fails (confirmed, ended pool) -> unavailable; the retry with a healthy pool is refused; 0 releases', failed instanceof SessionVerificationUnavailableError && asTypeError(retry), { failed: (failed as Error)?.name });
      const proxy = await startFaultProxy(dbUrl, '"AuthSession"');
      const viaProxy = createSessionPool(proxy.url);
      try {
        const x = await openWithProvisional(u);
        const dx = await commitAuthSessionTransaction(lib<LibClient>(x.c), x.p);
        x.c.release();
        proxy.queue.push('blackhole');
        const ax = authOf(dx);
        const uncertain = await settle(releaseCommittedAuthSession(lib<LibPool>(viaProxy), ax));
        const retry2 = await settle(releaseCommittedAuthSession(pool, ax));
        check('12b read-back uncertain (black-holed answer, deadline) -> unavailable/uncertain; NOT restored; 0 releases', uncertain instanceof SessionVerificationUnavailableError && (uncertain as SessionVerificationUnavailableError).outcome === 'uncertain' && asTypeError(retry2));
      } finally {
        await viaProxy.end().catch(() => {});
        await proxy.close();
      }
    }
    // 13. Revoked, expired or missing row after a confirmed commit.
    for (const [label, sql] of [
      ['revoked', `UPDATE "AuthSession" SET "revokedAt" = now(), "revokeReason" = 'logout' WHERE "idHash" = $1`],
      ['expired', `UPDATE "AuthSession" SET "createdAt" = now() - interval '800 hours', "expiresAt" = now() - interval '1 second' WHERE "idHash" = $1`],
      ['missing', `DELETE FROM "AuthSession" WHERE "idHash" = $1`],
    ] as const) {
      const { c, p } = await openWithProvisional(u);
      const d = await commitAuthSessionTransaction(lib<LibClient>(c), p);
      c.release();
      await admin.query(sql, [p.idHash]);
      const r = await releases(pool, d, 3);
      check(`13 confirmed commit but ${label} row -> 0 releases (null once, then refused)`, r.count === 0 && r.results.filter((x) => x === null).length === 1, { releases: r.count });
    }
    // 14 / 15. Ambiguous COMMIT with a persisted row; substitution attempt afterwards; repeated classification.
    {
      const proxy = await startFaultProxy(dbUrl, 'COMMIT');
      const caller = new Client({ connectionString: proxy.url, application_name: 'auth-session-r3-caller' });
      caller.on('error', () => {});
      await caller.connect();
      await caller.query('BEGIN');
      const p: Provisional = await createAuthSessionInTransaction(lib<LibClient>(caller), u);
      proxy.queue.push('drop-after-forward');
      const d = await commitAuthSessionTransaction(lib<LibClient>(caller), p);
      await caller.end().catch(() => {});
      await proxy.close();
      await new Promise((r) => setTimeout(r, 400));
      const persisted = (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [p.idHash])).rows.length === 1;
      const c2 = await admin.connect();
      await c2.query('BEGIN');
      await c2.query('SELECT txid_current()');
      const substitute = await settle(commitAuthSessionTransaction(lib<LibClient>(c2), p));
      await endTx(c2);
      const labels = [await classifyAmbiguousCommit(pool, p), await classifyAmbiguousCommit(pool, p), await classifyAmbiguousCommit(pool, p)];
      check('14 ambiguous COMMIT that persisted the row -> ambiguous, no authorization; 0 releases', d.outcome === 'ambiguous' && !('authorization' in d) && persisted);
      check('14 a later substitute transaction cannot commit / authorize it (refused); 0 releases', asTypeError(substitute));
      check('15 repeated classification -> committed_undisclosed x3, never session material', labels.every((l) => l === 'committed_undisclosed') && !labels.some(isSid), labels);
    }
    // Control: standalone committed creation still works.
    {
      const s = await createAuthSession(pool, u);
      check('control: standalone createAuthSession unchanged (committed, hashed id)', s.state === 'committed' && hashSessionId(s.sid) === s.idHash);
    }
  } finally {
    await (pool as unknown as Pool).end().catch(() => {});
  }
  check('no uncaught exceptions or unhandled rejections', uncaught === 0, uncaught);
}

main()
  .catch((e) => {
    failures++;
    console.error('FAIL  unexpected error', e);
  })
  .finally(async () => {
    try {
      if (users.length) await admin.query(`DELETE FROM "User" WHERE id = ANY($1::text[])`, [users]);
    } catch {
      /* best effort */
    }
    await admin.end().catch(() => {});
    console.log(`\n${passes} passed, ${failures} failed`);
    process.exit(failures === 0 ? 0 : 1);
  });
