/**
 * AURA-MCP-02-I2a -- local OAuth authorization server -> remote MCP, offline.
 *
 * Runs the real `oidc-provider` based authorization server
 * (packages/mcp-tools/src/auth/authorizationServer.ts) on an ephemeral
 * 127.0.0.1 port, drives a full Authorization Code + PKCE flow with a
 * synthetic user and synthetic public clients, then calls the remote MCP
 * handler with the issued token. No network beyond loopback, no database,
 * no environment variables, no real credentials.
 *
 * Also covers the environment gate (apps/web/lib/mcpAuthGate.ts): Production,
 * staging and every other Vercel deployment, and any production build,
 * always resolve to reject-all.
 */
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { createHash, createHmac, randomBytes } from 'crypto';
import type { AddressInfo } from 'net';
import { createAuraOAuthServer, type AuraOAuthServer } from '../packages/mcp-tools/src/auth/authorizationServer';
import { handleRemoteMcpRequest, MCP_SCOPE, parseRemoteMcpConfig, rejectAllAccessTokens, type RemoteMcpDeps } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { createFixedWindowRateLimiter } from '../packages/mcp-tools/src/security/rateLimit';
import { createRedactingAuditSink, auditUserRef } from '../packages/mcp-tools/src/security/audit';
import { resolveMcpAuthMode, PRODUCTION_PROJECT_ID, STAGING_PROJECT_IDS } from '../apps/web/lib/mcpAuthGate';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count += 1;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 500)}` : ''}`);
  if (!condition) allPassed = false;
}
const ROOT = path.resolve(__dirname, '..');

// ------------------------------------------------------------------ synthetic fixtures
const USER_A = 'synthetic-user-a-0001';
const USER_B = 'synthetic-user-b-0002';
const CLIENT = 'synthetic-mcp-client';
const OTHER_CLIENT = 'synthetic-other-client';
const AS_ONLY_CLIENT = 'synthetic-as-only-client'; // registered at the AS, not accepted by the resource
const REDIRECT = 'http://127.0.0.1:8976/callback';
const SECRET_TASK = 'synthetic-secret-task-title-zq81';

interface Harness {
  as: AuraOAuthServer;
  origin: string;
  resource: string;
  close(): Promise<void>;
  auditLines: string[];
}

async function startHarness(opts: { ttl?: number; limit?: number } = {}): Promise<Harness> {
  let as: AuraOAuthServer | null = null;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void as!.handle(req, res, url.pathname, url.search);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const auditLines: string[] = [];
  as = createAuraOAuthServer({
    issuer: origin,
    resourceUrl: `${origin}/api/mcp`,
    clients: [
      { client_id: CLIENT, redirect_uris: [REDIRECT], label: 'Synthetic MCP client' },
      { client_id: OTHER_CLIENT, redirect_uris: [REDIRECT], label: 'Other synthetic client' },
      { client_id: AS_ONLY_CLIENT, redirect_uris: [REDIRECT], label: 'AS-only synthetic client' },
    ],
    resourceAllowedClientIds: [CLIENT, OTHER_CLIENT],
    // Synthetic stand-in for Aura's `as_session` verifier: the cookie value is the user id.
    resolveSessionUser: (req) => {
      const m = /(?:^|;\s*)test_session=([A-Za-z0-9-]+)/.exec(String(req.headers.cookie ?? ''));
      return m ? { userId: m[1] } : null;
    },
    accessTokenTtlSeconds: opts.ttl ?? 600,
    audit: createRedactingAuditSink({ write: (l) => auditLines.push(l), knownTools: ['find_best_time'] }),
  });
  return {
    as,
    origin,
    resource: `${origin}/api/mcp`,
    auditLines,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// ------------------------------------------------------------------ tiny cookie-aware client
class Browser {
  jar = new Map<string, string>();
  constructor(private readonly origin: string, session?: string) {
    if (session) this.jar.set('test_session', session);
  }
  cookie(): string {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(url, this.origin), { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), cookie: this.cookie() } });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      const value = pair.slice(i + 1);
      if (/expires=Thu, 01 Jan 1970/i.test(sc) || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
}

const b64url = (b: Buffer) => b.toString('base64url');
function pkcePair() {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
}

interface AuthorizeResult {
  code?: string;
  error?: string;
  location?: string;
  status: number;
  iss?: string;
  state?: string;
}

/** Drives authorize -> login -> consent -> callback. Stops at the first non-redirect. */
async function authorize(
  h: Harness,
  browser: Browser,
  params: Record<string, string | undefined>,
  consent: 'confirm' | 'abort' | 'none' = 'confirm',
): Promise<AuthorizeResult> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, v);
  let res = await browser.fetch(`/oauth/authorize?${q}`);
  for (let hop = 0; hop < 12; hop += 1) {
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      if (location.startsWith(REDIRECT)) {
        const cb = new URL(location);
        return { status: res.status, location, code: cb.searchParams.get('code') ?? undefined, error: cb.searchParams.get('error') ?? undefined, iss: cb.searchParams.get('iss') ?? undefined, state: cb.searchParams.get('state') ?? undefined };
      }
      res = await browser.fetch(location);
      continue;
    }
    if (res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html')) {
      const html = await res.text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const action = consent === 'abort' ? /action="([^"]+\/abort)"/.exec(html)?.[1] : /action="([^"]+\/confirm)"/.exec(html)?.[1];
      if (!csrf || !action || consent === 'none') return { status: res.status, error: 'consent_page' };
      res = await browser.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      continue;
    }
    return { status: res.status, error: `stopped_${res.status}` };
  }
  return { status: 0, error: 'too_many_hops' };
}

