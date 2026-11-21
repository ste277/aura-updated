/// <reference path="./oidc-provider.d.ts" />
import { createHmac, generateKeyPairSync, randomBytes, timingSafeEqual } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import Provider, { errors, type InteractionDetails } from 'oidc-provider';
import { MCP_SCOPE, type AccessTokenVerifier } from '../http/remoteMcpHandler';
import { noopAuditSink, type McpAuditSink } from '../security/audit';
import { createMemoryAdapterStore, type MemoryAdapterStore } from './memoryAdapter';

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
 */

export interface AuraOAuthClient {
  client_id: string;
  redirect_uris: string[];
  /** Consent label. Chosen by Aura, never taken from the client. */
  label: string;
}

export interface AuraOAuthServerOptions {
  /** Issuer (origin, no path), e.g. http://localhost:3000. */
  issuer: string;
  /** The only resource tokens can be issued for, e.g. http://localhost:3000/api/mcp. */
  resourceUrl: string;
  clients: readonly AuraOAuthClient[];
  /** Resolves the signed-in Aura user from the request, or null. */
  resolveSessionUser: (req: IncomingMessage) => Promise<{ userId: string } | null> | { userId: string } | null;
  /** Where an unauthenticated user is sent to sign in. */
  signInUrl?: string;
  /**
   * Clients whose tokens the MCP resource accepts (client identity binding).
   * Defaults to every registered client.
   */
  resourceAllowedClientIds?: readonly string[];
  /** Access token lifetime in seconds (default 600). */
  accessTokenTtlSeconds?: number;
  audit?: McpAuditSink;
  /** Defaults to a fresh in-memory store (local/test only). */
  adapterStore?: MemoryAdapterStore;
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
  adapterStore: MemoryAdapterStore;
}

