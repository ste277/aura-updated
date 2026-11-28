/**
 * AURA-AUTH-SESSION-01-I1 R3 (39237) -- witnesses for the two 39236 defects,
 * reconstructed independently (the 39236 disposition and evidence were not
 * available). Runs unchanged against R2 (696e584) and R3. It only OBSERVES and
 * prints JSON; the number of raw-session-id releases is counted per witness.
 *
 *   DATABASE_URL=postgresql://...@127.0.0.1:PORT/DB TS_NODE_TRANSPILE_ONLY=1 npx ts-node AURA_AUTH_SESSION_01_I1_R3_EVIDENCE/repro/reproR3Witnesses.ts
 *
 * Defect A (binding): an acknowledged COMMIT is accepted as authorization even
 *   when it ended a transaction OTHER than the one that created the
 *   provisional session.
 * Defect B (single use): overlapping release calls on one authorization can
 *   each return the raw session id.
 * Disposable loopback database only; synthetic users only.
 */
import { randomUUID } from 'crypto';
import { Client, Pool } from 'pg';
import * as dbLib from '../../apps/web/lib/authSessionDb';
import * as store from '../../apps/web/lib/authSessionStore';
import { startFaultProxy } from '../../test/authSessionFaultProxy';

const url = process.env.DATABASE_URL || '';
if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  console.error('DATABASE_URL must be a disposable loopback database.');
  process.exit(1);
}
const s = store as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
const admin = new Pool({ connectionString: url, max: 4, application_name: 'r3-witness-admin' });
const isSid = (x: unknown) => !!x && typeof x === 'object' && typeof (x as { sid?: unknown }).sid === 'string';
const settle = async (p: Promise<unknown>) => p.then((v) => v, (e: Error) => `throws ${e.name}`);

async function releaseAll(pool: unknown, decision: unknown, n: number) {
  const d = decision as { outcome?: string; authorization?: unknown };
  if (d?.outcome !== 'committed') return { outcome: d?.outcome ?? String(decision), releases: 0, results: [] as string[] };
  const results = await Promise.all(Array.from({ length: n }, () => settle(s.releaseCommittedAuthSession(pool, d.authorization))));
  return { outcome: d.outcome, releases: results.filter(isSid).length, results: results.map((r) => (isSid(r) ? 'RAW SID RELEASED' : String(r))) };
}

