/// <reference path="./oidc-provider.d.ts" />
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import Provider, { errors, interactionPolicy, type InteractionDetails } from 'oidc-provider';
import { MCP_SCOPE, type AccessTokenVerifier } from '../http/remoteMcpHandler';
import { noopAuditSink, type McpAuditSink } from '../security/audit';
import { nodeAddressRequest, resolveClientAddressDetailed, type ClientAddressSource } from '../security/clientAddress';
import { isStoreUnavailableError, outsideRequestBudget, runWithRequestBudget } from '../security/deadline';
import { buildPreAuthRules, type BucketHasher } from '../security/preAuthRules';
import type { McpRateLimiter } from '../security/rateLimit';
import { validateClientRegistry } from './clientPolicy';
import { ephemeralOAuthKeys, type OAuthKeyMaterial } from './keys';
import { createMemoryAdapterStore } from './memoryAdapter';
import type { IssuedActivation, OAuthStore } from './oauthStore';

/**
 * AURA-MCP-02-I2a -- Aura OAuth authorization server foundation
 * (`oidc-provider` 9.13.3, D2 option A).
 *
 * Framework-free: `handle(req, res, path)` takes Node req/res, so the same
 * code runs under the Next Pages API mount (apps/web/pages/api/oauth) and
 * under a plain node:http server in tests.
 *
 * What it is (deliberately minimal for an MCP resource server):
 *   - Authorization Code + PKCE, S256 only, PKCE required for every client;
 *   - public clients (token_endpoint_auth_method "none"), statically
 *     registered by the caller -- no DCR, no CIMD (both deferred to I2b/I4);
 *   - RFC 8707 resource indicators: exactly one resource (the MCP URL),
 *     exactly one resource scope (`aura.planning.read`), opaque access
 *     tokens with a short TTL stored in the adapter, so revocation is
 *     immediate;
 *   - RFC 7009 revocation; RFC 9207 `iss` in authorization responses;
 *   - discovery at /.well-known/openid-configuration AND the RFC 8414 URL
 *     /.well-known/oauth-authorization-server (same document);
 *   - no refresh tokens, no userinfo, no end-session, no introspection, no
 *     registration, no device flow, no PAR, no DPoP, no dev interactions.
 *
 * Login reuses Aura's existing session: `resolveSessionUser(req)` is
 * injected (apps/web passes the existing `as_session` cookie verifier). The
 * server never sees a password or sign-in code. Consent is an explicit POST
 * protected by an HMAC CSRF token bound to (interaction uid, user id), an
 * Origin check and anti-framing headers.
 *
 * Identity binding (I2a-R1, F1): `oidc-provider` keeps its own login session
 * cookie. It is never trusted on its own. On EVERY authorization request the
 * login prompt re-checks that a current Aura session exists and names the
 * same user as the provider session; otherwise login is required again
 * (and `prompt=none` fails with login_required). Consent is also required on
 * every authorization request (`prompt=none` fails with consent_required),
 * so a previously authorized client can never obtain a code silently -- not
 * for another user, and not through an attacker-chosen PKCE challenge. A
 * stored grant is reused only if it belongs to the current account and
 * client.
 *
 * Only loopback peers may reach the authorization server (I2a-R1, F14).
 *
 * I2b additions (all opt-in; defaults keep the I2a behaviour):
 *   - durable, shared storage (`adapterStore`: postgresAdapter.ts) with
 *     atomic single-use codes and refresh tokens (F6);
 *   - configured signing / cookie keys with rotation (`keys`: keys.ts);
 *   - refresh tokens (`refreshTokens`): only for clients registered with
 *     `allow_refresh`, only when `offline_access` is requested and consented,
 *     always rotated, idle + absolute lifetime, replay revokes the grant;
 *   - pre-authentication throttling of every OAuth endpoint by trusted
 *     client address plus a global ceiling (`preAuth`, F5 / R1-L2). I2b-S2:
 *     addresses are bucketed IPv4 /32, IPv6 /64; a missing or invalid
 *     trusted address uses one shared bounded bucket and is audited
 *     (`oauth.address_unresolved`); the global ceiling is sharded with
 *     shard limits summing to exactly the ceiling (security/preAuthRules.ts);
 *   - I2b-S2 fail closed with 503: a limiter that cannot decide, or an
 *     OAuth state store that times out or errors, answers 503 (never 429,
 *     never a code or token);
 *   - ID tokens carry only a per-client pseudonymous `sub` (HMAC of client
 *     and user, keyed by the pairwise salt) -- never the Aura user id;
 *   - connected-assistant listing and disconnect (`listUserConnections`,
 *     `revokeUserClientGrants`), and a sign-in return URL.
 */

/** The slice of the Koa context the I2b-S4 issuance middleware uses. */
interface ProviderCtx {
  status: number;
  body: unknown;
  type: string;
  oidc?: { route?: string; entities?: unknown; params?: Record<string, unknown>; client?: { clientId?: string } };
  req: IncomingMessage;
  res: ServerResponse;
  response: { get(name: string): string };
  remove(name: string): void;
  set(name: string, value: string): void;
}

/** I2b-S12: the redirect statuses the provider uses for an authorization response. */
const AUTHORIZATION_REDIRECT_STATUSES: ReadonlySet<number> = new Set([302, 303]);

/**
 * AURA-MCP-02-I2b-S12 (S11 review R-P2-1): STRUCTURED validation of the
 * authorization-response redirect that carries a code -- no substring
 * matching. Valid only if ALL hold:
 *   - status 302 or 303;
 *   - `location` is an absolute URL whose origin and path are EXACTLY the
 *     registered callback's, with no userinfo and no fragment;
 *   - every query parameter registered on the callback is present with the
 *     same values (as a multiset);
 *   - exactly one `code` parameter, equal to the code; exactly one `state`
 *     equal to the requested state if one was requested, none otherwise; at
 *     most one `iss`, equal to the issuer (RFC 9207); nothing else;
 *   - the code occurs exactly ONCE in the whole location string (so it cannot
 *     also survive in the path, the fragment or another parameter).
 */
