/**
 * AURA-MCP-02-I2b -- offline security tests (no database): the in-memory
 * store implements the same atomic contract as the Postgres adapter, which
 * test/mcpOAuthPostgresDb.test.ts covers against a real database.
 *
 *   F6     atomic single-use codes; replay revokes the grant
 *   refresh issue policy, rotation, replay, idle/absolute expiry
 *   F5     pre-authentication throttling (authorization server and /api/mcp)
 *   R1-L2  client address resolution / proxy-header spoofing
 *   R1-L1  (limiter contract; distributed behaviour in the DB suite)
 *   keys, rotation, ID-token privacy, client policy, readiness preflight,
 *   disconnect, sign-in return, audit redaction, multi-instance (shared store)
 */
import { createPublicKey, generateKeyPairSync } from 'crypto';
import { createMemoryAdapterStore } from '../packages/mcp-tools/src/auth/memoryAdapter';
import { createFieldSealer, FieldSealError } from '../packages/mcp-tools/src/auth/fieldSeal';
import { protectPayload, unprotectPayload } from '../packages/mcp-tools/src/auth/postgresAdapter';
import { ReplayDetectedError } from '../packages/mcp-tools/src/auth/oauthStore';
import { ephemeralOAuthKeys, loadOAuthKeysFromEnv, validateSigningJwks } from '../packages/mcp-tools/src/auth/keys';
import { parseClientRegistry, validateClientRegistry, validateRedirectUri } from '../packages/mcp-tools/src/auth/clientPolicy';
import { handleRemoteMcpRequest, MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { auditUserRef, createRedactingAuditSink, type McpAuditEvent } from '../packages/mcp-tools/src/security/audit';
import { fetchAddressRequest, nodeAddressRequest, normalizeIp, parseClientAddressSource, resolveClientAddress } from '../packages/mcp-tools/src/security/clientAddress';
import { createFixedWindowRateLimiter } from '../packages/mcp-tools/src/security/rateLimit';
import { assessRemoteMcpReadiness } from '../apps/web/lib/mcpRemoteReadiness';
import { safeOAuthReturnTo } from '../apps/web/lib/mcpConnectReturn';
import { Browser, CLIENT, CLIENT_NR, SCOPE_OFFLINE, USER_A, USER_B, authorize, check, connect, redeemCode, refresh, sleep, startCluster, summary, verifyOn, sharedKeys } from './mcpOAuthI2bHarness';

const secrets = new Set<string>();
const captured: string[] = [];
const origLog = console.log;
const audits: McpAuditEvent[] = [];
const auditLines: string[] = [];
const auditKey = 'synthetic-audit-key-0123456789abcdef0123';
const sink = createRedactingAuditSink({ write: (l) => auditLines.push(l), userRefKey: auditKey });
const audit = (e: McpAuditEvent) => {
  audits.push(e);
  sink(e);
};
for (const m of ['info', 'warn', 'error'] as const) {
  const orig = console[m].bind(console);
  console[m] = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
    orig(...args);
  };
}

function decodeJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = jwt.split('.');
  return { header: JSON.parse(Buffer.from(h, 'base64url').toString()), payload: JSON.parse(Buffer.from(p, 'base64url').toString()) };
}

