/**
 * AURA-MCP-02-I2b-S4 -- regression tests for the S3 review findings, against
 * a REAL disposable Postgres (migration 0052). Synthetic users/clients only.
 *
 *   S3-1  A store failure after the authorization code is written must not
 *         disclose the code (headers or body) and must not leave it
 *         redeemable; no token is issued. Every store statement after the
 *         code write is failed in turn (reject and hang), plus activation.
 *   S3-2  A store write that misses its deadline while blocked on a lock
 *         fails closed and can NEVER land later: hold a lock, start a
 *         Session update, let it miss the deadline, release the lock, write
 *         a newer Session, and check the old write did not overwrite it.
 *         Server-side waits end; the pool recovers.
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { createHash, randomBytes } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { isStoreUnavailableError, MCP_PG_POOL_BOUNDS } from '../packages/mcp-tools/src/security/deadline';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
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

type Fault = 'reject' | 'hang';
/** A pg Pool whose checked-out clients fail the Nth store statement issued after the code INSERT. */
function faultPool(real: Pool) {
  const state = { codeWritten: false, after: 0, failAt: -1, mode: 'reject' as Fault, fired: '' as string, armed: false };
  const isStatement = (t: string) => !/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(t);
  const pool = {
    query: (t: string, p?: unknown[]) => real.query(t, p),
    connect: async () => {
      const c: PoolClient = await real.connect();
      return {
        query: (text: string, params?: unknown[]) => {
          if (state.armed && isStatement(text)) {
            const model = String(params?.[0] ?? '');
            if (state.codeWritten) {
              state.after += 1;
              if (state.after === state.failAt) {
                state.fired = `${text.trim().split(/\s+/)[0]} ${model}`;
                return state.mode === 'hang' ? new Promise(() => undefined) : Promise.reject(new Error('injected store fault'));
              }
            }
            if (/^\s*INSERT/i.test(text) && model === 'AuthorizationCode') state.codeWritten = true;
          }
          return c.query(text, params as unknown[]);
        },
        release: (err?: unknown) => c.release(err as Error | undefined),
      };
    },
  };
  return { pool, state };
}

/** Records plaintext authorization codes as the provider writes them (test-only spy). */
function spyCodes(store: OAuthStore) {
  const codes: string[] = [];
  const Base = store.factory;
  class Spy extends (Base as unknown as new (name: string) => { upsert(id: string, payload: unknown, exp: number): Promise<void> }) {
    private readonly model: string;
    constructor(name: string) {
      super(name);
      this.model = name;
    }
    async upsert(id: string, payload: unknown, exp: number) {
      if (this.model === 'AuthorizationCode') codes.push(id);
      return super.upsert(id, payload, exp);
    }
  }
  return { store: { ...store, factory: Spy as unknown as OAuthStore['factory'] }, codes };
}

/** Drives the browser flow; returns every response seen after consent and the final one. */
async function flow(origin: string, resource: string) {
  const b = new Browser(origin, USER_A);
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const seen: { status: number; headers: string; body: string }[] = [];
  let res = await b.fetch(`/oauth/authorize?${q}`);
  for (let i = 0; i < 14; i += 1) {
    const body = await res.text();
    seen.push({ status: res.status, headers: JSON.stringify([...res.headers]), body });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) return { seen, verifier, delivered: new URL(loc).searchParams.get('code') };
      res = await b.fetch(loc);
      continue;
    }
    if (res.status === 200 && /name="csrf"/.test(body)) {
      const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
      const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
      res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      continue;
    }
    return { seen, verifier, delivered: null as string | null };
  }
  return { seen, verifier, delivered: null as string | null };
}

