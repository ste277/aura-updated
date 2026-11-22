/**
 * AURA-MCP-02-I2b -- shared test harness (synthetic users and clients only,
 * 127.0.0.1 only).
 *
 * Multi-instance model: N independent AuraOAuthServer instances built with
 * the SAME issuer, keys and store sit behind one front HTTP server (like a
 * load balancer); `route` picks the instance for each request. Instances
 * share nothing in memory except what the store/limiter share.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { createHash, randomBytes } from 'crypto';
import { createAuraOAuthServer, type AuraOAuthServer, type AuraOAuthServerOptions } from '../packages/mcp-tools/src/auth/authorizationServer';
import { MCP_SCOPE } from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { ephemeralOAuthKeys, type OAuthKeyMaterial } from '../packages/mcp-tools/src/auth/keys';
import { createMemoryAdapterStore } from '../packages/mcp-tools/src/auth/memoryAdapter';

export const USER_A = 'synthetic-i2b-user-a';
export const USER_B = 'synthetic-i2b-user-b';
export const CLIENT = 'synthetic-i2b-client';
export const CLIENT_NR = 'synthetic-i2b-norefresh';
export const REDIRECT = 'http://127.0.0.1:8976/callback';
export const b64 = (b: Buffer) => b.toString('base64url');

let allPassed = true;
let count = 0;
export function check(label: string, condition: boolean, detail?: unknown): void {
  count += 1;
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!condition) allPassed = false;
}
export function summary(name: string): never {
  console.log(allPassed ? `\nAll ${count} ${name} checks passed.` : `\n${name} FAILED (${count} checks)`);
  process.exit(allPassed ? 0 : 1);
}

/** Shared (configured-style) key material so every instance accepts the same cookies and CSRF tokens. */
export function sharedKeys(): OAuthKeyMaterial {
  return { ...ephemeralOAuthKeys(), source: 'configured' };
}

export interface Cluster {
  instances: AuraOAuthServer[];
  origin: string;
  resource: string;
  /** Picks the instance index for the next request (default round-robin). */
  route: { pick?: () => number };
  /** When set, requests appear to come from this TCP peer. */
  spoofPeer: { address?: string };
  close(): Promise<void>;
}

export async function startCluster(n: number, extra: Partial<AuraOAuthServerOptions> = {}, perInstance?: (i: number) => Partial<AuraOAuthServerOptions>): Promise<Cluster> {
  const instances: AuraOAuthServer[] = [];
  const route: Cluster['route'] = {};
  const spoofPeer: Cluster['spoofPeer'] = {};
  let rr = 0;
  const server = http.createServer((req, res) => {
    delete (req.socket as unknown as Record<string, unknown>).remoteAddress;
    if (spoofPeer.address) Object.defineProperty(req.socket, 'remoteAddress', { value: spoofPeer.address, configurable: true });
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const i = route.pick ? route.pick() : rr++ % instances.length;
    void instances[i].handle(req, res, url.pathname, url.search);
  });
  server.keepAliveTimeout = 1;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const keys = extra.keys ?? sharedKeys();
  // One store for the whole cluster (instances share state only through it).
  const adapterStore = extra.adapterStore ?? createMemoryAdapterStore();
  for (let k = 0; k < n; k += 1) {
    instances.push(
      createAuraOAuthServer({
        issuer: origin,
        resourceUrl: `${origin}/api/mcp`,
        clients: [
          { client_id: CLIENT, redirect_uris: [REDIRECT], label: 'Synthetic I2b client', allow_refresh: true },
          { client_id: CLIENT_NR, redirect_uris: [REDIRECT], label: 'Synthetic no-refresh client' },
        ],
        resolveSessionUser: (req) => {
          const m = /(?:^|;\s*)aura=([A-Za-z0-9-]+)/.exec(String(req.headers.cookie ?? ''));
          return m ? { userId: m[1] } : null;
        },
        keys,
        ...extra,
        adapterStore,
        ...(perInstance ? perInstance(k) : {}),
      }),
    );
  }
  return { instances, origin, resource: `${origin}/api/mcp`, route, spoofPeer, close: () => new Promise((r) => server.close(() => r())) };
}

export class Browser {
  jar = new Map<string, string>();
  constructor(private readonly origin: string, user?: string) {
    if (user) this.jar.set('aura', user);
  }
  async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await fetch(new URL(url, this.origin), { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(';');
      const i = pair.indexOf('=');
      if (/expires=Thu, 01 Jan 1970/i.test(sc)) this.jar.delete(pair.slice(0, i));
      else this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
}

export interface Outcome {
  code?: string;
  error?: string;
  verifier: string;
  consentHtml?: string;
  stoppedStatus?: number;
  body?: string;
}

/** Full browser authorization; clicks Allow when `consent` is true. */
export async function authorize(c: Cluster, b: Browser, opts: { scope?: string; clientId?: string; consent?: boolean; prompt?: string } = {}): Promise<Outcome> {
  const verifier = b64(randomBytes(32));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  const q = new URLSearchParams({ client_id: opts.clientId ?? CLIENT, redirect_uri: REDIRECT, response_type: 'code', scope: opts.scope ?? MCP_SCOPE, resource: c.resource, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
  if (opts.prompt) q.set('prompt', opts.prompt);
  let res = await b.fetch(`/oauth/authorize?${q}`);
  let consentHtml: string | undefined;
  for (let i = 0; i < 14; i += 1) {
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (loc.startsWith(REDIRECT)) {
        const cb = new URL(loc);
        return { code: cb.searchParams.get('code') ?? undefined, error: cb.searchParams.get('error') ?? undefined, verifier, consentHtml };
      }
      res = await b.fetch(loc);
      continue;
    }
    const html = await res.text();
    if (res.status === 200 && /name="csrf"/.test(html)) {
      consentHtml = html;
      if (!opts.consent) return { verifier, consentHtml, stoppedStatus: 200 };
      const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] as string;
      const action = /action="([^"]+\/confirm)"/.exec(html)?.[1] as string;
      res = await b.fetch(action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: c.origin }, body: `csrf=${encodeURIComponent(csrf)}` });
      continue;
    }
    return { verifier, consentHtml, stoppedStatus: res.status, body: html };
  }
  return { verifier, error: 'too_many_hops' };
}

export async function tokenRequest(c: Cluster, body: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${c.origin}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

export function redeemCode(c: Cluster, code: string, verifier: string, clientId = CLIENT) {
  return tokenRequest(c, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: c.resource });
}

export function refresh(c: Cluster, refreshToken: string, clientId = CLIENT) {
  return tokenRequest(c, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, resource: c.resource });
}

/** Signs in, consents and redeems: returns the token response. */
export async function connect(c: Cluster, user: string, opts: { scope?: string; clientId?: string } = {}) {
  const b = new Browser(c.origin, user);
  const out = await authorize(c, b, { ...opts, consent: true });
  if (!out.code) return { browser: b, outcome: out, token: undefined as undefined | { status: number; json: Record<string, unknown> } };
  return { browser: b, outcome: out, token: await redeemCode(c, out.code, out.verifier, opts.clientId) };
}

export async function verifyOn(c: Cluster, i: number, token: unknown): Promise<string | null> {
  if (typeof token !== 'string') return null;
  const v = await c.instances[i].verifyAccessToken(token, c.resource);
  return v?.userId ?? null;
}

export const SCOPE_OFFLINE = `${MCP_SCOPE} offline_access`;
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
