import { parseRemoteMcpConfig, type RemoteMcpConfig } from '../../../packages/mcp-tools/src/http/remoteMcpHandler';

/**
 * AURA-MCP-02-I1 -- the only place remote MCP reads the environment.
 *
 *   AURA_MCP_REMOTE_ENABLED         must be exactly "1" (default: off)
 *   AURA_MCP_RESOURCE_URL           canonical https resource URL (RFC 8707)
 *   AURA_MCP_AUTHORIZATION_SERVER   authorization server issuer URL
 *
 * Fails closed: if the flag is off or either URL is missing or malformed,
 * every remote MCP endpoint answers 404. None of these variables is set in
 * any environment by this ticket.
 */
export function remoteMcpConfigFromEnv(): RemoteMcpConfig | null {
  return parseRemoteMcpConfig({
    enabled: process.env.AURA_MCP_REMOTE_ENABLED,
    resourceUrl: process.env.AURA_MCP_RESOURCE_URL,
    authorizationServer: process.env.AURA_MCP_AUTHORIZATION_SERVER,
  });
}
