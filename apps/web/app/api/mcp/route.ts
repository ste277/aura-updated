import { handleRemoteMcpRequest, rejectAllAccessTokens } from '../../../../../packages/mcp-tools/src/http/remoteMcpHandler';
import { remoteMcpConfigFromEnv } from '../../../lib/mcpRemoteConfig';

/**
 * AURA-MCP-02-I1 -- remote MCP endpoint (Streamable HTTP, stateless).
 *
 * A thin adapter: every decision lives in handleRemoteMcpRequest
 * (packages/mcp-tools/src/http/remoteMcpHandler.ts). Off by default (404).
 * Even when enabled, I1 deliberately wires `rejectAllAccessTokens`, so every
 * request is answered 401 until the authorization server (MCP-02-I2) exists.
 */
export const dynamic = 'force-dynamic';

function handle(req: Request): Promise<Response> {
  return handleRemoteMcpRequest(req, { config: remoteMcpConfigFromEnv(), verifyAccessToken: rejectAllAccessTokens });
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
