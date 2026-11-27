/**
 * AURA-AUTH-SESSION-01-I1 R2 (39235) -- reproduction of the provisional-commit
 * authorization discrepancy. Runs unchanged against R1 (8419631: the API has
 * confirmCommittedAuthSession) and against R2 (commitAuthSessionTransaction /
 * releaseCommittedAuthSession / classifyAmbiguousCommit). It only OBSERVES and
 * prints JSON: for each scenario, whether raw session material (a `sid`) was
 * released, and what the database actually holds.
 *
 *   DATABASE_URL=postgresql://...@127.0.0.1:PORT/DB TS_NODE_TRANSPILE_ONLY=1 npx ts-node AURA_AUTH_SESSION_01_I1_R2_EVIDENCE/repro/reproCommitAuthorization.ts
 *
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
const api = typeof s.commitAuthSessionTransaction === 'function' ? 'R2' : 'R1';
const admin = new Pool({ connectionString: url, max: 3, application_name: 'r2-repro-admin' });
const released = (x: unknown) => !!x && typeof x === 'object' && typeof (x as { sid?: unknown }).sid === 'string';
const rowExists = async (idHash: string) => (await admin.query(`SELECT 1 FROM "AuthSession" WHERE "idHash" = $1`, [idHash])).rows.length === 1;

/** Runs a caller transaction through the fault proxy, injecting `fault` on COMMIT; then attempts release. */
async function scenario(pool: unknown, uid: string, fault: 'pass' | 'drop-after-forward' | 'drop-before-forward', readBacks: number) {
  const proxy = await startFaultProxy(url, 'COMMIT');
  const caller = new Client({ connectionString: proxy.url });
  caller.on('error', () => {});
  await caller.connect();
  await caller.query('BEGIN');
  const p = (await s.createAuthSessionInTransaction(caller, uid)) as { idHash: string };
  proxy.queue.push(fault);
  const attempts: unknown[] = [];
  let callerCommit = '';
  if (api === 'R1') {
    callerCommit = await caller.query('COMMIT').then(() => 'acknowledged', () => 'ambiguous');
    await caller.end().catch(() => {});
    await proxy.close();
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < readBacks; i++) attempts.push(await s.confirmCommittedAuthSession(pool, p).catch((e: Error) => `throws ${e.name}`));
  } else {
    const decision = (await s.commitAuthSessionTransaction(caller, p)) as { outcome: string; authorization?: unknown };
    callerCommit = decision.outcome;
    await caller.end().catch(() => {});
    await proxy.close();
    await new Promise((r) => setTimeout(r, 400));
    for (let i = 0; i < readBacks; i++) {
      if (decision.outcome === 'committed') attempts.push(await s.releaseCommittedAuthSession(pool, decision.authorization).catch((e: Error) => `throws ${e.name}`));
      else attempts.push(await s.classifyAmbiguousCommit(pool, p).catch((e: Error) => `throws ${e.name}`));
    }
  }
  return {
    callerCommit,
    dbRowCommitted: await rowExists(p.idHash),
    readBacks: attempts.map((a) => (released(a) ? 'RELEASED raw sid' : typeof a === 'string' ? a : a === null ? 'null' : `no sid (${Object.keys(a as object).sort().join(',')})`)),
    sessionMaterialReleased: attempts.some(released),
  };
}

async function main() {
  const uid = randomUUID();
  await admin.query(`INSERT INTO "User" (id, email, "cityName", latitude, longitude) VALUES ($1, $2, 'Chennai', 13.08, 80.27)`, [uid, `r2-repro-${uid}@example.test`]);
  const pool = dbLib.createSessionPool(url);
  const out: Record<string, unknown> = { api };
  try {
    out.acknowledgedCommit = await scenario(pool, uid, 'pass', 1);
    out.ambiguousCommitThatSucceeded = await scenario(pool, uid, 'drop-after-forward', 3);
    out.ambiguousCommitThatDidNotSucceed = await scenario(pool, uid, 'drop-before-forward', 2);
  } finally {
    await (pool as unknown as Pool).end().catch(() => {});
    await admin.query(`DELETE FROM "User" WHERE id = $1`, [uid]).catch(() => {});
    await admin.end();
  }
  console.log(JSON.stringify(out, null, 2));
}
main().catch((e) => {
  console.error('repro failed', e instanceof Error ? e.message : e);
  process.exit(1);
});
