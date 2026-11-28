import type { IncomingMessage } from 'http';
import { Pool } from 'pg';
import { createAuraOAuthServer, type AuraOAuthServer } from '../../../packages/mcp-tools/src/auth/authorizationServer';
import { ephemeralOAuthKeys, loadOAuthKeysFromEnv, type OAuthKeyMaterial } from '../../../packages/mcp-tools/src/auth/keys';
import type { OAuthStore } from '../../../packages/mcp-tools/src/auth/oauthStore';
import { createPostgresAdapterStore } from '../../../packages/mcp-tools/src/auth/postgresAdapter';
import { createRedactingAuditSink, type McpAuditSink } from '../../../packages/mcp-tools/src/security/audit';
import {
  fetchAddressRequest,
  parseClientAddressSource,
  resolveClientAddressDetailed,
  type AddressUnresolvedReason,
  type ClientAddressSource,
} from '../../../packages/mcp-tools/src/security/clientAddress';
import { MCP_PG_POOL_BOUNDS, StoreUnavailableError } from '../../../packages/mcp-tools/src/security/deadline';
import { SessionVerificationUnavailableError } from './sessionErrors';
import { randomBytes } from 'crypto';
import { createPostgresRateLimiter } from '../../../packages/mcp-tools/src/security/postgresRateLimit';
import { createBucketHasher, deriveBucketKey, type BucketHasher } from '../../../packages/mcp-tools/src/security/preAuthRules';
import { createFixedWindowRateLimiter, type McpRateLimiter } from '../../../packages/mcp-tools/src/security/rateLimit';
import type { RemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { getSessionFromCookieHeader, withSessionShareLock } from './session';
import { resolveRuntimeMcpAuthMode } from './mcpAuthGate';

/**
 * AURA-MCP-02-I2a / I2b -- the LOCAL development authorization server instance.
 *
 * Only ever loaded through a dynamic import after resolveRuntimeMcpAuthMode()
 * returned "local" (apps/web/app/api/mcp/route.ts,
 * apps/web/pages/api/oauth/[...oidc].ts and the I2b connection routes), and
 * it re-checks the gate itself before constructing anything.
 *
 * Login reuses Aura's session (AURA-AUTH-SESSION-01-I2, D6): the v2 session
 * cookie, verified against the database by lib/session.ts -- the same central
 * validation as every route. Consent approval re-checks the session FOR SHARE
 * while the grant is issued (B3). Nothing else in MCP OAuth changes.
 *
 * Storage (I2b):
 *   - default: in memory (lost on restart);
 *   - AURA_MCP_OAUTH_STORE=postgres: the durable Postgres adapter and the
 *     shared rate limiter (migration 0052), so the I2b production components
 *     can be exercised locally. It REQUIRES AURA_MCP_OAUTH_DATABASE_URL on a
 *     loopback host -- never DATABASE_URL, which may point at a shared or
 *     Production database.
 *   I2b-S2 (I2b-R-2): TWO bounded pools on that database -- one for the
 *     OAuth store, one for the two limiters -- so limiter saturation cannot
 *     block token/session reads and vice versa. Each has a checkout timeout
 *     and a client-side query timeout (MCP_PG_POOL_BOUNDS); the limiter
 *     adds transaction-local lock/statement timeouts and a decision
 *     deadline, the store a per-query deadline. Timeouts fail closed (503).
 * Client address for /api/mcp pre-auth (I2b-S2, I2b-R-3):
 *   AURA_MCP_CLIENT_ADDRESS_SOURCE (default "none"). Only "none" or
 *   "header:x-real-ip" / "header:x-vercel-forwarded-for" make sense for an
 *   App Router request; without a usable address /api/mcp uses the shared
 *   bounded "unresolved" bucket.
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

export interface LocalState {
  key: string;
  server: AuraOAuthServer;
  rateLimiter: McpRateLimiter;
  preAuthLimiter: McpRateLimiter;
  audit: McpAuditSink;
  storeKind: 'memory' | 'postgres';
  addressSource: ClientAddressSource;
  /** I2b-S8 (S3-6): keyed hash for limiter address buckets, shared by the AS and /api/mcp. */
  hashBucket: BucketHasher;
}

/**
 * I2b-S8 (S3-4): ONE parsed client-address source for both pre-auth paths.
 * When AURA_MCP_CLIENT_ADDRESS_SOURCE is set, the authorization server and
 * /api/mcp both use it (previously the AS always used the TCP peer, so
 * behind an edge every client shared one bucket). When it is unset, local
 * development keeps its defaults: the AS (a Node request from a directly
 * connected client) uses the TCP peer, /api/mcp (an App Router request with
 * no socket) uses "none" -- the shared bounded bucket.
 */
export function preAuthAddressSources(env: Record<string, string | undefined>): { authorizationServer: ClientAddressSource; mcp: ClientAddressSource } {
  const configured = (env.AURA_MCP_CLIENT_ADDRESS_SOURCE ?? '').trim();
  if (configured === '') return { authorizationServer: { kind: 'socket' }, mcp: { kind: 'none' } };
  const source = parseClientAddressSource(configured);
  return { authorizationServer: source, mcp: source };
}