export function validateAuthorizationRedirect(x: { status: number; location: string; code: string; redirectUri: string; state?: string; issuer: string }): boolean {
  if (!AUTHORIZATION_REDIRECT_STATUSES.has(x.status) || typeof x.location !== 'string' || x.code.length === 0) return false;
  if (x.location.split(x.code).length - 1 !== 1) return false;
  let loc: URL;
  let reg: URL;
  try {
    loc = new URL(x.location);
    reg = new URL(x.redirectUri);
  } catch {
    return false;
  }
  if (loc.username || loc.password || loc.hash || x.location.includes('#')) return false;
  if (loc.origin !== reg.origin || loc.pathname !== reg.pathname) return false;
  const remaining = new Map<string, string[]>();
  for (const [k, v] of loc.searchParams) remaining.set(k, [...(remaining.get(k) ?? []), v]);
  const take = (k: string, v: string) => {
    const vals = remaining.get(k);
    const i = vals ? vals.indexOf(v) : -1;
    if (!vals || i < 0) return false;
    vals.splice(i, 1);
    if (vals.length === 0) remaining.delete(k);
    return true;
  };
  for (const [k, v] of reg.searchParams) if (!take(k, v)) return false; // registered parameters preserved
  if (!take('code', x.code)) return false;
  if (x.state !== undefined && !take('state', x.state)) return false;
  if (remaining.has('iss') && !take('iss', x.issuer)) return false;
  return remaining.size === 0; // no duplicate code / state / iss, nothing else
}

export interface AuraOAuthClient {
  client_id: string;
  redirect_uris: string[];
  /** Consent label. Chosen by Aura, never taken from the client. */
  label: string;
  /** I2b: may receive refresh tokens (also requires `refreshTokens.enabled` and consented offline_access). */
  allow_refresh?: boolean;
}

export interface RefreshTokenPolicy {
  enabled: boolean;
  /** Idle lifetime of each (rotated) refresh token, seconds (default 7 days). */
  ttlSeconds?: number;
  /** Absolute lifetime of the refresh-token chain from first issue, seconds (default 30 days). */
  absoluteLifetimeSeconds?: number;
}

export interface PreAuthThrottle {
  limiter: McpRateLimiter;
  /** Where the client address comes from (clientAddress.ts). */
  addressSource: ClientAddressSource;
  /** Requests per window per client address (default 120) and for all clients together (default 6000). */
  perAddress?: number;
  global?: number;
  /** Global ceiling shards (default: preAuthRules.defaultGlobalShards). */
  globalShards?: number;
  /** Test hook: shard selection (default: crypto random). */
  pickShard?: (shards: number) => number;
  /** I2b-S8 (S3-6): keyed hash for the address part of limiter keys (shared by every instance). */
  hashBucket?: BucketHasher;
}

export interface AuraConnection {
  grantId: string;
  clientId: string;
  /** Aura's label for the client (never client-supplied). */
  label: string;
  createdAt?: number;
}

export interface AuraOAuthServerOptions {
  /** Issuer (origin, no path), e.g. http://localhost:3000. */
  issuer: string;
  /** The only resource tokens can be issued for, e.g. http://localhost:3000/api/mcp. */
  resourceUrl: string;
  clients: readonly AuraOAuthClient[];
  /** Resolves the signed-in Aura user from the request, or null. */
  resolveSessionUser: (req: IncomingMessage) => Promise<{ userId: string } | null> | { userId: string } | null;
  /**
   * Where an unauthenticated user is sent to sign in. A function receives
   * the interaction path to return to (always an /oauth/interaction/ path).
   */
  signInUrl?: string | ((returnTo: string) => string);
  /**
   * Clients whose tokens the MCP resource accepts (client identity binding).
   * Defaults to every registered client.
   */
  resourceAllowedClientIds?: readonly string[];
  /** Access token lifetime in seconds (default 600). */
  accessTokenTtlSeconds?: number;
  audit?: McpAuditSink;
  /** Defaults to a fresh in-memory store (local/test only). */
  adapterStore?: OAuthStore;
  /** Defaults to fresh ephemeral keys (local/test only). */
  keys?: OAuthKeyMaterial;
  /** Default: no refresh tokens (I2a behaviour). */
  refreshTokens?: RefreshTokenPolicy;
  /** Default: none (local loopback only). */
  /**
   * I2b-S10: total time budget for the store calls of ONE request (after the
   * pre-auth throttle), ms (default 5000, 500..30000). Each store call is
   * also bounded by its own deadline; the budget caps their sum. The code
   * activation COMMIT after hand-off is bounded separately by the store.
   */
  requestBudgetMs?: number;
  preAuth?: PreAuthThrottle;
  /** Same-origin path of the connected-assistants page, linked from the consent page. */
  connectionsUrl?: string;
  /**
   * I2b ID-token policy. "disabled" (default): `openid` is removed from every request -- the MCP
   * flow is plain OAuth and needs no ID token, so none is issued. "pairwise":
   * ID tokens carry only a per-client pseudonymous `sub` (HMAC of client and
   * user, keyed by the pairwise salt); every client's redirect URIs must then
   * share one host (the pairwise sector).
   */
  idTokens?: 'disabled' | 'pairwise';
  /**
   * Accept requests whose TCP peer is not a loopback address. Default false:
   * a LAN peer of a local dev server gets 404 from every OAuth path.
   */
  allowNonLoopbackPeers?: boolean;
}

export interface AuraOAuthServer {
  provider: Provider;
  issuer: string;
  resourceUrl: string;
  /** Node request handler; `path` is the public path (e.g. /oauth/token). */
  handle(req: IncomingMessage, res: ServerResponse, path: string, search?: string): Promise<void>;
  /** Resource-server token verifier for remoteMcpHandler. */
  verifyAccessToken: AccessTokenVerifier;
  /** Client identity binding for remoteMcpHandler. */
  isClientAllowed(clientId: string): boolean;
  /** Revokes every token of every grant a user holds for a client (disconnect). */
  revokeUserClientGrants(userId: string, clientId: string): Promise<number>;
  /** Assistants the user has connected (registered clients only). */
  listUserConnections(userId: string): Promise<AuraConnection[]>;
  adapterStore: OAuthStore;
}

