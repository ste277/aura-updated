import { McpServer, WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import { FIND_BEST_TIME_TOOL, toFindBestTimeToolResult } from '../findBestTimeTool';
import { executeFindBestTimeRemote } from '../findBestTimeRemote';
import type { McpRateLimiter } from '../security/rateLimit';
import type { McpAuditEvent, McpAuditSink } from '../security/audit';

/**
 * AURA-MCP-02-I1 -- Remote Transport Foundation.
 *
 * A framework-free Streamable HTTP handler (Web Request -> Response) for the
 * remote MCP endpoint. apps/web/app/api/mcp/route.ts is a thin adapter over
 * it; tests call it directly.
 *
 * Order of checks (cheap and fail-closed first; no engine work before auth):
 *   1. disabled (flag off / incomplete config)  -> 404, for every method
 *   2. method other than POST                   -> 405
 *   3. Origin present and not allowlisted       -> 403  (absent Origin is
 *      allowed: vendor clouds call server-to-server)
 *   4. declared body larger than the cap        -> 413
 *   5. bearer token rejected by verifyAccessToken -> 401 + WWW-Authenticate
 *      pointing at the RFC 9728 protected resource metadata; token without
 *      the scope -> 403 insufficient_scope; token issued to a client the
 *      resource does not accept (isClientAllowed) -> 403 unauthorized_client
 *   5b. per-user / per-client rate limit (rateLimiter)         -> 429
 *   6. body read with a streaming 16 KB cap -> 413; invalid JSON -> 400;
 *      JSON-RPC batch (array) -> 400 (batching was removed from the
 *      protocol in 2025-06-18, and a batch would multiply the per-request
 *      Timing Search cost the 14-day window cap bounds -- D1 threat T9)
 *   7. stateless MCP request (fresh server per request, JSON responses)
 *
 * Every exit from step 2 onwards is reported to the optional audit sink
 * (security/audit.ts), which can carry only allowlisted fields.
 *
 * The verifier is injected. apps/web/app/api/mcp/route.ts passes
 * `rejectAllAccessTokens` everywhere except the explicitly gated local
 * development path (apps/web/lib/mcpAuthGate.ts, AURA-MCP-02-I2a), so
 * nothing is callable in any deployment.
 */

export const REMOTE_SERVER_NAME = 'aura-mcp-remote';
export const REMOTE_SERVER_VERSION = '0.1.0';
export const MCP_SCOPE = 'aura.planning.read';
export const MAX_REQUEST_BODY_BYTES = 16 * 1024;

export interface VerifiedAccess {
  /** Verified, server-side Aura user id. Unused by tools until I3 (personalization). */
  userId: string;
  /** OAuth client the token was issued to (client identity binding). */
  clientId?: string;
  scopes: readonly string[];
}

/** Resolves a bearer token to verified access, or null to reject it. */
export type AccessTokenVerifier = (token: string, resource: string) => Promise<VerifiedAccess | null>;

/** The only verifier I1 deploys: every token is rejected. */
export const rejectAllAccessTokens: AccessTokenVerifier = async () => null;

export interface RemoteMcpConfig {
  /** Canonical resource URL (RFC 8707 audience), e.g. https://example.com/api/mcp. */
  resourceUrl: string;
  /** Authorization server issuer URL advertised in protected resource metadata. */
  authorizationServer: string;
}

export interface RemoteMcpDeps {
  /** null = remote MCP disabled (flag off or configuration incomplete). */
  config: RemoteMcpConfig | null;
  verifyAccessToken: AccessTokenVerifier;
  now?: () => Date;
  /**
   * Client identity binding: when set, a token whose client is not accepted
   * here is refused with 403 even if it is otherwise valid. A token without
   * a clientId is refused too.
   */
  isClientAllowed?: (clientId: string) => boolean;
  /** Per-user and per-client rate limit, checked after authentication. */
  rateLimiter?: McpRateLimiter;
  /** Redacted audit sink. */
  audit?: McpAuditSink;
  /** Monotonic-ish clock for audit latency (tests pin it). */
  clockMs?: () => number;
}

const JSON_HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' } as const;

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

/** RFC 9728 well-known URL for a resource, with path insertion (e.g. /.well-known/oauth-protected-resource/api/mcp). */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  const url = new URL(resourceUrl);
  const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
  return `${url.origin}/.well-known/oauth-protected-resource${path}`;
}

