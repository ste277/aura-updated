/**
 * AURA-MCP-02-I2b-R1 -- sensitive identifier storage (I2b-R-1) against a
 * REAL Postgres database with migrations applied (same requirements and
 * safety rules as test/mcpOAuthPostgresDb.test.ts: disposable DB only; only
 * the two MCP tables are truncated; loopback unless CI=true).
 *
 * Proves, by inspecting the database while flows are in progress:
 *   - no session id, interaction uid (= _interaction / _interaction_resume
 *     cookie values), code, token or cookie value is stored in plaintext;
 *   - Interaction rows carry no `session.cookie` and a SEALED `returnTo`;
 *     Session `state.secret` is sealed;
 *   - I2b-RR-1: on the REAL library account-switch path (resume.js),
 *     Session `state.postLogoutRedirectUri` (the resume URL with the live
 *     uid) is sealed and restores exactly;
 *   - I2b-RR-2: a missing or corrupted Interaction `returnTo` shows the
 *     recovery page (400): no code, no redirect, no 500;
 *   - without the keys the identifiers cannot be recovered;
 *   - tampered, moved or plaintext (unsealed) values fail closed;
 *   - key rotation keeps in-flight interactions working, and removing a key
 *     fails closed;
 *   - sign-in, consent, resume, session continuity/expiry, account switch,
 *     code single-use, refresh rotation/replay, disconnect, multi-instance
 *     all still work; nothing leaks into logs.
 */
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { createAuraOAuthServer } from '../packages/mcp-tools/src/auth/authorizationServer';
import { createPostgresAdapterStore, storageKey } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { Browser, CLIENT, REDIRECT, SCOPE_OFFLINE, USER_A, USER_B, authorize, b64, check, redeemCode, refresh, sharedKeys, startCluster, summary, verifyOn, type Cluster } from './mcpOAuthI2bHarness';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (a disposable database with migrations applied)');
  process.exit(1);
}
if (!['127.0.0.1', 'localhost', '::1'].includes(new URL(url).hostname) && process.env.CI !== 'true') {
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

/** Records every cookie value the server ever sets (provider cookies only). */
class RecordingBrowser extends Browser {
  seen = new Set<string>();
  async fetch(u: string, init: RequestInit = {}): Promise<Response> {
    const res = await super.fetch(u, init);
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const v = pair.slice(pair.indexOf('=') + 1);
      if (v && v.length >= 8) this.seen.add(v);
    }
    return res;
  }
}

const clients = [
  { client_id: CLIENT, redirect_uris: [REDIRECT], label: 'Synthetic I2b client', allow_refresh: true },
];
const resolveSessionUser = (req: { headers: { cookie?: string } }) => {
  const m = /(?:^|;\s*)aura=([A-Za-z0-9-]+)/.exec(String(req.headers.cookie ?? ''));
  return m ? { userId: m[1] } : null;
};