async function main() {
  // ------------------------------------------------------------ F6: atomic consume (store level)
  {
    const store = createMemoryAdapterStore();
    const Codes = new store.factory('AuthorizationCode');
    const Grants = new store.factory('Grant');
    await Grants.upsert('g1', { accountId: USER_A, clientId: CLIENT }, 3600);
    await Codes.upsert('c1', { grantId: 'g1', accountId: USER_A }, 60);
    const results = await Promise.allSettled(Array.from({ length: 25 }, () => Codes.consume('c1')));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const replay = results.filter((r) => r.status === 'rejected' && r.reason instanceof ReplayDetectedError).length;
    check('F6 store: 25 concurrent consumes of one code -> exactly 1 succeeds, 24 replay errors', ok === 1 && replay === 24, { ok, replay });
    check('F6 store: replay revoked the grant behind the code', (await Grants.find('g1')) === undefined);
    const err = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    check('F6 store: replay error is an OAuth invalid_grant', (err.reason as { error?: string }).error === 'invalid_grant');
    await Codes.upsert('c2', { accountId: USER_A }, 1);
    await sleep(1100);
    check('F6 store: an expired code cannot be consumed', await Codes.consume('c2').then(() => false, (e) => e instanceof ReplayDetectedError));
    check('store: expired entries are invisible and cleaned up', (await Codes.find('c2')) === undefined && (await store.cleanupExpired()) >= 1);
  }

  // ------------------------------------------------------------ F6 + multi-instance: concurrent redemption through the token endpoint
  {
    const store = createMemoryAdapterStore();
    const c = await startCluster(3, { adapterStore: store, audit, refreshTokens: { enabled: true } });
    try {
      const b = new Browser(c.origin, USER_A);
      const out = await authorize(c, b, { consent: true });
      check('multi-instance: authorization completes across instances (shared store + keys)', !!out.code, out);
      const reqs = await Promise.all(Array.from({ length: 12 }, () => redeemCode(c, out.code as string, out.verifier)));
      const ok = reqs.filter((r) => r.status === 200);
      const tok = ok[0]?.json.access_token;
      check('F6: 12 concurrent redemptions of one code across 3 instances -> exactly 1 token', ok.length === 1, reqs.map((r) => r.status));
      check('F6: losing redemptions get invalid_grant (400)', reqs.filter((r) => r.status === 400 && r.json.error === 'invalid_grant').length === 11);
      check('F6: replay revoked the grant, so even the winning token is dead', (await verifyOn(c, 0, tok)) === null);
      check('audit: replay detection recorded', audits.some((e) => e.event === 'oauth.replay_detected'));
      const again = await connect(c, USER_A);
      check('F6: a fresh authorization after replay works', again.token?.status === 200 && (await verifyOn(c, 1, again.token.json.access_token)) === USER_A);
      if (again.token?.json.access_token) secrets.add(String(again.token.json.access_token));
      for (const i of [0, 1, 2]) check(`multi-instance: token verifies on instance ${i}`, (await verifyOn(c, i, again.token?.json.access_token)) === USER_A);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ refresh tokens
  {
    const c = await startCluster(2, { audit, refreshTokens: { enabled: true, ttlSeconds: 2, absoluteLifetimeSeconds: 4 } });
    try {
      const plain = await connect(c, USER_A);
      check('refresh: no refresh token without offline_access', plain.token?.status === 200 && plain.token.json.refresh_token === undefined);
      const nr = await connect(c, USER_A, { clientId: CLIENT_NR, scope: SCOPE_OFFLINE });
      check('refresh: no refresh token for a client not allowed to refresh', nr.token?.status === 200 && nr.token.json.refresh_token === undefined);
      const off = await connect(c, USER_A, { scope: SCOPE_OFFLINE });
      check('refresh: consent page says how long it stays connected', /stay connected for up to/.test(off.outcome.consentHtml ?? ''));
      const rt1 = off.token?.json.refresh_token as string;
      check('refresh: allowed client + consented offline_access -> refresh token', typeof rt1 === 'string' && rt1.length > 20, off.token);
      secrets.add(rt1);
      const r1 = await refresh(c, rt1);
      const rt2 = r1.json.refresh_token as string;
      check('refresh: rotation returns a NEW refresh token and a working access token', r1.status === 200 && typeof rt2 === 'string' && rt2 !== rt1 && (await verifyOn(c, 0, r1.json.access_token)) === USER_A, r1);
      secrets.add(rt2);
      const replay = await refresh(c, rt1);
      check('refresh: replaying the rotated refresh token -> invalid_grant', replay.status === 400 && replay.json.error === 'invalid_grant', replay);
      const after = await refresh(c, rt2);
      check('refresh: replay revoked the whole chain (newest refresh token dead too)', after.status === 400, after);
      check('refresh: replay revoked the access token from the rotation', (await verifyOn(c, 1, r1.json.access_token)) === null);
      const conc = await connect(c, USER_B, { scope: SCOPE_OFFLINE });
      const rtB = conc.token?.json.refresh_token as string;
      const racers = await Promise.all(Array.from({ length: 8 }, () => refresh(c, rtB)));
      check('refresh: 8 concurrent uses of one refresh token -> at most 1 success', racers.filter((r) => r.status === 200).length <= 1, racers.map((r) => r.status));
      const idle = await connect(c, USER_A, { scope: SCOPE_OFFLINE });
      await sleep(2300);
      const idleR = await refresh(c, idle.token?.json.refresh_token as string);
      check('refresh: idle-expired refresh token refused', idleR.status === 400, idleR);
      const abs = await connect(c, USER_A, { scope: SCOPE_OFFLINE });
      let rt = abs.token?.json.refresh_token as string;
      let lastStatus = 0;
      for (let i = 0; i < 6; i += 1) {
        await sleep(900);
        const r = await refresh(c, rt);
        lastStatus = r.status;
        if (r.status !== 200) break;
        rt = r.json.refresh_token as string;
      }
      check('refresh: chain refused after the absolute lifetime even when rotated in time', lastStatus === 400, lastStatus);
      check('audit: refresh recorded as oauth.token_refreshed', audits.some((e) => e.event === 'oauth.token_refreshed'));
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ disconnect + connections
  {
    const c = await startCluster(2, { audit, refreshTokens: { enabled: true } });
    try {
      const a = await connect(c, USER_A, { scope: SCOPE_OFFLINE });
      const b = await connect(c, USER_B);
      const listA = await c.instances[1].listUserConnections(USER_A);
      check('connections: list shows the connected client with Aura label', listA.length === 1 && listA[0].clientId === CLIENT && listA[0].label === 'Synthetic I2b client', listA);
      check('connections: another user sees only their own', (await c.instances[0].listUserConnections(USER_B)).every((x) => x.clientId === CLIENT));
      const n = await c.instances[0].revokeUserClientGrants(USER_A, CLIENT);
      check('disconnect: revokes the grant', n === 1);
      check('disconnect: access token dead on every instance', (await verifyOn(c, 0, a.token?.json.access_token)) === null && (await verifyOn(c, 1, a.token?.json.access_token)) === null);
      check('disconnect: refresh token dead', (await refresh(c, a.token?.json.refresh_token as string)).status === 400);
      check("disconnect: other user's token unaffected", (await verifyOn(c, 1, b.token?.json.access_token)) === USER_B);
      check('connections: list empty after disconnect', (await c.instances[1].listUserConnections(USER_A)).length === 0);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ ID-token privacy
  {
    const d = await startCluster(1, { audit });
    try {
      const out = await connect(d, USER_A, { scope: `openid ${MCP_SCOPE}` });
      check('ID token (default "disabled"): openid is stripped -- token issued without openid and without an ID token', out.token?.status === 200 && out.token.json.id_token === undefined && !String(out.token.json.scope).includes('openid'), out.token);
      const plain = await connect(d, USER_A);
      check('ID token (default): MCP scope alone still authorizes', plain.token?.status === 200 && plain.token.json.id_token === undefined);
    } finally {
      await d.close();
    }
    let threw = false;
    try {
      await startCluster(1, { idTokens: 'pairwise', clients: [{ client_id: 'multi-host', label: 'Multi', redirect_uris: ['http://127.0.0.1:8976/cb', 'http://localhost:8976/cb'] }] });
    } catch {
      threw = true;
    }
    check('ID token (pairwise): a client whose redirect URIs span hosts is refused at startup', threw);
    const c = await startCluster(1, { audit, idTokens: 'pairwise' });
    try {
      const a1 = await connect(c, USER_A, { scope: `openid ${MCP_SCOPE}` });
      const a2 = await connect(c, USER_A, { scope: `openid ${MCP_SCOPE}` });
      const nr = await connect(c, USER_A, { scope: `openid ${MCP_SCOPE}`, clientId: CLIENT_NR });
      const t1 = decodeJwt(String(a1.token?.json.id_token));
      const t2 = decodeJwt(String(a2.token?.json.id_token));
      const t3 = decodeJwt(String(nr.token?.json.id_token));
      check('ID token: sub is not the Aura user id', typeof t1.payload.sub === 'string' && t1.payload.sub !== USER_A && !String(a1.token?.json.id_token).includes(USER_A));
      check('ID token: sub is stable for the same client', t1.payload.sub === t2.payload.sub);
      check('ID token: sub differs between clients (pairwise)', t1.payload.sub !== t3.payload.sub);
      check('ID token: no email or profile claims', !('email' in t1.payload) && !('name' in t1.payload));
      check('ID token: signed with the configured first key', t1.header.kid === (c.instances[0] && (await (await fetch(`${c.origin}/oauth/jwks`)).json()).keys[0].kid));
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ key configuration and rotation
  {
    const k1 = ephemeralOAuthKeys().jwks.keys[0];
    const ec = { ...(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'ec-rotation-2', alg: 'ES256' };
    const weak = { ...(generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'weak-rsa-1' };
    const pub = { ...(createPublicKey(generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey).export({ format: 'jwk' }) as Record<string, unknown>), kid: 'public-only' };
    const rejects = (raw: string) => {
      try {
        validateSigningJwks(raw);
        return false;
      } catch {
        return true;
      }
    };
    check('keys: RSA-2048 + EC P-256 rotation set accepted', !rejects(JSON.stringify({ keys: [k1, ec] })));
    check('keys: RSA-1024 rejected', rejects(JSON.stringify({ keys: [weak] })));
    check('keys: public-only key rejected', rejects(JSON.stringify({ keys: [pub] })));
    check('keys: duplicate kid rejected', rejects(JSON.stringify({ keys: [k1, k1] })));
    check('keys: missing kid rejected', rejects(JSON.stringify({ keys: [{ ...k1, kid: undefined }] })));
    check('keys: symmetric (oct/HS256) rejected', rejects(JSON.stringify({ keys: [{ kty: 'oct', k: 'c2VjcmV0', kid: 'hs-key-1', d: 'x' }] })));
    check('keys: garbage rejected', rejects('not json') && rejects('{"keys":[]}'));
    const env = {
      AURA_MCP_OAUTH_JWKS: JSON.stringify({ keys: [ec, k1] }),
      // I2b-S12: the current key declares its format; the retained one stays untagged (legacy compatibility path).
      AURA_MCP_OAUTH_COOKIE_KEYS: `base64url:${Buffer.from('synthetic-cookie-key-new-0123456789abcdef').toString('base64url')},synthetic-cookie-key-old-0123456789abcdef`,
      AURA_MCP_OAUTH_PAIRWISE_SALT: `base64url:${Buffer.from('synthetic-pairwise-salt-0123456789abcdef').toString('base64url')}`,
      AURA_MCP_AUDIT_KEY: `base64url:${Buffer.from('synthetic-audit-key-x-0123456789abcdefgh').toString('base64url')}`,
    };
    const loaded = loadOAuthKeysFromEnv(env);
    check('keys: env loader returns configured material, first key signs', loaded.source === 'configured' && loaded.jwks.keys[0].kid === 'ec-rotation-2' && loaded.cookieKeys.length === 2);
    const throws = (e: Record<string, string>) => {
      try {
        loadOAuthKeysFromEnv(e);
        return false;
      } catch (err) {
        return !String((err as Error).message).includes('synthetic');
      }
    };
    check('keys: short cookie key rejected (and the value is not echoed)', throws({ ...env, AURA_MCP_OAUTH_COOKIE_KEYS: 'short-synthetic' }));
    check('keys: reused secret across roles rejected', throws({ ...env, AURA_MCP_AUDIT_KEY: env.AURA_MCP_OAUTH_PAIRWISE_SALT }));
    // Rotation in practice: old instance signs cookies with key OLD; new instance lists [NEW, OLD] and must accept them.
    const store = createMemoryAdapterStore();
    const base = sharedKeys();
    const oldKeys = { ...base, cookieKeys: ['synthetic-cookie-key-old-0123456789abcdef'] };
    const newKeys = { ...base, cookieKeys: ['synthetic-cookie-key-new-0123456789abcdef', 'synthetic-cookie-key-old-0123456789abcdef'], jwks: { keys: [ec, ...base.jwks.keys] } };
    const cOld = await startCluster(1, { adapterStore: store, keys: oldKeys });
    try {
      const b = new Browser(cOld.origin, USER_A);
      const started = await authorize(cOld, b, { consent: false });
      check('rotation: consent reached on old-key instance', !!started.consentHtml);
      // Swap the instance for one with rotated keys (same issuer/store).
      const { createAuraOAuthServer } = await import('../packages/mcp-tools/src/auth/authorizationServer');
      cOld.instances[0] = createAuraOAuthServer({
        issuer: cOld.origin,
        resourceUrl: cOld.resource,
        clients: [{ client_id: CLIENT, redirect_uris: ['http://127.0.0.1:8976/callback'], label: 'Synthetic I2b client', allow_refresh: true }],
        resolveSessionUser: (req) => {
          const m = /(?:^|;\s*)aura=([A-Za-z0-9-]+)/.exec(String(req.headers.cookie ?? ''));
          return m ? { userId: m[1] } : null;
        },
        adapterStore: store,
        keys: newKeys,
      });
      const csrf = /name="csrf" value="([^"]+)"/.exec(started.consentHtml ?? '')?.[1] as string;
      const action = /action="([^"]+\/confirm)"/.exec(started.consentHtml ?? '')?.[1] as string;
      let res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: cOld.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      for (let i = 0; i < 6 && res.status >= 300 && res.status < 400 && !(res.headers.get('location') ?? '').startsWith('http://127.0.0.1:8976'); i += 1) res = await b.fetch(res.headers.get('location') as string);
      const loc = res.headers.get('location') ?? '';
      check('rotation: an in-flight authorization started under the old cookie key completes after rotation', loc.startsWith('http://127.0.0.1:8976/callback') && new URL(loc).searchParams.has('code'), { status: res.status, loc: loc.slice(0, 60) });
      const jwks = (await (await fetch(`${cOld.origin}/oauth/jwks`)).json()) as { keys: { kid: string; d?: string }[] };
      check('rotation: JWKS publishes new and old signing keys, public parts only', jwks.keys.length === 2 && jwks.keys[0].kid === 'ec-rotation-2' && jwks.keys.every((k) => k.d === undefined));
    } finally {
      await cOld.close();
    }
  }

  // ------------------------------------------------------------ I2b-R1: field sealing (unit)
  {
    const K1 = 'synthetic-field-key-one-0123456789abcdef';
    const K2 = 'synthetic-field-key-two-0123456789abcdef';
    const s1 = createFieldSealer([K1]);
    const aad = 'Interaction\0rowkey\0returnTo';
    const plain = 'http://127.0.0.1:3000/oauth/authorize/SyntheticInteractionUid123';
    const sealed = s1.seal(plain, aad);
    check('I2b-R1 seal: round trip', s1.open(sealed, aad) === plain);
    check('I2b-R1 seal: ciphertext reveals nothing of the identifier', !sealed.includes('SyntheticInteractionUid123') && !sealed.includes('oauth') && sealed.startsWith('v1.'));
    check('I2b-R1 seal: fresh IV per value (same input -> different output)', s1.seal(plain, aad) !== sealed);
    const fails = (fn: () => unknown) => {
      try {
        fn();
        return false;
      } catch (e) {
        return e instanceof FieldSealError;
      }
    };
    const parts = sealed.split('.');
    const flip = (i: number) => parts.map((p, j) => (j === i ? (p[0] === 'A' ? 'B' : 'A') + p.slice(1) : p)).join('.');
    check('I2b-R1 seal: tampered IV / ciphertext / tag each fail closed', fails(() => s1.open(flip(2), aad)) && fails(() => s1.open(flip(3), aad)) && fails(() => s1.open(flip(4), aad)));
    check('I2b-R1 seal: a value moved to another row or field fails (AAD binding)', fails(() => s1.open(sealed, 'Interaction\0otherrow\0returnTo')) && fails(() => s1.open(sealed, 'Session\0rowkey\0state.secret')));
    check('I2b-R1 seal: malformed values fail closed', ['', 'v1', 'v1.a.b.c', 'v2.x.y.z.w', plain].every((v) => fails(() => s1.open(v, aad))));
    check('I2b-R1 seal: without the key a value cannot be opened', fails(() => createFieldSealer([K2]).open(sealed, aad)));
    const rotated = createFieldSealer([K2, K1]);
    check('I2b-R1 seal: rotation -- [new, old] opens values sealed with old', rotated.open(sealed, aad) === plain);
    check('I2b-R1 seal: rotation -- new values use the new key (old-only sealer cannot open them)', fails(() => s1.open(rotated.seal(plain, aad), aad)));
    const refuses = (keys: string[]) => {
      try {
        createFieldSealer(keys);
        return false;
      } catch {
        return true;
      }
    };
    check('I2b-R1 seal: missing, short or duplicate keys refused at construction', refuses([]) && refuses(['short-key']) && refuses([K1, K1]));
    const payload = { returnTo: plain, session: { accountId: USER_A, uid: 'session-uid-1', cookie: 'SyntheticSessionCookieValue99' }, params: { client_id: CLIENT } };
    const prot = protectPayload(s1, 'Interaction', 'rowkey', payload as never);
    const text = JSON.stringify(prot);
    check('I2b-R1 protect: Interaction session.cookie dropped, returnTo sealed, rest unchanged', !text.includes('SyntheticSessionCookieValue99') && !('cookie' in (prot.session as object)) && !text.includes('SyntheticInteractionUid123') && (prot.params as { client_id: string }).client_id === CLIENT && (prot.session as { uid: string }).uid === 'session-uid-1');
    check('I2b-R1 protect: input payload is not mutated', payload.session.cookie === 'SyntheticSessionCookieValue99' && payload.returnTo === plain);
    check('I2b-R1 unprotect: returnTo restored', unprotectPayload(s1, 'Interaction', 'rowkey', prot).returnTo === plain);
    const sess = protectPayload(s1, 'Session', 'srow', { accountId: USER_A, state: { secret: 'SyntheticXsrfSecret42', clientId: CLIENT } } as never);
    check('I2b-R1 protect: Session state.secret sealed and restorable', !JSON.stringify(sess).includes('SyntheticXsrfSecret42') && (unprotectPayload(s1, 'Session', 'srow', sess).state as { secret: string }).secret === 'SyntheticXsrfSecret42');
    check('I2b-R1 unprotect: a plaintext value where a seal is required fails closed', fails(() => unprotectPayload(s1, 'Interaction', 'rowkey', { returnTo: plain } as never)));
    // I2b-RR-1: the library account-switch state (resume.js) carries the resume URL.
    const swState = { secret: 'SyntheticXsrfSecret77', clientId: CLIENT, postLogoutRedirectUri: plain };
    const sw = protectPayload(s1, 'Session', 'srow', { accountId: USER_A, state: swState } as never);
    const swText = JSON.stringify(sw);
    const swBack = unprotectPayload(s1, 'Session', 'srow', sw).state as typeof swState;
    check('I2b-RR-1 protect: Session state.postLogoutRedirectUri sealed (no uid, no URL), clientId unchanged', !swText.includes('SyntheticInteractionUid123') && !swText.includes('oauth') && (sw.state as typeof swState).clientId === CLIENT);
    check('I2b-RR-1 unprotect: both state fields restored exactly', swBack.secret === swState.secret && swBack.postLogoutRedirectUri === plain && swBack.clientId === CLIENT);
    check('I2b-RR-1 unprotect: sealed state fields cannot be swapped (field binding)', fails(() => unprotectPayload(s1, 'Session', 'srow', { state: { secret: (sw.state as typeof swState).postLogoutRedirectUri, postLogoutRedirectUri: (sw.state as typeof swState).secret } } as never)));
    check('I2b-RR-1 unprotect: a plaintext postLogoutRedirectUri fails closed', fails(() => unprotectPayload(s1, 'Session', 'srow', { state: { secret: (sw.state as typeof swState).secret, postLogoutRedirectUri: plain } } as never)));
    check('I2b-RR-1: a Session without state (normal case) still round-trips', (unprotectPayload(s1, 'Session', 'srow', protectPayload(s1, 'Session', 'srow', { accountId: USER_A } as never)) as { accountId: string }).accountId === USER_A);
    // I2b-RR-2: an Interaction must carry its sealed returnTo.
    check('I2b-RR-2 unprotect: an Interaction with no returnTo fails closed (not a half-valid record)', fails(() => unprotectPayload(s1, 'Interaction', 'rowkey', { session: { uid: 'x' } } as never)));
    check('I2b-RR-2 unprotect: null / number / object returnTo fail closed', [null, 42, { url: 'http://attacker.example/' }].every((v) => fails(() => unprotectPayload(s1, 'Interaction', 'rowkey', { returnTo: v } as never))));
  }

  // ------------------------------------------------------------ R1-L2 client address
  {
    const hdr = (h: Record<string, string>) => fetchAddressRequest({ headers: new Headers(h) });
    const real = parseClientAddressSource('header:x-real-ip');
    check('R1-L2: trusted header read when it is a single IP', resolveClientAddress(hdr({ 'x-real-ip': '203.0.113.9' }), real) === '203.0.113.9');
    check('R1-L2: X-Forwarded-For is never used, even if present', resolveClientAddress(hdr({ 'x-forwarded-for': '198.51.100.1' }), real) === null);
    check('R1-L2: Forwarded header is never used', resolveClientAddress(hdr({ forwarded: 'for=198.51.100.1' }), real) === null);
    check('R1-L2: a list in the trusted header (spoof appended) -> null', resolveClientAddress(hdr({ 'x-real-ip': '198.51.100.1, 203.0.113.9' }), real) === null);
    check('R1-L2: repeated trusted header (Node array) -> null', resolveClientAddress(nodeAddressRequest({ headers: { 'x-real-ip': ['1.2.3.4', '5.6.7.8'] } }), real) === null);
    check('R1-L2: garbage / port / empty -> null', ['not-an-ip', '203.0.113.9:443', '', ' '].every((v) => resolveClientAddress(hdr({ 'x-real-ip': v }), real) === null));
    check('R1-L2: IPv4-mapped IPv6 normalised to IPv4 (one bucket)', normalizeIp('::FFFF:203.0.113.9') === '203.0.113.9' && normalizeIp('2001:DB8::1') === '2001:db8::1');
    check('R1-L2: socket mode ignores every header', resolveClientAddress(nodeAddressRequest({ headers: { 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }), { kind: 'socket' }) === '127.0.0.1');
    check('R1-L2: none mode yields no address', resolveClientAddress(hdr({ 'x-real-ip': '203.0.113.9' }), { kind: 'none' }) === null);
    const bad = ['header:x-forwarded-for', 'header:forwarded', 'header:cf-connecting-ip', 'trust-all', 'header:'];
    check('R1-L2: untrusted header names refused at configuration time', bad.every((s) => {
      try {
        parseClientAddressSource(s);
        return false;
      } catch {
        return true;
      }
    }));
  }

  // ------------------------------------------------------------ F5 pre-auth throttle: authorization server
  {
    const limiter = createFixedWindowRateLimiter({ windowMs: 60_000 });
    const c = await startCluster(2, { audit, preAuth: { limiter, addressSource: { kind: 'socket' }, perAddress: 5, global: 12 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await fetch(`${c.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': `10.0.0.${i}`, 'x-real-ip': `10.0.1.${i}` }, body: 'grant_type=authorization_code&code=bogus' })).status);
      check('F5 AS: per-address limit enforced across instances (5 allowed, then 429)', statuses.slice(0, 5).every((s) => s !== 429) && statuses.slice(5).every((s) => s === 429), statuses);
      check('F5 AS: rotating X-Forwarded-For / X-Real-IP does not create new buckets in socket mode', statuses[6] === 429);
      const r = await fetch(`${c.origin}/oauth/authorize`);
      check('F5 AS: throttled response has Retry-After and no body detail', r.status === 429 && Number(r.headers.get('retry-after')) >= 1 && (await r.text()) === '{"error":"rate_limited"}');
      // Another loopback peer address gets its own bucket until the global ceiling.
      c.spoofPeer.address = '::1';
      const other: number[] = [];
      for (let i = 0; i < 7; i += 1) other.push((await fetch(`${c.origin}/.well-known/oauth-authorization-server`)).status);
      c.spoofPeer.address = undefined;
      check('F5 AS: a second client address has its own allowance, then the global ceiling applies', other.slice(0, 5).every((s) => s === 200) && other.slice(5).every((s) => s === 429), other);
      check('audit: throttling recorded', audits.some((e) => e.event === 'oauth.throttled'));
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ F5 pre-auth throttle: /api/mcp, before token verification
  {
    let verifierCalls = 0;
    const limiter = createFixedWindowRateLimiter({ windowMs: 60_000 });
    const config = { resourceUrl: 'http://127.0.0.1:3999/api/mcp', authorizationServer: 'http://127.0.0.1:3999' };
    const call = (addr: string | null) =>
      handleRemoteMcpRequest(new Request(config.resourceUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-invalid-token' }, body: '{}' }), {
        config,
        verifyAccessToken: async () => {
          verifierCalls += 1;
          return null;
        },
        preAuthRateLimiter: limiter,
        clientAddress: addr,
        preAuthLimits: { perAddress: 4, global: 9 },
      });
    const s1: number[] = [];
    for (let i = 0; i < 6; i += 1) s1.push((await call('203.0.113.7')).status);
    check('F5 MCP: invalid-token flood from one address is throttled after 4', s1.slice(0, 4).every((s) => s === 401) && s1.slice(4).every((s) => s === 429), s1);
    check('F5 MCP: throttled requests never reach token verification (no DB lookup)', verifierCalls === 4, verifierCalls);
    const s2: number[] = [];
    for (let i = 0; i < 4; i += 1) s2.push((await call('203.0.113.8')).status);
    check('F5 MCP: another address keeps its own allowance', s2.every((s) => s === 401), s2);
    const s3 = (await call(null)).status;
    const s4 = (await call('203.0.113.99')).status;
    check('F5 MCP: global ceiling caps all addresses together (and address-less requests)', s3 === 401 && s4 === 429, [s3, s4]);
  }

  // ------------------------------------------------------------ client registration policy
  {
    check('policy: https and loopback redirect URIs accepted', [ 'https://assistant.example/cb', 'http://127.0.0.1:8976/cb', 'http://[::1]:5000/x', 'http://localhost:33418/cb' ].every((u) => validateRedirectUri(u) === null));
    check('policy: unsafe redirect URIs rejected', ['http://assistant.example/cb', 'https://a.example/*', 'https://u:p@a.example/cb', 'https://a.example/cb#f', 'javascript:alert(1)', 'http://127.0.0.1/cb', 'custom-scheme://cb'].every((u) => validateRedirectUri(u) !== null));
    check('policy: HTML in label, duplicate ids and unknown fields rejected', validateClientRegistry([{ client_id: 'abc', label: '<b>x</b>', redirect_uris: ['https://a.example/cb'] }]).errors.length > 0
      && validateClientRegistry([{ client_id: 'abc', label: 'A', redirect_uris: ['https://a.example/cb'] }, { client_id: 'abc', label: 'B', redirect_uris: ['https://b.example/cb'] }]).errors.length > 0
      && validateClientRegistry([{ client_id: 'abc', label: 'A', redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'client_secret_basic' }]).errors.length > 0);
    check('policy: valid registry parses', parseClientRegistry(JSON.stringify([{ client_id: 'assistant-one', label: 'Assistant One', redirect_uris: ['https://assistant.example/cb'], allow_refresh: true }])).errors.length === 0);
    let threw = false;
    try {
      await startCluster(1, { clients: [{ client_id: 'bad', label: 'Bad', redirect_uris: ['http://evil.example/cb'] }] });
    } catch {
      threw = true;
    }
    check('policy: the authorization server refuses an invalid client registry at startup', threw);
  }

  // ------------------------------------------------------------ staging readiness preflight (enables nothing)
  {
    const empty = assessRemoteMcpReadiness({});
    check('preflight: empty environment is not ready', !empty.ready && empty.problems.length >= 5, empty.problems);
    const k = ephemeralOAuthKeys();
    const env = {
      AURA_MCP_REMOTE_ENABLED: '1',
      AURA_MCP_RESOURCE_URL: 'https://staging.aura.example/api/mcp',
      AURA_MCP_AUTHORIZATION_SERVER: 'https://staging.aura.example',
      AURA_MCP_OAUTH_STORE: 'postgres',
      AURA_MCP_OAUTH_DATABASE_URL: 'postgresql://synthetic@db.invalid/aura',
      AURA_MCP_CLIENT_ADDRESS_SOURCE: 'header:x-real-ip',
      AURA_MCP_OAUTH_JWKS: JSON.stringify(k.jwks),
      AURA_MCP_OAUTH_COOKIE_KEYS: `base64url:${Buffer.from('synthetic-cookie-key-aaaa-0123456789abcdef').toString('base64url')}`,
      AURA_MCP_OAUTH_PAIRWISE_SALT: `base64url:${Buffer.from('synthetic-pairwise-salt-0123456789abcdef').toString('base64url')}`,
      AURA_MCP_AUDIT_KEY: `base64url:${Buffer.from('synthetic-audit-key-y-0123456789abcdefgh').toString('base64url')}`,
      AURA_MCP_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'assistant-one', label: 'Assistant One', redirect_uris: ['https://assistant.example/cb'] }]),
    };
    const full = assessRemoteMcpReadiness(env);
    check('preflight: complete synthetic staging environment is ready', full.ready, full.problems);
    const noProxy = assessRemoteMcpReadiness({ ...env, AURA_MCP_CLIENT_ADDRESS_SOURCE: 'socket' });
    check('preflight: a deployment without a trusted proxy header is not ready (R1-L2)', !noProxy.ready);
    const memory = assessRemoteMcpReadiness({ ...env, AURA_MCP_OAUTH_STORE: 'memory' });
    check('preflight: in-memory state is not ready (F6 / R1-L1)', !memory.ready);
    const http = assessRemoteMcpReadiness({ ...env, AURA_MCP_RESOURCE_URL: 'http://localhost:3000/api/mcp', AURA_MCP_AUTHORIZATION_SERVER: 'http://localhost:3000' });
    check('preflight: non-https issuer is not ready', !http.ready);
    check('preflight: problems never echo secret values', !JSON.stringify([empty, noProxy, memory, http]).includes('synthetic-cookie-key'));
  }

  // ------------------------------------------------------------ sign-in return + expired session handling
  {
    check('return: only same-origin interaction paths accepted', safeOAuthReturnTo('/oauth/interaction/AbC_d-9') === '/oauth/interaction/AbC_d-9');
    check('return: open-redirect attempts refused', ['https://evil.example/', '//evil.example/x', '/oauth/interaction/../../x', '/oauth/interaction/a%2F..', '/', '/oauth/token', '\\\\evil.example', '/oauth/interaction/a?next=https://evil'].every((v) => safeOAuthReturnTo(v) === null));
    const c = await startCluster(1, { signInUrl: (r) => `/connect/sign-in?returnTo=${encodeURIComponent(r)}`, connectionsUrl: '/connect/apps' });
    try {
      const out = await authorize(c, new Browser(c.origin), { consent: false });
      const link = /href="([^"]+)"/.exec(out.body ?? '')?.[1] ?? '';
      const rt = new URL(link.replace(/&amp;/g, '&'), c.origin).searchParams.get('returnTo');
      check('return: signed-out user gets a sign-in link that returns to this interaction', out.stoppedStatus === 401 && safeOAuthReturnTo(rt) === rt && !!rt, { status: out.stoppedStatus, link });
      const b = new Browser(c.origin, USER_A);
      const consent = await authorize(c, b, { consent: false });
      check('consent: page links to Connected assistants for disconnecting', /href="\/connect\/apps"/.test(consent.consentHtml ?? ''));
      const expired = await b.fetch('/oauth/interaction/does-not-exist');
      check('expired: an unknown/expired interaction explains how to recover', expired.status === 400 && /start connecting again/.test(await expired.text()));
      const denied = await authorize(c, new Browser(c.origin, USER_B), { prompt: 'none' });
      check('failed authorization: prompt=none without consent returns an OAuth error, not a code', !denied.code && !!denied.error, denied);
    } finally {
      await c.close();
    }
  }

  // ------------------------------------------------------------ audit redaction
  {
    const keyed = auditUserRef(USER_A, auditKey);
    check('audit: keyed userRef differs from the unkeyed digest (F10)', keyed !== auditUserRef(USER_A) && keyed.length === 16);
    check('audit: userRef never equals or contains the user id', !auditLines.some((l) => l.includes(USER_A) || l.includes(USER_B)));
    const leaked = [...secrets].filter((s) => s && (auditLines.some((l) => l.includes(s)) || captured.some((l) => l.includes(s))));
    check('audit/logs: no access token, refresh token or code in any audit line or console output', leaked.length === 0, leaked.length);
    check('audit: every audit line is the redacted JSON shape', auditLines.every((l) => /^\{"aura_mcp_audit":\{"ts":"/.test(l)));
  }

  console.log = origLog;
  summary('AURA-MCP-02-I2b offline OAuth security');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
