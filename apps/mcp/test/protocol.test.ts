import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import { CHENNAI, connectClient, minimalEnv, SERVER_ENTRY } from './helpers';

const VALID_ARGS = {
  activityId: 'workout',
  durationMinutes: 45,
  location: CHENNAI,
  timezone: 'Asia/Kolkata',
  dateRange: { start: '2026-11-10', end: '2026-11-10' },
  referenceTime: '2026-11-09T00:00:00+05:30',
};

test('1. initialization succeeds and advertises tools capability', async () => {
  const { client } = await connectClient();
  try {
    assert.deepEqual(client.getServerVersion(), { name: 'aura-mcp', version: '0.0.1' });
    const caps = client.getServerCapabilities();
    assert.ok(caps?.tools, 'tools capability advertised');
    assert.equal(caps?.resources, undefined, 'no resources capability');
    assert.equal(caps?.prompts, undefined, 'no prompts capability');
  } finally {
    await client.close();
  }
});

test('2/3. tool discovery lists exactly find_best_time, marked read-only', async () => {
  const { client } = await connectClient();
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['find_best_time']);
    const tool = tools[0];
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.inputSchema.type, 'object');
    assert.deepEqual(
      Object.keys(tool.inputSchema.properties ?? {}).sort(),
      ['activityId', 'dailyRhythm', 'dateRange', 'durationMinutes', 'horizon', 'limit', 'location', 'referenceTime', 'taskTitle', 'timePreference', 'timezone'],
    );
    assert.deepEqual([...(tool.inputSchema.required ?? [])].sort(), ['durationMinutes', 'location', 'timezone']);
    assert.match(tool.description ?? '', /non-personalized/i);
  } finally {
    await client.close();
  }
});

test('4. valid invocation returns structured, non-personalized candidates', async () => {
  const { client } = await connectClient();
  try {
    const result = await client.callTool({ name: 'find_best_time', arguments: VALID_ARGS });
    assert.notEqual(result.isError, true);
    const structured = result.structuredContent as Record<string, any>;
    assert.equal(structured.personalized, false);
    assert.match(structured.personalizationNote, /No Aura account or birth-profile personalization was applied/);
    assert.equal(structured.mode, 'FIND');
    assert.ok(structured.candidates.length >= 1);
    assert.deepEqual(structured.candidates.map((c: any) => c.rank), structured.candidates.map((_: unknown, i: number) => i + 1));
    const text = (result.content as { type: string; text: string }[])[0];
    assert.equal(text.type, 'text');
    assert.deepEqual(JSON.parse(text.text), structured, 'text content mirrors structuredContent');
  } finally {
    await client.close();
  }
});

test('5. invalid input is rejected as a tool error, server keeps serving', async () => {
  const { client } = await connectClient();
  try {
    const bad = await client.callTool({ name: 'find_best_time', arguments: { ...VALID_ARGS, timezone: 'Mars/Olympus' } });
    assert.equal(bad.isError, true);
    assert.match((bad.content as any)[0].text, /timezone/);
    const missing = await client.callTool({ name: 'find_best_time', arguments: { activityId: 'workout' } });
    assert.equal(missing.isError, true);
    const ok = await client.callTool({ name: 'find_best_time', arguments: VALID_ARGS });
    assert.notEqual(ok.isError, true, 'server still healthy after rejected calls');
  } finally {
    await client.close();
  }
});

test('5b. over the protocol: unknown keys, fractional limit and impossible referenceTime are rejected', async () => {
  const { client } = await connectClient();
  try {
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ ...VALID_ARGS, userId: 'someone-else' }, /userId|Unrecognized/i],
      [{ ...VALID_ARGS, limit: 2.5 }, /limit/],
      [{ ...VALID_ARGS, referenceTime: '2026-02-30T00:00:00Z' }, /referenceTime/],
    ];
    for (const [args, pattern] of cases) {
      const result = await client.callTool({ name: 'find_best_time', arguments: args });
      assert.equal(result.isError, true, JSON.stringify(args));
      assert.match((result.content as any)[0].text, pattern);
    }
    const { tools } = await client.listTools();
    assert.equal(tools[0].inputSchema.additionalProperties, false, 'advertised schema forbids unknown keys');
  } finally {
    await client.close();
  }
});

