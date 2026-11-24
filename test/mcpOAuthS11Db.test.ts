/**
 * AURA-MCP-02-I2b-S11 -- real-PostgreSQL regressions for the S10 independent
 * review findings, against a DISPOSABLE database (migration 0052).
 * Synthetic users/clients only.
 *
 *   P2-1  checked-out client errors: the APPLICATION connection path (a real
 *         `pg` Pool with MCP_PG_POOL_BOUNDS, exactly as apps/web wires it --
 *         NO test-installed client listeners) survives a server-side
 *         termination of a held activation, an idle-in-transaction timeout, a
 *         backend killed mid-statement and a limiter decision whose backend
 *         dies: no unhandled 'error' event, the connection is discarded, the
 *         code stays pending, the pool recovers, and no listener leaks.
 *   P3-3  (A6, deterministic) a held activation whose COMMIT never arrives:
 *         DURING the hold every redemption is refused, the row is pending and
 *         no token exists; AFTER the rollback is OBSERVED (backend gone) the
 *         refusal is a deterministic 400 and the backend recovers.
 *
 * `process.on('uncaughtException')` is only a COUNTER here (an unhandled
 * EventEmitter 'error' becomes an uncaught exception); it is not a client
 * listener and masks nothing: the assertions require the count to be 0.
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { createHash, randomBytes } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { boundedStatement, heldStatement, MCP_PG_POOL_BOUNDS, StoreUnavailableError, type BoundedPool } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
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

let uncaught = 0;
const uncaughtMessages: string[] = [];
process.on('uncaughtException', (e) => {
  uncaught += 1;
  uncaughtMessages.push(String((e as Error)?.message ?? e).slice(0, 120));
});

async function main() {
  const admin = new Pool({ connectionString: url, max: 3 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const keys = sharedKeys();
  const pools: Pool[] = [];
  /** The application's pool shape (apps/web/lib/mcpLocalOAuth.ts): bounds + a pool-level idle-error listener only. */
  const appPool = (name: string) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  const backendOf = async (app: string, state = 'idle in transaction') => {
    const r = await q(`SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND state LIKE $2 || '%'`, [app, state]);
    return r.map((x) => x.pid as number);
  };
  const waitFor = async (pred: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return true;
      await sleep(25);
    }
    return pred();
  };
  const codeState = async () => {
    const rows = await q(`SELECT ("payload" ? 'auraIssuePending') AS pending FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`);
    return rows.map((r) => (r.pending ? 'pending' : 'active')).join(',') || 'absent';
  };
  const tokenCount = async () => Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" IN ('AccessToken','RefreshToken')`))[0].n);
  const results: Record<string, unknown>[] = [];

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ------------------------------------------------------------ P2-1 a: held activation, backend terminated
    {
      const app = 'aura-s11-held-kill';
      const pool = appPool(app);
      const store = createPostgresAdapterStore({ db: pool, fieldKeys: keys.cookieKeys, cleanupEvery: 0, activationHoldMs: 5000 });
      const Code = new store.factory('AuthorizationCode');
      await Code.upsert('s11-code-a', { accountId: USER_A, clientId: CLIENT, jti: 's11-code-a' }, 60);
      const before = uncaught;
      const act = await store.beginIssuedActivation?.('AuthorizationCode', 's11-code-a');
      const pids = await backendOf(app);
      await admin.query('SELECT pg_terminate_backend(pid) FROM unnest($1::int[]) AS pid', [pids]);
      await sleep(300);
      const outcome = await act?.commit();
      const state = await codeState();
      const found = await new store.factory('AuthorizationCode').find('s11-code-a');
      const recovered = await store.size('AuthorizationCode');
      const row = { case: 'P2-1a held activation, backend terminated', heldBackends: pids.length, uncaughtDuringTest: uncaught - before, commitOutcome: outcome, state, findable: !!found, poolRecoveredQuery: recovered };
      results.push(row);
      check('P2-1a a terminated held activation raises NO unhandled client error (process survives)', pids.length === 1 && uncaught === before, row);
      check('P2-1a the activation is not committed (outcome not "committed"), the code stays PENDING and is not findable', outcome !== 'committed' && state === 'pending' && !found, row);
      check('P2-1a the same pool recovers: the next store call succeeds on a fresh connection', recovered === 1, row);
    }

    // ------------------------------------------------------------ P2-1 b: idle-in-transaction timeout on a held transaction
    {
      const app = 'aura-s11-held-idle';
      const pool = appPool(app);
      const before = uncaught;
      const held = await heldStatement(pool as unknown as BoundedPool, 'SELECT 1', [], { deadlineMs: 2000, statementTimeoutMs: 1000, lockTimeoutMs: 500, idleInTransactionTimeoutMs: 200, holdMs: 5000 });
      await waitFor(async () => (await backendOf(app)).length === 0, 3000);
      await sleep(200);
      const outcome = await held.commit(500);
      const next = await boundedStatement(pool as unknown as BoundedPool, 'SELECT 1 AS ok', [], { deadlineMs: 2000, statementTimeoutMs: 1000, lockTimeoutMs: 500 }).then((r) => r.rowCount, (e) => e);
      const row = { case: 'P2-1b idle-in-transaction timeout ends a held transaction', uncaughtDuringTest: uncaught - before, commitOutcome: outcome, nextCall: next };
      results.push(row);
      check('P2-1b the server-side idle-in-transaction termination raises NO unhandled client error', uncaught === before, row);
      check('P2-1b the terminated hold is never reported committed; the pool serves the next call', outcome !== 'committed' && next === 1, row);
    }

    // ------------------------------------------------------------ P2-1 c: backend killed mid-statement (boundedStatement)
    {
      const app = 'aura-s11-stmt-kill';
      const pool = appPool(app);
      const before = uncaught;
      const work = boundedStatement(pool as unknown as BoundedPool, 'SELECT pg_sleep(2)', [], { deadlineMs: 3000, statementTimeoutMs: 2500, lockTimeoutMs: 500 }).then(() => null, (e) => e);
      await waitFor(async () => (await backendOf(app, 'active')).length === 1, 1000);
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, [app]);
      const err = await work;
      await sleep(200);
      const next = await boundedStatement(pool as unknown as BoundedPool, 'SELECT 1', [], { deadlineMs: 2000, statementTimeoutMs: 1000, lockTimeoutMs: 500 }).then((r) => r.rowCount, (e) => e);
      const row = { case: 'P2-1c backend killed mid-statement', uncaughtDuringTest: uncaught - before, error: err instanceof StoreUnavailableError ? err.reason : String(err), nextCall: next };
      results.push(row);
      check('P2-1c a backend killed mid-statement fails as StoreUnavailableError with NO unhandled client error; the pool recovers', err instanceof StoreUnavailableError && uncaught === before && next === 1, row);
    }

    // ------------------------------------------------------------ P2-1 d: limiter decision whose backend dies
    {
      const app = 'aura-s11-limiter-kill';
      const pool = appPool(app);
      const limiter = createPostgresRateLimiter({ pool, windowMs: 60_000, decisionDeadlineMs: 3000, lockTimeoutMs: 2500, statementTimeoutMs: 2800 });
      await limiter.check([{ key: 'user:s11-kill', limit: 100 }]); // creates the row
      const holder: PoolClient = await admin.connect();
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = 'user:s11-kill' FOR UPDATE`);
      const before = uncaught;
      const decision = limiter.check([{ key: 'user:s11-kill', limit: 100 }]);
      await waitFor(async () => (await backendOf(app, 'active')).length === 1, 1500);
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'`, [app]);
      const d = await decision;
      await holder.query('ROLLBACK');
      holder.release();
      await sleep(200);
      const next = await limiter.check([{ key: 'user:s11-kill', limit: 100 }]);
      const row = { case: 'P2-1d limiter decision, backend terminated', uncaughtDuringTest: uncaught - before, decision: d, next };
      results.push(row);
      check('P2-1d a limiter decision whose backend dies is denied (unavailable) with NO unhandled client error; the next decision admits', !d.allowed && d.limitedBy === 'unavailable' && uncaught === before && next.allowed, row);
    }

    // ------------------------------------------------------------ P2-1 e: no listener leak on the application path
    {
      const app = 'aura-s11-leak';
      const pool = appPool(app);
      const store = createPostgresAdapterStore({ db: pool, fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const limiter = createPostgresRateLimiter({ pool, windowMs: 60_000 });
      for (let i = 0; i < 60; i += 1) {
        await store.size();
        await limiter.check([{ key: `user:s11-leak-${i % 3}`, limit: 1000 }]);
        const a = await store.beginIssuedActivation?.('AuthorizationCode', `s11-none-${i}`); // no row: aborted at once
        a?.abort();
      }
      const c = await pool.connect();
      const listeners = c.listenerCount('error');
      c.release();
      const row = { case: 'P2-1e listener hygiene after 180 checkouts', errorListenersOnACheckedOutClient: listeners, poolTotal: pool.totalCount };
      results.push(row);
      check('P2-1e no error-listener leak: a client checked out after 180 store / limiter / activation checkouts carries none of ours', listeners === 0, row);
    }

    // ------------------------------------------------------------ P3-3 (A6) deterministic freeze
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const app0 = 'aura-s11-a6-i0';
      const real = appPool(app0);
      // A frozen process: the activation COMMIT is never sent and the connection is never closed.
      const frozen: PoolClient[] = [];
      const pool0 = {
        query: (t: string, p?: unknown[]) => real.query(t, p),
        connect: async () => {
          const c = await real.connect();
          let inActivation = false;
          let isFrozen = false;
          return {
            on: c.on.bind(c),
            off: c.off.bind(c),
            query: async (t: string, p?: unknown[]) => {
              if (/^\s*UPDATE/i.test(t) && p?.[0] === 'AuthorizationCode' && t.includes(`"payload" = "payload" - 'auraIssuePending'`)) inActivation = true;
              if (/^\s*COMMIT/i.test(t) && inActivation) {
                isFrozen = true;
                frozen.push(c);
                return new Promise(() => undefined);
              }
              return c.query(t, p as unknown[]);
            },
            release: (err?: unknown) => {
              if (!isFrozen) c.release(err as Error | undefined);
            },
          };
        },
      };
      const s0 = createPostgresAdapterStore({ db: pool0 as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0, activationHoldMs: 1500, activationCommitMs: 300 });
      const codes: string[] = [];
      const Base = s0.factory;
      class Spy extends (Base as unknown as new (n: string) => { upsert(id: string, p: unknown, e: number): Promise<void> }) {
        constructor(private readonly m: string) {
          super(m);
        }
        async upsert(id: string, p: unknown, e: number) {
          if (this.m === 'AuthorizationCode') codes.push(id);
          return super.upsert(id, p, e);
        }
      }
      const s1 = createPostgresAdapterStore({ db: appPool('aura-s11-a6-i1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(2, { keys }, (i) => ({ adapterStore: i === 0 ? { ...s0, factory: Spy as never } : s1 }));
      const before = uncaught;
      try {
        c.route.pick = () => 0;
        const b = new Browser(c.origin, USER_A);
        const verifier = b64(randomBytes(32));
        const qs = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's' });
        let res = await b.fetch(`/oauth/authorize?${qs}`);
        let delivered: string | null = null;
        for (let i = 0; i < 14 && !delivered; i += 1) {
          const body = await res.text();
          const loc = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && loc) {
            if (loc.startsWith(REDIRECT)) delivered = new URL(loc).searchParams.get('code');
            else res = await b.fetch(loc);
            continue;
          }
          const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
          const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
          res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
        }
        const code = codes[0];
        // DURING the hold: the backend is still idle in transaction.
        const heldNow = (await backendOf(app0)).length;
        c.route.pick = () => 1;
        const during = await redeemCode(c, code, verifier);
        const duringState = await codeState();
        const duringTokens = await tokenCount();
        // AFTER: wait until the rollback is OBSERVED (the frozen backend is gone), then redeem.
        const rolledBack = await waitFor(async () => (await backendOf(app0)).length === 0, 6000);
        const after = await redeemCode(c, code, verifier);
        const afterState = await codeState();
        // Backend recovery: a fresh flow on the healthy instance issues and redeems.
        const row = {
          case: 'P3-3 A6 deterministic freeze',
          delivered: !!delivered,
          heldBackendDuringCheck: heldNow,
          duringStatus: during.status,
          duringState,
          duringTokens,
          rollbackObserved: rolledBack,
          afterStatus: after.status,
          afterState,
          uncaughtDuringTest: uncaught - before,
        };
        results.push(row);
        check('A6 DURING the hold (backend still idle in transaction): redemption is refused, no token, the code is PENDING', heldNow === 1 && during.status !== 200 && !during.json.access_token && duringTokens === 0 && duringState === 'pending', row);
        check('A6 the rollback is OBSERVED (frozen backend ended by the server)', rolledBack, row);
        check('A6 AFTER the observed rollback: deterministic 400, still PENDING, still no token', after.status === 400 && afterState === 'pending' && !after.json.access_token && (await tokenCount()) === 0, row);
        check('A6 no unhandled client error from the frozen connection (application listener, none from the test)', uncaught === before, row);
      } finally {
        await c.close();
        for (const f of frozen) {
          try {
            f.release(new Error('test cleanup'));
          } catch {
            // ended by the server
          }
        }
      }
      // Recovery on the same database: a normal flow on fresh pools issues and redeems.
      const s2 = createPostgresAdapterStore({ db: appPool('aura-s11-a6-recover'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c2 = await startCluster(1, { keys }, () => ({ adapterStore: s2 }));
      try {
        const b2 = new Browser(c2.origin, USER_A);
        const v2 = b64(randomBytes(32));
        const qs2 = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c2.resource, code_challenge: b64(createHash('sha256').update(v2).digest()), code_challenge_method: 'S256', state: 's' });
        let r2 = await b2.fetch(`/oauth/authorize?${qs2}`);
        let code2: string | null = null;
        for (let i = 0; i < 14 && !code2; i += 1) {
          const body = await r2.text();
          const loc = r2.headers.get('location');
          if (r2.status >= 300 && r2.status < 400 && loc) {
            if (loc.startsWith(REDIRECT)) code2 = new URL(loc).searchParams.get('code');
            else r2 = await b2.fetch(loc);
            continue;
          }
          const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
          const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
          r2 = await b2.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c2.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
        }
        await sleep(200);
        const tok = await redeemCode(c2, code2 as string, v2);
        check('A6 backend recovery: after the freeze, a normal flow issues and redeems (200 + token)', tok.status === 200 && !!tok.json.access_token, tok.status);
      } finally {
        await c2.close();
      }
    }

    // ------------------------------------------------------------ P2-2 response issuance integrity
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const codes: string[] = [];
      const s0raw = createPostgresAdapterStore({ db: appPool('aura-s11-p22-i0'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const Base = s0raw.factory;
      class Spy extends (Base as unknown as new (n: string) => { upsert(id: string, p: unknown, e: number): Promise<void> }) {
        constructor(private readonly m: string) {
          super(m);
        }
        async upsert(id: string, p: unknown, e: number) {
          if (this.m === 'AuthorizationCode') codes.push(id);
          return super.upsert(id, p, e);
        }
      }
      const s1 = createPostgresAdapterStore({ db: appPool('aura-s11-p22-i1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(2, { keys }, (i) => ({ adapterStore: i === 0 ? { ...s0raw, factory: Spy as never } : s1 }));
      const run = async (extra: Record<string, string>) => {
        c.route.pick = () => 0;
        const b = new Browser(c.origin, USER_A);
        const verifier = b64(randomBytes(32));
        const qs = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's', ...extra });
        const seen: string[] = [];
        let status = 0;
        let delivered: string | null = null;
        try {
          let res = await b.fetch(`/oauth/authorize?${qs}`);
          for (let i = 0; i < 14; i += 1) {
            const body = await res.text();
            seen.push(JSON.stringify([...res.headers]) + body);
            status = res.status;
            const loc = res.headers.get('location');
            if (res.status >= 300 && res.status < 400 && loc) {
              if (loc.startsWith(REDIRECT)) {
                delivered = new URL(loc).searchParams.get('code');
                break;
              }
              res = await b.fetch(loc);
              continue;
            }
            const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1];
            const action = /action="([^"]+\/confirm)"/.exec(body)?.[1];
            if (!csrf || !action) break;
            res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
          }
        } catch {
          status = -1;
        }
        await sleep(250);
        return { status, delivered, seen, verifier };
      };
      try {
        for (const mode of ['form_post', 'fragment']) {
          codes.length = 0;
          await admin.query('TRUNCATE "McpOAuthPayload"');
          const out = await run({ response_mode: mode });
          const rows = Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`))[0].n);
          const refusedWith = out.seen.some((x) => /invalid_request/.test(x)) ? 'invalid_request' : null;
          const row = { case: `P2-2 response_mode=${mode}`, status: out.status, refusedWith, codesCreated: codes.length, codeRows: rows, delivered: !!out.delivered, bodyCarriedCode: out.seen.some((x) => /name="code"/.test(x)) };
          results.push(row);
          // The provider refuses with invalid_request -- as a 400 page, or (RFC 6749 s4.1.2.1) as an error redirect to the registered callback.
          check(`P2-2 response_mode=${mode} is refused (invalid_request) before any code exists: no code created, none sent, no form-carried code`, refusedWith === 'invalid_request' && codes.length === 0 && rows === 0 && !out.delivered && !row.bodyCarriedCode, row);
        }
        {
          codes.length = 0;
          await admin.query('TRUNCATE "McpOAuthPayload"');
          const out = await run({ response_mode: 'query' });
          c.route.pick = () => 1;
          const tok = await redeemCode(c, out.delivered as string, out.verifier);
          check('P2-2 explicit response_mode=query issues normally (delivered, redeemed on the other instance)', !!out.delivered && tok.status === 200 && !!tok.json.access_token, { status: out.status, redeem: tok.status });
        }
        {
          codes.length = 0;
          await admin.query('TRUNCATE "McpOAuthPayload"');
          // Same-status replacement: the 303 is kept, but the Location no longer carries the code.
          c.route.onRequest = (_req, res) => {
            const end = res.end.bind(res) as (...a: unknown[]) => unknown;
            (res as unknown as { end: (...a: unknown[]) => unknown }).end = (...args: unknown[]) => {
              const loc = String(res.getHeader('location') ?? '');
              if (loc.startsWith(REDIRECT) && loc.includes('code=')) {
                const replaced = `${REDIRECT}?error=replaced&state=s`;
                res.setHeader('location', replaced);
                // Koa's redirect body repeats the URL; replace it too, so the code leaves nowhere.
                if (typeof args[0] === 'string' || Buffer.isBuffer(args[0])) {
                  args[0] = `Redirecting to ${replaced}.`;
                  res.setHeader('content-length', Buffer.byteLength(args[0] as string));
                }
              }
              return end(...args);
            };
          };
          const out = await run({});
          c.route.onRequest = undefined;
          const code = codes[0];
          const state = await codeState();
          c.route.pick = () => 1;
          const red = code ? await redeemCode(c, code, out.verifier) : { status: 0, json: {} as Record<string, unknown> };
          const row = { case: 'P2-2 same-status replacement (303 kept, Location without the code)', finalStatus: out.status, exposed: !!code && out.seen.some((x) => x.includes(code)), state, redeemOtherInstance: red.status };
          results.push(row);
          check('P2-2 a same-status replacement that drops the code from Location is never committed: PENDING, refused on the other instance with the server-known code + verifier', out.status === 303 && !row.exposed && state === 'pending' && red.status === 400 && !red.json.access_token, row);
        }
        {
          const d1 = await (await fetch(`${c.origin}/.well-known/oauth-authorization-server`)).json();
          const d2 = await (await fetch(`${c.origin}/.well-known/openid-configuration`)).json();
          check('P2-2 discovery (RFC 8414 and OIDC) advertises response_modes_supported = ["query"] only', JSON.stringify(d1.response_modes_supported) === '["query"]' && JSON.stringify(d2.response_modes_supported) === '["query"]', [d1.response_modes_supported, d2.response_modes_supported]);
        }
      } finally {
        await c.close();
      }
    }

    check('P2-1 no unhandled exception anywhere in this suite', uncaught === 0, uncaughtMessages);
    console.log('\nS11 results:');
    for (const r of results) console.log(`  ${JSON.stringify(r)}`);
    for (const p of pools) await p.end().catch(() => undefined);
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S11 checked-out client and freeze DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