async function token(h: Harness, body: Record<string, string | undefined>): Promise<{ status: number; json: any }> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) if (v !== undefined) form.set(k, v);
  const res = await fetch(`${h.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function fullFlow(h: Harness, user = USER_A, clientId = CLIENT): Promise<{ accessToken?: string; tokenResponse: any; auth: AuthorizeResult; verifier: string }> {
  const pkce = pkcePair();
  const browser = new Browser(h.origin, user);
  const auth = await authorize(h, browser, {
    client_id: clientId,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: MCP_SCOPE,
    resource: h.resource,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    state: 'synthetic-state-1',
  });
  if (!auth.code) return { tokenResponse: null, auth, verifier: pkce.verifier };
  const t = await token(h, { grant_type: 'authorization_code', code: auth.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce.verifier, resource: h.resource });
  return { accessToken: t.json?.access_token, tokenResponse: t, auth, verifier: pkce.verifier };
}

// ------------------------------------------------------------------ MCP calls
const ACCEPT = 'application/json, text/event-stream';
function mcpDeps(h: Harness, extra: Partial<RemoteMcpDeps> = {}): RemoteMcpDeps {
  return {
    config: { resourceUrl: h.resource, authorizationServer: h.origin },
    verifyAccessToken: h.as.verifyAccessToken,
    isClientAllowed: h.as.isClientAllowed,
    now: () => new Date('2026-11-21T09:00:00.000Z'),
    audit: createRedactingAuditSink({ write: (l) => h.auditLines.push(l), knownTools: ['find_best_time'] }),
    ...extra,
  };
}
async function mcp(h: Harness, accessToken: string | null, method: string, params: unknown, extra: Partial<RemoteMcpDeps> = {}): Promise<{ status: number; body: any; headers: Headers }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: ACCEPT, 'mcp-protocol-version': '2025-11-25' };
  if (accessToken !== null) headers.authorization = `Bearer ${accessToken}`;
  const res = await handleRemoteMcpRequest(new Request(h.resource, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }), mcpDeps(h, extra));
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, headers: res.headers };
}
const FIND_ARGS = {
  taskTitle: SECRET_TASK,
  durationMinutes: 30,
  location: { latitude: 13.0827, longitude: 80.2707 },
  timezone: 'Asia/Kolkata',
  horizon: 'TOMORROW',
  referenceTime: '2026-11-21T09:00:00+05:30',
};

function hs256Jwt(claims: Record<string, unknown>, key: Buffer): string {
  const enc = (o: unknown) => b64url(Buffer.from(JSON.stringify(o)));
  const head = enc({ alg: 'HS256', typ: 'at+jwt' });
  const body = enc(claims);
  return `${head}.${body}.${b64url(createHmac('sha256', key).update(`${head}.${body}`).digest())}`;
}

async function main(): Promise<void> {
  const h = await startHarness();
  try {
    // ---------------------------------------------------------- discovery
    const d8414 = await fetch(`${h.origin}/.well-known/oauth-authorization-server`);
    const meta = await d8414.json();
    const dOidc = await (await fetch(`${h.origin}/.well-known/openid-configuration`)).json();
    check('discovery: RFC 8414 URL serves metadata (200)', d8414.status === 200 && meta.issuer === h.origin, meta);
    check('discovery: OIDC URL serves the same document', JSON.stringify(dOidc) === JSON.stringify(meta));
    check('discovery: authorization + token + revocation endpoints under /oauth', meta.authorization_endpoint === `${h.origin}/oauth/authorize` && meta.token_endpoint === `${h.origin}/oauth/token` && meta.revocation_endpoint === `${h.origin}/oauth/revoke`, meta);
    check('discovery: PKCE S256 only', JSON.stringify(meta.code_challenge_methods_supported) === '["S256"]', meta.code_challenge_methods_supported);
    check('discovery: code flow only, no implicit/hybrid', JSON.stringify(meta.response_types_supported) === '["code"]' && JSON.stringify(meta.grant_types_supported) === '["authorization_code"]', [meta.response_types_supported, meta.grant_types_supported]);
    check('discovery: public clients only (token auth "none")', JSON.stringify(meta.token_endpoint_auth_methods_supported) === '["none"]', meta.token_endpoint_auth_methods_supported);
    check('discovery: RFC 9207 iss parameter advertised', meta.authorization_response_iss_parameter_supported === true);
    check('discovery: no userinfo, registration, end-session, introspection, PAR or device endpoints', !meta.userinfo_endpoint && !meta.registration_endpoint && !meta.end_session_endpoint && !meta.introspection_endpoint && !meta.pushed_authorization_request_endpoint && !meta.device_authorization_endpoint, Object.keys(meta));
    // oidc-provider lists only OIDC scopes here; the resource scope is
    // advertised by the RFC 9728 protected resource metadata and the 401
    // WWW-Authenticate challenge (remoteMcpHandler).
    check('discovery: scopes_supported advertises no extra scopes', JSON.stringify(meta.scopes_supported) === '["openid"]', meta.scopes_supported);
    const jwks = await (await fetch(`${h.origin}/oauth/jwks`)).json();
    check('discovery: JWKS exposes public key material only', jwks.keys.length === 1 && !('d' in jwks.keys[0]) && !('p' in jwks.keys[0]), Object.keys(jwks.keys[0]));
    const userinfo = await fetch(`${h.origin}/me`);
    check('surface: default userinfo route is not mounted (404)', userinfo.status === 404, userinfo.status);
    const reg = await fetch(`${h.origin}/reg`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"redirect_uris":["https://evil.example/cb"]}' });
    check('surface: dynamic client registration is not available (404)', reg.status === 404, reg.status);

    // ---------------------------------------------------------- happy path
    const flow = await fullFlow(h);
    check('flow: authorization returns a code to the registered redirect', !!flow.auth.code, flow.auth);
    check('flow: authorization response carries iss (RFC 9207) and state', flow.auth.iss === h.origin && flow.auth.state === 'synthetic-state-1', flow.auth);
    check('flow: token endpoint issues a Bearer access token', flow.tokenResponse?.status === 200 && flow.tokenResponse.json.token_type === 'Bearer' && typeof flow.accessToken === 'string', flow.tokenResponse);
    check('flow: token scope is exactly aura.planning.read', flow.tokenResponse?.json?.scope === MCP_SCOPE, flow.tokenResponse?.json);
    check('flow: no refresh token issued', flow.tokenResponse?.json?.refresh_token === undefined);
    check('flow: expires_in matches configured TTL', flow.tokenResponse?.json?.expires_in === 600, flow.tokenResponse?.json?.expires_in);
    check('flow: access token is opaque (not a JWT)', typeof flow.accessToken === 'string' && flow.accessToken.split('.').length === 1, flow.accessToken?.length);
    const at = flow.accessToken!;
    const verified = await h.as.verifyAccessToken(at, h.resource);
    check('verifier: resolves user id, client id and scope', verified?.userId === USER_A && verified?.clientId === CLIENT && verified.scopes.includes(MCP_SCOPE), verified);

    // ---------------------------------------------------------- MCP after authorization
    const init = await mcp(h, at, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '0' } });
    check('mcp: initialize succeeds with the issued token', init.status === 200 && init.body?.result?.protocolVersion === '2025-11-25', init);
    const list = await mcp(h, at, 'tools/list', {});
    check('mcp: tools/list returns exactly find_best_time', list.status === 200 && list.body?.result?.tools?.length === 1 && list.body.result.tools[0].name === 'find_best_time', list.body);
    const call = await mcp(h, at, 'tools/call', { name: 'find_best_time', arguments: FIND_ARGS });
    const sc = call.body?.result?.structuredContent;
    check('mcp: find_best_time returns ranked, non-personalized candidates', call.status === 200 && !call.body.result.isError && sc?.personalized === false && Array.isArray(sc?.candidates) && sc.candidates.length > 0 && sc.candidates[0].rank === 1, call.body);
    const noToken = await mcp(h, null, 'tools/list', {});
    check('mcp: no token -> 401 with resource_metadata challenge', noToken.status === 401 && /resource_metadata=/.test(noToken.headers.get('www-authenticate') ?? ''), noToken.status);

    // ---------------------------------------------------------- PKCE enforcement
    {
      const b = new Browser(h.origin, USER_A);
      const r = await authorize(h, b, { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, state: 's' });
      check('pkce: authorization without code_challenge is refused (invalid_request)', !r.code && r.error === 'invalid_request', r);
      const p = pkcePair();
      const r2 = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p.verifier, code_challenge_method: 'plain', state: 's' });
      check('pkce: code_challenge_method=plain is refused (invalid_request)', !r2.code && r2.error === 'invalid_request', r2);
      const p3 = pkcePair();
      const r3 = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p3.challenge, code_challenge_method: 'S256', state: 's' });
      const wrong = await token(h, { grant_type: 'authorization_code', code: r3.code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: pkcePair().verifier, resource: h.resource });
      check('pkce: wrong code_verifier -> invalid_grant', wrong.status === 400 && wrong.json?.error === 'invalid_grant', wrong);
      const missing = await token(h, { grant_type: 'authorization_code', code: r3.code, redirect_uri: REDIRECT, client_id: CLIENT, resource: h.resource });
      check('pkce: missing code_verifier -> refused', missing.status === 400, missing);
    }

    // ---------------------------------------------------------- authorization code reuse and binding
    {
      const p = pkcePair();
      const r = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      const crossClient = await token(h, { grant_type: 'authorization_code', code: r.code, redirect_uri: REDIRECT, client_id: OTHER_CLIENT, code_verifier: p.verifier, resource: h.resource });
      check('client binding: code issued to one client cannot be redeemed by another', crossClient.status === 400 && crossClient.json?.error === 'invalid_grant', crossClient);
      const p2 = pkcePair();
      const r2 = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p2.challenge, code_challenge_method: 'S256', state: 's' });
      const first = await token(h, { grant_type: 'authorization_code', code: r2.code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: p2.verifier, resource: h.resource });
      const replay = await token(h, { grant_type: 'authorization_code', code: r2.code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: p2.verifier, resource: h.resource });
      check('code: single use -- replay is refused', first.status === 200 && replay.status === 400 && replay.json?.error === 'invalid_grant', [first.status, replay]);
      check('code: replay revokes the tokens already issued from that code', (await h.as.verifyAccessToken(first.json?.access_token, h.resource)) === null);
    }

    // ---------------------------------------------------------- unauthorized clients / redirect
    {
      const p = pkcePair();
      const unknown = await new Browser(h.origin, USER_A).fetch(`/oauth/authorize?${new URLSearchParams({ client_id: 'not-registered', redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, code_challenge: p.challenge, code_challenge_method: 'S256' })}`);
      const unknownBody = await unknown.text();
      check('clients: unregistered client_id is refused without redirect', unknown.status === 400 && !unknown.headers.get('location') && /invalid_client/.test(unknownBody), [unknown.status, unknownBody.slice(0, 200)]);
      check('errors: authorization error page has no stack or internal paths', !/at\s+\w+\s+\(|node_modules|\.js:\d+/.test(unknownBody));
      const badRedirect = await new Browser(h.origin, USER_A).fetch(`/oauth/authorize?${new URLSearchParams({ client_id: CLIENT, redirect_uri: 'https://evil.example/cb', response_type: 'code', scope: MCP_SCOPE, code_challenge: p.challenge, code_challenge_method: 'S256' })}`);
      check('clients: unregistered redirect_uri is refused without redirect', badRedirect.status === 400 && !badRedirect.headers.get('location'), badRedirect.status);
      const asOnly = await fullFlow(h, USER_A, AS_ONLY_CLIENT);
      const asOnlyCall = await mcp(h, asOnly.accessToken!, 'tools/list', {});
      check('clients: token for a client the resource does not accept -> 403 unauthorized_client', !!asOnly.accessToken && asOnlyCall.status === 403 && asOnlyCall.body?.error === 'unauthorized_client', asOnlyCall);
      const wrongTarget = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: 'https://other.example/api', code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      check('audience: authorization for a foreign resource is refused (invalid_target)', !wrongTarget.code && wrongTarget.error === 'invalid_target', wrongTarget);
    }

    // ---------------------------------------------------------- consent & login (Aura session reuse)
    {
      const p = pkcePair();
      const anon = new Browser(h.origin);
      const r = await authorize(h, anon, { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      check('login: without an Aura session the flow stops at sign-in (401), no code', !r.code && r.error === 'stopped_401', r);
      const denied = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' }, 'abort');
      check('consent: Deny returns access_denied to the client', !denied.code && denied.error === 'access_denied', denied);

      // CSRF: a POST without / with a wrong token, or from a foreign Origin, is refused.
      const b = new Browser(h.origin, USER_A);
      const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      let res = await b.fetch(`/oauth/authorize?${q}`);
      for (let i = 0; i < 4 && res.status === 303; i += 1) res = await b.fetch(res.headers.get('location')!);
      const html = await res.text();
      const action = /action="([^"]+\/confirm)"/.exec(html)?.[1];
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      check('consent: page is served with anti-framing headers', res.headers.get('x-frame-options') === 'DENY' && /frame-ancestors 'none'/.test(res.headers.get('content-security-policy') ?? ''), [...res.headers]);
      check('consent: label comes from Aura config, not the client', html.includes('Synthetic MCP client'));
      const noCsrf = await b.fetch(action!, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '' });
      check('csrf: confirm without token -> 403', noCsrf.status === 403, noCsrf.status);
      const badCsrf = await b.fetch(action!, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'csrf=AAAA' });
      check('csrf: confirm with wrong token -> 403', badCsrf.status === 403, badCsrf.status);
      const foreign = await b.fetch(action!, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: `csrf=${encodeURIComponent(csrf!)}` });
      check('csrf: confirm from a foreign Origin -> 403', foreign.status === 403, foreign.status);
      // A different signed-in user cannot complete user A's consent with A's CSRF token.
      b.jar.set('test_session', USER_B);
      const otherUser = await b.fetch(action!, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.origin }, body: `csrf=${encodeURIComponent(csrf!)}` });
      check('consent: CSRF token is bound to the signed-in user (other user -> 403)', otherUser.status === 403, otherUser.status);
      // User B (now signed in) reloads the consent page started under user A: the flow ends with login_required, no code.
      const consentUrl = action!.replace(/\/confirm$/, '');
      let switched = await b.fetch(consentUrl);
      for (let i = 0; i < 4 && switched.status === 303 && !(switched.headers.get('location') ?? '').startsWith(REDIRECT); i += 1) switched = await b.fetch(switched.headers.get('location')!);
      const switchedLoc = new URL(switched.headers.get('location') ?? 'http://x/');
      check('consent: account switch mid-flow -> login_required, no code', switchedLoc.href.startsWith(REDIRECT) && switchedLoc.searchParams.get('error') === 'login_required' && !switchedLoc.searchParams.get('code'), switchedLoc.href);
    }

    // ---------------------------------------------------------- invalid / forged tokens
    {
      const tampered = at.slice(0, -1) + (at.endsWith('A') ? 'B' : 'A');
      check('tokens: tampered token -> rejected', (await h.as.verifyAccessToken(tampered, h.resource)) === null);
      const forged = hs256Jwt({ iss: h.origin, aud: h.resource, sub: USER_A, client_id: CLIENT, scope: MCP_SCOPE, exp: Math.floor(Date.now() / 1000) + 600 }, randomBytes(32));
      check('tokens: JWT with a foreign signature -> rejected', (await h.as.verifyAccessToken(forged, h.resource)) === null);
      const none = `${b64url(Buffer.from('{"alg":"none"}'))}.${b64url(Buffer.from(JSON.stringify({ aud: h.resource, sub: USER_A, scope: MCP_SCOPE })))}.`;
      check('tokens: unsigned (alg=none) JWT -> rejected', (await h.as.verifyAccessToken(none, h.resource)) === null);
      const other = await startHarness();
      const otherFlow = await fullFlow(other);
      check('tokens: token from a different authorization server instance -> rejected', !!otherFlow.accessToken && (await h.as.verifyAccessToken(otherFlow.accessToken!, h.resource)) === null);
      await other.close();
      const forgedCall = await mcp(h, tampered, 'tools/list', {});
      check('mcp: invalid token -> 401 error="invalid_token"', forgedCall.status === 401 && /error="invalid_token"/.test(forgedCall.headers.get('www-authenticate') ?? ''), forgedCall.status);
      check('tokens: oversized token -> rejected without lookup', (await h.as.verifyAccessToken('a'.repeat(5000), h.resource)) === null);
    }

    // ---------------------------------------------------------- audience
    check('audience: valid token presented for another resource -> rejected', (await h.as.verifyAccessToken(at, `${h.origin}/api/other`)) === null);
    {
      // A token stored for another audience in the same AS (constructed directly).
      const grant = new h.as.provider.Grant({ accountId: USER_A, clientId: CLIENT });
      grant.addResourceScope('https://other.example/api', MCP_SCOPE);
      const grantId = await grant.save();
      const client = await h.as.provider.Client.find(CLIENT);
      const foreign = new h.as.provider.AccessToken({ accountId: USER_A, client, grantId, scope: MCP_SCOPE, resourceServer: { audience: 'https://other.example/api', accessTokenFormat: 'opaque', scope: MCP_SCOPE, identifier: () => 'https://other.example/api' } });
      const value = await foreign.save();
      check('audience: token whose aud is another resource -> rejected', (await h.as.verifyAccessToken(value, h.resource)) === null);
      const call2 = await mcp(h, value, 'tools/list', {});
      check('audience: MCP call with wrong-audience token -> 401', call2.status === 401, call2.status);
    }

    // ---------------------------------------------------------- scope
    {
      const grant = new h.as.provider.Grant({ accountId: USER_A, clientId: CLIENT });
      grant.addResourceScope(h.resource, MCP_SCOPE);
      const grantId = await grant.save();
      const client = await h.as.provider.Client.find(CLIENT);
      const noScope = new h.as.provider.AccessToken({ accountId: USER_A, client, grantId, scope: '', resourceServer: { audience: h.resource, accessTokenFormat: 'opaque', scope: MCP_SCOPE, identifier: () => h.resource } });
      const value = await noScope.save();
      const res = await mcp(h, value, 'tools/list', {});
      check('scope: token without aura.planning.read -> 403 insufficient_scope', res.status === 403 && res.body?.error === 'insufficient_scope' && /insufficient_scope/.test(res.headers.get('www-authenticate') ?? ''), res);
      const p = pkcePair();
      const r = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: 'openid', resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      const t = r.code ? await token(h, { grant_type: 'authorization_code', code: r.code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: p.verifier, resource: h.resource }) : null;
      const tokenScope = t?.json?.scope ?? '';
      const res2 = t?.json?.access_token ? await mcp(h, t.json.access_token, 'tools/list', {}) : { status: 0 };
      console.log(`     (openid-only request -> ${r.code ? `token status ${t?.status}, scope "${tokenScope}", MCP ${res2.status}` : `error ${r.error}`})`);
      check('scope: authorizing without the resource scope yields no usable MCP token', !String(tokenScope).includes(MCP_SCOPE) && res2.status !== 200, [tokenScope, res2.status]);
      const unknownScope = await authorize(h, new Browser(h.origin, USER_A), { client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: `${MCP_SCOPE} aura.planning.write`, resource: h.resource, code_challenge: p.challenge, code_challenge_method: 'S256', state: 's' });
      const t2 = unknownScope.code ? await token(h, { grant_type: 'authorization_code', code: unknownScope.code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: p.verifier, resource: h.resource }) : null;
      console.log(`     (unknown-scope request -> ${unknownScope.code ? `token scope "${t2?.json?.scope}"` : `error ${unknownScope.error}`})`);
      check('scope: unknown scopes are never granted', unknownScope.code ? t2?.status === 200 && t2.json.scope === MCP_SCOPE : !!unknownScope.error, [unknownScope, t2?.json]);
    }

    // ---------------------------------------------------------- revocation
    {
      const f = await fullFlow(h);
      const before = await mcp(h, f.accessToken!, 'tools/list', {});
      const rev = await fetch(`${h.origin}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: f.accessToken!, client_id: CLIENT }) });
      const after = await mcp(h, f.accessToken!, 'tools/list', {});
      check('revocation: RFC 7009 revoke -> 200 and token immediately unusable', before.status === 200 && rev.status === 200 && after.status === 401, [before.status, rev.status, after.status]);
      const f2 = await fullFlow(h);
      const otherRev = await fetch(`${h.origin}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: f2.accessToken!, client_id: OTHER_CLIENT }) });
      const stillOk = await mcp(h, f2.accessToken!, 'tools/list', {});
      check('revocation: another client cannot revoke this client\'s token', stillOk.status === 200, [otherRev.status, stillOk.status]);
      const n = await h.as.revokeUserClientGrants(USER_A, CLIENT);
      const afterDisconnect = await mcp(h, f2.accessToken!, 'tools/list', {});
      check('revocation: disconnect (grant revocation) invalidates every token of that user+client', n >= 1 && afterDisconnect.status === 401, [n, afterDisconnect.status]);
      const fb = await fullFlow(h, USER_B);
      await h.as.revokeUserClientGrants(USER_A, CLIENT);
      const bStill = await mcp(h, fb.accessToken!, 'tools/list', {});
      check('revocation: disconnecting user A leaves user B connected', bStill.status === 200, bStill.status);
      const bVerified = await h.as.verifyAccessToken(fb.accessToken!, h.resource);
      check('isolation: user B\'s token resolves to user B, never A', bVerified?.userId === USER_B, bVerified);
    }

    // ---------------------------------------------------------- rate limits
    {
      const fa = await fullFlow(h, USER_A);
      const fb = await fullFlow(h, USER_B);
      const limiter = createFixedWindowRateLimiter({ limit: 3, windowMs: 60_000, now: () => 1_000_000 });
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) statuses.push((await mcp(h, fa.accessToken!, 'tools/list', {}, { rateLimiter: limiter })).status);
      const limited = await mcp(h, fa.accessToken!, 'tools/list', {}, { rateLimiter: limiter });
      check('rate limit: 4th request of a user in the window -> 429', JSON.stringify(statuses) === '[200,200,200,429]', statuses);
      check('rate limit: 429 carries Retry-After and no internals', limited.status === 429 && Number(limited.headers.get('retry-after')) >= 1 && limited.body?.error === 'rate_limited', [limited.status, limited.headers.get('retry-after'), limited.body]);
      const clientLimited = (await mcp(h, fb.accessToken!, 'tools/list', {}, { rateLimiter: limiter })).status;
      check('rate limit: per-client budget is shared across users of that client', clientLimited === 429, clientLimited);
      const perUser = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => 5 });
      await mcp(h, fa.accessToken!, 'tools/list', {}, { rateLimiter: perUser });
      const keysSeen: string[][] = [];
      const spy = { check: (keys: readonly string[]) => (keysSeen.push([...keys]), { allowed: true, retryAfterSeconds: 0 }) };
      await mcp(h, fa.accessToken!, 'tools/list', {}, { rateLimiter: spy });
      check('rate limit: keyed by verified user AND client (never by request input)', JSON.stringify(keysSeen) === JSON.stringify([[`user:${USER_A}`, `client:${CLIENT}`]]), keysSeen);
      let t = 0;
      const windowed = createFixedWindowRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
      const w1 = windowed.check(['user:x']).allowed;
      const w2 = windowed.check(['user:x']).allowed;
      t = 1000;
      const w3 = windowed.check(['user:x']).allowed;
      check('rate limit: window resets', w1 && !w2 && w3, [w1, w2, w3]);
      const unauth = await mcp(h, null, 'tools/list', {}, { rateLimiter: { check: () => ({ allowed: false, retryAfterSeconds: 9 }) } });
      check('rate limit: checked only after authentication (401 first)', unauth.status === 401, unauth.status);
    }

    // ---------------------------------------------------------- expiry (short-TTL instance)
    {
      const short = await startHarness({ ttl: 1 });
      const f = await fullFlow(short);
      const okNow = await short.as.verifyAccessToken(f.accessToken!, short.resource);
      check('expiry: short-lived token initially valid (expires_in 1)', !!okNow && f.tokenResponse?.json?.expires_in === 1, f.tokenResponse?.json);
      await new Promise((r) => setTimeout(r, 2100));
      check('expiry: expired token -> rejected by verifier', (await short.as.verifyAccessToken(f.accessToken!, short.resource)) === null);
      const call = await mcp(short, f.accessToken!, 'tools/list', {});
      check('expiry: MCP call with expired token -> 401 invalid_token', call.status === 401 && /invalid_token/.test(call.headers.get('www-authenticate') ?? ''), call.status);
      await short.close();
    }

    // ---------------------------------------------------------- audit redaction
    {
      const all = h.auditLines.join('\n');
      const parsed = h.auditLines.map((l) => JSON.parse(l).aura_mcp_audit);
      check('audit: events were recorded for MCP and OAuth', parsed.some((e) => e.event === 'mcp.request' && e.outcome === 'ok') && parsed.some((e) => e.event === 'oauth.token_issued') && parsed.some((e) => e.event === 'oauth.grant') && parsed.some((e) => e.event === 'oauth.token_revoked'), [...new Set(parsed.map((e) => `${e.event}:${e.outcome}`))]);
      check('audit: no access token appears', !all.includes(at) && !all.includes(flow.accessToken!));
      check('audit: no authorization code or PKCE verifier appears', !all.includes(flow.auth.code!) && !all.includes(flow.verifier));
      check('audit: no tool arguments appear', !all.includes(SECRET_TASK) && !all.includes('80.2707'));
      check('audit: no raw user id appears (pseudonymous userRef only)', !all.includes(USER_A) && !all.includes(USER_B) && all.includes(auditUserRef(USER_A)));
      check('audit: no cookies, secrets or bearer strings', !/as_session|test_session|_interaction|Bearer |csrf|cookie/i.test(all));
      const keys = new Set(parsed.flatMap((e) => Object.keys(e)));
      const allowed = new Set(['ts', 'event', 'outcome', 'status', 'clientId', 'userRef', 'rpcMethod', 'tool', 'errorCode', 'limitedBy', 'latencyMs']);
      check('audit: only allowlisted fields are ever emitted', [...keys].every((k) => allowed.has(k)), [...keys]);
      check('audit: tool calls are attributed to user+client+tool', parsed.some((e) => e.event === 'mcp.request' && e.tool === 'find_best_time' && e.clientId === CLIENT && e.userRef === auditUserRef(USER_A)));
      check('audit: rate-limit and auth failures are recorded with codes', parsed.some((e) => e.outcome === 'rate_limited' && e.limitedBy) && parsed.some((e) => e.outcome === 'invalid_token') && parsed.some((e) => e.outcome === 'unauthorized_client'));
      const injected: string[] = [];
      createRedactingAuditSink({ write: (l) => injected.push(l) })({ event: 'mcp.request', outcome: 'ok', clientId: 'evil"client\nwith newline', errorCode: 'x'.repeat(200), rpcMethod: 'tools/call; DROP', tool: 'secret_tool', ...({ token: 'should-not-pass', args: SECRET_TASK } as object) } as never);
      const inj = JSON.parse(injected[0]).aura_mcp_audit;
      check('audit: unknown fields, non-identifier values and unknown methods/tools are dropped or masked', !('token' in inj) && !('args' in inj) && inj.clientId === undefined && inj.errorCode === undefined && inj.rpcMethod === 'other' && inj.tool === 'other', inj);
    }
  } finally {
    await h.close();
  }

  // ---------------------------------------------------------- environment gate
  const local = { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:3000' };
  const LOCAL_ENV = { AURA_MCP_AUTH_MODE: 'local-dev', NODE_ENV: 'development' };
  check('gate: local dev with explicit opt-in and loopback URLs -> local', resolveMcpAuthMode(LOCAL_ENV, local).mode === 'local');
  const denials: [string, Record<string, string | undefined>, typeof local | null][] = [
    ['Production project id', { ...LOCAL_ENV, VERCEL_PROJECT_ID: PRODUCTION_PROJECT_ID }, local],
    ['staging project id', { ...LOCAL_ENV, VERCEL_PROJECT_ID: STAGING_PROJECT_IDS[0] }, local],
    ['VERCEL_ENV=production', { ...LOCAL_ENV, VERCEL_ENV: 'production' }, local],
    ['VERCEL_ENV=preview', { ...LOCAL_ENV, VERCEL_ENV: 'preview' }, local],
    ['VERCEL=1 (any Vercel build/runtime)', { ...LOCAL_ENV, VERCEL: '1' }, local],
    ['VERCEL_URL set', { ...LOCAL_ENV, VERCEL_URL: 'x.vercel.app' }, local],
    ['unknown Vercel project id', { ...LOCAL_ENV, VERCEL_PROJECT_ID: 'prj_unknown' }, local],
    ['NODE_ENV=production (next build / next start / Docker)', { ...LOCAL_ENV, NODE_ENV: 'production' }, local],
    ['NODE_ENV unset', { AURA_MCP_AUTH_MODE: 'local-dev' }, local],
    ['opt-in missing', { NODE_ENV: 'development' }, local],
    ['opt-in misspelled ("1")', { NODE_ENV: 'development', AURA_MCP_AUTH_MODE: '1' }, local],
    ['remote MCP config disabled', LOCAL_ENV, null],
    ['non-loopback resource URL', LOCAL_ENV, { resourceUrl: 'https://aura.example/api/mcp', authorizationServer: 'http://localhost:3000' }],
    ['non-loopback issuer', LOCAL_ENV, { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'https://aura.example' }],
    ['issuer origin differs from resource origin', LOCAL_ENV, { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:4000' }],
    ['issuer with a path', LOCAL_ENV, { resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:3000/oauth' }],
    ['loopback lookalike host', LOCAL_ENV, { resourceUrl: 'http://localhost.evil.example/api/mcp', authorizationServer: 'http://localhost.evil.example' }],
  ];
  for (const [label, env, cfg] of denials) {
    const m = resolveMcpAuthMode(env, cfg);
    check(`gate: ${label} -> reject_all`, m.mode === 'reject_all', m);
  }
  check('gate: Production project wins over every other variable', resolveMcpAuthMode({ ...LOCAL_ENV, VERCEL_PROJECT_ID: PRODUCTION_PROJECT_ID, VERCEL_ENV: undefined }, local).mode === 'reject_all');
  check('gate: config parser still requires the flag (enabled !== "1" -> disabled)', parseRemoteMcpConfig({ enabled: 'true', resourceUrl: local.resourceUrl, authorizationServer: local.authorizationServer }) === null);
  check('gate: rejectAllAccessTokens still rejects', (await rejectAllAccessTokens('anything', local.resourceUrl)) === null);

  // ---------------------------------------------------------- static wiring checks
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const route = read('apps/web/app/api/mcp/route.ts');
  check('wiring: /api/mcp falls back to rejectAllAccessTokens unless the gate says local', /rejectAllAccessTokens/.test(route) && /resolveRuntimeMcpAuthMode\(/.test(route) && /mode === 'local'/.test(route));
  check('wiring: /api/mcp loads the local AS lazily (dynamic import), never at module load', /await import\(['"][^'"]*mcpLocalOAuth['"]\)/.test(route) && !/^import[^\n]*mcpLocalOAuth/m.test(route));
  const pagesRoute = read('apps/web/pages/api/oauth/[...oidc].ts');
  check('wiring: OAuth mount 404s unless the gate says local', /resolveRuntimeMcpAuthMode\(/.test(pagesRoute) && /404/.test(pagesRoute) && /await import\(['"][^'"]*mcpLocalOAuth['"]\)/.test(pagesRoute));
  check('wiring: OAuth mount disables Next body parsing (provider reads the raw body)', /bodyParser:\s*false/.test(pagesRoute));
  const localAs = read('apps/web/lib/mcpLocalOAuth.ts');
  check('wiring: local AS refuses to construct unless the gate says local', /resolveRuntimeMcpAuthMode\(/.test(localAs) && /throw/.test(localAs));
  check('wiring: local AS registers only loopback synthetic redirect URIs', [...localAs.matchAll(/redirect_uris:\s*\[([^\]]*)\]/g)].every((m) => [...m[1].matchAll(/'([^']+)'/g)].every((u) => /^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(u[1]))));
  const gateSrc = read('apps/web/lib/mcpAuthGate.ts');
  check('wiring: runtime gate has a literal process.env.NODE_ENV production check (inlined by next build)', /export function resolveRuntimeMcpAuthMode[\s\S]*if \(process\.env\.NODE_ENV === 'production'\) return \{ mode: 'reject_all'/.test(gateSrc));
  const handlerSrc = read('packages/mcp-tools/src/http/remoteMcpHandler.ts');
  check('wiring: remote handler still reads no environment variables', !/process\.env/.test(handlerSrc));
  const asSrc = read('packages/mcp-tools/src/auth/authorizationServer.ts');
  check('wiring: authorization server reads no environment variables', !/process\.env/.test(asSrc));
  check('wiring: dev interactions disabled', /devInteractions:\s*\{\s*enabled:\s*false/.test(asSrc));
  const rootPkg = JSON.parse(read('package.json'));
  check('pins: oidc-provider pinned exactly to 9.13.3 (D2-reviewed version)', rootPkg.dependencies?.['oidc-provider'] === '9.13.3', rootPkg.dependencies?.['oidc-provider']);

  if (!allPassed) {
    console.error(`\nAURA-MCP-02-I2a local OAuth test FAILED (${count} checks)`);
    process.exit(1);
  }
  console.log(`\nAll ${count} AURA-MCP-02-I2a local OAuth checks passed.`);
}

main().catch((err) => {
  console.error('AURA-MCP-02-I2a local OAuth test crashed:', err);
  process.exit(1);
});
