import { handleRemoteMcpRequest, rejectAllAccessTokens } from '../../../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';
import { resolveRuntimeMcpAuthMode } from '../../../lib/mcpAuthGate';

/**
 * AURA-MCP-02-I1/I2a -- remote MCP endpoint (Streamable HTTP, stateless).
 *
 * A thin adapter: every decision lives in handleRemoteMcpRequest
 * (packages/mcp-tools/src/http/remoteMcpHandler.ts). Off by default (404).
 *
 * Token validation: `rejectAllAccessTokens` (every request 401) in every
 * environment, EXCEPT when resolveRuntimeMcpAuthMode (lib/mcpAuthGate.ts) returns
 * "local" -- a NODE_ENV=development server, not on Vercel, with the explicit
 * AURA_MCP_AUTH_MODE=local-dev opt-in and loopback URLs. Only then is the
 * local authorization server loaded (lazily) and its verifier, client
 * binding, rate limiter and audit sink wired in. Production and staging
 * stay reject-all by code, not only by flag.
 */
export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  const config = remoteMcpConfigFromEnv();
  // I2a-R1 F15: the literal NODE_ENV test is replaced by Next at build time,
  // so in a production build this whole block -- including the dynamic
  // import -- is dead code that webpack drops: the local authorization
  // server, oidc-provider and Koa are not emitted into the server bundle.
  // The runtime gate below still applies on its own.
  if (process.env.NODE_ENV !== 'production') {
    const gate = resolveRuntimeMcpAuthMode(config);
    if (config && gate.mode === 'local') {
      const { getLocalMcpAuth, localMcpClientAddress } = await import('../../../lib/mcpLocalOAuth');
      const local = getLocalMcpAuth(config);
      return handleRemoteMcpRequest(req, {
        config,
        verifyAccessToken: local.server.verifyAccessToken,
        isClientAllowed: local.server.isClientAllowed,
        rateLimiter: local.rateLimiter,
        // I2b F5: throttled before token verification. I2b-S2 (I2b-R-3): the
        // address comes from the configured trusted header
        // (AURA_MCP_CLIENT_ADDRESS_SOURCE); without one the request uses the
        // shared bounded "unresolved" bucket, never the global ceiling alone.
        preAuthRateLimiter: local.preAuthLimiter,
        ...localMcpClientAddress(local, req),
        audit: local.audit,
      });
    }
  }
  return handleRemoteMcpRequest(req, { config, verifyAccessToken: rejectAllAccessTokens });
}

// Every method goes through the handler so that, while disabled, the route
// is indistinguishable from a missing one (404 -- including OPTIONS/PUT/PATCH,
// which Next would otherwise answer itself with 204/405).
export const POST = handle;
export const GET = handle;
export const DELETE = handle;
export const PUT = handle;
export const PATCH = handle;
export const OPTIONS = handle;
export const HEAD = handle;
