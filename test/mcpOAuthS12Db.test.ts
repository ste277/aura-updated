/**
 * AURA-MCP-02-I2b-S12 -- real-PostgreSQL regressions for the S11 independent
 * review residuals (DISPOSABLE database, migration 0052; synthetic data).
 *
 *   R-P2-1  final hand-off must be EXACTLY the validated redirect: any
 *           same-status replacement that moves, duplicates or re-homes the
 *           code, or changes the callback or state, is never committed --
 *           pending, and refused on ANOTHER instance with the server-known
 *           code + verifier. Valid query-mode issuance (incl. a callback with
 *           registered query parameters) redeems once, PKCE S256.
 *   R-P2-2  the APPLICATION audit output (createRedactingAuditSink, the sink
 *           apps/web uses) carries the bounded limiter cause on the OAuth
 *           pre-auth path and BOTH MCP limiter paths -- and nothing raw.
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { createHash, randomBytes } from 'crypto';
import type { ServerResponse } from 'http';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { createRedactingAuditSink } from '../packages/mcp-tools/src/security/audit';
import { MCP_PG_POOL_BOUNDS } from '../packages/mcp-tools/src/security/deadline';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { handleRemoteMcpRequest, MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { Browser, CLIENT, CLIENT_NR, REDIRECT, USER_A, b64, check, redeemCode, sharedKeys, sleep, startCluster, summary, tokenRequest } from './mcpOAuthI2bHarness';

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

function spyCodes(store: OAuthStore) {
  const codes: string[] = [];
  const Base = store.factory;
  class Spy extends (Base as unknown as new (n: string) => { upsert(id: string, p: unknown, e: number): Promise<void> }) {
    constructor(private readonly m: string) {
      super(m);
    }
    async upsert(id: string, p: unknown, e: number) {
      if (this.m === 'AuthorizationCode') codes.push(id);
      return super.upsert(id, p, e);
    }
  }
  return { store: { ...store, factory: Spy as unknown as OAuthStore['factory'] }, codes };
}

async function main() {
  const admin = new Pool({ connectionString: url, max: 3 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const keys = sharedKeys();
  const pools: Pool[] = [];
  const appPool = (name: string) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  const codeState = async () => (await q(`SELECT ("payload" ? 'auraIssuePending') AS pending FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`)).map((r) => (r.pending ? 'pending' : 'active')).join(',') || 'absent';
  const tokenCount = async () => Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" IN ('AccessToken','RefreshToken')`))[0].n);
  const results: Record<string, unknown>[] = [];

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ------------------------------------------------------------ R-P2-1
    {
      const REG_Q = 'http://127.0.0.1:8976/cb-with-query?tenant=synthetic-a';
      const clients = [
        { client_id: CLIENT, redirect_uris: [REDIRECT], label: 'Synthetic client', allow_refresh: true },
        { client_id: CLIENT_NR, redirect_uris: [REG_Q], label: 'Synthetic client with a registered query parameter' },
      ];
      const s0 = spyCodes(createPostgresAdapterStore({ db: appPool('aura-s12-rd-i0'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 }));
      const s1 = createPostgresAdapterStore({ db: appPool('aura-s12-rd-i1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(2, { keys, clients }, (i) => ({ adapterStore: i === 0 ? s0.store : s1 }));
      /** Runs one browser flow on instance 0; `rewrite` may replace the code-carrying Location at the wire. */
      const run = async (rewrite?: (loc: string, code: string) => string, clientId = CLIENT, redirect = REDIRECT) => {
        await admin.query('TRUNCATE "McpOAuthPayload"');
        s0.codes.length = 0;
        c.route.pick = () => 0;
        c.route.onRequest = rewrite
          ? (_req, res: ServerResponse) => {
              const end = res.end.bind(res) as (...a: unknown[]) => unknown;
              (res as unknown as { end: (...a: unknown[]) => unknown }).end = (...args: unknown[]) => {
                const loc = String(res.getHeader('location') ?? '');
                const code = new URL(loc, 'http://x').searchParams.get('code');
                if (loc.startsWith(redirect.split('?')[0]) && code) {
                  const replaced = rewrite(loc, code);
                  res.setHeader('location', replaced);
                  if (typeof args[0] === 'string') {
                    args[0] = `Redirecting to ${replaced}.`;
                    res.setHeader('content-length', Buffer.byteLength(args[0] as string));
                  }
                }
                return end(...args);
              };
            }
          : undefined;
        const b = new Browser(c.origin, USER_A);
        const verifier = b64(randomBytes(32));
        const qs = new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 'st-s12' });
        let res = await b.fetch(`/oauth/authorize?${qs}`);
        let finalLoc = '';
        let status = 0;
        for (let i = 0; i < 14; i += 1) {
          const body = await res.text();
          status = res.status;
          const loc = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && loc) {
            if (!loc.startsWith(c.origin) && !loc.startsWith('/')) {
              finalLoc = loc;
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
        c.route.onRequest = undefined;
        await sleep(250);
        const code = s0.codes[0];
        const state = await codeState();
        c.route.pick = () => 1;
        // Redeem with THIS client's registered callback (the harness helper assumes the default one).
        const red = code ? await tokenRequest(c, { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: redirect }) : { status: 0, json: {} as Record<string, unknown> };
        return { status, finalLoc, code, state, red, tokens: await tokenCount() };
      };
      try {
        const replacements: [string, (loc: string, code: string) => string][] = [
          ['code moved into the PATH', (loc, code) => loc.replace('/callback?', `/callback/${code}?`)],
          ['code also in the FRAGMENT', (loc, code) => `${loc}#${code}`],
          ['code also in an UNRELATED parameter', (loc, code) => `${loc}&x=${code}`],
          ['DUPLICATE code parameter', (loc, code) => `${loc}&code=${code}`],
          ['changed callback destination', (loc) => loc.replace('127.0.0.1:8976/callback', '127.0.0.1:8976/elsewhere')],
          ['changed state', (loc) => loc.replace('state=st-s12', 'state=st-evil')],
          ['same status, code kept only in a WRONG parameter', (loc, code) => loc.replace(`code=${code}`, `x=${code}`)],
        ];
        for (const [label, rewrite] of replacements) {
          const out = await run(rewrite);
          const row = { case: `R-P2-1 ${label}`, status: out.status, state: out.state, redeemOtherInstance: out.red.status, tokens: out.tokens };
          results.push(row);
          check(`R-P2-1 ${label}: the hand-off differs from the validated redirect -> never committed, PENDING, refused on the other instance (server-known code + verifier), no token`, out.status === 303 && out.state === 'pending' && out.red.status === 400 && !out.red.json.access_token && out.tokens === 0, row);
        }
        const good = await run();
        const again = good.code ? await redeemCode(c, good.code, 'x') : { status: 0 };
        results.push({ case: 'R-P2-1 valid query-mode issuance', status: good.status, state: good.state, redeem: good.red.status });
        check('R-P2-1 valid query-mode issuance: redirect to the registered callback, ACTIVE, redeemed once on the other instance (S256), reuse refused', good.status === 303 && good.state === 'active' && good.red.status === 200 && !!good.red.json.access_token && again.status === 400, { good, again: again.status });
        const reg = await run(undefined, CLIENT_NR, REG_Q);
        const u = new URL(reg.finalLoc);
        results.push({ case: 'R-P2-1 registered callback with a query parameter', finalLoc: reg.finalLoc.replace(/code=[^&]+/, 'code=<code>'), state: reg.state, redeem: reg.red.status });
        check('R-P2-1 a registered callback\'s own query parameter is preserved and the issuance validates (ACTIVE, redeemed once)', u.searchParams.get('tenant') === 'synthetic-a' && u.searchParams.getAll('code').length === 1 && reg.state === 'active' && reg.red.status === 200, { loc: reg.finalLoc.replace(/code=[^&]+/, 'code=<code>'), state: reg.state, redeem: reg.red.status, err: reg.red.json });
      } finally {
        await c.close();
      }
    }

    // ------------------------------------------------------------ R-P2-2 audit propagation (application sink)
    {
      const lines: Record<string, unknown>[] = [];
      const sink = createRedactingAuditSink({ write: (l) => lines.push(JSON.parse(l).aura_mcp_audit) });
      const downPool = { connect: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.1:5432 password=never-logged');
      } };
      const refusingPool = () => {
        const real = appPool('aura-s12-refuse');
        return { connect: async () => {
          const cl: PoolClient = await real.connect();
          return { on: cl.on.bind(cl), off: cl.off.bind(cl), query: async (t: string, p?: unknown[]) => {
            if (t === 'COMMIT') {
              await cl.query('ROLLBACK');
              throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001', severity: 'ERROR' });
            }
            return cl.query(t, p as unknown[]);
          }, release: (e?: unknown) => cl.release(e as Error | undefined) };
        } };
      };
      // (1) OAuth authorization-server pre-auth path.
      const down = createPostgresRateLimiter({ pool: downPool as never, windowMs: 60_000 });
      const c = await startCluster(1, { keys, audit: sink, preAuth: { limiter: down, addressSource: { kind: 'socket' } } });
      try {
        const r = await fetch(`${c.origin}/.well-known/openid-configuration`);
        check('R-P2-2 OAuth pre-auth limiter unavailable -> 503', r.status === 503, r.status);
      } finally {
        await c.close();
      }
      const oauthLine = lines.find((l) => l.event === 'oauth.throttled' && l.outcome === 'limiter_unavailable');
      check('R-P2-2 OAuth audit (sanitized application output) carries cause "checkout"', oauthLine?.cause === 'checkout', oauthLine);
      // (2) MCP pre-auth branch, (3) MCP per-user branch.
      const config = { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:3000' };
      const req = () => new Request(config.resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-token' }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
      const r2 = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => null, preAuthRateLimiter: down, clientAddress: '203.0.113.9', audit: sink });
      const mcpPre = lines.filter((l) => l.event === 'mcp.request' && l.outcome === 'limiter_unavailable').pop();
      check('R-P2-2 MCP pre-auth limiter: 503 and the audit carries cause "checkout"', r2.status === 503 && mcpPre?.cause === 'checkout', mcpPre);
      await admin.query('TRUNCATE "McpRateLimitWindow"');
      const refusing = createPostgresRateLimiter({ pool: refusingPool() as never, windowMs: 60_000 });
      const r3 = await handleRemoteMcpRequest(req(), { config, verifyAccessToken: async () => ({ userId: 'synthetic-s12-user', clientId: CLIENT, scopes: [MCP_SCOPE] }), rateLimiter: refusing, audit: sink });
      const mcpUser = lines.filter((l) => l.event === 'mcp.request' && l.outcome === 'limiter_unavailable').pop();
      check('R-P2-2 MCP per-user limiter: an explicit COMMIT refusal -> 503 and the audit carries cause "commit_failed"', r3.status === 503 && mcpUser?.cause === 'commit_failed', mcpUser);
      const counted = Number((await q(`SELECT COALESCE(sum("count"),0)::int AS n FROM "McpRateLimitWindow"`))[0].n);
      check('R-P2-2 the refused COMMIT counted nothing (conservative accounting, nothing landed)', counted === 0, counted);
      const all = JSON.stringify(lines);
      check('R-P2-2 no raw database error, password, address, token or user id in any audit line', !/ECONNREFUSED|password|serialize|10\.0\.0\.1|203\.0\.113\.9|synthetic-token|synthetic-s12-user/.test(all), lines);
      results.push({ case: 'R-P2-2 audit lines', lines });
    }

    console.log('\nS12 results:');
    for (const r of results) console.log(`  ${JSON.stringify(r)}`);
    for (const p of pools) await p.end().catch(() => undefined);
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S12 redirect integrity and audit cause DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
