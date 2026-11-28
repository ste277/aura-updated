import { remoteMcpConfigFromEnv } from '../../../../lib/mcpRemoteConfig';
import { resolveRuntimeMcpAuthMode } from '../../../../lib/mcpAuthGate';

/**
 * AURA-MCP-02-I2b -- connected assistants for the signed-in Aura user.
 *
 *   GET  -> { connections: [{ clientId, label, connectedAt }] }
 *   POST { "clientId": "..." } -> disconnect: revokes every grant, code,
 *        access token and refresh token the user holds for that client.
 *
 * Authentication: the existing Aura session cookie only. POST also requires
 * a same-origin `Origin` header and a JSON body (no form posts, so a
 * cross-site page cannot trigger a disconnect).
 *
 * Disabled (404, indistinguishable from a missing route) everywhere the
 * OAuth authorization server is disabled: the same literal build-time guard
 * as /api/mcp (no OAuth code in production bundles, F15) plus the runtime
 * gate (lib/mcpAuthGate.ts).
 */
export const dynamic = 'force-dynamic';

const notFound = () => new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const MAX_BODY = 1024;

async function handle(req: Request): Promise<Response> {
  if (process.env.NODE_ENV !== 'production') {
    const config = remoteMcpConfigFromEnv();
    const gate = resolveRuntimeMcpAuthMode(config);
    if (config && gate.mode === 'local') {
      const { getLocalMcpAuth, sessionUserFromCookie } = await import('../../../../lib/mcpLocalOAuth');
      // AURA-AUTH-SESSION-01-I2 (D6): database-backed session; an outage is 503, never 401.
      let userId: string | null;
      try {
        userId = await sessionUserFromCookie(req.headers.get('cookie'));
      } catch {
        return json(503, { error: 'session_unavailable' });
      }
      if (!userId) return json(401, { error: 'sign_in_required' });
      const local = getLocalMcpAuth(config);
      if (req.method === 'GET') {
        const connections = await local.server.listUserConnections(userId);
        // One row per client (a client may hold more than one grant).
        const byClient = new Map<string, { clientId: string; label: string; connectedAt: number | null }>();
        for (const c of connections) {
          const prev = byClient.get(c.clientId);
          const at = c.createdAt ?? null;
          if (!prev) byClient.set(c.clientId, { clientId: c.clientId, label: c.label, connectedAt: at });
          else if (at !== null && (prev.connectedAt === null || at < prev.connectedAt)) prev.connectedAt = at;
        }
        return json(200, { connections: [...byClient.values()] });
      }
      if (req.method === 'POST') {
        if (req.headers.get('origin') !== new URL(config.authorizationServer).origin) return json(403, { error: 'forbidden_origin' });
        if ((req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') return json(415, { error: 'json_required' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'request_too_large' });
        let clientId: unknown;
        try {
          clientId = (JSON.parse(text) as { clientId?: unknown })?.clientId;
        } catch {
          return json(400, { error: 'invalid_json' });
        }
        if (typeof clientId !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(clientId)) return json(400, { error: 'invalid_client_id' });
        const revoked = await local.server.revokeUserClientGrants(userId, clientId);
        return json(200, { disconnected: revoked > 0 });
      }
      return new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET, POST', 'cache-control': 'no-store' } });
    }
  }
  return notFound();
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
export const OPTIONS = handle;
export const HEAD = handle;
