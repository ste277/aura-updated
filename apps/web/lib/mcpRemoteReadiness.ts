import { loadOAuthKeysFromEnv } from '../../../packages/mcp-tools/src/auth/keys';
import { parseClientRegistry } from '../../../packages/mcp-tools/src/auth/clientPolicy';
import { parseClientAddressSource } from '../../../packages/mcp-tools/src/security/clientAddress';
import { parseRemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpConfig';

/**
 * AURA-MCP-02-I2b -- staging readiness PREFLIGHT for remote MCP OAuth.
 *
 * A pure check of an environment against everything a non-local
 * (staging/Production) authorization server would need. It ENABLES NOTHING:
 * no route imports it, and lib/mcpAuthGate.ts -- which still rejects every
 * Vercel deployment, the staging project and the Production project -- is
 * unchanged. A future, separately approved ticket would amend the gate to
 * allow a remote mode only when this preflight returns `ready: true` (see
 * packages/mcp-tools/README.md, "Deployment requirements").
 *
 * Requirements checked:
 *   - remote MCP config enabled with https issuer/resource on one origin;
 *   - AURA_MCP_OAUTH_STORE=postgres and a database URL (durable, shared
 *     state: F6, R1-L1);
 *   - AURA_MCP_CLIENT_ADDRESS_SOURCE = header:x-real-ip or
 *     header:x-vercel-forwarded-for (a trusted proxy header; R1-L2, F5);
 *   - signing keys, cookie keys, pairwise salt, audit key (keys.ts);
 *   - a valid static client registry (clientPolicy.ts), https or loopback
 *     redirect URIs only;
 *   - optional AURA_MCP_OAUTH_REFRESH_DAYS within 1..90.
 * Values are never echoed back: problems name the variable, not its content.
 */
export interface RemoteReadiness {
  ready: boolean;
  problems: string[];
}

export function assessRemoteMcpReadiness(env: Record<string, string | undefined>): RemoteReadiness {
  const problems: string[] = [];
  const config = parseRemoteMcpConfig({ enabled: env.AURA_MCP_REMOTE_ENABLED, resourceUrl: env.AURA_MCP_RESOURCE_URL, authorizationServer: env.AURA_MCP_AUTHORIZATION_SERVER });
  if (!config) problems.push('remote MCP config incomplete (AURA_MCP_REMOTE_ENABLED=1, AURA_MCP_RESOURCE_URL, AURA_MCP_AUTHORIZATION_SERVER)');
  else {
    const issuer = new URL(config.authorizationServer);
    const resource = new URL(config.resourceUrl);
    if (issuer.protocol !== 'https:' || resource.protocol !== 'https:') problems.push('issuer and resource must be https');
    if (issuer.origin !== resource.origin || issuer.pathname !== '/') problems.push('issuer must be the origin of the resource');
  }
  if (env.AURA_MCP_OAUTH_STORE !== 'postgres') problems.push('AURA_MCP_OAUTH_STORE must be "postgres" (durable shared OAuth state)');
  if (!env.AURA_MCP_OAUTH_DATABASE_URL && !env.AURA_DATABASE_URL && !env.DATABASE_URL) problems.push('a database URL is required for the OAuth store');
  try {
    const source = parseClientAddressSource(env.AURA_MCP_CLIENT_ADDRESS_SOURCE);
    if (source.kind !== 'header') problems.push('AURA_MCP_CLIENT_ADDRESS_SOURCE must name a trusted proxy header (header:x-real-ip or header:x-vercel-forwarded-for)');
  } catch {
    problems.push('AURA_MCP_CLIENT_ADDRESS_SOURCE is not a supported value');
  }
  try {
    loadOAuthKeysFromEnv(env);
  } catch (err) {
    problems.push(err instanceof Error ? err.message : 'OAuth key material invalid');
  }
  const registry = parseClientRegistry(env.AURA_MCP_OAUTH_CLIENTS);
  problems.push(...registry.errors);
  for (const c of registry.clients) {
    for (const r of c.redirect_uris) {
      const u = new URL(r);
      if (u.protocol === 'http:' && u.hostname !== '127.0.0.1' && u.hostname !== '[::1]' && u.hostname !== 'localhost') problems.push(`client ${c.client_id}: non-loopback http redirect_uri`);
    }
  }
  if (env.AURA_MCP_OAUTH_REFRESH_DAYS !== undefined) {
    const d = Number(env.AURA_MCP_OAUTH_REFRESH_DAYS);
    if (!Number.isInteger(d) || d < 1 || d > 90) problems.push('AURA_MCP_OAUTH_REFRESH_DAYS must be an integer 1-90');
  }
  return { ready: problems.length === 0, problems };
}
