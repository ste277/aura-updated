# packages/mcp-tools

The shared core of Aura's MCP tool, `find_best_time`, used by two transports:

| Transport | Where | SDK | Status |
|---|---|---|---|
| Local stdio | `apps/mcp` | `@modelcontextprotocol/sdk` 1.x (pinned in `apps/mcp`) | Merged in AURA-MCP-01 |
| Remote Streamable HTTP | `apps/web/app/api/mcp/route.ts` | `@modelcontextprotocol/server` 2.x (pinned at the repo root) | **Foundation only (AURA-MCP-02-I1).** Off by default, and every request is rejected with 401. |

## Files

| File | Role | May import |
|---|---|---|
| `src/findBestTimeSchema.ts` | Strict zod input schema plus `TIMING_LIMITS` mirror | zod, the shared timezone validator, the activity catalog |
| `src/findBestTime.ts` | `executeFindBestTime`, a thin adapter over `buildTimingSearchRequest` and `runTimingSearchWithDailyRhythm` | shared Timing Search modules only |
| `src/findBestTimeTool.ts` | `FIND_BEST_TIME_TOOL` (name, title, description, annotations, schema) and the shared outcome-to-result mapping | the schema and executor types |
| `src/findBestTimeRemote.ts` | Remote profile: caps an explicit `dateRange` at a **span** of 14 days (`end − start`, the same convention as the local 90-day limit, so up to 15 calendar dates inclusive; D1 threat T9). Otherwise delegates to the executor. | the executor |
| `src/http/remoteMcpHandler.ts` | Framework-free Web `Request` → `Response` handler, protected resource metadata, fail-closed config parsing | `@modelcontextprotocol/server` and the files above |

**Rule:** the four core files must never import an MCP SDK, a database, a session or `process.env`. Both `apps/mcp/test/isolation.test.ts` (compiled graph) and `test/mcpRemoteTransport.test.ts` (source imports) enforce this. Only `apps/web/lib/mcpRemoteConfig.ts` reads the environment.

## Remote endpoint behaviour (I1)

Checks run in this order, failing closed:

1. `AURA_MCP_REMOTE_ENABLED` is not exactly `1`, or `AURA_MCP_RESOURCE_URL` / `AURA_MCP_AUTHORIZATION_SERVER` is missing or invalid: **404 for every HTTP method** on `/api/mcp` and both protected-resource-metadata URLs. Every method is routed through the handler, so Next doesn't answer OPTIONS or PUT itself.
2. A method other than POST returns **405**. The endpoint is stateless (no sessions and no SSE stream).
3. An `Origin` header that is present but not the resource's own origin returns **403**. Requests without an `Origin` header, which is normal for vendor server-to-server calls, are allowed.
4. A declared body over 16 KB returns **413** before authentication runs.
5. A missing or rejected bearer token returns **401** with `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/mcp", scope="aura.planning.read"`, adding `error="invalid_token"` only when a token was presented (RFC 6750 §3.1). A token without the scope returns **403** `insufficient_scope`.
6. The body is read with a streaming 16 KB cap (413 beyond it). Invalid JSON returns 400. A **JSON-RPC batch** (array) returns 400 / `-32600`: batching was removed from the protocol in 2025-06-18, and a batch would multiply the per-request Timing Search cost that the window cap bounds.
7. Otherwise the request is handled as stateless JSON-RPC by a fresh `McpServer` per request.

**Nothing is callable in any deployment yet.** The route always wires `rejectAllAccessTokens`. The OAuth authorization server, an in-app `oidc-provider` per the AURA-MCP-02-D2 decision record, arrives in MCP-02-I2. Personalization from the verified account, which excludes the birth profile per D-2, arrives in MCP-02-I3.

Failures return a generic 500 and log only the error class name. Arguments, tokens and bodies are never logged.

## Schema snapshot

`fixtures/findBestTimeInputSchema.json` is the canonical JSON Schema of the tool input: keys sorted, without `$schema`, because the dialect URI is SDK-specific (v1 emits draft-07, v2 emits 2020-12, and nothing else differs). Both transports' tests compare their advertised `inputSchema` against it. If you change the schema deliberately, regenerate the snapshot and review the diff.

**Known (pre-existing):** the `activityId` description's example `"exercise"` is not a catalog id. Fixing it changes the advertised schema of the merged stdio tool, so it is deferred to a separately scoped change.

## Dependencies and resolution

Code outside `apps/web` resolves bare imports from the **repository root** `node_modules`. Vercel's install command is `npm install --prefix ../.. && npm install`, and CI installs root dependencies the same way. So `zod` and `@modelcontextprotocol/server` are exact-pinned in the root `package.json`.

`apps/mcp` compiles these same files with its own `zod`, via a `paths` mapping in `apps/mcp/tsconfig.json`. The remote test asserts that the root and `apps/mcp` zod pins are identical.

## Tests

```bash
npm install                                   # repo root
npx ts-node test/mcpRemoteTransport.test.ts   # remote handler (CI: math-core-tests job)
(cd apps/mcp && npm ci && npm test)           # stdio server plus shared-definition check (CI: MCP Server job)
```
