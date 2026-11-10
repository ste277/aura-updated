#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer, logToStderr } from './server';

/**
 * Local stdio entrypoint. Opens no network listener and reads no
 * environment configuration, database or credentials. stdout carries MCP
 * JSON-RPC messages only; every diagnostic goes to stderr.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();

  let closing = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logToStderr(`shutting down (${reason})`);
    try {
      await server.close();
    } finally {
      process.exit(0);
    }
  };

  process.stdin.on('end', () => void shutdown('stdin closed'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await server.connect(transport);
  logToStderr('ready on stdio');
}

main().catch((err: unknown) => {
  logToStderr(`fatal: ${err instanceof Error ? err.name : 'Error'}`);
  process.exit(1);
});
