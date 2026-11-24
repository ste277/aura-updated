/**
 * AURA-MCP-02-I2b-S8 -- database regression tests for the consolidated
 * security remediation, against a REAL disposable Postgres (migration 0052).
 * Synthetic users/clients only.
 *
 *   S3-1 residual  activation committed but its acknowledgement was lost AND
 *                  both inline revocations failed: the instance refuses the
 *                  code at once, and the background retry deletes it once
 *                  the database answers again (then no instance redeems it)
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
import { createHash, randomBytes } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { boundedStatement, MCP_PG_POOL_BOUNDS, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { createBucketHasher, deriveBucketKey } from '../packages/mcp-tools/src/security/preAuthRules';
import { handleRemoteMcpRequest, MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import type { McpAuditEvent } from '../packages/mcp-tools/src/security/audit';
import { Browser, CLIENT, REDIRECT, USER_A, b64, check, redeemCode, sharedKeys, sleep, startCluster, summary } from './mcpOAuthI2bHarness';

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

const isActivation = (t: string, p?: unknown[]) => /^\s*UPDATE/i.test(t) && p?.[0] === 'AuthorizationCode' && t.includes('auraIssuePending');

/**
 * A pg Pool whose activation COMMIT lands but whose acknowledgement is lost,
 * and whose first `revokeFailures` AuthorizationCode DELETEs fail.
 */
function faultPool(real: Pool, f: { ackLost: boolean; revokeFailures: number }) {
  const st = { deletesFailed: 0, deletesOk: 0 };
  return {
    st,
    pool: {
      query: (t: string, p?: unknown[]) => real.query(t, p),
      connect: async () => {
        const c: PoolClient = await real.connect();
        let inActivation = false;
        return {
          query: async (text: string, params?: unknown[]) => {
            if (params?.[0] === 'AuthorizationCode' && /^\s*DELETE/i.test(text)) {
              if (st.deletesFailed < f.revokeFailures) {
                st.deletesFailed += 1;
                throw new Error('injected revoke fault');
              }
              st.deletesOk += 1;
            }
            if (isActivation(text, params)) inActivation = true;
            if (/^\s*COMMIT/i.test(text) && inActivation) {
              inActivation = false;
              const r = await c.query('COMMIT');
              if (f.ackLost) throw new Error('injected lost COMMIT acknowledgement');
              return r;
            }
            return c.query(text, params as unknown[]);
          },
          release: (err?: unknown) => c.release(err as Error | undefined),
        };
      },
    },
  };
}

async function flow(origin: string, resource: string) {
  const b = new Browser(origin, USER_A);
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const seen: string[] = [];
  let res = await b.fetch(`/oauth/authorize?${q}`);
  for (let i = 0; i < 14; i += 1) {
    const body = await res.text();
    seen.push(JSON.stringify([...res.headers]) + body);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) return { status: res.status, verifier, delivered: new URL(loc).searchParams.get('code'), seen };
      res = await b.fetch(loc);
      continue;
    }
    if (res.status === 200 && /name="csrf"/.test(body)) {
      const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
      const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
      res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      continue;
    }
    return { status: res.status, verifier, delivered: null, seen };
  }
  return { status: 0, verifier, delivered: null, seen };
}

function spyCodes(store: OAuthStore) {
  const codes: string[] = [];
  const Base = store.factory;
  class Spy extends (Base as unknown as new (name: string) => { upsert(id: string, payload: unknown, exp: number): Promise<void> }) {
    constructor(private readonly model: string) {
      super(model);
    }
    async upsert(id: string, payload: unknown, exp: number) {
      if (this.model === 'AuthorizationCode') codes.push(id);
      return super.upsert(id, payload, exp);
    }
  }
  return { store: { ...store, factory: Spy as unknown as OAuthStore['factory'] }, codes };
}