test('6. unknown tool is reported, not executed', async () => {
  const { client } = await connectClient();
  try {
    const result = await client.callTool({ name: 'create_plan', arguments: {} }).catch((err: Error) => ({ thrown: err.message }));
    if ('thrown' in result) {
      assert.match(String(result.thrown), /not found/i);
    } else {
      assert.equal(result.isError, true);
      assert.match((result.content as any)[0].text, /Tool create_plan not found/);
    }
  } finally {
    await client.close();
  }
});

test('7. execution-level errors are returned safely (no stack trace, no paths)', async () => {
  const { client } = await connectClient();
  try {
    // Passes schema validation but is rejected by the existing pipeline's
    // cross-field rules -> exercises the INVALID_INPUT path after the SDK.
    const result = await client.callTool({ name: 'find_best_time', arguments: { ...VALID_ARGS, taskTitle: 'Run' } });
    assert.equal(result.isError, true);
    const text: string = (result.content as any)[0].text;
    assert.match(text, /exactly one of activityId or taskTitle/);
    assert.doesNotMatch(text, /\n\s+at |\/Users\/|node_modules|dist\//, 'no stack frames or filesystem paths');
  } finally {
    await client.close();
  }
});

/** Raw JSON-RPC session over the child's real stdio, no SDK client. */
function rawSession(messages: object[]): Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], { env: minimalEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`server did not exit after stdin closed; stderr=${stderr}`));
    }, 20_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, signal });
    });
    const expected = messages.filter((m: any) => m.id !== undefined).length;
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`);
    // Close stdin (client disconnect) once every request has a response.
    const poll = setInterval(() => {
      const responses = stdout.split('\n').filter((l) => l.trim()).length;
      if (responses >= expected) {
        clearInterval(poll);
        child.stdin.end();
      }
    }, 25);
  });
}

test('8/9. stdout carries only JSON-RPC messages, and the server exits cleanly when stdin closes', async () => {
  const { stdout, stderr, code, signal } = await rawSession([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'raw', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'find_best_time', arguments: VALID_ARGS } },
    { jsonrpc: '2.0', id: 4, method: 'no/such/method' },
  ]);
  assert.equal(code, 0, `clean exit code; stderr=${stderr}`);
  assert.equal(signal, null);

  const lines = stdout.split('\n').filter((l) => l.length > 0);
  assert.equal(lines.length, 4, 'one stdout line per request, nothing else');
  const parsed = lines.map((l) => JSON.parse(l));
  for (const message of parsed) assert.equal(message.jsonrpc, '2.0');
  const byId = new Map(parsed.map((m) => [m.id, m]));
  assert.equal(byId.get(1).result.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.deepEqual(byId.get(2).result.tools.map((t: any) => t.name), ['find_best_time']);
  assert.equal(byId.get(3).result.structuredContent.personalized, false);
  assert.equal(byId.get(4).error.code, -32601, 'unknown method -> Method not found');

  // Diagnostics went to stderr, never stdout.
  assert.match(stderr, /\[aura-mcp\] ready on stdio/);
  assert.doesNotMatch(stdout, /aura-mcp\]/);
});

test('9b. malformed JSON on stdin does not crash the server or pollute stdout', async () => {
  const { stdout, code } = await new Promise<{ stdout: string; code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [SERVER_ENTRY], { env: minimalEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c: Buffer) => (out += c.toString('utf8')));
    child.on('exit', (exitCode) => resolve({ stdout: out, code: exitCode }));
    child.stdin.write('this is not json\n');
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'raw', version: '0' } } })}\n`);
    const poll = setInterval(() => {
      if (out.includes('"id":1')) {
        clearInterval(poll);
        child.stdin.end();
      }
    }, 25);
  });
  assert.equal(code, 0);
  for (const line of stdout.split('\n').filter((l) => l)) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  assert.ok(stdout.includes('"id":1'), 'still answered initialize after a malformed line');
});

test('10. runs with PATH as the only environment variable (no DB, no secrets)', async () => {
  // connectClient() spawns with minimalEnv(); a successful round trip proves it.
  assert.deepEqual(Object.keys(minimalEnv()), ['PATH']);
  const { client } = await connectClient();
  try {
    const result = await client.callTool({ name: 'find_best_time', arguments: VALID_ARGS });
    assert.notEqual(result.isError, true);
  } finally {
    await client.close();
  }
});
