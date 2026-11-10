import { handleProtectedResourceMetadata } from '../../../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';

/** AURA-MCP-02-I1 -- RFC 9728 protected resource metadata (404 while remote MCP is off). */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return handleProtectedResourceMetadata({ config: remoteMcpConfigFromEnv() });
}
