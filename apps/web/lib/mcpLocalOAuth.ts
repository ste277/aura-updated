import type { IncomingMessage } from 'http';
import { Pool } from 'pg';
import { createAuraOAuthServer, type AuraOAuthServer } from '../../../packages/mcp-tools/src/auth/authorizationServer';
import { ephemeralOAuthKeys, loadOAuthKeysFromEnv, type OAuthKeyMaterial } from '../../../packages/mcp-tools/src/auth/keys';
import type { OAuthStore } from '../../../packages/mcp-tools/src/auth/oauthStore';
import { createPostgresAdapterStore } from '../../../packages/mcp-tools/src/auth/postgresAdapter';
import { createRedactingAuditSink, type McpAuditSink } from '../../../packages/mcp-tools/src/security/audit';
import { createPostgresRateLimiter } from '../../../packages/mcp-tools/src/security/postgresRateLimit';
import { createFixedWindowRateLimiter, type McpRateLimiter } from '../../../packages/mcp-tools/src/security/rateLimit';
import type { RemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { SESSION_COOKIE_NAME, verifySessionToken } from './auth';
import { resolveRuntimeMcpAuthMode } from './mcpAuthGate';

/**
 * AURA-MCP-02-I2a / I2b -- the LOCAL development authorization server instance.
 *
 * Only ever loaded through a dynamic import after resolveRuntimeMcpAuthMode()
 * returned "local" (apps/web/app/api/mcp/route.ts,
 * apps/web/pages/api/oauth/[...oidc].ts and the I2b connection routes), and
 * it re-checks the gate itself before constructing anything.
 *
 * Login reuses Aura's existing session cookie (`as_session`, verified by the
 * unchanged lib/auth.ts verifier). Nothing here changes Aura's authentication.
 *
 * Storage (I2b):
 *   - default: in memory (lost on restart);
 *   - AURA_MCP_OAUTH_STORE=postgres: the durable Postgres adapter and the
 *     shared rate limiter (migration 0052), so the I2b production components
 *     can be exercised locally. It REQUIRES AURA_MCP_OAUTH_DATABASE_URL on a
 *     loopback host -- never DATABASE_URL, which may point at a shared or
 *     Production database.
 * Keys: AURA_MCP_OAUTH_JWKS (+ cookie keys, pairwise salt, audit key; see
 * packages/mcp-tools/src/auth/keys.ts) when set, otherwise ephemeral.
 *
 * There is exactly one synthetic client, with loopback redirect URIs only.
 */

export const LOCAL_DEV_CLIENT_ID = 'aura-local-dev-client';

const LOCAL_CLIENTS = [
  {
    client_id: LOCAL_DEV_CLIENT_ID,
    redirect_uris: ['http://127.0.0.1:8976/callback', 'http://localhost:8976/callback'],
    label: 'Aura local development client',
    allow_refresh: true,
  },
];

const LOOPBACK_DB_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface LocalState {
  key: string;
  server: AuraOAuthServer;
  rateLimiter: McpRateLimiter;
  preAuthLimiter: McpRateLimiter;
  audit: McpAuditSink;
  storeKind: 'memory' | 'postgres';
}

// Survives Next dev hot reloads within one process.
const globalRef = globalThis as typeof globalThis & { __auraMcpLocalOAuth?: LocalState };

export function readSessionCookieValue(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === SESSION_COOKIE_NAME) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/** Aura user id from a Cookie header, or null. */
export function sessionUserFromCookie(cookieHeader: string | null | undefined): string | null {
  const token = readSessionCookieValue(cookieHeader);
  const session = token ? verifySessionToken(token) : null;
  return session?.userId ?? null;
}

/** Only an explicit loopback database may hold local OAuth state. */
export function localOAuthDatabaseUrl(env: Record<string, string | undefined>): string {
  const raw = env.AURA_MCP_OAUTH_DATABASE_URL;
  if (!raw) throw new Error('AURA_MCP_OAUTH_STORE=postgres requires AURA_MCP_OAUTH_DATABASE_URL');
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error('AURA_MCP_OAUTH_DATABASE_URL is not a URL');
  }
  if (!LOOPBACK_DB_HOSTS.has(host)) throw new Error('AURA_MCP_OAUTH_DATABASE_URL must point at a loopback host for local OAuth');
  return raw;
}

function keyMaterial(env: Record<string, string | undefined>): OAuthKeyMaterial {
  return env.AURA_MCP_OAUTH_JWKS ? loadOAuthKeysFromEnv(env) : ephemeralOAuthKeys();
}

export function getLocalMcpAuth(config: RemoteMcpConfig): LocalState {
  const gate = resolveRuntimeMcpAuthMode(config);
  if (gate.mode !== 'local') throw new Error(`local MCP auth refused (${gate.reason})`);
  const env = process.env;
  const storeKind: LocalState['storeKind'] = env.AURA_MCP_OAUTH_STORE === 'postgres' ? 'postgres' : 'memory';
  const key = `${config.authorizationServer} ${config.resourceUrl} ${storeKind}`;
  if (globalRef.__auraMcpLocalOAuth?.key === key) return globalRef.__auraMcpLocalOAuth;

  const keys = keyMaterial(env);
  const audit = createRedactingAuditSink({ knownTools: ['find_best_time'], userRefKey: keys.source === 'configured' ? keys.auditKey : undefined });

  let adapterStore: OAuthStore | undefined;
  let rateLimiter: McpRateLimiter;
  let preAuthLimiter: McpRateLimiter;
  if (storeKind === 'postgres') {
    const pool = new Pool({ connectionString: localOAuthDatabaseUrl(env), max: 5 });
    adapterStore = createPostgresAdapterStore({ db: pool });
    rateLimiter = createPostgresRateLimiter({ pool, windowMs: 60_000 });
    preAuthLimiter = rateLimiter;
  } else {
    // Local: 1-minute windows, bounded at 10,000 windows each.
    rateLimiter = createFixedWindowRateLimiter({ windowMs: 60_000, maxKeys: 10_000 });
    preAuthLimiter = createFixedWindowRateLimiter({ windowMs: 60_000, maxKeys: 10_000 });
  }

  const server = createAuraOAuthServer({
    issuer: config.authorizationServer,
    resourceUrl: config.resourceUrl,
    clients: LOCAL_CLIENTS,
    resolveSessionUser: (req: IncomingMessage) => {
      const userId = sessionUserFromCookie(req.headers.cookie);
      return userId ? { userId } : null;
    },
    signInUrl: (returnTo) => `/connect/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    connectionsUrl: '/connect/apps',
    audit,
    adapterStore,
    keys,
    refreshTokens: { enabled: true },
    // Local dev: clients connect directly, so the TCP peer is the address.
    preAuth: { limiter: preAuthLimiter, addressSource: { kind: 'socket' } },
  });
  const state: LocalState = { key, server, rateLimiter, preAuthLimiter, audit, storeKind };
  globalRef.__auraMcpLocalOAuth = state;
  return state;
}

export const localMcpAudit = createRedactingAuditSink({ knownTools: ['find_best_time'] });
