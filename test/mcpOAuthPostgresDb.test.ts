/**
 * AURA-MCP-02-I2b -- durable OAuth state and distributed rate limiting
 * against a REAL Postgres database (migration 0052).
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database that already has the
 * full migration chain applied (CI: the "Database migration validation" job;
 * locally: a throwaway Postgres). The test TRUNCATEs the two MCP tables and
 * touches nothing else. It refuses to run against a non-loopback database
 * unless CI=true (GitHub's service container is on localhost anyway).
 *
 * "Instances" are independent AuraOAuthServer objects with their OWN
 * connection pools and store objects: they share nothing but the database,
 * exactly like serverless instances.
 */
import { Pool } from 'pg';
import { createPostgresAdapterStore, storageKey } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { ReplayDetectedError } from '../packages/mcp-tools/src/auth/oauthStore';
import { createPostgresRateLimiter } from '../packages/mcp-tools/src/security/postgresRateLimit';
import { createFixedWindowRateLimiter } from '../packages/mcp-tools/src/security/rateLimit';
import { Browser, CLIENT, SCOPE_OFFLINE, USER_A, USER_B, authorize, check, connect, redeemCode, refresh, sharedKeys, sleep, startCluster, summary, verifyOn } from './mcpOAuthI2bHarness';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (a disposable database with migrations applied)');
  process.exit(1);
}
const host = new URL(url).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.CI !== 'true') {
  console.error('refusing to run against a non-loopback database outside CI');
  process.exit(1);
}

const captured: string[] = [];
for (const m of ['log', 'info', 'warn', 'error'] as const) {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
    orig(...args);
  };
}

