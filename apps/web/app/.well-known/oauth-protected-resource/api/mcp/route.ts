import { handleProtectedResourceMetadata } from '../../../../../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { remoteMcpConfigFromEnv } from '../../../../../lib/mcpRemoteConfig';

/**
 * AURA-MCP-02-I1 -- the same metadata at the RFC 9728 path-inserted URL for
 * the /api/mcp resource, which some MCP clients probe first.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return handleProtectedResourceMetadata({ config: remoteMcpConfigFromEnv() });
}
