/**
 * AURA-MCP-02-I2b-S10 -- S3-1 cross-instance authorization-code safety,
 * against a REAL disposable Postgres (migration 0052). Synthetic users and
 * clients only.
 *
 * Invariant under test: a code is redeemable on ANY instance only if its
 * activation transaction committed, and that COMMIT is sent only after the
 * complete response carrying the code was handed to the runtime. Every
 * other outcome leaves the code PENDING in the shared database without any
 * further write, so it is refused everywhere -- even by an instance that
 * holds the plaintext code (captured here with a test-only spy, i.e. with
 * knowledge only the server has) and the right PKCE verifier.
 *
 * Every case uses TWO instances with SEPARATE store objects and pools (no
 * shared process memory): instance 0 serves the authorization flow (its
 * pool can be faulted), instance 1 redeems over a healthy pool.
 *
 *   Abandoned issuance (never committed -> pending -> 400 everywhere)
 *     A1 activation UPDATE fails
 *     A2 database unreachable for instance 0 right after the code write
 *     A3 client disconnect observed before the response is written
 *     A4 partial HTTP delivery: Location (with the code) reached the client
 *        socket, then the connection broke before the response finished
 *     A5 response replaced after activation (Koa-style error replacement; S7 P3)
 *     A6 process frozen between activation and COMMIT (COMMIT never sent;
 *        the connection is never closed): the server's
 *        idle_in_transaction_session_timeout rolls it back and frees the
 *        row lock; a fresh store ("restarted instance") also refuses it
 *   Issued (handed off; receipt NOT proven)
 *     I1 normal: redeemable exactly once, on another instance
 *     I2 COMMIT acknowledgement lost after hand-off: audited as
 *        unconfirmed; the code is issued (redeemable once) -- the
 *        documented "issued, outcome unknown" case, not an abandonment
 *     I3 handed off, client never reads it: only the PKCE verifier holder
 *        can redeem; wrong verifier refused; single use
 *     I4 redemption racing the activation COMMIT on another instance waits
 *        for it (FOR SHARE) and succeeds instead of reading it half-decided
 *   Hygiene
 *     H1 no code value in any audit event; no pending-revocation API remains
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { createHash, randomBytes } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { MCP_PG_POOL_BOUNDS } from '../packages/mcp-tools/src/security/deadline';
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

interface Faults {
  activationFail?: boolean;
  dbDownAfterCodeWrite?: boolean;
  /** The activation COMMIT is never sent and the connection is never closed (frozen process). */
  freezeCommit?: boolean;
  /** The activation COMMIT reaches the server, but its acknowledgement is lost. */
  ackLost?: boolean;
  /** Forward the activation COMMIT only after this delay (ms). */
  delayCommitMs?: number;
  /** Called (and awaited) right after the activation UPDATE returned, before the response is written. */
  afterActivationUpdate?: () => Promise<void>;
}
const isActivation = (t: string, p?: unknown[]) => /^\s*UPDATE/i.test(t) && p?.[0] === 'AuthorizationCode' && t.includes(`"payload" = "payload" - 'auraIssuePending'`); // the activation statement only (not consume's pending filter)

