/**
 * AURA-MCP-02-I2b-S6 -- authorization-code lifecycle under ambiguous store
 * outcomes and interrupted responses, against a REAL disposable Postgres
 * (migration 0052). Synthetic users/clients only.
 *
 * The S4 design writes a code PENDING and activates it only once the
 * response that carries it has succeeded. S5 found that an activation whose
 * COMMIT lands while the application sees an error (lost acknowledgement,
 * timeout) left an ACTIVE code behind a 503, because the failure path only
 * deleted PENDING rows. These cases drive the real provider flow and fault
 * the activation transaction at the wire:
 *
 *   1  Session write fails after the code is created
 *   2  activation fails before COMMIT
 *   3  activation COMMIT lands, acknowledgement lost
 *   4  activation outcome uncertain (app gives up, COMMIT lands later)
 *   5  cleanup (revocation) fails too: 2+5 and 3+5
 *   6  client disconnects before activation
 *   7  client disconnects after activation committed, before the response
 *   8  concurrent flows, every other activation ack-lost
 *   9  correct and incorrect PKCE verifier
 *  10  normal flow and token exchange
 *
 * For every case: HTTP outcome (server status vs client-side abort), whether
 * the code left the server, the code's database state, and whether
 * redeeming the real code (captured with a test-only spy, i.e. with
 * knowledge only the server has) with the right PKCE verifier succeeds.
 *
 * Needs DATABASE_URL pointing at a DISPOSABLE database with the migrations
 * applied. Truncates the two MCP tables only; refuses a non-loopback database
 * outside CI.
 */
import { createHash, randomBytes } from 'crypto';
import { Pool, type PoolClient } from 'pg';
import { createPostgresAdapterStore } from '../packages/mcp-tools/src/auth/postgresAdapter';
import type { OAuthStore } from '../packages/mcp-tools/src/auth/oauthStore';
import { MCP_PG_POOL_BOUNDS } from '../packages/mcp-tools/src/security/deadline';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import type { McpAuditEvent } from '../packages/mcp-tools/src/security/audit';
import { Browser, CLIENT, REDIRECT, USER_A, b64, check, redeemCode, sharedKeys, sleep, startCluster, summary, type Cluster } from './mcpOAuthI2bHarness';

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

type ActivationFault = 'none' | 'update-reject' | 'ack-lost' | 'uncertain';
interface Faults {
  activation: ActivationFault;
  /** Apply the activation fault only to every Nth activation (1 = all). */
  everyNth: number;
  sessionRejectAfterCode: boolean;
  revokeFails: boolean;
  onActivationStart?: () => void;
  onActivationCommitted?: () => Promise<void>;
}
const isActivation = (t: string, p?: unknown[]) => /^\s*UPDATE/i.test(t) && p?.[0] === 'AuthorizationCode' && t.includes('auraIssuePending');

