import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

/** Compiled tests live at dist/apps/mcp/test/*.js; the server at dist/apps/mcp/src/index.js. */
export const SERVER_ENTRY = path.resolve(__dirname, '..', 'src', 'index.js');
export const DIST_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Environment for the spawned server: PATH only. No DATABASE_URL,
 * AUTH_SECRET, NODE_ENV, Vercel or credential variables are passed, which
 * proves the server needs none of them.
 */
export function minimalEnv(): Record<string, string> {
  return { PATH: process.env.PATH ?? '' };
}

export async function connectClient(): Promise<{ client: Client; transport: StdioClientTransport; stderr: () => string }> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: minimalEnv(),
    stderr: 'pipe',
  });
  let stderrText = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8');
  });
  const client = new Client({ name: 'aura-mcp-test-client', version: '0.0.0' });
  await client.connect(transport);
  return { client, transport, stderr: () => stderrText };
}

export const CHENNAI = { latitude: 13.0827, longitude: 80.2707 } as const;
export const LOS_ANGELES = { latitude: 34.0522, longitude: -118.2437 } as const;
export const SVALBARD = { latitude: 78.2232, longitude: 15.6267 } as const;
