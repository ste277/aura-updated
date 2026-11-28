/**
 * Good Right Now / Log Activity Failure State Correctness V1 -- the one
 * pure decision behind both handleLogActivity's own primary attempt and
 * the offline-queue replay loop (page.tsx): given an HTTP response status
 * (or the sentinel 'network-error' for a fetch call that never received a
 * response at all), what should happen to this specific log attempt?
 *
 * - 2xx is the only outcome that means the server actually persisted the
 *   row -- 'confirmed'.
 * - 'network-error' is the one genuinely ambiguous case (the server's
 *   real outcome is unknown -- it may have committed, may not have) --
 *   'retry', the sole legitimate justification for the offline queue.
 * - 5xx looks the same as 'network-error' to a naive check, but it is NOT
 *   ambiguous: the server was reachable and explicitly reported its own
 *   failure. Still 'retry' (a transient server issue may resolve), but
 *   deliberately NOT treated as "offline" -- callers must surface this as
 *   a real, visible failure, never a silent queue entry.
 * - 4xx is a definitive, permanent rejection (bad request, unauthenticated,
 *   unknown activity) -- retrying the identical request will fail
 *   identically forever. 'permanent-failure': never retried, never
 *   silently claimed as a success.
 */
export type HabitLogSyncOutcome = 'confirmed' | 'retry' | 'permanent-failure';

export function classifyHabitLogSyncOutcome(status: number | 'network-error'): HabitLogSyncOutcome {
  if (status === 'network-error') return 'retry';
  if (status >= 200 && status < 300) return 'confirmed';
  if (status >= 500) return 'retry';
  return 'permanent-failure';
}

// ------------------------------------------------------------------ AURA-ANDROID-REL-04 R15 (39256 option B)
/**
 * R15 -- THE authoritative success contract, shared by direct submission, replay and the "Check again" lookup.
 * Transport status alone is never evidence: an activity write is ACCEPTED only when the authenticated same-origin
 * habit-logs route answered with a validated row bound to the exact operation (account + request id + persisted
 * intent) while the account lease is current. Anything else that is not a recognised refusal leaves the operation
 * UNRESOLVED under its original identity.
 */
export const HABIT_LOGS_PATH = '/api/habit-logs';
const LOG_SOURCES = new Set(['AURA_PLANNED', 'AURA_DO_NOW', 'MANUAL', 'OVERRIDE_CAUTION']);
const SIGNIFICANCE = new Set(['LOW', 'MEDIUM', 'HIGH']);
/** Statuses meaning "this session can't write this entry now" -- kept for its account (never terminal). */
export const ACCOUNT_HOLD_STATUSES = new Set([401, 403, 409, 428]);

/** The server-persisted intent of one activity log (server-derived fields such as activeWindow are excluded). */
export interface PersistedIntent {
  activityTitle: string;
  activityId: string | null;
  logTimestampMs: number;
  notes: string | null;
  durationMinutes: number;
  logSource: string;
  activitySignificance: string;
}

/** What POST /api/habit-logs persists for this dispatch body (the route's own normalisation), or null if it would refuse it. */
export function intentOfPayload(body: Record<string, unknown>): PersistedIntent | null {
  const title = typeof body.activityTitle === 'string' ? body.activityTitle.trim() : '';
  if (!title) return null;
  const activityId = typeof body.activityId === 'string' && body.activityId.trim() ? body.activityId.trim() : null;
  if (typeof body.logTimestamp !== 'string') return null; // the route would stamp "now": not comparable
  const ts = new Date(body.logTimestamp).getTime();
  if (!Number.isFinite(ts)) return null;
  const duration = Math.min(180, Math.max(0, Number(body.durationMinutes ?? 30)));
  if (!Number.isInteger(duration)) return null; // an integer column: a fractional value would not round-trip
  return {
    activityTitle: title,
    activityId,
    logTimestampMs: ts,
    notes: body.notes ? String(body.notes).trim() : null,
    durationMinutes: duration,
    logSource: typeof body.logSource === 'string' && LOG_SOURCES.has(body.logSource) ? body.logSource : 'MANUAL',
    activitySignificance: typeof body.activitySignificance === 'string' && SIGNIFICANCE.has(body.activitySignificance) ? body.activitySignificance : 'MEDIUM',
  };
}

