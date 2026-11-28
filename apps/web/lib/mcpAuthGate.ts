import type { RemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpHandler';

/**
 * AURA-MCP-02-I2a -- explicit environment gate for MCP token validation.
 *
 * Decides whether a real access-token verifier may be used. Everything that
 * is not a deliberately configured LOCAL development server resolves to
 * `reject_all`, so /api/mcp keeps answering 401 to every token and the OAuth
 * routes answer 404. This does not rely on the feature flag alone; each of
 * these independently forces reject_all:
 *
 *   1. the Aura Production Vercel project id (pinned below);
 *   2. the aura-staging Vercel project id (staging stays disabled until a
 *      separately approved ticket changes this code);
 *   3. ANY Vercel deployment signal (VERCEL, VERCEL_ENV, VERCEL_URL,
 *      VERCEL_PROJECT_ID) -- Production, Preview and unknown projects alike;
 *   4. NODE_ENV other than "development"/"test" at runtime, AND (in
 *      resolveRuntimeMcpAuthMode) a literal `process.env.NODE_ENV` check
 *      that Next inlines at build time: in a `next build` bundle it is the
 *      constant "production", so the local path is unreachable code in any
 *      production build, whatever its runtime env vars;
 *   5. the explicit opt-in AURA_MCP_AUTH_MODE=local-dev missing;
 *   5b. (I2a-R1 F14) AUTH_SECRET missing, shorter than 32 characters, or
 *      equal to the development fallback published in lib/auth.ts -- the
 *      OAuth consent flow trusts the Aura session cookie, so a publicly
 *      known signing key must never authenticate OAuth users;
 *   6. remote MCP config disabled (AURA_MCP_REMOTE_ENABLED != "1");
 *   7. resource or issuer not a loopback http(s) URL, issuer not an origin,
 *      or issuer and resource on different origins.
 *
 * resolveMcpAuthMode is a pure function of (env, config), unit-tested in
 * test/mcpOAuthLocal.test.ts. Routes call resolveRuntimeMcpAuthMode.
 */

/** Aura Production (team aura-56a1). Same pin as scripts/check-db-identity.js. */
export const PRODUCTION_PROJECT_ID = 'prj_iY4xteQOWUNsV85NnbyIylBAba6t';
/** aura-staging. Remote MCP auth stays disabled there until separately authorized. */
export const STAGING_PROJECT_IDS: readonly string[] = Object.freeze(['prj_0wR8cnuX0dphdd3ExRGOT0AqcuEa']);
export const LOCAL_DEV_OPT_IN = 'local-dev';
/** lib/auth.ts development fallback (public in the repo); never acceptable for local OAuth. */
const PUBLIC_DEV_SESSION_SECRET = 'dev-only-insecure-secret-change-me';
const MIN_SESSION_SECRET_LENGTH = 32;

export type McpAuthMode = { mode: 'local' } | { mode: 'reject_all'; reason: string };

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

function loopbackUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return LOOPBACK_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

export function resolveMcpAuthMode(env: Env, config: RemoteMcpConfig | null): McpAuthMode {
  const reject = (reason: string): McpAuthMode => ({ mode: 'reject_all', reason });
  const projectId = env.VERCEL_PROJECT_ID;
  if (projectId === PRODUCTION_PROJECT_ID) return reject('production_project');
  if (projectId && STAGING_PROJECT_IDS.includes(projectId)) return reject('staging_not_authorized');
  if (env.VERCEL_ENV === 'production') return reject('production_env');
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL || projectId) return reject('vercel_deployment');
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') return reject('not_development_build');
  if (env.AURA_MCP_AUTH_MODE !== LOCAL_DEV_OPT_IN) return reject('local_opt_in_missing');
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH || secret === PUBLIC_DEV_SESSION_SECRET) return reject('unsafe_session_secret');
  if (!config) return reject('remote_mcp_disabled');
  const resource = loopbackUrl(config.resourceUrl);
  const issuer = loopbackUrl(config.authorizationServer);
  if (!resource || !issuer) return reject('non_loopback_url');
  if (issuer.pathname !== '/' || issuer.origin !== resource.origin) return reject('issuer_resource_mismatch');
  return { mode: 'local' };
}

/**
 * What routes call. The literal `process.env.NODE_ENV` below (not read
 * through the env object) is replaced by Next at build time, so in a
 * production build this returns reject_all before looking at anything else.
 */
export function resolveRuntimeMcpAuthMode(config: RemoteMcpConfig | null): McpAuthMode {
  if (process.env.NODE_ENV === 'production') return { mode: 'reject_all', reason: 'production_build' };
  return resolveMcpAuthMode(process.env, config);
}