async function main() {
  const pools = [new Pool({ connectionString: url, max: 6 }), new Pool({ connectionString: url, max: 6 })];
  const admin = new Pool({ connectionString: url, max: 2 });
  const rows = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');
    const keys = sharedKeys();
    const stores = pools.map((pool) => createPostgresAdapterStore({ db: pool, fieldKeys: keys.cookieKeys }));
    const secrets: string[] = [];

    // ---------------------------------------------------------- adapter: atomic consume across two pools
    {
      const Code0 = new stores[0].factory('AuthorizationCode');
      const Code1 = new stores[1].factory('AuthorizationCode');
      const Grant0 = new stores[0].factory('Grant');
      await Grant0.upsert('grant-db-1', { accountId: USER_A, clientId: CLIENT, iat: 1 }, 3600);
      await Code0.upsert('code-db-1', { grantId: 'grant-db-1', accountId: USER_A, jti: 'code-db-1' }, 60);
      // I2b-S10: a new code is PENDING (never consumable) until its activation commits.
      const act = await stores[0].beginIssuedActivation?.('AuthorizationCode', 'code-db-1');
      check('F6 DB: the seeded code is activated through the issuance path (held activation committed)', !!act && (await act.commit()) === 'committed');
      const races = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => (i % 2 ? Code0 : Code1).consume('code-db-1')));
      const ok = races.filter((r) => r.status === 'fulfilled').length;
      check('F6 DB: 40 concurrent consumes on two pools -> exactly 1 succeeds', ok === 1, ok);
      check('F6 DB: every loser gets ReplayDetectedError (invalid_grant)', races.filter((r) => r.status === 'rejected' && r.reason instanceof ReplayDetectedError).length === 39);
      check('F6 DB: replay revoked every row of the grant', Number((await rows(`SELECT count(*) FROM "McpOAuthPayload" WHERE "grantId" = 'grant-db-1'`))[0].count) === 0);
      await Code0.upsert('code-db-2', { accountId: USER_A }, 1);
      await sleep(1200);
      check('DB expiry: expired row invisible to find', (await Code1.find('code-db-2')) === undefined);
      check('DB expiry: expired row cannot be consumed', await Code1.consume('code-db-2').then(() => false, (e) => e instanceof ReplayDetectedError));
      const removed = await stores[0].cleanupExpired();
      check('DB cleanup: cleanupExpired removes expired rows', removed >= 1 && Number((await rows(`SELECT count(*) FROM "McpOAuthPayload" WHERE "expiresAt" < now()`))[0].count) === 0, removed);
    }

    // ---------------------------------------------------------- full flow: two independent instances on one database
    const c = await startCluster(2, { refreshTokens: { enabled: true }, keys }, (i) => ({ adapterStore: stores[i] }));
    try {
      let n = 0;
      c.route.pick = () => n++ % 2;
      const b = new Browser(c.origin, USER_A);
      const out = await authorize(c, b, { consent: true, scope: SCOPE_OFFLINE });
      check('DB multi-instance: authorization alternating between instances completes', !!out.code, out);
      const reqs = await Promise.all(Array.from({ length: 20 }, () => redeemCode(c, out.code as string, out.verifier)));
      const winners = reqs.filter((r) => r.status === 200);
      check('F6 DB: 20 concurrent redemptions across instances -> exactly 1 token', winners.length === 1, reqs.map((r) => r.status));
      check('F6 DB: replay revoked the grant -> winning token dead on both instances', (await verifyOn(c, 0, winners[0]?.json.access_token)) === null && (await verifyOn(c, 1, winners[0]?.json.access_token)) === null);

      const good = await connect(c, USER_A, { scope: SCOPE_OFFLINE });
      const at = String(good.token?.json.access_token);
      const rt = String(good.token?.json.refresh_token);
      // Provider cookies (_session, _interaction, their .sig) -- not the synthetic `aura` login cookie,
      // whose value is the user id (stored on purpose as accountId for the connections list).
      secrets.push(at, rt, String(good.outcome.code), good.outcome.verifier, ...[...good.browser.jar].filter(([k]) => k !== 'aura').map(([, v]) => v));
      check('DB: token from one instance verifies on the other', (await verifyOn(c, 0, at)) === USER_A && (await verifyOn(c, 1, at)) === USER_A);

      const dump = JSON.stringify(await rows(`SELECT * FROM "McpOAuthPayload"`));
      const inClear = secrets.filter((s) => s.length >= 8 && dump.includes(s));
      check('DB at rest: no access token, refresh token, code, verifier or provider cookie value stored in clear', inClear.length === 0, inClear.map((s) => (s === USER_A ? 'aura-user-id' : `len${s.length}`)));
      check('DB at rest: ids are SHA-256 keys and payloads carry no jti', !dump.includes('"jti"') && (await rows(`SELECT "id" FROM "McpOAuthPayload"`)).every((r) => /^[0-9a-f]{64}$/.test(r.id)));
      check('DB at rest: the access token is findable only by its hash', (await rows(`SELECT 1 FROM "McpOAuthPayload" WHERE "model" = 'AccessToken' AND "id" = $1`, [storageKey(at)])).length === 1);

      const r1 = await refresh(c, rt);
      check('DB refresh: rotation on the other instance issues a new refresh token', r1.status === 200 && r1.json.refresh_token !== rt, r1);
      const racers = await Promise.all(Array.from({ length: 10 }, () => refresh(c, String(r1.json.refresh_token))));
      check('DB refresh: 10 concurrent uses of one refresh token -> at most 1 success', racers.filter((r) => r.status === 200).length <= 1, racers.map((r) => r.status));
      const replay = await refresh(c, rt);
      check('DB refresh: replay of a rotated refresh token -> invalid_grant', replay.status === 400 && replay.json.error === 'invalid_grant', replay);
      check('DB refresh: replay revoked the grant (no rows left for it)', Number((await rows(`SELECT count(*) FROM "McpOAuthPayload" WHERE "model" = 'Grant' AND "accountId" = $1`, [USER_A]))[0].count) === 0);

      const bConn = await connect(c, USER_B, { scope: SCOPE_OFFLINE });
      const listed = await c.instances[1].listUserConnections(USER_B);
      check('DB connections: list via the other instance', listed.length === 1 && listed[0].clientId === CLIENT, listed);
      const revoked = await c.instances[0].revokeUserClientGrants(USER_B, CLIENT);
      check('DB disconnect: one indexed delete revokes the grant', revoked === 1);
      check('DB disconnect: access token dead on the other instance', (await verifyOn(c, 1, bConn.token?.json.access_token)) === null);
      check('DB disconnect: refresh token dead', (await refresh(c, String(bConn.token?.json.refresh_token))).status === 400);

      // F1 preserved on the durable store: account switch in one browser.
      const shared = new Browser(c.origin, USER_A);
      const first = await authorize(c, shared, { consent: true });
      const firstTok = first.code ? await redeemCode(c, first.code, first.verifier) : undefined;
      shared.jar.set('aura', USER_B);
      const switched = await authorize(c, shared, { consent: true });
      const switchedTok = switched.code ? await redeemCode(c, switched.code, switched.verifier) : undefined;
      const aAfter = await verifyOn(c, 0, firstTok?.json.access_token);
      check('F1 DB: A connects, then B signs in on the same browser -> B consents and gets B\'s token, never A\'s',
        !!first.code && (await verifyOn(c, 1, switchedTok?.json.access_token)) === USER_B, { first: !!first.code, switched: switched.error });
      // A's session-bound (no offline_access) token ends with A's reset provider session; it never becomes B's.
      check('F1 DB: A\'s earlier token never resolves to B (ended with A\'s provider session)', aAfter === null || aAfter === USER_A, aAfter);
      shared.jar.delete('aura');
      const signedOut = await authorize(c, shared, { consent: true });
      check('F1 DB: after sign-out no code is issued (sign-in required)', !signedOut.code && signedOut.stoppedStatus === 401, signedOut.stoppedStatus);
    } finally {
      await c.close();
    }

    // ---------------------------------------------------------- R1-L1: distributed limiter (two instances, one database)
    {
      const limiters = pools.map((pool) => createPostgresRateLimiter({ pool, windowMs: 60_000 }));
      const decisions = await Promise.all(Array.from({ length: 40 }, (_, i) => limiters[i % 2].check([{ key: 'user:db-u1', limit: 10 }])));
      check('R1-L1: 40 concurrent requests on two instances -> exactly 10 admitted (global, not per process)', decisions.filter((d) => d.allowed).length === 10, decisions.filter((d) => d.allowed).length);
      check('R1-L1: rejected requests did not inflate the counter', Number((await rows(`SELECT "count" FROM "McpRateLimitWindow" WHERE "key" = 'user:db-u1'`))[0].count) === 10);
      check('R1-L1: another user is unaffected', (await limiters[1].check([{ key: 'user:db-u2', limit: 10 }])).allowed);
      const rejected = decisions.find((d) => !d.allowed);
      check('R1-L1: rejection reports the namespace and a Retry-After', rejected?.limitedBy === 'user' && (rejected?.retryAfterSeconds ?? 0) >= 1);
      // All-or-nothing across rules: per-user 5, per-client 7.
      const multi = await Promise.all(
        Array.from({ length: 15 }, (_, i) => limiters[i % 2].check([{ key: `user:db-m${i % 3}`, limit: 5 }, { key: 'client:db-c', limit: 7 }])),
      );
      const admitted = multi.filter((d) => d.allowed).length;
      const userSum = (await rows(`SELECT sum("count")::int AS s FROM "McpRateLimitWindow" WHERE "key" LIKE 'user:db-m%'`))[0].s;
      check('R1-L1: client ceiling admits exactly 7 and rejected requests consume no per-user budget', admitted === 7 && userSum === 7, { admitted, userSum });
      // Window expiry (1 s windows) and no early reset.
      const short = pools.map((pool) => createPostgresRateLimiter({ pool, windowMs: 1000 }));
      const a1 = await short[0].check([{ key: 'user:db-w', limit: 1 }]);
      const a2 = await short[1].check([{ key: 'user:db-w', limit: 1 }]);
      await sleep(1300);
      const a3 = await short[1].check([{ key: 'user:db-w', limit: 1 }]);
      check('R1-L1: window limits across instances, then restarts only after it expires', a1.allowed && !a2.allowed && a3.allowed, [a1, a2, a3]);
      await admin.query(`INSERT INTO "McpRateLimitWindow" ("key","windowStart","count","expiresAt") VALUES ('user:db-old', now() - interval '2 hours', 3, now() - interval '1 hour')`);
      check('R1-L1: cleanupExpired removes expired windows only', (await limiters[0].cleanupExpired()) >= 1 && (await rows(`SELECT 1 FROM "McpRateLimitWindow" WHERE "key" = 'user:db-u1'`)).length === 1);
      const dead = new Pool({ connectionString: 'postgresql://synthetic@127.0.0.1:1/none', connectionTimeoutMillis: 500 });
      const unavailable = await createPostgresRateLimiter({ pool: dead, windowMs: 60_000 }).check([{ key: 'user:x', limit: 100 }]);
      check('R1-L1: database unavailable -> fail closed (denied, "unavailable")', !unavailable.allowed && unavailable.limitedBy === 'unavailable');
      await dead.end().catch(() => undefined);
    }

    // ---------------------------------------------------------- F5 with the shared limiter: budget shared by instances
    {
      const shared = pools.map((pool) => createPostgresRateLimiter({ pool, windowMs: 60_000 }));
      const c2 = await startCluster(2, { keys }, (i) => ({ adapterStore: stores[i], preAuth: { limiter: shared[i], addressSource: { kind: 'socket' }, perAddress: 6, global: 1000 } }));
      try {
        let k = 0;
        c2.route.pick = () => k++ % 2;
        const st: number[] = [];
        for (let i = 0; i < 9; i += 1) st.push((await fetch(`${c2.origin}/oauth/jwks`)).status);
        check('F5 + R1-L1: one address gets 6 requests in total across both instances, then 429', st.slice(0, 6).every((s) => s === 200) && st.slice(6).every((s) => s === 429), st);
      } finally {
        await c2.close();
      }
      // The per-process limiter would have allowed 6 per instance (12 total) -- the I2a gap.
      const perProcess = [createFixedWindowRateLimiter({ windowMs: 60_000 }), createFixedWindowRateLimiter({ windowMs: 60_000 })];
      let allowed = 0;
      for (let i = 0; i < 12; i += 1) if (perProcess[i % 2].check([{ key: 'addr:x', limit: 6 }]).allowed) allowed += 1;
      check('R1-L1 control: per-process limiters admit 12 (2 x 6) -- the gap the shared limiter closes', allowed === 12);
    }

    check('logs: no secret value in any console output', secrets.every((s) => s.length < 8 || !captured.some((l) => l.includes(s))));
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await Promise.all([...pools, admin].map((p) => p.end().catch(() => undefined)));
  }
  summary('AURA-MCP-02-I2b Postgres OAuth / rate-limit DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'error');
  process.exit(1);
});