async function main() {
  const admin = new Pool({ connectionString: url, max: 4 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const keys = sharedKeys();
  const pools: Pool[] = [];
  const mkPool = (name: string, extra: Record<string, unknown> = {}) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name, ...extra });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  const codeState = async () => {
    const rows = await q(`SELECT ("payload" ? 'auraIssuePending') AS pending FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`);
    return rows.map((r) => (r.pending ? 'pending' : 'active')).join(',') || 'absent';
  };
  const results: Record<string, unknown>[] = [];

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ---------------------------------------------------------- S3-1 residual: hold + background retry
    {
      // Instance 0 and instance 1 have their OWN store objects (own local
      // holds), over the same database -- like two serverless instances.
      const f0 = faultPool(mkPool('aura-s8-i0'), { ackLost: true, revokeFailures: 2 });
      const s0 = createPostgresAdapterStore({ db: f0.pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0, revocationRetryDelaysMs: [600, 600, 600] });
      const spy = spyCodes(s0);
      const s1 = createPostgresAdapterStore({ db: mkPool('aura-s8-i1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const audits: McpAuditEvent[] = [];
      const c = await startCluster(2, { keys, audit: (e) => audits.push(e) }, (i) => ({ adapterStore: i === 0 ? spy.store : s1 }));
      try {
        c.route.pick = () => 0;
        const out = await flow(c.origin, c.resource);
        const code = spy.codes[0];
        const exposed = out.seen.some((x) => x.includes(code));
        const stateAtAnswer = await codeState();
        const sameInstance = await redeemCode(c, code, out.verifier);
        const row: Record<string, unknown> = { case: 'S3-1 ack lost + both inline revocations fail', status: out.status, exposed, stateAtAnswer, held: s0.pendingRevocations?.(), redeemSameInstanceDuringHold: sameInstance.status, audits: audits.map((a) => a.errorCode).filter((e) => /Code/.test(String(e))) };
        check('S3-1 residual: 503, code not exposed, CodeRevocationFailed audited (no value)', out.status === 503 && !exposed && (row.audits as string[]).includes('CodeRevocationFailed'), row);
        check('S3-1 residual: the committed activation left the code ACTIVE in the database (the ambiguity is real)', stateAtAnswer === 'active', row);
        check('S3-1 residual: the instance that failed to revoke refuses the code immediately (400, no token)', sameInstance.status === 400 && !sameInstance.json.access_token && row.held === 1, row);
        await sleep(1500);
        const afterRetry = await codeState();
        c.route.pick = () => 1;
        const other = await redeemCode(c, code, out.verifier);
        Object.assign(row, { stateAfterBackgroundRetry: afterRetry, retryDeletes: f0.st.deletesOk, redeemOtherInstanceAfterRetry: other.status, heldAfter: s0.pendingRevocations?.() });
        results.push(row);
        check('S3-1 residual: the background retry deleted the code once the database answered', afterRetry === 'absent' && f0.st.deletesOk >= 1 && row.heldAfter === 0, row);
        check('S3-1 residual: after the retry no instance redeems it (400 on the other instance)', other.status === 400 && !other.json.access_token, row);
      } finally {
        await c.close();
      }
    }

    // ---------------------------------------------------------- S3-1 residual window, measured (not a pass condition)
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const f0 = faultPool(mkPool('aura-s8-w0'), { ackLost: true, revokeFailures: 1_000 });
      const s0 = createPostgresAdapterStore({ db: f0.pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0, revocationRetryDelaysMs: [] });
      const spy = spyCodes(s0);
      const s1 = createPostgresAdapterStore({ db: mkPool('aura-s8-w1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(2, { keys }, (i) => ({ adapterStore: i === 0 ? spy.store : s1 }));
      try {
        c.route.pick = () => 0;
        const out = await flow(c.origin, c.resource);
        const code = spy.codes[0];
        const same = await redeemCode(c, code, out.verifier);
        c.route.pick = () => 1;
        const other = await redeemCode(c, code, out.verifier);
        const row = { case: 'S3-1 database unreachable for revocation for the whole code lifetime (measured residual)', status: out.status, exposed: out.seen.some((x) => x.includes(code)), redeemSameInstance: same.status, redeemOtherInstanceWithServerKnownCode: other.status };
        results.push(row);
        check('S3-1 residual window: still 503 and never exposed; same instance refuses', out.status === 503 && !row.exposed && same.status === 400, row);
        // Documented, not asserted: another instance can redeem it ONLY with
        // the code value, which never left the server (see the S8 report).
      } finally {
        await c.close();
      }
    }

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