/** A pg Pool whose clients fault the activation transaction at the wire. */
function faultPool(real: Pool, f: Faults) {
  const st = { codeWritten: false, down: false, frozen: [] as PoolClient[] };
  const pool = {
    query: (t: string, p?: unknown[]) => real.query(t, p),
    connect: async () => {
      if (st.down) throw new Error('injected: database unreachable');
      const c: PoolClient = await real.connect();
      let inActivation = false;
      let frozen = false;
      let codeInsertOpen = false;
      return {
        // I2b-S11: forward listener management to the real client, so the
        // APPLICATION's checkout guard handles connection errors (the S10
        // fixture installed its own listener here, which masked P2-1).
        on: c.on.bind(c),
        off: c.off.bind(c),
        query: async (text: string, params?: unknown[]) => {
          if (st.down) throw new Error('injected: database unreachable');
          if (isActivation(text, params)) {
            inActivation = true;
            if (f.activationFail) throw new Error('injected activation fault');
            const r = await c.query(text, params as unknown[]);
            if (f.afterActivationUpdate) await f.afterActivationUpdate();
            return r;
          }
          if (/^\s*COMMIT/i.test(text) && inActivation) {
            inActivation = false;
            if (f.freezeCommit) {
              frozen = true;
              st.frozen.push(c);
              return new Promise(() => undefined); // never sent, never answered
            }
            if (f.delayCommitMs) await sleep(f.delayCommitMs);
            const r = await c.query('COMMIT');
            if (f.ackLost) throw new Error('injected lost COMMIT acknowledgement');
            return r;
          }
          const r = await c.query(text, params as unknown[]);
          if (/^\s*INSERT/i.test(text) && params?.[0] === 'AuthorizationCode') codeInsertOpen = true;
          // The database goes away right AFTER the code write has committed.
          if (f.dbDownAfterCodeWrite && codeInsertOpen && /^\s*COMMIT/i.test(text)) st.down = true;
          return r;
        },
        release: (err?: unknown) => {
          if (frozen) return; // a frozen process closes nothing
          c.release(err as Error | undefined);
        },
      };
    },
  };
  return { pool, st };
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

/** Bytes the client socket actually received, per request (raw, so a broken response is still visible). */
interface FlowOut {
  status: number | 'broken';
  verifier: string;
  delivered: string | null;
  seen: string[];
}
async function flow(origin: string, resource: string, ctl: { current?: AbortController } = {}): Promise<FlowOut> {
  const b = new Browser(origin, USER_A);
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const seen: string[] = [];
  const go = (u: string, init: RequestInit = {}) => {
    ctl.current = new AbortController();
    return b.fetch(u, { ...init, signal: ctl.current.signal });
  };
  try {
    let res = await go(`/oauth/authorize?${q}`);
    for (let i = 0; i < 14; i += 1) {
      const body = await res.text();
      seen.push(JSON.stringify([...res.headers]) + body);
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (loc.startsWith(REDIRECT)) return { status: res.status, verifier, delivered: new URL(loc).searchParams.get('code'), seen };
        res = await go(loc);
        continue;
      }
      if (res.status === 200 && /name="csrf"/.test(body)) {
        const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
        const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
        res = await go(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(csrf)}` });
        continue;
      }
      return { status: res.status, verifier, delivered: null, seen };
    }
    return { status: 0, verifier, delivered: null, seen };
  } catch {
    return { status: 'broken', verifier, delivered: null, seen };
  }
}

/** Patches a response that carries an authorization code to the callback (test-only wire fault). */
function onCodeResponse(res: ServerResponse, fn: (res: ServerResponse, end: (...a: unknown[]) => unknown, location: string) => void): void {
  const end = res.end.bind(res) as (...a: unknown[]) => unknown;
  (res as unknown as { end: (...a: unknown[]) => unknown }).end = (...args: unknown[]) => {
    const location = String(res.getHeader('location') ?? '');
    if (location.startsWith(REDIRECT) && location.includes('code=')) {
      fn(res, end, location);
      return res;
    }
    return end(...args);
  };
}

async function main() {
  const admin = new Pool({ connectionString: url, max: 4 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const keys = sharedKeys();
  const pools: Pool[] = [];
  const mkPool = (name: string) => {
    const p = new Pool({ connectionString: url, ...MCP_PG_POOL_BOUNDS, application_name: name });
    p.on('error', () => undefined);
    pools.push(p);
    return p;
  };
  const codeState = async () => {
    const rows = await q(`SELECT ("payload" ? 'auraIssuePending') AS pending, "consumedAt" IS NOT NULL AS consumed FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`);
    return rows.map((r) => (r.consumed ? 'consumed' : r.pending ? 'pending' : 'active')).join(',') || 'absent';
  };
  const tokenCount = async () => Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" IN ('AccessToken','RefreshToken')`))[0].n);
  const results: Record<string, unknown>[] = [];
  const allAudits: McpAuditEvent[] = [];
  const allCodes: string[] = [];

  async function runCase(
    name: string,
    faults: Faults,
    opts: { onRequest?: (req: IncomingMessage, res: ServerResponse) => void; storeOpts?: Record<string, unknown>; ctl?: { current?: AbortController }; afterFlow?: () => Promise<void> } = {},
  ) {
    await admin.query('TRUNCATE "McpOAuthPayload"');
    const f0 = faultPool(mkPool(`aura-s10-${name.slice(0, 2)}-i0`), faults);
    const s0 = createPostgresAdapterStore({ db: f0.pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0, ...(opts.storeOpts ?? {}) });
    const spy = spyCodes(s0);
    const s1 = createPostgresAdapterStore({ db: mkPool(`aura-s10-${name.slice(0, 2)}-i1`), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
    const audits: McpAuditEvent[] = [];
    const c = await startCluster(2, { keys, audit: (e) => audits.push(e) }, (i) => ({ adapterStore: i === 0 ? spy.store : s1 }));
    c.route.pick = () => 0;
    c.route.onRequest = opts.onRequest;
    try {
      const out = await flow(c.origin, c.resource, opts.ctl);
      if (opts.afterFlow) await opts.afterFlow();
      await sleep(300); // let instance 0 settle its activation after the response
      const code = spy.codes[0];
      allCodes.push(...spy.codes);
      allAudits.push(...audits);
      const exposed = !!code && out.seen.some((x) => x.includes(code));
      const state = await codeState();
      c.route.onRequest = undefined;
      c.route.pick = () => 1; // redeem on the OTHER instance (separate store object and pool)
      const redeem = code ? await redeemCode(c, code, out.verifier) : undefined;
      const row: Record<string, unknown> = {
        case: name,
        status: out.status,
        exposedToClient: exposed,
        stateBeforeRedeem: state,
        redeemOtherInstance: redeem?.status ?? 'n/a',
        token: !!redeem?.json.access_token,
        tokensInDb: await tokenCount(),
        audits: audits.map((a) => a.errorCode).filter((e) => /Code/.test(String(e))),
      };
      results.push(row);
      return { row, out, code, c, f0, redeem };
    } finally {
      await c.close();
    }
  }
  const abandoned = (row: Record<string, unknown>) => row.stateBeforeRedeem === 'pending' && row.redeemOtherInstance === 400 && row.token === false && row.tokensInDb === 0;

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // ------------------------------------------------------------------ Abandoned issuance
    {
      const { row } = await runCase('A1 activation UPDATE fails', { activationFail: true });
      check('A1 activation fails: 503, code never sent, stays PENDING, refused on another instance with the server-known code + verifier', row.status === 503 && !row.exposedToClient && abandoned(row), row);
      check('A1 audited CodeActivationFailed', (row.audits as string[]).includes('CodeActivationFailed'), row);
    }
    {
      const { row } = await runCase('A2 database unreachable after the code write', { dbDownAfterCodeWrite: true });
      check('A2 database down for instance 0 after the code write: error answer, code never sent, PENDING, refused elsewhere -- no write was needed', typeof row.status === 'number' && (row.status as number) >= 400 && !row.exposedToClient && abandoned(row), row);
    }
    {
      const ctl: { current?: AbortController } = {};
      const { row } = await runCase('A3 client disconnect observed before the response is written', {
        afterActivationUpdate: async () => {
          ctl.current?.abort();
          await sleep(200); // the server observes the closed connection
        },
      }, { ctl });
      check('A3 disconnect before the write: nothing received, PENDING, refused elsewhere', row.status === 'broken' && !row.exposedToClient && abandoned(row), row);
      check('A3 audited CodeDeliveryAbandoned', (row.audits as string[]).includes('CodeDeliveryAbandoned'), row);
    }
    {
      // The status line and Location header (with the code) are written to the
      // socket, then the connection breaks before the response finishes.
      const raw: string[] = [];
      const { row, code } = await runCase('A4 partial delivery (code bytes on the wire, response unfinished)', {}, {
        onRequest: (_req, res) =>
          onCodeResponse(res, (r, _end, location) => {
            const head = `HTTP/1.1 303 See Other\r\nLocation: ${location}\r\n`;
            raw.push(head);
            r.socket?.write(head);
            setTimeout(() => r.socket?.destroy(), 50);
          }),
      });
      const onWire = !!code && raw.some((h) => h.includes(code));
      Object.assign(row, { codeBytesWrittenToSocket: onWire });
      check('A4 partial delivery: the code itself was written to the socket, the response never finished, and the code stays PENDING -- refused elsewhere even with code + verifier', onWire && abandoned(row), row);
    }
    {
      const { row } = await runCase('A5 response replaced after activation (error replacement)', {}, {
        onRequest: (_req, res) =>
          onCodeResponse(res, (r, end) => {
            // What Koa's error handler does: drop headers, error status, new body.
            for (const h of r.getHeaderNames()) r.removeHeader(h);
            r.statusCode = 500;
            end('Internal Server Error');
          }),
      });
      check('A5 replaced response (S7 P3): a 500 without the code finished locally; the activation is never committed; PENDING, refused elsewhere', row.status === 500 && !row.exposedToClient && abandoned(row), row);
    }
    {
      const name = 'A6 process frozen between activation and COMMIT';
      const r = await runCase(name, { freezeCommit: true }, { storeOpts: { activationHoldMs: 300, activationCommitMs: 300 } });
      // The redemption inside runCase ran DURING the hold (the frozen backend
      // holds the row lock until idle_in_transaction_session_timeout =
      // activationHoldMs + 1000 = 1300 ms): it may wait out lock_timeout (503)
      // or see the pending row (400) -- both are refusals. I2b-S11 (P3-3):
      // assert the refusal, then OBSERVE the rollback, then assert the
      // deterministic outcome.
      const idleInTx = async () => (await q(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'aura-s10-A6-i0' AND state LIKE 'idle in transaction%'`))[0].n as number;
      let rolledBack = false;
      for (let i = 0; i < 160 && !rolledBack; i += 1) {
        rolledBack = (await idleInTx()) === 0;
        if (!rolledBack) await sleep(25);
      }
      const state = await codeState();
      // A "restarted" instance: a brand-new store object, empty memory.
      const fresh = createPostgresAdapterStore({ db: mkPool('aura-s10-A6-fresh'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const found = await new fresh.factory('AuthorizationCode').find(r.code as string);
      const consumed = await new fresh.factory('AuthorizationCode').consume(r.code as string).then(() => 'consumed', (e) => (e as Error).name);
      Object.assign(r.row, { rollbackObserved: rolledBack, stateAfterRollback: state, freshStoreFinds: !!found, freshStoreConsume: consumed });
      check('A6 frozen before COMMIT, DURING the hold: the response was handed off (303) and the redemption on the other instance is REFUSED (400 or a lock-wait 503), no token, code PENDING', r.row.status === 303 && r.row.redeemOtherInstance !== 200 && r.row.token === false && r.row.tokensInDb === 0 && r.row.stateBeforeRedeem === 'pending', r.row);
      check('A6 the rollback is OBSERVED: the server ended the frozen idle-in-transaction backend (row lock released)', rolledBack && state === 'pending', r.row);
      check('A6 AFTER the observed rollback: deterministic refusal -- a restarted instance neither finds nor consumes it', !found && consumed === 'ReplayDetectedError', r.row);
      for (const fc of r.f0.st.frozen) fc.release(new Error('test cleanup'));
    }

    // ------------------------------------------------------------------ Issued (receipt not proven)
    {
      const { row, c, code, out } = await runCase('I1 normal issuance', {});
      check('I1 normal: delivered (303), ACTIVE, redeemed on the other instance (200 + token)', row.status === 303 && row.exposedToClient === true && row.stateBeforeRedeem === 'active' && row.redeemOtherInstance === 200 && row.token === true, row);
      void c;
      void code;
      void out;
    }
    {
      const r = await runCase('I2 COMMIT acknowledgement lost after hand-off', { ackLost: true });
      check('I2 ack lost after hand-off: the response was already out (303); audited CodeActivationUnconfirmed; the COMMIT did land, so the code is issued and redeems once', r.row.status === 303 && (r.row.audits as string[]).includes('CodeActivationUnconfirmed') && r.row.stateBeforeRedeem === 'active' && r.row.redeemOtherInstance === 200, r.row);
    }
    {
      const sockets: (() => void)[] = [];
      const r = await runCase('I3 handed off, client never reads it', {}, {
        onRequest: (_req, res) =>
          onCodeResponse(res, (rs, end) => {
            end();
            sockets.push(() => rs.socket?.destroy());
          }),
      });
      sockets.forEach((d) => d());
      // r.redeem used the right verifier on the other instance already; now check single use and a wrong verifier on a second code.
      check('I3 handed off without proof of receipt: the code is issued (ACTIVE) -- redeemable only with the PKCE verifier', r.row.stateBeforeRedeem === 'active' && r.row.redeemOtherInstance === 200, r.row);
      r.c.route.pick = () => 1;
    }
    {
      // Wrong verifier and single use, on a fresh issued code.
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const s = createPostgresAdapterStore({ db: mkPool('aura-s10-I3b'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const spy = spyCodes(s);
      const c = await startCluster(2, { keys }, () => ({ adapterStore: spy.store }));
      try {
        c.route.pick = () => 0;
        const out = await flow(c.origin, c.resource);
        await sleep(200);
        c.route.pick = () => 1;
        const wrong = await redeemCode(c, out.delivered as string, b64(randomBytes(32)));
        const b = await (async () => {
          await admin.query('TRUNCATE "McpOAuthPayload"');
          c.route.pick = () => 0;
          const o = await flow(c.origin, c.resource);
          await sleep(200);
          c.route.pick = () => 1;
          const first = await redeemCode(c, o.delivered as string, o.verifier);
          const second = await redeemCode(c, o.delivered as string, o.verifier);
          return { first, second };
        })();
        const row = { case: 'I3b PKCE + single use (issued codes)', wrongVerifier: wrong.status, firstRedeem: b.first.status, secondRedeem: b.second.status };
        results.push(row);
        check('I3b a wrong PKCE verifier is refused (400, no token)', wrong.status === 400 && !wrong.json.access_token, row);
        check('I3b an issued code redeems exactly once (200, then 400)', b.first.status === 200 && b.second.status === 400, row);
      } finally {
        await c.close();
      }
    }
    {
      // The redemption on instance 1 starts while instance 0's activation COMMIT is still delayed.
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const f0 = faultPool(mkPool('aura-s10-I4-i0'), { delayCommitMs: 500 });
      const s0 = createPostgresAdapterStore({ db: f0.pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const s1 = createPostgresAdapterStore({ db: mkPool('aura-s10-I4-i1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(2, { keys }, (i) => ({ adapterStore: i === 0 ? s0 : s1 }));
      try {
        c.route.pick = () => 0;
        const out = await flow(c.origin, c.resource);
        const pendingAtReceipt = await codeState();
        c.route.pick = () => 1;
        const t0 = Date.now();
        const red = await redeemCode(c, out.delivered as string, out.verifier);
        const row = { case: 'I4 redemption races the activation COMMIT', stateWhenClientGotTheCode: pendingAtReceipt, redeem: red.status, waitedMs: Date.now() - t0 };
        results.push(row);
        check('I4 the client received the code while its activation was still uncommitted (the race is real)', pendingAtReceipt === 'pending', row);
        check('I4 the other instance waited for the in-flight activation (FOR SHARE) and redeemed it (200), not a half-decided 400', red.status === 200 && !!red.json.access_token && row.waitedMs >= 100, row);
      } finally {
        await c.close();
      }
    }

    // ------------------------------------------------------------------ Request budget (integration)
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const real = mkPool('aura-s10-B1');
      const slow = {
        query: (t: string, p?: unknown[]) => real.query(t, p),
        connect: async () => {
          const c = await real.connect();
          return { query: async (t: string, p?: unknown[]) => {
            await sleep(150);
            return c.query(t, p as unknown[]);
          }, release: (e?: unknown) => c.release(e as Error | undefined) };
        },
      };
      // Each store call takes ~450 ms (3 round trips) -- under its own 3 s deadline -- so only the budget can stop the sum.
      const s = createPostgresAdapterStore({ db: slow as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(1, { keys, requestBudgetMs: 1000 }, () => ({ adapterStore: s }));
      try {
        const b = new Browser(c.origin, USER_A);
        const verifier = b64(randomBytes(32));
        const qs = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256', state: 's' });
        let worst = 0;
        let last = 0;
        let url2 = `/oauth/authorize?${qs}`;
        for (let i = 0; i < 6; i += 1) {
          const t0 = Date.now();
          const res = await b.fetch(url2);
          worst = Math.max(worst, Date.now() - t0);
          last = res.status;
          await res.text();
          const loc = res.headers.get('location');
          if (res.status >= 300 && res.status < 400 && loc && !loc.startsWith(REDIRECT)) {
            url2 = loc;
            continue;
          }
          break;
        }
        const row = { case: 'B1 request budget 1000 ms, every store call ~450 ms', worstRequestMs: worst, lastStatus: last };
        results.push(row);
        check('B1 every request of the flow is cut by its 1000 ms budget (+ one round trip + slack), never by the sum of per-call deadlines', worst < 1700, row);
        check('B1 a request that runs out of budget answers 503 (fail closed), not a hang or a 500', last === 503, row);
      } finally {
        await c.close();
      }
    }

    // ------------------------------------------------------------------ Hygiene
    {
      const text = JSON.stringify(allAudits);
      check('H1 no authorization code value appears in any audit event', allCodes.length > 0 && allCodes.every((k) => !text.includes(k)), { codes: allCodes.length, audits: allAudits.length });
      const s = createPostgresAdapterStore({ db: mkPool('aura-s10-H1'), fieldKeys: keys.cookieKeys, cleanupEvery: 0 }) as unknown as Record<string, unknown>;
      check('H1 no instance-local hold / revocation machinery remains (holdUnrevoked, pendingRevocations, revokeIssued, activateIssued)', ['holdUnrevoked', 'pendingRevocations', 'revokeIssued', 'activateIssued'].every((k) => s[k] === undefined) && typeof s.beginIssuedActivation === 'function');
    }

    console.log('\nS10 S3-1 results:');
    for (const r of results) console.log(`  ${JSON.stringify(r)}`);
    for (const p of pools) await p.end().catch(() => undefined);
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S10 S3-1 cross-instance code safety DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
