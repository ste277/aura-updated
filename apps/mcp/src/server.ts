import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { FIND_BEST_TIME_TOOL, toFindBestTimeToolResult } from '../../../packages/mcp-tools/src/findBestTimeTool';
import { executeFindBestTime } from './tools/findBestTime';

export const SERVER_NAME = 'aura-mcp';
export const SERVER_VERSION = '0.0.1';
export const TOOL_NAME = FIND_BEST_TIME_TOOL.name;

/** Logs go to stderr only: stdout is reserved for MCP protocol messages. */
export function logToStderr(message: string): void {
  process.stderr.write(`[aura-mcp] ${message}\n`);
}

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  // Registered from the shared definition (packages/mcp-tools) so the stdio
  // and remote HTTP servers advertise an identical tool.
  server.registerTool(
    FIND_BEST_TIME_TOOL.name,
    {
      title: FIND_BEST_TIME_TOOL.title,
      description: FIND_BEST_TIME_TOOL.description,
      inputSchema: FIND_BEST_TIME_TOOL.inputSchema,
      annotations: { ...FIND_BEST_TIME_TOOL.annotations },
    },
    async (args) => {
      const outcome = executeFindBestTime(args);
      if (!outcome.ok) logToStderr(`${TOOL_NAME} ${outcome.kind}`);
      return toFindBestTimeToolResult(outcome);
    },
  );

  return server;
}
