import { handleProtectedResourceMetadata, handleProtectedResourceMetadataOtherMethod } from '../../../../../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { remoteMcpConfigFromEnv } from '../../../../../lib/mcpRemoteConfig';

/**
 * AURA-MCP-02-I1 -- the same metadata at the RFC 9728 path-inserted URL for
 * the /api/mcp resource, which some MCP clients probe first.
 */
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return handleProtectedResourceMetadata({ config: remoteMcpConfigFromEnv() });
}

/**
 * Every other method: 404 while disabled (so the route is indistinguishable
 * from a missing one -- Next would otherwise answer OPTIONS/POST/... itself
 * with 204/405), 405 when enabled.
 */
function otherMethod(): Response {
  return handleProtectedResourceMetadataOtherMethod({ config: remoteMcpConfigFromEnv() });
}
export const OPTIONS = otherMethod;
export const POST = otherMethod;
export const PUT = otherMethod;
export const PATCH = otherMethod;
export const DELETE = otherMethod;
