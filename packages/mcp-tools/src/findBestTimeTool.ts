import { findBestTimeObjectSchema } from './findBestTimeSchema';
import type { FindBestTimeOutcome } from './findBestTime';

/**
 * The single, SDK-agnostic definition of the `find_best_time` tool.
 *
 * Both transports register the tool from THIS object, so the name, title,
 * description, annotations and input schema cannot drift between them:
 *   - apps/mcp/src/server.ts            local stdio server (SDK v1)
 *   - packages/mcp-tools/src/http/*     remote Streamable HTTP server (SDK v2)
 *
 * This module imports only zod (via the schema) and the shared Timing Search
 * pipeline (via the executor types). It must never import an MCP SDK, a
 * database, a session or any environment variable.
 */
export const FIND_BEST_TIME_TOOL = {
  name: 'find_best_time',
  title: 'Find best time (non-personalized)',
  description: [
    "Find suitable start times for an activity using Aura's existing Timing Search (Panchangam windows, Muhurta and activity fit).",
    'Read-only and non-personalized: results depend only on the supplied location, timezone, date window and optional work hours.',
    'No Aura account, birth profile or saved preferences are used, and nothing is saved.',
    "Candidates are returned in ranked order with the engine's own score, label (including CAUTION) and structured reasons.",
  ].join(' '),
  inputSchema: findBestTimeObjectSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

export interface FindBestTimeToolResult {
  [key: string]: unknown;
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent: Record<string, unknown>;
}

/** The one mapping from an executor outcome to an MCP tool result, shared by both transports. */
export function toFindBestTimeToolResult(outcome: FindBestTimeOutcome): FindBestTimeToolResult {
  if (!outcome.ok) {
    return {
      isError: true,
      content: [{ type: 'text', text: `${outcome.kind}: ${outcome.message}` }],
      structuredContent: { error: { kind: outcome.kind, message: outcome.message } },
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(outcome.result, null, 2) }],
    structuredContent: outcome.result as unknown as Record<string, unknown>,
  };
}