async function main() {
  const uid = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [uid, `r3-witness-${uid}@example.test`]);
  const pool = dbLib.createSessionPool(url);
  const out: Record<string, unknown> = { implementation: typeof s.classifyAmbiguousCommit === 'function' ? 'R2+' : 'unknown' };
  try {
    // A1: caller commits T1 itself (acknowledged), opens T2, then asks the helper to "commit" P1.
    {
      const c = await admin.connect();
      await c.query('BEGIN');
      const p = await s.createAuthSessionInTransaction(c, uid);
      await c.query('COMMIT'); // T1 ends outside the helper
      await c.query('BEGIN');
      await c.query('SELECT txid_current()'); // T2 gets a transaction id
      const d = await settle(s.commitAuthSessionTransaction(c, p));
      await c.query('ROLLBACK').catch(() => {}); // the caller owns its transaction: end it whatever the outcome
      c.release();
      out.A1_substituted_transaction_after_caller_commit = { decision: d, ...(await releaseAll(pool, d, 1)) };
    }
    // A2: T1's COMMIT is AMBIGUOUS (acknowledgement lost, but it committed); a new transaction on a new connection then "commits" P1.
    {
      const proxy = await startFaultProxy(url, 'COMMIT');
      const c1 = new Client({ connectionString: proxy.url });
      c1.on('error', () => {});
      await c1.connect();
      await c1.query('BEGIN');
      const p = await s.createAuthSessionInTransaction(c1, uid);
      proxy.queue.push('drop-after-forward');
      const t1 = await c1.query('COMMIT').then(() => 'acknowledged', () => 'ambiguous');
      await c1.end().catch(() => {});
      await proxy.close();
      await new Promise((r) => setTimeout(r, 400));
      const c2 = await admin.connect();
      await c2.query('BEGIN');
      await c2.query('SELECT txid_current()');
      const d = await settle(s.commitAuthSessionTransaction(c2, p));
      await c2.query('ROLLBACK').catch(() => {});
      c2.release();
      const committed = (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [(p as { idHash: string }).idHash])).rows.length === 1;
      out.A2_release_after_ambiguous_T1_commit_via_substitute = { t1Commit: t1, rowCommittedByT1: committed, decision: d, ...(await releaseAll(pool, d, 1)) };
    }
    // A3: T1 rolled back; T2 re-inserts a row with the SAME idHash (a mismatched operation), then the helper "commits" P1.
    {
      const c = await admin.connect();
      await c.query('BEGIN');
      const p = (await s.createAuthSessionInTransaction(c, uid)) as { idHash: string };
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query(`INSERT INTO "AuthSession" ("idHash", "userId", "expiresAt") VALUES ($1, $2, now() + interval '1 hour')`, [p.idHash, uid]);
      const d = await settle(s.commitAuthSessionTransaction(c, p));
      await c.query('ROLLBACK').catch(() => {}); // the caller owns its transaction: end it whatever the outcome
      c.release();
      out.A3_rollback_then_mismatched_reinsert = { decision: d, ...(await releaseAll(pool, d, 1)) };
    }
    // A4: the caller's own COMMIT / BEGIN are queued on the same client right behind the helper's first query
    // (deterministic: node-pg executes queries in send order). Which transaction did the helper's COMMIT end?
    // PostgreSQL's "there is no transaction in progress" notice on the CALLER's COMMIT means the helper had
    // already committed T1 itself; no notice means the caller's COMMIT ended T1 and the helper's COMMIT ended
    // the caller's REPLACEMENT transaction.
    {
      const c = await admin.connect();
      const notices: string[] = [];
      const onNotice = (n: { message?: string }) => notices.push(String(n.message));
      c.on('notice', onNotice);
      await c.query('BEGIN');
      const p = await s.createAuthSessionInTransaction(c, uid);
      const helper = settle(s.commitAuthSessionTransaction(c, p));
      let noticesWhenCallerCommitDone = -1;
      const callerCommit = c.query('COMMIT').then(
        (r) => ((noticesWhenCallerCommitDone = notices.filter((m) => /no transaction in progress/.test(m)).length), r.command),
        () => 'error'
      );
      const callerBegin = c.query('BEGIN').then((r) => r.command, () => 'error');
      const d = await helper;
      await callerCommit;
      await callerBegin;
      c.off('notice', onNotice); // before the witness's own cleanup ROLLBACK, which may itself warn
      await c.query('ROLLBACK').catch(() => {});
      c.release();
      // Notices are delivered before the reply of the statement that raised them, so a notice counted when the
      // caller's COMMIT resolved can only come from that COMMIT (or the helper's earlier message).
      const helperCommittedT1Itself = noticesWhenCallerCommitDone > 0;
      out.A4_caller_commit_and_begin_queued_behind_helper = {
        decision: d,
        callerCommitGotNoTransactionNotice: helperCommittedT1Itself,
        authorizationCameFromTheOriginatingTransaction: (d as { outcome?: string })?.outcome !== 'committed' || helperCommittedT1Itself,
        ...(await releaseAll(pool, d, 1)),
      };
    }
    // A4b: the caller replaces the transaction BEFORE the helper runs (COMMIT + BEGIN + a write queued first).
    {
      const c = await admin.connect();
      await c.query('BEGIN');
      const p = await s.createAuthSessionInTransaction(c, uid);
      const q1 = c.query('COMMIT').catch(() => {});
      const q2 = c.query('BEGIN').catch(() => {});
      const q3 = c.query('SELECT txid_current()').catch(() => {});
      const d = await settle(s.commitAuthSessionTransaction(c, p));
      await Promise.all([q1, q2, q3]);
      await c.query('ROLLBACK').catch(() => {});
      c.release();
      out.A4b_transaction_replaced_before_helper = { decision: d, ...(await releaseAll(pool, d, 1)) };
    }
    // B1 / B2: overlapping release of ONE valid authorization (2 and 10 concurrent calls).
    for (const n of [2, 10]) {
      const c = await admin.connect();
      await c.query('BEGIN');
      const p = await s.createAuthSessionInTransaction(c, uid);
      const d = await s.commitAuthSessionTransaction(c, p);
      c.release();
      out[`B_overlapping_release_x${n}`] = await releaseAll(pool, d, n);
    }
  } finally {
    await (pool as unknown as Pool).end().catch(() => {});
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [uid]).catch(() => {});
    await admin.end();
  }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error('witness failed', e instanceof Error ? e.message : e);
  process.exit(1);
});