async function main() {
  const admin = new Pool({ connectionString: url, max: 3 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const keys = sharedKeys();
  const pools: Pool[] = [];
  const mkPool = (name: string) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ------------------------------------------------------------ S3-1: control (no fault)
    {
      const real = mkPool('aura-s4-control');
      const { store, codes } = spyCodes(createPostgresAdapterStore({ db: real, fieldKeys: keys.cookieKeys, cleanupEvery: 0 }));
      const c = await startCluster(1, { keys }, () => ({ adapterStore: store }));
      try {
        const out = await flow(c.origin, c.resource);
        const tok = out.delivered ? await redeemCode(c, out.delivered, out.verifier) : undefined;
        check('S3-1 control: without a fault the code is delivered, activated and redeemable (200 + token)', !!out.delivered && out.delivered === codes[0] && tok?.status === 200 && !!tok.json.access_token);
        check('S3-1 control: a delivered code is stored activated (no pending marker left)', Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode' AND "payload" ? 'auraIssuePending'`))[0].n) === 0);
      } finally {
        await c.close();
      }
    }

    // ------------------------------------------------------------ S3-1: fail every store statement after the code write, in turn
    {
      const results: { failAt: number; mode: Fault; fired: string; ok: boolean; why: string }[] = [];
      for (const mode of ['reject', 'hang'] as Fault[]) {
        for (let failAt = 1; failAt <= 12; failAt += 1) {
          await admin.query('TRUNCATE "McpOAuthPayload"');
          const real = mkPool(`aura-s4-fault-${mode}-${failAt}`);
          const { pool, state } = faultPool(real);
          const { store, codes } = spyCodes(createPostgresAdapterStore({ db: pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0, queryDeadlineMs: 600 }));
          const audits: McpAuditEvent[] = [];
          const c = await startCluster(1, { keys, audit: (e) => audits.push(e) }, () => ({ adapterStore: store }));
          try {
            state.failAt = failAt;
            state.mode = mode;
            state.armed = true;
            const out = await flow(c.origin, c.resource);
            state.armed = false;
            if (!state.fired) break; // the flow had fewer statements after the code write: done
            const code = codes[0];
            const disclosed = !!code && out.seen.some((r) => r.headers.includes(code) || r.body.includes(code));
            const tok = code ? await redeemCode(c, code, out.verifier) : undefined;
            const live = Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode' AND NOT ("payload" ? 'auraIssuePending')`))[0].n);
            const tokens = Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" IN ('AccessToken','RefreshToken')`))[0].n);
            const last = out.seen[out.seen.length - 1];
            // Either the fault hit after delivery+activation (then the flow legitimately succeeded),
            // or nothing usable may have left the server.
            const succeeded = !!out.delivered && last.status < 400;
            const ok = succeeded
              ? tok?.status === 200 && live === 1
              : !disclosed && !out.delivered && last.status >= 400 && !last.headers.includes('"location"') && tok?.status === 400 && !tok.json.access_token && live === 0 && tokens === 0;
            results.push({ failAt, mode, fired: state.fired, ok, why: JSON.stringify({ status: last.status, disclosed, redeem: tok?.status, live, tokens, succeeded }) });
          } finally {
            await c.close();
          }
        }
      }
      const failed = results.filter((r) => !r.ok);
      check(`S3-1 fault sweep: ${results.length} runs (each store statement after the code write failed in turn, reject and hang) -- no code disclosed, none redeemable, no token`, results.length >= 6 && failed.length === 0, failed.slice(0, 4));
      console.log(`     (sweep: ${results.map((r) => `${r.mode}:${r.fired}`).join(', ')})`);
      check('S3-1 fault sweep covered the Session write after the code (the reviewed exploit) and the activation', results.some((r) => /Session/.test(r.fired)) && results.some((r) => /^UPDATE AuthorizationCode/.test(r.fired)), results.map((r) => r.fired));
    }

    // ------------------------------------------------------------ S3-2: late write cannot overwrite a newer session
    for (const variant of [
      { name: 'server lock_timeout below the deadline (defaults)', opts: {}, failWithinMs: 1600 },
      { name: 'server timeouts LARGER than the deadline (no commit after a reported failure)', opts: { queryDeadlineMs: 800, statementTimeoutMs: 20_000, lockTimeoutMs: 20_000 }, failWithinMs: 1200 },
    ]) {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const app = `aura-s4-late-${variant.opts.queryDeadlineMs ?? 'default'}`;
      const storePool = mkPool(app);
      const store = createPostgresAdapterStore({ db: storePool, fieldKeys: keys.cookieKeys, cleanupEvery: 0, ...variant.opts });
      const Session = new store.factory('Session');
      await Session.upsert('synthetic-sess-1', { accountId: 'synthetic-v1', uid: 'synthetic-uid-s4' } as never, 600);
      // 1. hold the row lock
      const holder = await admin.connect();
      await holder.query('BEGIN');
      await holder.query(`SELECT 1 FROM "McpOAuthPayload" WHERE "model" = 'Session' FOR UPDATE`);
      // 2-4. a session update misses its deadline and fails closed
      const t0 = Date.now();
      const old = await Session.upsert('synthetic-sess-1', { accountId: 'synthetic-OLD', uid: 'synthetic-uid-s4' } as never, 600).then(() => 'stored', (e) => e);
      const ms = Date.now() - t0;
      check(`S3-2 [${variant.name}]: the blocked update fails closed (StoreUnavailableError -> 503) within ${variant.failWithinMs} ms`, isStoreUnavailableError(old) && ms <= variant.failWithinMs, [String(old), ms]);
      // 5. release the lock; a newer session write follows
      await holder.query('ROLLBACK');
      holder.release();
      await Session.upsert('synthetic-sess-1', { accountId: 'synthetic-NEW', uid: 'synthetic-uid-s4' } as never, 600);
      await sleep(2500);
      // 6. the old write never lands
      const now = (await Session.find('synthetic-sess-1')) as { accountId?: string } | undefined;
      check(`S3-2 [${variant.name}]: after the lock is released the old write never overwrites the newer session`, now?.accountId === 'synthetic-NEW', now?.accountId);
      const lingering = Number((await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = $1 AND (state LIKE 'idle in transaction%' OR wait_event_type = 'Lock' OR state = 'active')`, [app]))[0].n);
      check(`S3-2 [${variant.name}]: no store backend still running, waiting or idle in a transaction`, lingering === 0, lingering);
      // 7. the pool recovers
      const again = await Session.find('synthetic-sess-1').then((v) => !!v, () => false);
      check(`S3-2 [${variant.name}]: the pool recovers (next read and write succeed)`, again && (await Session.upsert('synthetic-sess-2', { accountId: 'synthetic-v1' } as never, 600).then(() => true, () => false)));
    }

    // ------------------------------------------------------------ S3-2: server-side bounds are really set on store statements
    {
      const p = mkPool('aura-s4-settings');
      const store = createPostgresAdapterStore({ db: p, fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const holder = await admin.connect();
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE "McpOAuthPayload" IN ACCESS EXCLUSIVE MODE');
      const Code = new store.factory('AuthorizationCode');
      const t0 = Date.now();
      const r = await Code.find('synthetic-code').then(() => 'answered', (e) => e);
      const ms = Date.now() - t0;
      await sleep(300);
      const waiting = Number((await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aura-s4-settings' AND wait_event_type = 'Lock'`))[0].n);
      await holder.query('ROLLBACK');
      holder.release();
      check('S3-2: a read blocked by a table lock is ended by the server (lock_timeout 1 s), not just abandoned by the client', isStoreUnavailableError(r) && ms < 2000 && waiting === 0, [ms, waiting]);
    }

    for (const p of pools) await p.end().catch(() => undefined);
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S4 OAuth store DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
