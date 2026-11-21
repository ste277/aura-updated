import type { IncomingMessage } from 'http';
import { createAuraOAuthServer, type AuraOAuthServer } from '../../../packages/mcp-tools/src/auth/authorizationServer';
import { createRedactingAuditSink } from '../../../packages/mcp-tools/src/security/audit';
import { createFixedWindowRateLimiter, type McpRateLimiter } from '../../../packages/mcp-tools/src/security/rateLimit';
import type { RemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { SESSION_COOKIE_NAME, verifySessionToken } from './auth';
import { resolveRuntimeMcpAuthMode } from './mcpAuthGate';

/**
 * AURA-MCP-02-I2a -- the LOCAL development authorization server instance.
 *
 * Only ever loaded through a dynamic import after resolveRuntimeMcpAuthMode()
 * returned "local" (apps/web/app/api/mcp/route.ts and
 * apps/web/pages/api/oauth/[...oidc].ts), and it re-checks the gate itself
 * before constructing anything.
 *
 * Login reuses Aura's existing session cookie (`as_session`, verified by the
 * unchanged lib/auth.ts verifier): sign in to the local app as usual, and
 * the consent page appears for that user. Nothing here changes Aura's
 * authentication.
 *
 * State is in memory (codes, grants, tokens, keys) and is lost on restart.
 * There is exactly one synthetic client, with loopback redirect URIs only.
 */

export const LOCAL_DEV_CLIENT_ID = 'aura-local-dev-client';

const LOCAL_CLIENTS = [
  {
    client_id: LOCAL_DEV_CLIENT_ID,
    redirect_uris: ['http://127.0.0.1:8976/callback', 'http://localhost:8976/callback'],
    label: 'Aura local development client',
  },
];

interface LocalState {
  key: string;
  server: AuraOAuthServer;
  rateLimiter: McpRateLimiter;
}

// Survives Next dev hot reloads within one process.
const globalRef = globalThis as typeof globalThis & { __auraMcpLocalOAuth?: LocalState };

function readSessionCookie(req: IncomingMessage): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function getLocalMcpAuth(config: RemoteMcpConfig): LocalState {
  const gate = resolveRuntimeMcpAuthMode(config);
  if (gate.mode !== 'local') throw new Error(`local MCP auth refused (${gate.reason})`);
  const key = `${config.authorizationServer} ${config.resourceUrl}`;
  if (globalRef.__auraMcpLocalOAuth?.key === key) return globalRef.__auraMcpLocalOAuth;

  const audit = createRedactingAuditSink({ knownTools: ['find_best_time'] });
  const server = createAuraOAuthServer({
    issuer: config.authorizationServer,
    resourceUrl: config.resourceUrl,
    clients: LOCAL_CLIENTS,
    resolveSessionUser: (req) => {
      const token = readSessionCookie(req);
      const session = token ? verifySessionToken(token) : null;
      return session?.userId ? { userId: session.userId } : null;
    },
    signInUrl: '/',
    audit,
  });
  const state: LocalState = {
    key,
    server,
    // Local: 1-minute windows; limits are the handler defaults
    // (60 per user, 600 per client ceiling). Bounded at 10,000 windows.
    rateLimiter: createFixedWindowRateLimiter({ windowMs: 60_000, maxKeys: 10_000 }),
  };
  globalRef.__auraMcpLocalOAuth = state;
  return state;
}

export const localMcpAudit = createRedactingAuditSink({ knownTools: ['find_best_time'] });