export const OAUTH_ROUTES = {
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  revocation: '/oauth/revoke',
  jwks: '/oauth/jwks',
} as const;
export const INTERACTION_PREFIX = '/oauth/interaction/';
const MAX_FORM_BYTES = 4096;
const LOOPBACK_PEERS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** True only for a loopback TCP peer address (as reported by the socket, not by headers). */
export function isLoopbackPeer(address: string | undefined): boolean {
  return typeof address === 'string' && LOOPBACK_PEERS.has(address);
}
const MAX_TOKEN_LENGTH = 512;

function isOriginOnly(value: string): boolean {
  try {
    const u = new URL(value);
    return u.pathname === '/' && !u.search && !u.hash && !u.username && !u.password && `${u.origin}` === value.replace(/\/$/, '');
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

const PAGE_HEADERS: Record<string, string> = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

function sendPage(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, PAGE_HEADERS);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5}button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style></head><body>${body}</body></html>`);
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams | null> {
  const type = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') return null;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_FORM_BYTES) return null;
    chunks.push(buf);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createAuraOAuthServer(options: AuraOAuthServerOptions): AuraOAuthServer {
  const issuer = options.issuer.replace(/\/$/, '');
  if (!isOriginOnly(issuer)) throw new TypeError('issuer must be an origin without a path');
  const resourceUrl = options.resourceUrl;
  if (new URL(resourceUrl).origin !== issuer) throw new TypeError('resourceUrl must share the issuer origin');
  const ttl = options.accessTokenTtlSeconds ?? 600;
  const audit = options.audit ?? noopAuditSink;
  const adapterStore: OAuthStore = options.adapterStore ?? createMemoryAdapterStore();
  // I2b: static registration policy (clientPolicy.ts) -- no DCR, no CIMD.
  const registry = validateClientRegistry(options.clients);
  if (registry.errors.length) throw new TypeError(`invalid OAuth client registry: ${registry.errors.join('; ')}`);
  const clientsById = new Map(options.clients.map((c) => [c.client_id, c]));
  const resourceClients: ReadonlySet<string> = new Set(options.resourceAllowedClientIds ?? clientsById.keys());

  // Keys: configured deployment secrets (keys.ts), or ephemeral per-process
  // keys for local development and tests. Never written or logged.
  const keys = options.keys ?? ephemeralOAuthKeys();
  // The consent CSRF key derives from the first cookie key, so every
  // instance sharing the configured keys accepts the same CSRF tokens.
  const csrfKeys = keys.source === 'configured' ? keys.cookieKeys.map((k) => createHmac('sha256', k).update('aura-mcp-consent-csrf-v1').digest()) : [randomBytes(32)];
  const idTokens = options.idTokens ?? 'disabled';
  if (idTokens === 'pairwise') {
    for (const c of options.clients) {
      if (new Set(c.redirect_uris.map((u) => new URL(u).host)).size !== 1) throw new TypeError(`idTokens "pairwise" requires client ${c.client_id} redirect_uris to share one host`);
    }
  }
  const pairwiseSub = (clientId: string, accountId: string) => createHmac('sha256', keys.pairwiseSalt).update(`aura-mcp-sub-v1\0${clientId}\0${accountId}`).digest('base64url');

  const refresh = options.refreshTokens?.enabled === true;
  const refreshIdle = options.refreshTokens?.ttlSeconds ?? 7 * 24 * 3600;
  const refreshAbsolute = options.refreshTokens?.absoluteLifetimeSeconds ?? 30 * 24 * 3600;
  if (refresh && !(refreshIdle > 0 && refreshAbsolute >= refreshIdle)) throw new TypeError('refreshTokens: absoluteLifetimeSeconds must be >= ttlSeconds > 0');
  const refreshAllowed = (clientId: string) => refresh && clientsById.get(clientId)?.allow_refresh === true;

  // F1: never trust the provider's own login session on its own.
  async function currentAuraUser(req: IncomingMessage): Promise<{ userId: string } | null> {
    try {
      const user = await options.resolveSessionUser(req);
      return user && typeof user.userId === 'string' && user.userId.length > 0 ? user : null;
    } catch {
      return null; // fail closed
    }
  }
  const { base: basePolicy, Check } = interactionPolicy;
  const policy = basePolicy();
  policy.get('login').checks.add(
    new Check('aura_session_binding', 'The Aura session does not match the authorization session', 'login_required', async (ctx: { req: IncomingMessage; oidc: { session?: { accountId?: string } } }) => {
      const user = await currentAuraUser(ctx.req);
      if (!user) return Check.REQUEST_PROMPT;
      return ctx.oidc.session?.accountId === user.userId ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
    }),
    0,
  );
  policy.get('consent').checks.add(
    new Check('aura_explicit_consent', 'Explicit consent is required for every authorization', 'consent_required', (ctx: { oidc: { result?: { consent?: unknown } } }) =>
      ctx.oidc.result?.consent ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT,
    ),
    0,
  );

  const provider = new Provider(issuer, {
    adapter: adapterStore.factory,
    clients: options.clients.map((c) => ({
      client_id: c.client_id,
      redirect_uris: c.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: refreshAllowed(c.client_id) ? ['authorization_code', 'refresh_token'] : ['authorization_code'],
      response_types: ['code'],
      // I2b-S11 (S10 review P2-2): codes are issued ONLY in a query redirect,
      // whose hand-off is verified at 'finish' (status + Location). form_post
      // and fragment are refused by the provider before any code exists.
      response_modes: ['query'],
      ...(idTokens === 'pairwise' ? { subject_type: 'pairwise' } : {}),
    })),
    ...(idTokens === 'pairwise'
      ? { subjectTypes: ['public', 'pairwise'], pairwiseIdentifier: async (_ctx: unknown, accountId: string, client: { clientId: string }) => pairwiseSub(client.clientId, accountId) }
      : {}),
    jwks: keys.jwks,
    cookies: { keys: keys.cookieKeys },
    routes: OAUTH_ROUTES,
    responseTypes: ['code'],
    clientAuthMethods: ['none'],
    scopes: refresh ? ['openid', 'offline_access'] : ['openid'],
    claims: { openid: ['sub'] },
    pkce: { required: () => true },
    // No profile claims at all; `sub` is pairwise (pairwiseIdentifier) when ID tokens are enabled.
    findAccount: async (_ctx: unknown, id: string) => ({ accountId: id, claims: async () => ({ sub: id }) }),
    // Refresh-token policies are configured only when refresh is enabled, so
    // the default server advertises and supports authorization_code only.
    ...(refresh
      ? {
          issueRefreshToken: async (_ctx: unknown, client: { clientId: string; grantTypeAllowed(g: string): boolean }, code: { scopes: Set<string> }) =>
            refreshAllowed(client.clientId) && client.grantTypeAllowed('refresh_token') && code.scopes.has('offline_access'),
          // Public clients: every refresh token is single use (atomic consume, F6).
          rotateRefreshToken: true,
        }
      : {}),
    interactions: { policy, url: (_ctx: unknown, interaction: { uid: string }) => `${INTERACTION_PREFIX}${interaction.uid}` },
    // Reuse a stored grant only if it belongs to the current account and client
    // (the library would otherwise throw on a mismatch).
    loadExistingGrant: async (ctx: { oidc: { result?: { consent?: { grantId?: string } }; session: { accountId?: string; grantIdFor(clientId: string): string | undefined }; client: { clientId: string }; provider: Provider } }) => {
      const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session.grantIdFor(ctx.oidc.client.clientId);
      if (!grantId) return undefined;
      const grant = await ctx.oidc.provider.Grant.find(grantId);
      if (!grant || grant.accountId !== ctx.oidc.session.accountId || grant.clientId !== ctx.oidc.client.clientId) return undefined;
      return grant;
    },
    ttl: {
      AccessToken: ttl,
      IdToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 3600,
      Grant: Math.max(30 * 24 * 3600, refreshAbsolute),
      // Idle lifetime, capped by the absolute lifetime of the chain (iiat =
      // when the first refresh token of this grant was issued).
      RefreshToken: (_ctx: unknown, token: { iiat?: number }) => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = (token.iiat ?? now) + refreshAbsolute - now;
        return Math.max(1, Math.min(refreshIdle, remaining));
      },
    },
    features: {
      devInteractions: { enabled: false },
      dPoP: { enabled: false },
      rpInitiatedLogout: { enabled: false },
      userinfo: { enabled: false },
      introspection: { enabled: false },
      registration: { enabled: false },
      pushedAuthorizationRequests: { enabled: false },
      // RFC 7009: a client may revoke only its own tokens (others get a
      // silent 200, so token existence is not disclosed).
      revocation: { enabled: true, allowedPolicy: async (_ctx: unknown, client: { clientId: string }, token: { clientId?: string }) => token.clientId === client.clientId },
      resourceIndicators: {
        enabled: true,
        defaultResource: () => resourceUrl,
        useGrantedResource: () => true,
        getResourceServerInfo: (_ctx: unknown, resourceIndicator: string) => {
          if (resourceIndicator !== resourceUrl) throw new errors.InvalidTarget();
          return { scope: MCP_SCOPE, audience: resourceUrl, accessTokenTTL: ttl, accessTokenFormat: 'opaque' };
        },
      },
    },
    // Error pages carry the OAuth error code only (no descriptions/stack).
    renderError: async (ctx: { type: string; body: string; status: number }, out: { error?: string }) => {
      const code = String(out.error ?? 'server_error');
      const hint =
        code === 'login_required' || code === 'consent_required' || code === 'interaction_required'
          ? 'Open Aura in this browser, sign in, and connect the assistant again.'
          : code === 'access_denied'
            ? 'The connection was not allowed. You can start again from your assistant.'
            : 'Return to your assistant and start connecting again.';
      ctx.type = 'html';
      ctx.body = `<!doctype html><meta charset="utf-8"><title>Authorization error</title><p>Authorization failed: ${escapeHtml(code)}</p><p>${hint}</p>`;
    },
  });

  // Audit hooks: ids and error codes only.
  provider.on('grant.success', (ctx: { oidc?: { params?: { grant_type?: string }; client?: { clientId?: string }; entities?: { AccessToken?: { accountId?: string } } } }) =>
    audit({
      event: ctx.oidc?.params?.grant_type === 'refresh_token' ? 'oauth.token_refreshed' : 'oauth.token_issued',
      outcome: 'ok',
      clientId: ctx.oidc?.client?.clientId,
      userId: ctx.oidc?.entities?.AccessToken?.accountId,
    }),
  );
  provider.on('grant.error', (ctx: { oidc?: { client?: { clientId?: string } } }, err: { error?: string; error_description?: string; message?: string }) => {
    // Code / refresh-token reuse (library check or lost atomic consume): the grant is revoked.
    const e = err as { error?: string; error_detail?: string; error_description?: string; message?: string };
    const replay = e?.error === 'invalid_grant' && /already (consumed|used)/.test(`${e?.error_detail ?? ''} ${e?.message ?? ''}`);
    audit(replay
      ? { event: 'oauth.replay_detected', outcome: 'grant_revoked', clientId: ctx.oidc?.client?.clientId, errorCode: err?.error }
      : { event: 'oauth.error', outcome: 'token_error', clientId: ctx.oidc?.client?.clientId, errorCode: err?.error });
  });
  provider.on('authorization.error', (ctx: { oidc?: { client?: { clientId?: string } } }, err: { error?: string }) =>
    audit({ event: 'oauth.error', outcome: 'authorization_error', clientId: ctx.oidc?.client?.clientId, errorCode: err?.error }),
  );
  provider.on('access_token.destroyed', (token: { clientId?: string; accountId?: string }) =>
    audit({ event: 'oauth.token_revoked', outcome: 'ok', clientId: token?.clientId, userId: token?.accountId }),
  );
  provider.on('revocation.error', (ctx: { oidc?: { client?: { clientId?: string } } }, err: { error?: string }) =>
    audit({ event: 'oauth.error', outcome: 'revocation_error', clientId: ctx.oidc?.client?.clientId, errorCode: err?.error }),
  );
  provider.on('server_error', (_ctx: unknown, err: unknown) => {
    audit({ event: 'oauth.error', outcome: isStoreUnavailableError(err) ? 'store_unavailable' : 'server_error', errorCode: err instanceof Error ? err.name : 'Error' });
  });

  /**
   * I2b-S4 / S10 (S3-1): authorization-code issuance is fail-closed by
   * database state, on every instance, with no write needed on failure.
   *
   * `oidc-provider` writes the code (the store makes it PENDING: not
   * findable, not consumable), sets the redirect, saves the session, and
   * Koa writes the response only after this outermost middleware returns.
   * For a code created by this request (any route but the token endpoint):
   *   1. It is deliverable only if the final response is < 400, actually
   *      carries the code in its redirect Location (I2b-S11: the only
   *      response mode offered is query; a body-carried code is never
   *      deliverable), headers are not yet
   *      sent and the client is still connected. Otherwise the code is
   *      never sent and stays pending.
   *   2. Before the response is written, `beginIssuedActivation` runs the
   *      activation UPDATE in a transaction that is NOT committed (it also
   *      proves the live pending row exists; if not, 503 and nothing sent).
   *   3. The response is written. Only when it has been COMPLETELY handed
   *      to the runtime (`finish`) with the same < 400 status that still
   *      carries the code is the activation COMMITTED: the code is "issued".
   *      Any other outcome -- close before finish (disconnect, partial
   *      write), a response Koa replaced with an error, a hand-off that
   *      never comes, a crash or freeze of this process, an unreachable
   *      database -- ABANDONS it: the transaction is never committed and the
   *      database rolls it back, so the code stays pending on every
   *      instance. Nothing depends on instance memory, a deny list or a
   *      revocation write that could fail in the same outage.
   *
   * What is and is not claimed:
   *   - "issued" means handed to the runtime, not received: hand-off cannot
   *     prove receipt (no atomicity between persistence and HTTP delivery
   *     is claimed). An issued code the client never received stays
   *     redeemable only with its PKCE verifier, once, until its 60 s TTL.
   *   - A partial write may have put code bytes on the wire; such a code is
   *     abandoned (pending), so it cannot be redeemed anywhere.
   *   - The COMMIT itself can be lost after hand-off ('unknown'): the code
   *     is then either redeemable (issued) or pending (the client's
   *     redemption fails, fail-closed). Both are safe.
   * Every response >= 400 loses its Location header. No code value is logged.
   */
  const connectionGone = (ctx: ProviderCtx) => ctx.res.destroyed === true || ctx.req.socket?.destroyed === true;
  /** Per response: settles once the activation of its code is committed or abandoned (handle() awaits it). */
  const issuance = new WeakMap<ServerResponse, Promise<void>>();
  const unavailable = (ctx: ProviderCtx) => {
    if (ctx.res.headersSent) return; // nothing can be changed; the code stays pending (never activated)
    ctx.remove('Location');
    ctx.status = 503;
    ctx.set('cache-control', 'no-store');
    ctx.set('retry-after', '1');
    ctx.type = 'json';
    ctx.body = JSON.stringify({ error: 'temporarily_unavailable' });
  };

  provider.use(async (ctx: ProviderCtx, next: () => Promise<void>) => {
    await next();
    let code: string | undefined;
    try {
      const ac = ctx.oidc?.route !== 'token' ? (ctx.oidc?.entities as { AuthorizationCode?: { jti?: string } } | undefined)?.AuthorizationCode : undefined;
      code = typeof ac?.jti === 'string' ? ac.jti : undefined;
    } catch {
      code = undefined;
    }
    if (code) {
      const location = String(ctx.response.get('Location') ?? '');
      const body = typeof ctx.body === 'string' ? ctx.body : '';
      // Any trace of the code anywhere: an undeliverable response is scrubbed (503).
      const carries = location.includes(code) || body.includes(code);
      // I2b-S12 (R-P2-1): deliverable only as a structurally valid query-mode
      // redirect to a callback REGISTERED for this client (S11: query mode only).
      const params = ctx.oidc?.params ?? {};
      const redirectUri = typeof params.redirect_uri === 'string' ? params.redirect_uri : '';
      const clientId = ctx.oidc?.client?.clientId;
      const registered = options.clients.some((c) => c.client_id === clientId && c.redirect_uris.includes(redirectUri));
      const state = typeof params.state === 'string' ? params.state : undefined;
      const validRedirect = registered && validateAuthorizationRedirect({ status: ctx.status, location, code, redirectUri, state, issuer });
      const deliverable = validRedirect && !connectionGone(ctx) && !ctx.res.headersSent;
      let activation: IssuedActivation | null = null;
      let ready = !adapterStore.beginIssuedActivation; // stores without pending codes write them active
      if (deliverable && adapterStore.beginIssuedActivation) {
        try {
          activation = await adapterStore.beginIssuedActivation('AuthorizationCode', code);
        } catch {
          activation = null; // store unavailable: nothing was written, the code stays pending
        }
        ready = activation !== null;
      }
      if (deliverable && ready && connectionGone(ctx)) {
        // The client left during activation: nothing is sent.
        activation?.abort();
        audit({ event: 'oauth.error', outcome: 'not_delivered', errorCode: 'CodeDeliveryAbandoned' });
        ctx.remove('Location');
        ctx.status = 503;
        ctx.body = '';
      } else if (deliverable && !ready) {
        audit({ event: 'oauth.error', outcome: 'store_unavailable', errorCode: 'CodeActivationFailed' });
        unavailable(ctx);
      } else if (!deliverable) {
        // Never sent (error response, no code in it, or client gone): pending forever.
        if (carries) unavailable(ctx);
      } else if (activation) {
        const held = activation;
        const res = ctx.res;
        const status = ctx.status;
        // The exact redirect validated above: the hand-off must match it byte for byte.
        const validatedLocation = location;
        issuance.set(
          res,
          new Promise<void>((resolve) => {
            let done = false;
            const settle = () => {
              if (done) return;
              done = true;
              clearTimeout(backstop);
              resolve();
            };
            const abandon = () => {
              held.abort();
              audit({ event: 'oauth.error', outcome: 'not_delivered', errorCode: 'CodeDeliveryAbandoned' });
              settle();
            };
            // Backstop only: a hand-off that never comes is abandoned (the store aborts it too).
            const backstop = setTimeout(abandon, 10_000);
            (backstop as { unref?: () => void }).unref?.();
            res.once('finish', () => {
              // I2b-S12 (R-P2-1): the FINISHED response must be exactly the validated
              // redirect -- same status, byte-identical Location.
              const intact = res.statusCode === status && String(res.getHeader('location') ?? '') === validatedLocation;
              if (!intact) return abandon(); // replaced (e.g. Koa error handler): never committed
              // The request budget does not apply: the response is already out.
              outsideRequestBudget(() => held.commit()).then((outcome) => {
                if (outcome !== 'committed') audit({ event: 'oauth.error', outcome: 'store_unavailable', errorCode: outcome === 'unknown' ? 'CodeActivationUnconfirmed' : 'CodeActivationNotCommitted' });
                settle();
              }, settle);
            });
            res.once('close', () => {
              if (!res.writableFinished) abandon(); // disconnect / partial write: never committed
            });
          }),
        );
      }
    }
    if (ctx.status >= 400) ctx.remove('Location');
    // I2b-S11 (P2-2): discovery advertises only the response mode Aura issues codes in.
    if (ctx.oidc?.route === 'discovery' && ctx.body && typeof ctx.body === 'object') (ctx.body as Record<string, unknown>).response_modes_supported = ['query'];
  });

  /**
   * I2b-S8 (I2b-R-3): request-origin pinning. `oidc-provider` builds every
   * absolute URL it emits (discovery endpoints, jwks_uri, the interaction
   * resume redirect) from Koa's `ctx.href`, i.e. from the request's Host
   * header -- client-controlled, and behind a TLS-terminating edge also on
   * the wrong scheme. Before the provider (or the interaction pages) see a
   * request, its origin is overwritten from the CONFIGURED issuer, and every
   * forwarded-origin header is replaced, so no client-supplied Host,
   * X-Forwarded-Host/-Proto/-Port, Forwarded or X-Forwarded-For value can
   * influence the issuer, an endpoint URL, a redirect, the resource identity
   * or cookie security. (The issuer and resource themselves already come
   * only from configuration.) Pre-auth address resolution runs before this
   * and reads only its configured source.
   */
  const requestBudgetMs = options.requestBudgetMs ?? 5000;
  if (!Number.isInteger(requestBudgetMs) || requestBudgetMs < 500 || requestBudgetMs > 30_000) throw new TypeError('requestBudgetMs must be an integer between 500 and 30000');
  const issuerUrl = new URL(issuer);
  provider.proxy = true;
  const ORIGIN_HEADERS = ['host', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-for', 'forwarded'];
  function pinRequestOrigin(req: IncomingMessage): void {
    for (const h of ORIGIN_HEADERS) delete req.headers[h];
    req.headers.host = issuerUrl.host;
    req.headers['x-forwarded-host'] = issuerUrl.host;
    req.headers['x-forwarded-proto'] = issuerUrl.protocol.replace(/:$/, '');
  }

  const providerCallback = provider.callback();
  const csrfWith = (key: Buffer, uid: string, userId: string) => createHmac('sha256', key).update(`${uid}\0${userId}`).digest('base64url');
  // New tokens use the first key; tokens made with any configured key verify (key rotation).
  const csrfFor = (uid: string, userId: string) => csrfWith(csrfKeys[0], uid, userId);
  const csrfValid = (presented: string, uid: string, userId: string) =>
    csrfKeys.some((k) => {
      const expected = csrfWith(k, uid, userId);
      return presented.length === expected.length && timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    });

  async function finish(req: IncomingMessage, res: ServerResponse, result: Record<string, unknown>): Promise<void> {
    const redirectTo = await provider.interactionResult(req, res, result, { mergeWithLastSubmission: false });
    res.writeHead(303, { location: redirectTo, 'cache-control': 'no-store' });
    res.end();
  }

  /**
   * F1: the provider session belongs to a different Aura user than the one
   * signed in now (sign-out + sign-in, or an account switch). Destroy that
   * provider session -- in the store, so it is unusable even if the browser
   * keeps the cookie, and by expiring its cookies -- then restart the same,
   * already validated authorization request so the current user logs in
   * fresh. (The library's own account-switch path needs RP-initiated logout,
   * which is deliberately disabled.)
   */
  async function resetProviderSessionAndRestart(req: IncomingMessage, res: ServerResponse, details: InteractionDetails): Promise<void> {
    const sessionCookie = provider.cookieName('session');
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0 && part.slice(0, i).trim() === sessionCookie) {
        const jti = decodeURIComponent(part.slice(i + 1).trim());
        if (jti) await new adapterStore.factory('Session').destroy(jti);
      }
    }
    const expired = 'Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax';
    const restart = new URLSearchParams();
    for (const [k, v] of Object.entries(details.params)) if (typeof v === 'string') restart.set(k, v);
    audit({ event: 'oauth.error', outcome: 'provider_session_reset', clientId: String(details.params.client_id ?? '') });
    res.writeHead(303, {
      location: `${OAUTH_ROUTES.authorization}?${restart}`,
      'cache-control': 'no-store',
      'set-cookie': [`${sessionCookie}=; ${expired}`, `${sessionCookie}.sig=; ${expired}`],
    });
    res.end();
  }

  /** Grants exactly the allowlisted scopes the prompt is missing. */
  async function grantFor(details: InteractionDetails, userId: string): Promise<string> {
    const clientId = String(details.params.client_id);
    const found = details.grantId ? await provider.Grant.find(details.grantId) : undefined;
    const existing = found && found.accountId === userId && found.clientId === clientId ? found : undefined;
    const grant = existing ?? new provider.Grant({ accountId: userId, clientId });
    // Always (re)state the allowlisted scopes this request asked for.
    const requested = String(details.params.scope ?? '').split(' ');
    if (requested.includes(MCP_SCOPE)) grant.addResourceScope(resourceUrl, MCP_SCOPE);
    if (requested.includes('openid')) grant.addOIDCScope('openid');
    if (requested.includes('offline_access') && refreshAllowed(clientId)) grant.addOIDCScope('offline_access');
    const d = details.prompt.details as { missingOIDCScope?: string[]; missingResourceScopes?: Record<string, string[]> };
    const oidc = (d.missingOIDCScope ?? []).filter((s) => s === 'openid' || (s === 'offline_access' && refreshAllowed(clientId)));
    if (oidc.length) grant.addOIDCScope(oidc.join(' '));
    for (const [resource, scopes] of Object.entries(d.missingResourceScopes ?? {})) {
      const allowed = scopes.filter((s) => s === MCP_SCOPE);
      if (resource === resourceUrl && allowed.length) grant.addResourceScope(resource, allowed.join(' '));
    }
    return grant.save();
  }

  async function handleInteraction(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const rest = path.slice(INTERACTION_PREFIX.length);
    const parts = rest.split('/');
    if (parts.length > 2 || !parts[0]) return sendPage(res, 404, 'Not found', '<h1>Not found</h1>');
    const [uid, action] = parts;
    let details: InteractionDetails;
    try {
      details = await provider.interactionDetails(req, res);
    } catch (err) {
      // I2b-S8 (S3-3): an unavailable store is an outage (503), not an expired request.
      if (isStoreUnavailableError(err)) throw err;
      return sendPage(res, 400, 'Request expired', '<h1>This request has expired</h1><p>Return to the assistant and start connecting again.</p>');
    }
    if (details.uid !== uid) return sendPage(res, 400, 'Request expired', '<h1>This connection request is no longer valid</h1><p>Return to your assistant and start connecting again.</p>');

    const user = await currentAuraUser(req);
    if (!user) {
      if (req.method === 'POST') return sendPage(res, 401, 'Sign in required', '<h1>Sign in required</h1>');
      const returnTo = `${INTERACTION_PREFIX}${encodeURIComponent(uid)}`;
      const target = typeof options.signInUrl === 'function' ? options.signInUrl(returnTo) : (options.signInUrl ?? '/');
      const signIn = escapeHtml(target);
      return sendPage(res, 401, 'Sign in to Aura', `<h1>Sign in to Aura</h1><p>Sign in to Aura in this browser to continue connecting. You will come back here afterwards.</p><p><a href="${signIn}">Sign in</a></p>`);
    }

    // A provider session for a different Aura user must never be reused.
    const accountChanged = !!details.session?.accountId && details.session.accountId !== user.userId;

    if (details.prompt.name === 'login') {
      // Login is the existing Aura session; nothing new is collected here.
      if (req.method !== 'GET' || action) return sendPage(res, 405, 'Invalid request', '<h1>Invalid request</h1>');
      if (accountChanged) return resetProviderSessionAndRestart(req, res, details);
      // Transient provider session: it never outlives the browser session,
      // and it is re-bound to the Aura session on every request anyway.
      return finish(req, res, { login: { accountId: user.userId, remember: false } });
    }

    if (details.prompt.name !== 'consent') return finish(req, res, { error: 'access_denied' });

    const client = clientsById.get(String(details.params.client_id));
    if (!client) return finish(req, res, { error: 'unauthorized_client' });

    if (req.method === 'GET' && !action) {
      if (accountChanged) return resetProviderSessionAndRestart(req, res, details);
      const csrf = csrfFor(uid, user.userId);
      const base = `${INTERACTION_PREFIX}${encodeURIComponent(uid)}`;
      const stays = String(details.params.scope ?? '').split(' ').includes('offline_access') && refreshAllowed(client.client_id);
      const duration = stays
        ? `<p>It will stay connected for up to ${Math.round(refreshAbsolute / 86400)} days, unless you disconnect it sooner.</p>`
        : '<p>Access lasts a short time; the assistant will ask again later.</p>';
      const manage = options.connectionsUrl ? `<p>You can disconnect it at any time in <a href="${escapeHtml(options.connectionsUrl)}">Connected assistants</a>.</p>` : '';
      return sendPage(
        res,
        200,
        'Connect to Aura',
        `<h1>Connect ${escapeHtml(client.label)} to Aura?</h1>
<p>It will be able to <strong>find suitable times for activities</strong> using Aura's timing search (read-only). It cannot change anything in your Aura account.</p>
${duration}${manage}
<form method="post" action="${base}/confirm"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Allow</button></form>
<form method="post" action="${base}/abort"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Deny</button></form>`,
      );
    }

    if (req.method !== 'POST' || (action !== 'confirm' && action !== 'abort')) return sendPage(res, 405, 'Invalid request', '<h1>Invalid request</h1>');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== issuer) return sendPage(res, 403, 'Forbidden', '<h1>Forbidden</h1>');
    const form = await readForm(req);
    const presented = form?.get('csrf') ?? '';
    if (!csrfValid(presented, uid, user.userId)) return sendPage(res, 403, 'Forbidden', '<h1>Forbidden</h1>');
    if (accountChanged) return finish(req, res, { error: 'login_required', error_description: 'The signed-in account changed.' });

    if (action === 'abort') {
      audit({ event: 'oauth.grant', outcome: 'denied', clientId: client.client_id, userId: user.userId });
      return finish(req, res, { error: 'access_denied', error_description: 'The user denied access.' });
    }
    const grantId = await grantFor(details, user.userId);
    audit({ event: 'oauth.grant', outcome: 'ok', clientId: client.client_id, userId: user.userId });
    return finish(req, res, { consent: { grantId } });
  }

  /**
   * The library keeps `offline_access` only when `prompt` includes `consent`
   * (an OIDC rule). Aura requires explicit consent on EVERY authorization
   * anyway (aura_explicit_consent), so for refresh-capable requests that rule
   * is made explicit. `prompt=none` is left alone, so it still fails.
   */
  function authorizationSearch(providerPath: string, search: string): string {
    if (providerPath !== OAUTH_ROUTES.authorization || !search) return search;
    const q = new URLSearchParams(search.slice(1));
    let scopes = String(q.get('scope') ?? '').split(' ').filter(Boolean);
    let changed = false;
    // ID tokens disabled: `openid` is removed, so the grant is narrower and
    // no ID token can be issued (RFC 6749 s3.3 allows a narrower scope).
    if (idTokens === 'disabled' && scopes.includes('openid')) {
      scopes = scopes.filter((s) => s !== 'openid');
      q.set('scope', scopes.join(' '));
      changed = true;
    }
    if (refresh && scopes.includes('offline_access')) {
      const prompts = String(q.get('prompt') ?? '').split(' ').filter(Boolean);
      if (!prompts.includes('none') && !prompts.includes('consent')) {
        q.set('prompt', [...prompts, 'consent'].join(' '));
        changed = true;
      }
    }
    return changed ? `?${q}` : search;
  }

  /** Returns the refusal (429 throttled, 503 limiter unavailable) when the request must not proceed, else null. */
  async function preAuthThrottled(req: IncomingMessage): Promise<{ status: 429 | 503; retryAfter: number } | null> {
    const pre = options.preAuth as PreAuthThrottle;
    const resolved = resolveClientAddressDetailed(nodeAddressRequest(req as never), pre.addressSource);
    // I2b-S2: no usable trusted address -> the shared bounded bucket, audited (never the value).
    if (resolved.kind === 'unresolved' && resolved.reason !== 'no_source') audit({ event: 'oauth.address_unresolved', outcome: 'unresolved', errorCode: resolved.reason });
    const rules = buildPreAuthRules(
      'preauth-as',
      resolved.kind === 'resolved' ? resolved.address : null,
      { perAddress: pre.perAddress ?? 120, global: pre.global ?? 6000, globalShards: pre.globalShards },
      pre.pickShard,
      pre.hashBucket,
    );
    const decision = await pre.limiter.check(rules);
    if (decision.allowed) return null;
    if (decision.limitedBy === 'unavailable') {
      audit({ event: 'oauth.throttled', outcome: 'limiter_unavailable', limitedBy: 'unavailable', cause: decision.cause });
      return { status: 503, retryAfter: 1 };
    }
    audit({ event: 'oauth.throttled', outcome: 'preauth_throttled', limitedBy: decision.limitedBy });
    return { status: 429, retryAfter: Math.max(1, decision.retryAfterSeconds) };
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string, search = ''): Promise<void> {
    try {
      if (!options.allowNonLoopbackPeers && !isLoopbackPeer(req.socket?.remoteAddress)) {
        res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
        res.end('Not Found');
        return;
      }
      // F5: throttle every unauthenticated OAuth request before any work.
      if (options.preAuth) {
        const throttled = await preAuthThrottled(req);
        if (throttled !== null) {
          res.writeHead(throttled.status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(throttled.retryAfter) });
          res.end(JSON.stringify({ error: throttled.status === 503 ? 'temporarily_unavailable' : 'rate_limited' }));
          return;
        }
      }
      pinRequestOrigin(req);
      // I2b-S10: every store call of this request shares ONE budget (requestBudgetMs).
      await runWithRequestBudget(requestBudgetMs, async () => {
        if (path.startsWith(INTERACTION_PREFIX)) {
          await handleInteraction(req, res, path);
          return;
        }
        // RFC 8414 discovery is served from the same document as OIDC discovery.
        const providerPath = path === '/.well-known/oauth-authorization-server' ? '/.well-known/openid-configuration' : path;
        req.url = `${providerPath}${authorizationSearch(providerPath, search)}`;
        await new Promise<void>((resolve) => {
          res.once('finish', resolve);
          res.once('close', resolve);
          providerCallback(req, res);
        });
      });
      // I2b-S10: stay alive until this response's code is committed or abandoned
      // (bounded: activation hold + COMMIT bound in the store).
      await issuance.get(res);
    } catch (err) {
      // I2b-S2: an unavailable OAuth state store is a 503; nothing was issued.
      const unavailable = isStoreUnavailableError(err);
      audit({ event: 'oauth.error', outcome: unavailable ? 'store_unavailable' : 'server_error', errorCode: err instanceof Error ? err.name : 'Error' });
      if (!res.headersSent) {
        // I2b-S4 (S3-1): never let a prepared success redirect out with an error.
        res.removeHeader('location');
        res.writeHead(unavailable ? 503 : 500, { 'content-type': 'application/json', 'cache-control': 'no-store', ...(unavailable ? { 'retry-after': '1' } : {}) });
        res.end(JSON.stringify({ error: unavailable ? 'temporarily_unavailable' : 'server_error' }));
      }
    }
  }

  const verifyAccessToken: AccessTokenVerifier = async (token, resource) => {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    if (resource !== resourceUrl) return null;
    const at = await provider.AccessToken.find(token);
    if (!at || at.isExpired) return null;
    const aud = Array.isArray(at.aud) ? at.aud : [at.aud];
    if (!aud.includes(resourceUrl)) return null;
    if (!at.accountId || !at.clientId || !at.grantId) return null;
    // Revoked grants (disconnect) invalidate their tokens immediately.
    const grant = await provider.Grant.find(at.grantId);
    if (!grant || grant.accountId !== at.accountId || grant.clientId !== at.clientId) return null;
    if (!(await provider.Client.find(at.clientId))) return null;
    return { userId: at.accountId, clientId: at.clientId, scopes: (at.scope ?? '').split(' ').filter(Boolean) };
  };

  async function revokeUserClientGrants(userId: string, clientId: string): Promise<number> {
    const revoked = await adapterStore.revokeUserClientGrants(userId, clientId);
    audit({ event: 'oauth.grant_revoked', outcome: revoked ? 'ok' : 'none', clientId, userId });
    return revoked;
  }

  async function listUserConnections(userId: string): Promise<AuraConnection[]> {
    const grants = await adapterStore.listUserGrants(userId);
    const out: AuraConnection[] = [];
    for (const g of grants) {
      const client = clientsById.get(g.clientId);
      if (client) out.push({ grantId: g.grantId, clientId: g.clientId, label: client.label, createdAt: g.createdAt });
    }
    return out;
  }

  return {
    provider,
    issuer,
    resourceUrl,
    handle,
    verifyAccessToken,
    isClientAllowed: (clientId) => resourceClients.has(clientId),
    revokeUserClientGrants,
    listUserConnections,
    adapterStore,
  };
}
