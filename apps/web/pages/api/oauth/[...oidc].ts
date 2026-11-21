import type { NextApiRequest, NextApiResponse } from 'next';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';
import { resolveRuntimeMcpAuthMode } from '../../../lib/mcpAuthGate';

/**
 * AURA-MCP-02-I2a -- Node req/res mount for the OAuth authorization server
 * (D2: `oidc-provider` is Koa/Node based, so it is mounted through a Pages
 * Router API route rather than an App Router handler).
 *
 * Public paths reach this route through next.config.js rewrites:
 *   /.well-known/oauth-authorization-server  (RFC 8414)
 *   /.well-known/openid-configuration
 *   /oauth/*                                 (authorize, token, revoke, jwks, interaction)
 *
 * Answers 404 for every request unless resolveRuntimeMcpAuthMode() returns "local"
 * (lib/mcpAuthGate.ts): never on Production, staging, Preview or any
 * production build. The authorization server module is only loaded after
 * that check.
 */
export const config = { api: { bodyParser: false, externalResolver: true } };

function notFound(res: NextApiResponse): void {
  res.statusCode = 404;
  res.setHeader('cache-control', 'no-store');
  res.end('Not Found');
}

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // I2a-R1 F15: the literal NODE_ENV test is replaced by Next at build time.
  // In a production build the whole block -- including the dynamic import --
  // is dead code that webpack skips at parse time, so neither the
  // authorization server nor oidc-provider is emitted into the bundle and
  // every request gets 404. (An early `return` is not enough: webpack only
  // prunes dead `if` branches.)
  if (process.env.NODE_ENV !== 'production') {
    const mcpConfig = remoteMcpConfigFromEnv();
    const gate = resolveRuntimeMcpAuthMode(mcpConfig);
    if (!mcpConfig || gate.mode !== 'local') return notFound(res);

    // The public path is rebuilt from the catch-all segments, so it does not
    // depend on how the rewrite presents req.url.
    const raw = req.query.oidc;
    const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    if (segments.some((s) => s === '' || s === '.' || s === '..' || s.includes('/'))) return notFound(res);
    const publicPath = `/${segments.join('/')}`;
    const allowed = publicPath === '/.well-known/oauth-authorization-server' || publicPath === '/.well-known/openid-configuration' || publicPath.startsWith('/oauth/');
    if (!allowed) return notFound(res);

    const query = new URL(req.url ?? '/', 'http://localhost').searchParams;
    query.delete('oidc');
    const search = query.toString() ? `?${query}` : '';

    const { getLocalMcpAuth } = await import('../../../lib/mcpLocalOAuth');
    await getLocalMcpAuth(mcpConfig).server.handle(req, res, publicPath, search);
    return;
  }
  return notFound(res);
}
