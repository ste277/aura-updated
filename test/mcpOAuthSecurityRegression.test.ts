/**
 * AURA-MCP-02-I2a-R1 -- regression tests for the independent security
 * review findings (AURA_MCP_02_I2A_SEC_REVIEW.md):
 *
 *   F1  (P0) provider login session not bound to the Aura session
 *   F2  (P1) one user exhausting a client-wide rate-limit bucket
 *   F3/F4    limiter eviction resetting live limits / unbounded memory
 *   F9       extra interaction path segments
 *   F13      leftover provider session blocking another user
 *   F14      non-loopback peers reaching the local authorization server
 *
 * Offline: ephemeral 127.0.0.1 server, synthetic users and clients, no DB,
 * no environment variables.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { createAuraOAuthServer, isLoopbackPeer, type AuraOAuthServer } from '../packages/mcp-tools/src/auth/authorizationServer';
import { handleRemoteMcpRequest, MCP_SCOPE, type RemoteMcpDeps } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { createFixedWindowRateLimiter } from '../packages/mcp-tools/src/security/rateLimit';

let allPassed = true;
let count = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  count += 1;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!condition) allPassed = false;
}

const USER_A = 'synthetic-user-a';
const USER_B = 'synthetic-user-b';
const CLIENT = 'synthetic-client';
const REDIRECT = 'http://127.0.0.1:8976/callback';
const b64 = (b: Buffer) => b.toString('base64url');

interface Harness {
  as: AuraOAuthServer;
  origin: string;
  resource: string;
  /** When set, the next requests appear to come from this TCP peer. */
  spoofPeer: { address?: string };
  close(): Promise<void>;
}

async function startHarness(): Promise<Harness> {
  let as: AuraOAuthServer | null = null;
  const spoofPeer: { address?: string } = {};
  const server = http.createServer((req, res) => {
    // Keep-alive sockets are reused: always reset the override first.
    delete (req.socket as unknown as Record<string, unknown>).remoteAddress;
    if (spoofPeer.address) Object.defineProperty(req.socket, 'remoteAddress', { value: spoofPeer.address, configurable: true });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    void as!.handle(req, res, url.pathname, url.search);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  as = createAuraOAuthServer({
    issuer: origin,
    resourceUrl: `${origin}/api/mcp`,
    clients: [{ client_id: CLIENT, redirect_uris: [REDIRECT], label: 'Synthetic client' }],
    // Synthetic Aura session: cookie `aura=<userId>`; `aura=expired` models an expired session; `aura=boom` makes the resolver throw.
    resolveSessionUser: (req) => {
      const m = /(?:^|;\s*)aura=([A-Za-z0-9-]+)/.exec(String(req.headers.cookie ?? ''));
      if (!m || m[1] === 'expired') return null;
      if (m[1] === 'boom') throw new Error('session store unavailable');
      return { userId: m[1] };
    },
  });
  return { as, origin, resource: `${origin}/api/mcp`, spoofPeer, close: () => new Promise((r) => server.close(() => r())) };
}

class Browser {
  jar = new Map<string, string>();
  constructor(private readonly h: Harness, user?: string) {
    if (user) this.jar.set('aura', user);
  }
  signIn(user: string) {
    this.jar.set('aura', user);
  }
  signOut() {
    this.jar.delete('aura');
  }
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(url, this.h.origin), { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
}

interface Outcome {
  /** Steps taken: I=interaction redirect, A=authorize resume, C=consent page shown, X=consent submitted, R=callback. */
  trail: string;
  code?: string;
  error?: string;
  stoppedStatus?: number;
  consentShown: boolean;
  verifier: string;
}

/** Drives the browser; `consent` decides whether the user clicks Allow when the consent page is shown. */
async function authorize(h: Harness, b: Browser, opts: { prompt?: string; consent?: boolean; challenge?: string; verifier?: string } = {}): Promise<Outcome> {
  const verifier = opts.verifier ?? b64(randomBytes(32));
  const challenge = opts.challenge ?? b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  if (opts.prompt) q.set('prompt', opts.prompt);
  let res = await b.fetch(`/oauth/authorize?${q}`);
  let trail = '';
  let consentShown = false;
  for (let i = 0; i < 12; i += 1) {
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) {
        const cb = new URL(loc);
        return { trail: `${trail}R`, code: cb.searchParams.get('code') ?? undefined, error: cb.searchParams.get('error') ?? undefined, consentShown, verifier };
      }
      trail += loc.includes('/interaction/') ? 'I' : 'A';
      res = await b.fetch(loc);
      continue;
    }
    if (res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('text/html')) {
      consentShown = true;
      trail += 'C';
      if (!opts.consent) return { trail, consentShown, verifier, stoppedStatus: 200 };
      const html = await res.text();
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
      const action = /action="([^"]+\/confirm)"/.exec(html)?.[1];
      if (!csrf || !action) return { trail, consentShown, verifier, stoppedStatus: 200, error: `page:${/<title>([^<]*)/.exec(html)?.[1]}` };
      trail += 'X';
      res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      continue;
    }
    return { trail, consentShown, verifier, stoppedStatus: res.status };
  }
  return { trail, consentShown, verifier, error: 'too_many_hops' };
}

