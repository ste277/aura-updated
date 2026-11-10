import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { findBestTimeObjectSchema } from './schemas/findBestTime';
import { executeFindBestTime } from './tools/findBestTime';

export const SERVER_NAME = 'aura-mcp';
export const SERVER_VERSION = '0.0.1';
export const TOOL_NAME = 'find_best_time';

const TOOL_DESCRIPTION = [
  "Find suitable start times for an activity using Aura's existing Timing Search (Panchangam windows, Muhurta and activity fit).",
  'Read-only and non-personalized: results depend only on the supplied location, timezone, date window and optional work hours.',
  'No Aura account, birth profile or saved preferences are used, and nothing is saved.',
  'Candidates are returned in ranked order with the engine\'s own score, label (including CAUTION) and structured reasons.',
].join(' ');

/** Logs go to stderr only: stdout is reserved for MCP protocol messages. */
export function logToStderr(message: string): void {
  process.stderr.write(`[aura-mcp] ${message}\n`);
}

export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.registerTool(
    TOOL_NAME,
    {
      title: 'Find best time (non-personalized)',
      description: TOOL_DESCRIPTION,
      inputSchema: findBestTimeObjectSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      const outcome = executeFindBestTime(args);
      if (!outcome.ok) {
        logToStderr(`${TOOL_NAME} ${outcome.kind}`);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `${outcome.kind}: ${outcome.message}` }],
          structuredContent: { error: { kind: outcome.kind, message: outcome.message } },
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(outcome.result, null, 2) }],
        structuredContent: outcome.result as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}