/** I2b-S2: a pool with the shared bounds (security/deadline.ts MCP_PG_POOL_BOUNDS). */
function boundedPool(connectionString: string, role: 'store' | 'limiter'): Pool {
  const pool = new Pool({ connectionString, ...MCP_PG_POOL_BOUNDS, application_name: `aura-mcp-oauth-${role}` });
  // An idle client that errors (server restart, destroyed connection) must
  // not crash the process; log the class only.
  pool.on('error', (err) => console.error(`[aura-mcp-oauth] ${role} pool client error (${err instanceof Error ? err.name : 'Error'})`));
  return pool;
}

// Survives Next dev hot reloads within one process.
const globalRef = globalThis as typeof globalThis & { __auraMcpLocalOAuth?: LocalState };


/**
 * Aura user id from a Cookie header (database-backed, lib/session.ts), or
 * null when not authenticated. Throws SessionVerificationUnavailableError
 * when the session cannot be verified (callers answer 503 / fail closed).
 */
export async function sessionUserFromCookie(cookieHeader: string | null | undefined): Promise<string | null> {
  const session = await getSessionFromCookieHeader(cookieHeader);
  return session?.userId ?? null;
}

/**
 * B3 (design §3) for consent approval: the grant is issued only while the
 * approving user's session row is held FOR SHARE after a live re-check, so a
 * concurrent logout is strictly ordered before (no grant: null) or after it.
 */
async function guardConsentGrant(req: IncomingMessage, userId: string, issue: () => Promise<string>): Promise<string | null> {
  try {
    const session = await getSessionFromCookieHeader(req.headers.cookie);
    if (!session || session.userId !== userId) return null;
    const locked = await withSessionShareLock(session, issue);
    return locked.ok ? locked.value : null;
  } catch (err) {
    // I2-R1 (39246-03): a session-store outage is 503 at the consent handler, never "sign in".
    if (err instanceof SessionVerificationUnavailableError) throw new StoreUnavailableError('error');
    throw err;
  }
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
  const sources = preAuthAddressSources(env);
  // Configured keys: every instance derives the same bucket key. Ephemeral
  // (local, one process): a per-process key is enough.
  const hashBucket = createBucketHasher(keys.source === 'configured' ? deriveBucketKey(keys.auditKey) : randomBytes(32));
  const audit = createRedactingAuditSink({ knownTools: ['find_best_time'], userRefKey: keys.source === 'configured' ? keys.auditKey : undefined });

  let adapterStore: OAuthStore | undefined;
  let rateLimiter: McpRateLimiter;
  let preAuthLimiter: McpRateLimiter;
  if (storeKind === 'postgres') {
    const connectionString = localOAuthDatabaseUrl(env);
    const storePool = boundedPool(connectionString, 'store');
    const limiterPool = boundedPool(connectionString, 'limiter');
    // I2b-R1: recoverable identifiers are sealed with keys derived from the cookie keys.
    adapterStore = createPostgresAdapterStore({ db: storePool, fieldKeys: keys.cookieKeys });
    rateLimiter = createPostgresRateLimiter({ pool: limiterPool, windowMs: 60_000 });
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
    resolveSessionUser: async (req: IncomingMessage) => {
      const userId = await sessionUserFromCookie(req.headers.cookie);
      return userId ? { userId } : null;
    },
    guardConsentGrant,
    signInUrl: (returnTo) => `/connect/sign-in?returnTo=${encodeURIComponent(returnTo)}`,
    connectionsUrl: '/connect/apps',
    audit,
    adapterStore,
    keys,
    refreshTokens: { enabled: true },
    preAuth: { limiter: preAuthLimiter, addressSource: sources.authorizationServer, hashBucket },
  });
  const state: LocalState = { key, server, rateLimiter, preAuthLimiter, audit, storeKind, addressSource: sources.mcp, hashBucket };
  globalRef.__auraMcpLocalOAuth = state;
  return state;
}

export const localMcpAudit = createRedactingAuditSink({ knownTools: ['find_best_time'] });

/** I2b-S2: the trusted client address of an /api/mcp request (or why there is none). */
export function localMcpClientAddress(state: LocalState, req: Request): { clientAddress: string | null; clientAddressProblem?: AddressUnresolvedReason } {
  const r = resolveClientAddressDetailed(fetchAddressRequest(req), state.addressSource);
  return r.kind === 'resolved' ? { clientAddress: r.address } : { clientAddress: null, clientAddressProblem: r.reason };
}

/** I2b-S8 (S3-6): the /api/mcp pre-auth dependencies that must match the AS. */
export function localMcpPreAuthDeps(state: LocalState): { preAuthBucketHasher: BucketHasher } {
  return { preAuthBucketHasher: state.hashBucket };
}
