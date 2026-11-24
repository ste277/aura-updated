/**
 * AURA-MCP-02-I2b-S8 -- database regression tests for the consolidated
 * security remediation, against a REAL disposable Postgres (migration 0052).
 * Synthetic users/clients only.
 *
 *   (S3-1 residual: the S8 instance-local hold and background retry were
 *                  removed in I2b-S10, which closes S3-1 by database state;
 *                  its cross-instance cases are test/mcpOAuthS10Db.test.ts)
 *   S5             a COMMIT answered with the ROLLBACK tag is never a
 *                  success; a COMMIT that does not answer in time is
 *                  reported as a failure (outcome unknown); a lost COMMIT
 *                  acknowledgement is reported as a failure
 *   S3-8           a process frozen inside a limiter transaction no longer
 *                  holds its shard lock until TCP teardown
 *   S3-6 / S3-7    limiter rows hold no client address and name G and N
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import { boundedStatement, MCP_PG_POOL_BOUNDS, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { createBucketHasher, deriveBucketKey } from '../packages/mcp-tools/src/security/preAuthRules';
import { handleRemoteMcpRequest } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { check, sleep, summary } from './mcpOAuthI2bHarness';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (a disposable database with migrations applied)');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) && process.env.CI !== 'true') {
  console.error('refusing to run against a non-loopback database outside CI');
  process.exit(1);
}
process.on('beforeExit', () => {
  console.error('FAIL test ended before its summary');
  process.exit(1);
});

async function main() {
  const admin = new Pool({ connectionString: url, max: 4 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const pools: Pool[] = [];
  const mkPool = (name: string, extra: Record<string, unknown> = {}) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name, ...extra });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  const results: Record<string, unknown>[] = [];

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ---------------------------------------------------------- S5 boundedStatement on a real connection
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const real = mkPool('aura-s8-s5');
      const ins = (id: string) => [`INSERT INTO "McpOAuthPayload" ("model","id","payload") VALUES ('Session', $1, '{}'::jsonb)`, [id]] as const;
      const present = async (id: string) => (await q(`SELECT 1 FROM "McpOAuthPayload" WHERE "model"='Session' AND "id"=$1`, [id])).length === 1;
      const wrap = (mode: 'rollback-tag' | 'slow-commit' | 'ack-lost'): BoundedPool => ({
        connect: async () => {
          const c = await real.connect();
          return {
            query: (async (t: string, p?: unknown[]) => {
              if (t === 'COMMIT') {
                if (mode === 'rollback-tag') return c.query('ROLLBACK');
                if (mode === 'slow-commit') {
                  await sleep(1200);
                  return c.query('COMMIT');
                }
                await c.query('COMMIT');
                throw new Error('injected lost COMMIT acknowledgement');
              }
              return c.query(t, p as unknown[]);
            }) as never,
            release: (err?: unknown) => c.release(err as Error | undefined),
          };
        },
      });
      const o = { deadlineMs: 2000, statementTimeoutMs: 1000, lockTimeoutMs: 500, commitDeadlineMs: 300 };
      const [t1, p1] = ins('s8-rollback-tag');
      const e1 = await boundedStatement(wrap('rollback-tag'), t1, [...p1], o).then(() => null, (e) => e);
      check('S5 COMMIT answered ROLLBACK: reported as failure, nothing written', e1 instanceof StoreUnavailableError && !(await present('s8-rollback-tag')));
      const [t2, p2] = ins('s8-slow-commit');
      const t0 = Date.now();
      const e2 = await boundedStatement(wrap('slow-commit'), t2, [...p2], o).then(() => null, (e) => e);
      const ms = Date.now() - t0;
      await sleep(1500);
      const landed = await present('s8-slow-commit');
      results.push({ case: 'S5 COMMIT slower than its deadline', answeredMs: ms, error: e2?.name, reason: e2?.reason, rowLandedLater: landed });
      check('S5 COMMIT slower than commitDeadlineMs: answered as failure (timeout) within ~0.3 s, never success', e2 instanceof StoreUnavailableError && e2.reason === 'timeout' && ms < 800, { ms });
      check('S5 ...and the connection was destroyed before the delayed COMMIT was sent, so nothing landed', !landed);
      const [t3, p3] = ins('s8-ack-lost');
      const e3 = await boundedStatement(wrap('ack-lost'), t3, [...p3], o).then(() => null, (e) => e);
      const landed3 = await present('s8-ack-lost');
      results.push({ case: 'S5 lost COMMIT acknowledgement', error: e3?.name, rowLanded: landed3 });
      check('S5 lost COMMIT acknowledgement: reported as failure even though the row landed (unverified outcome is never a success)', e3 instanceof StoreUnavailableError && landed3);
    }

    // ---------------------------------------------------------- S5 limiter: unconfirmed COMMIT is a deny
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const real = mkPool('aura-s8-lim-tag');
      const wrapped = {
        query: (t: string, p?: unknown[]) => real.query(t, p),
        connect: async () => {
          const c = await real.connect();
          return { query: (t: string, p?: unknown[]) => (t === 'COMMIT' ? c.query('ROLLBACK') : c.query(t, p as unknown[])), release: (e?: unknown) => c.release(e as Error | undefined) };
        },
      };
      const lim = createPostgresRateLimiter({ pool: wrapped as never, windowMs: 60_000 });
      const d = await lim.check([{ key: 'user:s8-tag', limit: 5 }]);
      const n = (await q(`SELECT "count" FROM "McpRateLimitWindow" WHERE "key"='user:s8-tag'`))[0]?.count ?? 0;
      check('S5 limiter: a COMMIT answered ROLLBACK is a deny "unavailable", never an admit', !d.allowed && d.limitedBy === 'unavailable' && Number(n) === 0, { d, n });
    }

    // ---------------------------------------------------------- S3-8 frozen limiter transaction
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const key = 'preauth-mcp:global:g6000n16:7';
      const fresh = createPostgresRateLimiter({ pool: mkPool('aura-s8-warm'), windowMs: 60_000 });
      await fresh.check([{ key, limit: 1000 }]); // create the row
      // A process that froze inside a decision: BEGIN with the limiter's
      // transaction-local timeouts, lock the shard row, then never continue.
      const frozenPool = mkPool('aura-s8-frozen', { query_timeout: 0 });
      const frozen = await frozenPool.connect();
      frozen.on('error', () => undefined);
      await frozen.query(`BEGIN; SET LOCAL lock_timeout = '1000ms'; SET LOCAL statement_timeout = '1000ms'; SET LOCAL idle_in_transaction_session_timeout = '300ms'`);
      await frozen.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = $1 FOR UPDATE`, [key]);
      const t0 = Date.now();
      const other = createPostgresRateLimiter({ pool: mkPool('aura-s8-other'), windowMs: 60_000 });
      const d = await other.check([{ key, limit: 1000 }]);
      const ms = Date.now() - t0;
      await sleep(200);
      const idle = await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aura-s8-frozen' AND state LIKE 'idle in transaction%'`);
      results.push({ case: 'S3-8 frozen process holding a shard lock', otherDecision: d.allowed ? 'admitted' : d.limitedBy, otherDecisionMs: ms, frozenSessionsLeft: idle[0].n });
      check('S3-8 the server ended the frozen session (idle_in_transaction_session_timeout) and released the shard lock', idle[0].n === 0, idle);
      check('S3-8 the next decision on that shard is admitted (not a 503 after lock_timeout)', d.allowed === true && ms < 1000, { d, ms });
      frozen.release(new Error('done'));
      const reals = await q(`SELECT setting FROM pg_settings WHERE name = 'idle_in_transaction_session_timeout'`);
      check('S3-8 set only transaction-locally (the server default is untouched)', reals[0].setting === '0', reals);
    }

    // ---------------------------------------------------------- S3-6 / S3-7 stored keys
    {
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const pre = createPostgresRateLimiter({ pool: mkPool('aura-s8-keys'), windowMs: 60_000 });
      const hasher = createBucketHasher(deriveBucketKey(randomBytes(32).toString('base64url')));
      const config = { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:3000' };
      const req = () => new Request(config.resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      for (const addr of ['203.0.113.77', '2001:db8:aa:bb::5']) {
        await handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => null, preAuthRateLimiter: pre, clientAddress: addr, preAuthBucketHasher: hasher });
      }
      const rows = (await q(`SELECT "key" FROM "McpRateLimitWindow" ORDER BY "key"`)).map((r) => String(r.key));
      results.push({ case: 'S3-6/S3-7 stored limiter keys', rows });
      check('S3-6 no client address in any stored limiter key', rows.length >= 3 && rows.every((k) => !k.includes('203.0.113') && !k.includes('2001:db8')), rows);
      check('S3-6 address rows are keyed hashes', rows.filter((k) => k.includes(':addr:')).every((k) => /^preauth-mcp:addr:h:[0-9a-f]{32}$/.test(k)), rows);
      check('S3-7 global rows name G and N', rows.filter((k) => k.includes(':global:')).every((k) => /^preauth-mcp:global:g6000n16:\d+$/.test(k)), rows);
    }

    console.log(JSON.stringify(results, null, 1));
  } finally {
    await Promise.allSettled(pools.map((p) => p.end()));
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end();
  }
  summary('AURA-MCP-02-I2b-S8 DB security');
}

main().catch((e) => {
  console.error('FAIL unexpected error', e instanceof Error ? e.message : e);
  process.exit(1);
});