/** The persisted intent a server row states, or null when it lacks comparable intent (kept unresolved). */
export function intentOfRow(row: Record<string, unknown>): PersistedIntent | null {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(row, k);
  if (typeof row.activityTitle !== 'string' || !row.activityTitle) return null;
  if (!has('activityId') || !(row.activityId === null || typeof row.activityId === 'string')) return null;
  if (!has('notes') || !(row.notes === null || typeof row.notes === 'string')) return null;
  const ts = typeof row.logTimestamp === 'string' ? new Date(row.logTimestamp).getTime() : NaN;
  if (!Number.isFinite(ts)) return null;
  if (typeof row.durationMinutes !== 'number' || !Number.isFinite(row.durationMinutes)) return null;
  if (typeof row.logSource !== 'string' || !LOG_SOURCES.has(row.logSource)) return null;
  if (typeof row.activitySignificance !== 'string' || !SIGNIFICANCE.has(row.activitySignificance)) return null;
  return {
    activityTitle: row.activityTitle,
    activityId: row.activityId as string | null,
    logTimestampMs: ts,
    notes: row.notes as string | null,
    durationMinutes: row.durationMinutes,
    logSource: row.logSource,
    activitySignificance: row.activitySignificance,
  };
}

export function sameIntent(a: PersistedIntent, b: PersistedIntent): boolean {
  return a.activityTitle === b.activityTitle && a.activityId === b.activityId && a.logTimestampMs === b.logTimestampMs
    && a.notes === b.notes && a.durationMinutes === b.durationMinutes && a.logSource === b.logSource && a.activitySignificance === b.activitySignificance;
}

/** A server row validated against one exact operation. */
export interface BoundServerRow {
  id: string;
  userId: string;
  clientRequestId: string;
  activityTitle: string;
  activeWindow?: string;
  logMinuteOfDay?: number;
  logTimestamp: string;
  durationMinutes: number;
  /** R16: the complete persisted intent travels with the row, so a stored receipt can be re-validated. */
  activityId: string | null;
  notes: string | null;
  logSource: string;
  activitySignificance: string;
}
export interface OperationExpectation {
  account: string;
  clientRequestId: string;
  /** The dispatch body (canonical payload fields). */
  body: Record<string, unknown>;
}
export type RowBinding = { ok: true; row: BoundServerRow } | { ok: false; reason: 'schema' | 'record-id' | 'account' | 'request' | 'intent' | 'intent-unavailable' };

/** The ONE row-binding rule (POST answers and GET evidence alike). */
export function bindServerRow(raw: unknown, expect: OperationExpectation): RowBinding {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'schema' };
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== 'string' || !row.id.trim()) return { ok: false, reason: 'record-id' };
  if (row.userId !== expect.account) return { ok: false, reason: 'account' };
  if (row.clientRequestId !== expect.clientRequestId) return { ok: false, reason: 'request' };
  const wanted = intentOfPayload(expect.body);
  const persisted = intentOfRow(row);
  if (!wanted || !persisted) return { ok: false, reason: 'intent-unavailable' };
  if (!sameIntent(wanted, persisted)) return { ok: false, reason: 'intent' };
  return {
    ok: true,
    row: {
      id: row.id,
      userId: row.userId as string,
      clientRequestId: row.clientRequestId as string,
      activityTitle: row.activityTitle as string,
      ...(typeof row.activeWindow === 'string' ? { activeWindow: row.activeWindow } : {}),
      ...(typeof row.logMinuteOfDay === 'number' ? { logMinuteOfDay: row.logMinuteOfDay } : {}),
      logTimestamp: row.logTimestamp as string,
      durationMinutes: row.durationMinutes as number,
      activityId: persisted.activityId,
      notes: persisted.notes,
      logSource: persisted.logSource,
      activitySignificance: persisted.activitySignificance,
    },
  };
}

/**
 * R16 (39258 G5) -- the ONLY refusals that establish definitive non-commit: the route's own deterministic
 * validation failures, recognised by status AND exact message AND the client's own re-evaluation of the same rule
 * on the exact dispatch body (a refusal the client cannot predict from its own request is not evidence). Anything
 * else -- 429, 404, any other 4xx, an unknown message, an unsupported body -- proves nothing about whether this
 * operation was or will be written: it stays UNRESOLVED, its copy and identity kept for same-id recovery.
 */
export const DEFINITIVE_REFUSALS = {
  'missing-title': { status: 400, error: 'Missing required fields.' },
  'invalid-timestamp': { status: 400, error: 'logTimestamp must be a valid date.' },
} as const;
export type DefinitiveRefusal = keyof typeof DEFINITIVE_REFUSALS;
export function definitiveRefusal(body: Record<string, unknown>, status: number, error: unknown): DefinitiveRefusal | null {
  if (status === DEFINITIVE_REFUSALS['missing-title'].status && error === DEFINITIVE_REFUSALS['missing-title'].error) {
    return typeof body.activityTitle !== 'string' || !body.activityTitle.trim() ? 'missing-title' : null;
  }
  if (status === DEFINITIVE_REFUSALS['invalid-timestamp'].status && error === DEFINITIVE_REFUSALS['invalid-timestamp'].error) {
    const title = typeof body.activityTitle === 'string' ? body.activityTitle.trim() : '';
    return title && typeof body.logTimestamp === 'string' && !Number.isFinite(new Date(body.logTimestamp).getTime()) ? 'invalid-timestamp' : null;
  }
  return null;
}

