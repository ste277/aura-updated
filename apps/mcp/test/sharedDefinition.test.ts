import { test, after, before } from 'node:test';
import * as assert from 'node:assert/strict';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FIND_BEST_TIME_TOOL } from '../../../packages/mcp-tools/src/findBestTimeTool';
import { connectClient } from './helpers';

/**
 * AURA-MCP-02-I1: the stdio server must advertise exactly the shared tool
 * definition that the remote HTTP server also registers from
 * (test/mcpRemoteTransport.test.ts checks the remote side against the same
 * object), so the two transports cannot drift.
 */
let client: Client;
let close: () => Promise<void>;

before(async () => {
  const conn = await connectClient();
  client = conn.client;
  close = () => conn.transport.close();
});
after(async () => close());

test('stdio tools/list matches the shared find_best_time definition', async () => {
  const { tools } = await client.listTools();
  assert.equal(tools.length, 1);
  const [tool] = tools;
  assert.equal(tool.name, FIND_BEST_TIME_TOOL.name);
  assert.equal(tool.title, FIND_BEST_TIME_TOOL.title);
  assert.equal(tool.description, FIND_BEST_TIME_TOOL.description);
  assert.deepEqual(tool.annotations, FIND_BEST_TIME_TOOL.annotations);
  assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}).sort(), Object.keys(FIND_BEST_TIME_TOOL.inputSchema.shape).sort());
});