async function main() {
  const pools = [new Pool({ connectionString: url, max: 4 }), new Pool({ connectionString: url, max: 4 })];
  const admin = new Pool({ connectionString: url, max: 2 });
  const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows;
  const dump = async () => JSON.stringify(await q('SELECT * FROM "McpOAuthPayload"'));
  const secrets: string[] = [];
  try {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');
    const keys = sharedKeys();
    const stores = pools.map((db) => createPostgresAdapterStore({ db, fieldKeys: keys.cookieKeys }));
    const c: Cluster = await startCluster(2, { keys, clients, refreshTokens: { enabled: true } }, (i) => ({ adapterStore: stores[i] }));
    try {
      let n = 0;
      c.route.pick = () => n++ % 2;

      // ---------------------------------------------------- pending interaction: inspect the database mid-flow
      const b = new RecordingBrowser(c.origin, USER_A);
      const pending = await authorize(c, b, { consent: false, scope: SCOPE_OFFLINE });
      check('flow: sign-in + consent page reached across instances', !!pending.consentHtml);
      const uid = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(pending.consentHtml ?? '')?.[1] as string;
      secrets.push(uid, ...b.seen);
      const interactions = await q(`SELECT "id", "payload" FROM "McpOAuthPayload" WHERE "model" = 'Interaction'`);
      const pendingRow = interactions.find((r) => r.id === storageKey(uid));
      check('storage: the pending interaction row exists (keyed by hash)', !!pendingRow);
      const d1 = await dump();
      const inClear = secrets.filter((s) => d1.includes(s));
      check('I2b-R-1: no interaction uid, session id or provider cookie value in any stored row', inClear.length === 0, inClear.map((s) => `len${s.length}`));
      check('I2b-R-1: Interaction payloads carry no session.cookie', interactions.every((r) => !r.payload.session || !('cookie' in r.payload.session)));
      check('I2b-R-1: Interaction returnTo is sealed (v1.*), not a URL', interactions.every((r) => typeof r.payload.returnTo === 'string' && r.payload.returnTo.startsWith('v1.') && !r.payload.returnTo.includes('oauth')));

      // Without the keys nothing can be recovered.
      const outsider = createPostgresAdapterStore({ db: admin, fieldKeys: ['synthetic-outsider-key-0123456789abcdefg'] });
      check('I2b-R-1: a store without the keys cannot open the interaction (no returnTo recovered)', (await new outsider.factory('Interaction').find(uid)) === undefined);
      check('storage: with the keys the provider reads it back', (await new stores[1].factory('Interaction').find(uid))?.returnTo === `${c.origin}/oauth/authorize/${uid}`);

      // ---------------------------------------------------- resume completes (sign-in -> consent -> code -> token)
      const csrf = /name="csrf" value="([^"]+)"/.exec(pending.consentHtml ?? '')?.[1] as string;
      let res = await b.fetch(`/oauth/interaction/${uid}/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      for (let i = 0; i < 6 && res.status >= 300 && res.status < 400 && !(res.headers.get('location') ?? '').startsWith(REDIRECT); i += 1) res = await b.fetch(res.headers.get('location') as string);
      const code = new URL(res.headers.get('location') ?? 'http://x/').searchParams.get('code');
      check('flow: interaction resume after consent yields a code (sealed returnTo opened)', !!code);
      const tok = await redeemCode(c, code as string, pending.verifier);
      const at = String(tok.json.access_token);
      const rt = String(tok.json.refresh_token);
      secrets.push(code as string, at, rt, pending.verifier, ...b.seen);
      check('flow: token issued for A, verifies on both instances', (await verifyOn(c, 0, at)) === USER_A && (await verifyOn(c, 1, at)) === USER_A);
      // Refresh rotation / replay first: the code replay below revokes this grant (F6).
      const r1 = await refresh(c, rt);
      check('refresh intact: rotation works', r1.status === 200 && r1.json.refresh_token !== rt, r1.status);
      secrets.push(String(r1.json.refresh_token), String(r1.json.access_token));
      check('refresh intact: replay of the old refresh token -> invalid_grant', (await refresh(c, rt)).json.error === 'invalid_grant');
      check('F6 intact: code replay -> invalid_grant', (await redeemCode(c, code as string, pending.verifier)).json.error === 'invalid_grant');

      // ---------------------------------------------------- session continuity and expiry
      const sessionsBefore = Number((await q(`SELECT count(*) FROM "McpOAuthPayload" WHERE "model" = 'Session' AND "accountId" = $1`, [USER_A]))[0].count);
      const again = await authorize(c, b, { consent: true });
      const sessionsAfter = Number((await q(`SELECT count(*) FROM "McpOAuthPayload" WHERE "model" = 'Session' AND "accountId" = $1`, [USER_A]))[0].count);
      check('session continuity: a second authorization in the same browser reuses the provider session', !!again.code && sessionsAfter === sessionsBefore, { sessionsBefore, sessionsAfter });
      secrets.push(...b.seen);
      const exp = await authorize(c, b, { consent: false });
      const expUid = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(exp.consentHtml ?? '')?.[1] as string;
      await admin.query(`UPDATE "McpOAuthPayload" SET "expiresAt" = now() - interval '1 second' WHERE "model" = 'Interaction' AND "id" = $1`, [storageKey(expUid)]);
      const expRes = await b.fetch(`/oauth/interaction/${expUid}`);
      check('session expiry: an expired interaction shows the recovery page (no code, no 500)', expRes.status === 400 && /start connecting again/.test(await expRes.text()));

      // ---------------------------------------------------- tampering fails closed
      for (const [label, mutate] of [
        ['tampered ciphertext', (v: string) => { const p = v.split('.'); p[3] = (p[3][0] === 'A' ? 'B' : 'A') + p[3].slice(1); return p.join('.'); }],
        ['sealed value moved from another row', null],
        ['plaintext (unsealed) returnTo', () => `${c.origin}/oauth/authorize/attacker-chosen`],
      ] as const) {
        const tb = new RecordingBrowser(c.origin, USER_A);
        const t = await authorize(c, tb, { consent: false });
        const tUid = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(t.consentHtml ?? '')?.[1] as string;
        const row = (await q(`SELECT "payload" FROM "McpOAuthPayload" WHERE "model" = 'Interaction' AND "id" = $1`, [storageKey(tUid)]))[0];
        let next: string;
        if (mutate) next = mutate(row.payload.returnTo);
        else {
          const other = await authorize(c, new Browser(c.origin, USER_A), { consent: false });
          const oUid = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(other.consentHtml ?? '')?.[1] as string;
          next = (await q(`SELECT "payload" FROM "McpOAuthPayload" WHERE "model" = 'Interaction' AND "id" = $1`, [storageKey(oUid)]))[0].payload.returnTo;
        }
        await admin.query(`UPDATE "McpOAuthPayload" SET "payload" = jsonb_set("payload", '{returnTo}', to_jsonb($1::text)) WHERE "model" = 'Interaction' AND "id" = $2`, [next, storageKey(tUid)]);
        const tCsrf = /name="csrf" value="([^"]+)"/.exec(t.consentHtml ?? '')?.[1] as string;
        const r = await tb.fetch(`/oauth/interaction/${tUid}/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(tCsrf)}` });
        const loc = r.headers.get('location') ?? '';
        check(`tamper (${label}): fails closed -- no code, no redirect to an attacker path, no 500`, r.status === 400 && !loc && !/attacker-chosen/.test(loc), { status: r.status, loc });
      }

      // ---------------------------------------------------- account switch (F1) with sealed state
      const shared = new RecordingBrowser(c.origin, USER_A);
      const a1 = await authorize(c, shared, { consent: true });
      shared.jar.set('aura', USER_B);
      const b1 = await authorize(c, shared, { consent: true });
      const bTok = b1.code ? await redeemCode(c, b1.code, b1.verifier) : undefined;
      check('F1 intact: account switch -> B consents and gets B\'s token', !!a1.code && (await verifyOn(c, 0, bTok?.json.access_token)) === USER_B);
      secrets.push(...shared.seen);

      // ---------------------------------------------------- I2b-RR-1: the REAL library account-switch path (resume.js)
      // Tab 1 starts an authorization with no provider session; tab 2 (same browser)
      // completes a connection as A; the user switches Aura to B and resumes tab 1.
      // oidc-provider then writes Session.state = {secret, clientId,
      // postLogoutRedirectUri: <resume URL containing the live uid>}.
      {
        const sb = new RecordingBrowser(c.origin, USER_A);
        const pk = b64(randomBytes(32));
        const aq = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: c.resource, code_challenge: b64(createHash('sha256').update(pk).digest()), code_challenge_method: 'S256', state: 's' });
        const r0 = await sb.fetch(`/oauth/authorize?${aq}`);
        const sUid = (r0.headers.get('location') ?? '').split('/').pop() as string;
        const tab1 = [...sb.jar].filter(([k]) => k.startsWith('_interaction'));
        const tab2 = await authorize(c, sb, { consent: true });
        for (const [k, v] of tab1) sb.jar.set(k, v);
        sb.jar.set('aura', USER_B);
        const g = await sb.fetch(`/oauth/interaction/${sUid}`);
        const rs = g.headers.get('location') ? await sb.fetch(g.headers.get('location') as string) : undefined;
        const rsBody = rs ? await rs.text() : '';
        const xsrf = /name="xsrf" value="([^"]+)"/.exec(rsBody)?.[1];
        secrets.push(sUid, ...sb.seen);
        if (xsrf) secrets.push(xsrf);
        const withState = (await q(`SELECT "id", "payload" FROM "McpOAuthPayload" WHERE "model" = 'Session' AND "payload" ? 'state'`));
        const st = withState[0]?.payload.state ?? {};
        const dSwitch = await dump();
        check('RR-1 setup: the library account-switch path is reached (resume form, no code issued)', !!tab2.code && !!xsrf && withState.length === 1 && !(rs?.headers.get('location') ?? '').startsWith(REDIRECT), { tab2: !!tab2.code, xsrf: !!xsrf, states: withState.length });
        check('RR-1: Session.state.postLogoutRedirectUri is sealed (v1.*), not a URL', typeof st.postLogoutRedirectUri === 'string' && st.postLogoutRedirectUri.startsWith('v1.') && !st.postLogoutRedirectUri.includes('oauth'), typeof st.postLogoutRedirectUri === 'string' ? st.postLogoutRedirectUri.slice(0, 3) : typeof st.postLogoutRedirectUri);
        check('RR-1: the live interaction uid is in no stored row after the real account switch', !dSwitch.includes(sUid));
        check('RR-1: Session.state.secret (real xsrf value) sealed, not in any row', !!xsrf && !dSwitch.includes(xsrf) && String(st.secret).startsWith('v1.'));
        const sid = sb.jar.get('_session') as string;
        const back = (await new stores[1].factory('Session').find(sid)) as { state?: { secret?: string; postLogoutRedirectUri?: string; clientId?: string } } | undefined;
        check('RR-1: both sealed state fields restore exactly on the other instance', back?.state?.secret === xsrf && back?.state?.postLogoutRedirectUri === `${c.origin}/oauth/authorize/${sUid}` && back?.state?.clientId === CLIENT);
        const ROT = 'synthetic-cookie-key-rotated-rr1-0123456789';
        const rotStore = createPostgresAdapterStore({ db: admin, fieldKeys: [ROT, ...keys.cookieKeys] });
        const newOnlyStore = createPostgresAdapterStore({ db: admin, fieldKeys: [ROT] });
        check('RR-1 rotation: [new, old] keys still open the switched Session state', ((await new rotStore.factory('Session').find(sid)) as typeof back)?.state?.postLogoutRedirectUri === `${c.origin}/oauth/authorize/${sUid}`);
        check('RR-1 rotation: with the old key removed the switched Session reads as missing (fail closed)', (await new newOnlyStore.factory('Session').find(sid)) === undefined);
        // Moving the sealed postLogoutRedirectUri into the secret slot (or vice versa) must fail closed.
        await admin.query(`UPDATE "McpOAuthPayload" SET "payload" = jsonb_set("payload", '{state,secret}', "payload"->'state'->'postLogoutRedirectUri') WHERE "id" = $1`, [withState[0].id]);
        check('RR-1: a sealed state field moved to another field fails closed (session reads as missing)', (await new stores[0].factory('Session').find(sid)) === undefined);
        await admin.query(`UPDATE "McpOAuthPayload" SET "payload" = jsonb_set("payload", '{state,postLogoutRedirectUri}', to_jsonb($1::text)) WHERE "id" = $2`, [`${c.origin}/oauth/authorize/attacker-chosen`, withState[0].id]);
        check('RR-1: a plaintext postLogoutRedirectUri fails closed', (await new stores[0].factory('Session').find(sid)) === undefined);
        const after = await sb.fetch(`/oauth/interaction/${sUid}`);
        check('RR-1: the browser continues with no 500 and no attacker redirect after the tampered session', after.status < 500 && !/attacker-chosen/.test(after.headers.get('location') ?? ''), after.status);
      }

      // ---------------------------------------------------- I2b-RR-2: missing / corrupted returnTo -> recovery page, never 500
      for (const [label, sql, value] of [
        ['missing returnTo', `"payload" - 'returnTo'`, null],
        ['returnTo = null', `jsonb_set("payload", '{returnTo}', 'null'::jsonb)`, null],
        ['returnTo = number', `jsonb_set("payload", '{returnTo}', '42'::jsonb)`, null],
        ['returnTo = object', `jsonb_set("payload", '{returnTo}', '{"url":"http://attacker.example/"}'::jsonb)`, null],
        ['returnTo = empty string', `jsonb_set("payload", '{returnTo}', '""'::jsonb)`, null],
        ['returnTo = truncated seal', `jsonb_set("payload", '{returnTo}', to_jsonb(split_part("payload"->>'returnTo', '.', 1) || '.' || split_part("payload"->>'returnTo', '.', 2)))`, null],
      ] as const) {
        void value;
        const mb = new RecordingBrowser(c.origin, USER_A);
        const m = await authorize(c, mb, { consent: false });
        const mUid = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(m.consentHtml ?? '')?.[1] as string;
        await admin.query(`UPDATE "McpOAuthPayload" SET "payload" = ${sql} WHERE "model" = 'Interaction' AND "id" = $1`, [storageKey(mUid)]);
        const mCsrf = /name="csrf" value="([^"]+)"/.exec(m.consentHtml ?? '')?.[1] as string;
        const cr = await mb.fetch(`/oauth/interaction/${mUid}/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(mCsrf)}` });
        const crBody = await cr.text();
        const gr = await mb.fetch(`/oauth/interaction/${mUid}`);
        check(`RR-2 (${label}): confirm and interaction page show the recovery page (400), no code, no redirect, no 500`, cr.status === 400 && /start connecting again/.test(crBody) && !cr.headers.get('location') && gr.status === 400 && !gr.headers.get('location'), { confirm: cr.status, page: gr.status });
        secrets.push(mUid, ...mb.seen);
      }

      // ---------------------------------------------------- Session state.secret sealed (library account-switch form secret)
      const S = new stores[0].factory('Session');
      await S.upsert('synthetic-session-jti-zz9', { uid: 'synthetic-session-uid', accountId: USER_A, state: { secret: 'SyntheticXsrfSecretZZ9', clientId: CLIENT } }, 600);
      check('I2b-R-1: Session state.secret not stored in clear', !(await dump()).includes('SyntheticXsrfSecretZZ9'));
      check('storage: Session state.secret restored on read (by id and by uid)', (await S.find('synthetic-session-jti-zz9') as { state?: { secret?: string } })?.state?.secret === 'SyntheticXsrfSecretZZ9' && (await new stores[1].factory('Session').findByUid('synthetic-session-uid') as { state?: { secret?: string } })?.state?.secret === 'SyntheticXsrfSecretZZ9');

      // ---------------------------------------------------- refresh rotation / replay and disconnect still hold
      const dc = await connectAndDisconnect(c, stores);
      check('disconnect intact: tokens dead on both instances after disconnect', dc);

      // ---------------------------------------------------- final database scan + logs
      const final = await dump();
      const leakedDb = [...new Set(secrets)].filter((s) => s.length >= 8 && final.includes(s));
      check('I2b-R-1 (final scan): no collected identifier, code, token or cookie anywhere in McpOAuthPayload', leakedDb.length === 0, leakedDb.length);
      const leakedLogs = [...new Set(secrets)].filter((s) => s.length >= 8 && captured.some((l) => l.includes(s)));
      check('logs: no identifier, code, token or cookie in console output', leakedLogs.length === 0, leakedLogs.length);
    } finally {
      await c.close();
    }

    // ---------------------------------------------------- key rotation across a deploy (in-flight interaction)
    {
      await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"');
      const base = sharedKeys();
      const OLD = 'synthetic-cookie-key-old-r1-0123456789abcd';
      const NEW = 'synthetic-cookie-key-new-r1-0123456789abcd';
      const oldKeys = { ...base, cookieKeys: [OLD] };
      const newKeys = { ...base, cookieKeys: [NEW, OLD] };
      const newOnly = { ...base, cookieKeys: [NEW] };
      const make = (k: typeof base, issuer: string, resource: string) =>
        createAuraOAuthServer({ issuer, resourceUrl: resource, clients, resolveSessionUser, keys: k, adapterStore: createPostgresAdapterStore({ db: pools[0], fieldKeys: k.cookieKeys }) });
      const c2 = await startCluster(1, { keys: oldKeys, clients }, () => ({ adapterStore: createPostgresAdapterStore({ db: pools[0], fieldKeys: oldKeys.cookieKeys }) }));
      try {
        const step = async (keysAfter: typeof base) => {
          c2.instances[0] = make(oldKeys, c2.origin, c2.resource);
          const br = new Browser(c2.origin, USER_A);
          const p = await authorize(c2, br, { consent: false });
          const u = /action="\/oauth\/interaction\/([^/"]+)\/confirm"/.exec(p.consentHtml ?? '')?.[1] as string;
          c2.instances[0] = make(keysAfter, c2.origin, c2.resource);
          const cs = /name="csrf" value="([^"]+)"/.exec(p.consentHtml ?? '')?.[1] as string;
          let r = await br.fetch(`/oauth/interaction/${u}/confirm`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c2.origin }, body: `csrf=${encodeURIComponent(cs)}` });
          for (let i = 0; i < 6 && r.status >= 300 && r.status < 400 && !(r.headers.get('location') ?? '').startsWith(REDIRECT); i += 1) r = await br.fetch(r.headers.get('location') as string);
          return { status: r.status, code: new URL(r.headers.get('location') ?? 'http://x/').searchParams.get('code') };
        };
        const rotated = await step(newKeys);
        check('rotation: interaction sealed under the old key completes after rotation to [new, old]', !!rotated.code, rotated);
        const removed = await step(newOnly);
        check('rotation: after the old key is removed, an old in-flight interaction fails closed (no code, no 500)', !removed.code && removed.status >= 400 && removed.status < 500, removed);
      } finally {
        await c2.close();
      }
    }

    // ---------------------------------------------------- missing / invalid keys prevent operation
    const refuses = (k: string[]) => {
      try {
        createPostgresAdapterStore({ db: admin, fieldKeys: k });
        return false;
      } catch {
        return true;
      }
    };
    check('keys: the durable store refuses to start without field keys, with short keys or duplicates', refuses([]) && refuses(['short']) && refuses(['synthetic-dup-key-0123456789abcdefghij', 'synthetic-dup-key-0123456789abcdefghij']) && refuses(undefined as never));
  } finally {
    await admin.query('TRUNCATE "McpOAuthPayload", "McpRateLimitWindow"').catch(() => undefined);
    await Promise.all([...pools, admin].map((p) => p.end().catch(() => undefined)));
  }
  summary('AURA-MCP-02-I2b-R1 storage protection DB');
}

async function connectAndDisconnect(c: Cluster, stores: { revokeUserClientGrants(u: string, cl: string): Promise<number> }[]): Promise<boolean> {
  const br = new Browser(c.origin, USER_B);
  const out = await authorize(c, br, { consent: true, scope: SCOPE_OFFLINE });
  if (!out.code) return false;
  const t = await redeemCode(c, out.code, out.verifier);
  const ok = (await verifyOn(c, 0, t.json.access_token)) === USER_B;
  await c.instances[1].revokeUserClientGrants(USER_B, CLIENT);
  void stores;
  return ok && (await verifyOn(c, 0, t.json.access_token)) === null && (await verifyOn(c, 1, t.json.access_token)) === null && (await refresh(c, String(t.json.refresh_token))).status === 400;
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : 'error');
  process.exit(1);
});