export type DecodedHabitLogResponse =
  /** Validated success: the server holds exactly this operation. */
  | { kind: 'accepted'; row: BoundServerRow }
  /** R16: the route's own DEFINITIVE refusal of this exact body (definitiveRefusal), under the current lease. */
  | { kind: 'rejected'; status: number; reason: DefinitiveRefusal }
  /** No response, or the server reported its own failure: the commit is unknown -- retry under the same id. */
  | { kind: 'retry' }
  /** The session cannot write this entry now (kept for its account). */
  | { kind: 'hold'; status: number }
  /** The deployment says this bundle is out of date (kept). */
  | { kind: 'upgrade' }
  /** An answer that proves nothing about this operation: unresolved under the same id. */
  | { kind: 'unverified'; reason: string };

const isJson = (res: Response) => (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase() === 'application/json';
/** Same-origin habit-logs route, not redirected (a synthetic Response with no URL is a test double). */
function fromRoute(res: Response): boolean {
  if (res.redirected || res.type === 'opaqueredirect' || res.type === 'opaque' || res.type === 'error') return false;
  if (!res.url) return true;
  try {
    const u = new URL(res.url);
    const origin = typeof location !== 'undefined' && location.origin && location.origin !== 'null' ? location.origin : null;
    return u.pathname === HABIT_LOGS_PATH && (origin === null || u.origin === origin);
  } catch {
    return false;
  }
}
async function jsonBody(res: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try { return { ok: true, value: JSON.parse(await res.text()) }; } catch { return { ok: false }; }
}

/** THE decoder for a POST /api/habit-logs answer, used by direct submission and replay. */
export async function decodeHabitLogResponse(res: Response | 'network-error', expect: OperationExpectation, leaseCurrent: () => boolean, upgradeCode: string): Promise<DecodedHabitLogResponse> {
  if (res === 'network-error') return { kind: 'retry' };
  if (res.status === 503 && isJson(res)) {
    const b = await jsonBody(res.clone());
    if (b.ok && (b.value as { code?: unknown } | null)?.code === upgradeCode) return { kind: 'upgrade' };
  }
  if (ACCOUNT_HOLD_STATUSES.has(res.status)) return { kind: 'hold', status: res.status };
  if (res.status >= 500 || res.status === 0) return { kind: 'retry' };
  if (!fromRoute(res)) return { kind: 'unverified', reason: 'not-route' };
  if (res.status >= 400) {
    if (!isJson(res)) return { kind: 'unverified', reason: 'refusal-media-type' };
    const b = await jsonBody(res);
    const err = b.ok ? (b.value as { error?: unknown } | null)?.error : undefined;
    const reason = definitiveRefusal(expect.body, res.status, err);
    if (!reason) return { kind: 'unverified', reason: 'unsupported-refusal' }; // e.g. a JSON 429: temporary, never terminal
    if (!leaseCurrent()) return { kind: 'unverified', reason: 'account-lease' };
    return { kind: 'rejected', status: res.status, reason };
  }
  if (res.status !== 200) return { kind: 'unverified', reason: 'status' };
  if (!isJson(res)) return { kind: 'unverified', reason: 'media-type' };
  const b = await jsonBody(res);
  if (!b.ok) return { kind: 'unverified', reason: 'malformed-json' };
  const bound = bindServerRow(b.value, expect);
  if (!bound.ok) return { kind: 'unverified', reason: bound.reason };
  if (!leaseCurrent()) return { kind: 'unverified', reason: 'account-lease' };
  return { kind: 'accepted', row: bound.row };
}

/** Authoritative GET evidence: the rows of the collection answer that bind to this exact operation. */
export type DecodedHabitLogList = { kind: 'match'; row: BoundServerRow } | { kind: 'mismatch' } | { kind: 'absent' } | { kind: 'unverified'; reason: string };
export async function decodeHabitLogList(res: Response | 'network-error', expect: OperationExpectation, leaseCurrent: () => boolean): Promise<DecodedHabitLogList> {
  if (res === 'network-error') return { kind: 'unverified', reason: 'network' };
  if (!fromRoute(res) || res.status !== 200 || !isJson(res)) return { kind: 'unverified', reason: 'not-route' };
  const b = await jsonBody(res);
  if (!b.ok || !Array.isArray(b.value)) return { kind: 'unverified', reason: 'schema' };
  const named = b.value.filter((r) => r && typeof r === 'object' && (r as { clientRequestId?: unknown }).clientRequestId === expect.clientRequestId);
  if (!leaseCurrent()) return { kind: 'unverified', reason: 'account-lease' };
  for (const r of named) { const bound = bindServerRow(r, expect); if (bound.ok) return { kind: 'match', row: bound.row }; }
  // A row that names this request but does not bind (another account, another intent) is contradictory evidence;
  // absence -- even from a fresh list -- is inconclusive. Neither resolves the operation.
  return named.length ? { kind: 'mismatch' } : { kind: 'absent' };
}