async function redeem(h: Harness, code: string, verifier: string): Promise<{ status: number; userId?: string; token?: string }> {
  const res = await fetch(`${h.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT, code_verifier: verifier, resource: h.resource }) });
  const json = await res.json().catch(() => ({}));
  const v = json.access_token ? await h.as.verifyAccessToken(json.access_token, h.resource) : null;
  return { status: res.status, userId: v?.userId, token: json.access_token };
}

async function connect(h: Harness, b: Browser): Promise<{ userId?: string; token?: string; outcome: Outcome }> {
  const outcome = await authorize(h, b, { consent: true });
  if (!outcome.code) return { outcome };
  const r = await redeem(h, outcome.code, outcome.verifier);
  return { userId: r.userId, token: r.token, outcome };
}

async function mcpStatus(h: Harness, token: string, extra: Partial<RemoteMcpDeps> = {}): Promise<number> {
  const res = await handleRemoteMcpRequest(
    new Request(h.resource, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25', authorization: `Bearer ${token}` }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' }),
    { config: { resourceUrl: h.resource, authorizationServer: h.origin }, verifyAccessToken: h.as.verifyAccessToken, isClientAllowed: h.as.isClientAllowed, ...extra },
  );
  await res.text();
  return res.status;
}

async function main(): Promise<void> {
  const h = await startHarness();
  try {
    // ------------------------------------------------------------ F1 scenario 1: A authorizes, signs out, B signs in
    {
      const b = new Browser(h, USER_A);
      const a = await connect(h, b);
      check('F1.1 baseline: A connects with explicit consent and gets a token for A', a.userId === USER_A && a.outcome.consentShown, a.outcome);
      b.signOut();
      const out = await authorize(h, b, { consent: true });
      check('F1.1a after Aura sign-out: no code, flow stops at sign-in (401)', !out.code && out.stoppedStatus === 401, out);
      const silent = await authorize(h, b, { prompt: 'none' });
      check('F1.1b after Aura sign-out, prompt=none: login_required, no code', !silent.code && silent.error === 'login_required', silent);
      b.signIn(USER_B);
      const bTry = await authorize(h, b, { consent: false });
      check('F1.1c B signed in on the same browser: consent page is shown (nothing silent)', !bTry.code && bTry.consentShown, bTry);
      const bConnect = await connect(h, b);
      check('F1.1d B completes consent: token is for B, never A', bConnect.userId === USER_B, { userId: bConnect.userId, outcome: bConnect.outcome });
    }

    // ------------------------------------------------------------ F1 scenario 2: A authorizes, then B attempts prompt=none
    {
      const b = new Browser(h, USER_A);
      await connect(h, b);
      b.signIn(USER_B);
      const out = await authorize(h, b, { prompt: 'none' });
      check('F1.2 A authorized, B signed in, prompt=none: no code (login_required)', !out.code && out.error === 'login_required', out);
      const sameUser = new Browser(h, USER_A);
      await connect(h, sameUser);
      const again = await authorize(h, sameUser, { prompt: 'none' });
      check('F1.2b even for the same user, prompt=none never issues a code (consent_required)', !again.code && again.error === 'consent_required', again);
    }

    // ------------------------------------------------------------ F1 scenario 3: malicious local client with its own PKCE
    {
      const victim = new Browser(h, USER_A);
      await connect(h, victim); // A has an existing grant and is signed in to Aura
      const attackerVerifier = b64(randomBytes(32));
      const attackerChallenge = b64(createHash('sha256').update(attackerVerifier).digest());
      const silent = await authorize(h, victim, { prompt: 'none', challenge: attackerChallenge, verifier: attackerVerifier });
      check('F1.3a attacker PKCE + prompt=none in the victim\'s browser: no code (consent_required)', !silent.code && silent.error === 'consent_required', silent);
      const visible = await authorize(h, victim, { challenge: attackerChallenge, verifier: attackerVerifier, consent: false });
      check('F1.3b attacker PKCE without prompt=none: stops at the consent page, no code without the user clicking Allow', !visible.code && visible.consentShown, visible);
      const noSession = await authorize(h, new Browser(h), { prompt: 'none', challenge: attackerChallenge, verifier: attackerVerifier });
      check('F1.3c attacker PKCE with no Aura session at all: login_required, no code', !noSession.code && noSession.error === 'login_required', noSession);
    }

    // ------------------------------------------------------------ F1 scenario 4: Aura session expiry / removal / resolver failure
    {
      const b = new Browser(h, USER_A);
      await connect(h, b);
      b.signIn('expired');
      const expired = await authorize(h, b, { consent: true });
      check('F1.4a expired Aura session: no code, stops at sign-in', !expired.code && expired.stoppedStatus === 401, expired);
      const expiredSilent = await authorize(h, b, { prompt: 'none' });
      check('F1.4b expired Aura session + prompt=none: login_required', !expiredSilent.code && expiredSilent.error === 'login_required', expiredSilent);
      b.signIn('boom');
      const failing = await authorize(h, b, { consent: true });
      check('F1.4c session resolver throws: fail closed, no code', !failing.code, failing);
      b.signIn(USER_A);
      const back = await connect(h, b);
      check('F1.4d after signing back in, A can reconnect (with consent)', back.userId === USER_A && back.outcome.consentShown, back.outcome);
    }

    // ------------------------------------------------------------ F1 scenario 5: concurrent authorization
    {
      const runs = await Promise.all(
        Array.from({ length: 12 }, (_, i) => {
          const user = i % 2 === 0 ? USER_A : USER_B;
          return connect(h, new Browser(h, user)).then((r) => ({ user, got: r.userId }));
        }),
      );
      check('F1.5a 12 concurrent flows (A and B): every token belongs to the user who consented', runs.every((r) => r.got === r.user), runs);
      // Same browser: start a flow as A, switch to B while it is in flight, then finish.
      const b = new Browser(h, USER_A);
      const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: b64(createHash('sha256').update('x'.repeat(43)).digest()), code_challenge_method: 'S256', state: 's' });
      let res = await b.fetch(`/oauth/authorize?${q}`);
      res = await b.fetch(res.headers.get('location')!); // login interaction -> resume
      b.signIn(USER_B); // switch mid-flow
      let codeFor: string | undefined;
      for (let i = 0; i < 8; i += 1) {
        const loc = res.headers.get('location');
        if (res.status === 303 && loc) {
          if (loc.startsWith(REDIRECT)) {
            const code = new URL(loc).searchParams.get('code');
            codeFor = code ? (await redeem(h, code, 'x'.repeat(43))).userId : `error:${new URL(loc).searchParams.get('error')}`;
            break;
          }
          res = await b.fetch(loc);
        } else if (res.status === 200) {
          const html = await res.text();
          const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
          const action = /action="([^"]+\/confirm)"/.exec(html)![1];
          res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
        } else break;
      }
      check('F1.5b account switch while a flow is in flight never yields a token for A', codeFor !== USER_A, codeFor);
    }

    // ------------------------------------------------------------ F1 scenario 6: legitimate reauthorization
    {
      const b = new Browser(h, USER_A);
      const first = await connect(h, b);
      const second = await connect(h, b);
      check('F1.6a A re-authorizes: consent shown again, token for A', second.userId === USER_A && second.outcome.consentShown, second.outcome);
      // AURA-AUTH-SESSION-01-I2-R2 (Rev 4 B3, approved: a NEW grant per consent, no reuse): an access token
      // WITHOUT offline_access is bound by oidc-provider to the browser session's CURRENT grant for the client
      // (expiresWithSession), so re-authorizing in the same browser supersedes it; the new token is valid.
      // Refresh-capable (offline_access) connections are not session-bound and are unaffected.
      check('F1.6b re-authorization: the new token is valid; the earlier session-bound token is superseded (no grant reuse)', (await mcpStatus(h, second.token!)) === 200 && (await mcpStatus(h, first.token!)) === 401);
    }

    // ------------------------------------------------------------ F13: leftover provider session does not block another user
    {
      const b = new Browser(h, USER_A);
      const partial = await authorize(h, b, { consent: false }); // A logs in, abandons at consent
      b.signIn(USER_B);
      const bConnect = await connect(h, b);
      check('F13 leftover provider session for A (no consent) does not block B', partial.consentShown && bConnect.userId === USER_B, bConnect.outcome);
    }

    // ------------------------------------------------------------ F9: extra path segments
    {
      const b = new Browser(h, USER_A);
      const q = new URLSearchParams({ client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: MCP_SCOPE, resource: h.resource, code_challenge: b64(createHash('sha256').update('y'.repeat(43)).digest()), code_challenge_method: 'S256' });
      let res = await b.fetch(`/oauth/authorize?${q}`);
      for (let i = 0; i < 4 && res.status === 303; i += 1) res = await b.fetch(res.headers.get('location')!);
      const html = await res.text();
      const action = /action="([^"]+\/confirm)"/.exec(html)![1];
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
      const extra = await b.fetch(`${action}/extra`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: h.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      check('F9 extra path segment after /confirm -> 404', extra.status === 404, extra.status);
    }

    // ------------------------------------------------------------ F14: non-loopback peers
    {
      check('F14 isLoopbackPeer: 127.0.0.1, ::1, ::ffff:127.0.0.1 only', isLoopbackPeer('127.0.0.1') && isLoopbackPeer('::1') && isLoopbackPeer('::ffff:127.0.0.1') && !isLoopbackPeer('192.168.1.20') && !isLoopbackPeer('10.0.0.5') && !isLoopbackPeer('::ffff:192.168.1.20') && !isLoopbackPeer(undefined) && !isLoopbackPeer('127.0.0.2'));
      h.spoofPeer.address = '192.168.1.20';
      const paths = ['/.well-known/oauth-authorization-server', '/.well-known/openid-configuration', `/oauth/authorize?client_id=${CLIENT}`, '/oauth/jwks', '/oauth/interaction/abc'];
      const statuses: number[] = [];
      for (const p of paths) statuses.push((await fetch(`${h.origin}${p}`, { redirect: 'manual' })).status);
      statuses.push((await fetch(`${h.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=authorization_code&code=x' })).status);
      statuses.push((await fetch(`${h.origin}/oauth/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'token=x' })).status);
      check('F14 a LAN peer (192.168.1.20) gets 404 on every OAuth path', statuses.every((s) => s === 404), statuses);
      h.spoofPeer.address = '::ffff:10.0.0.7';
      const mapped = await fetch(`${h.origin}/.well-known/openid-configuration`);
      check('F14 an IPv4-mapped LAN peer gets 404', mapped.status === 404, mapped.status);
      h.spoofPeer.address = undefined;
      const ok = await fetch(`${h.origin}/.well-known/openid-configuration`);
      check('F14 a loopback peer still reaches discovery', ok.status === 200, ok.status);
    }
  } finally {
    await h.close();
  }

  // ------------------------------------------------------------ F2: cross-user isolation, concurrency, saturation
  {
    const h2 = await startHarness();
    try {
      const tokens: Record<string, string> = {};
      for (const u of ['u1', 'u2', 'u3']) tokens[u] = (await connect(h2, new Browser(h2, u))).token!;
      const limiter = createFixedWindowRateLimiter({ windowMs: 60_000, now: () => 42 });
      const limits = { perUser: 10, perClient: 25 };
      const burst = await Promise.all(Array.from({ length: 100 }, () => mcpStatus(h2, tokens.u1, { rateLimiter: limiter, rateLimits: limits })));
      check('F2.1 100 concurrent requests from one user: exactly perUser (10) succeed', burst.filter((s) => s === 200).length === 10 && burst.filter((s) => s === 429).length === 90, burst.filter((s) => s === 200).length);
      const u2 = await mcpStatus(h2, tokens.u2, { rateLimiter: limiter, rateLimits: limits });
      check('F2.2 after user 1 saturates their bucket, user 2 of the same client is unaffected', u2 === 200, u2);
      const u2burst = await Promise.all(Array.from({ length: 30 }, () => mcpStatus(h2, tokens.u2, { rateLimiter: limiter, rateLimits: limits })));
      const u3 = await mcpStatus(h2, tokens.u3, { rateLimiter: limiter, rateLimits: limits });
      check('F2.3 client ceiling is a multi-user backstop: reachable only after several users max out (u1 10 + u2 10 + u3 5)', u2burst.filter((s) => s === 200).length === 9 && u3 === 200, [u2burst.filter((s) => s === 200).length, u3]);
      let misconfigured = false;
      try {
        await handleRemoteMcpRequest(new Request(h2.resource, { method: 'POST', headers: { authorization: `Bearer ${tokens.u1}`, 'content-type': 'application/json' }, body: '{}' }), {
          config: { resourceUrl: h2.resource, authorizationServer: h2.origin },
          verifyAccessToken: h2.as.verifyAccessToken,
          rateLimiter: limiter,
          rateLimits: { perUser: 10, perClient: 10 },
        });
      } catch {
        misconfigured = true;
      }
      check('F2.4 a client ceiling not above the per-user limit is refused as misconfiguration', misconfigured);
    } finally {
      await h2.close();
    }
  }

  // ------------------------------------------------------------ F3/F4: eviction and memory bounds (limiter API)
  {
    let t = 1_000;
    const lim = createFixedWindowRateLimiter({ windowMs: 1_000, maxKeys: 50, now: () => t });
    const victim = [{ key: 'user:victim', limit: 2 }];
    lim.check(victim);
    lim.check(victim);
    check('F3.0 victim reaches their limit', !lim.check(victim).allowed);
    let capacityRejects = 0;
    for (let i = 0; i < 200; i += 1) if (lim.check([{ key: `user:flood-${i}`, limit: 5 }]).limitedBy === 'capacity') capacityRejects += 1;
    check('F3.1 flooding new keys never evicts an active window: victim is still limited', !lim.check(victim).allowed);
    check('F3.2 table never exceeds maxKeys; excess new keys fail closed with limitedBy=capacity', lim.size() <= 50 && capacityRejects === 151, [lim.size(), capacityRejects]);
    t += 1_000;
    check('F3.3 after the window expires, the victim has budget again and expired windows are reclaimed', lim.check(victim).allowed && lim.check([{ key: 'user:new', limit: 1 }]).allowed);

    let t2 = 0;
    const lim2 = createFixedWindowRateLimiter({ windowMs: 60_000, maxKeys: 10, now: () => t2 });
    lim2.check([{ key: 'client:c', limit: 1 }]);
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 300_000; i += 1) lim2.check([{ key: `user:${i}`, limit: 5 }, { key: 'client:c', limit: 1 }]);
    const grownMb = (process.memoryUsage().heapUsed - before) / 1e6;
    check('F4.1 300k rejected requests with distinct keys create no state (size stays 1)', lim2.size() === 1, lim2.size());
    console.log(`     (heap delta after 300k rejected requests: ${grownMb.toFixed(1)} MB incl. GC noise; table size 1; previous implementation grew to 300k entries, +71.6 MB)`);
    let threw = false;
    try {
      lim2.check([{ key: 'user:x', limit: 0 }]);
    } catch {
      threw = true;
    }
    check('F4.2 invalid limits are refused', threw);
    t2 = 0;
  }

  if (!allPassed) {
    console.error(`\nAURA-MCP-02-I2a-R1 security regression FAILED (${count} checks)`);
    process.exit(1);
  }
  console.log(`\nAll ${count} AURA-MCP-02-I2a-R1 security regression checks passed.`);
}

main().catch((err) => {
  console.error('AURA-MCP-02-I2a-R1 security regression crashed:', err);
  process.exit(1);
});