/**
 * Parses and validates remote MCP configuration. Fails closed: anything
 * missing or malformed yields null, which disables every endpoint (404).
 * Both URLs must be absolute https URLs without query, fragment or
 * credentials (http is permitted only for localhost, for local testing).
 */
export function parseRemoteMcpConfig(input: { enabled?: string; resourceUrl?: string; authorizationServer?: string }): RemoteMcpConfig | null {
  if (input.enabled !== '1') return null;
  const resourceUrl = canonicalUrl(input.resourceUrl);
  const authorizationServer = canonicalUrl(input.authorizationServer);
  if (!resourceUrl || !authorizationServer) return null;
  return { resourceUrl, authorizationServer };
}

function canonicalUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const localhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhost)) return null;
  if (url.search || url.hash || url.username || url.password) return null;
  return url.href.replace(/\/$/, '');
}

/**
 * RFC 6750 section 3.1: with no credentials, the challenge carries no error
 * code; with a presented-but-rejected token, `error="invalid_token"`.
 */
function unauthorized(config: RemoteMcpConfig, tokenPresented: boolean): Response {
  const metadata = protectedResourceMetadataUrl(config.resourceUrl);
  const error = tokenPresented ? 'error="invalid_token", ' : '';
  return jsonResponse(
    401,
    tokenPresented ? { error: 'invalid_token', error_description: 'The access token is invalid or expired.' } : { error: 'unauthorized', error_description: 'An access token is required.' },
    { 'www-authenticate': `Bearer ${error}resource_metadata="${metadata}", scope="${MCP_SCOPE}"` },
  );
}

/** Reads at most `limit` bytes of the body; returns null if it is larger. */
async function readBodyCapped(req: Request, limit: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/.exec(header.trim());
  return match ? match[1] : null;
}

/** RFC 9728 protected resource metadata, or 404 when remote MCP is disabled. */
export function handleProtectedResourceMetadata(deps: Pick<RemoteMcpDeps, 'config'>): Response {
  if (!deps.config) return notFound();
  return jsonResponse(200, {
    resource: deps.config.resourceUrl,
    authorization_servers: [deps.config.authorizationServer],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Aura',
  });
}

/** Non-GET methods on the metadata URLs: 404 while disabled, 405 when enabled. */
export function handleProtectedResourceMetadataOtherMethod(deps: Pick<RemoteMcpDeps, 'config'>): Response {
  if (!deps.config) return notFound();
  return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET', 'cache-control': 'no-store' } });
}

export function createRemoteMcpServer(now?: () => Date, onToolOutcome?: (tool: string, outcome: string) => void): McpServer {
  const server = new McpServer({ name: REMOTE_SERVER_NAME, version: REMOTE_SERVER_VERSION }, { capabilities: { tools: {} } });
  server.registerTool(
    FIND_BEST_TIME_TOOL.name,
    {
      title: FIND_BEST_TIME_TOOL.title,
      description: FIND_BEST_TIME_TOOL.description,
      inputSchema: FIND_BEST_TIME_TOOL.inputSchema,
      annotations: { ...FIND_BEST_TIME_TOOL.annotations },
    },
    async (args: unknown) => {
      const outcome = executeFindBestTimeRemote(args, now);
      onToolOutcome?.(FIND_BEST_TIME_TOOL.name, outcome.ok ? 'ok' : outcome.kind);
      return toFindBestTimeToolResult(outcome);
    },
  );
  return server;
}

function rpcFields(body: unknown): Pick<McpAuditEvent, 'rpcMethod' | 'tool'> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
  const { method, params } = body as { method?: unknown; params?: { name?: unknown } };
  const fields: Pick<McpAuditEvent, 'rpcMethod' | 'tool'> = {};
  if (typeof method === 'string') fields.rpcMethod = method;
  if (method === 'tools/call' && params && typeof params.name === 'string') fields.tool = params.name;
  return fields;
}

