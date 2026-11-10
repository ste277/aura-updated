import { test, after, before } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { FIND_BEST_TIME_TOOL } from '../../../packages/mcp-tools/src/findBestTimeTool';
import { DIST_ROOT, connectClient } from './helpers';

/** Committed JSON Schema snapshot that BOTH transports are compared against. */
const FIXTURE = path.resolve(DIST_ROOT, '..', '..', '..', 'packages', 'mcp-tools', 'fixtures', 'findBestTimeInputSchema.json');
/** Key-order-insensitive canonical form; `$schema` (the dialect URI) is SDK-specific: v1 draft-07, v2 2020-12. */
function canonicalSchema(schema: Record<string, unknown>): unknown {
  const { $schema: _dialect, ...rest } = schema;
  const sortDeep = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])])) : v;
  return sortDeep(rest);
}

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
  // Full JSON Schema (bounds, patterns, descriptions, required, strictness)
  // equals the committed snapshot the remote transport is also checked against.
  assert.deepEqual(canonicalSchema(tool.inputSchema as Record<string, unknown>), JSON.parse(fs.readFileSync(FIXTURE, 'utf8')));
});
