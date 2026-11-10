/**
 * AURA-MCP-02-I1 -- Remote Transport Foundation.
 *
 * Exercises the framework-free remote MCP handler
 * (packages/mcp-tools/src/http/remoteMcpHandler.ts) directly with Web
 * Request objects: no server, no network, no database, no environment.
 *
 * Covers: fail-closed configuration, 404-when-off, method/Origin/body-size
 * gates, the 401 + RFC 9728 challenge, the deployed reject-all verifier,
 * scope enforcement, tool discovery from the shared definition, result
 * parity with the shared executor (the same function the stdio server
 * calls), the remote 14-day window cap, strict schema, dependency pin
 * guards, and static isolation of the shared core.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  handleRemoteMcpRequest,
  handleProtectedResourceMetadata,
  handleProtectedResourceMetadataOtherMethod,
  parseRemoteMcpConfig,
  protectedResourceMetadataUrl,
  rejectAllAccessTokens,
  MAX_REQUEST_BODY_BYTES,
  MCP_SCOPE,
  type AccessTokenVerifier,
  type RemoteMcpConfig,
} from '../packages/mcp-tools/src/http/remoteMcpHandler';
import { FIND_BEST_TIME_TOOL } from '../packages/mcp-tools/src/findBestTimeTool';
import { executeFindBestTime } from '../packages/mcp-tools/src/findBestTime';
import { REMOTE_MAX_DATE_RANGE_DAYS } from '../packages/mcp-tools/src/findBestTimeRemote';

let allPassed = true;
function check(label: string, condition: boolean, detail?: unknown) {
  console.log(`${condition ? 'OK  ' : 'FAIL'} ${label}${!condition && detail !== undefined ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`);
  if (!condition) allPassed = false;
}

const ROOT = path.resolve(__dirname, '..');
const CONFIG: RemoteMcpConfig = { resourceUrl: 'https://aura.example/api/mcp', authorizationServer: 'https://aura.example' };
const TEST_TOKEN = 'test-token-not-a-real-credential';
const acceptTestToken: AccessTokenVerifier = async (token, resource) =>
  token === TEST_TOKEN && resource === CONFIG.resourceUrl ? { userId: 'test-user', scopes: [MCP_SCOPE] } : null;
const acceptWithoutScope: AccessTokenVerifier = async (token) => (token === TEST_TOKEN ? { userId: 'test-user', scopes: [] } : null);
const NOW = () => new Date('2026-11-10T13:00:00.000Z');

const ACCEPT = 'application/json, text/event-stream';
function mcpRequest(body: unknown, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(CONFIG.resourceUrl, {
    method,
    headers: { 'content-type': 'application/json', accept: ACCEPT, ...headers },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });
}
const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const PROTOCOL = { 'mcp-protocol-version': '2025-11-25' };
const deps = (verifyAccessToken: AccessTokenVerifier = acceptTestToken) => ({ config: CONFIG, verifyAccessToken, now: NOW });

async function rpc(method: string, params: unknown, verifier: AccessTokenVerifier = acceptTestToken): Promise<{ status: number; body: any }> {
  const res = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method, params }, { ...AUTH, ...PROTOCOL }), deps(verifier));
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const CHENNAI = { latitude: 13.0827, longitude: 80.2707 };
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };

async function main() {
  // ---------------------------------------------------------------- config
  check('config: off by default (no env)', parseRemoteMcpConfig({}) === null);
  check('config: flag must be exactly "1"', parseRemoteMcpConfig({ enabled: 'true', resourceUrl: CONFIG.resourceUrl, authorizationServer: CONFIG.authorizationServer }) === null);
  check('config: enabled without URLs fails closed', parseRemoteMcpConfig({ enabled: '1' }) === null);
  check('config: http (non-localhost) rejected', parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'http://aura.example/api/mcp', authorizationServer: CONFIG.authorizationServer }) === null);
  check('config: query string rejected', parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'https://aura.example/api/mcp?x=1', authorizationServer: CONFIG.authorizationServer }) === null);
  check('config: credentials rejected', parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'https://u:p@aura.example/api/mcp', authorizationServer: CONFIG.authorizationServer }) === null);
  check('config: garbage rejected', parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'not a url', authorizationServer: CONFIG.authorizationServer }) === null);
  const parsed = parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'https://aura.example/api/mcp/', authorizationServer: 'https://aura.example/' });
  check('config: valid https config normalized (no trailing slash)', parsed?.resourceUrl === 'https://aura.example/api/mcp' && parsed?.authorizationServer === 'https://aura.example', parsed);
  check('config: localhost http allowed for local testing', parseRemoteMcpConfig({ enabled: '1', resourceUrl: 'http://localhost:3000/api/mcp', authorizationServer: 'http://localhost:3000' }) !== null);

  // ---------------------------------------------------------------- disabled
  for (const method of ['POST', 'GET', 'DELETE']) {
    const res = await handleRemoteMcpRequest(mcpRequest({}, AUTH, method), { config: null, verifyAccessToken: acceptTestToken });
    check(`disabled: ${method} /api/mcp -> 404`, res.status === 404, res.status);
  }
  check('disabled: protected resource metadata -> 404', handleProtectedResourceMetadata({ config: null }).status === 404);
  check('disabled: other methods on metadata URLs -> 404', handleProtectedResourceMetadataOtherMethod({ config: null }).status === 404);
  check('enabled: other methods on metadata URLs -> 405', handleProtectedResourceMetadataOtherMethod({ config: CONFIG }).status === 405);
  for (const method of ['OPTIONS', 'PUT', 'PATCH', 'HEAD']) {
    const res = await handleRemoteMcpRequest(new Request(CONFIG.resourceUrl, { method }), { config: null, verifyAccessToken: acceptTestToken });
    check(`disabled: ${method} /api/mcp -> 404`, res.status === 404, res.status);
  }
  const routeSrc = fs.readFileSync(path.join(ROOT, 'apps/web/app/api/mcp/route.ts'), 'utf8');
  check('disabled: /api/mcp route exports every method through the handler (no Next auto-204/405)', ['POST', 'GET', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD'].every((m) => new RegExp(`export const ${m} = handle;`).test(routeSrc)));

  // ---------------------------------------------------------------- metadata
  const prm = handleProtectedResourceMetadata({ config: CONFIG });
  const prmBody = await prm.json();
  check('metadata: 200 with resource, authorization_servers and scope', prm.status === 200 && prmBody.resource === CONFIG.resourceUrl && prmBody.authorization_servers[0] === CONFIG.authorizationServer && prmBody.scopes_supported.includes(MCP_SCOPE), prmBody);
  check('metadata: path-inserted RFC 9728 URL', protectedResourceMetadataUrl(CONFIG.resourceUrl) === 'https://aura.example/.well-known/oauth-protected-resource/api/mcp');

  // ---------------------------------------------------------------- gates
  for (const method of ['GET', 'DELETE']) {
    const res = await handleRemoteMcpRequest(mcpRequest({}, AUTH, method), deps());
    check(`enabled: ${method} -> 405 with Allow: POST`, res.status === 405 && res.headers.get('allow') === 'POST', res.status);
  }
  const foreign = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...AUTH, origin: 'https://evil.example' }), deps());
  check('origin: present and not allowlisted -> 403', foreign.status === 403, foreign.status);
  const sameOrigin = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { ...AUTH, ...PROTOCOL, origin: 'https://aura.example' }), deps());
  check('origin: resource origin allowed', sameOrigin.status === 200, sameOrigin.status);

  const declaredHuge = await handleRemoteMcpRequest(mcpRequest('{}', { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }), deps(rejectAllAccessTokens));
  check('body: declared length over cap -> 413 before auth', declaredHuge.status === 413, declaredHuge.status);

  const noToken = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps());
  const challenge = noToken.headers.get('www-authenticate') ?? '';
  check('auth: missing token -> 401', noToken.status === 401, noToken.status);
  check('auth: 401 carries Bearer resource_metadata (path-inserted) and scope', challenge.startsWith('Bearer ') && challenge.includes('resource_metadata="https://aura.example/.well-known/oauth-protected-resource/api/mcp"') && challenge.includes(`scope="${MCP_SCOPE}"`), challenge);
  const malformed = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Basic abc' }), deps());
  check('auth: non-Bearer scheme -> 401 without error code', malformed.status === 401 && !(malformed.headers.get('www-authenticate') ?? '').includes('error='), malformed.status);
  check('auth: no credentials -> challenge without error code (RFC 6750 3.1)', !challenge.includes('error='), challenge);
  const wrong = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer some-other-token' }), deps());
  check('auth: unknown token -> 401 with error="invalid_token"', wrong.status === 401 && (wrong.headers.get('www-authenticate') ?? '').includes('error="invalid_token"'), wrong.status);
  const deployed = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH), deps(rejectAllAccessTokens));
  check('auth: deployed reject-all verifier -> 401 even for the test token', deployed.status === 401, deployed.status);
  const cookieOnly = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { cookie: 'as_session=anything' }), deps());
  check('auth: Aura session cookie alone -> 401', cookieOnly.status === 401, cookieOnly.status);
  const noScope = await handleRemoteMcpRequest(mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, AUTH), deps(acceptWithoutScope));
  check('auth: token without aura.planning.read -> 403 insufficient_scope', noScope.status === 403 && (noScope.headers.get('www-authenticate') ?? '').includes('insufficient_scope'), noScope.status);

  const bigBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(MAX_REQUEST_BODY_BYTES) } });
  const actualHuge = await handleRemoteMcpRequest(mcpRequest(bigBody, AUTH), deps());
  check('body: actual body over cap (no content-length) -> 413', actualHuge.status === 413, actualHuge.status);
  const batch = await handleRemoteMcpRequest(mcpRequest([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }], { ...AUTH, ...PROTOCOL }), deps());
  const batchBody = await batch.json();
  check('body: JSON-RPC batch rejected (400, -32600) before any tool runs', batch.status === 400 && batchBody.error?.code === -32600, batchBody);
  const chunked = new Request(CONFIG.resourceUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: ACCEPT, ...AUTH },
    body: new ReadableStream({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new TextEncoder().encode('x'.repeat(1024))); c.close(); } }),
    duplex: 'half',
  } as RequestInit & { duplex: 'half' });
  const chunkedRes = await handleRemoteMcpRequest(chunked, deps());
  check('body: streamed body without content-length is cut off at the cap -> 413', chunkedRes.status === 413, chunkedRes.status);
  const badJson = await handleRemoteMcpRequest(mcpRequest('{not json', AUTH), deps());
  check('body: invalid JSON -> 400 parse error', badJson.status === 400, badJson.status);

  // ---------------------------------------------------------------- MCP
  const init = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
  check('mcp: initialize -> 200 with protocol 2025-11-25 and tools capability', init.status === 200 && init.body.result.protocolVersion === '2025-11-25' && !!init.body.result.capabilities.tools, init.body);

  const list = await rpc('tools/list', {});
  const tools = list.body?.result?.tools ?? [];
  check('mcp: exactly one tool, find_best_time', tools.length === 1 && tools[0].name === 'find_best_time', tools.map((t: any) => t.name));
  const tool = tools[0] ?? {};
  check('mcp: title/description from the shared definition', tool.title === FIND_BEST_TIME_TOOL.title && tool.description === FIND_BEST_TIME_TOOL.description);
  check('mcp: annotations equal the shared definition (readOnlyHint true, destructiveHint false)', JSON.stringify(tool.annotations) === JSON.stringify(FIND_BEST_TIME_TOOL.annotations), tool.annotations);
  const shapeKeys = Object.keys(FIND_BEST_TIME_TOOL.inputSchema.shape).sort();
  check('mcp: inputSchema properties equal the shared schema shape', JSON.stringify(Object.keys(tool.inputSchema?.properties ?? {}).sort()) === JSON.stringify(shapeKeys), Object.keys(tool.inputSchema?.properties ?? {}));
  check('mcp: inputSchema forbids additional properties', tool.inputSchema?.additionalProperties === false, tool.inputSchema?.additionalProperties);
  const sortDeep = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sortDeep) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sortDeep((v as Record<string, unknown>)[k])])) : v;
  const { $schema: _dialect, ...remoteSchema } = tool.inputSchema ?? {};
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/mcp-tools/fixtures/findBestTimeInputSchema.json'), 'utf8'));
  check('mcp: full inputSchema equals the committed snapshot (also asserted for stdio in apps/mcp/test/sharedDefinition.test.ts)', JSON.stringify(sortDeep(remoteSchema)) === JSON.stringify(fixture));

  const cases: Array<{ label: string; args: Record<string, unknown> }> = [
    { label: 'free-text, TOMORROW morning, New York', args: { taskTitle: 'Morning run', durationMinutes: 45, horizon: 'TOMORROW', timePreference: 'MORNING', timezone: 'America/New_York', location: NEW_YORK, referenceTime: '2026-11-10T08:00:00-05:00' } },
    { label: 'catalog activity, 7-day range, Chennai, with Daily Rhythm', args: { activityId: 'meditation', durationMinutes: 30, dateRange: { start: '2026-11-11', end: '2026-11-17' }, timezone: 'Asia/Kolkata', location: CHENNAI, referenceTime: '2026-11-10T09:00:00+05:30', limit: 5, dailyRhythm: { workStart: '09:00', workEnd: '17:00', workDays: [1, 2, 3, 4, 5] } } },
    { label: 'DST-crossing range (US DST ends 2026-11-01), New York', args: { taskTitle: 'Evening walk', durationMinutes: 30, dateRange: { start: '2026-10-30', end: '2026-11-03' }, timePreference: 'EVENING', timezone: 'America/New_York', location: NEW_YORK, referenceTime: '2026-10-29T12:00:00-04:00', limit: 5 } },
    { label: 'server clock default (no referenceTime)', args: { taskTitle: 'Call family', durationMinutes: 20, horizon: 'TODAY', timezone: 'Asia/Kolkata', location: CHENNAI } },
  ];
  for (const { label, args } of cases) {
    const call = await rpc('tools/call', { name: 'find_best_time', arguments: args });
    const direct = executeFindBestTime(args, NOW);
    const remote = call.body?.result;
    const ok = direct.ok && remote && !remote.isError && JSON.stringify(remote.structuredContent) === JSON.stringify(direct.result);
    check(`parity: ${label} -- remote structuredContent deep-equals shared executor`, !!ok, remote?.content?.[0]?.text ?? call.body);
  }

  const exactCap = await rpc('tools/call', { name: 'find_best_time', arguments: { taskTitle: 'Walk', durationMinutes: 30, dateRange: { start: '2026-11-11', end: '2026-11-25' }, timezone: 'Asia/Kolkata', location: CHENNAI, referenceTime: '2026-11-10T09:00:00+05:30', limit: 1 } });
  check(`window: span of ${REMOTE_MAX_DATE_RANGE_DAYS} days (end - start, same convention as the 90-day local limit) accepted`, exactCap.body?.result && !exactCap.body.result.isError, exactCap.body?.result?.content?.[0]?.text);
  const overCap = await rpc('tools/call', { name: 'find_best_time', arguments: { taskTitle: 'Walk', durationMinutes: 30, dateRange: { start: '2026-11-11', end: '2026-11-26' }, timezone: 'Asia/Kolkata', location: CHENNAI, referenceTime: '2026-11-10T09:00:00+05:30' } });
  check(`window: span of ${REMOTE_MAX_DATE_RANGE_DAYS + 1} days rejected by the remote cap specifically`, overCap.body?.result?.isError === true && /INVALID_INPUT: dateRange: must span 14 days or fewer for remote requests/.test(overCap.body.result.content[0].text), overCap.body?.result);

  const injected = await rpc('tools/call', { name: 'find_best_time', arguments: { ...cases[0].args, userId: 'someone-else' } });
  check('schema: client-supplied userId is rejected (strict schema)', injected.body?.result?.isError === true && /userId/.test(injected.body.result.content[0].text), injected.body);
  const unknownTool = await rpc('tools/call', { name: 'create_plan', arguments: {} });
  check('read-only: unknown/write tool name is not callable', !!unknownTool.body?.error || unknownTool.body?.result?.isError === true, unknownTool.body);

  // ---------------------------------------------------------------- pins
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const mcpPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps/mcp/package.json'), 'utf8'));
  const exact = (v: unknown) => typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
  check('pins: root zod and @modelcontextprotocol/server are exact', exact(rootPkg.dependencies?.zod) && exact(rootPkg.dependencies?.['@modelcontextprotocol/server']), rootPkg.dependencies);
  check('pins: root zod === apps/mcp zod (one zod version across transports)', rootPkg.dependencies?.zod === mcpPkg.dependencies?.zod, [rootPkg.dependencies?.zod, mcpPkg.dependencies?.zod]);

  // ---------------------------------------------------------------- isolation (static)
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const imports = (src: string) => [...src.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  const CORE = ['packages/mcp-tools/src/findBestTime.ts', 'packages/mcp-tools/src/findBestTimeSchema.ts', 'packages/mcp-tools/src/findBestTimeTool.ts', 'packages/mcp-tools/src/findBestTimeRemote.ts'];
  for (const rel of CORE) {
    const src = read(rel);
    const bad = imports(src).filter((s) => /modelcontextprotocol|\/db$|\/session$|\/auth$|productEvents|prisma|^pg$|^next/.test(s));
    check(`isolation: ${rel} imports no SDK, database, session or framework`, bad.length === 0, bad);
    check(`isolation: ${rel} reads no environment variables`, !/process\.env/.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')));
  }
  const handlerImports = imports(read('packages/mcp-tools/src/http/remoteMcpHandler.ts'));
  check('isolation: remote handler imports only the SDK v2 server and shared core', handlerImports.every((s) => s === '@modelcontextprotocol/server' || s.startsWith('../')), handlerImports);
  check('isolation: remote handler reads no environment variables', !/process\.env/.test(read('packages/mcp-tools/src/http/remoteMcpHandler.ts')));
  const route = read('apps/web/app/api/mcp/route.ts');
  check('deployment: /api/mcp route wires rejectAllAccessTokens (nothing callable until I2)', /verifyAccessToken:\s*rejectAllAccessTokens/.test(route) && !/acceptTestToken|TEST_TOKEN/.test(route));

  if (!allPassed) {
    console.error('\nAURA-MCP-02-I1 remote transport test FAILED');
    process.exit(1);
  }
  console.log('\nAll AURA-MCP-02-I1 remote transport checks passed.');
}

main().catch((err) => {
  console.error('AURA-MCP-02-I1 remote transport test crashed:', err);
  process.exit(1);
});