export async function handleRemoteMcpRequest(req: Request, deps: RemoteMcpDeps): Promise<Response> {
  const { config } = deps;
  if (!config) return notFound();

  const clock = deps.clockMs ?? Date.now;
  const started = clock();
  const audit: Partial<McpAuditEvent> = {};
  const done = (res: Response, outcome: string): Response => {
    deps.audit?.({ ...audit, event: 'mcp.request', outcome, status: res.status, latencyMs: clock() - started });
    return res;
  };

  if (req.method !== 'POST') {
    return done(new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } }), 'method_not_allowed');
  }

  const origin = req.headers.get('origin');
  if (origin !== null && origin !== new URL(config.resourceUrl).origin) {
    return done(jsonResponse(403, { error: 'forbidden_origin' }), 'forbidden_origin');
  }

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
    return done(jsonResponse(413, { error: 'request_too_large' }), 'request_too_large');
  }

  const token = bearerToken(req);
  let access: VerifiedAccess | null = null;
  try {
    access = token ? await deps.verifyAccessToken(token, config.resourceUrl) : null;
  } catch (err) {
    // A verifier failure is a rejection, never a pass.
    console.error(`[aura-mcp-remote] token verification failed (${err instanceof Error ? err.name : 'Error'})`);
    access = null;
  }
  if (!access) {
    const presented = /^\s*Bearer\s/i.test(req.headers.get('authorization') ?? '');
    return done(unauthorized(config, presented), presented ? 'invalid_token' : 'unauthenticated');
  }
  audit.userId = access.userId;
  audit.clientId = access.clientId;
  if (!access.scopes.includes(MCP_SCOPE)) {
    return done(
      jsonResponse(
        403,
        { error: 'insufficient_scope' },
        { 'www-authenticate': `Bearer error="insufficient_scope", scope="${MCP_SCOPE}", resource_metadata="${protectedResourceMetadataUrl(config.resourceUrl)}"` },
      ),
      'insufficient_scope',
    );
  }
  if (deps.isClientAllowed && !(access.clientId && deps.isClientAllowed(access.clientId))) {
    return done(jsonResponse(403, { error: 'unauthorized_client' }), 'unauthorized_client');
  }
  if (deps.rateLimiter) {
    const keys = [`user:${access.userId}`];
    if (access.clientId) keys.push(`client:${access.clientId}`);
    const decision = await deps.rateLimiter.check(keys);
    if (!decision.allowed) {
      audit.limitedBy = decision.limitedBy;
      return done(jsonResponse(429, { error: 'rate_limited' }, { 'retry-after': String(decision.retryAfterSeconds) }), 'rate_limited');
    }
  }

  const text = await readBodyCapped(req, MAX_REQUEST_BODY_BYTES);
  if (text === null) return done(jsonResponse(413, { error: 'request_too_large' }), 'request_too_large');
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return done(jsonResponse(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }), 'parse_error');
  }
  if (Array.isArray(parsedBody)) {
    return done(jsonResponse(400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request: batch requests are not supported' } }), 'batch_rejected');
  }
  Object.assign(audit, rpcFields(parsedBody));

  try {
    let toolOutcome: string | undefined;
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const server = createRemoteMcpServer(deps.now, (_tool, outcome) => {
      toolOutcome = outcome;
    });
    await server.connect(transport);
    const res = await transport.handleRequest(req, { parsedBody });
    const outcome = res.status >= 400 ? 'protocol_error' : toolOutcome === undefined || toolOutcome === 'ok' ? 'ok' : `tool_${toolOutcome}`;
    return done(res, outcome);
  } catch (err) {
    // Never surface internals (stack traces, paths) to the client; log only
    // the error class name -- never arguments, tokens or bodies.
    console.error(`[aura-mcp-remote] request failed (${err instanceof Error ? err.name : 'Error'})`);
    return done(jsonResponse(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } }), 'internal_error');
  }
}