/** A pg Pool whose clients fault the activation transaction (and optionally Session / code DELETE) at the wire. */
function faultPool(real: Pool, f: Faults) {
  const st = { codeWritten: false, sessionFired: false, activations: 0, uncertainCommits: [] as Promise<unknown>[] };
  const pool = {
    query: (t: string, p?: unknown[]) => real.query(t, p),
    connect: async () => {
      const c: PoolClient = await real.connect();
      let activationTx: ActivationFault | undefined;
      let deferred: Promise<unknown> | undefined;
      return {
        query: async (text: string, params?: unknown[]) => {
          const model = String(params?.[0] ?? '');
          if (/^\s*INSERT/i.test(text) && model === 'AuthorizationCode') st.codeWritten = true;
          if (f.sessionRejectAfterCode && st.codeWritten && !st.sessionFired && model === 'Session' && /^\s*INSERT/i.test(text)) {
            st.sessionFired = true;
            throw new Error('injected session fault');
          }
          if (f.revokeFails && model === 'AuthorizationCode' && /^\s*DELETE/i.test(text)) throw new Error('injected revoke fault');
          if (isActivation(text, params)) {
            st.activations += 1;
            activationTx = st.activations % f.everyNth === 0 ? f.activation : 'none';
            f.onActivationStart?.();
            if (activationTx === 'update-reject') throw new Error('injected activation fault');
          }
          if (/^\s*COMMIT/i.test(text) && activationTx) {
            const mode = activationTx;
            activationTx = undefined;
            if (mode === 'uncertain') {
              // The application gives up now; the server commits 300 ms later.
              deferred = sleep(300).then(() => c.query('COMMIT'));
              st.uncertainCommits.push(deferred);
              throw new Error('injected commit timeout (outcome unknown)');
            }
            const r = await c.query('COMMIT');
            if (f.onActivationCommitted) await f.onActivationCommitted();
            if (mode === 'ack-lost') throw new Error('injected lost COMMIT acknowledgement');
            return r;
          }
          return c.query(text, params as unknown[]);
        },
        release: (err?: unknown) => {
          // A deferred COMMIT must reach the server before the connection goes.
          if (deferred) void deferred.finally(() => c.release(err as Error | undefined));
          else c.release(err as Error | undefined);
        },
      };
    },
  };
  return { pool, st };
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

interface FlowResult {
  seen: { status: number; headers: string; body: string }[];
  verifier: string;
  delivered: string | null;
  /** 'server <status>' or 'client aborted' (connection closed by the client before a response). */
  outcome: string;
}
/** Drives the browser flow. `ctl.abort` can be called by a fault hook to drop the in-flight request client-side. */
async function flow(origin: string, resource: string, ctl: { current?: AbortController } = {}): Promise<FlowResult> {
  const b = new Browser(origin, USER_A);
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  const seen: FlowResult['seen'] = [];
  const go = async (u: string, init: RequestInit = {}) => {
    ctl.current = new AbortController();
    return b.fetch(u, { ...init, signal: ctl.current.signal });
  };
  try {
    let res = await go(`/oauth/authorize?${q}`);
    for (let i = 0; i < 14; i += 1) {
      const body = await res.text();
      seen.push({ status: res.status, headers: JSON.stringify([...res.headers]), body });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        if (loc.startsWith(REDIRECT)) return { seen, verifier, delivered: new URL(loc).searchParams.get('code'), outcome: `server ${res.status}` };
        res = await go(loc);
        continue;
      }
      if (res.status === 200 && /name="csrf"/.test(body)) {
        const csrf = /name="csrf" value="([^"]+)"/.exec(body)?.[1] as string;
        const action = /action="([^"]+\/confirm)"/.exec(body)?.[1] as string;
        res = await go(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin }, body: `csrf=${encodeURIComponent(csrf)}` });
        continue;
      }
      return { seen, verifier, delivered: null, outcome: `server ${res.status}` };
    }
    return { seen, verifier, delivered: null, outcome: 'loop' };
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message))) return { seen, verifier, delivered: null, outcome: 'client aborted' };
    throw e;
  }
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
  const codeStates = async () => {
    const rows = await q(`SELECT ("payload" ? 'auraIssuePending') AS pending, "consumedAt" IS NOT NULL AS consumed FROM "McpOAuthPayload" WHERE "model" = 'AuthorizationCode'`);
    return rows.map((r) => (r.consumed ? 'consumed' : r.pending ? 'pending' : 'active'));
  };
  const tokenCount = async () => Number((await q(`SELECT count(*)::int AS n FROM "McpOAuthPayload" WHERE "model" IN ('AccessToken','RefreshToken')`))[0].n);
  const table: Record<string, unknown>[] = [];

  async function runCase(name: string, faults: Partial<Faults>, setup?: (ctl: { current?: AbortController }) => Partial<Faults>) {
    await admin.query('TRUNCATE "McpOAuthPayload"');
    const ctl: { current?: AbortController } = {};
    const f: Faults = { activation: 'none', everyNth: 1, sessionRejectAfterCode: false, revokeFails: false, ...faults, ...(setup ? setup(ctl) : {}) };
    const real = mkPool(`aura-s6-${name.replace(/\W+/g, '-').slice(0, 40)}`);
    const { pool, st } = faultPool(real, f);
    const { store, codes } = spyCodes(createPostgresAdapterStore({ db: pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0 }));
    const audits: McpAuditEvent[] = [];
    const c = await startCluster(1, { keys, audit: (e) => audits.push(e) }, () => ({ adapterStore: store }));
    try {
      const out = await flow(c.origin, c.resource, ctl);
      await Promise.allSettled(st.uncertainCommits);
      await sleep(1200); // let the server-side middleware finish after a client abort
      const code = codes[0];
      const exposed = !!code && out.seen.some((r) => r.headers.includes(code) || r.body.includes(code));
      const states = await codeStates();
      const tok = code ? await redeemCode(c, code, out.verifier) : undefined;
      const row = {
        case: name,
        outcome: out.outcome,
        exposed,
        dbBeforeRedeem: states.join(',') || 'absent',
        redeemWithServerKnownCode: tok?.status ?? 'n/a',
        tokenIssued: !!tok?.json.access_token,
        tokensInDb: await tokenCount(),
        audits: audits.filter((a) => /Code/.test(String(a.errorCode))).map((a) => a.errorCode),
      };
      table.push(row);
      return { row, out, code, c };
    } finally {
      await c.close();
    }
  }

  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');

    // 10. normal flow
    {
      const { row, out } = await runCase('10 normal flow', {});
      check('10 normal: code delivered in a redirect and stored active (no pending marker)', out.delivered !== null && /^server 30\d$/.test(row.outcome) && row.dbBeforeRedeem === 'active', row);
      check('10 normal: redemption issues exactly one token pair', row.redeemWithServerKnownCode === 200 && row.tokenIssued === true, row);
    }

    // 1. Session write fails after the code is created
    {
      const { row } = await runCase('1 session write fails after code', { sessionRejectAfterCode: true });
      check('1 session fault: >= 400, code not exposed, not redeemable, no token', /server [45]\d\d/.test(row.outcome) && !row.exposed && row.redeemWithServerKnownCode === 400 && !row.tokenIssued && row.tokensInDb === 0, row);
    }

    // 2. activation fails before COMMIT
    {
      const { row } = await runCase('2 activation fails before COMMIT', { activation: 'update-reject' });
      check('2 activation pre-COMMIT fault: 503, code not exposed, code removed, not redeemable', row.outcome === 'server 503' && !row.exposed && row.dbBeforeRedeem === 'absent' && row.redeemWithServerKnownCode === 400 && !row.tokenIssued, row);
    }

    // 3. activation COMMIT lands, acknowledgement lost
    {
      const { row } = await runCase('3 activation COMMIT ack lost', { activation: 'ack-lost' });
      check('3 ack lost: 503, code not exposed, the committed activation is revoked (code absent), not redeemable', row.outcome === 'server 503' && !row.exposed && row.dbBeforeRedeem === 'absent' && row.redeemWithServerKnownCode === 400 && !row.tokenIssued && row.tokensInDb === 0, row);
    }

    // 4. activation outcome uncertain: app gives up, COMMIT lands 300 ms later
    {
      const { row } = await runCase('4 activation outcome uncertain', { activation: 'uncertain' });
      check('4 uncertain: 503, code not exposed, revocation ordered after the late COMMIT (code absent), not redeemable', row.outcome === 'server 503' && !row.exposed && row.dbBeforeRedeem === 'absent' && row.redeemWithServerKnownCode === 400 && !row.tokenIssued, row);
    }

    // 5. cleanup failure
    {
      const a = await runCase('5a pre-COMMIT fault + revoke fails', { activation: 'update-reject', revokeFails: true });
      check('5a revoke fails after a pre-COMMIT activation fault: 503, not exposed, code stays PENDING, not redeemable', a.row.outcome === 'server 503' && !a.row.exposed && a.row.dbBeforeRedeem === 'pending' && a.row.redeemWithServerKnownCode === 400, a.row);
      const b = await runCase('5b ack lost + revoke fails (residual)', { activation: 'ack-lost', revokeFails: true });
      check('5b ack lost and revoke fails: 503 and the code never leaves the server (it is the documented residual: active until its 60 s TTL)', b.row.outcome === 'server 503' && !b.row.exposed, b.row);
      check('5b the failed revocation is audited without the code value', (b.row.audits as string[]).includes('CodeRevocationFailed'), b.row);
    }

    // 6. client disconnects before activation
    {
      const { row } = await runCase('6 client disconnect before activation', {}, (ctl) => ({ onActivationStart: () => ctl.current?.abort() }));
      check('6 disconnect before activation: client-side abort, no code received, code absent, not redeemable', row.outcome === 'client aborted' && !row.exposed && row.dbBeforeRedeem === 'absent' && row.redeemWithServerKnownCode === 400 && !row.tokenIssued, row);
    }

    // 7. client disconnects after activation committed, before the response is written
    {
      const { row } = await runCase('7 disconnect after activation', {}, (ctl) => ({
        onActivationCommitted: async () => {
          ctl.current?.abort();
          await sleep(200);
        },
      }));
      check('7 disconnect after activation: client-side abort, the activated code is revoked (absent), not redeemable', row.outcome === 'client aborted' && !row.exposed && row.dbBeforeRedeem === 'absent' && row.redeemWithServerKnownCode === 400 && !row.tokenIssued, row);
    }

    // 8. concurrent flows; every other activation loses its COMMIT acknowledgement
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const real = mkPool('aura-s6-concurrent');
      const { pool } = faultPool(real, { activation: 'ack-lost', everyNth: 2, sessionRejectAfterCode: false, revokeFails: false });
      const { store, codes } = spyCodes(createPostgresAdapterStore({ db: pool as never, fieldKeys: keys.cookieKeys, cleanupEvery: 0 }));
      const c: Cluster = await startCluster(2, { keys }, () => ({ adapterStore: store }));
      try {
        const outs = await Promise.all(Array.from({ length: 8 }, () => flow(c.origin, c.resource)));
        const delivered = outs.filter((o) => o.delivered);
        const failed = outs.filter((o) => !o.delivered);
        const states = await codeStates();
        const okRedeem = await Promise.all(delivered.map((o) => redeemCode(c, o.delivered as string, o.verifier)));
        const undelivered = codes.filter((k) => !outs.some((o) => o.delivered === k));
        const leaked = undelivered.some((k) => outs.some((o) => o.seen.some((r) => r.headers.includes(k) || r.body.includes(k))));
        // The code-to-flow mapping of undelivered codes is unknown: try every failed flow's verifier.
        const badRedeem: { status: number }[] = [];
        for (const k of undelivered) {
          const tries = await Promise.all(failed.map((o) => redeemCode(c, k, o.verifier)));
          badRedeem.push(tries.find((t) => t.status === 200) ?? tries[0] ?? { status: 0 });
        }
        const tokens = await tokenCount();
        const row = { case: '8 concurrent (8 flows, 2 instances, every 2nd activation ack-lost)', delivered: delivered.length, failed503: failed.filter((o) => o.outcome === 'server 503').length, dbAfterFlows: states.join(','), deliveredRedeemed200: okRedeem.filter((r) => r.status === 200).length, undeliveredRedeemed: badRedeem.map((r) => r.status).join(','), leaked, tokensInDb: tokens };
        table.push(row);
        check('8 concurrent: 4 delivered and 4 failed with 503 (faults hit only their own flow)', delivered.length === 4 && failed.length === 4 && row.failed503 === 4, row);
        check('8 concurrent: every delivered code redeems to 200; no undelivered code leaked or redeems; tokens only for delivered codes', okRedeem.every((r) => r.status === 200) && undelivered.length === 4 && badRedeem.every((r) => r.status === 400) && !leaked && tokens === 4 * (okRedeem[0]?.json.refresh_token ? 2 : 1), row);
      } finally {
        await c.close();
      }
    }

    // 9. PKCE: wrong verifier refused; right verifier on a fresh code works
    {
      await admin.query('TRUNCATE "McpOAuthPayload"');
      const real = mkPool('aura-s6-pkce');
      const store = createPostgresAdapterStore({ db: real, fieldKeys: keys.cookieKeys, cleanupEvery: 0 });
      const c = await startCluster(1, { keys }, () => ({ adapterStore: store }));
      try {
        const a = await flow(c.origin, c.resource);
        const wrong = await redeemCode(c, a.delivered as string, b64(randomBytes(32)));
        const b = await flow(c.origin, c.resource);
        const right = await redeemCode(c, b.delivered as string, b.verifier);
        table.push({ case: '9 PKCE', wrongVerifier: wrong.status, wrongToken: !!wrong.json.access_token, rightVerifier: right.status, rightToken: !!right.json.access_token });
        check('9 PKCE: an incorrect verifier is refused (400, no token)', wrong.status === 400 && !wrong.json.access_token, wrong);
        check('9 PKCE: the correct verifier redeems (200 + token)', right.status === 200 && !!right.json.access_token, right.status);
      } finally {
        await c.close();
      }
    }

    console.log('\nS6 results:');
    for (const r of table) console.log(`  ${JSON.stringify(r)}`);
    for (const p of pools) await p.end().catch(() => undefined);
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  summary('AURA-MCP-02-I2b-S6 authorization-code lifecycle DB');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}\n${err.stack}` : 'error');
  process.exit(1);
});