export const OAUTH_ROUTES = {
  authorization: '/oauth/authorize',
  token: '/oauth/token',
  revocation: '/oauth/revoke',
  jwks: '/oauth/jwks',
} as const;
export const INTERACTION_PREFIX = '/oauth/interaction/';
const MAX_FORM_BYTES = 4096;
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
  const adapterStore = options.adapterStore ?? createMemoryAdapterStore();
  const clientsById = new Map(options.clients.map((c) => [c.client_id, c]));
  if (clientsById.size === 0) throw new TypeError('at least one client is required');
  const resourceClients: ReadonlySet<string> = new Set(options.resourceAllowedClientIds ?? clientsById.keys());

  // Ephemeral, process-local keys: generated in memory, never written or
  // logged. A durable deployment needs managed keys (deferred).
  const signingKey = { ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }), kid: `local-${randomBytes(6).toString('hex')}`, use: 'sig', alg: 'RS256' };
  const cookieKeys = [randomBytes(32).toString('base64url')];
  const csrfKey = randomBytes(32);

  const provider = new Provider(issuer, {
    adapter: adapterStore.factory,
    clients: options.clients.map((c) => ({
      client_id: c.client_id,
      redirect_uris: c.redirect_uris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
    })),
    jwks: { keys: [signingKey] },
    cookies: { keys: cookieKeys },
    routes: OAUTH_ROUTES,
    responseTypes: ['code'],
    clientAuthMethods: ['none'],
    scopes: ['openid'],
    claims: { openid: ['sub'] },
    pkce: { required: () => true },
    findAccount: async (_ctx: unknown, id: string) => ({ accountId: id, claims: async () => ({ sub: id }) }),
    interactions: { url: (_ctx: unknown, interaction: { uid: string }) => `${INTERACTION_PREFIX}${interaction.uid}` },
    ttl: {
      AccessToken: ttl,
      IdToken: 300,
      AuthorizationCode: 60,
      Interaction: 600,
      Session: 3600,
      Grant: 30 * 24 * 3600,
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
      ctx.type = 'html';
      ctx.body = `<!doctype html><meta charset="utf-8"><title>Authorization error</title><p>Authorization failed: ${escapeHtml(String(out.error ?? 'server_error'))}</p>`;
    },
  });

  // Audit hooks: ids and error codes only.
  provider.on('grant.success', (ctx: { oidc?: { client?: { clientId?: string }; entities?: { AccessToken?: { accountId?: string } } } }) =>
    audit({ event: 'oauth.token_issued', outcome: 'ok', clientId: ctx.oidc?.client?.clientId, userId: ctx.oidc?.entities?.AccessToken?.accountId }),
  );
  provider.on('grant.error', (ctx: { oidc?: { client?: { clientId?: string } } }, err: { error?: string }) =>
    audit({ event: 'oauth.error', outcome: 'token_error', clientId: ctx.oidc?.client?.clientId, errorCode: err?.error }),
  );
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
    audit({ event: 'oauth.error', outcome: 'server_error', errorCode: err instanceof Error ? err.name : 'Error' });
  });

  const providerCallback = provider.callback();
  const csrfFor = (uid: string, userId: string) => createHmac('sha256', csrfKey).update(`${uid}\0${userId}`).digest('base64url');

  async function finish(req: IncomingMessage, res: ServerResponse, result: Record<string, unknown>): Promise<void> {
    const redirectTo = await provider.interactionResult(req, res, result, { mergeWithLastSubmission: false });
    res.writeHead(303, { location: redirectTo, 'cache-control': 'no-store' });
    res.end();
  }

  /** Grants exactly the allowlisted scopes the prompt is missing. */
  async function grantFor(details: InteractionDetails, userId: string): Promise<string> {
    const clientId = String(details.params.client_id);
    const existing = details.grantId ? await provider.Grant.find(details.grantId) : undefined;
    const grant = existing ?? new provider.Grant({ accountId: userId, clientId });
    const d = details.prompt.details as { missingOIDCScope?: string[]; missingResourceScopes?: Record<string, string[]> };
    const oidc = (d.missingOIDCScope ?? []).filter((s) => s === 'openid');
    if (oidc.length) grant.addOIDCScope(oidc.join(' '));
    for (const [resource, scopes] of Object.entries(d.missingResourceScopes ?? {})) {
      const allowed = scopes.filter((s) => s === MCP_SCOPE);
      if (resource === resourceUrl && allowed.length) grant.addResourceScope(resource, allowed.join(' '));
    }
    return grant.save();
  }

  async function handleInteraction(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
    const rest = path.slice(INTERACTION_PREFIX.length);
    const [uid, action] = rest.split('/');
    let details: InteractionDetails;
    try {
      details = await provider.interactionDetails(req, res);
    } catch {
      return sendPage(res, 400, 'Request expired', '<h1>This request has expired</h1><p>Return to the assistant and start connecting again.</p>');
    }
    if (details.uid !== uid) return sendPage(res, 400, 'Invalid request', '<h1>Invalid request</h1>');

    const user = await options.resolveSessionUser(req);
    if (!user) {
      if (req.method === 'POST') return sendPage(res, 401, 'Sign in required', '<h1>Sign in required</h1>');
      const signIn = escapeHtml(options.signInUrl ?? '/');
      return sendPage(res, 401, 'Sign in to Aura', `<h1>Sign in to Aura</h1><p>Sign in to Aura in this browser, then reload this page to continue.</p><p><a href="${signIn}">Sign in</a></p>`);
    }

    if (details.prompt.name === 'login') {
      // Login is the existing Aura session; nothing new is collected here.
      if (req.method !== 'GET' || action) return sendPage(res, 405, 'Invalid request', '<h1>Invalid request</h1>');
      return finish(req, res, { login: { accountId: user.userId } });
    }

    if (details.prompt.name !== 'consent') return finish(req, res, { error: 'access_denied' });

    const client = clientsById.get(String(details.params.client_id));
    if (!client) return finish(req, res, { error: 'unauthorized_client' });

    // A provider session for a different Aura user must not be reused.
    const accountChanged = !!details.session?.accountId && details.session.accountId !== user.userId;

    if (req.method === 'GET' && !action) {
      if (accountChanged) return finish(req, res, { error: 'login_required', error_description: 'The signed-in account changed.' });
      const csrf = csrfFor(uid, user.userId);
      const base = `${INTERACTION_PREFIX}${encodeURIComponent(uid)}`;
      return sendPage(
        res,
        200,
        'Connect to Aura',
        `<h1>Connect ${escapeHtml(client.label)} to Aura?</h1>
<p>It will be able to <strong>find suitable times for activities</strong> using Aura's timing search (read-only). It cannot change anything in your Aura account.</p>
<form method="post" action="${base}/confirm"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Allow</button></form>
<form method="post" action="${base}/abort"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Deny</button></form>`,
      );
    }

    if (req.method !== 'POST' || (action !== 'confirm' && action !== 'abort')) return sendPage(res, 405, 'Invalid request', '<h1>Invalid request</h1>');
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== issuer) return sendPage(res, 403, 'Forbidden', '<h1>Forbidden</h1>');
    const form = await readForm(req);
    const presented = form?.get('csrf') ?? '';
    const expected = csrfFor(uid, user.userId);
    const ok = presented.length === expected.length && timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
    if (!ok) return sendPage(res, 403, 'Forbidden', '<h1>Forbidden</h1>');
    if (accountChanged) return finish(req, res, { error: 'login_required', error_description: 'The signed-in account changed.' });

    if (action === 'abort') {
      audit({ event: 'oauth.grant', outcome: 'denied', clientId: client.client_id, userId: user.userId });
      return finish(req, res, { error: 'access_denied', error_description: 'The user denied access.' });
    }
    const grantId = await grantFor(details, user.userId);
    audit({ event: 'oauth.grant', outcome: 'ok', clientId: client.client_id, userId: user.userId });
    return finish(req, res, { consent: { grantId } });
  }

  async function handle(req: IncomingMessage, res: ServerResponse, path: string, search = ''): Promise<void> {
    try {
      if (path.startsWith(INTERACTION_PREFIX)) return await handleInteraction(req, res, path);
      // RFC 8414 discovery is served from the same document as OIDC discovery.
      const providerPath = path === '/.well-known/oauth-authorization-server' ? '/.well-known/openid-configuration' : path;
      req.url = `${providerPath}${search}`;
      await new Promise<void>((resolve) => {
        res.once('finish', resolve);
        res.once('close', resolve);
        providerCallback(req, res);
      });
    } catch (err) {
      audit({ event: 'oauth.error', outcome: 'server_error', errorCode: err instanceof Error ? err.name : 'Error' });
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ error: 'server_error' }));
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
    // The memory store has no index by account; walk Grant entries via find.
    // (The Postgres adapter will do this with one indexed DELETE.)
    let revoked = 0;
    const adapter = new adapterStore.factory('Grant');
    for (const grantId of grantIds) {
      const g = await adapter.find(grantId);
      if (g && g.accountId === userId && g.clientId === clientId) {
        await adapter.revokeByGrantId(grantId);
        grantIds.delete(grantId);
        revoked += 1;
      }
    }
    if (revoked) audit({ event: 'oauth.grant_revoked', outcome: 'ok', clientId, userId });
    return revoked;
  }
  const grantIds = new Set<string>();
  provider.on('grant.saved', (grant: { jti: string }) => grantIds.add(grant.jti));

  return {
    provider,
    issuer,
    resourceUrl,
    handle,
    verifyAccessToken,
    isClientAllowed: (clientId) => resourceClients.has(clientId),
    revokeUserClientGrants,
    adapterStore,
  };
}
