/**
 * Remote MCP configuration parsing (AURA-MCP-02-I1; moved here unchanged in
 * AURA-MCP-02-I2a-R2 B1).
 *
 * This module deliberately has NO imports. The Pages Router OAuth route
 * (apps/web/pages/api/oauth/[...oidc].ts) reads the config through
 * apps/web/lib/mcpRemoteConfig.ts; when this parser lived in
 * remoteMcpHandler.ts, that route also loaded `@modelcontextprotocol/server`
 * at module load. The Pages Router does not bundle npm packages and Next's
 * file tracer does not copy that ESM package into `.next/standalone`, so in
 * the deployable server the route failed with ERR_MODULE_NOT_FOUND (HTTP 500)
 * before it could answer 404. Keep this file dependency-free.
 */

export interface RemoteMcpConfig {
  /** Canonical resource URL (RFC 8707 audience), e.g. https://example.com/api/mcp. */
  resourceUrl: string;
  /** Authorization server issuer URL advertised in protected resource metadata. */
  authorizationServer: string;
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
