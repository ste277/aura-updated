import { createHash, createHmac } from 'crypto';
import { LIMITER_UNAVAILABLE_CAUSES, type LimiterUnavailableCause } from './rateLimit';

/**
 * AURA-MCP-02-I2a -- redacted audit logging for remote MCP and its
 * authorization server.
 *
 * Redaction is structural, not pattern-based: an audit event can only carry
 * the fields declared in `McpAuditEvent`, and `sanitizeAuditEvent` copies
 * each one through a per-field allowlist or normaliser. There is no free-text
 * field, so tokens, authorization codes, PKCE verifiers, cookies, tool
 * arguments, tool results, emails and raw user ids have nowhere to go.
 *
 * Users appear only as `userRef`, a pseudonym that lets one user's events be
 * correlated without logging the id itself. I2b (F10): deployments pass
 * `userRefKey` (AURA_MCP_AUDIT_KEY) and the pseudonym becomes a truncated
 * HMAC-SHA-256, so someone holding the logs and a candidate user id can no
 * longer confirm it. Without a key (local dev/tests) the I2a unkeyed digest
 * is used.
 */

export type McpAuditEventName =
  | 'mcp.request'
  | 'oauth.grant'
  | 'oauth.token_issued'
  | 'oauth.token_revoked'
  | 'oauth.grant_revoked'
  | 'oauth.token_refreshed'
  | 'oauth.replay_detected'
  | 'oauth.throttled'
  | 'oauth.error'
  // I2b-S2: a request had no usable trusted client address (reason code only, never the value).
  | 'oauth.address_unresolved'
  | 'mcp.address_unresolved';

export interface McpAuditEvent {
  event: McpAuditEventName;
  /** Machine-readable outcome code (see AUDIT_OUTCOMES). */
  outcome: string;
  status?: number;
  clientId?: string;
  userId?: string;
  /** JSON-RPC method, recorded only when it is a known MCP method. */
  rpcMethod?: string;
  /** Tool name, recorded only when it is a registered tool. */
  tool?: string;
  /** Short error code (e.g. an OAuth `error` value); never a description. */
  errorCode?: string;
  /** Which rate-limit namespace rejected the request. */
  limitedBy?: string;
  /**
   * I2b-S12 (S11 review R-P2-2): why the limiter was unavailable -- one of
   * LIMITER_UNAVAILABLE_CAUSES (a bounded code; anything else is dropped).
   */
  cause?: string;
  latencyMs?: number;
}

export interface SanitizedAuditEvent {
  ts: string;
  event: McpAuditEventName;
  outcome: string;
  status?: number;
  clientId?: string;
  userRef?: string;
  rpcMethod?: string;
  tool?: string;
  errorCode?: string;
  limitedBy?: string;
  cause?: LimiterUnavailableCause;
  latencyMs?: number;
}

export type McpAuditSink = (event: McpAuditEvent) => void;

const LIMITER_CAUSES: ReadonlySet<string> = new Set(LIMITER_UNAVAILABLE_CAUSES);
const EVENTS: ReadonlySet<string> = new Set([
  'mcp.request',
  'oauth.grant',
  'oauth.token_issued',
  'oauth.token_revoked',
  'oauth.grant_revoked',
  'oauth.token_refreshed',
  'oauth.replay_detected',
  'oauth.throttled',
  'oauth.error',
  'oauth.address_unresolved',
  'mcp.address_unresolved',
]);
const KNOWN_RPC_METHODS: ReadonlySet<string> = new Set([
  'initialize',
  'notifications/initialized',
  'ping',
  'tools/list',
  'tools/call',
  'resources/list',
  'resources/read',
  'resources/templates/list',
  'prompts/list',
  'prompts/get',
  'completion/complete',
  'logging/setLevel',
  'notifications/cancelled',
]);
/** Identifier-shaped values only (client ids, error codes, tool names, outcome codes). */
const SAFE_IDENT = /^[A-Za-z0-9._:-]{1,64}$/;

export function auditUserRef(userId: string, key?: string): string {
  if (key) return createHmac('sha256', key).update(`aura-mcp-audit-v2:${userId}`).digest('hex').slice(0, 16);
  return createHash('sha256').update(`aura-mcp-audit-v1:${userId}`).digest('hex').slice(0, 16);
}

function ident(value: unknown): string | undefined {
  return typeof value === 'string' && SAFE_IDENT.test(value) ? value : undefined;
}

export function sanitizeAuditEvent(event: McpAuditEvent, now: () => Date = () => new Date(), knownTools: ReadonlySet<string> = new Set(), userRefKey?: string): SanitizedAuditEvent {
  const out: SanitizedAuditEvent = {
    ts: now().toISOString(),
    event: EVENTS.has(event.event) ? event.event : 'oauth.error',
    outcome: ident(event.outcome) ?? 'unknown',
  };
  if (Number.isInteger(event.status)) out.status = event.status;
  const clientId = ident(event.clientId);
  if (clientId) out.clientId = clientId;
  if (typeof event.userId === 'string' && event.userId.length > 0) out.userRef = auditUserRef(event.userId, userRefKey);
  if (typeof event.rpcMethod === 'string') out.rpcMethod = KNOWN_RPC_METHODS.has(event.rpcMethod) ? event.rpcMethod : 'other';
  if (typeof event.tool === 'string') out.tool = knownTools.has(event.tool) ? event.tool : 'other';
  const errorCode = ident(event.errorCode);
  if (errorCode) out.errorCode = errorCode;
  const limitedBy = ident(event.limitedBy);
  if (limitedBy) out.limitedBy = limitedBy;
  // I2b-S12: only the bounded limiter cause codes pass; never a raw error.
  if (typeof event.cause === 'string' && LIMITER_CAUSES.has(event.cause)) out.cause = event.cause as LimiterUnavailableCause;
  if (typeof event.latencyMs === 'number' && Number.isFinite(event.latencyMs)) out.latencyMs = Math.max(0, Math.round(event.latencyMs));
  return out;
}

/**
 * Builds a sink that sanitises every event and hands the JSON line to
 * `write` (default: console.info). A failing writer never breaks a request.
 */
export function createRedactingAuditSink(options: { write?: (line: string) => void; now?: () => Date; knownTools?: readonly string[]; userRefKey?: string } = {}): McpAuditSink {
  const write = options.write ?? ((line: string) => console.info(line));
  const knownTools = new Set(options.knownTools ?? []);
  return (event) => {
    try {
      write(JSON.stringify({ aura_mcp_audit: sanitizeAuditEvent(event, options.now, knownTools, options.userRefKey) }));
    } catch {
      // Audit must never take the request down.
    }
  };
}

export const noopAuditSink: McpAuditSink = () => undefined;
